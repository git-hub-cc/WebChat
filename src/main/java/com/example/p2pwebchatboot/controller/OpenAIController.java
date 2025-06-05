package com.example.p2pwebchatboot.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

/**
 * Controller to proxy requests to the OpenAI API.
 * Uses WebClient for non-blocking, reactive HTTP calls.
 */
@RestController
@RequestMapping("/v1") // Matches OpenAI's API path prefix
public class OpenAIController {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIController.class);

    private final WebClient webClient;

    public OpenAIController(WebClient.Builder webClientBuilder,
                            @Value("${openai.api.base_url}") String openaiApiBaseUrl,
                            @Value("${openai.api.api_key}") String apiKey) { // Corrected property name
        // Configure WebClient for OpenAI API interaction
        this.webClient = webClientBuilder.baseUrl(openaiApiBaseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey) // Standard way to send API key
                .filter((request, next) -> { // Log WebClient requests and responses
                    logger.debug("WebClient 请求: {} {} Headers: {}", request.method(), request.url(), request.headers());
                    return next.exchange(request)
                            .doOnNext(response -> logger.debug("WebClient 响应: {} {} Status: {}", request.method(), request.url(), response.statusCode()))
                            .doOnError(error -> logger.error("WebClient 请求 {} 失败", request.url(), error));
                })
                .build();

        logger.info("OpenAIController 初始化。基础 URL: {}", openaiApiBaseUrl);
        if (apiKey != null && !apiKey.isEmpty()) {
            logger.info("OpenAI API 密钥已配置 (长度: {})", apiKey.length());
        } else {
            logger.warn("OpenAI API 密钥未配置!");
        }
    }

    /**
     * Streams chat completions from the OpenAI API.
     * @param body The request body, expected to conform to OpenAI's chat completions API.
     * @return A Flux of String representing the streamed response.
     */
    @PostMapping(value = "/chat/completions", produces = MediaType.TEXT_EVENT_STREAM_VALUE) // OpenAI stream uses text/event-stream
    public Flux<String> generateStream(@RequestBody String body) {
        logger.info("收到 POST /v1/chat/completions (流式) 请求");
        // Be cautious with logging full request bodies in production if they contain sensitive data.
        logger.debug("请求体 /chat/completions: {}", body);

        return webClient.post()
                .uri("/chat/completions")
                .contentType(MediaType.APPLICATION_JSON)
                .body(BodyInserters.fromValue(body))
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