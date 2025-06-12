/**
 * 此文件是核心的WebSocket消息处理器，用于WebRTC信令交换。
 *
 * 主要职责:
 * - 管理WebSocket连接的生命周期 (`afterConnectionEstablished`, `afterConnectionClosed`)。
 * - 接收、解析和路由所有信令消息 (`handleMessage`)。
 * - 处理用户注册、心跳(Ping/Pong)以及WebRTC的Offer, Answer, ICE Candidate消息转发。
 *
 * 关联:
 * - `UserSessionService`: 用于管理用户与WebSocket会话的映射关系。
 * - `SignalingMessage`: 作为所有信令消息的数据载体。
 * - `WebSocketConfig`: 在此类中被注册到WebSocket路由。
 */
package club.ppmc.handler;

import club.ppmc.dto.MessageType;
import club.ppmc.dto.SignalingMessage;
import club.ppmc.service.UserSessionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

@Component
public class SignalingWebSocketHandler implements WebSocketHandler {
    private static final Logger logger = LoggerFactory.getLogger(SignalingWebSocketHandler.class);

    private final UserSessionService userSessionService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SignalingWebSocketHandler(UserSessionService userSessionService) {
        this.userSessionService = userSessionService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        logger.info("新的WebSocket连接已建立: 会话ID {}", session.getId());
    }

    @Override
    public void handleMessage(WebSocketSession session, WebSocketMessage<?> message) {
        try {
            var payload = message.getPayload().toString();
            var signalingMessage = objectMapper.readValue(payload, SignalingMessage.class);

            // 根据消息类型进行结构化日志记录，避免冗余信息
            logReceivedMessage(session, signalingMessage);

            handleSignalingMessage(session, signalingMessage);
        } catch (Exception e) {
            logger.error("处理WebSocket消息失败 | 会话ID {}: {}", session.getId(), e.getMessage(), e);
            sendErrorMessage(session, "无效的消息格式或处理错误。");
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) {
        logger.info("WebSocket连接已关闭: 会话ID {} | 状态: {}", session.getId(), closeStatus);
        userSessionService.removeUser(session); // 清理用户会话资源
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        logger.error("WebSocket传输错误 | 会话ID {}: {}", session.getId(), exception.getMessage());
    }

    @Override
    public boolean supportsPartialMessages() {
        return false; // 信令消息通常较小，不支持分片消息
    }

    private void handleSignalingMessage(WebSocketSession session, SignalingMessage message) {
        // 使用JDK 17的Switch表达式风格路由消息
        switch (message.type()) {
            case REGISTER -> handleRegister(session, message);
            case OFFER, ANSWER -> forwardRtcMessage(session, message);
            case ICE_CANDIDATE -> forwardIceCandidate(session, message);
            case PING -> handlePing(session);
            default -> {
                logger.warn("收到未知的消息类型: {} | 会话ID: {}", message.type(), session.getId());
                sendErrorMessage(session, "未知的消息类型: " + message.type());
            }
        }
    }

    private void handleRegister(WebSocketSession session, SignalingMessage message) {
        var userId = message.userId();
        if (userId == null || userId.trim().isEmpty()) {
            logger.warn("注册请求中用户ID为空 | 会话ID: {}", session.getId());
            sendErrorMessage(session, "用户ID不能为空。");
            return;
        }

        if (userSessionService.registerUser(userId, session)) {
            var response = new SignalingMessage(MessageType.SUCCESS, userId, null, null, null, null, null, null, null, null, null, "注册成功");
            sendMessage(session, response);
            logger.info("用户 '{}' 注册成功 | 会话ID: {}", userId, session.getId());
        } else {
            sendErrorMessage(session, "用户ID '" + userId + "' 已被其他会话使用。");
            logger.warn("用户 '{}' 注册失败，ID已被占用 | 会话ID: {}", userId, session.getId());
        }
    }

    /**
     * 统一处理Offer和Answer消息的转发。
     * 这两种消息的转发逻辑几乎相同，可以合并以减少代码重复。
     */
    private void forwardRtcMessage(WebSocketSession session, SignalingMessage message) {
        var fromUserId = userSessionService.getUserId(session);
        if (fromUserId == null) {
            sendErrorMessage(session, "无法识别用户身份，请先注册。");
            return;
        }

        var targetUserId = message.targetUserId();
        var targetSession = userSessionService.getUserSession(targetUserId);

        if (targetSession == null || !targetSession.isOpen()) {
            logger.warn("{}转发失败：目标用户'{}'不在线。", message.type(), targetUserId);
            var notFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND, null, targetUserId, null, null, null, null, null, null, null, null, "目标用户 " + targetUserId + " 不在线。");
            sendMessage(session, notFoundMsg);
            return;
        }

        // 创建要转发的消息，将`fromUserId`设置为原始发送者
        var forwardMessage = new SignalingMessage(
                message.type(), null, null, fromUserId, message.sdp(), message.sdpType(),
                message.candidates(), null, message.isVideoCall(), message.isAudioOnly(),
                message.isScreenShare(), null);

        sendMessage(targetSession, forwardMessage);
        logger.info("{} 已从 '{}' 转发给 '{}'。", message.type(), fromUserId, targetUserId);
    }

    private void forwardIceCandidate(WebSocketSession session, SignalingMessage message) {
        var fromUserId = userSessionService.getUserId(session);
        if (fromUserId == null) {
            logger.warn("无法识别ICE Candidate发送者 | 会话ID: {}", session.getId());
            return;
        }

        var targetUserId = message.targetUserId();
        var targetSession = userSessionService.getUserSession(targetUserId);

        if (targetSession == null || !targetSession.isOpen()) {
            logger.warn("ICE Candidate转发失败: 目标用户'{}'不在线。消息从'{}'到'{}'未送达。",
                    targetUserId, fromUserId, targetUserId);
            return;
        }

        var forwardMessage = new SignalingMessage(
                MessageType.ICE_CANDIDATE, null, null, fromUserId, null, null,
                null, message.candidate(), null, null, null, null);

        sendMessage(targetSession, forwardMessage);
        logger.debug("ICE Candidate 已从'{}'转发给'{}'。", fromUserId, targetUserId);
    }

    private void handlePing(WebSocketSession session) {
        logger.debug("收到来自会话 {} 的Ping，将发送Pong。", session.getId());
        sendMessage(session, new SignalingMessage(MessageType.PONG, null, null, null, null, null, null, null, null, null, null, "pong"));
    }

    private void sendMessage(WebSocketSession session, SignalingMessage message) {
        try {
            if (session.isOpen()) {
                var jsonPayload = objectMapper.writeValueAsString(message);
                session.sendMessage(new TextMessage(jsonPayload));
            } else {
                logger.warn("尝试向已关闭的会话 {} 发送消息失败: {}", session.getId(), message.type());
            }
        } catch (Exception e) {
            logger.error("通过WebSocket发送消息失败 | 会话ID {}: {}", session.getId(), e.getMessage(), e);
        }
    }

    private void sendErrorMessage(WebSocketSession session, String errorMessageText) {
        sendMessage(session, new SignalingMessage(MessageType.ERROR, null, null, null, null, null, null, null, null, null, null, errorMessageText));
    }

    private void logReceivedMessage(WebSocketSession session, SignalingMessage message) {
        switch (message.type()) {
            case OFFER, ANSWER ->
                    logger.info("收到消息: {} | 会话: {} | 目标: {} | 视频: {} | 音频: {}",
                            message.type(), session.getId(), message.targetUserId(),
                            message.isVideoCall(), message.isAudioOnly());
            case ICE_CANDIDATE ->
                    logger.debug("收到消息: {} | 会话: {} | 目标: {}",
                            message.type(), session.getId(), message.targetUserId());
            case PING ->
                    logger.debug("收到消息: PING | 会话: {}", session.getId());
            case REGISTER ->
                    logger.info("收到消息: {} | 会话: {} | 用户: {}",
                            message.type(), session.getId(), message.userId());
            default ->
                    logger.info("收到消息: {} | 会话: {}", message, session.getId());
        }
    }
}