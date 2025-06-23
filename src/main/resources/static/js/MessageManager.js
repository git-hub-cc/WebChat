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
 *                    实际文件数据现在通过'file-transfer'类型的消息发送。
 *              修改: 视频文件消息现在点击后全屏播放。
 *              优化: 图片和视频文件消息现在显示缩略图预览 (使用 MediaUIManager.renderMediaThumbnail)。
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
        const originalMessageText = input.value;
        const messageText = originalMessageText.trim();
        const currentSelectedFile = MessageManager.selectedFile;
        const currentAudioData = MessageManager.audioData;
        const currentAudioDuration = MessageManager.audioDuration;

        if (!ChatManager.currentChatId) {
            NotificationUIManager.showNotification('请选择一个聊天以发送消息。', 'warning');
            return;
        }
        const isGroup = ChatManager.currentChatId.startsWith('group_');
        const targetId = ChatManager.currentChatId;
        const contact = UserManager.contacts[targetId];
        const group = isGroup ? GroupManager.groups[targetId] : null;
        const nowTimestamp = new Date().toISOString();
        const messageIdBase = `msg_${Date.now()}_${Utils.generateId(4)}`;

        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig && !isGroup) {
            if (currentAudioData || currentSelectedFile) {
                NotificationUIManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData();
                if (currentSelectedFile) MessageManager.cancelFileData();
                return;
            }
            if (!messageText) return;
            const userMessage = { id: messageIdBase, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            await ChatManager.addMessage(targetId, userMessage);
            input.value = ''; input.style.height = 'auto';
            await AiApiHandler.sendAiMessage(targetId, contact, messageText);
            input.focus();
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
        let userTextMessageForChat = null;

        if (messageText) {
            userTextMessageForChat = { id: `${messageIdBase}_text`, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
        }

        if (isGroup && group && messageText) {
            for (const memberId of group.members) {
                const memberContact = UserManager.contacts[memberId];
                if (memberContact && memberContact.isAI) {
                    const mentionTag = '@' + memberContact.name;
                    const mentionRegex = new RegExp(mentionTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$|\\p{P})', 'u');
                    if (messageText.match(mentionRegex)) {
                        Utils.log(`MessageManager: 检测到对群内AI ${memberContact.name} (${memberContact.id}) 的提及。`, Utils.logLevels.INFO);
                        const triggeringMsgId = userTextMessageForChat ? userTextMessageForChat.id : null;
                        AiApiHandler.sendGroupAiMessage(targetId, group, memberContact.id, messageText, UserManager.userId, triggeringMsgId)
                            .catch(err => Utils.log(`处理群内AI提及 (${memberContact.name}) 时出错: ${err}`, Utils.logLevels.ERROR));
                    }
                }
            }
        }

        if (currentAudioData) {
            const audioMessage = { id: `${messageIdBase}_audio`, type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage);
            else ConnectionManager.sendTo(targetId, audioMessage);
            await ChatManager.addMessage(targetId, audioMessage);
            messageSent = true; MessageManager.cancelAudioData();
        }

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
                Utils.log(`文件 ${currentSelectedFile.name} (hash: ${currentSelectedFile.hash.substring(0,8)}...) 已存入本地 fileCache。`, Utils.logLevels.INFO);

                const blobToBase64 = (blob) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                const base64Data = await blobToBase64(currentSelectedFile.blob);

                const messagePayloadForSending = {
                    id: `${messageIdBase}_file`,
                    type: 'file-transfer',
                    fileName: currentSelectedFile.name,
                    fileType: currentSelectedFile.type,
                    size: currentSelectedFile.size,
                    fileHash: currentSelectedFile.hash,
                    fileData: base64Data,
                    timestamp: nowTimestamp,
                    sender: UserManager.userId
                };

                const messagePayloadForLocalChat = {
                    id: messagePayloadForSending.id,
                    type: 'file',
                    fileId: currentSelectedFile.hash,
                    fileName: currentSelectedFile.name,
                    fileType: currentSelectedFile.type,
                    size: currentSelectedFile.size,
                    fileHash: currentSelectedFile.hash,
                    timestamp: nowTimestamp,
                    sender: UserManager.userId
                };

                if (isGroup) GroupManager.broadcastToGroup(targetId, messagePayloadForSending);
                else ConnectionManager.sendTo(targetId, messagePayloadForSending);

                await ChatManager.addMessage(targetId, messagePayloadForLocalChat);
                messageSent = true;
                MessageManager.cancelFileData();

            } catch (error) { // Combined catch for DB and blob conversion
                Utils.log(`发送文件时出错: ${error}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification('发送文件失败。', 'error');
                MessageManager.cancelFileData();
                return;
            }
        }

        if (userTextMessageForChat) {
            if (isGroup) GroupManager.broadcastToGroup(targetId, userTextMessageForChat);
            else ConnectionManager.sendTo(targetId, userTextMessageForChat);
            await ChatManager.addMessage(targetId, userTextMessageForChat);
            messageSent = true;
        }

        if (messageSent) {
            if (messageText && originalMessageText === input.value) {
                input.value = '';
                input.style.height = 'auto';
            }
            input.focus();
        }
    },

    /**
     * 在聊天窗口中显示或更新一条消息。
     * @param {object} message - 要显示的消息对象。
     * @param {boolean} [prepend=false] - 是否将消息前置插入（用于加载历史记录）。
     */
    displayMessage: function (message, prepend = false) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) return;

        const isSentByMe = message.sender === UserManager.userId || (message.originalSender && message.originalSender === UserManager.userId);
        let msgDiv = null;
        let mainContentWrapper = null;
        let contentElement = null;

        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender];
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts;

        if (msgDiv) { // If message div already exists, we are updating it
            if (message.isRetracted && !msgDiv.classList.contains('retracted')) {
                msgDiv.innerHTML = '';
            } else if (!message.isRetracted) {
                mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
                contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
            }
        } else { // If message div does not exist, create it
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
            if (message.id) msgDiv.setAttribute('data-message-id', message.id);
            if (message.sender) msgDiv.setAttribute('data-sender-id', message.sender);
            if (message.timestamp) msgDiv.setAttribute('data-timestamp', new Date(message.timestamp).getTime());
        }

        if (message.type === 'system' || message.isRetracted) {
            msgDiv.classList.add('system');
        } else {
            msgDiv.classList.remove('system');
        }
        if (message.isThinking) msgDiv.classList.add('thinking'); else msgDiv.classList.remove('thinking');
        if (message.isRetracted) msgDiv.classList.add('retracted'); else msgDiv.classList.remove('retracted');
        if (isAIMessage && senderContact?.id) {
            msgDiv.classList.add('character-message', senderContact.id);
        } else {
            if (senderContact?.id) msgDiv.classList.remove('character-message', senderContact.id);
            else msgDiv.classList.remove('character-message');
        }

        if (!contentElement || (message.isRetracted && msgDiv.innerHTML === '')) {
            let senderNameHtml = '';
            if (!isSentByMe && message.type !== 'system' && !message.isRetracted) {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender || '').substring(0, 4)}`);
                if ((message.groupId && ChatManager.currentChatId === message.groupId) || (senderContact?.isSpecial && !senderContact.isAI)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                } else if (senderContact?.isAI) {
                    senderNameHtml = `<div class="message-sender ai-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }

            let messageBodyHtml;
            if (message.isRetracted) {
                let retractedText;
                if (message.retractedBy === UserManager.userId) {
                    retractedText = "你撤回了一条消息";
                } else {
                    const retractedName = UserManager.contacts[message.retractedBy]?.name || (message.originalSenderName && message.retractedBy === (message.originalSender || message.sender) ? message.originalSenderName : null) || `用户 ${String(message.retractedBy || message.sender || '').substring(0,4)}`;
                    retractedText = `${Utils.escapeHtml(retractedName)} 撤回了一条消息`;
                }
                messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${Utils.escapeHtml(retractedText)}</div></div>`;
            } else {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                switch (message.type) {
                    case 'text':
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${Utils.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""))}</div></div>`;
                        break;
                    case 'audio':
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="voice-message"><button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button><span class="voice-duration">${Utils.formatTime(message.duration)}</span></div></div>`;
                        break;
                    case 'file':
                        const originalFileName = message.fileName || '文件';
                        const escapedOriginalFileName = Utils.escapeHtml(originalFileName);
                        const displayFileName = Utils.truncateFileName(escapedOriginalFileName, 10);
                        const fileSizeForDisplay = message.size || message.fileSize || 0;
                        const fileHash = message.fileHash;
                        let fileSpecificContainerClass = "";
                        let initialIconContent = "📄";

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

                        const thumbnailPlaceholderHtml = `<div class="thumbnail-placeholder" data-hash="${fileHash}" data-filename="${escapedOriginalFileName}" data-filetype="${message.fileType}">
                                                             ${initialIconContent}
                                                             ${ (message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/')) ? `<span class="play-overlay-icon">${message.fileType.startsWith('image/') ? '👁️' : '▶'}</span>` : '' }
                                                           </div>`;
                        const fileDetailsHtml = `
                            <div class="file-details">
                                <div class="file-name" title="${escapedOriginalFileName}">${displayFileName}</div>
                                <div class="file-meta">${MediaManager.formatFileSize(fileSizeForDisplay)}</div>
                            </div>`;
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
                        if (message.fileType?.startsWith('audio/')) {
                            messageBodyHtml += `<button class="play-media-btn" data-hash="${fileHash}" data-filename="${escapedOriginalFileName}" data-filetype="${message.fileType}">播放</button>`;
                        } else if (!(message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/'))) {
                            messageBodyHtml += `<button class="download-file-btn" data-hash="${fileHash}" data-filename="${escapedOriginalFileName}">下载</button>`;
                        }
                        messageBodyHtml += `</div>`;
                        break;
                    case 'user':
                    case 'system':
                        messageBodyHtml = `<div class="message-content system-text">${Utils.formatMessageText(textContent)}</div>`;
                        break;
                    default:
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">[不支持的类型: ${message.type}]</div></div>`;
                }
            }
            msgDiv.innerHTML = senderNameHtml + messageBodyHtml + `<div class="timestamp">${message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...'}</div>`;

            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');

            if (!message.isRetracted && message.type === 'file') {
                const fileInfoContainer = msgDiv.querySelector('.file-info');
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
                const playMediaBtn = msgDiv.querySelector('.play-media-btn');
                if (playMediaBtn) playMediaBtn.addEventListener('click', (e) => this._handlePlayMediaClick(e.target));
                const downloadBtn = msgDiv.querySelector('.download-file-btn');
                if (downloadBtn) downloadBtn.addEventListener('click', (e) => this._handleDownloadFileClick(e.target));
            }
        } else {
            if (contentElement && message.type === 'text' && !message.isRetracted) {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = Utils.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
            const timestampElement = msgDiv.querySelector('.timestamp');
            if (timestampElement && message.timestamp && timestampElement.textContent !== Utils.formatDate(new Date(message.timestamp), true)) {
                timestampElement.textContent = Utils.formatDate(new Date(message.timestamp), true);
            }
        }

        if (message.isRetracted) {
            const actionableElements = msgDiv.querySelectorAll('.file-info[style*="cursor:pointer"], button.play-media-btn, button.download-file-btn, .play-voice-btn, .tts-play-button, .tts-retry-button');
            actionableElements.forEach(el => {
                if(el.tagName === 'BUTTON') el.disabled = true;
                el.onclick = null;
                el.style.cursor = 'default';
                if (el.classList.contains('tts-play-button') || el.classList.contains('tts-retry-button')) {
                    el.parentElement.innerHTML = '';
                }
            });
            msgDiv.style.cursor = 'default';
        }

        if (!message.isRetracted && message.type === 'file' && (message.fileType?.startsWith('image/') || message.fileType?.startsWith('video/'))) {
            const placeholderDiv = msgDiv.querySelector('.thumbnail-placeholder');
            if (placeholderDiv && typeof MediaUIManager !== 'undefined' && MediaUIManager.renderMediaThumbnail) {
                MediaUIManager.renderMediaThumbnail(placeholderDiv, message.fileHash, message.fileType, message.fileName, false);
            }
        }

        if (message.type === 'text' && isAIMessage && ttsConfig?.enabled && !message.isStreaming && message.isNewlyCompletedAIResponse && !message.isRetracted) {
            const textForTts = MessageTtsHandler.cleanTextForTts(message.content);
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            if (textForTts && textForTts.trim() !== "" && mainContentWrapper) {
                const ttsId = message.id || `tts_${Date.now()}`;
                const oldTtsContainer = mainContentWrapper.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
                if(oldTtsContainer) oldTtsContainer.remove();

                MessageTtsHandler.addTtsPlaceholder(mainContentWrapper, ttsId);
                MessageTtsHandler.requestTtsForMessage(textForTts, ttsConfig, mainContentWrapper, ttsId);
            } else {
                Utils.log(`TTS 未为消息 ID ${message.id} 触发: 清理后的文本为空或没有包装器。原文: "${message.content?.substring(0, 50)}..."`, Utils.logLevels.INFO);
            }
        }

        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt):not(.retracted):not([class*="loading-indicator"])');
        if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
            if (!message.isThinking && !message.isStreaming && !message.isRetracted) {
                noMsgPlaceholder.remove();
            }
        }

        if (!chatBox.contains(msgDiv)) {
            if (prepend && chatBox.firstChild) {
                chatBox.insertBefore(msgDiv, chatBox.firstChild);
            } else {
                chatBox.appendChild(msgDiv);
            }
        }
    },

    /**
     * @private
     * 处理文件消息中“查看”按钮（通常是图片）的点击事件。
     */
    _handleViewFileClick: async function(buttonOrContainerElement) {
        const fileHash = buttonOrContainerElement.dataset.hash;
        const fileName = buttonOrContainerElement.dataset.filename;

        if (!fileHash) {
            NotificationUIManager.showNotification("无法查看文件：缺少文件信息。", "error");
            return;
        }
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                Utils.showFullImage(objectURL, fileName);
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
                Utils.showFullVideo(objectURL, fileName, fileType);
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
     */
    _handlePlayMediaClick: async function(buttonElement) {
        const fileHash = buttonElement.dataset.hash;
        const fileName = buttonElement.dataset.filename;
        const fileType = buttonElement.dataset.filetype;

        if (!fileType || !fileType.startsWith('audio/')) {
            Utils.log(`_handlePlayMediaClick: 非音频类型 (${fileType})，不处理。`, Utils.logLevels.WARN);
            return;
        }
        if (!fileHash) {
            NotificationUIManager.showNotification("无法播放媒体：缺少文件信息。", "error");
            return;
        }
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                const mediaElement = document.createElement('audio');
                mediaElement.controls = true;
                mediaElement.src = objectURL;
                mediaElement.style.maxWidth = '100%';
                mediaElement.title = fileName;

                const commonParent = buttonElement.closest('.message-content-wrapper') || buttonElement.parentElement;
                if (commonParent) {
                    const existingPlayer = commonParent.querySelector('audio');
                    if (existingPlayer) {
                        existingPlayer.remove();
                        buttonElement.style.display = '';
                        URL.revokeObjectURL(existingPlayer.src);
                        return;
                    }
                    // Insert after the button, or after file-info if button is inside it
                    const insertAfterElement = buttonElement.closest('.file-info') || buttonElement;
                    insertAfterElement.parentNode.insertBefore(mediaElement, insertAfterElement.nextSibling);
                    buttonElement.style.display = 'none';
                } else {
                    buttonElement.parentNode.insertBefore(mediaElement, buttonElement.nextSibling);
                    buttonElement.style.display = 'none';
                }
                mediaElement.play().catch(e => Utils.log(`播放音频文件 ${fileName} 出错: ${e}`, Utils.logLevels.ERROR));
                mediaElement.onended = () => {
                    URL.revokeObjectURL(objectURL);
                    mediaElement.remove();
                    buttonElement.style.display = '';
                };
                mediaElement.onerror = () => {
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
     */
    _handleDownloadFileClick: async function(buttonElement) {
        const fileHash = buttonElement.dataset.hash;
        const fileName = buttonElement.dataset.filename;

        if (!fileHash || !fileName) {
            NotificationUIManager.showNotification("无法下载文件：缺少文件信息。", "error");
            return;
        }
        buttonElement.disabled = true;
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
                URL.revokeObjectURL(objectURL);
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
     * 取消当前已选择但未发送的文件。
     */
    cancelFileData: function () {
        if (MessageManager.selectedFile && MessageManager.selectedFile.previewUrl) {
            URL.revokeObjectURL(MessageManager.selectedFile.previewUrl);
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
            NotificationUIManager.showNotification('未选择要清空的聊天。', 'warning');
            return;
        }
        ModalUIManager.showConfirmationModal(
            '您确定要清空此聊天中的消息吗？此操作无法撤销。',
            () => {
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) NotificationUIManager.showNotification('聊天记录已清空。', 'success');
                    else NotificationUIManager.showNotification('清空聊天记录失败。', 'error');
                });
            }
        );
    },

    /**
     * 本地删除一条消息。
     */
    deleteMessageLocally: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) {
                const mediaThumbnailPlaceholder = messageElement.querySelector('.thumbnail-placeholder');
                if (mediaThumbnailPlaceholder && mediaThumbnailPlaceholder.dataset.objectUrlForRevoke) {
                    URL.revokeObjectURL(mediaThumbnailPlaceholder.dataset.objectUrlForRevoke);
                    delete mediaThumbnailPlaceholder.dataset.objectUrlForRevoke;
                    Utils.log(`Object URL for message ${messageId} thumbnail released on local delete.`, Utils.logLevels.DEBUG);
                }
                messageElement.remove();
            }

            ChatManager.chats[chatId].splice(messageIndex, 1);
            ChatManager.saveCurrentChat();
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
     * 请求撤回一条消息。
     */
    requestRetractMessage: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;
        const message = ChatManager.chats[chatId].find(msg => msg.id === messageId);
        if (!message) { NotificationUIManager.showNotification("无法找到要撤回的消息。", "warning"); return; }
        if (message.sender !== UserManager.userId) { NotificationUIManager.showNotification("只能撤回自己发送的消息。", "error"); return; }
        const messageTime = new Date(message.timestamp).getTime();
        if (Date.now() - messageTime > Config.ui.messageRetractionWindow) {
            NotificationUIManager.showNotification(`消息已超过${Config.ui.messageRetractionWindow / (60 * 1000)}分钟，无法撤回。`, "warning");
            return;
        }
        const myName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName;
        if (chatId.startsWith('group_')) {
            const retractRequest = {
                type: 'group-retract-message-request', originalMessageId: messageId,
                sender: UserManager.userId, originalSender: message.sender, originalSenderName: myName
            };
            const broadcastSuccess = GroupManager.broadcastToGroup(chatId, retractRequest);
            if (broadcastSuccess) { this._updateMessageToRetractedState(messageId, chatId, true, myName); }
            else { NotificationUIManager.showNotification("发送群消息撤回请求失败。", "error"); }
        } else {
            if (!ConnectionManager.isConnectedTo(chatId)) {
                NotificationUIManager.showNotification("对方不在线，暂时无法撤回消息。", "warning"); return;
            }
            const retractRequest = {
                type: 'retract-message-request', originalMessageId: messageId,
                sender: UserManager.userId, targetUserId: chatId, senderName: myName
            };
            const sent = ConnectionManager.sendTo(chatId, retractRequest);
            if (sent) { this._updateMessageToRetractedState(messageId, chatId, true, myName); }
            else { NotificationUIManager.showNotification("发送消息撤回请求失败。", "error"); }
        }
    },

    /**
     * @private
     * 将指定消息更新为撤回状态。
     */
    _updateMessageToRetractedState: function(messageId, chatId, isOwnRetraction, retractedByName = null) {
        if (!ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex === -1) return;

        const originalMessage = ChatManager.chats[chatId][messageIndex];
        let retracterDisplayName;
        if (isOwnRetraction) {
            retracterDisplayName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName || "你";
        } else if(retractedByName) {
            retracterDisplayName = retractedByName;
        } else if (originalMessage.sender) {
            retracterDisplayName = UserManager.contacts[originalMessage.sender]?.name || `用户 ${String(originalMessage.sender).substring(0,4)}`;
        } else {
            retracterDisplayName = "对方";
        }
        const retractedMessage = {
            ...originalMessage,
            type: 'system',
            content: isOwnRetraction ? "你撤回了一条消息" : `${Utils.escapeHtml(retracterDisplayName)} 撤回了一条消息`,
            isRetracted: true,
            retractedBy: isOwnRetraction ? UserManager.userId : (originalMessage.sender || null),
            originalType: originalMessage.type,
            data: null, // Clear audio/file data for retracted message
            fileHash: originalMessage.fileHash || null, // Keep hash for potential internal reference if needed
            isNewlyCompletedAIResponse: false, isStreaming: false, isThinking: false
        };
        ChatManager.addMessage(chatId, retractedMessage);
    }
};