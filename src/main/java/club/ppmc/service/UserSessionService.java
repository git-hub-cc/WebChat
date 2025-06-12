/**
 * 此服务类负责管理所有活跃用户的WebSocket会话。
 *
 * 主要职责:
 * - 线程安全地处理用户注册、注销和查询操作。
 * - 维护用户ID到`WebSocketSession`的正向映射和会话ID到用户ID的反向映射，以实现高效查找。
 * - 处理会话的清理逻辑，包括因断开或被新会话取代而产生的陈旧会话。
 *
 * 关联:
 * - `SignalingWebSocketHandler`: 依赖此服务来管理用户注册和消息转发。
 * - `MonitorController`: 依赖此服务来获取在线用户总数。
 */
package club.ppmc.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

@Service
public class UserSessionService {
    private static final Logger logger = LoggerFactory.getLogger(UserSessionService.class);

    // 映射: userId -> WebSocketSession，用于根据用户ID查找会话。
    private final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();
    // 映射: sessionId -> userId，用于根据会话ID反向查找用户ID，主要用于断开连接时清理。
    private final Map<String, String> sessionToUserMap = new ConcurrentHashMap<>();

    /**
     * 注册一个用户及其关联的WebSocket会话。
     *
     * @param userId  要注册的用户的ID。
     * @param session 用户的WebSocket会话。
     * @return 如果注册成功，返回`true`；如果用户ID已被一个活跃会话占用，则返回`false`。
     */
    public boolean registerUser(String userId, WebSocketSession session) {
        if (userId == null || userId.trim().isEmpty() || session == null) {
            logger.warn("尝试使用无效的UserID或Session进行注册，操作被拒绝。");
            return false;
        }

        // 核心逻辑: 原子地检查并更新会话，处理并发和陈旧会话问题。
        // compute方法确保对同一个userId的操作是线程安全的。
        var oldSession = userSessions.compute(userId, (key, existingSession) -> {
            // Case 1: 用户ID已绑定到一个不同的、仍然活跃的会话。注册失败。
            if (existingSession != null && existingSession.isOpen() && !existingSession.getId().equals(session.getId())) {
                logger.warn("用户ID '{}' 已被活跃会话 {} 占用。新会话 {} 的注册被拒绝。",
                        userId, existingSession.getId(), session.getId());
                return existingSession; // 返回旧会话，不作更改
            }
            // Case 2: 用户ID未被绑定，或绑定到一个已关闭的会话，或就是当前这个会话。可以注册/更新。
            return session; // 将新的会话与userId关联
        });

        // 如果compute方法返回的是新会话，说明注册成功。
        if (session.getId().equals(oldSession.getId())) {
            sessionToUserMap.put(session.getId(), userId);
            logger.info("用户 '{}' 已成功注册/更新会话ID '{}'。", userId, session.getId());
            return true;
        }

        return false; // 注册失败 (Case 1)
    }

    /**
     * 根据WebSocket会话移除用户。在会话关闭时调用。
     *
     * @param session 要移除的用户所关联的WebSocket会话。
     */
    public void removeUser(WebSocketSession session) {
        if (session == null) return;
        var sessionId = session.getId();
        var userId = sessionToUserMap.remove(sessionId);

        if (userId != null) {
            // 关键检查: 仅当映射中的会话确实是当前要移除的会话时，才执行移除操作。
            // 这可以防止因竞态条件（如用户快速重连）而错误地移除了新的、活跃的会话。
            userSessions.remove(userId, session);
            logger.info("用户 '{}' (会话 {}) 已被移除。", userId, sessionId);
        } else {
            logger.debug("尝试移除一个未注册的会话: {}", sessionId);
        }
    }

    /**
     * 根据用户ID获取其活跃的WebSocket会话。
     *
     * @param userId 用户的ID。
     * @return 如果用户在线且会话是打开的，则返回`WebSocketSession`；否则返回`null`。
     */
    public WebSocketSession getUserSession(String userId) {
        if (userId == null) return null;
        var session = userSessions.get(userId);

        if (session != null && session.isOpen()) {
            return session;
        } else if (session != null) {
            // 发现陈旧会话（已关闭但未被清理），主动清理。
            logger.warn("为用户 '{}' 找到一个已关闭的陈旧会话 {}，正在清理...", userId, session.getId());
            removeUser(session);
            return null;
        }
        return null;
    }

    /**
     * 根据WebSocket会话获取其关联的用户ID。
     *
     * @param session WebSocket会话。
     * @return 如果会话已注册，则返回用户ID；否则返回`null`。
     */
    public String getUserId(WebSocketSession session) {
        return session != null ? sessionToUserMap.get(session.getId()) : null;
    }

    /**
     * 获取当前在线（已注册）的用户数量。
     *
     * @return 在线用户数。
     */
    public int getOnlineUserCount() {
        return userSessions.size();
    }
}