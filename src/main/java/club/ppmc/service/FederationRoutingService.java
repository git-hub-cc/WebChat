package club.ppmc.service;

import club.ppmc.config.FederationProperties;
import club.ppmc.dto.FederatedControlMessage;
import club.ppmc.dto.FederatedControlMessageType;
import club.ppmc.dto.MessageType;
import club.ppmc.dto.SignalingMessage;
import club.ppmc.handler.SignalingWebSocketHandler;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.WebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * [REVISED] 联邦路由服务，作为联邦网络的“客户端”核心 (Spoke Role).
 *
 * 主要职责:
 * - 主动连接到 `peers` 配置中指定的伙伴服务器，管理“出站”连接。
 * - 连接成功后，发送包含自身GUID的 `REGISTER_PEER` 消息进行握手。
 * - 将所有收到的上游消息委托给`SignalingWebSocketHandler`统一处理。
 * - 缓存上游伙伴的GUID，并为`SignalingWebSocketHandler`提供查询能力。
 * - 执行对未知用户的“洪泛路由”转发。
 */
@Service
public class FederationRoutingService {

    private static final Logger logger = LoggerFactory.getLogger(FederationRoutingService.class);
    private final FederationProperties properties;
    private final WebSocketClient webSocketClient;
    private final FederationService federationService;
    private final ObjectMapper objectMapper;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    private final SignalingWebSocketHandler signalingWebSocketHandler;

    private final Map<String, WebSocketSession> outboundPeers = new ConcurrentHashMap<>();
    private final Map<String, String> outboundSessionToGuidMap = new ConcurrentHashMap<>();

    public FederationRoutingService(
            FederationProperties properties,
            WebSocketClient webSocketClient,
            @Lazy FederationService federationService,
            ObjectMapper objectMapper,
            @Lazy SignalingWebSocketHandler signalingWebSocketHandler) {
        this.properties = properties;
        this.webSocketClient = webSocketClient;
        this.federationService = federationService;
        this.objectMapper = objectMapper;
        this.signalingWebSocketHandler = signalingWebSocketHandler;
    }

    @PostConstruct
    public void initialize() {
        connectToPeers();
        scheduler.scheduleAtFixedRate(this::sendHeartbeats, 30, 25, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        scheduler.shutdownNow();
        outboundPeers.values().forEach(session -> {
            try { if (session.isOpen()) session.close(CloseStatus.GOING_AWAY); } catch (IOException e) { logger.warn("关闭出站伙伴连接时出错: {}", session.getRemoteAddress()); }
        });
        outboundPeers.clear();
        outboundSessionToGuidMap.clear();
    }

    public boolean isOutboundSession(WebSocketSession session) {
        return outboundSessionToGuidMap.containsKey(session.getId());
    }

    public String getGuidForOutboundSession(WebSocketSession session) {
        return outboundSessionToGuidMap.get(session.getId());
    }

    // [NEW] 允许Handler在收到带GUID的控制消息时，强制关联会话
    public void associateOutboundSessionWithGuid(WebSocketSession session, String guid) {
        if (!outboundSessionToGuidMap.containsKey(session.getId())) {
            outboundSessionToGuidMap.put(session.getId(), guid);
            logger.info("已通过控制消息将出站会话 {} 与伙伴GUID {} 关联。", session.getId(), guid);
        }
    }

    private void connectToPeers() {
        List<String> peers = properties.peers();
        if (peers == null || peers.isEmpty()) {
            logger.info("未配置伙伴服务器（peers），跳过出站联邦连接。");
            return;
        }
        peers.forEach(this::connectToPeer);
    }

    private void connectToPeer(String peerUrl) {
        try {
            String scheme = peerUrl.startsWith("https://") ? "wss" : "ws";
            URI uri = UriComponentsBuilder.fromHttpUrl(peerUrl).scheme(scheme).path("/signaling").build().toUri();
            logger.info("正在尝试连接到伙伴服务器: {}", uri);
            webSocketClient.execute(new PeerConnectionHandler(peerUrl), uri.toString());
        } catch (Exception e) {
            logger.error("连接到伙伴服务器 {} 失败，将在1分钟后重试。", peerUrl, e);
            scheduler.schedule(() -> connectToPeer(peerUrl), 1, TimeUnit.MINUTES);
        }
    }

    public void broadcastLocalUserList(List<String> localUserIds) {
        if (outboundPeers.isEmpty()) return;
        var message = new FederatedControlMessage(FederatedControlMessageType.USER_LIST_UPDATE, localUserIds, System.currentTimeMillis(), federationService.getSelfGuid());
        try {
            String payload = objectMapper.writeValueAsString(message);
            logger.debug("向 {} 个出站伙伴广播用户列表更新...", outboundPeers.size());
            for (WebSocketSession session : outboundPeers.values()) {
                sendOverWebSocket(session, payload);
            }
        } catch (JsonProcessingException e) {
            logger.error("序列化用户列表广播消息失败。", e);
        }
    }

    public boolean forwardToOutboundPeers(SignalingMessage originalMessage, String fromUserId) {
        if (outboundPeers.isEmpty()) return false;

        // --- [BUG FIX] ---
        // 更新构造函数调用，移除 sourceServerUrl (null) 参数，以匹配新的7参数 DTO
        var forwardMessage = new SignalingMessage(
                originalMessage.type(), null, originalMessage.targetUserId(), fromUserId,
                originalMessage.payload(), null, federationService.getSelfGuid()
        );
        // --- [BUG FIX] ---
        try {
            String payload = objectMapper.writeValueAsString(forwardMessage);
            for (WebSocketSession session : outboundPeers.values()) {
                sendOverWebSocket(session, payload);
            }
            return true;
        } catch (JsonProcessingException e) {
            logger.error("序列化洪泛路由消息失败。", e);
            return false;
        }
    }

    private void sendHeartbeats() {
        if (outboundPeers.isEmpty()) return;
        var message = new FederatedControlMessage(FederatedControlMessageType.PING, null, System.currentTimeMillis(), federationService.getSelfGuid());
        try {
            String payload = objectMapper.writeValueAsString(message);
            for (WebSocketSession session : outboundPeers.values()) {
                sendOverWebSocket(session, payload);
            }
        } catch (JsonProcessingException e) {
            logger.error("序列化心跳PING消息失败。", e);
        }
    }

    private void sendOverWebSocket(WebSocketSession session, String payload) {
        try {
            if (session != null && session.isOpen()) {
                session.sendMessage(new TextMessage(payload));
            }
        } catch (IOException e) {
            logger.error("通过出站伙伴WebSocket连接 {} 发送消息时出错。", session.getRemoteAddress());
        }
    }

    private class PeerConnectionHandler extends TextWebSocketHandler {
        private final String peerUrl;

        PeerConnectionHandler(String peerUrl) { this.peerUrl = peerUrl; }

        @Override
        public void afterConnectionEstablished(WebSocketSession session) {
            logger.info("到伙伴 {} 的出站连接已建立: 会话ID {}", peerUrl, session.getId());
            outboundPeers.put(peerUrl, session);

            // --- [BUG FIX] ---
            // 更新构造函数调用，移除 sourceServerUrl (null) 参数
            var registerMsg = new SignalingMessage(MessageType.REGISTER_PEER, null, null, null, null, "Peer Registration", federationService.getSelfGuid());
            // --- [BUG FIX] ---
            try {
                sendOverWebSocket(session, objectMapper.writeValueAsString(registerMsg));
            } catch (JsonProcessingException e) {
                logger.error("序列化REGISTER_PEER消息失败。", e);
            }
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            outboundPeers.remove(peerUrl);
            String removedGuid = outboundSessionToGuidMap.remove(session.getId());
            if (removedGuid != null) {
                federationService.removePeer(removedGuid);
                logger.info("已移除与出站伙伴 {} (GUID: {}) 的关联。", peerUrl, removedGuid);
            }
            signalingWebSocketHandler.afterConnectionClosed(session, status);
            logger.info("与伙伴 {} 的连接已断开，将在1分钟后尝试重连。", peerUrl);
            scheduler.schedule(() -> connectToPeer(peerUrl), 1, TimeUnit.MINUTES);
        }

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
            // 所有消息都委托给统一处理器，它现在能够处理所有情况
            signalingWebSocketHandler.handleMessage(session, message);
        }

        @Override
        public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
            signalingWebSocketHandler.handleTransportError(session, exception);
        }
    }
}