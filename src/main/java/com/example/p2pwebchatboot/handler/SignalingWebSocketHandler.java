package com.example.p2pwebchatboot.handler;


import com.example.p2pwebchatboot.model.MessageType;
import com.example.p2pwebchatboot.model.SignalingMessage;
import com.example.p2pwebchatboot.service.UserSessionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

@Component
public class SignalingWebSocketHandler implements WebSocketHandler {
    private static final Logger logger = LoggerFactory.getLogger(SignalingWebSocketHandler.class);

    @Autowired
    private UserSessionService userSessionService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        logger.info("新的WebSocket连接建立: {}", session.getId());
    }

    @Override
    public void handleMessage(WebSocketSession session, WebSocketMessage<?> message) throws Exception {
        try {
            System.out.println(message.getPayload());
            String payload = message.getPayload().toString();
            SignalingMessage signalingMessage = objectMapper.readValue(payload, SignalingMessage.class);

            // Avoid logging SDP content directly in production if it's too verbose or sensitive
            if (signalingMessage.getType() == MessageType.OFFER || signalingMessage.getType() == MessageType.ANSWER) {
                logger.info("收到消息类型: {} 来自会话: {}, 目标用户: {}, isVideoCall: {}, isAudioOnly: {}, isScreenShare: {}",
                        signalingMessage.getType(), session.getId(), signalingMessage.getTargetUserId(),
                        signalingMessage.getIsVideoCall(), signalingMessage.getIsAudioOnly(), signalingMessage.getIsScreenShare());
            } else {
                logger.info("收到消息: {} 来自会话: {}", signalingMessage.getType(), session.getId());
            }

            handleSignalingMessage(session, signalingMessage);
        } catch (Exception e) {
            logger.error("处理消息失败", e);
            sendErrorMessage(session, "无效的消息格式");
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        logger.error("WebSocket传输错误: {}", session.getId(), exception);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) throws Exception {
        logger.info("WebSocket连接关闭: {} 状态: {}", session.getId(), closeStatus);
        userSessionService.removeUser(session);
    }

    @Override
    public boolean supportsPartialMessages() {
        return false;
    }

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
                sendErrorMessage(session, "未知的消息类型");
        }
    }

    private void handleRegister(WebSocketSession session, SignalingMessage message) {
        String userId = message.getUserId();

        if (userSessionService.registerUser(userId, session)) {
            SignalingMessage response = new SignalingMessage(MessageType.SUCCESS, "注册成功");
            response.setUserId(userId);
            sendMessage(session, response);
        } else {
            sendErrorMessage(session, "用户ID已存在或无效");
        }
    }

    private void handleIceCandidate(WebSocketSession session, SignalingMessage message) {
        String userId = message.getUserId();
        String targetUserId = message.getTargetUserId();

        logger.info("用户 {} 向用户 {} 发送ICE candidate", userId, targetUserId);

        WebSocketSession targetSession = userSessionService.getUserSession(targetUserId);
        if (targetSession == null || !targetSession.isOpen()) {
            // Do not send "目标用户不在线" for ICE candidates as they might arrive late or for a connection being torn down.
            // The WebRTC connection state handles this.
            logger.warn("ICE Candidate: 目标用户 {} 不在线或会话已关闭. ICE for {}->{} not forwarded.", targetUserId, userId, targetUserId);
            // Optionally, if you want to inform the sender, send USER_NOT_FOUND
            // SignalingMessage userNotFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND);
            // userNotFoundMsg.setTargetUserId(targetUserId);
            // sendMessage(session, userNotFoundMsg);
            return;
        }

        // 转发ICE candidate给目标用户
        SignalingMessage forwardMessage = new SignalingMessage(MessageType.ICE_CANDIDATE);
        forwardMessage.setFromUserId(userId);
        forwardMessage.setCandidate(message.getCandidate());

        sendMessage(targetSession, forwardMessage);
    }

    private void sendMessage(WebSocketSession session, SignalingMessage message) {
        try {
            if (session.isOpen()) {
                String json = objectMapper.writeValueAsString(message);
                session.sendMessage(new TextMessage(json));
            }
        } catch (Exception e) {
            logger.error("发送消息失败", e);
        }
    }

    private void sendErrorMessage(WebSocketSession session, String errorMessage) {
        SignalingMessage message = new SignalingMessage(MessageType.ERROR, errorMessage);
        sendMessage(session, message);
    }

    private void handleOffer(WebSocketSession session, SignalingMessage message) {
        String userId = message.getUserId(); // This is the initiator
        String targetUserId = message.getTargetUserId();

        logger.info("用户 {} 向用户 {} 发送offer. isVideoCall={}, isAudioOnly={}, isScreenShare={}, sdpType={}",
                userId, targetUserId, message.getIsVideoCall(), message.getIsAudioOnly(), message.getIsScreenShare(), message.getSdpType());

        WebSocketSession targetSession = userSessionService.getUserSession(targetUserId);
        if (targetSession == null || !targetSession.isOpen()) {
            sendErrorMessage(session, "目标用户 " + targetUserId + " 不在线");
            // Also notify client that user was not found.
            SignalingMessage userNotFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND);
            userNotFoundMsg.setTargetUserId(targetUserId); // So client knows which attempt failed
            sendMessage(session, userNotFoundMsg);
            return;
        }

        SignalingMessage forwardMessage = new SignalingMessage(MessageType.OFFER);
        forwardMessage.setFromUserId(userId); // Set who the original message is from
        forwardMessage.setSdp(message.getSdp());
        forwardMessage.setSdpType(message.getSdpType()); // Forward sdpType
        forwardMessage.setCandidates(message.getCandidates());
        forwardMessage.setIsVideoCall(message.getIsVideoCall()); // Forward isVideoCall
        forwardMessage.setIsAudioOnly(message.getIsAudioOnly()); // Forward isAudioOnly
        forwardMessage.setIsScreenShare(message.getIsScreenShare()); // Forward isScreenShare

        sendMessage(targetSession, forwardMessage);
        logger.info("Offer已转发给用户 {}", targetUserId);
    }

    private void handleAnswer(WebSocketSession session, SignalingMessage message) {
        String userId = message.getUserId(); // This is the one sending the answer
        String targetUserId = message.getTargetUserId(); // This is the original offer initiator

        logger.info("用户 {} 向用户 {} 发送answer. isVideoCall={}, isAudioOnly={}, isScreenShare={}, sdpType={}",
                userId, targetUserId, message.getIsVideoCall(), message.getIsAudioOnly(), message.getIsScreenShare(), message.getSdpType());

        WebSocketSession targetSession = userSessionService.getUserSession(targetUserId);
        if (targetSession == null || !targetSession.isOpen()) {
            sendErrorMessage(session, "目标用户 " + targetUserId + " 不在线");
            SignalingMessage userNotFoundMsg = new SignalingMessage(MessageType.USER_NOT_FOUND);
            userNotFoundMsg.setTargetUserId(targetUserId);
            sendMessage(session, userNotFoundMsg);
            return;
        }

        SignalingMessage forwardMessage = new SignalingMessage(MessageType.ANSWER);
        forwardMessage.setFromUserId(userId);
        forwardMessage.setSdp(message.getSdp());
        forwardMessage.setSdpType(message.getSdpType()); // Forward sdpType
        forwardMessage.setCandidates(message.getCandidates());
        forwardMessage.setIsVideoCall(message.getIsVideoCall()); // Forward isVideoCall
        forwardMessage.setIsAudioOnly(message.getIsAudioOnly()); // Forward isAudioOnly
        forwardMessage.setIsScreenShare(message.getIsScreenShare()); // Forward isScreenShare

        sendMessage(targetSession, forwardMessage);
        logger.info("Answer已转发给用户 {}", targetUserId);
    }
}