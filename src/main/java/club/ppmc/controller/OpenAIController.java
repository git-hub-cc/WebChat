/**
 * 此文件定义了与OpenAI聊天功能相关的API端点。
 *
 * 主要职责:
 * - 提供 `/api/v1/chat/completions` 端点，用于处理聊天请求，并流式返回AI响应。 [修改] 路径已更新
 *
 * 关联:
 * - `OpenAIService`: 核心业务逻辑的实现，由本Controller调用。
 */
package club.ppmc.controller;

import club.ppmc.service.OpenAIService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

@RestController
@RequestMapping("/api/v1/chat") // [修改] 统一API前缀
public class OpenAIController {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIController.class);

    private final OpenAIService openAIService;

    public OpenAIController(OpenAIService openAIService) {
        this.openAIService = openAIService;
    }

    /**
     * 聊天完成接口。
     * 此端点接收聊天请求，并直接将其流式转发给AI服务。
     * Endpoint: POST /api/v1/chat/completions
     *
     * @param rawBody 原始的JSON请求体字符串。
     * @return 一个Server-Sent Events (SSE) 事件流。
     */
    @PostMapping(value = "/completions", produces = MediaType.TEXT_EVENT_STREAM_VALUE) // [修改] 路径调整为相对路径
    public Flux<String> streamChatCompletion(@RequestBody String rawBody) {
        logger.info("接收到聊天请求: POST /api/v1/chat/completions，直接转发。"); // [修改] 更新日志中的路径
        // 直接将请求体传递给基础聊天服务
        return openAIService.streamBaseChatCompletion(rawBody);
    }
}