/**
 * [NEW] 定义了在伙伴服务器之间WebSocket控制通道中使用的所有消息类型。
 *
 * 关联:
 * - FederationControlMessage: 使用此枚举来标识消息的具体类型。
 * - FederationRoutingService.PeerConnectionHandler: 根据此枚举的值来路由和处理服务器间的控制消息。
 */
package club.ppmc.dto;

public enum FederatedControlMessageType {
    /**
     * 消息负载是一个完整的用户ID列表。
     * 当一个节点的用户列表发生变化时，它会向所有伙伴广播此消息。
     * 接收方应使用此列表完全替换缓存中该来源服务器的用户列表。
     */
    USER_LIST_UPDATE,

    /**
     * 心跳请求。
     * 用于保持WebSocket连接活跃并检测连接是否断开。
     */
    PING,

    /**
     * 心跳响应。
     * 收到 PING 消息后，应立即回复 PONG。
     */
    PONG
}