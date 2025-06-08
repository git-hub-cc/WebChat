// MODIFIED: MessageManager.js
// - TTS logic moved to MessageTtsHandler.js
// - displayMessage now calls MessageTtsHandler.
// - Call MediaUIManager for resetRecordingButtonUI
const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,
    // _currentlyPlayingTtsAudio and _currentlyPlayingTtsButton are now in MessageTtsHandler

    sendMessage: async function () {
        const input = document.getElementById('messageInput');
        const messageText = input.value.trim();
        const currentSelectedFile = MessageManager.selectedFile;
        const currentAudioData = MessageManager.audioData;
        const currentAudioDuration = MessageManager.audioDuration;

        if (!ChatManager.currentChatId) {
            NotificationManager.showNotification('Select a chat to send a message.', 'warning');
            return;
        }
        const isGroup = ChatManager.currentChatId.startsWith('group_');
        const targetId = ChatManager.currentChatId;
        const contact = UserManager.contacts[targetId];
        const chatBox = document.getElementById('chatBox');

        if (contact && contact.isSpecial && contact.isAI && contact.aiConfig) {
            if (currentAudioData || currentSelectedFile) {
                NotificationManager.showNotification(`Audio/File messages are not supported with ${contact.name}.`, 'warning');
                if (currentAudioData) MessageManager.cancelAudioData(); // <- INI AKAN MEMANGGIL cancelAudioData
                return;
            }
            if (!messageText) return;

            const userMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString(), sender: UserManager.userId };
            ChatManager.addMessage(targetId, userMessage);
            input.value = ''; input.style.height = 'auto'; input.focus();

            const thinkingMsgId = `thinking_${Date.now()}`;
            const thinkingMessage = { id: thinkingMsgId, type: 'system', content: `${contact.name} is thinking...`, timestamp: new Date().toISOString(), sender: targetId, isThinking: true };
            MessageManager.displayMessage(thinkingMessage, false);
            let thinkingElement = chatBox.querySelector(`.message[data-message-id="${thinkingMsgId}"]`);

            try {
                const fiveMinutesAgo = new Date().getTime() - (Config.ai.sessionTime);
                const chatHistory = ChatManager.chats[targetId] || [];
                const recentMessages = chatHistory.filter(msg => new Date(msg.timestamp).getTime() > fiveMinutesAgo && msg.type === 'text');
                const contextMessagesForAI = recentMessages.map(msg => ({role: (msg.sender === UserManager.userId) ? 'user' : 'assistant', content: msg.content}));
                const aiApiMessages = [{role: "system", content: contact.aiConfig.systemPrompt}, ...contextMessagesForAI];
                for (let i = aiApiMessages.length - 1; i >= 0; i--) {
                    if (aiApiMessages[i].role === 'user') { aiApiMessages[i].content += ` [Sent at: ${new Date().toLocaleString()}]`; break; }
                }

                const currentConfigForAIRequest = { endpoint: window.Config.server.apiEndpoint, keyPresent: !!window.Config.server.api_key, model: window.Config.server.model, max_tokens: window.Config.server.max_tokens };
                Utils.log(`MessageManager: AI request to ${contact.name}. Using Config: Endpoint='${currentConfigForAIRequest.endpoint}', KeyPresent=${currentConfigForAIRequest.keyPresent}, Model='${currentConfigForAIRequest.model}', MaxTokens=${currentConfigForAIRequest.max_tokens}`, Utils.logLevels.DEBUG);

                const requestBody = { model: currentConfigForAIRequest.model, messages: aiApiMessages, stream: true, temperature: 0.1, max_tokens: currentConfigForAIRequest.max_tokens || 1000 };
                Utils.log(`Sending to AI (${contact.name}) (streaming): ${JSON.stringify(requestBody.messages.slice(-5))}`, Utils.logLevels.DEBUG); // Log last 5 messages

                const response = await fetch(currentConfigForAIRequest.endpoint, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'authorization': window.Config.server.api_key }, body: JSON.stringify(requestBody)
                });
                if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();
                if (!response.ok) {
                    const errorData = await response.text();
                    Utils.log(`AI API Error (${response.status}) for ${contact.name}: ${errorData}`, Utils.logLevels.ERROR);
                    throw new Error(`API request failed for ${contact.name} with status ${response.status}.`);
                }

                const aiMessageId = `ai_stream_${Date.now()}`;
                let fullAiResponseContent = "";
                const initialAiMessage = { id: aiMessageId, type: 'text', content: "▍", timestamp: new Date().toISOString(), sender: targetId, isStreaming: true };
                ChatManager.addMessage(targetId, initialAiMessage);
                let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                if (!aiMessageElement) { MessageManager.displayMessage(initialAiMessage, false); aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`); }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                    const {value, done: readerDone} = await reader.read();
                    if (readerDone) { buffer += decoder.decode(); break; }
                    buffer += decoder.decode(value, {stream: true});
                    let stopStreaming = false;
                    if (buffer.trim() === "[DONE]" || buffer.includes("[DONE]")) {
                        buffer = buffer.substring(0, buffer.indexOf("[DONE]"));
                        stopStreaming = true;
                    }
                    let boundary = 0;
                    while (boundary < buffer.length) {
                        const startIdx = buffer.indexOf('{', boundary);
                        if (startIdx === -1) { buffer = buffer.substring(boundary); break; }
                        let openBraces = 0, endIdx = -1;
                        for (let i = startIdx; i < buffer.length; i++) {
                            if (buffer[i] === '{') openBraces++;
                            else if (buffer[i] === '}') { openBraces--; if (openBraces === 0) { endIdx = i; break; } }
                        }
                        if (endIdx !== -1) {
                            const jsonString = buffer.substring(startIdx, endIdx + 1);
                            try {
                                const jsonChunk = JSON.parse(jsonString);
                                if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                                    fullAiResponseContent += jsonChunk.choices[0].delta.content;
                                    if (aiMessageElement) { aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍"); chatBox.scrollTop = chatBox.scrollHeight; }
                                }
                            } catch (e) { Utils.log(`AI stream: Error parsing JSON: ${e}. Buffer: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN); }
                            boundary = endIdx + 1;
                            if (boundary >= buffer.length) buffer = "";
                        } else { buffer = buffer.substring(startIdx); break; }
                    }
                    if (stopStreaming) break;
                }
                if (aiMessageElement) aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent);
                const finalAiMessage = { id: aiMessageId, type: 'text', content: fullAiResponseContent, timestamp: initialAiMessage.timestamp, sender: targetId, isStreaming: false, isNewlyCompletedAIResponse: true };
                ChatManager.addMessage(targetId, finalAiMessage);
            } catch (error) {
                if (thinkingElement && thinkingElement.parentNode) thinkingElement.remove();
                Utils.log(`Error communicating with AI (${contact.name}): ${error}`, Utils.logLevels.ERROR);
                NotificationManager.showNotification(`Error: Could not get reply from ${contact.name}.`, 'error');
                ChatManager.addMessage(targetId, { type: 'text', content: `Sorry, an error occurred: ${error.message}`, timestamp: new Date().toISOString(), sender: targetId });
            }
            return;
        }

        if (!isGroup && !ConnectionManager.isConnectedTo(targetId)) {
            if (messageText || currentSelectedFile || currentAudioData) {
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showReconnectPrompt(targetId, () => Utils.log("Reconnected, resend message.", Utils.logLevels.INFO));
                return;
            }
        }
        if (!messageText && !currentSelectedFile && !currentAudioData) return;

        let messageSent = false;
        if (currentAudioData) {
            const audioMessage = { type: 'audio', data: currentAudioData, duration: currentAudioDuration, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, audioMessage); else ConnectionManager.sendTo(targetId, audioMessage);
            ChatManager.addMessage(targetId, {...audioMessage, sender: UserManager.userId});
            messageSent = true; MessageManager.cancelAudioData(); // <- INI AKAN MEMANGGIL cancelAudioData
        }
        if (currentSelectedFile) {
            const fileMessage = { type: 'file', fileId: `${Date.now()}-${Utils.generateId(6)}`, fileName: currentSelectedFile.name, fileType: currentSelectedFile.type, fileSize: currentSelectedFile.size, data: currentSelectedFile.data, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, fileMessage); else ConnectionManager.sendTo(targetId, fileMessage);
            ChatManager.addMessage(targetId, {...fileMessage, sender: UserManager.userId});
            messageSent = true; MessageManager.cancelFileData();
        }
        if (messageText) {
            const textMessage = { type: 'text', content: messageText, timestamp: new Date().toISOString() };
            if (isGroup) GroupManager.broadcastToGroup(targetId, textMessage); else ConnectionManager.sendTo(targetId, textMessage);
            ChatManager.addMessage(targetId, {...textMessage, sender: UserManager.userId});
            messageSent = true; input.value = ''; input.style.height = 'auto';
        }
        if (messageSent) input.focus();
    },

    displayMessage: function (message, isSentByMe) {
        // ... (kode displayMessage tetap sama)
        const chatBox = document.getElementById('chatBox');
        let msgDiv = null, mainContentWrapper = null, contentElement = null;
        if (message.id) msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);

        const senderContact = UserManager.contacts[message.sender];
        const isAIMessage = !isSentByMe && senderContact?.isAI;
        const ttsConfig = isAIMessage && senderContact.aiConfig?.tts;

        if (msgDiv) { // Update existing message
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
        } else { // Create new message
            msgDiv = document.createElement('div');
            msgDiv.className = `message ${isSentByMe ? 'sent' : 'received'}`;
            if (message.id) msgDiv.setAttribute('data-message-id', message.id);
            if (message.sender) msgDiv.setAttribute('data-sender-id', message.sender);
        }
        if (message.type === 'system') {
            msgDiv.classList.add('system');
            if (message.isThinking) {
                msgDiv.classList.add('thinking');
            }
        }

        let initialHtmlStructure = '';
        if (!contentElement) {
            let senderNameHtml = '';
            if (!isSentByMe && message.type !== 'system') {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `User ${String(message.sender).substring(0, 4)}`);
                if (ChatManager.currentChatId?.startsWith('group_') || (senderContact?.isSpecial)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml;
            let messageBodyHtml = '';
            const textContent = message.content;
            const showStreamingCursor = isAIMessage && message.isStreaming;

            switch (message.type) {
                case 'text':
                    messageBodyHtml = `<div class="message-content-wrapper"><div class="message-content">${this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""))}</div></div>`;
                    break;
                case 'audio':
                    messageBodyHtml = `<div class="voice-message"><button class="play-voice-btn" data-audio="${message.data}" onclick="MediaManager.playAudio(this)">▶</button><span class="voice-duration">${Utils.formatTime(message.duration)}</span></div>`;
                    break;
                case 'file':
                    const safeFileName = Utils.escapeHtml(message.fileName || 'file');
                    if (message.fileType?.startsWith('image/')) messageBodyHtml = `<img src="${message.data}" alt="${safeFileName}" class="file-preview-img" onclick="UIManager.showFullImage('${message.data}', '${safeFileName}')">`;
                    else if (message.fileType?.startsWith('video/')) messageBodyHtml = `<video controls class="file-preview-video" style="max-width:100%;"><source src="${message.data}" type="${message.fileType}"></video><div>${safeFileName}</div>`;
                    else if (message.fileType?.startsWith('audio/')) messageBodyHtml = `<div class="file-info"><span class="file-icon">🎵</span><div class="file-details"><div class="file-name">${safeFileName}</div><audio controls src="${message.data}" style="width:100%"></audio></div></div>`;
                    else messageBodyHtml = `<div class="file-info"><span class="file-icon">📄</span><div class="file-details"><div class="file-name">${safeFileName}</div><div class="file-meta">${MediaManager.formatFileSize(message.fileSize || 0)}</div></div><a href="${message.data}" download="${safeFileName}" class="download-btn">Download</a></div>`;
                    break;
                case 'system': messageBodyHtml = `<div class="message-content system-text">${this.formatMessageText(textContent)}</div>`; break;
                default: messageBodyHtml = `<div class="message-content">[Unsupported type: ${message.type}]</div>`;
            }
            initialHtmlStructure += messageBodyHtml;
            initialHtmlStructure += `<div class="timestamp">${message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : 'sending...'}</div>`;
            msgDiv.innerHTML = initialHtmlStructure;
            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');
            const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt)');
            if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("No messages yet") || noMsgPlaceholder.textContent.includes("You created this group") || noMsgPlaceholder.textContent.includes("Start a conversation with"))) {
                if (!message.isThinking && !message.isStreaming) noMsgPlaceholder.remove();
            }
            chatBox.appendChild(msgDiv);
        } else {
            if (contentElement && message.type === 'text') {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }

        if (message.type === 'text' && isAIMessage && ttsConfig?.enabled && !message.isStreaming && message.isNewlyCompletedAIResponse) {
            const textForTts = MessageTtsHandler.cleanTextForTts(message.content);
            if (textForTts && textForTts.trim() !== "" && mainContentWrapper) {
                const ttsId = message.id || `tts_${Date.now()}`;
                MessageTtsHandler.addTtsPlaceholder(mainContentWrapper, ttsId);
                MessageTtsHandler.requestTtsForMessage(textForTts, ttsConfig, mainContentWrapper, ttsId);
            } else {
                Utils.log(`TTS not triggered for message ID ${message.id}: Cleaned text is empty or no wrapper. Original: "${message.content?.substring(0, 50)}..."`, Utils.logLevels.INFO);
            }
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    formatMessageText: function (text) {
        // ... (kode formatMessageText tetap sama)
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text).replace(/ /g, ' ').replace(/▍/g, '<span class="streaming-cursor">▍</span>');
        let linkedText = escapedText.replace(/\n/g, '<br>');
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return linkedText.replace(urlRegex, url => `<a href="${url.replace(/ /g, ' ')}" target="_blank" rel="noopener noreferrer">${url.replace(/ /g, ' ')}</a>`);
    },

    cancelFileData: function () {
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
        if (typeof MediaUIManager !== 'undefined') { // PERIKSA APAKAH MediaUIManager SUDAH TERDEFINISI
            MediaUIManager.resetRecordingButtonUI(); // GANTI KE INI
        } else {
            Utils.log("MediaUIManager is undefined in MessageManager.cancelAudioData", Utils.logLevels.WARN);
        }
    },

    clearChat: function () {
        if (!ChatManager.currentChatId) {
            NotificationManager.showNotification('No chat selected to clear.', 'warning');
            return;
        }
        ModalManager.showConfirmationModal(
            'Are you sure you want to clear messages in this chat? This cannot be undone.',
            () => {
                ChatManager.clearChat(ChatManager.currentChatId).then(success => {
                    if (success) NotificationManager.showNotification('Chat history cleared.', 'success');
                    else NotificationManager.showNotification('Failed to clear chat history.', 'error');
                });
            }
        );
    },
};