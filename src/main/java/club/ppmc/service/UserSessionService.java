package club.ppmc.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class UserSessionService {
    private static final Logger logger = LoggerFactory.getLogger(UserSessionService.class);

    private final Map<String, WebSocketSession> userSessions = new ConcurrentHashMap<>();
    private final Map<String, String> sessionToUserMap = new ConcurrentHashMap<>();
    private final FederationService federationService;

    /**
     * 构造函数注入FederationService。
     * 使用 @Lazy 注解来解决 UserSessionService 和 FederationService 之间的循环依赖问题。
     * Spring会创建一个代理对象，直到首次使用时才完全初始化Bean。
     */
    public UserSessionService(@Lazy FederationService federationService) {
        this.federationService = federationService;
    }

    /**
     * 注册一个用户及其关联的WebSocket会话。
     * 如果用户列表发生实际变化（新用户注册），则触发一次联邦用户列表广播。
     *
     * @param userId  要注册的用户的ID。
     * @param session 用户的WebSocket会话。
     * @return 如果注册成功，返回`true`。
     */
    public boolean registerUser(String userId, WebSocketSession session) {
        if (userId == null || userId.trim().isEmpty() || session == null) {
            return false;
        }

        final boolean[] listChanged = {false};
        WebSocketSession oldSession = userSessions.compute(userId, (key, existingSession) -> {
            if (existingSession != null && existingSession.isOpen() && !existingSession.getId().equals(session.getId())) {
                return existingSession; // ID已被其他活跃会话占用，注册失败
            }
            // 如果是新用户，或者用户用新会话重连，则标记为列表已改变
            if (existingSession == null || !existingSession.getId().equals(session.getId())) {
                listChanged[0] = true;
            }
            return session;
        });

        if (session.getId().equals(oldSession.getId())) {
            sessionToUserMap.put(session.getId(), userId);
            if (listChanged[0]) {
                // 本地用户列表发生变化，通知联邦服务向所有出站伙伴广播新列表
                federationService.triggerUserListBroadcastToOutbound();
            }
            return true;
        }

        return false; // 注册失败
    }

    /**
     * 根据WebSocket会话移除用户。
     * 如果用户被成功移除，则触发一次联邦用户列表广播。
     *
     * @param session 要移除的用户所关联的WebSocket会话。
     */
    public void removeUser(WebSocketSession session) {
        if (session == null) return;
        String sessionId = session.getId();
        String userId = sessionToUserMap.remove(sessionId);

        if (userId != null) {
            // 确保我们只移除与当前session匹配的条目，防止竞态条件
            boolean removed = userSessions.remove(userId, session);
            if (removed) {
                // 本地用户列表发生变化，通知联邦服务向所有出站伙伴广播新列表
                federationService.triggerUserListBroadcastToOutbound();
            }
        }
    }

    /**
     * 根据用户ID获取其活跃的WebSocket会话。
     */
    public WebSocketSession getUserSession(String userId) {
        if (userId == null) return null;
        var session = userSessions.get(userId);

        if (session != null && session.isOpen()) {
            return session;
        } else if (session != null) {
            // 发现并清理已关闭但未被移除的陈旧会话
            removeUser(session);
            return null;
        }
        return null;
    }

    /**
     * 根据WebSocket会话获取其关联的用户ID。
     */
    public String getUserId(WebSocketSession session) {
        return session != null ? sessionToUserMap.get(session.getId()) : null;
    }

    /**
     * 获取当前在线（已注册）的用户数量。
     */
    public int getOnlineUserCount() {
        // 清理不活跃会话以保证计数准确
        userSessions.values().removeIf(s -> !s.isOpen());
        return userSessions.size();
    }

    /**
     * 获取当前所有在线用户的ID列表。
     */
    public List<String> getOnlineUserIds() {
        // 在返回列表前，清理所有已关闭的会话
        var iterator = userSessions.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<String, WebSocketSession> entry = iterator.next();
            if (!entry.getValue().isOpen()) {
                sessionToUserMap.remove(entry.getValue().getId());
                iterator.remove();
            }
        }
        return new ArrayList<>(userSessions.keySet());
    }
}