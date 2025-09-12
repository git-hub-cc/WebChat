/**
 * [MODIFIED] 用于服务器之间控制通道通信的数据传输对象 (DTO)。
 *
 * 这个类的实例用于在伙伴服务器之间交换非信令的控制信息，
 * 例如心跳和在线用户列表的同步。它与客户端使用的 `SignalingMessage` 是分开的，
 * 从而实现了一个干净的服务器间控制协议。
 *
 * 关联:
 * - FederationControlMessageType: 定义此消息的具体类型。
 * - FederationRoutingService.PeerConnectionHandler: 创建和解析此类型的对象。
 */
package club.ppmc.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record FederatedControlMessage(
        FederatedControlMessageType type,
        List<String> userIds,
        long timestamp,
        // [NEW] 新增字段，用于在控制消息中始终携带发送方身份
        String sourceServerGuid
) {}