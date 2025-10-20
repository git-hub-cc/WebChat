package club.ppmc.dto;

/**
 * 代表一个来自联邦网络中某个节点的用户。
 * [MODIFIED] originServer 字段已重命名为 originServerGuid 以反映其真实含义。
 *
 * @param userId 用户的唯一ID。
 * @param originServerGuid 用户当前连接的服务器的持久化全局唯一ID (GUID)。
 */
public record FederatedUser(String userId, String originServerGuid) {}