/**
 * @file MessageManager.js
 * @description 消息管理器，负责处理消息的发送、接收和显示。
 *              它协调文本、文件和语音消息的发送流程，并调用相应的模块（如 AiApiHandler）来处理特定类型的消息。
 *              同时，它也负责将消息渲染到聊天窗口中。
 *              支持消息的本地删除和撤回请求。
 * @module MessageManager
 * @exports {object} MessageManager - 对外暴露的单例对象，包含消息处理的所有核心方法。
 * @property {function} sendMessage - 从输入框发送消息，处理文本、文件和语音消息。
 * @property {function} displayMessage - 在聊天窗口中显示或更新一条消息。
 * @property {function} cancelFileData - 取消当前已选择但未发送的文件。
 * @property {function} cancelAudioData - 取消当前已录制但未发送的语音。
 * @property {function} clearChat - 触发清空当前聊天记录的确认流程。
 * @property {function} deleteMessageLocally - 本地删除一条消息。
 * @property {function} requestRetractMessage - 请求撤回一条消息。
 * @dependencies ChatManager, UserManager, ConnectionManager, GroupManager, NotificationManager, AiApiHandler,
 *               MediaManager, MessageTtsHandler, Utils, ModalManager, ChatAreaUIManager, Config
 * @dependents ChatAreaUIManager (绑定发送按钮事件), ChatManager (调用以显示历史消息)
 */
const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,

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
        const nowTimestamp = new Date().toISOString();
        const messageIdBase = `msg_${Date.now()}_${Utils.generateId(4)}`;

        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                NotificationManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData();
                if (currentSelectedFile) MessageManager.cancelFileData();
                return;
            }
            if (!messageText) return;
            const userMessage = { id: messageIdBase, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            ChatManager.addMessage(targetId, userMessage);
            input.value = ''; input.style.height = 'auto'; input.focus();
            await AiApiHandler.sendAiMessage(targetId, contact, messageText); // AiApiHandler会处理AI消息的ID
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
            const audioMessage = { id: `${messageIdBase}_audio`, type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage); else ConnectionManager.sendTo(targetId, audioMessage);
            ChatManager.addMessage(targetId, audioMessage);
            messageSent = true; MessageManager.cancelAudioData();
        }
        if (currentSelectedFile) {
            const messagePayload = {
                id: `${messageIdBase}_file`,
                type: 'file',
                fileId: `${Date.now()}-${Utils.generateId(6)}`, // 保持原有的fileId生成方式
                fileName: currentSelectedFile.name,
                fileType: currentSelectedFile.type,
                fileSize: currentSelectedFile.size,
                data: currentSelectedFile.data,
                timestamp: nowTimestamp,
                sender: UserManager.userId
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, messagePayload); else ConnectionManager.sendTo(targetId, messagePayload);
            ChatManager.addMessage(targetId, messagePayload);
            messageSent = true; MessageManager.cancelFileData();
        }
        if (messageText) {
            const textMessage = { id: `${messageIdBase}_text`, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, textMessage); else ConnectionManager.sendTo(targetId, textMessage);
            ChatManager.addMessage(targetId, textMessage);
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
        if (!chatBox) return;
        let msgDiv = null, mainContentWrapper = null, contentElement = null;
        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender];
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts;

        if (msgDiv) { // 更新现有消息
            // 如果消息要被更新为撤回状态，则强制重绘整个内部HTML
            if (message.isRetracted && !msgDiv.classList.contains('retracted')) {
                msgDiv.innerHTML = ''; // 清空以便重绘
            } else {
                mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
                contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
            }
        } else { // 创建新消息元素
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
            if (message.id) msgDiv.setAttribute('data-message-id', message.id);
            if (message.sender) msgDiv.setAttribute('data-sender-id', message.sender);
            if (message.timestamp) msgDiv.setAttribute('data-timestamp', new Date(message.timestamp).getTime());
        }

        // 更新 classList (这对于已存在的 msgDiv 也很重要，以防状态改变)
        if (message.type === 'system' || message.isRetracted) {
            msgDiv.classList.add('system');
        } else {
            msgDiv.classList.remove('system'); // 确保非系统消息没有 system 类
        }
        if (message.isThinking) msgDiv.classList.add('thinking'); else msgDiv.classList.remove('thinking');
        if (message.isRetracted) msgDiv.classList.add('retracted'); else msgDiv.classList.remove('retracted');


        let initialHtmlStructure = '';
        // 如果是新消息，或者消息从非撤回状态变为撤回状态 (msgDiv.innerHTML 已被清空)
        if (!contentElement || (message.isRetracted && msgDiv.innerHTML === '')) {
            let senderNameHtml = '';
            if (!isSentByMe && message.type !== 'system' && !message.isRetracted) {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender || '').substring(0, 4)}`);
                if (ChatManager.currentChatId?.startsWith('group_') || (senderContact?.isSpecial)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml;
            let messageBodyHtml = '';

            if (message.isRetracted) {
                let retractedText = "消息已撤回";
                if (message.retractedBy === UserManager.userId) {
                    retractedText = "你撤回了一条消息";
                } else {
                    const retracterName = UserManager.contacts[message.retractedBy]?.name ||
                        (message.originalSenderName && message.retractedBy === (message.originalSender || message.sender) ? message.originalSenderName : null) ||
                        `用户 ${String(message.retractedBy || message.sender || '').substring(0,4)}`;
                    retractedText = `${Utils.escapeHtml(retracterName)} 撤回了一条消息`;
                }
                messageBodyHtml = `<div class="message-content-wrapper"><div class.message-content system-text">${Utils.escapeHtml(retractedText)}</div></div>`;
            } else {
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
            }
            initialHtmlStructure += messageBodyHtml;
            initialHtmlStructure += `<div class="timestamp">${message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...'}</div>`;
            msgDiv.innerHTML = initialHtmlStructure;
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');

            const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt):not(.retracted)');
            if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
                if (!message.isThinking && !message.isStreaming && !message.isRetracted) noMsgPlaceholder.remove();
            }
            if (!chatBox.contains(msgDiv)) { // 仅当元素不在DOM中时才添加
                chatBox.appendChild(msgDiv);
            }
        } else { // 更新现有消息 (非撤回状态的流式文本)
            if (contentElement && message.type === 'text' && !message.isRetracted) {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }

        if (message.isRetracted) {
            const actionableElements = msgDiv.querySelectorAll('img[onclick], .play-voice-btn, .download-btn, video[controls], audio[controls]');
            actionableElements.forEach(el => {
                if (el.tagName === 'IMG' || el.classList.contains('play-voice-btn') || el.classList.contains('download-btn')) {
                    el.onclick = null; // 移除点击事件
                    if (el.tagName === 'A') el.removeAttribute('href'); // 移除下载链接
                } else if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
                    el.removeAttribute('controls'); // 移除播放控件
                    el.removeAttribute('src'); // 移除源
                    if (el.srcObject) el.srcObject = null;
                }
            });
            msgDiv.style.cursor = 'default';
        }

        if (message.type === 'text' && isAIMessage && ttsConfig?.enabled && !message.isStreaming && message.isNewlyCompletedAIResponse && !message.isRetracted) {
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
        // Bug 3 Fix: Check if data is an Object URL before revoking
        if (MessageManager.selectedFile && MessageManager.selectedFile.data && typeof MessageManager.selectedFile.data === 'string' && MessageManager.selectedFile.data.startsWith('blob:')) {
            URL.revokeObjectURL(MessageManager.selectedFile.data);
        }
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

    /**
     * 本地删除一条消息。
     * @param {string} messageId - 要删除的消息的ID。
     */
    deleteMessageLocally: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;

        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            ChatManager.chats[chatId].splice(messageIndex, 1);
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
            ChatManager.saveCurrentChat();

            const remainingMessages = ChatManager.chats[chatId];
            let newPreview = "聊天记录已更新";
            if (remainingMessages.length > 0) {
                const lastMsg = remainingMessages[remainingMessages.length - 1];
                if (chatId.startsWith('group_')) {
                    newPreview = GroupManager.formatMessagePreview(lastMsg);
                } else {
                    newPreview = UserManager.formatMessagePreview(lastMsg);
                }
            } else {
                newPreview = "暂无消息";
            }
            if (chatId.startsWith('group_')) {
                GroupManager.updateGroupLastMessage(chatId, newPreview, false, true);
            } else {
                UserManager.updateContactLastMessage(chatId, newPreview, false, true);
            }
            NotificationManager.showNotification("消息已删除。", "success");
        } else {
            NotificationManager.showNotification("无法找到要删除的消息。", "warning");
        }
    },

    /**
     * 请求撤回一条消息。
     * @param {string} messageId - 要撤回的消息的ID。
     */
    requestRetractMessage: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;

        const message = ChatManager.chats[chatId].find(msg => msg.id === messageId);
        if (!message) {
            NotificationManager.showNotification("无法找到要撤回的消息。", "warning");
            return;
        }
        if (message.sender !== UserManager.userId) {
            NotificationManager.showNotification("只能撤回自己发送的消息。", "error");
            return;
        }
        const messageTime = new Date(message.timestamp).getTime();
        if (Date.now() - messageTime > Config.ui.messageRetractionWindow) { // 使用 Config中的值
            NotificationManager.showNotification(`消息已超过${Config.ui.messageRetractionWindow / (60 * 1000)}分钟，无法撤回。`, "warning");
            return;
        }

        const myName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName;

        if (chatId.startsWith('group_')) {
            const retractRequest = {
                type: 'group-retract-message-request',
                originalMessageId: messageId,
                sender: UserManager.userId,
                originalSender: message.sender, // 确保originalSender是消息的原始发送者
                originalSenderName: myName
            };
            const broadcastSuccess = GroupManager.broadcastToGroup(chatId, retractRequest);
            if (broadcastSuccess) {
                this._updateMessageToRetractedState(messageId, chatId, true, myName);
            } else {
                NotificationManager.showNotification("发送群消息撤回请求失败。", "error");
            }
        } else {
            if (!ConnectionManager.isConnectedTo(chatId)) {
                NotificationManager.showNotification("对方不在线，暂时无法撤回消息。", "warning");
                return;
            }
            const retractRequest = {
                type: 'retract-message-request',
                originalMessageId: messageId,
                sender: UserManager.userId,
                targetUserId: chatId,
                senderName: myName // P2P撤回时也发送撤回者名字
            };
            const sent = ConnectionManager.sendTo(chatId, retractRequest);
            if (sent) {
                this._updateMessageToRetractedState(messageId, chatId, true, myName);
            } else {
                NotificationManager.showNotification("发送消息撤回请求失败。", "error");
            }
        }
    },

    /**
     * 将指定消息更新为撤回状态，并在UI和本地存储中反映此更改。
     * @param {string} messageId - 要撤回的消息的ID。
     * @param {string} chatId - 消息所在的聊天ID。
     * @param {boolean} isOwnRetraction - 是否是自己撤回的消息。
     * @param {string} [retractedByName=null] - 撤回者的显示名称（主要用于他人撤回时）。
     * @private
     */
    _updateMessageToRetractedState: function(messageId, chatId, isOwnRetraction, retractedByName = null) {
        if (!ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex === -1) return;

        const originalMessage = ChatManager.chats[chatId][messageIndex];
        let retracterDisplayName = "对方";
        if (isOwnRetraction) {
            retracterDisplayName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName;
        } else if(retractedByName) {
            retracterDisplayName = retractedByName;
        } else if (originalMessage.sender) { // 如果没有提供名字，尝试从原始发送者获取
            retracterDisplayName = UserManager.contacts[originalMessage.sender]?.name || `用户 ${String(originalMessage.sender).substring(0,4)}`;
        }

        // 创建一个新的消息对象，而不是直接修改旧的，以确保 ChatManager.addMessage 能正确处理更新
        const retractedMessage = {
            ...originalMessage,
            type: 'system',
            content: isOwnRetraction ? "你撤回了一条消息" : `${Utils.escapeHtml(retracterDisplayName)} 撤回了一条消息`,
            isRetracted: true,
            retractedBy: isOwnRetraction ? UserManager.userId : (originalMessage.sender || null), // 撤回者
            originalType: originalMessage.type,
            data: null, fileId: null, fileName: null, fileType: null, fileSize: null, duration: null,
            isNewlyCompletedAIResponse: false, // 确保清除AI相关的临时状态
            isStreaming: false,
            isThinking: false
        };

        ChatManager.addMessage(chatId, retractedMessage); // 使用 addMessage 来处理UI和DB更新
    }
};