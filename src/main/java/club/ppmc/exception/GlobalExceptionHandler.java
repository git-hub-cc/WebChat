/**
 * [修改]
 * 增加了对 ResourceNotFoundException 的处理，返回 HTTP 404 状态码。
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
     * [新增] 处理资源未找到的异常。
     * @param ex ResourceNotFoundException 实例。
     * @return 返回一个 HTTP 404 (Not Found) 响应，包含错误信息。
     */
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleResourceNotFoundException(ResourceNotFoundException ex) {
        logger.warn("请求的资源未找到: {}", ex.getMessage());
        Map<String, String> errorResponse = Map.of(
                "error", "Resource Not Found",
                "message", ex.getMessage()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.NOT_FOUND);
    }

    @ExceptionHandler(FileUploadException.class)
    public ResponseEntity<Map<String, String>> handleFileUploadException(FileUploadException ex) {
        logger.error("文件上传失败: {}", ex.getMessage(), ex);
        Map<String, String> errorResponse = Map.of(
                "error", "File Upload Failed",
                "message", ex.getMessage()
        );
        return new ResponseEntity<>(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }

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