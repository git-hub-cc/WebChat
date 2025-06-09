package com.p2pChat.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.p2pChat.service.OpenAIService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Controller to proxy requests to the OpenAI API.
 * Uses WebClient for non-blocking, reactive HTTP calls.
 */
@RestController
@RequestMapping("/v1") // Matches OpenAI's API path prefix
public class OpenAIController {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIController.class);

    private final WebClient webClient;
    private final OpenAIService openAIService;
    private final ObjectMapper objectMapper;
    private final String summary_prompt;

    @Autowired
    public OpenAIController(WebClient.Builder webClientBuilder,
                            @Value("${openai.api.base_url}") String openaiApiBaseUrl,
                            @Value("${openai.api.api_key}") String apiKey,
                            @Value("${app.summary_prompt}") String summary_prompt,
                            OpenAIService openAIService,
                            ObjectMapper objectMapper) {
        // Configure WebClient for OpenAI API interaction
        this.summary_prompt = summary_prompt;
        this.webClient = webClientBuilder.baseUrl(openaiApiBaseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey) // Standard way to send API key
                .filter((request, next) -> { // Log WebClient requests and responses
                    logger.debug("WebClient 请求: {} {} Headers: {}", request.method(), request.url(), request.headers());
                    return next.exchange(request)
                            .doOnNext(response -> logger.debug("WebClient 响应: {} {} Status: {}", request.method(), request.url(), response.statusCode()))
                            .doOnError(error -> logger.error("WebClient 请求 {} 失败", request.url(), error));
                })
                .build();

        this.openAIService = openAIService;
        this.objectMapper = objectMapper;

        logger.info("OpenAIController 初始化。基础 URL: {}", openaiApiBaseUrl);
        if (apiKey != null && !apiKey.isEmpty()) {
            logger.info("OpenAI API 密钥已配置 (长度: {})", apiKey.length());
        } else {
            logger.warn("OpenAI API 密钥未配置!");
        }
    }

    /**
     * Streams chat completions from the OpenAI API.
     * If the incoming request has exactly 2 messages, it attempts to substitute the content
     * with a summary request of the last conversation history for that user/character.
     * Otherwise, it stores the request body in OpenAIService for potential later use.
     *
     * @param body The request body, expected to conform to OpenAI's chat completions API.
     * @return A Flux of String representing the streamed response.
     */
    @PostMapping(value = "/chat/completions", produces = MediaType.TEXT_EVENT_STREAM_VALUE) // OpenAI stream uses text/event-stream
    public Flux<String> generateStream(@RequestBody String body) {
        logger.info("收到 POST /v1/chat/completions (流式) 请求");
        // Be cautious with logging full request bodies in production if they contain sensitive data.
        logger.debug("原始请求体: {}", body);

        String finalBody = body; // By default, use the original request body.
        boolean bodyWasModified = false;

        try {
            // Parse the JSON string to a Map to extract data.
            @SuppressWarnings("unchecked")
            Map<String, Object> bodyMap = objectMapper.readValue(body, Map.class);
            String user = (String) bodyMap.get("user");
            String characterId = (String) bodyMap.get("character_id");

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) bodyMap.get("messages");

            // --- Start of new logic: Modify request if messages count is 2 and history exists ---
            // 当用户请求体中的messages为2时
            if (messages != null && messages.size() == 2) {
                logger.info("检测到消息数量为2，为用户 '{}' 和角色 '{}' 尝试获取历史记录。", user, characterId);
                // 根据user，characterId获取lastRequestBodyByUserAndChar中的值
                String lastRequestBody = openAIService.getLastRequest(user, characterId);

                // 2. 值不为空，修改请求体内容
                if (lastRequestBody != null && !lastRequestBody.isEmpty()) {
                    logger.info("找到历史记录，正在修改请求体以进行数据提炼。");

                    // Create the new messages list
                    List<Map<String, Object>> newMessages = new ArrayList<>();

                    // 第一个值是提炼数据的提示词
                    Map<String, Object> promptMessage = new HashMap<>();
                    promptMessage.put("role", "system");
                    promptMessage.put("content", this.summary_prompt);
                    newMessages.add(promptMessage);

                    // 第二个值是从lastRequestBodyByUserAndChar中获取出来的值
                    Map<String, Object> historyMessage = new HashMap<>();
                    historyMessage.put("role", "user");
                    historyMessage.put("content", lastRequestBody);
                    newMessages.add(historyMessage);

                    // Replace the messages in the original map, add a status field, and re-serialize
                    bodyMap.put("messages", newMessages);
                    // Add a status field to indicate a summary operation. This will be sent to OpenAI.
                    // While the standard API ignores this, a custom proxy or model might use it.
                    // The primary notification mechanism to the front-end will be a custom SSE event.
                    bodyMap.put("status", "summary");
                    finalBody = objectMapper.writeValueAsString(bodyMap);
                    bodyWasModified = true;
                    logger.debug("修改后的请求体 /chat/completions: {}", finalBody);

                } else {
                    // 1. 值为空逻辑不变，用户的请求体不变
                    logger.info("未找到用户 '{}' 和角色 '{}' 的历史记录，将按原始请求处理。", user, characterId);
                }
            }
            // --- End of new logic ---

            // If the body was NOT modified, it represents a standard conversation turn.
            // Store it for potential future summarization.
            if (!bodyWasModified) {
                openAIService.storeLastRequest(user, characterId, body);
            }

        } catch (JsonProcessingException e) {
            logger.warn("处理请求体时发生JSON处理错误，将使用原始请求体。错误: {}", e.getMessage());
        } catch (Exception e) {
            // Catch other potential exceptions (e.g., ClassCastException)
            logger.warn("处理请求历史时发生意外错误，将使用原始请求体。", e);
        }

        // Use a final variable for the lambda expression
        final String effectiveRequestBody = finalBody;
        final boolean isSummaryRequest = bodyWasModified;

        Flux<String> openAiResponseStream = webClient.post()
                .uri("/chat/completions")
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(effectiveRequestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse -> { // Custom error handling for OpenAI API errors
                    logger.error("OpenAI /chat/completions (流式) 错误: HTTP 状态 {}", clientResponse.statusCode());
                    return clientResponse.bodyToMono(String.class)
                            .flatMap(errorBody -> {
                                logger.error("OpenAI /chat/completions (流式) 错误体: {}", errorBody);
                                return Mono.error(new OpenAIClientException("OpenAI API 错误: " + clientResponse.statusCode() + " - " + errorBody, clientResponse.statusCode()));
                            });
                })
                .bodyToFlux(String.class) // Stream the response body as a Flux of Strings
                .doOnSubscribe(subscription -> logger.info("已订阅 OpenAI /chat/completions 流"))
                .doOnNext(data -> logger.trace("OpenAI /chat/completions 流数据接收 (前50字符): {}", data.substring(0, Math.min(data.length(), 50))))
                .doOnError(error -> logger.error("处理 OpenAI /chat/completions 流时出错", error))
                .doOnComplete(() -> logger.info("OpenAI /chat/completions 流已完成"));

        if (isSummaryRequest) {
            logger.info("请求是摘要请求，正在向客户端流中添加 'summary' 状态信号。");
            // This is our custom event to signal the frontend to handle this stream differently.
            // It must be in the Server-Sent Events (SSE) format: "data: json\n\n"
            String summaryStatusEvent = "data: {\"status\":\"summary\"}\n\n";
            // Prepend our custom event to the actual stream from OpenAI.
            return Flux.just(summaryStatusEvent).concatWith(openAiResponseStream);
        } else {
            return openAiResponseStream;
        }
    }

    /**
     * Custom exception for errors originating from the OpenAI client interaction.
     */
    static class OpenAIClientException extends RuntimeException {
        private final HttpStatusCode statusCode;

        public OpenAIClientException(String message, HttpStatusCode statusCode) {
            super(message);
            this.statusCode = statusCode;
        }

        public HttpStatusCode getStatusCode() {
            return statusCode;
        }
    }
}