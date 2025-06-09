package com.p2pChat.controller;

import com.p2pChat.service.UserSessionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * Controller for monitoring server status.
 */
@RestController
@RequestMapping("/api/monitor")
public class MonitorController {

    private static final Logger logger = LoggerFactory.getLogger(MonitorController.class);

    private final UserSessionService userSessionService;

    @Autowired
    public MonitorController(UserSessionService userSessionService) {
        this.userSessionService = userSessionService;
    }

    @GetMapping("/status")
    public Map<String, Object> getServerStatus() {
        logger.info("收到获取服务器状态的请求 /api/monitor/status");

        Map<String, Object> status = new HashMap<>();
        try {
            int onlineUserCount = userSessionService.getOnlineUserCount();
            long serverTime = System.currentTimeMillis();
            String serverStatus = "运行中"; // "running"

            status.put("onlineUsers", onlineUserCount);
            status.put("serverTime", serverTime);
            status.put("status", serverStatus);

            logger.debug("服务器状态获取成功: 在线用户={}, 服务器时间={}, 状态={}",
                    onlineUserCount, serverTime, serverStatus);

        } catch (Exception e) {
            logger.error("获取服务器状态时出错", e);
            status.put("onlineUsers", -1); // Indicates an error in fetching count
            status.put("serverTime", System.currentTimeMillis());
            status.put("status", "错误"); // "error"
            status.put("errorMessage", e.getMessage());
        }
        return status;
    }
}