
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
    isVideoEnabled: true,
    isAudioOnly: false,
    callRequestTimeout: null,
    isScreenSharing: false, // New state for screen sharing
    statsInterval: null,
    isPipMode: false, // For Picture-in-Picture mode
    pipButton: null,
    dragInfo: { // For PiP dragging
        active: false,
        currentX: 0,
        currentY: 0,
        initialX: 0,
        initialY: 0,
        xOffset: 0,
        yOffset: 0,
        draggedElement: null
    },
    musicPlayer: null,
    isMusicPlaying: false,
    _boundEnableMusicPlay: null, // For removing event listener

    audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
    },

    codecPreferences: {
        audio: [
            {
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
                sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000;dtx=0'
            }
        ],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },

    init: function () {
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.pipButton = document.getElementById('togglePipBtn'); // Get PiP button

        try {
            this.musicPlayer = new Audio(Config.music); // Assuming music.mp3 is in the root
            this.musicPlayer.loop = true;
            this.musicPlayer.addEventListener('ended', () => {
                if (this.isMusicPlaying) {
                    this.musicPlayer.currentTime = 0;
                    this.musicPlayer.play().catch(e => Utils.log(`Music loop error: ${e}`, Utils.logLevels.WARN));
                }
            }, false);
        } catch (e) {
            Utils.log(`Error initializing Audio object for music: ${e}`, Utils.logLevels.ERROR);
            this.musicPlayer = null;
        }


        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('Browser does not support media devices (getUserMedia). Call functions will be disabled.', Utils.logLevels.ERROR);
            return false;
        }

        if (this.pipButton) {
            this.pipButton.addEventListener('click', () => this.togglePipMode());
        }
        return true;
    },

    playMusic: function (isRetry = false) {
        if (this.musicPlayer && this.musicPlayer.paused && !this.isMusicPlaying) {
            Utils.log("Attempting to play music...", Utils.logLevels.DEBUG);
            this.musicPlayer.play().then(() => {
                this.isMusicPlaying = true;
                Utils.log("Music started playing.", Utils.logLevels.INFO);
                if (isRetry && this._boundEnableMusicPlay) {
                    document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                    document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                    delete this._boundEnableMusicPlay;
                }
            }).catch(error => {
                Utils.log(`Error playing music: ${error.name} - ${error.message}`, Utils.logLevels.ERROR);
                if (error.name === 'NotAllowedError' && !isRetry) {
                    UIManager.showNotification("Music playback blocked. Click/tap anywhere to enable.", "warning");
                    this._boundEnableMusicPlay = () => this.playMusic(true);
                    document.body.addEventListener('click', this._boundEnableMusicPlay, {once: true, capture: true});
                    document.body.addEventListener('touchstart', this._boundEnableMusicPlay, {
                        once: true,
                        capture: true
                    });
                }
            });
        } else if (this.isMusicPlaying) {
            Utils.log("Music is already playing or play attempt in progress.", Utils.logLevels.DEBUG);
        } else if (!this.musicPlayer) {
            Utils.log("Music player not available.", Utils.logLevels.WARN);
        }
    },

    stopMusic: function () {
        if (this.musicPlayer && (!this.musicPlayer.paused || this.isMusicPlaying)) {
            this.musicPlayer.pause();
            this.musicPlayer.currentTime = 0;
            this.isMusicPlaying = false;
            Utils.log("Music stopped.", Utils.logLevels.INFO);
            if (this._boundEnableMusicPlay) {
                document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                delete this._boundEnableMusicPlay;
            }
        }
    },

    initiateAudioCall: function (peerId) {
        this.initiateCall(peerId, true);
    },

    initiateScreenShare: async function (peerId) {
        if (this.isCallActive || this.isCallPending) {
            UIManager.showNotification('A call or share is already active or pending.', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) {
            UIManager.showNotification('Please select a chat partner to share screen with.', 'warning');
            return;
        }
        if (!ConnectionManager.isConnectedTo(peerId)) {
            UIManager.showNotification('Not connected to peer. Cannot initiate screen share.', 'error');
            return;
        }

        this.isScreenSharing = true;
        this.isAudioOnly = false;       // Screen share implies video (the screen itself)
        this.isVideoEnabled = true; // The screen track is considered the video
        this.isAudioMuted = false;      // User can mute audio if they wish

        try {
            this.currentPeerId = peerId; // Set currentPeerId here for UIManager.showCallingModal
            this.isCaller = true;
            this.isCallPending = true;

            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly, // will be false
                isScreenShare: this.isScreenSharing, // true
                sender: UserManager.userId
            });

            UIManager.showCallingModal(
                UserManager.contacts[peerId]?.name || 'peer',
                () => this.endCall(), // onCancelCall
                () => this.stopMusic(), // onStopMusicOnly
                'Screen Share'
            );
            this.playMusic();


            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) {
                    ConnectionManager.sendTo(this.currentPeerId, {
                        type: 'video-call-cancel',
                        sender: UserManager.userId
                    });
                    this.endCall(); // endCall will call endCallCleanup which stops music and hides modal
                }
            }, 30000);
        } catch (error) {
            Utils.log(`Failed to initiate screen share: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.showNotification('Failed to initiate screen share.', 'error');
            this.endCallCleanup();
        }
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

        this.isAudioOnly = audioOnly;
        this.isScreenSharing = false; // Explicitly not screen sharing for regular call
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;

        try {
            this.currentPeerId = peerId; // Set currentPeerId here for UIManager.showCallingModal
            this.isCaller = true;
            this.isCallPending = true;

            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing, // will be false
                sender: UserManager.userId
            });

            UIManager.showCallingModal(
                UserManager.contacts[peerId]?.name || 'peer',
                () => this.endCall(), // onCancelCall
                () => this.stopMusic(), // onStopMusicOnly
                this.isAudioOnly ? 'Audio Call' : 'Video Call'
            );
            this.playMusic();

            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) {
                    ConnectionManager.sendTo(this.currentPeerId, {
                        type: 'video-call-cancel',
                        sender: UserManager.userId
                    });
                    this.endCall(); // endCall will call endCallCleanup
                }
            }, 30000);
        } catch (error) {
            Utils.log(`Failed to initiate call: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.showNotification('Failed to initiate call.', 'error');
            this.endCallCleanup();
        }
    },

    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        this.currentPeerId = peerId;
        this.isAudioOnly = audioOnly;
        this.isScreenSharing = isScreenShare;
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;
        this.isCaller = false;

        const requestModal = document.getElementById('videoCallRequest');
        const requestTitle = requestModal.querySelector('h3');
        const requestDesc = requestModal.querySelector('p');
        const avatarEl = requestModal.querySelector('.video-call-avatar');

        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0, 4)}`;
        let avatarContentHtml = (UserManager.contacts[peerId]?.name?.charAt(0).toUpperCase() || 'P');

        const peerContact = UserManager.contacts[peerId];
        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${Utils.escapeHtml(peerName.charAt(0))}" class="avatar-image">`;
        } else {
            avatarContentHtml = Utils.escapeHtml(avatarContentHtml); // Escape if it's text
        }
        if (avatarEl) avatarEl.innerHTML = avatarContentHtml;


        let callTypeString = "Video Call";
        if (this.isScreenSharing) {
            callTypeString = "Screen Share";
        } else if (this.isAudioOnly) {
            callTypeString = "Audio Call";
        }
        if (requestTitle) requestTitle.textContent = `${callTypeString} Request`;
        if (requestDesc) requestDesc.textContent = `${peerName} ${this.isScreenSharing ? 'wants to share screen' : 'is calling'}...`;
        requestModal.style.display = 'flex';
        this.playMusic();
    },

    hideCallRequest: function () {
        const requestModal = document.getElementById('videoCallRequest');
        if (requestModal) requestModal.style.display = 'none';
    },

    acceptCall: async function () {
        this.hideCallRequest();
        this.stopMusic(); // Callee stops music on accept
        if (!this.currentPeerId) {
            UIManager.showNotification('Invalid call request.', 'error');
            return;
        }
        try {
            if (this.isScreenSharing) {
                this.isVideoEnabled = false;
            }

            await this.startLocalStreamAndSignal(false);

            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (error) {
            Utils.log(`Failed to accept call: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.showNotification(`Accept call failed: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-rejected',
                reason: 'device_error',
                sender: UserManager.userId
            });
            this.endCallCleanup();
        }
    },

    rejectCall: function () {
        this.hideCallRequest();
        this.stopMusic(); // Callee stops music on reject
        if (!this.currentPeerId) return;
        ConnectionManager.sendTo(this.currentPeerId, {
            type: 'video-call-rejected',
            reason: 'user_rejected',
            sender: UserManager.userId
        });
        this.endCallCleanup();
        Utils.log('Rejected call request.', Utils.logLevels.INFO);
    },

    startLocalStreamAndSignal: async function (isOfferCreatorForMedia) {
        let attemptLocalCameraVideoSending = !this.isAudioOnly && !this.isScreenSharing;

        try {
            if (this.isScreenSharing) {
                if (this.isCaller) {
                    this.localStream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
                    this.isVideoEnabled = true;

                    const screenTrack = this.localStream.getVideoTracks()[0];
                    if (screenTrack) {
                        screenTrack.onended = () => {
                            Utils.log("Screen sharing ended by user (browser UI).", Utils.logLevels.INFO);
                            this.endCall();
                        };
                    }
                    if (this.localStream.getAudioTracks().length === 0) {
                        try {
                            const micStream = await navigator.mediaDevices.getUserMedia({
                                audio: this.audioConstraints,
                                video: false
                            });
                            micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                            Utils.log("Added microphone audio to screen share stream.", Utils.logLevels.INFO);
                        } catch (micError) {
                            Utils.log(`Could not get microphone audio for screen share: ${micError.message}`, Utils.logLevels.WARN);
                        }
                    }
                } else {
                    this.localStream = await navigator.mediaDevices.getUserMedia({
                        video: false,
                        audio: this.audioConstraints
                    });
                    this.isVideoEnabled = false;
                }
            } else {
                if (attemptLocalCameraVideoSending) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if (!this.isAudioOnly) UIManager.showNotification('No camera detected. You will send audio only for this video call.', 'warning');
                        attemptLocalCameraVideoSending = false;
                    }
                }
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: attemptLocalCameraVideoSending,
                    audio: this.audioConstraints
                });
                this.isVideoEnabled = attemptLocalCameraVideoSending && this.localStream.getVideoTracks().length > 0 && this.localStream.getVideoTracks()[0].readyState !== 'ended';

                if (attemptLocalCameraVideoSending && !this.isVideoEnabled) {
                    if (!this.isAudioOnly) UIManager.showNotification('Could not use camera. Sending audio only for this video call.', 'warning');
                }
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia error: ${getUserMediaError.name} - ${getUserMediaError.message}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            if (this.isScreenSharing && this.isCaller) {
                UIManager.showNotification(`Screen share error: ${getUserMediaError.name}. Call cannot proceed.`, 'error');
                this.endCallCleanup();
                throw getUserMediaError;
            } else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) {
                UIManager.showNotification(`Camera error: ${getUserMediaError.name}. Switching to audio only.`, 'error');
            }
            try {
                if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: false,
                    audio: this.audioConstraints
                });
                this.isAudioOnly = true;
                this.isVideoEnabled = false;
                if (this.isScreenSharing) this.isScreenSharing = false;
            } catch (audioError) {
                Utils.log(`Fallback audio getUserMedia error: ${audioError.name}`, Utils.logLevels.ERROR);
                this.endCallCleanup();
                throw audioError;
            }
        }

        if (this.localStream.getAudioTracks()[0]) {
            this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        }
        if (this.localStream.getVideoTracks()[0]) {
            this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;
        }

        if (this.isScreenSharing && this.isCaller) {
            this.localVideo.srcObject = null;
            this.localVideo.style.display = 'none';
        } else if (this.isScreenSharing && !this.isCaller) {
            this.localVideo.srcObject = null;
            this.localVideo.style.display = 'none';
        } else {
            if (!this.isAudioOnly && this.isVideoEnabled) {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.style.display = 'block';
            } else {
                this.localVideo.srcObject = null;
                this.localVideo.style.display = 'none';
            }
        }

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
            if (sender.track) {
                try {
                    pc.removeTrack(sender);
                } catch (e) {
                    Utils.log("Error removing old track from sender: " + e, Utils.logLevels.WARN);
                }
            }
        });

        this.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio') {
                pc.addTrack(track, this.localStream);
            } else if (track.kind === 'video' && this.isVideoEnabled) {
                if ((!this.isScreenSharing && this.isVideoEnabled) || (this.isScreenSharing && this.isCaller && this.isVideoEnabled)) {
                    pc.addTrack(track, this.localStream);
                }
            }
        });

        this.setCodecPreferences(pc);

        pc.ontrack = (event) => {
            Utils.log(`ontrack event: track kind=${event.track.kind}, id=${event.track.id}, streams associated: ${event.streams.length}`, Utils.logLevels.DEBUG);

            const trackHandler = (track) => {
                if (!track._videoManagerListenersAttached) {
                    track.onunmute = () => {
                        Utils.log(`Remote track ${track.id} (${track.kind}) unmuted.`, Utils.logLevels.DEBUG);
                        this.updateUIForCallType();
                        if (track.kind === 'video' && this.remoteVideo && this.remoteVideo.paused) {
                            this.remoteVideo.play().catch(e => Utils.log(`Error playing remote video on unmute: ${e}`, Utils.logLevels.WARN));
                        }
                    };
                    track.onmute = () => {
                        Utils.log(`Remote track ${track.id} (${track.kind}) muted.`, Utils.logLevels.DEBUG);
                        this.updateUIForCallType();
                    };
                    track.onended = () => {
                        Utils.log(`Remote track ${track.id} (${track.kind}) ended.`, Utils.logLevels.DEBUG);
                        if (this.remoteStream && this.remoteStream.getTrackById(track.id)) {
                            try {
                                this.remoteStream.removeTrack(track);
                                Utils.log(`Removed track ${track.id} from remoteStream.`, Utils.logLevels.DEBUG);
                            } catch (e) {
                                Utils.log(`Error removing track ${track.id} from remoteStream: ${e}`, Utils.logLevels.WARN);
                            }
                        }
                        if (track.kind === 'video' && this.isScreenSharing && !this.isCaller) {
                            Utils.log("Remote screen share track ended. Ending call.", Utils.logLevels.INFO);
                            this.endCall();
                        } else {
                            this.updateUIForCallType();
                        }
                    };
                    track._videoManagerListenersAttached = true;
                }
            };

            if (event.streams && event.streams[0]) {
                const incomingStream = event.streams[0];
                if (this.remoteVideo.srcObject !== incomingStream) {
                    this.remoteVideo.srcObject = incomingStream;
                    this.remoteStream = incomingStream;
                    Utils.log(`Assigned event.streams[0] (id: ${this.remoteStream.id}) to remoteVideo.srcObject.`, Utils.logLevels.INFO);
                }
                if (this.remoteStream) {
                    this.remoteStream.getTracks().forEach(t => trackHandler(t));
                }
                if (event.track) {
                    trackHandler(event.track);
                }

            } else if (event.track) {
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                    if (!this.remoteVideo.srcObject || !(this.remoteVideo.srcObject instanceof MediaStream) || this.remoteVideo.srcObject.getTracks().length === 0) {
                        this.remoteVideo.srcObject = this.remoteStream;
                    }
                    Utils.log(`Initialized new remoteStream (event.track w/o event.streams[0]). Current srcObject: ${this.remoteVideo.srcObject === this.remoteStream ? 'this.remoteStream' : 'other stream'}.`, Utils.logLevels.INFO);
                }
                if (!this.remoteStream.getTrackById(event.track.id)) {
                    this.remoteStream.addTrack(event.track);
                    Utils.log(`Added event.track (id: ${event.track.id}, kind: ${event.track.kind}) to manually managed remoteStream.`, Utils.logLevels.INFO);
                }
                if(this.remoteVideo.srcObject !== this.remoteStream && this.remoteStream.getTracks().length > 0) {
                    this.remoteVideo.srcObject = this.remoteStream;
                }
                trackHandler(event.track);
            }

            this.updateUIForCallType();
        };

        this.setupConnectionMonitoring(pc);

        if (isOfferCreatorForMedia) {
            await this.createAndSendOffer();
        }
    },

    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`Call ICE State: ${pc.iceConnectionState} for ${this.currentPeerId}`, Utils.logLevels.DEBUG);
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                if (this.isCallActive) {
                    UIManager.showNotification('Call connection issue detected.', 'warning');
                    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                        this.endCall();
                    }
                }
            }
        };
    },

    setCodecPreferences: function (pc) {
        if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) {
            Utils.log("setCodecPreferences not supported by this browser.", Utils.logLevels.WARN);
            return;
        }
        try {
            pc.getTransceivers().forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return;
                const kind = transceiver.sender.track.kind;

                if (kind === 'audio') {
                    const {codecs} = RTCRtpSender.getCapabilities('audio');
                    const preferredAudio = this.codecPreferences.audio
                        .map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() && (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.includes(pref.sdpFmtpLine.split(';')[0])))))
                        .filter(c => c);
                    if (preferredAudio.length > 0) {
                        try {
                            transceiver.setCodecPreferences(preferredAudio);
                        } catch (e) {
                            Utils.log(`Failed to set audio codec prefs for transceiver: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                } else if (kind === 'video' && !this.isAudioOnly) {
                    const {codecs} = RTCRtpSender.getCapabilities('video');
                    const preferredVideo = this.codecPreferences.video
                        .map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase()))
                        .filter(c => c);
                    if (preferredVideo.length > 0) {
                        try {
                            transceiver.setCodecPreferences(preferredVideo);
                        } catch (e) {
                            Utils.log(`Failed to set video codec prefs for transceiver: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                }
            });
        } catch (error) {
            Utils.log(`Error iterating transceivers for codec preferences: ${error.message}`, Utils.logLevels.WARN);
        }
    },

    modifySdpForOpus: function (sdp) {
        const opusRegex = /a=rtpmap:(\d+) opus\/48000\/2/gm;
        let match;
        let modifiedSdp = sdp;
        const opusTargetParams = this.codecPreferences.audio.find(p => p.mimeType === 'audio/opus')?.sdpFmtpLine || 'minptime=10;useinbandfec=1';

        while ((match = opusRegex.exec(sdp)) !== null) {
            const opusPayloadType = match[1];
            const rtpmapLineSignature = `a=rtpmap:${opusPayloadType} opus/48000/2`;
            const fmtpLineForPayload = `a=fmtp:${opusPayloadType} ${opusTargetParams}`;
            const existingFmtpRegex = new RegExp(`^a=fmtp:${opusPayloadType} .*(\\r\\n)?`, 'm');
            if (existingFmtpRegex.test(modifiedSdp)) {
                modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$2 || '\r\n'));
            } else {
                const rtpmapLineIndex = modifiedSdp.indexOf(rtpmapLineSignature);
                if (rtpmapLineIndex !== -1) {
                    const endOfRtpmapLine = modifiedSdp.indexOf('\n', rtpmapLineIndex);
                    const insertPosition = (endOfRtpmapLine !== -1) ? endOfRtpmapLine : modifiedSdp.length;
                    modifiedSdp = modifiedSdp.slice(0, insertPosition) + `\r\n${fmtpLineForPayload}` + modifiedSdp.slice(insertPosition);
                }
            }
        }
        return modifiedSdp;
    },

    createAndSendOffer: async function () {
        if (!this.currentPeerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("No PC to create offer", Utils.logLevels.ERROR);
            return;
        }
        try {
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: !this.isAudioOnly || this.isScreenSharing,
            };
            const offer = await conn.peerConnection.createOffer(offerOptions);
            let sdp = this.modifySdpForOpus(offer.sdp);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: sdp});
            await conn.peerConnection.setLocalDescription(modifiedOffer);
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-offer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (e) {
            Utils.log("Error creating/sending offer: " + e, Utils.logLevels.ERROR);
            this.endCall();
        }
    },

    handleOffer: async function (sdpOffer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("No PC to handle offer", Utils.logLevels.ERROR);
            return;
        }
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            if (!this.isCallActive) {
                this.isScreenSharing = remoteIsScreenShare;
                this.isAudioOnly = remoteIsAudioOnly && !remoteIsScreenShare;
                this.currentPeerId = peerId;
                this.isCaller = false;
                this.isVideoEnabled = !this.isAudioOnly && !this.isScreenSharing;

                await this.startLocalStreamAndSignal(false);
            }

            const answer = await conn.peerConnection.createAnswer();
            let sdp = this.modifySdpForOpus(answer.sdp);
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: sdp});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (e) {
            Utils.log("Error handling offer: " + e, Utils.logLevels.ERROR);
            this.endCall();
        }
    },

    handleAnswer: async function (sdpAnswer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        if (this.currentPeerId !== peerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) return;
        try {
            if (remoteIsAudioOnly !== this.isAudioOnly) {
                Utils.log(`Warning: Mismatch in audioOnly state from answer. Peer: ${remoteIsAudioOnly}, Self: ${this.isAudioOnly}. Using self's state.`, Utils.logLevels.WARN);
            }
            if (remoteIsScreenShare !== this.isScreenSharing) {
                Utils.log(`Warning: Mismatch in isScreenShare state from answer. Peer: ${remoteIsScreenShare}, Self: ${this.isScreenSharing}. Using self's state.`, Utils.logLevels.WARN);
            }
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`Answer from ${peerId} processed. Call should be established/updated.`, Utils.logLevels.INFO);
        } catch (e) {
            Utils.log("Error handling answer: " + e, Utils.logLevels.ERROR);
            this.endCall();
        }
    },

    toggleCamera: function () {
        if (!this.isCallActive) return;
        if (this.isAudioOnly) {
            UIManager.showNotification("Camera is not available in an audio-only call.", "warning");
            return;
        }
        if (this.isScreenSharing) {
            UIManager.showNotification("Camera cannot be toggled while screen sharing.", "warning");
            return;
        }
        const videoTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
        if (!videoTrack) {
            UIManager.showNotification('Local video stream is not available. Cannot toggle camera state.', 'warning');
            return;
        }
        this.isVideoEnabled = !this.isVideoEnabled;
        videoTrack.enabled = this.isVideoEnabled;
        this.updateUIForCallType();
    },

    toggleAudio: function () {
        if (!this.isCallActive || !this.localStream || !this.localStream.getAudioTracks()[0]) return;
        this.isAudioMuted = !this.isAudioMuted;
        this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        this.updateUIForCallType();
    },

    toggleAudioOnly: async function () {
        if (this.isCallActive) {
            UIManager.showNotification("Cannot switch call mode (Audio/Video) while a call is active.", "warning");
            return;
        }
        Utils.log("toggleAudioOnly called when no call is active. Current isAudioOnly: " + this.isAudioOnly, Utils.logLevels.INFO);
    },

    updateUIForCallType: function () {
        const callContainer = document.getElementById('videoCallContainer');
        const localVideoEl = this.localVideo;
        const remoteVideoEl = this.remoteVideo;
        const audioOnlyBtn = document.getElementById('audioOnlyBtn');
        const cameraBtn = document.getElementById('toggleCameraBtn');
        const audioBtn = document.getElementById('toggleAudioBtn');
        const pipBtn = this.pipButton;

        if (!callContainer) return;

        if (this.isScreenSharing) {
            callContainer.classList.add('screen-sharing-mode');
            callContainer.classList.remove('audio-only-mode');
        } else {
            callContainer.classList.remove('screen-sharing-mode');
            callContainer.classList.toggle('audio-only-mode', this.isAudioOnly);
        }
        callContainer.classList.toggle('pip-mode', this.isPipMode && this.isCallActive);


        if (localVideoEl) {
            if (this.isScreenSharing && !this.isCaller) {
                localVideoEl.style.display = 'none';
            } else if (this.isScreenSharing && this.isCaller) {
                localVideoEl.style.display = 'none';
            } else if (!this.isAudioOnly && this.isVideoEnabled) {
                localVideoEl.style.display = 'block';
            } else {
                localVideoEl.style.display = 'none';
            }
        }


        if (remoteVideoEl) {
            const currentRemoteStream = remoteVideoEl.srcObject;
            const hasRemoteVideoTrack = currentRemoteStream && currentRemoteStream instanceof MediaStream &&
                currentRemoteStream.getVideoTracks().some(t => t.readyState === "live" && !t.muted);

            if ((this.isScreenSharing && hasRemoteVideoTrack) || (!this.isAudioOnly && hasRemoteVideoTrack)) {
                remoteVideoEl.style.display = 'block';
                if (remoteVideoEl.paused) {
                    remoteVideoEl.play().catch(e => Utils.log(`Error playing remote video: ${e.name} - ${e.message}`, Utils.logLevels.WARN));
                }
            } else {
                remoteVideoEl.style.display = 'none';
            }
        }

        if (audioOnlyBtn) {
            audioOnlyBtn.style.display = this.isCallActive ? 'none' : 'inline-block';
            if (!this.isCallActive) {
                audioOnlyBtn.style.background = this.isAudioOnly ? 'var(--primary-color)' : '#fff';
                audioOnlyBtn.style.color = this.isAudioOnly ? 'white' : 'var(--text-color)';
                audioOnlyBtn.innerHTML = this.isAudioOnly ? '🎬' : '🔊';
                audioOnlyBtn.title = this.isAudioOnly ? 'Switch to Video Call' : 'Switch to Audio-Only Call';
            }
        }

        if (pipBtn) {
            pipBtn.style.display = this.isCallActive ? 'inline-block' : 'none';
            if (this.isCallActive) {
                pipBtn.innerHTML = this.isPipMode ? '📺' : '🖼️';
                pipBtn.title = this.isPipMode ? 'Maximize Video' : 'Minimize Video';
            }
        }

        if (cameraBtn) {
            const disableCameraToggle = this.isAudioOnly || this.isScreenSharing;
            cameraBtn.style.display = disableCameraToggle ? 'none' : 'inline-block';
            if (!disableCameraToggle) {
                cameraBtn.innerHTML = this.isVideoEnabled ? '📹' : '🚫';
                cameraBtn.style.background = this.isVideoEnabled ? '#fff' : '#666';
                cameraBtn.style.color = this.isVideoEnabled ? 'var(--text-color)' : 'white';
                cameraBtn.title = this.isVideoEnabled ? 'Turn Camera Off' : 'Turn Camera On';
            }
        }
        if (audioBtn) {
            audioBtn.innerHTML = this.isAudioMuted ? '🔇' : '🎤';
            audioBtn.style.background = this.isAudioMuted ? '#666' : '#fff';
            audioBtn.style.color = this.isAudioMuted ? 'white' : 'var(--text-color)';
            audioBtn.title = this.isAudioMuted ? 'Unmute Microphone' : 'Mute Microphone';
        }
    },

    togglePipMode: function () {
        if (!this.isCallActive) return;

        this.isPipMode = !this.isPipMode;
        const callContainer = document.getElementById('videoCallContainer');

        callContainer.classList.toggle('pip-mode', this.isPipMode);

        if (this.isPipMode) {
            this.initPipDraggable(callContainer);
            callContainer.style.left = callContainer.dataset.pipLeft || `${window.innerWidth - callContainer.offsetWidth - 20}px`;
            callContainer.style.top = callContainer.dataset.pipTop || `${window.innerHeight - callContainer.offsetHeight - 20}px`;
            callContainer.style.right = 'auto';
            callContainer.style.bottom = 'auto';
        } else {
            this.removePipDraggable(callContainer);
            if (callContainer.style.left && callContainer.style.left !== 'auto') {
                callContainer.dataset.pipLeft = callContainer.style.left;
            }
            if (callContainer.style.top && callContainer.style.top !== 'auto') {
                callContainer.dataset.pipTop = callContainer.style.top;
            }
            callContainer.style.left = '';
            callContainer.style.top = '';
            callContainer.style.right = '';
            callContainer.style.bottom = '';
        }
        this.updateUIForCallType();
    },

    initPipDraggable: function (element) {
        element.addEventListener("mousedown", this._boundDragStart = this._boundDragStart || this.dragStart.bind(this));
        element.addEventListener("touchstart", this._boundDragStartTouch = this._boundDragStartTouch || this.dragStart.bind(this), {passive: false});
    },

    removePipDraggable: function (element) {
        element.removeEventListener("mousedown", this._boundDragStart);
        element.removeEventListener("touchstart", this._boundDragStartTouch);
        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    dragStart: function (e) {
        if (e.target.classList.contains('video-call-button') || e.target.closest('.video-call-button')) {
            return;
        }
        if (!this.isPipMode || !this.isCallActive) return;

        this.dragInfo.draggedElement = document.getElementById('videoCallContainer');
        this.dragInfo.active = true;
        this.dragInfo.draggedElement.style.cursor = 'grabbing';

        const rect = this.dragInfo.draggedElement.getBoundingClientRect();

        if (e.type === "touchstart") {
            this.dragInfo.initialX = e.touches[0].clientX - rect.left;
            this.dragInfo.initialY = e.touches[0].clientY - rect.top;
            document.addEventListener("touchmove", this._boundDragTouch = this._boundDragTouch || this.drag.bind(this), {passive: false});
            document.addEventListener("touchend", this._boundDragEndTouch = this._boundDragEndTouch || this.dragEnd.bind(this));
            e.preventDefault();
        } else {
            this.dragInfo.initialX = e.clientX - rect.left;
            this.dragInfo.initialY = e.clientY - rect.top;
            document.addEventListener("mousemove", this._boundDrag = this._boundDrag || this.drag.bind(this));
            document.addEventListener("mouseup", this._boundDragEnd = this._boundDragEnd || this.dragEnd.bind(this));
        }
    },

    drag: function (e) {
        if (!this.dragInfo.active) return;

        let currentX, currentY;
        if (e.type === "touchmove") {
            e.preventDefault();
            currentX = e.touches[0].clientX - this.dragInfo.initialX;
            currentY = e.touches[0].clientY - this.dragInfo.initialY;
        } else {
            currentX = e.clientX - this.dragInfo.initialX;
            currentY = e.clientY - this.dragInfo.initialY;
        }

        const container = this.dragInfo.draggedElement;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        currentX = Math.max(0, Math.min(currentX, viewportWidth - container.offsetWidth));
        currentY = Math.max(0, Math.min(currentY, viewportHeight - container.offsetHeight));

        container.style.left = currentX + "px";
        container.style.top = currentY + "px";
    },

    dragEnd: function () {
        if (!this.dragInfo.active) return;
        this.dragInfo.active = false;
        if (this.dragInfo.draggedElement) {
            this.dragInfo.draggedElement.style.cursor = 'grab';
            this.dragInfo.draggedElement.dataset.pipLeft = this.dragInfo.draggedElement.style.left;
            this.dragInfo.draggedElement.dataset.pipTop = this.dragInfo.draggedElement.style.top;
        }

        document.removeEventListener("mousemove", this._boundDrag);
        document.removeEventListener("mouseup", this._boundDragEnd);
        document.removeEventListener("touchmove", this._boundDragTouch);
        document.removeEventListener("touchend", this._boundDragEndTouch);
    },

    endCall: function () {
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        if ((this.isCallActive || this.isCallPending) && this.currentPeerId) {
            ConnectionManager.sendTo(this.currentPeerId, {type: 'video-call-end', sender: UserManager.userId});
        }
        this.endCallCleanup();
    },

    endCallCleanup: function () {
        this.stopMusic();
        UIManager.hideCallingModal();

        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = null;
        this.releaseMediaResources();
        if (this.localVideo) this.localVideo.srcObject = null;
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = null;
            this.remoteVideo.style.display = 'none';
        }
        this.remoteStream = null;

        const callContainer = document.getElementById('videoCallContainer');
        if (this.isPipMode) {
            this.isPipMode = false;
            this.removePipDraggable(callContainer);
            callContainer.classList.remove('pip-mode');
            callContainer.style.left = '';
            callContainer.style.top = '';
            callContainer.style.right = '';
            callContainer.style.bottom = '';
        }

        if (callContainer) callContainer.style.display = 'none';
        this.hideCallRequest();

        const oldPeerId = this.currentPeerId;
        this.isCallActive = false;
        this.isCallPending = false;
        this.isCaller = false;
        this.isAudioMuted = false;
        this.isAudioOnly = false;
        this.isScreenSharing = false;
        this.isVideoEnabled = true;
        this.currentPeerId = null;

        if (oldPeerId && ConnectionManager.connections[oldPeerId]) {
            const pc = ConnectionManager.connections[oldPeerId].peerConnection;
            if (pc) {
                pc.getSenders().forEach(sender => {
                    if (sender.track && (sender.track.kind === 'audio' || sender.track.kind === 'video')) {
                        try {
                            pc.removeTrack(sender);
                        } catch (e) {
                            Utils.log(`Error removing track from sender for ${oldPeerId}: ${e}`, Utils.logLevels.WARN);
                        }
                    }
                });
                pc.ontrack = null;
            }
        }
        Utils.log('Call resources cleaned up.', Utils.logLevels.INFO);
        this.updateUIForCallType();
    },

    releaseMediaResources: function () {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    },

    handleMessage: function (message, peerId) {
        switch (message.type) {
            case 'video-call-request':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    ConnectionManager.sendTo(peerId, {
                        type: 'video-call-rejected',
                        reason: 'busy',
                        sender: UserManager.userId
                    });
                }
                break;
            case 'video-call-accepted':
                if (this.isCallPending && this.isCaller && this.currentPeerId === peerId) {
                    this.stopMusic();
                    UIManager.hideCallingModal();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    this.isAudioOnly = message.audioOnly || false;
                    this.isScreenSharing = message.isScreenShare || false;
                    this.startLocalStreamAndSignal(true);
                }
                break;
            case 'video-call-rejected':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (this.isCaller) {
                        this.stopMusic();
                        UIManager.hideCallingModal();
                    }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    UIManager.showNotification(`Call rejected by ${UserManager.contacts[peerId]?.name || 'peer'}. Reason: ${message.reason || 'N/A'}`, 'warning');
                    this.endCallCleanup();
                }
                break;
            case 'video-call-cancel':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (!this.isCaller) {
                        this.stopMusic();
                        this.hideCallRequest();
                    }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    if (!this.isCaller) {
                        UIManager.showNotification(`Call cancelled by ${UserManager.contacts[peerId]?.name || 'peer'}.`, 'warning');
                    }
                    this.endCallCleanup();
                }
                break;
            case 'video-call-offer':
                const remoteIsAudioOnlyOffer = message.audioOnly || false;
                const remoteIsScreenShareOffer = message.isScreenShare || false;
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    this.handleOffer(message.sdp, peerId, remoteIsAudioOnlyOffer, remoteIsScreenShareOffer);
                } else if (this.isCallActive && this.currentPeerId === peerId) {
                    this.handleOffer(message.sdp, peerId, remoteIsAudioOnlyOffer, remoteIsScreenShareOffer);
                }
                break;
            case 'video-call-answer':
                const remoteIsAudioOnlyAnswer = message.audioOnly || false;
                const remoteIsScreenShareAnswer = message.isScreenShare || false;
                if (this.isCallActive && this.currentPeerId === peerId) {
                    this.handleAnswer(message.sdp, peerId, remoteIsAudioOnlyAnswer, remoteIsScreenShareAnswer);
                }
                break;
            case 'video-call-mode-change':
                if (this.isCallActive && this.currentPeerId === peerId) {
                    Utils.log(`Received deprecated 'video-call-mode-change'. Ignoring.`, Utils.logLevels.WARN);
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
    handleCallStats: function (stats) {
        if (stats && typeof stats.rtt === 'number') {
            Utils.log(`Call RTT to ${this.currentPeerId}: ${stats.rtt}ms. Packets Lost: ${stats.packetsLost || 'N/A'}`, Utils.logLevels.DEBUG);
        }
    },
    collectAndSendStats: async function () {
        if (!this.isCallActive || !this.currentPeerId) return;
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection || typeof conn.peerConnection.getStats !== 'function') return;

        try {
            const reports = await conn.peerConnection.getStats(null);
            let relevantStats = {rtt: null, packetsLost: null, jitter: null, bytesSent: null, bytesReceived: null};
            reports.forEach(report => {
                if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
                    if (report.roundTripTime !== undefined) relevantStats.rtt = Math.round(report.roundTripTime * 1000);
                    if (report.packetsLost !== undefined) relevantStats.packetsLost = report.packetsLost;
                    if (report.jitter !== undefined) relevantStats.jitter = report.jitter;
                }
                if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                    if (report.bytesSent !== undefined) relevantStats.bytesSent = report.bytesSent;
                }
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
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
    }
}