/**
 * @file MessageManager.js
 * @description 消息管理器，负责处理消息的发送、接收和显示。
 *              它协调文本、文件和语音消息的发送流程，并调用相应的模块（如 AiApiHandler）来处理特定类型的消息。
 *              同时，它也负责将消息渲染到聊天窗口中。
 *              支持消息的本地删除和撤回请求。
 *              在群聊中检测对AI的@提及，并触发AI响应。文件名过长时，在预览和消息中会进行截断显示。
 *              文件消息现在能正确显示文件大小。文件发送时，将Blob存入DB的fileCache，消息体中存储fileHash。
 *              实际文件数据现在通过高效的二进制分片传输。视频文件消息现在点击后全屏播放。
 *              图片和视频文件消息现在显示缩略图预览。
 *              新增：在群聊中发送消息时，会检查并提醒用户是否有在线但未连接的群成员。
 *              私聊时，如果对方不在线，则提示用户消息无法发送，并阻止消息发送。
 *              新增：支持发送贴图消息。
 *              FIXED: 修复了文件消息的下载/播放按钮因无法获取文件信息而失效的问题。
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
     * 发送消息。
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
                    const mentionRegex = new RegExp(mentionTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$|\\p{P})', 'u');
                    if (messageText.match(mentionRegex)) {
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

        // --- REFACTORED AND FIXED FILE SENDING LOGIC ---
        if (currentSelectedFile) {
            try {
                // 1. Cache the file locally
                await DBManager.setItem('fileCache', {
                    id: currentSelectedFile.hash,
                    fileBlob: currentSelectedFile.blob,
                    metadata: { name: currentSelectedFile.name, type: currentSelectedFile.type, size: currentSelectedFile.size }
                });
                Utils.log(`文件 ${currentSelectedFile.name} (hash: ${currentSelectedFile.hash.substring(0,8)}...) 已存入本地 fileCache。`, Utils.logLevels.INFO);

                // 2. Create the file message object
                const fileMessageObject = {
                    id: `${messageIdBase}_file`,
                    type: 'file', // This remains 'file' for regular files/images
                    fileId: currentSelectedFile.hash,
                    fileName: currentSelectedFile.name,
                    fileType: currentSelectedFile.type,
                    size: currentSelectedFile.size,
                    fileHash: currentSelectedFile.hash,
                    timestamp: nowTimestamp,
                    sender: UserManager.userId
                };

                // 3. Add the message to the local chat UI immediately
                await ChatManager.addMessage(targetId, fileMessageObject);

                // 4. Send the JSON instruction message AND the binary data
                const sendFunction = (peerId) => {
                    const conn = WebRTCManager.connections[peerId];
                    if (conn?.dataChannel?.readyState === 'open') {
                        // Send the JSON "instruction" message first
                        ConnectionManager.sendTo(peerId, fileMessageObject);
                        // Then send the binary data chunks
                        Utils.sendInChunks(currentSelectedFile.blob, currentSelectedFile.name, conn.dataChannel, peerId, currentSelectedFile.hash);
                    } else {
                        Utils.log(`无法向 ${peerId} 发送文件，数据通道未打开。`, Utils.logLevels.WARN);
                    }
                };

                if (isGroup) {
                    // For groups, broadcast the JSON instruction, then send binary to each member
                    GroupManager.broadcastToGroup(targetId, fileMessageObject);
                    group.members.forEach(memberId => {
                        if (memberId !== UserManager.userId && !UserManager.contacts[memberId]?.isAI) {
                            const conn = WebRTCManager.connections[memberId];
                            if (conn?.dataChannel?.readyState === 'open') {
                                Utils.sendInChunks(currentSelectedFile.blob, currentSelectedFile.name, conn.dataChannel, memberId, currentSelectedFile.hash);
                            }
                        }
                    });
                } else {
                    sendFunction(targetId);
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
        // --- END OF REFACTORED LOGIC ---

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
            // 1. Cache sticker blob in fileCache for unified access
            await DBManager.setItem('fileCache', {
                id: stickerData.id, // stickerData.id is the hash
                fileBlob: stickerData.blob,
                metadata: { name: stickerData.name, type: stickerData.blob.type, size: stickerData.blob.size }
            });

            const nowTimestamp = new Date().toISOString();
            const messageId = `msg_${Date.now()}_${Utils.generateId(4)}`;

            // 2. Create the sticker message object
            const stickerMessage = {
                id: messageId,
                type: 'sticker', // The special type
                fileId: stickerData.id,
                fileName: stickerData.name,
                fileType: stickerData.blob.type,
                size: stickerData.blob.size,
                fileHash: stickerData.id,
                timestamp: nowTimestamp,
                sender: UserManager.userId
            };

            // 3. Add to local UI
            await ChatManager.addMessage(targetId, stickerMessage);

            // 4. Send JSON and binary data to peer(s)
            const sendStickerFunction = (peerId) => {
                const conn = WebRTCManager.connections[peerId];
                if (conn?.dataChannel?.readyState === 'open') {
                    // Send the JSON "instruction"
                    ConnectionManager.sendTo(peerId, stickerMessage);
                    // Send the binary data
                    Utils.sendInChunks(stickerData.blob, stickerData.name, conn.dataChannel, peerId, stickerData.id);
                } else {
                    Utils.log(`无法向 ${peerId} 发送贴图，数据通道未打开。`, Utils.logLevels.WARN);
                }
            };

            if (isGroup) {
                // Broadcast the JSON "instruction"
                GroupManager.broadcastToGroup(targetId, stickerMessage);
                // Send binary data to each connected member
                group.members.forEach(memberId => {
                    if (memberId !== UserManager.userId && !UserManager.contacts[memberId]?.isAI) {
                        const conn = WebRTCManager.connections[memberId];
                        if (conn?.dataChannel?.readyState === 'open') {
                            Utils.sendInChunks(stickerData.blob, stickerData.name, conn.dataChannel, memberId, stickerData.id);
                        }
                    }
                });
            } else {
                sendStickerFunction(targetId);
            }
        } catch (error) {
            Utils.log(`发送贴图时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发送贴图失败。', 'error');
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

        let msgDiv = message.id ? chatBox.querySelector(`.message[data-message-id="${message.id}"]`) : null;
        const isUpdate = !!msgDiv;

        if (isUpdate) {
            // 更新逻辑：如果只是流式文本更新，则直接修改内容
            if (message.type === 'text' && message.isStreaming) {
                const contentEl = msgDiv.querySelector('.message-content');
                if (contentEl) {
                    contentEl.innerHTML = Utils.formatMessageText(message.content + "▍");
                }
                return; // 快速返回，不重新渲染整个消息
            }
            // 如果是更新完成状态
            if(message.type === 'text' && !message.isStreaming && !message.isNewlyCompletedAIResponse) {
                const contentEl = msgDiv.querySelector('.message-content');
                if (contentEl) {
                    contentEl.innerHTML = Utils.formatMessageText(message.content);
                }
                const timestampEl = msgDiv.querySelector('.timestamp');
                if (timestampEl) {
                    timestampEl.textContent = Utils.formatDate(new Date(message.timestamp), true);
                }
                return;
            }
        }

        // --- 创建或完整重绘消息 ---
        const messageTpl = document.getElementById('message-template').content.cloneNode(true);
        const newMsgDiv = messageTpl.querySelector('.message');
        const contentWrapper = messageTpl.querySelector('.message-content-wrapper');
        const contentEl = messageTpl.querySelector('.message-content');
        const senderEl = messageTpl.querySelector('.message-sender');
        const timestampEl = messageTpl.querySelector('.timestamp');

        // 设置通用属性
        this._setMessageAttributes(newMsgDiv, message);

        // 设置发送者
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

        // 设置时间戳
        timestampEl.textContent = message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...';

        // 根据消息类型填充内容
        this._fillMessageContent(contentEl, message);

        // 处理TTS
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        if (isAIMessage && senderContact.aiConfig?.tts?.enabled && message.isNewlyCompletedAIResponse && message.type === 'text') {
            const textForTts = TtsApiHandler.cleanTextForTts(message.content);
            if (textForTts && textForTts.trim() !== "") {
                const ttsId = message.id || `tts_${Date.now()}`;
                TtsApiHandler.addTtsPlaceholder(contentWrapper, ttsId);
                TtsApiHandler.requestTtsForMessage(textForTts, senderContact.aiConfig.tts, contentWrapper, ttsId);
            }
        }

        // 将新消息插入DOM
        if (isUpdate) {
            msgDiv.replaceWith(newMsgDiv);
        } else {
            if (prepend && chatBox.firstChild) {
                chatBox.insertBefore(newMsgDiv, chatBox.firstChild);
            } else {
                chatBox.appendChild(newMsgDiv);
            }
        }

        // 移除"无消息"占位符
        this._removeEmptyPlaceholder(chatBox, message);
    },

    /**
     * @private
     * 为消息DOM元素设置通用属性和类。
     * @param {HTMLElement} msgDiv - 消息的div元素。
     * @param {object} message - 消息对象。
     */
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

    /**
     * @private
     * 根据消息类型填充消息内容区域。
     * @param {HTMLElement} contentEl - 消息内容的容器元素。
     * @param {object} message - 消息对象。
     */
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
                const stickerInfoDiv = stickerTpl.querySelector('.sticker-info');
                this._setupFileMessage(stickerInfoDiv, message);
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

    /**
     * @private
     * 设置文件或贴图消息的DOM元素。
     * @param {HTMLElement} fileInfoDiv - 文件信息的容器元素。
     * @param {object} message - 消息对象。
     */
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

        // 文件详情和操作按钮 (贴图类型没有这些)
        const fileNameEl = fileInfoDiv.querySelector('.file-name');
        if(fileNameEl) fileNameEl.textContent = Utils.truncateFileName(fileName, 10);

        const fileMetaEl = fileInfoDiv.querySelector('.file-meta');
        if(fileMetaEl) fileMetaEl.textContent = MediaManager.formatFileSize(size);

        const actionBtn = fileInfoDiv.querySelector('.media-action-btn');
        if (actionBtn) {
            // FIX: 将文件信息从容器的 dataset 传递到按钮的 dataset,
            //      确保事件处理器能从被点击的按钮上直接获取到所需信息。
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
                actionBtn.remove(); // 图片和视频直接点击容器，不需要按钮
            }
        }
    },

    /**
     * @private
     * 移除聊天框中的 "暂无消息" 占位符。
     * @param {HTMLElement} chatBox - 聊天框元素。
     * @param {object} message - 新增的消息对象。
     */
    _removeEmptyPlaceholder: function(chatBox, message) {
        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking)');
        if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
            if (!message.isThinking && !message.isStreaming && !message.isRetracted) {
                noMsgPlaceholder.remove();
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
                // --- MODIFICATION START for _handleViewFileClick ---
                // Check if the file is currently being received
                const isReceiving = Object.values(ConnectionManager.pendingReceivedChunks || {}).some(
                    peerChunks => peerChunks && peerChunks[fileHash]
                );

                if (isReceiving) {
                    NotificationUIManager.showNotification('图片正在接收中，请稍候...', 'info');
                    // Optionally, listen for the 'fileDataReady' event to auto-open when ready
                    EventEmitter.once('fileDataReady', (eventData) => {
                        if (eventData.fileHash === fileHash) {
                            // Re-trigger the view action now that the file is ready
                            this._handleViewFileClick(buttonOrContainerElement);
                        }
                    });
                } else {
                    NotificationUIManager.showNotification("无法查看：文件未在缓存中找到，且当前未在接收。", "error");
                }
                // --- MODIFICATION END ---
            }
        } catch (error) {
            Utils.log(`查看文件 (hash: ${fileHash}) 出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("查看文件时出错。", "error");
        }
    },

    /**
     * @private
     * 处理视频预览容器的点击事件，用于全屏播放视频。
     * FIXED: 增加了对文件传输状态的检查，如果文件正在接收，则提示用户并监听完成事件。
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
                // --- Cache HIT ---
                const objectURL = URL.createObjectURL(cachedItem.fileBlob);
                Utils.showFullVideo(objectURL, fileName, fileType);
            } else {
                // --- Cache MISS ---
                // Check if the file is currently being received from any peer
                const isReceiving = Object.values(ConnectionManager.pendingReceivedChunks || {}).some(
                    peerChunks => peerChunks && peerChunks[fileHash]
                );

                if (isReceiving) {
                    NotificationUIManager.showNotification('视频正在接收中，请稍候...', 'info');

                    // Listen for the fileDataReady event ONCE to auto-play when ready
                    EventEmitter.once('fileDataReady', (eventData) => {
                        // Check if the ready file is the one we are waiting for
                        if (eventData.fileHash === fileHash) {
                            Utils.log(`视频文件 ${fileName} (hash: ${fileHash}) 接收完毕，自动播放。`, Utils.logLevels.INFO);
                            // Re-trigger the play action now that the file is ready
                            this._handlePlayVideoFullScreenClick(previewContainerElement);
                        }
                    });
                } else {
                    // If not in cache and not being received, then it's a real error.
                    NotificationUIManager.showNotification("无法播放：视频文件未在缓存中找到，且当前未在接收。", "error");
                }
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
                // --- MODIFICATION START for _handlePlayMediaClick ---
                const isReceiving = Object.values(ConnectionManager.pendingReceivedChunks || {}).some(
                    peerChunks => peerChunks && peerChunks[fileHash]
                );
                if(isReceiving) {
                    NotificationUIManager.showNotification('音频文件正在接收中，请稍候...', 'info');
                } else {
                    NotificationUIManager.showNotification("无法播放：文件未在缓存中找到。", "error");
                }
                // --- MODIFICATION END ---
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
                // --- MODIFICATION START for _handleDownloadFileClick ---
                const isReceiving = Object.values(ConnectionManager.pendingReceivedChunks || {}).some(
                    peerChunks => peerChunks && peerChunks[fileHash]
                );
                if(isReceiving) {
                    NotificationUIManager.showNotification('文件正在接收中，请稍候再试。', 'info');
                } else {
                    NotificationUIManager.showNotification("无法下载：文件未在缓存中找到。", "error");
                }
                // --- MODIFICATION END ---
            }
        } catch (error) {
            Utils.log(`下载文件 (hash: ${fileHash}) 出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification("下载文件时出错。", "error");
        } finally {
            buttonElement.disabled = false;
            buttonElement.textContent = "下载";
        }
    },

    cancelFileData: function () {
        if (MessageManager.selectedFile && MessageManager.selectedFile.previewUrl) {
            URL.revokeObjectURL(MessageManager.selectedFile.previewUrl);
        }
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
        if (typeof MediaUIManager !== 'undefined') {
            MediaUIManager.resetRecordingButtonUI();
        } else {
            Utils.log("在 MessageManager.cancelAudioData 中 MediaUIManager 未定义", Utils.logLevels.WARN);
        }
    },

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

    requestRetractMessage: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;
        const message = ChatManager.chats[chatId].find(msg => msg.id === messageId);
        if (!message) { NotificationUIManager.showNotification("无法找到要撤回的消息。", "warning"); return; }
        if (message.sender !== UserManager.userId) { NotificationUIManager.showNotification("只能撤回自己发送的消息。", "error"); return; }
        const messageTime = new Date(message.timestamp).getTime();
        if (Date.now() - messageTime > AppSettings.ui.messageRetractionWindow) {
            NotificationUIManager.showNotification(`消息已超过${AppSettings.ui.messageRetractionWindow / (60 * 1000)}分钟，无法撤回。`, "warning");
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

    _updateMessageToRetractedState: function(messageId, chatId, isOwnRetraction, retractedByName = null) {
        if (!ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex === -1) return;
        const originalMessage = ChatManager.chats[chatId][messageIndex];
        let retracterDisplayName;
        if (isOwnRetraction) retracterDisplayName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName || "你";
        else if(retractedByName) retracterDisplayName = retractedByName;
        else if (originalMessage.sender) retracterDisplayName = UserManager.contacts[originalMessage.sender]?.name || `用户 ${String(originalMessage.sender).substring(0,4)}`;
        else retracterDisplayName = "对方";
        const retractedMessage = { ...originalMessage, type: 'system', content: isOwnRetraction ? "你撤回了一条消息" : `${Utils.escapeHtml(retracterDisplayName)} 撤回了一条消息`, isRetracted: true, retractedBy: isOwnRetraction ? UserManager.userId : (originalMessage.sender || null), originalType: originalMessage.type, data: null, fileHash: originalMessage.fileHash || null, isNewlyCompletedAIResponse: false, isStreaming: false, isThinking: false };
        ChatManager.addMessage(chatId, retractedMessage);
    }
};