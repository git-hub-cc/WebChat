/**
 * 此文件定义了与OpenAI服务API相关的配置属性。
 *
 * 主要职责:
 * - 使用 `@ConfigurationProperties` 将 `application.yml` 中以 "openai.api" 为前缀的
 *   配置项 (如baseUrl, keys, model) 自动、类型安全地绑定到此记录的字段上。
 * - 实现了对OpenAI API密钥列表的配置，支持密钥池功能。
 *
 * 关联:
 * - `OpenAIConfig`: 注入并使用此配置属性类，以获取API基础URL、密钥列表和模型名称。
 * - `OpenAIServiceImpl`: 间接通过`OpenAIConfig`获取密钥列表以初始化密钥池。
 * - `application.yml`: 是此配置类的数据源。例如:
 *   ```yaml
 *   openai:
 *     api:
 *       base_url: "https://api.openai.com/v1"
 *       keys:
 *         - "sk-yourFirstApiKey"
 *         - "sk-yourSecondApiKey"
 *       model: "gpt-3.5-turbo"
 *   ```
 */
package club.ppmc.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

/**
 * 将 application.yml 中的 'openai.api' 配置项映射到此不可变记录。
 *
 * @param baseUrl OpenAI API的基础URL。
 * @param api_keys    OpenAI API的密钥列表，用于构建密钥池。
 * @param model   要使用的AI模型名称。
 */
@ConfigurationProperties(prefix = "openai.api")
@Validated // 启用对该配置属性的校验
public record OpenaiApiProperties(
        @NotNull String baseUrl,
        @NotEmpty List<String> api_keys,
        @NotNull String model) {}