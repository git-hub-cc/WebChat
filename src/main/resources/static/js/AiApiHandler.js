/**
 * @file AiApiHandler.js
 * @description 负责处理与后端 AI API 的所有通信，包括构建上下文、发送请求以及处理流式响应和对话摘要。
 * @module AiApiHandler
 * @exports {object} AiApiHandler - 对外暴露的单例对象，包含与 AI 交互的方法。
 * @property {object} activeSummaries - 内部缓存，用于存储每个 AI 联系人的当前活动对话摘要。键为联系人 ID，值为摘要字符串。
 * @property {function} sendAiMessage - 向 AI 联系人发送消息并处理流式响应。
 * @dependencies UserManager, ChatManager, MessageManager, Config, Utils, NotificationManager
 * @dependents MessageManager (当检测到消息目标是 AI 时调用)
 */
const AiApiHandler = {

    /**
     * @description 内部缓存，用于存储每个 AI 联系人的当前活动对话摘要。
     *              键为联系人 ID (targetId)，值为摘要字符串。
     * @type {Object<string, string>}
     */
    activeSummaries: {},

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
            const fiveMinutesAgo = new Date().getTime() - (Config.ai.sessionTime);
            const chatHistory = ChatManager.chats[targetId] || [];
            const recentMessages = chatHistory.filter(msg => new Date(msg.timestamp).getTime() > fiveMinutesAgo && msg.type === 'text');
            const contextMessagesForAIHistory = recentMessages.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));

            // 构建最终的请求消息体
            const messagesForRequestBody = [];
            messagesForRequestBody.push({role: "system", content: contact.aiConfig.systemPrompt + Config.ai.baseSystemPrompt});

            // 检查并包含已存储的摘要
            if (this.activeSummaries[targetId]) {
                Utils.log(`AiApiHandler: Including stored summary for ${targetId} in the request.`, Utils.logLevels.DEBUG);
                messagesForRequestBody.push({ role: "system", content: `上下文摘要:\n${this.activeSummaries[targetId]}` });
            }

            messagesForRequestBody.push(...contextMessagesForAIHistory);

            // 遵循原始逻辑：为上下文中的最新用户消息附加上下文时间戳
            for (let i = messagesForRequestBody.length - 1; i >= 0; i--) {
                if (messagesForRequestBody[i].role === 'user') {
                    messagesForRequestBody[i].content = (messagesForRequestBody[i].content || '') + ` [发送于: ${new Date().toLocaleString()}]`;
                    break;
                }
            }

            const currentConfigForAIRequest = { endpoint: window.Config.server.apiEndpoint, keyPresent: !!window.Config.server.api_key, model: window.Config.server.model, max_tokens: window.Config.server.max_tokens };
            Utils.log(`AiApiHandler: 向 ${contact.name} 发送 AI 请求。配置: 端点='${currentConfigForAIRequest.endpoint}', 密钥存在=${currentConfigForAIRequest.keyPresent}, 模型='${currentConfigForAIRequest.model}'`, Utils.logLevels.DEBUG);

            const requestBody = {
                model: currentConfigForAIRequest.model,
                messages: messagesForRequestBody, // 使用构建好的消息数组
                stream: true,
                temperature: 0.1,
                max_tokens: currentConfigForAIRequest.max_tokens || 2048,
                user: UserManager.userId,
                character_id: targetId
            };
            Utils.log(`正在发送到 AI (${contact.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG);

            const response = await fetch(currentConfigForAIRequest.endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': window.Config.server.api_key }, body: JSON.stringify(requestBody)
            });
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();

            if (!response.ok) {
                const errorData = await response.text();
                Utils.log(`AI API 错误 (${response.status}) for ${contact.name}: ${errorData}`, Utils.logLevels.ERROR);
                throw new Error(`针对 ${contact.name} 的 API 请求失败，状态码 ${response.status}。`);
            }

            const aiMessageId = `ai_stream_${Date.now()}`;
            let fullAiResponseContent = "";
            const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            MessageManager.displayMessage(initialAiMessage, false);
            let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);

            let isSummaryMode = false, summaryContent = "", summaryMsgId = null, initialMessageAddedToCache = false;

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
                        if (buffer[i] === '{') openBraces++; else if (buffer[i] === '}') { openBraces--; if (openBraces === 0) { endIdx = i; break; } }
                    }
                    if (endIdx !== -1) {
                        const jsonString = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            if (jsonChunk.status === 'summary') {
                                isSummaryMode = true;
                                if (aiMessageElement) { aiMessageElement.closest('.message')?.remove(); }
                                if (!summaryMsgId) {
                                    summaryMsgId = `summary_status_${Date.now()}`;
                                    MessageManager.displayMessage({ id: summaryMsgId, type: 'system', content: `${contact.name} 正在回忆过去的事件...`, timestamp: new Date().toISOString(), sender: targetId }, false);
                                }
                            } else if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                const chunkContent = jsonChunk.choices[0].delta.content;
                                if (isSummaryMode) {
                                    summaryContent += chunkContent;
                                } else {
                                    if (!initialMessageAddedToCache) {
                                        ChatManager.addMessage(targetId, initialAiMessage);
                                        initialMessageAddedToCache = true;
                                    }
                                    fullAiResponseContent += chunkContent;
                                    if (aiMessageElement) { aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍"); chatBox.scrollTop = chatBox.scrollHeight; }
                                }
                            }
                        } catch (e) { Utils.log(`AI 流: 解析 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN); }
                        boundary = endIdx + 1;
                        if (boundary >= buffer.length) buffer = "";
                    } else { buffer = buffer.substring(startIdx); break; }
                }
                if (stopStreaming) break;
            }

            if (isSummaryMode) {
                await this._handleSummaryResponse(targetId, contact, messageText, summaryContent, summaryMsgId, chatBox);
            } else {
                if (aiMessageElement) aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent);
                const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                ChatManager.addMessage(targetId, finalAiMessage);
            }

        } catch (error) {
            if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();
            Utils.log(`与 AI (${contact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification(`错误: 无法从 ${contact.name} 获取回复。`, 'error');
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
        // 存储收到的摘要
        this.activeSummaries[targetId] = summaryContent;
        Utils.log(`AiApiHandler: Stored summary for contact ${targetId}. It will be used in subsequent requests.`, Utils.logLevels.DEBUG);

        if (summaryMsgId) chatBox.querySelector(`.message[data-message-id="${summaryMsgId}"]`)?.remove();

        try {
            const currentConfigForAIRequest = { endpoint: window.Config.server.apiEndpoint, keyPresent: !!window.Config.server.api_key, model: window.Config.server.model, max_tokens: window.Config.server.max_tokens };
            const newAiApiMessages = [
                { role: "system", content: contact.aiConfig.systemPrompt + Config.ai.baseSystemPrompt },
                { role: "system", content: `上下文摘要:\n${summaryContent}` }, // 使用刚收到的摘要
                { role: "user", content: `${originalMessageText} [发送于: ${new Date().toLocaleString()}]` }
            ];
            const newRequestBody = {
                model: currentConfigForAIRequest.model, messages: newAiApiMessages, stream: true,
                temperature: 0.1, max_tokens: currentConfigForAIRequest.max_tokens || 2048,
                user: UserManager.userId, character_id: targetId
            };
            Utils.log(`正在使用摘要上下文重新发送到 AI (${contact.name}) (流式): ${JSON.stringify(newRequestBody.messages)}`, Utils.logLevels.DEBUG);

            const summaryResponse = await fetch(currentConfigForAIRequest.endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': window.Config.server.api_key }, body: JSON.stringify(newRequestBody)
            });
            if (!summaryResponse.ok) {
                throw new Error(`在摘要后，API 请求失败，状态码 ${summaryResponse.status}。`);
            }

            const newAiMessageId = `ai_stream_${Date.now()}`;
            let newFullAiResponseContent = "";
            const newInitialAiMessage = { id: newAiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
            ChatManager.addMessage(targetId, newInitialAiMessage);
            MessageManager.displayMessage(newInitialAiMessage, false);
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
                        if (summaryBuffer[i] === '{') openBraces++; else if (summaryBuffer[i] === '}') { openBraces--; if (openBraces === 0) { endIdx = i; break; } }
                    }
                    if (endIdx !== -1) {
                        const jsonString = summaryBuffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                newFullAiResponseContent += jsonChunk.choices[0].delta.content;
                                if (newAiMessageElement) { newAiMessageElement.innerHTML = MessageManager.formatMessageText(newFullAiResponseContent + "▍"); chatBox.scrollTop = chatBox.scrollHeight; }
                            }
                        } catch (e) { Utils.log(`AI 摘要响应流: 解析 JSON 出错: ${e}.`, Utils.logLevels.WARN); }
                        boundary = endIdx + 1;
                        if(boundary >= summaryBuffer.length) summaryBuffer = "";
                    } else { summaryBuffer = summaryBuffer.substring(startIdx); break; }
                }
                if (stopStreaming) break;
            }

            if (newAiMessageElement) newAiMessageElement.innerHTML = MessageManager.formatMessageText(newFullAiResponseContent);
            const finalAiMessage = { id: newAiMessageId, type: 'text', content: newFullAiResponseContent, timestamp: newInitialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
            ChatManager.addMessage(targetId, finalAiMessage);

        } catch (error) {
            Utils.log(`在摘要后与 AI (${contact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification(`错误: 在摘要后无法从 ${contact.name} 获取回复。`, 'error');
            ChatManager.addMessage(targetId, { type: 'text', content: `抱歉，在摘要后发生错误: ${error.message}`, timestamp: new Date().toISOString(), sender: targetId });
        }
    }
};