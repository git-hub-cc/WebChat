/**
 * 此文件定义了用于WebRTC信令的WebSocket消息的数据传输对象(DTO)。
 *
 * 使用JDK 17的`record`类型实现，提供了不可变性、简洁性和自动生成的方法。
 * `@JsonInclude(JsonInclude.Include.NON_NULL)`确保在序列化为JSON时，
 * null值的字段会被忽略，从而保持消息体的整洁。
 * [MODIFIED] 字段已更新以支持 simple-peer 的通用信令负载，并增加了用于联邦路由和增强信令的字段。
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
        Map<String, Object> payload,
        String message,
        String sourceServerGuid,

        // --- [NEW] Fields for Enhanced Signaling Logic ---
        /**
         * 用于区分同一消息类型下的不同子操作，例如 "initialOffer", "restartOffer"
         */
        String subType,
        /**
         * 用于信令版本控制或顺序管理
         */
        Long sequenceId,
        /**
         * 用于ACK机制，确认某条消息的ID
         */
        String ackId) {

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
        if (sourceServerGuid != null) builder.append(", sourceServerGuid='").append(sourceServerGuid).append('\'');
        // [MODIFIED] Add new fields to logging
        if (subType != null) builder.append(", subType='").append(subType).append('\'');
        if (sequenceId != null) builder.append(", sequenceId=").append(sequenceId);
        if (ackId != null) builder.append(", ackId='").append(ackId).append('\'');
        builder.append('}');
        return builder.toString();
    }
}