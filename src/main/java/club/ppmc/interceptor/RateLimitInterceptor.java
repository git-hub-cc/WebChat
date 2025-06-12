/**
 * 此文件定义了一个用于API速率限制的Spring拦截器。
 *
 * 主要职责:
 * - 在请求到达Controller之前进行拦截。
 * - 基于客户端IP地址，限制特定API路径 (如`/v1/**`) 的日访问次数。
 * - 如果超过限制，则中断请求并返回`429 Too Many Requests`响应。
 *
 * 关联:
 * - `WebConfig`: 此拦截器在此类中被注册。
 * - `RateLimitInfo`: 用于存储每个客户端的请求计数和日期的记录类。
 * - `application.yml`: 从此文件读取每日请求限制次数 (`api.v1.request.limit`)。
 */
package club.ppmc.interceptor;

import club.ppmc.model.RateLimitInfo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.LocalDate;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(RateLimitInterceptor.class);
    private final Map<String, RateLimitInfo> requestCounts = new ConcurrentHashMap<>();

    private static final String API_V1_PREFIX = "/v1/";
    private static final String HEADER_X_FORWARDED_FOR = "X-Forwarded-For";

    private final int dailyLimit;

    public RateLimitInterceptor(@Value("${api.v1.request.limit}") int dailyLimit) {
        this.dailyLimit = dailyLimit;
        logger.info("速率限制拦截器初始化，每日限制为 {} 次请求。", dailyLimit);
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        // 对CORS预检请求(OPTIONS)直接放行
        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }

        // 仅对/v1/**路径应用速率限制
        if (!request.getRequestURI().startsWith(API_V1_PREFIX)) {
            return true;
        }

        var clientId = getClientIdentifier(request);
        var today = LocalDate.now();

        // 原子地更新或创建客户端的请求计数信息
        var info = requestCounts.compute(clientId, (key, currentInfo) -> {
            if (currentInfo == null || !currentInfo.date().isEqual(today)) {
                return new RateLimitInfo(1, today); // 新的一天或新客户端，重置计数为1
            }
            return new RateLimitInfo(currentInfo.count() + 1, today); // 当日计数加一
        });

        if (info.count() > dailyLimit) {
            logger.warn("速率限制已超出: 客户端ID '{}', 今日请求次数 {}, 限制 {}", clientId, info.count(), dailyLimit);
            sendLimitExceededResponse(response);
            return false; // 拦截请求
        }

        logger.debug("请求允许: 客户端ID '{}', 今日请求次数 {}/{}", clientId, info.count(), dailyLimit);
        return true; // 放行请求
    }

    /**
     * 获取客户端标识符，优先使用代理服务器设置的头信息，最后回退到直接连接的IP地址。
     */
    private String getClientIdentifier(HttpServletRequest request) {
        var ip = request.getHeader(HEADER_X_FORWARDED_FOR);
        if (ip != null && !ip.isBlank() && !"unknown".equalsIgnoreCase(ip)) {
            // 如果`X-Forwarded-For`包含多个IP，第一个通常是原始客户端IP
            return ip.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private void sendLimitExceededResponse(HttpServletResponse response) throws IOException {
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType("application/json;charset=UTF-8");
        // 使用JDK 17的Text Blocks定义JSON字符串，提高可读性
        var errorJson = """
                {
                  "code": 429,
                  "message": "今日请求已达上限，请明天再来！"
                }
                """;
        response.getWriter().write(errorJson);
    }
}