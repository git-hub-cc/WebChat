/**
 * `OpenAIService`接口的实现类。
 *
 * 主要职责:
 * - 通过`WebClient`与外部AI API进行实际的HTTP通信。
 * - 在内存中使用`ConcurrentHashMap`管理对话历史和角色每日状态（事件/心情）的缓存。
 * - 实现聊天、摘要生成、上下文准备和缓存清理等核心业务逻辑。
 *
 * 关联:
 * - `OpenAIService`: 实现此接口。
 * - `OpenAIConfig`: 从中注入`WebClient`和各种配置字符串。
 * - `CacheManagerTask`: 调用本服务中的`clearCharacterStateCache`方法。
 */
package club.ppmc.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Service
public class OpenAIServiceImpl implements OpenAIService {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIServiceImpl.class);
    private static final TypeReference<Map<String, Object>> MAP_TYPE_REFERENCE = new TypeReference<>() {};
    private static final String API_URI = "/chat/completions";

    // 使用内部记录类来增强类型安全性和代码可读性
    private record EventMood(String event, String mood) {}
    private record ChatPayload(String user, String character_id, List<Map<String, Object>> messages) {}

    // 缓存: 存储 "user:character_id" -> requestBody 的最近一次请求
    private final Map<String, String> lastRequestStore = new ConcurrentHashMap<>();
    // 缓存: 存储 "character_id" -> EventMood 的今日状态
    private final Map<String, EventMood> characterStateStore = new ConcurrentHashMap<>();

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final String summaryPrompt;
    private final String eventMoodPrompt;
    private final String model;

    public OpenAIServiceImpl(
            @Qualifier("openaiWebClient") WebClient webClient,
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
            var payload = objectMapper.readValue(originalRequestBody, ChatPayload.class);
            if (payload.character_id() == null) {
                logger.warn("请求体中缺少 'character_id'，跳过事件/心情生成。");
                return Mono.just(originalRequestBody);
            }

            return getOrCreateEventMood(payload)
                    .flatMap(eventMood -> {
                        try {
                            var bodyMap = objectMapper.readValue(originalRequestBody, MAP_TYPE_REFERENCE);
                            var modifiedBody = updateSystemPrompt(bodyMap, eventMood);
                            logger.info("成功为角色 '{}' 更新系统提示。", payload.character_id());
                            return Mono.just(modifiedBody);
                        } catch (JsonProcessingException e) {
                            logger.error("更新系统提示后重新序列化请求体失败。", e);
                            return Mono.just(originalRequestBody);
                        }
                    })
                    .defaultIfEmpty(originalRequestBody)
                    .onErrorReturn(originalRequestBody);
        } catch (JsonProcessingException e) {
            logger.warn("解析请求体以准备上下文时失败，将返回原始请求体。", e);
            return Mono.just(originalRequestBody);
        }
    }

    @Override
    public boolean hasHistory(String user, String characterId) {
        if (user == null || characterId == null) return false;
        var key = createKey(user, characterId);
        boolean hasHistory = lastRequestStore.containsKey(key);
        logger.debug("检查历史记录 for key '{}': {}", key, hasHistory);
        return hasHistory;
    }

    @Override
    public Flux<String> streamBaseChatCompletion(String requestBody) {
        logger.info("处理基础聊天完成请求。");
        storeLastRequest(requestBody);
        return performOpenAIStreamRequest(requestBody, API_URI);
    }

    @Override
    public Flux<String> getSummaryStream(String user, String characterId) {
        logger.info("为用户 '{}' 和角色 '{}' 请求摘要。", user, characterId);
        var key = createKey(user, characterId);
        var lastRequestBody = lastRequestStore.get(key);

        if (lastRequestBody == null || lastRequestBody.isEmpty()) {
            logger.warn("未找到key '{}'的对话历史，无法生成摘要。", key);
            return Flux.empty();
        }

        try {
            var summaryRequestBody = createSummaryRequestBody(lastRequestBody);
            logger.debug("已构建摘要请求体。");
            return performOpenAIStreamRequest(summaryRequestBody, API_URI);
        } catch (JsonProcessingException e) {
            logger.error("创建摘要请求体时发生JSON处理错误。", e);
            return Flux.error(e);
        }
    }

    @Override
    public void clearCharacterStateCache() {
        if (!characterStateStore.isEmpty()) {
            int sizeBefore = characterStateStore.size();
            characterStateStore.clear();
            logger.info("角色状态缓存已清空，移除了 {} 个条目。", sizeBefore);
        } else {
            logger.info("角色状态缓存已为空，无需操作。");
        }
    }

    private Mono<EventMood> getOrCreateEventMood(ChatPayload payload) {
        var existingState = characterStateStore.get(payload.character_id());
        if (existingState != null) {
            logger.info("为角色 '{}' 找到已缓存的事件/心情，直接使用。", payload.character_id());
            return Mono.just(existingState);
        }

        logger.info("角色 '{}' 的当日事件/心情不存在，开始生成...", payload.character_id());
        return generateEventAndMood(payload)
                .doOnSuccess(newState -> {
                    if (newState != null) {
                        characterStateStore.put(payload.character_id(), newState);
                        logger.info("已为角色 '{}' 生成并缓存新的事件/心情。", payload.character_id());
                    }
                });
    }

    private Mono<EventMood> generateEventAndMood(ChatPayload payload) {
        try {
            if (payload.messages() == null || payload.messages().isEmpty() || !"system".equals(payload.messages().get(0).get("role"))) {
                logger.warn("无法生成事件/心情：'messages'数组缺失、为空或首条消息非system角色。");
                return Mono.empty();
            }
            var characterSettings = (String) payload.messages().get(0).get("content");
            var promptContent = String.format(eventMoodPrompt, characterSettings);

            var systemMessage = Map.of("role", "system", "content", promptContent);
            var requestPayload = Map.of(
                    "model", this.model,
                    "messages", List.of(systemMessage),
                    "response_format", Map.of("type", "json_object")
            );

            var requestBody = objectMapper.writeValueAsString(requestPayload);

            return performOpenAINonStreamRequest(requestBody, API_URI)
                    .flatMap(this::parseEventMoodFromResponse);
        } catch (JsonProcessingException e) {
            logger.error("创建事件/心情生成请求体时失败。", e);
            return Mono.empty();
        }
    }

    private Mono<EventMood> parseEventMoodFromResponse(String responseBody) {
        try {
            var responseMap = objectMapper.readValue(responseBody, MAP_TYPE_REFERENCE);
            var choices = (List<Map<String, Object>>) responseMap.get("choices");
            var message = (Map<String, Object>) choices.get(0).get("message");
            var content = (String) message.get("content");
            return Mono.just(objectMapper.readValue(content, EventMood.class));
        } catch (Exception e) {
            logger.error("从OpenAI响应中解析事件/心情失败: {}", responseBody, e);
            return Mono.empty();
        }
    }

    @SuppressWarnings("unchecked")
    private String updateSystemPrompt(Map<String, Object> bodyMap, EventMood eventMood) throws JsonProcessingException {
        var messages = (List<Map<String, Object>>) bodyMap.get("messages");
        if (messages == null || messages.isEmpty()) return objectMapper.writeValueAsString(bodyMap);

        var systemMessage = messages.get(0);
        var originalContent = (String) systemMessage.get("content");

        // 使用Text Block来格式化新的系统提示，可读性更强
        var newContent = """
                今天发生了一件小事：%s。这让我的心情有点%s。
                
                %s
                """.formatted(eventMood.event(), eventMood.mood(), originalContent);

        systemMessage.put("content", newContent);
        return objectMapper.writeValueAsString(bodyMap);
    }

    private void storeLastRequest(String requestBody) {
        try {
            var payload = objectMapper.readValue(requestBody, ChatPayload.class);
            if (payload.user() != null && payload.character_id() != null) {
                var key = createKey(payload.user(), payload.character_id());
                lastRequestStore.put(key, requestBody);
                logger.info("已为key '{}'存储对话历史。", key);
            }
        } catch (JsonProcessingException e) {
            logger.warn("因JSON解析失败，未能存储对话历史: {}", e.getMessage());
        }
    }

    private String createSummaryRequestBody(String historyContent) throws JsonProcessingException {
        var promptMessage = Map.of("role", "system", "content", this.summaryPrompt);
        var historyMessage = Map.of("role", "user", "content", historyContent);

        var newBodyMap = Map.of(
                "messages", List.of(promptMessage, historyMessage),
                "model", this.model,
                "stream", true);

        return objectMapper.writeValueAsString(newBodyMap);
    }

    private Flux<String> performOpenAIStreamRequest(String requestBody, String uri) {
        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(requestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse ->
                        clientResponse.bodyToMono(String.class).flatMap(errorBody -> {
                            logger.error("OpenAI流式API调用失败: Status={}, URI={}, Body={}",
                                    clientResponse.statusCode(), uri, errorBody);
                            return Mono.error(new RuntimeException("OpenAI API Error: " + errorBody));
                        })
                )
                .bodyToFlux(String.class)
                .doOnSubscribe(s -> logger.info("已订阅OpenAI流: {}", uri))
                .doOnError(e -> logger.error("处理OpenAI流时出错: {}", uri, e))
                .doOnComplete(() -> logger.info("OpenAI流处理完成: {}", uri));
    }

    private Mono<String> performOpenAINonStreamRequest(String requestBody, String uri) {
        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(requestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse ->
                        clientResponse.bodyToMono(String.class).flatMap(errorBody -> {
                            logger.error("OpenAI非流式API调用失败: Status={}, URI={}, Body={}",
                                    clientResponse.statusCode(), uri, errorBody);
                            return Mono.error(new RuntimeException("OpenAI API Error: " + errorBody));
                        })
                )
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(30)) // 设置超时以防请求挂起
                .doOnSubscribe(s -> logger.info("发送非流式请求到OpenAI: {}", uri))
                .doOnError(e -> logger.error("OpenAI非流式请求出错: {}", uri, e))
                .doOnSuccess(response -> logger.info("OpenAI非流式请求成功: {}", uri));
    }

    private String createKey(String user, String characterId) {
        return user + ":" + characterId;
    }
}