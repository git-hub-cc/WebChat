/**
 * 此文件定义了WebSocket连接的Spring配置。
 *
 * 主要职责:
 * - 启用WebSocket支持 (`@EnableWebSocket`)。
 * - 注册`SignalingWebSocketHandler`来处理特定路径 (`/signaling`) 上的WebSocket消息。
 * - 配置WebSocket服务器的底层参数，如缓冲区大小和会话超时时间。
 *
 * 关联:
 * - `SignalingWebSocketHandler`: 在此被注册为WebSocket消息处理器。
 * - `AppProperties`: 从此类型安全的配置类中获取WebSocket允许的源列表。
 */
package club.ppmc.config;

import club.ppmc.handler.SignalingWebSocketHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
@EnableConfigurationProperties(AppProperties.class) // **[关键步骤]** 启用AppProperties
public class WebSocketConfig implements WebSocketConfigurer {

    private static final Logger logger = LoggerFactory.getLogger(WebSocketConfig.class);
    private static final String SIGNALING_PATH = "/signaling";
    private static final int KB_TO_BYTES = 1024;
    private static final long MIN_TO_MS = 60 * 1000L;

    private final SignalingWebSocketHandler signalingWebSocketHandler;
    private final String[] allowedOrigins;
    private final int maxTextMessageBufferSize;
    private final int maxBinaryMessageBufferSize;
    private final long maxSessionIdleTimeoutMs;

    // **[修改点]** 注入 AppProperties 而不是 @Value
    public WebSocketConfig(
            SignalingWebSocketHandler signalingWebSocketHandler,
            AppProperties appProperties, // <--- 修改此处
            @Value("${websocket.max.text-buffer-size-kb}") int maxTextMessageBufferSizeKb,
            @Value("${websocket.max.binary-buffer-size-kb}") int maxBinaryMessageBufferSizeKb,
            @Value("${websocket.max.session-timeout-min}") long maxSessionIdleTimeoutMin) {

        this.signalingWebSocketHandler = signalingWebSocketHandler;
        this.allowedOrigins = appProperties.origins().toArray(new String[0]); // <--- 修改此处
        this.maxTextMessageBufferSize = maxTextMessageBufferSizeKb * KB_TO_BYTES;
        this.maxBinaryMessageBufferSize = maxBinaryMessageBufferSizeKb * KB_TO_BYTES;
        this.maxSessionIdleTimeoutMs = maxSessionIdleTimeoutMin * MIN_TO_MS;

        logger.info("WebSocketConfig初始化。信令路径: {}, 允许的源: {}",
                SIGNALING_PATH, appProperties.origins());
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(signalingWebSocketHandler, SIGNALING_PATH)
                .setAllowedOrigins(this.allowedOrigins);
        logger.info("已为路径'{}'注册SignalingWebSocketHandler。", SIGNALING_PATH);
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        var container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(this.maxTextMessageBufferSize);
        container.setMaxBinaryMessageBufferSize(this.maxBinaryMessageBufferSize);
        container.setMaxSessionIdleTimeout(this.maxSessionIdleTimeoutMs);
        logger.info(
                "WebSocket容器已配置: MaxTextSize[{} B], MaxBinarySize[{} B], IdleTimeout[{} ms]",
                this.maxTextMessageBufferSize,
                this.maxBinaryMessageBufferSize,
                this.maxSessionIdleTimeoutMs);
        return container;
    }
}