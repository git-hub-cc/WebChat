
const ConnectionManager = {
    connections: {},
    iceCandidates: {},
    connectionTimeouts: {},
    reconnectAttempts: {},
    iceTimers: {},
    iceGatheringStartTimes: {},
    websocket: null,
    isWebSocketConnected: false,
    signalingServerUrl: 'ws://localhost:8080/signaling', // Ensure this matches your server
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
                    setTimeout(() => this.connectWebSocket(), 3000); // Reconnect after 3 seconds
                };

                this.websocket.onerror = (error) => {
                    Utils.log('WebSocket error: ' + JSON.stringify(error), Utils.logLevels.ERROR);
                    UIManager.updateConnectionStatusIndicator('Signaling server connection error.');
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    // No reject here, as onclose will attempt reconnect.
                    // If you need to reject for initial connection promise:
                    if (this.websocket && this.websocket.readyState !== WebSocket.OPEN) {
                        reject(error); // Commented out to prefer auto-reconnect logic
                    }
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
        this.sendSignalingMessage(message, false); // false for not silent
    },

    sendSignalingMessage: function(message, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const messageString = JSON.stringify(message);
            this.websocket.send(messageString);
            Utils.log(`Sent WS: ${message.type} to ${message.targetUserId || 'server'} (from ${message.userId || 'N/A'}) ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        } else {
            Utils.log('WebSocket not connected, cannot send signaling message.', Utils.logLevels.ERROR);
            if (!isInternalSilentFlag) { // Only show UI notification for non-silent operations
                UIManager.showNotification('Not connected to signaling server. Message not sent.', 'error');
            }
        }
    },

    handleSignalingMessage: function(message) {
        Utils.log(`Received WS: ${message.type} from ${message.fromUserId || 'server'} ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        switch (message.type) {
            case 'SUCCESS': // User registration successful
                UIManager.updateConnectionStatusIndicator(`User registration successful: ${UserManager.userId.substring(0,8)}...`);
                this.autoConnectToAllContacts(); // Attempt auto-connection after successful registration
                break;
            case 'ERROR': // Generic error from signaling server
                // UIManager.showNotification(`Signaling error: ${message.message}`, 'error');
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
                    UIManager.showNotification(`User ${message.targetUserId.substring(0,8)}... not found or offline.`, 'warning');
                }
                Utils.log(`User ${message.targetUserId} not found. (Silent Attempt: ${wasSilentAttempt})`, Utils.logLevels.WARN);

                if(ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt) {
                    UIManager.updateChatHeaderStatus(`User not found or offline`);
                }
                if (this.connections[message.targetUserId]) {
                    this.close(message.targetUserId, false); // false for no notification to peer (they are not there)
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
            this.close(peerId, false);
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
                isAudioOnly: false,
                isScreenShare: false,
                wasInitiatedSilently: false
            };
            this.iceCandidates[peerId] = []; // Initialize as empty array for trickle ICE
            this.reconnectAttempts[peerId] = 0;

            pc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            pc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            pc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            pc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);

            if (isVideoCall) {
                // ontrack for video/audio tracks will be handled by VideoCallManager when it sets up the call
            } else {
                // For data channel connections
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
                    await this.connectWebSocket(); // Ensure WS is connected
                } catch (e) {
                    if (!isSilent) UIManager.showNotification("Signaling server connection failed. Cannot create offer.", "error");
                    return; // Cannot proceed without WS
                }
            }

            Utils.log(`Creating offer for target: ${targetPeerId}, from: ${UserManager.userId}, isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, silent: ${isSilent}`, Utils.logLevels.DEBUG);

            const pc = this.initConnection(targetPeerId, isVideoCall);
            if (!pc) {
                if (!isSilent) UIManager.showNotification("Failed to initialize connection for offer.", "error");
                return;
            }
            this.connections[targetPeerId].isVideoCall = isVideoCall;
            this.connections[targetPeerId].isAudioOnly = isAudioOnly;
            this.connections[targetPeerId].isScreenShare = options.isScreenShare || false;
            this.connections[targetPeerId].wasInitiatedSilently = isSilent;

            if (!isVideoCall) { // This is for a data channel connection
                const dataChannel = pc.createDataChannel('chatChannel', { reliable: true });
                this.setupDataChannel(dataChannel, targetPeerId);
            } else { // This is for a video/audio call (handled by VideoCallManager)
                if (VideoCallManager.localStream) {
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                } else {
                    Utils.log("Local stream not available for video call offer. VideoCallManager should handle this.", Utils.logLevels.WARN);
                }
            }

            try {
                const offerOptions = {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: isVideoCall && !isAudioOnly // Only offer to receive video if it's a video call
                };
                const offer = await pc.createOffer(offerOptions);
                await pc.setLocalDescription(offer); // Set local description

                Utils.log(`Offer created for ${targetPeerId}. State: ${pc.signalingState}. Sending SDP immediately. ICE will trickle. (Silent: ${isSilent})`, Utils.logLevels.INFO);
                if (!isSilent && ChatManager.currentChatId === targetPeerId) {
                    const contactName = UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0,8) + '...';
                    UIManager.updateChatHeaderStatus(`Connecting to ${contactName}...`);
                }

                // Send the offer SDP immediately
                if (!pc.localDescription) {
                    Utils.log(`Cannot send offer for ${targetPeerId}: localDescription is null immediately after set. This is unexpected.`, Utils.logLevels.ERROR);
                    if (!isSilent) UIManager.showNotification("Error: Could not finalize local connection details early.", "error");
                    this.close(targetPeerId);
                    return;
                }
                const offerMessagePayload = {
                    type: 'OFFER',
                    userId: UserManager.userId,
                    targetUserId: targetPeerId,
                    sdp: pc.localDescription.sdp,
                    sdpType: pc.localDescription.type,
                    // candidates: [], // No initial candidates needed, rely on trickle ICE
                    isVideoCall: isVideoCall,
                    isAudioOnly: isAudioOnly,
                    isScreenShare: options.isScreenShare || false,
                };
                this.sendSignalingMessage(offerMessagePayload, isSilent);
                Utils.log(`Offer SDP sent to ${targetPeerId} via signaling. (Silent: ${isSilent}) ICE candidates will follow.`, Utils.logLevels.INFO);

                // `pc.onicecandidate` (set in initConnection) will handle sending candidates.
                // Use waitForIceGatheringComplete for logging or if modal needs full info for manual copy
                this.waitForIceGatheringComplete(targetPeerId, () => {
                    Utils.log(`ICE gathering for ${targetPeerId} considered complete/timed out (non-blocking). Total candidates found so far: ${this.iceCandidates[targetPeerId]?.length || 0}`, Utils.logLevels.DEBUG);
                    if (promptedForId && document.getElementById('modalSdpText')) {
                        this.updateSdpTextInModal(targetPeerId); // Now update modal with SDP and collected candidates
                    }
                });

            } catch (error) {
                Utils.log(`WebRTC error during offer creation for ${targetPeerId}: ${error.message}\nStack: ${error.stack}`, Utils.logLevels.ERROR);
                if (!isSilent) UIManager.showNotification(`Connection offer error: ${error.message}`, 'error');
                this.close(targetPeerId);
            }
        } catch (e) { // Outer catch for initial setup or prompt errors
            Utils.log(`UNEXPECTED ERROR in createOffer for ${targetPeerId || 'unknown target'}: ${e.message}\nStack: ${e.stack}`, Utils.logLevels.ERROR);
            if (!isSilent) UIManager.showNotification("An unexpected error occurred while trying to connect.", "error");
            if (targetPeerId) {
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
        let offerDelay = 0; // Stagger requests slightly

        for (const contactId of contactIds) {
            if (contactId === UserManager.userId) continue; // Don't connect to self

            if (this.isConnectedTo(contactId)) {
                Utils.log(`Already connected to ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }
            // Check if a connection attempt is already in progress
            const existingConn = this.connections[contactId];
            if (existingConn && (
                existingConn.peerConnection?.connectionState === 'connecting' ||
                existingConn.peerConnection?.connectionState === 'new' || // Still in the process of being set up
                existingConn.dataChannel?.readyState === 'connecting'
            )) {
                Utils.log(`Connection attempt already in progress for ${contactId}. Skipping auto-connect.`, Utils.logLevels.DEBUG);
                continue;
            }

            // Use a closure to capture contactId for the setTimeout
            ((idToConnect, delay) => {
                setTimeout(async () => {
                    Utils.log(`Auto-connecting to contact (staggered): ${idToConnect}`, Utils.logLevels.DEBUG);
                    try {
                        // Create a non-video, silent offer
                        await this.createOffer(idToConnect, {isVideoCall: false, isAudioOnly: false, isSilent: true});
                    } catch (error) {
                        Utils.log(`Error during auto-connecting initiation for ${idToConnect}: ${error.message}`, Utils.logLevels.WARN);
                    }
                }, delay);
            })(contactId, offerDelay);

            offerDelay += 50; // Reduced stagger delay (was 100ms)
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
            sdpTextEl.value = ''; // Clear the modal

            if (!answerDataFromModal.sdp || !answerDataFromModal.sdp.sdp ||
                answerDataFromModal.sdp.type !== 'answer' ||
                !answerDataFromModal.userId) {
                UIManager.showNotification("Invalid answer data format in modal. Expected { sdp: {type: 'answer', sdp}, candidates, userId }.", "error");
                Utils.log(`Invalid answer data from modal: ${JSON.stringify(answerDataFromModal)}`, Utils.logLevels.ERROR);
                return;
            }
            if (answerDataFromModal.userId === UserManager.userId) {
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
                UIManager.toggleModal('mainMenuModal', false);
                return;
            }
            // Use handleRemoteAnswer to process the answer
            await this.handleRemoteAnswer(
                fromUserId,
                answerDataFromModal.sdp.sdp,
                answerDataFromModal.candidates, // Candidates provided with the answer
                conn.isVideoCall, // These flags come from the original offer context
                conn.isAudioOnly,
                conn.isScreenShare,
                'answer' // sdpType
            );
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

            // Add any ICE candidates that came bundled with the answer
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object') {
                        // Check if pc is still valid and remoteDescription is set
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

    createAnswer: async function() { // For manual SDP exchange via modal
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
                UIManager.showNotification("Invalid offer data format in modal. Expected { sdp: {type: 'offer', ...}, ... }.", "error");
                Utils.log(`Pasted offer data for createAnswer was invalid: ${JSON.stringify(offerDataFromModal)}`, Utils.logLevels.ERROR);
                return;
            }
            if (offerDataFromModal.userId === UserManager.userId) {
                UIManager.showNotification("Cannot process an offer from yourself in this way.", "warning");
                return;
            }

            const fromUserId = offerDataFromModal.userId;
            sdpTextEl.value = 'Generating answer...'; // Placeholder

            // initConnection will create the peerConnection object
            const pc = this.initConnection(fromUserId, offerDataFromModal.isVideoCall || false);
            if (!pc) {
                UIManager.showNotification("Failed to initialize connection to create answer.", "error");
                sdpTextEl.value = 'Error initializing connection.';
                return;
            }

            if(this.connections[fromUserId]){
                this.connections[fromUserId].wasInitiatedSilently = false; // Manual flow is not silent
                this.connections[fromUserId].isVideoCall = offerDataFromModal.isVideoCall || false;
                this.connections[fromUserId].isAudioOnly = offerDataFromModal.isAudioOnly || false;
                this.connections[fromUserId].isScreenShare = offerDataFromModal.isScreenShare || false;
            }

            await this.handleRemoteOffer(
                fromUserId,
                offerDataFromModal.sdp.sdp,
                offerDataFromModal.candidates, // Candidates that came with the offer
                offerDataFromModal.isVideoCall,
                offerDataFromModal.isAudioOnly,
                offerDataFromModal.isScreenShare,
                'offer', // sdpType
                true // isManualCreateAnswerFlow = true
            );
            // Note: handleRemoteOffer (when isManualCreateAnswerFlow is true) will call updateSdpTextInModal after ICE gathering.
            UIManager.showNotification("Answer generation started. Modal will update with info to copy.", "info");

        } catch (e) {
            UIManager.showNotification("Error creating answer: " + e.message, "error");
            Utils.log("Error in ConnectionManager.createAnswer (manual): " + e, Utils.logLevels.ERROR);
            if (sdpTextEl) sdpTextEl.value = `Error: ${e.message}`;
        }
    },

    handleRemoteOffer: async function(fromUserId, sdpString, candidates, isVideoCall, isAudioOnly, isScreenShare, sdpTypeFromServer, isManualCreateAnswerFlow = false) {
        Utils.log(`Handling remote offer from ${fromUserId}. isVideo: ${isVideoCall}, isAudioOnly: ${isAudioOnly}, isScreenShare: ${isScreenShare}. ManualFlow: ${isManualCreateAnswerFlow}`, Utils.logLevels.INFO);

        if (!UserManager.contacts[fromUserId] && !GroupManager.groups[fromUserId]) {
            if(!isVideoCall && !fromUserId.startsWith('group_')){ // Only auto-add if not a video call and not a group
                UserManager.addContact(fromUserId, `Peer ${fromUserId.substring(0,4)}`);
            }
        }

        let pc = this.connections[fromUserId]?.peerConnection;

        if (!isManualCreateAnswerFlow && (!pc || pc.signalingState !== 'stable')) { // For signaling, if PC exists but not stable, re-init. If 'new' from initConnection, it's fine.
            if (pc && pc.signalingState !== 'new') { // if not new, means it's some other state, better to re-init
                Utils.log(`handleRemoteOffer (signaling): PC for ${fromUserId} is in state ${pc.signalingState}. Re-initializing.`, Utils.logLevels.DEBUG);
                pc = this.initConnection(fromUserId, isVideoCall);
            } else if (!pc) { // If no PC, init
                pc = this.initConnection(fromUserId, isVideoCall);
            }
            if (!pc) {
                UIManager.showNotification("Failed to initialize connection to handle offer.", "error");
                return;
            }
        } else if (isManualCreateAnswerFlow && !pc) { // For manual, pc MUST have been created by createAnswer call to initConnection
            Utils.log(`handleRemoteOffer (manual flow): pc is unexpectedly null for ${fromUserId}. Aborting.`, Utils.logLevels.ERROR);
            UIManager.showNotification("Connection object missing, cannot handle offer.", "error");
            return;
        }
        // If isManualCreateAnswerFlow and pc exists, it should be in 'new' state from initConnection.


        if(this.connections[fromUserId]){ // Ensure flags are set on our connection object
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

            // Add any ICE candidates that came bundled with the offer
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

            // If this is a video call being handled by VideoCallManager
            if (isVideoCall && VideoCallManager.isCallActive && VideoCallManager.currentPeerId === fromUserId) {
                // VideoCallManager will add its local tracks when it processes the offer/answer logic
            } else if (!isVideoCall && !this.connections[fromUserId].dataChannel) {
                // If it's a data channel connection and we are responding to an offer,
                // ondatachannel on 'pc' (set in initConnection) will be triggered by remote creating the channel.
                Utils.log(`Waiting for remote to create data channel for ${fromUserId}.`, Utils.logLevels.DEBUG);
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            Utils.log(`Local description (answer) created and set for ${fromUserId}. New state: ${pc.signalingState}. Sending SDP. ICE will trickle...`, Utils.logLevels.INFO);


            if (!pc.localDescription) {
                Utils.log(`Cannot send/prepare answer for ${fromUserId}: localDescription is null.`, Utils.logLevels.ERROR);
                this.close(fromUserId);
                return;
            }
            const answerMessagePayload = {
                type: 'ANSWER',
                userId: UserManager.userId,
                targetUserId: fromUserId,
                sdp: pc.localDescription.sdp,
                sdpType: pc.localDescription.type,
                // candidates: [], // Rely on trickle ICE
                isVideoCall: this.connections[fromUserId].isVideoCall,
                isAudioOnly: this.connections[fromUserId].isAudioOnly,
                isScreenShare: this.connections[fromUserId].isScreenShare,
            };

            if (isManualCreateAnswerFlow) {
                // For manual flow, wait for ICE gathering then update modal.
                this.waitForIceGatheringComplete(fromUserId, () => {
                    Utils.log(`ICE gathering for manual answer to ${fromUserId} considered complete/timed out. Updating modal.`, Utils.logLevels.DEBUG);
                    this.updateSdpTextInModal(fromUserId); // This will include candidates
                });
            } else {
                // For automatic flow, send answer SDP immediately.
                this.sendSignalingMessage(answerMessagePayload, false); // false for not silent
                Utils.log(`Answer SDP sent to ${fromUserId} via signaling. ICE candidates will follow.`, Utils.logLevels.INFO);
                // Optional: still use waitForIce for logging or longer timeout
                this.waitForIceGatheringComplete(fromUserId, () => {
                    Utils.log(`ICE gathering for answer to ${fromUserId} considered complete/timed out (non-blocking).`, Utils.logLevels.DEBUG);
                });
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
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    Utils.log(`Added remote ICE candidate from ${fromUserId}.`, Utils.logLevels.DEBUG);
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
            // Store candidate locally (useful for manual SDP exchange modal)
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate.toJSON());

            const connData = this.connections[peerId];
            const sendSilently = connData?.wasInitiatedSilently || false;

            // Send this ICE candidate via signaling (Trickle ICE)
            const candidateMessagePayload = {
                type: 'ICE_CANDIDATE',
                userId: UserManager.userId,
                targetUserId: peerId,
                candidate: event.candidate.toJSON() // Send the candidate
            };
            this.sendSignalingMessage(candidateMessagePayload, sendSilently);
        } else {
            // ICE gathering finished for this PC
            Utils.log(`ICE gathering complete for ${peerId} (event.candidate is null).`, Utils.logLevels.DEBUG);
            // `waitForIceGatheringComplete` will also handle this state change if it's polling.
        }
    },

    waitForIceGatheringComplete: function(peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) {
            Utils.log(`waitForIceGatheringComplete: No PeerConnection for ${peerId}.`, Utils.logLevels.WARN);
            if (typeof callback === 'function') callback(); // Callback immediately if no PC
            return;
        }

        if (this.iceTimers[peerId]) { // Clear any existing timer for this peer
            clearTimeout(this.iceTimers[peerId]);
            delete this.iceTimers[peerId];
        }

        if (pc.iceGatheringState === 'complete') {
            Utils.log(`ICE gathering already complete for ${peerId}. Calling callback immediately.`, Utils.logLevels.DEBUG);
            if (typeof callback === 'function') callback();
        } else {
            Utils.log(`Waiting for ICE gathering to complete for ${peerId}... Current state: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);
            this.iceGatheringStartTimes[peerId] = Date.now(); // Record start time

            const iceTimeout = Config.timeouts.iceGathering; // Use configured timeout
            let checkInterval;

            const onDone = () => {
                if(checkInterval) clearInterval(checkInterval); // Clear interval if it exists
                checkInterval = null; // Prevent multiple clears
                if (this.iceTimers[peerId]) { // Check if timer still exists (it should)
                    clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                    if (typeof callback === 'function') callback(); // Execute the provided callback
                }
            };

            // Set a timeout for ICE gathering
            this.iceTimers[peerId] = setTimeout(() => {
                Utils.log(`ICE gathering timeout for ${peerId} after ${iceTimeout}ms. Proceeding. State: ${pc.iceGatheringState}`, Utils.logLevels.WARN);
                onDone();
            }, iceTimeout);

            // Periodically check the ICE gathering state
            checkInterval = setInterval(() => {
                if (!this.connections[peerId] || !this.connections[peerId].peerConnection) {
                    if(checkInterval) clearInterval(checkInterval);
                    checkInterval = null;
                    if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                    Utils.log(`waitForIceGatheringComplete: PeerConnection for ${peerId} disappeared. Aborting wait.`, Utils.logLevels.WARN);
                    return; // PC object is gone
                }
                if (this.connections[peerId].peerConnection.iceGatheringState === 'complete') {
                    Utils.log(`ICE gathering reported complete for ${peerId} by interval check.`, Utils.logLevels.DEBUG);
                    onDone();
                }
            }, 200); // Check every 200ms
        }
    },

    setupDataChannel: function(channel, peerId) {
        if (!this.connections[peerId]) {
            Utils.log(`Connection object for ${peerId} not found when setting up data channel. Channel name: ${channel.label}`, Utils.logLevels.ERROR);
            try { channel.close(); } catch(e){ /* ignore */ }
            return;
        }
        // If a data channel already exists and is open, don't overwrite unless necessary
        if (this.connections[peerId].dataChannel && this.connections[peerId].dataChannel.readyState === 'open') {
            Utils.log(`Data channel already exists and is open for ${peerId}. Ignoring new channel: ${channel.label}`, Utils.logLevels.WARN);
            return;
        }

        this.connections[peerId].dataChannel = channel;
        const wasSilentContext = this.connections[peerId].wasInitiatedSilently || false;
        Utils.log(`Setting up data channel "${channel.label}" for ${peerId}. Silent Context: ${wasSilentContext}`, Utils.logLevels.INFO);


        channel.onopen = () => {
            Utils.log(`Data channel with ${peerId} ("${channel.label}") opened. (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);
            const contactName = UserManager.contacts[peerId]?.name || peerId.substring(0,8) + '...';
            // Update UI only if not a silent connection or if it's the current chat
            if ((!wasSilentContext || ChatManager.currentChatId === peerId)) {
                UIManager.updateChatHeaderStatus(`Connected to ${contactName}`);
            }
            EventEmitter.emit('connectionEstablished', peerId);
            if (ChatManager.currentChatId === peerId && !this.connections[peerId].isVideoCall) { // Ensure not a video call
                UIManager.setCallButtonsState(true, peerId);
            }
            this.reconnectAttempts[peerId] = 0; // Reset reconnect attempts on successful open
        };

        channel.onclose = () => {
            Utils.log(`Data channel with ${peerId} ("${channel.label}") closed. (Was Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);
            const pcState = this.connections[peerId]?.peerConnection?.connectionState;
            // Emit disconnected only if the underlying peer connection isn't already closed or failed
            if (pcState !== 'closed' && pcState !== 'failed') {
                EventEmitter.emit('connectionDisconnected', peerId);
            }
            // UI updates for current chat
            if (ChatManager.currentChatId === peerId) {
                UIManager.setCallButtonsState(false); // Disable call buttons
            }
            if (this.connections[peerId]) { // Check if connection object still exists
                this.connections[peerId].dataChannel = null; // Nullify the dataChannel reference
            }
        };

        channel.onerror = (error) => {
            Utils.log(`Data channel error with ${peerId} ("${channel.label}"): ${JSON.stringify(error)} (Was Silent: ${wasSilentContext})`, Utils.logLevels.ERROR);
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
                        Utils.log(`Received malformed JSON or plain text from ${peerId} on DC "${channel.label}": ${String(rawMessage).substring(0,100)}... Error: ${e.message}`, Utils.logLevels.WARN);
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
                } else if (rawMessage instanceof ArrayBuffer || rawMessage instanceof Blob) {
                    Utils.log(`Received binary DataChannel message from ${peerId} on DC "${channel.label}". Length: ${rawMessage.byteLength || rawMessage.size}. Discarding (binary protocol not implemented here).`, Utils.logLevels.WARN);
                    return;
                }
                else {
                    Utils.log(`Received non-string/non-binary DataChannel message from ${peerId} on DC "${channel.label}". Type: ${typeof rawMessage}. Discarding.`, Utils.logLevels.WARN);
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
                Utils.log(`Critical error in DataChannel onmessage from ${peerId} on DC "${channel.label}": ${e.message}. Data: ${String(event.data).substring(0,100)} Stack: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    handleIceConnectionStateChange: function(peerId) {
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return; // Connection might have been closed
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`ICE connection state for ${peerId}: ${pc.iceConnectionState} (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

        switch (pc.iceConnectionState) {
            case 'connected':
            case 'completed':
                this.reconnectAttempts[peerId] = 0;
                break;
            case 'disconnected':
                Utils.log(`ICE disconnected for ${peerId}. Attempting to reconnect if appropriate...`, Utils.logLevels.WARN);
                if (!conn.isVideoCall) {
                    this.attemptReconnect(peerId);
                }
                EventEmitter.emit('connectionDisconnected', peerId);
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
        if(!conn || !conn.peerConnection) return; // Connection might have been closed
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`RTCPeerConnection state for ${peerId}: ${pc.connectionState} (Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

        switch (pc.connectionState) {
            case "new":
            case "connecting":
                break;
            case "connected":
                Utils.log(`RTCPeerConnection to ${peerId} is now 'connected'.`, Utils.logLevels.INFO);
                this.reconnectAttempts[peerId] = 0;
                // Emit 'connectionEstablished' here if not already handled by data channel onopen
                // This indicates the underlying transport is up.
                // However, for data channels, 'onopen' is more specific.
                // For video calls, this state is important.
                if (conn.isVideoCall) {
                    EventEmitter.emit('connectionEstablished', peerId);
                }
                break;
            case "disconnected":
                Utils.log(`RTCPeerConnection to ${peerId} is 'disconnected'. (Silent Context: ${wasSilentContext})`, Utils.logLevels.WARN);
                if (!conn.isVideoCall) {
                    EventEmitter.emit('connectionDisconnected', peerId);
                    this.attemptReconnect(peerId);
                } else {
                    // VideoCallManager might handle its own logic for video call disconnections
                    EventEmitter.emit('connectionDisconnected', peerId); // Still notify
                }
                break;
            case "failed":
                Utils.log(`RTCPeerConnection to ${peerId} has 'failed'. (Silent Context: ${wasSilentContext})`, Utils.logLevels.ERROR);
                if (!wasSilentContext) UIManager.showNotification(`Connection with ${UserManager.contacts[peerId]?.name || peerId.substring(0,8)} has failed critically.`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false);
                break;
            case "closed":
                Utils.log(`RTCPeerConnection to ${peerId} is 'closed'.`, Utils.logLevels.INFO);
                if (this.connections[peerId]) { // If not already cleaned up by this.close()
                    this.close(peerId, false);
                }
                break;
        }
    },

    attemptReconnect: function(peerId) {
        const conn = this.connections[peerId];
        if (!conn || conn.isVideoCall) { // Don't auto-reconnect video calls this way
            Utils.log(`Skipping reconnect attempt for ${peerId} (no connection or is video call).`, Utils.logLevels.DEBUG);
            return;
        }
        if (this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') {
            Utils.log(`Reconnect attempt for ${peerId} skipped: already connected or connecting.`, Utils.logLevels.DEBUG);
            this.reconnectAttempts[peerId] = 0;
            return;
        }

        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        if (this.reconnectAttempts[peerId] <= Config.reconnect.maxAttempts) {
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId] -1);
            Utils.log(`Attempting to reconnect with ${peerId} (attempt ${this.reconnectAttempts[peerId]}) in ${delay/1000}s...`, Utils.logLevels.INFO);

            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);

            this.connectionTimeouts[peerId] = setTimeout(() => {
                delete this.connectionTimeouts[peerId];
                const currentConn = this.connections[peerId]; // Re-check connection
                if (currentConn && !this.isConnectedTo(peerId) && currentConn.peerConnection.connectionState !== 'connecting') {
                    Utils.log(`Re-initiating offer to ${peerId} for reconnection.`, Utils.logLevels.INFO);
                    this.createOffer(peerId, { isVideoCall: false, isAudioOnly: false, isSilent: true });
                } else if (this.isConnectedTo(peerId)) {
                    Utils.log(`Reconnection to ${peerId} not needed, already connected. Resetting attempts.`, Utils.logLevels.INFO);
                    this.reconnectAttempts[peerId] = 0;
                } else {
                    Utils.log(`Reconnection to ${peerId} aborted, connection object no longer valid, already closed, or connecting. State: ${currentConn?.peerConnection?.connectionState}`, Utils.logLevels.INFO);
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
                    Utils.sendInChunks(messageString,
                        (chunk) => conn.dataChannel.send(chunk),
                        peerId,
                        (messageObject.type === 'file' || messageObject.type === 'audio') ? (messageObject.fileId || messageObject.fileName || `blob-${Date.now()}`) : undefined
                    );
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
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return false;

        const pcOverallState = conn.peerConnection.connectionState;

        if (pcOverallState === 'connected') {
            if (conn.isVideoCall) {
                // For video calls, 'connected' RTCPeerConnection state is a good indicator for the dot.
                // Media flow is handled by VideoCallManager, but the P2P link is up.
                return true;
            } else if (conn.dataChannel && conn.dataChannel.readyState === 'open') {
                // For data channels, the channel must also be explicitly open.
                return true;
            }
        }
        return false;
    },

    close: function(peerId, notifyPeer = true) { // notifyPeer is not used as we don't send a "close" message over WebRTC
        const conn = this.connections[peerId];
        if (conn) {
            const wasSilentContext = conn.wasInitiatedSilently || false;
            Utils.log(`Closing connection with ${peerId}. (Was Silent Context: ${wasSilentContext})`, Utils.logLevels.INFO);

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
                    conn.dataChannel.onclose = () => { // Ensure onclose logic runs once
                        if (currentOnClose) currentOnClose();
                        conn.dataChannel = null; // Then nullify
                    };
                    if (conn.dataChannel.readyState !== 'closed') {
                        conn.dataChannel.close();
                    } else {
                        conn.dataChannel = null; // Already closed
                    }
                } catch (e) { Utils.log(`Error closing data channel for ${peerId}: ${e}`, Utils.logLevels.WARN); conn.dataChannel = null;}
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
            EventEmitter.emit('connectionClosed', peerId); // Emit that the connection is definitively closed
        } else {
            Utils.log(`Attempted to close non-existent connection for ${peerId}.`, Utils.logLevels.DEBUG);
        }
    },

    resetAllConnections: function() {
        UIManager.showConfirmationModal(
            "Are you sure you want to reset all connections? This will disconnect all active chats and calls.",
            () => { // onConfirm
                Utils.log("Resetting all connections.", Utils.logLevels.INFO);
                for (const peerId in this.connections) {
                    this.close(peerId, false);
                }
                this.connections = {};
                this.iceCandidates = {};
                this.reconnectAttempts = {};
                this.iceGatheringStartTimes = {};
                Object.keys(this.connectionTimeouts).forEach(peerId => clearTimeout(this.connectionTimeouts[peerId]));
                this.connectionTimeouts = {};
                Object.keys(this.iceTimers).forEach(peerId => clearTimeout(this.iceTimers[peerId]));
                this.iceTimers = {};

                if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.onclose = null;
                    this.websocket.close();
                }
                this.websocket = null;
                this.isWebSocketConnected = false;
                EventEmitter.emit('websocketStatusUpdate');

                setTimeout(() => this.initialize(), 1000);

                UIManager.showNotification("All connections have been reset.", "info");
                if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith("group_")) {
                    UIManager.updateChatHeaderStatus("Disconnected - Connections Reset");
                    UIManager.setCallButtonsState(false);
                }
                ChatManager.renderChatList();
            }
        );
    },

    updateSdpTextInModal: function(peerId) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;

        const conn = this.connections[peerId];
        const pc = conn?.peerConnection;

        if (pc && pc.localDescription) {
            const sdpType = pc.localDescription.type;
            const connectionInfo = {
                sdp: {
                    type: sdpType,
                    sdp: pc.localDescription.sdp
                },
                candidates: this.iceCandidates[peerId] || [],
                userId: UserManager.userId,
                isVideoCall: conn?.isVideoCall || false,
                isAudioOnly: conn?.isAudioOnly || false,
                isScreenShare: conn?.isScreenShare || false,
            };
            sdpTextEl.value = JSON.stringify(connectionInfo, null, 2);
            Utils.log(`Updated modalSdpText for ${peerId} with local ${sdpType} and ${connectionInfo.candidates.length} candidates.`, Utils.logLevels.DEBUG);
        } else {
            sdpTextEl.value = `Generating ${pc?.localDescription ? pc.localDescription.type : 'connection info'} for ${peerId}... (ICE State: ${pc?.iceGatheringState})`;
        }
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
        }
    },
};