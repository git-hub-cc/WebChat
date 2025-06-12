/**
 * 此文件定义了Spring Web MVC的核心配置。
 *
 * 主要职责:
 * - 配置CORS (跨域资源共享)，允许指定的外部域访问本应用的API。
 * - 注册自定义的拦截器，如`RateLimitInterceptor`，以实现API速率限制等功能。
 *
 * 关联:
 * - `RateLimitInterceptor`: 在此被注册，并应用于特定API路径。
 * - `AppProperties`: 从此类型安全的配置类中获取CORS允许的源列表。
 */
package club.ppmc.config;

import club.ppmc.interceptor.RateLimitInterceptor;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableConfigurationProperties(AppProperties.class) // **[关键步骤]** 启用AppProperties
public class WebConfig implements WebMvcConfigurer {

    private static final Logger logger = LoggerFactory.getLogger(WebConfig.class);

    private static final String ALL_PATHS_PATTERN = "/**";
    private static final String API_V1_PATHS_PATTERN = "/v1/**";
    private static final String[] ALLOWED_CORS_METHODS =
            new String[] {"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"};

    private final RateLimitInterceptor rateLimitInterceptor;
    private final String[] allowedCorsOrigins;

    // **[修改点]** 注入 AppProperties 而不是 @Value
    public WebConfig(
            RateLimitInterceptor rateLimitInterceptor,
            AppProperties appProperties) { // <--- 修改此处
        this.rateLimitInterceptor = rateLimitInterceptor;
        this.allowedCorsOrigins = appProperties.origins().toArray(new String[0]); // <--- 修改此处
        logger.info("WebConfig初始化。CORS允许的源: {}", appProperties.origins());
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns(API_V1_PATHS_PATTERN);
        logger.info("速率限制拦截器已注册，作用于路径: {}", API_V1_PATHS_PATTERN);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping(ALL_PATHS_PATTERN)
                .allowedOrigins(this.allowedCorsOrigins)
                .allowedMethods(ALLOWED_CORS_METHODS)
                .allowedHeaders("*")
                .allowCredentials(true);

        logger.info("CORS映射已配置: 路径[{}], 允许的源[{}], 允许的方法[{}]",
                ALL_PATHS_PATTERN,
                String.join(", ", this.allowedCorsOrigins),
                String.join(", ", ALLOWED_CORS_METHODS));
    }
}