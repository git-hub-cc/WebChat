/**
 * @file MessageManager.js
 * @description 消息管理器，负责处理消息的发送、接收和显示。
 *              它协调文本、文件和语音消息的发送流程，并调用相应的模块（如 AiApiHandler）来处理特定类型的消息。
 *              同时，它也负责将消息渲染到聊天窗口中。
 *              支持消息的本地删除和撤回请求。
 *              新增：在群聊中检测对AI的@提及，并触发AI响应。
 *              文件名过长时，在预览和消息中会进行截断显示。
 *              修复：文件消息现在能正确显示文件大小。
 *              修改: 文件发送时，将Blob存入DB的fileCache，消息体中存储fileHash。显示时按需加载。
 *              修改: 视频文件消息现在点击后全屏播放。
 *              优化: 图片和视频文件消息现在显示缩略图预览。
 *              修复：移除发送消息后对 scrollToLatestMessages 的调用，以防止消息消失。
 *              修复：向 sendGroupAiMessage 传递触发消息的ID，防止AI上下文中重复出现该消息。
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
 *               MediaManager, MediaUIManager, MessageTtsHandler, Utils, ModalUIManager, ChatAreaUIManager, UIManager, Config, DBManager
 * @dependents ChatAreaUIManager (绑定发送按钮事件), ChatManager (调用以显示历史消息)
 */
const MessageManager = {
    selectedFile: null, // 当前选择的文件 { blob, hash, name, type, size, previewUrl }
    audioData: null,    // 当前录制的音频数据 (Data URL)
    audioDuration: 0,   // 当前录制的音频时长

    /**
     * 发送消息。根据输入框内容、已选择的文件或已录制的音频，构建并发送消息。
     * 在群聊中，会检测对AI的@提及并触发AI响应。
     */
    sendMessage: async function () {
        const input = document.getElementById('messageInput');
        const originalMessageText = input.value; // 保留原始输入文本，用于后续判断是否清空
        const messageText = originalMessageText.trim(); // 获取并去除首尾空格的文本
        const currentSelectedFile = MessageManager.selectedFile; // 结构: { blob, hash, name, type, size, previewUrl }
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
            input.value = ''; input.style.height = 'auto'; // 清空输入框
            // AI消息发送后，它会自己更新UI并滚动，所以这里不需要强制scrollToLatest
            await AiApiHandler.sendAiMessage(targetId, contact, messageText);
            input.focus(); // 聚焦输入框
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
                        // 传递 userTextMessageForChat.id 作为 triggeringMessageId
                        const triggeringMsgId = userTextMessageForChat ? userTextMessageForChat.id : null;
                        AiApiHandler.sendGroupAiMessage(targetId, group, memberContact.id, messageText, UserManager.userId, triggeringMsgId)
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
            try {
                await DBManager.setItem('fileCache', {
                    id: currentSelectedFile.hash,
                    fileBlob: currentSelectedFile.blob,
                    metadata: {
                        name: currentSelectedFile.name,
                        type: currentSelectedFile.type,
                        size: currentSelectedFile.size
                    }
                });
                Utils.log(`文件 ${currentSelectedFile.name} (hash: ${currentSelectedFile.hash.substring(0,8)}...) 已存入fileCache。`, Utils.logLevels.INFO);

                const messagePayload = {
                    id: `${messageIdBase}_file`,
                    type: 'file',
                    fileId: currentSelectedFile.hash,
                    fileName: currentSelectedFile.name,
                    fileType: currentSelectedFile.type,
                    size: currentSelectedFile.size,
                    fileHash: currentSelectedFile.hash,
                    timestamp: nowTimestamp,
                    sender: UserManager.userId
                };

                if (isGroup) GroupManager.broadcastToGroup(targetId, messagePayload);
                else ConnectionManager.sendTo(targetId, messagePayload);
                await ChatManager.addMessage(targetId, messagePayload);
                messageSent = true; MessageManager.cancelFileData();
            } catch (dbError) {
                Utils.log(`将文件存入fileCache失败: ${dbError}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification('发送文件失败：无法保存到本地缓存。', 'error');
                MessageManager.cancelFileData();
                return;
            }
        }

        // 发送最终的文本消息（如果有）
        // 这个 addMessage 调用会更新 ChatAreaUIManager._allMessagesForCurrentChat
        if (userTextMessageForChat) {
            if (isGroup) GroupManager.broadcastToGroup(targetId, userTextMessageForChat);
            else ConnectionManager.sendTo(targetId, userTextMessageForChat);
            await ChatManager.addMessage(targetId, userTextMessageForChat);
            messageSent = true;
        }

        if (messageSent) {
            // 如果原始文本消息被发送了，清空输入框
            if (messageText && originalMessageText === input.value) {
                input.value = '';
                input.style.height = 'auto';
            }

            // ChatAreaUIManager.handleNewMessageForCurrentChat (通过 ChatManager.addMessage 调用)
            // 已经处理了新消息的追加和在用户接近底部时的滚动。
            // 此处调用 scrollToLatestMessages() 会导致仅渲染一个批次，使旧消息消失。
            // 因此，移除此显式调用。
            input.focus(); // 聚焦输入框
        }
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
                    case 'audio': // 音频消息仍然使用data URL
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="voice-message"><button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button><span class="voice-duration">${Utils.formatTime(message.duration)}</span></div></div>`;
                        break;
                    case 'file':
                        const originalFileName = message.fileName || '文件';
                        const escapedOriginalFileName = Utils.escapeHtml(originalFileName);
                        const displayFileName = Utils.truncateFileName(escapedOriginalFileName, 10);
                        const fileSizeForDisplay = message.size || message.fileSize || 0;
                        const fileHash = message.fileHash;
                        let fileSpecificContainerClass = "";
                        let initialIconContent = "📄"; // 默认文件图标

                        if (message.fileType?.startsWith('image/')) {
                            fileSpecificContainerClass = "image-preview-container";
                            initialIconContent = "🖼️";
                        } else if (message.fileType?.startsWith('video/')) {
                            fileSpecificContainerClass = "video-preview-container";
                            initialIconContent = "🎬";
                        } else if (message.fileType?.startsWith('audio/')) {
                            fileSpecificContainerClass = "audio-file-container";
                            initialIconContent = "🎵";
                        }

                        // 缩略图占位符 - 将由 _renderThumbnailPreview 异步填充
                        const thumbnailPlaceholderHtml = `<div class="thumbnail-placeholder" data-hash="${fileHash}" data-filename="${escapedOriginalFileName}" data-filetype="${message.fileType}">
                                                             ${initialIconContent}
                                                             ${ (message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/')) ? `<span class="play-overlay-icon">${message.fileType.startsWith('image/') ? '👁️' : '▶'}</span>` : '' }
                                                           </div>`;
                        // 文件详情（名称和大小）
                        const fileDetailsHtml = `
                            <div class="file-details">
                                <div class="file-name" title="${escapedOriginalFileName}">${displayFileName}</div>
                                <div class="file-meta">${MediaManager.formatFileSize(fileSizeForDisplay)}</div>
                            </div>`;

                        // 构建消息主体
                        messageBodyHtml = `
                            <div class="message-content-wrapper">
                                <div class="file-info ${fileSpecificContainerClass}" 
                                     data-hash="${fileHash}" 
                                     data-filename="${escapedOriginalFileName}" 
                                     data-filetype="${message.fileType}"
                                     ${(message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/')) ? 'style="cursor:pointer;"' : ''}>
                                    ${thumbnailPlaceholderHtml}
                                    ${fileDetailsHtml}
                                    
                                </div>`;
                        // 为非图片/视频的音频文件或通用文件添加外部操作按钮
                        if (message.fileType?.startsWith('audio/')) {
                            messageBodyHtml += `<button class="play-media-btn" data-hash="${fileHash}" data-filename="${escapedOriginalFileName}" data-filetype="${message.fileType}">播放</button>`;
                        } else if (!(message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/'))) {
                            messageBodyHtml += `<button class="download-file-btn" data-hash="${fileHash}" data-filename="${escapedOriginalFileName}">下载</button>`;
                        }
                        messageBodyHtml += `</div>`; // 关闭 message-content-wrapper
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

            // 为新创建的文件消息按钮绑定事件
            if (!message.isRetracted && message.type === 'file') {
                const fileInfoContainer = msgDiv.querySelector('.file-info'); // 通用容器
                if (fileInfoContainer && (message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/'))) {
                    fileInfoContainer.addEventListener('click', (e) => {
                        const target = e.currentTarget;
                        if (target.classList.contains('image-preview-container')) {
                            this._handleViewFileClick(target);
                        } else if (target.classList.contains('video-preview-container')) {
                            this._handlePlayVideoFullScreenClick(target);
                        }
                    });
                }

                const playMediaBtn = msgDiv.querySelector('.play-media-btn'); // 音频文件播放按钮
                if (playMediaBtn) playMediaBtn.addEventListener('click', (e) => this._handlePlayMediaClick(e.target));

                const downloadBtn = msgDiv.querySelector('.download-file-btn'); // 通用文件下载按钮
                if (downloadBtn) downloadBtn.addEventListener('click', (e) => this._handleDownloadFileClick(e.target));
            }

        } else { // 如果是更新现有消息的文本内容
            if (contentElement && message.type === 'text' && !message.isRetracted) {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }
        // 如果消息被撤回，移除所有可交互元素的功能
        if (message.isRetracted) {
            const actionableElements = msgDiv.querySelectorAll('.file-info[style*="cursor:pointer"], button.play-media-btn, button.download-file-btn, .play-voice-btn');
            actionableElements.forEach(el => {
                if(el.tagName === 'BUTTON') el.disabled = true;
                el.onclick = null; // 移除点击事件
                el.style.cursor = 'default';
            });
            msgDiv.style.cursor = 'default'; // 重置光标
        }

        // 异步渲染图片/视频缩略图
        if (!message.isRetracted && message.type === 'file' && (message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/'))) {
            this._renderThumbnailPreview(msgDiv, message);
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
     * @private
     * 异步渲染文件消息中的图片或视频缩略图。
     * @param {HTMLElement} messageDiv - 包含消息的 DOM 元素。
     * @param {object} message - 消息对象。
     */
    _renderThumbnailPreview: async function(messageDiv, message) {
        const placeholder = messageDiv.querySelector('.thumbnail-placeholder');
        if (!placeholder) return;

        const fileHash = placeholder.dataset.hash;
        const fileType = placeholder.dataset.filetype;

        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (!cachedItem || !cachedItem.fileBlob) {
                placeholder.textContent = '⚠️';
                placeholder.title = '无法加载预览：文件缓存未找到。';
                Utils.log(`缩略图预览：文件缓存未找到 (hash: ${fileHash})`, Utils.logLevels.WARN);
                return;
            }

            const blob = cachedItem.fileBlob;
            const objectURL = URL.createObjectURL(blob);

            let mediaElement;
            let loadEventName;

            if (fileType.startsWith('image/')) {
                mediaElement = document.createElement('img');
                mediaElement.alt = '图片预览';
                loadEventName = 'load';
            } else if (fileType.startsWith('video/')) {
                mediaElement = document.createElement('video');
                mediaElement.muted = true;
                mediaElement.alt = '视频预览';
                mediaElement.preload = "metadata"; // 提示浏览器仅加载元数据
                loadEventName = 'loadedmetadata';
            } else {
                URL.revokeObjectURL(objectURL);
                return; // 非图片或视频，不处理缩略图
            }

            mediaElement.classList.add('message-thumbnail'); // 用于样式

            const loadPromise = new Promise((resolve, reject) => {
                mediaElement.addEventListener(loadEventName, () => {
                    const dimensions = fileType.startsWith('image/') ?
                        { width: mediaElement.naturalWidth, height: mediaElement.naturalHeight } :
                        { width: mediaElement.videoWidth, height: mediaElement.videoHeight };
                    resolve(dimensions);
                }, { once: true });
                mediaElement.addEventListener('error', () => reject(new Error(`${fileType.startsWith('image/') ? 'Image' : 'Video'} ${loadEventName} error`)), { once: true });
            });

            mediaElement.src = objectURL;
            if (fileType.startsWith('video/')) {
                mediaElement.load(); // 触发视频元数据加载
            }

            try {
                const dimensions = await loadPromise;
                let { width, height } = dimensions;

                if (width === 0 || height === 0) { // 处理尺寸获取失败的情况
                    Utils.log(`缩略图预览：无法获取媒体尺寸 (hash: ${fileHash})`, Utils.logLevels.WARN);
                    width = 150; height = 100; // 默认回退尺寸
                }

                const aspectRatio = width / height;
                const MAX_WIDTH = 150;
                const MAX_HEIGHT = 150;

                if (aspectRatio > 1) { // 宽图
                    mediaElement.style.width = `${MAX_WIDTH}px`;
                    mediaElement.style.height = 'auto';
                } else { // 高图或方形图
                    mediaElement.style.height = `${MAX_HEIGHT}px`;
                    mediaElement.style.width = 'auto';
                }
                // 确保不超过最大尺寸限制，同时保持比例
                mediaElement.style.maxWidth = `${MAX_WIDTH}px`;
                mediaElement.style.maxHeight = `${MAX_HEIGHT}px`;

                placeholder.innerHTML = ''; // 清空占位符内容（如 emoji 图标）
                placeholder.appendChild(mediaElement); // 添加实际的缩略图元素

                // 预览加载并设置好尺寸后，可以释放 Object URL，因为显示的是位图/元数据
                URL.revokeObjectURL(objectURL);

            } catch (error) {
                Utils.log(`加载媒体预览尺寸失败 (hash: ${fileHash}): ${error.message}`, Utils.logLevels.ERROR);
                placeholder.textContent = '⚠️';
                placeholder.title = '预览加载失败。';
                URL.revokeObjectURL(objectURL); // 出错时也释放
            }
        } catch (error) {
            Utils.log(`处理媒体预览失败 (hash: ${fileHash}): ${error.message}`, Utils.logLevels.ERROR);
            placeholder.textContent = '⚠️';
            placeholder.title = '预览生成失败。';
            // 如果 objectURL 在此之前已创建，确保它被释放（但这里可能未创建）
        }
    },


    /**
     * @private
     * 处理文件消息中“查看”按钮（通常是图片）的点击事件。
     * @param {HTMLElement} buttonOrContainerElement - 被点击的按钮或包含data属性的容器元素。
     */
    _handleViewFileClick: async function(buttonOrContainerElement) {
        const fileHash = buttonOrContainerElement.dataset.hash;
        const fileName = buttonOrContainerElement.dataset.filename;
        // const fileType = buttonOrContainerElement.dataset.filetype; // 可选

        if (!fileHash) {
            NotificationUIManager.showNotification("无法查看文件：缺少文件信息。", "error");
            return;
        }
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                UIManager.showFullImage(objectURL, fileName); // UIManager.showFullImage 现在不负责revoke，调用者应确保
                // 注意：由于 UIManager.showFullImage 的 click to close 会立即 remove modal，
                // revokeObjectURL 需要在 modal.remove() 之后执行，或者 showFullImage 内部处理。
                // 为简单起见，这里假设 showFullImage 弹出后用户会关闭，Object URL 生命周期较短。
                // 更安全的做法是 showFullImage 返回一个 Promise，在 Promise resolve 时 revoke。
                // 或者，让 UIManager 负责 revoke，但它需要知道 src 是否为 Object URL。
                // 当前 UIManager.showFullImage 未做此处理，这里暂时依赖浏览器回收，或手动管理。
                // 后续优化：UIManager.showFullImage/showFullVideo 应该接受一个 onclose 回调来执行 revoke。
            } else {
                NotificationUIManager.showNotification("无法查看：文件未在缓存中找到。", "error");
            }
        } catch (error) {
            Utils.log(`查看文件 (hash: ${fileHash}) 出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("查看文件时出错。", "error");
        }
    },

    /**
     * @private
     * 处理视频预览容器的点击事件，用于全屏播放视频。
     * @param {HTMLElement} previewContainerElement - 被点击的视频预览容器元素。
     */
    _handlePlayVideoFullScreenClick: async function(previewContainerElement) {
        const fileHash = previewContainerElement.dataset.hash;
        const fileName = previewContainerElement.dataset.filename;
        const fileType = previewContainerElement.dataset.filetype;

        if (!fileHash || !fileType || !fileName) {
            NotificationUIManager.showNotification("无法播放视频：缺少文件信息。", "error");
            return;
        }

        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                UIManager.showFullVideo(objectURL, fileName, fileType); // UIManager.showFullVideo 内部会处理 Object URL 的 revoke
            } else {
                NotificationUIManager.showNotification("无法播放：视频文件未在缓存中找到。", "error");
            }
        } catch (error) {
            Utils.log(`全屏播放视频 (hash: ${fileHash}) 出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("播放视频时出错。", "error");
        }
    },


    /**
     * @private
     * 处理文件消息中“播放”按钮（目前主要是音频文件）的点击事件。
     * @param {HTMLElement} buttonElement - 被点击的按钮元素。
     */
    _handlePlayMediaClick: async function(buttonElement) {
        const fileHash = buttonElement.dataset.hash;
        const fileName = buttonElement.dataset.filename;
        const fileType = buttonElement.dataset.filetype;

        // 确保此函数只处理音频文件
        if (!fileType || !fileType.startsWith('audio/')) {
            Utils.log(`_handlePlayMediaClick: 非音频类型 (${fileType})，不处理。`, Utils.logLevels.WARN);
            return;
        }

        if (!fileHash) { // fileType 已在上一步检查
            NotificationUIManager.showNotification("无法播放媒体：缺少文件信息。", "error");
            return;
        }

        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);

                const mediaElement = document.createElement('audio'); // 显式创建 audio
                mediaElement.controls = true;
                mediaElement.src = objectURL;
                mediaElement.style.maxWidth = '100%';
                mediaElement.title = fileName;

                const fileInfoDiv = buttonElement.closest('.file-info');
                if (fileInfoDiv) {
                    const existingPlayer = fileInfoDiv.querySelector('audio');
                    if (existingPlayer) {
                        existingPlayer.remove();
                        buttonElement.style.display = '';
                        URL.revokeObjectURL(existingPlayer.src);
                        return;
                    }
                    // 将播放器插入到按钮之前或之后，而不是替换整个 file-info
                    // 或将播放器作为 file-info 的兄弟节点插入
                    buttonElement.parentNode.insertBefore(mediaElement, buttonElement.nextSibling);
                    buttonElement.style.display = 'none'; // 隐藏播放按钮，显示播放器
                } else { // 如果找不到 .file-info，直接在按钮旁边操作
                    buttonElement.parentNode.insertBefore(mediaElement, buttonElement.nextSibling);
                    buttonElement.style.display = 'none';
                }


                mediaElement.play().catch(e => Utils.log(`播放音频文件 ${fileName} 出错: ${e}`, Utils.logLevels.ERROR));
                mediaElement.onended = () => {
                    URL.revokeObjectURL(objectURL);
                    mediaElement.remove();
                    buttonElement.style.display = '';
                };
                mediaElement.onerror = () => { // 处理播放器错误
                    URL.revokeObjectURL(objectURL);
                    mediaElement.remove();
                    buttonElement.style.display = '';
                    NotificationUIManager.showNotification(`播放音频 "${fileName}" 失败。`, 'error');
                };
            } else {
                NotificationUIManager.showNotification("无法播放：文件未在缓存中找到。", "error");
            }
        } catch (error) {
            Utils.log(`播放媒体文件 (hash: ${fileHash}) 出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("播放媒体时出错。", "error");
        }
    },

    /**
     * @private
     * 处理文件消息中“下载”按钮的点击事件。
     * @param {HTMLElement} buttonElement - 被点击的按钮元素。
     */
    _handleDownloadFileClick: async function(buttonElement) {
        const fileHash = buttonElement.dataset.hash;
        const fileName = buttonElement.dataset.filename;

        if (!fileHash || !fileName) {
            NotificationUIManager.showNotification("无法下载文件：缺少文件信息。", "error");
            return;
        }
        buttonElement.disabled = true; // 防止重复点击
        buttonElement.textContent = "下载中...";
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                const a = document.createElement('a');
                a.href = objectURL;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(objectURL); // 下载完成后立即释放
                NotificationUIManager.showNotification(`文件 "${fileName}" 已开始下载。`, "success");
            } else {
                NotificationUIManager.showNotification("无法下载：文件未在缓存中找到。", "error");
            }
        } catch (error) {
            Utils.log(`下载文件 (hash: ${fileHash}) 出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("下载文件时出错。", "error");
        } finally {
            buttonElement.disabled = false;
            buttonElement.textContent = "下载";
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
        // 如果是 Blob URL (用于预览的 Object URL)，则释放它
        if (MessageManager.selectedFile && MessageManager.selectedFile.previewUrl) {
            URL.revokeObjectURL(MessageManager.selectedFile.previewUrl);
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
            // 如果是文件消息，且预览时创建了Object URL并存储在DOM元素上，尝试在这里释放
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) {
                const mediaThumbnail = messageElement.querySelector('.message-thumbnail');
                if (mediaThumbnail && mediaThumbnail.dataset.objectUrlForRevoke) {
                    URL.revokeObjectURL(mediaThumbnail.dataset.objectUrlForRevoke);
                    delete mediaThumbnail.dataset.objectUrlForRevoke;
                }
                messageElement.remove(); // 从UI中删除
            }

            ChatManager.chats[chatId].splice(messageIndex, 1); // 从内存中删除
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
            data: null, // 确保移除旧的 data 字段 (如果有)
            fileHash: originalMessage.fileHash || null, // 保留哈希，以备未来可能的“恢复”或调试
            // 确保其他与文件内容相关的字段也被清理或设为null，例如预览URL等
            // 但 fileName, fileType, size 可以保留作为撤回消息的元信息
            // 清理临时状态
            isNewlyCompletedAIResponse: false, isStreaming: false, isThinking: false
        };
        ChatManager.addMessage(chatId, retractedMessage); // 将撤回后的消息添加到聊天记录 (addMessage会处理更新)
    }
};