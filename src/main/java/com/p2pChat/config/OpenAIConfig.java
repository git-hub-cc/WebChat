package com.p2pChat.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier; // 确保引入
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * 应用程序的配置类。
 * 负责创建和配置与外部服务（如OpenAI）交互所需的Beans。
 */
@Configuration
public class OpenAIConfig {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIConfig.class);

    /**
     * 创建并配置一个用于与OpenAI API交互的WebClient Bean。
     * 这个Bean是单例的，并被注入到需要调用OpenAI服务的组件中。
     * 使用 @Qualifier("openaiWebClient") 来唯一标识这个Bean，以防应用中有其他WebClient实例。
     *
     * @param webClientBuilder Spring Boot自动配置的WebClient.Builder
     * @param openaiApiBaseUrl OpenAI API的基础URL，从配置文件读取
     * @param apiKey           OpenAI API的密钥，从配置文件读取
     * @return 配置好的WebClient实例
     */
    @Bean("openaiWebClient")
    public WebClient openaiWebClient(WebClient.Builder webClientBuilder,
                                     @Value("${openai.api.base_url}") String openaiApiBaseUrl,
                                     @Value("${openai.api.api_key}") String apiKey) {

        logger.info("正在创建 OpenAI WebClient Bean...");
        logger.info("OpenAI 基础 URL: {}", openaiApiBaseUrl);
        if (apiKey != null && !apiKey.isEmpty()) {
            logger.info("OpenAI API 密钥已配置 (长度: {})", apiKey.length());
        } else {
            logger.warn("OpenAI API 密钥未配置或为空!");
        }

        return webClientBuilder.baseUrl(openaiApiBaseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey) // 设置认证头
                .filter((request, next) -> { // 添加日志过滤器
                    logger.debug("WebClient 请求: {} {} Headers: {}", request.method(), request.url(), request.headers());
                    return next.exchange(request)
                            .doOnNext(response -> logger.debug("WebClient 响应: {} {} Status: {}", request.method(), request.url(), response.statusCode()))
                            .doOnError(error -> logger.error("WebClient 请求 {} 失败", request.url(), error));
                })
                .build();
    }

    /**
     * 将摘要提示词作为一个Bean提供。
     * 这样做可以将所有外部化配置都集中在配置类中管理。
     * 使用 @Qualifier("summaryPrompt") 来唯一标识这个Bean。
     *
     * @param prompt 从 application.properties 读取的提示词字符串
     * @return 摘要提示词
     */
    @Bean("summaryPrompt")
    public String summaryPrompt(@Value("${app.summary_prompt}") String prompt) {
        logger.info("摘要提示词已加载。");
        return prompt;
    }

    /**
     * [新增] 将生成事件和心情的提示词作为一个Bean提供。
     * @param prompt 从 application.properties 读取的提示词字符串
     * @return 事件/心情提示词
     */
    @Bean("eventMoodPrompt")
    public String eventMoodPrompt(@Value("${app.event_mood_prompt}") String prompt) {
        logger.info("事件/心情生成提示词已加载。");
        return prompt;
    }


    @Bean("model")
    public String model(@Value("${openai.api.model}") String model) {
        logger.info("模型已加载: {}", model);
        return model;
    }
}