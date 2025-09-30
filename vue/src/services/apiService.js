import { useUserStore } from '@/stores/userStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGroupStore } from '@/stores/groupStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { eventBus } from './eventBus';
import { log, fetchApiStream } from '@/utils';
import AppSettings from '@/config/AppSettings';
import { MCP_TOOLS } from '@/config/McpTools';
import { dbService } from './dbService';
// --- NEW ---
import { useTtsStore } from '@/stores/ttsStore';


// Internal cache for dynamic TTS data to avoid redundant API calls
const _ttsDynamicDataCache = {};

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
function _buildMcpAnalysisPrompt(chatHistory, userMessage) {
    const messages = [];
    let mcpSystemPrompt = "你是一个能够理解并使用工具的智能助手。\n";
    mcpSystemPrompt += "可用的工具列表如下 (JSON格式):\n```json\n" + JSON.stringify(Object.values(MCP_TOOLS).map(({ name, description, parameters }) => ({ name, description, parameters })), null, 2) + "\n```\n";
    mcpSystemPrompt += "根据用户的提问，如果可以使用工具，你必须只回复一个JSON对象，格式如下: {\"tool_call\": {\"name\": \"工具名称\", \"arguments\": {\"参数1\": \"值1\"}}}. 不要添加任何其他解释或文本。\n";
    mcpSystemPrompt += "如果任何工具都不适用，或者你需要用户提供更多信息，请像平常一样自然地回复用户，不要提及工具。";
    messages.push({ role: "system", content: mcpSystemPrompt });
    messages.push(...chatHistory);
    messages.push({ role: "user", content: userMessage });
    return messages;
}
function _buildMcpFinalPrompt(baseSystemPrompt, originalUserMessage, toolCall, toolResult) {
    const messages = [];
    messages.push({ role: "system", content: baseSystemPrompt });
    const combinedPrompt = `${originalUserMessage}\n\n[系统提示：你已调用工具“${toolCall.name}”并获得以下结果，请基于此结果，用自然语言回复用户。]\n工具结果: ${toolResult}`;
    messages.push({ role: "user", content: combinedPrompt });
    return messages;
}
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
async function _generateTtsCacheKey(payload) {
    try {
        const payloadString = JSON.stringify(payload);
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadString);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        log(`生成 TTS 缓存键失败: ${error}`, 'ERROR');
        return `tts_fallback_${encodeURIComponent(payload.text)}_${encodeURIComponent(payload.model_name || 'default_model')}`;
    }
}

export const apiService = {
    async sendAiMessage(targetId, messageText, fullChatHistory = []) {
        const chatStore = useChatStore();
        const userStore = useUserStore();
        const memoryStore = useMemoryStore();

        const contact = userStore.contacts[targetId];
        if (!contact) {
            log(`sendAiMessage: Contact with ID ${targetId} not found. Aborting.`, 'ERROR');
            return;
        }

        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.apiEndpoint) throw new Error("AI API 端点未配置。");

        const thinkingMessageId = `ai_thinking_${Date.now()}`;
        chatStore.addTemporaryMessage(targetId, { id: thinkingMessageId, type: 'system', content: '思考中...', sender: targetId, isThinking: true });

        try {
            const formattedChatHistory = fullChatHistory
                .filter(msg => msg.type === 'text' && msg.content && typeof msg.content === 'string')
                .map(msg => ({
                    role: (msg.sender === userStore.userId) ? 'user' : 'assistant',
                    content: msg.content
                }));

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

            let requestBody;
            let runStreaming = true;

            if (contact.aiConfig?.mcp_enabled && typeof MCP_TOOLS !== 'undefined') {
                const analysisMessages = _buildMcpAnalysisPrompt(formattedChatHistory, messageText);
                const analysisRequestBody = { model: effectiveConfig.model, messages: analysisMessages, stream: false, temperature: 0.0, max_tokens: 512 };

                try {
                    const analysisResponse = await fetch(effectiveConfig.apiEndpoint, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey },
                        body: JSON.stringify(analysisRequestBody)
                    });
                    if (!analysisResponse.ok) throw new Error(`MCP分析请求失败: ${analysisResponse.status}`);
                    const rawTextResult = await analysisResponse.text();
                    const jsonStringResult = rawTextResult.trim().match(/\{.*\}/s)?.[0] || rawTextResult;
                    const analysisResult = JSON.parse(jsonStringResult);
                    const aiContent = analysisResult.choices[0].message.content;

                    let toolCall;
                    try { const parsedContent = JSON.parse(aiContent); if (parsedContent.tool_call) toolCall = parsedContent.tool_call; } catch(e) {}

                    if (toolCall) {
                        chatStore.removeTemporaryMessage(targetId, thinkingMessageId);
                        const toolUseMessageId = `tool_use_${Date.now()}`;
                        chatStore.addTemporaryMessage(targetId, { id: toolUseMessageId, type: 'system', toolCallInfo: { name: toolCall.name }, sender: targetId });
                        const toolResult = await _executeMcpTool(toolCall.name, toolCall.arguments);
                        chatStore.removeTemporaryMessage(targetId, toolUseMessageId);
                        if (toolResult.error) throw new Error(`工具调用错误: ${toolResult.error}`);
                        const finalMessages = _buildMcpFinalPrompt(systemPrompt, messageText, toolCall, toolResult.data);
                        requestBody = { model: effectiveConfig.model, messages: finalMessages, stream: true, max_tokens: effectiveConfig.maxTokens };
                    } else {
                        runStreaming = false;
                        chatStore.removeTemporaryMessage(targetId, thinkingMessageId);
                        const finalAiMessage = { id: `ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: targetId, isNewlyCompletedAIResponse: true };
                        await chatStore.addMessage(targetId, finalAiMessage);
                    }
                } catch (mcpError) {
                    log(`MCP analysis or tool execution failed: ${mcpError.message}. Falling back to normal response.`, 'WARN');
                    requestBody = {
                        model: effectiveConfig.model,
                        messages: [{ role: "system", content: systemPrompt }, ...formattedChatHistory, { role: "user", content: messageText }],
                        stream: true, max_tokens: effectiveConfig.maxTokens
                    };
                }
            } else {
                requestBody = {
                    model: effectiveConfig.model,
                    messages: [{ role: "system", content: systemPrompt }, ...formattedChatHistory, { role: "user", content: messageText }],
                    stream: true, max_tokens: effectiveConfig.maxTokens
                };
            }

            if (runStreaming) {
                chatStore.removeTemporaryMessage(targetId, thinkingMessageId);
                const aiMessageId = `ai_stream_${Date.now()}`;
                let fullResponseContent = "";
                const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", sender: targetId, timestamp: new Date().toISOString(), isStreaming: true };
                chatStore.addTemporaryMessage(targetId, initialAiMessage);

                await fetchApiStream(
                    effectiveConfig.apiEndpoint, requestBody, { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey },
                    (jsonChunk) => {
                        const chunkContent = jsonChunk.choices[0]?.delta?.content;
                        if (chunkContent) {
                            fullResponseContent += chunkContent;
                            chatStore.updateTemporaryMessage(targetId, aiMessageId, fullResponseContent + "▍");
                        }
                    },
                    async (finalContent) => {
                        chatStore.removeTemporaryMessage(targetId, aiMessageId);
                        const finalAiMessage = { id: aiMessageId, type: 'text', content: finalContent, sender: targetId, timestamp: initialAiMessage.timestamp, isNewlyCompletedAIResponse: true };
                        await chatStore.addMessage(targetId, finalAiMessage);

                        const latestContactState = useUserStore().contacts[targetId];
                        // --- MODIFICATION: Trigger TTS via ttsStore ---
                        if (latestContactState?.aiConfig?.tts?.enabled && finalContent) {
                            const ttsStore = useTtsStore();
                            // Pass the final message object and the contact info
                            ttsStore.requestTtsForMessage({ ...finalAiMessage, senderContact: latestContactState });
                        }
                    }
                );
            }
        } catch (error) {
            log(`与 AI 通信时出错: ${error}`, 'ERROR');
            chatStore.removeTemporaryMessage(targetId, thinkingMessageId);
            const errorMessage = { id: `ai_error_${Date.now()}`, type: 'text', content: `抱歉，我遇到了一个错误: ${error.message}`, sender: targetId, timestamp: new Date().toISOString() };
            await chatStore.addMessage(targetId, errorMessage);
        }
    },
    async sendGroupAiMessage(groupId, aiContactId, mentionedMessageText, originalSenderId) {
        const chatStore = useChatStore();
        const userStore = useUserStore();
        const groupStore = useGroupStore();

        const aiContact = userStore.contacts[aiContactId];
        if (!aiContact || !aiContact.isAI) {
            log(`sendGroupAiMessage: Target ${aiContactId} is not a valid AI contact.`, 'WARN');
            return;
        }

        const effectiveConfig = _getEffectiveAiConfig();
        const group = groupStore.groups[groupId];
        if (!group) return;

        const thinkingMessageId = `ai_thinking_group_${Date.now()}`;
        chatStore.addTemporaryMessage(groupId, { id: thinkingMessageId, type: 'system', toolCallInfo: { name: '思考中...' }, sender: aiContact.id });

        try {
            const fullHistory = (chatStore.chats[groupId] || []).slice(-10);
            const formattedHistory = fullHistory
                .filter(msg => msg.type === 'text' && !msg.isRetracted && !msg.isThinking)
                .map(msg => ({
                    role: msg.sender === aiContact.id ? 'assistant' : 'user',
                    content: `${userStore.contacts[msg.sender]?.name || '用户'}: ${msg.content}`
                }));
            const originalSenderName = userStore.contacts[originalSenderId]?.name || userStore.userName;
            const userTriggerMessage = `${originalSenderName}: ${mentionedMessageText}`;

            let requestBody;
            let runStreaming = true;

            if (aiContact.aiConfig?.mcp_enabled && typeof MCP_TOOLS !== 'undefined') {
                const analysisMessages = _buildMcpAnalysisPrompt(formattedHistory, userTriggerMessage);
                const analysisRequestBody = { model: effectiveConfig.model, messages: analysisMessages, stream: false, temperature: 0.0, max_tokens: 512 };
                try {
                    const analysisResponse = await fetch(effectiveConfig.apiEndpoint, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey },
                        body: JSON.stringify(analysisRequestBody)
                    });
                    if (!analysisResponse.ok) throw new Error(`MCP分析请求失败: ${analysisResponse.status}`);
                    const rawTextResult = await analysisResponse.text();
                    const jsonStringResult = rawTextResult.trim().match(/\{.*\}/s)?.[0] || rawTextResult;
                    const analysisResult = JSON.parse(jsonStringResult);
                    const aiContent = analysisResult.choices[0].message.content;
                    let toolCall;
                    try { const parsedContent = JSON.parse(aiContent); if (parsedContent.tool_call) toolCall = parsedContent.tool_call; } catch (e) {}
                    if (toolCall) {
                        chatStore.removeTemporaryMessage(groupId, thinkingMessageId);
                        const toolUseMessageId = `tool_use_group_${Date.now()}`;
                        chatStore.addTemporaryMessage(groupId, { id: toolUseMessageId, type: 'system', toolCallInfo: { name: toolCall.name }, sender: aiContact.id });
                        const toolResult = await _executeMcpTool(toolCall.name, toolCall.arguments);
                        chatStore.removeTemporaryMessage(groupId, toolUseMessageId);
                        if (toolResult.error) throw new Error(`工具调用错误: ${toolResult.error}`);
                        const finalMessages = _buildMcpFinalPrompt(group.aiPrompts?.[aiContact.id] || aiContact.aiConfig?.systemPrompt || "", userTriggerMessage, toolCall, toolResult.data);
                        requestBody = { model: effectiveConfig.model, messages: finalMessages, stream: true, max_tokens: effectiveConfig.maxTokens };
                    } else {
                        runStreaming = false;
                        chatStore.removeTemporaryMessage(groupId, thinkingMessageId);
                        const finalAiMessage = { id: `group_ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: aiContact.id, groupId: groupId };
                        await chatStore.addMessage(groupId, finalAiMessage);
                        groupStore.broadcastMessage(groupId, finalAiMessage);
                    }
                } catch(mcpError) {
                    log(`Group MCP failed: ${mcpError.message}. Falling back.`, 'WARN');
                }
            }

            if (runStreaming && !requestBody) {
                let systemPrompt = group.aiPrompts?.[aiContact.id] || aiContact.aiConfig?.systemPrompt || "You are a helpful assistant.";
                systemPrompt += AppSettings.ai.groupPromptSuffix;
                const messagesForRequestBody = [
                    { role: "system", content: systemPrompt },
                    ...formattedHistory,
                    { role: 'user', content: userTriggerMessage }
                ];
                requestBody = { model: effectiveConfig.model, messages: messagesForRequestBody, stream: true, max_tokens: effectiveConfig.maxTokens };
            }

            if(runStreaming) {
                chatStore.removeTemporaryMessage(groupId, thinkingMessageId);
                const aiResponseMessageId = `group_ai_msg_${aiContact.id}_${Date.now()}`;
                let fullAiResponseContent = "";
                const initialAiResponseMessage = {
                    id: aiResponseMessageId, type: 'text', content: "▍",
                    timestamp: new Date().toISOString(), sender: aiContact.id,
                    groupId: groupId, isStreaming: true,
                };
                chatStore.addTemporaryMessage(groupId, initialAiResponseMessage);

                await fetchApiStream(
                    effectiveConfig.apiEndpoint, requestBody, { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey },
                    (jsonChunk) => {
                        const chunkContent = jsonChunk.choices[0]?.delta?.content;
                        if (chunkContent) {
                            fullAiResponseContent += chunkContent;
                            chatStore.updateTemporaryMessage(groupId, aiResponseMessageId, fullAiResponseContent + "▍");
                        }
                    },
                    async (finalContent) => {
                        chatStore.removeTemporaryMessage(groupId, aiResponseMessageId);
                        const finalAiMessage = { ...initialAiResponseMessage, content: finalContent, isStreaming: false, isNewlyCompletedAIResponse: true };
                        await chatStore.addMessage(groupId, finalAiMessage);
                        const messageForBroadcast = { ...finalAiMessage, isNewlyCompletedAIResponse: undefined };
                        groupStore.broadcastMessage(groupId, messageForBroadcast);

                        // --- MODIFICATION: Trigger TTS via ttsStore ---
                        const latestAiContactState = useUserStore().contacts[aiContact.id];
                        if (latestAiContactState?.aiConfig?.tts?.enabled && finalContent) {
                            const ttsStore = useTtsStore();
                            ttsStore.requestTtsForMessage({ ...finalAiMessage, senderContact: latestAiContactState });
                        }
                    }
                );
            }

        } catch (error) {
            log(`在群聊中与 AI 通信时出错: ${error}`, 'ERROR');
            chatStore.removeTemporaryMessage(groupId, thinkingMessageId);
            const errorMessage = {
                id: `ai_error_group_${Date.now()}`, type: 'system',
                content: `${aiContact.name} 无法回复: ${error.message}`, sender: aiContact.id
            };
            await chatStore.addMessage(groupId, errorMessage);
        }
    },
    async extractMemoryElements(elements, conversationTranscript) {
        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.apiEndpoint) throw new Error("AI API 端点未配置。");

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
                    { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey },
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
                    stream: false
                })
            });
            return response.ok;
        } catch (error) {
            log(`AI service health check failed: ${error}`, 'ERROR');
            return false;
        }
    },

    async getTtsModels(version) {
        if (_ttsDynamicDataCache[version]) {
            return Object.keys(_ttsDynamicDataCache[version].models || {});
        }
        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.ttsApiEndpoint) throw new Error('TTS API endpoint is not configured.');

        // --- ✅ MODIFICATION START ---
        // 构建新的 URL，将版本号作为路径的一部分
        const modelsUrl = `${effectiveConfig.ttsApiEndpoint.replace(/\/$/, '')}/models/${version}`;
        log(`Fetching TTS models from ${modelsUrl}`, 'DEBUG');

        // 发起 GET 请求，不再需要请求体
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                // 'Content-Type': 'application/json', // GET 请求不需要 Content-Type
                'Authorization': 'Bearer guest'
            },
            // body: JSON.stringify({ version }) // GET 请求不需要 body
        });
        // --- ✅ MODIFICATION END ---

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch TTS models: ${response.status} ${errorText}`);
        }
        const data = await response.json();
        if (!data || typeof data.models !== 'object') {
            throw new Error('Invalid response format from TTS models API.');
        }
        _ttsDynamicDataCache[version] = { models: data.models };
        return Object.keys(data.models);
    },

    // --- START OF FIX ---
    getTtsModelData(version) {
        // Correctly references the module-level cache variable.
        return _ttsDynamicDataCache[version]?.models || {};
    },
    // --- END OF FIX ---

    async requestTtsForMessage(contact, text) {
        const effectiveConfig = _getEffectiveAiConfig();
        if (!effectiveConfig.ttsApiEndpoint) throw new Error('TTS API endpoint is not configured.');
        const ttsConfig = contact.aiConfig?.tts || {};
        const cleanedText = text
            .replace(/[*【\[(（].*?[*】\])）]/g, '')
            .replace(/[!?"#$%&'()*+\-\/:;<=>@[\\\]^_`{|}~「」『』《》〈〉·～]/g, '，')
            .trim();
        if (!cleanedText) return null;
        const payload = {
            version: ttsConfig.version || 'v4',
            sample_steps: ttsConfig.sample_steps ?? 16,
            if_sr: ttsConfig.if_sr ?? false,
            model_name: ttsConfig.model_name,
            speaker_name: ttsConfig.speaker_name,
            prompt_text_lang: ttsConfig.prompt_text_lang || "中文",
            emotion: ttsConfig.emotion || "默认",
            text: cleanedText,
            text_lang: ttsConfig.text_lang || "中文",
            top_k: ttsConfig.top_k ?? 10,
            top_p: ttsConfig.top_p ?? 1,
            temperature: ttsConfig.temperature ?? 1,
            text_split_method: ttsConfig.text_split_method || "按标点符号切",
            batch_size: ttsConfig.batch_size ?? 10,
            batch_threshold: ttsConfig.batch_threshold ?? 0.75,
            split_bucket: ttsConfig.split_bucket ?? true,
            speed_facter: ttsConfig.speed_facter ?? 1,
            fragment_interval: ttsConfig.fragment_interval ?? 0.3,
            media_type: ttsConfig.media_type || "wav",
            parallel_infer: ttsConfig.parallel_infer ?? true,
            repetition_penalty: ttsConfig.repetition_penalty ?? 1.35,
            seed: ttsConfig.seed ?? -1,
        };
        const cacheKey = await _generateTtsCacheKey(payload);
        const cachedItem = await dbService.getItem('ttsCache', cacheKey);
        if (cachedItem?.audioBlob) {
            log(`TTS Cache HIT for key ${cacheKey}`, 'INFO');
            return cachedItem.audioBlob;
        }
        log(`TTS Cache MISS for key ${cacheKey}. Fetching from API.`, 'DEBUG');
        const ttsUrl = `${effectiveConfig.ttsApiEndpoint.replace(/\/$/, '')}/infer_single`;
        const response = await fetch(ttsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer guest' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`TTS API request failed with status ${response.status}`);
        const result = await response.json();
        if (!result.audio_url) throw new Error('TTS API response did not contain an audio_url.');
        const audioResponse = await fetch(result.audio_url);
        if (!audioResponse.ok) throw new Error(`Failed to fetch TTS audio file from ${result.audio_url}`);
        const audioBlob = await audioResponse.blob();
        await dbService.setItem('ttsCache', { id: cacheKey, audioBlob });
        return audioBlob;
    },
};