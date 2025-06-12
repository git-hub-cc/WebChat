/**
 * @file MessageManager.js
 * @description 消息管理器，负责处理消息的发送、接收和显示。
 *              它协调文本、文件和语音消息的发送流程，并调用相应的模块（如 AiApiHandler）来处理特定类型的消息。
 *              同时，它也负责将消息渲染到聊天窗口中。
 * @module MessageManager
 * @exports {object} MessageManager - 对外暴露的单例对象，包含消息处理的所有核心方法。
 * @property {function} sendMessage - 从输入框发送消息，处理文本、文件和语音消息。
 * @property {function} displayMessage - 在聊天窗口中显示或更新一条消息。
 * @property {function} cancelFileData - 取消当前已选择但未发送的文件。
 * @property {function} cancelAudioData - 取消当前已录制但未发送的语音。
 * @property {function} clearChat - 触发清空当前聊天记录的确认流程。
 * @dependencies ChatManager, UserManager, ConnectionManager, GroupManager, NotificationManager, AiApiHandler,
 *               MediaManager, MessageTtsHandler, Utils, ModalManager, ChatAreaUIManager
 * @dependents ChatAreaUIManager (绑定发送按钮事件), ChatManager (调用以显示历史消息)
 */
const MessageManager = {
    selectedFile: null, // 暂存待发送的文件
    audioData: null,    // 暂存待发送的音频数据 (Base64)
    audioDuration: 0,   // 暂存待发送的音频时长

    /**
     * 发送消息。根据输入框内容、已选择的文件或已录制的音频，构建并发送消息。
     * @returns {Promise<void>}
     */
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

        // --- AI 消息处理 ---
        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                NotificationManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData();
                return;
            }
            if (!messageText) return;

            // 首先将用户的消息添加到 UI 和缓存
            const userMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString(), sender: UserManager.userId };
            ChatManager.addMessage(targetId, userMessage);
            input.value = ''; input.style.height = 'auto'; input.focus();

            // 将后续的 API 通信委托给 AiApiHandler
            await AiApiHandler.sendAiMessage(targetId, contact, messageText);
            return; // AI 消息处理完毕
        }

        // --- P2P / 群组消息处理 ---
        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            // 如果对方离线，提示用户重连
            if (messageText || currentSelectedFile || currentAudioData) {
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showReconnectPrompt(targetId, () => Utils.log("已重新连接，请重新发送消息。", Utils.logLevels.INFO));
                return;
            }
        }
        if (!messageText && !currentSelectedFile && !currentAudioData) return;

        let messageSent = false;
        // 发送语音消息
        if (currentAudioData) {
            const audioMessage = { type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage); else ConnectionManager.sendTo(targetId, audioMessage);
            ChatManager.addMessage(targetId, {...audioMessage, sender: UserManager.userId});
            messageSent = true; MessageManager.cancelAudioData();
        }
        // 发送文件消息
        if (currentSelectedFile) {
            const fileMessage = { type: 'file', fileId: `${Date.now()}-${Utils.generateId(6)}`, fileName: currentSelectedFile.name, fileType: currentSelectedFile.type, fileSize: currentSelectedFile.size, data: currentSelectedFile.data, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, fileMessage); else ConnectionManager.sendTo(targetId, fileMessage);
            ChatManager.addMessage(targetId, {...fileMessage, sender: UserManager.userId});
            messageSent = true; MessageManager.cancelFileData();
        }
        // 发送文本消息
        if (messageText) {
            const textMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, textMessage); else ConnectionManager.sendTo(targetId, textMessage);
            ChatManager.addMessage(targetId, {...textMessage, sender: UserManager.userId});
            messageSent = true; input.value = ''; input.style.height = 'auto';
        }
        if (messageSent) input.focus();
    },

    /**
     * 在聊天窗口中显示或更新一条消息。
     * @param {object} message - 要显示的消息对象。
     * @param {boolean} isSentByMe - 该消息是否由当前用户发送。
     */
    displayMessage: function (message, isSentByMe) {
        const chatBox = document.getElementById('chatBox');
        let msgDiv = null, mainContentWrapper = null, contentElement = null;
        // 如果消息有 ID，尝试查找并更新现有的 DOM 元素
        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender];
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts;

        if (msgDiv) { // 更新现有消息
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
        } else { // 创建新消息元素
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
        if (!contentElement) { // 如果是新消息，构建完整的 HTML 结构
            let senderNameHtml = '';
            if (!isSentByMe && message.type !== 'system') {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender).substring(0, 4)}`);
                // 在群聊或与特殊联系人聊天时显示发送者名称
                if (ChatManager.currentChatId?.startsWith('group_') || (senderContact?.isSpecial)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml;
            let messageBodyHtml = '';
            const textContent = message.content;
            const showStreamingCursor = isAIMessage && message.isStreaming;

            // 根据消息类型生成不同的 HTML 内容
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

// 移除“暂无消息”的占位符
            const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt)');
            if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
                if (!message.isThinking && !message.isStreaming) noMsgPlaceholder.remove();
            }
            chatBox.appendChild(msgDiv);
        } else { // 如果是更新现有消息（如流式文本）
            if (contentElement && message.type === 'text') {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }

// 如果是 AI 回复且流式传输刚完成，则触发 TTS
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

    /**
     * 格式化消息文本，转换换行符为 <br> 并将 URL 转换为可点击的链接。
     * @param {string} text - 要格式化的原始文本。
     * @returns {string} - 格式化后的 HTML 字符串。
     */
    formatMessageText: function (text) {
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text).replace(/ /g, ' ').replace(/▍/g, '<span class="streaming-cursor">▍</span>');
        let linkedText = escapedText.replace(/\n/g, '<br>');
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return linkedText.replace(urlRegex, url => `<a href="${url.replace(/ /g, ' ')}" target="_blank" rel="noopener noreferrer">${url.replace(/ /g, ' ')}</a>`);
    },

    /**
     * 取消当前已选择但未发送的文件。
     */
    cancelFileData: function () {
        MessageManager.selectedFile = null;
        document.getElementById('filePreviewContainer').innerHTML = '';
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = '';
    },

    /**
     * 取消当前已录制但未发送的语音。
     */
    cancelAudioData: function () {
        MessageManager.audioData = null;
        MessageManager.audioDuration = 0;
        document.getElementById('audioPreviewContainer').innerHTML = '';
        MediaManager.releaseAudioResources();
        if (typeof MediaUIManager !== 'undefined') {
            MediaUIManager.resetRecordingButtonUI();
        } else {
            Utils.log("在 MessageManager.cancelAudioData 中 MediaUIManager 未定义", Utils.logLevels.WARN);
        }
    },

    /**
     * 触发清空当前聊天记录的确认流程。
     */
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