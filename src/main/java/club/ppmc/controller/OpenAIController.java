/**
 * 此文件定义了与OpenAI聊天功能相关的API端点。
 *
 * 主要职责:
 * - 提供一个`/v1/chat/completions`门面(Facade)端点，作为客户端的主要入口。
 * - 该门面端点会智能地根据请求内容和对话历史，将请求路由到内部的“基础聊天”或“摘要生成”逻辑。
 * - 这种设计简化了客户端的逻辑，客户端无需关心何时需要生成摘要。
 *
 * 关联:
 * - `OpenAIService`: 核心业务逻辑的实现，由本Controller调用。
 * - `SummarizeRequest`: 用于发起摘要请求的DTO。
 */
package club.ppmc.controller;

import club.ppmc.dto.SummarizeRequest;
import club.ppmc.service.OpenAIService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

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
    private final ObjectMapper objectMapper;

    // 为门面端点内部检查逻辑定义一个私有、轻量级的记录类，以增强类型安全
    private record ChatInspectionPayload(String user, String character_id, List<?> messages) {}

    public OpenAIController(OpenAIService openAIService, ObjectMapper objectMapper) {
        this.openAIService = openAIService;
        this.objectMapper = objectMapper;
    }

    /**
     * 聊天完成接口的门面(Facade)端点。
     * 接收所有聊天请求，并根据上下文智能路由。
     *
     * @param rawBody 原始的JSON请求体字符串。
     * @return 一个Server-Sent Events (SSE) 事件流。
     */
    @PostMapping(value = "/chat/completions", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> generateStreamFacade(@RequestBody String rawBody) {
        logger.info("接收到门面端点请求: POST /v1/chat/completions");

        // 步骤1: 准备聊天上下文，可能会注入今日事件和心情。
        var modifiedBody = openAIService.prepareChatContext(rawBody).block();
        if (modifiedBody == null) {
            modifiedBody = rawBody; // 如果准备失败，则使用原始body
        }

        // 步骤2: 智能路由决策
        try {
            var inspectionPayload = objectMapper.readValue(modifiedBody, ChatInspectionPayload.class);

            // 如果是新对话（通常包含两条消息：system和user）且存在历史记录，则触发摘要逻辑。
            if (inspectionPayload.messages() != null
                    && inspectionPayload.messages().size() == 2
                    && openAIService.hasHistory(
                    inspectionPayload.user(), inspectionPayload.character_id())) {

                logger.info(
                        "Facade: 满足摘要条件。为用户 '{}' 路由到摘要逻辑。", inspectionPayload.user());
                var summarizeRequest = new SummarizeRequest(
                        inspectionPayload.user(), inspectionPayload.character_id());
                return this.summarizeConversation(summarizeRequest);
            }
        } catch (JsonProcessingException e) {
            logger.warn(
                    "Facade: 解析请求体以进行路由决策时失败，将默认执行基础聊天。错误: {}", e.getMessage());
            // 如果解析失败，直接将修改后的body转发到基础聊天，以保证服务可用性。
            return this.streamBaseChatCompletion(modifiedBody);
        }

        logger.info("Facade: 路由到基础聊天逻辑。");
        return this.streamBaseChatCompletion(modifiedBody);
    }

    // -----------------------------------------------------
    // 内部工作端点 (Internal Worker Endpoints)
    // -----------------------------------------------------

    /**
     * 处理基础聊天完成请求的内部工作端点。
     */
    private Flux<String> streamBaseChatCompletion(String body) {
        logger.debug("Worker: 接收到基础聊天请求。");
        return openAIService.streamBaseChatCompletion(body);
    }

    /**
     * 处理对话摘要请求的内部工作端点。
     */
    private Flux<String> summarizeConversation(SummarizeRequest request) {
        logger.info(
                "Worker: 接收到摘要请求，用户: '{}', 角色: '{}'",
                request.user(),
                request.characterId());
        var summaryStatusEvent = "data: {\"status\":\"summary\"}\n\n";
        var summaryStream = openAIService.getSummaryStream(request.user(), request.characterId());
        // 先发送一个状态事件，告诉客户端正在进行摘要
        return Flux.just(summaryStatusEvent).concatWith(summaryStream);
    }
}