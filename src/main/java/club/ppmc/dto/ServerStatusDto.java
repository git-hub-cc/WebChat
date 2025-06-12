/**
 * 此文件定义了用于表示服务器状态的数据传输对象(DTO)。
 *
 * 使用JDK 17的`record`类型，提供了简洁、不可变的数据结构。
 * 替代了在Controller中直接使用`Map<String, Object>`，增强了代码的类型安全性和可读性。
 *
 * 关联:
 * - `MonitorController`: 使用此DTO作为其`/api/monitor/status`端点的响应体。
 */
package club.ppmc.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServerStatusDto(
        int onlineUsers,
        long serverTime,
        String status,
        String errorMessage) {

    /**
     * 创建一个表示成功状态的DTO实例。
     * @param onlineUsers 当前在线用户数。
     * @param serverTime 当前服务器时间戳。
     * @return 代表成功的`ServerStatusDto`对象。
     */
    public static ServerStatusDto success(int onlineUsers, long serverTime) {
        return new ServerStatusDto(onlineUsers, serverTime, "运行中", null);
    }

    /**
     * 创建一个表示错误状态的DTO实例。
     * @param message 错误信息。
     * @return 代表错误的`ServerStatusDto`对象。
     */
    public static ServerStatusDto error(String message) {
        return new ServerStatusDto(-1, System.currentTimeMillis(), "错误", message);
    }
}