/**
 * 此文件定义了用于WebRTC信令的WebSocket消息的数据传输对象(DTO)。
 *
 * 使用JDK 17的`record`类型实现，提供了不可变性、简洁性和自动生成的方法。
 * `@JsonInclude(JsonInclude.Include.NON_NULL)`确保在序列化为JSON时，
 * null值的字段会被忽略，从而保持消息体的整洁。
 * [MODIFIED] 字段已更新以支持 simple-peer 的通用信令负载，并增加了用于联邦路由的字段。
 *
 * 关联:
 * - `SignalingWebSocketHandler`: 创建和解析此类型的对象。
 * - `MessageType`: 作为此记录的一个字段，定义了消息的类型。
 * - `FederationRoutingService`: 创建带有 `sourceServerGuid` 的此类型对象用于跨服转发。
 */
package club.ppmc.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SignalingMessage(
        MessageType type,
        String userId,
        String targetUserId,
        String fromUserId,
        // [MODIFIED] 使用一个通用的Map来承载simple-peer的信令数据
        Map<String, Object> payload,
        String message,
        // --- [BUG FIX] ---
        // 移除了冗余的 sourceServerUrl 字段，统一使用 sourceServerGuid
        // String sourceServerUrl,
        // --- [BUG FIX] ---
        // [NEW] 新增字段，服务器的持久化唯一ID。
        String sourceServerGuid) {

    /**
     * 重写toString方法以避免在日志中记录完整的、可能很大的信令负载。
     * 这有助于保持日志的整洁和可读性。
     */
    @Override
    public String toString() {
        var builder = new StringBuilder("SignalingMessage{");
        builder.append("type=").append(type);
        if (userId != null) builder.append(", userId='").append(userId).append('\'');
        if (targetUserId != null) builder.append(", targetUserId='").append(targetUserId).append('\'');
        if (fromUserId != null) builder.append(", fromUserId='").append(fromUserId).append('\'');
        if (payload != null) builder.append(", payload='<signal_data>'"); // 使用占位符
        if (message != null) builder.append(", message='").append(message).append('\'');
        // --- [BUG FIX] ---
        // 移除了对 sourceServerUrl 的日志记录
        // if (sourceServerUrl != null) builder.append(", sourceServerUrl='").append(sourceServerUrl).append('\'');
        // --- [BUG FIX] ---
        if (sourceServerGuid != null) builder.append(", sourceServerGuid='").append(sourceServerGuid).append('\'');
        builder.append('}');
        return builder.toString();
    }
}