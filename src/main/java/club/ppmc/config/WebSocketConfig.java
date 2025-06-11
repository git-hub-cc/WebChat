package club.ppmc.config;

import club.ppmc.handler.SignalingWebSocketHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * Configuration for WebSocket connections.
 * Enables WebSocket support and registers handlers.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private static final Logger logger = LoggerFactory.getLogger(WebSocketConfig.class);

    private static final String SIGNALING_PATH = "/signaling"; // WebSocket endpoint path

    private final SignalingWebSocketHandler signalingWebSocketHandler;
    private final String allowedOriginUrl;
    private final int maxTextMessageBufferSize;
    private final int maxBinaryMessageBufferSize;
    private final long maxSessionIdleTimeoutMs;

    // Constructor injection for dependencies and configuration values
    public WebSocketConfig(SignalingWebSocketHandler signalingWebSocketHandler,
                           @Value("${allowed.url}") String allowedOriginUrl,
                           @Value("${websocket.max.textBufferSize}") int maxTextMessageBufferSizeKB,
                           @Value("${websocket.max.binaryBufferSize}") int maxBinaryMessageBufferSizeKB,
                           @Value("${websocket.max.sessionTimeout}") long maxSessionIdleTimeoutMinutes) {
        this.signalingWebSocketHandler = signalingWebSocketHandler;
        this.allowedOriginUrl = allowedOriginUrl;
        // Convert KB to Bytes and Minutes to Milliseconds
        this.maxTextMessageBufferSize = maxTextMessageBufferSizeKB * 1024;
        this.maxBinaryMessageBufferSize = maxBinaryMessageBufferSizeKB * 1024;
        this.maxSessionIdleTimeoutMs = maxSessionIdleTimeoutMinutes * 60 * 1000L;

        logger.info("WebSocketConfig 初始化。允许的源 URL: {}", this.allowedOriginUrl+","+"http://localhost:8080");
        logger.info("信令路径: {}", SIGNALING_PATH);
        logger.info("最大文本消息缓冲大小: {} 字节", this.maxTextMessageBufferSize);
        logger.info("最大二进制消息缓冲大小: {} 字节", this.maxBinaryMessageBufferSize);
        logger.info("最大会话空闲超时: {} 毫秒", this.maxSessionIdleTimeoutMs);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Register the signaling handler for the specified path and allowed origins.
        registry.addHandler(signalingWebSocketHandler, SIGNALING_PATH)
                .setAllowedOrigins(allowedOriginUrl,"http://localhost:8080");
        logger.info("已为路径 '{}' 注册 SignalingWebSocketHandler，允许的源: {}",
                SIGNALING_PATH, allowedOriginUrl);
    }

    @Bean
    public ServletServerContainerFactoryBean servletServerContainerFactoryBean() {
        // Configure underlying WebSocket server properties.
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(this.maxTextMessageBufferSize);
        container.setMaxBinaryMessageBufferSize(this.maxBinaryMessageBufferSize);
        container.setMaxSessionIdleTimeout(this.maxSessionIdleTimeoutMs);
        logger.debug("ServletServerContainerFactoryBean 已配置：最大文本消息缓冲大小={}, 最大二进制消息缓冲大小={}, 最大会话空闲超时={}毫秒",
                this.maxTextMessageBufferSize, this.maxBinaryMessageBufferSize, this.maxSessionIdleTimeoutMs);
        return container;
    }
}