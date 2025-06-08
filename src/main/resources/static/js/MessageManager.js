const MessageManager = {
    selectedFile: null,
    audioData: null,
    audioDuration: 0,
    _currentlyPlayingTtsAudio: null, // For managing single TTS playback instance
    _currentlyPlayingTtsButton: null, // Tracks which button is playing TTS

    sendMessage: async function () {
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
                    return {role: role, content: msg.content};
                });

                const aiApiMessages = [
                    {role: "system", content: contact.aiConfig.systemPrompt}
                ];
                aiApiMessages.push(...contextMessagesForAI);

                // Find the last user message and append dateTimeString
                for (let i = aiApiMessages.length - 1; i >= 0; i--) {
                    if (aiApiMessages[i].role === 'user') {
                        const dateTimeString = ` [Sent at: ${new Date().toLocaleString()}]`;
                        aiApiMessages[i].content += dateTimeString;
                        break; // Stop after modifying the last user message
                    }
                }

                // Log the configuration values MessageManager is about to use
                const currentConfigForAIRequest = {
                    endpoint: window.Config.server.apiEndpoint,
                    keyPresent: !!window.Config.server.api_key,
                    model: window.Config.server.model,
                    max_tokens: window.Config.server.max_tokens
                };
                Utils.log(`MessageManager: AI request to ${contact.name}. Using Config: Endpoint='${currentConfigForAIRequest.endpoint}', KeyPresent=${currentConfigForAIRequest.keyPresent}, Model='${currentConfigForAIRequest.model}', MaxTokens=${currentConfigForAIRequest.max_tokens}`, Utils.logLevels.DEBUG);


                const requestBody = {
                    model: currentConfigForAIRequest.model, // Use logged value
                    messages: aiApiMessages,
                    stream: true,
                    temperature: 0.1,
                    max_tokens: currentConfigForAIRequest.max_tokens || 1000 // Use logged value
                };

                Utils.log(`Sending to AI (${contact.name}) (streaming): ${JSON.stringify(requestBody.messages)}`, Utils.logLevels.DEBUG);

                const response = await fetch(currentConfigForAIRequest.endpoint, { // Use logged value
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'authorization': window.Config.server.api_key, // Direct read, assuming it's updated
                    },
                    body: JSON.stringify(requestBody)
                });

                if (thinkingElement && thinkingElement.parentNode) {
                    thinkingElement.remove();
                    thinkingElement = null;
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
                    content: "▍",
                    timestamp: new Date().toISOString(),
                    sender: targetId,
                    isStreaming: true
                };
                ChatManager.addMessage(targetId, initialAiMessage);
                let aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                if (!aiMessageElement) {
                    MessageManager.displayMessage(initialAiMessage, false);
                    aiMessageElement = chatBox.querySelector(`.message[data-message-id="${aiMessageId}"] .message-content`);
                }


                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const {value, done: readerDone} = await reader.read();
                    if (readerDone) {
                        buffer += decoder.decode();
                        break;
                    }

                    buffer += decoder.decode(value, {stream: true});
                    let stopStreaming = false;

                    if (buffer.trim() === "[DONE]") {
                        stopStreaming = true;
                    } else if (buffer.includes("[DONE]")) {
                        const partBeforeDone = buffer.substring(0, buffer.indexOf("[DONE]"));
                        buffer = partBeforeDone;
                        stopStreaming = true;
                    }

                    let boundary = 0;
                    while (boundary < buffer.length) {
                        const startIdx = buffer.indexOf('{', boundary);
                        if (startIdx === -1) {
                            buffer = buffer.substring(boundary);
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
                                if (jsonChunk.choices && jsonChunk.choices[0] && jsonChunk.choices[0].delta) {
                                    const deltaContent = jsonChunk.choices[0].delta.content;
                                    if (deltaContent) {
                                        fullAiResponseContent += deltaContent;
                                        if (aiMessageElement) {
                                            aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent + "▍");
                                            chatBox.scrollTop = chatBox.scrollHeight;
                                        }
                                    }
                                }
                            } catch (e) {
                                Utils.log(`AI stream: Error parsing JSON chunk: ${e}. Buffer: ${buffer.substring(0, 200)}`, Utils.logLevels.WARN);
                                Utils.log(`Skipping non-JSON segment: ${jsonString}`, Utils.logLevels.DEBUG);
                            }
                            boundary = endIdx + 1;
                            if (boundary >= buffer.length) buffer = "";
                        } else {
                            buffer = buffer.substring(startIdx);
                            break;
                        }
                    }
                    if (stopStreaming) break;
                }

                if (aiMessageElement) {
                    aiMessageElement.innerHTML = MessageManager.formatMessageText(fullAiResponseContent);
                    chatBox.scrollTop = chatBox.scrollHeight;
                }

                const finalAiMessage = {
                    id: aiMessageId,
                    type: 'text',
                    content: fullAiResponseContent,
                    timestamp: initialAiMessage.timestamp,
                    sender: targetId,
                    isStreaming: false,
                    isNewlyCompletedAIResponse: true // Flag for fresh AI response
                };
                ChatManager.addMessage(targetId, finalAiMessage);

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
            ChatManager.addMessage(targetId, {...textMessage, sender: UserManager.userId});
            messageSent = true;
            input.value = '';
            input.style.height = 'auto';
        }

        if (messageSent) {
            input.focus();
        }
    },
    cleanTextForTts: function (text) {
        if (typeof text !== 'string') return '';
        let cleanedText = text;

        // Remove content between *...*
        cleanedText = cleanedText.replace(/\*.*?\*/g, '');

        // Remove content between 【...】
        cleanedText = cleanedText.replace(/【.*?】/g, '');

        // Remove content between [...]
        cleanedText = cleanedText.replace(/\[.*?\]/g, '');

        // Remove content between (...) and （...）
        cleanedText = cleanedText.replace(/\(.*?\)/g, '');
        cleanedText = cleanedText.replace(/（.*?）/g, '');

        // Define characters to be treated as "special" and replaced by a comma.
        // This targets symbols often not meant for direct speech or remnants of formatting.
        // Excludes common math/currency symbols like $, %, +, = that TTS might handle.
        const specialCharsToCommaRegex = /[~*_#^|<>`{}\\]/g; // Added backslash here
        cleanedText = cleanedText.replace(specialCharsToCommaRegex, ',');

        // Normalize spaces around commas and consolidate multiple commas:
        // 1. Ensure no multiple spaces around a comma, and convert "word , word" to "word,word"
        cleanedText = cleanedText.replace(/\s*,\s*/g, ',');
        // 2. Consolidate multiple commas into a single comma, e.g., ",,," becomes ","
        cleanedText = cleanedText.replace(/,{2,}/g, ',');

        // Remove leading or trailing commas that might have resulted from replacements
        cleanedText = cleanedText.replace(/^,|,$/g, '');

        // Remove commas if they are adjacent to other significant punctuation marks.
        // This avoids outputs like "Hello!," or ",Hello?"
        // ([.。！？\?，。！？、；：]) captures common Western and CJK punctuation.
        const puncGroup = "([.。！？\\?，。！？、；：])"; // Note: \? needs to be escaped in string for regex
        // Punctuation followed by a comma (and optional spaces): Punc , -> Punc
        cleanedText = cleanedText.replace(new RegExp(puncGroup + "\\s*,", 'g'), '$1');
        // Comma followed by punctuation (and optional spaces): , Punc -> Punc
        cleanedText = cleanedText.replace(new RegExp(",\\s*" + puncGroup, 'g'), '$1');

        // Trim whitespace that might be left at the ends after all operations
        return cleanedText.trim();
    },

    displayMessage: function (message, isSentByMe) {
        const chatBox = document.getElementById('chatBox');
        let msgDiv = null;
        let mainContentWrapper = null;
        let contentElement = null;

        if (message.id) {
            msgDiv = chatBox.querySelector(`.message[data-message-id="${message.id}"]`);
        }

        const senderContact = UserManager.contacts[message.sender];
        const isAIMessage = !isSentByMe && senderContact && senderContact.isAI;
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
            msgDiv.classList.remove('sent', 'received');
            if (message.isThinking) {
                msgDiv.classList.add('thinking');
            }
        }

        let initialHtmlStructure = '';
        if (!contentElement) { // Only build structure if creating new message div
            let senderNameHtml = '';
            if (!isSentByMe && message.type !== 'system') {
                const senderName = message.originalSenderName || (senderContact ? senderContact.name : `User ${String(message.sender).substring(0, 4)}`);
                if (ChatManager.currentChatId?.startsWith('group_') || (senderContact && senderContact.isSpecial)) {
                    senderNameHtml = `<div class="message-sender">${Utils.escapeHtml(senderName)}</div>`;
                }
            }
            initialHtmlStructure += senderNameHtml;

            let messageBodyHtml = '';
            const textContent = message.content;
            const showStreamingCursor = isAIMessage && message.isStreaming;

            switch (message.type) {
                case 'text':
                    if (isAIMessage) {
                        messageBodyHtml = `
                            <div class="message-content-wrapper">
                                <div class="message-content">${this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""))}</div>
                                <!-- TTS control will be added here if final & enabled -->
                            </div>`;
                    } else {
                        messageBodyHtml = `<div class="message-content">${this.formatMessageText(textContent)}</div>`;
                    }
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
                    messageBodyHtml = `<div class="message-content system-text">${this.formatMessageText(textContent)}</div>`;
                    break;
                default:
                    messageBodyHtml = `<div class="message-content">[Unsupported message type: ${message.type}]</div>`;
            }
            initialHtmlStructure += messageBodyHtml;

            const timestampStr = message.timestamp ? Utils.formatDate(new Date(message.timestamp), true) : 'sending...';
            initialHtmlStructure += `<div class="timestamp">${timestampStr}</div>`;
            msgDiv.innerHTML = initialHtmlStructure;

            mainContentWrapper = msgDiv.querySelector('.message-content-wrapper');
            contentElement = mainContentWrapper ? mainContentWrapper.querySelector('.message-content') : msgDiv.querySelector('.message-content');

            const noMsgPlaceholder = chatBox.querySelector('.system-message:not(.thinking):not(.reconnect-prompt)');
            if (noMsgPlaceholder &&
                (noMsgPlaceholder.textContent.includes("No messages yet") ||
                    noMsgPlaceholder.textContent.includes("You created this group") ||
                    noMsgPlaceholder.textContent.includes("Start a conversation with"))) {
                if (!message.isThinking && !message.isStreaming) {
                    noMsgPlaceholder.remove();
                }
            }
            chatBox.appendChild(msgDiv);
        } else { // Updating existing message (e.g., streaming AI text)
            if (contentElement && message.type === 'text') {
                const textContent = message.content;
                const showStreamingCursor = isAIMessage && message.isStreaming;
                contentElement.innerHTML = this.formatMessageText(textContent + (showStreamingCursor ? "▍" : ""));
            }
        }

        // TTS logic for final AI messages
        if (message.type === 'text' && isAIMessage && ttsConfig && ttsConfig.enabled &&
            (message.isStreaming === false || typeof message.isStreaming === 'undefined') &&
            message.isNewlyCompletedAIResponse === true
        ) {
            const currentTtsApiEndpoint = window.Config.server.ttsApiEndpoint;
            if (!currentTtsApiEndpoint) {
                Utils.log("TTS not triggered: Global TTS API Endpoint is not configured in Config.server.ttsApiEndpoint. Please set it in Settings > AI & API Configuration.", Utils.logLevels.WARN);
            } else {
                const textForTts = this.cleanTextForTts(message.content);
                if (textForTts && textForTts.trim() !== "") {
                    if (mainContentWrapper) {
                        const ttsId = message.id || `tts_${Date.now()}`;
                        const oldTtsControl = mainContentWrapper.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
                        if (oldTtsControl) oldTtsControl.remove();

                        this.addTtsPlaceholder(mainContentWrapper, ttsId);
                        this.requestTtsForMessage(textForTts, ttsConfig, mainContentWrapper, ttsId, currentTtsApiEndpoint);
                    }
                } else {
                    Utils.log(`TTS not triggered for message ID ${message.id}: Cleaned text is empty. Original: "${message.content.substring(0, 50)}..."`, Utils.logLevels.INFO);
                }
            }
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    formatMessageText: function (text) {
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text);
        escapedText = escapedText.replace(/ /g, ' ').replace(/▍/g, '<span class="streaming-cursor">▍</span>');
        let linkedText = escapedText.replace(/\n/g, '<br>');
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        linkedText = linkedText.replace(urlRegex, function (url) {
            const displayUrl = url.replace(/ /g, ' ');
            return `<a href="${displayUrl}" target="_blank" rel="noopener noreferrer">${displayUrl}</a>`;
        });
        return linkedText;
    },

    addTtsPlaceholder: function (parentContainer, ttsId) {
        const existingControl = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (existingControl) existingControl.remove();

        const ttsControlContainer = document.createElement('span');
        ttsControlContainer.className = 'tts-control-container';
        ttsControlContainer.dataset.ttsId = ttsId;

        const spinner = document.createElement('span');
        spinner.className = 'tts-loading-spinner';
        ttsControlContainer.appendChild(spinner);
        parentContainer.appendChild(ttsControlContainer);
    },

    requestTtsForMessage: async function (text, ttsConfig, parentContainer, ttsId, ttsApiEndpointToUse) {
        const payload = {
            access_token: "guest",
            model_name: ttsConfig.model_name,
            speaker_name: ttsConfig.speaker_name,
            prompt_text_lang: ttsConfig.prompt_text_lang || "中文",
            emotion: ttsConfig.emotion || "默认",
            text: text,
            text_lang: ttsConfig.text_lang || "中文",
            top_k: ttsConfig.top_k || 10,
            top_p: ttsConfig.top_p || 1,
            temperature: ttsConfig.temperature || 1,
            text_split_method: ttsConfig.text_split_method || "按标点符号切",
            batch_size: ttsConfig.batch_size || 10,
            batch_threshold: ttsConfig.batch_threshold || 0.75,
            split_bucket: ttsConfig.split_bucket === undefined ? true : ttsConfig.split_bucket,
            speed_facter: ttsConfig.speed_facter || 1,
            fragment_interval: ttsConfig.fragment_interval || 0.3,
            media_type: ttsConfig.media_type || "wav",
            parallel_infer: ttsConfig.parallel_infer === undefined ? true : ttsConfig.parallel_infer,
            repetition_penalty: ttsConfig.repetition_penalty || 1.35,
            seed: ttsConfig.seed === undefined ? -1 : ttsConfig.seed,
        };

        Utils.log(`MessageManager: TTS request. Using Config: Endpoint='${ttsApiEndpointToUse}'`, Utils.logLevels.DEBUG);

        try {
            const response = await fetch(ttsApiEndpointToUse, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`TTS API request failed with status ${response.status}: ${errorData}`);
            }

            const result = await response.json();
            if (result.audio_url) {
                this.updateTtsControlToPlay(parentContainer, ttsId, result.audio_url);
            } else {
                throw new Error(`TTS API response missing audio_url. Message: ${result.msg || 'Unknown error'}`);
            }
        } catch (error) {
            Utils.log(`Error fetching TTS audio for ttsId ${ttsId}: ${error}`, Utils.logLevels.ERROR);
            this.updateTtsControlToError(parentContainer, ttsId);
        }
    },

    updateTtsControlToPlay: function (parentContainer, ttsId, audioUrl) {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = '';
            const playButton = document.createElement('button');
            playButton.className = 'tts-play-button';
            playButton.dataset.audioUrl = audioUrl;
            playButton.title = "Play/Pause Speech";
            playButton.onclick = (e) => {
                e.stopPropagation();
                this.playTtsAudioFromControl(playButton);
            };
            ttsControlContainer.appendChild(playButton);
        }
    },

    playTtsAudioFromControl: function (buttonElement) {
        const audioUrl = buttonElement.dataset.audioUrl;
        if (!audioUrl) return;

        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) {
                this._currentlyPlayingTtsAudio.play().catch(e => Utils.log("Error resuming TTS audio: " + e, Utils.logLevels.ERROR));
                buttonElement.classList.add('playing');
            } else {
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing');
            }
        } else {
            if (this._currentlyPlayingTtsAudio) {
                this._currentlyPlayingTtsAudio.pause();
                if (this._currentlyPlayingTtsButton) {
                    this._currentlyPlayingTtsButton.classList.remove('playing');
                }
            }

            this._currentlyPlayingTtsAudio = new Audio(audioUrl);
            this._currentlyPlayingTtsButton = buttonElement;

            this._currentlyPlayingTtsAudio.play().then(() => {
                buttonElement.classList.add('playing');
            }).catch(e => {
                Utils.log("Error playing TTS audio: " + e, Utils.logLevels.ERROR);
                buttonElement.classList.remove('playing');
                this._currentlyPlayingTtsAudio = null;
                this._currentlyPlayingTtsButton = null;
            });

            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                if (this._currentlyPlayingTtsButton === buttonElement) {
                    this._currentlyPlayingTtsAudio = null;
                    this._currentlyPlayingTtsButton = null;
                }
            };
            this._currentlyPlayingTtsAudio.onerror = (e) => {
                Utils.log("Error during TTS audio playback: " + (e.target.error ? e.target.error.message : "Unknown error"), Utils.logLevels.ERROR);
                buttonElement.classList.remove('playing');
                const originalContent = buttonElement.innerHTML;
                buttonElement.innerHTML = '⚠️';
                buttonElement.title = "Error playing audio";
                setTimeout(() => {
                    if (buttonElement.innerHTML === '⚠️') {
                        buttonElement.innerHTML = originalContent;
                        buttonElement.title = "Play/Pause Speech";
                    }
                }, 2000);
                if (this._currentlyPlayingTtsButton === buttonElement) {
                    this._currentlyPlayingTtsAudio = null;
                    this._currentlyPlayingTtsButton = null;
                }
            };
        }
    },

    updateTtsControlToError: function (parentContainer, ttsId) {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = '';
            const errorIcon = document.createElement('span');
            errorIcon.className = 'tts-error-icon';
            errorIcon.textContent = '⚠️';
            errorIcon.title = 'TTS failed';
            ttsControlContainer.appendChild(errorIcon);
        }
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
        MediaManager.resetRecordingButton();
    },

    clearChat: function () {
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