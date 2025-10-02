/**
 * [新文件]
 * 用于接收创建新评论请求的数据传输对象 (DTO)。
 */
package club.ppmc.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CommentRequest(
        @NotBlank
        @Size(max = 1000)
        String content,

        @NotNull
        String userId // 生产环境警告：应从认证信息中获取
) {
}