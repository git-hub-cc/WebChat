/**
 * [新文件]
 * 全局异常处理器，使用 @RestControllerAdvice 注解。
 * 它可以捕获Controller层抛出的特定异常，并返回统一格式的HTTP错误响应。
 */
package club.ppmc.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * 处理文件上传相关的异常。
     * @param ex FileUploadException 实例。
     * @return 返回一个 HTTP 500 (Internal Server Error) 响应，包含错误信息。
     */
    @ExceptionHandler(FileUploadException.class)
    public ResponseEntity<Map<String, String>> handleFileUploadException(FileUploadException ex) {
        logger.error("文件上传失败: {}", ex.getMessage(), ex);
        Map<String, String> errorResponse = Map.of(
                "error", "File Upload Failed",
                "message", ex.getMessage()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    /**
     * 兜底处理器，捕获所有其他未处理的异常。
     * @param ex Exception 实例。
     * @return 返回一个通用的 HTTP 500 响应。
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGenericException(Exception ex) {
        logger.error("发生未捕获的服务器内部错误: {}", ex.getMessage(), ex);
        Map<String, String> errorResponse = Map.of(
                "error", "Internal Server Error",
                "message", "服务器发生未知错误，请联系管理员。"
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}