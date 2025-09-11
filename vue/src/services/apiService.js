import { useUserStore } from '@/stores/userStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGroupStore } from '@/stores/groupStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { eventBus } from './eventBus';
import { log, fetchApiStream } from '@/utils';
import AppSettings from '@/config/AppSettings';
import { MCP_TOOLS } from '@/config/McpTools';

/**
 * @file apiService.js
 * @description (Vue Refactor) 封装所有与外部 API 的交互逻辑，
 *              包括 AI 对话、TTS 合成、工具调用 (MCP) 和记忆提取。
 */

// 辅助函数：从 Pinia store 获取当前生效的 API 配置
function _getEffectiveAiConfig() {
    const settingsStore = useSettingsStore();
    return {
        apiEndpoint: settingsStore.apiSettings?.apiEndpoint || AppSettings.server.apiEndpoint,
        model: settingsStore.apiSettings?.model || AppSettings.server.model,
        apiKey: settingsStore.apiSettings?.apiKey || AppSettings.server.api_key,
        maxTokens: settingsStore.apiSettings?.maxTokens || AppSettings.server.max_tokens,
        ttsApiEndpoint: settingsStore.apiSettings?.ttsApiEndpoint || AppSettings.server.ttsApiEndpoint
    };
}

// 辅助函数：为 MCP 分析请求构建提示
function _buildMcpAnalysisPrompt(chatHistory, userMessage) {
    const messages = [];
    let mcpSystemPrompt = "你是一个能够理解并使用工具的智能助手。\n";
    mcpSystemPrompt += "可用的工具列表如下 (JSON格式):\n```json\n" + JSON.stringify(Object.values(MCP_TOOLS).map(({ name, description, parameters }) => ({ name, description, parameters })), null, 2) + "\n```\n";
    mcpSystemPrompt += "根据用户的提问，如果可以使用工具，你必须只回复一个JSON对象，格式如下: {\"tool_call\": {\"name\": \"工具名称\", \"arguments\": {\"参数1\": \"值1\"}}}. 不要添加任何其他解释或文本。\n";
    mcpSystemPrompt += "如果任何工具都不适用，或者你需要用户提供更多信息，请像平常一样自然地回复用户，不要提及工具。";

    messages.push({ role: "system", content: mcpSystemPrompt });
    messages.push(...chatHistory); // chatHistory should already be in { role, content } format
    messages.push({ role: "user", content: userMessage });
    return messages;
}

// 辅助函数：为 MCP 最终回复构建提示
function _buildMcpFinalPrompt(baseSystemPrompt, originalUserMessage, toolCall, toolResult) {
    const messages = [];
    messages.push({ role: "system", content: baseSystemPrompt });
    const combinedPrompt = `${originalUserMessage}\n\n[系统提示：你已调用工具“${toolCall.name}”并获得以下结果，请基于此结果，用自然语言回复用户。]\n工具结果: ${toolResult}`;
    messages.push({ role: "user", content: combinedPrompt });
    return messages;
}


// 辅助函数：执行 MCP 工具调用
async function _executeMcpTool(toolName, args) {
    const toolDef = MCP_TOOLS[toolName];
    if (!toolDef) return { error: `未知的工具: ${toolName}` };
    let url = toolDef.url_template;
    for (const key in args) {
        url = url.replace(`{${key}}`, encodeURIComponent(args[key]));
    }
    log(`MCP: 正在执行工具 "${toolName}"，请求URL: ${url}`, 'INFO');
    try {
        const response = await fetch(url);
        if (!response.ok) return { error: `工具API请求失败: ${response.status}` };
        const data = await response.text();
        return { data };
    } catch (e) {
        return { error: `网络请求失败: ${e.message}` };
    }
}


export const apiService = {
    /**
     * 向单个 AI 发送消息并处理响应。
     * @param {string} targetId - AI 联系人 ID。
     * @param {object} contact - AI 联系人对象。
     * @param {string} messageText - 用户消息。
     * @param {Array<object>} fullChatHistory - 完整聊天历史。
     */
    async sendAiMessage(targetId, contact, messageText, fullChatHistory = []) {
        const chatStore = useChatStore();
        const userStore = useUserStore();
        const memoryStore = useMemoryStore();
        const effectiveConfig = _getEffectiveAiConfig();

        if (!effectiveConfig.apiEndpoint) {
            throw new Error("AI API 端点未配置。");
        }

        const thinkingMessageId = `ai_thinking_${Date.now()}`;
        eventBus.emit('ai:thinking', {
            chatId: targetId,
            message: { id: thinkingMessageId, type: 'system', content: '思考中...', sender: targetId }
        });

        try {
            const formattedChatHistory = fullChatHistory
                .filter(msg => msg.type === 'text' && msg.content && typeof msg.content === 'string')
                .map(msg => ({
                    role: (msg.sender === userStore.userId) ? 'user' : 'assistant',
                    content: msg.content
                }));

            // 构建 System Prompt
            let systemPrompt = contact.aiConfig?.systemPrompt || "You are a helpful assistant.";
            const memoryContent = memoryStore.getEnabledMemoryForChat(targetId);
            if (memoryContent) {
                systemPrompt = `[背景记忆]\n${memoryContent}\n\n[角色设定]\n${systemPrompt}`;
            }
            const selectedChapterId = contact.selectedChapterId;
            if (selectedChapterId && contact.chapters) {
                const chapter = contact.chapters.find(c => c.id === selectedChapterId);
                if (chapter?.promptModifier) {
                    systemPrompt += `\n\n[当前篇章: ${chapter.name}]\n${chapter.promptModifier}`;
                }
            }
            systemPrompt += AppSettings.ai.promptSuffix;

            const messagesForRequestBody = [
                { role: "system", content: systemPrompt },
                ...formattedChatHistory,
                { role: "user", content: messageText }
            ];

            const requestBody = {
                model: effectiveConfig.model,
                messages: messagesForRequestBody,
                stream: true,
                max_tokens: effectiveConfig.maxTokens
            };

            const headers = { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey };
            const aiMessageId = `ai_stream_${Date.now()}`;
            let fullResponseContent = "";

            eventBus.emit('ai:clear_thinking', { chatId: targetId, thinkingId: thinkingMessageId });

            const initialAiMessage = {
                id: aiMessageId, type: 'text', content: "▍", sender: targetId,
                timestamp: new Date().toISOString(), isStreaming: true,
            };
            eventBus.emit('ai:streaming_start', { chatId: targetId, message: initialAiMessage });

            await fetchApiStream(
                effectiveConfig.apiEndpoint, requestBody, headers,
                (jsonChunk) => { // onChunkReceived
                    const chunkContent = jsonChunk.choices[0]?.delta?.content;
                    if (chunkContent) {
                        fullResponseContent += chunkContent;
                        eventBus.emit('ai:streaming_chunk', {
                            chatId: targetId, messageId: aiMessageId, content: fullResponseContent + "▍"
                        });
                    }
                },
                async () => { // onStreamEnd
                    eventBus.emit('ai:streaming_end', { chatId: targetId, messageId: aiMessageId });
                    const finalAiMessage = {
                        id: aiMessageId, type: 'text', content: fullResponseContent, sender: targetId,
                        timestamp: initialAiMessage.timestamp, isNewlyCompletedAIResponse: true,
                    };
                    await chatStore.addMessage(targetId, finalAiMessage);
                }
            );

        } catch (error) {
            log(`与 AI 通信时出错: ${error}`, 'ERROR');
            eventBus.emit('ai:clear_thinking', { chatId: targetId, thinkingId: thinkingMessageId });
            const errorMessage = {
                id: `ai_error_${Date.now()}`, type: 'text', content: `抱歉，我遇到了一个错误: ${error.message}`,
                sender: targetId, timestamp: new Date().toISOString()
            };
            await chatStore.addMessage(targetId, errorMessage);
        }
    },

    /**
     * 向群聊中的 AI 发送消息并处理响应。
     * @param {string} groupId - 群组 ID。
     * @param {object} aiContact - AI 联系人对象。
     * @param {string} mentionedMessageText - 触发AI的完整消息文本。
     * @param {string} originalSenderId - 原始消息发送者 ID。
     */
    async sendGroupAiMessage(groupId, aiContact, mentionedMessageText, originalSenderId) {
        const chatStore = useChatStore();
        const userStore = useUserStore();
        const groupStore = useGroupStore();
        const effectiveConfig = _getEffectiveAiConfig();

        const thinkingMessageId = `ai_thinking_group_${Date.now()}`;
        eventBus.emit('ai:thinking', {
            chatId: groupId,
            message: { id: thinkingMessageId, type: 'system', content: `${aiContact.name} 正在思考...`, sender: aiContact.id }
        });

        try {
            const group = groupStore.groups[groupId];
            const fullHistory = (chatStore.chats[groupId] || []).slice(-10); // Limit context for groups

            const formattedHistory = fullHistory
                .filter(msg => msg.type === 'text' && !msg.isRetracted && !msg.isThinking)
                .map(msg => {
                    const senderName = msg.sender === userStore.userId ? userStore.userName : userStore.contacts[msg.sender]?.name || `用户${msg.sender.substring(0,4)}`;
                    return {
                        role: msg.sender === aiContact.id ? 'assistant' : 'user',
                        content: `${senderName}: ${msg.content}`
                    };
                });

            const originalSenderName = userStore.contacts[originalSenderId]?.name || userStore.userName;
            const userTriggerMessage = `${originalSenderName}: ${mentionedMessageText}`;

            let systemPrompt = group.aiPrompts?.[aiContact.id] || aiContact.aiConfig?.systemPrompt || "You are a helpful assistant.";
            systemPrompt += AppSettings.ai.groupPromptSuffix;

            const messagesForRequestBody = [
                { role: "system", content: systemPrompt },
                ...formattedHistory,
                { role: "user", content: userTriggerMessage }
            ];

            const requestBody = {
                model: effectiveConfig.model, messages: messagesForRequestBody, stream: true,
                max_tokens: effectiveConfig.maxTokens,
            };

            eventBus.emit('ai:clear_thinking', { chatId: groupId, thinkingId: thinkingMessageId });

            const aiResponseMessageId = `group_ai_msg_${aiContact.id}_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiResponseMessage = {
                id: aiResponseMessageId, type: 'text', content: "▍",
                timestamp: new Date().toISOString(), sender: aiContact.id,
                groupId: groupId, isStreaming: true,
            };
            eventBus.emit('ai:streaming_start', { chatId: groupId, message: initialAiResponseMessage });

            await fetchApiStream(
                effectiveConfig.apiEndpoint, requestBody, { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey },
                (jsonChunk) => {
                    const chunkContent = jsonChunk.choices[0]?.delta?.content;
                    if (chunkContent) {
                        fullAiResponseContent += chunkContent;
                        eventBus.emit('ai:streaming_chunk', {
                            chatId: groupId, messageId: aiResponseMessageId, content: fullAiResponseContent + "▍"
                        });
                    }
                },
                async () => {
                    eventBus.emit('ai:streaming_end', { chatId: groupId, messageId: aiResponseMessageId });
                    const finalAiMessage = { ...initialAiResponseMessage, content: fullAiResponseContent, isStreaming: false };
                    await chatStore.addMessage(groupId, finalAiMessage);
                    groupStore.broadcastMessage(groupId, finalAiMessage);
                }
            );

        } catch (error) {
            log(`在群聊中与 AI 通信时出错: ${error}`, 'ERROR');
            eventBus.emit('ai:clear_thinking', { chatId: groupId, thinkingId: thinkingMessageId });
            const errorMessage = {
                id: `ai_error_group_${Date.now()}`, type: 'system',
                content: `${aiContact.name} 无法回复: ${error.message}`, sender: aiContact.id
            };
            await chatStore.addMessage(groupId, errorMessage);
        }
    },

    /**
     * 为记忆书功能提取对话要素。
     * @param {Array<string>} elements - 要提取的要素列表。
     * @param {string} conversationTranscript - 对话文本。
     * @returns {Promise<string>} AI 生成的摘要。
     */
    async extractMemoryElements(elements, conversationTranscript) {
        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.apiEndpoint) {
            throw new Error("AI API 端点未配置。");
        }
        const prompt = `你是一个对话分析和信息提取专家。请仔细阅读以下对话记录，并根据预设的关键要素列表，简洁、清晰地总结出相关信息。\n\n关键要素列表:\n${elements.map(e => `- ${e}`).join('\n')}\n\n对话记录:\n---\n${conversationTranscript}\n---\n\n请根据以上对话，生成一份“记忆书”，清晰地列出每个关键要素对应的内容。如果对话中没有某个要素的信息，请注明“未提及”。`;
        const requestBody = {
            model: effectiveConfig.model,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            temperature: 0.1,
            max_tokens: 1024
        };
        return new Promise(async (resolve, reject) => {
            try {
                await fetchApiStream(
                    effectiveConfig.apiEndpoint, requestBody,
                    { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                    () => {},
                    (finalContent) => resolve(finalContent)
                );
            } catch (error) {
                reject(error);
            }
        });
    },

    async checkAiServiceHealth() {
        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.apiEndpoint || !effectiveConfig.apiKey) {
            log('AI service health check skipped: Endpoint or API Key is missing.', 'WARN');
            return false;
        }

        try {
            const response = await fetch(effectiveConfig.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey },
                body: JSON.stringify({
                    model: effectiveConfig.model,
                    messages: [{ role: "user", content: "Health check" }],
                    max_tokens: 1,
                    stream: false // Health check can be non-streaming for simplicity
                })
            });
            return response.ok;
        } catch (error) {
            log(`AI service health check failed: ${error}`, 'ERROR');
            return false;
        }
    },
    async requestTtsForMessage(payload) {
        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.ttsApiEndpoint) {
            throw new Error('TTS API endpoint is not configured.');
        }

        const cacheKey = await this._generateTtsCacheKey(payload);
        const cachedItem = await dbService.getItem('ttsCache', cacheKey);
        if (cachedItem?.audioBlob) {
            log(`TTS Cache HIT for key ${cacheKey}`, 'INFO');
            return cachedItem.audioBlob;
        }

        log(`TTS Cache MISS for key ${cacheKey}. Fetching from API.`, 'DEBUG');
        const ttsUrl = `${effectiveConfig.ttsApiEndpoint}/infer_single`;
        const response = await fetch(ttsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer guest' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`TTS API request failed with status ${response.status}`);
        }
        const result = await response.json();
        if (!result.audio_url) {
            throw new Error('TTS API response did not contain an audio_url.');
        }

        const audioResponse = await fetch(result.audio_url);
        if (!audioResponse.ok) {
            throw new Error(`Failed to fetch TTS audio file from ${result.audio_url}`);
        }
        const audioBlob = await audioResponse.blob();

        await dbService.setItem('ttsCache', { id: cacheKey, audioBlob });
        return audioBlob;
    },
    async _generateTtsCacheKey(payload) {
        const payloadString = JSON.stringify(payload);
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
};