/**
 * @file 消息管理器 (MessageManager.js)
 * @description 负责消息的发送、接收和显示。协调文本、文件和语音消息的发送流程，并调用相应模块处理特定类型的消息。
 *              支持消息的本地删除和撤回，在群聊中检测对AI的@提及，并对过长的文件名进行截断显示。
 *              文件消息会正确显示文件大小，发送时将 Blob 存入 fileCache，消息体中存储 fileHash，并通过分片传输。
 *              支持图片/视频缩略图预览和视频全屏播放。新增对贴图消息的支持。
 *              新增：在私聊中，若对方不在线，会提示并阻止消息发送；在群聊中，会提示有哪些在线成员未连接。
 *              修复：解决了渲染缺少 fileHash 的旧版文件消息时导致渲染失败的 bug。
 *              修复：确保只有当文件/贴图数据完全接收并缓存后，才将消息添加到聊天 UI，避免缩略图渲染失败。
 *              修复：修复了群聊中 @AI 时，用户消息在 AI 回复之后才显示的顺序问题。
 *              注意：已移除所有与“正在思考...”状态消息相关的逻辑。
 * @module MessageManager
 * @exports {object} MessageManager - 对外暴露的单例对象，包含消息处理的所有核心方法。
 * @dependency AppSettings, Utils, NotificationUIManager, ChatManager, ConnectionManager, WebRTCManager, AiApiHandler, TtsApiHandler, UserManager, GroupManager, PeopleLobbyManager, ModalUIManager, MediaManager, DBManager
 */
const MessageManager = {
    // 当前选择的文件对象 { blob, hash, name, type, size, previewUrl }
    selectedFile: null,
    // 当前录制的音频数据 (Data URL)
    audioData: null,
    // 当前录制的音频时长（秒）
    audioDuration: 0,
    // 上次显示“群成员未连接”通知的时间戳，用于节流
    _lastUnconnectedNotificationTime: 0,

    /**
     * 发送消息，根据当前状态（文本、文件、音频）构造并发送一个或多个消息。
     * @function sendMessage
     * @returns {Promise<void>}
     */
    sendMessage: async function () {
        // --- 1. 准备阶段：获取所有需要的数据 ---
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

        // --- 2. 前置检查与特殊处理 ---
        // 检查群聊中是否有未连接的在线成员，并进行节流提示
        if (isGroup && group && (messageText || currentSelectedFile || currentAudioData)) {
            const currentTime = Date.now();
            if (currentTime - this._lastUnconnectedNotificationTime > AppSettings.ui.unconnectedMemberNotificationCooldown) {
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

        // 处理与特殊联系人（如单聊AI）的交互
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

        // 检查私聊对方是否在线
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

        // --- 3. 消息发送流程 ---
        // 3.1. 处理并发送文本消息（如果有）
        // NOTE: 优先处理并显示用户自己的文本消息，修复了@AI时消息顺序错乱的问题。
        if (messageText) {
            userTextMessageForChat = { id: `${messageIdBase}_text`, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) {
                GroupManager.broadcastToGroup(targetId, userTextMessageForChat);
            } else {
                ConnectionManager.sendTo(targetId, userTextMessageForChat);
            }
            await ChatManager.addMessage(targetId, userTextMessageForChat);
            messageSent = true;
        }

        // 3.2. 在发送完文本消息后，检查群聊中的 AI @提及
        if (isGroup && group && messageText) {
            for (const memberId of group.members) {
                const memberContact = UserManager.contacts[memberId];
                if (memberContact && memberContact.isAI) {
                    const mentionTag = '@' + memberContact.name;
                    const mentionRegex = new RegExp(mentionTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$|\\p{P})', 'u');
                    if (messageText.match(mentionRegex)) {
                        Utils.log(`检测到对群内AI ${memberContact.name} 的提及。`, Utils.logLevels.INFO);
                        const triggeringMsgId = userTextMessageForChat ? userTextMessageForChat.id : null;
                        AiApiHandler.sendGroupAiMessage(targetId, group, memberContact.id, messageText, UserManager.userId, triggeringMsgId).catch(err => Utils.log(`处理群内AI提及 (${memberContact.name}) 时出错: ${err}`, Utils.logLevels.ERROR));
                    }
                }
            }
        }

        // 3.3. 处理并发送音频消息（如果有）
        if (currentAudioData) {
            const audioMessage = { id: `${messageIdBase}_audio`, type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage);
            else ConnectionManager.sendTo(targetId, audioMessage);
            await ChatManager.addMessage(targetId, audioMessage);
            messageSent = true; MessageManager.cancelAudioData();
        }

        // 3.4. 处理并发送文件消息（如果有）
        if (currentSelectedFile) {
            try {
                // 将文件存入本地 IndexedDB 缓存
                await DBManager.setItem('fileCache', {
                    id: currentSelectedFile.hash,
                    fileBlob: currentSelectedFile.blob,
                    metadata: { name: currentSelectedFile.name, type: currentSelectedFile.type, size: currentSelectedFile.size }
                });
                Utils.log(`文件 ${currentSelectedFile.name} (hash: ${currentSelectedFile.hash.substring(0,8)}...) 已存入本地 fileCache。`, Utils.logLevels.INFO);

                const fileMessageObject = {
                    id: `${messageIdBase}_file`, type: 'file', fileId: currentSelectedFile.hash,
                    fileName: currentSelectedFile.name, fileType: currentSelectedFile.type, size: currentSelectedFile.size,
                    fileHash: currentSelectedFile.hash, timestamp: nowTimestamp, sender: UserManager.userId
                };

                // NOTE: 立即在本地UI添加消息。远程对等方将在完全接收文件后才添加。
                await ChatManager.addMessage(targetId, fileMessageObject);

                // 定义发送函数，用于分片传输文件Blob
                const sendFunction = (peerId) => {
                    const conn = WebRTCManager.connections[peerId];
                    if (conn?.dataChannel?.readyState === 'open') {
                        // 先发送文件元信息消息对象
                        ConnectionManager.sendTo(peerId, fileMessageObject);
                        // 再通过分片发送文件实体
                        Utils.sendInChunks(currentSelectedFile.blob, currentSelectedFile.name, conn.dataChannel, peerId, currentSelectedFile.hash);
                    } else {
                        Utils.log(`无法向 ${peerId} 发送文件，数据通道未打开。`, Utils.logLevels.WARN);
                    }
                };

                // 根据聊天类型（群聊/私聊）执行发送
                if (isGroup) {
                    GroupManager.broadcastToGroup(targetId, fileMessageObject);
                    group.members.forEach(memberId => {
                        if (memberId !== UserManager.userId && !UserManager.contacts[memberId]?.isAI) {
                            sendFunction(memberId);
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

        // --- 4. 清理阶段 ---
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
     * @function sendSticker
     * @param {object} stickerData - 包含贴图信息的对象 { id, name, blob }。
     * @returns {Promise<void>}
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
            // 1. 将贴图文件存入本地缓存
            await DBManager.setItem('fileCache', {
                id: stickerData.id,
                fileBlob: stickerData.blob,
                metadata: { name: stickerData.name, type: stickerData.blob.type, size: stickerData.blob.size }
            });

            const nowTimestamp = new Date().toISOString();
            const messageId = `msg_${Date.now()}_${Utils.generateId(4)}`;

            // 2. 构建贴图消息对象
            const stickerMessage = {
                id: messageId, type: 'sticker', fileId: stickerData.id, fileName: stickerData.name,
                fileType: stickerData.blob.type, size: stickerData.blob.size, fileHash: stickerData.id,
                timestamp: nowTimestamp, sender: UserManager.userId
            };

            // 3. 立即在本地 UI 显示
            await ChatManager.addMessage(targetId, stickerMessage);

            // 4. 定义并执行发送逻辑（元信息 + 分片传输）
            const sendStickerFunction = (peerId) => {
                const conn = WebRTCManager.connections[peerId];
                if (conn?.dataChannel?.readyState === 'open') {
                    ConnectionManager.sendTo(peerId, stickerMessage);
                    Utils.sendInChunks(stickerData.blob, stickerData.name, conn.dataChannel, peerId, stickerData.id);
                } else {
                    Utils.log(`无法向 ${peerId} 发送贴图，数据通道未打开。`, Utils.logLevels.WARN);
                }
            };

            if (isGroup) {
                GroupManager.broadcastToGroup(targetId, stickerMessage);
                group.members.forEach(memberId => {
                    if (memberId !== UserManager.userId && !UserManager.contacts[memberId]?.isAI) {
                        sendStickerFunction(memberId);
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
     * @function displayMessage
     * @param {object} message - 要显示的消息对象。
     * @param {boolean} [prepend=false] - 是否将消息前置插入（用于加载历史记录）。
     * @returns {void}
     */
    displayMessage: function (message, prepend = false) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) return;

        // 检查消息是否已存在于 DOM 中
        let msgDiv = message.id ? chatBox.querySelector(`.message[data-message-id="${message.id}"]`) : null;
        const isUpdate = !!msgDiv;

        // 针对 AI 流式响应的特殊更新逻辑
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

        // 创建新的消息元素
        const messageTpl = document.getElementById('message-template').content.cloneNode(true);
        const newMsgDiv = messageTpl.querySelector('.message');
        const contentWrapper = messageTpl.querySelector('.message-content-wrapper');
        const contentEl = messageTpl.querySelector('.message-content');
        const senderEl = messageTpl.querySelector('.message-sender');
        const timestampEl = messageTpl.querySelector('.timestamp');

        // 设置消息元素属性（如 class, data-*）
        this._setMessageAttributes(newMsgDiv, message);

        // 设置发送者名称
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

        // 填充消息内容
        this._fillMessageContent(contentEl, message);

        // 为新完成的 AI 消息触发 TTS
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        if (isAIMessage && senderContact.aiConfig?.tts?.enabled && message.isNewlyCompletedAIResponse && message.type === 'text') {
            const textForTts = TtsApiHandler.cleanTextForTts(message.content);
            if (textForTts && textForTts.trim() !== "") {
                const ttsId = message.id || `tts_${Date.now()}`;
                TtsApiHandler.addTtsPlaceholder(contentWrapper, ttsId);
                TtsApiHandler.requestTtsForMessage(textForTts, senderContact.aiConfig.tts, contentWrapper, ttsId);
            }
        }

        // 将消息元素插入到 DOM
        if (isUpdate) {
            msgDiv.replaceWith(newMsgDiv);
        } else {
            if (prepend && chatBox.firstChild) {
                chatBox.insertBefore(newMsgDiv, chatBox.firstChild);
            } else {
                chatBox.appendChild(newMsgDiv);
            }
        }

        // 移除“暂无消息”等占位提示
        this._removeEmptyPlaceholder(chatBox, message);
    },

    /**
     * 内部方法：为消息DOM元素设置各种属性（class, data-*）。
     * @function _setMessageAttributes
     * @param {HTMLElement} msgDiv - 消息的DOM元素。
     * @param {object} message - 消息对象。
     * @returns {void}
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
        if (message.isRetracted) msgDiv.classList.add('retracted');

        if (!isSentByMe && senderContact?.isAI && senderContact.id) {
            msgDiv.classList.add('character-message', senderContact.id);
        }
    },

    /**
     * 内部方法：根据消息类型填充消息内容区域。
     * @function _fillMessageContent
     * @param {HTMLElement} contentEl - 消息内容的DOM容器。
     * @param {object} message - 消息对象。
     * @returns {void}
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
     * 内部方法：设置文件或贴图消息的显示内容（缩略图、文件名、大小、按钮等）。
     * @function _setupFileMessage
     * @param {HTMLElement} fileInfoDiv - 文件信息的容器元素。
     * @param {object} message - 文件或贴图消息对象。
     * @returns {void}
     */
    _setupFileMessage: function(fileInfoDiv, message) {
        const { fileHash, fileName, fileType, size } = message;
        fileInfoDiv.dataset.hash = fileHash;
        fileInfoDiv.dataset.filename = fileName;
        fileInfoDiv.dataset.filetype = fileType;

        const thumbnailPlaceholder = fileInfoDiv.querySelector('.thumbnail-placeholder');

        // 渲染媒体缩略图
        if (fileHash && fileType && thumbnailPlaceholder && typeof MediaUIManager !== 'undefined' && MediaUIManager.renderMediaThumbnail) {
            MediaUIManager.renderMediaThumbnail(thumbnailPlaceholder, fileHash, fileType, fileName, false);
        } else if (thumbnailPlaceholder) {
            // NOTE: 为旧版消息或缓存丢失的情况提供回退显示
            const icon = fileType?.startsWith('video/') ? '🎬' : (fileType?.startsWith('image/') ? '🖼️' : '📄');
            thumbnailPlaceholder.innerHTML = `<div class="file-icon-fallback">${icon}</div>`;
            thumbnailPlaceholder.title = "无法加载预览 (旧消息格式或缓存丢失)";
            Utils.log(`消息 ${message.id} 缺少 fileHash 或依赖项，使用回退预览。`, Utils.logLevels.DEBUG);
        }

        // 为图片和视频添加点击全屏查看/播放的事件
        if (fileType && (fileType.startsWith('image/') || fileType.startsWith('video/'))) {
            fileInfoDiv.style.cursor = 'pointer';
            fileInfoDiv.addEventListener('click', (e) => {
                const target = e.currentTarget;
                if (fileType.startsWith('image/')) this._handleViewFileClick(target);
                else if (fileType.startsWith('video/')) this._handlePlayVideoFullScreenClick(target);
            });
        }

        // 设置文件名（截断）和文件大小
        const fileNameEl = fileInfoDiv.querySelector('.file-name');
        if(fileNameEl && fileName) fileNameEl.textContent = Utils.truncateFileName(fileName, 10);

        const fileMetaEl = fileInfoDiv.querySelector('.file-meta');
        if(fileMetaEl && size !== undefined) fileMetaEl.textContent = MediaManager.formatFileSize(size);

        // 设置操作按钮（如播放、下载）
        const actionBtn = fileInfoDiv.querySelector('.media-action-btn');
        if (actionBtn) {
            if (fileHash) actionBtn.dataset.hash = fileHash;
            if (fileName) actionBtn.dataset.filename = fileName;

            const isPlayableAudio = fileType && fileType.startsWith('audio/');
            const isDownloadable = fileType && !fileType.startsWith('image/') && !fileType.startsWith('video/') && !isPlayableAudio;

            if (isPlayableAudio) {
                actionBtn.textContent = '播放';
                actionBtn.addEventListener('click', (e) => { e.stopPropagation(); this._handlePlayMediaClick(e.currentTarget); });
            } else if (isDownloadable) {
                actionBtn.textContent = '下载';
                actionBtn.addEventListener('click', (e) => { e.stopPropagation(); this._handleDownloadFileClick(e.currentTarget); });
            } else {
                actionBtn.remove();
            }
        }
    },

    /**
     * 内部方法：如果聊天框中不再有实际消息，则移除“暂无消息”等占位符。
     * @function _removeEmptyPlaceholder
     * @param {HTMLElement} chatBox - 聊天框元素。
     * @param {object} message - 刚添加的消息对象。
     * @returns {void}
     */
    _removeEmptyPlaceholder: function(chatBox, message) {
        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.message.system)');
        if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
            if (!message.isStreaming && !message.isRetracted) {
                noMsgPlaceholder.remove();
            }
        }
    },

    /**
     * 内部方法：处理点击查看图片文件的操作。
     * @function _handleViewFileClick
     * @param {HTMLElement} buttonOrContainerElement - 触发事件的元素。
     * @returns {Promise<void>}
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
     * 内部方法：处理点击全屏播放视频的操作。
     * @function _handlePlayVideoFullScreenClick
     * @param {HTMLElement} previewContainerElement - 视频预览容器元素。
     * @returns {Promise<void>}
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
     * 内部方法：处理点击播放音频文件的操作。
     * @function _handlePlayMediaClick
     * @param {HTMLElement} buttonElement - 播放按钮元素。
     * @returns {Promise<void>}
     */
    _handlePlayMediaClick: async function(buttonElement) {
        const fileHash = buttonElement.dataset.hash;
        const fileName = buttonElement.dataset.filename;
        const fileType = buttonElement.closest('.file-info')?.dataset.filetype;

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
                    buttonElement.style.display = '⚠️';
                    setTimeout(() => {buttonElement.innerHTML = '▶'; audio.remove();}, 2000);
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
     * 内部方法：处理点击下载文件的操作。
     * @function _handleDownloadFileClick
     * @param {HTMLElement} buttonElement - 下载按钮元素。
     * @returns {Promise<void>}
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
     * 取消待发送的文件，并清理预览。
     * @function cancelFileData
     * @returns {void}
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
     * 取消待发送的音频，并清理预览和录音资源。
     * @function cancelAudioData
     * @returns {void}
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
     * 清空当前聊天的所有消息。
     * @function clearChat
     * @returns {void}
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
     * 在本地删除一条消息。
     * @function deleteMessageLocally
     * @param {string} messageId - 要删除的消息 ID。
     * @returns {void}
     */
    deleteMessageLocally: function(messageId) {
        const chatId = ChatManager.currentChatId;
        if (!chatId || !ChatManager.chats[chatId]) return;
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) {
                // NOTE: 如果是媒体消息，释放其缩略图的 Object URL
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

            // 更新联系人列表中的最后一条消息预览
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
     * @function requestRetractMessage
     * @param {string} messageId - 要撤回的消息 ID。
     * @returns {void}
     */
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

    /**
     * 内部方法：将指定消息更新为“已撤回”状态。
     * @function _updateMessageToRetractedState
     * @param {string} messageId - 要撤回的消息 ID。
     * @param {string} chatId - 聊天 ID。
     * @param {boolean} isOwnRetraction - 是否是自己撤回。
     * @param {string|null} [retractedByName=null] - 撤回者的名称。
     * @returns {void}
     */
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