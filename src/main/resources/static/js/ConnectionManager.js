
const ConnectionManager = {
    connections: {},
    iceCandidates: {},
    connectionTimeouts: {},
    reconnectAttempts: {},
    iceTimers: {},
    iceGatheringStartTimes: {},
    websocket: null,
    isWebSocketConnected: false,
    signalingServerUrl: Config.server.signalingServerUrl, // Ensure this matches your server
    pendingSentChunks: {}, // For Utils.sendInChunks
    pendingReceivedChunks: {}, // For Utils.reassembleChunk

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
                    // Do not reject here, let onclose handle reconnect attempts
                };
            } catch (error) {
                Utils.log('Failed to create WebSocket connection: ' + error, Utils.logLevels.ERROR);
                UIManager.updateConnectionStatusIndicator('Failed to connect to signaling server.');
                const oldStatus = this.isWebSocketConnected;
                this.isWebSocketConnected = false;
                if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                reject(error); // Reject if initial WebSocket object creation fails
            }
        });
    },

    registerUser: function() {
        if (!UserManager.userId) {
            Utils.log('User ID not set, cannot register.', Utils.logLevels.ERROR);
            return;
        }
        const message = { type: 'REGISTER', userId: UserManager.userId };
        this.sendSignalingMessage(message, false); // false for not silent
    },

    sendSignalingMessage: function(message, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const messageString = JSON.stringify(message);
            this.websocket.send(messageString);
            Utils.log(`Sent WS: ${message.type} to ${message.targetUserId || 'server'} (from ${message.userId || 'N/A'}) ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        } else {
            Utils.log('WebSocket not connected, cannot send signaling message.', Utils.logLevels.ERROR);
            if (!isInternalSilentFlag) { // Only show notification if not an internal silent operation
                UIManager.showNotification('Not connected to signaling server. Message not sent.', 'error');
            }
        }
    },

    handleSignalingMessage: function(message) {
        Utils.log(`Received WS: ${message.type} from ${message.fromUserId || 'server'} ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        switch (message.type) {
            case 'SUCCESS': // User registration success
                UIManager.updateConnectionStatusIndicator(`User registration successful: ${UserManager.userId.substring(0,8)}...`);
                this.autoConnectToAllContacts();
                break;
            case 'ERROR':
                if (!message.message.includes('不在线')) { // Don't show "not online" as a blocking error notification
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

                if (!wasSilentAttempt) { // Only show notification if it wasn't a silent background attempt
                    UIManager.showNotification(`User ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0,8) + '...'} not found or offline.`, 'warning');
                }
                Utils.log(`User ${message.targetUserId} not found. (Silent Attempt: ${wasSilentAttempt})`, Utils.logLevels.WARN);

                if(ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt) {
                    UIManager.updateChatHeaderStatus(`User not found or offline`);
                }
                if (this.connections[message.targetUserId]) {
                    this.close(message.targetUserId, false); // false for notifyPeer
                }
                break;
            default:
                Utils.log('Unknown signaling message type: ' + message.type, Utils.logLevels.WARN);
        }
    },

    initConnection: function(peerId, isVideoCall = false) {
        Utils.log(`Attempting to initialize connection with ${peerId}. Current connection object: ${this.connections[peerId] ? 'exists' : 'null'}`, Utils.logLevels.DEBUG);

        if (this.connections[peerId]) {
            Utils.log(`Explicitly closing and deleting existing RTCPeerConnection for ${peerId} before new init.`, Utils.logLevels.WARN);
            this.close(peerId, false); // false: do not notify peer about this internal reset
        }
        delete this.connections[peerId];
        delete this.iceCandidates[peerId];
        delete this.reconnectAttempts[peerId];
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
        delete this.iceTimers[peerId];
        delete this.iceGatheringStartTimes[peerId];


        Utils.log(`Initializing new RTCPeerConnection for ${peerId}. Video call: ${isVideoCall}`, Utils.logLevels.INFO);

        try {
            const rtcConfig = Config.peerConnectionConfig;
            Utils.log(`Initializing RTCPeerConnection for ${peerId} with config: ${JSON.stringify(rtcConfig)}`, Utils.logLevels.DEBUG);
            const pc = new RTCPeerConnection(rtcConfig);
            this.connections[peerId] = {
                peerConnection: pc,
                dataChannel: null,
                isVideoCall: isVideoCall,
                isAudioOnly: false, // Will be set during call initiation
                isScreenShare: false, // Will be set during call initiation
                wasInitiatedSilently: false // Default to not silent
            };
            this.iceCandidates[peerId] = [];
            this.reconnectAttempts[peerId] = 0;

            pc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            pc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            pc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            pc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);

            if (isVideoCall) {
                // ontrack will be handled by VideoCallManager when it sets up the call
            } else {
                // For non-video calls, setup data channel immediately if we create one, or wait for ondatachannel
                pc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
            }
            return pc;
        } catch (error) {
            Utils.log(`CRITICAL: Failed to initialize RTCPeerConnection for ${peerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Connection setup error for ${peerId}: ${error.message}`, 'error');
            delete this.connections[peerId]; // Ensure cleanup if init fails
            return null;
        }
    },

    createOffer: async function(targetPeerId = null, options = {}) {
        const { isVideoCall = false, isAudioOnly = false, isSilent = false } = options;
        let promptedForId = false;

        if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
            const contactName = UserManager.contacts[targetPeerId]?.name || "this AI contact";
            if (!isSilent) UIManager.showNotification(`Cannot establish a P2P connection with ${contactName}. It is an AI contact.`, "info");
            else Utils.log(`Attempted to create silent P2P offer to AI contact ${contactName}. Skipped.`, Utils.logLevels.DEBUG);
            return;
        }


        try {
            // Determine targetPeerId if not provided
            if (!targetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) {
                targetPeerId = ChatManager.currentChatId;
            }

            if (!targetPeerId && !isSilent) { // If still no target and not silent, prompt user
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

            // Prevent connecting to self
            if (targetPeerId === UserManager.userId) {
                if (!isSilent) UIManager.showNotification("You cannot create an offer to connect to yourself.", "warning");
                else Utils.log("Attempted to create silent offer to self. Skipped.", Utils.logLevels.DEBUG);
                if (promptedForId && document.getElementById('modalSdpText')) {
                    document.getElementById('modalSdpText').value = "Cannot connect to self. Enter a different Peer ID.";
                }
                return;
            }

            if (!UserManager.userId) { // Should not happen if app initialized correctly
                Utils.log("UserManager.userId is null, cannot create offer.", Utils.logLevels.ERROR);
                if (!isSilent) UIManager.showNotification("Your user ID is not available. Cannot create offer.", "error");
                return;
            }

            // Ensure WebSocket connection
            if (!this.isWebSocketConnected) {
                try {
                    if (!isSilent) UIManager.showNotification("Signaling server not connected. Attempting to connect...", "info");
                    await this.connectWebSocket(); // Ensure connected before proceeding
                } catch (e) {
                    if (!isSilent) UIManager.showNotification("Signaling server connection failed. Cannot create offer.", "error");
                    return;
                }
            }

            Utils.log(`Creating offer for target: ${targetPeerId}, from: ${UserManager.userId}, isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, silent: ${isSilent}`, Utils.logLevels.DEBUG);

            const pc = this.initConnection(targetPeerId, isVideoCall);
            if (!pc) { // initConnection failed
                if (!isSilent) UIManager.showNotification("Failed to initialize connection for offer.", "error");
                return;
            }
            // Store call type info and silent flag in the connection object
            this.connections[targetPeerId].isVideoCall = isVideoCall;
            this.connections[targetPeerId].isAudioOnly = isAudioOnly;
            this.connections[targetPeerId].isScreenShare = options.isScreenShare || false;
            this.connections[targetPeerId].wasInitiatedSilently = isSilent;


            if (!isVideoCall) { // For non-video calls (chat data channels)
                const dataChannel = pc.createDataChannel('chatChannel', { reliable: true });
                this.setupDataChannel(dataChannel, targetPeerId);
            } else { // For video/audio calls
                // VideoCallManager will add tracks when it starts the call
                if (VideoCallManager.localStream) { // Ensure local stream is ready
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                } else {
                    // This case means VideoCallManager didn't prepare its stream yet.
                    // The call flow should ensure local stream is acquired before ConnectionManager creates offer for a video call.
                    Utils.log("Local stream not available for video call offer. VideoCallManager should handle this.", Utils.logLevels.WARN);
                }
            }

            try {
                const offerOptions = { // Standard offer options
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: isVideoCall && !isAudioOnly // Only offer to receive video if it's a video call
                };
                const offer = await pc.createOffer(offerOptions);
                await pc.setLocalDescription(offer); // Set local description

                Utils.log(`Offer created for ${targetPeerId}. State: ${pc.signalingState}. Sending SDP immediately. ICE will trickle. (Silent: ${isSilent})`, Utils.logLevels.INFO);
                // Update UI for connecting status if not silent
                if (!isSilent && ChatManager.currentChatId === targetPeerId) {
                    const contactName = UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,8) + '...';
                    UIManager.updateChatHeaderStatus(`Connecting to ${contactName}...`);
                }

                // Send the offer via signaling server
                if (!pc.localDescription) { // Should not happen
                    Utils.log(`Cannot send offer for ${targetPeerId}: localDescription is null immediately after set.`, Utils.logLevels.ERROR);
                    if (!isSilent) UIManager.showNotification("Error: Could not finalize local connection details early.", "error");
                    this.close(targetPeerId); return;
                }
                const offerMessagePayload = {
                    type: 'OFFER',
                    userId: UserManager.userId,
                    targetUserId: targetPeerId,
                    sdp: pc.localDescription.sdp, // SDP string
                    sdpType: pc.localDescription.type, // 'offer'
                    isVideoCall: isVideoCall,
                    isAudioOnly: isAudioOnly,
                    isScreenShare: options.isScreenShare || false,
                    // candidates will be sent via trickle ICE
                };
                this.sendSignalingMessage(offerMessagePayload, isSilent); // Send offer, respecting silent flag for notifications
                Utils.log(`Offer SDP sent to ${targetPeerId} via signaling. (Silent: ${isSilent}) ICE candidates will follow.`, Utils.logLevels.INFO);

                // For manual exchange via modal (if prompted)
                this.waitForIceGatheringComplete(targetPeerId, () => {
                    Utils.log(`ICE gathering for ${targetPeerId} considered complete/timed out (non-blocking). Total candidates found so far: ${this.iceCandidates[targetPeerId]?.length || 0}`, Utils.logLevels.DEBUG);
                    if (promptedForId && document.getElementById('modalSdpText')) {
                        this.updateSdpTextInModal(targetPeerId);
                    }
                });


            } catch (error) {
                Utils.log(`WebRTC error during offer creation for ${targetPeerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
                if (!isSilent) UIManager.showNotification(`Connection offer error: ${error.message}`, 'error');
                this.close(targetPeerId); // Clean up failed connection attempt
            }
        } catch (e) { // Catch unexpected errors in the outer try-catch
            Utils.log(`UNEXPECTED ERROR in createOffer for ${targetPeerId || 'unknown target'}: ${e.message}\nStack: ${e.stack}`, Utils.logLevels.ERROR);
            if (!isSilent) UIManager.showNotification("An unexpected error occurred while trying to connect.", "error");
            if (targetPeerId) { // If targetPeerId was determined, try to close
                this.close(targetPeerId);
            }
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
        let offerDelay = 0; // Stagger connection attempts

        for (const contactId of contactIds) {
            // Skip self, special AI contacts, or already connected/connecting peers
            if (contactId === UserManager.userId || (UserManager.isSpecialContact(contactId) && UserManager.contacts[contactId]?.isAI)) continue;

            if (this.isConnectedTo(contactId)) {
                Utils.log(`Already connected to ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }
            const existingConn = this.connections[contactId];
            if (existingConn && (
                existingConn.peerConnection?.connectionState === 'connecting' ||
                existingConn.peerConnection?.connectionState === 'new' ||
                existingConn.dataChannel?.readyState === 'connecting'
            )) {
                Utils.log(`Connection attempt already in progress for ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }

            // Closure to create offer with delay
            ((idToConnect, delay) => {
                setTimeout(async () => {
                    Utils.log(`Auto-connecting to contact (staggered): ${idToConnect}`, Utils.logLevels.DEBUG);
                    try {
                        // Auto-connect is for chat data channels, not video. Always silent.
                        await this.createOffer(idToConnect, {isVideoCall: false, isAudioOnly: false, isSilent: true});
                    } catch (error) {
                        Utils.log(`Error during auto-connecting initiation for ${idToConnect}: ${error.message}`, Utils.logLevels.WARN);
                    }
                }, delay);
            })(contactId, offerDelay);

            offerDelay += 50; // Increment delay for next contact
        }
        Utils.log("Finished dispatching auto-connection attempts to contacts.", Utils.logLevels.INFO);
    },

    handleAnswer: async function() { // For manual SDP exchange via modal
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            UIManager.showNotification("Paste answer info into the text area first.", "warning");
            return;
        }
        try {
            const answerDataFromModal = JSON.parse(sdpTextEl.value);
            sdpTextEl.value = ''; // Clear after parsing

            // Validate answer data structure
            if (!answerDataFromModal.sdp || !answerDataFromModal.sdp.sdp ||
                answerDataFromModal.sdp.type !== 'answer' || // Must be an answer
                !answerDataFromModal.userId) {
                UIManager.showNotification("Invalid answer data format in modal. Expected { sdp: {type: 'answer', sdp}, candidates, userId }.", "error");
                Utils.log(`Invalid answer data from modal: ${JSON.stringify(answerDataFromModal)}`, Utils.logLevels.ERROR);
                return;
            }
            if (answerDataFromModal.userId === UserManager.userId) { // Cannot answer self
                UIManager.showNotification("Cannot process an answer from yourself in this way.", "warning");
                return;
            }

            const fromUserId = answerDataFromModal.userId;
            const conn = this.connections[fromUserId];

            if (!conn || !conn.peerConnection) {
                UIManager.showNotification(`Error: No active offer found for peer ${fromUserId}. Please create an offer first.`, "error");
                Utils.log(`handleAnswer (manual): No peerConnection object for ${fromUserId} found.`, Utils.logLevels.ERROR);
                return;
            }

            const pc = conn.peerConnection;
            Utils.log(`handleAnswer (manual): Current signalingState for ${fromUserId} before setting remote answer: ${pc.signalingState}`, Utils.logLevels.DEBUG);

            if (pc.signalingState !== 'have-local-offer') {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) {
                    UIManager.showNotification(`Already connected to ${fromUserId}. No action needed for manual answer.`, "info");
                } else {
                    UIManager.showNotification(`Error: Connection for ${fromUserId} is in an unexpected state (${pc.signalingState}). Expected 'have-local-offer'.`, "error");
                }
                UIManager.toggleModal('mainMenuModal', false); // Close modal
                return;
            }
            // Call the generalized handleRemoteAnswer
            await this.handleRemoteAnswer(
                fromUserId,
                answerDataFromModal.sdp.sdp,
                answerDataFromModal.candidates,
                conn.isVideoCall, // Use existing call type info from connection object
                conn.isAudioOnly,
                conn.isScreenShare,
                'answer' // sdpType
            );
            UIManager.toggleModal('mainMenuModal', false); // Close modal on success

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
            // Do not close connection here, might be a late answer for an already established conn
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

            // Add ICE candidates that might have been bundled with the answer
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object') {
                        // Check if pc.remoteDescription is set and pc is not closed before adding candidate
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
            this.close(fromUserId); // Close connection on error
        }
    },

    createAnswer: async function() { // For manual SDP exchange via modal
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            UIManager.showNotification("Paste offer info into the text area first.", "warning");
            return;
        }
        let offerDataFromModal;
        try {
            offerDataFromModal = JSON.parse(sdpTextEl.value);

            // Validate offer data structure
            if (!offerDataFromModal.sdp || typeof offerDataFromModal.sdp !== 'object' ||
                offerDataFromModal.sdp.type !== 'offer' || // Must be an offer
                !offerDataFromModal.sdp.sdp || !offerDataFromModal.userId) {
                UIManager.showNotification("Invalid offer data format in modal. Expected { sdp: {type: 'offer', ...}, ... }.", "error");
                Utils.log(`Pasted offer data for createAnswer was invalid: ${JSON.stringify(offerDataFromModal)}`, Utils.logLevels.ERROR);
                return;
            }
            if (offerDataFromModal.userId === UserManager.userId) { // Cannot answer self
                UIManager.showNotification("Cannot process an offer from yourself in this way.", "warning");
                return;
            }

            const fromUserId = offerDataFromModal.userId;
            sdpTextEl.value = 'Generating answer...'; // Update modal text

            // Initialize connection (or get existing if re-answering, though initConnection handles reset)
            const pc = this.initConnection(fromUserId, offerDataFromModal.isVideoCall || false);
            if (!pc) {
                UIManager.showNotification("Failed to initialize connection to create answer.", "error");
                sdpTextEl.value = 'Error initializing connection.';
                return;
            }

            // Update connection object with call type info from offer
            if(this.connections[fromUserId]){
                this.connections[fromUserId].wasInitiatedSilently = false; // Manual flow is not silent
                this.connections[fromUserId].isVideoCall = offerDataFromModal.isVideoCall || false;
                this.connections[fromUserId].isAudioOnly = offerDataFromModal.isAudioOnly || false;
                this.connections[fromUserId].isScreenShare = offerDataFromModal.isScreenShare || false;
            }


            // Call the generalized handleRemoteOffer
            await this.handleRemoteOffer(
                fromUserId,
                offerDataFromModal.sdp.sdp,
                offerDataFromModal.candidates,
                offerDataFromModal.isVideoCall,
                offerDataFromModal.isAudioOnly,
                offerDataFromModal.isScreenShare,
                'offer', // sdpType
                true // isManualCreateAnswerFlow = true
            );
            // Notification that generation started, modal will update via waitForIceGatheringComplete
            UIManager.showNotification("Answer generation started. Modal will update with info to copy.", "info");

        } catch (e) {
            UIManager.showNotification("Error creating answer: " + e.message, "error");
            Utils.log("Error in ConnectionManager.createAnswer (manual): " + e, Utils.logLevels.ERROR);
            if (sdpTextEl) sdpTextEl.value = `Error: ${e.message}`; // Show error in modal
        }
    },

    handleRemoteOffer: async function(fromUserId, sdpString, candidates, isVideoCall, isAudioOnly, isScreenShare, sdpTypeFromServer, isManualCreateAnswerFlow = false) {
        Utils.log(`Handling remote offer from ${fromUserId}. isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, isScreenShare: ${isScreenShare}. ManualFlow: ${isManualCreateAnswerFlow}`, Utils.logLevels.INFO);

        // Add contact if not already known (for non-group, non-video calls initially)
        if (!UserManager.contacts[fromUserId] && !GroupManager.groups[fromUserId]) { // Check if not group
            // Only add if not a video call to avoid premature contact add before call confirmation
            if(!isVideoCall && !fromUserId.startsWith('group_')){
                UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
            }
        }


        let pc = this.connections[fromUserId]?.peerConnection;

        // If not manual flow and PC is not stable, re-initialize.
        // For manual flow, pc should have been initialized by createAnswer.
        if (!isManualCreateAnswerFlow && (!pc || pc.signalingState !== 'stable')) {
            if (pc && pc.signalingState !== 'new') { // If exists but not new (e.g. have-local-offer, closed, failed)
                Utils.log(`handleRemoteOffer (signaling): PC for ${fromUserId} is in state ${pc.signalingState}. Re-initializing.`, Utils.logLevels.DEBUG);
                pc = this.initConnection(fromUserId, isVideoCall); // Re-init for a fresh start
            } else if (!pc) { // No PC exists yet
                pc = this.initConnection(fromUserId, isVideoCall);
            }
            if (!pc) { // initConnection failed
                UIManager.showNotification("Failed to initialize connection to handle offer.", "error");
                return;
            }
        } else if (isManualCreateAnswerFlow && !pc) { // This shouldn't happen if createAnswer called initConnection
            Utils.log(`handleRemoteOffer (manual flow): pc is unexpectedly null for ${fromUserId}. Aborting.`, Utils.logLevels.ERROR);
            UIManager.showNotification("Connection object missing, cannot handle offer.", "error");
            return;
        }


        // Update connection object details
        if(this.connections[fromUserId]){
            // If it's a manual flow, it's not silent. Otherwise, preserve existing silent status.
            this.connections[fromUserId].wasInitiatedSilently = this.connections[fromUserId].wasInitiatedSilently && !isManualCreateAnswerFlow;
            this.connections[fromUserId].isVideoCall = isVideoCall;
            this.connections[fromUserId].isAudioOnly = isAudioOnly;
            this.connections[fromUserId].isScreenShare = isScreenShare || false; // Default to false if undefined
        }


        try {
            if (typeof sdpString !== 'string' || sdpTypeFromServer !== 'offer') {
                Utils.log(`Invalid SDP string or sdpType (expected 'offer') received in offer from ${fromUserId}. SDP: ${sdpString}, Type: ${sdpTypeFromServer}`, Utils.logLevels.ERROR);
                this.close(fromUserId); return;
            }
            const remoteSdpObject = { type: 'offer', sdp: sdpString };
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdpObject));
            Utils.log(`Remote description (offer) set for ${fromUserId}. New state: ${pc.signalingState}.`, Utils.logLevels.INFO);

            // Add ICE candidates bundled with offer
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

            // Setup DataChannel if it's a non-video call and we are responder
            // (ondatachannel event will fire if remote created it)
            if (isVideoCall && VideoCallManager.isCallActive && VideoCallManager.currentPeerId === fromUserId) {
                // If it's a video call, VideoCallManager handles tracks.
            } else if (!isVideoCall && !this.connections[fromUserId].dataChannel) {
                // For chat, if we are responding to an offer, remote should have created the data channel.
                // We wait for 'ondatachannel' event.
                Utils.log(`Waiting for remote to create data channel for ${fromUserId}.`, Utils.logLevels.DEBUG);
            }

            // Create and set local answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            Utils.log(`Local description (answer) created and set for ${fromUserId}. New state: ${pc.signalingState}. Sending SDP. ICE will trickle...`, Utils.logLevels.INFO);


            if (!pc.localDescription) { // Should not happen
                Utils.log(`Cannot send/prepare answer for ${fromUserId}: localDescription is null.`, Utils.logLevels.ERROR);
                this.close(fromUserId);
                return;
            }
            const answerMessagePayload = {
                type: 'ANSWER',
                userId: UserManager.userId,
                targetUserId: fromUserId,
                sdp: pc.localDescription.sdp, // SDP string
                sdpType: pc.localDescription.type, // 'answer'
                isVideoCall: this.connections[fromUserId].isVideoCall, // Reflect current state of connection
                isAudioOnly: this.connections[fromUserId].isAudioOnly,
                isScreenShare: this.connections[fromUserId].isScreenShare,
                // candidates will be sent via trickle ICE
            };

            if (isManualCreateAnswerFlow) {
                // For manual flow, wait for ICE gathering and then update modal.
                this.waitForIceGatheringComplete(fromUserId, () => {
                    Utils.log(`ICE gathering for manual answer to ${fromUserId} considered complete/timed out. Updating modal.`, Utils.logLevels.DEBUG);
                    this.updateSdpTextInModal(fromUserId); // Update modal with answer SDP and candidates
                });
            } else {
                // For automatic flow, send answer via signaling.
                this.sendSignalingMessage(answerMessagePayload, false); // false: not silent for regular offer handling
                Utils.log(`Answer SDP sent to ${fromUserId} via signaling. ICE candidates will follow.`, Utils.logLevels.INFO);
                this.waitForIceGatheringComplete(fromUserId, () => { // Non-blocking wait for ICE
                    Utils.log(`ICE gathering for answer to ${fromUserId} considered complete/timed out (non-blocking).`, Utils.logLevels.DEBUG);
                    // No specific action needed here for automatic flow, ICE trickles.
                });
            }

        } catch (error) {
            Utils.log(`Failed to handle remote offer from ${fromUserId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Error processing connection offer: ${error.message}`, 'error');
            this.close(fromUserId); // Clean up on error
        }
    },

    handleRemoteIceCandidate: async function(fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        // Ensure connection, peerConnection, remoteDescription exist and connection is not closed
        if (conn && conn.peerConnection && conn.peerConnection.remoteDescription && conn.peerConnection.signalingState !== 'closed') {
            try {
                if (candidate && typeof candidate === 'object') { // Basic validation of candidate
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    Utils.log(`Added remote ICE candidate from ${fromUserId}.`, Utils.logLevels.DEBUG);
                } else {
                    Utils.log(`Skipping invalid remote ICE candidate from ${fromUserId}: ${JSON.stringify(candidate)}`, Utils.logLevels.WARN);
                }
            } catch (error) {
                // Log error, but don't necessarily close connection. ICE can be finicky.
                Utils.log(`Error adding remote ICE candidate from ${fromUserId} (state: ${conn.peerConnection.signalingState}): ${error}`, Utils.logLevels.WARN);
            }
        } else {
            Utils.log(`Received ICE candidate from ${fromUserId}, but no valid connection, remoteDescription, or connection closed. State: ${conn?.peerConnection?.signalingState}. Candidate might be queued or dropped.`, Utils.logLevels.WARN);
            // Potentially queue candidate if remoteDescription is not yet set (more advanced)
        }
    },

    handleIceCandidate: function(event, peerId) {
        if (event.candidate) { // A new ICE candidate has been found
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate.toJSON()); // Store for potential manual exchange

            const connData = this.connections[peerId];
            // Determine if this candidate should be sent silently (based on original offer/answer context)
            const sendSilently = connData?.wasInitiatedSilently || false;

            const candidateMessagePayload = {
                type: 'ICE_CANDIDATE',
                userId: UserManager.userId,
                targetUserId: peerId,
                candidate: event.candidate.toJSON()
            };
            this.sendSignalingMessage(candidateMessagePayload, sendSilently); // Send to peer via signaling
        } else {
            // ICE gathering is complete for this PeerConnection (event.candidate is null)
            Utils.log(`ICE gathering complete for ${peerId} (event.candidate is null).`, Utils.logLevels.DEBUG);
            // The waitForIceGatheringComplete function handles timeout/completion callbacks.
        }
    },

    waitForIceGatheringComplete: function(peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) {
            Utils.log(`waitForIceGatheringComplete: No PeerConnection for ${peerId}.`, Utils.logLevels.WARN);
            if (typeof callback === 'function') callback();
            return;
        }

        // Clear any existing timer for this peerId to prevent multiple callbacks
        if (this.iceTimers[peerId]) {
            clearTimeout(this.iceTimers[peerId]);
            delete this.iceTimers[peerId];
        }

        if (pc.iceGatheringState === 'complete') {
            Utils.log(`ICE gathering already complete for ${peerId}. Calling callback immediately.`, Utils.logLevels.DEBUG);
            if (typeof callback === 'function') callback();
        } else {
            Utils.log(`Waiting for ICE gathering to complete for ${peerId}... Current state: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);
            this.iceGatheringStartTimes[peerId] = Date.now(); // Record start time for timeout calculation

            const iceTimeout = Config.timeouts.iceGathering;
            let checkInterval; // For periodically checking state

            const onDone = () => { // Cleanup function
                if(checkInterval) clearInterval(checkInterval);
                checkInterval = null;
                if (this.iceTimers[peerId]) { // Ensure timer exists before clearing (it should)
                    clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                    if (typeof callback === 'function') callback(); // Execute the callback
                }
            };

            // Set a timeout for ICE gathering
            this.iceTimers[peerId] = setTimeout(() => {
                Utils.log(`ICE gathering timeout for ${peerId} after ${iceTimeout}ms. Proceeding. State: ${pc.iceGatheringState}`, Utils.logLevels.WARN);
                onDone();
            }, iceTimeout);

            // Also, poll for completion state, as onicecandidate with null candidate is the primary signal.
            // This interval is a fallback / complementary check.
            checkInterval = setInterval(() => {
                if (!this.connections[peerId] || !this.connections[peerId].peerConnection) { // Connection disappeared
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
            }, 200); // Check every 200ms
        }
    },

    setupDataChannel: function(channel, peerId) {
        if (!this.connections[peerId]) { // Should not happen if initConnection was successful
            Utils.log(`Connection object for ${peerId} not found when setting up data channel. Channel name: ${channel.label}`, Utils.logLevels.ERROR);
            try { channel.close(); } catch(e){ /* ignore close error if already closed */ }
            return;
        }
        // Prevent overwriting an existing open data channel
        if (this.connections[peerId].dataChannel && this.connections[peerId].dataChannel.readyState === 'open') {
            Utils.log(`Data channel already exists and is open for ${peerId}. Ignoring new channel: ${channel.label}`, Utils.logLevels.WARN);
            // If the new channel is different, one might need to decide which one to use or close the old one.
            // For now, just keep the existing open one.
            return;
        }


        this.connections[peerId].dataChannel = channel;
        const wasSilentContext = this.connections[peerId].wasInitiatedSilently || false;
        Utils.log(`Setting up data channel "${channel.label}" for ${peerId}. Silent Context: ${wasSilentContext}`, Utils.logLevels.INFO);


        channel.onopen = () => {
            Utils.log(`Data channel with ${peerId} ("${channel.label}") opened. (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);
            const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
            // Update UI only if not a silent connection OR if it's the currently active chat
            if ((!wasSilentContext || ChatManager.currentChatId === peerId)) {
                UIManager.updateChatHeaderStatus(`Connected to ${contactName}`);
            }
            EventEmitter.emit('connectionEstablished', peerId);
            // Enable call buttons if current chat is this peer and it's not a video call context already
            if (ChatManager.currentChatId === peerId && !this.connections[peerId].isVideoCall) {
                UIManager.setCallButtonsState(true, peerId);
            }
            this.reconnectAttempts[peerId] = 0; // Reset reconnect attempts on successful open
        };

        channel.onclose = () => {
            Utils.log(`Data channel with ${peerId} ("${channel.label}") closed. (Was Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);
            const pcState = this.connections[peerId]?.peerConnection?.connectionState;
            // Emit disconnected only if PC isn't already definitively closed or failed
            if (pcState !== 'closed' && pcState !== 'failed') {
                EventEmitter.emit('connectionDisconnected', peerId);
            }
            if (ChatManager.currentChatId === peerId) { // Update UI for current chat
                UIManager.setCallButtonsState(false);
            }
            if (this.connections[peerId]) { // Nullify the dataChannel reference
                this.connections[peerId].dataChannel = null;
            }
            // Attempt reconnect if appropriate (e.g., not user-initiated close)
            // Reconnect logic is primarily tied to iceConnectionStateChange and rtcConnectionStateChange.
            // A data channel close might trigger those if it's due to underlying transport failure.
        };

        channel.onerror = (error) => {
            Utils.log(`Data channel error with ${peerId} ("${channel.label}"): ${JSON.stringify(error)} (Was Silent: ${wasSilentContext})`, Utils.logLevels.ERROR);
            // Error on data channel might also trigger other state changes that lead to reconnect attempts.
        };

        channel.onmessage = (event) => {
            try {
                const rawMessage = event.data;
                let messageObjectToProcess;

                if (typeof rawMessage === 'string') {
                    let parsedJson;
                    try {
                        parsedJson = JSON.parse(rawMessage);
                    } catch (e) { // Handle non-JSON string messages (e.g., plain text test)
                        Utils.log(`Received malformed JSON or plain text from ${peerId} on DC "${channel.label}": ${String(rawMessage).substring(0,100)}... Error: ${e.message}`, Utils.logLevels.WARN);
                        // Create a basic message object for plain text for robust handling
                        messageObjectToProcess = {
                            type: 'text', // Assume text
                            content: rawMessage,
                            sender: peerId, // Set sender
                            timestamp: new Date().toISOString() // Add timestamp
                        };
                    }

                    if (parsedJson) { // If JSON parsed successfully
                        if (parsedJson.type === 'chunk-meta' || parsedJson.type === 'chunk-data') {
                            const reassembledData = Utils.reassembleChunk(parsedJson, peerId);
                            if (reassembledData) { // Chunk reassembly complete
                                messageObjectToProcess = reassembledData;
                            } else { // Still waiting for more chunks or error in reassembly
                                return; // Do not process further
                            }
                        } else { // Not a chunk, process as is
                            messageObjectToProcess = parsedJson;
                        }
                    }
                } else if (rawMessage instanceof ArrayBuffer || rawMessage instanceof Blob) {
                    // Binary data received, currently not standard part of app's protocol for chat
                    Utils.log(`Received binary DataChannel message from ${peerId} on DC "${channel.label}". Length: ${rawMessage.byteLength || rawMessage.size}. Discarding (binary protocol not implemented here).`, Utils.logLevels.WARN);
                    return; // Ignore binary data for now
                }
                else { // Unknown data type
                    Utils.log(`Received non-string/non-binary DataChannel message from ${peerId} on DC "${channel.label}". Type: ${typeof rawMessage}. Discarding.`, Utils.logLevels.WARN);
                    return; // Ignore unknown data type
                }


                if (!messageObjectToProcess) { // Should ideally not happen if logic above is sound
                    Utils.log(`Logic error: messageObjectToProcess is undefined before final handling. Raw: ${String(rawMessage).substring(0,100)}`, Utils.logLevels.ERROR);
                    return;
                }
                // Ensure sender is set, defaulting to peerId if not in message
                messageObjectToProcess.sender = messageObjectToProcess.sender || peerId;


                // Route message based on type
                if (messageObjectToProcess.type && messageObjectToProcess.type.startsWith('video-call-')) {
                    VideoCallManager.handleMessage(messageObjectToProcess, peerId);
                } else if (messageObjectToProcess.groupId || messageObjectToProcess.type?.startsWith('group-')) {
                    GroupManager.handleGroupMessage(messageObjectToProcess);
                } else { // Regular direct message
                    ChatManager.addMessage(messageObjectToProcess.groupId || peerId, messageObjectToProcess);
                }

            } catch (e) {
                Utils.log(`Critical error in DataChannel onmessage from ${peerId} on DC "${channel.label}": ${e.message}. Data: ${String(event.data).substring(0,100)} Stack: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    handleIceConnectionStateChange: function(peerId) {
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return; // No connection object
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState} (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

        switch (pc.iceConnectionState) {
            case 'connected': // Connection established, but checking continues
            case 'completed': // All ICE checks successful
                this.reconnectAttempts[peerId] = 0; // Reset reconnect attempts
                // Note: 'connected' might still lead to 'disconnected' if checks fail later.
                // 'completed' is more stable.
                break;
            case 'disconnected': // Lost connection, may recover
                Utils.log(`ICE disconnected for ${peerId}. Attempting to reconnect if appropriate...`, Utils.logLevels.WARN);
                if (!conn.isVideoCall) { // Don't auto-reconnect video calls this way
                    this.attemptReconnect(peerId);
                }
                EventEmitter.emit('connectionDisconnected', peerId); // Notify app
                break;
            case 'failed': // Connection failed definitively
                Utils.log(`ICE connection failed for ${peerId}. (Silent Context: ${wasSilentContext})`, Utils.logLevels.ERROR);
                if (!wasSilentContext) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} failed.`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false); // Close connection, no need to notify peer as it failed
                break;
            case 'closed': // Connection closed
                Utils.log(`ICE connection closed for ${peerId}.`, Utils.logLevels.INFO);
                // This state is usually a result of calling pc.close()
                // If not, it means an abrupt closure.
                if (this.connections[peerId]) { // Ensure it hasn't been deleted yet
                    this.close(peerId, false); // Clean up if not already done
                }
                break;
        }
    },

    handleRtcConnectionStateChange: function(peerId) {
        const conn = this.connections[peerId];
        if(!conn || !conn.peerConnection) return; // No connection object
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`RTCPeerConnection state for ${peerId}: ${pc.connectionState} (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

        switch (pc.connectionState) {
            case "new":
            case "connecting":
                // Standard intermediate states
                break;
            case "connected": // Connection is live
                Utils.log(`RTCPeerConnection to ${peerId} is now 'connected'.`, Utils.logLevels.INFO);
                this.reconnectAttempts[peerId] = 0; // Reset reconnect attempts
                if (conn.isVideoCall) { // For video calls, this is a key indicator of success
                    EventEmitter.emit('connectionEstablished', peerId);
                }
                // For data channels, 'onopen' is the primary success indicator.
                // However, 'connected' state here is also good news.
                break;
            case "disconnected": // Temporary disconnection, might recover
                Utils.log(`RTCPeerConnection to ${peerId} is 'disconnected'. (Silent Context: ${wasSilentContext})`, Utils.logLevels.WARN);
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) { // Don't auto-reconnect video calls
                    this.attemptReconnect(peerId);
                } else {
                    // For video calls, UI might show "reconnecting" status based on this.
                }
                break;
            case "failed": // Connection failed critically
                Utils.log(`RTCPeerConnection to ${peerId} has 'failed'. (Silent Context: ${wasSilentContext})`, Utils.logLevels.ERROR);
                if (!wasSilentContext) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} has failed critically.`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false); // Close and clean up
                break;
            case "closed": // Connection was closed
                Utils.log(`RTCPeerConnection to ${peerId} is 'closed'.`, Utils.logLevels.INFO);
                // Typically result of local or remote pc.close().
                if (this.connections[peerId]) { // Ensure not already deleted
                    this.close(peerId, false); // Clean up
                }
                break;
        }
    },

    attemptReconnect: function(peerId) {
        const conn = this.connections[peerId];
        // Don't attempt if no connection object, or it's a video call, or already connected/connecting
        if (!conn || conn.isVideoCall) {
            Utils.log(`Skipping reconnect attempt for ${peerId} (no connection or is video call).`, Utils.logLevels.DEBUG);
            return;
        }
        if (this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') {
            Utils.log(`Reconnect attempt for ${peerId} skipped: already connected or connecting.`, Utils.logLevels.DEBUG);
            this.reconnectAttempts[peerId] = 0; // Reset if somehow called while connected
            return;
        }

        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        if (this.reconnectAttempts[peerId] <= Config.reconnect.maxAttempts) {
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId] -1);
            Utils.log(`Attempting to reconnect with ${peerId} (attempt ${this.reconnectAttempts[peerId]}) in ${delay/1000}s...`, Utils.logLevels.INFO);

            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]); // Clear existing timeout

            // Schedule reconnect attempt
            this.connectionTimeouts[peerId] = setTimeout(() => {
                delete this.connectionTimeouts[peerId]; // Remove from active timeouts
                const currentConn = this.connections[peerId]; // Re-check current connection status
                if (currentConn && !this.isConnectedTo(peerId) && currentConn.peerConnection.connectionState !== 'connecting') {
                    Utils.log(`Re-initiating offer to ${peerId} for reconnection.`, Utils.logLevels.INFO);
                    // Reconnection is always silent for data channels (chat)
                    this.createOffer(peerId, { isVideoCall: false, isAudioOnly: false, isSilent: true });
                } else if (this.isConnectedTo(peerId)) {
                    Utils.log(`Reconnection to ${peerId} not needed, already connected. Resetting attempts.`, Utils.logLevels.INFO);
                    this.reconnectAttempts[peerId] = 0;
                } else {
                    Utils.log(`Reconnection to ${peerId} aborted, connection object no longer valid, already closed, or connecting. State: ${currentConn?.peerConnection?.connectionState}`, Utils.logLevels.INFO);
                }
            }, delay);
        } else { // Max attempts reached
            Utils.log(`Max reconnection attempts reached for ${peerId}. Closing connection.`, Utils.logLevels.ERROR);
            this.close(peerId, false); // Give up and close
        }
    },

    sendTo: function(peerId, messageObject) {
        const conn = this.connections[peerId];
        if (conn && conn.dataChannel && conn.dataChannel.readyState === 'open') {
            try {
                // Ensure sender and timestamp are set
                messageObject.sender = messageObject.sender || UserManager.userId;
                messageObject.timestamp = messageObject.timestamp || new Date().toISOString();

                const messageString = JSON.stringify(messageObject);
                // Check if message exceeds chunk size
                if (messageString.length > Config.chunkSize) {
                    Utils.sendInChunks(messageString,
                        (chunk) => conn.dataChannel.send(chunk), // Send function
                        peerId, // Peer ID for logging/tracking
                        // File ID for chunking, useful for file transfers
                        (messageObject.type === 'file' || messageObject.type === 'audio') ? (messageObject.fileId || messageObject.fileName || `blob-${Date.now()}`) : undefined
                    );
                } else { // Send as a single message
                    conn.dataChannel.send(messageString);
                }
                return true; // Message sent (or started sending in chunks)
            } catch (error) {
                Utils.log(`Error sending message to ${peerId} via DataChannel: ${error}`, Utils.logLevels.ERROR);
                return false; // Send failed
            }
        } else {
            Utils.log(`Cannot send to ${peerId}: DataChannel not open or connection doesn't exist. DC State: ${conn?.dataChannel?.readyState}, PC State: ${conn?.peerConnection?.connectionState}`, Utils.logLevels.WARN);
            return false; // Cannot send
        }
    },

    isConnectedTo: function(peerId) {
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) {
            return true; // AI contacts are conceptually always "connected"
        }
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return false;

        const pcOverallState = conn.peerConnection.connectionState;

        // A connection is considered "connected" if the PeerConnection state is 'connected'
        // AND, if it's not a video call, the data channel must also be open.
        // For video calls, the 'connected' state of PC is sufficient.
        if (pcOverallState === 'connected') {
            if (conn.isVideoCall) { // For video calls, PC 'connected' is enough
                return true;
            } else if (conn.dataChannel && conn.dataChannel.readyState === 'open') { // For data, DC must be open
                return true;
            }
        }
        return false;
    },

    close: function(peerId, notifyPeer = true) { // notifyPeer not currently used, signaling for close not implemented
        const conn = this.connections[peerId];
        if (conn) {
            const wasSilentContext = conn.wasInitiatedSilently || false;
            Utils.log(`Closing connection with ${peerId}. (Was Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

            // Clear any pending timeouts related to this connection
            if (this.connectionTimeouts[peerId]) {
                clearTimeout(this.connectionTimeouts[peerId]);
                delete this.connectionTimeouts[peerId];
            }
            if (this.iceTimers[peerId]) {
                clearTimeout(this.iceTimers[peerId]);
                delete this.iceTimers[peerId];
            }

            // Close data channel
            if (conn.dataChannel) {
                try {
                    // Remove event listeners to prevent them firing during/after close
                    conn.dataChannel.onopen = null;
                    conn.dataChannel.onmessage = null;
                    conn.dataChannel.onerror = null;
                    const currentOnClose = conn.dataChannel.onclose; // Preserve for one last fire if needed
                    conn.dataChannel.onclose = () => {
                        if (currentOnClose) currentOnClose(); // Call original onclose if it exists
                        conn.dataChannel = null; // Nullify after close
                    };
                    if (conn.dataChannel.readyState !== 'closed') {
                        conn.dataChannel.close();
                    } else {
                        conn.dataChannel = null; // Already closed
                    }
                } catch (e) { Utils.log(`Error closing data channel for ${peerId}: ${e}`, Utils.logLevels.WARN); conn.dataChannel = null;}
            }
            // Close peer connection
            if (conn.peerConnection) {
                try {
                    // Remove event listeners
                    conn.peerConnection.onicecandidate = null;
                    conn.peerConnection.onicegatheringstatechange = null;
                    conn.peerConnection.oniceconnectionstatechange = null;
                    conn.peerConnection.onconnectionstatechange = null;
                    conn.peerConnection.ondatachannel = null;
                    conn.peerConnection.ontrack = null; // Important for video calls
                    if (conn.peerConnection.signalingState !== 'closed') {
                        conn.peerConnection.close();
                    }
                } catch (e) { Utils.log(`Error closing peer connection for ${peerId}: ${e}`, Utils.logLevels.WARN); }
            }

            // Clean up manager's state for this peer
            delete this.connections[peerId];
            delete this.iceCandidates[peerId];
            delete this.reconnectAttempts[peerId];
            delete this.iceGatheringStartTimes[peerId];


            // Update UI if this was the current chat
            if (ChatManager.currentChatId === peerId) {
                const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
                // Only update header if not a silent connection OR it's the current chat
                if (!wasSilentContext || ChatManager.currentChatId === peerId) {
                    UIManager.updateChatHeaderStatus(`Disconnected from ${contactName}`);
                }
                UIManager.setCallButtonsState(false); // Disable call buttons
            }
            EventEmitter.emit('connectionClosed', peerId); // Notify app of closure
        } else {
            Utils.log(`Attempted to close non-existent connection for ${peerId}.`, Utils.logLevels.DEBUG);
        }
    },

    resetAllConnections: function() {
        UIManager.showConfirmationModal(
            "Are you sure you want to reset all connections? This will disconnect all active chats and calls.",
            () => {
                Utils.log("Resetting all connections.", Utils.logLevels.INFO);
                // Close all peer connections
                for (const peerId in this.connections) {
                    this.close(peerId, false); // false: do not try to notify peers during a mass reset
                }
                // Clear all connection-related state
                this.connections = {};
                this.iceCandidates = {};
                this.reconnectAttempts = {};
                this.iceGatheringStartTimes = {};
                Object.keys(this.connectionTimeouts).forEach(peerId => clearTimeout(this.connectionTimeouts[peerId]));
                this.connectionTimeouts = {};
                Object.keys(this.iceTimers).forEach(peerId => clearTimeout(this.iceTimers[peerId]));
                this.iceTimers = {};

                // Close WebSocket and prevent auto-reconnect, then re-initialize
                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.onclose = null; // Prevent default onclose reconnect logic
                    this.websocket.close();
                }
                this.websocket = null;
                this.isWebSocketConnected = false;
                EventEmitter.emit('websocketStatusUpdate'); // Update UI about WS status

                // Re-initialize WebSocket connection after a short delay
                setTimeout(() => this.initialize(), 1000);

                UIManager.showNotification("All connections have been reset.", "info");
                // Update UI for the current chat if it was a P2P chat
                if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith("group_") && !UserManager.isSpecialContact(ChatManager.currentChatId)) {
                    UIManager.updateChatHeaderStatus("Disconnected - Connections Reset");
                    UIManager.setCallButtonsState(false);
                }
                ChatManager.renderChatList(); // Re-render chat list to update online status dots
            }
        );
    },

    updateSdpTextInModal: function(peerId) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return; // Modal not open or element doesn't exist

        const conn = this.connections[peerId];
        const pc = conn?.peerConnection;

        if (pc && pc.localDescription) { // Ensure PeerConnection and localDescription exist
            const sdpType = pc.localDescription.type; // 'offer' or 'answer'
            const connectionInfo = { // Structure for manual exchange
                sdp: {
                    type: sdpType,
                    sdp: pc.localDescription.sdp
                },
                candidates: this.iceCandidates[peerId] || [], // All gathered ICE candidates
                userId: UserManager.userId,
                // Include call type information
                isVideoCall: conn?.isVideoCall || false,
                isAudioOnly: conn?.isAudioOnly || false,
                isScreenShare: conn?.isScreenShare || false,
            };
            sdpTextEl.value = JSON.stringify(connectionInfo, null, 2); // Pretty print JSON
            Utils.log(`Updated modalSdpText for ${peerId} with local ${sdpType} and ${connectionInfo.candidates.length} candidates.`, Utils.logLevels.DEBUG);
        } else { // Still generating or error
            sdpTextEl.value = `Generating ${pc?.localDescription ? pc.localDescription.type : 'connection info'} for ${peerId}... (ICE State: ${pc?.iceGatheringState})`;
        }
    },

    handleIceGatheringStateChange: function(peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return; // No PeerConnection object for this peerId
        Utils.log(`ICE gathering state for ${peerId}: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);

        if (pc.iceGatheringState === 'gathering') {
            // Record start time if not already set for this gathering phase
            if (!this.iceGatheringStartTimes[peerId]) {
                this.iceGatheringStartTimes[peerId] = Date.now();
            }
        } else if (pc.iceGatheringState === 'complete') {
            // Calculate duration of ICE gathering if start time was recorded
            const duration = (Date.now() - (this.iceGatheringStartTimes[peerId] || Date.now())) / 1000;
            Utils.log(`ICE gathering reported complete for ${peerId} in ${duration.toFixed(1)}s. Total candidates: ${this.iceCandidates[peerId]?.length || 0}`, Utils.logLevels.DEBUG);
            // Reset start time for next potential gathering phase
            delete this.iceGatheringStartTimes[peerId];
            // Any specific actions on ICE completion (like updating modal SDP for manual exchange)
            // are typically handled by waitForIceGatheringComplete callbacks.
        }
    },
};