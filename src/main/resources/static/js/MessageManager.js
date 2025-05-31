
const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,

    sendMessage: function() {
        const input = document.getElementById('messageInput');
        const messageText = input.value.trim();
        // Correctly access properties of MessageManager
        // this.audioData = MessageManager.audioData; // This was redundant
        this.selectedFile = MessageManager.selectedFile;
        this.audioData = MessageManager.audioData;
        this.audioDuration = MessageManager.audioDuration;

        if (!ChatManager.currentChatId) {
            UIManager.showNotification('Select a chat to send a message.', 'warning');
            return;
        }

        const isGroup = ChatManager.currentChatId.startsWith('group_');
        const targetId = ChatManager.currentChatId;

        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || this.selectedFile || this.audioData) {
                UIManager.showReconnectPrompt(targetId, () => {
                    Utils.log("Reconnection successful, attempting to resend message.", Utils.logLevels.INFO);
                });
                return;
            }
        }


        if (!messageText && !this.selectedFile && !this.audioData) {
            return;
        }

        let messageSent = false;

        if (this.audioData) {
            const audioMessage = {
                type: 'audio',
                data: this.audioData,
                duration: this.audioDuration,
                timestamp: new Date().toISOString(),
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage);
            else ConnectionManager.sendTo(targetId, audioMessage);

            ChatManager.addMessage(targetId, {...audioMessage, sender: UserManager.userId});
            messageSent = true;
            MessageManager.cancelAudioData();
        }

        if (this.selectedFile) {
            const fileMessage = {
                type: 'file',
                fileId: `${Date.now()}-${Utils.generateId(6)}`,
                fileName: this.selectedFile.name,
                fileType: this.selectedFile.type,
                fileSize: this.selectedFile.size,
                data: this.selectedFile.data,
                timestamp: new Date().toISOString(),
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, fileMessage);
            else ConnectionManager.sendTo(targetId, fileMessage);

            ChatManager.addMessage(targetId, {...fileMessage, sender: UserManager.userId});
            messageSent = true;
            MessageManager.cancelFileData();
        }

        if (messageText) {
            const textMessage = {
                type: 'text',
                content: messageText,
                timestamp: new Date().toISOString(),
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, textMessage);
            else ConnectionManager.sendTo(targetId, textMessage);

            ChatManager.addMessage(targetId, { ...textMessage, sender: UserManager.userId });
            messageSent = true;
            input.value = '';
            input.style.height = 'auto';
        }

        if (messageSent) {
            input.focus();
        }
    },

    displayMessage: function(message, isSentByMe) {
        const chatBox = document.getElementById('chatBox');
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
        if (message.type === 'system') {
            msgDiv.classList.add('system');
            msgDiv.classList.remove('sent', 'received');
        }

        let contentHtml = '';
        const senderName = message.originalSenderName ||
            (UserManager.contacts[message.sender]?.name ||
                (message.sender === UserManager.userId ? UserManager.userName : `User ${String(message.sender).substring(0,4)}`));

        if (!isSentByMe && ChatManager.currentChatId?.startsWith('group_') && message.type !== 'system') {
            contentHtml += `<div class="message-sender">${senderName}</div>`;
        }

        switch (message.type) {
            case 'text':
                contentHtml += `<div class="message-content">${this.formatMessageText(message.content)}</div>`;
                break;
            case 'audio':
                contentHtml += `
                    <div class="voice-message">
                        <button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button>
                        <span class="voice-duration">${Utils.formatTime(message.duration)}</span>
                    </div>`;
                break;
            case 'file':
                const safeFileName = Utils.escapeHtml(message.fileName || 'file');
                if (message.fileType?.startsWith('image/')) {
                    contentHtml += `<img src="${message.data}" alt="${safeFileName}" class="file-preview-img" onclick="UIManager.showFullImage('${message.data}', '${safeFileName}')">`;
                } else if (message.fileType?.startsWith('video/')) {
                    contentHtml += `
                        <video controls class="file-preview-video" style="max-width:100%;">
                            <source src="${message.data}" type="${message.fileType}">
                            Preview not supported.
                        </video>
                        <div>${safeFileName}</div>`;
                } else if (message.fileType?.startsWith('audio/')) {
                    contentHtml += `
                        <div class="file-info">
                            <span class="file-icon">🎵</span>
                            <div class="file-details">
                                <div class="file-name">${safeFileName}</div>
                                <audio controls src="${message.data}" style="width:100%"></audio>
                            </div>
                        </div>`;
                }
                else {
                    contentHtml += `
                        <div class="file-info">
                            <span class="file-icon">📄</span>
                            <div class="file-details">
                                <div class="file-name">${safeFileName}</div>
                                <div class="file-meta">${MediaManager.formatFileSize(message.fileSize || 0)}</div>
                            </div>
                            <a href="${message.data}" download="${safeFileName}" class="download-btn">Download</a>
                        </div>`;
                }
                break;
            case 'system':
                contentHtml = `<div class="message-content system-text">${this.formatMessageText(message.content)}</div>`;
                break;
            default:
                contentHtml = `<div class="message-content">[Unsupported message type: ${message.type}]</div>`;
        }

        msgDiv.innerHTML = contentHtml;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'timestamp';
        timestampDiv.textContent = message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : 'sending...';
        msgDiv.appendChild(timestampDiv);

        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    formatMessageText: function(text) {
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text);
        let linkedText = escapedText.replace(/\n/g, '<br>');
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        linkedText = linkedText.replace(urlRegex, function(url) {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
        return linkedText;
    },

    cancelFileData: function() {
        this.selectedFile = null;
        document.getElementById('filePreviewContainer').innerHTML = '';
        document.getElementById('fileInput').value = '';
    },

    cancelAudioData: function() {
        this.audioData = null;
        this.audioDuration = 0;
        document.getElementById('audioPreviewContainer').innerHTML = '';
        MediaManager.releaseAudioResources();
        MediaManager.resetRecordingButton();
    },

    clearChat: function() {
        if (!ChatManager.currentChatId) {
            UIManager.showNotification('No chat selected to clear.', 'warning');
            return;
        }
        UIManager.showConfirmationModal(
            'Are you sure you want to clear messages in this chat? This cannot be undone.',
            () => { // onConfirm
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) UIManager.showNotification('Chat history cleared.', 'success');
                    else UIManager.showNotification('Failed to clear chat history.', 'error');
                });
            }
        );
    },
};