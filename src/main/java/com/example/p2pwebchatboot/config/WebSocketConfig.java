package com.example.p2pwebchatboot.config;

import com.example.p2pwebchatboot.handler.SignalingWebSocketHandler;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @Autowired
    private SignalingWebSocketHandler signalingWebSocketHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(signalingWebSocketHandler, "/signaling")
                .setAllowedOrigins("https://175.178.216.24/,http://localhost:8080/"); // 生产环境中应该限制允许的源
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        // Set buffer size to 16KB (128 * 1024 bytes)
        container.setMaxTextMessageBufferSize(128 * 1024);
        container.setMaxBinaryMessageBufferSize(128 * 1024);
        // You can also configure other parameters if needed
        container.setMaxSessionIdleTimeout(5 * 60 * 1000L); // 15 minutes timeout
        return container;
    }
}