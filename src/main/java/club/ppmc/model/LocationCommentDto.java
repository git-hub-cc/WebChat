/**
 * [新文件]
 * 用于API响应的评论数据传输对象 (DTO)。
 * 包含了前端需要的所有信息，包括点赞数和当前用户是否已点赞。
 */
package club.ppmc.dto;

import java.time.LocalDateTime;

public record LocationCommentDto(
        Long id,
        String content,
        String userId,
        LocalDateTime createdAt,
        long likeCount,
        boolean likedByCurrentUser
) {
}