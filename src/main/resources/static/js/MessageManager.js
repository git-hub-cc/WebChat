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
 *               MediaManager, MediaUIManager, MessageTtsHandler, Utils, ModalManager, ChatAreaUIManager, UIManager, Config
 * @dependents ChatAreaUIManager (绑定发送按钮事件), ChatManager (调用以显示历史消息)
 */
const MessageManager = {
    selectedFile: null, // 当前选择的文件，准备发送
    audioData: null, // 当前录制的音频数据，准备发送
    audioDuration: 0, // 当前录制的音频时长

    /**
     * 发送消息。根据输入框内容、已选择的文件或已录制的音频，构建并发送消息。
     */
    sendMessage: async function () {
        const input = document.getElementById('messageInput'); // 获取消息输入框元素
        const messageText = input.value.trim(); // 获取并清理输入框文本
        const currentSelectedFile = MessageManager.selectedFile; // 获取当前选择的文件
        const currentAudioData = MessageManager.audioData; // 获取当前录制的音频数据
        const currentAudioDuration = MessageManager.audioDuration; // 获取当前录制的音频时长

        // 检查是否已选择聊天对象
        if (!ChatManager.currentChatId) {
            NotificationManager.showNotification('请选择一个聊天以发送消息。', 'warning');
            return;
        }
        const isGroup = ChatManager.currentChatId.startsWith('group_'); // 判断是否为群聊
        const targetId = ChatManager.currentChatId; // 目标聊天ID
        const contact = UserManager.contacts[targetId]; // 获取联系人信息
        const nowTimestamp = new Date().toISOString(); // 当前时间戳
        const messageIdBase = `msg_${Date.now()}_${Utils.generateId(4)}`; // 生成消息ID的基础部分

        // 处理AI聊天对象的特殊逻辑
        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                NotificationManager.showNotification(`不支持向 ${contact.name} 发送音频/文件消息。`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData(); // 取消音频
                if (currentSelectedFile) MessageManager.cancelFileData(); // 取消文件
                return;
            }
            if (!messageText) return; // 如果没有文本内容，则不发送
            // 构建用户发送给AI的消息体
            const userMessage = { id: messageIdBase, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            ChatManager.addMessage(targetId, userMessage); // 将用户消息添加到聊天记录
            input.value = ''; input.style.height = 'auto'; input.focus(); // 清空输入框并重置样式
            await AiApiHandler.sendAiMessage(targetId, contact, messageText); // 调用AI接口发送消息，AiApiHandler会处理AI消息的ID
            return;
        }

        // 检查P2P聊天连接状态
        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || currentSelectedFile || currentAudioData) {
                // 如果有未发送的内容，提示用户重新连接
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showReconnectPrompt(targetId, () => Utils.log("已重新连接，请重新发送消息。", Utils.logLevels.INFO));
                return;
            }
        }
        // 如果没有任何内容（文本、文件、音频），则不发送
        if (!messageText && !currentSelectedFile && !currentAudioData) return;

        let messageSent = false; // 标记是否有消息被发送
        // 处理音频消息
        if (currentAudioData) {
            const audioMessage = { id: `${messageIdBase}_audio`, type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage); else ConnectionManager.sendTo(targetId, audioMessage); // 发送群聊或P2P消息
            ChatManager.addMessage(targetId, audioMessage); // 添加到聊天记录
            messageSent = true; MessageManager.cancelAudioData(); // 取消已发送的音频
        }
        // 处理文件消息
        if (currentSelectedFile) {
            const messagePayload = {
                id: `${messageIdBase}_file`,
                type: 'file',
                fileId: `${Date.now()}-${Utils.generateId(6)}`, // 文件ID，保持原有的fileId生成方式
                fileName: currentSelectedFile.name,
                fileType: currentSelectedFile.type,
                fileSize: currentSelectedFile.size,
                data: currentSelectedFile.data, // 文件数据 (通常是Base64或Blob URL)
                timestamp: nowTimestamp,
                sender: UserManager.userId
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, messagePayload); else ConnectionManager.sendTo(targetId, messagePayload); // 发送群聊或P2P消息
            ChatManager.addMessage(targetId, messagePayload); // 添加到聊天记录
            messageSent = true; MessageManager.cancelFileData(); // 取消已发送的文件
        }
        // 处理文本消息
        if (messageText) {
            const textMessage = { id: `${messageIdBase}_text`, type: 'text', content: messageText, timestamp: nowTimestamp, sender: UserManager.userId };
            if (isGroup) GroupManager.broadcastToGroup(targetId, textMessage); else ConnectionManager.sendTo(targetId, textMessage); // 发送群聊或P2P消息
            ChatManager.addMessage(targetId, textMessage); // 添加到聊天记录
            messageSent = true; input.value = ''; input.style.height = 'auto'; // 清空输入框并重置样式
        }
        if (messageSent) input.focus(); // 如果有消息发送，则聚焦输入框
    },

    /**
     * 在聊天窗口中显示或更新一条消息。
     * @param {object} message - 要显示的消息对象。
     * @param {boolean} [prepend=false] - 是否将消息前置插入（用于加载历史记录）。
     */
    displayMessage: function (message, prepend = false) {
        const chatBox = document.getElementById('chatBox'); // 获取聊天框元素
        if (!chatBox) return; // 如果聊天框不存在，则退出

        // 内部判断消息是否由当前用户发送
        const isSentByMe = message.sender === UserManager.userId || (message.originalSender && message.originalSender === UserManager.userId);

        let msgDiv = null; // 消息的DOM元素
        let mainContentWrapper = null; // 消息主要内容的包装器
        let contentElement = null; // 消息内容本身的元素

        // 如果消息已存在于DOM中 (通过ID查找)，则获取它以进行更新
        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender]; // 获取发送者联系人信息
        const isAIMessage = !isSentByMe && senderContact?.isAI; // 判断是否为AI发送的消息
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts; // 获取AI消息的TTS配置

        if (msgDiv) { // 更新现有消息的逻辑
            // 如果消息要被更新为撤回状态，且之前不是撤回状态，则清空其内部HTML以便重绘
            if (message.isRetracted && !msgDiv.classList.contains('retracted')) {
                msgDiv.innerHTML = ''; // 清空内容，准备重绘为撤回提示
            } else {
                // 否则，尝试获取内容包装器和内容元素以进行可能的流式更新（如AI回复）
                mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
                contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
            }
        } else { // 创建新消息元素的逻辑
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`; // 根据发送者设置CSS类
            if (message.id) msgDiv.setAttribute('data-message-id', message.id); // 设置消息ID属性
            if (message.sender) msgDiv.setAttribute('data-sender-id', message.sender); // 设置发送者ID属性
            if (message.timestamp) msgDiv.setAttribute('data-timestamp', new Date(message.timestamp).getTime()); // 设置时间戳属性
        }

        // 更新消息的CSS类列表 (对于已存在的msgDiv也很重要，以防状态改变，例如从普通消息变为撤回消息)
        if (message.type === 'system' || message.isRetracted) {
            msgDiv.classList.add('system'); // 系统消息或撤回消息添加 'system' 类
        } else {
            msgDiv.classList.remove('system'); // 确保非系统消息没有system类
        }
        if (message.isThinking) msgDiv.classList.add('thinking'); else msgDiv.classList.remove('thinking'); // AI思考状态
        if (message.isRetracted) msgDiv.classList.add('retracted'); else msgDiv.classList.remove('retracted'); // 消息撤回状态
        if (isAIMessage && senderContact?.id) { // 为AI角色消息添加特定类，用于定制样式
            msgDiv.classList.add('character-message', senderContact.id);
        }


        let initialHtmlStructure = ''; // 用于构建消息内部HTML的字符串
        // 如果是新消息，或者消息从非撤回状态变为撤回状态 (此时msgDiv.innerHTML已被清空，需要重新构建)
        if (!contentElement || (message.isRetracted && msgDiv.innerHTML === '')) {
            let senderNameHtml = '';
            // 为接收到的非系统、非撤回消息显示发送者名称（通常在群聊或AI消息时）
            if (!isSentByMe && message.type !== 'system' && !message.isRetracted) {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `用户 ${String(message.sender || '').substring(0, 4)}`);
                if (ChatManager.currentChatId?.startsWith('group_') || (senderContact?.isSpecial)) { // 群聊或特殊联系人（如AI）
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml; // 添加发送者名称HTML
            let messageBodyHtml = ''; // 消息主体内容的HTML

            if (message.isRetracted) { // 如果消息已撤回
                let retractedText = "消息已撤回"; // 默认的撤回提示文本
                if (message.retractedBy === UserManager.userId) { // 如果是当前用户自己撤回的
                    retractedText = "你撤回了一条消息";
                } else { // 如果是他人撤回的
                    const retracterName = UserManager.contacts[message.retractedBy]?.name || // 尝试获取撤回者名称
                        (message.originalSenderName && message.retractedBy === (message.originalSender || message.sender) ? message.originalSenderName : null) || // 兼容旧数据或转发场景
                        `用户 ${String(message.retractedBy || message.sender || '').substring(0,4)}`; // 默认名称
                    retractedText = `${Utils.escapeHtml(retracterName)} 撤回了一条消息`;
                }
                // 已撤回消息也使用包装器，以保持结构一致性，便于样式控制
                messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${Utils.escapeHtml(retractedText)}</div></div>`;
            } else { // 非撤回消息，根据消息类型构建内容
                const textContent = message.content; // 消息的文本内容
                const showStreamingCursor = isAIMessage && message.isStreaming; // AI流式消息显示动态光标
                switch (message.type) {
                    case 'text':
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""))}</div></div>`;
                        break;
                    case 'audio': // 语音消息
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="voice-message"><button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button><span class="voice-duration">${Utils.formatTime(message.duration)}</span></div></div>`;
                        break;
                    case 'file': // 文件消息
                        const safeFileName = Utils.escapeHtml(message.fileName || 'file'); // 安全处理文件名
                        if (message.fileType?.startsWith('image/')) { // 图片文件预览
                            messageBodyHtml = `<div class="message-content-wrapper"><img src="${message.data}" alt="${safeFileName}" class="file-preview-img" onclick="UIManager.showFullImage('${message.data}', '${safeFileName}')"></div>`;
                        } else if (message.fileType?.startsWith('video/')) { // 视频文件预览
                            messageBodyHtml = `<div class="message-content-wrapper"><video controls class="file-preview-video" style="max-width:100%;"><source src="${message.data}" type="${message.fileType}"></video><div>${safeFileName}</div></div>`;
                        } else if (message.fileType?.startsWith('audio/')) { // 音频文件预览 (非录制语音)
                            messageBodyHtml = `<div class="message-content-wrapper"><div class="file-info"><span class="file-icon">🎵</span><div class="file-details"><div class="file-name">${safeFileName}</div><audio controls src="${message.data}" style="width:100%"></audio></div></div></div>`;
                        } else { // 其他类型文件
                            messageBodyHtml = `<div class="message-content-wrapper"><div class="file-info"><span class="file-icon">📄</span><div class="file-details"><div class="file-name">${safeFileName}</div><div class="file-meta">${MediaManager.formatFileSize(message.size || 0)}</div></div><a href="${message.data}" download="${safeFileName}" class="download-btn">下载</a></div></div>`;
                        }
                        break;
                    case 'system': // 系统消息 (如入群提示、时间分隔等)，不使用标准的内容包装器
                        messageBodyHtml = `<div class="message-content system-text">${this.formatMessageText(textContent)}</div>`;
                        break;
                    default: // 未知消息类型
                        messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">[不支持的类型: ${message.type}]</div></div>`;
                }
            }
            initialHtmlStructure += messageBodyHtml; // 添加消息主体HTML
            // 添加时间戳
            initialHtmlStructure += `<div class="timestamp">${message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : '正在发送...'}</div>`;
            msgDiv.innerHTML = initialHtmlStructure; // 设置消息元素的完整内部HTML

            // 更新后重新选择元素引用，因为innerHTML会重构DOM树，旧的引用可能失效
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');

        } else { // 更新现有消息 (通常是AI流式文本的更新，或者消息状态的细微变化不涉及结构重绘)
            if (contentElement && message.type === 'text' && !message.isRetracted) {
                const textContent = message.content; // 获取最新文本内容
                const showStreamingCursor = isAIMessage && message.isStreaming; // 判断是否显示流式光标
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : "")); // 更新文本内容
            }
        }

        // 如果是已撤回的消息，则禁用所有可交互元素 (如播放按钮、下载链接、图片点击放大等)
        if (message.isRetracted) {
            const actionableElements = msgDiv.querySelectorAll('img[onclick], .play-voice-btn, .download-btn, video[controls], audio[controls]');
            actionableElements.forEach(el => {
                if (el.tagName === 'IMG' || el.classList.contains('play-voice-btn') || el.classList.contains('download-btn')) {
                    el.onclick = null; // 移除点击事件监听
                    if (el.tagName === 'A') el.removeAttribute('href'); // 移除下载链接的href属性
                } else if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
                    el.removeAttribute('controls'); // 移除播放控件
                    el.removeAttribute('src');      // 移除媒体源
                    if (el.srcObject) el.srcObject = null; // 清除可能的 srcObject
                }
            });
            msgDiv.style.cursor = 'default'; // 重置鼠标光标为默认样式
        }

        // 如果是AI消息且TTS已启用，并且消息已完成流式传输且未被撤回，则处理TTS（文本转语音）
        if (message.type === 'text' && isAIMessage && ttsConfig?.enabled && !message.isStreaming && message.isNewlyCompletedAIResponse && !message.isRetracted) {
            const textForTts = MessageTtsHandler.cleanTextForTts(message.content); // 清理文本以适应TTS引擎
            if (textForTts && textForTts.trim() !== "" && mainContentWrapper) { // 确保有有效文本和内容包装器
                const ttsId = message.id || `tts_${Date.now()}`; // 为TTS请求生成唯一ID，优先使用消息ID
                MessageTtsHandler.addTtsPlaceholder(mainContentWrapper, ttsId); // 在UI中添加TTS播放器占位符或加载指示
                MessageTtsHandler.requestTtsForMessage(textForTts, ttsConfig, mainContentWrapper, ttsId); // 发起TTS请求
            } else {
                Utils.log(`TTS 未为消息 ID ${message.id} 触发: 清理后的文本为空或没有包装器。原文: "${message.content?.substring(0, 50)}..."`, Utils.logLevels.INFO);
            }
        }

        // ---- DOM 插入逻辑 ----
        // 移除“暂无消息”等占位符（如果存在且当前正在添加的是真实用户消息，而非临时状态消息）
        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt):not(.retracted):not([class*="loading-indicator"])'); // 精确选择占位符，排除加载指示器等
        if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
            if (!message.isThinking && !message.isStreaming && !message.isRetracted) { // 仅当新消息不是临时系统消息时移除占位符
                noMsgPlaceholder.remove();
            }
        }

        // 如果消息元素不在DOM中（即是新创建的消息），则根据prepend标志添加到聊天框
        if (!chatBox.contains(msgDiv)) {
            if (prepend && chatBox.firstChild) { // 如果是预置插入（如加载历史记录）且聊天框有子元素
                chatBox.insertBefore(msgDiv, chatBox.firstChild); // 插入到聊天框的最前面
            } else { // 否则，追加到聊天框的末尾
                chatBox.appendChild(msgDiv);
            }
        }
        // 注意：滚动行为现在由 ChatAreaUIManager 在批量操作后或处理新消息时统一管理，以优化性能和用户体验。
    },

    /**
     * 格式化消息文本，转换换行符为 <br>，将 URL 转换为可点击的链接，并处理流式光标。
     * @param {string} text - 要格式化的原始文本。
     * @returns {string} - 格式化后的 HTML 字符串。
     */
    formatMessageText: function (text) {
        if (typeof text !== 'string') return ''; // 防御空或非字符串输入
        // 首先对整个文本进行HTML转义，防止XSS攻击
        let escapedText = Utils.escapeHtml(text);
        // 将多个连续空格替换为一个空格，但保留换行符前的单个空格（HTML默认会合并空格）
        // 这一步通常浏览器渲染时会自动处理，但明确化可能有助于特定场景
        escapedText = escapedText.replace(/ {2,}/g, ' ');
        // 替换换行符 (\n) 为HTML的换行标签 (<br>)
        escapedText = escapedText.replace(/\n/g, '<br>');
        // 将特定的流式光标字符 '▍' 替换为一个带样式的span元素，以便CSS控制其闪烁等效果
        escapedText = escapedText.replace(/▍/g, '<span class="streaming-cursor">▍</span>');

        // URL 正则表达式，匹配 http, https, ftp, file 协议的网址
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        // 将匹配到的URL替换为可点击的<a>标签
        return escapedText.replace(urlRegex, function (url) {
            // url参数是匹配到的原始URL（此时已HTML转义）。
            // 链接的href属性应该使用原始URL（未转义的，或正确编码的），但此处url是从escapedText中匹配的，所以它本身是转义过的。
            // 现代浏览器通常能较好处理href中的实体，但最安全做法是href用原始URL，显示文本用转义URL。
            // 这里为了简单，href和显示文本都用了转义后的url。如果url中包含&等字符，已被转义为&，这在href中是有效的。
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    },

    /**
     * 取消当前已选择但未发送的文件。
     */
    cancelFileData: function () {
        // 如果选择的文件数据是一个Object URL (例如来自截图或本地Blob)，则需要释放它以避免内存泄漏
        if (MessageManager.selectedFile && MessageManager.selectedFile.data && typeof MessageManager.selectedFile.data === 'string' && MessageManager.selectedFile.data.startsWith('blob:')) {
            URL.revokeObjectURL(MessageManager.selectedFile.data);
        }
        MessageManager.selectedFile = null; // 清空已选文件信息
        document.getElementById('filePreviewContainer').innerHTML = ''; // 清空文件预览UI区域
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.value = ''; // 重置文件输入框的状态，这样用户可以再次选择相同的文件
    },

    /**
     * 取消当前已录制但未发送的语音。
     */
    cancelAudioData: function () {
        MessageManager.audioData = null; // 清空已录制的音频数据
        MessageManager.audioDuration = 0; // 清空音频时长记录
        document.getElementById('audioPreviewContainer').innerHTML = ''; // 清空音频预览UI区域
        MediaManager.releaseAudioResources(); // 释放麦克风等音频录制相关资源
        if (typeof MediaUIManager !== 'undefined') {
            MediaUIManager.resetRecordingButtonUI(); // 调用MediaUIManager重置录音按钮的UI状态
        } else {
            Utils.log("在 MessageManager.cancelAudioData 中 MediaUIManager 未定义", Utils.logLevels.WARN);
        }
    },

    /**
     * 触发清空当前聊天记录的确认流程。
     */
    clearChat: function () {
        if (!ChatManager.currentChatId) { // 检查是否已选择聊天
            NotificationManager.showNotification('未选择要清空的聊天。', 'warning');
            return;
        }
        // 显示一个确认模态框，防止用户误操作
        ModalManager.showConfirmationModal(
            '您确定要清空此聊天中的消息吗？此操作无法撤销。', // 提示信息
            () => { // 用户点击确认后的回调函数
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) NotificationManager.showNotification('聊天记录已清空。', 'success');
                    else NotificationManager.showNotification('清空聊天记录失败。', 'error');
                });
            }
        );
    },

    /**
     * 本地删除一条消息。这仅从当前用户的视图和本地存储中删除，不会通知其他用户。
     * @param {string} messageId - 要删除的消息的ID。
     */
    deleteMessageLocally: function(messageId) {
        const chatId = ChatManager.currentChatId; // 获取当前聊天ID
        if (!chatId || !ChatManager.chats[chatId]) return; // 确保当前聊天和聊天记录存在

        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId); // 查找消息索引
        if (messageIndex !== -1) { // 如果找到消息
            ChatManager.chats[chatId].splice(messageIndex, 1); // 从内存中的聊天记录数组中移除该消息
            const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove(); // 从DOM中移除对应的消息元素
            }
            ChatManager.saveCurrentChat(); // 保存更改到本地存储（如IndexedDB）

            // 更新侧边栏联系人列表或群组列表中的最后消息预览
            const remainingMessages = ChatManager.chats[chatId];
            let newPreview = "聊天记录已更新"; // 默认预览文本
            if (remainingMessages.length > 0) {
                const lastMsg = remainingMessages[remainingMessages.length - 1]; // 获取新的最后一条消息
                if (chatId.startsWith('group_')) { // 如果是群聊
                    newPreview = GroupManager.formatMessagePreview(lastMsg);
                } else { // 如果是单聊
                    newPreview = UserManager.formatMessagePreview(lastMsg);
                }
            } else { // 如果聊天记录已空
                newPreview = "暂无消息";
            }
            // 更新对应联系人或群组的最后消息状态
            if (chatId.startsWith('group_')) {
                GroupManager.updateGroupLastMessage(chatId, newPreview, false, true); // (chatId, message, isUnread, updateTimestamp)
            } else {
                UserManager.updateContactLastMessage(chatId, newPreview, false, true);
            }
            NotificationManager.showNotification("消息已删除。", "success");
        } else {
            NotificationManager.showNotification("无法找到要删除的消息。", "warning");
        }
    },

    /**
     * 请求撤回一条消息。会向对方或群组发送撤回请求。
     * @param {string} messageId - 要撤回的消息的ID。
     */
    requestRetractMessage: function(messageId) {
        const chatId = ChatManager.currentChatId; // 获取当前聊天ID
        if (!chatId || !ChatManager.chats[chatId]) return; // 确保当前聊天和聊天记录存在

        const message = ChatManager.chats[chatId].find(msg => msg.id === messageId); // 查找要撤回的消息对象
        if (!message) { // 如果未找到消息
            NotificationManager.showNotification("无法找到要撤回的消息。", "warning");
            return;
        }
        if (message.sender !== UserManager.userId) { // 检查是否是自己发送的消息
            NotificationManager.showNotification("只能撤回自己发送的消息。", "error");
            return;
        }
        const messageTime = new Date(message.timestamp).getTime(); // 获取消息发送时间戳
        // 检查消息是否在可撤回的时间窗口内 (例如：2分钟内)
        if (Date.now() - messageTime > Config.ui.messageRetractionWindow) {
            NotificationManager.showNotification(`消息已超过${Config.ui.messageRetractionWindow / (60 * 1000)}分钟，无法撤回。`, "warning");
            return;
        }

        const myName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName; // 获取当前用户的显示名称

        if (chatId.startsWith('group_')) { // 如果是群聊消息
            const retractRequest = { // 构建群消息撤回请求体
                type: 'group-retract-message-request',
                originalMessageId: messageId,
                sender: UserManager.userId, // 请求发起者
                originalSender: message.sender, // 原始消息发送者 (总是自己)
                originalSenderName: myName // 原始消息发送者名称
            };
            const broadcastSuccess = GroupManager.broadcastToGroup(chatId, retractRequest); // 向群组广播撤回请求
            if (broadcastSuccess) {
                // 本地立即更新消息为撤回状态，无需等待服务器确认（乐观更新）
                this._updateMessageToRetractedState(messageId, chatId, true, myName);
            } else {
                NotificationManager.showNotification("发送群消息撤回请求失败。", "error");
            }
        } else { // 如果是P2P聊天消息
            if (!ConnectionManager.isConnectedTo(chatId)) { // 检查与对方的连接状态
                NotificationManager.showNotification("对方不在线，暂时无法撤回消息。", "warning");
                return;
            }
            const retractRequest = { // 构建P2P消息撤回请求体
                type: 'retract-message-request',
                originalMessageId: messageId,
                sender: UserManager.userId, // 请求发起者
                targetUserId: chatId, // 目标用户ID
                senderName: myName // 发送者名称，用于对方显示 "XXX撤回了一条消息"
            };
            const sent = ConnectionManager.sendTo(chatId, retractRequest); // 向对方发送撤回请求
            if (sent) {
                // 本地立即更新消息为撤回状态
                this._updateMessageToRetractedState(messageId, chatId, true, myName);
            } else {
                NotificationManager.showNotification("发送消息撤回请求失败。", "error");
            }
        }
    },

    /**
     * 内部辅助函数：将指定消息更新为撤回状态，并在UI和本地存储中反映此更改。
     * 此函数被本地撤回操作和接收到他人撤回通知时调用。
     * @param {string} messageId - 要撤回的消息的ID。
     * @param {string} chatId - 消息所在的聊天ID。
     * @param {boolean} isOwnRetraction - 指示是否是当前用户自己执行的撤回操作。
     * @param {string} [retractedByName=null] - 撤回者的显示名称（主要用于他人撤回时，若为null则尝试自动获取）。
     * @private
     */
    _updateMessageToRetractedState: function(messageId, chatId, isOwnRetraction, retractedByName = null) {
        if (!ChatManager.chats[chatId]) return; // 确保聊天记录存在
        const messageIndex = ChatManager.chats[chatId].findIndex(msg => msg.id === messageId); // 查找消息索引
        if (messageIndex === -1) return; // 如果消息未找到，则不执行任何操作

        const originalMessage = ChatManager.chats[chatId][messageIndex]; // 获取原始消息对象
        let retracterDisplayName; // 撤回者的显示名称
        if (isOwnRetraction) { // 如果是自己撤回
            retracterDisplayName = UserManager.contacts[UserManager.userId]?.name || UserManager.userName || "你";
        } else if(retractedByName) { // 如果外部提供了撤回者名称 (例如从通知中获取)
            retracterDisplayName = retractedByName;
        } else if (originalMessage.sender) { // 否则，尝试从原始发送者信息获取 (适用于对方撤回)
            retracterDisplayName = UserManager.contacts[originalMessage.sender]?.name || `用户 ${String(originalMessage.sender).substring(0,4)}`;
        } else {
            retracterDisplayName = "对方"; // 最终回退
        }

        // 创建一个新的消息对象来表示撤回状态，而不是直接修改旧的。
        // 这样做的好处是 ChatManager.addMessage 可以统一处理新消息的插入/更新逻辑，
        // 包括UI渲染和本地存储。
        const retractedMessage = {
            ...originalMessage, // 继承原始消息的ID、时间戳等基本属性
            type: 'system',     // 撤回的消息在UI上通常表现为一种系统提示类型的消息
            content: isOwnRetraction ? "你撤回了一条消息" : `${Utils.escapeHtml(retracterDisplayName)} 撤回了一条消息`,
            isRetracted: true,  // 明确标记为已撤回状态
            retractedBy: isOwnRetraction ? UserManager.userId : (originalMessage.sender || null), // 记录撤回操作的发起者ID
            originalType: originalMessage.type, // 保存原始消息类型，可能用于某些特殊处理或统计

            // 清除可能存在的媒体数据和文件信息，因为消息内容已变为撤回提示
            data: null, fileId: null, fileName: null, fileType: null, fileSize: null, duration: null,

            // 清除AI相关的临时状态，如果原始消息是AI消息
            isNewlyCompletedAIResponse: false,
            isStreaming: false,
            isThinking: false
        };

        // 使用ChatManager.addMessage来统一处理UI更新和数据持久化。
        // ChatManager.addMessage内部会判断messageId是否已存在，如果存在则视为更新。
        ChatManager.addMessage(chatId, retractedMessage);
    }
};