const ConnectionManager = {
    connections: {},  // { peerId: { peerConnection: RTCPeerConnection, dataChannel: RTCDataChannel, isVideoCall: false, wasInitiatedSilently: false } }
    iceCandidates: {}, // { peerId: [] }
    connectionTimeouts: {}, // { peerId: timeoutId }
    reconnectAttempts: {}, // { peerId: count }
    iceTimers: {}, // { peerId: timeoutId }
    iceGatheringStartTimes: {}, // { peerId: timestamp }
    websocket: null,
    isWebSocketConnected: false,
    signalingServerUrl: 'ws://localhost:8080/signaling',

    initialize: function() {
        if (!this.isWebSocketConnected && (!this.websocket || this.websocket.readyState === WebSocket.CLOSED)) {
            this.connectWebSocket();
        }
    },

    connectWebSocket: function() {
        if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
            return Promise.resolve();
        }

        UIManager.updateConnectionStatusIndicator('Connecting to signaling server...');
        Utils.log('Attempting to connect to WebSocket: ' + this.signalingServerUrl, Utils.logLevels.INFO);

        return new Promise((resolve, reject) => {
            try {
                this.websocket = new WebSocket(this.signalingServerUrl);

                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    UIManager.updateConnectionStatusIndicator('Signaling server connected.');
                    Utils.log('WebSocket connection established.', Utils.logLevels.INFO);
                    this.registerUser();
                    EventEmitter.emit('websocketStatusUpdate'); // Emit event
                    resolve();
                };

                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        this.handleSignalingMessage(message);
                    } catch (e) {
                        Utils.log('Error parsing signaling message: ' + e, Utils.logLevels.ERROR);
                    }
                };

                this.websocket.onclose = () => {
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    UIManager.updateConnectionStatusIndicator('Signaling server disconnected. Attempting to reconnect...');
                    Utils.log('WebSocket connection closed. Reconnecting in 3s...', Utils.logLevels.WARN);
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    setTimeout(() => this.connectWebSocket(), 3000);
                };

                this.websocket.onerror = (error) => {
                    Utils.log('WebSocket error: ' + JSON.stringify(error), Utils.logLevels.ERROR);
                    UIManager.updateConnectionStatusIndicator('Signaling server connection error.');
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate'); // Emit event only if status changed
                    reject(error);
                };
            } catch (error) {
                Utils.log('Failed to create WebSocket connection: ' + error, Utils.logLevels.ERROR);
                UIManager.updateConnectionStatusIndicator('Failed to connect to signaling server.');
                const oldStatus = this.isWebSocketConnected;
                this.isWebSocketConnected = false;
                if (oldStatus) EventEmitter.emit('websocketStatusUpdate'); // Emit event
                reject(error);
            }
        });
    },

    registerUser: function() {
        if (!UserManager.userId) {
            Utils.log('User ID not set, cannot register.', Utils.logLevels.ERROR);
            return;
        }
        const message = { type: 'REGISTER', userId: UserManager.userId };
        this.sendSignalingMessage(message, false); // Registration is not silent for UI purposes
    },

    sendSignalingMessage: function(message, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const messageString = JSON.stringify(message); // Message should be clean here
            Utils.log(`[RAW_WS_SEND] ${messageString}`, Utils.logLevels.DEBUG);
            this.websocket.send(messageString);
            Utils.log(`Sent WS: ${message.type} to ${message.targetUserId || 'server'} (from ${message.userId || 'N/A'})`, Utils.logLevels.DEBUG);
        } else {
            Utils.log('WebSocket not connected, cannot send signaling message.', Utils.logLevels.ERROR);
            if (!isInternalSilentFlag) { // Only show UI notification if the operation itself wasn't meant to be silent
                UIManager.showNotification('Not connected to signaling server. Message not sent.', 'error');
            }
        }
    },

    handleSignalingMessage: function(message) {
        Utils.log(`Received WS: ${message.type} from ${message.fromUserId || 'server'}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        switch (message.type) {
            case 'SUCCESS': // User registration successful
                UIManager.updateConnectionStatusIndicator(`User registration successful: ${UserManager.userId.substring(0,8)}...`);
                this.autoConnectToAllContacts();
                break;
            case 'ERROR':
                // UIManager.updateConnectionStatusIndicator(`Signaling error: ${message.message}`);
                // UIManager.showNotification(`Signaling Error: ${message.message}`, 'error');
                break;
            case 'OFFER':
                this.handleRemoteOffer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.sdpType);
                break;
            case 'ANSWER':
                this.handleRemoteAnswer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.sdpType);
                break;
            case 'ICE_CANDIDATE':
                this.handleRemoteIceCandidate(fromUserId, message.candidate);
                break;
            case 'USER_NOT_FOUND':
                const connDetails = this.connections[message.targetUserId];
                const wasSilentAttempt = connDetails?.wasInitiatedSilently || false;

                if (!wasSilentAttempt) {
                    UIManager.showNotification(`User ${message.targetUserId} not found or offline.`, 'warning');
                }
                Utils.log(`User ${message.targetUserId} not found. (Silent Attempt: ${wasSilentAttempt})`, Utils.logLevels.WARN);

                if(ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt) {
                    UIManager.updateChatHeaderStatus(`User not found or offline`);
                }
                if (this.connections[message.targetUserId]) {
                    this.close(message.targetUserId, false);
                }
                break;
            default:
                Utils.log('Unknown signaling message type: ' + message.type, Utils.logLevels.WARN);
        }
    },

    initConnection: function(peerId, isVideoCall = false) {
        Utils.log(`Attempting to initialize connection with ${peerId}. Current connection object: ${JSON.stringify(this.connections[peerId])}`, Utils.logLevels.DEBUG);

        if (this.connections[peerId]) {
            Utils.log(`Explicitly closing and deleting existing connection object for ${peerId} before new init.`, Utils.logLevels.WARN);
            this.close(peerId, false);
        }
        delete this.connections[peerId];
        delete this.iceCandidates[peerId];
        delete this.reconnectAttempts[peerId];

        Utils.log(`Initializing new RTCPeerConnection for ${peerId}. Video call: ${isVideoCall}`, Utils.logLevels.INFO);

        try {
            const pc = new RTCPeerConnection(Config.peerConnectionConfig);
            this.connections[peerId] = {
                peerConnection: pc,
                dataChannel: null,
                isVideoCall: isVideoCall,
                isAudioOnly: false,
                wasInitiatedSilently: false
            };
            this.iceCandidates[peerId] = [];
            this.reconnectAttempts[peerId] = 0;

            pc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            pc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            pc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            pc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);

            if (isVideoCall) {
                pc.ontrack = (event) => VideoCallManager.handleRemoteTrack(event, peerId);
            } else {
                pc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
            }
            return pc;
        } catch (error) {
            Utils.log(`CRITICAL: Failed to initialize RTCPeerConnection for ${peerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Connection setup error for ${peerId}: ${error.message}`, 'error');
            delete this.connections[peerId];
            return null;
        }
    },

    createOffer: async function(targetPeerId = null, options = {}) {
        const { isVideoCall = false, isAudioOnly = false, isSilent = false } = options;
        let promptedForId = false;

        try {
            if (!targetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId) {
                targetPeerId = ChatManager.currentChatId;
            }

            if (!targetPeerId && !isSilent) {
                Utils.log("Target Peer ID missing for createOffer, prompting user.", Utils.logLevels.INFO);
                targetPeerId = prompt('请输入要连接的用户ID:');
                promptedForId = true;
                if (!targetPeerId) {
                    UIManager.showNotification("Connection cancelled: No Peer ID entered.", "info");
                    return;
                }
            } else if (!targetPeerId && isSilent) {
                Utils.log("Target Peer ID missing for silent createOffer. Aborting this offer.", Utils.logLevels.WARN);
                return;
            }

            if (targetPeerId === UserManager.userId) {
                if (!isSilent) UIManager.showNotification("You cannot create an offer to connect to yourself.", "warning");
                else Utils.log("Attempted to create silent offer to self. Skipped.", Utils.logLevels.DEBUG);
                if (promptedForId && document.getElementById('modalSdpText')) {
                    document.getElementById('modalSdpText').value = "Cannot connect to self. Enter a different Peer ID.";
                }
                return;
            }

            if (!UserManager.userId) {
                Utils.log("UserManager.userId is null, cannot create offer.", Utils.logLevels.ERROR);
                if (!isSilent) UIManager.showNotification("Your user ID is not available. Cannot create offer.", "error");
                return;
            }

            if (!this.isWebSocketConnected) {
                try {
                    if (!isSilent) UIManager.showNotification("Signaling server not connected. Attempting to connect...", "info");
                    await this.connectWebSocket();
                } catch (e) {
                    if (!isSilent) UIManager.showNotification("Signaling server connection failed. Cannot create offer.", "error");
                    return;
                }
            }

            Utils.log(`Creating offer for target: ${targetPeerId}, from: ${UserManager.userId}, isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, silent: ${isSilent}`, Utils.logLevels.DEBUG);

            const pc = this.initConnection(targetPeerId, isVideoCall);
            if (!pc) {
                return;
            }
            this.connections[targetPeerId].isVideoCall = isVideoCall;
            this.connections[targetPeerId].isAudioOnly = isAudioOnly;
            this.connections[targetPeerId].wasInitiatedSilently = isSilent;


            if (!isVideoCall) {
                const dataChannel = pc.createDataChannel('chatChannel', { reliable: true });
                this.setupDataChannel(dataChannel, targetPeerId);
            } else {
                if (VideoCallManager.localStream) {
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                } else {
                    Utils.log("Local stream not available for video call offer.", Utils.logLevels.WARN);
                }
            }

            try {
                const offerOptions = {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: isVideoCall && !isAudioOnly
                };
                const offer = await pc.createOffer(offerOptions);
                await pc.setLocalDescription(offer);

                Utils.log(`Offer created for ${targetPeerId}. ICE Gathering... (Silent: ${isSilent})`, Utils.logLevels.INFO);
                if (!isSilent && ChatManager.currentChatId === targetPeerId) {
                    const contactName = UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,8) + '...';
                    UIManager.updateChatHeaderStatus(`Connecting to ${contactName}...`);
                }

                if(promptedForId && document.getElementById('modalSdpText')) {
                    this.updateSdpTextInModal(targetPeerId);
                }

                this.waitForIceGatheringComplete(targetPeerId, () => {
                    if (!pc.localDescription) {
                        Utils.log(`Cannot send offer for ${targetPeerId}: localDescription is null after ICE.`, Utils.logLevels.ERROR);
                        if (!isSilent) UIManager.showNotification("Error: Could not finalize local connection details.", "error");
                        this.close(targetPeerId);
                        return;
                    }
                    // **MODIFIED: Prepare message without isSilentInternal first**
                    const offerMessagePayload = {
                        type: 'OFFER',
                        userId: UserManager.userId,
                        targetUserId: targetPeerId,
                        sdp: pc.localDescription.sdp,
                        sdpType: pc.localDescription.type,
                        candidates: this.iceCandidates[targetPeerId] || [],
                        isVideoCall: isVideoCall,
                        isAudioOnly: isAudioOnly,
                    };
                    // **MODIFIED: Pass isSilent as the second argument to sendSignalingMessage**
                    this.sendSignalingMessage(offerMessagePayload, isSilent);
                    Utils.log(`Offer sent to ${targetPeerId} via signaling. (Silent: ${isSilent})`, Utils.logLevels.INFO);
                });
            } catch (error) {
                Utils.log(`WebRTC error during offer creation for ${targetPeerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
                if (!isSilent) UIManager.showNotification(`Connection offer error: ${error.message}`, 'error');
                this.close(targetPeerId);
            }
        } catch (e) {
            Utils.log(`UNEXPECTED ERROR in createOffer for ${targetPeerId || 'unknown target'}: ${e.message}\nStack: ${e.stack}`, Utils.logLevels.ERROR);
            if (!isSilent) UIManager.showNotification("An unexpected error occurred while trying to connect.", "error");
            if (targetPeerId) {
                this.close(targetPeerId);
            }
        }
    },

    autoConnectToAllContacts: async function() {
        Utils.log("Attempting to auto-connect to all contacts.", Utils.logLevels.INFO);
        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) {
            Utils.log("No contacts to auto-connect to.", Utils.logLevels.INFO);
            return;
        }

        const contactIds = Object.keys(UserManager.contacts);
        for (const contactId of contactIds) {
            if (contactId === UserManager.userId) continue;

            if (this.isConnectedTo(contactId)) {
                Utils.log(`Already connected to ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }
            const existingConn = this.connections[contactId];
            if (existingConn && (existingConn.peerConnection?.connectionState === 'connecting' || existingConn.dataChannel?.readyState === 'connecting')) {
                Utils.log(`Connection attempt already in progress for ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }

            Utils.log(`Auto-connecting to contact: ${contactId}`, Utils.logLevels.DEBUG);
            try {
                await this.createOffer(contactId, { isVideoCall: false, isAudioOnly: false, isSilent: true });
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
                Utils.log(`Error during auto-connecting to ${contactId}: ${error.message}`, Utils.logLevels.WARN);
            }
        }
        Utils.log("Finished attempting auto-connections to contacts.", Utils.logLevels.INFO);
    },

    handleRemoteAnswer: async function(fromUserId, sdpString, candidates, isVideoCall = false, isAudioOnly = false, sdpTypeFromServer = null) {
        const conn = this.connections[fromUserId];
        if (!conn || !conn.peerConnection) {
            Utils.log(`No active connection found for answer from ${fromUserId}.`, Utils.logLevels.WARN);
            return;
        }
        const pc = conn.peerConnection;
        const wasSilent = conn.wasInitiatedSilently || false;

        try {
            if (typeof sdpString !== 'string' || !sdpTypeFromServer) {
                Utils.log(`Invalid SDP (string) or sdpType received in answer from ${fromUserId}. SDP: ${sdpString}, Type: ${sdpTypeFromServer}`, Utils.logLevels.ERROR);
                this.close(fromUserId); return;
            }
            const remoteSdpObject = { type: sdpTypeFromServer, sdp: sdpString };
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdpObject));
            Utils.log(`Remote description (answer) set for ${fromUserId}. (Silent Attempt: ${wasSilent})`, Utils.logLevels.INFO);
            if (candidates) {
                for (const candidate of candidates) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`Error adding remote ICE candidate from answer: ${e}`, Utils.logLevels.WARN));
                }
            }
        } catch (error) {
            Utils.log(`Failed to handle remote answer from ${fromUserId}: ${error} (Silent: ${wasSilent})`, Utils.logLevels.ERROR);
            if (!wasSilent) UIManager.showNotification(`Error processing connection answer: ${error.message}`, 'error');
            this.close(fromUserId);
        }
    },

    handleRemoteIceCandidate: async function(fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        if (conn && conn.peerConnection && conn.peerConnection.remoteDescription) {
            try {
                await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                Utils.log(`Added remote ICE candidate from ${fromUserId}.`, Utils.logLevels.DEBUG);
            } catch (error) {
                Utils.log(`Error adding remote ICE candidate from ${fromUserId}: ${error}`, Utils.logLevels.WARN);
            }
        } else {
            Utils.log(`Received ICE candidate from ${fromUserId}, but no valid connection or remoteDescription. Candidate might be queued or dropped.`, Utils.logLevels.WARN);
        }
    },

    handleIceCandidate: function(event, peerId) {
        if (event.candidate) {
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate);

            const connData = this.connections[peerId];
            const isSilentAttempt = connData?.wasInitiatedSilently || false;

            // **MODIFIED: Prepare message without isSilentInternal first**
            const candidateMessagePayload = {
                type: 'ICE_CANDIDATE',
                userId: UserManager.userId,
                targetUserId: peerId,
                candidate: event.candidate.toJSON()
            };
            // **MODIFIED: Pass isSilentAttempt as the second argument to sendSignalingMessage**
            this.sendSignalingMessage(candidateMessagePayload, isSilentAttempt);
            Utils.log(`Sent ICE candidate to ${peerId}: ${event.candidate.type || 'end-of-candidates'} (Silent: ${isSilentAttempt})`, Utils.logLevels.DEBUG);
        } else {
            Utils.log(`ICE gathering complete for ${peerId}.`, Utils.logLevels.DEBUG);
        }
    },

    waitForIceGatheringComplete: function(peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;

        if (pc.iceGatheringState === 'complete') {
            callback();
        } else {
            let checkInterval;
            const timeout = setTimeout(() => {
                clearInterval(checkInterval);
                Utils.log(`ICE gathering timeout for ${peerId}. Proceeding with collected candidates.`, Utils.logLevels.WARN);
                callback();
            }, Config.timeouts.iceGathering);

            checkInterval = setInterval(() => {
                if (pc.iceGatheringState === 'complete') {
                    clearInterval(checkInterval);
                    clearTimeout(timeout);
                    callback();
                }
            }, 100);
        }
    },

    handleAnswer: async function() {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            UIManager.showNotification("Paste answer info into the text area first.", "warning");
            return;
        }
        try {
            const answerDataFromModal = JSON.parse(sdpTextEl.value);
            sdpTextEl.value = '';

            if (!answerDataFromModal.sdp || !answerDataFromModal.sdp.sdp || !answerDataFromModal.sdp.type || !answerDataFromModal.userId) {
                UIManager.showNotification("Invalid answer data format in modal. Expected { sdp: {type, sdp}, candidates, userId }.", "error");
                return;
            }
            if (answerDataFromModal.userId === UserManager.userId) {
                UIManager.showNotification("Cannot process an answer from yourself in this way.", "warning");
                return;
            }
            const fromUserId = answerDataFromModal.userId;
            if (!this.connections[fromUserId]) {
                this.initConnection(fromUserId, answerDataFromModal.isVideoCall || false);
            }
            if(this.connections[fromUserId]) {
                this.connections[fromUserId].wasInitiatedSilently = false;
                this.connections[fromUserId].isVideoCall = answerDataFromModal.isVideoCall || false;
                this.connections[fromUserId].isAudioOnly = answerDataFromModal.isAudioOnly || false;
            }


            await this.handleRemoteAnswer(
                fromUserId,
                answerDataFromModal.sdp.sdp,
                answerDataFromModal.candidates,
                answerDataFromModal.isVideoCall,
                answerDataFromModal.isAudioOnly,
                answerDataFromModal.sdp.type
            );
            UIManager.showNotification("Answer processed. Connection should establish.", "info");
            UIManager.toggleModal('mainMenuModal', false);

        } catch (e) {
            UIManager.showNotification("Error handling answer: " + e.message, "error");
            Utils.log("Error in ConnectionManager.handleAnswer (manual): " + e, Utils.logLevels.ERROR);
        }
    },

    setupDataChannel: function(channel, peerId) {
        if (!this.connections[peerId]) {
            Utils.log(`Connection object for ${peerId} not found when setting up data channel.`, Utils.logLevels.ERROR);
            return;
        }
        this.connections[peerId].dataChannel = channel;
        const wasSilent = this.connections[peerId].wasInitiatedSilently || false;

        channel.onopen = () => {
            Utils.log(`Data channel with ${peerId} opened. (Silent Attempt: ${wasSilent})`, Utils.logLevels.INFO);
            const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
            if ((!wasSilent || ChatManager.currentChatId === peerId)) {
                UIManager.updateChatHeaderStatus(`Connected to ${contactName}`);
            }
            EventEmitter.emit('connectionEstablished', peerId);
            if (ChatManager.currentChatId === peerId) {
                UIManager.setCallButtonsState(true, peerId);
            }
        };

        channel.onclose = () => {
            Utils.log(`Data channel with ${peerId} closed. (Was Silent Attempt: ${wasSilent})`, Utils.logLevels.INFO);
            EventEmitter.emit('connectionDisconnected', peerId);
            if (ChatManager.currentChatId === peerId) {
                UIManager.setCallButtonsState(false);
                const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
                if (!wasSilent || ChatManager.currentChatId === peerId) {
                    UIManager.updateChatHeaderStatus(`Disconnected from ${contactName}`);
                }
            }
            this.close(peerId, false);
        };

        channel.onerror = (error) => {
            Utils.log(`Data channel error with ${peerId}: ${JSON.stringify(error)} (Was Silent: ${wasSilent})`, Utils.logLevels.ERROR);
        };

        channel.onmessage = (event) => {
            try {
                const rawMessage = event.data;
                let messageObjectToProcess;

                if (typeof rawMessage === 'string') {
                    let parsedJson;
                    try {
                        parsedJson = JSON.parse(rawMessage);
                    } catch (e) {
                        Utils.log(`Received malformed JSON or plain text from ${peerId}: ${rawMessage.substring(0,100)}... Error: ${e.message}`, Utils.logLevels.WARN);
                        messageObjectToProcess = {
                            type: 'text',
                            content: rawMessage,
                            sender: peerId,
                            timestamp: new Date().toISOString()
                        };
                    }

                    if (parsedJson) {
                        if (parsedJson.type === 'chunk-meta' || parsedJson.type === 'chunk-data') {
                            const reassembledData = Utils.reassembleChunk(parsedJson, peerId);
                            if (reassembledData) {
                                messageObjectToProcess = reassembledData;
                            } else {
                                return;
                            }
                        } else {
                            messageObjectToProcess = parsedJson;
                        }
                    }
                } else {
                    Utils.log(`Received non-string DataChannel message from ${peerId}. Type: ${typeof rawMessage}. Discarding.`, Utils.logLevels.WARN);
                    return;
                }

                if (!messageObjectToProcess) {
                    Utils.log(`Logic error: messageObjectToProcess is undefined before final handling. Raw: ${String(rawMessage).substring(0,100)}`, Utils.logLevels.ERROR);
                    return;
                }
                messageObjectToProcess.sender = messageObjectToProcess.sender || peerId;

                if (messageObjectToProcess.type && messageObjectToProcess.type.startsWith('video-call-')) {
                    VideoCallManager.handleMessage(messageObjectToProcess, peerId);
                } else if (messageObjectToProcess.groupId || messageObjectToProcess.type?.startsWith('group-')) {
                    GroupManager.handleGroupMessage(messageObjectToProcess);
                } else {
                    ChatManager.addMessage(messageObjectToProcess.groupId || peerId, messageObjectToProcess);
                }

            } catch (e) {
                Utils.log(`Critical error in DataChannel onmessage from ${peerId}: ${e}. Data: ${String(event.data).substring(0,100)} Stack: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    handleIceConnectionStateChange: function(peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;
        const wasSilent = this.connections[peerId]?.wasInitiatedSilently || false;
        Utils.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState} (Silent: ${wasSilent})`, Utils.logLevels.INFO);

        switch (pc.iceConnectionState) {
            case 'connected':
            case 'completed':
                this.reconnectAttempts[peerId] = 0;
                break;
            case 'disconnected':
                Utils.log(`ICE disconnected for ${peerId}. Attempting to reconnect...`, Utils.logLevels.WARN);
                this.attemptReconnect(peerId);
                EventEmitter.emit('connectionDisconnected', peerId);
                break;
            case 'failed':
                Utils.log(`ICE connection failed for ${peerId}. (Silent: ${wasSilent})`, Utils.logLevels.ERROR);
                if (!wasSilent) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId} failed.`, 'error');
                this.close(peerId);
                EventEmitter.emit('connectionFailed', peerId);
                break;
            case 'closed':
                Utils.log(`ICE connection closed for ${peerId}.`, Utils.logLevels.INFO);
                if (this.connections[peerId]) {
                    this.close(peerId, false);
                }
                break;
        }
    },

    handleRtcConnectionStateChange: function(peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if(!pc) return;
        const wasSilent = this.connections[peerId]?.wasInitiatedSilently || false;
        Utils.log(`RTCPeerConnection state for ${peerId}: ${pc.connectionState} (Silent: ${wasSilent})`, Utils.logLevels.INFO);

        switch (pc.connectionState) {
            case "connected":
                break;
            case "disconnected":
            case "failed":
                Utils.log(`RTCPeerConnection ${pc.connectionState} for ${peerId}. (Silent: ${wasSilent})`, Utils.logLevels.WARN);
                if (!this.connections[peerId]?.isVideoCall) {
                    EventEmitter.emit(pc.connectionState === 'failed' ? 'connectionFailed' : 'connectionDisconnected', peerId);
                }
                if (pc.connectionState === "disconnected") {
                    this.attemptReconnect(peerId);
                } else if (pc.connectionState === "failed") {
                    if (!wasSilent) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId} has failed critically.`, 'error');
                    this.close(peerId);
                }
                break;
            case "closed":
                Utils.log(`RTCPeerConnection closed for ${peerId}.`, Utils.logLevels.INFO);
                this.close(peerId, false);
                break;
        }
    },

    attemptReconnect: function(peerId) {
        if (!this.connections[peerId] || this.connections[peerId].isVideoCall) return;

        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        if (this.reconnectAttempts[peerId] <= Config.reconnect.maxAttempts) {
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId] -1);
            Utils.log(`Attempting to reconnect with ${peerId} (attempt ${this.reconnectAttempts[peerId]}) in ${delay/1000}s...`, Utils.logLevels.INFO);
            setTimeout(() => {
                if (this.connections[peerId] && !this.isConnectedTo(peerId)) {
                    Utils.log(`Re-initiating offer to ${peerId} for reconnection.`, Utils.logLevels.INFO);
                    this.createOffer(peerId, { isVideoCall: false, isAudioOnly: false, isSilent: true });
                } else if (this.isConnectedTo(peerId)) {
                    Utils.log(`Reconnection to ${peerId} not needed, already connected. Resetting attempts.`, Utils.logLevels.INFO);
                    this.reconnectAttempts[peerId] = 0;
                } else {
                    Utils.log(`Reconnection to ${peerId} aborted, connection object no longer valid or already closed.`, Utils.logLevels.INFO);
                }
            }, delay);
        } else {
            Utils.log(`Max reconnection attempts reached for ${peerId}. Closing connection.`, Utils.logLevels.ERROR);
            this.close(peerId);
        }
    },

    sendTo: function(peerId, messageObject) {
        const conn = this.connections[peerId];
        if (conn && conn.dataChannel && conn.dataChannel.readyState === 'open') {
            try {
                messageObject.sender = messageObject.sender || UserManager.userId;
                messageObject.timestamp = messageObject.timestamp || new Date().toISOString();

                const messageString = JSON.stringify(messageObject);
                if (messageString.length > Config.chunkSize) {
                    Utils.sendInChunks(messageString,
                        (chunk) => conn.dataChannel.send(chunk),
                        peerId,
                        messageObject.type === 'file' || messageObject.type === 'audio' ? messageObject.fileId || messageObject.data?.substring(0,10) : undefined
                    );
                } else {
                    conn.dataChannel.send(messageString);
                }
                Utils.log(`Sent DC message to ${peerId}: ${messageObject.type}`, Utils.logLevels.DEBUG);
                return true;
            } catch (error) {
                Utils.log(`Error sending message to ${peerId} via DataChannel: ${error}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log(`Cannot send to ${peerId}: DataChannel not open or connection doesn't exist. Current state: ${conn?.dataChannel?.readyState}`, Utils.logLevels.WARN);
            return false;
        }
    },

    isConnectedTo: function(peerId) {
        const conn = this.connections[peerId];
        return conn && conn.peerConnection &&
            (conn.peerConnection.connectionState === 'connected' || conn.peerConnection.iceConnectionState === 'connected' || conn.peerConnection.iceConnectionState === 'completed') &&
            (conn.isVideoCall || (conn.dataChannel && conn.dataChannel.readyState === 'open'));
    },

    close: function(peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn) {
            const wasSilent = conn.wasInitiatedSilently || false;
            Utils.log(`Closing connection with ${peerId}. Notify: ${notifyPeer} (Was Silent: ${wasSilent})`, Utils.logLevels.INFO);
            if (conn.dataChannel) {
                try { conn.dataChannel.close(); } catch (e) { Utils.log(`Error closing data channel for ${peerId}: ${e}`, Utils.logLevels.WARN); }
            }
            if (conn.peerConnection) {
                try { conn.peerConnection.close(); } catch (e) { Utils.log(`Error closing peer connection for ${peerId}: ${e}`, Utils.logLevels.WARN); }
            }
            delete this.connections[peerId];
            delete this.iceCandidates[peerId];

            if (ChatManager.currentChatId === peerId) {
                const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
                if (!wasSilent || ChatManager.currentChatId === peerId) {
                    UIManager.updateChatHeaderStatus(`Disconnected from ${contactName}`);
                }
                UIManager.setCallButtonsState(false);
            }
            EventEmitter.emit('connectionClosed', peerId);
        }
    },

    resetAllConnections: function() {
        if (!confirm("Are you sure you want to reset all connections? This will disconnect all active chats and calls.")) return;

        Utils.log("Resetting all connections.", Utils.logLevels.INFO);
        for (const peerId in this.connections) {
            this.close(peerId, true);
        }
        this.connections = {};
        this.iceCandidates = {};
        this.reconnectAttempts = {};

        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.close();
        }
        this.isWebSocketConnected = false;
        EventEmitter.emit('websocketStatusUpdate');
        setTimeout(() => this.initialize(), 1000);


        UIManager.showNotification("All connections have been reset.", "info");
        if (!ChatManager.currentChatId || !ChatManager.currentChatId.startsWith("group_")) {
            UIManager.showNoChatSelected();
            ChatManager.currentChatId = null;
        }
        ChatManager.renderChatList();
    },

    handleRemoteOffer: async function(fromUserId, sdpString, candidates, isVideoCall = false, isAudioOnly = false, sdpTypeFromServer = null) {
        Utils.log(`Handling remote offer from ${fromUserId}. isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}`, Utils.logLevels.INFO);

        if (!UserManager.contacts[fromUserId] && !GroupManager.groups[fromUserId]) {
            if(!isVideoCall){
                UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
            }
        }

        const pc = this.initConnection(fromUserId, isVideoCall);
        if (!pc) return;

        this.connections[fromUserId].wasInitiatedSilently = false; // Incoming offers are not "silent" to us
        this.connections[fromUserId].isVideoCall = isVideoCall;
        this.connections[fromUserId].isAudioOnly = isAudioOnly;

        try {
            if (typeof sdpString !== 'string' || !sdpTypeFromServer) {
                Utils.log(`Invalid SDP (string) or sdpType received in offer from ${fromUserId}. SDP: ${sdpString}, Type: ${sdpTypeFromServer}`, Utils.logLevels.ERROR);
                this.close(fromUserId); return;
            }
            const remoteSdpObject = { type: sdpTypeFromServer, sdp: sdpString };
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdpObject));

            if (candidates) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object') {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`Error adding remote ICE candidate from offer: ${e}`, Utils.logLevels.WARN));
                    } else {
                        Utils.log(`Skipping invalid remote ICE candidate from offer: ${candidate}`, Utils.logLevels.WARN);
                    }
                }
            }

            if (isVideoCall && VideoCallManager.isCallActive && VideoCallManager.currentPeerId === fromUserId) {
                if (VideoCallManager.localStream) {
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                }
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            Utils.log(`Answer created for ${fromUserId}. ICE Gathering...`, Utils.logLevels.INFO);

            if (document.getElementById('mainMenuModal').style.display === 'flex' && document.getElementById('modalSdpText')) {
                this.updateSdpTextInModal(fromUserId);
            }

            this.waitForIceGatheringComplete(fromUserId, () => {
                if (!pc.localDescription) {
                    Utils.log(`Cannot send answer for ${fromUserId}: localDescription is null.`, Utils.logLevels.ERROR);
                    return;
                }
                const answerMessagePayload = {
                    type: 'ANSWER',
                    userId: UserManager.userId,
                    targetUserId: fromUserId,
                    sdp: pc.localDescription.sdp,
                    sdpType: pc.localDescription.type,
                    candidates: this.iceCandidates[fromUserId] || [],
                    isVideoCall: isVideoCall,
                    isAudioOnly: isAudioOnly,
                };
                // The sending of an answer is not "silent" to the original offerer.
                // The 'isSilent' flag for sendSignalingMessage here refers to UI notifications on *our* side if WS is down.
                // Generally, we want to know if sending an answer fails due to WS.
                this.sendSignalingMessage(answerMessagePayload, false);
                Utils.log(`Answer sent to ${fromUserId} via signaling.`, Utils.logLevels.INFO);
            });

        } catch (error) {
            Utils.log(`Failed to handle remote offer from ${fromUserId}: ${error}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Error processing connection offer: ${error.message}`, 'error');
            this.close(fromUserId);
        }
    },

    updateSdpTextInModal: function(peerId) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;

        const conn = this.connections[peerId];
        const pc = conn?.peerConnection;

        if (pc && pc.localDescription) {
            const connectionInfo = {
                sdp: {
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp
                },
                candidates: this.iceCandidates[peerId] ? this.iceCandidates[peerId].map(c => c.toJSON ? c.toJSON() : c) : [],
                userId: UserManager.userId,
                isVideoCall: conn?.isVideoCall || false,
                isAudioOnly: conn?.isAudioOnly || false,
            };
            sdpTextEl.value = JSON.stringify(connectionInfo, null, 2);
            Utils.log(`Updated modalSdpText for ${peerId} with ${pc.localDescription.type}`, Utils.logLevels.DEBUG);
        } else {
            sdpTextEl.value = "Generating connection info...";
        }
    },

    createAnswer: async function() {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            UIManager.showNotification("Paste offer info into the text area first.", "warning");
            return;
        }
        try {
            const offerDataFromModal = JSON.parse(sdpTextEl.value);

            if (!offerDataFromModal.sdp || typeof offerDataFromModal.sdp !== 'object' ||
                !offerDataFromModal.sdp.sdp || !offerDataFromModal.sdp.type ||
                !offerDataFromModal.userId) {
                UIManager.showNotification("Invalid offer data format in modal. Expected { sdp: {type: 'offer', sdp: '...'}, candidates: [...], userId: '...' }.", "error");
                Utils.log("Pasted offer data for createAnswer was invalid:", offerDataFromModal);
                return;
            }
            if (offerDataFromModal.userId === UserManager.userId) {
                UIManager.showNotification("Cannot process an offer from yourself in this way.", "warning");
                return;
            }

            const fromUserId = offerDataFromModal.userId;
            if (!this.connections[fromUserId]) {
                this.initConnection(fromUserId, offerDataFromModal.isVideoCall || false);
            }
            if(this.connections[fromUserId]){
                this.connections[fromUserId].wasInitiatedSilently = false;
                this.connections[fromUserId].isVideoCall = offerDataFromModal.isVideoCall || false;
                this.connections[fromUserId].isAudioOnly = offerDataFromModal.isAudioOnly || false;
            }


            await this.handleRemoteOffer(
                fromUserId,
                offerDataFromModal.sdp.sdp,
                offerDataFromModal.candidates,
                offerDataFromModal.isVideoCall,
                offerDataFromModal.isAudioOnly,
                offerDataFromModal.sdp.type
            );
            UIManager.showNotification("Answer created and displayed. Copy it and send to peer.", "info");

        } catch (e) {
            UIManager.showNotification("Error creating answer: " + e.message, "error");
            Utils.log("Error in ConnectionManager.createAnswer (manual): " + e, Utils.logLevels.ERROR);
        }
    },

    handleIceGatheringStateChange: function(peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;
        Utils.log(`ICE gathering state for ${peerId}: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);
        if (pc.iceGatheringState === 'gathering') {
            this.iceGatheringStartTimes[peerId] = Date.now();
        } else if (pc.iceGatheringState === 'complete') {
            const duration = (Date.now() - (this.iceGatheringStartTimes[peerId] || Date.now())) / 1000;
            Utils.log(`ICE gathering complete for ${peerId} in ${duration.toFixed(1)}s.`, Utils.logLevels.DEBUG);

            if (document.getElementById('mainMenuModal').style.display === 'flex' && document.getElementById('modalSdpText')) {
                this.updateSdpTextInModal(peerId);
            }
        }
    },
};