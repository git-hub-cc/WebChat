package com.p2pChat.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service implementation for interacting with the OpenAI API.
 * This class encapsulates the business logic for storing conversation history,
 * generating summaries, and handling standard chat completions.
 */
@Service
public class OpenAIServiceImpl implements OpenAIService {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIServiceImpl.class);

    // 用于存储 "user:character_id" -> requestBody 的历史记录
    private final Map<String, String> lastRequestStore = new ConcurrentHashMap<>();

    // 用于存储 "user:character_id" -> EventMood 的今日状态
    private final Map<String, EventMood> characterStateStore = new ConcurrentHashMap<>();

    private final WebClient webClient;
    private final String summaryPrompt;
    private final String eventMoodPrompt;
    private final String model;
    private final ObjectMapper objectMapper;

    // 用于封装事件和心情的记录类 (Record)
    private record EventMood(String event, String mood) {}

    @Autowired
    public OpenAIServiceImpl(@Qualifier("openaiWebClient") WebClient webClient,
                             @Qualifier("summaryPrompt") String summaryPrompt,
                             @Qualifier("eventMoodPrompt") String eventMoodPrompt,
                             @Qualifier("model") String model,
                             ObjectMapper objectMapper) {
        this.webClient = webClient;
        this.summaryPrompt = summaryPrompt;
        this.eventMoodPrompt = eventMoodPrompt;
        this.model = model;
        this.objectMapper = objectMapper;
    }

    @Override
    public Mono<String> prepareChatContext(String originalRequestBody) {
        try {
            Map<String, Object> bodyMap = objectMapper.readValue(originalRequestBody, Map.class);
            String user = (String) bodyMap.get("user");
            String characterId = (String) bodyMap.get("character_id");

            if (user == null || characterId == null) {
                logger.warn("Request body missing 'user' or 'character_id'. Skipping event/mood generation.");
                return Mono.just(originalRequestBody);
            }

            String key = user + ":" + characterId;

            return getOrCreateEventMood(key, bodyMap)
                    .flatMap(eventMood -> {
                        try {
                            String modifiedBody = updateSystemPrompt(bodyMap, eventMood);
                            logger.info("Successfully updated system prompt for key '{}'", key);
                            return Mono.just(modifiedBody);
                        } catch (JsonProcessingException e) {
                            logger.error("Failed to re-serialize body after updating system prompt for key '{}'", key, e);
                            return Mono.just(originalRequestBody);
                        }
                    })
                    .defaultIfEmpty(originalRequestBody)
                    .onErrorReturn(originalRequestBody);
        } catch (JsonProcessingException e) {
            logger.warn("Failed to parse request body for context preparation. Returning original body.", e);
            return Mono.just(originalRequestBody);
        }
    }

    @Override
    public boolean hasHistory(String user, String characterId) {
        if (user == null || characterId == null) {
            return false;
        }
        String key = user + ":" + characterId;
        boolean hasHistory = lastRequestStore.containsKey(key);
        logger.debug("Checking history for key '{}': {}", key, hasHistory);
        return hasHistory;
    }

    @Override
    public void storeLastRequest(String requestBody) {
        try {
            Map<String, Object> bodyMap = objectMapper.readValue(requestBody, Map.class);
            String user = (String) bodyMap.get("user");
            String characterId = (String) bodyMap.get("character_id");

            if (user != null && characterId != null) {
                String key = user + ":" + characterId;
                lastRequestStore.put(key, requestBody);
                logger.info("Stored request history for user '{}' and character '{}'.", user, characterId);
            } else {
                logger.warn("Could not store history: 'user' or 'character_id' missing from request body.");
            }
        } catch (JsonProcessingException e) {
            logger.warn("Failed to parse JSON for storing request history: {}", e.getMessage());
        }
    }

    @Override
    public Flux<String> streamBaseChatCompletion(String requestBody) {
        logger.info("Processing base chat completion request.");
        storeLastRequest(requestBody);
        return performOpenAIStreamRequest(requestBody, "/chat/completions");
    }

    @Override
    public Flux<String> getSummaryStream(String user, String characterId) {
        logger.info("Requesting summary for user '{}' and character '{}'.", user, characterId);
        String lastRequestBody = getLastRequest(user, characterId);

        if (lastRequestBody == null || lastRequestBody.isEmpty()) {
            logger.warn("No history found for user '{}' and character '{}'. Cannot generate summary.", user, characterId);
            return Flux.empty();
        }

        try {
            String summaryRequestBody = createSummaryRequestBody(lastRequestBody, this.model);
            logger.debug("Constructed summary request body: {}", summaryRequestBody);
            return performOpenAIStreamRequest(summaryRequestBody, "/chat/completions");
        } catch (JsonProcessingException e) {
            logger.error("Error creating summary request body due to JSON processing failure.", e);
            return Flux.error(e);
        }
    }

    @Override
    public void clearCharacterStateCache() {
        logger.info("Executing request to clear character event and mood cache.");
        int sizeBefore = characterStateStore.size();
        if (sizeBefore > 0) {
            characterStateStore.clear();
            logger.info("Character state cache has been cleared. Removed {} entries.", sizeBefore);
        } else {
            logger.info("Character state cache was already empty. No action taken.");
        }
    }

    private Mono<EventMood> getOrCreateEventMood(String key, Map<String, Object> bodyMap) {
        EventMood existingState = characterStateStore.get(key);
        if (existingState != null) {
            logger.info("Found existing event/mood for key '{}'. Reusing it.", key);
            return Mono.just(existingState);
        }

        logger.info("No event/mood found for key '{}'. Generating new one.", key);
        return generateEventAndMood(bodyMap)
                .doOnSuccess(newState -> {
                    if (newState != null) {
                        characterStateStore.put(key, newState);
                        logger.info("Stored new event/mood for key '{}'.", key);
                    }
                });
    }

    @SuppressWarnings("unchecked")
    private Mono<EventMood> generateEventAndMood(Map<String, Object> originalBodyMap) {
        try {
            List<Map<String, Object>> messages = (List<Map<String, Object>>) originalBodyMap.get("messages");
            if (messages == null || messages.isEmpty() || !"system".equals(messages.get(0).get("role"))) {
                logger.warn("Cannot generate event/mood: 'messages' array is missing, empty, or first message is not a system prompt.");
                return Mono.empty();
            }
            String characterSettings = (String) messages.get(0).get("content");

            Map<String, Object> requestPayload = new HashMap<>();
            List<Map<String, String>> newMessages = new ArrayList<>();
            Map<String, String> systemMessage = new HashMap<>();
            systemMessage.put("role", "system");
            systemMessage.put("content", String.format(eventMoodPrompt, characterSettings));

            newMessages.add(systemMessage);

            requestPayload.put("model", this.model);
            requestPayload.put("messages", newMessages);
            requestPayload.put("response_format", Map.of("type", "json_object"));

            String requestBody = objectMapper.writeValueAsString(requestPayload);

            return performOpenAINonStreamRequest(requestBody, "/chat/completions")
                    .flatMap(responseBody -> {
                        try {
                            Map<String, Object> responseMap = objectMapper.readValue(responseBody, Map.class);
                            List<Map<String, Object>> choices = (List<Map<String, Object>>) responseMap.get("choices");
                            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
                            String content = (String) message.get("content");

                            EventMood eventMood = objectMapper.readValue(content, EventMood.class);
                            return Mono.just(eventMood);
                        } catch (Exception e) {
                            logger.error("Failed to parse event/mood response from OpenAI: {}", responseBody, e);
                            return Mono.empty();
                        }
                    });

        } catch (JsonProcessingException e) {
            logger.error("Failed to create request body for event/mood generation.", e);
            return Mono.empty();
        }
    }

    @SuppressWarnings("unchecked")
    private String updateSystemPrompt(Map<String, Object> bodyMap, EventMood eventMood) throws JsonProcessingException {
        List<Map<String, Object>> messages = (List<Map<String, Object>>) bodyMap.get("messages");
        if (messages == null || messages.isEmpty()) {
            return objectMapper.writeValueAsString(bodyMap);
        }

        Map<String, Object> systemMessage = messages.get(0);
        String originalContent = (String) systemMessage.get("content");

        String newContent = String.format("今天发生了一件小事：%s。这让我的心情有点%s。\n\n%s",
                eventMood.event(), eventMood.mood(), originalContent);

        systemMessage.put("content", newContent);
        return objectMapper.writeValueAsString(bodyMap);
    }

    private String getLastRequest(String user, String characterId) {
        String key = user + ":" + characterId;
        return lastRequestStore.get(key);
    }

    private String createSummaryRequestBody(String historyContent, String model) throws JsonProcessingException {
        Map<String, Object> newBodyMap = new HashMap<>();
        List<Map<String, Object>> newMessages = new ArrayList<>();

        Map<String, Object> promptMessage = new HashMap<>();
        promptMessage.put("role", "system");
        promptMessage.put("content", this.summaryPrompt);
        newMessages.add(promptMessage);

        Map<String, Object> historyMessage = new HashMap<>();
        historyMessage.put("role", "user");
        historyMessage.put("content", historyContent);
        newMessages.add(historyMessage);

        newBodyMap.put("messages", newMessages);
        newBodyMap.put("model", model);
        newBodyMap.put("stream", true);

        return objectMapper.writeValueAsString(newBodyMap);
    }

    private Flux<String> performOpenAIStreamRequest(String requestBody, String uri) {
        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(requestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse ->
                        clientResponse.bodyToMono(String.class)
                                .flatMap(errorBody -> {
                                    logger.error("OpenAI API call failed: Status=[{}], URI=[{}], Body=[{}]",
                                            clientResponse.statusCode(), uri, errorBody);
                                    return Mono.error(new RuntimeException("OpenAI API Error: " + errorBody));
                                })
                )
                .bodyToFlux(String.class)
                .doOnSubscribe(s -> logger.info("Subscribed to OpenAI stream at URI: {}", uri))
                .doOnError(e -> logger.error("Error during OpenAI stream processing for URI: {}", uri, e))
                .doOnComplete(() -> logger.info("OpenAI stream completed for URI: {}", uri));
    }

    private Mono<String> performOpenAINonStreamRequest(String requestBody, String uri) {
        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(requestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse ->
                        clientResponse.bodyToMono(String.class)
                                .flatMap(errorBody -> {
                                    logger.error("OpenAI Non-Stream API call failed: Status=[{}], URI=[{}], Body=[{}]",
                                            clientResponse.statusCode(), uri, errorBody);
                                    return Mono.error(new RuntimeException("OpenAI API Error: " + errorBody));
                                })
                )
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(30))
                .doOnSubscribe(s -> logger.info("Sending Non-Stream request to OpenAI at URI: {}", uri))
                .doOnError(e -> logger.error("Error during OpenAI Non-Stream request for URI: {}", uri, e))
                .doOnSuccess(response -> logger.info("OpenAI Non-Stream request completed for URI: {}", uri));
    }
}