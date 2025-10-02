/**
 * [新文件]
 * 用于响应点赞/取消点赞操作的数据传输对象 (DTO)。
 */
package club.ppmc.dto;

public record CommentLikeResponse(
        long newLikeCount,
        boolean likedByCurrentUser
) {
}