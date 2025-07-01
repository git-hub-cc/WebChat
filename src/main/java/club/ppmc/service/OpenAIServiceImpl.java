/**
 * `OpenAIService`接口的实现类。
 *
 * 主要职责:
 * - 通过`WebClient`与外部AI API进行实际的HTTP通信。
 * - 管理一个OpenAI API密钥池：
 *   - 从`OpenaiApiProperties`初始化密钥列表。
 *   - 为每个API请求轮询选择一个API密钥。
 *   - 在API调用失败（如401、429错误）时，从池中移除相应的密钥。
 * - 在内存中使用`ConcurrentHashMap`管理角色每日状态（事件/心情）的缓存。
 * - 实现聊天、上下文准备和缓存清理等核心业务逻辑。
 *
 * 关联:
 * - `OpenAIService`: 实现此接口。
 * - `OpenAIConfig`: 从中注入`WebClient`和各种配置字符串（如提示词、模型名称）。
 * - `OpenaiApiProperties`: 注入此配置类以获取API密钥列表。
 * - `CacheManagerTask`: 调用本服务中的`clearCharacterStateCache`方法。
 */
package club.ppmc.service;

import club.ppmc.config.OpenaiApiProperties; // 新增导入
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue; // 新增导入
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders; // 新增导入
import org.springframework.http.HttpStatus; // 新增导入
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Service
public class OpenAIServiceImpl implements OpenAIService {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIServiceImpl.class);
    private static final TypeReference<Map<String, Object>> MAP_TYPE_REFERENCE = new TypeReference<>() {};
    private static final String API_URI = "/chat/completions";
    private static final String BEARER_PREFIX = "Bearer "; // 新增常量

    // 使用内部记录类来增强类型安全性和代码可读性
    private record EventMood(String event, String mood) {}
    private record ChatPayload(String user, String character_id, List<Map<String, Object>> messages) {}

    // 缓存: 存储 "character_id" -> EventMood 的今日状态
    private final Map<String, EventMood> characterStateStore = new ConcurrentHashMap<>();

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final String eventMoodPrompt;
    private final String model;
    private final ConcurrentLinkedQueue<String> activeApiKeys; // API密钥池

    // 自定义异常类，用于表示密钥池耗尽
    private static class OpenaiKeyPoolExhaustedException extends RuntimeException {
        public OpenaiKeyPoolExhaustedException(String message) {
            super(message);
        }
    }

    // 自定义异常类，用于表示OpenAI API调用相关的错误
    private static class OpenaiApiException extends RuntimeException {
        private final HttpStatusCode statusCode;
        public OpenaiApiException(String message, HttpStatusCode statusCode) {
            super(message);
            this.statusCode = statusCode;
        }
        public HttpStatusCode getStatusCode() {
            return statusCode;
        }
    }


    public OpenAIServiceImpl(
            @Qualifier("openaiWebClient") WebClient webClient,
            @Qualifier("eventMoodPrompt") String eventMoodPrompt,
            @Qualifier("model") String model,
            ObjectMapper objectMapper,
            OpenaiApiProperties openaiApiProperties) { // 注入OpenaiApiProperties
        this.webClient = webClient;
        this.eventMoodPrompt = eventMoodPrompt;
        this.model = model;
        this.objectMapper = objectMapper;

        if (openaiApiProperties.api_keys() == null || openaiApiProperties.api_keys().isEmpty()) {
            logger.warn("OpenAI API密钥池未配置或为空，所有API调用可能会失败。");
            this.activeApiKeys = new ConcurrentLinkedQueue<>();
        } else {
            this.activeApiKeys = new ConcurrentLinkedQueue<>(openaiApiProperties.api_keys());
            logger.info("OpenAIService已初始化，激活的API密钥池大小: {}", this.activeApiKeys.size());
        }
    }

    /**
     * 从密钥池中选择一个API密钥并轮转。
     * @return 可用的API密钥。
     * @throws OpenaiKeyPoolExhaustedException 如果密钥池已空。
     */
    private String selectAndRotateApiKey() {
        if (activeApiKeys.isEmpty()) {
            // 此处日志级别为error，因为这是服务无法继续操作的严重问题
            logger.error("OpenAI API密钥池已空，无法选择密钥。");
            throw new OpenaiKeyPoolExhaustedException("没有可用的OpenAI API密钥。");
        }
        String apiKey = activeApiKeys.poll(); // 从队列头部获取一个密钥
        if (apiKey != null) {
            activeApiKeys.offer(apiKey); // 将密钥放回队列尾部，实现轮询
            return apiKey;
        }
        //理论上，如果isEmpty为false，poll不应返回null，但作为防御性编程
        logger.error("在轮询API密钥时发生意外：activeApiKeys.poll()返回null，尽管池不应为空。");
        throw new OpenaiKeyPoolExhaustedException("获取OpenAI API密钥失败，密钥池可能存在并发问题。");
    }

    /**
     * 使指定的API密钥失效并从活动池中移除。
     * @param apiKey 要移除的API密钥。
     * @param reason 移除原因。
     */
    private void invalidateAndRemoveApiKey(String apiKey, String reason) {
        boolean removed = activeApiKeys.remove(apiKey); // 从队列中移除指定的密钥
        if (removed) {
            // 用户要求：若调用失败将key从配置池中移除，并且打印信息在控制台info级别
            logger.info("OpenAI API密钥 '{}' 调用失败 (原因: {}), 已从可用密钥池中移除。剩余可用密钥数: {}",
                    maskApiKey(apiKey), reason, activeApiKeys.size());
        } else {
            logger.warn("尝试移除API密钥 '{}' (原因: {}), 但它已不在活动密钥池中 (可能已被其他线程并发移除)。",
                    maskApiKey(apiKey), reason);
        }
    }

    /**
     * 对API密钥进行脱敏处理，用于日志输出。
     * @param apiKey 原始API密钥。
     * @return 脱敏后的API密钥字符串。
     */
    private String maskApiKey(String apiKey) {
        if (apiKey == null || apiKey.length() < 8) {
            return "****"; // 如果密钥过短或为null，返回固定掩码
        }
        return apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
    }


    @Override
    public Mono<String> prepareChatContext(String originalRequestBody) {
        try {
            var payload = objectMapper.readValue(originalRequestBody, ChatPayload.class);
            if (payload.character_id() == null) {
                logger.warn("请求体中缺少 'character_id'，跳过事件/心情生成。");
                return Mono.just(originalRequestBody);
            }

            return getOrCreateEventMood(payload)
                    .flatMap(eventMood -> {
                        try {
                            var bodyMap = objectMapper.readValue(originalRequestBody, MAP_TYPE_REFERENCE);
                            var modifiedBody = updateSystemPrompt(bodyMap, eventMood);
                            logger.info("成功为角色 '{}' 更新系统提示。", payload.character_id());
                            return Mono.just(modifiedBody);
                        } catch (JsonProcessingException e) {
                            logger.error("更新系统提示后重新序列化请求体失败。", e);
                            return Mono.just(originalRequestBody);
                        }
                    })
                    .defaultIfEmpty(originalRequestBody)
                    .onErrorReturn(originalRequestBody); // 如果上游为空或错误，返回原始请求体
        } catch (JsonProcessingException e) {
            logger.warn("解析请求体以准备上下文时失败，将返回原始请求体。", e);
            return Mono.just(originalRequestBody);
        }
    }

    @Override
    public Flux<String> streamBaseChatCompletion(String requestBody) {
        logger.info("处理基础聊天完成请求。");
        return performOpenAIStreamRequest(requestBody, API_URI);
    }

    @Override
    public void clearCharacterStateCache() {
        if (!characterStateStore.isEmpty()) {
            int sizeBefore = characterStateStore.size();
            characterStateStore.clear();
            logger.info("角色状态缓存已清空，移除了 {} 个条目。", sizeBefore);
        } else {
            logger.info("角色状态缓存已为空，无需操作。");
        }
    }

    private Mono<EventMood> getOrCreateEventMood(ChatPayload payload) {
        var existingState = characterStateStore.get(payload.character_id());
        if (existingState != null) {
            logger.info("为角色 '{}' 找到已缓存的事件/心情，直接使用。", payload.character_id());
            return Mono.just(existingState);
        }

        logger.info("角色 '{}' 的当日事件/心情不存在，开始生成...", payload.character_id());
        return generateEventAndMood(payload)
                .doOnSuccess(newState -> {
                    if (newState != null) {
                        characterStateStore.put(payload.character_id(), newState);
                        logger.info("已为角色 '{}' 生成并缓存新的事件/心情。", payload.character_id());
                    }
                });
    }

    private Mono<EventMood> generateEventAndMood(ChatPayload payload) {
        try {
            if (payload.messages() == null || payload.messages().isEmpty() || !"system".equals(payload.messages().get(0).get("role"))) {
                logger.warn("无法生成事件/心情：'messages'数组缺失、为空或首条消息非system角色。");
                return Mono.empty();
            }
            var characterSettings = (String) payload.messages().get(0).get("content");
            var promptContent = String.format(eventMoodPrompt, characterSettings);

            var systemMessage = Map.of("role", "system", "content", promptContent);
            var requestPayload = Map.of(
                    "model", this.model,
                    "messages", List.of(systemMessage),
                    "response_format", Map.of("type", "json_object")
            );

            var requestBody = objectMapper.writeValueAsString(requestPayload);
            // 事件/心情生成也需要通过密钥池认证
            return performOpenAINonStreamRequest(requestBody, API_URI)
                    .flatMap(this::parseEventMoodFromResponse);
        } catch (JsonProcessingException e) {
            logger.error("创建事件/心情生成请求体时失败。", e);
            return Mono.empty();
        }
    }

    private Mono<EventMood> parseEventMoodFromResponse(String responseBody) {
        try {
            var responseMap = objectMapper.readValue(responseBody, MAP_TYPE_REFERENCE);
            @SuppressWarnings("unchecked") // choices的类型已知
            var choices = (List<Map<String, Object>>) responseMap.get("choices");
            if (choices == null || choices.isEmpty()) {
                logger.error("从OpenAI响应中解析事件/心情失败: 'choices' 字段为空或不存在。响应: {}", responseBody);
                return Mono.empty();
            }
            var message = (Map<String, Object>) choices.get(0).get("message");
            if (message == null) {
                logger.error("从OpenAI响应中解析事件/心情失败: 'message' 字段为空或不存在。响应: {}", responseBody);
                return Mono.empty();
            }
            var content = (String) message.get("content");
            if (content == null) {
                logger.error("从OpenAI响应中解析事件/心情失败: 'content' 字段为空或不存在。响应: {}", responseBody);
                return Mono.empty();
            }
            return Mono.just(objectMapper.readValue(content, EventMood.class));
        } catch (Exception e) {
            logger.error("从OpenAI响应中解析事件/心情失败: {}", responseBody, e);
            return Mono.empty();
        }
    }

    @SuppressWarnings("unchecked")
    private String updateSystemPrompt(Map<String, Object> bodyMap, EventMood eventMood) throws JsonProcessingException {
        var messages = (List<Map<String, Object>>) bodyMap.get("messages");
        if (messages == null || messages.isEmpty()) return objectMapper.writeValueAsString(bodyMap);

        var systemMessage = messages.get(0); // 假设第一条是系统消息
        var originalContent = (String) systemMessage.get("content");

        // 使用Text Block来格式化新的系统提示，可读性更强
        var newContent = """
                今天发生了一件小事：%s。这让我的心情有点%s。
                
                %s
                """.formatted(eventMood.event(), eventMood.mood(), originalContent);

        systemMessage.put("content", newContent);
        return objectMapper.writeValueAsString(bodyMap);
    }

    private Flux<String> performOpenAIStreamRequest(String requestBody, String uri) {
        final String currentApiKey;
        try {
            currentApiKey = selectAndRotateApiKey();
        } catch (OpenaiKeyPoolExhaustedException e) {
            logger.error("无法执行流式OpenAI请求 (URI: {}), 因为API密钥池已空。", uri, e);
            return Flux.error(e);
        }

        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, BEARER_PREFIX + currentApiKey) // 动态添加认证头
                .body(BodyInserters.fromValue(requestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse ->
                        clientResponse.bodyToMono(String.class)
                                .flatMap(errorBody -> {
                                    String logMessage = String.format(
                                            "OpenAI流式API调用失败: Status=%s, URI=%s, Key=%s, Body=%s",
                                            clientResponse.statusCode(), uri, maskApiKey(currentApiKey), errorBody);
                                    logger.error(logMessage);

                                    boolean keyInvalidated = false;
                                    // 检查特定错误码以决定是否移除密钥
                                    if (clientResponse.statusCode().isSameCodeAs(HttpStatus.UNAUTHORIZED) ||
                                            clientResponse.statusCode().isSameCodeAs(HttpStatus.FORBIDDEN)) {
                                        invalidateAndRemoveApiKey(currentApiKey, "授权问题 (" + clientResponse.statusCode() + ")");
                                        keyInvalidated = true;
                                    } else if (clientResponse.statusCode().isSameCodeAs(HttpStatus.TOO_MANY_REQUESTS)) {
                                        // **[MODIFIED]** 根据新要求，当收到429 (Too Many Requests) 错误时，不再移除API密钥
                                        logger.warn("OpenAI API密钥 '{}' 遭遇 429 (Too Many Requests). 根据策略，密钥将不会被移除。", maskApiKey(currentApiKey));
                                        // keyInvalidated 保持 false
                                    }

                                    String errorMessage = "OpenAI API Error: " + errorBody;
                                    if (keyInvalidated) {
                                        errorMessage += " (API Key " + maskApiKey(currentApiKey) + " was invalidated and removed from pool)";
                                    }
                                    return Mono.error(new OpenaiApiException(errorMessage, clientResponse.statusCode()));
                                })
                )
                .bodyToFlux(String.class)
                .doOnSubscribe(s -> logger.info("已订阅OpenAI流: {}, 使用Key: {}", uri, maskApiKey(currentApiKey)))
                .doOnError(e -> {
                    if (!(e instanceof OpenaiKeyPoolExhaustedException || e instanceof OpenaiApiException)) {
                        logger.error("处理OpenAI流时发生未知错误 (URI: {}, Key: {}): {}", uri, maskApiKey(currentApiKey), e.getMessage(), e);
                    } else if (e instanceof OpenaiApiException) {
                        // OpenaiApiException already logged in onStatus, this is just for context
                        logger.warn("OpenAI流处理因API异常终止 (URI: {}, Key: {}): {}", uri, maskApiKey(currentApiKey), e.getMessage());
                    }
                    // OpenaiKeyPoolExhaustedException is logged when thrown
                })
                .doOnComplete(() -> logger.info("OpenAI流处理完成: {}, Key: {}", uri, maskApiKey(currentApiKey)));
    }

    private Mono<String> performOpenAINonStreamRequest(String requestBody, String uri) {
        final String currentApiKey;
        try {
            currentApiKey = selectAndRotateApiKey();
        } catch (OpenaiKeyPoolExhaustedException e) {
            logger.error("无法执行非流式OpenAI请求 (URI: {}), 因为API密钥池已空。", uri, e);
            return Mono.error(e);
        }

        return webClient.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, BEARER_PREFIX + currentApiKey) // 动态添加认证头
                .body(BodyInserters.fromValue(requestBody))
                .retrieve()
                .onStatus(HttpStatusCode::isError, clientResponse ->
                        clientResponse.bodyToMono(String.class)
                                .flatMap(errorBody -> {
                                    String logMessage = String.format(
                                            "OpenAI非流式API调用失败: Status=%s, URI=%s, Key=%s, Body=%s",
                                            clientResponse.statusCode(), uri, maskApiKey(currentApiKey), errorBody);
                                    logger.error(logMessage);

                                    boolean keyInvalidated = false;
                                    if (clientResponse.statusCode().isSameCodeAs(HttpStatus.UNAUTHORIZED) ||
                                            clientResponse.statusCode().isSameCodeAs(HttpStatus.FORBIDDEN)) {
                                        invalidateAndRemoveApiKey(currentApiKey, "授权问题 (" + clientResponse.statusCode() + ")");
                                        keyInvalidated = true;
                                    } else if (clientResponse.statusCode().isSameCodeAs(HttpStatus.TOO_MANY_REQUESTS)) {
                                        // **[MODIFIED]** 根据新要求，当收到429 (Too Many Requests) 错误时，不再移除API密钥
                                        logger.warn("OpenAI API密钥 '{}' 遭遇 429 (Too Many Requests). 根据策略，密钥将不会被移除。", maskApiKey(currentApiKey));
                                        // keyInvalidated 保持 false
                                    }

                                    String errorMessage = "OpenAI API Error: " + errorBody;
                                    if (keyInvalidated) {
                                        errorMessage += " (API Key " + maskApiKey(currentApiKey) + " was invalidated and removed from pool)";
                                    }
                                    return Mono.error(new OpenaiApiException(errorMessage, clientResponse.statusCode()));
                                })
                )
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(30)) // 设置超时以防请求挂起
                .doOnSubscribe(s -> logger.info("发送非流式请求到OpenAI: {}, 使用Key: {}", uri, maskApiKey(currentApiKey)))
                .doOnError(e -> {
                    if (!(e instanceof OpenaiKeyPoolExhaustedException || e instanceof OpenaiApiException)) {
                        logger.error("OpenAI非流式请求发生未知错误 (URI: {}, Key: {}): {}", uri, maskApiKey(currentApiKey), e.getMessage(), e);
                    } else if (e instanceof OpenaiApiException) {
                        logger.warn("OpenAI非流式请求因API异常终止 (URI: {}, Key: {}): {}", uri, maskApiKey(currentApiKey), e.getMessage());
                    }
                })
                .doOnSuccess(response -> logger.info("OpenAI非流式请求成功: {}, Key: {}", uri, maskApiKey(currentApiKey)));
    }
}