/**
 * @file AiApiHandler.js
 * @description 负责处理与后端 AI API 的所有通信，包括构建上下文、发送请求以及处理流式响应和对话摘要。
 *              现在会优先使用用户在设置中配置的 API 参数。
 *              更新：在群聊中处理对 AI 的提及，提示词获取逻辑调整为支持非当前主题定义的AI角色。
 *              修复：在 sendGroupAiMessage 中，从历史记录中排除触发AI调用的用户消息本身，以避免AI上下文中该消息重复。
 *              重构：通用 API 请求逻辑已移至 Utils.fetchApiStream。
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
        const serverConfig = (typeof Config !== 'undefined' && Config && typeof Config.server === 'object' && Config.server !== null)
            ? Config.server
            : {};
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
                // 这个错误现在会在 checkAiServiceHealth 中首先被捕获和记录
                Utils.log("AiApiHandler.sendAiMessage: AI API 端点未配置。请在设置中配置。", Utils.logLevels.ERROR);
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
            const systemPromptBase = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "";
            messagesForRequestBody.push({role: "system", content: systemPromptBase + Config.ai.baseSystemPrompt});


            if (this.activeSummaries[targetId]) {
                Utils.log(`AiApiHandler: 在请求中包含已存储的摘要 (目标: ${targetId})。`, Utils.logLevels.DEBUG);
                messagesForRequestBody.push({ role: "system", content: `上下文摘要:\n${this.activeSummaries[targetId]}` });
            }

            messagesForRequestBody.push(...contextMessagesForAIHistory);

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
                user: UserManager.userId,
                character_id: targetId
            };
            Utils.log(`正在发送到 AI (${contact.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG);

            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove(); // 响应前移除思考消息

            const aiMessageId = `ai_stream_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            MessageManager.displayMessage(initialAiMessage, false);
            let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
            let initialMessageAddedToCache = false;
            let summaryMsgId = null; // 用于存储“正在回忆”消息的ID

            await Utils.fetchApiStream(
                effectiveConfig.apiEndpoint,
                requestBody,
                { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                (jsonChunk, isSummaryModeChunk) => { // onChunkReceived
                    if (isSummaryModeChunk) {
                        if (aiMessageElement) { aiMessageElement.closest('.message')?.remove(); }
                    } else {
                        if (!initialMessageAddedToCache) {
                            ChatManager.addMessage(targetId, initialAiMessage);
                            initialMessageAddedToCache = true;
                        }
                        const chunkContent = jsonChunk.choices[0].delta.content;
                        fullAiResponseContent += chunkContent;
                        if (aiMessageElement) {
                            aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent + "▍");
                            chatBox.scrollTop = chatBox.scrollHeight;
                        }
                    }
                },
                async (finalContent, isSummaryModeEnd, summaryContentEnd) => { // onStreamEnd
                    if (isSummaryModeEnd) {
                        await this._handleSummaryResponse(targetId, contact, messageText, summaryContentEnd, summaryMsgId, chatBox);
                    } else {
                        if (aiMessageElement) aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent);
                        const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                        ChatManager.addMessage(targetId, finalAiMessage);
                    }
                },
                () => { // onSummaryStart
                    summaryMsgId = `summary_status_${Date.now()}`;
                    MessageManager.displayMessage({ id: summaryMsgId, type: 'system', content: `${contact.name} 正在回忆过去的事件...`, timestamp: new Date().toISOString(), sender: targetId }, false);
                }
            );

        } catch (error) {
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();
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
        this.activeSummaries[targetId] = summaryContent;
        Utils.log(`AiApiHandler: 已为联系人 ${targetId} 存储摘要。它将在后续请求中使用。`, Utils.logLevels.DEBUG);

        if (summaryMsgId) chatBox.querySelector(`.message[data-message-id="${summaryMsgId}"]`)?.remove();

        try {
            const effectiveConfig = this._getEffectiveAiConfig();
            if (!effectiveConfig.apiEndpoint) {
                // 这个错误现在会在 checkAiServiceHealth 中首先被捕获和记录
                Utils.log("AiApiHandler._handleSummaryResponse: AI API 端点未配置。", Utils.logLevels.ERROR);
                throw new Error("AI API 端点未配置。请在设置中配置。");
            }

            const systemPromptBase = (contact.aiConfig && contact.aiConfig.systemPrompt) ? contact.aiConfig.systemPrompt : "";
            const newAiApiMessages = [
                { role: "system", content: systemPromptBase + Config.ai.baseSystemPrompt },
                { role: "system", content: `上下文摘要:\n${summaryContent}` },
                { role: "user", content: `${originalMessageText} [发送于: ${new Date().toLocaleString()}]` }
            ];
            const newRequestBody = {
                model: effectiveConfig.model, messages: newAiApiMessages, stream: true,
                temperature: 0.1, max_tokens: effectiveConfig.maxTokens || 2048,
                user: UserManager.userId, character_id: targetId
            };
            Utils.log(`正在使用摘要上下文重新发送到 AI (${contact.name}) (流式): ${JSON.stringify(newRequestBody.messages)}`, Utils.logLevels.DEBUG);

            const newAiMessageId = `ai_stream_${Date.now()}`;
            let newFullAiResponseContent = "";
            const newInitialAiMessage = { id: newAiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            ChatManager.addMessage(targetId, newInitialAiMessage);
            MessageManager.displayMessage(newInitialAiMessage, false);
            let newAiMessageElement = chatBox.querySelector(`.message[data-message-id="${newAiMessageId}"] .message-content`);

            await Utils.fetchApiStream(
                effectiveConfig.apiEndpoint,
                newRequestBody,
                { 'Content-Type': 'application/json', 'authorization': effectiveConfig.apiKey || "" },
                (jsonChunk) => { // onChunkReceived (摘要后不应再有摘要模式)
                    const chunkContent = jsonChunk.choices[0].delta.content;
                    newFullAiResponseContent += chunkContent;
                    if (newAiMessageElement) {
                        newAiMessageElement.innerHTML = Utils.formatMessageText(newFullAiResponseContent + "▍");
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                },
                () => { // onStreamEnd
                    if (newAiMessageElement) newAiMessageElement.innerHTML = Utils.formatMessageText(newFullAiResponseContent);
                    const finalAiMessage = { id: newAiMessageId, type: 'text', content: newFullAiResponseContent, timestamp: newInitialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                }
            );

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
                // 这个错误现在会在 checkAiServiceHealth 中首先被捕获和记录
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
            const finalSystemPrompt = systemPromptBase + Config.ai.baseGroupSystemPrompt;


            const groupContextWindow = (typeof Config !== 'undefined' && Config.ai && Config.ai.groupAiSessionTime !== undefined)
                ? Config.ai.groupAiSessionTime
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
                (jsonChunk) => { // onChunkReceived
                    const chunkContent = jsonChunk.choices[0].delta.content;
                    fullAiResponseContent += chunkContent;
                    if (aiMessageElement) {
                        aiMessageElement.innerHTML = Utils.formatMessageText(fullAiResponseContent + "▍");
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                    ChatManager.addMessage(groupId, {
                        ...initialAiResponseMessage,
                        content: fullAiResponseContent + "▍", // Keep cursor until stream ends
                        isStreaming: true
                    });
                },
                () => { // onStreamEnd
                    const finalAiResponseMessage = {
                        id: aiResponseMessageId, type: 'text', content: fullAiResponseContent,
                        timestamp: initialAiResponseMessage.timestamp, sender: aiContactId,
                        groupId: groupId, originalSender: aiContactId, originalSenderName: aiContact.name,
                        isStreaming: false, isNewlyCompletedAIResponse: true
                    };
                    ChatManager.addMessage(groupId, finalAiResponseMessage);

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


    /**
     * @description 执行针对配置的 AI 服务的健康检查。
     * @returns {Promise<boolean>} 如果服务健康则返回 true，否则返回 false。
     */
    checkAiServiceHealth: async function() {
        const effectiveConfig = this._getEffectiveAiConfig();

        if (!effectiveConfig.apiEndpoint) {
            Utils.log("AiApiHandler: AI API 端点未配置，无法进行健康检查。", Utils.logLevels.ERROR);
            // No NotificationUIManager here, as AppInitializer will update UserManager,
            // which in turn will trigger an EventEmitter event, and ChatAreaUIManager
            // will update the header if an AI chat is active.
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
                (jsonChunk) => { // onChunkReceived
                    if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                        fullStreamedContent += jsonChunk.choices[0].delta.content;
                    }
                },
                () => { // onStreamEnd
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

    /**
     * @description 处理 AI 配置变更事件，重新检查 AI 服务健康状况。
     *              此方法由 AppInitializer 通过 EventEmitter 调用。
     * @returns {Promise<void>}
     */
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