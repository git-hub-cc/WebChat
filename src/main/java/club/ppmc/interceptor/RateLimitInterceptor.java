package club.ppmc.interceptor;

import club.ppmc.model.RateLimitInfo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.time.LocalDate;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Interceptor for rate limiting API requests.
 * Limits the number of requests per client IP per day for specific API paths.
 */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(RateLimitInterceptor.class);
    private final Map<String, RateLimitInfo> requestCounts = new ConcurrentHashMap<>();

    @Value("${api.v1.request.limit}")
    private int dailyLimit; // Daily request limit per client

    private static final String API_V1_PREFIX = "/v1/";

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // Allow OPTIONS requests (pre-flight requests for CORS)
        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }

        // Only apply rate limiting to /v1/** paths
        if (!request.getRequestURI().startsWith(API_V1_PREFIX)) {
            return true;
        }

        String clientId = getClientIdentifier(request);
        LocalDate today = LocalDate.now();

        // Atomically update the request count for the client
        RateLimitInfo info = requestCounts.compute(clientId, (key, currentInfo) -> {
            if (currentInfo == null || !currentInfo.getDate().isEqual(today)) {
                // New day or new client, reset count
                currentInfo = new RateLimitInfo(0, today);
            }
            currentInfo.incrementCount();
            return currentInfo;
        });

        if (info.getCount() > dailyLimit) {
            logger.warn("速率限制已超出: 客户端 ID '{}', 今日请求次数 {}, 限制 {}", clientId, info.getCount(), dailyLimit);
            sendLimitExceededResponse(response);
            return false; // Block the request
        }

        logger.debug("请求允许: 客户端 ID '{}', 今日请求次数 {}", clientId, info.getCount());
        return true; // Allow the request
    }

    /**
     * Retrieves a client identifier, typically the IP address.
     * Tries common headers used by proxies to find the original client IP.
     */
    private String getClientIdentifier(HttpServletRequest request) {
        String[] headersToTry = {
                "X-Forwarded-For",
                "Proxy-Client-IP",
                "WL-Proxy-Client-IP",
                "HTTP_X_FORWARDED_FOR",
                "HTTP_X_FORWARDED",
                "HTTP_X_CLUSTER_CLIENT_IP",
                "HTTP_CLIENT_IP",
                "HTTP_FORWARDED_FOR",
                "HTTP_FORWARDED",
                "HTTP_VIA",
                "REMOTE_ADDR" // Fallback
        };

        for (String header : headersToTry) {
            String ip = request.getHeader(header);
            if (ip != null && !ip.isEmpty() && !"unknown".equalsIgnoreCase(ip)) {
                // If "X-Forwarded-For" contains multiple IPs, the first one is usually the client
                if (ip.contains(",")) {
                    return ip.split(",")[0].trim();
                }
                return ip;
            }
        }
        // If no header found, use getRemoteAddr() as a last resort
        return request.getRemoteAddr();
    }

    private void sendLimitExceededResponse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType("application/json;charset=UTF-8");
        // Provide a user-friendly error message in Chinese
        response.getWriter().write("{\"code\": 429, \"message\": \"今日请求已达上限，请明天再来！\"}");
    }
}