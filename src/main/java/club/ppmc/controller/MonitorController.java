/**
 * [修改]
 * 1. API基准路径已统一为 /api/v1/monitor
 */
package club.ppmc.controller;

import club.ppmc.dto.FederatedUser;
import club.ppmc.dto.ServerStatus;
import club.ppmc.service.FederationService;
import club.ppmc.service.ServerIdentityService;
import club.ppmc.service.UserSessionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/v1/monitor") // [修改] 统一API前缀
public class MonitorController {

    private static final Logger logger = LoggerFactory.getLogger(MonitorController.class);

    private final UserSessionService userSessionService;
    private final FederationService federationService;
    // [MODIFIED] 使用ServerIdentityService来获取唯一的、持久化的服务器ID
    private final ServerIdentityService serverIdentityService;

    public MonitorController(
            UserSessionService userSessionService,
            FederationService federationService,
            ServerIdentityService serverIdentityService) { // <-- 注入ServerIdentityService
        this.userSessionService = userSessionService;
        this.federationService = federationService;
        this.serverIdentityService = serverIdentityService;
    }

    /**
     * 获取服务器状态，包括在线用户数和服务器时间。
     * Endpoint: GET /api/v1/monitor/status
     * @return 包含服务器状态的`ServerStatusDto`对象。
     */
    @GetMapping("/status")
    public ServerStatus getServerStatus() {
        logger.info("收到获取服务器状态的请求 /api/v1/monitor/status");
        try {
            var onlineUserCount = userSessionService.getOnlineUserCount();
            var serverTime = System.currentTimeMillis();
            var status = ServerStatus.success(onlineUserCount, serverTime);

            logger.debug("服务器状态获取成功: {}", status);
            return status;
        } catch (Exception e) {
            logger.error("获取服务器状态时发生未知错误。", e);
            return ServerStatus.error(e.getMessage());
        }
    }

    /**
     * 获取当前所有在线用户的ID列表。
     * Endpoint: GET /api/v1/monitor/online-user-ids
     * @return 包含所有在线用户ID的列表。如果发生错误，则返回空列表。
     */
    @GetMapping("/online-user-ids")
    public ResponseEntity<List<String>> getOnlineUserIds() {
        logger.info("收到获取在线用户ID列表的请求 /api/v1/monitor/online-user-ids");
        try {
            var onlineUserIds = userSessionService.getOnlineUserIds();
            logger.debug("成功获取在线用户ID列表，数量: {}", onlineUserIds.size());
            return ResponseEntity.ok(onlineUserIds);
        } catch (Exception e) {
            logger.error("获取在线用户ID列表时发生未知错误。", e);
            return ResponseEntity.ok(Collections.emptyList());
        }
    }

    /**
     * [MODIFIED] 获取所有已知服务器（包括本机）的在线用户列表。
     * 现在使用服务器的持久化GUID作为来源标识。
     * Endpoint: GET /api/v1/monitor/all-online-users
     * @return 包含所有在线用户ID及其来源服务器GUID的列表。
     */
    @GetMapping("/all-online-users")
    public ResponseEntity<List<FederatedUser>> getAllOnlineUsers() {
        logger.info("收到获取全网在线用户的请求 /api/v1/monitor/all-online-users");
        try {
            // 获取本服务器的GUID
            String selfServerGuid = serverIdentityService.getServerGuid();

            // 获取本地用户，并使用GUID进行标记
            List<FederatedUser> localUsers = userSessionService.getOnlineUserIds().stream()
                    .map(userId -> new FederatedUser(userId, selfServerGuid))
                    .toList();

            // 获取联邦用户 (FederationService现在会返回带有GUID的DTO)
            List<FederatedUser> federatedUsers = federationService.getFederatedUsers();

            // 合并并返回
            List<FederatedUser> allUsers = Stream.concat(localUsers.stream(), federatedUsers.stream())
                    .collect(Collectors.toList());

            logger.debug("成功获取全网在线用户列表，数量: {}", allUsers.size());
            return ResponseEntity.ok(allUsers);
        } catch (Exception e) {
            logger.error("获取全网在线用户列表时发生未知错误。", e);
            return ResponseEntity.ok(Collections.emptyList());
        }
    }
}