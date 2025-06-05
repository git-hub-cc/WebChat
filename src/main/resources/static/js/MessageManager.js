// MessageManager.js

const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,

    sendMessage: async function() {
        const input = document.getElementById('messageInput');
        const messageText = input.value.trim();
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
        const chatBox = document.getElementById('chatBox');


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
            let thinkingElement = chatBox.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);

            try {
                const fiveMinutesAgo = new Date().getTime() - (Config.ai.sessionTime);
                const chatHistory = ChatManager.chats[targetId] || [];
                const recentMessages = chatHistory.filter(msg => {
                    const msgTimestamp = new Date(msg.timestamp).getTime();
                    return msg.type === 'text' && msgTimestamp > fiveMinutesAgo;
                });

                const contextMessagesForAI = recentMessages.map(msg => {
                    let role = 'user';
                    if (msg.sender === UserManager.userId) role = 'user';
                    else if (msg.sender === targetId) role = 'assistant';
                    return { role: role, content: msg.content };
                });

                const aiApiMessages = [
                    { role: "system", content: contact.aiConfig.systemPrompt }
                ];
                aiApiMessages.push(...contextMessagesForAI);
                aiApiMessages.push({ role: "user", content: messageText });

                const requestBody = {
                    model: Config.server.model,
                    messages: aiApiMessages,
                    stream: true, // <<<< CHANGED TO TRUE FOR STREAMING
                    temperature: 0.1,
                    max_tokens: Config.server.max_tokens || 1000
                };

                Utils.log(`Sending to AI (${contact.name}) (streaming): ${JSON.stringify(requestBody.messages)}`, Utils.logLevels.DEBUG);

                const response = await fetch(Config.server.apiEndpoint, {
                    method: 'POST',
                    headers: {
                        // 'Authorization': Config.server.api_key, // Assumes API key is the token. Use 'Bearer ' + key if needed.
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                // Remove "thinking..." message as stream is about to start or has started
                if (thinkingElement && thinkingElement.parentNode) {
                    thinkingElement.remove();
                    thinkingElement = null; // Ensure it's not reused
                }

                if (!response.ok) {
                    const errorData = await response.text();
                    Utils.log(`AI API Error (${response.status}) for ${contact.name}: ${errorData}`, Utils.logLevels.ERROR);
                    throw new Error(`API request failed for ${contact.name} with status ${response.status}.`);
                }

                const aiMessageId = `ai_stream_${Date.now()}`;
                let fullAiResponseContent = "";
                const initialAiMessage = {
                    id: aiMessageId,
                    type: 'text',
                    content: "▍", // Initial cursor or empty
                    timestamp: new Date().toISOString(),
                    sender: targetId,
                    isStreaming: true // Custom flag
                };
                // Add the initial placeholder message to ChatManager.chats AND display it
                ChatManager.addMessage(targetId, initialAiMessage); // This will also save it initially
                let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                if (!aiMessageElement) {
                    // If displayMessage hasn't rendered it yet (e.g. due to async operations in ChatManager.addMessage)
                    // We force a display here. This is a bit of a race condition safeguard.
                    // Ideally, ChatManager.addMessage guarantees sync display if current chat.
                    MessageManager.displayMessage(initialAiMessage, false);
                    aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                }


                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { value, done: readerDone } = await reader.read();
                    if (readerDone) {
                        // Process any remaining data in buffer after stream ends
                        buffer += decoder.decode(); // Final decode for any remaining bytes in decoder
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });

                    let stopStreaming = false;

                    // Process buffer for complete JSON objects if it's not just "[DONE]"
                    if (buffer.trim() === "[DONE]") {
                        stopStreaming = true; // Stop processing if only [DONE] is received
                    } else if (buffer.includes("[DONE]")) {
                        const partBeforeDone = buffer.substring(0, buffer.indexOf("[DONE]"));
                        buffer = partBeforeDone; // Process what's before [DONE]
                        stopStreaming = true; // Signal to stop after this iteration
                    }

                    let boundary = 0;
                    let processedSomethingThisIteration = false;
                    while (boundary < buffer.length) {
                        const startIdx = buffer.indexOf('{', boundary);
                        if (startIdx === -1) {
                            buffer = buffer.substring(boundary); // Keep unprocessed part
                            break;
                        }

                        let openBraces = 0;
                        let endIdx = -1;
                        for (let i = startIdx; i < buffer.length; i++) {
                            if (buffer[i] === '{') openBraces++;
                            else if (buffer[i] === '}') {
                                openBraces--;
                                if (openBraces === 0) {
                                    endIdx = i;
                                    break;
                                }
                            }
                        }

                        if (endIdx !== -1) {
                            const jsonString = buffer.substring(startIdx, endIdx + 1);
                            try {
                                const jsonChunk = JSON.parse(jsonString);
                                processedSomethingThisIteration = true;
                                if (jsonChunk.choices && jsonChunk.choices[0] && jsonChunk.choices[0].delta) {
                                    const deltaContent = jsonChunk.choices[0].delta.content;
                                    if (deltaContent) {
                                        fullAiResponseContent += deltaContent;
                                        if (aiMessageElement) {
                                            aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍");
                                            chatBox.scrollTop = chatBox.scrollHeight;
                                        }
                                    }
                                    if (jsonChunk.choices[0].finish_reason === "stop") {
                                        // Actual content stream might end here
                                        // We'll wait for [DONE] or readerDone to be sure.
                                    }
                                }
                            } catch (e) {
                                Utils.log(`AI stream: Error parsing JSON chunk: ${e}. Buffer: ${buffer.substring(0, 200)}`, Utils.logLevels.WARN);
                                // If parse fails, it's risky to advance 'boundary'.
                                // Better to keep 'buffer' as is and hope next chunk completes it,
                                // or if it's malformed, it will be skipped.
                                // For now, we assume brace counting is good enough to get full objects or detect partial ones.
                                // If endIdx was found but parse failed, it means it's not JSON. We consume it to avoid infinite loop.
                                Utils.log(`Skipping non-JSON segment: ${jsonString}`, Utils.logLevels.DEBUG);
                            }
                            boundary = endIdx + 1;
                            if (boundary >= buffer.length) buffer = "";
                        } else {
                            buffer = buffer.substring(startIdx); // Keep partial JSON
                            break;
                        }
                    }
                    if (stopStreaming) break; // Break from reader.read() loop if [DONE] was processed.
                }

                // Final update to remove cursor and save complete message
                if (aiMessageElement) {
                    aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent);
                    chatBox.scrollTop = chatBox.scrollHeight;
                }

                const finalAiMessage = {
                    id: aiMessageId, // Use the same ID
                    type: 'text',
                    content: fullAiResponseContent, // The fully accumulated content
                    timestamp: initialAiMessage.timestamp, // Use timestamp of the first part of the stream
                    sender: targetId,
                    isStreaming: false // Explicitly mark as complete
                };
                ChatManager.addMessage(targetId, finalAiMessage); // Update/replace in ChatManager.chats and save to DB

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

        // ... (rest of the sendMessage logic for non-AI, file/audio sending)
        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || currentSelectedFile || currentAudioData) {
                UIManager.showReconnectPrompt(targetId, () => {
                    Utils.log("Reconnection successful, user may need to resend message.", Utils.logLevels.INFO);
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
        let msgDiv = null;
        let contentElement = null;

        // Try to find existing message div if ID is present (for streaming updates)
        if (message.id) {
            msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);
        }

        if (msgDiv) { // Message div already exists, we are updating it
            contentElement = msgDiv.querySelector('.message-content');
            // Clear existing content if we are about to set new formatted content (for streaming)
            // If it's a system message or other type, this might need adjustment.
            // For streaming text, formatMessageText will replace the content.
        } else { // Create new message div
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
            if (message.id) {
                msgDiv.setAttribute('data-message-id', message.id);
            }
            if (message.sender) {
                msgDiv.setAttribute('data-sender-id', message.sender);
            }
        }

        if (message.type === 'system') {
            msgDiv.classList.add('system');
            msgDiv.classList.remove('sent', 'received');
            if (message.isThinking) {
                msgDiv.classList.add('thinking');
            }
        }

        let contentHtml = ''; // This will be for initial creation
        let senderName = '';
        const senderContact = UserManager.contacts[message.sender];

        if (senderContact && senderContact.isSpecial) {
            senderName = senderContact.name;
        } else if (message.originalSenderName) {
            senderName = message.originalSenderName;
        } else if (senderContact) {
            senderName = senderContact.name;
        } else if (message.sender === UserManager.userId) {
            senderName = UserManager.userName;
        } else {
            senderName = `User ${String(message.sender).substring(0,4)}`;
        }

        if (!isSentByMe && message.type !== 'system' && !msgDiv.querySelector('.message-sender')) { // Add sender name only if not already present
            if (ChatManager.currentChatId?.startsWith('group_')) {
                contentHtml += `<div class="message-sender">${Utils.escapeHtml(message.originalSenderName || senderName)}</div>`;
            } else if (senderContact && senderContact.isSpecial) {
                contentHtml += `<div class="message-sender">${Utils.escapeHtml(senderContact.name)}</div>`;
            }
        }

        // Determine content based on message type for initial creation
        // If contentElement exists (updating), this part constructs the HTML for it
        let messageBodyHtml = '';
        switch (message.type) {
            case 'text':
                messageBodyHtml = `<div class="message-content">${this.formatMessageText(message.content + (message.isStreaming ? "▍" : ""))}</div>`;
                break;
            case 'audio':
                messageBodyHtml = `
<div class="voice-message">
    <button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button>
    <span class="voice-duration">${Utils.formatTime(message.duration)}</span>
</div>`;
                break;
            case 'file':
                const safeFileName = Utils.escapeHtml(message.fileName || 'file');
                if (message.fileType?.startsWith('image/')) {
                    messageBodyHtml = `<img src="${message.data}" alt="${safeFileName}" class="file-preview-img" onclick="UIManager.showFullImage('${message.data}', '${safeFileName}')">`;
                } else if (message.fileType?.startsWith('video/')) {
                    messageBodyHtml = `
    <video controls class="file-preview-video" style="max-width:100%;">
    <source src="${message.data}" type="${message.fileType}">
    Preview not supported.
</video>
<div>${safeFileName}</div>`;
                } else if (message.fileType?.startsWith('audio/')) {
                    messageBodyHtml = `
<div class="file-info">
    <span class="file-icon">🎵</span>
<div class="file-details">
    <div class="file-name">${safeFileName}</div>
    <audio controls src="${message.data}" style="width:100%"></audio>
</div>
</div>`;
                } else {
                    messageBodyHtml = `
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
                messageBodyHtml = `<div class="message-content system-text">${this.formatMessageText(message.content)}</div>`;
                break;
            default:
                messageBodyHtml = `<div class="message-content">[Unsupported message type: ${message.type}]</div>`;
        }

        if (contentElement) { // Updating existing message content (e.g. stream)
            // For streaming, the sender part is already there. Only update the message-content part.
            if (message.type === 'text') {
                contentElement.innerHTML = this.formatMessageText(message.content + (message.isStreaming ? "▍" : ""));
            } // Other types are not typically streamed this way.
        } else { // Creating new message
            contentHtml += messageBodyHtml;
            msgDiv.innerHTML = contentHtml;

            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'timestamp';
            timestampDiv.textContent = message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : 'sending...';
            msgDiv.appendChild(timestampDiv);

            const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt)');
            if (noMsgPlaceholder &&
                (noMsgPlaceholder.textContent.includes("No messages yet") ||
                    noMsgPlaceholder.textContent.includes("You created this group") ||
                    noMsgPlaceholder.textContent.includes("Start a conversation with"))) {
                if (!message.isThinking && !message.isStreaming) { // Don't remove for thinking or initial stream message
                    noMsgPlaceholder.remove();
                }
            }
            chatBox.appendChild(msgDiv);
        }

        chatBox.scrollTop = chatBox.scrollHeight;
    },

    formatMessageText: function(text) {
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text);
        // Preserve spaces for the "▍" cursor, then convert actual newlines to <br>
        escapedText = escapedText.replace(/ /g, ' ').replace(/▍/g, '<span class="streaming-cursor">▍</span>');
        let linkedText = escapedText.replace(/\n/g, '<br>');
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        linkedText = linkedText.replace(urlRegex, function(url) {
            const displayUrl = url.replace(/ /g, ' '); // Display URL without  
            return `<a href="${displayUrl}" target="_blank" rel="noopener noreferrer">${displayUrl}</a>`;
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