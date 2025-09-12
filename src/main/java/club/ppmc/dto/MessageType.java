/**
 * 此文件定义了在WebSocket信令通信中使用的所有消息类型。
 *
 * `enum` 提供了一种类型安全的方式来识别和处理不同种OLS的消息。
 * [MODIFIED] 增加了 `REGISTER_PEER` 类型，用于伙伴服务器间的握手。
 *
 * 关联:
 * - `SignalingMessage`: 使用此枚举来标识消息的具体类型。
 * - `SignalingWebSocketHandler`: 根据此枚举的值来路由和处理消息。
 */
package club.ppmc.dto;

public enum MessageType {
    // 客户端行为
    REGISTER,       // 客户端使用用户ID进行注册
    PING,           // 客户端发送心跳以保持连接

    // WebRTC 信令
    SIGNAL,         // 用于封装所有WebRTC协商数据(offer, answer, candidates)的通用消息

    // 服务器响应
    PONG,           // 服务器对PING的心跳响应
    SUCCESS,        // 服务器发往客户端的通用成功消息
    ERROR,          // 服务器发往客户端的错误消息
    USER_NOT_FOUND, // 表示消息的目标用户未找到

    // [NEW] 联邦服务器间握手
    REGISTER_PEER   // 下游伙伴服务器连接成功后，向上游服务器注册自己
}