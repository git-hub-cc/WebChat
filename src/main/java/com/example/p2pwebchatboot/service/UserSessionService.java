package com.example.p2pwebchatboot.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.util.concurrent.ConcurrentHashMap;

@Service
public class UserSessionService {
    private static final Logger logger = LoggerFactory.getLogger(UserSessionService.class);

    private final ConcurrentHashMap<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> sessionToUser = new ConcurrentHashMap<>();

    /**
     * 注册用户会话
     */
    public boolean registerUser(String userId, WebSocketSession session) {
        if (userId == null || userId.trim().isEmpty()) {
            return false;
        }

        if (userSessions.containsKey(userId)) {
            logger.warn("用户ID {} 已存在", userId);
            return false;
        }

        userSessions.put(userId, session);
        sessionToUser.put(session.getId(), userId);
        logger.info("用户 {} 注册成功", userId);
        return true;
    }

    /**
     * 移除用户会话
     */
    public void removeUser(WebSocketSession session) {
        String userId = sessionToUser.remove(session.getId());
        if (userId != null) {
            userSessions.remove(userId);
            logger.info("用户 {} 已断开连接", userId);
        }
    }

    /**
     * 根据用户ID获取会话
     */
    public WebSocketSession getUserSession(String userId) {
        return userSessions.get(userId);
    }

    /**
     * 根据会话获取用户ID
     */
    public String getUserId(WebSocketSession session) {
        return sessionToUser.get(session.getId());
    }

    /**
     * 检查用户是否在线
     */
    public boolean isUserOnline(String userId) {
        WebSocketSession session = userSessions.get(userId);
        return session != null && session.isOpen();
    }

    /**
     * 获取在线用户数量
     */
    public int getOnlineUserCount() {
        return userSessions.size();
    }
}
