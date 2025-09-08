import { useUserStore } from '@/stores/userStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { eventBus } from './eventBus';
import { log, fetchApiStream } from '@/utils';
import AppSettings from '@/config/AppSettings';

// Helper to get current API settings from Pinia store
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

export const apiService = {
    /**
     * Sends a message to the AI and handles the streaming response.
     * @param {string} targetId - The AI contact ID.
     * @param {object} contact - The AI contact object from the store.
     * @param {string} messageText - The user's message.
     * @param {Array<object>} fullChatHistory - The full chat history for context.
     */
    async sendAiMessage(targetId, contact, messageText, fullChatHistory = []) {
        const chatStore = useChatStore();
        const userStore = useUserStore();
        const effectiveConfig = _getEffectiveAiConfig();

        if (!effectiveConfig.apiEndpoint) {
            throw new Error("AI API endpoint is not configured.");
        }

        // --- FIX START: 使用 EventBus 管理临时UI状态 ---
        const thinkingMessageId = `ai_thinking_${Date.now()}`;

        // 1. 发送事件，让UI显示“思考中...”
        eventBus.emit('ai:thinking', {
            chatId: targetId,
            message: {
                id: thinkingMessageId,
                type: 'system',
                content: '思考中...',
                sender: targetId,
            }
        });

        try {
            const formattedChatHistory = fullChatHistory
                .filter(msg => msg.type === 'text' && msg.content && typeof msg.content === 'string')
                .map(msg => ({
                    role: (msg.sender === userStore.userId) ? 'user' : 'assistant',
                    content: msg.content
                }));

            const messagesForRequestBody = [
                { role: "system", content: contact.aiConfig?.systemPrompt || "You are a helpful assistant." },
                ...formattedChatHistory,
                { role: "user", content: messageText }
            ];

            const requestBody = {
                model: effectiveConfig.model,
                messages: messagesForRequestBody,
                stream: true,
                max_tokens: effectiveConfig.maxTokens
            };

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': effectiveConfig.apiKey,
            };

            const aiMessageId = `ai_stream_${Date.now()}`;
            let fullResponseContent = "";

            // 2. 移除“思考中...”，并准备显示流式消息
            eventBus.emit('ai:clear_thinking', { chatId: targetId, thinkingId: thinkingMessageId });

            const initialAiMessage = {
                id: aiMessageId,
                type: 'text',
                content: "▍",
                sender: targetId,
                timestamp: new Date().toISOString(),
                isStreaming: true,
            };
            // 发送事件，让UI显示初始的流式消息气泡
            eventBus.emit('ai:streaming_start', { chatId: targetId, message: initialAiMessage });

            await fetchApiStream(
                effectiveConfig.apiEndpoint,
                requestBody,
                headers,
                (jsonChunk) => { // onChunkReceived
                    const chunkContent = jsonChunk.choices[0]?.delta?.content;
                    if (chunkContent) {
                        fullResponseContent += chunkContent;
                        // 发送事件，更新UI中的流式消息内容
                        eventBus.emit('ai:streaming_chunk', {
                            chatId: targetId,
                            messageId: aiMessageId,
                            content: fullResponseContent + "▍"
                        });
                    }
                },
                async () => { // onStreamEnd
                    // 3. 流式传输结束，移除流式UI消息
                    eventBus.emit('ai:streaming_end', { chatId: targetId, messageId: aiMessageId });

                    // 4. 将最终的、完整的消息添加到 chatStore 进行持久化
                    const finalAiMessage = {
                        id: aiMessageId, // 使用流式消息的ID以保持一致性
                        type: 'text',
                        content: fullResponseContent,
                        sender: targetId,
                        timestamp: initialAiMessage.timestamp, // 使用初始时间戳
                        isNewlyCompletedAIResponse: true, // For TTS trigger
                    };
                    await chatStore.addMessage(targetId, finalAiMessage);
                }
            );

        } catch (error) {
            log(`Error communicating with AI: ${error}`, 'ERROR');
            // 5. 如果出错，确保移除所有临时UI消息
            eventBus.emit('ai:clear_thinking', { chatId: targetId, thinkingId: thinkingMessageId });
            eventBus.emit('ai:streaming_end', { chatId: targetId, messageId: `ai_stream_${thinkingMessageId.split('_')[2]}` }); // Try to clean up stream bubble too

            const errorMessage = {
                id: `ai_error_${Date.now()}`,
                type: 'text',
                content: `抱歉，我遇到了一个错误: ${error.message}`,
                sender: targetId,
                timestamp: new Date().toISOString()
            };
            // 将错误消息添加到持久化存储
            await chatStore.addMessage(targetId, errorMessage);
        }
        // --- FIX END ---
    },

    // ... 其他函数 (checkAiServiceHealth, requestTtsForMessage, _generateTtsCacheKey) 保持不变 ...
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