/**
 * @file MessageManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 消息管理器，负责处理消息的发送、接收和显示。
 *              文件发送逻辑已完全移至 DataChannelHandler，本模块只负责构建消息对象并调用上层发送接口。
 *              增强了文件/媒体消息的UI交互，在资源未完全接收时提供更好的用户反馈。
 * @module MessageManager
 * @exports {object} MessageManager - 对外暴露的单例对象，包含消息处理的所有核心方法。
 */
const MessageManager = {
    selectedFile: null, // 当前选择的文件 { blob, hash, name, type, size, previewUrl }
    audioData: null,    // 当前录制的音频数据 (Data URL)
    audioDuration: 0,   // 当前录制的音频时长
    _lastUnconnectedNotificationTime: 0, // 上次显示未连接成员通知的时间戳
    _UNCONNECTED_NOTIFICATION_COOLDOWN: 30000, // 30秒冷却时间

    /**
     * 发送贴图消息。
     * @param {object} stickerData - 包含贴图信息的对象 { id, name, blob }。
     */
    sendSticker: async function (stickerData) {
        if (!ChatManager.currentChatId) {
            NotificationUIManager.showNotification('请选择一个聊天以发送贴图。', 'warning');
            return;
        }
        const targetId = ChatManager.currentChatId;
        const isGroup = targetId.startsWith('group_');
        const group = isGroup ? GroupManager.groups[targetId] : null;

        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            const contactName = UserManager.contacts[targetId]?.name || `用户 ${targetId.substring(0, 4)}`;
            NotificationUIManager.showNotification(`${contactName} 不在线，贴图将无法发送。`, 'warning');
            return;
        }

        try {
            // 1. 将贴图 Blob 存入本地缓存
            await DBManager.setItem('fileCache', {
                id: stickerData.id, // stickerData.id is the hash
                fileBlob: stickerData.blob,
                metadata: { name: stickerData.name, type: stickerData.blob.type, size: stickerData.blob.size }
            });

            const nowTimestamp = new Date().toISOString();
            const messageId = `msg_${Date.now()}_${Utils.generateId(4)}`;

            // 2. 创建贴图消息对象 (作为指令)
            const stickerMessage = {
                id: messageId,
                type: 'sticker',
                fileId: stickerData.id,
                fileName: stickerData.name,
                fileType: stickerData.blob.type,
                size: stickerData.blob.size,
                fileHash: stickerData.id,
                timestamp: nowTimestamp,
                sender: UserManager.userId
            };

            // 3. 立即在本地 UI 显示
            await ChatManager.addMessage(targetId, stickerMessage);

            // 4. 构建用于发送的文件对象
            const fileObjectForSending = {
                blob: stickerData.blob,
                hash: stickerData.id,
                name: stickerData.name,
                type: stickerData.blob.type,
                size: stickerData.blob.size
            };

            // 5. 通过 DataChannelHandler 发送文件
            if (isGroup) {
                GroupManager.broadcastToGroup(targetId, stickerMessage);
                group.members.forEach(memberId => {
                    if (memberId !== UserManager.userId && !UserManager.contacts[memberId]?.isAI && ConnectionManager.isConnectedTo(memberId)) {
                        DataChannelHandler.sendFile(memberId, fileObjectForSending)
                            .catch(err => Utils.log(`向群成员 ${memberId} 发送贴图失败: ${err.message}`, Utils.logLevels.ERROR));
                    }
                });
            } else {
                ConnectionManager.sendTo(targetId, stickerMessage); // 发送指令
                await DataChannelHandler.sendFile(targetId, fileObjectForSending); // 发送二进制数据
            }
        } catch (error) {
            Utils.log(`发送贴图时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发送贴图失败。', 'error');
        }
    },

    /**
     * 发送消息的主函数。
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

        // 检查群聊中是否有未连接的在线成员
        if (isGroup && group && (messageText || currentSelectedFile || currentAudioData)) {
            const currentTime = Date.now();
            if (currentTime - this._lastUnconnectedNotificationTime > this._UNCONNECTED_NOTIFICATION_COOLDOWN) {
                const unconnectedOnlineMembersInfo = [];
                for (const memberId of group.members) {
                    if (memberId === UserManager.userId || UserManager.contacts[memberId]?.isAI) continue;
                    if ((PeopleLobbyManager.onlineUserIds || []).includes(memberId) && !ConnectionManager.isConnectedTo(memberId)) {
                        unconnectedOnlineMembersInfo.push({ id: memberId, name: UserManager.contacts[memberId]?.name || `用户 ${memberId.substring(0,4)}` });
                    }
                }
                if (unconnectedOnlineMembersInfo.length > 0) {
                    let namesToShow = unconnectedOnlineMembersInfo.slice(0, 2).map(m => m.name).join('、');
                    if (unconnectedOnlineMembersInfo.length > 2) namesToShow += ` 等 ${unconnectedOnlineMembersInfo.length} 人`;
                    else if (unconnectedOnlineMembersInfo.length > 0) namesToShow += ` 共 ${unconnectedOnlineMembersInfo.length} 位成员`;
                    const notificationMessage = `注意: 群内在线成员 ${namesToShow} 当前未与您建立直接连接，他们可能无法收到此消息。可尝试在详情面板中手动连接或等待自动连接。`;
                    NotificationUIManager.showNotification(notificationMessage, 'warning', 7000);
                    this._lastUnconnectedNotificationTime = currentTime;
                }
            }
        }

        if (contact && contact.isSpecial && contact.isAI && !isGroup) {
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
                const contactName = UserManager.contacts[targetId]?.name || `用户 ${targetId.substring(0,4)}`;
                NotificationUIManager.showNotification(`${contactName} 不在线，消息将无法发送。`, 'warning');
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
                    if (messageText.includes(mentionTag)) {
                        Utils.log(`MessageManager: 检测到对群内AI ${memberContact.name} (${memberContact.id}) 的提及。`, Utils.logLevels.INFO);
                        const triggeringMsgId = userTextMessageForChat ? userTextMessageForChat.id : null;
                        AiApiHandler.sendGroupAiMessage(targetId, group, memberContact.id, messageText, UserManager.userId, triggeringMsgId).catch(err => Utils.log(`处理群内AI提及 (${memberContact.name}) 时出错: ${err}`, Utils.logLevels.ERROR));
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
                    metadata: { name: currentSelectedFile.name, type: currentSelectedFile.type, size: currentSelectedFile.size }
                });
                Utils.log(`文件 ${currentSelectedFile.name} (hash: ${currentSelectedFile.hash.substring(0,8)}...) 已存入本地 fileCache。`, Utils.logLevels.INFO);

                const fileMessageObject = {
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

                await ChatManager.addMessage(targetId, fileMessageObject);

                if (isGroup) {
                    GroupManager.broadcastToGroup(targetId, fileMessageObject);
                    group.members.forEach(memberId => {
                        if (memberId !== UserManager.userId && !UserManager.contacts[memberId]?.isAI && ConnectionManager.isConnectedTo(memberId)) {
                            DataChannelHandler.sendFile(memberId, currentSelectedFile)
                                .catch(err => Utils.log(`向群成员 ${memberId} 发送文件失败: ${err.message}`, Utils.logLevels.ERROR));
                        }
                    });
                } else {
                    if(ConnectionManager.isConnectedTo(targetId)){
                        ConnectionManager.sendTo(targetId, fileMessageObject);
                        await DataChannelHandler.sendFile(targetId, currentSelectedFile);
                    }
                }

                messageSent = true;
                MessageManager.cancelFileData();

            } catch (error) {
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
     * @private
     * 检查并提醒群聊中未连接的在线成员。
     * @param {string} groupId - 群组ID。
     */
    _checkAndNotifyUnconnectedGroupMembers: function(groupId) {
        const group = GroupManager.groups[groupId];
        const currentTime = Date.now();
        if (currentTime - this._lastUnconnectedNotificationTime > this._UNCONNECTED_NOTIFICATION_COOLDOWN) {
            const unconnectedOnlineMembersInfo = [];
            for (const memberId of group.members) {
                if (memberId === UserManager.userId || UserManager.contacts[memberId]?.isAI) continue;
                if ((PeopleLobbyManager.onlineUserIds || []).includes(memberId) && !ConnectionManager.isConnectedTo(memberId)) {
                    unconnectedOnlineMembersInfo.push({ id: memberId, name: UserManager.contacts[memberId]?.name || `用户 ${memberId.substring(0,4)}` });
                }
            }
            if (unconnectedOnlineMembersInfo.length > 0) {
                let namesToShow = unconnectedOnlineMembersInfo.slice(0, 2).map(m => m.name).join('、');
                if (unconnectedOnlineMembersInfo.length > 2) namesToShow += ` 等 ${unconnectedOnlineMembersInfo.length} 人`;
                else if (unconnectedOnlineMembersInfo.length > 0) namesToShow += ` 共 ${unconnectedOnlineMembersInfo.length} 位成员`;
                const notificationMessage = `注意: 群内在线成员 ${namesToShow} 当前未与您建立直接连接，他们可能无法收到此消息。可尝试在详情面板中手动连接或等待自动连接。`;
                NotificationUIManager.showNotification(notificationMessage, 'warning', 7000);
                this._lastUnconnectedNotificationTime = currentTime;
            }
        }
    },

    /**
     * 在聊天窗口中显示或更新一条消息。
     * @param {object} message - 要显示的消息对象。
     * @param {boolean} [prepend=false] - 是否将消息前置插入。
     */
    displayMessage: function (message, prepend = false) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) return;

        let msgDiv = message.id ? chatBox.querySelector(`.message[data-message-id="${message.id}"]`) : null;
        const isUpdate = !!msgDiv;

        if (isUpdate) {
            if (message.type === 'text' && message.isStreaming) {
                const contentEl = msgDiv.querySelector('.message-content');
                if (contentEl) contentEl.innerHTML = Utils.formatMessageText(message.content + "▍");
                return;
            }
            if(message.type === 'text' && !message.isStreaming && !message.isNewlyCompletedAIResponse) {
                const contentEl = msgDiv.querySelector('.message-content');
                if (contentEl) contentEl.innerHTML = Utils.formatMessageText(message.content);
                const timestampEl = msgDiv.querySelector('.timestamp');
                if (timestampEl) timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), true);
                return;
            }
        }

        const messageTpl = document.getElementById('message-template').content.cloneNode(true);
        const newMsgDiv = messageTpl.querySelector('.message');
        const contentWrapper = messageTpl.querySelector('.message-content-wrapper');
        const contentEl = messageTpl.querySelector('.message-content');
        const senderEl = messageTpl.querySelector('.message-sender');
        const timestampEl = messageTpl.querySelector('.timestamp');

        this._setMessageAttributes(newMsgDiv, message);

        const senderContact = UserManager.contacts[message.sender];
        const isSentByMe = message.sender === UserManager.userId || (message.originalSender && message.originalSender === UserManager.userId);
        if (!isSentByMe && message.type !== 'system' && !message.isRetracted) {
            const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender || '').substring(0, 4)}`);
            if (message.groupId || senderContact?.isSpecial) {
                senderEl.textContent = Utils.escapeHtml(senderName);
            } else {
                senderEl.remove();
            }
        } else {
            senderEl.remove();
        }

        timestampEl.textContent = message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...';
        this._fillMessageContent(contentEl, message);

        const isAIMessage = !isSentByMe && senderContact?.isAI;
        if (isAIMessage && senderContact.aiConfig?.tts?.enabled && message.isNewlyCompletedAIResponse && message.type === 'text') {
            const textForTts = TtsApiHandler.cleanTextForTts(message.content);
            if (textForTts && textForTts.trim() !== "") {
                const ttsId = message.id || `tts_${Date.now()}`;
                TtsApiHandler.addTtsPlaceholder(contentWrapper, ttsId);
                TtsApiHandler.requestTtsForMessage(textForTts, senderContact.aiConfig.tts, contentWrapper, ttsId);
            }
        }

        if (isUpdate) {
            msgDiv.replaceWith(newMsgDiv);
        } else {
            if (prepend && chatBox.firstChild) {
                chatBox.insertBefore(newMsgDiv, chatBox.firstChild);
            } else {
                chatBox.appendChild(newMsgDiv);
            }
        }
        this._removeEmptyPlaceholder(chatBox, message);
    },

    _setMessageAttributes: function(msgDiv, message) {
        const isSentByMe = message.sender === UserManager.userId || (message.originalSender && message.originalSender === UserManager.userId);
        const senderContact = UserManager.contacts[message.sender];

        msgDiv.classList.add(isSentByMe ? 'sent' : 'received');
        if (message.id) msgDiv.dataset.messageId = message.id;
        if (message.sender) msgDiv.dataset.senderId = message.sender;
        if (message.timestamp) msgDiv.dataset.timestamp = new Date(message.timestamp).getTime();

        if (message.type === 'system' || message.isRetracted) msgDiv.classList.add('system');
        if (message.type === 'sticker') msgDiv.classList.add('sticker');
        if (message.isThinking) msgDiv.classList.add('thinking');
        if (message.isRetracted) msgDiv.classList.add('retracted');

        if (!isSentByMe && senderContact?.isAI && senderContact.id) {
            msgDiv.classList.add('character-message', senderContact.id);
        }
    },

    _fillMessageContent: function(contentEl, message) {
        if (message.isRetracted) {
            let retractedText;
            if (message.retractedBy === UserManager.userId) {
                retractedText = "你撤回了一条消息";
            } else {
                const retractedName = UserManager.contacts[message.retractedBy]?.name || (message.originalSenderName && message.retractedBy === (message.originalSender || message.sender) ? message.originalSenderName : null) || `用户 ${String(message.retractedBy || message.sender || '').substring(0,4)}`;
                retractedText = `${Utils.escapeHtml(retractedName)} 撤回了一条消息`;
            }
            contentEl.textContent = retractedText;
            return;
        }

        switch (message.type) {
            case 'text':
                contentEl.innerHTML = Utils.formatMessageText(message.content);
                break;
            case 'audio':
                const audioTpl = document.getElementById('message-audio-template').content.cloneNode(true);
                audioTpl.querySelector('.play-voice-btn').dataset.audio = message.data;
                audioTpl.querySelector('.play-voice-btn').addEventListener('click', (e) => MediaManager.playAudio(e.currentTarget));
                audioTpl.querySelector('.voice-duration').textContent = Utils.formatTime(message.duration);
                contentEl.appendChild(audioTpl);
                break;
            case 'sticker':
                const stickerTpl = document.getElementById('message-sticker-template').content.cloneNode(true);
                this._setupFileMessage(stickerTpl.querySelector('.sticker-info'), message);
                contentEl.appendChild(stickerTpl);
                break;
            case 'file':
                const fileTpl = document.getElementById('message-file-template').content.cloneNode(true);
                this._setupFileMessage(fileTpl.querySelector('.file-info'), message);
                contentEl.appendChild(fileTpl);
                break;
            case 'user':
            case 'system':
                contentEl.classList.add('system-text');
                contentEl.innerHTML = Utils.formatMessageText(message.content);
                break;
            default:
                contentEl.textContent = `[不支持的类型: ${message.type}]`;
        }
    },

    _setupFileMessage: function(fileInfoDiv, message) {
        const { fileHash, fileName, fileType, size } = message;
        fileInfoDiv.dataset.hash = fileHash;
        fileInfoDiv.dataset.filename = fileName;
        fileInfoDiv.dataset.filetype = fileType;

        const thumbnailPlaceholder = fileInfoDiv.querySelector('.thumbnail-placeholder');
        if (MediaUIManager.renderMediaThumbnail) {
            MediaUIManager.renderMediaThumbnail(thumbnailPlaceholder, fileHash, fileType, fileName, false);
        }

        if (fileType.startsWith('image/') || fileType.startsWith('video/')) {
            fileInfoDiv.style.cursor = 'pointer';
            fileInfoDiv.addEventListener('click', (e) => {
                const target = e.currentTarget;
                if (fileType.startsWith('image/')) this._handleViewFileClick(target);
                else if (fileType.startsWith('video/')) this._handlePlayVideoFullScreenClick(target);
            });
        }

        const fileNameEl = fileInfoDiv.querySelector('.file-name');
        if(fileNameEl) fileNameEl.textContent = Utils.truncateFileName(fileName, 10);

        const fileMetaEl = fileInfoDiv.querySelector('.file-meta');
        if(fileMetaEl) fileMetaEl.textContent = MediaManager.formatFileSize(size);

        const actionBtn = fileInfoDiv.querySelector('.media-action-btn');
        if (actionBtn) {
            actionBtn.dataset.hash = fileHash;
            actionBtn.dataset.filename = fileName;
            actionBtn.dataset.filetype = fileType;
            if (fileType.startsWith('audio/')) {
                actionBtn.textContent = '播放';
                actionBtn.addEventListener('click', (e) => { e.stopPropagation(); this._handlePlayMediaClick(actionBtn); });
            } else if (!fileType.startsWith('image/') && !fileType.startsWith('video/')) {
                actionBtn.textContent = '下载';
                actionBtn.addEventListener('click', (e) => { e.stopPropagation(); this._handleDownloadFileClick(actionBtn); });
            } else {
                actionBtn.remove();
            }
        }
    },

    _removeEmptyPlaceholder: function(chatBox, message) {
        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking)');
        if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
            if (!message.isThinking && !message.isStreaming && !message.isRetracted) {
                noMsgPlaceholder.remove();
            }
        }
    },

    _handleViewFileClick: async function(element) {
        const fileHash = element.dataset.hash;
        const fileName = element.dataset.filename;
        if (!fileHash) return;
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                Utils.showFullImage(objectURL, fileName);
            } else {
                const isReceiving = Object.values(ConnectionManager.pendingReceivedChunks || {}).some(
                    peerChunks => peerChunks && peerChunks[fileHash]
                );
                if (isReceiving) {
                    NotificationUIManager.showNotification('图片正在接收中，请稍候...', 'info');
                    EventEmitter.once('fileDataReady', (eventData) => {
                        if (eventData.fileHash === fileHash) this._handleViewFileClick(element);
                    });
                } else {
                    NotificationUIManager.showNotification("无法查看：文件未在缓存中找到。", "error");
                }
            }
        } catch (error) {
            NotificationUIManager.showNotification("查看文件时出错。", "error");
        }
    },

    _handlePlayVideoFullScreenClick: async function(element) {
        const fileHash = element.dataset.hash;
        const fileName = element.dataset.filename;
        const fileType = element.dataset.filetype;
        if (!fileHash) return;
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                Utils.showFullVideo(objectURL, fileName, fileType);
            } else {
                const isReceiving = Object.values(ConnectionManager.pendingReceivedChunks || {}).some(
                    peerChunks => peerChunks && peerChunks[fileHash]
                );
                if (isReceiving) {
                    NotificationUIManager.showNotification('视频正在接收中，请稍候...', 'info');
                    EventEmitter.once('fileDataReady', (eventData) => {
                        if (eventData.fileHash === fileHash) this._handlePlayVideoFullScreenClick(element);
                    });
                } else {
                    NotificationUIManager.showNotification("无法播放：视频文件未在缓存中找到。", "error");
                }
            }
        } catch (error) {
            NotificationUIManager.showNotification("播放视频时出错。", "error");
        }
    },

    _handlePlayMediaClick: async function(element) {
        const fileHash = element.dataset.hash;
        const fileName = element.dataset.filename;
        if (!fileHash) return;
        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (cachedItem && cachedItem.fileBlob) {
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                const mediaElement = document.createElement('audio');
                mediaElement.controls = true;
                mediaElement.src = objectURL;
                const parent = element.closest('.message-content-wrapper') || element.parentElement;
                parent.appendChild(mediaElement);
                element.style.display = 'none';
                mediaElement.onended = () => {
                    URL.revokeObjectURL(objectURL);
                    mediaElement.remove();
                    element.style.display = '';
                };
            } else {
                NotificationUIManager.showNotification("无法播放：文件未在缓存中找到。", "error");
            }
        } catch (error) {
            NotificationUIManager.showNotification("播放媒体时出错。", "error");
        }
    },

    _handleDownloadFileClick: async function(element) {
        const fileHash = element.dataset.hash;
        const fileName = element.dataset.filename;
        if (!fileHash) return;
        element.disabled = true; element.textContent = "下载中...";
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
            } else {
                NotificationUIManager.showNotification("无法下载：文件未在缓存中找到。", "error");
            }
        } catch (error) {
            NotificationUIManager.showNotification("下载文件时出错。", "error");
        } finally {
            element.disabled = false; element.textContent = "下载";
        }
    },

    cancelFileData: function () {
        if (this.selectedFile && this.selectedFile.previewUrl) {
            URL.revokeObjectURL(this.selectedFile.previewUrl);
        }
        this.selectedFile = null;
        document.getElementById('filePreviewContainer').innerHTML = '';
    },

    cancelAudioData: function () {
        this.audioData = null;
        this.audioDuration = 0;
        document.getElementById('audioPreviewContainer').innerHTML = '';
        MediaManager.releaseAudioResources();
        if (typeof MediaUIManager !== 'undefined') {
            MediaUIManager.resetRecordingButtonUI();
        }
    },

    clearChat: function () {
        if (!ChatManager.currentChatId) return;
        ModalUIManager.showConfirmationModal('您确定要清空此聊天中的消息吗？此操作无法撤销。',
            () => ChatManager.clearChat(ChatManager.currentChatId)
        );
    },

    deleteMessageLocally: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) messageElement.remove();
            ChatManager.chats[chatId].splice(messageIndex, 1);
            ChatManager.saveCurrentChat();
            // ... (update last message preview logic) ...
            NotificationUIManager.showNotification("消息已删除。", "success");
        }
    },

    requestRetractMessage: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;
        const message = ChatManager.chats[chatId].find(msg => msg.id === messageId);
        if (!message || message.sender !== UserManager.userId) return;
        if (Date.now() - new Date(message.timestamp).getTime() > AppSettings.ui.messageRetractionWindow) {
            NotificationUIManager.showNotification("消息已超过可撤回时间。", "warning");
            return;
        }

        const myName = UserManager.userName;
        if (chatId.startsWith('group_')) {
            GroupManager.broadcastToGroup(chatId, { type: 'group-retract-message-request', originalMessageId: messageId, originalSenderName: myName });
        } else {
            ConnectionManager.sendTo(chatId, { type: 'retract-message-request', originalMessageId: messageId, senderName: myName });
        }
        this._updateMessageToRetractedState(messageId, chatId, true, myName);
    },

    _updateMessageToRetractedState: function(messageId, chatId, isOwnRetraction, retractedByName = null) {
        if (!ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex === -1) return;

        const originalMessage = ChatManager.chats[chatId][messageIndex];
        const retracterDisplayName = isOwnRetraction ? "你" : (retractedByName || `用户 ${String(originalMessage.sender).substring(0,4)}`);

        const retractedMessage = { ...originalMessage, type: 'system', content: `${Utils.escapeHtml(retracterDisplayName)} 撤回了一条消息`, isRetracted: true };

        ChatManager.addMessage(chatId, retractedMessage);
    }
};