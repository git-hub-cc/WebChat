// NO CHANGE IN THIS PART (ConnectionManager.js)
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

        LayoutManager.updateConnectionStatusIndicator('Connecting to signaling server...');
        Utils.log('Attempting to connect to WebSocket: ' + this.signalingServerUrl, Utils.logLevels.INFO);

        return new Promise((resolve, reject) => {
            try {
                this.websocket = new WebSocket(this.signalingServerUrl);

                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    LayoutManager.updateConnectionStatusIndicator('Signaling server connected.');
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
                    LayoutManager.updateConnectionStatusIndicator('Signaling server disconnected. Attempting to reconnect...');
                    Utils.log('WebSocket connection closed. Reconnecting in 3s...', Utils.logLevels.WARN);
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    setTimeout(() => this.connectWebSocket(), 3000);
                };

                this.websocket.onerror = (error) => {
                    Utils.log('WebSocket error: ' + JSON.stringify(error), Utils.logLevels.ERROR);
                    LayoutManager.updateConnectionStatusIndicator('Signaling server connection error.');
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                };
            } catch (error) {
                Utils.log('Failed to create WebSocket connection: ' + error, Utils.logLevels.ERROR);
                LayoutManager.updateConnectionStatusIndicator('Failed to connect to signaling server.');
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
                    NotificationManager.showNotification('Running from local file system. Signaling server might be unavailable. Message not sent.', 'warning');
                } else {
                    NotificationManager.showNotification('Not connected to signaling server. Message not sent.', 'error');
                }
            }
        }
    },

    handleSignalingMessage: function(message) {
        Utils.log(`Received WS: ${message.type} from ${message.fromUserId || 'server'} ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        switch (message.type) {
            case 'SUCCESS':
                LayoutManager.updateConnectionStatusIndicator(`User registration successful: ${UserManager.userId.substring(0,8)}...`);
                this.autoConnectToAllContacts();
                break;
            case 'ERROR':
                if (!message.message.includes('不在线')) {
                    NotificationManager.showNotification(`Signaling error: ${message.message}`, 'error');
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
                    NotificationManager.showNotification(`User ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0,8) + '...'} not found or offline.`, 'warning');
                }
                Utils.log(`User ${message.targetUserId} not found. (Silent Attempt: ${wasSilentAttempt})`, Utils.logLevels.WARN);
                if(ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.updateChatHeaderStatus(`User not found or offline`);
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
            if (pcSignalingState === 'have-local-offer' || pcSignalingState === 'have-remote-offer') {
                Utils.log(`initConnection: Conn for ${peerId} in active negotiation (Signaling: ${pcSignalingState}). Re-using.`, Utils.logLevels.WARN);
                existingConnDetails.isVideoCall = isVideoCall;
                if (!isVideoCall && !pc.ondatachannel) {
                    pc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
                }
                return pc;
            }
            Utils.log(`initConnection: Existing PC for ${peerId} (Signaling: ${pcSignalingState}, Conn: ${pc.connectionState}). Closing and re-init.`, Utils.logLevels.INFO);
            this.close(peerId, false);
        }
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID && this.connections[this.MANUAL_PLACEHOLDER_PEER_ID]) {
            Utils.log(`Explicitly closing existing PC for ${this.MANUAL_PLACEHOLDER_PEER_ID} before new manual init.`, Utils.logLevels.WARN);
            this.close(this.MANUAL_PLACEHOLDER_PEER_ID, false);
        }
        delete this.connections[peerId]; delete this.iceCandidates[peerId]; delete this.reconnectAttempts[peerId];
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]); delete this.iceTimers[peerId]; delete this.iceGatheringStartTimes[peerId];
        Utils.log(`Initializing NEW RTCPeerConnection for ${peerId}. Video call: ${isVideoCall}`, Utils.logLevels.INFO);
        try {
            const rtcConfig = Config.peerConnectionConfig;
            Utils.log(`Initializing RTCPeerConnection for ${peerId} with config: ${JSON.stringify(rtcConfig)}`, Utils.logLevels.DEBUG);
            const newPc = new RTCPeerConnection(rtcConfig);
            this.connections[peerId] = { peerConnection: newPc, dataChannel: null, isVideoCall: isVideoCall, isAudioOnly: false, isScreenShare: false, wasInitiatedSilently: false };
            this.iceCandidates[peerId] = []; this.reconnectAttempts[peerId] = 0;
            newPc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            newPc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            newPc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            newPc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);
            if (!isVideoCall) newPc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
            return newPc;
        } catch (error) {
            Utils.log(`CRITICAL: Failed to init PC for ${peerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification(`Connection setup error for ${peerId}: ${error.message}`, 'error');
            delete this.connections[peerId]; return null;
        }
    },

    createOffer: async function(targetPeerId = null, options = {}) {
        const { isVideoCall = false, isAudioOnly = false, isSilent = false, isManual = false } = options;
        let promptedForId = false;
        if (isManual) { Utils.log("Manual offer creation.", Utils.logLevels.INFO); targetPeerId = this.MANUAL_PLACEHOLDER_PEER_ID; }
        else {
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                if (!isSilent) NotificationManager.showNotification(`Cannot P2P with ${UserManager.contacts[targetPeerId]?.name || "AI"}.`, "info");
                else Utils.log(`Skipped P2P offer to AI ${UserManager.contacts[targetPeerId]?.name}.`, Utils.logLevels.DEBUG); return;
            }
            if (!targetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) targetPeerId = ChatManager.currentChatId;
            if (!targetPeerId && !isSilent) { targetPeerId = prompt('Enter Peer ID:'); promptedForId = true; if (!targetPeerId) { NotificationManager.showNotification("Cancelled: No Peer ID.", "info"); return; } }
            else if (!targetPeerId && isSilent) { Utils.log("Target Peer ID missing for silent createOffer. Aborting.", Utils.logLevels.WARN); return; }
            if (targetPeerId === UserManager.userId) {
                if (!isSilent) NotificationManager.showNotification("Cannot connect to yourself.", "warning"); else Utils.log("Skipped offer to self.", Utils.logLevels.DEBUG);
                if (promptedForId && document.getElementById('modalSdpText')) document.getElementById('modalSdpText').value = "Cannot connect to self."; return;
            }
            if (!UserManager.userId) { if (!isSilent) NotificationManager.showNotification("Your user ID N/A.", "error"); return; }
            if (!this.isWebSocketConnected) {
                try { if (!isSilent) NotificationManager.showNotification("Signaling server not connected. Trying...", "info"); await this.connectWebSocket(); }
                catch (e) { if (!isSilent) NotificationManager.showNotification("Signaling failed. Cannot create offer.", "error"); return; }
            }
        }
        Utils.log(`Creating offer for ${targetPeerId}, from: ${UserManager.userId}, video: ${isVideoCall}, audioOnly: ${isAudioOnly}, silent: ${isSilent}, manual: ${isManual}`, Utils.logLevels.DEBUG);
        const pc = this.initConnection(targetPeerId, isVideoCall);
        if (!pc) { if (!isSilent || isManual) NotificationManager.showNotification("Failed to init connection for offer.", "error"); Utils.log(`createOffer: initConnection null for ${targetPeerId}. Aborting.`, Utils.logLevels.ERROR); return; }
        if (pc.signalingState === 'have-local-offer') {
            if (!isSilent) NotificationManager.showNotification(`Offer to ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,6)} already sent.`, "info"); return;
        }
        if (pc.signalingState === 'have-remote-offer') { if (!isSilent) NotificationManager.showNotification(`Received offer from peer. Cannot create new offer.`, "info"); return; }

        if (this.connections[targetPeerId]) { this.connections[targetPeerId].isVideoCall = isVideoCall; this.connections[targetPeerId].isAudioOnly = isAudioOnly; this.connections[targetPeerId].isScreenShare = options.isScreenShare || false; this.connections[targetPeerId].wasInitiatedSilently = isSilent && !isManual; }
        else if (targetPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID) { this.connections[targetPeerId] = { peerConnection: pc, dataChannel: null, isVideoCall, isAudioOnly, isScreenShare: options.isScreenShare||false, wasInitiatedSilently: isSilent&&!isManual }; }

        if (pc.signalingState === 'stable' || pc.signalingState === 'new') {
            if (!isVideoCall) {
                const connEntry = this.connections[targetPeerId];
                if (!connEntry || !connEntry.dataChannel || connEntry.dataChannel.readyState === 'closed') { const dataChannel = pc.createDataChannel('chatChannel', { reliable: true }); this.setupDataChannel(dataChannel, targetPeerId); }
            } else {
                if (VideoCallManager.localStream) {
                    pc.getSenders().forEach(sender => { if(sender.track) try{pc.removeTrack(sender);}catch(e){Utils.log(`Err removing old track: ${e}`,Utils.logLevels.WARN);}});
                    VideoCallManager.localStream.getTracks().forEach(track => { if ((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') pc.addTrack(track, VideoCallManager.localStream); });
                } else Utils.log("Local stream N/A for video call offer.", Utils.logLevels.WARN);
            }
        }
        try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: isVideoCall && !isAudioOnly });
            await pc.setLocalDescription(offer);
            Utils.log(`Offer created for ${targetPeerId}. State: ${pc.signalingState}. (Manual: ${isManual})`, Utils.logLevels.INFO);
            if (!pc.localDescription) { if (!isSilent || isManual) NotificationManager.showNotification("Error: Could not finalize local details.", "error"); this.close(targetPeerId); return; }
            if (isManual) { this.waitForIceGatheringComplete(targetPeerId, () => { this.updateSdpTextInModal(targetPeerId); NotificationManager.showNotification("Offer created. Copy info & send.", "info"); }); }
            else {
                if (!isSilent && ChatManager.currentChatId === targetPeerId && typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.updateChatHeaderStatus(`Connecting to ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,8)}...`);
                const offerMessagePayload = { type: 'OFFER', userId: UserManager.userId, targetUserId: targetPeerId, sdp: pc.localDescription.sdp, sdpType: pc.localDescription.type, isVideoCall, isAudioOnly, isScreenShare: options.isScreenShare || false };
                this.sendSignalingMessage(offerMessagePayload, isSilent);
            }
        } catch (error) {
            Utils.log(`WebRTC error during offer for ${targetPeerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            if (!isSilent || isManual) NotificationManager.showNotification(`Conn offer error: ${error.message}`, 'error'); this.close(targetPeerId);
        }
    },

    autoConnectToAllContacts: async function() {
        if (!UserManager.userSettings || typeof UserManager.userSettings.autoConnectEnabled === 'undefined') return;
        if (!UserManager.userSettings.autoConnectEnabled) { Utils.log("Auto-connect disabled.", Utils.logLevels.INFO); return; }
        Utils.log("Attempting auto-connect to contacts.", Utils.logLevels.INFO);
        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) { Utils.log("No contacts to auto-connect.", Utils.logLevels.INFO); return; }
        let offerDelay = 0;
        for (const contactId of Object.keys(UserManager.contacts)) {
            if (contactId === UserManager.userId || (UserManager.isSpecialContact(contactId) && UserManager.contacts[contactId]?.isAI)) continue;
            if (this.isConnectedTo(contactId)) continue;
            const existingConn = this.connections[contactId];
            if (existingConn?.peerConnection && (existingConn.peerConnection.signalingState === 'have-local-offer' || existingConn.peerConnection.signalingState === 'have-remote-offer' || existingConn.peerConnection.connectionState === 'connecting' || existingConn.dataChannel?.readyState === 'connecting')) continue;
            ((idToConnect, delay) => { setTimeout(async () => { try { await this.createOffer(idToConnect, {isSilent: true}); } catch (error) { Utils.log(`Error auto-connecting to ${idToConnect}: ${error.message}`, Utils.logLevels.WARN); }}, delay); })(contactId, offerDelay);
            offerDelay += 200;
        }
    },

    handleAnswer: async function(options = {}) { // Manual flow from UI
        const { isManual = false } = options; if (!isManual) return;
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) { NotificationManager.showNotification("Paste answer info first.", "warning"); return; }
        try {
            const answerData = JSON.parse(sdpTextEl.value); sdpTextEl.value = '';
            if (!answerData.sdp?.sdp || answerData.sdp.type !== 'answer' || !answerData.userId) { NotificationManager.showNotification("Invalid answer data format.", "error"); return; }
            if (answerData.userId === UserManager.userId) { NotificationManager.showNotification("Cannot process answer from self.", "warning"); return; }
            const fromUserId = answerData.userId;
            const placeholderConn = this.connections[this.MANUAL_PLACEHOLDER_PEER_ID];
            if (!placeholderConn?.peerConnection) { NotificationManager.showNotification(`Error: No pending manual offer found.`, "error"); return; }
            this.connections[fromUserId] = placeholderConn; delete this.connections[this.MANUAL_PLACEHOLDER_PEER_ID];
            ['iceCandidates', 'reconnectAttempts', 'iceTimers', 'iceGatheringStartTimes', 'connectionTimeouts'].forEach(storeKey => { if (this[storeKey]?.[this.MANUAL_PLACEHOLDER_PEER_ID]) { this[storeKey][fromUserId] = this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID]; delete this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID]; }});
            const pc = placeholderConn.peerConnection;
            if (pc.signalingState !== 'have-local-offer') {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) NotificationManager.showNotification(`Already connected to ${fromUserId}.`, "info");
                else NotificationManager.showNotification(`Error: Conn for ${fromUserId} in unexpected state (${pc.signalingState}).`, "error");
                ModalManager.toggleModal('mainMenuModal', false); return;
            }
            await this.handleRemoteAnswer(fromUserId, answerData.sdp.sdp, answerData.candidates, placeholderConn.isVideoCall, placeholderConn.isAudioOnly, placeholderConn.isScreenShare, 'answer');
            if (fromUserId !== UserManager.userId && !UserManager.contacts[fromUserId]) await UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
            NotificationManager.showNotification(`Processing answer from ${UserManager.contacts[fromUserId]?.name || fromUserId.substring(0,6)}...`, "info");
            ModalManager.toggleModal('mainMenuModal', false);
        } catch (e) { NotificationManager.showNotification("Error handling answer: " + e.message, "error"); Utils.log("Error in CM.handleAnswer (manual): " + e, Utils.logLevels.ERROR); }
    },

    handleRemoteAnswer: async function(fromUserId, sdpString, candidates, isVideoCallFlag, isAudioOnlyFlag, isScreenShareFlag, sdpType) {
        const conn = this.connections[fromUserId];
        if (!conn?.peerConnection) { Utils.log(`handleRemoteAnswer: No active conn for ${fromUserId}.`, Utils.logLevels.WARN); return; }
        const pc = conn.peerConnection; const wasSilentContext = conn.wasInitiatedSilently || false;
        if (sdpType !== 'answer') { if (!wasSilentContext) NotificationManager.showNotification(`Protocol error: Expected answer SDP.`, 'error'); this.close(fromUserId); return; }
        if (pc.signalingState !== 'have-local-offer') {
            if (!wasSilentContext) {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) Utils.log(`Conn to ${fromUserId} already stable. Answer might be late.`, Utils.logLevels.INFO);
                else NotificationManager.showNotification(`Conn state error processing answer for ${fromUserId}. State: ${pc.signalingState}.`, 'error');
            } return;
        }
        try {
            if (typeof sdpString !== 'string') { this.close(fromUserId); return; }
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sdpString }));
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object' && pc.remoteDescription && pc.signalingState !== 'closed') {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`Error adding remote ICE from answer for ${fromUserId}: ${e}`, Utils.logLevels.WARN));
                    }
                }
            }
        } catch (error) {
            Utils.log(`Failed to set remote answer/ICE for ${fromUserId}: ${error.message} (State: ${pc.signalingState})`, Utils.logLevels.ERROR);
            if (!wasSilentContext) NotificationManager.showNotification(`Error processing answer: ${error.message}`, 'error'); this.close(fromUserId);
        }
    },

    createAnswer: async function(options = {}) { // Manual flow from UI
        const { isManual = false } = options; if (!isManual) return;
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) { NotificationManager.showNotification("Paste offer info first.", "warning"); return; }
        try {
            const offerData = JSON.parse(sdpTextEl.value);
            if (!offerData.sdp?.sdp || offerData.sdp.type !== 'offer' || !offerData.userId) { NotificationManager.showNotification("Invalid offer data format.", "error"); return; }
            if (offerData.userId === UserManager.userId) { NotificationManager.showNotification("Cannot process offer from self.", "warning"); return; }
            const fromUserId = offerData.userId; sdpTextEl.value = 'Generating answer...';
            const pc = this.initConnection(fromUserId, offerData.isVideoCall || false);
            if (!pc) { NotificationManager.showNotification("Failed to init connection for answer.", "error"); sdpTextEl.value = 'Error init conn.'; return; }
            if(this.connections[fromUserId]){ this.connections[fromUserId].wasInitiatedSilently = false; this.connections[fromUserId].isVideoCall = offerData.isVideoCall||false; this.connections[fromUserId].isAudioOnly = offerData.isAudioOnly||false; this.connections[fromUserId].isScreenShare = offerData.isScreenShare||false; }
            await this.handleRemoteOffer(fromUserId, offerData.sdp.sdp, offerData.candidates, offerData.isVideoCall, offerData.isAudioOnly, offerData.isScreenShare, 'offer', true);
            NotificationManager.showNotification("Answer generation started. Modal will update.", "info");
        } catch (e) { NotificationManager.showNotification("Error creating answer: " + e.message, "error"); Utils.log("Error in CM.createAnswer (manual): " + e, Utils.logLevels.ERROR); if(sdpTextEl) sdpTextEl.value = `Error: ${e.message}`; }
    },

    handleRemoteOffer: async function(fromUserId, sdpString, candidates, isVideoCall, isAudioOnly, isScreenShare, sdpType, isManualFlow = false) {
        if (isManualFlow && fromUserId !== UserManager.userId && !UserManager.contacts[fromUserId]) await UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
        let pc = this.connections[fromUserId]?.peerConnection;
        if (!pc || (!isManualFlow && pc.signalingState !== 'stable' && pc.signalingState !== 'new')) pc = this.initConnection(fromUserId, isVideoCall);
        if (!pc) { NotificationManager.showNotification("Failed to init connection for offer.", "error"); return; }
        if(this.connections[fromUserId]){ this.connections[fromUserId].wasInitiatedSilently = this.connections[fromUserId].wasInitiatedSilently && !isManualFlow; this.connections[fromUserId].isVideoCall = isVideoCall; this.connections[fromUserId].isAudioOnly = isAudioOnly; this.connections[fromUserId].isScreenShare = isScreenShare||false; }
        try {
            if (typeof sdpString !== 'string' || sdpType !== 'offer') { this.close(fromUserId); return; }
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdpString }));
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) { if (candidate && typeof candidate === 'object' && pc.remoteDescription && pc.signalingState !== 'closed') await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`Err adding remote ICE from offer for ${fromUserId}: ${e}`, Utils.logLevels.WARN)); }
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (!pc.localDescription) { this.close(fromUserId); return; }
            if (isManualFlow) { this.waitForIceGatheringComplete(fromUserId, () => { this.updateSdpTextInModal(fromUserId); NotificationManager.showNotification("Answer created. Copy info & send.", "info"); }); }
            else {
                const answerPayload = { type: 'ANSWER', userId: UserManager.userId, targetUserId: fromUserId, sdp: pc.localDescription.sdp, sdpType: pc.localDescription.type, isVideoCall: this.connections[fromUserId]?.isVideoCall||false, isAudioOnly: this.connections[fromUserId]?.isAudioOnly||false, isScreenShare: this.connections[fromUserId]?.isScreenShare||false };
                this.sendSignalingMessage(answerPayload, false);
            }
        } catch (error) { Utils.log(`Failed to handle remote offer from ${fromUserId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR); NotificationManager.showNotification(`Error processing offer: ${error.message}`, 'error'); this.close(fromUserId); }
    },

    handleRemoteIceCandidate: async function(fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        if (conn?.peerConnection?.remoteDescription && conn.peerConnection.signalingState !== 'closed') {
            try { if (candidate && typeof candidate === 'object' && (candidate.candidate || candidate.sdpMid || candidate.sdpMLineIndex !== undefined)) await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
            catch (error) { Utils.log(`Error adding remote ICE from ${fromUserId} (state: ${conn.peerConnection.signalingState}): ${error}`, Utils.logLevels.WARN); }
        }
    },

    handleIceCandidate: function(event, peerId) {
        if (event.candidate) {
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate.toJSON());
            const connData = this.connections[peerId];
            const isManualContext = peerId === this.MANUAL_PLACEHOLDER_PEER_ID || (connData && connData.wasInitiatedSilently === false && (document.getElementById('modalCreateOfferBtn')?.disabled || document.getElementById('modalCreateAnswerBtn')?.disabled));
            if (!isManualContext && peerId !== this.MANUAL_PLACEHOLDER_PEER_ID) {
                const sendSilently = connData?.wasInitiatedSilently || false;
                this.sendSignalingMessage({ type: 'ICE_CANDIDATE', userId: UserManager.userId, targetUserId: peerId, candidate: event.candidate.toJSON() }, sendSilently);
            }
        }
    },

    waitForIceGatheringComplete: function(peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection; if (!pc) { if (typeof callback === 'function') callback(); return; }
        if (this.iceTimers[peerId]) { clearTimeout(this.iceTimers[peerId]); delete this.iceTimers[peerId]; }
        if (pc.iceGatheringState === 'complete') { if (typeof callback === 'function') callback(); }
        else {
            this.iceGatheringStartTimes[peerId] = Date.now(); let checkInterval;
            const onDone = () => { if(checkInterval) clearInterval(checkInterval); checkInterval=null; const timerExists = !!this.iceTimers[peerId]; if (this.iceTimers[peerId]) { clearTimeout(this.iceTimers[peerId]); delete this.iceTimers[peerId]; } if (typeof callback === 'function' && timerExists) callback(); };
            this.iceTimers[peerId] = setTimeout(() => { Utils.log(`ICE gathering timeout for ${peerId}. Proceeding. State: ${pc.iceGatheringState}`, Utils.logLevels.WARN); onDone(); }, Config.timeouts.iceGathering);
            checkInterval = setInterval(() => { if (!this.connections[peerId]?.peerConnection) { if(checkInterval) clearInterval(checkInterval); if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]); delete this.iceTimers[peerId]; return; } if (this.connections[peerId].peerConnection.iceGatheringState === 'complete') onDone(); }, 200);
        }
    },

    setupDataChannel: function(channel, peerIdArg) {
        let currentContextPeerId = peerIdArg;
        if (currentContextPeerId === this.MANUAL_PLACEHOLDER_PEER_ID) channel._isManualPlaceholderChannel = true;
        if (!this.connections[currentContextPeerId]) { try { channel.close(); } catch(e){ /*ignore*/ } return; }
        if (this.connections[currentContextPeerId].dataChannel && this.connections[currentContextPeerId].dataChannel !== channel && this.connections[currentContextPeerId].dataChannel.readyState === 'open') { try { channel.close(); } catch(e) {} return; }
        if (this.connections[currentContextPeerId].dataChannel === channel && channel._listenersAttached) return;
        this.connections[currentContextPeerId].dataChannel = channel; channel._listenersAttached = true;
        const wasSilentContext = this.connections[currentContextPeerId]?.wasInitiatedSilently || false;
        channel.onopen = async () => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderChannel) { for (const actualIdInMap in this.connections) if (this.connections[actualIdInMap]?.dataChannel === channel) { finalPeerId = actualIdInMap; break; } }
            Utils.log(`Data channel with ${finalPeerId} ("${channel.label}") opened. (Silent: ${this.connections[finalPeerId]?.wasInitiatedSilently || false})`, Utils.logLevels.INFO);
            const contactName = UserManager.contacts[finalPeerId]?.name || finalPeerId.substring(0,8) + '...';
            if ((!this.connections[finalPeerId]?.wasInitiatedSilently || ChatManager.currentChatId === finalPeerId) && typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.updateChatHeaderStatus(`Connected to ${contactName}`);
            if (finalPeerId !== UserManager.userId && finalPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID && !UserManager.contacts[finalPeerId]) await UserManager.addContact(finalPeerId, `Peer ${finalPeerId.substring(0,4)}`);
            else if (channel._isManualPlaceholderChannel && finalPeerId !== UserManager.userId && finalPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID && (ChatManager.currentChatId === null || ChatManager.currentChatId === this.MANUAL_PLACEHOLDER_PEER_ID || ChatManager.currentChatId === currentContextPeerId)) ChatManager.openChat(finalPeerId, 'contact');
            EventEmitter.emit('connectionEstablished', finalPeerId);
            if (ChatManager.currentChatId === finalPeerId && this.connections[finalPeerId] && !this.connections[finalPeerId].isVideoCall && typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.setCallButtonsState(true, finalPeerId);
            if (this.reconnectAttempts[finalPeerId] !== undefined) this.reconnectAttempts[finalPeerId] = 0;
        };
        channel.onclose = () => {
            let finalPeerId = currentContextPeerId; if (channel._isManualPlaceholderChannel) for (const actualId in this.connections) if(this.connections[actualId]?.dataChannel === channel) {finalPeerId=actualId;break;}
            const pcState = this.connections[finalPeerId]?.peerConnection?.connectionState;
            if (pcState !== 'closed' && pcState !== 'failed') EventEmitter.emit('connectionDisconnected', finalPeerId);
            if (ChatManager.currentChatId === finalPeerId && typeof ChatAreaUIManager !== 'undefined') { ChatAreaUIManager.setCallButtonsState(false); if (!this.connections[finalPeerId]?.wasInitiatedSilently) ChatAreaUIManager.updateChatHeaderStatus(`Disconnected`); }
            if (this.connections[finalPeerId]?.dataChannel === channel) this.connections[finalPeerId].dataChannel = null; channel._listenersAttached = false;
        };
        channel.onerror = (error) => { let finalPeerId=currentContextPeerId; if(channel._isManualPlaceholderChannel)for(const id in this.connections)if(this.connections[id]?.dataChannel===channel){finalPeerId=id;break;} Utils.log(`DC error with ${finalPeerId} ("${channel.label}"): ${JSON.stringify(error)}`, Utils.logLevels.ERROR);};
        channel.onmessage = (event) => {
            let finalPeerId = currentContextPeerId; if (channel._isManualPlaceholderChannel) { let resolved=false; for(const actualId in this.connections)if(this.connections[actualId]?.dataChannel===channel){finalPeerId=actualId;resolved=true;break;} if(!resolved)return; }
            try {
                const rawMessage = event.data; let messageObjectToProcess;
                if (typeof rawMessage === 'string') {
                    let parsedJson; try { parsedJson = JSON.parse(rawMessage); } catch (e) { messageObjectToProcess = { type: 'text', content: rawMessage, sender: finalPeerId, timestamp: new Date().toISOString() }; }
                    if (parsedJson) { if (parsedJson.type === 'chunk-meta' || parsedJson.type === 'chunk-data') { const reassembledData = Utils.reassembleChunk(parsedJson, finalPeerId); if (reassembledData) messageObjectToProcess = reassembledData; else return; } else messageObjectToProcess = parsedJson; }
                } else return;
                if (!messageObjectToProcess) return;
                messageObjectToProcess.sender = messageObjectToProcess.sender || finalPeerId;
                if (messageObjectToProcess.type?.startsWith('video-call-')) VideoCallManager.handleMessage(messageObjectToProcess, finalPeerId);
                else if (messageObjectToProcess.groupId || messageObjectToProcess.type?.startsWith('group-')) GroupManager.handleGroupMessage(messageObjectToProcess);
                else ChatManager.addMessage(messageObjectToProcess.groupId || finalPeerId, messageObjectToProcess);
            } catch (e) { Utils.log(`Critical error in DC onmessage from ${finalPeerId}: ${e.message}. Data: ${String(event.data).substring(0,100)} Stack: ${e.stack}`, Utils.logLevels.ERROR); }
        };
    },

    handleIceConnectionStateChange: function(peerId) {
        const conn = this.connections[peerId]; if (!conn?.peerConnection) return; const pc = conn.peerConnection; const wasSilentContext = conn.wasInitiatedSilently || false;
        switch (pc.iceConnectionState) {
            case 'connected': case 'completed': if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0; break;
            case 'disconnected': EventEmitter.emit('connectionDisconnected', peerId); if (!conn.isVideoCall) this.attemptReconnect(peerId); break;
            case 'failed': if (!wasSilentContext) NotificationManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} failed.`, 'error'); EventEmitter.emit('connectionFailed', peerId); this.close(peerId, false); break;
            case 'closed': if (this.connections[peerId]) this.close(peerId, false); break;
        }
    },
    handleRtcConnectionStateChange: function(peerId) {
        const conn = this.connections[peerId]; if(!conn?.peerConnection) return; const pc = conn.peerConnection; const wasSilentContext = conn.wasInitiatedSilently || false;
        switch (pc.connectionState) {
            case "connected": if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0; if ((conn.isVideoCall || (conn.dataChannel?.readyState === 'open')) && !conn._emittedEstablished) { EventEmitter.emit('connectionEstablished', peerId); conn._emittedEstablished = true; } break;
            case "disconnected": EventEmitter.emit('connectionDisconnected', peerId); if (!conn.isVideoCall) this.attemptReconnect(peerId); conn._emittedEstablished = false; break;
            case "failed": if (!wasSilentContext) NotificationManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} failed critically.`, 'error'); EventEmitter.emit('connectionFailed', peerId); this.close(peerId, false); conn._emittedEstablished = false; break;
            case "closed": conn._emittedEstablished = false; break;
        }
    },
    attemptReconnect: function(peerId) {
        const conn = this.connections[peerId]; if (!conn || conn.isVideoCall || this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') return;
        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        if (this.reconnectAttempts[peerId] <= Config.reconnect.maxAttempts) {
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId] -1);
            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);
            this.connectionTimeouts[peerId] = setTimeout(async () => {
                delete this.connectionTimeouts[peerId]; const currentConn = this.connections[peerId];
                if (currentConn && !this.isConnectedTo(peerId) && currentConn.peerConnection && currentConn.peerConnection.connectionState !== 'connecting' && currentConn.peerConnection.signalingState !== 'have-local-offer' && currentConn.peerConnection.signalingState !== 'have-remote-offer' ) {
                    if (['failed','closed','disconnected'].includes(currentConn.peerConnection.connectionState)) this.close(peerId,false);
                    await this.createOffer(peerId, {isSilent: true});
                } else if (this.isConnectedTo(peerId)) if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
            }, delay);
        } else this.close(peerId, false);
    },

    sendTo: function(peerId, messageObject) {
        const conn = this.connections[peerId];
        if (conn?.dataChannel?.readyState === 'open') {
            try {
                messageObject.sender = messageObject.sender || UserManager.userId; messageObject.timestamp = messageObject.timestamp || new Date().toISOString();
                const messageString = JSON.stringify(messageObject);
                if (messageString.length > Config.chunkSize) Utils.sendInChunks(messageString, (chunk) => conn.dataChannel.send(chunk), peerId, (messageObject.type === 'file' || messageObject.type === 'audio') ? (messageObject.fileId || messageObject.fileName || `blob-${Date.now()}`) : undefined );
                else conn.dataChannel.send(messageString); return true;
            } catch (error) { Utils.log(`Error sending to ${peerId} via DC: ${error}`, Utils.logLevels.ERROR); return false; }
        } else { Utils.log(`Cannot send to ${peerId}: DC not open/exists. DC: ${conn?.dataChannel?.readyState}, PC: ${conn?.peerConnection?.connectionState}`, Utils.logLevels.WARN); return false; }
    },

    isConnectedTo: function(peerId) {
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) return true;
        const conn = this.connections[peerId]; if (!conn?.peerConnection) return false;
        const pcOverallState = conn.peerConnection.connectionState;
        if (pcOverallState === 'connected') { if (conn.isVideoCall || (conn.dataChannel?.readyState === 'open')) return true; }
        return false;
    },

    close: function(peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn) {
            if (this.connectionTimeouts[peerId]) { clearTimeout(this.connectionTimeouts[peerId]); delete this.connectionTimeouts[peerId]; }
            if (this.iceTimers[peerId]) { clearTimeout(this.iceTimers[peerId]); delete this.iceTimers[peerId]; }
            if (conn.dataChannel) { try { conn.dataChannel.onopen=null; conn.dataChannel.onmessage=null; conn.dataChannel.onerror=null; const co=conn.dataChannel.onclose; conn.dataChannel.onclose=()=>{if(typeof co==='function')co();}; if(conn.dataChannel.readyState!=='closed')conn.dataChannel.close(); } catch (e) {} }
            if (conn.peerConnection) { try { conn.peerConnection.onicecandidate=null; conn.peerConnection.onicegatheringstatechange=null; conn.peerConnection.oniceconnectionstatechange=null; conn.peerConnection.onconnectionstatechange=null; conn.peerConnection.ondatachannel=null; conn.peerConnection.ontrack=null; if(conn.peerConnection.signalingState!=='closed')conn.peerConnection.close(); } catch (e) {} }
            delete this.connections[peerId]; delete this.iceCandidates[peerId]; delete this.reconnectAttempts[peerId]; delete this.iceGatheringStartTimes[peerId];
            if (ChatManager.currentChatId === peerId && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.updateChatHeaderStatus(`Disconnected from ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)}...`);
                ChatAreaUIManager.setCallButtonsState(false);
            }
            EventEmitter.emit('connectionClosed', peerId);
        }
    },

    resetAllConnections: function() {
        ModalManager.showConfirmationModal( "Are you sure you want to reset all connections?", () => {
            Object.keys(this.connections).forEach(peerId => this.close(peerId, false));
            this.connections = {}; this.iceCandidates = {}; this.reconnectAttempts = {}; this.iceGatheringStartTimes = {};
            Object.keys(this.connectionTimeouts).forEach(id=>clearTimeout(this.connectionTimeouts[id]));this.connectionTimeouts={};
            Object.keys(this.iceTimers).forEach(id=>clearTimeout(this.iceTimers[id]));this.iceTimers={};
            if (this.websocket?.readyState === WebSocket.OPEN) { this.websocket.onclose = null; this.websocket.close(); }
            this.websocket = null; this.isWebSocketConnected = false; EventEmitter.emit('websocketStatusUpdate');
            setTimeout(() => this.initialize(), 1000);
            NotificationManager.showNotification("All connections reset.", "info");
            if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith("group_") && !UserManager.isSpecialContact(ChatManager.currentChatId) && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.updateChatHeaderStatus("Disconnected - Connections Reset"); ChatAreaUIManager.setCallButtonsState(false);
            }
            ChatManager.renderChatList();
        });
    },

    updateSdpTextInModal: function(peerIdToGetSdpFrom) {
        const sdpTextEl = document.getElementById('modalSdpText'); if (!sdpTextEl) return;
        const conn = this.connections[peerIdToGetSdpFrom]; const pc = conn?.peerConnection;
        if (pc?.localDescription) {
            const sdpType = pc.localDescription.type;
            const connectionInfo = { sdp: { type: sdpType, sdp: pc.localDescription.sdp }, candidates: this.iceCandidates[peerIdToGetSdpFrom] || [], userId: UserManager.userId, isVideoCall: conn?.isVideoCall||false, isAudioOnly: conn?.isAudioOnly||false, isScreenShare: conn?.isScreenShare||false };
            sdpTextEl.value = JSON.stringify(connectionInfo, null, 2);
        } else sdpTextEl.value = `Generating ${pc?.localDescription ? pc.localDescription.type : 'info'} for ${peerIdToGetSdpFrom}... (ICE: ${pc?.iceGatheringState})`;
        if (typeof SettingsUIManager !== 'undefined') SettingsUIManager.copySdpTextFromModal = () => { // Temporary fix for copy button in modal
            if (sdpTextEl.value) navigator.clipboard.writeText(sdpTextEl.value).then(()=>NotificationManager.showNotification('Conn Info copied!', 'success')).catch(()=>NotificationManager.showNotification('Failed to copy.', 'error'));
            else NotificationManager.showNotification('No info to copy.', 'warning');
        };
    },
    handleIceGatheringStateChange: function(peerId) { // Unchanged
        const pc = this.connections[peerId]?.peerConnection; if (!pc) return;
        if (pc.iceGatheringState === 'gathering' && !this.iceGatheringStartTimes[peerId]) this.iceGatheringStartTimes[peerId] = Date.now();
        else if (pc.iceGatheringState === 'complete') { Utils.log(`ICE gathering complete for ${peerId} in ${(Date.now()-(this.iceGatheringStartTimes[peerId]||Date.now()))/1000}s. Candidates: ${this.iceCandidates[peerId]?.length||0}`, Utils.logLevels.DEBUG); delete this.iceGatheringStartTimes[peerId]; }
    },
};