/**
 * 此文件定义了一个用于存储客户端速率限制信息的数据记录。
 *
 * 使用JDK 17的`record`类型，使其成为一个简洁、不可变的数据载体。
 *
 * 关联:
 * - `RateLimitInterceptor`: 使用此记录类来在内存中跟踪每个客户端的请求计数。
 */
package club.ppmc.model;

import java.time.LocalDate;

public record RateLimitInfo(int count, LocalDate date) {}