/**
 * 此文件定义了用于发起对话摘要请求的数据传输对象(DTO)。
 *
 * 使用JDK 17的`record`类型实现，简洁且不可变。
 *
 * 关联:
 * - `OpenAIController`: 在其门面端点中创建此对象，并作为请求体发送到摘要工作端点。
 * - `OpenAIService`: 接收此对象以执行摘要逻辑。
 */
package club.ppmc.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SummarizeRequest(
        String user,
        @JsonProperty("character_id") String characterId
) {}