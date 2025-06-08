// MODIFIED: VideoCallManager.js
// - Modified endCall and related cleanup to only stop media, not close the RTCPeerConnection.
const VideoCallManager = {
    localStream: null,
    remoteStream: null,
    currentPeerId: null,
    isCallActive: false,
    isCaller: false,
    isCallPending: false,
    isAudioMuted: false,
    isVideoEnabled: true,
    isAudioOnly: false,
    callRequestTimeout: null,
    isScreenSharing: false,
    statsInterval: null,
    musicPlayer: null,
    isMusicPlaying: false,
    _boundEnableMusicPlay: null,

    audioConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    codecPreferences: {
        audio: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000;dtx=0' }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },

    init: function () {
        try {
            this.musicPlayer = new Audio(Config.music);
            this.musicPlayer.loop = true;
            this.musicPlayer.addEventListener('ended', () => { if (this.isMusicPlaying) this.musicPlayer.play().catch(e => Utils.log(`Music loop error: ${e}`, Utils.logLevels.WARN)); });
        } catch (e) { Utils.log(`Error initializing music: ${e}`, Utils.logLevels.ERROR); this.musicPlayer = null; }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('Browser does not support media devices. Call functions disabled.', Utils.logLevels.ERROR);
            return false;
        }
        return true;
    },

    playMusic: function (isRetry = false) {
        if (this.musicPlayer && this.musicPlayer.paused && !this.isMusicPlaying) {
            Utils.log("Attempting to play music...", Utils.logLevels.DEBUG);
            this.musicPlayer.play().then(() => {
                this.isMusicPlaying = true; Utils.log("Music playing.", Utils.logLevels.INFO);
                if (isRetry && this._boundEnableMusicPlay) {
                    document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                    document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                    delete this._boundEnableMusicPlay;
                }
            }).catch(error => {
                Utils.log(`Error playing music: ${error.name} - ${error.message}`, Utils.logLevels.ERROR);
                if (error.name === 'NotAllowedError' && !isRetry) {
                    NotificationManager.showNotification("Music blocked. Click/tap to enable.", "warning");
                    this._boundEnableMusicPlay = () => this.playMusic(true);
                    document.body.addEventListener('click', this._boundEnableMusicPlay, {once: true, capture: true});
                    document.body.addEventListener('touchstart', this._boundEnableMusicPlay, {once: true, capture: true});
                }
            });
        }
    },

    stopMusic: function () {
        if (this.musicPlayer && (!this.musicPlayer.paused || this.isMusicPlaying)) {
            this.musicPlayer.pause(); this.musicPlayer.currentTime = 0; this.isMusicPlaying = false; Utils.log("Music stopped.", Utils.logLevels.INFO);
            if (this._boundEnableMusicPlay) {
                document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                delete this._boundEnableMusicPlay;
            }
        }
    },

    updateCurrentCallUIState: function() {
        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.updateUIForCallState({
                isCallActive: this.isCallActive,
                isAudioOnly: this.isAudioOnly,
                isScreenSharing: this.isScreenSharing,
                isVideoEnabled: this.isVideoEnabled,
                isAudioMuted: this.isAudioMuted,
            });
        }
    },

    initiateAudioCall: function (peerId) { this.initiateCall(peerId, true); },

    initiateScreenShare: async function (peerId) {
        if (this.isCallActive || this.isCallPending) { NotificationManager.showNotification('A call/share is already active/pending.', 'warning'); return; }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) { NotificationManager.showNotification('Select a partner to share screen with.', 'warning'); return; }
        if (!ConnectionManager.isConnectedTo(peerId)) { NotificationManager.showNotification('Not connected to peer.', 'error'); return; }

        this.isScreenSharing = true; this.isAudioOnly = false; this.isVideoEnabled = true; this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId; this.isCaller = true; this.isCallPending = true;
            ConnectionManager.sendTo(peerId, { type: 'video-call-request', audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
            ModalManager.showCallingModal(UserManager.contacts[peerId]?.name || 'peer', () => this.hangUpMedia(), () => this.stopMusic(), 'Screen Share');
            this.playMusic();
            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) { ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId }); this.cancelPendingCall(); }
            }, 30000);
        } catch (error) {
            Utils.log(`Failed to initiate screen share: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('Failed to initiate screen share.', 'error'); this.cleanupCallMediaAndState();
        }
    },

    initiateCall: async function (peerId, audioOnly = false) {
        if (this.isCallActive || this.isCallPending) { NotificationManager.showNotification('A call is already active/pending.', 'warning'); return; }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) { NotificationManager.showNotification('Select a partner to call.', 'warning'); return; }
        if (!ConnectionManager.isConnectedTo(peerId)) { NotificationManager.showNotification('Not connected to peer.', 'error'); return; }

        this.isAudioOnly = audioOnly; this.isScreenSharing = false; this.isVideoEnabled = !audioOnly; this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId; this.isCaller = true; this.isCallPending = true;
            ConnectionManager.sendTo(peerId, { type: 'video-call-request', audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
            ModalManager.showCallingModal(UserManager.contacts[peerId]?.name || 'peer', () => this.hangUpMedia(), () => this.stopMusic(), this.isAudioOnly ? 'Audio Call' : 'Video Call');
            this.playMusic();
            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) { ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId }); this.cancelPendingCall(); }
            }, 30000);
        } catch (error) {
            Utils.log(`Failed to initiate call: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('Failed to initiate call.', 'error'); this.cleanupCallMediaAndState();
        }
    },

    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        this.currentPeerId = peerId; this.isAudioOnly = audioOnly; this.isScreenSharing = isScreenShare;
        this.isVideoEnabled = !audioOnly; this.isAudioMuted = false; this.isCaller = false;
        ModalManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.playMusic();
    },

    acceptCall: async function () {
        ModalManager.hideCallRequest(); this.stopMusic();
        if (!this.currentPeerId) { NotificationManager.showNotification('Invalid call request.', 'error'); return; }
        try {
            if (this.isScreenSharing) this.isVideoEnabled = false;
            await this.startLocalStreamAndSignal(false);
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-accepted', audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
        } catch (error) {
            Utils.log(`Failed to accept call: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification(`Accept call failed: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-rejected', reason: 'device_error', sender: UserManager.userId });
            this.cleanupCallMediaAndState();
        }
    },

    rejectCall: function () {
        ModalManager.hideCallRequest(); this.stopMusic();
        if (!this.currentPeerId) return;
        ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-rejected', reason: 'user_rejected', sender: UserManager.userId });
        this.cleanupCallMediaAndState(false); // Do not close PC, just reset state
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
                    if (screenTrack) screenTrack.onended = () => { Utils.log("Screen sharing ended by user.", Utils.logLevels.INFO); this.hangUpMedia(); };
                    if (this.localStream.getAudioTracks().length === 0) {
                        try {
                            const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                            micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                        } catch (micError) { Utils.log(`Could not get mic for screen share: ${micError.message}`, Utils.logLevels.WARN); }
                    }
                } else {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                    this.isVideoEnabled = false;
                }
            } else {
                if (attemptLocalCameraVideoSending) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if (!this.isAudioOnly) NotificationManager.showNotification('No camera. Audio only.', 'warning');
                        attemptLocalCameraVideoSending = false;
                    }
                }
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: attemptLocalCameraVideoSending, audio: this.audioConstraints });
                this.isVideoEnabled = attemptLocalCameraVideoSending && this.localStream.getVideoTracks()[0]?.readyState !== 'ended';
                if (attemptLocalCameraVideoSending && !this.isVideoEnabled && !this.isAudioOnly) NotificationManager.showNotification('Camera error. Audio only.', 'warning');
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia error: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            if (this.isScreenSharing && this.isCaller) { NotificationManager.showNotification(`Screen share error: ${getUserMediaError.name}.`, 'error'); this.cleanupCallMediaAndState(); throw getUserMediaError; }
            else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) NotificationManager.showNotification(`Camera error: ${getUserMediaError.name}. Audio only.`, 'error');
            try {
                if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                this.isAudioOnly = true; this.isVideoEnabled = false; if(this.isScreenSharing) this.isScreenSharing = false;
            } catch (audioError) { Utils.log(`Fallback audio error: ${audioError.name}`, Utils.logLevels.ERROR); this.cleanupCallMediaAndState(); throw audioError; }
        }

        if (this.localStream.getAudioTracks()[0]) this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        if (this.localStream.getVideoTracks()[0]) this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;

        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.setLocalStream(this.localStream);
            VideoCallUIManager.showCallContainer(true);
        }
        this.isCallActive = true; this.isCallPending = false;
        this.updateCurrentCallUIState();
        await this.setupPeerConnection(isOfferCreatorForMedia);
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(() => this.collectAndSendStats(), 5000);
    },

    setupPeerConnection: async function (isOfferCreatorForMedia) {
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: No PeerConnection.", Utils.logLevels.ERROR); this.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        // Hapus trek lama sebelum menambahkan yang baru jika ini adalah renegosiasi atau awal panggilan baru pada PC yang ada
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);} catch(e){Utils.log("Err removing old track: "+e,Utils.logLevels.WARN);}});

        this.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio' || (track.kind === 'video' && this.isVideoEnabled && ((!this.isScreenSharing) || (this.isScreenSharing && this.isCaller)))) {
                try {
                    pc.addTrack(track, this.localStream);
                } catch(e) {
                    Utils.log(`Error adding track ${track.kind} to PC: ${e.message}`, Utils.logLevels.ERROR);
                }
            }
        });
        this.setCodecPreferences(pc);
        pc.ontrack = (event) => {
            const trackHandler = (track) => {
                if (!track._videoManagerListenersAttached) {
                    track.onunmute = () => { Utils.log(`Remote track ${track.id} (${track.kind}) unmuted.`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); if (track.kind === 'video' && VideoCallUIManager.remoteVideo?.paused) VideoCallUIManager.remoteVideo.play().catch(e => Utils.log(`Error playing remote video: ${e}`,Utils.logLevels.WARN)); };
                    track.onmute = () => { Utils.log(`Remote track ${track.id} (${track.kind}) muted.`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); };
                    track.onended = () => { // Penting untuk menangani ketika trek jarak jauh dihentikan
                        Utils.log(`Remote track ${track.id} (${track.kind}) ended.`, Utils.logLevels.DEBUG);
                        if (this.remoteStream?.getTrackById(track.id)) try {this.remoteStream.removeTrack(track);}catch(e){Utils.log("Err removing track from remote: "+e,Utils.logLevels.WARN);}
                        if (track.kind === 'video' && this.isScreenSharing && !this.isCaller) { Utils.log("Remote screen share ended. Ending call aspect.", Utils.logLevels.INFO); this.hangUpMedia(false); /*false: jangan kirim video-call-end karena ini reaksi terhadap trek yang berakhir*/ }
                        else if (this.remoteStream && this.remoteStream.getTracks().length === 0) { // Jika semua trek jarak jauh hilang
                            if(VideoCallUIManager.remoteVideo) VideoCallUIManager.remoteVideo.srcObject = null;
                            this.remoteStream = null;
                            Utils.log("All remote tracks ended. Call aspect might be over.", Utils.logLevels.INFO);
                            // Pertimbangkan apakah ini juga harus memicu hangUpMedia() jika belum
                        }
                        this.updateCurrentCallUIState();
                    };
                    track._videoManagerListenersAttached = true;
                }
            };
            if (event.streams && event.streams[0]) {
                if (VideoCallUIManager.remoteVideo?.srcObject !== event.streams[0]) {
                    if (typeof VideoCallUIManager !== 'undefined') VideoCallUIManager.setRemoteStream(event.streams[0]);
                    this.remoteStream = event.streams[0];
                }
                if (this.remoteStream) this.remoteStream.getTracks().forEach(t => trackHandler(t));
                if (event.track) trackHandler(event.track);
            } else if (event.track) {
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                    if (typeof VideoCallUIManager !== 'undefined' && (!VideoCallUIManager.remoteVideo?.srcObject || VideoCallUIManager.remoteVideo.srcObject.getTracks().length === 0)) VideoCallUIManager.setRemoteStream(this.remoteStream);
                }
                if (!this.remoteStream.getTrackById(event.track.id)) this.remoteStream.addTrack(event.track);
                if (typeof VideoCallUIManager !== 'undefined' && VideoCallUIManager.remoteVideo?.srcObject !== this.remoteStream && this.remoteStream.getTracks().length > 0) VideoCallUIManager.setRemoteStream(this.remoteStream);
                trackHandler(event.track);
            }
            this.updateCurrentCallUIState();
        };
        this.setupConnectionMonitoring(pc); // Monitor ICE state, tapi JANGAN panggil endCall/hangUpMedia dari sini jika PC state berubah jadi disconnected
        if (isOfferCreatorForMedia) await this.createAndSendOffer();
    },

    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`Call ICE State: ${pc.iceConnectionState} for ${this.currentPeerId}`, Utils.logLevels.DEBUG);
            // JANGAN panggil hangUpMedia() atau endCall() secara otomatis dari sini
            // jika tujuannya adalah untuk mempertahankan PC.
            // Biarkan logika aplikasi (misalnya, batas waktu, keputusan pengguna) yang menanganinya.
            // Anda mungkin ingin menampilkan notifikasi jika koneksi ICE 'failed'.
            if (this.isCallActive && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed')) {
                if (this.isCallActive) {
                    NotificationManager.showNotification('Call connection issue (ICE). Media may be affected.', 'warning');
                    // Jika state menjadi 'closed' atau 'failed' secara permanen, PC mungkin tidak dapat digunakan lagi.
                    // Jika Anda ingin mencoba memulihkan PC, itu akan menjadi logika yang lebih kompleks.
                    // Untuk saat ini, asumsikan DataChannel masih bisa berfungsi jika hanya media yang bermasalah.
                }
            }
        };
    },
    setCodecPreferences: function (pc) {
        if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) { Utils.log("setCodecPreferences not supported.", Utils.logLevels.WARN); return; }
        try {
            pc.getTransceivers().forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return;
                const kind = transceiver.sender.track.kind;
                if (kind === 'audio') {
                    const {codecs} = RTCRtpSender.getCapabilities('audio');
                    const preferredAudio = this.codecPreferences.audio.map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() && (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.includes(pref.sdpFmtpLine.split(';')[0]))))).filter(c => c);
                    if (preferredAudio.length > 0) try {transceiver.setCodecPreferences(preferredAudio);}catch(e){Utils.log(`Failed to set audio codec prefs: ${e.message}`,Utils.logLevels.WARN);}
                } else if (kind === 'video' && !this.isAudioOnly) {
                    const {codecs} = RTCRtpSender.getCapabilities('video');
                    const preferredVideo = this.codecPreferences.video.map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase())).filter(c => c);
                    if (preferredVideo.length > 0) try {transceiver.setCodecPreferences(preferredVideo);}catch(e){Utils.log(`Failed to set video codec prefs: ${e.message}`,Utils.logLevels.WARN);}
                }
            });
        } catch (error) { Utils.log(`Error in setCodecPreferences: ${error.message}`, Utils.logLevels.WARN); }
    },
    modifySdpForOpus: function (sdp) {
        const opusRegex = /a=rtpmap:(\d+) opus\/48000\/2/gm; let match; let modifiedSdp = sdp;
        const opusTargetParams = this.codecPreferences.audio.find(p => p.mimeType === 'audio/opus')?.sdpFmtpLine || 'minptime=10;useinbandfec=1';
        while ((match = opusRegex.exec(sdp)) !== null) {
            const opusPayloadType = match[1]; const rtpmapLineSignature = `a=rtpmap:${opusPayloadType} opus/48000/2`;
            const fmtpLineForPayload = `a=fmtp:${opusPayloadType} ${opusTargetParams}`;
            const existingFmtpRegex = new RegExp(`^a=fmtp:${opusPayloadType} .*(\\r\\n)?`, 'm');
            if (existingFmtpRegex.test(modifiedSdp)) modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$2 || '\r\n'));
            else {
                const rtpmapLineIndex = modifiedSdp.indexOf(rtpmapLineSignature);
                if (rtpmapLineIndex !== -1) {
                    const endOfRtpmapLine = modifiedSdp.indexOf('\n', rtpmapLineIndex);
                    const insertPosition = (endOfRtpmapLine !== -1) ? endOfRtpmapLine : modifiedSdp.length;
                    modifiedSdp = modifiedSdp.slice(0, insertPosition) + `\r\n${fmtpLineForPayload}` + modifiedSdp.slice(insertPosition);
                }
            }
        } return modifiedSdp;
    },

    createAndSendOffer: async function () {
        if (!this.currentPeerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("No PC for offer", Utils.logLevels.ERROR); return; }
        try {
            // Jika Anda hanya menghapus trek, Anda mungkin perlu mengatur ulang transceivers
            // atau menegosiasikan ulang dengan cara tertentu yang menunjukkan tidak ada media.
            // Cara sederhana adalah offerToReceiveAudio/Video = false jika tidak ada trek lokal.
            const offerOptions = {
                offerToReceiveAudio: true, // Selalu siap menerima audio
                offerToReceiveVideo: !this.isAudioOnly || this.isScreenSharing // Siap menerima video jika bukan audio-only atau jika screen share
            };

            const offer = await conn.peerConnection.createOffer(offerOptions);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-offer', sdp: conn.peerConnection.localDescription, audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
        } catch (e) { Utils.log("Error creating/sending offer: " + e, Utils.logLevels.ERROR); this.hangUpMedia(); }
    },

    handleOffer: async function (sdpOffer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) { Utils.log("No PC to handle offer", Utils.logLevels.ERROR); return; }
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));
            if (!this.isCallActive) {
                this.isScreenSharing = remoteIsScreenShare; this.isAudioOnly = remoteIsAudioOnly && !remoteIsScreenShare;
                this.currentPeerId = peerId; this.isCaller = false; this.isVideoEnabled = !this.isAudioOnly && !this.isScreenSharing;
                await this.startLocalStreamAndSignal(false);
            }
            const answer = await conn.peerConnection.createAnswer();
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: this.modifySdpForOpus(answer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);
            ConnectionManager.sendTo(peerId, { type: 'video-call-answer', sdp: conn.peerConnection.localDescription, audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
        } catch (e) { Utils.log("Error handling offer: " + e, Utils.logLevels.ERROR); this.hangUpMedia(); }
    },

    handleAnswer: async function (sdpAnswer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        if (this.currentPeerId !== peerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) return;
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`Answer from ${peerId} processed.`, Utils.logLevels.INFO);
        } catch (e) { Utils.log("Error handling answer: " + e, Utils.logLevels.ERROR); this.hangUpMedia(); }
    },

    toggleCamera: function () {
        if (!this.isCallActive || !this.localStream || this.isAudioOnly || this.isScreenSharing) {
            if(this.isAudioOnly) NotificationManager.showNotification("Camera N/A in audio call.", "warning");
            if(this.isScreenSharing) NotificationManager.showNotification("Camera N/A during screen share.", "warning");
            return;
        }
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (!videoTrack) { NotificationManager.showNotification('Local video N/A.', 'warning'); return; }
        this.isVideoEnabled = !this.isVideoEnabled; videoTrack.enabled = this.isVideoEnabled;
        this.updateCurrentCallUIState();
    },

    toggleAudio: function () {
        if (!this.isCallActive || !this.localStream || !this.localStream.getAudioTracks()[0]) return;
        this.isAudioMuted = !this.isAudioMuted; this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        this.updateCurrentCallUIState();
    },

    toggleAudioOnly: async function () {
        if (this.isCallActive) { NotificationManager.showNotification("Cannot switch mode mid-call.", "warning"); return; }
        this.isAudioOnly = !this.isAudioOnly;
        Utils.log("Toggled AudioOnly mode (pre-call): " + this.isAudioOnly, Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    // BARU: Fungsi untuk hanya menghentikan media, bukan seluruh koneksi
    hangUpMedia: function(notifyPeer = true) {
        Utils.log(`Hanging up media for peer ${this.currentPeerId}. Notify: ${notifyPeer}`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;

        if (notifyPeer && (this.isCallActive || this.isCallPending) && this.currentPeerId) {
            ConnectionManager.sendTo(this.currentPeerId, {type: 'video-call-end', sender: UserManager.userId});
        }
        this.cleanupCallMediaAndState(false); // false: JANGAN tutup RTCPeerConnection
    },

    // BARU: Fungsi untuk membatalkan panggilan yang tertunda
    cancelPendingCall: function() {
        Utils.log(`Cancelling pending call for peer ${this.currentPeerId}.`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
        // Tidak perlu mengirim video-call-cancel jika sudah dikirim sebelumnya
        this.cleanupCallMediaAndState(false); // false: JANGAN tutup RTCPeerConnection
    },

    // DIMODIFIKASI: cleanupCallMediaAndState untuk menerima argumen closePeerConnection
    cleanupCallMediaAndState: function (closePeerConnection = true) {
        Utils.log(`Cleaning up call media and state. Close PC: ${closePeerConnection}`, Utils.logLevels.INFO);
        this.stopMusic(); ModalManager.hideCallingModal();
        if (this.statsInterval) clearInterval(this.statsInterval); this.statsInterval = null;

        this.releaseMediaResources(); // Hentikan trek lokal

        // Hapus trek dari RTCPeerConnection
        const peerIdToClean = this.currentPeerId; // Simpan sebelum di-null-kan
        if (peerIdToClean) {
            const conn = ConnectionManager.connections[peerIdToClean];
            if (conn && conn.peerConnection) {
                conn.peerConnection.getSenders().forEach(sender => {
                    if (sender.track) {
                        try {
                            conn.peerConnection.removeTrack(sender);
                            Utils.log(`Removed track ${sender.track.kind} from PC for ${peerIdToClean}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`Error removing track from PC for ${peerIdToClean}: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                });
                // Setelah menghapus trek, Anda mungkin perlu menegosiasikan ulang
                // jika ingin memberi tahu peer lain secara formal bahwa trek telah hilang.
                // Namun, event 'onended' pada trek jarak jauh seharusnya sudah cukup.
                // Jika tidak, Anda bisa memanggil `this.createAndSendOffer()` di sini jika `this.isCaller`.
            }
        }


        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.setLocalStream(null);
            VideoCallUIManager.setRemoteStream(null);
            VideoCallUIManager.showCallContainer(false);
            VideoCallUIManager.resetPipVisuals();
        }
        this.remoteStream = null;
        ModalManager.hideCallRequest();

        const oldPeerIdForPCClosure = this.currentPeerId; // Simpan untuk penutupan PC jika diperlukan

        this.isCallActive = false; this.isCallPending = false; this.isCaller = false;
        this.isAudioMuted = false; this.isAudioOnly = false; this.isScreenSharing = false; this.isVideoEnabled = true;
        this.currentPeerId = null; // Penting: reset currentPeerId setelah digunakan untuk mengambil koneksi

        if (closePeerConnection && oldPeerIdForPCClosure) {
            Utils.log(`Closing RTCPeerConnection with ${oldPeerIdForPCClosure} as part of full call end.`, Utils.logLevels.INFO);
            ConnectionManager.close(oldPeerIdForPCClosure, false); // false: jangan kirim sinyal 'close' tambahan
        } else if (oldPeerIdForPCClosure) {
            Utils.log(`RTCPeerConnection with ${oldPeerIdForPCClosure} RETAINED. Media hung up.`, Utils.logLevels.INFO);
        }

        Utils.log('Call media and state cleaned up.', Utils.logLevels.INFO);
        this.updateCurrentCallUIState(); // Perbarui UI terakhir kali
    },

    releaseMediaResources: function () {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                Utils.log(`Stopped local track: ${track.kind} id: ${track.id}`, Utils.logLevels.DEBUG);
            });
            this.localStream = null;
        }
    },

    handleMessage: function (message, peerId) {
        switch (message.type) {
            case 'video-call-request':
                if (!this.isCallActive && !this.isCallPending) { this.isCallPending = true; this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false); }
                else ConnectionManager.sendTo(peerId, { type: 'video-call-rejected', reason: 'busy', sender: UserManager.userId });
                break;
            case 'video-call-accepted':
                if (this.isCallPending && this.isCaller && this.currentPeerId === peerId) {
                    this.stopMusic(); ModalManager.hideCallingModal();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
                    this.isAudioOnly = message.audioOnly || false; this.isScreenSharing = message.isScreenShare || false;
                    this.startLocalStreamAndSignal(true);
                }
                break;
            case 'video-call-rejected':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (this.isCaller) { this.stopMusic(); ModalManager.hideCallingModal(); }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
                    NotificationManager.showNotification(`Call rejected by ${UserManager.contacts[peerId]?.name || 'peer'}. Reason: ${message.reason || 'N/A'}`, 'warning');
                    this.cleanupCallMediaAndState(false); // false: JANGAN tutup PC
                }
                break;
            case 'video-call-cancel':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (!this.isCaller) { this.stopMusic(); ModalManager.hideCallRequest(); }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
                    if (!this.isCaller) NotificationManager.showNotification(`Call cancelled by ${UserManager.contacts[peerId]?.name || 'peer'}.`, 'warning');
                    this.cleanupCallMediaAndState(false); // false: JANGAN tutup PC
                }
                break;
            case 'video-call-offer':
                if (!this.isCallActive && !this.isCallPending) { this.isCallPending = true; this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false); }
                else if (this.isCallActive && this.currentPeerId === peerId) this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                break;
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                break;
            case 'video-call-end': // Pesan ini sekarang berarti "media telah berakhir"
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    NotificationManager.showNotification(`${UserManager.contacts[peerId]?.name || 'Peer'} ended the call media.`, 'info');
                    this.cleanupCallMediaAndState(false); // false: JANGAN tutup PC
                }
                break;
            case 'video-call-stats': if (this.isCallActive && this.currentPeerId === peerId) this.handleCallStats(message.stats); break;
        }
    },
    handleCallStats: function (stats) {
        if (stats && typeof stats.rtt === 'number') Utils.log(`Call RTT to ${this.currentPeerId}: ${stats.rtt}ms. Lost: ${stats.packetsLost || 'N/A'}`, Utils.logLevels.DEBUG);
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
                if (report.type === 'outbound-rtp' && report.kind === 'audio') if (report.bytesSent !== undefined) relevantStats.bytesSent = report.bytesSent;
                if (report.type === 'inbound-rtp' && report.kind === 'audio') if (report.bytesReceived !== undefined) relevantStats.bytesReceived = report.bytesReceived;
            });
            if (relevantStats.rtt !== null) ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-stats', stats: relevantStats, sender: UserManager.userId });
        } catch (e) { Utils.log("Error collecting WebRTC stats: " + e, Utils.logLevels.WARN); }
    }
};