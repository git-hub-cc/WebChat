/**
 * @file AiApiHandler.js
 * @description 负责处理与后端 AI API 的所有通信，包括构建上下文、发送请求以及处理流式响应和对话摘要。
 *              现在会优先使用用户在设置中配置的 API 参数。
 *              更新：在群聊中处理对 AI 的提及，提示词获取逻辑调整为支持非当前主题定义的AI角色。
 *              修复：在 sendGroupAiMessage 中，从历史记录中排除触发AI调用的用户消息本身，以避免AI上下文中该消息重复。
 * @module AiApiHandler
 * @exports {object} AiApiHandler - 对外暴露的单例对象，包含与 AI 交互的方法。
 * @property {object} activeSummaries - 内部缓存，用于存储每个 AI 联系人的当前活动对话摘要。键为联系人 ID，值为摘要字符串。
 * @property {function} sendAiMessage - 向 AI 联系人发送消息并处理流式响应。
 * @property {function} sendGroupAiMessage - 在群组聊天中处理对 AI 的提及，并获取 AI 的回复。
 * @property {function} checkAiServiceHealth - 执行 AI 服务健康检查。
 * @property {function} handleAiConfigChange - 处理 AI 配置变更，由 AppInitializer 调用。
 * @dependencies UserManager, ChatManager, MessageManager, Config, Utils, NotificationUIManager, EventEmitter, SettingsUIManager, GroupManager
 * @dependents MessageManager (当检测到消息目标是 AI 时调用), AppInitializer (初始化时及配置变更时调用)
 */
const AiApiHandler = {

    /**
     * @description 内部缓存，用于存储每个 AI 联系人的当前活动对话摘要。
     *              键为联系人 ID (targetId)，值为摘要字符串。
     * @type {Object<string, string>}
     */
    activeSummaries: {},

    /**
     * @private
     * @description 获取当前有效的 AI 配置，优先从 localStorage 读取，然后回退到全局 Config，最后到 SettingsUIManager 中的备用默认值。
     * @returns {object} 包含 apiEndpoint, apiKey, model, maxTokens, ttsApiEndpoint 的配置对象。
     */
    _getEffectiveAiConfig: function() {
        const config = {};
        const serverConfig = (typeof window.Config !== 'undefined' && window.Config && typeof window.Config.server === 'object' && window.Config.server !== null)
            ? window.Config.server
            : {};
        // SettingsUIManager.FALLBACK_AI_DEFAULTS 似乎未定义，注释掉以避免潜在错误，或确保其在SettingsUIManager中定义
        // const fallbackDefaults = (typeof SettingsUIManager !== 'undefined' && SettingsUIManager && typeof SettingsUIManager.FALLBACK_AI_DEFAULTS === 'object' && SettingsUIManager.FALLBACK_AI_DEFAULTS !== null)
        //     ? SettingsUIManager.FALLBACK_AI_DEFAULTS
        //     : { apiEndpoint: '', api_key: '', model: 'default-model', max_tokens: 2048, ttsApiEndpoint: '' };
        const fallbackDefaults = { apiEndpoint: '', api_key: '', model: 'default-model', max_tokens: 2048, ttsApiEndpoint: '' };


        config.apiEndpoint = localStorage.getItem('aiSetting_apiEndpoint') || serverConfig.apiEndpoint || fallbackDefaults.apiEndpoint;
        config.apiKey = localStorage.getItem('aiSetting_api_key') || serverConfig.api_key || fallbackDefaults.api_key;
        config.model = localStorage.getItem('aiSetting_model') || serverConfig.model || fallbackDefaults.model;

        const maxTokensStored = localStorage.getItem('aiSetting_max_tokens');
        let parsedMaxTokens = parseInt(maxTokensStored, 10);

        if (maxTokensStored !== null && !isNaN(parsedMaxTokens)) {
            config.maxTokens = parsedMaxTokens;
        } else if (serverConfig.max_tokens !== undefined) {
            config.maxTokens = serverConfig.max_tokens;
        } else {
            config.maxTokens = fallbackDefaults.max_tokens;
        }
        config.ttsApiEndpoint = localStorage.getItem('aiSetting_ttsApiEndpoint') || serverConfig.ttsApiEndpoint || fallbackDefaults.ttsApiEndpoint;

        Utils.log(`_getEffectiveAiConfig: 生效的 AI 配置已使用。端点: ${config.apiEndpoint ? String(config.apiEndpoint).substring(0,30) + '...' : 'N/A'}, 密钥存在: ${!!config.apiKey}, 模型: ${config.model}, TTS 端点: ${config.ttsApiEndpoint ? String(config.ttsApiEndpoint).substring(0,30) + '...' : 'N/A'}`, Utils.logLevels.DEBUG);
        return config;
    },

    /**
     * 向 AI 联系人发送消息并处理流式响应。
     * 此函数会构建必要的上下文历史（可能包括已存储的摘要），发送到配置的 AI API 端点，并实时处理返回的数据流，
     * 将 AI 的回复渲染到聊天窗口中。它还能处理需要生成内容摘要的场景。
     *
     * @param {string} targetId - 目标 AI 联系人的 ID。
     * @param {object} contact - 目标 AI 联系人对象，包含其配置信息。
     * @param {string} messageText - 用户发送的文本消息。
     * @returns {Promise<void>}
     */
    sendAiMessage: async function(targetId, contact, messageText) {
        const chatBox = document.getElementById('chatBox');

        const thinkingMsgId = `thinking_${Date.now()}`;
        const thinkingMessage = { id: thinkingMsgId, type: 'system', content: `${contact.name} 正在思考...`, timestamp: new Date().toISOString(), sender: targetId, isThinking: true };
        MessageManager.displayMessage(thinkingMessage, false);
        let thinkingElement = chatBox.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            const contextWindow = (typeof Config !== 'undefined' && Config.ai && Config.ai.sessionTime !== undefined)
                ? Config.ai.sessionTime
                : (10 * 60 * 1000); // 回退到10分钟
            const timeThreshold = new Date().getTime() - contextWindow;

            const chatHistory = ChatManager.chats[targetId] || [];
            const recentMessages = chatHistory.filter(msg => new Date(msg.timestamp).getTime() > timeThreshold && msg.type === 'text');
            const contextMessagesForAIHistory = recentMessages.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));

            const messagesForRequestBody = [];
            // 使用 contact.aiConfig.systemPrompt 作为基础
            const systemPromptBase = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "";
            messagesForRequestBody.push({role: "system", content: systemPromptBase + Config.ai.baseSystemPrompt});


            if (this.activeSummaries[targetId]) {
                Utils.log(`AiApiHandler: 在请求中包含已存储的摘要 (目标: ${targetId})。`, Utils.logLevels.DEBUG);
                messagesForRequestBody.push({ role: "system", content: `上下文摘要:\n${this.activeSummaries[targetId]}` });
            }

            messagesForRequestBody.push(...contextMessagesForAIHistory);

            // 查找最后一个用户消息并添加时间戳
            for (let i = messagesForRequestBody.length - 1; i >= 0; i--) {
                if (messagesForRequestBody[i].role === 'user') {
                    messagesForRequestBody[i].content = (messagesForRequestBody[i].content || '') + ` [发送于: ${new Date().toLocaleString()}]`;
                    break;
                }
            }

            Utils.log(`AiApiHandler: 向 ${contact.name} 发送 AI 请求。配置: 端点='${effectiveConfig.apiEndpoint}', 密钥存在=${!!effectiveConfig.apiKey}, 模型='${effectiveConfig.model}'`, Utils.logLevels.DEBUG);

            const requestBody = {
                model: effectiveConfig.model,
                messages: messagesForRequestBody,
                stream: true,
                temperature: 0.1,
                max_tokens: effectiveConfig.maxTokens || 2048,
                user: UserManager.userId, // 可选，用于标识请求来源
                character_id: targetId // 新增：角色ID
            };
            Utils.log(`正在发送到 AI (${contact.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG);

            const response = await fetch(effectiveConfig.apiEndpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" }, body: JSON.stringify(requestBody)
            });
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove(); // "正在思考"消息可能会在API响应前被移除

            if (!response.ok) {
                const errorData = await response.text();
                Utils.log(`AI API 错误 (${response.status}) for ${contact.name}: ${errorData}`, Utils.logLevels.ERROR);
                throw new Error(`针对 ${contact.name} 的 API 请求失败，状态码 ${response.status}。`);
            }

            const aiMessageId = `ai_stream_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            MessageManager.displayMessage(initialAiMessage, false); // 初始显示流式光标
            let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);

            let isSummaryMode = false, summaryContent = "", summaryMsgId = null, initialMessageAddedToCache = false;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = ""; // 用于累积未处理完的JSON块
            while (true) {
                const {value, done: readerDone} = await reader.read();
                if (readerDone) { // 流结束
                    // 解码剩余的缓冲区内容（如果有）
                    buffer += decoder.decode(); // 解码最后一部分
                    break;
                }
                buffer += decoder.decode(value, {stream: true}); // 解码当前块，stream:true 表示可能有未完成的多字节字符

                // 检查是否是流式结束标记（如果API使用特定标记）
                let stopStreaming = (buffer.trim() === "[DONE]" || buffer.includes("[DONE]"));
                if (stopStreaming) {
                    buffer = buffer.substring(0, buffer.indexOf("[DONE]")); // 移除结束标记
                }

                // 处理缓冲区中的JSON对象
                let boundary = 0; // 当前处理到的缓冲区的起始位置
                while (boundary < buffer.length) {
                    const startIdx = buffer.indexOf('{', boundary); // 查找下一个JSON对象的开始
                    if (startIdx === -1) { // 当前缓冲区没有完整的JSON对象开始
                        buffer = buffer.substring(boundary); // 保留未处理部分
                        break;
                    }
                    // 查找匹配的 '}' 以确定JSON对象的结束
                    let openBraces = 0;
                    let endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') openBraces++;
                        else if (buffer[i] === '}') {
                            openBraces--;
                            if (openBraces === 0) {
                                endIdx = i;
                                break;
                            }
                        }
                    }

                    if (endIdx !== -1) { // 找到了一个完整的JSON对象
                        const jsonString = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            if (jsonChunk.status === 'summary') { // 处理摘要状态
                                isSummaryMode = true;
                                if (aiMessageElement) { aiMessageElement.closest('.message')?.remove(); } // 移除旧的AI消息元素
                                if (!summaryMsgId) {
                                    summaryMsgId = `summary_status_${Date.now()}`;
                                    MessageManager.displayMessage({ id: summaryMsgId, type: 'system', content: `${contact.name} 正在回忆过去的事件...`, timestamp: new Date().toISOString(), sender: targetId }, false);
                                }
                            } else if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) { // 处理内容块
                                const chunkContent = jsonChunk.choices[0].delta.content;
                                if (isSummaryMode) {
                                    summaryContent += chunkContent;
                                } else {
                                    if (!initialMessageAddedToCache) { // 首次收到内容时，将初始消息加入缓存
                                        ChatManager.addMessage(targetId, initialAiMessage);
                                        initialMessageAddedToCache = true;
                                    }
                                    fullAiResponseContent += chunkContent;
                                    if (aiMessageElement) { // 更新UI
                                        aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍");
                                        chatBox.scrollTop = chatBox.scrollHeight; // 滚动到底部
                                    }
                                }
                            }
                        } catch (e) {
                            Utils.log(`AI 流: 解析 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN);
                        }
                        boundary = endIdx + 1; // 更新处理边界
                        if (boundary >= buffer.length) buffer = ""; // 如果已处理完，清空缓冲区
                    } else { // JSON对象未完整，保留从 '{' 开始的部分
                        buffer = buffer.substring(startIdx);
                        break;
                    }
                }
                if (stopStreaming) break; // 如果是流结束标记，则跳出主循环
            }

            if (isSummaryMode) { // 如果是摘要模式
                await this._handleSummaryResponse(targetId, contact, messageText, summaryContent, summaryMsgId, chatBox);
            } else { // 普通响应模式
                if (aiMessageElement) aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent); // 移除最后的流式光标
                const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                ChatManager.addMessage(targetId, finalAiMessage); // 更新消息缓存
            }

        } catch (error) {
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove(); // 移除“正在思考”
            Utils.log(`与 AI (${contact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`错误: 无法从 ${contact.name} 获取回复。 ${error.message}`, 'error');
            ChatManager.addMessage(targetId, { type: 'text', content: `抱歉，发生了一个错误: ${error.message}`, timestamp: new Date().toISOString(), sender: targetId });
        }
    },

    /**
     * @private
     * 在收到摘要后，处理后续的 AI 请求，并将摘要存储起来供将来使用。
     * 此函数使用收到的摘要作为新的上下文，重新向 AI API 发送用户的原始消息。
     * 同时，它会将这个摘要保存到 `this.activeSummaries` 中，以便后续的 `sendAiMessage` 调用可以利用它。
     *
     * @param {string} targetId - 目标 AI 联系人的 ID。
     * @param {object} contact - 目标 AI 联系人对象。
     * @param {string} originalMessageText - 用户最初发送的文本消息。
     * @param {string} summaryContent - 从 API 收到的上下文摘要。
     * @param {string} summaryMsgId - “正在回忆...”系统消息的 ID，用于移除。
     * @param {HTMLElement} chatBox - 聊天框的 DOM 元素。
     * @returns {Promise<void>}
     */
    _handleSummaryResponse: async function(targetId, contact, originalMessageText, summaryContent, summaryMsgId, chatBox) {
        Utils.log(`--- 收到关于 [${contact.name}] 的摘要 ---\n${summaryContent}`, Utils.logLevels.INFO);
        this.activeSummaries[targetId] = summaryContent; // 存储摘要
        Utils.log(`AiApiHandler: 已为联系人 ${targetId} 存储摘要。它将在后续请求中使用。`, Utils.logLevels.DEBUG);

        if (summaryMsgId) chatBox.querySelector(`.message[data-message-id="${summaryMsgId}"]`)?.remove(); // 移除“正在回忆...”

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            // 构建使用摘要的请求体
            const systemPromptBase = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "";
            const newAiApiMessages = [
                { role: "system", content: systemPromptBase + Config.ai.baseSystemPrompt },
                { role: "system", content: `上下文摘要:\n${summaryContent}` }, // 加入摘要
                { role: "user", content: `${originalMessageText} [发送于: ${new Date().toLocaleString()}]` }
            ];
            const newRequestBody = {
                model: effectiveConfig.model, messages: newAiApiMessages, stream: true,
                temperature: 0.1, max_tokens: effectiveConfig.maxTokens || 2048,
                user: UserManager.userId, character_id: targetId
            };
            Utils.log(`正在使用摘要上下文重新发送到 AI (${contact.name}) (流式): ${JSON.stringify(newRequestBody.messages)}`, Utils.logLevels.DEBUG);

            const summaryResponse = await fetch(effectiveConfig.apiEndpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" }, body: JSON.stringify(newRequestBody)
            });
            if (!summaryResponse.ok) {
                throw new Error(`在摘要后，API 请求失败，状态码 ${summaryResponse.status}。`);
            }

            // 处理流式响应 (与 sendAiMessage 中类似)
            const newAiMessageId = `ai_stream_${Date.now()}`;
            let newFullAiResponseContent = "";
            const newInitialAiMessage = { id: newAiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            ChatManager.addMessage(targetId, newInitialAiMessage); // 先添加空消息到缓存
            MessageManager.displayMessage(newInitialAiMessage, false); // UI上显示流式光标
            let newAiMessageElement = chatBox.querySelector(`.message[data-message-id="${newAiMessageId}"] .message-content`);

            const summaryReader = summaryResponse.body.getReader();
            const summaryDecoder = new TextDecoder();
            let summaryBuffer = "";
            while (true) {
                const { value, done: readerDone } = await summaryReader.read();
                if (readerDone) { summaryBuffer += summaryDecoder.decode(); break; }
                summaryBuffer += summaryDecoder.decode(value, { stream: true });
                let stopStreaming = (summaryBuffer.trim() === "[DONE]" || summaryBuffer.includes("[DONE]"));
                if(stopStreaming) summaryBuffer = summaryBuffer.substring(0, summaryBuffer.indexOf("[DONE]"));

                let boundary = 0;
                while(boundary < summaryBuffer.length) {
                    const startIdx = summaryBuffer.indexOf('{', boundary);
                    if (startIdx === -1) { summaryBuffer = summaryBuffer.substring(boundary); break; }
                    let openBraces = 0, endIdx = -1;
                    for (let i = startIdx; i < summaryBuffer.length; i++) {
                        if (summaryBuffer[i] === '{') openBraces++;
                        else if (summaryBuffer[i] === '}') { openBraces--; if (openBraces === 0) { endIdx = i; break; } }
                    }
                    if (endIdx !== -1) {
                        const jsonString = summaryBuffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                newFullAiResponseContent += jsonChunk.choices[0].delta.content;
                                if (newAiMessageElement) { // 更新UI
                                    newAiMessageElement.innerHTML = MessageManager.formatMessageText(newFullAiResponseContent + "▍");
                                    chatBox.scrollTop = chatBox.scrollHeight;
                                }
                            }
                        } catch (e) {
                            Utils.log(`AI 摘要响应流: 解析 JSON 出错: ${e}.`, Utils.logLevels.WARN);
                        }
                        boundary = endIdx + 1;
                        if(boundary >= summaryBuffer.length) summaryBuffer = "";
                    } else { summaryBuffer = summaryBuffer.substring(startIdx); break; }
                }
                if (stopStreaming) break;
            }

            if (newAiMessageElement) newAiMessageElement.innerHTML = MessageManager.formatMessageText(newFullAiResponseContent); // 移除最后的流式光标
            const finalAiMessage = { id: newAiMessageId, type: 'text', content: newFullAiResponseContent, timestamp: newInitialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
            ChatManager.addMessage(targetId, finalAiMessage); // 更新消息缓存

        } catch (error) {
            Utils.log(`在摘要后与 AI (${contact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`错误: 在摘要后无法从 ${contact.name} 获取回复。 ${error.message}`, 'error');
            ChatManager.addMessage(targetId, { type: 'text', content: `抱歉，在摘要后发生错误: ${error.message}`, timestamp: new Date().toISOString(), sender: targetId });
        }
    },

    /**
     * @description 在群组聊天中处理对 AI 的提及，并获取 AI 的回复。
     *              提示词获取逻辑调整为：群组特定提示词 > AI角色在UserManager中的当前配置 > 默认空提示词。
     * @param {string} groupId - 群组 ID。
     * @param {object} group - 群组对象 (来自 GroupManager.groups[groupId])。
     * @param {string} aiContactId - 被提及的 AI 的 ID。
     * @param {string} mentionedMessageText - 包含提及的完整消息文本。
     * @param {string} originalSenderId - 发送提及消息的用户 ID。
     * @param {string|null} [triggeringMessageId=null] - 触发此AI调用的用户消息的ID，用于从上下文中排除此消息。
     * @returns {Promise<void>}
     */
    sendGroupAiMessage: async function(groupId, group, aiContactId, mentionedMessageText, originalSenderId, triggeringMessageId = null) {
        const aiContact = UserManager.contacts[aiContactId]; // 从 UserManager 获取最新的AI联系人信息
        if (!aiContact || !aiContact.isAI) { // 确保它确实是一个AI
            Utils.log(`AiApiHandler.sendGroupAiMessage: 目标 ${aiContactId} 不是有效的AI联系人。`, Utils.logLevels.WARN);
            return;
        }

        const chatBox = document.getElementById('chatBox');
        const thinkingMsgId = `group_thinking_${aiContactId}_${Date.now()}`;
        const thinkingMessage = {
            id: thinkingMsgId, type: 'system',
            content: `${aiContact.name} (在群组 ${group.name} 中) 正在思考...`,
            timestamp: new Date().toISOString(),
            sender: aiContactId, // 系统消息的发送者设为AI本身
            groupId: groupId, // 标记此消息属于哪个群组
            isThinking: true
        };
        ChatManager.addMessage(groupId, thinkingMessage); // 显示“正在思考”

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            // 获取系统提示词
            let systemPromptBase = "";
            // 优先使用群组特定提示词
            if (group.aiPrompts && group.aiPrompts[aiContactId] !== undefined && group.aiPrompts[aiContactId].trim() !== "") {
                systemPromptBase = group.aiPrompts[aiContactId];
                Utils.log(`AiApiHandler.sendGroupAiMessage: 使用群组 ${groupId} 中为 AI ${aiContactId} 设置的特定提示词。`, Utils.logLevels.INFO);
            }
            // 如果群组特定提示词不存在或为空，则使用AI的默认提示词
            else if (aiContact.aiConfig && aiContact.aiConfig.systemPrompt !== undefined && aiContact.aiConfig.systemPrompt.trim() !== "") {
                systemPromptBase = aiContact.aiConfig.systemPrompt;
                Utils.log(`AiApiHandler.sendGroupAiMessage: 使用 AI ${aiContactId} 在群组 ${groupId} 中的默认提示词。`, Utils.logLevels.INFO);
            }
            // 如果两者都无，则systemPromptBase保持为空字符串 (或由Config.ai.baseGroupSystemPrompt处理)
            else {
                Utils.log(`AiApiHandler.sendGroupAiMessage: AI ${aiContactId} 在群组 ${groupId} 中无特定提示词，也无默认提示词。将仅使用基础群聊提示词。`, Utils.logLevels.WARN);
            }
            // 附加基础群聊提示词
            const finalSystemPrompt = systemPromptBase + Config.ai.baseGroupSystemPrompt;


            // 构建上下文历史
            const groupContextWindow = (typeof Config !== 'undefined' && Config.ai && Config.ai.groupAiSessionTime !== undefined)
                ? Config.ai.groupAiSessionTime
                : (3 * 60 * 1000); // 回退到3分钟
            const timeThreshold = new Date().getTime() - groupContextWindow;

            // 获取在当前提及消息之前的聊天记录
            const groupChatHistory = ChatManager.chats[groupId] || [];

            const recentMessages = groupChatHistory.filter(msg =>
                new Date(msg.timestamp).getTime() > timeThreshold &&
                (msg.type === 'text' || (msg.type === 'system' && !msg.isThinking)) && // 排除思考中的系统消息
                msg.id !== thinkingMsgId && // 排除当前正在思考的消息
                msg.id !== triggeringMessageId // 修复：排除触发此调用的用户消息本身
            );

            const contextMessagesForAIHistory = recentMessages.map(msg => {
                let role = 'system'; // 默认角色
                let content = msg.content;
                if (msg.sender === aiContactId) { // 如果是AI自己的回复
                    role = 'assistant';
                } else if (msg.sender) { // 如果是其他用户或系统消息但有发送者
                    role = 'user';
                    // 为用户消息添加发送者名称前缀，以便AI区分
                    const senderName = UserManager.contacts[msg.sender]?.name || `用户 ${String(msg.sender).substring(0,4)}`;
                    content = `${senderName}: ${msg.content}`;
                }
                // 对于没有明确 sender 的 system 消息，role 保持 'system'
                return { role: role, content: content };
            });

            const messagesForRequestBody = [];
            messagesForRequestBody.push({ role: "system", content: finalSystemPrompt }); // 系统提示词
            messagesForRequestBody.push(...contextMessagesForAIHistory); // 上下文历史

            // 显式添加触发此调用的用户提及消息
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
                // user: originalSenderId, // 可选，用于标识请求来源
                group_id: groupId, // 新增：群组ID
                character_id: aiContactId // 添加character_id
            };
            Utils.log(`发送到群组 AI (${aiContact.name} in ${group.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG);

            const response = await fetch(effectiveConfig.apiEndpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" }, body: JSON.stringify(requestBody)
            });

            // 响应到达后移除“正在思考”
            const thinkingElementToRemove = document.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);
            if (thinkingElementToRemove && thinkingElementToRemove.parentNode) thinkingElementToRemove.remove();


            if (!response.ok) {
                const errorData = await response.text();
                Utils.log(`群组 AI API 错误 (${response.status}) for ${aiContact.name}: ${errorData}`, Utils.logLevels.ERROR);
                throw new Error(`针对 ${aiContact.name} 的群组 AI API 请求失败，状态码 ${response.status}。`);
            }

            const aiResponseMessageId = `group_ai_msg_${aiContactId}_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiResponseMessage = { // AI在群组中的回复消息
                id: aiResponseMessageId,
                type: 'text',
                content: "▍", // 初始流式光标
                timestamp: new Date().toISOString(),
                sender: aiContactId, // 发送者是AI
                groupId: groupId, // 标记属于此群组
                originalSender: aiContactId, // 原始发送者也是AI
                originalSenderName: aiContact.name, // AI的名称
                isStreaming: true,
                isNewlyCompletedAIResponse: false // 初始为false，完成后设为true
            };

            // 将初始的AI回复消息添加到聊天记录（用于非当前聊天或后续更新）
            ChatManager.addMessage(groupId, initialAiResponseMessage);

            // 如果当前正在查看此群聊，则获取DOM元素以实时更新UI
            let aiMessageElement = null;
            if (ChatManager.currentChatId === groupId) {
                aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiResponseMessageId}"] .message-content`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const {value, done: readerDone} = await reader.read();
                if (readerDone) { buffer += decoder.decode(); break; }
                buffer += decoder.decode(value, {stream: true});
                let stopStreaming = (buffer.trim() === "[DONE]" || buffer.includes("[DONE]"));
                if (stopStreaming) buffer = buffer.substring(0, buffer.indexOf("[DONE]"));

                let boundary = 0;
                while (boundary < buffer.length) {
                    const startIdx = buffer.indexOf('{', boundary);
                    if (startIdx === -1) { buffer = buffer.substring(boundary); break; }
                    let openBraces = 0, endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') openBraces++;
                        else if (buffer[i] === '}') { openBraces--; if (openBraces === 0) { endIdx = i; break; } }
                    }
                    if (endIdx !== -1) {
                        const jsonString = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                const chunkContent = jsonChunk.choices[0].delta.content;
                                fullAiResponseContent += chunkContent;
                                if (aiMessageElement) { // 如果在当前聊天UI中，则实时更新
                                    aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍");
                                    chatBox.scrollTop = chatBox.scrollHeight;
                                }
                                // 更新 ChatManager 中的消息记录（即使不在当前UI中也更新，确保数据一致性）
                                ChatManager.addMessage(groupId, {
                                    ...initialAiResponseMessage,
                                    content: fullAiResponseContent + (stopStreaming && boundary >= buffer.length ? "" : "▍"), // 如果是最后一块且已停止流，则不加光标
                                    isStreaming: !(stopStreaming && boundary >= buffer.length) // 更新流状态
                                });
                            }
                        } catch (e) {
                            Utils.log(`群组 AI 流: 解析 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN);
                        }
                        boundary = endIdx + 1;
                        if (boundary >= buffer.length) buffer = "";
                    } else { buffer = buffer.substring(startIdx); break; }
                }
                if (stopStreaming) break;
            }

            // 流结束后，最终更新消息对象
            const finalAiResponseMessage = {
                id: aiResponseMessageId, type: 'text', content: fullAiResponseContent,
                timestamp: initialAiResponseMessage.timestamp, sender: aiContactId,
                groupId: groupId, originalSender: aiContactId, originalSenderName: aiContact.name,
                isStreaming: false, isNewlyCompletedAIResponse: true
            };
            ChatManager.addMessage(groupId, finalAiResponseMessage); // 保存最终消息

            // 将AI的回复广播给群内其他人类成员
            const humanMembers = group.members.filter(id => !UserManager.contacts[id]?.isAI);
            humanMembers.forEach(memberId => {
                if (memberId !== originalSenderId && memberId !== UserManager.userId) { // 不发给触发者和自己 (如果自己是触发者)
                    ConnectionManager.sendTo(memberId, finalAiResponseMessage);
                }
            });


        } catch (error) {
            // 确保移除“正在思考”
            const thinkingElementToRemove = document.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);
            if (thinkingElementToRemove && thinkingElementToRemove.parentNode) thinkingElementToRemove.remove();

            Utils.log(`在群组 (${group.name}) 中与 AI (${aiContact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`错误: 无法从 ${aiContact.name} (群组内) 获取回复。 ${error.message}`, 'error');
            // 发送错误消息到群聊
            const errorResponseMessage = {
                id: `group_ai_error_${aiContactId}_${Date.now()}`,
                type: 'text',
                content: `抱歉，我在群组 (${group.name}) 中回复时遇到了问题: ${error.message}`,
                timestamp: new Date().toISOString(),
                sender: aiContactId, // 错误消息也由AI发送
                groupId: groupId,
                originalSender: aiContactId,
                originalSenderName: aiContact.name
            };
            ChatManager.addMessage(groupId, errorResponseMessage);
            // 将错误消息广播给其他人类成员
            const humanMembers = group.members.filter(id => !UserManager.contacts[id]?.isAI);
            humanMembers.forEach(memberId => {
                if (memberId !== originalSenderId && memberId !== UserManager.userId) {
                    ConnectionManager.sendTo(memberId, errorResponseMessage);
                }
            });
        }
    },


    /**
     * @description 执行针对配置的 AI 服务的健康检查。
     * @returns {Promise<boolean>} 如果服务健康则返回 true，否则返回 false。
     */
    checkAiServiceHealth: async function() {
        const effectiveConfig = this._getEffectiveAiConfig();

        if (!effectiveConfig.apiEndpoint) {
            Utils.log("AiApiHandler: AI API 端点未配置，无法进行健康检查。", Utils.logLevels.ERROR);
            return false;
        }

        // 健康检查请求体
        const healthCheckPayload = {
            model: effectiveConfig.model, // 使用当前配置的模型
            messages: [ { role: "user", content: "回复ok." } ], // 简单的测试消息
            stream: true, // 使用流式响应进行测试，更接近实际使用场景
            max_tokens: 5 // 限制最大令牌数，避免不必要的消耗
        };

        try {
            Utils.log(`AiApiHandler: 正在向 ${effectiveConfig.apiEndpoint} (模型: ${effectiveConfig.model}) 执行健康检查 (流式)`, Utils.logLevels.DEBUG);
            const response = await fetch(effectiveConfig.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': effectiveConfig.apiKey || "" },
                body: JSON.stringify(healthCheckPayload)
            });

            if (!response.ok) {
                Utils.log(`AiApiHandler: AI 服务健康检查失败。状态: ${response.status}`, Utils.logLevels.WARN);
                return false;
            }

            // 解析流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullStreamedContent = ""; // 用于累积流式响应内容

            while (true) {
                const {value, done: readerDone} = await reader.read();
                if (readerDone) { buffer += decoder.decode(); break; } // 流结束
                buffer += decoder.decode(value, {stream: true});
                let stopStreaming = (buffer.trim() === "[DONE]" || buffer.includes("[DONE]"));
                if (stopStreaming) buffer = buffer.substring(0, buffer.indexOf("[DONE]"));
                // 处理缓冲区中的JSON对象 (与sendAiMessage中逻辑类似)
                let boundary = 0;
                while (boundary < buffer.length) {
                    const startIdx = buffer.indexOf('{', boundary);
                    if (startIdx === -1) { buffer = buffer.substring(boundary); break; }
                    let openBraces = 0, endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') openBraces++;
                        else if (buffer[i] === '}') { openBraces--; if (openBraces === 0) { endIdx = i; break; } }
                    }
                    if (endIdx !== -1) {
                        const jsonString = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                fullStreamedContent += jsonChunk.choices[0].delta.content;
                            }
                        } catch (e) {
                            Utils.log(`AI 健康检查流: 解析 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN);
                        }
                        boundary = endIdx + 1;
                        if (boundary >= buffer.length) buffer = "";
                    } else { buffer = buffer.substring(startIdx); break; }
                }
                if (stopStreaming) break;
            }
            const trimmedContent = fullStreamedContent.trim();
            Utils.log(`AI 健康检查流式响应内容: "${trimmedContent}" (长度: ${trimmedContent.length})`, Utils.logLevels.DEBUG);

            // 检查响应内容是否符合预期 (例如，包含 "ok" 且长度较短)
            if (trimmedContent.toLowerCase().includes("ok") && trimmedContent.length < 10) {
                Utils.log("AiApiHandler: AI 服务健康检查成功 (流式)。", Utils.logLevels.INFO);
                return true;
            } else {
                Utils.log(`AiApiHandler: AI 服务健康检查失败 (流式)。内容: "${trimmedContent}", 长度: ${trimmedContent.length}`, Utils.logLevels.WARN);
                return false;
            }
        } catch (error) {
            Utils.log(`AiApiHandler: AI 服务健康检查期间出错: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    },

    /**
     * @description 处理 AI 配置变更事件，重新检查 AI 服务健康状况。
     *              此方法由 AppInitializer 通过 EventEmitter 调用。
     * @returns {Promise<void>}
     */
    handleAiConfigChange: async function() {
        Utils.log("AiApiHandler: AI 配置已更改，正在重新检查服务健康状况...", Utils.logLevels.INFO);
        try {
            const isHealthy = await this.checkAiServiceHealth();
            UserManager.updateAiServiceStatus(isHealthy); // 更新状态，内部会触发事件
            // EventEmitter.emit('aiServiceStatusUpdated'...) is now called within UserManager.updateAiServiceStatus
        } catch (e) {
            Utils.log("处理 AI 配置变更时，健康检查出错: " + e.message, Utils.logLevels.ERROR);
            UserManager.updateAiServiceStatus(false); // 更新状态，内部会触发事件
            // EventEmitter.emit('aiServiceStatusUpdated'...) is now called within UserManager.updateAiServiceStatus
        }
    }
};