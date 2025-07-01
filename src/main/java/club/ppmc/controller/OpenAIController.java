/**
 * 此文件定义了与OpenAI聊天功能相关的API端点。
 *
 * 主要职责:
 * - 提供 `/v1/chat/completions` 端点，用于处理标准聊天请求。它会先准备上下文（如注入角色心情），然后流式返回AI响应。
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
@RequestMapping("/v1")
public class OpenAIController {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIController.class);

    private final OpenAIService openAIService;

    // 移除了对ObjectMapper的直接依赖，因为控制器不再需要手动解析JSON。
    public OpenAIController(OpenAIService openAIService) {
        this.openAIService = openAIService;
    }

    /**
     * 聊天完成接口。
     * 此端点接收聊天请求，准备上下文（如注入角色心情），然后流式返回AI的响应。
     *
     * @param rawBody 原始的JSON请求体字符串。
     * @return 一个Server-Sent Events (SSE) 事件流。
     */
    @PostMapping(value = "/chat/completions", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamChatCompletion(@RequestBody String rawBody) {
        logger.info("接收到聊天请求: POST /v1/chat/completions");

        // 步骤1: 准备聊天上下文，可能会注入今日事件和心情。
        // 使用响应式链，避免阻塞，并将准备好的上下文直接传递给聊天服务。
        return openAIService.prepareChatContext(rawBody)
                .flatMapMany(modifiedBody -> {
                    logger.info("上下文准备完毕，开始执行基础聊天逻辑。");
                    return openAIService.streamBaseChatCompletion(modifiedBody);
                });
    }
}