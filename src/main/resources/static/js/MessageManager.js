// MessageManager.js

const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,

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

        // AI 消息处理
        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                NotificationManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData();
                return;
            }
            if (!messageText) return;

            // 将用户消息添加到聊天窗口和缓存中
            const userMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString(), sender: UserManager.userId };
            ChatManager.addMessage(targetId, userMessage);
            input.value = ''; input.style.height = 'auto'; input.focus();

            // 将 API 通信委托给 AiApiHandler
            await AiApiHandler.sendAiMessage(targetId, contact, messageText);
            return; // AI 消息处理完毕，提前返回
        }

        // 非 AI 消息处理（P2P/群组）
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
            messageSent = true; MessageManager.cancelAudioData();
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
            MediaUIManager.resetRecordingButtonUI();
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