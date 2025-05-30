package com.example.p2pwebchatboot.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class UserSessionService {
    private static final Logger logger = LoggerFactory.getLogger(UserSessionService.class);

    // Maps userId to WebSocketSession
    private final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();
    // Maps sessionId to userId (for quick lookup on disconnect)
    private final Map<String, String> sessionToUserMap = new ConcurrentHashMap<>();

    public boolean registerUser(String userId, WebSocketSession session) {
        if (userId == null || userId.trim().isEmpty() || session == null) {
            logger.warn("Attempted to register user with null or empty userId/session.");
            return false;
        }
        // Prevent overwriting an existing user's session unless it's the same session trying to re-register (which shouldn't happen)
        // Or if the old session for that userId is closed.
        WebSocketSession existingSession = userSessions.get(userId);
        if (existingSession != null && existingSession.isOpen() && !existingSession.getId().equals(session.getId())) {
            logger.warn("User ID {} is already registered with an active session {}.", userId, existingSession.getId());
            return false;
        }

        // If there was an old, closed session for this userId, clean it up
        if (existingSession != null && !existingSession.isOpen()) {
            logger.info("Cleaning up old, closed session for userId {} before new registration.", userId);
            removeUser(existingSession); // Ensure sessionToUserMap is also cleaned
        }


        userSessions.put(userId, session);
        sessionToUserMap.put(session.getId(), userId);
        logger.info("User {} registered with session ID {}.", userId, session.getId());
        return true;
    }

    public void removeUser(WebSocketSession session) {
        if (session == null) return;
        String sessionId = session.getId();
        String userId = sessionToUserMap.remove(sessionId);
        if (userId != null) {
            // Remove only if the current session for this userId matches the disconnecting session
            // This prevents a new session for the same user from being incorrectly removed if disconnects are out of order
            WebSocketSession currentSessionForUser = userSessions.get(userId);
            if (currentSessionForUser != null && currentSessionForUser.getId().equals(sessionId)) {
                userSessions.remove(userId);
                logger.info("User {} (session {}) removed.", userId, sessionId);
            } else if (currentSessionForUser != null) {
                logger.info("Session {} for user {} disconnected, but user has a newer active session {}. Not removing user from userSessions map.",
                        sessionId, userId, currentSessionForUser.getId());
            } else {
                logger.info("Session {} for user {} disconnected. User was not found in active userSessions map (already removed or new session took over).", sessionId, userId);
            }
        } else {
            logger.warn("Attempted to remove user for session ID {}, but no user was mapped to this session.", sessionId);
        }
    }

    public WebSocketSession getUserSession(String userId) {
        if (userId == null) return null;
        WebSocketSession session = userSessions.get(userId);
        if (session != null && session.isOpen()) {
            return session;
        } else if (session != null) {
            // Session found but not open, means it's stale. Clean it up.
            logger.warn("User {} has a session {} but it's not open. Cleaning up.", userId, session.getId());
            removeUser(session); // This will clear it from both maps
            return null;
        }
        return null; // User not found or session stale
    }

    public String getUserId(WebSocketSession session) {
        if (session == null) return null;
        return sessionToUserMap.get(session.getId());
    }

    /**
     * 获取在线用户数量
     */
    public int getOnlineUserCount() {
        return userSessions.size();
    }
}