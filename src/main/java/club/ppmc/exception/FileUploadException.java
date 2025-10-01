/**
 * [新文件]
 * 自定义运行时异常，专用于文件上传过程中发生的错误。
 * 这样可以在全局异常处理器中被精确捕获。
 */
package club.ppmc.exception;

public class FileUploadException extends RuntimeException {
    public FileUploadException(String message) {
        super(message);
    }

    public FileUploadException(String message, Throwable cause) {
        super(message, cause);
    }
}