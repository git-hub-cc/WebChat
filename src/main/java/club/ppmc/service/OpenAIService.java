/**
 * 此接口定义了与OpenAI服务交互的核心业务逻辑。
 *
 * 它抽象了所有与AI模型相关的操作，为Controller层提供了一个清晰、稳定的服务契约。
 *
 * 关联:
 * - `OpenAIServiceImpl`: 此接口的具体实现。
 * - `OpenAIController`: 调用此接口中定义的方法来处理API请求。
 */
package club.ppmc.service;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

public interface OpenAIService {

    /**
     * 检查指定用户和角色的组合是否存在对话历史。
     * @param user 用户标识。
     * @param characterId 角色标识。
     * @return 如果存在历史记录，则返回`true`，否则返回`false`。
     */
    boolean hasHistory(String user, String characterId);

    /**
     * 基于用户和角色的对话历史，生成并返回一个摘要流。
     * @param user 用户标识。
     * @param characterId 角色标识。
     * @return 一个包含摘要内容的SSE事件流 (`Flux<String>`)。
     */
    Flux<String> getSummaryStream(String user, String characterId);

    /**
     * 将基础聊天请求流式转发到OpenAI，并在转发前处理历史记录存储。
     * @param requestBody 完整的聊天请求体JSON字符串。
     * @return 一个直接来自OpenAI的SSE事件流 (`Flux<String>`)。
     */
    Flux<String> streamBaseChatCompletion(String requestBody);

    /**
     * 准备聊天上下文。此方法是实现动态角色行为的关键。
     * 它会检查并按需生成角色的“今日事件”和“心情”，然后将其注入到请求的系统提示中。
     * @param originalRequestBody 原始的聊天请求体JSON字符串。
     * @return 一个`Mono<String>`，异步返回修改后的请求体JSON字符串。
     */
    Mono<String> prepareChatContext(String originalRequestBody);

    /**
     * 清除所有角色的事件和心情状态缓存。
     * 此方法设计为由定时任务调用，以实现每日状态的刷新。
     */
    void clearCharacterStateCache();
}