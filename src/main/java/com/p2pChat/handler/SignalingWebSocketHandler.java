package com.p2pChat.handler;

import com.p2pChat.model.MessageType;
import com.p2pChat.model.SignalingMessage;
import com.p2pChat.service.UserSessionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

/**
 * Handles WebSocket messages for WebRTC signaling.
 * Manages user registration and forwards signaling messages (offer, answer, ICE candidates)
 * between connected peers.
 */
@Component
public class SignalingWebSocketHandler implements WebSocketHandler {
    private static final Logger logger = LoggerFactory.getLogger(SignalingWebSocketHandler.class);

    private final UserSessionService userSessionService;
    private final ObjectMapper objectMapper = new ObjectMapper(); // For JSON serialization/deserialization

    @Autowired
    public SignalingWebSocketHandler(UserSessionService userSessionService) {
        this.userSessionService = userSessionService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        logger.info("新的 WebSocket 连接已建立: 会话 ID {}", session.getId());
    }

    @Override
    public void handleMessage(WebSocketSession session, WebSocketMessage<?> message) {
        try {
            String payload = message.getPayload().toString();
            SignalingMessage signalingMessage = objectMapper.readValue(payload, SignalingMessage.class);

            // Log message details, avoiding overly verbose SDP content in general logs
            if (signalingMessage.getType() == MessageType.OFFER || signalingMessage.getType() == MessageType.ANSWER) {
                logger.info("收到消息类型: {} | 来自会话: {} | 目标用户: {} | 视频通话: {} | 纯音频: {} | 屏幕共享: {}",
                        signalingMessage.getType(), session.getId(), signalingMessage.getTargetUserId(),
                        signalingMessage.getIsVideoCall(), signalingMessage.getIsAudioOnly(), signalingMessage.getIsScreenShare());
            } else if (signalingMessage.getType() == MessageType.ICE_CANDIDATE) {
                logger.info("收到消息类型: {} | 来自会话: {} | 发送者: {} | 目标用户: {}",
                        signalingMessage.getType(), session.getId(), signalingMessage.getUserId(), signalingMessage.getTargetUserId());
            }
            else {
                logger.info("收到消息: {} | 来自会话: {}", signalingMessage, session.getId());
            }

            handleSignalingMessage(session, signalingMessage);
        } catch (Exception e) {
            logger.error("处理 WebSocket 消息失败 | 会话 ID {}: {}", session.getId(), e.getMessage(), e);
            sendErrorMessage(session, "无效的消息格式或处理错误");
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        logger.error("WebSocket 传输错误 | 会话 ID {}: {}", session.getId(), exception.getMessage(), exception);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) {
        logger.info("WebSocket 连接已关闭: 会话 ID {} | 状态: {}", session.getId(), closeStatus);
        userSessionService.removeUser(session); // Clean up user session
    }

    @Override
    public boolean supportsPartialMessages() {
        return false; // Signaling messages are typically small and complete
    }

    /**
     * Routes incoming signaling messages to appropriate handlers based on type.
     */
    private void handleSignalingMessage(WebSocketSession session, SignalingMessage message) {
        switch (message.getType()) {
            case REGISTER:
                handleRegister(session, message);
                break;
            case OFFER:
                handleOffer(session, message);
                break;
            case ANSWER:
                handleAnswer(session, message);
                break;
            case ICE_CANDIDATE:
                handleIceCandidate(session, message);
                break;
            default:
                logger.warn("收到未知的消息类型: {} | 来自会话: {}", message.getType(), session.getId());
                sendErrorMessage(session, "未知的消息类型: " + message.getType());
        }
    }

    private void handleRegister(WebSocketSession session, SignalingMessage message) {
        String userId = message.getUserId();
        if (userId == null || userId.trim().isEmpty()) {
            logger.warn("注册请求中用户ID为空 | 会话 ID: {}", session.getId());
            sendErrorMessage(session, "用户ID不能为空");
            return;
        }

        if (userSessionService.registerUser(userId, session)) {
            SignalingMessage response = new SignalingMessage(MessageType.SUCCESS, "注册成功");
            response.setUserId(userId); // Echo back userId for confirmation
            sendMessage(session, response);
            logger.info("用户 {} 注册成功 | 会话 ID: {}", userId, session.getId());
        } else {
            sendErrorMessage(session, "用户ID '" + userId + "' 已存在或无效 (可能同时打开多个窗口?)");
            logger.warn("用户 {} 注册失败，ID已存在或无效 | 会话 ID: {}", userId, session.getId());
        }
    }

    private void handleOffer(WebSocketSession session, SignalingMessage message) {
        String initiatorUserId = userSessionService.getUserId(session); // Get initiator from current session
        if (initiatorUserId == null) {
            logger.warn("无法识别 Offer 发送者 | 会话 ID: {}", session.getId());
            sendErrorMessage(session, "无法识别用户身份，请先注册");
            return;
        }
        String targetUserId = message.getTargetUserId();
        logger.info("用户 {} 向用户 {} 发送 Offer | 视频通话: {} | 纯音频: {} | 屏幕共享: {} | SDP 类型: {}",
                initiatorUserId, targetUserId, message.getIsVideoCall(), message.getIsAudioOnly(), message.getIsScreenShare(), message.getSdpType());

        WebSocketSession targetSession = userSessionService.getUserSession(targetUserId);
        if (targetSession == null || !targetSession.isOpen()) {
            logger.warn("Offer 转发失败：目标用户 {} 不在线或会话已关闭", targetUserId);
            SignalingMessage userNotFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND, "目标用户 " + targetUserId + " 不在线");
            userNotFoundMsg.setTargetUserId(targetUserId);
            sendMessage(session, userNotFoundMsg);
            return;
        }

        // Forward the offer to the target user
        SignalingMessage forwardMessage = new SignalingMessage(MessageType.OFFER);
        forwardMessage.setFromUserId(initiatorUserId); // Important: set who the offer is from
        forwardMessage.setSdp(message.getSdp());
        forwardMessage.setSdpType(message.getSdpType());
        forwardMessage.setCandidates(message.getCandidates());
        forwardMessage.setIsVideoCall(message.getIsVideoCall());
        forwardMessage.setIsAudioOnly(message.getIsAudioOnly());
        forwardMessage.setIsScreenShare(message.getIsScreenShare());

        sendMessage(targetSession, forwardMessage);
        logger.info("Offer 已从 {} 转发给用户 {}", initiatorUserId, targetUserId);
    }

    private void handleAnswer(WebSocketSession session, SignalingMessage message) {
        String responderUserId = userSessionService.getUserId(session); // Get responder from current session
        if (responderUserId == null) {
            logger.warn("无法识别 Answer 发送者 | 会话 ID: {}", session.getId());
            sendErrorMessage(session, "无法识别用户身份，请先注册");
            return;
        }
        String originalInitiatorUserId = message.getTargetUserId(); // The one who sent the offer
        logger.info("用户 {} 向用户 {} 发送 Answer | 视频通话: {} | 纯音频: {} | 屏幕共享: {} | SDP 类型: {}",
                responderUserId, originalInitiatorUserId, message.getIsVideoCall(), message.getIsAudioOnly(), message.getIsScreenShare(), message.getSdpType());

        WebSocketSession originalInitiatorSession = userSessionService.getUserSession(originalInitiatorUserId);
        if (originalInitiatorSession == null || !originalInitiatorSession.isOpen()) {
            logger.warn("Answer 转发失败：目标用户 (原始Offer发起者) {} 不在线或会话已关闭", originalInitiatorUserId);
            SignalingMessage userNotFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND, "目标用户 " + originalInitiatorUserId + " 不在线");
            userNotFoundMsg.setTargetUserId(originalInitiatorUserId);
            sendMessage(session, userNotFoundMsg);
            return;
        }

        // Forward the answer to the original initiator
        SignalingMessage forwardMessage = new SignalingMessage(MessageType.ANSWER);
        forwardMessage.setFromUserId(responderUserId); // Important: set who the answer is from
        forwardMessage.setSdp(message.getSdp());
        forwardMessage.setSdpType(message.getSdpType());
        forwardMessage.setCandidates(message.getCandidates());
        forwardMessage.setIsVideoCall(message.getIsVideoCall());
        forwardMessage.setIsAudioOnly(message.getIsAudioOnly());
        forwardMessage.setIsScreenShare(message.getIsScreenShare());

        sendMessage(originalInitiatorSession, forwardMessage);
        logger.info("Answer 已从 {} 转发给用户 {}", responderUserId, originalInitiatorUserId);
    }

    private void handleIceCandidate(WebSocketSession session, SignalingMessage message) {
        String senderUserId = userSessionService.getUserId(session); // Get sender from current session
        if (senderUserId == null) {
            logger.warn("无法识别 ICE Candidate 发送者 | 会话 ID: {}", session.getId());
            // Usually, we don't send an error for this, as ICE candidates can arrive after registration context is lost
            return;
        }
        String targetUserId = message.getTargetUserId();
        logger.info("用户 {} 向用户 {} 发送 ICE candidate", senderUserId, targetUserId);

        WebSocketSession targetSession = userSessionService.getUserSession(targetUserId);
        if (targetSession == null || !targetSession.isOpen()) {
            // It's common for ICE candidates to arrive for sessions that are being torn down or for users who have disconnected.
            // Usually, no explicit error message is sent back to the sender for this.
            logger.warn("ICE Candidate 转发失败：目标用户 {} 不在线或会话已关闭。ICE 从 {} 到 {} 未转发。", targetUserId, senderUserId, targetUserId);
            // Optionally, if an explicit notification is required by the client:
            // SignalingMessage userNotFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND);
            // userNotFoundMsg.setTargetUserId(targetUserId);
            // sendMessage(session, userNotFoundMsg);
            return;
        }

        // Forward the ICE candidate to the target user
        SignalingMessage forwardMessage = new SignalingMessage(MessageType.ICE_CANDIDATE);
        forwardMessage.setFromUserId(senderUserId); // Important: set who the candidate is from
        forwardMessage.setCandidate(message.getCandidate());
        // If sdpMid, sdpMLineIndex are part of candidate, they are already in the map.
        // If they are separate fields in SignalingMessage, forward them too.

        sendMessage(targetSession, forwardMessage);
        // logger.debug("ICE Candidate 已从 {} 转发给用户 {}", senderUserId, targetUserId); // Can be too verbose
    }

    private void sendMessage(WebSocketSession session, SignalingMessage message) {
        try {
            if (session.isOpen()) {
                String jsonPayload = objectMapper.writeValueAsString(message);
                session.sendMessage(new TextMessage(jsonPayload));
            } else {
                logger.warn("尝试向已关闭的会话 {} 发送消息失败: {}", session.getId(), message.getType());
            }
        } catch (Exception e) {
            logger.error("通过 WebSocket 发送消息失败 | 会话 ID {}: {}", session.getId(), e.getMessage(), e);
        }
    }

    private void sendErrorMessage(WebSocketSession session, String errorMessageText) {
        SignalingMessage errorMessage = new SignalingMessage(MessageType.ERROR, errorMessageText);
        sendMessage(session, errorMessage);
    }
}