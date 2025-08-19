/**
 * 此文件是核心的WebSocket消息处理器，用于WebRTC信令交换。
 *
 * 主要职责:
 * - 管理WebSocket连接的生命周期 (`afterConnectionEstablished`, `afterConnectionClosed`)。
 * - 接收、解析和路由所有信令消息 (`handleMessage`)。
 * - 处理用户注册、心跳(Ping/Pong)以及将WebRTC的SIGNAL消息转发给目标用户。
 * [MODIFIED] 消息处理逻辑已简化，以支持 simple-peer 的通用信令模型。
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
        // [MODIFIED] 使用简化的Switch表达式来路由消息
        switch (message.type()) {
            case REGISTER -> handleRegister(session, message);
            case SIGNAL -> forwardSignalingMessage(session, message); // 新的通用转发逻辑
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
            var response = new SignalingMessage(MessageType.SUCCESS, userId, null, null, null, "注册成功");
            sendMessage(session, response);
            logger.info("用户 '{}' 注册成功 | 会话ID: {}", userId, session.getId());
        } else {
            sendErrorMessage(session, "用户ID '" + userId + "' 已被其他会话使用。");
            logger.warn("用户 '{}' 注册失败，ID已被占用 | 会话ID: {}", userId, session.getId());
        }
    }

    /**
     * [NEW] 统一处理所有WebRTC信令消息的转发。
     * 此方法不再关心信令的具体内容，只负责将其从一个用户传递给另一个用户。
     */
    private void forwardSignalingMessage(WebSocketSession session, SignalingMessage message) {
        var fromUserId = userSessionService.getUserId(session);
        if (fromUserId == null) {
            sendErrorMessage(session, "无法识别用户身份，请先注册。");
            return;
        }

        var targetUserId = message.targetUserId();
        if (targetUserId == null || targetUserId.isBlank()) {
            logger.warn("信令消息转发失败：缺少目标用户ID。消息来自 '{}'。", fromUserId);
            sendErrorMessage(session, "信令消息必须包含targetUserId。");
            return;
        }

        var targetSession = userSessionService.getUserSession(targetUserId);

        if (targetSession == null || !targetSession.isOpen()) {
            logger.warn("{}转发失败：目标用户'{}'不在线。", message.type(), targetUserId);
            var notFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND, null, targetUserId, null, null, "目标用户 " + targetUserId + " 不在线。");
            sendMessage(session, notFoundMsg);
            return;
        }

        // 创建要转发的消息，将`fromUserId`设置为原始发送者，并携带原始负载
        var forwardMessage = new SignalingMessage(
                message.type(),
                null,           // userId (not needed for forward)
                null,           // targetUserId (not needed for forward)
                fromUserId,     // fromUserId is the original sender
                message.payload(),// The original payload from the sender
                null            // message (not needed for signal)
        );

        sendMessage(targetSession, forwardMessage);
        logger.debug("{} 已从 '{}' 转发给 '{}'。", message.type(), fromUserId, targetUserId);
    }

    private void handlePing(WebSocketSession session) {
        logger.debug("收到来自会话 {} 的Ping，将发送Pong。", session.getId());
        sendMessage(session, new SignalingMessage(MessageType.PONG, null, null, null, null, "pong"));
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
        sendMessage(session, new SignalingMessage(MessageType.ERROR, null, null, null, null, errorMessageText));
    }

    /**
     * [MODIFIED] 简化了日志记录逻辑以适应新的信令协议。
     */
    private void logReceivedMessage(WebSocketSession session, SignalingMessage message) {
        switch (message.type()) {
            case SIGNAL ->
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