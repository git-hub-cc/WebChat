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
 * @dependencies UserManager, MessageManager, ChatManager, NotificationUIManager, Utils, AppSettings, ConnectionManager, LLMProviders
 */
const AiApiHandler = {

    _getEffectiveAiConfig: function() {
        const config = {};
        const fallbackConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};
        // **MODIFIED**: Use LLMProviders directly
        const llmProviders = (typeof LLMProviders !== 'undefined') ? LLMProviders : {};

        // 1. 确定提供商和其配置
        // BUG FIX: 将新用户的默认提供商从 'siliconflow' 改为 'ppmc'，以匹配 AppSettings.js 中的全局回退设置。
        const providerKey = localStorage.getItem('aiSetting_llmProvider') || 'ppmc';
        const providerConfig = llmProviders[providerKey] || llmProviders.ppmc || {};

        // 2. 获取 API 端点: 优先使用 localStorage 中的用户设置，然后是提供商默认值，最后是全局回退值
        config.apiEndpoint = localStorage.getItem('aiSetting_apiEndpoint')
            || providerConfig.defaultEndpoint
            || fallbackConfig.apiEndpoint;

        // 3. 获取模型: 逻辑同上
        config.model = localStorage.getItem('aiSetting_model')
            || providerConfig.defaultModel
            || fallbackConfig.model;

        // 4. 获取其他配置（API Key, Max Tokens, TTS Endpoint），这些配置不受提供商选择的直接影响，但同样遵循 "用户设置 > 全局回退" 的原则
        config.apiKey = localStorage.getItem('aiSetting_api_key') || fallbackConfig.api_key || '';

        const maxTokensStored = localStorage.getItem('aiSetting_max_tokens');
        let parsedMaxTokens = parseInt(maxTokensStored, 10);

        // COMMENT: 此处逻辑确保 max_tokens 的获取优先级为：用户在 localStorage 中的设置 > AppSettings.js 中的默认值 > 硬编码的最终回退值 (2048)。
        if (maxTokensStored !== null && !isNaN(parsedMaxTokens)) {
            config.maxTokens = parsedMaxTokens;
        } else if (fallbackConfig.max_tokens !== undefined) {
            config.maxTokens = fallbackConfig.max_tokens;
        } else {
            config.maxTokens = 2048; // 最终回退值
        }

        config.ttsApiEndpoint = localStorage.getItem('aiSetting_ttsApiEndpoint') || fallbackConfig.ttsApiEndpoint || '';

        Utils.log(`_getEffectiveAiConfig: 生效的 AI 配置已使用。提供商: ${providerKey}, 端点: ${config.apiEndpoint ? String(config.apiEndpoint).substring(0,30) + '...' : 'N/A'}, 密钥存在: ${!!config.apiKey}, 模型: ${config.model}, TTS 端点: ${config.ttsApiEndpoint ? String(config.ttsApiEndpoint).substring(0,30) + '...' : 'N/A'}`, Utils.logLevels.DEBUG);
        return config;
    },
    /**
     * @private
     * @description 为MCP流程构建第一次请求的提示。包含工具定义和指示。
     * @param {object} contact - AI联系人对象。
     * @param {Array<object>} chatHistory - 聊天历史记录。
     * @param {string} userMessage - 用户的当前消息。
     * @returns {Array<object>} - 用于API请求的messages数组。
     */
    _buildMcpAnalysisPrompt: function(contact, chatHistory, userMessage) {
        const messages = [];
        // 1. 构建包含工具定义的系统提示
        let mcpSystemPrompt = "你是一个能够理解并使用工具的智能助手。\n";
        mcpSystemPrompt += "可用的工具列表如下 (JSON格式):\n```json\n" + JSON.stringify(MCP_TOOLS, null, 2) + "\n```\n";
        mcpSystemPrompt += "根据用户的提问，如果可以使用工具，你必须只回复一个JSON对象，格式如下: {\"tool_call\": {\"name\": \"工具名称\", \"arguments\": {\"参数1\": \"值1\"}}}. 不要添加任何其他解释或文本。\n";
        mcpSystemPrompt += "如果任何工具都不适用，或者你需要用户提供更多信息，请像平常一样自然地回复用户，不要提及工具。\n\n";
        //mcpSystemPrompt += (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : ""; // 附加角色自身设定

        messages.push({ role: "system", content: mcpSystemPrompt });

        // 2. 添加聊天历史
        const contextMessagesForAIHistory = chatHistory.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));
        messages.push(...contextMessagesForAIHistory);

        // 3. 添加当前用户消息
        messages.push({ role: "user", content: userMessage });

        return messages;
    },

    /**
     * @private
     * @description 为MCP流程构建第二次请求的提示。包含工具调用结果。
     * @param {object} contact - AI联系人对象。
     * @param {string} originalUserMessage - 用户的原始消息。
     * @param {object} toolCall - AI决定的工具调用对象。
     * @param {string} toolResult - 工具的执行结果文本。
     * @returns {Array<object>} - 用于API请求的messages数组。
     */
    _buildMcpFinalPrompt: function(contact, originalUserMessage, toolCall, toolResult) {
        const messages = [];
        const baseSystemPrompt = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "你是一个乐于助人的助手。";
        messages.push({ role: "system", content: baseSystemPrompt });

        // 将原始问题和工具结果合并为一个新的用户问题，引导AI进行总结
        const combinedPrompt = `${originalUserMessage}\n\n[系统提示：你已调用工具“${toolCall.name}”并获得以下结果，请基于此结果，用自然语言回复用户。]\n工具结果: ${toolResult}`;
        messages.push({ role: "user", content: combinedPrompt });

        return messages;
    },

    /**
     * @private
     * @description 执行MCP工具调用。
     * @param {string} toolName - 要调用的工具名称。
     * @param {object} args - 工具的参数。
     * @returns {Promise<object>} - 返回一个包含 { data } 或 { error } 的对象。
     */
    _executeMcpTool: async function(toolName, args) {
        // 确保MCP_TOOLS已定义
        if (typeof MCP_TOOLS === 'undefined' || !MCP_TOOLS[toolName]) {
            return { error: `未知的工具: ${toolName}` };
        }
        const toolDef = MCP_TOOLS[toolName];
        let url = toolDef.url_template;

        // 替换URL模板中的参数占位符
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

    sendAiMessage: async function(targetId, contact, messageText) {
        const chatBox = document.getElementById('chatBox');

        const thinkingMsgId = `thinking_${Date.now()}`;
        const thinkingMessage = { id: thinkingMsgId, type: 'system', content: `${contact.name} 正在思考...`, timestamp: new Date().toISOString(), sender: targetId, isThinking: true };
        MessageManager.displayMessage(thinkingMessage, false);
        let thinkingElement = chatBox.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);

        // 辅助函数，用于移除“正在思考”消息
        const removeThinkingMessage = () => {
            if (thinkingElement && thinkingElement.parentNode) {
                thinkingElement.remove();
                thinkingElement = null; // 防止重复移除
            }
        };

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

            // FIX START: 在将历史记录发送给 AI 之前，从中删除当前正在发送的用户消息，以避免重复。
            // 这个问题在 MCP 流程和标准流程中都存在。
            // 我们通过检查历史记录中的最后一条消息是否与当前发送的消息匹配来做到这一点。
            if (chatHistory.length > 0) {
                const lastMessageInHistory = chatHistory[chatHistory.length - 1];
                if (lastMessageInHistory.sender === UserManager.userId && lastMessageInHistory.content === messageText) {
                    chatHistory.pop(); // 从历史记录中移除该消息
                    Utils.log(`sendAiMessage: 从上下文中移除了重复的触发消息: "${messageText.substring(0, 30)}..."`, Utils.logLevels.DEBUG);
                }
            }
            // FIX END

            // ================== MCP 流程开始 ==================
            if (contact.aiConfig?.mcp_enabled && typeof MCP_TOOLS !== 'undefined') {
                // 1. 获取工具分析 (非流式)
                const analysisMessages = this._buildMcpAnalysisPrompt(contact, chatHistory, messageText);
                const analysisRequestBody = {
                    model: effectiveConfig.model, messages: analysisMessages, stream: false,
                    temperature: 0.0, // 低温以获得可预测的JSON输出
                    max_tokens: 512 // 限制token，因为只需要JSON
                };

                const analysisResponse = await fetch(effectiveConfig.apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                    body: JSON.stringify(analysisRequestBody)
                });

                if (!analysisResponse.ok) throw new Error(`MCP分析请求失败: ${analysisResponse.status}`);

                // 修复：处理服务器可能错误地以流格式返回非流请求的问题
                const rawTextResult = await analysisResponse.text();
                let jsonStringResult = rawTextResult.trim();
                // 移除 SSE 的 "data: " 前缀
                if (jsonStringResult.startsWith('data: ')) {
                    jsonStringResult = jsonStringResult.substring('data: '.length).trim();
                }
                // 移除可能的 "[DONE]" 标记
                if (jsonStringResult.endsWith('[DONE]')) {
                    jsonStringResult = jsonStringResult.substring(0, jsonStringResult.lastIndexOf('[DONE]')).trim();
                }
                // 为确保健壮性，提取第一个 '{' 和最后一个 '}' 之间的内容
                const firstBraceIndex = jsonStringResult.indexOf('{');
                const lastBraceIndex = jsonStringResult.lastIndexOf('}');
                if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
                    jsonStringResult = jsonStringResult.substring(firstBraceIndex, lastBraceIndex + 1);
                }

                const analysisResult = JSON.parse(jsonStringResult);
                const aiContent = analysisResult.choices[0].message.content;

                // 2. 解析AI响应以查找工具调用
                let toolCall;
                try {
                    const parsedContent = JSON.parse(aiContent);
                    if (parsedContent.tool_call) {
                        toolCall = parsedContent.tool_call;
                    }
                } catch (e) {
                    // AI回复不是JSON，或JSON格式不符 -> 作为普通消息处理
                    removeThinkingMessage();
                    const finalAiMessage = { id: `ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: targetId, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                    return; // MCP流程结束
                }

                // 3. 如果是工具调用，则执行
                if (toolCall) {
                    removeThinkingMessage();

                    // 显示临时的“正在调用工具”消息
                    const toolUseMsgId = `system_tool_${Date.now()}`;
                    const toolUseMsg = { id: toolUseMsgId, type: 'system', content: `正在调用工具: ${toolCall.name}...`, timestamp: new Date().toISOString(), sender: targetId, isThinking: true }; // 标记为临时消息
                    MessageManager.displayMessage(toolUseMsg, false);
                    let toolUseMsgElement = chatBox.querySelector(`.message[data-message-id="${toolUseMsgId}"]`);

                    const toolResult = await this._executeMcpTool(toolCall.name, toolCall.arguments);

                    // 移除临时的“正在调用工具”消息
                    if (toolUseMsgElement && toolUseMsgElement.parentNode) {
                        toolUseMsgElement.remove();
                    }

                    if (toolResult.error) {
                        throw new Error(`工具调用错误: ${toolResult.error}`);
                    }

                    // 4. 第二次调用获取最终答案 (流式)
                    const finalMessages = this._buildMcpFinalPrompt(contact, messageText, toolCall, toolResult.data);
                    const finalRequestBody = {
                        model: effectiveConfig.model, messages: finalMessages, stream: true,
                        temperature: 0.1, max_tokens: effectiveConfig.maxTokens || 2048,
                        user: UserManager.userId, character_id: targetId
                    };

                    // 使用现有的流式处理逻辑
                    const aiMessageId = `ai_stream_${Date.now()}`;
                    let fullAiResponseContent = "";
                    const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
                    MessageManager.displayMessage(initialAiMessage, false);
                    let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                    ChatManager.addMessage(targetId, initialAiMessage);

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
                    return; // MCP流程结束
                } else {
                    // 是合法JSON但不是工具调用，同样作为普通消息处理
                    removeThinkingMessage();
                    const finalAiMessage = { id: `ai_msg_${Date.now()}`, type: 'text', content: aiContent, timestamp: new Date().toISOString(), sender: targetId, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                    return; // MCP流程结束
                }
            }
            // ================== MCP 流程结束 ==================

            // 如果不是MCP角色，执行原有逻辑
            removeThinkingMessage(); // 先移除思考消息，流式处理会创建自己的消息

            const recentMessages = chatHistory; // 使用已经修复过的 chatHistory
            const contextMessagesForAIHistory = recentMessages.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));

            const messagesForRequestBody = [];
            let baseSystemPrompt = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "";

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
            removeThinkingMessage();
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
        const thinkingMsgId = `group_thinking_${aiContactId}_${Date.now()}`;
        const thinkingMessage = {
            id: thinkingMsgId, type: 'system',
            content: `${aiContact.name} (在群组 ${group.name} 中) 正在思考...`,
            timestamp: new Date().toISOString(),
            sender: aiContactId,
            groupId: groupId,
            isThinking: true
        };
        ChatManager.addMessage(groupId, thinkingMessage);

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                Utils.log("AiApiHandler.sendGroupAiMessage: AI API 端点未配置。", Utils.logLevels.ERROR);
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            let systemPromptBase = "";
            if (group.aiPrompts && group.aiPrompts[aiContactId] !== undefined && group.aiPrompts[aiContactId].trim() !== "") {
                systemPromptBase = group.aiPrompts[aiContactId];
                Utils.log(`AiApiHandler.sendGroupAiMessage: 使用群组 ${groupId} 中为 AI ${aiContactId} 设置的特定提示词。`, Utils.logLevels.INFO);
            }
            else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined && aiContact.aiConfig.systemPrompt.trim() !== "") {
                systemPromptBase = aiContact.aiConfig.systemPrompt;
                Utils.log(`AiApiHandler.sendGroupAiMessage: 使用 AI ${aiContactId} 在群组 ${groupId} 中的默认提示词。`, Utils.logLevels.INFO);
            }
            else {
                Utils.log(`AiApiHandler.sendGroupAiMessage: AI ${aiContactId} 在群组 ${groupId} 中无特定提示词，也无默认提示词。将仅使用基础群聊提示词。`, Utils.logLevels.WARN);
            }
            const finalSystemPrompt = systemPromptBase + AppSettings.ai.groupPromptSuffix;


            const groupContextWindow = (typeof AppSettings !== 'undefined' && AppSettings.ai && AppSettings.ai.groupAiSessionTime !== undefined)
                ? AppSettings.ai.groupAiSessionTime
                : (3 * 60 * 1000);
            const timeThreshold = new Date().getTime() - groupContextWindow;

            const groupChatHistory = ChatManager.chats[groupId] || [];

            const recentMessages = groupChatHistory.filter(msg =>
                new Date(msg.timestamp).getTime() > timeThreshold &&
                (msg.type === 'text' || (msg.type === 'system' && !msg.isThinking)) &&
                msg.id !== thinkingMsgId &&
                msg.id !== triggeringMessageId
            );

            const contextMessagesForAIHistory = recentMessages.map(msg => {
                let role = 'system';
                let content = msg.content;
                if (msg.sender === aiContactId) {
                    role = 'assistant';
                } else if (msg.sender) {
                    role = 'user';
                    // COMMENT: 对于群聊，必须在用户消息前加上用户名，以便AI能区分不同发言者。
                    // 这是让AI理解群聊上下文的关键步骤。
                    const senderName = UserManager.contacts[msg.sender]?.name || `用户 ${String(msg.sender).substring(0,4)}`;
                    content = `${senderName}: ${msg.content}`;
                }
                return { role: role, content: content };
            });

            const messagesForRequestBody = [];
            messagesForRequestBody.push({ role: "system", content: finalSystemPrompt });
            messagesForRequestBody.push(...contextMessagesForAIHistory);

            const triggeringSenderName = UserManager.contacts[originalSenderId]?.name || `用户 ${String(originalSenderId).substring(0,4)}`;
            const userTriggerMessage = {
                role: 'user',
                content: `${triggeringSenderName}: ${mentionedMessageText} [发送于: ${new Date().toLocaleString()}]`
            };
            messagesForRequestBody.push(userTriggerMessage);

            Utils.log(`AiApiHandler.sendGroupAiMessage: 为 ${aiContact.name} (群组 ${group.name}) 发送 AI 请求。上下文窗口: ${groupContextWindow / 60000} 分钟。`, Utils.logLevels.DEBUG);

            const requestBody = {
                model: effectiveConfig.model,
                messages: messagesForRequestBody,
                stream: true,
                temperature: 0.1,
                max_tokens: effectiveConfig.maxTokens || 2048,
                group_id: groupId,
                character_id: aiContactId
            };
            Utils.log(`发送到群组 AI (${aiContact.name} in ${group.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG);

            const thinkingElementToRemove = document.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);
            if (thinkingElementToRemove && thinkingElementToRemove.parentNode) thinkingElementToRemove.remove();

            const aiResponseMessageId = `group_ai_msg_${aiContactId}_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiResponseMessage = {
                id: aiResponseMessageId, type: 'text', content: "▍",
                timestamp: new Date().toISOString(), sender: aiContactId,
                groupId: groupId, originalSender: aiContactId,
                originalSenderName: aiContact.name, isStreaming: true,
                isNewlyCompletedAIResponse: false
            };
            ChatManager.addMessage(groupId, initialAiResponseMessage);
            let aiMessageElement = null;
            if (ChatManager.currentChatId === groupId) {
                aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiResponseMessageId}"] .message-content`);
            }

            await Utils.fetchApiStream(
                effectiveConfig.apiEndpoint,
                requestBody,
                { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                (jsonChunk) => {
                    const chunkContent = jsonChunk.choices[0].delta.content;
                    fullAiResponseContent += chunkContent;
                    if (aiMessageElement) {
                        aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent + "▍");
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                    ChatManager.addMessage(groupId, {
                        ...initialAiResponseMessage,
                        content: fullAiResponseContent + "▍",
                        isStreaming: true
                    });
                },
                () => {
                    const finalAiResponseMessage = {
                        id: aiResponseMessageId, type: 'text', content: fullAiResponseContent,
                        timestamp: initialAiResponseMessage.timestamp, sender: aiContactId,
                        groupId: groupId, originalSender: aiContactId, originalSenderName: aiContact.name,
                        isStreaming: false, isNewlyCompletedAIResponse: true
                    };
                    ChatManager.addMessage(groupId, finalAiResponseMessage);

                    // COMMENT: 当AI在群聊中完成回复后，需要将这条完整的消息通过WebRTC广播给群内的其他人类成员，
                    // 以确保所有人的聊天记录保持同步。
                    const humanMembers = group.members.filter(id => !UserManager.contacts[id]?.isAI);
                    humanMembers.forEach(memberId => {
                        if (memberId !== originalSenderId && memberId !== UserManager.userId) {
                            ConnectionManager.sendTo(memberId, finalAiResponseMessage);
                        }
                    });
                }
            );

        } catch (error) {
            const thinkingElementToRemove = document.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);
            if (thinkingElementToRemove && thinkingElementToRemove.parentNode) thinkingElementToRemove.remove();

            Utils.log(`在群组 (${group.name}) 中与 AI (${aiContact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`错误: 无法从 ${aiContact.name} (群组内) 获取回复。 ${error.message}`, 'error');
            const errorResponseMessage = {
                id: `group_ai_error_${aiContactId}_${Date.now()}`, type: 'text',
                content: `抱歉，我在群组 (${group.name}) 中回复时遇到了问题: ${error.message}`,
                timestamp: new Date().toISOString(), sender: aiContactId,
                groupId: groupId, originalSender: aiContactId, originalSenderName: aiContact.name
            };
            ChatManager.addMessage(groupId, errorResponseMessage);
            const humanMembers = group.members.filter(id => !UserManager.contacts[id]?.isAI);
            humanMembers.forEach(memberId => {
                if (memberId !== originalSenderId && memberId !== UserManager.userId) {
                    ConnectionManager.sendTo(memberId, errorResponseMessage);
                }
            });
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
                    if (trimmedContent.toLowerCase().includes("ok") && trimmedContent.length < 10) {
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
    handleAiConfigChange: async function() {
        Utils.log("AiApiHandler: AI 配置已更改，正在重新检查服务健康状况...", Utils.logLevels.INFO);
        try {
            const isHealthy = await this.checkAiServiceHealth();
            UserManager.updateAiServiceStatus(isHealthy);
        } catch (e) {
            Utils.log("处理 AI 配置变更时，健康检查出错: " + e.message, Utils.logLevels.ERROR);
            UserManager.updateAiServiceStatus(false);
        }
    }
};