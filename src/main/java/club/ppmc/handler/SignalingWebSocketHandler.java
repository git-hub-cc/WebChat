package club.ppmc.handler;

import club.ppmc.dto.*;
import club.ppmc.service.FederationRoutingService;
import club.ppmc.service.FederationService;
import club.ppmc.service.UserSessionService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * [REVISED] WebSocket消息处理器，作为联邦网络的统一业务逻辑处理中心。
 *
 * 主要职责:
 * - 作为所有WebSocket连接（包括客户端、入站伙伴、出站伙伴）的统一消息处理入口。
 * - 通过`REGISTER_PEER`握手消息，识别并管理所有“入站”的伙伴服务器连接，并将其`sessionId`与持久化的`GUID`关联。
 * - 接收并处理所有来源的控制消息（如`USER_LIST_UPDATE`, `PING`）和信令消息（`SIGNAL`）。
 * - 智能路由`SIGNAL`消息，确保其在联邦网络中正确流转。
 */
@Component
public class SignalingWebSocketHandler implements WebSocketHandler {
    private static final Logger logger = LoggerFactory.getLogger(SignalingWebSocketHandler.class);

    private final UserSessionService userSessionService;
    private final ObjectMapper objectMapper;
    private final FederationService federationService;
    private final FederationRoutingService federationRoutingService;


    /**
     * [MODIFIED] 存储所有已通过握手验证的“入站”伙伴服务器连接的sessionId到其GUID的映射。
     * Key: WebSocket Session ID. Value: Server GUID.
     */
    private final Map<String, String> inboundSessionToGuidMap = new ConcurrentHashMap<>();
    /**
     * [NEW] 存储所有活跃的“入站”伙伴WebSocketSession实例，用于精确消息转发。
     * Key: WebSocket Session ID. Value: WebSocketSession Object.
     */
    private final Map<String, WebSocketSession> activeInboundPeers = new ConcurrentHashMap<>();

    public SignalingWebSocketHandler(
            UserSessionService userSessionService,
            ObjectMapper objectMapper,
            FederationService federationService,
            @Lazy FederationRoutingService federationRoutingService) {
        this.userSessionService = userSessionService;
        this.objectMapper = objectMapper;
        this.federationService = federationService;
        this.federationRoutingService = federationRoutingService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        logger.info("新的WebSocket连接已建立: 会话ID {}", session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) {
        String sessionId = session.getId();
        activeInboundPeers.remove(sessionId); // 从活跃会话池中移除
        String peerGuid = inboundSessionToGuidMap.remove(sessionId);

        if (peerGuid != null) {
            federationService.removePeer(peerGuid);
            logger.info("入站伙伴服务器连接已关闭: 会话ID {} | GUID: {} | 状态: {}", sessionId, peerGuid, closeStatus);
        } else if (federationRoutingService.isOutboundSession(session)) {
            logger.info("出站伙伴连接已关闭: 会话ID {} | 状态: {}", sessionId, closeStatus);
        } else {
            userSessionService.removeUser(session);
            logger.info("客户端连接已关闭: 会话ID {} | 状态: {}", sessionId, closeStatus);
        }
    }

    @Override
    public void handleMessage(WebSocketSession session, WebSocketMessage<?> message) {
        try {
            var payload = message.getPayload().toString();
            var messageMap = objectMapper.readValue(payload, new TypeReference<Map<String, Object>>() {});
            String typeString = (String) messageMap.get("type");

            if (isFederationControlType(typeString)) {
                var controlMessage = objectMapper.readValue(payload, FederatedControlMessage.class);
                handleFederationControlMessage(session, controlMessage);
            } else {
                var signalingMessage = objectMapper.readValue(payload, SignalingMessage.class);
                handleSignalingMessage(session, signalingMessage);
            }
        } catch (Exception e) {
            logger.error("处理WebSocket消息失败 | 会话ID {}: {}", session.getId(), e.getMessage(), e);
            if (session.isOpen()) {
                sendErrorMessage(session, "无效的消息格式或处理错误。");
            }
        }
    }

    private void handleSignalingMessage(WebSocketSession session, SignalingMessage message) {
        if (getPeerGuid(session) == null && message.sourceServerGuid() != null) {
            logger.warn("收到来自伙伴 {} 的信令消息，该伙伴GUID未知，但消息中包含GUID {}。将尝试关联。", session.getId(), message.sourceServerGuid());
            federationRoutingService.associateOutboundSessionWithGuid(session, message.sourceServerGuid());
        }

        if (message.type() == MessageType.REGISTER_PEER) {
            handlePeerRegistration(session, message);
        } else if (isPeerSession(session) || message.sourceServerGuid() != null) {
            handleFederatedSignalingMessage(message);
        } else {
            handleClientSignalingMessage(session, message);
        }
    }

    private void handleClientSignalingMessage(WebSocketSession session, SignalingMessage message) {
        switch (message.type()) {
            case REGISTER -> handleRegister(session, message);
            case SIGNAL -> forwardSignalingMessage(session, message);
            case PING -> handlePing(session);
            case ACK -> logger.debug("收到来自会话 {} 的ACK消息, ackId: {}", session.getId(), message.ackId());
            default -> logger.warn("收到未知的客户端消息类型: {} | 会话ID: {}", message.type(), session.getId());
        }
    }

    private void handlePeerRegistration(WebSocketSession session, SignalingMessage message) {
        String sessionId = session.getId();
        String peerGuid = message.sourceServerGuid();

        if (peerGuid == null || peerGuid.isBlank()) {
            logger.warn("伙伴 {} 尝试注册但未提供有效的GUID，已拒绝。", sessionId);
            try { session.close(CloseStatus.POLICY_VIOLATION.withReason("Missing server GUID")); } catch (IOException e) {/* ignore */}
            return;
        }

        if (inboundSessionToGuidMap.containsKey(sessionId)) {
            logger.warn("伙伴 {} (GUID: {}) 尝试重复注册。", sessionId, peerGuid);
            return;
        }

        userSessionService.removeUser(session);
        inboundSessionToGuidMap.put(sessionId, peerGuid);
        activeInboundPeers.put(sessionId, session);
        logger.info("入站伙伴服务器注册成功: 会话ID {} | GUID: {}", sessionId, peerGuid);
        federationService.syncUserListToSinglePeer(session);
    }

    private void handleFederatedSignalingMessage(SignalingMessage message) {
        var targetUserId = message.targetUserId();
        var targetSession = userSessionService.getUserSession(targetUserId);

        if (targetSession != null && targetSession.isOpen()) {
            // [MODIFIED] 将联邦消息转发给本地客户端时，不包含服务器间的路由信息。
            var clientMessage = new SignalingMessage(
                    message.type(), null, null, message.fromUserId(),
                    message.payload(), null, null,
                    message.subType(), message.sequenceId(), message.ackId(),
                    null, null // 清除路由信息
            );
            sendMessage(targetSession, clientMessage);
        } else {
            logger.warn("收到针对用户 '{}' 的联邦信令，但该用户当前不在线。", targetUserId);
        }
    }

    private void handleFederationControlMessage(WebSocketSession session, FederatedControlMessage message) {
        String peerGuid = getPeerGuid(session);

        if (peerGuid == null) {
            if (message.sourceServerGuid() != null) {
                federationRoutingService.associateOutboundSessionWithGuid(session, message.sourceServerGuid());
                peerGuid = message.sourceServerGuid();
            } else {
                logger.warn("收到一个来自未经注册的伙伴 {} 的控制消息，且消息本身不含GUID，已忽略: {}", session.getId(), message);
                return;
            }
        }

        switch (message.type()) {
            case USER_LIST_UPDATE -> federationService.updatePeerUserList(peerGuid, message.userIds());
            case PING -> {
                var pong = new FederatedControlMessage(FederatedControlMessageType.PONG, null, System.currentTimeMillis(), federationService.getSelfGuid());
                try {
                    String payload = objectMapper.writeValueAsString(pong);
                    session.sendMessage(new TextMessage(payload));
                } catch (IOException e) {
                    logger.error("回复PONG到伙伴 {} (GUID: {}) 时失败。", session.getId(), peerGuid, e);
                }
            }
            case PONG -> logger.debug("收到来自伙伴 {} (GUID: {}) 的PONG响应。", session.getId(), peerGuid);
        }
    }

    private void forwardSignalingMessage(WebSocketSession session, SignalingMessage message) {
        var fromUserId = userSessionService.getUserId(session);
        if (fromUserId == null) {
            sendErrorMessage(session, "请先注册。");
            return;
        }
        var targetUserId = message.targetUserId();

        // 1. 尝试本地转发
        var targetSession = userSessionService.getUserSession(targetUserId);
        if (targetSession != null && targetSession.isOpen()) {
            // [MODIFIED] 转发给本地客户端时，不包含服务器间的路由信息。
            var forwardMessage = new SignalingMessage(
                    message.type(), null, null, fromUserId, message.payload(), null, null,
                    message.subType(), message.sequenceId(), message.ackId(),
                    null, null // 清除路由信息
            );
            sendMessage(targetSession, forwardMessage);
            logger.debug("SIGNAL 已从 '{}' 本地转发给 '{}'。", fromUserId, targetUserId);
            return;
        }

        // 2. 尝试向下游伙伴精确转发
        String targetPeerGuid = federationService.findPeerGuidForUser(targetUserId);
        if (targetPeerGuid != null) {
            String targetSessionId = inboundSessionToGuidMap.entrySet().stream()
                    .filter(entry -> targetPeerGuid.equals(entry.getValue()))
                    .map(Map.Entry::getKey)
                    .findFirst()
                    .orElse(null);

            if (targetSessionId != null) {
                WebSocketSession peerSession = activeInboundPeers.get(targetSessionId);
                if (peerSession != null && peerSession.isOpen()) {
                    // [MODIFIED] 精确路由时，需要传递完整的原始消息，以便下一跳能进行路由保护。
                    var forwardMessage = new SignalingMessage(
                            message.type(), null, targetUserId, fromUserId, message.payload(), null, federationService.getSelfGuid(),
                            message.subType(), message.sequenceId(), message.ackId(),
                            message.visitedServers(), message.hopCount());
                    try {
                        peerSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(forwardMessage)));
                        logger.debug("SIGNAL 已从 '{}' 通过入站伙伴连接 {} (GUID: {}) 精确转发给 '{}'。", fromUserId, peerSession.getId(), targetPeerGuid, targetUserId);
                        return;
                    } catch (IOException e) {
                        logger.error("通过入站伙伴连接 {} (GUID: {}) 转发信令失败。", peerSession.getId(), targetPeerGuid, e);
                    }
                }
            }
        }

        // 3. 尝试向上游伙伴洪泛转发
        // [MODIFIED] FederationRoutingService现在会处理路由循环保护，我们只需传递原始消息。
        boolean forwardedToUpstream = federationService.forwardToOutboundPeers(message, fromUserId);
        if (forwardedToUpstream) {
            logger.debug("SIGNAL 已从 '{}' 尝试通过出站连接洪泛转发给 '{}'。", fromUserId, targetUserId);
            return;
        }

        // 4. 用户不存在
        logger.warn("SIGNAL 转发失败：目标用户 '{}' 在全网均未找到。", targetUserId);
        sendMessage(session, new SignalingMessage(MessageType.USER_NOT_FOUND, null, targetUserId, null, null, "目标用户不在线。", null, null, null, null, null, null));
    }

    private boolean isPeerSession(WebSocketSession session) {
        return inboundSessionToGuidMap.containsKey(session.getId()) || federationRoutingService.isOutboundSession(session);
    }

    private String getPeerGuid(WebSocketSession session) {
        String guid = inboundSessionToGuidMap.get(session.getId());
        if (guid != null) return guid;
        return federationRoutingService.getGuidForOutboundSession(session);
    }

    private boolean isFederationControlType(String type) { if (type == null) return false; try { FederatedControlMessageType.valueOf(type); return true; } catch (IllegalArgumentException e) { return false; } }
    private void handleRegister(WebSocketSession session, SignalingMessage message) { var userId = message.userId(); if (userId == null || userId.trim().isEmpty()) { sendErrorMessage(session, "用户ID不能为空。"); return; } if (userSessionService.registerUser(userId, session)) { sendMessage(session, new SignalingMessage(MessageType.SUCCESS, userId, null, null, null, "注册成功", null, null, null, null, null, null)); logger.info("用户 '{}' 注册成功 | 会话ID: {}", userId, session.getId()); } else { sendErrorMessage(session, "用户ID '" + userId + "' 已被其他会话使用。"); logger.warn("用户 '{}' 注册失败，ID已被占用 | 会话ID: {}", userId, session.getId()); } }
    private void handlePing(WebSocketSession session) { sendMessage(session, new SignalingMessage(MessageType.PONG, null, null, null, null, "pong", null, null, null, null, null, null)); }
    private void sendMessage(WebSocketSession session, SignalingMessage message) { try { if (session.isOpen()) { session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message))); } } catch (Exception e) { logger.error("发送SignalingMessage失败 | 会话ID {}: {}", (session != null ? session.getId() : "null"), e.getMessage()); } }
    private void sendErrorMessage(WebSocketSession session, String errorMessageText) { sendMessage(session, new SignalingMessage(MessageType.ERROR, null, null, null, null, errorMessageText, null, null, null, null, null, null)); }
    @Override public void handleTransportError(WebSocketSession session, Throwable exception) { logger.error("WebSocket传输错误 | 会话ID {}: {}", session.getId(), exception.getMessage());}
    @Override public boolean supportsPartialMessages() { return false; }
}