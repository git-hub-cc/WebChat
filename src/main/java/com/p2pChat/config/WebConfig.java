package com.p2pChat.config;

import com.p2pChat.interceptor.RateLimitInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC configuration for CORS and interceptors.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final Logger logger = LoggerFactory.getLogger(WebConfig.class);

    private final RateLimitInterceptor rateLimitInterceptor;
    private final String allowedCorsOriginUrl;

    private static final String ALL_PATHS_PATTERN = "/**";
    private static final String API_V1_PATHS_PATTERN = "/v1/**"; // Ensure interceptor applies to all /v1 subpaths
    private static final String[] ALLOWED_CORS_METHODS = {"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"};

    public WebConfig(RateLimitInterceptor rateLimitInterceptor,
                     @Value("${allowed.url}") String allowedCorsOriginUrl) {
        this.rateLimitInterceptor = rateLimitInterceptor;
        this.allowedCorsOriginUrl = allowedCorsOriginUrl;
        logger.info("WebConfig 初始化。CORS 允许的源 URL: {}", this.allowedCorsOriginUrl);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Register the rate limit interceptor for API v1 paths.
        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns(API_V1_PATHS_PATTERN);
        logger.info("速率限制拦截器已注册，作用于路径: {}", API_V1_PATHS_PATTERN);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // Configure Cross-Origin Resource Sharing (CORS) for all paths.
        // This is crucial for web applications where frontend and backend are on different origins.
        registry.addMapping(ALL_PATHS_PATTERN)
                .allowedOrigins(allowedCorsOriginUrl,"http://localhost:8080")
                .allowedMethods(ALLOWED_CORS_METHODS)
                .allowedHeaders("*") // Allow all standard headers
                .allowCredentials(true); // Important for sending credentials like cookies or Authorization headers

        logger.info("CORS 映射已配置：路径: {}, 允许的源: {}, 允许的方法: {}",
                ALL_PATHS_PATTERN,
                allowedCorsOriginUrl,
                String.join(", ", ALLOWED_CORS_METHODS));
    }
}