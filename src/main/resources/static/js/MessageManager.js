
const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,

    sendMessage: async function() {
        const input = document.getElementById('messageInput');
        const messageText = input.value.trim();
        // Make sure to use MessageManager's own properties, not module-level ones
        const currentSelectedFile = MessageManager.selectedFile;
        const currentAudioData = MessageManager.audioData;
        const currentAudioDuration = MessageManager.audioDuration;


        if (!ChatManager.currentChatId) {
            UIManager.showNotification('Select a chat to send a message.', 'warning');
            return;
        }

        const isGroup = ChatManager.currentChatId.startsWith('group_');
        const targetId = ChatManager.currentChatId;
        const contact = UserManager.contacts[targetId];

        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                UIManager.showNotification(`Audio/File messages are not supported with ${contact.name}.`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData();
                if (currentSelectedFile) MessageManager.cancelFileData();
                return;
            }
            if (!messageText) return;

            const userMessage = {
                type: 'text',
                content: messageText,
                timestamp: new Date().toISOString(),
                sender: UserManager.userId
            };
            ChatManager.addMessage(targetId, userMessage);
            input.value = '';
            input.style.height = 'auto';
            input.focus();

            const thinkingMsgId = `thinking_${Date.now()}`;
            const thinkingMessage = {
                id: thinkingMsgId,
                type: 'system',
                content: `${contact.name} is thinking...`,
                timestamp: new Date().toISOString(),
                sender: targetId, // Sender is the AI contact
                isThinking: true
            };
            MessageManager.displayMessage(thinkingMessage, false);

            const chatBox = document.getElementById('chatBox');
            let thinkingElement = chatBox.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);

            try {
                const requestBody = {
                    model: contact.aiConfig.model,
                    messages: [
                        { role: "system", content: contact.aiConfig.systemPrompt },
                        { role: "user", content: messageText }
                    ],
                    stream: false,
                    temperature: 0.1, // Example, could be part of aiConfig
                    max_tokens: contact.aiConfig.max_tokens || 1000 // Example
                };

                Utils.log(`Sending to AI (${contact.name}): ${JSON.stringify(requestBody)}`, Utils.logLevels.DEBUG);

                const response = await fetch(contact.aiConfig.apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': contact.aiConfig.apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (thinkingElement && thinkingElement.parentNode) {
                    thinkingElement.remove();
                }

                if (!response.ok) {
                    const errorData = await response.text(); // Or response.json() if API returns JSON errors
                    Utils.log(`AI API Error (${response.status}) for ${contact.name}: ${errorData}`, Utils.logLevels.ERROR);
                    throw new Error(`API request failed for ${contact.name} with status ${response.status}.`);
                }

                const responseData = await response.json();
                Utils.log(`AI Response from ${contact.name}: ${JSON.stringify(responseData)}`, Utils.logLevels.DEBUG);

                let aiReplyContent = "Sorry, I couldn't process that.";
                if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
                    aiReplyContent = responseData.choices[0].message.content;
                } else if (responseData.error) {
                    aiReplyContent = `Error from AI ${contact.name}: ${responseData.error.message || 'Unknown error'}`;
                    Utils.log(`AI ${contact.name} reported error: ${JSON.stringify(responseData.error)}`, Utils.logLevels.ERROR);
                }

                const aiMessage = {
                    type: 'text',
                    content: aiReplyContent,
                    timestamp: new Date().toISOString(),
                    sender: targetId // AI is the sender
                };
                ChatManager.addMessage(targetId, aiMessage);

            } catch (error) {
                if (thinkingElement && thinkingElement.parentNode) {
                    thinkingElement.remove();
                }
                Utils.log(`Error communicating with AI (${contact.name}): ${error}`, Utils.logLevels.ERROR);
                UIManager.showNotification(`Error: Could not get reply from ${contact.name}.`, 'error');

                const errorMessageToUser = {
                    type: 'text',
                    content: `Sorry, an error occurred while I (${contact.name}) was thinking: ${error.message}`,
                    timestamp: new Date().toISOString(),
                    sender: targetId
                };
                ChatManager.addMessage(targetId, errorMessageToUser);
            }
            return;
        }


        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || currentSelectedFile || currentAudioData) {
                UIManager.showReconnectPrompt(targetId, () => {
                    Utils.log("Reconnection successful, user may need to resend message.", Utils.logLevels.INFO);
                    // Potentially, we could automatically resend the message here if it was stored.
                    // For now, user needs to resend.
                });
                return;
            }
        }

        if (!messageText && !currentSelectedFile && !currentAudioData) {
            return;
        }

        let messageSent = false;

        if (currentAudioData) {
            const audioMessage = {
                type: 'audio',
                data: currentAudioData,
                duration: currentAudioDuration,
                timestamp: new Date().toISOString(),
            };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage);
            else ConnectionManager.sendTo(targetId, audioMessage);

            ChatManager.addMessage(targetId, {...audioMessage, sender: UserManager.userId});
            messageSent = true;
            MessageManager.cancelAudioData();
        }

        if (currentSelectedFile) {
            const fileMessage = {
                type: 'file',
                fileId: `${Date.now()}-${Utils.generateId(6)}`,
                fileName: currentSelectedFile.name,
                fileType: currentSelectedFile.type,
                fileSize: currentSelectedFile.size,
                data: currentSelectedFile.data,
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

        if (message.id) {
            msgDiv.setAttribute('data-message-id', message.id);
        }
        if (message.sender) {
            msgDiv.setAttribute('data-sender-id', message.sender);
        }

        if (message.type === 'system') {
            msgDiv.classList.add('system');
            msgDiv.classList.remove('sent', 'received');
            if (message.isThinking) {
                msgDiv.classList.add('thinking');
            }
        }

        let contentHtml = '';
        let senderName = '';
        const senderContact = UserManager.contacts[message.sender];


        if (senderContact && senderContact.isSpecial) {
            senderName = senderContact.name;
        } else if (message.originalSenderName) { // For group messages primarily
            senderName = message.originalSenderName;
        } else if (senderContact) {
            senderName = senderContact.name;
        } else if (message.sender === UserManager.userId) {
            senderName = UserManager.userName;
        } else {
            senderName = `User ${String(message.sender).substring(0,4)}`;
        }


        if (!isSentByMe && message.type !== 'system') {
            if (ChatManager.currentChatId?.startsWith('group_')) {
                contentHtml += `<div class="message-sender">${message.originalSenderName || senderName}</div>`;
            } else if (senderContact && senderContact.isSpecial) {
                contentHtml += `<div class="message-sender">${senderContact.name}</div>`;
            }
            // For direct non-special contacts, sender name is usually clear from chat header,
            // so not adding it here to keep bubble cleaner. Can be added if desired.
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

        const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking)');
        if (noMsgPlaceholder &&
            (noMsgPlaceholder.textContent.includes("No messages yet") ||
                noMsgPlaceholder.textContent.includes("You created this group") ||
                noMsgPlaceholder.textContent.includes("Start a conversation with"))) {
            if (!message.isThinking) {
                noMsgPlaceholder.remove();
            }
        }

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
        MessageManager.selectedFile = null;
        document.getElementById('filePreviewContainer').innerHTML = '';
        const fileInput = document.getElementById('fileInput');
        if(fileInput) fileInput.value = '';
    },

    cancelAudioData: function() {
        MessageManager.audioData = null;
        MessageManager.audioDuration = 0;
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
            () => {
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) UIManager.showNotification('Chat history cleared.', 'success');
                    else UIManager.showNotification('Failed to clear chat history.', 'error');
                });
            }
        );
    },
};