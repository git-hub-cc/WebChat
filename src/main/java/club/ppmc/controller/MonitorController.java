/**
 * 此文件提供了用于监控服务器状态的API端点。
 *
 * 主要职责:
 * - 提供一个`/api/monitor/status`接口，返回服务器的当前状态，
 *   包括在线用户数、服务器时间和运行状态。
 *
 * 关联:
 * - `UserSessionService`: 用于获取当前在线用户数量。
 * - `ServerStatusDto`: 作为此Controller的响应数据结构。
 */
package club.ppmc.controller;

import club.ppmc.dto.ServerStatusDto;
import club.ppmc.service.UserSessionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/monitor")
public class MonitorController {

    private static final Logger logger = LoggerFactory.getLogger(MonitorController.class);

    private final UserSessionService userSessionService;

    public MonitorController(UserSessionService userSessionService) {
        this.userSessionService = userSessionService;
    }

    /**
     * 获取服务器状态，包括在线用户数和服务器时间。
     * @return 包含服务器状态的`ServerStatusDto`对象。
     */
    @GetMapping("/status")
    public ServerStatusDto getServerStatus() {
        logger.info("收到获取服务器状态的请求 /api/monitor/status");
        try {
            var onlineUserCount = userSessionService.getOnlineUserCount();
            var serverTime = System.currentTimeMillis();
            var status = ServerStatusDto.success(onlineUserCount, serverTime);

            logger.debug("服务器状态获取成功: {}", status);
            return status;
        } catch (Exception e) {
            logger.error("获取服务器状态时发生未知错误。", e);
            return ServerStatusDto.error(e.getMessage());
        }
    }
}