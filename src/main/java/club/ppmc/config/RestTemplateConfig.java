/**
 * 此文件定义了同步HTTP客户端`RestTemplate`的Spring配置。
 *
 * 主要职责:
 * - 创建一个`RestTemplate` Bean，用于应用程序中需要进行同步HTTP调用的部分。
 *
 * 注意:
 * - 在现代响应式Spring应用中，推荐优先使用`WebClient`。
 *   此Bean的存在可能是为了兼容旧代码或特定的同步场景。
 */
package club.ppmc.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

@Configuration
public class RestTemplateConfig {

    /**
     * 创建一个默认的`RestTemplate`实例作为Spring Bean。
     *
     * @return 一个新的`RestTemplate`对象。
     */
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}