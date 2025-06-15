/**
 * @file VideoCallManager.js
 * @description 视频通话核心逻辑管理器。负责处理视频/音频通话和屏幕共享的所有核心功能，
 *              包括媒体流的获取、信令交换、连接协商以及通话状态管理。
 *              注意：此模块现在只处理媒体流的挂起，而不关闭底层的 RTCPeerConnection，
 *              以允许在同一次连接上进行数据传输和多次通话。
 * @module VideoCallManager
 * @exports {object} VideoCallManager - 对外暴露的单例对象，包含所有通话管理方法。
 * @property {function} init - 初始化模块，包括音乐播放器。
 * @property {function} initiateCall - 发起一个视频或音频通话。
 * @property {function} initiateScreenShare - 发起屏幕共享。
 * @property {function} acceptCall - 接听来电。
 * @property {function} rejectCall - 拒绝来电。
 * @property {function} hangUpMedia - 挂断当前通话的媒体流（不关闭连接）。
 * @property {function} handleMessage - 处理与通话相关的 P2P 消息。
 * @dependencies Config, Utils, NotificationManager, ConnectionManager, UserManager, VideoCallUIManager, ModalManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (绑定通话按钮事件)
 */
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

    // 音视频编解码器偏好设置
    audioConstraints: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
    codecPreferences: {
        audio: [{
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000;dtx=0'
        }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },

    /**
     * 初始化视频通话管理器。
     * @returns {boolean} - 初始化是否成功。
     */
    init: function () {
        try {
            this.musicPlayer = new Audio(Config.music);
            this.musicPlayer.loop = true;
            this.musicPlayer.addEventListener('ended', () => {
                if (this.isMusicPlaying) this.musicPlayer.play().catch(e => Utils.log(`音乐循环播放错误: ${e}`, Utils.logLevels.WARN));
            });
        } catch (e) {
            Utils.log(`初始化音乐时出错: ${e}`, Utils.logLevels.ERROR);
            this.musicPlayer = null;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。通话功能已禁用。', Utils.logLevels.ERROR);
            return false;
        }
        return true;
    },

    /**
     * 播放呼叫音乐。处理浏览器自动播放策略。
     * @param {boolean} [isRetry=false] - 是否为用户交互后的重试播放。
     */
    playMusic: function (isRetry = false) {
        if (this.musicPlayer && this.musicPlayer.paused && !this.isMusicPlaying) {
            Utils.log("正在尝试播放音乐...", Utils.logLevels.DEBUG);
            this.musicPlayer.play().then(() => {
                this.isMusicPlaying = true;
                Utils.log("音乐正在播放。", Utils.logLevels.INFO);
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
                    document.body.addEventListener('touchstart', this._boundEnableMusicPlay, {
                        once: true,
                        capture: true
                    });
                }
            });
        }
    },

    /**
     * 停止播放呼叫音乐。
     */
    stopMusic: function () {
        if (this.musicPlayer && (!this.musicPlayer.paused || this.isMusicPlaying)) {
            this.musicPlayer.pause();
            this.musicPlayer.currentTime = 0;
            this.isMusicPlaying = false;
            Utils.log("音乐已停止。", Utils.logLevels.INFO);
            if (this._boundEnableMusicPlay) {
                document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                delete this._boundEnableMusicPlay;
            }
        }
    },

    /**
     * 更新当前通话的 UI 状态。
     */
    updateCurrentCallUIState: function () {
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

    /**
     * 发起一个纯音频通话。
     * @param {string} peerId - 目标对方的 ID。
     */
    initiateAudioCall: function (peerId) {
        this.initiateCall(peerId, true);
    },

    /**
     * 发起屏幕共享。
     * @param {string} peerId - 目标对方的 ID。
     * @returns {Promise<void>}
     */
    initiateScreenShare: async function (peerId) {
        if (this.isCallActive || this.isCallPending) {
            NotificationManager.showNotification('已有通话/共享正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) {
            NotificationManager.showNotification('请选择一个伙伴以共享屏幕。', 'warning');
            return;
        }
        if (!ConnectionManager.isConnectedTo(peerId)) {
            NotificationManager.showNotification('未连接到对方。', 'error');
            return;
        }

        this.isScreenSharing = true;
        this.isAudioOnly = false;
        this.isVideoEnabled = true;
        this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId;
            this.isCaller = true;
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
            ModalManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), '屏幕共享');
            this.playMusic();
            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) {
                    ConnectionManager.sendTo(this.currentPeerId, {
                        type: 'video-call-cancel',
                        sender: UserManager.userId
                    });
                    this.cancelPendingCall();
                }
            }, 30000);
        } catch (error) {
            Utils.log(`发起屏幕共享失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('发起屏幕共享失败。', 'error');
            this.cleanupCallMediaAndState();
        }
    },

    /**
     * 发起一个通话（视频或纯音频）。
     * @param {string} peerId - 目标对方的 ID。
     * @param {boolean} [audioOnly=false] - 是否为纯音频通话。
     * @returns {Promise<void>}
     */
    initiateCall: async function (peerId, audioOnly = false) {
        if (this.isCallActive || this.isCallPending) {
            NotificationManager.showNotification('已有通话正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) {
            NotificationManager.showNotification('请选择一个伙伴进行通话。', 'warning');
            return;
        }
        if (!ConnectionManager.isConnectedTo(peerId)) {
            NotificationManager.showNotification('未连接到对方。', 'error');
            return;
        }

        this.isAudioOnly = audioOnly;
        this.isScreenSharing = false;
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId;
            this.isCaller = true;
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
            ModalManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), this.isAudioOnly ? '语音通话' : '视频通话');
            this.playMusic();
            this.callRequestTimeout = setTimeout(() => {
                if (this.isCallPending) {
                    ConnectionManager.sendTo(this.currentPeerId, {
                        type: 'video-call-cancel',
                        sender: UserManager.userId
                    });
                    this.cancelPendingCall();
                }
            }, 30000);
        } catch (error) {
            Utils.log(`发起通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('发起通话失败。', 'error');
            this.cleanupCallMediaAndState();
        }
    },

    /**
     * 显示来电请求界面。
     * @param {string} peerId - 来电方的 ID。
     * @param {boolean} [audioOnly=false] - 是否为纯音频通话。
     * @param {boolean} [isScreenShare=false] - 是否为屏幕共享。
     */
    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        this.currentPeerId = peerId;
        this.isAudioOnly = audioOnly;
        this.isScreenSharing = isScreenShare;
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;
        this.isCaller = false;
        ModalManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.playMusic();
    },

    /**
     * 接听来电。
     * @returns {Promise<void>}
     */
    acceptCall: async function () {
        ModalManager.hideCallRequest();
        this.stopMusic();
        if (!this.currentPeerId) {
            NotificationManager.showNotification('无效的通话请求。', 'error');
            return;
        }
        try {
            if (this.isScreenSharing) this.isVideoEnabled = false;
            await this.startLocalStreamAndSignal(false);
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (error) {
            Utils.log(`接听通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification(`接听通话失败: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-rejected',
                reason: 'device_error',
                sender: UserManager.userId
            });
            this.cleanupCallMediaAndState();
        }
    },

    /**
     * 拒绝来电。
     */
    rejectCall: function () {
        ModalManager.hideCallRequest();
        this.stopMusic();
        if (!this.currentPeerId) return;
        ConnectionManager.sendTo(this.currentPeerId, {
            type: 'video-call-rejected',
            reason: 'user_rejected',
            sender: UserManager.userId
        });
        this.cleanupCallMediaAndState(false);
        Utils.log('已拒绝通话请求。', Utils.logLevels.INFO);
    },

    /**
     * 获取本地媒体流并开始信令交换。
     * @param {boolean} isOfferCreatorForMedia - 当前用户是否为媒体协商的发起方。
     * @returns {Promise<void>}
     * @throws {Error} 如果获取媒体设备失败。
     */
    startLocalStreamAndSignal: async function (isOfferCreatorForMedia) {
        let attemptLocalCameraVideoSending = !this.isAudioOnly && !this.isScreenSharing;
        try {
            if (this.isScreenSharing) {
                if (this.isCaller) {
                    this.localStream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: true});
                    this.isVideoEnabled = true;
                    const screenTrack = this.localStream.getVideoTracks()[0];
                    if (screenTrack) screenTrack.onended = () => {
                        Utils.log("用户已结束屏幕共享。", Utils.logLevels.INFO);
                        this.hangUpMedia();
                    };
                    if (this.localStream.getAudioTracks().length === 0) {
                        try {
                            const micStream = await navigator.mediaDevices.getUserMedia({
                                audio: this.audioConstraints,
                                video: false
                            });
                            micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                        } catch (micError) {
                            Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN);
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
                        if (!this.isAudioOnly) NotificationManager.showNotification('没有摄像头。仅音频通话。', 'warning');
                        attemptLocalCameraVideoSending = false;
                    }
                }
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: attemptLocalCameraVideoSending,
                    audio: this.audioConstraints
                });
                this.isVideoEnabled = attemptLocalCameraVideoSending && this.localStream.getVideoTracks()[0]?.readyState !== 'ended';
                if (attemptLocalCameraVideoSending && !this.isVideoEnabled && !this.isAudioOnly) NotificationManager.showNotification('摄像头错误。仅音频通话。', 'warning');
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            if (this.isScreenSharing && this.isCaller) {
                NotificationManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error');
                this.cleanupCallMediaAndState();
                throw getUserMediaError;
            } else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) NotificationManager.showNotification(`摄像头错误: ${getUserMediaError.name}。仅音频通话。`, 'error');
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
                Utils.log(`备用音频错误: ${audioError.name}`, Utils.logLevels.ERROR);
                this.cleanupCallMediaAndState();
                throw audioError;
            }
        }

        if (this.localStream.getAudioTracks()[0]) this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        if (this.localStream.getVideoTracks()[0]) this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;

        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.setLocalStream(this.localStream);
            VideoCallUIManager.showCallContainer(true);
        }
        this.isCallActive = true;
        this.isCallPending = false;
        this.updateCurrentCallUIState();
        await this.setupPeerConnection(isOfferCreatorForMedia);
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = setInterval(() => this.collectAndSendStats(), 5000);
    },

    /**
     * 设置 RTCPeerConnection，添加轨道和事件监听器。
     * @param {boolean} isOfferCreatorForMedia - 当前用户是否为媒体协商的发起方。
     * @returns {Promise<void>}
     */
    setupPeerConnection: async function (isOfferCreatorForMedia) {
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: 没有 PeerConnection。", Utils.logLevels.ERROR); this.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);} catch(e){Utils.log("移除旧轨道时出错: "+e,Utils.logLevels.WARN);}});

        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                Utils.log(`通话 ${this.currentPeerId} 连接已 ${pc.connectionState}。正在挂断通话。`, Utils.logLevels.INFO);
                this.hangUpMedia(false); // Don't notify peer if connection is already bad/closed
            }
        });


        this.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio' || (track.kind === 'video' && this.isVideoEnabled && ((!this.isScreenSharing) || (this.isScreenSharing && this.isCaller)))) {
                try { pc.addTrack(track, this.localStream); } catch(e) { Utils.log(`向 PC 添加轨道 ${track.kind} 时出错: ${e.message}`, Utils.logLevels.ERROR); }
            }
        });
        this.setCodecPreferences(pc);
        pc.ontrack = (event) => {
            const trackHandler = (track) => {
                if (!track._videoManagerListenersAttached) {
                    track.onunmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已取消静音。`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); if (track.kind === 'video' && VideoCallUIManager.remoteVideo?.paused) VideoCallUIManager.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e}`,Utils.logLevels.WARN)); };
                    track.onmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已静音。`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); };
                    track.onended = () => {
                        Utils.log(`远程轨道 ${track.id} (${track.kind}) 已结束。`, Utils.logLevels.DEBUG);
                        if (this.remoteStream?.getTrackById(track.id)) try {this.remoteStream.removeTrack(track);}catch(e){Utils.log("从远程流移除轨道时出错: "+e,Utils.logLevels.WARN);}
                        if (track.kind === 'video' && this.isScreenSharing && !this.isCaller) { Utils.log("远程屏幕共享已结束。正在结束通话部分。", Utils.logLevels.INFO); this.hangUpMedia(false); }
                        else if (this.remoteStream && this.remoteStream.getTracks().length === 0) {
                            if(VideoCallUIManager.remoteVideo) VideoCallUIManager.remoteVideo.srcObject = null;
                            this.remoteStream = null;
                            Utils.log("所有远程轨道已结束。通话部分可能已结束。", Utils.logLevels.INFO);
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
        this.setupConnectionMonitoring(pc);
        if (isOfferCreatorForMedia) await this.createAndSendOffer();
    },

    /**
     * 监控 ICE 连接状态的变化。
     * @param {RTCPeerConnection} pc - 要监控的 PeerConnection 实例。
     */
    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`通话 ICE 状态: ${pc.iceConnectionState} (for ${this.currentPeerId})`, Utils.logLevels.DEBUG);
            if (this.isCallActive && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed')) {
                if (this.isCallActive) {
                    NotificationManager.showNotification('通话连接问题 (ICE)。媒体可能受影响。', 'warning');
                }
            }
        };
    },

    /**
     * 为 PeerConnection 设置首选的音视频编解码器。
     * @param {RTCPeerConnection} pc - 目标 PeerConnection 实例。
     */
    setCodecPreferences: function (pc) {
        if (typeof RTCRtpTransceiver === 'undefined' || !('setCodecPreferences' in RTCRtpTransceiver.prototype)) {
            Utils.log("setCodecPreferences 不受支持。", Utils.logLevels.WARN);
            return;
        }
        try {
            pc.getTransceivers().forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return;
                const kind = transceiver.sender.track.kind;
                if (kind === 'audio') {
                    const {codecs} = RTCRtpSender.getCapabilities('audio');
                    const preferredAudio = this.codecPreferences.audio.map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() && (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.includes(pref.sdpFmtpLine.split(';')[0]))))).filter(c => c);
                    if (preferredAudio.length > 0) try {
                        transceiver.setCodecPreferences(preferredAudio);
                    } catch (e) {
                        Utils.log(`设置音频编解码器首选项失败: ${e.message}`, Utils.logLevels.WARN);
                    }
                } else if (kind === 'video' && !this.isAudioOnly) {
                    const {codecs} = RTCRtpSender.getCapabilities('video');
                    const preferredVideo = this.codecPreferences.video.map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase())).filter(c => c);
                    if (preferredVideo.length > 0) try {
                        transceiver.setCodecPreferences(preferredVideo);
                    } catch (e) {
                        Utils.log(`设置视频编解码器首选项失败: ${e.message}`, Utils.logLevels.WARN);
                    }
                }
            });
        } catch (error) {
            Utils.log(`setCodecPreferences 出错: ${error.message}`, Utils.logLevels.WARN);
        }
    },

    /**
     * 修改 SDP 字符串以包含 Opus 编解码器的特定参数。
     * @param {string} sdp - 原始 SDP 字符串。
     * @returns {string} - 修改后的 SDP 字符串。
     */
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
            if (existingFmtpRegex.test(modifiedSdp)) modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$2 || '\r\n'));
            else {
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

    /**
     * 创建并发送一个媒体协商的提议 (offer)。
     * @returns {Promise<void>}
     */
    createAndSendOffer: async function () {
        if (!this.currentPeerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 用于创建提议", Utils.logLevels.ERROR);
            return;
        }
        try {
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: !this.isAudioOnly || this.isScreenSharing
            };
            const offer = await conn.peerConnection.createOffer(offerOptions);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-offer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (e) {
            Utils.log("创建/发送提议时出错: " + e, Utils.logLevels.ERROR);
            this.hangUpMedia();
        }
    },

    /**
     * 处理远程媒体提议 (offer)。
     * @param {RTCSessionDescriptionInit} sdpOffer - 远程 SDP 提议。
     * @param {string} peerId - 发送方的 ID。
     * @param {boolean} remoteIsAudioOnly - 对方是否为纯音频模式。
     * @param {boolean} [remoteIsScreenShare=false] - 对方是否在共享屏幕。
     * @returns {Promise<void>}
     */
    handleOffer: async function (sdpOffer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 来处理提议", Utils.logLevels.ERROR);
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
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: this.modifySdpForOpus(answer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (e) {
            Utils.log("处理提议时出错: " + e, Utils.logLevels.ERROR);
            this.hangUpMedia();
        }
    },

    /**
     * 处理远程媒体应答 (answer)。
     * @param {RTCSessionDescriptionInit} sdpAnswer - 远程 SDP 应答。
     * @param {string} peerId - 发送方的 ID。
     * @param {boolean} remoteIsAudioOnly - 对方是否为纯音频模式。
     * @param {boolean} [remoteIsScreenShare=false] - 对方是否在共享屏幕。
     * @returns {Promise<void>}
     */
    handleAnswer: async function (sdpAnswer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        if (this.currentPeerId !== peerId || !this.isCallActive) return;
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) return;
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`来自 ${peerId} 的应答已处理。`, Utils.logLevels.INFO);
        } catch (e) {
            Utils.log("处理应答时出错: " + e, Utils.logLevels.ERROR);
            this.hangUpMedia();
        }
    },

    /**
     * 切换本地摄像头的启用/禁用状态。
     */
    toggleCamera: function () {
        if (!this.isCallActive || !this.localStream || this.isAudioOnly || this.isScreenSharing) {
            if (this.isAudioOnly) NotificationManager.showNotification("纯音频通话中摄像头不可用。", "warning");
            if (this.isScreenSharing) NotificationManager.showNotification("屏幕共享期间摄像头不可用。", "warning");
            return;
        }
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (!videoTrack) {
            NotificationManager.showNotification('本地视频不可用。', 'warning');
            return;
        }
        this.isVideoEnabled = !this.isVideoEnabled;
        videoTrack.enabled = this.isVideoEnabled;
        this.updateCurrentCallUIState();
    },

    /**
     * 切换本地麦克风的静音/取消静音状态。
     */
    toggleAudio: function () {
        if (!this.isCallActive || !this.localStream || !this.localStream.getAudioTracks()[0]) return;
        this.isAudioMuted = !this.isAudioMuted;
        this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        this.updateCurrentCallUIState();
    },

    /**
     * 在通话开始前，切换纯音频模式。
     * @returns {Promise<void>}
     */
    toggleAudioOnly: async function () {
        if (this.isCallActive) {
            NotificationManager.showNotification("通话中无法切换模式。", "warning");
            return;
        }
        this.isAudioOnly = !this.isAudioOnly;
        Utils.log("已切换纯音频模式 (通话前): " + this.isAudioOnly, Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    /**
     * 挂断当前通话的媒体流，但不关闭底层的 RTCPeerConnection。
     * @param {boolean} [notifyPeer=true] - 是否通知对方媒体已结束。
     */
    hangUpMedia: function (notifyPeer = true) {
        Utils.log(`正在为对方 ${this.currentPeerId} 挂断媒体。通知: ${notifyPeer}`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        if (notifyPeer && (this.isCallActive || this.isCallPending) && this.currentPeerId) {
            ConnectionManager.sendTo(this.currentPeerId, {type: 'video-call-end', sender: UserManager.userId});
        }
        this.cleanupCallMediaAndState(false);
    },

    /**
     * 取消一个等待对方响应的通话。
     */
    cancelPendingCall: function () {
        Utils.log(`正在为对方 ${this.currentPeerId} 取消等待中的通话。`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;
        this.cleanupCallMediaAndState(false);
    },

    /**
     * 清理所有与通话相关的媒体资源和状态。
     * @param {boolean} [closePeerConnection=true] - 是否关闭底层的 RTCPeerConnection。
     */
    cleanupCallMediaAndState: function (closePeerConnection = true) {
        Utils.log(`正在清理通话媒体和状态。关闭 PC: ${closePeerConnection}`, Utils.logLevels.INFO);
        this.stopMusic();
        ModalManager.hideCallingModal();
        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = null;

        this.releaseMediaResources();

        const peerIdToClean = this.currentPeerId;
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

        const oldPeerIdForPCClosure = this.currentPeerId;
        this.isCallActive = false;
        this.isCallPending = false;
        this.isCaller = false;
        this.isAudioMuted = false;
        this.isAudioOnly = false;
        this.isScreenSharing = false;
        this.isVideoEnabled = true;
        this.currentPeerId = null;

        if (closePeerConnection && oldPeerIdForPCClosure) {
            Utils.log(`作为完整通话结束的一部分，正在关闭与 ${oldPeerIdForPCClosure} 的 RTCPeerConnection。`, Utils.logLevels.INFO);
            ConnectionManager.close(oldPeerIdForPCClosure, false);
        } else if (oldPeerIdForPCClosure) {
            Utils.log(`与 ${oldPeerIdForPCClosure} 的 RTCPeerConnection 已保留。媒体已挂断。`, Utils.logLevels.INFO);
        }

        Utils.log('通话媒体和状态已清理。', Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    /**
     * 释放本地媒体资源（摄像头和麦克风）。
     */
    releaseMediaResources: function () {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                Utils.log(`已停止本地轨道: ${track.kind} id: ${track.id}`, Utils.logLevels.DEBUG);
            });
            this.localStream = null;
        }
    },

    /**
     * 处理与通话相关的 P2P 消息。
     * @param {object} message - 从数据通道接收到的消息对象。
     * @param {string} peerId - 发送方的 ID。
     */
    handleMessage: function (message, peerId) {
        switch (message.type) {
            case 'video-call-request':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false);
                } else ConnectionManager.sendTo(peerId, {
                    type: 'video-call-rejected',
                    reason: 'busy',
                    sender: UserManager.userId
                });
                break;
            case 'video-call-accepted':
                if (this.isCallPending && this.isCaller && this.currentPeerId === peerId) {
                    this.stopMusic();
                    ModalManager.hideCallingModal();
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
                        ModalManager.hideCallingModal();
                    }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    NotificationManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 拒绝。原因: ${message.reason || 'N/A'}`, 'warning');
                    this.cleanupCallMediaAndState(false);
                }
                break;
            case 'video-call-cancel':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (!this.isCaller) {
                        this.stopMusic();
                        ModalManager.hideCallRequest();
                    }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    if (!this.isCaller) NotificationManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 取消。`, 'warning');
                    this.cleanupCallMediaAndState(false);
                }
                break;
            case 'video-call-offer':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else if (this.isCallActive && this.currentPeerId === peerId) this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                break;
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                break;
            case 'video-call-end':
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    NotificationManager.showNotification(`${UserManager.contacts[peerId]?.name || '对方'} 结束了通话媒体。`, 'info');
                    this.cleanupCallMediaAndState(false);
                }
                break;
            case 'video-call-stats':
                if (this.isCallActive && this.currentPeerId === peerId) this.handleCallStats(message.stats);
                break;
        }
    },

    /**
     * 处理接收到的通话统计信息。
     * @param {object} stats - 包含统计数据的对象。
     */
    handleCallStats: function (stats) {
        if (stats && typeof stats.rtt === 'number') Utils.log(`到 ${this.currentPeerId} 的通话 RTT: ${stats.rtt}ms. 丢包: ${stats.packetsLost || 'N/A'}`, Utils.logLevels.DEBUG);
    },

    /**
     * 收集并发送通话统计数据。
     * @returns {Promise<void>}
     */
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
            if (relevantStats.rtt !== null) ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-stats',
                stats: relevantStats,
                sender: UserManager.userId
            });
        } catch (e) {
            Utils.log("收集 WebRTC 统计数据时出错: " + e, Utils.logLevels.WARN);
        }
    }
};