const ConnectionManager = {
    connections: {},
    iceCandidates: {},
    connectionTimeouts: {},
    reconnectAttempts: {},
    iceTimers: {},
    iceGatheringStartTimes: {},
    websocket: null,
    isWebSocketConnected: false,
    signalingServerUrl: Config.server.signalingServerUrl,
    pendingSentChunks: {},
    pendingReceivedChunks: {},

    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

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
                    EventEmitter.emit('websocketStatusUpdate');
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
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                };
            } catch (error) {
                Utils.log('Failed to create WebSocket connection: ' + error, Utils.logLevels.ERROR);
                UIManager.updateConnectionStatusIndicator('Failed to connect to signaling server.');
                const oldStatus = this.isWebSocketConnected;
                this.isWebSocketConnected = false;
                if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
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
        this.sendSignalingMessage(message, false);
    },

    sendSignalingMessage: function(message, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const messageString = JSON.stringify(message);
            this.websocket.send(messageString);
            Utils.log(`Sent WS: ${message.type} to ${message.targetUserId || 'server'} (from ${message.userId || 'N/A'}) ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        } else {
            Utils.log('WebSocket not connected, cannot send signaling message.', Utils.logLevels.ERROR);
            if (!isInternalSilentFlag) {
                if (window.location.protocol === 'file:') {
                    UIManager.showNotification('Running from local file system. Signaling server might be unavailable. Message not sent.', 'warning');
                } else {
                    UIManager.showNotification('Not connected to signaling server. Message not sent.', 'error');
                }
            }
        }
    },

    handleSignalingMessage: function(message) {
        Utils.log(`Received WS: ${message.type} from ${message.fromUserId || 'server'} ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        switch (message.type) {
            case 'SUCCESS':
                UIManager.updateConnectionStatusIndicator(`User registration successful: ${UserManager.userId.substring(0,8)}...`);
                this.autoConnectToAllContacts();
                break;
            case 'ERROR':
                if (!message.message.includes('不在线')) {
                    UIManager.showNotification(`Signaling error: ${message.message}`, 'error');
                }
                Utils.log(`Signaling server error: ${message.message}`, Utils.logLevels.ERROR);
                break;
            case 'OFFER':
                this.handleRemoteOffer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ANSWER':
                this.handleRemoteAnswer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ICE_CANDIDATE':
                this.handleRemoteIceCandidate(fromUserId, message.candidate);
                break;
            case 'USER_NOT_FOUND':
                const connDetails = this.connections[message.targetUserId];
                const wasSilentAttempt = connDetails?.wasInitiatedSilently || false;
                if (!wasSilentAttempt) {
                    UIManager.showNotification(`User ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0,8) + '...'} not found or offline.`, 'warning');
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
        Utils.log(`Attempting to initialize connection with ${peerId}. Video call: ${isVideoCall}`, Utils.logLevels.DEBUG);

        const existingConnDetails = this.connections[peerId];
        if (existingConnDetails && existingConnDetails.peerConnection) {
            const pc = existingConnDetails.peerConnection;
            const pcSignalingState = pc.signalingState;

            if (pcSignalingState === 'have-local-offer' ||
                pcSignalingState === 'have-remote-offer') {

                Utils.log(`initConnection: Connection for ${peerId} is in active negotiation (Signaling: ${pcSignalingState}). Re-using existing PeerConnection.`, Utils.logLevels.WARN);
                existingConnDetails.isVideoCall = isVideoCall;
                if (!isVideoCall && !pc.ondatachannel) {
                    pc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
                    Utils.log(`initConnection: Re-set ondatachannel for reused PC ${peerId}`, Utils.logLevels.DEBUG);
                }
                return pc;
            }
            Utils.log(`initConnection: Existing RTCPeerConnection for ${peerId} found (Signaling: ${pcSignalingState}, Connection: ${pc.connectionState}). Proceeding with close and re-init.`, Utils.logLevels.INFO);
            this.close(peerId, false);
        }

        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID && this.connections[this.MANUAL_PLACEHOLDER_PEER_ID]) {
            Utils.log(`Explicitly closing and deleting existing RTCPeerConnection for ${this.MANUAL_PLACEHOLDER_PEER_ID} before new manual init.`, Utils.logLevels.WARN);
            this.close(this.MANUAL_PLACEHOLDER_PEER_ID, false);
        }

        delete this.connections[peerId];
        delete this.iceCandidates[peerId];
        delete this.reconnectAttempts[peerId];
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
        delete this.iceTimers[peerId];
        delete this.iceGatheringStartTimes[peerId];

        Utils.log(`Initializing NEW RTCPeerConnection for ${peerId}. Video call: ${isVideoCall}`, Utils.logLevels.INFO);

        try {
            const rtcConfig = Config.peerConnectionConfig;
            Utils.log(`Initializing RTCPeerConnection for ${peerId} with config: ${JSON.stringify(rtcConfig)}`, Utils.logLevels.DEBUG);
            const newPc = new RTCPeerConnection(rtcConfig);
            this.connections[peerId] = {
                peerConnection: newPc,
                dataChannel: null,
                isVideoCall: isVideoCall,
                isAudioOnly: false,
                isScreenShare: false,
                wasInitiatedSilently: false
            };
            this.iceCandidates[peerId] = [];
            this.reconnectAttempts[peerId] = 0;

            newPc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            newPc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            newPc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            newPc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);

            if (!isVideoCall) {
                newPc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
            }
            return newPc;
        } catch (error) {
            Utils.log(`CRITICAL: Failed to initialize RTCPeerConnection for ${peerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Connection setup error for ${peerId}: ${error.message}`, 'error');
            delete this.connections[peerId];
            return null;
        }
    },

    createOffer: async function(targetPeerId = null, options = {}) {
        const { isVideoCall = false, isAudioOnly = false, isSilent = false, isManual = false } = options;
        let promptedForId = false;

        if (isManual) {
            Utils.log("Manual offer creation requested.", Utils.logLevels.INFO);
            targetPeerId = this.MANUAL_PLACEHOLDER_PEER_ID;
        } else {
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                if (!isSilent) UIManager.showNotification(`Cannot establish a P2P connection with ${UserManager.contacts[targetPeerId]?.name || "this AI contact"}. It is an AI contact.`, "info");
                else Utils.log(`Attempted to create silent P2P offer to AI contact ${UserManager.contacts[targetPeerId]?.name}. Skipped.`, Utils.logLevels.DEBUG);
                return;
            }
            if (!targetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) {
                targetPeerId = ChatManager.currentChatId;
            }
            if (!targetPeerId && !isSilent) {
                Utils.log("Target Peer ID missing for createOffer, prompting user.", Utils.logLevels.INFO);
                targetPeerId = prompt('Enter Peer ID to connect to:');
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
        }

        Utils.log(`Creating offer for target: ${targetPeerId}, from: ${UserManager.userId}, isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, silent: ${isSilent}, manual: ${isManual}`, Utils.logLevels.DEBUG);

        const pc = this.initConnection(targetPeerId, isVideoCall);
        if (!pc) {
            if (!isSilent || isManual) UIManager.showNotification("Failed to initialize or retrieve connection for offer.", "error");
            Utils.log(`createOffer: initConnection returned null for ${targetPeerId}. Aborting offer.`, Utils.logLevels.ERROR);
            return;
        }

        if (pc.signalingState === 'have-local-offer') {
            Utils.log(`createOffer: PeerConnection for ${targetPeerId} is already in 'have-local-offer' state. Not creating a new offer. (Silent: ${isSilent})`, Utils.logLevels.INFO);
            if (!isSilent) {
                const contactName = UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,6);
                UIManager.showNotification(`An offer to ${contactName} has already been sent. Please wait for a response.`, "info");
            }
            return;
        }
        if (pc.signalingState === 'have-remote-offer') {
            Utils.log(`createOffer: PeerConnection for ${targetPeerId} is in 'have-remote-offer' state. An answer should be created, not an offer. Aborting.`, Utils.logLevels.WARN);
            if (!isSilent) UIManager.showNotification(`Received an offer from this peer. Cannot create a new offer now.`, "info");
            return;
        }

        if (this.connections[targetPeerId]) {
            this.connections[targetPeerId].isVideoCall = isVideoCall;
            this.connections[targetPeerId].isAudioOnly = isAudioOnly;
            this.connections[targetPeerId].isScreenShare = options.isScreenShare || false;
            this.connections[targetPeerId].wasInitiatedSilently = isSilent && !isManual;
        } else if (targetPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID) {
            Utils.log(`CRITICAL: Connection object for ${targetPeerId} not found after initConnection call in createOffer. Re-creating basic entry.`, Utils.logLevels.ERROR);
            this.connections[targetPeerId] = {
                peerConnection: pc, dataChannel: null, isVideoCall: isVideoCall, isAudioOnly: isAudioOnly,
                isScreenShare: options.isScreenShare || false, wasInitiatedSilently: isSilent && !isManual
            };
        }

        if (pc.signalingState === 'stable' || pc.signalingState === 'new') {
            if (!isVideoCall) {
                const connEntry = this.connections[targetPeerId];
                if (!connEntry || !connEntry.dataChannel || connEntry.dataChannel.readyState === 'closed') {
                    Utils.log(`createOffer: Creating new data channel for ${targetPeerId} (PC state: ${pc.signalingState})`, Utils.logLevels.DEBUG);
                    const dataChannel = pc.createDataChannel('chatChannel', { reliable: true });
                    this.setupDataChannel(dataChannel, targetPeerId);
                } else {
                    Utils.log(`createOffer: Data channel already exists for ${targetPeerId} (state: ${connEntry.dataChannel.readyState}). Not creating a new one.`, Utils.logLevels.DEBUG);
                }
            } else {
                if (VideoCallManager.localStream) {
                    pc.getSenders().forEach(sender => {
                        if(sender.track) {
                            try { pc.removeTrack(sender); } catch(e) { Utils.log(`Error removing old track: ${e}`, Utils.logLevels.WARN); }
                        }
                    });
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if ((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                } else {
                    Utils.log("Local stream not available for video call offer. VideoCallManager should handle this.", Utils.logLevels.WARN);
                }
            }
        }

        try {
            const offerOptions = { offerToReceiveAudio: true, offerToReceiveVideo: isVideoCall && !isAudioOnly };
            const offer = await pc.createOffer(offerOptions);
            await pc.setLocalDescription(offer);

            Utils.log(`Offer created for ${targetPeerId}. State: ${pc.signalingState}. (Manual: ${isManual})`, Utils.logLevels.INFO);

            if (!pc.localDescription) {
                Utils.log(`Cannot process offer for ${targetPeerId}: localDescription is null.`, Utils.logLevels.ERROR);
                if (!isSilent || isManual) UIManager.showNotification("Error: Could not finalize local connection details.", "error");
                this.close(targetPeerId); return;
            }

            if (isManual) {
                this.waitForIceGatheringComplete(targetPeerId, () => {
                    this.updateSdpTextInModal(targetPeerId);
                    UIManager.showNotification("Offer created. Copy the info from 'My Info' and send to peer.", "info");
                });
            } else {
                if (!isSilent && ChatManager.currentChatId === targetPeerId) {
                    const contactName = UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,8) + '...';
                    UIManager.updateChatHeaderStatus(`Connecting to ${contactName}...`);
                }
                const offerMessagePayload = {
                    type: 'OFFER',
                    userId: UserManager.userId,
                    targetUserId: targetPeerId,
                    sdp: pc.localDescription.sdp,
                    sdpType: pc.localDescription.type,
                    isVideoCall: isVideoCall,
                    isAudioOnly: isAudioOnly,
                    isScreenShare: options.isScreenShare || false,
                };
                this.sendSignalingMessage(offerMessagePayload, isSilent);
                Utils.log(`Offer SDP sent to ${targetPeerId} via signaling. (Silent: ${isSilent}) ICE candidates will follow.`, Utils.logLevels.INFO);
            }
        } catch (error) {
            Utils.log(`WebRTC error during offer creation for ${targetPeerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            if (!isSilent || isManual) UIManager.showNotification(`Connection offer error: ${error.message}`, 'error');
            this.close(targetPeerId);
        }
    },

    autoConnectToAllContacts: async function() {
        if (!UserManager.userSettings || typeof UserManager.userSettings.autoConnectEnabled === 'undefined') {
            Utils.log("Auto-connect setting not found or UserManager not fully initialized. Assuming disabled for this attempt.", Utils.logLevels.WARN);
            return;
        }
        if (!UserManager.userSettings.autoConnectEnabled) {
            Utils.log("Auto-connect to contacts is disabled by user setting.", Utils.logLevels.INFO);
            return;
        }
        Utils.log("Attempting to auto-connect to all contacts (setting is ON).", Utils.logLevels.INFO);
        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) {
            Utils.log("No contacts to auto-connect to.", Utils.logLevels.INFO);
            return;
        }
        const contactIds = Object.keys(UserManager.contacts);
        let offerDelay = 0;
        for (const contactId of contactIds) {
            if (contactId === UserManager.userId || (UserManager.isSpecialContact(contactId) && UserManager.contacts[contactId]?.isAI)) continue;
            if (this.isConnectedTo(contactId)) {
                Utils.log(`Already connected to ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }
            const existingConn = this.connections[contactId];
            if (existingConn && existingConn.peerConnection &&
                (existingConn.peerConnection.signalingState === 'have-local-offer' ||
                    existingConn.peerConnection.signalingState === 'have-remote-offer' ||
                    existingConn.peerConnection.connectionState === 'connecting' ||
                    (existingConn.dataChannel?.readyState === 'connecting'))) {
                Utils.log(`Connection attempt already in progress for ${contactId} (signaling: ${existingConn.peerConnection.signalingState}, connection: ${existingConn.peerConnection.connectionState}). Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }
            ((idToConnect, delay) => {
                setTimeout(async () => {
                    Utils.log(`Auto-connecting to contact (staggered): ${idToConnect}`, Utils.logLevels.DEBUG);
                    try {
                        await this.createOffer(idToConnect, {isVideoCall: false, isAudioOnly: false, isSilent: true});
                    } catch (error) {
                        Utils.log(`Error during auto-connecting initiation for ${idToConnect}: ${error.message}`, Utils.logLevels.WARN);
                    }
                }, delay);
            })(contactId, offerDelay);
            offerDelay += 200;
        }
        Utils.log("Finished dispatching auto-connection attempts to contacts.", Utils.logLevels.INFO);
    },

    handleAnswer: async function(options = {}) {
        const { isManual = false } = options;
        if (!isManual) {
            Utils.log("handleAnswer called without isManual=true. This function is for manual flow. For signaling answers, use handleRemoteAnswer directly.", Utils.logLevels.WARN);
            return;
        }

        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            UIManager.showNotification("Paste answer info into the text area first.", "warning");
            return;
        }
        try {
            const answerDataFromModal = JSON.parse(sdpTextEl.value);
            sdpTextEl.value = '';

            if (!answerDataFromModal.sdp || !answerDataFromModal.sdp.sdp ||
                answerDataFromModal.sdp.type !== 'answer' ||
                !answerDataFromModal.userId) {
                UIManager.showNotification("Invalid answer data format. Expected { sdp: {type: 'answer', ...}, ... }.", "error");
                Utils.log(`Invalid answer data from modal: ${JSON.stringify(answerDataFromModal)}`, Utils.logLevels.ERROR);
                return;
            }
            if (answerDataFromModal.userId === UserManager.userId) {
                UIManager.showNotification("Cannot process an answer from yourself.", "warning");
                return;
            }

            const fromUserId = answerDataFromModal.userId;
            const placeholderConn = this.connections[this.MANUAL_PLACEHOLDER_PEER_ID];

            if (!placeholderConn || !placeholderConn.peerConnection) {
                UIManager.showNotification(`Error: No pending manual offer found. Please create an offer first.`, "error");
                Utils.log(`handleAnswer (manual): No peerConnection object for ${this.MANUAL_PLACEHOLDER_PEER_ID} found.`, Utils.logLevels.ERROR);
                return;
            }

            this.connections[fromUserId] = placeholderConn;
            delete this.connections[this.MANUAL_PLACEHOLDER_PEER_ID];

            if (this.iceCandidates[this.MANUAL_PLACEHOLDER_PEER_ID]) {
                this.iceCandidates[fromUserId] = this.iceCandidates[this.MANUAL_PLACEHOLDER_PEER_ID];
                delete this.iceCandidates[this.MANUAL_PLACEHOLDER_PEER_ID];
            }
            ['reconnectAttempts', 'iceTimers', 'iceGatheringStartTimes', 'connectionTimeouts'].forEach(storeKey => {
                if (this[storeKey] && this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID]) {
                    this[storeKey][fromUserId] = this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID];
                    delete this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID];
                }
            });

            if (placeholderConn.dataChannel) {
                Utils.log(`DataChannel for manual offerer (now ${fromUserId}) was already set up under placeholder. It will resolve to ${fromUserId} on open.`, Utils.logLevels.DEBUG);
            }

            const pc = placeholderConn.peerConnection;
            Utils.log(`handleAnswer (manual): PC for ${fromUserId} (was ${this.MANUAL_PLACEHOLDER_PEER_ID}). State: ${pc.signalingState}`, Utils.logLevels.DEBUG);

            if (pc.signalingState !== 'have-local-offer') {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) {
                    UIManager.showNotification(`Already connected to ${fromUserId}. No action needed for manual answer.`, "info");
                } else {
                    UIManager.showNotification(`Error: Connection for ${fromUserId} is in an unexpected state (${pc.signalingState}). Expected 'have-local-offer'.`, "error");
                }
                UIManager.toggleModal('mainMenuModal', false);
                return;
            }

            await this.handleRemoteAnswer(
                fromUserId,
                answerDataFromModal.sdp.sdp,
                answerDataFromModal.candidates,
                placeholderConn.isVideoCall,
                placeholderConn.isAudioOnly,
                placeholderConn.isScreenShare,
                'answer'
            );

            if (fromUserId !== UserManager.userId && !UserManager.contacts[fromUserId]) {
                await UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
            }

            UIManager.showNotification(`Processing answer from ${UserManager.contacts[fromUserId]?.name || fromUserId.substring(0,6)}...`, "info");
            UIManager.toggleModal('mainMenuModal', false);

        } catch (e) {
            UIManager.showNotification("Error handling answer: " + e.message, "error");
            Utils.log("Error in ConnectionManager.handleAnswer (manual): " + e, Utils.logLevels.ERROR);
        }
    },

    handleRemoteAnswer: async function(fromUserId, sdpString, candidates, isVideoCallFlagFromOffer, isAudioOnlyFlagFromOffer, isScreenShareFlagFromOffer, sdpTypeFromServer) {
        const conn = this.connections[fromUserId];
        if (!conn || !conn.peerConnection) {
            Utils.log(`handleRemoteAnswer: No active connection found for answer from ${fromUserId}.`, Utils.logLevels.WARN);
            return;
        }
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;

        Utils.log(`handleRemoteAnswer for ${fromUserId}: Current signalingState: ${pc.signalingState}. SDP Type provided: ${sdpTypeFromServer}`, Utils.logLevels.DEBUG);

        if (sdpTypeFromServer !== 'answer') {
            Utils.log(`handleRemoteAnswer: Expected SDP type 'answer' but got '${sdpTypeFromServer}' for ${fromUserId}. Aborting.`, Utils.logLevels.ERROR);
            if (!wasSilentContext) UIManager.showNotification(`Protocol error: Expected answer SDP for ${fromUserId}.`, 'error');
            this.close(fromUserId);
            return;
        }

        if (pc.signalingState !== 'have-local-offer') {
            Utils.log(`handleRemoteAnswer: PeerConnection for ${fromUserId} is in state ${pc.signalingState}, but expected 'have-local-offer'. (Silent: ${wasSilentContext})`, Utils.logLevels.ERROR);
            if (!wasSilentContext) {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) {
                    Utils.log(`handleRemoteAnswer: Connection to ${fromUserId} already stable. Answer might be duplicate or late.`, Utils.logLevels.INFO);
                } else {
                    UIManager.showNotification(`Connection state error processing answer for ${fromUserId}. State: ${pc.signalingState}.`, 'error');
                }
            }
            return;
        }

        try {
            if (typeof sdpString !== 'string') {
                Utils.log(`Invalid SDP string received in answer from ${fromUserId}. SDP: ${sdpString}`, Utils.logLevels.ERROR);
                this.close(fromUserId); return;
            }
            const remoteSdpObject = { type: 'answer', sdp: sdpString };
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdpObject));
            Utils.log(`Remote description (answer) set for ${fromUserId}. New state: ${pc.signalingState}. (Silent: ${wasSilentContext})`, Utils.logLevels.INFO);

            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object') {
                        if (pc.remoteDescription && pc.signalingState !== 'closed') {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`Error adding remote ICE candidate from answer for ${fromUserId}: ${e}`, Utils.logLevels.WARN));
                        } else {
                            Utils.log(`Skipping ICE candidate from answer for ${fromUserId}: PC closed or no remoteDesc. State: ${pc.signalingState}`, Utils.logLevels.WARN);
                        }
                    } else {
                        Utils.log(`Skipping invalid remote ICE candidate from answer for ${fromUserId}: ${JSON.stringify(candidate)}`, Utils.logLevels.WARN);
                    }
                }
            }
        } catch (error) {
            Utils.log(`Failed to set remote answer or add ICE for ${fromUserId}: ${error.message} (Signaling state was ${pc.signalingState}) (Silent: ${wasSilentContext})`, Utils.logLevels.ERROR);
            if (!wasSilentContext) UIManager.showNotification(`Error processing connection answer: ${error.message}`, 'error');
            this.close(fromUserId);
        }
    },

    createAnswer: async function(options = {}) {
        const { isManual = false } = options;
        if (!isManual) {
            Utils.log("createAnswer called without isManual=true. This function is for manual flow. For signaling offers, use handleRemoteOffer directly.", Utils.logLevels.WARN);
            return;
        }

        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            UIManager.showNotification("Paste offer info into the text area first.", "warning");
            return;
        }
        let offerDataFromModal;
        try {
            offerDataFromModal = JSON.parse(sdpTextEl.value);

            if (!offerDataFromModal.sdp || typeof offerDataFromModal.sdp !== 'object' ||
                offerDataFromModal.sdp.type !== 'offer' ||
                !offerDataFromModal.sdp.sdp || !offerDataFromModal.userId) {
                UIManager.showNotification("Invalid offer data format. Expected { sdp: {type: 'offer', ...}, ... }.", "error");
                Utils.log(`Pasted offer data for createAnswer was invalid: ${JSON.stringify(offerDataFromModal)}`, Utils.logLevels.ERROR);
                return;
            }
            if (offerDataFromModal.userId === UserManager.userId) {
                UIManager.showNotification("Cannot process an offer from yourself.", "warning");
                return;
            }

            const fromUserId = offerDataFromModal.userId;
            sdpTextEl.value = 'Generating answer...';

            const pc = this.initConnection(fromUserId, offerDataFromModal.isVideoCall || false);
            if (!pc) {
                UIManager.showNotification("Failed to initialize connection to create answer.", "error");
                sdpTextEl.value = 'Error initializing connection.';
                return;
            }

            if(this.connections[fromUserId]){
                this.connections[fromUserId].wasInitiatedSilently = false;
                this.connections[fromUserId].isVideoCall = offerDataFromModal.isVideoCall || false;
                this.connections[fromUserId].isAudioOnly = offerDataFromModal.isAudioOnly || false;
                this.connections[fromUserId].isScreenShare = offerDataFromModal.isScreenShare || false;
            }

            await this.handleRemoteOffer(
                fromUserId,
                offerDataFromModal.sdp.sdp,
                offerDataFromModal.candidates,
                offerDataFromModal.isVideoCall,
                offerDataFromModal.isAudioOnly,
                offerDataFromModal.isScreenShare,
                'offer',
                true
            );
            UIManager.showNotification("Answer generation started. Modal will update with info to copy.", "info");

        } catch (e) {
            UIManager.showNotification("Error creating answer: " + e.message, "error");
            Utils.log("Error in ConnectionManager.createAnswer (manual): " + e, Utils.logLevels.ERROR);
            if (sdpTextEl) sdpTextEl.value = `Error: ${e.message}`;
        }
    },

    handleRemoteOffer: async function(fromUserId, sdpString, candidates, isVideoCall, isAudioOnly, isScreenShare, sdpTypeFromServer, isManualCreateAnswerFlow = false) {
        Utils.log(`Handling remote offer from ${fromUserId}. isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, isScreenShare: ${isScreenShare}. ManualFlow: ${isManualCreateAnswerFlow}`, Utils.logLevels.INFO);

        if (isManualCreateAnswerFlow && fromUserId !== UserManager.userId && !UserManager.contacts[fromUserId]) {
            await UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
        }

        let pc = this.connections[fromUserId]?.peerConnection;

        if (!pc) {
            pc = this.initConnection(fromUserId, isVideoCall);
        } else if (!isManualCreateAnswerFlow && pc.signalingState !== 'stable' && pc.signalingState !== 'new') {
            pc = this.initConnection(fromUserId, isVideoCall);
        }

        if (!pc) {
            Utils.log(`handleRemoteOffer: PeerConnection for ${fromUserId} could not be obtained/initialized. Aborting.`, Utils.logLevels.ERROR);
            UIManager.showNotification("Failed to initialize connection to handle offer.", "error");
            return;
        }

        if(this.connections[fromUserId]){
            this.connections[fromUserId].wasInitiatedSilently = this.connections[fromUserId].wasInitiatedSilently && !isManualCreateAnswerFlow;
            this.connections[fromUserId].isVideoCall = isVideoCall;
            this.connections[fromUserId].isAudioOnly = isAudioOnly;
            this.connections[fromUserId].isScreenShare = isScreenShare || false;
        }

        try {
            if (typeof sdpString !== 'string' || sdpTypeFromServer !== 'offer') {
                Utils.log(`Invalid SDP string or sdpType (expected 'offer') received in offer from ${fromUserId}. SDP: ${sdpString}, Type: ${sdpTypeFromServer}`, Utils.logLevels.ERROR);
                this.close(fromUserId); return;
            }
            const remoteSdpObject = { type: 'offer', sdp: sdpString };
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdpObject));
            Utils.log(`Remote description (offer) set for ${fromUserId}. New state: ${pc.signalingState}.`, Utils.logLevels.INFO);

            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object') {
                        if (pc.remoteDescription && pc.signalingState !== 'closed') {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`Error adding remote ICE candidate from offer for ${fromUserId}: ${e}`, Utils.logLevels.WARN));
                        } else {
                            Utils.log(`Skipping ICE candidate from offer for ${fromUserId}: PC closed or no remoteDesc. State: ${pc.signalingState}`, Utils.logLevels.WARN);
                        }
                    } else {
                        Utils.log(`Skipping invalid remote ICE candidate from offer for ${fromUserId}: ${JSON.stringify(candidate)}`, Utils.logLevels.WARN);
                    }
                }
            }

            if (isVideoCall && VideoCallManager.isCallActive && VideoCallManager.currentPeerId === fromUserId) {
            } else if (!isVideoCall && (!this.connections[fromUserId] || !this.connections[fromUserId].dataChannel)) {
                Utils.log(`Waiting for remote to create data channel for ${fromUserId}. (ondatachannel will fire)`, Utils.logLevels.DEBUG);
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            Utils.log(`Local description (answer) created and set for ${fromUserId}. New state: ${pc.signalingState}.`, Utils.logLevels.INFO);

            if (!pc.localDescription) {
                Utils.log(`Cannot send/prepare answer for ${fromUserId}: localDescription is null.`, Utils.logLevels.ERROR);
                this.close(fromUserId);
                return;
            }

            if (isManualCreateAnswerFlow) {
                this.waitForIceGatheringComplete(fromUserId, () => {
                    this.updateSdpTextInModal(fromUserId);
                    UIManager.showNotification("Answer created. Copy the info from 'My Info' and send back to offerer.", "info");
                });
            } else {
                const answerMessagePayload = {
                    type: 'ANSWER',
                    userId: UserManager.userId,
                    targetUserId: fromUserId,
                    sdp: pc.localDescription.sdp,
                    sdpType: pc.localDescription.type,
                    isVideoCall: this.connections[fromUserId]?.isVideoCall || false,
                    isAudioOnly: this.connections[fromUserId]?.isAudioOnly || false,
                    isScreenShare: this.connections[fromUserId]?.isScreenShare || false,
                };
                this.sendSignalingMessage(answerMessagePayload, false);
                Utils.log(`Answer SDP sent to ${fromUserId} via signaling. ICE candidates will follow.`, Utils.logLevels.INFO);
            }

        } catch (error) {
            Utils.log(`Failed to handle remote offer from ${fromUserId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Error processing connection offer: ${error.message}`, 'error');
            this.close(fromUserId);
        }
    },

    handleRemoteIceCandidate: async function(fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        if (conn && conn.peerConnection && conn.peerConnection.remoteDescription && conn.peerConnection.signalingState !== 'closed') {
            try {
                if (candidate && typeof candidate === 'object') {
                    if (candidate.candidate || candidate.sdpMid || candidate.sdpMLineIndex !== undefined) {
                        await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                        Utils.log(`Added remote ICE candidate from ${fromUserId}.`, Utils.logLevels.DEBUG);
                    } else {
                        Utils.log(`Skipping remote ICE candidate from ${fromUserId} due to missing fields: ${JSON.stringify(candidate)}`, Utils.logLevels.WARN);
                    }
                } else {
                    Utils.log(`Skipping invalid remote ICE candidate from ${fromUserId}: ${JSON.stringify(candidate)}`, Utils.logLevels.WARN);
                }
            } catch (error) {
                Utils.log(`Error adding remote ICE candidate from ${fromUserId} (state: ${conn.peerConnection.signalingState}): ${error}`, Utils.logLevels.WARN);
            }
        } else {
            Utils.log(`Received ICE candidate from ${fromUserId}, but no valid connection, remoteDescription, or connection closed. State: ${conn?.peerConnection?.signalingState}. Candidate might be queued or dropped.`, Utils.logLevels.WARN);
        }
    },

    handleIceCandidate: function(event, peerId) {
        if (event.candidate) {
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate.toJSON());

            const connData = this.connections[peerId];
            const isManualContext = peerId === this.MANUAL_PLACEHOLDER_PEER_ID ||
                (connData && connData.wasInitiatedSilently === false &&
                    (document.getElementById('modalCreateOfferBtn')?.disabled ||
                        document.getElementById('modalCreateAnswerBtn')?.disabled)
                );

            if (!isManualContext && peerId !== this.MANUAL_PLACEHOLDER_PEER_ID) {
                const sendSilently = connData?.wasInitiatedSilently || false;
                const candidateMessagePayload = {
                    type: 'ICE_CANDIDATE',
                    userId: UserManager.userId,
                    targetUserId: peerId,
                    candidate: event.candidate.toJSON()
                };
                this.sendSignalingMessage(candidateMessagePayload, sendSilently);
            }
        } else {
            Utils.log(`ICE gathering complete for ${peerId} (event.candidate is null).`, Utils.logLevels.DEBUG);
        }
    },

    waitForIceGatheringComplete: function(peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) {
            Utils.log(`waitForIceGatheringComplete: No PeerConnection for ${peerId}.`, Utils.logLevels.WARN);
            if (typeof callback === 'function') callback();
            return;
        }

        if (this.iceTimers[peerId]) {
            clearTimeout(this.iceTimers[peerId]);
            delete this.iceTimers[peerId];
        }

        if (pc.iceGatheringState === 'complete') {
            Utils.log(`ICE gathering already complete for ${peerId}. Calling callback immediately.`, Utils.logLevels.DEBUG);
            if (typeof callback === 'function') callback();
        } else {
            Utils.log(`Waiting for ICE gathering to complete for ${peerId}... Current state: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);
            this.iceGatheringStartTimes[peerId] = Date.now();

            const iceTimeout = Config.timeouts.iceGathering;
            let checkInterval;

            const onDone = () => {
                if(checkInterval) clearInterval(checkInterval);
                checkInterval = null;
                const timerExists = !!this.iceTimers[peerId];
                if (this.iceTimers[peerId]) {
                    clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                }
                if (typeof callback === 'function' && timerExists) {
                    callback();
                }
            };

            this.iceTimers[peerId] = setTimeout(() => {
                Utils.log(`ICE gathering timeout for ${peerId} after ${iceTimeout}ms. Proceeding. State: ${pc.iceGatheringState}`, Utils.logLevels.WARN);
                onDone();
            }, iceTimeout);

            checkInterval = setInterval(() => {
                if (!this.connections[peerId] || !this.connections[peerId].peerConnection) {
                    if(checkInterval) clearInterval(checkInterval);
                    checkInterval = null;
                    if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                    Utils.log(`waitForIceGatheringComplete: PeerConnection for ${peerId} disappeared. Aborting wait.`, Utils.logLevels.WARN);
                    return;
                }
                if (this.connections[peerId].peerConnection.iceGatheringState === 'complete') {
                    Utils.log(`ICE gathering reported complete for ${peerId} by interval check.`, Utils.logLevels.DEBUG);
                    onDone();
                }
            }, 200);
        }
    },

    setupDataChannel: function(channel, peerIdArg) {
        let currentContextPeerId = peerIdArg;

        if (currentContextPeerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
            channel._isManualPlaceholderChannel = true;
        }

        if (!this.connections[currentContextPeerId]) {
            Utils.log(`Connection object for ${currentContextPeerId} not found when setting up data channel. Channel name: ${channel.label}`, Utils.logLevels.ERROR);
            try { channel.close(); } catch(e){ /* ignore */ }
            return;
        }
        if (this.connections[currentContextPeerId].dataChannel &&
            this.connections[currentContextPeerId].dataChannel !== channel &&
            this.connections[currentContextPeerId].dataChannel.readyState === 'open') {
            Utils.log(`Data channel already exists and is open for ${currentContextPeerId}. New channel: ${channel.label} is being ignored. Old channel was: ${this.connections[currentContextPeerId].dataChannel.label}`, Utils.logLevels.WARN);
            try { channel.close(); } catch(e) { Utils.log(`Error closing redundant new channel: ${e}`, Utils.logLevels.WARN); }
            return;
        }
        if (this.connections[currentContextPeerId].dataChannel === channel && channel._listenersAttached) {
            Utils.log(`setupDataChannel called again for already configured channel ${channel.label} for ${currentContextPeerId}. Listeners not re-attached.`, Utils.logLevels.DEBUG);
            return;
        }

        this.connections[currentContextPeerId].dataChannel = channel;
        channel._listenersAttached = true;
        const wasSilentContext = this.connections[currentContextPeerId]?.wasInitiatedSilently || false;
        Utils.log(`Setting up data channel "${channel.label}" for connection key ${currentContextPeerId}. Silent Context: ${wasSilentContext}`, Utils.logLevels.INFO);

        channel.onopen = async () => {
            let finalPeerId = currentContextPeerId;

            if (channel._isManualPlaceholderChannel) {
                let resolved = false;
                for (const actualIdInMap in this.connections) {
                    if (this.connections[actualIdInMap] && this.connections[actualIdInMap].dataChannel === channel) {
                        finalPeerId = actualIdInMap;
                        resolved = true;
                        Utils.log(`DataChannel.onopen (Offerer A): Resolved ${this.MANUAL_PLACEHOLDER_PEER_ID} to actual peer ${finalPeerId}.`, Utils.logLevels.INFO);
                        break;
                    }
                }
                if (!resolved) {
                    Utils.log(`CRITICAL: DataChannel.onopen (Offerer A): Could not resolve placeholder to actual peer ID. Original context ID: ${currentContextPeerId}`, Utils.logLevels.ERROR);
                    return;
                }
            }

            Utils.log(`Data channel with ${finalPeerId} ("${channel.label}") opened. (Silent Context: ${this.connections[finalPeerId]?.wasInitiatedSilently || false})`, Utils.logLevels.INFO);
            const contactName = UserManager.contacts[finalPeerId]?.name || finalPeerId.substring(0,8) + '...';

            if ((!this.connections[finalPeerId]?.wasInitiatedSilently || ChatManager.currentChatId === finalPeerId)) {
                UIManager.updateChatHeaderStatus(`Connected to ${contactName}`);
            }

            // *** MODIFIED SECTION START ***
            // Check if the peer is already a contact. If not, add them.
            // This handles cases where the connection is initiated by the other peer (we received an offer).
            if (finalPeerId !== UserManager.userId &&
                finalPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID &&
                !UserManager.contacts[finalPeerId]) {

                Utils.log(`DataChannel.onopen: Peer ${finalPeerId} is not a known contact. Adding them.`, Utils.logLevels.INFO);
                await UserManager.addContact(finalPeerId, `Peer ${finalPeerId.substring(0,4)}`);
                // Optionally, open chat if this was an incoming connection that just established
                // This might be too aggressive if the user wasn't expecting it. Consider a notification instead.
                // For now, let's not auto-open, but adding contact is good.
            }
            // Handle manual connection cases where the contact might need to be added or chat opened.
            else if (channel._isManualPlaceholderChannel && finalPeerId !== UserManager.userId && finalPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID) {
                // This is Party A, and connection with Party B (finalPeerId) is now open.
                // We already add contact for Party B in handleAnswer (for Party A).
                // Ensure chat is opened if it was for the placeholder.
                if (ChatManager.currentChatId === null || ChatManager.currentChatId === this.MANUAL_PLACEHOLDER_PEER_ID || ChatManager.currentChatId === currentContextPeerId) {
                    ChatManager.openChat(finalPeerId, 'contact');
                }
            }
            // *** MODIFIED SECTION END ***

            EventEmitter.emit('connectionEstablished', finalPeerId);
            if (ChatManager.currentChatId === finalPeerId && this.connections[finalPeerId] && !this.connections[finalPeerId].isVideoCall) {
                UIManager.setCallButtonsState(true, finalPeerId);
            }
            if (this.reconnectAttempts[finalPeerId] !== undefined) this.reconnectAttempts[finalPeerId] = 0;
        };

        channel.onclose = () => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderChannel) {
                for (const actualIdInMap in this.connections) {
                    if (this.connections[actualIdInMap] && this.connections[actualIdInMap].dataChannel === channel) {
                        finalPeerId = actualIdInMap; break;
                    }
                }
            }
            Utils.log(`Data channel with ${finalPeerId} ("${channel.label}") closed. (Was Silent Context: ${this.connections[finalPeerId]?.wasInitiatedSilently || false})`, Utils.logLevels.INFO);
            const pcState = this.connections[finalPeerId]?.peerConnection?.connectionState;
            if (pcState !== 'closed' && pcState !== 'failed') {
                EventEmitter.emit('connectionDisconnected', finalPeerId);
            }
            if (ChatManager.currentChatId === finalPeerId) {
                UIManager.setCallButtonsState(false);
                if (!this.connections[finalPeerId]?.wasInitiatedSilently) {
                    UIManager.updateChatHeaderStatus(`Disconnected`);
                }
            }
            if (this.connections[finalPeerId] && this.connections[finalPeerId].dataChannel === channel) {
                this.connections[finalPeerId].dataChannel = null;
            }
            channel._listenersAttached = false;
        };

        channel.onerror = (error) => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderChannel) { for (const id in this.connections) if(this.connections[id]?.dataChannel === channel) {finalPeerId=id; break;}}
            Utils.log(`Data channel error with ${finalPeerId} ("${channel.label}"): ${JSON.stringify(error)} (Was Silent: ${this.connections[finalPeerId]?.wasInitiatedSilently || false})`, Utils.logLevels.ERROR);
        };

        channel.onmessage = (event) => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderChannel) {
                let resolved = false;
                for (const actualIdInMap in this.connections) {
                    if (this.connections[actualIdInMap] && this.connections[actualIdInMap].dataChannel === channel) {
                        finalPeerId = actualIdInMap; resolved = true; break;
                    }
                }
                if (!resolved) { Utils.log(`CRITICAL: DataChannel.onmessage: Could not resolve peer ID for manual channel. Original context: ${currentContextPeerId}`, Utils.logLevels.ERROR); return; }
            }

            try {
                const rawMessage = event.data;
                let messageObjectToProcess;

                if (typeof rawMessage === 'string') {
                    let parsedJson;
                    try { parsedJson = JSON.parse(rawMessage); }
                    catch (e) {
                        Utils.log(`Received malformed JSON or plain text from ${finalPeerId} on DC "${channel.label}": ${String(rawMessage).substring(0,100)}... Error: ${e.message}`, Utils.logLevels.WARN);
                        messageObjectToProcess = { type: 'text', content: rawMessage, sender: finalPeerId, timestamp: new Date().toISOString() };
                    }
                    if (parsedJson) {
                        if (parsedJson.type === 'chunk-meta' || parsedJson.type === 'chunk-data') {
                            const reassembledData = Utils.reassembleChunk(parsedJson, finalPeerId);
                            if (reassembledData) { messageObjectToProcess = reassembledData; }
                            else { return; }
                        } else { messageObjectToProcess = parsedJson; }
                    }
                } else if (rawMessage instanceof ArrayBuffer || rawMessage instanceof Blob) {
                    Utils.log(`Received binary DataChannel message from ${finalPeerId} on DC "${channel.label}". Discarding.`, Utils.logLevels.WARN); return;
                } else {
                    Utils.log(`Received non-string/non-binary DataChannel message from ${finalPeerId} on DC "${channel.label}". Discarding.`, Utils.logLevels.WARN); return;
                }

                if (!messageObjectToProcess) {
                    Utils.log(`Logic error: messageObjectToProcess is undefined before final handling. Raw: ${String(rawMessage).substring(0,100)}`, Utils.logLevels.ERROR); return;
                }
                messageObjectToProcess.sender = messageObjectToProcess.sender || finalPeerId;

                if (messageObjectToProcess.type && messageObjectToProcess.type.startsWith('video-call-')) {
                    VideoCallManager.handleMessage(messageObjectToProcess, finalPeerId);
                } else if (messageObjectToProcess.groupId || messageObjectToProcess.type?.startsWith('group-')) {
                    GroupManager.handleGroupMessage(messageObjectToProcess);
                } else {
                    ChatManager.addMessage(messageObjectToProcess.groupId || finalPeerId, messageObjectToProcess);
                }
            } catch (e) {
                Utils.log(`Critical error in DataChannel onmessage from ${finalPeerId} on DC "${channel.label}": ${e.message}. Data: ${String(event.data).substring(0,100)} Stack: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    handleIceConnectionStateChange: function(peerId) {
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState} (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

        switch (pc.iceConnectionState) {
            case 'connected':
            case 'completed':
                if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
                break;
            case 'disconnected':
                Utils.log(`ICE disconnected for ${peerId}. Attempting to reconnect if appropriate...`, Utils.logLevels.WARN);
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) {
                    this.attemptReconnect(peerId);
                }
                break;
            case 'failed':
                Utils.log(`ICE connection failed for ${peerId}. (Silent Context: ${wasSilentContext})`, Utils.logLevels.ERROR);
                if (!wasSilentContext) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} failed.`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false);
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
        const conn = this.connections[peerId];
        if(!conn || !conn.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`RTCPeerConnection state for ${peerId}: ${pc.connectionState} (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

        switch (pc.connectionState) {
            case "new":
            case "connecting":
                break;
            case "connected":
                Utils.log(`RTCPeerConnection to ${peerId} is now 'connected'.`, Utils.logLevels.INFO);
                if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
                if (conn.isVideoCall || (conn.dataChannel && conn.dataChannel.readyState === 'open' && !conn._emittedEstablished)) {
                    EventEmitter.emit('connectionEstablished', peerId);
                    conn._emittedEstablished = true;
                }
                break;
            case "disconnected":
                Utils.log(`RTCPeerConnection to ${peerId} is 'disconnected'. (Silent Context: ${wasSilentContext})`, Utils.logLevels.WARN);
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) {
                    this.attemptReconnect(peerId);
                }
                conn._emittedEstablished = false;
                break;
            case "failed":
                Utils.log(`RTCPeerConnection to ${peerId} has 'failed'. (Silent Context: ${wasSilentContext})`, Utils.logLevels.ERROR);
                if (!wasSilentContext) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} has failed critically.`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false);
                conn._emittedEstablished = false;
                break;
            case "closed":
                Utils.log(`RTCPeerConnection to ${peerId} is 'closed'. (Final cleanup expected by this.close)`, Utils.logLevels.INFO);
                conn._emittedEstablished = false;
                break;
        }
    },

    attemptReconnect: function(peerId) {
        const conn = this.connections[peerId];
        if (!conn || conn.isVideoCall) {
            Utils.log(`Skipping reconnect attempt for ${peerId} (no connection or is video call).`, Utils.logLevels.DEBUG);
            return;
        }
        if (this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') {
            Utils.log(`Reconnect attempt for ${peerId} skipped: already connected or connecting.`, Utils.logLevels.DEBUG);
            if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
            return;
        }

        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        if (this.reconnectAttempts[peerId] <= Config.reconnect.maxAttempts) {
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId] -1);
            Utils.log(`Attempting to reconnect with ${peerId} (attempt ${this.reconnectAttempts[peerId]}) in ${delay/1000}s...`, Utils.logLevels.INFO);

            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);

            this.connectionTimeouts[peerId] = setTimeout(async () => {
                delete this.connectionTimeouts[peerId];
                const currentConn = this.connections[peerId];
                if (currentConn && !this.isConnectedTo(peerId) &&
                    currentConn.peerConnection &&
                    currentConn.peerConnection.connectionState !== 'connecting' &&
                    currentConn.peerConnection.signalingState !== 'have-local-offer' &&
                    currentConn.peerConnection.signalingState !== 'have-remote-offer' ) {
                    Utils.log(`Re-initiating offer to ${peerId} for reconnection.`, Utils.logLevels.INFO);
                    if (currentConn.peerConnection.connectionState === 'failed' || currentConn.peerConnection.connectionState === 'closed' || currentConn.peerConnection.connectionState === 'disconnected') {
                        Utils.log(`Closing stale PC before reconnection attempt for ${peerId}. State: ${currentConn.peerConnection.connectionState}`, Utils.logLevels.DEBUG);
                        this.close(peerId, false);
                    }
                    await this.createOffer(peerId, {isVideoCall: false, isAudioOnly: false, isSilent: true});
                } else if (this.isConnectedTo(peerId)) {
                    Utils.log(`Reconnection to ${peerId} not needed, already connected. Resetting attempts.`, Utils.logLevels.INFO);
                    if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
                } else {
                    Utils.log(`Reconnection to ${peerId} aborted, connection object no longer valid, already closed, or actively connecting/negotiating. State: PC=${currentConn?.peerConnection?.connectionState}, Signaling=${currentConn?.peerConnection?.signalingState}`, Utils.logLevels.INFO);
                }
            }, delay);
        } else {
            Utils.log(`Max reconnection attempts reached for ${peerId}. Closing connection.`, Utils.logLevels.ERROR);
            this.close(peerId, false);
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
                    Utils.sendInChunks(messageString, (chunk) => conn.dataChannel.send(chunk), peerId, (messageObject.type === 'file' || messageObject.type === 'audio') ? (messageObject.fileId || messageObject.fileName || `blob-${Date.now()}`) : undefined );
                } else {
                    conn.dataChannel.send(messageString);
                }
                return true;
            } catch (error) {
                Utils.log(`Error sending message to ${peerId} via DataChannel: ${error}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log(`Cannot send to ${peerId}: DataChannel not open or connection doesn't exist. DC State: ${conn?.dataChannel?.readyState}, PC State: ${conn?.peerConnection?.connectionState}`, Utils.logLevels.WARN);
            return false;
        }
    },

    isConnectedTo: function(peerId) {
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) {
            return true;
        }
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return false;

        const pcOverallState = conn.peerConnection.connectionState;

        if (pcOverallState === 'connected') {
            if (conn.isVideoCall) {
                return true;
            } else if (conn.dataChannel && conn.dataChannel.readyState === 'open') {
                return true;
            }
        }
        return false;
    },

    close: function(peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn) {
            const wasSilentContext = conn.wasInitiatedSilently || false;
            Utils.log(`Closing connection with ${peerId}. (Was Silent Context: ${wasSilentContext}) PC State: ${conn.peerConnection?.connectionState}, DC State: ${conn.dataChannel?.readyState}`, Utils.logLevels.INFO);

            if (this.connectionTimeouts[peerId]) {
                clearTimeout(this.connectionTimeouts[peerId]);
                delete this.connectionTimeouts[peerId];
            }
            if (this.iceTimers[peerId]) {
                clearTimeout(this.iceTimers[peerId]);
                delete this.iceTimers[peerId];
            }

            if (conn.dataChannel) {
                try {
                    conn.dataChannel.onopen = null;
                    conn.dataChannel.onmessage = null;
                    conn.dataChannel.onerror = null;
                    const currentOnClose = conn.dataChannel.onclose;
                    conn.dataChannel.onclose = () => {
                        if (typeof currentOnClose === 'function') currentOnClose();
                    };
                    if (conn.dataChannel.readyState !== 'closed') {
                        conn.dataChannel.close();
                    }
                } catch (e) { Utils.log(`Error closing data channel for ${peerId}: ${e}`, Utils.logLevels.WARN); }
            }
            if (conn.peerConnection) {
                try {
                    conn.peerConnection.onicecandidate = null;
                    conn.peerConnection.onicegatheringstatechange = null;
                    conn.peerConnection.oniceconnectionstatechange = null;
                    conn.peerConnection.onconnectionstatechange = null;
                    conn.peerConnection.ondatachannel = null;
                    conn.peerConnection.ontrack = null;
                    if (conn.peerConnection.signalingState !== 'closed') {
                        conn.peerConnection.close();
                    }
                } catch (e) { Utils.log(`Error closing peer connection for ${peerId}: ${e}`, Utils.logLevels.WARN); }
            }

            const wasConnected = this.isConnectedTo(peerId);
            delete this.connections[peerId];
            delete this.iceCandidates[peerId];
            delete this.reconnectAttempts[peerId];
            delete this.iceGatheringStartTimes[peerId];

            if (ChatManager.currentChatId === peerId) {
                const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
                if (!wasSilentContext || ChatManager.currentChatId === peerId) {
                    UIManager.updateChatHeaderStatus(`Disconnected from ${contactName}`);
                }
                UIManager.setCallButtonsState(false);
            }
            EventEmitter.emit('connectionClosed', peerId);
        } else {
            Utils.log(`Attempted to close non-existent connection for ${peerId}.`, Utils.logLevels.DEBUG);
        }
    },

    resetAllConnections: function() {
        UIManager.showConfirmationModal(
            "Are you sure you want to reset all connections? This will disconnect all active chats and calls.",
            () => {
                Utils.log("Resetting all connections.", Utils.logLevels.INFO);
                const peerIdsToClose = Object.keys(this.connections);
                peerIdsToClose.forEach(peerId => this.close(peerId, false));

                this.connections = {}; this.iceCandidates = {}; this.reconnectAttempts = {}; this.iceGatheringStartTimes = {};
                Object.keys(this.connectionTimeouts).forEach(peerId => clearTimeout(this.connectionTimeouts[peerId])); this.connectionTimeouts = {};
                Object.keys(this.iceTimers).forEach(peerId => clearTimeout(this.iceTimers[peerId])); this.iceTimers = {};

                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.onclose = null;
                    this.websocket.close();
                }
                this.websocket = null; this.isWebSocketConnected = false;
                EventEmitter.emit('websocketStatusUpdate');

                setTimeout(() => this.initialize(), 1000);

                UIManager.showNotification("All connections have been reset.", "info");
                if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith("group_") && !UserManager.isSpecialContact(ChatManager.currentChatId)) {
                    UIManager.updateChatHeaderStatus("Disconnected - Connections Reset");
                    UIManager.setCallButtonsState(false);
                }
                ChatManager.renderChatList();
            }
        );
    },

    updateSdpTextInModal: function(peerIdToGetSdpFrom) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;

        const conn = this.connections[peerIdToGetSdpFrom];
        const pc = conn?.peerConnection;

        if (pc && pc.localDescription) {
            const sdpType = pc.localDescription.type;
            const connectionInfo = {
                sdp: { type: sdpType, sdp: pc.localDescription.sdp },
                candidates: this.iceCandidates[peerIdToGetSdpFrom] || [],
                userId: UserManager.userId,
                isVideoCall: conn?.isVideoCall || false,
                isAudioOnly: conn?.isAudioOnly || false,
                isScreenShare: conn?.isScreenShare || false,
            };
            sdpTextEl.value = JSON.stringify(connectionInfo, null, 2);
            Utils.log(`Updated modalSdpText for ${peerIdToGetSdpFrom} with local ${sdpType} and ${connectionInfo.candidates.length} candidates.`, Utils.logLevels.DEBUG);
        } else {
            sdpTextEl.value = `Generating ${pc?.localDescription ? pc.localDescription.type : 'info'} for ${peerIdToGetSdpFrom}... (ICE: ${pc?.iceGatheringState})`;
        }
        UIManager.copySdpTextFromModal();
    },

    handleIceGatheringStateChange: function(peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;
        Utils.log(`ICE gathering state for ${peerId}: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);

        if (pc.iceGatheringState === 'gathering') {
            if (!this.iceGatheringStartTimes[peerId]) {
                this.iceGatheringStartTimes[peerId] = Date.now();
            }
        } else if (pc.iceGatheringState === 'complete') {
            const duration = (Date.now() - (this.iceGatheringStartTimes[peerId] || Date.now())) / 1000;
            Utils.log(`ICE gathering reported complete for ${peerId} in ${duration.toFixed(1)}s. Total candidates: ${this.iceCandidates[peerId]?.length || 0}`, Utils.logLevels.DEBUG);
            delete this.iceGatheringStartTimes[peerId];
        }
    },
};