/**
 * 此文件定义了应用程序自定义配置的类型安全属性类。
 *
 * 主要职责:
 * - 使用 `@ConfigurationProperties` 将 `application.yml` 中以 "allowed" 为前缀的
 *   配置项，自动、类型安全地绑定到此记录的字段上。
 * - 替代在多个配置类中使用 `@Value` 注解来分散地注入属性，从而实现配置的集中管理。
 *
 * 关联:
 * - `WebConfig`, `WebSocketConfig`: 注入并使用此配置属性类，而不是直接注入原始值。
 * - `application.yml`: 是此配置类的数据源。
 */
package club.ppmc.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 将 application.yml 中的 'allowed' 配置项映射到此不可变记录。
 *
 * @param origins 允许进行CORS和WebSocket连接的源URL列表。
 */
@ConfigurationProperties(prefix = "allowed")
public record AppProperties(List<String> origins) {}