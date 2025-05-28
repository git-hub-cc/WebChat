package com.example.p2pwebchatboot.controller;


import com.example.p2pwebchatboot.service.UserSessionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/monitor")
public class MonitorController {

    @Autowired
    private UserSessionService userSessionService;

    @GetMapping("/status")
    public Map<String, Object> getServerStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("onlineUsers", userSessionService.getOnlineUserCount());
        status.put("serverTime", System.currentTimeMillis());
        status.put("status", "running");
        return status;
    }
}
