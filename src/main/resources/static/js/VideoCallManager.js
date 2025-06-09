// MODIFIED: VideoCallManager.js (已翻译为中文)
// - 修改了 endCall 及相关清理逻辑，使其只停止媒体流，不关闭 RTCPeerConnection。
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
            this.musicPlayer.addEventListener('ended', () => { if (this.isMusicPlaying) this.musicPlayer.play().catch(e => Utils.log(`音乐循环播放错误: ${e}`, Utils.logLevels.WARN)); });
        } catch (e) { Utils.log(`初始化音乐时出错: ${e}`, Utils.logLevels.ERROR); this.musicPlayer = null; }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。通话功能已禁用。', Utils.logLevels.ERROR);
            return false;
        }
        return true;
    },

    playMusic: function (isRetry = false) {
        if (this.musicPlayer && this.musicPlayer.paused && !this.isMusicPlaying) {
            Utils.log("正在尝试播放音乐...", Utils.logLevels.DEBUG);
            this.musicPlayer.play().then(() => {
                this.isMusicPlaying = true; Utils.log("音乐正在播放。", Utils.logLevels.INFO);
                if (isRetry && this._boundEnableMusicPlay) {
                    document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                    document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                    delete this._boundEnableMusicPlay;
                }
            }).catch(error => {
                Utils.log(`播放音乐时出错: ${error.name} - ${error.message}`, Utils.logLevels.ERROR);
                if (error.name === 'NotAllowedError' && !isRetry) {
                    NotificationManager.showNotification("音乐播放被阻止。请点击/触摸以启用。", "warning");
                    this._boundEnableMusicPlay = () => this.playMusic(true);
                    document.body.addEventListener('click', this._boundEnableMusicPlay, {once: true, capture: true});
                    document.body.addEventListener('touchstart', this._boundEnableMusicPlay, {once: true, capture: true});
                }
            });
        }
    },

    stopMusic: function () {
        if (this.musicPlayer && (!this.musicPlayer.paused || this.isMusicPlaying)) {
            this.musicPlayer.pause(); this.musicPlayer.currentTime = 0; this.isMusicPlaying = false; Utils.log("音乐已停止。", Utils.logLevels.INFO);
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
        if (this.isCallActive || this.isCallPending) { NotificationManager.showNotification('已有通话/共享正在进行或等待中。', 'warning'); return; }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) { NotificationManager.showNotification('请选择一个伙伴以共享屏幕。', 'warning'); return; }
        if (!ConnectionManager.isConnectedTo(peerId)) { NotificationManager.showNotification('未连接到对方。', 'error'); return; }

        this.isScreenSharing = true; this.isAudioOnly = false; this.isVideoEnabled = true; this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId; this.isCaller = true; this.isCallPending = true;
            ConnectionManager.sendTo(peerId, { type: 'video-call-request', audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
            ModalManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), '屏幕共享');
            this.playMusic();
            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) { ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId }); this.cancelPendingCall(); }
            }, 30000);
        } catch (error) {
            Utils.log(`发起屏幕共享失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('发起屏幕共享失败。', 'error'); this.cleanupCallMediaAndState();
        }
    },

    initiateCall: async function (peerId, audioOnly = false) {
        if (this.isCallActive || this.isCallPending) { NotificationManager.showNotification('已有通话正在进行或等待中。', 'warning'); return; }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) { NotificationManager.showNotification('请选择一个伙伴进行通话。', 'warning'); return; }
        if (!ConnectionManager.isConnectedTo(peerId)) { NotificationManager.showNotification('未连接到对方。', 'error'); return; }

        this.isAudioOnly = audioOnly; this.isScreenSharing = false; this.isVideoEnabled = !audioOnly; this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId; this.isCaller = true; this.isCallPending = true;
            ConnectionManager.sendTo(peerId, { type: 'video-call-request', audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
            ModalManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), this.isAudioOnly ? '语音通话' : '视频通话');
            this.playMusic();
            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) { ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId }); this.cancelPendingCall(); }
            }, 30000);
        } catch (error) {
            Utils.log(`发起通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('发起通话失败。', 'error'); this.cleanupCallMediaAndState();
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
        if (!this.currentPeerId) { NotificationManager.showNotification('无效的通话请求。', 'error'); return; }
        try {
            if (this.isScreenSharing) this.isVideoEnabled = false;
            await this.startLocalStreamAndSignal(false);
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-accepted', audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
        } catch (error) {
            Utils.log(`接听通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification(`接听通话失败: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-rejected', reason: 'device_error', sender: UserManager.userId });
            this.cleanupCallMediaAndState();
        }
    },

    rejectCall: function () {
        ModalManager.hideCallRequest(); this.stopMusic();
        if (!this.currentPeerId) return;
        ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-rejected', reason: 'user_rejected', sender: UserManager.userId });
        this.cleanupCallMediaAndState(false); // false: 不关闭 PC，只重置状态
        Utils.log('已拒绝通话请求。', Utils.logLevels.INFO);
    },

    startLocalStreamAndSignal: async function (isOfferCreatorForMedia) {
        let attemptLocalCameraVideoSending = !this.isAudioOnly && !this.isScreenSharing;
        try {
            if (this.isScreenSharing) {
                if (this.isCaller) {
                    this.localStream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
                    this.isVideoEnabled = true;
                    const screenTrack = this.localStream.getVideoTracks()[0];
                    if (screenTrack) screenTrack.onended = () => { Utils.log("用户已结束屏幕共享。", Utils.logLevels.INFO); this.hangUpMedia(); };
                    if (this.localStream.getAudioTracks().length === 0) {
                        try {
                            const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                            micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                        } catch (micError) { Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN); }
                    }
                } else {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                    this.isVideoEnabled = false;
                }
            } else {
                if (attemptLocalCameraVideoSending) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if (!this.isAudioOnly) NotificationManager.showNotification('没有摄像头。仅音频通话。', 'warning');
                        attemptLocalCameraVideoSending = false;
                    }
                }
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: attemptLocalCameraVideoSending, audio: this.audioConstraints });
                this.isVideoEnabled = attemptLocalCameraVideoSending && this.localStream.getVideoTracks()[0]?.readyState !== 'ended';
                if (attemptLocalCameraVideoSending && !this.isVideoEnabled && !this.isAudioOnly) NotificationManager.showNotification('摄像头错误。仅音频通话。', 'warning');
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            if (this.isScreenSharing && this.isCaller) { NotificationManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error'); this.cleanupCallMediaAndState(); throw getUserMediaError; }
            else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) NotificationManager.showNotification(`摄像头错误: ${getUserMediaError.name}。仅音频通话。`, 'error');
            try {
                if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                this.isAudioOnly = true; this.isVideoEnabled = false; if(this.isScreenSharing) this.isScreenSharing = false;
            } catch (audioError) { Utils.log(`备用音频错误: ${audioError.name}`, Utils.logLevels.ERROR); this.cleanupCallMediaAndState(); throw audioError; }
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
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: 没有 PeerConnection。", Utils.logLevels.ERROR); this.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        // 如果是重新协商或在新连接上开始新通话，先移除旧轨道
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);} catch(e){Utils.log("移除旧轨道时出错: "+e,Utils.logLevels.WARN);}});

        this.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio' || (track.kind === 'video' && this.isVideoEnabled && ((!this.isScreenSharing) || (this.isScreenSharing && this.isCaller)))) {
                try {
                    pc.addTrack(track, this.localStream);
                } catch(e) {
                    Utils.log(`向 PC 添加轨道 ${track.kind} 时出错: ${e.message}`, Utils.logLevels.ERROR);
                }
            }
        });
        this.setCodecPreferences(pc);
        pc.ontrack = (event) => {
            const trackHandler = (track) => {
                if (!track._videoManagerListenersAttached) {
                    track.onunmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已取消静音。`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); if (track.kind === 'video' && VideoCallUIManager.remoteVideo?.paused) VideoCallUIManager.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e}`,Utils.logLevels.WARN)); };
                    track.onmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已静音。`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); };
                    track.onended = () => { // 重要：处理远程轨道结束的情况
                        Utils.log(`远程轨道 ${track.id} (${track.kind}) 已结束。`, Utils.logLevels.DEBUG);
                        if (this.remoteStream?.getTrackById(track.id)) try {this.remoteStream.removeTrack(track);}catch(e){Utils.log("从远程流移除轨道时出错: "+e,Utils.logLevels.WARN);}
                        if (track.kind === 'video' && this.isScreenSharing && !this.isCaller) { Utils.log("远程屏幕共享已结束。正在结束通话部分。", Utils.logLevels.INFO); this.hangUpMedia(false); /*false: 不发送 video-call-end，因为这是对轨道结束的反应*/ }
                        else if (this.remoteStream && this.remoteStream.getTracks().length === 0) { // 如果所有远程轨道都消失了
                            if(VideoCallUIManager.remoteVideo) VideoCallUIManager.remoteVideo.srcObject = null;
                            this.remoteStream = null;
                            Utils.log("所有远程轨道已结束。通话部分可能已结束。", Utils.logLevels.INFO);
                            // 考虑这是否也应该在尚未触发的情况下触发 hangUpMedia()
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
        this.setupConnectionMonitoring(pc); // 监控 ICE 状态，但如果 PC 状态变为 disconnected，不要从这里调用 endCall/hangUpMedia
        if (isOfferCreatorForMedia) await this.createAndSendOffer();
    },

    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`通话 ICE 状态: ${pc.iceConnectionState} (for ${this.currentPeerId})`, Utils.logLevels.DEBUG);
            // 如果目标是保留 PC，不要从这里自动调用 hangUpMedia() 或 endCall()。
            // 让应用逻辑（如超时、用户决定）来处理。
            // 如果连接 ICE 'failed'，你可能想显示一个通知。
            if (this.isCallActive && (pc.iceconnectionState === 'failed' || pc.iceconnectionState === 'disconnected' || pc.iceconnectionState === 'closed')) {
                if (this.isCallActive) {
                    NotificationManager.showNotification('通话连接问题 (ICE)。媒体可能受影响。', 'warning');
                    // 如果状态永久变为 'closed' 或 'failed'，PC 可能无法再使用。
                    // 如果你想尝试恢复 PC，那将是更复杂的逻辑。
                    // 目前，假设如果只是媒体有问题，DataChannel 仍然可以工作。
                }
            }
        };
    },
    setCodecPreferences: function (pc) {
        if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) { Utils.log("setCodecPreferences 不受支持。", Utils.logLevels.WARN); return; }
        try {
            pc.getTransceivers().forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return;
                const kind = transceiver.sender.track.kind;
                if (kind === 'audio') {
                    const {codecs} = RTCRtpSender.getCapabilities('audio');
                    const preferredAudio = this.codecPreferences.audio.map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() && (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.includes(pref.sdpFmtpLine.split(';')[0]))))).filter(c => c);
                    if (preferredAudio.length > 0) try {transceiver.setCodecPreferences(preferredAudio);}catch(e){Utils.log(`设置音频编解码器首选项失败: ${e.message}`,Utils.logLevels.WARN);}
                } else if (kind === 'video' && !this.isAudioOnly) {
                    const {codecs} = RTCRtpSender.getCapabilities('video');
                    const preferredVideo = this.codecPreferences.video.map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase())).filter(c => c);
                    if (preferredVideo.length > 0) try {transceiver.setCodecPreferences(preferredVideo);}catch(e){Utils.log(`设置视频编解码器首选项失败: ${e.message}`,Utils.logLevels.WARN);}
                }
            });
        } catch (error) { Utils.log(`setCodecPreferences 出错: ${error.message}`, Utils.logLevels.WARN); }
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
        if (!conn || !conn.peerConnection) { Utils.log("没有 PC 用于创建提议", Utils.logLevels.ERROR); return; }
        try {
            // 如果你只移除轨道，你可能需要重置收发器或以某种方式重新协商以表明没有媒体。
            // 一种简单的方法是，如果没有本地轨道，则 offerToReceiveAudio/Video = false。
            const offerOptions = {
                offerToReceiveAudio: true, // 始终准备好接收音频
                offerToReceiveVideo: !this.isAudioOnly || this.isScreenSharing // 如果不是纯音频或正在共享屏幕，则准备好接收视频
            };

            const offer = await conn.peerConnection.createOffer(offerOptions);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);
            ConnectionManager.sendTo(this.currentPeerId, { type: 'video-call-offer', sdp: conn.peerConnection.localDescription, audioOnly: this.isAudioOnly, isScreenShare: this.isScreenSharing, sender: UserManager.userId });
        } catch (e) { Utils.log("创建/发送提议时出错: " + e, Utils.logLevels.ERROR); this.hangUpMedia(); }
    },

    handleOffer: async function (sdpOffer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) { Utils.log("没有 PC 来处理提议", Utils.logLevels.ERROR); return; }
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
        } catch (e) { Utils.log("处理提议时出错: " + e, Utils.logLevels.ERROR); this.hangUpMedia(); }
    },

    handleAnswer: async function (sdpAnswer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        if (this.currentPeerId !== peerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) return;
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`来自 ${peerId} 的应答已处理。`, Utils.logLevels.INFO);
        } catch (e) { Utils.log("处理应答时出错: " + e, Utils.logLevels.ERROR); this.hangUpMedia(); }
    },

    toggleCamera: function () {
        if (!this.isCallActive || !this.localStream || this.isAudioOnly || this.isScreenSharing) {
            if(this.isAudioOnly) NotificationManager.showNotification("纯音频通话中摄像头不可用。", "warning");
            if(this.isScreenSharing) NotificationManager.showNotification("屏幕共享期间摄像头不可用。", "warning");
            return;
        }
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (!videoTrack) { NotificationManager.showNotification('本地视频不可用。', 'warning'); return; }
        this.isVideoEnabled = !this.isVideoEnabled; videoTrack.enabled = this.isVideoEnabled;
        this.updateCurrentCallUIState();
    },

    toggleAudio: function () {
        if (!this.isCallActive || !this.localStream || !this.localStream.getAudioTracks()[0]) return;
        this.isAudioMuted = !this.isAudioMuted; this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        this.updateCurrentCallUIState();
    },

    toggleAudioOnly: async function () {
        if (this.isCallActive) { NotificationManager.showNotification("通话中无法切换模式。", "warning"); return; }
        this.isAudioOnly = !this.isAudioOnly;
        Utils.log("已切换纯音频模式 (通话前): " + this.isAudioOnly, Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    // 新增: 只挂断媒体，不关闭整个连接的函数
    hangUpMedia: function(notifyPeer = true) {
        Utils.log(`正在为对方 ${this.currentPeerId} 挂断媒体。通知: ${notifyPeer}`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;

        if (notifyPeer && (this.isCallActive || this.isCallPending) && this.currentPeerId) {
            ConnectionManager.sendTo(this.currentPeerId, {type: 'video-call-end', sender: UserManager.userId});
        }
        this.cleanupCallMediaAndState(false); // false: 不要关闭 RTCPeerConnection
    },

    // 新增: 取消等待中通话的函数
    cancelPendingCall: function() {
        Utils.log(`正在为对方 ${this.currentPeerId} 取消等待中的通话。`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
        // 如果之前已经发送过 video-call-cancel，则无需再次发送
        this.cleanupCallMediaAndState(false); // false: 不要关闭 RTCPeerConnection
    },

    // 修改: cleanupCallMediaAndState 接受 closePeerConnection 参数
    cleanupCallMediaAndState: function (closePeerConnection = true) {
        Utils.log(`正在清理通话媒体和状态。关闭 PC: ${closePeerConnection}`, Utils.logLevels.INFO);
        this.stopMusic(); ModalManager.hideCallingModal();
        if (this.statsInterval) clearInterval(this.statsInterval); this.statsInterval = null;

        this.releaseMediaResources(); // 停止本地轨道

        // 从 RTCPeerConnection 中移除轨道
        const peerIdToClean = this.currentPeerId; // 在置为 null 之前保存
        if (peerIdToClean) {
            const conn = ConnectionManager.connections[peerIdToClean];
            if (conn && conn.peerConnection) {
                conn.peerConnection.getSenders().forEach(sender => {
                    if (sender.track) {
                        try {
                            conn.peerConnection.removeTrack(sender);
                            Utils.log(`已从 ${peerIdToClean} 的 PC 中移除轨道 ${sender.track.kind}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`从 ${peerIdToClean} 的 PC 中移除轨道时出错: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                });
                // 移除轨道后，如果想正式通知对方轨道已消失，你可能需要重新协商。
                // 然而，远程轨道的 'onended' 事件应该足够了。
                // 如果不够，如果 `this.isCaller`，可以在这里调用 `this.createAndSendOffer()`。
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

        const oldPeerIdForPCClosure = this.currentPeerId; // 保存以便在需要时关闭 PC

        this.isCallActive = false; this.isCallPending = false; this.isCaller = false;
        this.isAudioMuted = false; this.isAudioOnly = false; this.isScreenSharing = false; this.isVideoEnabled = true;
        this.currentPeerId = null; // 重要：在用于获取连接后重置 currentPeerId

        if (closePeerConnection && oldPeerIdForPCClosure) {
            Utils.log(`作为完整通话结束的一部分，正在关闭与 ${oldPeerIdForPCClosure} 的 RTCPeerConnection。`, Utils.logLevels.INFO);
            ConnectionManager.close(oldPeerIdForPCClosure, false); // false: 不发送额外的 'close' 信号
        } else if (oldPeerIdForPCClosure) {
            Utils.log(`与 ${oldPeerIdForPCClosure} 的 RTCPeerConnection 已保留。媒体已挂断。`, Utils.logLevels.INFO);
        }

        Utils.log('通话媒体和状态已清理。', Utils.logLevels.INFO);
        this.updateCurrentCallUIState(); // 最后更新一次 UI
    },

    releaseMediaResources: function () {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                Utils.log(`已停止本地轨道: ${track.kind} id: ${track.id}`, Utils.logLevels.DEBUG);
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
                    NotificationManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 拒绝。原因: ${message.reason || 'N/A'}`, 'warning');
                    this.cleanupCallMediaAndState(false); // false: 不要关闭 PC
                }
                break;
            case 'video-call-cancel':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (!this.isCaller) { this.stopMusic(); ModalManager.hideCallRequest(); }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); this.callRequestTimeout = null;
                    if (!this.isCaller) NotificationManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 取消。`, 'warning');
                    this.cleanupCallMediaAndState(false); // false: 不要关闭 PC
                }
                break;
            case 'video-call-offer':
                if (!this.isCallActive && !this.isCallPending) { this.isCallPending = true; this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false); }
                else if (this.isCallActive && this.currentPeerId === peerId) this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                break;
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                break;
            case 'video-call-end': // 此消息现在意味着“媒体已结束”
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    NotificationManager.showNotification(`${UserManager.contacts[peerId]?.name || '对方'} 结束了通话媒体。`, 'info');
                    this.cleanupCallMediaAndState(false); // false: 不要关闭 PC
                }
                break;
            case 'video-call-stats': if (this.isCallActive && this.currentPeerId === peerId) this.handleCallStats(message.stats); break;
        }
    },
    handleCallStats: function (stats) {
        if (stats && typeof stats.rtt === 'number') Utils.log(`到 ${this.currentPeerId} 的通话 RTT: ${stats.rtt}ms. 丢包: ${stats.packetsLost || 'N/A'}`, Utils.logLevels.DEBUG);
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
        } catch (e) { Utils.log("收集 WebRTC 统计数据时出错: " + e, Utils.logLevels.WARN); }
    }
};