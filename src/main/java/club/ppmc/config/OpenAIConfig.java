/**
 * 此文件定义了与OpenAI服务交互所需的Spring配置。
 *
 * 主要职责:
 * - 创建一个配置好的、单例的`WebClient` Bean (`openaiWebClient`)，用于所有对OpenAI API的调用。
 * - 将配置文件中的提示词 (Prompt) 和模型名称作为`String`类型的Bean提供，便于集中管理和注入。
 *
 * 关联:
 * - `OpenAIServiceImpl`: 注入并使用此类中定义的`WebClient`和`String` Beans。
 * - `application.yml`: 从此文件读取API URL、密钥、模型和提示词等配置。
 */
package club.ppmc.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class OpenAIConfig {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIConfig.class);
    private static final String BEARER_PREFIX = "Bearer ";

    /**
     * 创建并配置用于与OpenAI API交互的`WebClient` Bean。
     * 此Bean为单例，并被注入到需要调用OpenAI服务的组件中。
     * 使用 @Qualifier("openaiWebClient") 来唯一标识此Bean。
     *
     * @param webClientBuilder Spring Boot自动配置的`WebClient.Builder`。
     * @param openaiApiBaseUrl OpenAI API的基础URL，从配置文件读取。
     * @param apiKey           OpenAI API的密钥，从配置文件读取。
     * @return 配置好的`WebClient`实例。
     */
    @Bean("openaiWebClient")
    public WebClient openaiWebClient(
            WebClient.Builder webClientBuilder,
            @Value("${openai.api.base_url}") String openaiApiBaseUrl,
            @Value("${openai.api.api_key}") String apiKey) {

        logger.info("正在配置OpenAI WebClient Bean...");
        logger.info("OpenAI 基础 URL: {}", openaiApiBaseUrl);

        if (StringUtils.hasText(apiKey)) {
            logger.info("OpenAI API密钥已配置。");
        } else {
            logger.warn("OpenAI API密钥未配置或为空，API调用可能会失败！");
        }

        return webClientBuilder
                .baseUrl(openaiApiBaseUrl)
                .defaultHeader(HttpHeaders.AUTHORIZATION, BEARER_PREFIX + apiKey)
                .filter((request, next) -> { // 添加日志过滤器以监控出站请求
                    logger.debug("WebClient请求: {} {}", request.method(), request.url());
                    return next.exchange(request)
                            .doOnNext(response -> logger.debug(
                                    "WebClient响应: {} {} Status: {}",
                                    request.method(),
                                    request.url(),
                                    response.statusCode()))
                            .doOnError(error -> logger.error(
                                    "WebClient请求 {} {} 失败",
                                    request.method(),
                                    request.url(),
                                    error));
                })
                .build();
    }

    /**
     * 将摘要提示词作为一个Bean提供。
     * 这使得提示词内容可以与业务逻辑解耦，并集中在配置类中进行管理。
     *
     * @param prompt 从`application.yml`读取的`app.summary_prompt`值。
     * @return 摘要提示词字符串。
     */
    @Bean("summaryPrompt")
    public String summaryPrompt(@Value("${app.summary_prompt}") String prompt) {
        logger.info("摘要提示词已加载。");
        return prompt;
    }

    /**
     * 将生成事件和心情的提示词作为一个Bean提供。
     *
     * @param prompt 从`application.yml`读取的`app.event_mood_prompt`值。
     * @return 事件/心情提示词字符串。
     */
    @Bean("eventMoodPrompt")
    public String eventMoodPrompt(@Value("${app.event_mood_prompt}") String prompt) {
        logger.info("事件/心情生成提示词已加载。");
        return prompt;
    }

    /**
     * 将要使用的AI模型名称作为一个Bean提供。
     *
     * @param model 从`application.yml`读取的`openai.api.model`值。
     * @return 模型名称字符串。
     */
    @Bean("model")
    public String model(@Value("${openai.api.model}") String model) {
        logger.info("AI模型已加载: {}", model);
        return model;
    }
}