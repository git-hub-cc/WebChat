/**
 * @file AiApiHandler.js
 * @description 负责处理与后端 AI API 的所有通信，包括构建上下文、发送请求以及处理流式响应。
 *              现在会优先使用用户在设置中配置的 API 参数。
 *              更新：在群聊中处理对 AI 的提及，提示词获取逻辑调整为支持非当前主题定义的AI角色。
 *              修复：在 sendGroupAiMessage 中，从历史记录中排除触发AI调用的用户消息本身，以避免AI上下文中该消息重复。
 *              重构：通用 API 请求逻辑已移至 Utils.fetchApiStream。
 *              新增：在向AI发送消息时，会检查并应用用户为该AI选择的词汇篇章特定提示词。
 *              修复：在 sendAiMessage 中，从历史记录中排除触发AI调用的用户消息本身，以避免AI上下文中该消息重复。
 *              移除：删除了所有与对话摘要相关的功能，因为后端不再支持。
 *              修改: _getEffectiveAiConfig 现在支持从多种大模型提供商配置中获取设置，并移除了对“覆盖”状态的检查。
 *              FIXED: 增加了 extractMemoryElements 方法以支持记忆书功能。
 *              FIXED: sendAiMessage 现在会注入已启用的记忆书内容。
 *              MODIFIED: sendGroupAiMessage 现在支持 MCP (工具调用)，并会在使用工具时发送系统提示。
 *              FIXED: 修复了群聊 MCP 分析请求时因响应格式不标准导致的 JSON 解析错误。
 * @dependencies UserManager, MessageManager, ChatManager, NotificationUIManager, Utils, AppSettings, ConnectionManager, LLMProviders, MemoryBookManager, GroupManager
 */
const AiApiHandler = {

    _getEffectiveAiConfig: function() {
        const config = {};
        const fallbackConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};
        const llmProviders = (typeof LLMProviders !== 'undefined') ? LLMProviders : {};

        const providerKey = localStorage.getItem('aiSetting_llmProvider') || 'ppmc';
        const providerConfig = llmProviders[providerKey] || llmProviders.ppmc || {};

        config.apiEndpoint = localStorage.getItem('aiSetting_apiEndpoint')
            || providerConfig.defaultEndpoint
            || fallbackConfig.apiEndpoint;

        config.model = localStorage.getItem('aiSetting_model')
            || providerConfig.defaultModel
            || fallbackConfig.model;

        config.apiKey = localStorage.getItem('aiSetting_api_key') || fallbackConfig.api_key || '';

        const maxTokensStored = localStorage.getItem('aiSetting_max_tokens');
        let parsedMaxTokens = parseInt(maxTokensStored, 10);

        if (maxTokensStored !== null && !isNaN(parsedMaxTokens)) {
            config.maxTokens = parsedMaxTokens;
        } else if (fallbackConfig.max_tokens !== undefined) {
            config.maxTokens = fallbackConfig.max_tokens;
        } else {
            config.maxTokens = 2048;
        }

        config.ttsApiEndpoint = localStorage.getItem('aiSetting_ttsApiEndpoint') || fallbackConfig.ttsApiEndpoint || '';

        Utils.log(`_getEffectiveAiConfig: 生效的 AI 配置已使用。提供商: ${providerKey}, 端点: ${config.apiEndpoint ? String(config.apiEndpoint).substring(0,30) + '...' : 'N/A'}, 密钥存在: ${!!config.apiKey}, 模型: ${config.model}, TTS 端点: ${config.ttsApiEndpoint ? String(config.ttsApiEndpoint).substring(0,30) + '...' : 'N/A'}`, Utils.logLevels.DEBUG);
        return config;
    },

    /**
     * @private
     * @description 为MCP流程构建第一次请求的提示。包含工具定义和指示。
     * ... (this method remains the same as your provided code) ...
     */
    _buildMcpAnalysisPrompt: function(contact, chatHistory, userMessage) {
        const messages = [];
        let mcpSystemPrompt = "你是一个能够理解并使用工具的智能助手。\n";
        mcpSystemPrompt += "可用的工具列表如下 (JSON格式):\n```json\n" + JSON.stringify(MCP_TOOLS, null, 2) + "\n```\n";
        mcpSystemPrompt += "根据用户的提问，如果可以使用工具，你必须只回复一个JSON对象，格式如下: {\"tool_call\": {\"name\": \"工具名称\", \"arguments\": {\"参数1\": \"值1\"}}}. 不要添加任何其他解释或文本。\n";
        mcpSystemPrompt += "如果任何工具都不适用，或者你需要用户提供更多信息，请像平常一样自然地回复用户，不要提及工具。\n\n";

        messages.push({ role: "system", content: mcpSystemPrompt });

        const contextMessagesForAIHistory = chatHistory.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));
        messages.push(...contextMessagesForAIHistory);
        messages.push({ role: "user", content: userMessage });

        return messages;
    },

    /**
     * @private
     * @description 为MCP流程构建第二次请求的提示。包含工具调用结果。
     * ... (this method remains the same as your provided code) ...
     */
    _buildMcpFinalPrompt: function(contact, originalUserMessage, toolCall, toolResult) {
        const messages = [];
        const baseSystemPrompt = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "你是一个乐于助人的助手。";
        messages.push({ role: "system", content: baseSystemPrompt });

        const combinedPrompt = `${originalUserMessage}\n\n[系统提示：你已调用工具“${toolCall.name}”并获得以下结果，请基于此结果，用自然语言回复用户。]\n工具结果: ${toolResult}`;
        messages.push({ role: "user", content: combinedPrompt });

        return messages;
    },

    /**
     * @private
     * @description 执行MCP工具调用。
     * ... (this method remains the same as your provided code) ...
     */
    _executeMcpTool: async function(toolName, args) {
        if (typeof MCP_TOOLS === 'undefined' || !MCP_TOOLS[toolName]) {
            return { error: `未知的工具: ${toolName}` };
        }
        const toolDef = MCP_TOOLS[toolName];
        let url = toolDef.url_template;

        for (const key in args) {
            if (Object.prototype.hasOwnProperty.call(args, key)) {
                url = url.replace(`{${key}}`, encodeURIComponent(args[key]));
            }
        }
        Utils.log(`MCP: 正在执行工具 "${toolName}"，请求URL: ${url}`, Utils.logLevels.INFO);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                return { error: `工具API请求失败，状态码: ${response.status}` };
            }
            const data = await response.text();
            return { data: data };
        } catch (e) {
            return { error: `网络请求失败: ${e.message}` };
        }
    },

    // --- ADDED: THE MISSING FUNCTION ---
    /**
     * NEW: Sends a conversation transcript to the AI to extract key elements.
     * @param {Array<string>} elements - The list of key elements to extract.
     * @param {string} conversationTranscript - The full conversation text.
     * @returns {Promise<string>} - The AI-generated summary/extraction.
     */
    extractMemoryElements: async function(elements, conversationTranscript) {
        Utils.log(`AiApiHandler: 请求提取记忆要素: ${elements.join(', ')}`, Utils.logLevels.INFO);
        const effectiveConfig = this._getEffectiveAiConfig();
        if (!effectiveConfig.apiEndpoint) {
            throw new Error("AI API 端点未配置。");
        }

        const prompt = `你是一个对话分析和信息提取专家。请仔细阅读以下对话记录，并根据预设的关键要素列表，简洁、清晰地总结出相关信息。

关键要素列表:
${elements.map(e => `- ${e}`).join('\n')}

对话记录:
---
${conversationTranscript}
---

请根据以上对话，生成一份“记忆书”，清晰地列出每个关键要素对应的内容。如果对话中没有某个要素的信息，请注明“未提及”。`;

        const requestBody = {
            model: effectiveConfig.model,
            messages: [{ role: "user", content: prompt }],
            stream: false, // This is a single, non-streaming request
            temperature: 0.1,
            max_tokens: 1024
        };

        const response = await fetch(effectiveConfig.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`记忆提取请求失败: ${response.status} - ${errorText.substring(0, 100)}`);
        }
        const result = await response.json();
        return result.choices[0].message.content;
    },
    // --- END OF ADDED FUNCTION ---

    sendAiMessage: async function(targetId, contact, messageText) {
        const chatBox = document.getElementById('chatBox');

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            const contextWindow = (typeof AppSettings !== 'undefined' && AppSettings.ai && AppSettings.ai.sessionTime !== undefined)
                ? AppSettings.ai.sessionTime
                : (10 * 60 * 1000);
            const timeThreshold = new Date().getTime() - contextWindow;
            const chatHistory = (ChatManager.chats[targetId] || []).filter(msg => new Date(msg.timestamp).getTime() > timeThreshold && msg.type === 'text');

            if (chatHistory.length > 0) {
                const lastMessageInHistory = chatHistory[chatHistory.length - 1];
                if (lastMessageInHistory.sender === UserManager.userId && lastMessageInHistory.content === messageText) {
                    chatHistory.pop();
                    Utils.log(`sendAiMessage: 从上下文中移除了重复的触发消息: "${messageText.substring(0, 30)}..."`, Utils.logLevels.DEBUG);
                }
            }

            // ... (MCP logic remains the same) ...
            if (contact.aiConfig?.mcp_enabled && typeof MCP_TOOLS !== 'undefined') {
                // MCP logic here...
                const analysisMessages = this._buildMcpAnalysisPrompt(contact, chatHistory, messageText);
                const analysisRequestBody = {
                    model: effectiveConfig.model, messages: analysisMessages, stream: false,
                    temperature: 0.0, max_tokens: 512
                };
                const analysisResponse = await fetch(effectiveConfig.apiEndpoint, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                    body: JSON.stringify(analysisRequestBody)
                });
                if (!analysisResponse.ok) throw new Error(`MCP分析请求失败: ${analysisResponse.status}`);
                const rawTextResult = await analysisResponse.text();
                let jsonStringResult = rawTextResult.trim();
                if (jsonStringResult.startsWith('data: ')) {
                    jsonStringResult = jsonStringResult.substring('data: '.length).trim();
                }
                if (jsonStringResult.endsWith('[DONE]')) {
                    jsonStringResult = jsonStringResult.substring(0, jsonStringResult.lastIndexOf('[DONE]')).trim();
                }
                const firstBraceIndex = jsonStringResult.indexOf('{');
                const lastBraceIndex = jsonStringResult.lastIndexOf('}');
                if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
                    jsonStringResult = jsonStringResult.substring(firstBraceIndex, lastBraceIndex + 1);
                }
                const analysisResult = JSON.parse(jsonStringResult);
                const aiContent = analysisResult.choices[0].message.content;
                let toolCall;
                try {
                    const parsedContent = JSON.parse(aiContent);
                    if (parsedContent.tool_call) {
                        toolCall = parsedContent.tool_call;
                    }
                } catch (e) {
                    const finalAiMessage = { id: `ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: targetId, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                    return;
                }
                if (toolCall) {
                    const toolResult = await this._executeMcpTool(toolCall.name, toolCall.arguments);
                    if (toolResult.error) {
                        throw new Error(`工具调用错误: ${toolResult.error}`);
                    }
                    const finalMessages = this._buildMcpFinalPrompt(contact, messageText, toolCall, toolResult.data);
                    const finalRequestBody = {
                        model: effectiveConfig.model, messages: finalMessages, stream: true,
                        temperature: 0.1, max_tokens: effectiveConfig.maxTokens || 2048,
                        user: UserManager.userId, character_id: targetId
                    };
                    const aiMessageId = `ai_stream_${Date.now()}`;
                    let fullAiResponseContent = "";
                    const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
                    MessageManager.displayMessage(initialAiMessage, false);
                    ChatManager.addMessage(targetId, initialAiMessage);
                    let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                    await Utils.fetchApiStream(
                        effectiveConfig.apiEndpoint, finalRequestBody,
                        { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                        (jsonChunk) => {
                            const chunkContent = jsonChunk.choices[0].delta.content;
                            fullAiResponseContent += chunkContent;
                            if (aiMessageElement) {
                                aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent + "▍");
                                chatBox.scrollTop = chatBox.scrollHeight;
                            }
                        },
                        (finalContent) => {
                            if (aiMessageElement) aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent);
                            const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                            ChatManager.addMessage(targetId, finalAiMessage);
                        }
                    );
                    return;
                } else {
                    const finalAiMessage = { id: `ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: targetId, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                    return;
                }
            }

            const recentMessages = chatHistory;
            const contextMessagesForAIHistory = recentMessages.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));

            const messagesForRequestBody = [];
            let baseSystemPrompt = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "";

            // --- FIXED: INJECT MEMORY BOOK CONTENT ---
            const memoryBookContent = (typeof MemoryBookManager !== 'undefined') ? MemoryBookManager.getEnabledMemoryBookContentForChat(targetId) : "";
            if (memoryBookContent) {
                baseSystemPrompt = `[背景记忆]\n${memoryBookContent}\n\n[角色设定]\n${baseSystemPrompt}`;
                Utils.log(`AiApiHandler: 为 AI ${targetId} 注入了记忆书内容。`, Utils.logLevels.INFO);
            }
            // --- END OF FIX ---

            const selectedChapterId = UserManager.getSelectedChapterForAI(targetId);
            let chapterPromptModifier = "";
            if (selectedChapterId && contact.chapters && contact.chapters.length > 0) {
                const chapter = contact.chapters.find(ch => ch.id === selectedChapterId);
                if (chapter && chapter.promptModifier) {
                    chapterPromptModifier = chapter.promptModifier;
                    Utils.log(`AiApiHandler: 为 AI ${targetId} 应用篇章 "${chapter.name}" 的提示词修正。`, Utils.logLevels.INFO);
                }
            }

            let finalSystemPrompt = baseSystemPrompt;
            if (chapterPromptModifier) {
                finalSystemPrompt += `\n\n[Chapter Focus: ${contact.chapters.find(ch => ch.id === selectedChapterId)?.name || selectedChapterId}]\n${chapterPromptModifier}`;
            }
            finalSystemPrompt += contact.aiConfig.promptSuffix?contact.aiConfig.promptSuffix:AppSettings.ai.promptSuffix;

            messagesForRequestBody.push({role: "system", content: finalSystemPrompt});
            messagesForRequestBody.push(...contextMessagesForAIHistory);
            messagesForRequestBody.push({ role: "user", content: `${messageText} [发送于: ${new Date().toLocaleString()}]` });

            Utils.log(`AiApiHandler: 向 ${contact.name} 发送 AI 请求。配置: 端点='${effectiveConfig.apiEndpoint}', 密钥存在=${!!effectiveConfig.apiKey}, 模型='${effectiveConfig.model}'`, Utils.logLevels.DEBUG);

            const requestBody = {
                model: effectiveConfig.model, messages: messagesForRequestBody, stream: true,
                temperature: 0.1, max_tokens: effectiveConfig.maxTokens || 2048,
                user: UserManager.userId, character_id: targetId
            };
            Utils.log(`正在发送到 AI (${contact.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG);

            const aiMessageId = `ai_stream_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            MessageManager.displayMessage(initialAiMessage, false);
            ChatManager.addMessage(targetId, initialAiMessage);
            let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);

            await Utils.fetchApiStream(
                effectiveConfig.apiEndpoint, requestBody,
                { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                (jsonChunk) => {
                    const chunkContent = jsonChunk.choices[0].delta.content;
                    fullAiResponseContent += chunkContent;
                    if (aiMessageElement) {
                        aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent + "▍");
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                },
                (finalContent) => {
                    if (aiMessageElement) aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent);
                    const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                }
            );

        } catch (error) {
            Utils.log(`与 AI (${contact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`错误: 无法从 ${contact.name} 获取回复。 ${error.message}`, 'error');
            ChatManager.addMessage(targetId, { type: 'text', content: `抱歉，发生了一个错误: ${error.message}`, timestamp: new Date().toISOString(), sender: targetId });
        }
    },

    sendGroupAiMessage: async function(groupId, group, aiContactId, mentionedMessageText, originalSenderId, triggeringMessageId = null) {
        const aiContact = UserManager.contacts[aiContactId];
        if (!aiContact || !aiContact.isAI) {
            Utils.log(`AiApiHandler.sendGroupAiMessage: 目标 ${aiContactId} 不是有效的AI联系人。`, Utils.logLevels.WARN);
            return;
        }

        const chatBox = document.getElementById('chatBox');

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                Utils.log("AiApiHandler.sendGroupAiMessage: AI API 端点未配置。", Utils.logLevels.ERROR);
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            const groupContextWindow = (typeof AppSettings !== 'undefined' && AppSettings.ai && AppSettings.ai.groupAiSessionTime !== undefined)
                ? AppSettings.ai.groupAiSessionTime
                : (3 * 60 * 1000);
            const timeThreshold = new Date().getTime() - groupContextWindow;
            const groupChatHistory = (ChatManager.chats[groupId] || []).filter(msg =>
                new Date(msg.timestamp).getTime() > timeThreshold &&
                (msg.type === 'text' || (msg.type === 'system')) &&
                msg.id !== triggeringMessageId
            );

            const formattedHistory = groupChatHistory.map(msg => {
                if (msg.sender && msg.sender !== aiContactId) {
                    const senderName = UserManager.contacts[msg.sender]?.name || `用户 ${String(msg.sender).substring(0,4)}`;
                    return { ...msg, content: `${senderName}: ${msg.content}` };
                }
                return msg;
            });

            const triggeringSenderName = UserManager.contacts[originalSenderId]?.name || `用户 ${String(originalSenderId).substring(0,4)}`;
            const userTriggerMessageContent = `${triggeringSenderName}: ${mentionedMessageText}`;

            if (aiContact.aiConfig?.mcp_enabled && typeof MCP_TOOLS !== 'undefined') {
                const analysisMessages = this._buildMcpAnalysisPrompt(aiContact, formattedHistory, userTriggerMessageContent);
                const analysisRequestBody = {
                    model: effectiveConfig.model, messages: analysisMessages, stream: false,
                    temperature: 0.0, max_tokens: 512
                };

                const analysisResponse = await fetch(effectiveConfig.apiEndpoint, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                    body: JSON.stringify(analysisRequestBody)
                });

                if (!analysisResponse.ok) throw new Error(`群聊 MCP 分析请求失败: ${analysisResponse.status}`);

                // --- FIX START: Handle non-standard JSON response ---
                const rawTextResult = await analysisResponse.text();
                let jsonStringResult = rawTextResult.trim();

                if (jsonStringResult.startsWith('data: ')) {
                    jsonStringResult = jsonStringResult.substring('data: '.length).trim();
                }
                if (jsonStringResult.endsWith('[DONE]')) {
                    jsonStringResult = jsonStringResult.substring(0, jsonStringResult.lastIndexOf('[DONE]')).trim();
                }

                const firstBraceIndex = jsonStringResult.indexOf('{');
                const lastBraceIndex = jsonStringResult.lastIndexOf('}');
                if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
                    jsonStringResult = jsonStringResult.substring(firstBraceIndex, lastBraceIndex + 1);
                }

                const analysisResult = JSON.parse(jsonStringResult);
                // --- FIX END ---

                const aiContent = analysisResult.choices[0].message.content;

                let toolCall;
                try {
                    const parsedContent = JSON.parse(aiContent);
                    if (parsedContent.tool_call) {
                        toolCall = parsedContent.tool_call;
                    }
                } catch (e) {
                    const finalAiMessage = { id: `group_ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: aiContactId, groupId: groupId };
                    ChatManager.addMessage(groupId, finalAiMessage);
                    GroupManager.broadcastToGroup(groupId, finalAiMessage);
                    return;
                }

                if (toolCall) {
                    const systemToolMsg = { id: `sys_tool_use_${Date.now()}`, type: 'system', content: `${aiContact.name} 正在使用 [${toolCall.name}] 工具...`, timestamp: new Date().toISOString(), groupId: groupId };
                    ChatManager.addMessage(groupId, systemToolMsg);

                    const toolResult = await this._executeMcpTool(toolCall.name, toolCall.arguments);
                    if (toolResult.error) {
                        throw new Error(`工具调用错误: ${toolResult.error}`);
                    }

                    const finalMessages = this._buildMcpFinalPrompt(aiContact, userTriggerMessageContent, toolCall, toolResult.data);
                    const finalRequestBody = {
                        model: effectiveConfig.model, messages: finalMessages, stream: true,
                        temperature: 0.1, max_tokens: effectiveConfig.maxTokens || 2048,
                        user: originalSenderId, character_id: aiContactId, group_id: groupId
                    };

                    const aiResponseMessageId = `group_ai_msg_${aiContactId}_${Date.now()}`;
                    let fullAiResponseContent = "";
                    const initialAiResponseMessage = {
                        id: aiResponseMessageId, type: 'text', content: "▍",
                        timestamp: new Date().toISOString(), sender: aiContactId,
                        groupId: groupId, isStreaming: true,
                    };
                    ChatManager.addMessage(groupId, initialAiResponseMessage);

                    await Utils.fetchApiStream(
                        effectiveConfig.apiEndpoint, finalRequestBody,
                        { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                        (jsonChunk) => {
                            const chunkContent = jsonChunk.choices[0].delta.content;
                            fullAiResponseContent += chunkContent;
                            ChatManager.addMessage(groupId, { ...initialAiResponseMessage, content: fullAiResponseContent + "▍" });
                        },
                        () => {
                            const finalAiMessage = { ...initialAiResponseMessage, content: fullAiResponseContent, isStreaming: false, isNewlyCompletedAIResponse: true };
                            ChatManager.addMessage(groupId, finalAiMessage);
                            const messageForBroadcast = { ...finalAiMessage };
                            delete messageForBroadcast.isNewlyCompletedAIResponse;
                            GroupManager.broadcastToGroup(groupId, messageForBroadcast);
                        }
                    );
                    return;
                }
            }

            let systemPromptBase = "";
            if (group.aiPrompts && group.aiPrompts[aiContactId] !== undefined && group.aiPrompts[aiContactId].trim() !== "") {
                systemPromptBase = group.aiPrompts[aiContactId];
            } else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined && aiContact.aiConfig.systemPrompt.trim() !== "") {
                systemPromptBase = aiContact.aiConfig.systemPrompt;
            }
            const finalSystemPrompt = systemPromptBase + AppSettings.ai.groupPromptSuffix;

            const contextMessagesForAIHistory = formattedHistory.map(msg => {
                let role = (msg.sender === aiContactId) ? 'assistant' : 'user';
                return { role: role, content: msg.content };
            });

            const messagesForRequestBody = [
                { role: "system", content: finalSystemPrompt },
                ...contextMessagesForAIHistory,
                { role: 'user', content: userTriggerMessageContent }
            ];

            const requestBody = {
                model: effectiveConfig.model,
                messages: messagesForRequestBody,
                stream: true,
                temperature: 0.1,
                max_tokens: effectiveConfig.maxTokens || 2048,
                group_id: groupId,
                character_id: aiContactId,
                user: originalSenderId
            };

            const aiResponseMessageId = `group_ai_msg_${aiContactId}_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiResponseMessage = {
                id: aiResponseMessageId, type: 'text', content: "▍",
                timestamp: new Date().toISOString(), sender: aiContactId,
                groupId: groupId, isStreaming: true,
            };
            ChatManager.addMessage(groupId, initialAiResponseMessage);

            await Utils.fetchApiStream(
                effectiveConfig.apiEndpoint, requestBody,
                { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                (jsonChunk) => {
                    const chunkContent = jsonChunk.choices[0].delta.content;
                    fullAiResponseContent += chunkContent;
                    ChatManager.addMessage(groupId, { ...initialAiResponseMessage, content: fullAiResponseContent + "▍" });
                },
                () => {
                    const finalAiMessage = { ...initialAiResponseMessage, content: fullAiResponseContent, isStreaming: false, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(groupId, finalAiMessage);
                    const messageForBroadcast = { ...finalAiMessage };
                    delete messageForBroadcast.isNewlyCompletedAIResponse;
                    GroupManager.broadcastToGroup(groupId, messageForBroadcast);
                }
            );

        } catch (error) {
            Utils.log(`在群组 (${group.name}) 中与 AI (${aiContact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`错误: 无法从 ${aiContact.name} (群组内) 获取回复。 ${error.message}`, 'error');
            const errorResponseMessage = {
                id: `group_ai_error_${aiContactId}_${Date.now()}`, type: 'text',
                content: `抱歉，我在群组 (${group.name}) 中回复时遇到了问题: ${error.message}`,
                timestamp: new Date().toISOString(), sender: aiContactId,
                groupId: groupId, originalSender: aiContactId, originalSenderName: aiContact.name
            };
            ChatManager.addMessage(groupId, errorResponseMessage);
            GroupManager.broadcastToGroup(groupId, errorResponseMessage);
        }
    },
    checkAiServiceHealth: async function() {
        const effectiveConfig = this._getEffectiveAiConfig();

        if (!effectiveConfig.apiEndpoint) {
            Utils.log("AiApiHandler: AI API 端点未配置，无法进行健康检查。", Utils.logLevels.ERROR);
            return false;
        }

        const healthCheckPayload = {
            model: effectiveConfig.model,
            messages: [ { role: "user", content: "回复ok." } ],
            stream: true,
            max_tokens: 5
        };

        try {
            Utils.log(`AiApiHandler: 正在向 ${effectiveConfig.apiEndpoint} (模型: ${effectiveConfig.model}) 执行健康检查 (流式)`, Utils.logLevels.DEBUG);
            let fullStreamedContent = "";
            let healthCheckPassed = false;

            await Utils.fetchApiStream(
                effectiveConfig.apiEndpoint,
                healthCheckPayload,
                { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey || "" },
                (jsonChunk) => {
                    if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                        fullStreamedContent += jsonChunk.choices[0].delta.content;
                    }
                },
                () => {
                    const trimmedContent = fullStreamedContent.trim();
                    Utils.log(`AI 健康检查流式响应内容: "${trimmedContent}" (长度: ${trimmedContent.length})`, Utils.logLevels.DEBUG);
                    if (trimmedContent.toLowerCase().includes("ok") && trimmedContent.length < 200) {
                        Utils.log("AiApiHandler: AI 服务健康检查成功 (流式)。", Utils.logLevels.INFO);
                        healthCheckPassed = true;
                    } else {
                        Utils.log(`AiApiHandler: AI 服务健康检查失败 (流式)。内容: "${trimmedContent}", 长度: ${trimmedContent.length}`, Utils.logLevels.WARN);
                        healthCheckPassed = false;
                    }
                }
            );
            return healthCheckPassed;
        } catch (error) {
            Utils.log(`AiApiHandler: AI 服务健康检查期间出错: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    },
    handleAiConfigChange: async function () {
        Utils.log("AiApiHandler: AI 配置已更改，正在重新检查服务健康状况...", Utils.logLevels.INFO);
        NotificationUIManager.showNotification("AI 配置已更新，正在检查服务状态...", "info");
        try {
            const isHealthy = await this.checkAiServiceHealth();
            UserManager.updateAiServiceStatus(isHealthy);
            if (isHealthy) {
                NotificationUIManager.showNotification("AI 服务连接成功！", "success");
            } else {
                NotificationUIManager.showNotification("AI 服务连接失败。请检查您的设置。", "error");
            }
        } catch (e) {
            Utils.log("处理 AI 配置变更时，健康检查出错: " + e.message, Utils.logLevels.ERROR);
            UserManager.updateAiServiceStatus(false);
            NotificationUIManager.showNotification("检查 AI 服务状态时发生错误。", "error");
        }
    }
};