
const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,

    // 发送消息
    sendMessage: function() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();

        // 检查是否有选择的聊天
        if (!ChatManager.currentChatId) {
            UIManager.showNotification('请先选择聊天对象', 'warning');
            return;
        }

        // 检查是否是群聊
        const isGroupChat = ChatManager.currentChatId.startsWith('group_');

        // 如果是群聊，检查群组是否存在
        if (isGroupChat && !GroupManager.groups[ChatManager.currentChatId]) {
            UIManager.showNotification('群聊不存在或您已被移出', 'error');
            return;
        }

        // 如果是私聊，检查连接状态
        if (!isGroupChat) {
            const isConnected = ConnectionManager.isConnectedTo(ChatManager.currentChatId);

            if (!isConnected && (message || this.selectedFile || this.audioData)) {
                // 连接未建立，显示重连提示
                UIManager.showReconnectPrompt(ChatManager.currentChatId, () => {
                    // 重连成功后的回调，重新尝试发送消息
                    this.sendMessage();
                });
                return;
            }
        }

        if (!message && !this.selectedFile && !this.audioData) {
            return;
        }

        // 发送语音消息
        if (this.audioData) {
            const audioMessage = {
                type: 'audio',
                data: this.audioData,
                duration: this.audioDuration,
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            if (isGroupChat) {
                // 发送到群组
                GroupManager.broadcastToGroup(ChatManager.currentChatId, audioMessage);
            } else {
                // 发送到个人
                Utils.sendInChunks(JSON.stringify(audioMessage),
                    (data) => ConnectionManager.connections[ChatManager.currentChatId].dataChannel.send(data));
            }

            // 添加到聊天记录
            ChatManager.addMessage(ChatManager.currentChatId, audioMessage);

            // 更新最后消息
            if (isGroupChat) {
                GroupManager.updateGroupLastMessage(ChatManager.currentChatId, '[语音]');
            } else {
                UserManager.updateContactLastMessage(ChatManager.currentChatId, '[语音]');
            }

            this.cancelAudioData();
        }

        // 发送文件消息
        if (this.selectedFile) {
            // 生成唯一文件ID
            const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

            const fileMessage = {
                type: 'file',  // 统一使用file类型
                fileId: fileId,
                fileName: this.selectedFile.name,
                fileType: this.selectedFile.type,
                fileSize: this.selectedFile.size,
                data: this.selectedFile.data,  // 这里包含文件的base64数据
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            if (isGroupChat) {
                // 发送到群组
                GroupManager.broadcastToGroup(ChatManager.currentChatId, fileMessage);
            } else {
                // 发送到个人
                Utils.sendInChunks(JSON.stringify(fileMessage),
                    (data) => ConnectionManager.connections[ChatManager.currentChatId].dataChannel.send(data));
            }

            // 添加到聊天记录
            ChatManager.addMessage(ChatManager.currentChatId, fileMessage);

            // 更新最后消息
            let filePreview = '[文件]';
            if (this.selectedFile.type.startsWith('image/')) filePreview = '[图片]';
            if (this.selectedFile.type.startsWith('video/')) filePreview = '[视频]';
            if (this.selectedFile.type.startsWith('audio/')) filePreview = '[音频]';

            if (isGroupChat) {
                GroupManager.updateGroupLastMessage(ChatManager.currentChatId, filePreview);
            } else {
                UserManager.updateContactLastMessage(ChatManager.currentChatId, filePreview);
            }

            this.cancelFileData();
        }

        // 发送文本消息
        if (message) {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const messageObj = {
                type: 'text',
                content: message,
                links: message.match(urlRegex) || [],
                sender: UserManager.userId,
                timestamp: new Date().toISOString()
            };

            if (isGroupChat) {
                // 发送到群组
                GroupManager.broadcastToGroup(ChatManager.currentChatId, messageObj);
            } else {
                // 发送到个人
                ConnectionManager.connections[ChatManager.currentChatId].dataChannel.send(JSON.stringify(messageObj));
            }

            // 添加到聊天记录
            ChatManager.addMessage(ChatManager.currentChatId, messageObj);

            // 更新最后消息
            if (isGroupChat) {
                GroupManager.updateGroupLastMessage(ChatManager.currentChatId, message);
            } else {
                UserManager.updateContactLastMessage(ChatManager.currentChatId, message);
            }

            input.value = '';
        }
    },

    // 清空聊天记录
    clearChat: function() {
        if (!ChatManager.currentChatId) {
            UIManager.showNotification('请先选择聊天对象', 'warning');
            return;
        }

        // 显示确认对话框
        if (confirm('确定要清空聊天记录吗？此操作不可撤销。')) {
            // 清空聊天
            if (ChatManager.clearChat(ChatManager.currentChatId)) {
                // 添加系统消息提示
                const systemMessage = document.createElement('div');
                systemMessage.className = 'system-message';
                systemMessage.textContent = '已清空聊天记录';
                systemMessage.style.textAlign = 'center';
                systemMessage.style.padding = '10px';
                systemMessage.style.color = '#666';
                systemMessage.style.fontSize = '12px';
                document.getElementById('chatBox').appendChild(systemMessage);

                // 通知用户
                UIManager.showNotification('聊天记录已清空', 'info');

                Utils.log('聊天记录已清空', Utils.logLevels.INFO);
            }
        }
    },

    // 显示消息
    displayMessage: function (message, isSent) {
        const chatBox = document.getElementById('chatBox');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;

        if (typeof message === 'string') {
            // 处理纯文本消息，将换行符转换为<br>标签
            messageDiv.innerHTML = this.formatMessageText(message);
        } else {
            switch (message.type) {
                case 'audio':
                    const audioDiv = document.createElement('div');
                    audioDiv.className = 'voice-message';

                    // 格式化音频持续时间
                    const formattedDuration = typeof message.duration === 'number'
                        ? Utils.formatTime(message.duration)
                        : message.duration;

                    audioDiv.innerHTML = `
                <button onclick="event.stopPropagation(); MediaManager.playAudio(this)" data-audio="${message.data}">
                    播放
                </button>
                <div class="voice-wave">
                    ${Array(5).fill('<div class="wave-bar"></div>').join('')}
                </div>
                <span class="duration">${formattedDuration}</span>
            `;
                    messageDiv.appendChild(audioDiv);
                    break;

                case 'file':
                    // 处理文件消息
                    const fileDiv = document.createElement('div');
                    fileDiv.className = 'file-message';

                    // 检查是否有文件数据
                    const fileData = message.data || '';

                    // 根据文件类型决定展示方式
                    if (message.fileType && message.fileType.startsWith('image/')) {
                        // 图片
                        fileDiv.innerHTML = `
                        ${fileData ? `<img src="${fileData}" class="file-preview-img" alt="${message.fileName}"
                             onclick="MessageManager.showFullImage('${fileData}')">` : '<div class="file-error">图片数据丢失</div>'}
                    `;
                    } else if (message.fileType && message.fileType.startsWith('video/')) {
                        // 视频
                        fileDiv.innerHTML = `
                        ${fileData ? `<video controls class="file-preview-video">
                            <source src="${fileData}" type="${message.fileType}">
                            您的浏览器不支持视频预览
                        </video>` : '<div class="file-error">视频数据丢失</div>'}
                    `;
                    } else {
                        // 其他文件类型
                        const fileSize = MediaManager.formatFileSize(message.fileSize || 0);
                        const fileIcon = MediaManager.getFileIcon(message.fileType);

                        fileDiv.innerHTML = `
                        <div class="file-info">
                            <div class="file-icon">${fileIcon}</div>
                            <div class="file-details">
                                <div class="file-name">${message.fileName || '未知文件'}</div>
                                <div class="file-meta">
                                    <span class="file-size">${fileSize}</span>
                                    <span class="file-type">${message.fileType || '未知类型'}</span>
                                </div>
                            </div>
                            ${fileData ? `<a href="${fileData}" download="${message.fileName}" class="download-btn">下载</a>` :
                            '<span class="download-error">下载失败</span>'}
                        </div>
                    `;
                    }

                    messageDiv.appendChild(fileDiv);
                    break;

                // 兼容旧版本的image类型，将其视为file类型处理
                case 'image':
                    const imgDiv = document.createElement('div');
                    imgDiv.className = 'file-message';

                    // 检查是否有文件数据
                    const imgData = message.data || '';

                    imgDiv.innerHTML = `
                    ${imgData ? `<img src="${imgData}" class="file-preview-img" alt="${message.fileName || '图片'}"
                         onclick="MessageManager.showFullImage('${imgData}')">` : '<div class="file-error">图片数据丢失</div>'}
                `;

                    messageDiv.appendChild(imgDiv);
                    break;

                case 'text':
                    const textDiv = document.createElement('div');
                    // 使用formatMessageText方法处理文本内容，保留换行符
                    textDiv.innerHTML = this.formatMessageText(message.content);
                    messageDiv.appendChild(textDiv);

                    if (message.links && message.links.length > 0) {
                        message.links.forEach(async (link) => {
                            const linkPreview = await this.createLinkPreview(link);
                            messageDiv.appendChild(linkPreview);
                        });
                    }
                    break;

                case 'system':
                    // 处理系统消息
                    const systemDiv = document.createElement('div');
                    systemDiv.className = 'system-message';
                    systemDiv.innerHTML = this.formatMessageText(message.content);
                    messageDiv.className = 'message system'; // 覆盖原来的sent/received类名
                    messageDiv.appendChild(systemDiv);
                    break;

                default:
                    // 未知类型消息
                    messageDiv.textContent = JSON.stringify(message);

            }
        }

        // 添加时间戳和发送者名称
        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';

        // 检查是否是群聊消息
        const isGroupChat = ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_');

        if (isGroupChat && !isSent) {
            const group = GroupManager.groups[ChatManager.currentChatId];

            // 优先使用原始发送者信息
            const senderId = message.originalSender || message.sender;

            // 获取发送者昵称
            let senderName = message.originalSenderName || message.senderName || '未知用户';

            // 如果在联系人列表中有该用户，使用联系人名称
            if (UserManager.contacts[senderId]) {
                senderName = UserManager.contacts[senderId].name;
            }

            // 检查发送者是否是群主
            if (group && senderId === group.owner) {
                timestamp.textContent = `${senderName}(群主) · ${message.timestamp ?
                    new Date(message.timestamp).toLocaleTimeString() :
                    new Date().toLocaleTimeString()}`;
            } else {
                timestamp.textContent = `${senderName} · ${message.timestamp ?
                    new Date(message.timestamp).toLocaleTimeString() :
                    new Date().toLocaleTimeString()}`;
            }

            // 添加转发标识（如果有转发者且不是原始发送者）
            if (message.sender !== message.originalSender && message.sender) {
                const relayInfo = document.createElement('div');
                relayInfo.className = 'relay-info';

                // 获取转发者名称
                let relayerName = '未知用户';
                if (UserManager.contacts[message.sender]) {
                    relayerName = UserManager.contacts[message.sender].name;
                } else if (message.sender === group.owner) {
                    relayerName = '群主';
                }

                relayInfo.textContent = `由 ${relayerName} 转发`;
                timestamp.appendChild(relayInfo);
            }
        } else {
            // 私聊消息或自己发送的消息，只显示时间
            timestamp.textContent = message.timestamp ?
                new Date(message.timestamp).toLocaleTimeString() :
                new Date().toLocaleTimeString();
        }

        messageDiv.appendChild(timestamp);

        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    // 显示全屏图片
    showFullImage: function(src) {
        const modal = document.createElement('div');
        modal.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); display: flex; align-items: center;
            justify-content: center; z-index: 1000; cursor: pointer;
        `;

        const fullImg = document.createElement('img');
        fullImg.src = src;
        fullImg.style = 'max-width: 90%; max-height: 90%; object-fit: contain;';

        modal.appendChild(fullImg);
        document.body.appendChild(modal);

        modal.onclick = () => document.body.removeChild(modal);
    },

    // 对文本进行转义
    formatMessageText: function(text) {
        if (!text) return '';

        // 转义HTML特殊字符，防止XSS攻击
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        // 将换行符转换为<br>标签
        return escaped.replace(/\n/g, '<br>');
    },

    // 链接预览
    createLinkPreview: async function (url) {
        const preview = document.createElement('div');
        preview.className = 'link-preview';
        preview.innerHTML = `
            <div class="link-preview-loading">
                <span class="loading-spinner"></span> 加载预览中...
            </div>
        `;

        try {
            const previewData = await this.fetchLinkPreview(url);

            if (previewData) {
                preview.innerHTML = `
                    <div class="link-preview-content">
                        ${previewData.image ?
                    `<img src="${previewData.image}"
                                class="link-preview-image"
                                onerror="this.style.display='none'"
                                alt="${previewData.title || '链接预览'}">`
                    : ''}
                        <div class="link-preview-title">${previewData.title || url}</div>
                        <div class="link-preview-description">${previewData.description || '无描述'}</div>
                        <div class="link-preview-domain">
                            <img src="https://www.google.com/s2/favicons?domain=${previewData.domain}"
                                width="16" height="16" onerror="this.style.display='none'" alt="">
                            ${previewData.domain}
                        </div>
                    </div>
                `;
            } else {
                preview.innerHTML = `
                    <div class="link-preview-content">
                        <div class="link-preview-title">${url}</div>
                        <div class="preview-error">无法加载预览</div>
                    </div>
                `;
            }
        } catch (error) {
            preview.innerHTML = `
                <div class="link-preview-content">
                    <div class="link-preview-title">${url}</div>
                    <div class="preview-error">预览加载失败</div>
                </div>
            `;
        }

        preview.onclick = () => window.open(url, '_blank');
        return preview;
    },

    // 获取链接预览
    fetchLinkPreview: async function (url) {
        try {
            // 使用第三方API获取链接预览（考虑中国网络情况，可能需要替换为国内可用的服务）
            // 在生产环境应使用自己的后端服务来代理请求，避免API服务的限制
            const proxyUrl = 'https://api.allorigins.win/raw?url=';
            const response = await fetch(`${proxyUrl}${encodeURIComponent(url)}`, {
                method: 'GET',
                headers: {'Content-Type': 'text/html'},
                mode: 'cors',
                cache: 'force-cache'
            });

            if (!response.ok) throw new Error('无法获取链接内容');

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 提取Open Graph数据
            const getMetaContent = (name) => {
                const element = doc.querySelector(`meta[property="og:${name}"], meta[name="${name}"], meta[name="og:${name}"]`);
                return element ? element.getAttribute('content') : null;
            };

            const title = getMetaContent('title') || doc.title || '';
            const description = getMetaContent('description') || '';
            const image = getMetaContent('image') || '';
            const domain = new URL(url).hostname;

            return {title, description, image, domain};
        } catch (error) {
            Utils.log(`链接预览获取失败: ${error.message}`, Utils.logLevels.ERROR);

            // 返回基本信息
            try {
                const domain = new URL(url).hostname;
                return {
                    title: url,
                    description: '',
                    image: null,
                    domain: domain
                };
            } catch (e) {
                return null;
            }
        }
    },

    // 取消文件数据
    cancelFileData: function () {
        this.selectedFile = null;
        document.getElementById('filePreviewContainer').innerHTML = '';
        document.getElementById('fileInput').value = '';
    },

    // 取消音频数据
    cancelAudioData: function () {
        this.audioData = null;
        this.audioDuration = 0;
        document.getElementById('audioPreviewContainer').innerHTML = '';

        // 确保释放媒体资源
        MediaManager.releaseAudioResources();
    }
};