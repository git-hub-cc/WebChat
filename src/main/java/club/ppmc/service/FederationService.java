package club.ppmc.service;

import club.ppmc.dto.FederatedControlMessage;
import club.ppmc.dto.FederatedControlMessageType;
import club.ppmc.dto.FederatedUserDto;
import club.ppmc.dto.SignalingMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * [REVISED] 联邦服务，作为全网用户状态的中央缓存和业务流程协调器。
 *
 * 主要职责:
 * - 维护一个以伙伴服务器的持久化GUID为键的缓存，存储每个伙伴节点上的在线用户列表。
 * - 协调`UserSessionService`和`FederationRoutingService`，在本地用户列表变化时触发广播。
 * - 为`SignalingWebSocketHandler`提供查询和转发服务，将其与底层路由实现解耦。
 */
@Service
public class FederationService {

    private static final Logger logger = LoggerFactory.getLogger(FederationService.class);

    /**
     * 核心缓存: 存储所有伙伴的在线用户列表。
     * Key: 伙伴服务器的持久化全局唯一ID (GUID).
     * Value: 该伙伴上的用户ID列表。
     */
    private final Map<String, List<String>> federatedUsersCache = new ConcurrentHashMap<>();

    private final FederationRoutingService federationRoutingService;
    private final UserSessionService userSessionService;
    private final ServerIdentityService serverIdentityService;
    private final ObjectMapper objectMapper;

    /**
     * 构造函数注入。
     * 使用 @Lazy 注解解决 FederationService, UserSessionService, 和 FederationRoutingService
     * 之间存在的循环依赖问题。
     */
    public FederationService(
            @Lazy FederationRoutingService federationRoutingService,
            @Lazy UserSessionService userSessionService,
            ServerIdentityService serverIdentityService,
            ObjectMapper objectMapper) {
        this.federationRoutingService = federationRoutingService;
        this.userSessionService = userSessionService;
        this.serverIdentityService = serverIdentityService;
        this.objectMapper = objectMapper;
    }

    /**
     * 获取当前服务器的持久化GUID。
     */
    public String getSelfGuid() {
        return serverIdentityService.getServerGuid();
    }

    /**
     * 当一个伙伴连接断开时，由此方法从缓存中移除其所有数据。
     * @param serverGuid 断开连接的伙伴的GUID。
     */
    public void removePeer(String serverGuid) {
        if (serverGuid != null && federatedUsersCache.remove(serverGuid) != null) {
            logger.info("伙伴(GUID: {})的用户缓存已成功移除。", serverGuid);
        }
    }

    /**
     * 更新指定伙伴服务器的在线用户列表缓存。
     * @param serverGuid 伙伴的GUID。
     * @param userIds 该伙伴上最新的在线用户ID列表。
     */
    public void updatePeerUserList(String serverGuid, List<String> userIds) {
        if (serverGuid == null || serverGuid.isBlank()) {
            logger.warn("尝试更新用户列表，但提供的serverGuid为空或无效。");
            return;
        }
        logger.debug("正在更新伙伴 {} 的用户列表，数量: {}", serverGuid, userIds != null ? userIds.size() : 0);
        federatedUsersCache.put(serverGuid, userIds == null ? Collections.emptyList() : userIds);
    }

    /**
     * 触发一次广播，将本节点的最新用户列表发送给所有“出站”连接的伙伴。
     * 由 UserSessionService 在本地用户列表发生变化时调用。
     */
    public void triggerUserListBroadcastToOutbound() {
        List<String> localUserIds = userSessionService.getOnlineUserIds();
        federationRoutingService.broadcastLocalUserList(localUserIds);
    }

    /**
     * 向一个新注册的“入站”伙伴单点同步当前的用户列表。
     * 由 SignalingWebSocketHandler 在处理`REGISTER_PEER`握手时调用。
     * @param peerSession 新伙伴的WebSocketSession。
     */
    public void syncUserListToSinglePeer(WebSocketSession peerSession) {
        List<String> localUserIds = userSessionService.getOnlineUserIds();
        // [FIX] 添加缺失的第四个参数 `getSelfGuid()`
        var message = new FederatedControlMessage(FederatedControlMessageType.USER_LIST_UPDATE, localUserIds, System.currentTimeMillis(), getSelfGuid());
        try {
            String payload = objectMapper.writeValueAsString(message);
            peerSession.sendMessage(new TextMessage(payload));
            logger.info("已向新注册的伙伴 {} 同步当前的用户列表。", peerSession.getId());
        } catch (Exception e) {
            logger.error("向新伙伴 {} 同步用户列表失败。", peerSession.getId(), e);
        }
    }

    /**
     * 根据用户ID在联邦缓存中查找其所在的伙伴服务器的GUID。
     * @param userId 目标用户ID。
     * @return 包含该用户的伙伴的GUID，如果未找到则返回null。
     */
    public String findPeerGuidForUser(String userId) {
        return federatedUsersCache.entrySet().stream()
                .filter(entry -> entry.getValue().contains(userId))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse(null);
    }

    /**
     * 向上游（出站）伙伴洪泛转发一个无法在本地或下游伙伴中找到的信令消息。
     * 这是信令路由的最后一步。
     * @param message 原始信令消息。
     * @param fromUserId 消息的原始发送者ID。
     * @return 如果成功发起了洪泛，则返回true。
     */
    public boolean forwardToOutboundPeers(SignalingMessage message, String fromUserId) {
        return federationRoutingService.forwardToOutboundPeers(message, fromUserId);
    }

    /**
     * [FIXED] 从以GUID为键的缓存中构建联邦用户列表。
     * DTO中的`originServerGuid`字段现在是伙伴服务器的持久化GUID。
     *
     * @return 所有联邦用户的列表（不含本服务器用户）。
     */
    public List<FederatedUserDto> getFederatedUsers() {
        return federatedUsersCache.entrySet().stream()
                .flatMap(entry -> {
                    String originServerGuid = entry.getKey();
                    List<String> userIds = entry.getValue();
                    return userIds.stream()
                            .map(userId -> new FederatedUserDto(userId, originServerGuid));
                })
                .collect(Collectors.toList());
    }
}