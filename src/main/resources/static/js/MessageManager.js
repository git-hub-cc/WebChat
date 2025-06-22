/**
 * @file MessageManager.js
 * @description 消息管理器，负责处理消息的发送、接收和显示。
 *              它协调文本、文件和语音消息的发送流程，并调用相应的模块（如 AiApiHandler）来处理特定类型的消息。
 *              同时，它也负责将消息渲染到聊天窗口中。
 *              支持消息的本地删除和撤回请求。
 *              新增：在群聊中检测对AI的@提及，并触发AI响应。
 *              文件名过长时，在预览和消息中会进行截断显示。
 *              修复：文件消息现在能正确显示文件大小。
 * @module MessageManager
 * @exports {object} MessageManager - 对外暴露的单例对象，包含消息处理的所有核心方法。
 * @property {function} sendMessage - 从输入框发送消息，处理文本、文件和语音消息。
 * @property {function} displayMessage - 在聊天窗口中显示或更新一条消息。
 * @property {function} cancelFileData - 取消当前已选择但未发送的文件。
 * @property {function} cancelAudioData - 取消当前已录制但未发送的语音。
 * @property {function} clearChat - 触发清空当前聊天记录的确认流程。
 * @property {function} deleteMessageLocally - 本地删除一条消息。
 * @property {function} requestRetractMessage - 请求撤回一条消息。
 * @dependencies ChatManager, UserManager, ConnectionManager, GroupManager, NotificationUIManager, AiApiHandler,
 *               MediaManager, MediaUIManager, MessageTtsHandler, Utils, ModalUIManager, ChatAreaUIManager, UIManager, Config
 * @dependents ChatAreaUIManager (绑定发送按钮事件), ChatManager (调用以显示历史消息)
 */
const MessageManager = {
    selectedFile: null, // 当前选择的文件
    audioData: null,    // 当前录制的音频数据
    audioDuration: 0,   // 当前录制的音频时长

    /**
     * 发送消息。根据输入框内容、已选择的文件或已录制的音频，构建并发送消息。
     * 在群聊中，会检测对AI的@提及并触发AI响应。
     */
    sendMessage: async function () {
        const input = document.getElementById('messageInput');
        const messageText = input.value.trim(); // 获取并去除首尾空格的文本
        const currentSelectedFile = MessageManager.selectedFile;
        const currentAudioData = MessageManager.audioData;
        const currentAudioDuration = MessageManager.audioDuration;

        if (!ChatManager.currentChatId) { // 检查是否已选择聊天
            NotificationUIManager.showNotification('请选择一个聊天以发送消息。', 'warning');
            return;
        }
        const isGroup = ChatManager.currentChatId.startsWith('group_'); // 判断是否为群聊
        const targetId = ChatManager.currentChatId;
        const contact = UserManager.contacts[targetId]; // 获取联系人信息
        const group = isGroup ? GroupManager.groups[targetId] : null; // 获取群组信息
        const nowTimestamp = new Date().toISOString(); // 当前时间戳
        const messageIdBase = `msg_${Date.now()}_${Utils.generateId(4)}`; // 生成基础消息ID

        // 处理与特殊AI联系人的聊天
        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig && !isGroup) {
            if (currentAudioData || currentSelectedFile) { // AI不支持文件/音频
                NotificationUIManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData(); // 取消音频
                if (currentSelectedFile) MessageManager.cancelFileData(); // 取消文件
                return;
            }
            if (!messageText) return; // 无文本则不发送
            const userMessage = { id: messageIdBase, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            await ChatManager.addMessage(targetId, userMessage); // 添加用户消息到聊天
            input.value = ''; input.style.height = 'auto'; input.focus(); // 清空并聚焦输入框
            await AiApiHandler.sendAiMessage(targetId, contact, messageText); // 调用AI处理
            return;
        }

        // 检查与普通联系人的连接状态
        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || currentSelectedFile || currentAudioData) { // 如果有内容但未连接
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showReconnectPrompt(targetId, () => Utils.log("已重新连接，请重新发送消息。", Utils.logLevels.INFO));
                return;
            }
        }
        if (!messageText && !currentSelectedFile && !currentAudioData) return; // 无任何内容则不发送

        let messageSent = false; // 标记是否有消息被实际发送
        let userTextMessageForChat = null;

        // 处理文本消息
        if (messageText) {
            userTextMessageForChat = { id: `${messageIdBase}_text`, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
        }

        // 处理群聊中的AI提及
        if (isGroup && group && messageText) {
            for (const memberId of group.members) { // 遍历群成员
                const memberContact = UserManager.contacts[memberId];
                if (memberContact && memberContact.isAI) { // 如果是AI成员
                    const mentionTag = '@' + memberContact.name; // 构建提及标签
                    // 使用更宽松的正则匹配，允许@后紧跟非单词字符或结尾
                    const mentionRegex = new RegExp(mentionTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$|\\p{P})', 'u');
                    if (messageText.match(mentionRegex)) { // 如果匹配到提及
                        Utils.log(`MessageManager: 检测到对群内AI ${memberContact.name} (${memberContact.id}) 的提及。`, Utils.logLevels.INFO);
                        // 调用AI处理群消息
                        AiApiHandler.sendGroupAiMessage(targetId, group, memberContact.id, messageText, UserManager.userId)
                            .catch(err => Utils.log(`处理群内AI提及 (${memberContact.name}) 时出错: ${err}`, Utils.logLevels.ERROR));
                    }
                }
            }
        }

        // 处理音频消息
        if (currentAudioData) {
            const audioMessage = { id: `${messageIdBase}_audio`, type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage); // 群聊广播
            else ConnectionManager.sendTo(targetId, audioMessage); // 单聊发送
            await ChatManager.addMessage(targetId, audioMessage); // 添加到本地聊天
            messageSent = true; MessageManager.cancelAudioData(); // 取消预览
        }
        // 处理文件消息
        if (currentSelectedFile) {
            const messagePayload = {
                id: `${messageIdBase}_file`, type: 'file', fileId: `${Date.now()}-${Utils.generateId(6)}`, // 文件唯一ID
                fileName: currentSelectedFile.name, fileType: currentSelectedFile.type,
                size: currentSelectedFile.size, // 文件大小
                data: currentSelectedFile.data, // 文件数据 (URL)
                timestamp: nowTimestamp, sender: UserManager.userId
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, messagePayload);
            else ConnectionManager.sendTo(targetId, messagePayload);
            await ChatManager.addMessage(targetId, messagePayload);
            messageSent = true; MessageManager.cancelFileData();
        }

        // 发送最终的文本消息（如果有）
        if (userTextMessageForChat) {
            if (isGroup) GroupManager.broadcastToGroup(targetId, userTextMessageForChat);
            else ConnectionManager.sendTo(targetId, userTextMessageForChat);
            await ChatManager.addMessage(targetId, userTextMessageForChat);
            messageSent = true; input.value = ''; input.style.height = 'auto'; // 清空输入框
        }

        if (messageSent) input.focus(); // 如果发送了消息，则重新聚焦输入框
    },

    /**
     * 在聊天窗口中显示或更新一条消息。
     * @param {object} message - 要显示的消息对象。
     * @param {boolean} [prepend=false] - 是否将消息前置插入（用于加载历史记录）。
     */
    displayMessage: function (message, prepend = false) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) return; // 如果聊天框不存在，则返回

        const isSentByMe = message.sender === UserManager.userId || (message.originalSender && message.originalSender === UserManager.userId);
        let msgDiv = null; // 消息的 DOM 元素
        let mainContentWrapper = null; // 消息内容包装器
        let contentElement = null; // 实际消息内容元素

        // 如果消息有ID，则尝试查找现有的DOM元素进行更新
        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender]; // 获取发送者联系人信息
        const isAIMessage = !isSentByMe && senderContact?.isAI; // 判断是否为AI消息
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts; // 获取AI的TTS配置

        if (msgDiv) { // 如果消息元素已存在 (即更新消息)
            if (message.isRetracted && !msgDiv.classList.contains('retracted')) {
                // 如果消息被撤回且当前DOM未标记为撤回，则清空内容准备显示撤回提示
                msgDiv.innerHTML = '';
            } else { // 否则，获取内容元素以便更新
                mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
                contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
            }
        } else { // 如果消息元素不存在 (即新消息)
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`; // 设置基础类名
            if (message.id) msgDiv.setAttribute('data-message-id', message.id);
            if (message.sender) msgDiv.setAttribute('data-sender-id', message.sender);
            if (message.timestamp) msgDiv.setAttribute('data-timestamp', new Date(message.timestamp).getTime());
        }

        // 根据消息状态添加/移除CSS类
        if (message.type === 'system' || message.isRetracted) {
            msgDiv.classList.add('system');
        } else {
            msgDiv.classList.remove('system');
        }
        if (message.isThinking) msgDiv.classList.add('thinking'); else msgDiv.classList.remove('thinking');
        if (message.isRetracted) msgDiv.classList.add('retracted'); else msgDiv.classList.remove('retracted');
        // 如果是AI角色消息，添加特定类用于主题化
        if (isAIMessage && senderContact?.id) {
            msgDiv.classList.add('character-message', senderContact.id);
        }

        let initialHtmlStructure = ''; // 用于构建消息的HTML结构
        // 如果是新消息或被撤回的消息需要重新构建HTML
        if (!contentElement || (message.isRetracted && msgDiv.innerHTML === '')) {
            let senderNameHtml = ''; // 发送者名称HTML
            if (!isSentByMe && message.type !== 'system' && !message.isRetracted) { // 非自己发送、非系统、非撤回的消息显示发送者名称
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender || '').substring(0, 4)}`);
                // 在群聊或与特殊联系人聊天时显示名称
                if ((message.groupId && ChatManager.currentChatId === message.groupId) || (senderContact?.isSpecial)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml; // 添加发送者名称

            let messageBodyHtml; // 消息主体HTML
            if (message.isRetracted) { // 如果是撤回消息
                let retractedText;
                if (message.retractedBy === UserManager.userId) { // 自己撤回
                    retractedText = "你撤回了一条消息";
                } else { // 他人撤回
                    const retractedName = UserManager.contacts[message.retractedBy]?.name || (message.originalSenderName && message.retractedBy === (message.originalSender || message.sender) ? message.originalSenderName : null) || `用户 ${String(message.retractedBy || message.sender || '').substring(0,4)}`;
                    retractedText = `${Utils.escapeHtml(retractedName)} 撤回了一条消息`;
                }
                messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${Utils.escapeHtml(retractedText)}</div></div>`;
            } else { // 非撤回消息
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming; // 是否显示流式光标
                switch (message.type) { // 根据消息类型构建主体HTML
                    case 'text':
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""))}</div></div>`;
                        break;
                    case 'audio':
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="voice-message"><button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button><span class="voice-duration">${Utils.formatTime(message.duration)}</span></div></div>`;
                        break;
                    case 'file':
                        const originalFileName = message.fileName || '文件';
                        const escapedOriginalFileName = Utils.escapeHtml(originalFileName);
                        const displayFileName = Utils.truncateFileName(escapedOriginalFileName, 10); // 截断文件名
                        const fileSizeForDisplay = message.size || message.fileSize || 0; // 文件大小

                        if (message.fileType?.startsWith('image/')) {
                            messageBodyHtml = `<div class="message-content-wrapper"><img src="${message.data}" alt="${escapedOriginalFileName}" class="file-preview-img" onclick="UIManager.showFullImage('${message.data}', '${escapedOriginalFileName}')" title="${escapedOriginalFileName}"></div>`;
                        } else if (message.fileType?.startsWith('video/')) {
                            messageBodyHtml = `<div class="message-content-wrapper"><video controls class="file-preview-video" style="max-width:100%;" title="${escapedOriginalFileName}"><source src="${message.data}" type="${message.fileType}"></video></div>`;
                        } else if (message.fileType?.startsWith('audio/')) {
                            messageBodyHtml = `<div class="message-content-wrapper"><div class="file-info"><span class="file-icon">🎵</span><div class="file-details"><div class="file-name" title="${escapedOriginalFileName}">${displayFileName}</div><audio controls src="${message.data}" style="width:100%"></audio></div></div></div>`;
                        } else { // 其他文件
                            messageBodyHtml = `<div class="message-content-wrapper"><div class="file-info"><span class="file-icon">📄</span><div class="file-details"><div class="file-name" title="${escapedOriginalFileName}">${displayFileName}</div><div class="file-meta">${MediaManager.formatFileSize(fileSizeForDisplay)}</div></div><a href="${message.data}" download="${escapedOriginalFileName}" class="download-btn">下载</a></div></div>`;
                        }
                        break;
                    case 'user': // 用户加入/离开等系统消息（目前也用 'system'）
                    case 'system': // 系统消息
                        messageBodyHtml = `<div class="message-content system-text">${this.formatMessageText(textContent)}</div>`;
                        break;
                    default: // 不支持的消息类型
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">[不支持的类型: ${message.type}]</div></div>`;
                }
            }
            initialHtmlStructure += messageBodyHtml; // 添加消息主体
            // 添加时间戳
            initialHtmlStructure += `<div class="timestamp">${message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...'}</div>`;
            msgDiv.innerHTML = initialHtmlStructure; // 设置消息元素的HTML
            // 重新获取内容元素，因为innerHTML会重建DOM
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
        } else { // 如果是更新现有消息的文本内容
            if (contentElement && message.type === 'text' && !message.isRetracted) {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }
        // 如果消息被撤回，移除所有可交互元素的功能
        if (message.isRetracted) {
            const actionableElements = msgDiv.querySelectorAll('img[onclick], .play-voice-btn, .download-btn, video[controls], audio[controls]');
            actionableElements.forEach(el => {
                if (el.tagName === 'IMG' || el.classList.contains('play-voice-btn') || el.classList.contains('download-btn')) {
                    el.onclick = null; // 移除点击事件
                    if (el.tagName === 'A') el.removeAttribute('href'); // 移除下载链接
                } else if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
                    el.removeAttribute('controls'); el.removeAttribute('src'); // 移除播放控件和源
                    if (el.srcObject) el.srcObject = null; // 清理 MediaStream
                }
            });
            msgDiv.style.cursor = 'default'; // 重置光标
        }
        // 处理AI消息的TTS
        if (message.type === 'text' && isAIMessage && ttsConfig?.enabled && !message.isStreaming && message.isNewlyCompletedAIResponse && !message.isRetracted) {
            const textForTts = MessageTtsHandler.cleanTextForTts(message.content); // 清理文本
            if (textForTts && textForTts.trim() !== "" && mainContentWrapper) { // 如果文本有效且有容器
                const ttsId = message.id || `tts_${Date.now()}`; // 生成TTS ID
                MessageTtsHandler.addTtsPlaceholder(mainContentWrapper, ttsId); // 添加加载占位符
                MessageTtsHandler.requestTtsForMessage(textForTts, ttsConfig, mainContentWrapper, ttsId); // 请求TTS
            } else {
                Utils.log(`TTS 未为消息 ID ${message.id} 触发: 清理后的文本为空或没有包装器。原文: "${message.content?.substring(0, 50)}..."`, Utils.logLevels.INFO);
            }
        }
        // 移除“暂无消息”等占位符
        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt):not(.retracted):not([class*="loading-indicator"])');
        if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
            if (!message.isThinking && !message.isStreaming && !message.isRetracted) { // 仅当不是临时状态消息时移除
                noMsgPlaceholder.remove();
            }
        }
        // 将消息添加到聊天框
        if (!chatBox.contains(msgDiv)) { // 如果消息元素不在聊天框中
            if (prepend && chatBox.firstChild) { // 如果是前置插入
                chatBox.insertBefore(msgDiv, chatBox.firstChild);
            } else { // 否则追加到底部
                chatBox.appendChild(msgDiv);
            }
        }
    },

    /**
     * 格式化消息文本，转换换行符为 <br>，将 URL 转换为可点击的链接，并处理流式光标。
     * @param {string} text - 要格式化的原始文本。
     * @returns {string} - 格式化后的 HTML 字符串。
     */
    formatMessageText: function (text) {
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text); // HTML转义
        escapedText = escapedText.replace(/ {2,}/g, ' '); // 替换多个空格为一个
        escapedText = escapedText.replace(/\n/g, '<br>'); // 换行符转<br>
        escapedText = escapedText.replace(/▍/g, '<span class="streaming-cursor">▍</span>'); // 流式光标
        // URL转链接
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return escapedText.replace(urlRegex, function (url) {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    },

    /**
     * 取消当前已选择但未发送的文件。
     */
    cancelFileData: function () {
        // 如果是 Blob URL，则释放它
        if (MessageManager.selectedFile && MessageManager.selectedFile.data && typeof MessageManager.selectedFile.data === 'string' && MessageManager.selectedFile.data.startsWith('blob:')) {
            URL.revokeObjectURL(MessageManager.selectedFile.data);
        }
        MessageManager.selectedFile = null; // 清空已选文件
        document.getElementById('filePreviewContainer').innerHTML = ''; // 清空预览UI
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = ''; // 重置文件输入框
    },

    /**
     * 取消当前已录制但未发送的语音。
     */
    cancelAudioData: function () {
        MessageManager.audioData = null; // 清空音频数据
        MessageManager.audioDuration = 0; // 清空时长
        document.getElementById('audioPreviewContainer').innerHTML = ''; // 清空预览UI
        MediaManager.releaseAudioResources(); // 释放音频资源
        if (typeof MediaUIManager !== 'undefined') {
            MediaUIManager.resetRecordingButtonUI(); // 重置录音按钮UI
        } else {
            Utils.log("在 MessageManager.cancelAudioData 中 MediaUIManager 未定义", Utils.logLevels.WARN);
        }
    },

    /**
     * 触发清空当前聊天记录的确认流程。
     */
    clearChat: function () {
        if (!ChatManager.currentChatId) { // 检查是否已选择聊天
            NotificationUIManager.showNotification('未选择要清空的聊天。', 'warning');
            return;
        }
        ModalUIManager.showConfirmationModal( // 显示确认对话框
            '您确定要清空此聊天中的消息吗？此操作无法撤销。',
            () => { // 确认回调
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) NotificationUIManager.showNotification('聊天记录已清空。', 'success');
                    else NotificationUIManager.showNotification('清空聊天记录失败。', 'error');
                });
            }
        );
    },

    /**
     * 本地删除一条消息。这仅从当前用户的视图和本地存储中删除，不会通知其他用户。
     * @param {string} messageId - 要删除的消息的ID。
     */
    deleteMessageLocally: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return; // 检查聊天是否存在
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId); // 查找消息索引
        if (messageIndex !== -1) { // 如果找到消息
            ChatManager.chats[chatId].splice(messageIndex, 1); // 从内存中删除
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove(); // 从UI中删除
            }
            ChatManager.saveCurrentChat(); // 保存更改到数据库
            // 更新最后消息预览
            const remainingMessages = ChatManager.chats[chatId];
            let newPreview;
            if (remainingMessages.length > 0) {
                const lastMsg = remainingMessages[remainingMessages.length - 1];
                if (chatId.startsWith('group_')) { newPreview = GroupManager.formatMessagePreview(lastMsg); }
                else { newPreview = UserManager.formatMessagePreview(lastMsg); }
            } else { newPreview = "暂无消息"; }
            if (chatId.startsWith('group_')) { GroupManager.updateGroupLastMessage(chatId, newPreview, false, true); }
            else { UserManager.updateContactLastMessage(chatId, newPreview, false, true); }
            NotificationUIManager.showNotification("消息已删除。", "success");
        } else {
            NotificationUIManager.showNotification("无法找到要删除的消息。", "warning");
        }
    },

    /**
     * 请求撤回一条消息。会向对方或群组发送撤回请求。
     * @param {string} messageId - 要撤回的消息的ID。
     */
    requestRetractMessage: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return; // 检查聊天是否存在
        const message = ChatManager.chats[chatId].find(msg => msg.id === messageId); // 查找消息
        if (!message) { NotificationUIManager.showNotification("无法找到要撤回的消息。", "warning"); return; }
        if (message.sender !== UserManager.userId) { NotificationUIManager.showNotification("只能撤回自己发送的消息。", "error"); return; }
        const messageTime = new Date(message.timestamp).getTime();
        // 检查是否在可撤回时间窗口内
        if (Date.now() - messageTime > Config.ui.messageRetractionWindow) {
            NotificationUIManager.showNotification(`消息已超过${Config.ui.messageRetractionWindow / (60 * 1000)}分钟，无法撤回。`, "warning");
            return;
        }
        const myName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName; // 获取自己的名称
        if (chatId.startsWith('group_')) { // 如果是群聊
            const retractRequest = {
                type: 'group-retract-message-request', originalMessageId: messageId,
                sender: UserManager.userId, originalSender: message.sender, originalSenderName: myName
            };
            const broadcastSuccess = GroupManager.broadcastToGroup(chatId, retractRequest); // 广播撤回请求
            if (broadcastSuccess) { this._updateMessageToRetractedState(messageId, chatId, true, myName); } // 成功则更新本地状态
            else { NotificationUIManager.showNotification("发送群消息撤回请求失败。", "error"); }
        } else { // 如果是单聊
            if (!ConnectionManager.isConnectedTo(chatId)) { // 检查对方是否在线
                NotificationUIManager.showNotification("对方不在线，暂时无法撤回消息。", "warning"); return;
            }
            const retractRequest = {
                type: 'retract-message-request', originalMessageId: messageId,
                sender: UserManager.userId, targetUserId: chatId, senderName: myName
            };
            const sent = ConnectionManager.sendTo(chatId, retractRequest); // 发送撤回请求
            if (sent) { this._updateMessageToRetractedState(messageId, chatId, true, myName); } // 成功则更新本地状态
            else { NotificationUIManager.showNotification("发送消息撤回请求失败。", "error"); }
        }
    },

    /**
     * 内部辅助函数：将指定消息更新为撤回状态，并在UI和本地存储中反映此更改。
     * 此函数被本地撤回操作和接收到他人撤回通知时调用。
     * @param {string} messageId - 要撤回的消息的ID。
     * @param {string} chatId - 消息所在的聊天ID。
     * @param {boolean} isOwnRetraction - 指示是否是当前用户自己执行的撤回操作。
     * @param {string|null} [retractedByName=null] - 撤回者的显示名称（主要用于他人撤回时，若为null则尝试自动获取）。
     * @private
     */
    _updateMessageToRetractedState: function(messageId, chatId, isOwnRetraction, retractedByName = null) {
        if (!ChatManager.chats[chatId]) return; // 检查聊天记录是否存在
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId); // 查找消息索引
        if (messageIndex === -1) return; // 如果消息不存在，则返回

        const originalMessage = ChatManager.chats[chatId][messageIndex]; // 获取原始消息
        let retracterDisplayName;
        // 确定撤回者的显示名称
        if (isOwnRetraction) {
            retracterDisplayName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName || "你";
        } else if(retractedByName) {
            retracterDisplayName = retractedByName;
        } else if (originalMessage.sender) {
            retracterDisplayName = UserManager.contacts[originalMessage.sender]?.name || `用户 ${String(originalMessage.sender).substring(0,4)}`;
        } else {
            retracterDisplayName = "对方"; // 回退名称
        }
        // 构建撤回后的消息对象
        const retractedMessage = {
            ...originalMessage, // 保留部分原始属性
            type: 'system', // 类型变为系统消息
            content: isOwnRetraction ? "你撤回了一条消息" : `${Utils.escapeHtml(retracterDisplayName)} 撤回了一条消息`,
            isRetracted: true, // 标记为已撤回
            retractedBy: isOwnRetraction ? UserManager.userId : (originalMessage.sender || null), // 记录撤回者
            originalType: originalMessage.type, // 保留原始类型
            // 清理文件和媒体相关属性
            data: null, fileId: null, fileName: null, fileType: null, fileSize: null, size: null, duration: null,
            // 重置临时状态
            isNewlyCompletedAIResponse: false, isStreaming: false, isThinking: false
        };
        ChatManager.addMessage(chatId, retractedMessage); // 将撤回后的消息添加到聊天记录 (addMessage会处理更新)
    }
};