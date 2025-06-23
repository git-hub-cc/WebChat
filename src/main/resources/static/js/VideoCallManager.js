/**
 * @file VideoCallManager.js
 * @description 视频通话核心逻辑管理器。负责处理视频/音频通话和屏幕共享的所有核心功能，
 *              包括媒体流的获取、信令交换、连接协商以及通话状态管理。
 *              通话中基于网络状况进行自适应音频质量调整及控制台日志。
 *              默认采用单声道 Opus，优化差网络下表现，并支持动态调整音频参数。
 *              新增：当 setRemoteDescription 遇到 m-line 顺序错误时，中止通话。
 * @module VideoCallManager
 * @exports {object} VideoCallManager - 对外暴露的单例对象，包含所有通话管理方法。
 * @property {function} init - 初始化模块，包括音乐播放器。
 * @property {function} initiateCall - 发起一个视频或音频通话。
 * @property {function} initiateScreenShare - 发起屏幕共享。
 * @property {function} acceptCall - 接听来电。
 * @property {function} rejectCall - 拒绝来电。
 * @property {function} hangUpMedia - 挂断当前通话的媒体流（不关闭连接）。
 * @property {function} handleMessage - 处理与通话相关的  消息。
 * @dependencies Config, Utils, NotificationUIManager, ConnectionManager, WebRTCManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (绑定通话按钮事件)
 */
const VideoCallManager = {
    localStream: null,
    remoteStream: null,
    currentPeerId: null,
    isCallActive: false,
    isCaller: false, //  Indicates if this client initiated the current call (important for renegotiation control)
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

    audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
    },
    codecPreferences: {
        audio: [{ // This is a fallback/default, actual sdpFmtpLine will come from adaptive profiles
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 1,
            sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000;cbr=0;maxplaybackrate=16000;sprop-stereo=0'
        }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },

    _adaptiveAudioIntervalId: null,
    _currentAudioProfileIndex: {},
    _lastProfileSwitchTime: {},
    _consecutiveGoodChecks: {},
    _consecutiveBadChecks: {},
    _lastNegotiatedSdpFmtpLine: {}, // Stores the sdpFmtpLine used in the last successful negotiation for a peer

    /**
     * 初始化视频通话管理器。
     * @returns {boolean} - 初始化是否成功。
     */
    init: function () {
        try {
            this.musicPlayer = new Audio(Config.media.music);
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
        this._lastNegotiatedSdpFmtpLine = {}; // Ensure clean state on init
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
                    NotificationUIManager.showNotification("音乐播放被阻止。请点击/触摸以启用。", "warning");
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
            NotificationUIManager.showNotification('已有通话/共享正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) {
            NotificationUIManager.showNotification('请选择一个伙伴以共享屏幕。', 'warning');
            return;
        }
        if (!ConnectionManager.isConnectedTo(peerId)) {
            NotificationUIManager.showNotification('未连接到对方。', 'error');
            return;
        }

        this.isScreenSharing = true;
        this.isAudioOnly = false;
        this.isVideoEnabled = true;
        this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId;
            this.isCaller = true; // This client is initiating the call/share
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
            ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), '屏幕共享');
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
            NotificationUIManager.showNotification('发起屏幕共享失败。', 'error');
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
            NotificationUIManager.showNotification('已有通话正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId) {
            NotificationUIManager.showNotification('请选择一个伙伴进行通话。', 'warning');
            return;
        }
        if (!ConnectionManager.isConnectedTo(peerId)) {
            NotificationUIManager.showNotification('未连接到对方。', 'error');
            return;
        }

        this.isAudioOnly = audioOnly;
        this.isScreenSharing = false;
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId;
            this.isCaller = true; // This client is initiating the call
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
            ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), this.isAudioOnly ? '语音通话' : '视频通话');
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
            NotificationUIManager.showNotification('发起通话失败。', 'error');
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
        this.isCaller = false; // This client is receiving the call request
        ModalUIManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.playMusic();
    },

    /**
     * 接听来电。
     * @returns {Promise<void>}
     */
    acceptCall: async function () {
        ModalUIManager.hideCallRequest();
        this.stopMusic();
        if (!this.currentPeerId) {
            NotificationUIManager.showNotification('无效的通话请求。', 'error');
            return;
        }
        try {
            if (this.isScreenSharing) this.isVideoEnabled = false;

            // isCaller is already false (set in showCallRequest)
            // The offer will come from the caller. We will handleOffer.
            // So, isOfferCreatorForMedia will be false.
            await this.startLocalStreamAndSignal(false);
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (error) {
            Utils.log(`接听通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`接听通话失败: ${error.message}`, 'error');
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
        ModalUIManager.hideCallRequest();
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
            if (this.isScreenSharing && this.isCaller) {
                this.localStream = await navigator.mediaDevices.getDisplayMedia({video: { cursor: "always" }, audio: true});
                this.isVideoEnabled = true;
                const screenTrack = this.localStream.getVideoTracks()[0];
                if (screenTrack) screenTrack.onended = () => {
                    Utils.log("用户已结束屏幕共享。", Utils.logLevels.INFO);
                    this.hangUpMedia();
                };
                if (this.localStream.getAudioTracks().length === 0) {
                    try {
                        const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                        micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                    } catch (micError) {
                        Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN);
                    }
                }
            } else {
                if (attemptLocalCameraVideoSending) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if(!this.isAudioOnly) NotificationUIManager.showNotification('没有摄像头。切换到纯音频通话。', 'warning');
                        attemptLocalCameraVideoSending = false;
                        this.isAudioOnly = true;
                    }
                }
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: attemptLocalCameraVideoSending ? {} : false, audio: this.audioConstraints });
                this.isVideoEnabled = attemptLocalCameraVideoSending && this.localStream.getVideoTracks()[0]?.readyState !== 'ended';
                if (attemptLocalCameraVideoSending && !this.isVideoEnabled && !this.isAudioOnly) {
                    NotificationUIManager.showNotification('摄像头错误。切换到纯音频通话。', 'error');
                    this.isAudioOnly = true;
                }
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            if (this.isScreenSharing && this.isCaller) {
                NotificationUIManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error');
                this.cleanupCallMediaAndState();
                throw getUserMediaError;
            } else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) {
                NotificationUIManager.showNotification(`摄像头错误: ${getUserMediaError.name}。切换到纯音频通话。`, 'error');
            }
            try {
                if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                this.isAudioOnly = true;
                this.isVideoEnabled = false;
                if(this.isScreenSharing) this.isScreenSharing = false;
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
    },

    /**
     * 设置 RTCPeerConnection，添加轨道和事件监听器。
     * @param {boolean} isOfferCreatorForMedia - 当前用户是否为媒体协商的发起方。
     * @returns {Promise<void>}
     */
    setupPeerConnection: async function (isOfferCreatorForMedia) {
        const conn = WebRTCManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: 没有 PeerConnection。", Utils.logLevels.ERROR); this.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);}catch(e){Utils.log("移除旧轨道时出错: "+e,Utils.logLevels.WARN);}});

        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                Utils.log(`通话 ${this.currentPeerId} 连接已 ${pc.connectionState}。正在挂断通话。`, Utils.logLevels.INFO);
                this.hangUpMedia(false);
            }
        });

        this.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio' ||
                (track.kind === 'video' && this.isVideoEnabled && (!this.isScreenSharing || (this.isScreenSharing && this.isCaller)))) {
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
                    track.onended = () => {
                        Utils.log(`远程轨道 ${track.id} (${track.kind}) 已结束。`, Utils.logLevels.DEBUG);
                        if (this.remoteStream?.getTrackById(track.id)) try {this.remoteStream.removeTrack(track);}catch(e){Utils.log("从远程流移除轨道时出错: "+e,Utils.logLevels.WARN);}
                        if (track.kind === 'video' && this.isScreenSharing && !this.isCaller) {
                            Utils.log("远程屏幕共享已结束。正在结束通话部分。", Utils.logLevels.INFO);
                            this.hangUpMedia(false);
                        }
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
                    if (typeof VideoCallUIManager !== 'undefined' && (!VideoCallUIManager.remoteVideo?.srcObject || VideoCallUIManager.remoteVideo.srcObject.getTracks().length === 0)) {
                        VideoCallUIManager.setRemoteStream(this.remoteStream);
                    }
                }
                if (!this.remoteStream.getTrackById(event.track.id)) {
                    this.remoteStream.addTrack(event.track);
                }
                if (typeof VideoCallUIManager !== 'undefined' && VideoCallUIManager.remoteVideo?.srcObject !== this.remoteStream && this.remoteStream.getTracks().length > 0) {
                    VideoCallUIManager.setRemoteStream(this.remoteStream);
                }
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
            // 'failed', 'disconnected', 'closed' states are handled by 'connectionstatechange'
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
            const transceivers = pc.getTransceivers();
            transceivers.forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return;
                const kind = transceiver.sender.track.kind;

                if (kind === 'audio') {
                    const { codecs } = RTCRtpSender.getCapabilities('audio');
                    const preferredAudioCodecs = this.codecPreferences.audio
                        .map(pref => codecs.find(c =>
                            c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() &&
                            (pref.clockRate ? c.clockRate === pref.clockRate : true) &&
                            (pref.channels ? c.channels === pref.channels : true) &&
                            (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.toLowerCase().includes(pref.sdpFmtpLine.split(';')[0].toLowerCase())))
                        ))
                        .filter(c => c);

                    if (preferredAudioCodecs.length > 0) {
                        try {
                            transceiver.setCodecPreferences(preferredAudioCodecs);
                            Utils.log(`为音频轨道设置编解码器首选项: ${preferredAudioCodecs.map(c=>c.mimeType).join(', ')}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`设置音频编解码器首选项失败: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                } else if (kind === 'video' && !this.isAudioOnly) {
                    const { codecs } = RTCRtpSender.getCapabilities('video');
                    const preferredVideoCodecs = this.codecPreferences.video
                        .map(pref => codecs.find(c => c.mimeType.toLowerCase() === pref.mimeType.toLowerCase()))
                        .filter(c => c);

                    if (preferredVideoCodecs.length > 0) {
                        try {
                            transceiver.setCodecPreferences(preferredVideoCodecs);
                            Utils.log(`为视频轨道设置编解码器首选项: ${preferredVideoCodecs.map(c=>c.mimeType).join(', ')}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`设置视频编解码器首选项失败: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                }
            });
        } catch (error) {
            Utils.log(`setCodecPreferences 出错: ${error.message}`, Utils.logLevels.WARN);
        }
    },

    /**
     * 修改 SDP 字符串以包含特定音频配置档案的 Opus 编解码器参数 (如 ptime, FEC, stereo)。
     * @param {string} sdp - 原始 SDP 字符串。
     * @param {string} peerId - 当前操作关联的对方ID，用于获取该对方的音频配置。
     * @returns {string} - 修改后的 SDP 字符串。
     */
    modifySdpForOpus: function(sdp, peerId) {
        let targetSdpFmtpLine;
        const profileIndex = (peerId && this._currentAudioProfileIndex[peerId] !== undefined)
            ? this._currentAudioProfileIndex[peerId]
            : Config.adaptiveAudioQuality.initialProfileIndex;

        const audioProfile = Config.adaptiveAudioQuality.audioQualityProfiles[profileIndex];

        if (audioProfile && audioProfile.sdpFmtpLine) {
            targetSdpFmtpLine = audioProfile.sdpFmtpLine;
            Utils.log(`modifySdpForOpus for ${peerId}: Using sdpFmtpLine from profile ${profileIndex} ('${audioProfile.levelName}'): ${targetSdpFmtpLine}`, Utils.logLevels.DEBUG);
        } else {
            const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
            targetSdpFmtpLine = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0'; // Fallback
            Utils.log(`modifySdpForOpus for ${peerId}: Falling back to ${audioProfile ? 'profile-less' : 'default'} sdpFmtpLine: ${targetSdpFmtpLine}`, Utils.logLevels.DEBUG);
        }

        const opusRegex = /a=rtpmap:(\d+) opus\/48000(\/2)?/gm;
        let match;
        let modifiedSdp = sdp;
        const opusTargetParams = targetSdpFmtpLine;

        while ((match = opusRegex.exec(sdp)) !== null) {
            const opusPayloadType = match[1];
            const fmtpLineForPayload = `a=fmtp:${opusPayloadType} ${opusTargetParams}`;
            const existingFmtpRegex = new RegExp(`^a=fmtp:${opusPayloadType} .*(\\r\\n)?`, 'm');

            if (existingFmtpRegex.test(modifiedSdp)) {
                modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$1 || '\r\n'));
                Utils.log(`SDP 修改：为 Opus (PT ${opusPayloadType}, Peer ${peerId}) 更新 fmtp: ${opusTargetParams}`, Utils.logLevels.DEBUG);
            } else {
                const rtpmapLineSignature = `a=rtpmap:${opusPayloadType} opus/48000${match[2] || ''}`;
                const rtpmapLineIndex = modifiedSdp.indexOf(rtpmapLineSignature);
                if (rtpmapLineIndex !== -1) {
                    const endOfRtpmapLine = modifiedSdp.indexOf('\n', rtpmapLineIndex);
                    const insertPosition = (endOfRtpmapLine !== -1) ? endOfRtpmapLine : modifiedSdp.length;
                    modifiedSdp = modifiedSdp.slice(0, insertPosition) + `\r\n${fmtpLineForPayload}` + modifiedSdp.slice(insertPosition);
                    Utils.log(`SDP 修改：为 Opus (PT ${opusPayloadType}, Peer ${peerId}) 添加 fmtp: ${opusTargetParams}`, Utils.logLevels.DEBUG);
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
        if (!this.currentPeerId || !this.isCallActive) return; // Check if call is active, not just pending
        const conn = WebRTCManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 用于创建提议", Utils.logLevels.ERROR);
            this.hangUpMedia();
            return;
        }
        try {
            this._applyAudioProfileToSender(this.currentPeerId,
                this._currentAudioProfileIndex[this.currentPeerId] !== undefined
                    ? this._currentAudioProfileIndex[this.currentPeerId]
                    : Config.adaptiveAudioQuality.initialProfileIndex);

            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: !this.isAudioOnly || (this.isScreenSharing && this.isCaller)
            };
            // For renegotiation, ensure ICE restart is handled if needed (usually not for simple codec param changes)
            // offerOptions.iceRestart = (conn.peerConnection.signalingState === 'stable'); // Example if restart needed

            const offer = await conn.peerConnection.createOffer(offerOptions);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp, this.currentPeerId)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);

            const offerProfileIndex = (this._currentAudioProfileIndex[this.currentPeerId] !== undefined)
                ? this._currentAudioProfileIndex[this.currentPeerId]
                : Config.adaptiveAudioQuality.initialProfileIndex;
            const offerAudioProfile = Config.adaptiveAudioQuality.audioQualityProfiles[offerProfileIndex];
            if (offerAudioProfile && offerAudioProfile.sdpFmtpLine) {
                this._lastNegotiatedSdpFmtpLine[this.currentPeerId] = offerAudioProfile.sdpFmtpLine;
            } else {
                const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
                this._lastNegotiatedSdpFmtpLine[this.currentPeerId] = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0';
            }
            Utils.log(`Offer for ${this.currentPeerId} created with sdpFmtpLine: ${this._lastNegotiatedSdpFmtpLine[this.currentPeerId]} (isCaller=${this.isCaller})`, Utils.logLevels.DEBUG);

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
        const conn = WebRTCManager.connections[peerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 来处理提议", Utils.logLevels.ERROR);
            return;
        }
        try {
            const isInitialOffer = !this.isCallActive; // True if this is the first offer establishing the call for us
            if (isInitialOffer) {
                this.isScreenSharing = remoteIsScreenShare;
                this.isAudioOnly = remoteIsAudioOnly && !remoteIsScreenShare;
                this.currentPeerId = peerId;
                this.isCaller = false; // We are receiving an offer, so we are not the initial caller of this media session
                this.isVideoEnabled = !this.isAudioOnly && !this.isScreenSharing;
                await this.startLocalStreamAndSignal(false);
            }
            // For re-offers, current state (isAudioOnly, etc.) should already be set.

            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            this._applyAudioProfileToSender(peerId,
                this._currentAudioProfileIndex[peerId] !== undefined
                    ? this._currentAudioProfileIndex[peerId]
                    : Config.adaptiveAudioQuality.initialProfileIndex);

            const answer = await conn.peerConnection.createAnswer();
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: this.modifySdpForOpus(answer.sdp, peerId)});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);

            const answerProfileIndex = (this._currentAudioProfileIndex[peerId] !== undefined)
                ? this._currentAudioProfileIndex[peerId]
                : Config.adaptiveAudioQuality.initialProfileIndex;
            const answerAudioProfile = Config.adaptiveAudioQuality.audioQualityProfiles[answerProfileIndex];
            if (answerAudioProfile && answerAudioProfile.sdpFmtpLine) {
                this._lastNegotiatedSdpFmtpLine[peerId] = answerAudioProfile.sdpFmtpLine;
            } else {
                const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
                this._lastNegotiatedSdpFmtpLine[peerId] = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0';
            }
            Utils.log(`Answer for ${peerId} created with sdpFmtpLine: ${this._lastNegotiatedSdpFmtpLine[peerId]} (isCaller=${this.isCaller})`, Utils.logLevels.DEBUG);


            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing && this.isCaller,
                sender: UserManager.userId
            });

            // If this was an initial offer, start adaptive audio check.
            // If it's a re-offer, the check might already be running. _startAdaptiveAudioCheck handles this.
            this._startAdaptiveAudioCheck(peerId);

        } catch (e) {
            Utils.log(`处理来自 ${peerId} 的提议时出错: ${e.message}`, Utils.logLevels.ERROR);
            if (e.message && e.message.includes("The order of m-lines")) {
                NotificationUIManager.showNotification("通话协商失败 (媒体描述不匹配)，通话已结束。", "error");
                Utils.log(`M-line 顺序错误，为 ${peerId} 中止通话。`, Utils.logLevels.ERROR);
            }
            this.hangUpMedia(true); // 发生错误时，通知对方并挂断
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
        if (this.currentPeerId !== peerId || !this.isCallActive) {
            Utils.log(`收到来自 ${peerId} 的应答，但当前通话不匹配或未激活。忽略。`, Utils.logLevels.WARN);
            return;
        }
        const conn = WebRTCManager.connections[peerId];
        if (!conn || !conn.peerConnection) {
            Utils.log(`处理来自 ${peerId} 的应答时没有 PeerConnection。忽略。`, Utils.logLevels.ERROR);
            return;
        }
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`来自 ${peerId} 的应答已处理。 Last negotiated sdpFmtpLine for this peer was: ${this._lastNegotiatedSdpFmtpLine[peerId]}`, Utils.logLevels.INFO);
            // The _lastNegotiatedSdpFmtpLine was set when this client (caller) created the offer.
            // The answer confirms this negotiation.

            // For the offer initiator (caller), start adaptive audio check after answer is received.
            this._startAdaptiveAudioCheck(peerId);
        } catch (e) {
            Utils.log("处理应答时出错: " + e, Utils.logLevels.ERROR);
            if (e.message && e.message.includes("The order of m-lines")) {
                NotificationUIManager.showNotification("通话协商失败 (媒体描述不匹配)，通话已结束。", "error");
                Utils.log(`M-line 顺序错误，为 ${peerId} 中止通话。`, Utils.logLevels.ERROR);
            }
            this.hangUpMedia(true); // 发生错误时，通知对方并挂断
        }
    },

    /**
     * 切换本地摄像头的启用/禁用状态。
     */
    toggleCamera: function () {
        if (!this.isCallActive || !this.localStream) {
            NotificationUIManager.showNotification("通话未激活或本地流不存在。", "warning");
            return;
        }
        if (this.isAudioOnly) {
            NotificationUIManager.showNotification("纯音频通话中摄像头不可用。", "warning");
            return;
        }
        if (this.isScreenSharing && this.isCaller) {
            NotificationUIManager.showNotification("屏幕共享期间摄像头不可用。", "warning");
            return;
        }

        const videoTrack = this.localStream.getVideoTracks().find(t => t.kind === 'video' && t.readyState === 'live');

        if (!videoTrack && !this.isScreenSharing) {
            NotificationUIManager.showNotification('本地视频轨道不可用。', 'warning');
            this.isVideoEnabled = false;
            this.updateCurrentCallUIState();
            return;
        }
        if (videoTrack) {
            this.isVideoEnabled = !this.isVideoEnabled;
            videoTrack.enabled = this.isVideoEnabled;
        } else {
            this.isVideoEnabled = false;
        }

        this.updateCurrentCallUIState();
    },

    /**
     * 切换本地麦克风的静音/取消静音状态。
     */
    toggleAudio: function () {
        if (!this.isCallActive || !this.localStream || !this.localStream.getAudioTracks()[0]) {
            NotificationUIManager.showNotification("通话未激活或本地音频轨道不存在。", "warning");
            return;
        }
        this.isAudioMuted = !this.isAudioMuted;
        this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        this.updateCurrentCallUIState();
    },

    /**
     * 在通话开始前，切换纯音频模式。
     * @returns {Promise<void>}
     */
    toggleAudioOnly: async function () {
        if (this.isCallActive || this.isCallPending) {
            NotificationUIManager.showNotification("通话中或等待时无法切换模式。", "warning");
            return;
        }
        this.isAudioOnly = !this.isAudioOnly;
        Utils.log("已切换纯音频模式 (通话前): " + this.isAudioOnly, Utils.logLevels.INFO);
        this.isVideoEnabled = !this.isAudioOnly;
        this.updateCurrentCallUIState();
    },

    /**
     * 挂断当前通话的媒体流，但不关闭底层的 RTCPeerConnection (除非是完整结束)。
     * @param {boolean} [notifyPeer=true] - 是否通知对方媒体已结束。
     */
    hangUpMedia: function (notifyPeer = true) {
        const peerIdToHangUp = this.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToHangUp || '未知'} 挂断媒体。通知: ${notifyPeer}`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        this._stopAdaptiveAudioCheck(peerIdToHangUp);

        if (notifyPeer && (this.isCallActive || this.isCallPending) && peerIdToHangUp) {
            ConnectionManager.sendTo(peerIdToHangUp, {type: 'video-call-end', sender: UserManager.userId});
        }
        this.cleanupCallMediaAndState(false);
    },

    /**
     * 取消一个等待对方响应的通话。
     */
    cancelPendingCall: function () {
        const peerIdToCancel = this.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToCancel || '未知'} 取消等待中的通话。`, Utils.logLevels.INFO);
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;
        this._stopAdaptiveAudioCheck(peerIdToCancel);
        this.cleanupCallMediaAndState(false);
    },

    /**
     * 清理所有与通话相关的媒体资源和状态。
     * @param {boolean} [closePeerConnectionIfUnused=true] - 是否在没有其他用途（如数据通道）时关闭底层的 RTCPeerConnection。
     */
    cleanupCallMediaAndState: function (closePeerConnectionIfUnused = true) {
        const peerIdCleaned = this.currentPeerId;
        Utils.log(`正在清理通话媒体和状态 (for ${peerIdCleaned || '未知'})。关闭 PC (如果未使用): ${closePeerConnectionIfUnused}`, Utils.logLevels.INFO);

        this.stopMusic();
        ModalUIManager.hideCallingModal();
        ModalUIManager.hideCallRequest();

        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = null;

        this._stopAdaptiveAudioCheck(peerIdCleaned);
        if (peerIdCleaned) {
            delete this._lastNegotiatedSdpFmtpLine[peerIdCleaned];
        } else { // Should ideally not happen without a peerId if a call was active
            this._lastNegotiatedSdpFmtpLine = {};
        }

        this.releaseMediaResources();

        Utils.log(`peerIdCleaned ${peerIdCleaned}`, Utils.logLevels.INFO);
        Utils.log(`WebRTCManager.connections ${typeof WebRTCManager !== 'undefined' ? WebRTCManager.connections : 'WebRTCManager undefined'}`, Utils.logLevels.INFO);
        if (peerIdCleaned) {
            const conn = typeof WebRTCManager !== 'undefined' ? WebRTCManager.connections[peerIdCleaned] : null;
            if (conn && conn.peerConnection) {
                conn.peerConnection.getSenders().forEach(sender => {
                    if (sender.track) {
                        try {
                            conn.peerConnection.removeTrack(sender);
                            Utils.log(`已从 ${peerIdCleaned} 的 PC 中移除轨道 ${sender.track.kind}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`从 ${peerIdCleaned} 的 PC 中移除轨道时出错: ${e.message}`, Utils.logLevels.WARN);
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

        this.isCallActive = false;
        this.isCallPending = false;
        // Do not reset isCaller here, as it might be needed for a quick follow-up action or log.
        // It will be set correctly when a new call is initiated or received.
        this.isAudioMuted = false;
        this.isAudioOnly = false;
        this.isScreenSharing = false;
        this.isVideoEnabled = true;

        const previousPeerId = this.currentPeerId;
        this.currentPeerId = null;

        if (closePeerConnectionIfUnused && previousPeerId) {
            Utils.log(`作为通话清理的一部分，考虑关闭与 ${previousPeerId} 的 RTCPeerConnection。`, Utils.logLevels.INFO);
            ConnectionManager.closePeerConnection(previousPeerId);
        } else if (previousPeerId) {
            Utils.log(`与 ${previousPeerId} 的 RTCPeerConnection 已保留。媒体已挂断。`, Utils.logLevels.INFO);
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
     * 处理与通话相关的信令消息。
     * @param {object} message - 从数据通道接收到的消息对象。
     * @param {string} peerId - 发送方的 ID。
     */
    handleMessage: function (message, peerId) {
        switch (message.type) {
            case 'video-call-request':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    // isCaller will be set to false in showCallRequest
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
                    ModalUIManager.hideCallingModal();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    // isCaller is already true.
                    // The client that sent 'video-call-request' (this.isCaller=true) will now
                    // create an offer. So isOfferCreatorForMedia is true.
                    this.startLocalStreamAndSignal(true);
                }
                break;
            case 'video-call-rejected':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (this.isCaller) {
                        this.stopMusic();
                        ModalUIManager.hideCallingModal();
                    } else {
                        ModalUIManager.hideCallRequest();
                    }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    NotificationUIManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 拒绝。原因: ${message.reason || 'N/A'}`, 'warning');
                    this.cleanupCallMediaAndState(false);
                }
                break;
            case 'video-call-cancel':
                if (this.isCallPending && !this.isCaller && this.currentPeerId === peerId) {
                    this.stopMusic();
                    ModalUIManager.hideCallRequest();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    NotificationUIManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 取消。`, 'warning');
                    this.cleanupCallMediaAndState(false);
                }
                break;
            case 'video-call-offer':
                // `this.isCaller` will be set to false in `handleOffer` if it's an initial offer.
                // For re-offers, `this.isCaller` reflects the *original* call initiator.
                if ((!this.isCallActive && !this.isCallPending) || (this.isCallActive && this.currentPeerId === peerId)) {
                    if (!this.isCallActive) this.isCallPending = true;
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 offer，但当前状态冲突. 忽略。`, Utils.logLevels.WARN);
                }
                break;
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) {
                    // `this.isCaller` should be true if this client sent the offer.
                    this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 answer，但当前状态不匹配。忽略。`, Utils.logLevels.WARN);
                }
                break;
            case 'video-call-end':
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    NotificationUIManager.showNotification(`${UserManager.contacts[peerId]?.name || '对方'} 结束了通话媒体。`, 'info');
                    this.cleanupCallMediaAndState(false);
                }
                break;
        }
    },

    // --- 自适应音频质量相关方法 ---

    /**
     * @private
     * @description 由呼叫发起方 (caller) 启动 WebRTC 重新协商流程。
     *              通常在需要更改 SDP 参数 (如 sdpFmtpLine) 时调用。
     * @param {string} peerId - 需要重新协商的对方ID。
     */
    _initiateRenegotiation: function(peerId) {
        Utils.log(`Caller (this.isCaller=${this.isCaller}) attempting to initiate renegotiation with ${peerId} for sdpFmtpLine change.`, Utils.logLevels.INFO);
        const conn = WebRTCManager.connections[peerId];

        // Ensure this client is the original caller, the call is active, it's the correct peer,
        // and the PeerConnection is in a stable state for sending a new offer.
        if (this.isCaller && this.isCallActive && this.currentPeerId === peerId &&
            conn && conn.peerConnection && conn.peerConnection.signalingState === 'stable') {

            Utils.log(`Proceeding with renegotiation for ${peerId}. Creating new offer.`, Utils.logLevels.INFO);
            // createAndSendOffer will use the updated _currentAudioProfileIndex[peerId]
            // to get the new sdpFmtpLine via the modified modifySdpForOpus.
            // It will also update this._lastNegotiatedSdpFmtpLine after setLocalDescription.
            this.createAndSendOffer();
        } else {
            Utils.log(`Cannot initiate renegotiation with ${peerId}. Conditions not met: isCaller=${this.isCaller}, isCallActive=${this.isCallActive}, currentPeerId=${this.currentPeerId}, peerConnection exists=${!!(conn && conn.peerConnection)}, signalingState=${conn?.peerConnection?.signalingState}`, Utils.logLevels.WARN);
        }
    },

    /**
     * @private
     * @description 启动周期性的网络状况检查以调整音频质量。
     * @param {string} peerId - 当前通话的对方ID。
     */
    _startAdaptiveAudioCheck: function(peerId) {
        if (!peerId) {
            Utils.log("尝试为未定义的 peerId 启动自适应音频检测，已跳过。", Utils.logLevels.WARN);
            return;
        }
        if (this._adaptiveAudioIntervalId && this._adaptiveAudioIntervalId[peerId]) {
            // Already running for this peer
            return;
        }
        if (!this._adaptiveAudioIntervalId) this._adaptiveAudioIntervalId = {};

        this._currentAudioProfileIndex[peerId] = Config.adaptiveAudioQuality.initialProfileIndex;
        this._lastProfileSwitchTime[peerId] = 0;
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;
        // _lastNegotiatedSdpFmtpLine[peerId] is set during offer/answer, not here.

        // Apply initial bitrate, sdpFmtpLine will be handled by initial negotiation
        this._applyAudioProfileToSender(peerId, Config.adaptiveAudioQuality.initialProfileIndex);

        this._adaptiveAudioIntervalId[peerId] = setInterval(() => {
            this._checkAndAdaptAudioQuality(peerId);
        }, Config.adaptiveAudioQuality.interval);
        Utils.log(`已为 ${peerId} 启动自适应音频质量检测，初始等级: ${Config.adaptiveAudioQuality.audioQualityProfiles[Config.adaptiveAudioQuality.initialProfileIndex].levelName} (isCaller: ${this.isCaller})。`, Utils.logLevels.INFO);
    },

    /**
     * @private
     * @description 停止自适应音频质量检测。
     * @param {string} [peerId] - (可选) 如果提供，则仅清理特定对方的状态和定时器。
     */
    _stopAdaptiveAudioCheck: function(peerId) {
        if (peerId && this._adaptiveAudioIntervalId && this._adaptiveAudioIntervalId[peerId]) {
            clearInterval(this._adaptiveAudioIntervalId[peerId]);
            delete this._adaptiveAudioIntervalId[peerId];
            Utils.log(`已停止对 ${peerId} 的自适应音频质量检测。`, Utils.logLevels.INFO);
            delete this._currentAudioProfileIndex[peerId];
            delete this._lastProfileSwitchTime[peerId];
            delete this._consecutiveGoodChecks[peerId];
            delete this._consecutiveBadChecks[peerId];
            // Do not delete _lastNegotiatedSdpFmtpLine[peerId] here, cleanupCallMediaAndState handles it
            if (Object.keys(this._adaptiveAudioIntervalId).length === 0) {
                this._adaptiveAudioIntervalId = null;
            }
        } else if (!peerId && this._adaptiveAudioIntervalId) {
            Utils.log(`正在停止所有自适应音频质量检测...`, Utils.logLevels.INFO);
            for (const id in this._adaptiveAudioIntervalId) {
                if (this._adaptiveAudioIntervalId.hasOwnProperty(id)) {
                    clearInterval(this._adaptiveAudioIntervalId[id]);
                    Utils.log(`已停止对 ${id} 的自适应音频质量检测。`, Utils.logLevels.DEBUG);
                }
            }
            this._adaptiveAudioIntervalId = null;
            this._currentAudioProfileIndex = {};
            this._lastProfileSwitchTime = {};
            this._consecutiveGoodChecks = {};
            this._consecutiveBadChecks = {};
            Utils.log(`所有自适应音频质量检测已停止并清理状态。`, Utils.logLevels.INFO);
        }
    },
    /**
     * @private
     * @description 根据当前网络统计数据决定最佳的音频质量等级索引。
     * @param {string} peerId - 对方ID。
     * @param {object} currentStats - 包含 {rtt, packetLoss, jitter} 的对象。
     * @returns {number} - 目标音质等级的索引。
     */
    _determineOptimalQualityLevel: function(peerId, currentStats) {
        const profiles = Config.adaptiveAudioQuality.audioQualityProfiles;
        const currentLevelIndex = this._currentAudioProfileIndex[peerId] !== undefined
            ? this._currentAudioProfileIndex[peerId]
            : Config.adaptiveAudioQuality.initialProfileIndex;

        const { baseGoodConnectionThresholds, stabilityCountForUpgrade, badQualityDowngradeThreshold } = Config.adaptiveAudioQuality;
        let targetLevelIndex = currentLevelIndex;

        const significantlyBetterFactor = 0.7;
        const slightlyWorseFactor = 1.3;
        const veryPoorFactor = 2.0;

        const meetsBaseline = currentStats.rtt <= baseGoodConnectionThresholds.rtt &&
            currentStats.packetLoss <= baseGoodConnectionThresholds.packetLoss &&
            currentStats.jitter <= baseGoodConnectionThresholds.jitter;

        const isSignificantlyBetter = currentStats.rtt < baseGoodConnectionThresholds.rtt * significantlyBetterFactor &&
            currentStats.packetLoss < baseGoodConnectionThresholds.packetLoss * significantlyBetterFactor &&
            currentStats.jitter < baseGoodConnectionThresholds.jitter * significantlyBetterFactor;

        const isSlightlyWorse = currentStats.rtt > baseGoodConnectionThresholds.rtt * slightlyWorseFactor ||
            currentStats.packetLoss > baseGoodConnectionThresholds.packetLoss + 0.01 ||
            currentStats.jitter > baseGoodConnectionThresholds.jitter * slightlyWorseFactor;

        const isVeryPoor = currentStats.rtt > baseGoodConnectionThresholds.rtt * veryPoorFactor ||
            currentStats.packetLoss > baseGoodConnectionThresholds.packetLoss + 0.03 ||
            currentStats.jitter > baseGoodConnectionThresholds.jitter * veryPoorFactor;

        if (meetsBaseline) {
            this._consecutiveGoodChecks[peerId] = (this._consecutiveGoodChecks[peerId] || 0) + 1;
            this._consecutiveBadChecks[peerId] = 0;
        } else {
            this._consecutiveBadChecks[peerId] = (this._consecutiveBadChecks[peerId] || 0) + 1;
            this._consecutiveGoodChecks[peerId] = 0;
        }

        if (this._consecutiveGoodChecks[peerId] >= stabilityCountForUpgrade) {
            if (isSignificantlyBetter && targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 2, profiles.length - 1);
            } else if (meetsBaseline && targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 1, profiles.length - 1);
            }
            if (targetLevelIndex > currentLevelIndex) {
                this._consecutiveGoodChecks[peerId] = 0;
            }
        }

        if (this._consecutiveBadChecks[peerId] >= badQualityDowngradeThreshold) {
            if (isVeryPoor && targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 2, 0);
            } else if (isSlightlyWorse && targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 1, 0);
            }
            if (targetLevelIndex < currentLevelIndex) {
                this._consecutiveBadChecks[peerId] = 0;
            }
        }
        return Math.max(0, Math.min(targetLevelIndex, profiles.length - 1));
    },

    /**
     * @private
     * @description 周期性检查网络状况并决定是否调整音频质量。
     * @param {string} peerId - 当前通话的对方ID。
     */
    _checkAndAdaptAudioQuality: async function(peerId) {
        if (!peerId || typeof WebRTCManager === 'undefined' || !WebRTCManager.connections[peerId]) {
            Utils.log(`AdaptiveAudioCheck: 对方 ${peerId || '未知'} 的连接信息不存在。跳过。`, Utils.logLevels.WARN);
            return;
        }
        const pc = WebRTCManager.connections[peerId].peerConnection;
        if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            Utils.log(`AdaptiveAudioCheck for ${peerId}: PeerConnection 不存在或已关闭/失败/断开. 跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        try {
            const stats = await pc.getStats();
            let currentRtt = Infinity, currentPacketLoss = 1, currentJitter = Infinity;

            stats.forEach(report => {
                if (report.type === 'outbound-rtp' && report.kind === 'audio' && report.remoteId) {
                    const remoteInboundReport = stats.get(report.remoteId);
                    if (remoteInboundReport) {
                        if (remoteInboundReport.roundTripTime !== undefined) currentRtt = Math.min(currentRtt, remoteInboundReport.roundTripTime * 1000);
                        if (remoteInboundReport.packetsLost !== undefined && remoteInboundReport.packetsReceived !== undefined) {
                            const totalPackets = remoteInboundReport.packetsLost + remoteInboundReport.packetsReceived + (remoteInboundReport.packetsDiscarded || 0);
                            if (totalPackets > 0) currentPacketLoss = Math.min(currentPacketLoss, (remoteInboundReport.packetsLost + (remoteInboundReport.packetsDiscarded || 0)) / totalPackets);
                        }
                        if (remoteInboundReport.jitter !== undefined) currentJitter = Math.min(currentJitter, remoteInboundReport.jitter * 1000);
                    }
                }
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime !== undefined) {
                    currentRtt = Math.min(currentRtt, report.currentRoundTripTime * 1000);
                }
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                    if (report.jitter !== undefined) currentJitter = Math.min(currentJitter, report.jitter * 1000);
                    if (report.packetsLost !== undefined && report.packetsReceived !== undefined) {
                        const totalPackets = report.packetsLost + report.packetsReceived + (report.packetsDiscarded || 0);
                        if (totalPackets > 0) currentPacketLoss = Math.min(currentPacketLoss, (report.packetsLost + (report.packetsDiscarded || 0)) / totalPackets);
                    }
                }
            });

            if (!isFinite(currentRtt) && currentPacketLoss === 1 && !isFinite(currentJitter)) {
                Utils.log(`AdaptiveAudioCheck for ${peerId}: 未能获取有效的网络统计数据。跳过调整。`, Utils.logLevels.WARN);
                return;
            }
            if (!isFinite(currentRtt)) currentRtt = Config.adaptiveAudioQuality.baseGoodConnectionThresholds.rtt * 3;
            if (currentPacketLoss === 1 && isFinite(stats.size)) currentPacketLoss = Config.adaptiveAudioQuality.baseGoodConnectionThresholds.packetLoss + 0.1;
            else if (currentPacketLoss === 1) currentPacketLoss = 0.5;
            if (!isFinite(currentJitter)) currentJitter = Config.adaptiveAudioQuality.baseGoodConnectionThresholds.jitter * 3;


            const currentStats = { rtt: currentRtt, packetLoss: currentPacketLoss, jitter: currentJitter };
            const currentProfileIndex = this._currentAudioProfileIndex[peerId] !== undefined
                ? this._currentAudioProfileIndex[peerId]
                : Config.adaptiveAudioQuality.initialProfileIndex;

            const optimalLevelIndex = this._determineOptimalQualityLevel(peerId, currentStats);

            const currentProfile = Config.adaptiveAudioQuality.audioQualityProfiles[currentProfileIndex];
            const optimalProfile = Config.adaptiveAudioQuality.audioQualityProfiles[optimalLevelIndex];
            const currentProfileName = currentProfile ? currentProfile.levelName : `索引 ${currentProfileIndex}`;
            const optimalProfileName = optimalProfile ? optimalProfile.levelName : `索引 ${optimalLevelIndex}`;


            if (Config.adaptiveAudioQuality.logStatsToConsole) {
                Utils.log(`[AudioQualityEval for ${peerId} (Caller: ${this.isCaller})]: Stats(RTT: ${currentRtt.toFixed(0)}ms, Loss: ${(currentPacketLoss*100).toFixed(2)}%, Jitter: ${currentJitter.toFixed(0)}ms) -> 当前: Lvl ${currentProfileIndex} ('${currentProfileName}'), 目标: Lvl ${optimalLevelIndex} ('${optimalProfileName}')`, Utils.logLevels.INFO);
            }

            const { switchToHigherCooldown, switchToLowerCooldown } = Config.adaptiveAudioQuality;
            const lastSwitchTime = this._lastProfileSwitchTime[peerId] || 0;
            const now = Date.now();

            if (optimalLevelIndex !== currentProfileIndex) {
                if (optimalLevelIndex > currentProfileIndex) {
                    if (now - lastSwitchTime > switchToHigherCooldown) {
                        this._switchToAudioProfile(peerId, optimalLevelIndex);
                    } else {
                        Utils.log(`[AudioQualityEval for ${peerId}]: 尝试提升至 '${optimalProfileName}'，但提升冷却期未结束。`, Utils.logLevels.DEBUG);
                    }
                } else {
                    if (now - lastSwitchTime > switchToLowerCooldown) {
                        this._switchToAudioProfile(peerId, optimalLevelIndex);
                    } else {
                        Utils.log(`[AudioQualityEval for ${peerId}]: 尝试降低至 '${optimalProfileName}'，但降低冷却期未结束。`, Utils.logLevels.DEBUG);
                    }
                }
            }
        } catch (error) {
            Utils.log(`在 _checkAndAdaptAudioQuality (for ${peerId}) 中出错: ${error.message || error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * @private
     * @description 切换到指定的音频配置档案，并根据需要触发重新协商。
     * @param {string} peerId - 目标对方ID。
     * @param {number} newLevelIndex - 要切换到的配置档案的索引。
     */
    _switchToAudioProfile: function(peerId, newLevelIndex) {
        if (this._currentAudioProfileIndex[peerId] === newLevelIndex && this.isCallActive) {
            Utils.log(`请求切换到与当前相同的音频配置 (${newLevelIndex}) for ${peerId}，已跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        const oldLevelIndex = this._currentAudioProfileIndex[peerId];
        this._currentAudioProfileIndex[peerId] = newLevelIndex;
        this._lastProfileSwitchTime[peerId] = Date.now();
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;

        const newProfile = Config.adaptiveAudioQuality.audioQualityProfiles[newLevelIndex];
        const newSdpFmtpLine = newProfile ? newProfile.sdpFmtpLine : null;

        const oldProfileFallbackSdpLine = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus')?.sdpFmtpLine || 'minptime=10;useinbandfec=1;stereo=0';
        const oldProfile = Config.adaptiveAudioQuality.audioQualityProfiles[oldLevelIndex];
        const currentNegotiatedSdpLine = this._lastNegotiatedSdpFmtpLine[peerId] || (oldProfile ? oldProfile.sdpFmtpLine : oldProfileFallbackSdpLine);

        if (this.isCallActive && newSdpFmtpLine && newSdpFmtpLine !== currentNegotiatedSdpLine) {
            if (this.isCaller) { // Only the original caller of the call initiates renegotiation
                Utils.log(`[AudioQuality for ${peerId}]: Caller needs to change sdpFmtpLine from '${currentNegotiatedSdpLine}' to '${newSdpFmtpLine}'. Initiating renegotiation.`, Utils.logLevels.INFO);
                this._initiateRenegotiation(peerId);
            } else {
                Utils.log(`[AudioQuality for ${peerId}]: Callee detected need for sdpFmtpLine change to '${newProfile.levelName}' (new: '${newSdpFmtpLine}', current_negotiated: '${currentNegotiatedSdpLine}'). Waiting for caller to initiate.`, Utils.logLevels.INFO);
            }
        }

        this._applyAudioProfileToSender(peerId, newLevelIndex);

        const profileName = newProfile ? newProfile.levelName : "未知等级";
        const description = newProfile ? newProfile.description : "无描述";

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('audioProfileChanged', { peerId: peerId, profileName: profileName, profileIndex: newLevelIndex, description: description });
        }
        NotificationUIManager.showNotification(`音频质量已调整为: ${profileName}`, 'info', 1500);
        Utils.log(`音频配置已切换为 Lvl ${newLevelIndex} ('${profileName}') for ${peerId}. New sdpFmtpLine: ${newSdpFmtpLine || 'N/A'}. Current negotiated sdpFmtpLine: ${currentNegotiatedSdpLine || 'N/A'}. (isCaller: ${this.isCaller})`, Utils.logLevels.INFO);
    },

    /**
     * @private
     * @description 将指定的音频配置应用到与对方的音频发送器。
     * @param {string} peerId - 目标对方ID。
     * @param {number} levelIndex - 要应用的配置档案的索引。
     */
    _applyAudioProfileToSender: function(peerId, levelIndex) {
        if (!peerId || typeof WebRTCManager === 'undefined' || !WebRTCManager.connections[peerId]) {
            Utils.log(`_applyAudioProfileToSender: 对方 ${peerId || '未知'} 的连接信息不存在。跳过。`, Utils.logLevels.WARN);
            return;
        }
        const pc = WebRTCManager.connections[peerId].peerConnection;
        if (!pc || !this.localStream) {
            Utils.log(`_applyAudioProfileToSender: PeerConnection 或本地流 (for ${peerId}) 不存在。跳过。`, Utils.logLevels.WARN);
            return;
        }

        const audioProfile = Config.adaptiveAudioQuality.audioQualityProfiles[levelIndex];
        if (!audioProfile) {
            Utils.log(`_applyAudioProfileToSender: 未找到等级 ${levelIndex} 的音频配置。跳过。`, Utils.logLevels.WARN);
            return;
        }

        pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
                const parameters = sender.getParameters();
                if (!parameters.encodings || parameters.encodings.length === 0) {
                    parameters.encodings = [{}];
                }

                let changed = false;
                if (audioProfile.maxAverageBitrate && parameters.encodings[0].maxBitrate !== audioProfile.maxAverageBitrate) {
                    parameters.encodings[0].maxBitrate = audioProfile.maxAverageBitrate;
                    changed = true;
                }
                // DTX and FEC are primarily handled via SDP (sdpFmtpLine)
                // Direct control via setParameters for these is less common/standardized.
                // If sdpFmtpLine changes, renegotiation handles it.

                if (changed) {
                    sender.setParameters(parameters)
                        .then(() => Utils.log(`音频配置档案 '${audioProfile.levelName}' (Lvl ${levelIndex}) 的码率 (${audioProfile.maxAverageBitrate}) 已成功应用到发送器 (for ${peerId})。`, Utils.logLevels.INFO))
                        .catch(e => Utils.log(`应用音频配置档案 '${audioProfile.levelName}' (for ${peerId}) 的码率时发生错误: ${e.message || e}`, Utils.logLevels.ERROR));
                } else {
                    Utils.log(`音频配置档案 '${audioProfile.levelName}' (Lvl ${levelIndex}) 无需应用码率 (for ${peerId})，参数未改变。当前码率: ${parameters.encodings[0].maxBitrate}`, Utils.logLevels.DEBUG);
                }
            }
        });
    }
};