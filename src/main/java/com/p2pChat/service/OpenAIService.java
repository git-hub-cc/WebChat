package com.p2pChat.service;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * 定义与OpenAI交互的服务接口。
 * 封装了聊天、摘要、上下文准备和缓存管理等核心功能。
 */
public interface OpenAIService {

    /**
     * 检查指定用户和角色是否存在可用的聊天历史。
     * @param user 用户标识
     * @param characterId 角色标识
     * @return 如果存在历史记录，则返回 true
     */
    boolean hasHistory(String user, String characterId);

    /**
     * 为常规聊天请求存储其请求体，用于未来的摘要。
     * @param requestBody 完整的聊天请求体
     */
    void storeLastRequest(String requestBody);

    /**
     * 基于用户和角色的历史记录，创建一个摘要流。
     * @param user 用户标识
     * @param characterId 角色标识
     * @return 返回一个包含摘要的事件流
     */
    Flux<String> getSummaryStream(String user, String characterId);

    /**
     * (基础聊天) 将常规聊天请求直接流式转发到OpenAI，并在此之前存储历史。
     * @param requestBody 完整的聊天请求体
     * @return 返回一个来自OpenAI的事件流
     */
    Flux<String> streamBaseChatCompletion(String requestBody);

    /**
     * 准备聊天上下文。
     * 1. 检查是否存在角色的今日事件和心情。
     * 2. 如果不存在，则调用AI生成并缓存。
     * 3. 将事件和心情更新到请求体的 system prompt 中。
     * @param originalRequestBody 原始的聊天请求体
     * @return 返回一个包含修改后请求体的 Mono<String>
     */
    Mono<String> prepareChatContext(String originalRequestBody);

    /**
     * 清除角色的事件和心情状态缓存。
     * 这个方法将被定时任务调用。
     */
    void clearCharacterStateCache();
}