// MODIFIED: MessageManager.js (已翻译为中文)
// - TTS 逻辑已移至 MessageTtsHandler.js
// - displayMessage 现在会调用 MessageTtsHandler
// - 调用 MediaUIManager 的 resetRecordingButtonUI
// - 在 AI API 调用中添加了 user_id 和 character_id
// - 添加了处理来自后端的摘要流的逻辑
const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,
    // _currentlyPlayingTtsAudio 和 _currentlyPlayingTtsButton 现已移至 MessageTtsHandler

    sendMessage: async function () {
        const input = document.getElementById('messageInput');
        const messageText = input.value.trim();
        const currentSelectedFile = MessageManager.selectedFile;
        const currentAudioData = MessageManager.audioData;
        const currentAudioDuration = MessageManager.audioDuration;

        if (!ChatManager.currentChatId) {
            NotificationManager.showNotification('请选择一个聊天以发送消息。', 'warning');
            return;
        }
        const isGroup = ChatManager.currentChatId.startsWith('group_');
        const targetId = ChatManager.currentChatId;
        const contact = UserManager.contacts[targetId];
        const chatBox = document.getElementById('chatBox');

        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                NotificationManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData(); // <- 这将会调用 cancelAudioData
                return;
            }
            if (!messageText) return;

            const userMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString(), sender: UserManager.userId };
            ChatManager.addMessage(targetId, userMessage);
            input.value = ''; input.style.height = 'auto'; input.focus();

            const thinkingMsgId = `thinking_${Date.now()}`;
            const thinkingMessage = { id: thinkingMsgId, type: 'system', content: `${contact.name} 正在思考...`, timestamp: new Date().toISOString(), sender: targetId, isThinking: true };
            MessageManager.displayMessage(thinkingMessage, false);
            let thinkingElement = chatBox.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);

            try {
                const fiveMinutesAgo = new Date().getTime() - (Config.ai.sessionTime);
                const chatHistory = ChatManager.chats[targetId] || [];
                const recentMessages = chatHistory.filter(msg => new Date(msg.timestamp).getTime() > fiveMinutesAgo && msg.type === 'text');
                const contextMessagesForAI = recentMessages.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));
                const aiApiMessages = [{role: "system", content: contact.aiConfig.systemPrompt}, ...contextMessagesForAI];
                for (let i = aiApiMessages.length - 1; i >= 0; i--) {
                    if (aiApiMessages[i].role === 'user') { aiApiMessages[i].content += ` [发送于: ${new Date().toLocaleString()}]`; break; }
                }

                const currentConfigForAIRequest = { endpoint: window.Config.server.apiEndpoint, keyPresent: !!window.Config.server.api_key, model: window.Config.server.model, max_tokens: window.Config.server.max_tokens };
                Utils.log(`MessageManager: 向 ${contact.name} 发送 AI 请求。使用配置: 端点='${currentConfigForAIRequest.endpoint}', 密钥存在=${currentConfigForAIRequest.keyPresent}, 模型='${currentConfigForAIRequest.model}', 最大令牌数=${currentConfigForAIRequest.max_tokens}`, Utils.logLevels.DEBUG);

                const requestBody = {
                    model: currentConfigForAIRequest.model,
                    messages: aiApiMessages,
                    stream: true,
                    temperature: 0.1,
                    max_tokens: currentConfigForAIRequest.max_tokens || 2048,
                    user: UserManager.userId,
                    character_id: targetId
                };
                Utils.log(`正在发送到 AI (${contact.name}) (流式): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG); // 记录最后5条消息

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
                // --- 修改开始 ---
                // 我们只显示初始消息。如果响应不是摘要，它稍后才会被添加到缓存中，
                // 这样可以防止在出现摘要时保存占位符消息。
                MessageManager.displayMessage(initialAiMessage, false);
                let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);

                let isSummaryMode = false;
                let summaryContent = "";
                let summaryMsgId = null;
                let initialMessageAddedToCache = false; // 控制缓存写入的标志
                // --- 修改结束 ---

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                    const {value, done: readerDone} = await reader.read();
                    if (readerDone) { buffer += decoder.decode(); break; }
                    buffer += decoder.decode(value, {stream: true});
                    let stopStreaming = false;
                    if (buffer.trim() === "[DONE]" || buffer.includes("[DONE]")) {
                        buffer = buffer.substring(0, buffer.indexOf("[DONE]"));
                        stopStreaming = true;
                    }
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

                                // --- 修改开始 ---
                                if (jsonChunk.status === 'summary') {
                                    isSummaryMode = true;
                                    // 从 UI 中移除占位符消息气泡，它从未被添加到缓存。
                                    if (aiMessageElement) {
                                        const aiMessageBubble = aiMessageElement.closest('.message');
                                        if (aiMessageBubble) aiMessageBubble.remove();
                                    }
                                    // 显示“正在回忆过去的事件...”消息（这是临时的，不缓存）
                                    if (!summaryMsgId) { // 只显示一次
                                        summaryMsgId = `summary_status_${Date.now()}`;
                                        const summaryMessage = { id: summaryMsgId, type: 'system', content: `${contact.name} 正在回忆过去的事件...`, timestamp: new Date().toISOString(), sender: targetId };
                                        MessageManager.displayMessage(summaryMessage, false);
                                    }
                                } else if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                    const chunkContent = jsonChunk.choices[0].delta.content;
                                    if (isSummaryMode) {
                                        // 累积摘要内容，不显示也不缓存。
                                        summaryContent += chunkContent;
                                    } else {
                                        // 这是普通消息。在第一个内容块时将初始占位符添加到缓存。
                                        if (!initialMessageAddedToCache) {
                                            ChatManager.addMessage(targetId, initialAiMessage);
                                            initialMessageAddedToCache = true;
                                        }
                                        fullAiResponseContent += chunkContent;
                                        if (aiMessageElement) { aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍"); chatBox.scrollTop = chatBox.scrollHeight; }
                                    }
                                }
                                // --- 修改结束 ---

                            } catch (e) { Utils.log(`AI 流: 解析 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN); }
                            boundary = endIdx + 1;
                            if (boundary >= buffer.length) buffer = "";
                        } else { buffer = buffer.substring(startIdx); break; }
                    }
                    if (stopStreaming) break;
                }

                // --- 修改开始 ---
                if (isSummaryMode) {
                    Utils.log(`--- 收到关于 [${contact.name}] 的摘要 (未缓存) ---\n${summaryContent}`, Utils.logLevels.INFO);

                    // 从 UI 中移除“正在回忆...”消息
                    if (summaryMsgId) {
                        const summaryElement = chatBox.querySelector(`.message[data-message-id="${summaryMsgId}"]`);
                        if (summaryElement) summaryElement.remove();
                    }

                    // 使用摘要作为上下文发起新的 AI 调用
                    try {
                        const newAiApiMessages = [
                            { role: "system", content: contact.aiConfig.systemPrompt },
                            { role: "system", content: `上下文摘要:\n${summaryContent}` },
                            { role: "user", content: `${messageText} [发送于: ${new Date().toLocaleString()}]` }
                        ];

                        const newRequestBody = {
                            model: currentConfigForAIRequest.model,
                            messages: newAiApiMessages,
                            stream: true,
                            temperature: 0.1,
                            max_tokens: currentConfigForAIRequest.max_tokens || 2048,
                            user: UserManager.userId,
                            character_id: targetId
                        };
                        Utils.log(`正在使用摘要上下文重新发送到 AI (${contact.name}) (流式): ${JSON.stringify(newRequestBody.messages)}`, Utils.logLevels.DEBUG);

                        const summaryResponse = await fetch(currentConfigForAIRequest.endpoint, {
                            method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': window.Config.server.api_key }, body: JSON.stringify(newRequestBody)
                        });

                        if (!summaryResponse.ok) {
                            const errorData = await summaryResponse.text();
                            Utils.log(`基于摘要的请求出现 AI API 错误 (${summaryResponse.status}) for ${contact.name}: ${errorData}`, Utils.logLevels.ERROR);
                            throw new Error(`在摘要后，针对 ${contact.name} 的 API 请求失败，状态码 ${summaryResponse.status}。`);
                        }

                        // 现在，为最终响应创建并缓存新消息
                        const newAiMessageId = `ai_stream_${Date.now()}`;
                        let newFullAiResponseContent = "";
                        const newInitialAiMessage = { id: newAiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
                        ChatManager.addMessage(targetId, newInitialAiMessage);
                        let newAiMessageElement = chatBox.querySelector(`.message[data-message-id="${newAiMessageId}"] .message-content`);
                        if (!newAiMessageElement) { MessageManager.displayMessage(newInitialAiMessage, false); newAiMessageElement = chatBox.querySelector(`.message[data-message-id="${newAiMessageId}"] .message-content`); }

                        const summaryReader = summaryResponse.body.getReader();
                        const summaryDecoder = new TextDecoder();
                        let summaryBuffer = "";
                        while (true) {
                            const { value, done: readerDone } = await summaryReader.read();
                            if (readerDone) { summaryBuffer += summaryDecoder.decode(); break; }
                            summaryBuffer += summaryDecoder.decode(value, { stream: true });
                            let stopStreaming = false;
                            if (summaryBuffer.trim() === "[DONE]" || summaryBuffer.includes("[DONE]")) {
                                summaryBuffer = summaryBuffer.substring(0, summaryBuffer.indexOf("[DONE]"));
                                stopStreaming = true;
                            }
                            let boundary = 0;
                            while (boundary < summaryBuffer.length) {
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
                                            const chunkContent = jsonChunk.choices[0].delta.content;
                                            newFullAiResponseContent += chunkContent;
                                            if (newAiMessageElement) { newAiMessageElement.innerHTML = MessageManager.formatMessageText(newFullAiResponseContent + "▍"); chatBox.scrollTop = chatBox.scrollHeight; }
                                        }
                                    } catch (e) { Utils.log(`AI 摘要响应流: 解析 JSON 出错: ${e}. 缓冲区: ${summaryBuffer.substring(0, 100)}`, Utils.logLevels.WARN); }
                                    boundary = endIdx + 1;
                                    if (boundary >= summaryBuffer.length) summaryBuffer = "";
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
                } else {
                    // 这是非摘要响应的原始流程
                    if (aiMessageElement) aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent);
                    // 用最终内容更新缓存中的消息。
                    const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                    ChatManager.addMessage(targetId, finalAiMessage);
                }
                // --- 修改结束 ---

            } catch (error) {
                if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();
                Utils.log(`与 AI (${contact.name}) 通信时出错: ${error}`, Utils.logLevels.ERROR);
                NotificationManager.showNotification(`错误: 无法从 ${contact.name} 获取回复。`, 'error');
                ChatManager.addMessage(targetId, { type: 'text', content: `抱歉，发生了一个错误: ${error.message}`, timestamp: new Date().toISOString(), sender: targetId });
            }
            return;
        }

        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || currentSelectedFile || currentAudioData) {
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showReconnectPrompt(targetId, () => Utils.log("已重新连接，请重新发送消息。", Utils.logLevels.INFO));
                return;
            }
        }
        if (!messageText && !currentSelectedFile && !currentAudioData) return;

        let messageSent = false;
        if (currentAudioData) {
            const audioMessage = { type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage); else ConnectionManager.sendTo(targetId, audioMessage);
            ChatManager.addMessage(targetId, {...audioMessage, sender: UserManager.userId});
            messageSent = true; MessageManager.cancelAudioData(); // <- 这将会调用 cancelAudioData
        }
        if (currentSelectedFile) {
            const fileMessage = { type: 'file', fileId: `${Date.now()}-${Utils.generateId(6)}`, fileName: currentSelectedFile.name, fileType: currentSelectedFile.type, fileSize: currentSelectedFile.size, data: currentSelectedFile.data, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, fileMessage); else ConnectionManager.sendTo(targetId, fileMessage);
            ChatManager.addMessage(targetId, {...fileMessage, sender: UserManager.userId});
            messageSent = true; MessageManager.cancelFileData();
        }
        if (messageText) {
            const textMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, textMessage); else ConnectionManager.sendTo(targetId, textMessage);
            ChatManager.addMessage(targetId, {...textMessage, sender: UserManager.userId});
            messageSent = true; input.value = ''; input.style.height = 'auto';
        }
        if (messageSent) input.focus();
    },

    displayMessage: function (message, isSentByMe) {
        // ... (displayMessage 代码保持不变)
        const chatBox = document.getElementById('chatBox');
        let msgDiv = null, mainContentWrapper = null, contentElement = null;
        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender];
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts;

        if (msgDiv) { // 更新现有消息
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
        } else { // 创建新消息
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
            if (message.id) msgDiv.setAttribute('data-message-id', message.id);
            if (message.sender) msgDiv.setAttribute('data-sender-id', message.sender);
        }
        if (message.type === 'system') {
            msgDiv.classList.add('system');
            if (message.isThinking) {
                msgDiv.classList.add('thinking');
            }
        }

        let initialHtmlStructure = '';
        if (!contentElement) {
            let senderNameHtml = '';
            if (!isSentByMe && message.type !== 'system') {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender).substring(0, 4)}`);
                if (ChatManager.currentChatId?.startsWith('group_') || (senderContact?.isSpecial)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml;
            let messageBodyHtml = '';
            const textContent = message.content;
            const showStreamingCursor = isAIMessage && message.isStreaming;

            switch (message.type) {
                case 'text':
                    messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""))}</div></div>`;
                    break;
                case 'audio':
                    messageBodyHtml = `<div class="voice-message"><button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button><span class="voice-duration">${Utils.formatTime(message.duration)}</span></div>`;
                    break;
                case 'file':
                    const safeFileName = Utils.escapeHtml(message.fileName || 'file');
                    if (message.fileType?.startsWith('image/')) messageBodyHtml = `<img src="${message.data}" alt="${safeFileName}" class="file-preview-img" onclick="UIManager.showFullImage('${message.data}', '${safeFileName}')">`;
                    else if (message.fileType?.startsWith('video/')) messageBodyHtml = `<video controls class="file-preview-video" style="max-width:100%;"><source src="${message.data}" type="${message.fileType}"></video><div>${safeFileName}</div>`;
                    else if (message.fileType?.startsWith('audio/')) messageBodyHtml = `<div class="file-info"><span class="file-icon">🎵</span><div class="file-details"><div class="file-name">${safeFileName}</div><audio controls src="${message.data}" style="width:100%"></audio></div></div>`;
                    else messageBodyHtml = `<div class="file-info"><span class="file-icon">📄</span><div class="file-details"><div class="file-name">${safeFileName}</div><div class="file-meta">${MediaManager.formatFileSize(message.fileSize || 0)}</div></div><a href="${message.data}" download="${safeFileName}" class="download-btn">下载</a></div>`;
                    break;
                case 'system': messageBodyHtml = `<div class="message-content system-text">${this.formatMessageText(textContent)}</div>`; break;
                default: messageBodyHtml = `<div class="message-content">[不支持的类型: ${message.type}]</div>`;
            }
            initialHtmlStructure += messageBodyHtml;
            initialHtmlStructure += `<div class="timestamp">${message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...'}</div>`;
            msgDiv.innerHTML = initialHtmlStructure;
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
            const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt)');
            if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
                if (!message.isThinking && !message.isStreaming) noMsgPlaceholder.remove();
            }
            chatBox.appendChild(msgDiv);
        } else {
            if (contentElement && message.type === 'text') {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }

        if (message.type === 'text' && isAIMessage && ttsConfig?.enabled && !message.isStreaming && message.isNewlyCompletedAIResponse) {
            const textForTts = MessageTtsHandler.cleanTextForTts(message.content);
            if (textForTts && textForTts.trim() !== "" && mainContentWrapper) {
                const ttsId = message.id || `tts_${Date.now()}`;
                MessageTtsHandler.addTtsPlaceholder(mainContentWrapper, ttsId);
                MessageTtsHandler.requestTtsForMessage(textForTts, ttsConfig, mainContentWrapper, ttsId);
            } else {
                Utils.log(`TTS 未为消息 ID ${message.id} 触发: 清理后的文本为空或没有包装器。原文: "${message.content?.substring(0, 50)}..."`, Utils.logLevels.INFO);
            }
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    formatMessageText: function (text) {
        // ... (formatMessageText 代码保持不变)
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text).replace(/ /g, ' ').replace(/▍/g, '<span class="streaming-cursor">▍</span>');
        let linkedText = escapedText.replace(/\n/g, '<br>');
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return linkedText.replace(urlRegex, url => `<a href="${url.replace(/ /g, ' ')}" target="_blank" rel="noopener noreferrer">${url.replace(/ /g, ' ')}</a>`);
    },

    cancelFileData: function () {
        MessageManager.selectedFile = null;
        document.getElementById('filePreviewContainer').innerHTML = '';
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';
    },

    cancelAudioData: function () {
        MessageManager.audioData = null;
        MessageManager.audioDuration = 0;
        document.getElementById('audioPreviewContainer').innerHTML = '';
        MediaManager.releaseAudioResources();
        if (typeof MediaUIManager !== 'undefined') { // 检查 MediaUIManager 是否已定义
            MediaUIManager.resetRecordingButtonUI(); // 改为这个
        } else {
            Utils.log("在 MessageManager.cancelAudioData 中 MediaUIManager 未定义", Utils.logLevels.WARN);
        }
    },

    clearChat: function () {
        if (!ChatManager.currentChatId) {
            NotificationManager.showNotification('未选择要清空的聊天。', 'warning');
            return;
        }
        ModalManager.showConfirmationModal(
            '您确定要清空此聊天中的消息吗？此操作无法撤销。',
            () => {
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) NotificationManager.showNotification('聊天记录已清空。', 'success');
                    else NotificationManager.showNotification('清空聊天记录失败。', 'error');
                });
            }
        );
    },
};