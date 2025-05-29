const VideoCallManager = {
    localStream: null,
    remoteStream: null,
    localVideo: null,
    remoteVideo: null,
    currentPeerId: null,
    isCallActive: false,
    isCaller: false,
    isCallPending: false,
    isAudioMuted: false,
    isVideoEnabled: true,   // Can *I* send video? (based on camera + user choice)
    isAudioOnly: false,     // Is the *call itself* in audio-only mode (UI, offerToReceiveVideo)?
    callRequestTimeout: null,
    statsInterval: null,

    audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    },

    codecPreferences: {
        audio: [
            {mimeType: 'audio/opus', clockRate: 48000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000;dtx=0'}
        ],
        video: [ {mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'} ]
    },

    init: function () {
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('Browser does not support media devices (getUserMedia). Call functions will be disabled.', Utils.logLevels.ERROR);
            return false;
        }
        return true;
    },

    initiateAudioCall: function (peerId) {
        this.initiateCall(peerId, true);
    },

    initiateCall: async function (peerId, audioOnly = false) {
        if (this.isCallActive || this.isCallPending) {
            UIManager.showNotification('A call is already active or pending.', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) {
            UIManager.showNotification('Please select a chat partner to call.', 'warning');
            return;
        }
        if (!ConnectionManager.isConnectedTo(peerId)) {
            UIManager.showNotification('Not connected to peer. Cannot initiate call.', 'error');
            return;
        }

        this.isAudioOnly = audioOnly;         // Call's fundamental mode
        this.isVideoEnabled = !audioOnly;     // If call is video, local video sending is initially *intended*
        this.isAudioMuted = false;

        try {
            this.currentPeerId = peerId;
            this.isCaller = true;
            this.isCallPending = true;

            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                sender: UserManager.userId
            });
            UIManager.showNotification(`Calling ${UserManager.contacts[peerId]?.name || 'peer'} (${this.isAudioOnly ? 'Audio' : 'Video'})...`, 'info');

            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) {
                    ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId });
                    this.endCallCleanup();
                    UIManager.showNotification('Call request timed out.', 'warning');
                }
            }, 30000);
        } catch (error) {
            Utils.log(`Failed to initiate call: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.showNotification('Failed to initiate call.', 'error');
            this.endCallCleanup();
        }
    },

    showCallRequest: function (peerId, audioOnly = false) {
        this.currentPeerId = peerId;
        this.isAudioOnly = audioOnly;
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;

        const requestModal = document.getElementById('videoCallRequest');
        const requestTitle = requestModal.querySelector('h3');
        const requestDesc = requestModal.querySelector('p');
        const avatar = requestModal.querySelector('.video-call-avatar');

        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0,4)}`;
        if (avatar) avatar.textContent = UserManager.contacts[peerId]?.name?.charAt(0).toUpperCase() || 'P';
        if (requestTitle) requestTitle.textContent = `${this.isAudioOnly ? 'Audio' : 'Video'} Call Request`;
        if (requestDesc) requestDesc.textContent = `${peerName} is calling...`;
        requestModal.style.display = 'flex';
    },

    hideCallRequest: function () {
        const requestModal = document.getElementById('videoCallRequest');
        if(requestModal) requestModal.style.display = 'none';
    },

    acceptCall: async function () {
        this.hideCallRequest();
        if (!this.currentPeerId) {
            UIManager.showNotification('Invalid call request.', 'error');
            return;
        }
        try {
            // isAudioOnly and isVideoEnabled are set by showCallRequest based on INCOMING request
            await this.startLocalStreamAndSignal(false); // false: not the initial offer creator for media
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: this.isAudioOnly, // Send our current mode (might have changed if we lack camera)
                sender: UserManager.userId
            });
        } catch (error) {
            Utils.log(`Failed to accept call: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Accept call failed: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-rejected',
                reason: 'device_error', // Let peer know it was a device issue on our side
                sender: UserManager.userId
            });
            this.endCallCleanup();
        }
    },

    rejectCall: function () {
        this.hideCallRequest();
        if (!this.currentPeerId) return;
        ConnectionManager.sendTo(this.currentPeerId, {
            type: 'video-call-rejected',
            reason: 'user_rejected',
            sender: UserManager.userId
        });
        this.endCallCleanup();
        Utils.log('Rejected call request.', Utils.logLevels.INFO);
    },

    startLocalStreamAndSignal: async function(isOfferCreatorForMedia) {
        let attemptLocalVideoSending = !this.isAudioOnly;

        try {
            if (attemptLocalVideoSending) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (!devices.some(d => d.kind === 'videoinput')) {
                    if (!this.isAudioOnly) UIManager.showNotification('No camera detected. You will send audio only.', 'warning');
                    attemptLocalVideoSending = false;
                }
            }

            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: attemptLocalVideoSending,
                audio: this.audioConstraints
            });

            if (attemptLocalVideoSending && (this.localStream.getVideoTracks().length === 0 || this.localStream.getVideoTracks()[0].readyState === 'ended')) {
                this.isVideoEnabled = false;
                if (!this.isAudioOnly) UIManager.showNotification('Could not use camera. Sending audio only.', 'warning');
                // If video failed but audio is okay, make sure audio track is still part of the stream
                if (this.localStream.getAudioTracks().length === 0) { // This case should be rare if audio constraint was met
                    this.localStream.getTracks().forEach(t => t.stop()); // Stop potentially partial stream
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints }); // Get audio only
                }
            } else if (!attemptLocalVideoSending) {
                this.isVideoEnabled = false;
            } else {
                this.isVideoEnabled = true;
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia error: ${getUserMediaError.name} - ${getUserMediaError.message}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            if (attemptLocalVideoSending && !this.isAudioOnly) { // Only show error if user expected video
                UIManager.showNotification(`Camera error: ${getUserMediaError.name}. Sending audio only.`, 'error');
            }
            try {
                if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
            } catch (audioError) {
                Utils.log(`Fallback audio getUserMedia error: ${audioError.name}`, Utils.logLevels.ERROR);
                throw audioError; // Propagate if audio also fails
            }
        }

        // Apply mute state to the new stream's tracks
        if (this.localStream.getAudioTracks()[0]) {
            this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        }
        if (this.localStream.getVideoTracks()[0]) { // Check if video track exists
            this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;
        }

        this.localVideo.srcObject = this.localStream;
        this.isCallActive = true;
        this.isCallPending = false;

        this.updateUIForCallType();
        document.getElementById('videoCallContainer').style.display = 'flex';

        await this.setupPeerConnection(isOfferCreatorForMedia);

        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(() => this.collectAndSendStats(), 5000);
    },

    setupPeerConnection: async function (isOfferCreatorForMedia) {
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("setupPeerConnection: No PeerConnection found.", Utils.logLevels.ERROR);
            this.endCall();
            return;
        }
        const pc = conn.peerConnection;

        pc.getSenders().forEach(sender => {
            if (sender.track) { try { pc.removeTrack(sender); } catch(e){Utils.log("Error removing old track from sender: " + e, Utils.logLevels.WARN);} }
        });

        this.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio') {
                pc.addTrack(track, this.localStream);
            } else if (track.kind === 'video' && this.isVideoEnabled) { // Only add video track if local sending is enabled
                pc.addTrack(track, this.localStream);
            }
        });

        this.setCodecPreferences(pc);

        pc.ontrack = (event) => {
            const stream = event.streams && event.streams[0] ? event.streams[0] : null;

            if (stream) {
                this.remoteVideo.srcObject = stream;
                this.remoteStream = stream;
                const videoTracks = stream.getVideoTracks();
                const hasVideo = videoTracks && videoTracks.length > 0 && videoTracks.some(t => t.readyState === "live" && !t.muted && t.enabled);

                this.remoteVideo.style.display = (hasVideo && !document.getElementById('videoCallContainer').classList.contains('audio-only-mode')) ? 'block' : 'none';
            } else if (event.track) {
                if (!this.remoteStream || (event.streams && event.streams[0] && this.remoteStream.id !== event.streams[0].id) ) {
                    this.remoteStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream();
                }
                if (!this.remoteStream.getTracks().includes(event.track)) {
                    this.remoteStream.addTrack(event.track);
                }
                this.remoteVideo.srcObject = this.remoteStream;

                const videoTracks = this.remoteStream.getVideoTracks();
                const hasVideo = videoTracks && videoTracks.length > 0 && videoTracks.some(t => t.readyState === "live" && !t.muted && t.enabled);
                this.remoteVideo.style.display = (hasVideo && !document.getElementById('videoCallContainer').classList.contains('audio-only-mode')) ? 'block' : 'none';
            }
            this.updateUIForCallType(); // Re-evaluate remote video display
        };

        // Setup other PC event handlers like oniceconnectionstatechange if not already handled by ConnectionManager
        this.setupConnectionMonitoring(pc);


        if (isOfferCreatorForMedia) {
            await this.createAndSendOffer();
        }
    },

    setupConnectionMonitoring: function(pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`Call ICE State: ${pc.iceConnectionState} for ${this.currentPeerId}`, Utils.logLevels.DEBUG);
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                if (this.isCallActive) { // Only act if the call was considered active
                    UIManager.showNotification('Call connection issue detected.', 'warning');
                    // Consider attempting ICE restart or ending the call
                    // For simplicity now, we might just end it if it's 'failed' or 'closed'
                    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                        this.endCall();
                    }
                }
            }
        };
    },

    setCodecPreferences: function(pc) {
        if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) {
            Utils.log("setCodecPreferences not supported by this browser.", Utils.logLevels.WARN);
            return;
        }
        try {
            pc.getTransceivers().forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return; // Skip if no track to base kind on
                const kind = transceiver.sender.track.kind;

                if (kind === 'audio') {
                    const { codecs } = RTCRtpSender.getCapabilities('audio');
                    const preferredAudio = this.codecPreferences.audio
                        .map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() && (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.includes(pref.sdpFmtpLine.split(';')[0]))))) // Match first part of fmtpLine for flexibility
                        .filter(c => c);
                    if (preferredAudio.length > 0) {
                        try { transceiver.setCodecPreferences(preferredAudio); } catch (e) { Utils.log(`Failed to set audio codec prefs for transceiver: ${e.message}`, Utils.logLevels.WARN); }
                    }
                } else if (kind === 'video' && !this.isAudioOnly) {
                    const { codecs } = RTCRtpSender.getCapabilities('video');
                    const preferredVideo = this.codecPreferences.video
                        .map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase()))
                        .filter(c => c);
                    if (preferredVideo.length > 0) {
                        try { transceiver.setCodecPreferences(preferredVideo); } catch (e) { Utils.log(`Failed to set video codec prefs for transceiver: ${e.message}`, Utils.logLevels.WARN); }
                    }
                }
            });
        } catch (error) {
            Utils.log(`Error iterating transceivers for codec preferences: ${error.message}`, Utils.logLevels.WARN);
        }
    },

    modifySdpForOpus: function(sdp) {
        const opusRegex = /a=rtpmap:(\d+) opus\/48000\/2/gm;
        let match;
        let modifiedSdp = sdp;
        const opusTargetParams = this.codecPreferences.audio.find(p => p.mimeType === 'audio/opus')?.sdpFmtpLine || 'minptime=10;useinbandfec=1';

        while ((match = opusRegex.exec(sdp)) !== null) {
            const opusPayloadType = match[1];
            // Ensure we are looking for the correct rtpmap line to append to.
            const rtpmapLineSignature = `a=rtpmap:${opusPayloadType} opus/48000/2`;
            const fmtpLineForPayload = `a=fmtp:${opusPayloadType} ${opusTargetParams}`;

            // Check if an fmtp line for this payload already exists
            const existingFmtpRegex = new RegExp(`^a=fmtp:${opusPayloadType} .*(\\r\\n)?`, 'm');
            if (existingFmtpRegex.test(modifiedSdp)) {
                // If it exists, replace it to ensure our params take precedence
                modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$2 || '\r\n'));
            } else {
                // If it doesn't exist, find the rtpmap line and insert fmtp after it
                const rtpmapLineIndex = modifiedSdp.indexOf(rtpmapLineSignature);
                if (rtpmapLineIndex !== -1) {
                    const endOfRtpmapLine = modifiedSdp.indexOf('\n', rtpmapLineIndex);
                    const insertPosition = (endOfRtpmapLine !== -1) ? endOfRtpmapLine : modifiedSdp.length; // Should always find \n
                    modifiedSdp = modifiedSdp.slice(0, insertPosition) + `\r\n${fmtpLineForPayload}` + modifiedSdp.slice(insertPosition);
                }
            }
        }
        return modifiedSdp;
    },

    mergeSdpFmtpParams: function(existingStr, newStr) { /* Not actively used with current modifySdpForOpus, but kept for reference */
        const params = {}; /* ... */ return Object.entries(params).map(([k,v])=>v===true?k:`${k}=${v}`).join(';');
    },

    createAndSendOffer: async function () {
        if (!this.currentPeerId || !this.isCallActive) return; // Ensure call is active
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("No PC to create offer",Utils.logLevels.ERROR); return; }
        try {
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: !this.isAudioOnly,
                // iceRestart: true // Consider adding this if renegotiation is due to network issues
            };
            const offer = await conn.peerConnection.createOffer(offerOptions);
            let sdp = this.modifySdpForOpus(offer.sdp);
            const modifiedOffer = new RTCSessionDescription({ type: 'offer', sdp: sdp });
            await conn.peerConnection.setLocalDescription(modifiedOffer);
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-offer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                sender: UserManager.userId
            });
        } catch (e) { Utils.log("Error creating/sending offer: " + e, Utils.logLevels.ERROR); this.endCall(); }
    },

    handleOffer: async function (sdpOffer, peerId, remoteIsAudioOnly) {
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) { Utils.log("No PC to handle offer",Utils.logLevels.ERROR); return; }
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            if (!this.isCallActive) {
                this.currentPeerId = peerId;
                this.isAudioOnly = remoteIsAudioOnly;
                this.isCaller = false; // We are receiving the offer that starts the call
                await this.startLocalStreamAndSignal(false); // Will setup local stream and then PC
            }
            // If already active, local stream should be set. Now create answer.

            const answer = await conn.peerConnection.createAnswer(); // No specific options needed for answer related to receive preference
            let sdp = this.modifySdpForOpus(answer.sdp);
            const modifiedAnswer = new RTCSessionDescription({ type: 'answer', sdp: sdp });
            await conn.peerConnection.setLocalDescription(modifiedAnswer);
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                sender: UserManager.userId
            });
        } catch (e) { Utils.log("Error handling offer: " + e, Utils.logLevels.ERROR); this.endCall(); }
    },

    handleAnswer: async function (sdpAnswer, peerId, remoteIsAudioOnly) {
        if (this.currentPeerId !== peerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) return;
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`Answer from ${peerId} processed. Call should be established/updated.`, Utils.logLevels.INFO);
        } catch (e) { Utils.log("Error handling answer: " + e, Utils.logLevels.ERROR); this.endCall(); }
    },

    toggleCamera: function () {
        if (!this.isCallActive) return;
        if (this.isAudioOnly) {
            this.toggleAudioOnly();
            return;
        }

        if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
            if (!this.isAudioOnly) { // We are in video mode but have no video track
                Utils.log("Attempting to re-enable video via toggleAudioOnly as no local video track exists.", Utils.logLevels.WARN)
                this.toggleAudioOnly(); // This will try to get video
            } else {
                UIManager.showNotification('No local camera to toggle.', 'warning');
            }
            return;
        }
        this.isVideoEnabled = !this.isVideoEnabled;
        this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;
        this.updateUIForCallType();
    },

    toggleAudio: function () {
        if (!this.isCallActive || !this.localStream || !this.localStream.getAudioTracks()[0]) return;
        this.isAudioMuted = !this.isAudioMuted;
        this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        this.updateUIForCallType();
    },

    toggleAudioOnly: async function () {
        if (!this.isCallActive) return;
        const newCallAudioOnlyState = !this.isAudioOnly;
        let newLocalStream = null;
        let newLocalVideoSendingEnabled = !newCallAudioOnlyState;

        try {
            if (newCallAudioOnlyState === false) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (!devices.some(d => d.kind === 'videoinput')) {
                    UIManager.showNotification("No camera detected. Cannot switch to video call mode.", "warning");
                    // If already audio-only, and no camera, prevent switching TO video mode.
                    if (this.isAudioOnly) return;
                    newLocalVideoSendingEnabled = false; // Can't send video, but call *mode* might still be video
                } else {
                    try {
                        const testStream = await navigator.mediaDevices.getUserMedia({ video: true });
                        testStream.getTracks().forEach(track => track.stop());
                    } catch (permError) {
                        UIManager.showNotification("Camera permission denied. Cannot switch to video call mode.", "warning");
                        if (this.isAudioOnly) return;
                        newLocalVideoSendingEnabled = false;
                    }
                }
            }

            newLocalStream = await navigator.mediaDevices.getUserMedia({
                video: newLocalVideoSendingEnabled,
                audio: this.audioConstraints
            });

            if (newLocalVideoSendingEnabled && (newLocalStream.getVideoTracks().length === 0 || newLocalStream.getVideoTracks()[0].readyState === 'ended')) {
                newLocalVideoSendingEnabled = false;
                if (!newCallAudioOnlyState) UIManager.showNotification("Could not start video. Call mode is video, but sending audio only.", "warning");
            }

            if (this.localStream) this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = newLocalStream;

            this.isAudioOnly = newCallAudioOnlyState;
            this.isVideoEnabled = newLocalVideoSendingEnabled;

            if (this.localStream.getAudioTracks()[0]) this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
            if (this.localStream.getVideoTracks()[0]) this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;

            this.localVideo.srcObject = this.localStream;

            const conn = ConnectionManager.connections[this.currentPeerId];
            if (!conn || !conn.peerConnection) throw new Error("PeerConnection not found for mode switch.");
            const pc = conn.peerConnection;

            const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
            const currentAudioTrack = this.localStream.getAudioTracks()[0];
            if (audioSender && currentAudioTrack) await audioSender.replaceTrack(currentAudioTrack);
            else if (currentAudioTrack) pc.addTrack(currentAudioTrack, this.localStream);

            const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
            const currentVideoTrack = this.localStream.getVideoTracks()[0];

            if (videoSender) {
                await videoSender.replaceTrack(this.isVideoEnabled && currentVideoTrack ? currentVideoTrack : null);
            } else if (this.isVideoEnabled && currentVideoTrack) {
                pc.addTrack(currentVideoTrack, this.localStream);
            }

            this.setCodecPreferences(pc);
            // Update UI *after* tracks are managed and before offer, so UI reflects what's being offered
            this.updateUIForCallType();

            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-mode-change',
                audioOnly: this.isAudioOnly,
                sender: UserManager.userId
            });
            await this.createAndSendOffer();
        } catch (error) {
            Utils.log(`Failed to switch call mode: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Mode switch failed: ${error.message}`, 'error');
            if (newLocalStream) newLocalStream.getTracks().forEach(track => track.stop());
            this.updateUIForCallType(); // Re-assert UI based on PREVIOUS stable state.
        }
    },

    updateUIForCallType: function () {
        const callContainer = document.getElementById('videoCallContainer');
        const localVideoEl = this.localVideo;
        const remoteVideoEl = this.remoteVideo;
        const audioOnlyBtn = document.getElementById('audioOnlyBtn');
        const cameraBtn = document.getElementById('toggleCameraBtn');
        const audioBtn = document.getElementById('toggleAudioBtn');

        if (!callContainer) return; // Exit if UI elements are not ready (e.g. during teardown)

        callContainer.classList.toggle('audio-only-mode', this.isAudioOnly);

        if (localVideoEl) {
            localVideoEl.style.display = (!this.isAudioOnly && this.isVideoEnabled) ? 'block' : 'none';
        }

        if (remoteVideoEl) {
            const hasRemoteVideo = this.remoteStream && this.remoteStream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
            if (this.isAudioOnly) {
                remoteVideoEl.style.display = 'none';
            } else {
                remoteVideoEl.style.display = hasRemoteVideo ? 'block' : 'none';
            }
        }

        if (audioOnlyBtn) {
            audioOnlyBtn.style.background = this.isAudioOnly ? 'var(--primary-color)' : '#fff';
            audioOnlyBtn.style.color = this.isAudioOnly ? 'white' : 'var(--text-color)';
            audioOnlyBtn.innerHTML = this.isAudioOnly ? '🎬' : '🔊';
            audioOnlyBtn.title = this.isAudioOnly ? 'Switch to Video Call' : 'Switch to Audio-Only Call';
        }
        if (cameraBtn) {
            cameraBtn.style.display = this.isAudioOnly ? 'none' : 'inline-block';
            if (!this.isAudioOnly) {
                cameraBtn.innerHTML = this.isVideoEnabled ? '📹' : '🚫';
                cameraBtn.style.background = this.isVideoEnabled ? '#fff' : '#666';
                cameraBtn.style.color = this.isVideoEnabled ? 'var(--text-color)' : 'white';
            }
        }
        if (audioBtn) {
            audioBtn.innerHTML = this.isAudioMuted ? '🔇' : '🎤';
            audioBtn.style.background = this.isAudioMuted ? '#666' : '#fff';
            audioBtn.style.color = this.isAudioMuted ? 'white' : 'var(--text-color)';
        }
    },

    endCall: function () {
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        if ((this.isCallActive || this.isCallPending) && this.currentPeerId) {
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-end', sender: UserManager.userId });
        }
        this.endCallCleanup();
    },

    endCallCleanup: function() {
        if (this.statsInterval) clearInterval(this.statsInterval); this.statsInterval = null;
        this.releaseMediaResources();
        if (this.localVideo) this.localVideo.srcObject = null;
        if (this.remoteVideo) this.remoteVideo.srcObject = null; this.remoteStream = null;

        const callContainer = document.getElementById('videoCallContainer');
        if(callContainer) callContainer.style.display = 'none';
        this.hideCallRequest();

        const oldPeerId = this.currentPeerId;
        this.isCallActive = false; this.isCallPending = false; this.isCaller = false;
        this.isAudioMuted = false; this.isVideoEnabled = true; this.isAudioOnly = false;
        this.currentPeerId = null;

        if (oldPeerId && ConnectionManager.connections[oldPeerId]) {
            const pc = ConnectionManager.connections[oldPeerId].peerConnection;
            if (pc) {
                pc.getSenders().forEach(sender => {
                    if (sender.track && (sender.track.kind === 'audio' || sender.track.kind === 'video')) {
                        try {
                            // sender.track.stop(); // Track should be stopped by releaseMediaResources or when stream is replaced
                            pc.removeTrack(sender);
                        } catch (e) { Utils.log(`Error removing track from sender for ${oldPeerId}: ${e}`, Utils.logLevels.WARN); }
                    }
                });
                pc.ontrack = null;
            }
        }
        Utils.log('Call resources cleaned up.', Utils.logLevels.INFO);
        this.updateUIForCallType(); // Ensure UI is reset
    },

    releaseMediaResources: function () {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        // No need to stop remoteStream tracks, they are controlled by the remote peer.
    },

    handleMessage: function (message, peerId) {
        switch (message.type) {
            case 'video-call-request':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    this.showCallRequest(peerId, message.audioOnly || false);
                } else {
                    ConnectionManager.sendTo(peerId, { type: 'video-call-rejected', reason: 'busy', sender: UserManager.userId });
                }
                break;
            case 'video-call-accepted':
                if (this.isCallPending && this.isCaller && this.currentPeerId === peerId) {
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
                    if (typeof message.audioOnly === 'boolean') {
                        this.isAudioOnly = message.audioOnly;
                        // isVideoEnabled will be determined by startLocalStreamAndSignal based on this.isAudioOnly and camera availability
                    }
                    this.startLocalStreamAndSignal(true);
                }
                break;
            case 'video-call-rejected':
            case 'video-call-cancel':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
                    const reason = message.type === 'video-call-rejected' ? (message.reason || 'rejected') : 'cancelled';
                    UIManager.showNotification(`Call ${reason} by ${UserManager.contacts[peerId]?.name || 'peer'}.`, 'warning');
                    this.endCallCleanup();
                }
                break;
            case 'video-call-offer':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    // this.currentPeerId will be set in handleOffer
                    // this.isAudioOnly will be set in handleOffer
                    this.isCaller = false;
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false); // Pass remote's preference
                } else if (this.isCallActive && this.currentPeerId === peerId) {
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false);
                }
                break;
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) {
                    this.handleAnswer(message.sdp, peerId, message.audioOnly || false); // Pass remote's confirmation
                }
                break;
            case 'video-call-mode-change':
                if (this.isCallActive && this.currentPeerId === peerId) {
                    if (this.isAudioOnly !== message.audioOnly) { // If mode actually changes
                        // Peer is informing us of *their* new mode. We should try to match if possible,
                        // or at least update our UI for receiving.
                        // For now, we just acknowledge by updating our 'isAudioOnly' for receiving.
                        // A more complex system might involve renegotiation.
                        this.isAudioOnly = message.audioOnly;
                        // this.isVideoEnabled would typically remain our sending capability.
                        // If peer switches to audio-only, we might want to stop sending video if we were.
                        // This part can be complex. For simplicity, we just update our UI based on their mode.
                        this.updateUIForCallType();
                        UIManager.showNotification(`Peer switched to ${this.isAudioOnly ? 'audio-only' : 'video'} mode.`, 'info');
                    }
                }
                break;
            case 'video-call-end':
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    this.endCallCleanup();
                    UIManager.showNotification(`${UserManager.contacts[peerId]?.name || 'Peer'} ended the call.`, 'info');
                }
                break;
            case 'video-call-stats':
                if (this.isCallActive && this.currentPeerId === peerId) {
                    this.handleCallStats(message.stats);
                }
                break;
        }
    },
    handleCallStats: function(stats) {
        if (stats && typeof stats.rtt === 'number') {
            Utils.log(`Call RTT to ${this.currentPeerId}: ${stats.rtt}ms. Packets Lost: ${stats.packetsLost || 'N/A'}`, Utils.logLevels.DEBUG);
        }
    },
    collectAndSendStats: async function() {
        if (!this.isCallActive || !this.currentPeerId) return;
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection || typeof conn.peerConnection.getStats !== 'function') return;

        try {
            const reports = await conn.peerConnection.getStats(null);
            let relevantStats = { rtt: null, packetsLost: null, jitter: null, bytesSent: null, bytesReceived: null };
            reports.forEach(report => {
                if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') { // Stats for audio received from peer
                    if (report.roundTripTime !== undefined) relevantStats.rtt = Math.round(report.roundTripTime * 1000);
                    if (report.packetsLost !== undefined) relevantStats.packetsLost = report.packetsLost; // Cumulative
                    if (report.jitter !== undefined) relevantStats.jitter = report.jitter;
                }
                if (report.type === 'outbound-rtp' && report.kind === 'audio') { // Stats for audio sent to peer
                    if (report.bytesSent !== undefined) relevantStats.bytesSent = report.bytesSent;
                }
                if (report.type === 'inbound-rtp' && report.kind === 'audio') { // Stats for audio received by us
                    if (report.bytesReceived !== undefined) relevantStats.bytesReceived = report.bytesReceived;
                }
            });
            if (relevantStats.rtt !== null) {
                ConnectionManager.sendTo(this.currentPeerId, {
                    type: 'video-call-stats',
                    stats: relevantStats,
                    sender: UserManager.userId
                });
            }
        } catch (e) {
            Utils.log("Error collecting WebRTC stats: " + e, Utils.logLevels.WARN);
        }
    },
};