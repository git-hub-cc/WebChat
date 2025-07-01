/**
 * 此文件定义了与OpenAI服务交互所需的Spring配置。
 *
 * 主要职责:
 * - 创建一个配置好的、单例的`WebClient` Bean (`openaiWebClient`)，用于所有对OpenAI API的调用。
 *   此`WebClient`不包含默认的Authorization头，授权将由`OpenAIServiceImpl`在每次请求时动态添加。
 * - 将配置文件中的模型名称作为`String`类型的Bean提供。
 * - 依赖 `OpenaiApiProperties` 来获取API基础URL、密钥列表和模型名称。
 *
 * 关联:
 * - `OpenAIServiceImpl`: 注入并使用此类中定义的`WebClient`和`model` Bean。它也直接注入`OpenaiApiProperties`来管理API密钥池。
 * - `OpenaiApiProperties`: 为此类提供类型安全的配置数据。
 * - `application.yml`: 从此文件读取API URL、密钥列表和模型等配置，通过`OpenaiApiProperties`进行映射。
 */
package club.ppmc.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
@EnableConfigurationProperties(OpenaiApiProperties.class) // 启用OpenaiApiProperties
public class OpenAIConfig {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIConfig.class);

    /**
     * 创建并配置用于与OpenAI API交互的`WebClient` Bean。
     * 此Bean为单例，并被注入到需要调用OpenAI服务的组件中。
     * 使用 @Qualifier("openaiWebClient") 来唯一标识此Bean。
     * 授权头将由服务层在每次请求时动态添加。
     *
     * @param webClientBuilder Spring Boot自动配置的`WebClient.Builder`。
     * @param properties       包含OpenAI API配置的属性对象。
     * @return 配置好的`WebClient`实例。
     */
    @Bean("openaiWebClient")
    public WebClient openaiWebClient(
            WebClient.Builder webClientBuilder,
            OpenaiApiProperties properties) {

        logger.info("正在配置OpenAI WebClient Bean...");
        logger.info("OpenAI 基础 URL: {}", properties.baseUrl());

        if (properties.api_keys() == null || properties.api_keys().isEmpty()) {
            logger.warn("OpenAI API密钥列表未配置或为空，API调用将会失败！");
        } else {
            logger.info("OpenAI API密钥池已配置，共 {} 个密钥。", properties.api_keys().size());
        }

        return webClientBuilder
                .baseUrl(properties.baseUrl())
                // 注意：Authorization头不再在此处设置默认值，将由OpenAIServiceImpl在每次请求时提供
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
     * 将生成事件和心情的提示词作为一个Bean提供。
     *
     * @param prompt 从`application.yml`读取的`app.event_mood_prompt`值。
     * @return 事件/心情提示词字符串。
     */
    @Bean("eventMoodPrompt")
    public String eventMoodPrompt(@org.springframework.beans.factory.annotation.Value("${app.event_mood_prompt}") String prompt) {
        logger.info("事件/心情生成提示词已加载。");
        return prompt;
    }

    /**
     * 将要使用的AI模型名称作为一个Bean提供。
     * 模型名称从 `OpenaiApiProperties` 中获取。
     *
     * @param properties 包含OpenAI API配置的属性对象。
     * @return 模型名称字符串。
     */
    @Bean("model")
    public String model(OpenaiApiProperties properties) {
        String modelName = properties.model();
        logger.info("AI模型已加载: {}", modelName);
        return modelName;
    }
}