package club.ppmc.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.socket.client.WebSocketClient;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;

/**
 * 此文件定义了同步HTTP客户端`RestTemplate`和WebSocket客户端的Spring配置。
 */
@Configuration
public class RestTemplateConfig {

    /**
     * [REMOVED] RestTemplate不再用于联邦服务。
     * 如果项目中其他地方也不再需要它，可以删除此Bean。
     * 此处暂时保留以确保其他潜在模块的兼容性。
     *
     * @return 一个新的`RestTemplate`对象。
     */
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    /**
     * 创建一个标准的WebSocket客户端Bean。
     * 此Bean是FederationRoutingService的必要依赖，用于建立到伙伴服务器的出站WebSocket连接。
     *
     * @return 一个新的`StandardWebSocketClient`对象。
     */
    @Bean
    public WebSocketClient webSocketClient() {
        return new StandardWebSocketClient();
    }
}