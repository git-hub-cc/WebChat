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

public interface OpenAIService {

    /**
     * 将基础聊天请求流式转发到OpenAI。
     * @param requestBody 完整的聊天请求体JSON字符串。
     * @return 一个直接来自OpenAI的SSE事件流 (`Flux<String>`)。
     */
    Flux<String> streamBaseChatCompletion(String requestBody);
}