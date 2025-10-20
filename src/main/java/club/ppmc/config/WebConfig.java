/**
 * 此文件定义了Spring Web MVC的核心配置。
 *
 * 主要职责:
 * - 配置CORS (跨域资源共享)，允许指定的外部域访问本应用的API。
 * - 注册自定义的拦截器，如`RateLimitInterceptor`，以实现API速率限制等功能。
 * - [新增] 配置静态资源处理器，将服务器上的文件目录映射到公开的URL路径。
 *
 * 关联:
 * - `RateLimitInterceptor`: 在此被注册，并应用于特定API路径。
 * - `AppProperties`: 从此类型安全的配置类中获取CORS允许的源列表。
 */
package club.ppmc.config;

import club.ppmc.interceptor.RateLimitInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.nio.file.Paths;

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private static final Logger logger = LoggerFactory.getLogger(WebConfig.class);

    private static final String ALL_PATHS_PATTERN = "/**";
    // [修改] 更新为新的统一API路径模式
    private static final String API_V1_PATHS_PATTERN = "/api/v1/**";
    private static final String[] ALLOWED_CORS_METHODS =
            new String[] {"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"};

    private final RateLimitInterceptor rateLimitInterceptor;
    private final String[] allowedCorsOrigins;

    // [新增] 注入地图图片上传目录
    @Value("${file.upload-dir.map-images}")
    private String mapImagesUploadDir;

    public WebConfig(
            RateLimitInterceptor rateLimitInterceptor,
            AppProperties appProperties) {
        this.rateLimitInterceptor = rateLimitInterceptor;
        this.allowedCorsOrigins = appProperties.origins().toArray(new String[0]);
        logger.info("WebConfig初始化。CORS允许的源: {}", appProperties.origins());
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // [修改] 拦截器现在作用于 /api/v1/**
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

    /**
     * [新增] 配置静态资源处理器。
     * 此方法将服务器文件系统上的一个目录（例如 "uploads/map-images"）
     * 映射到一个公共的URL路径（例如 "/map-images/**"）。
     * 这样，前端就可以通过 `http://<server>/map-images/<filename>` 来访问上传的图片。
     *
     * @param registry Spring的资源处理器注册表。
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path uploadPath = Paths.get(mapImagesUploadDir).toAbsolutePath();
        String resourceLocation = "file:" + uploadPath.toString() + "/";

        registry.addResourceHandler("/map-images/**")
                .addResourceLocations(resourceLocation);

        logger.info("静态资源处理器已配置：URL路径 [/map-images/**] 映射到物理路径 [{}]", resourceLocation);
    }
}