package com.example.p2pwebchatboot.interceptor;

import com.example.p2pwebchatboot.model.RateLimitInfo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.time.LocalDate;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private final Map<String, RateLimitInfo> requestCounts = new ConcurrentHashMap<>();

    @Value("${api.v1.request.limit:200}")
    private int dailyLimit;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }
        String requestURI = request.getRequestURI();
        if (!requestURI.startsWith("/v1/")) {
            return true;
        }
        String clientId = getClientIdentifier(request);
        LocalDate today = LocalDate.now();

        RateLimitInfo info = requestCounts.compute(clientId, (key, current) -> {
            if (current == null || !current.getDate().isEqual(today)) {
                current = new RateLimitInfo(0, today);
            }
            current.incrementCount();
            return current;
        });
        System.out.println("Client ID: " + clientId + ", Tentative Count: " + info.getCount() + ", Date: " + info.getDate());
        if (info.getCount() > dailyLimit) {
            sendLimitExceededResponse(response);
            System.out.println("Client ID: " + clientId + " - Request blocked. Count after rollback: " + info.getCount());
            return false;
        }
        System.out.println("Client ID: " + clientId + " - Request allowed. Count: " + info.getCount());
        return true;
    }

    private String getClientIdentifier(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("HTTP_CLIENT_IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("HTTP_X_FORWARDED_FOR");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        return ip != null && ip.contains(",") ? ip.split(",")[0].trim() : ip;
    }

    private void sendLimitExceededResponse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\": 429, \"message\": \"今日请求已达上限，请明天再来！\"}");
    }
}