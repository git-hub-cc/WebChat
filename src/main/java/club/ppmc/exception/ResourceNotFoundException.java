/**
 * [新文件]
 * 自定义运行时异常，当请求的资源（如地点、评论）未找到时抛出。
 * 将被 GlobalExceptionHandler 捕获并转换为 HTTP 404 响应。
 */
package club.ppmc.exception;

public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) {
        super(message);
    }
}