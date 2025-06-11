package club.ppmc.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for managing user WebSocket sessions.
 * Handles registration, removal, and lookup of user sessions.
 * Uses ConcurrentHashMaps for thread-safe access.
 */
@Service
public class UserSessionService {
    private static final Logger logger = LoggerFactory.getLogger(UserSessionService.class);

    // Maps user ID to their active WebSocket session
    private final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();
    // Maps WebSocket session ID to user ID for quick reverse lookup
    private final Map<String, String> sessionToUserMap = new ConcurrentHashMap<>();

    /**
     * Registers a user with their WebSocket session.
     * @param userId The ID of the user to register.
     * @param session The WebSocket session of the user.
     * @return true if registration was successful, false otherwise (e.g., user ID already in use by an active session).
     */
    public boolean registerUser(String userId, WebSocketSession session) {
        if (userId == null || userId.trim().isEmpty() || session == null) {
            logger.warn("尝试使用空的 UserID 或 Session 进行用户注册。");
            return false;
        }

        // Atomically check and put if absent, or if existing session is different and closed
        WebSocketSession oldSessionForUser = userSessions.get(userId);

        // Case 1: User ID is already registered with a DIFFERENT, ACTIVE session.
        if (oldSessionForUser != null && oldSessionForUser.isOpen() && !oldSessionForUser.getId().equals(session.getId())) {
            logger.warn("用户ID '{}' 已被活动会话 {} 注册。新会话 {} 的注册被拒绝。", userId, oldSessionForUser.getId(), session.getId());
            return false;
        }

        // Case 2: User ID is registered with an old, CLOSED session, or this is a new user.
        // Or, user ID is registered with THIS session (e.g. re-register attempt from same client after brief disconnect/reconnect managed by client).
        if (oldSessionForUser != null && !oldSessionForUser.isOpen()) {
            logger.info("清理用户 '{}' 的旧的已关闭会话 {}，准备进行新注册。", userId, oldSessionForUser.getId());
            removeUserInternal(oldSessionForUser.getId(), userId); // Clean up old session fully
        }

        // Proceed with registration
        userSessions.put(userId, session);
        sessionToUserMap.put(session.getId(), userId);
        logger.info("用户 '{}' 已通过会话ID '{}' 注册。", userId, session.getId());
        return true;
    }

    /**
     * Removes a user based on their WebSocket session.
     * Cleans up mappings in both userSessions and sessionToUserMap.
     * @param session The WebSocket session of the user to remove.
     */
    public void removeUser(WebSocketSession session) {
        if (session == null) return;
        String sessionId = session.getId();
        String userId = sessionToUserMap.remove(sessionId); // Remove from reverse map first

        if (userId != null) {
            // Only remove from userSessions if the session being removed is the one currently mapped to the userId.
            // This prevents inadvertently removing a user if they quickly reconnected with a new session.
            WebSocketSession currentSessionForUser = userSessions.get(userId);
            if (currentSessionForUser != null && currentSessionForUser.getId().equals(sessionId)) {
                userSessions.remove(userId);
                logger.info("用户 '{}' (会话 {}) 已移除。", userId, sessionId);
            } else if (currentSessionForUser != null) {
                // This means the session being closed (sessionId) is an older session for this userId.
                // The user already has a newer active session (currentSessionForUser.getId()).
                logger.info("会话 {} (用户 '{}') 已断开, 但用户已有一个更新的活动会话 {}。主用户会话映射未更改。",
                        sessionId, userId, currentSessionForUser.getId());
            } else {
                // UserID was in sessionToUserMap, but not in userSessions. This implies userSessions[userId] was already removed or replaced.
                logger.info("会话 {} (用户 '{}') 已断开。用户未在活动的 userSessions 映射中找到 (可能已被移除或新会话已取代)。", sessionId, userId);
            }
        } else {
            logger.warn("尝试移除会话ID '{}' 对应的用户失败，未找到该会话的用户映射。", sessionId);
        }
    }

    /**
     * Internal helper to remove user session ensuring consistency.
     */
    private void removeUserInternal(String sessionId, String userId) {
        sessionToUserMap.remove(sessionId);
        // Only remove from userSessions if the session ID matches the one stored for the user.
        // This guards against race conditions if the user re-registers quickly.
        WebSocketSession currentMappedSession = userSessions.get(userId);
        if (currentMappedSession != null && currentMappedSession.getId().equals(sessionId)) {
            userSessions.remove(userId);
        }
    }


    /**
     * Retrieves the active WebSocket session for a given user ID.
     * @param userId The ID of the user.
     * @return The WebSocketSession if the user is online and session is open, otherwise null.
     *         Also cleans up stale (closed) sessions if found for the user ID.
     */
    public WebSocketSession getUserSession(String userId) {
        if (userId == null) return null;
        WebSocketSession session = userSessions.get(userId);

        if (session != null) {
            if (session.isOpen()) {
                return session;
            } else {
                // Session found but it's closed. This is a stale entry. Clean it up.
                logger.warn("用户 '{}' 存在会话 {} 但会话已关闭。正在清理...", userId, session.getId());
                removeUser(session); // This will clear it from both maps if it's the mapped session
                return null; // Return null as the session is not usable
            }
        }
        return null; // User not found
    }

    /**
     * Retrieves the user ID associated with a given WebSocket session ID.
     * @param session The WebSocket session.
     * @return The user ID, or null if the session is not registered.
     */
    public String getUserId(WebSocketSession session) {
        if (session == null) return null;
        return sessionToUserMap.get(session.getId());
    }

    /**
     * Gets the current count of online (registered) users.
     * @return The number of online users.
     */
    public int getOnlineUserCount() {
        // The size of userSessions reflects users with an assigned session.
        // We could filter for session.isOpen() for a more "strictly active" count,
        // but cleanup logic aims to keep userSessions mostly accurate.
        return userSessions.size();
    }
}