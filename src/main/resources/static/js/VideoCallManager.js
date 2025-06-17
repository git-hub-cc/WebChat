/**
 * @file VideoCallManager.js
 * @description 视频通话核心逻辑管理器。负责处理视频/音频通话和屏幕共享的所有核心功能，
 *              包括媒体流的获取、信令交换、连接协商以及通话状态管理。
 *              新增：通话中基于网络状况的五级自适应音频质量调整及控制台日志。
 *              修改：默认采用单声道 Opus，优化差网络下表现。
 * @module VideoCallManager
 * @exports {object} VideoCallManager - 对外暴露的单例对象，包含所有通话管理方法。
 * @property {function} init - 初始化模块，包括音乐播放器。
 * @property {function} initiateCall - 发起一个视频或音频通话。
 * @property {function} initiateScreenShare - 发起屏幕共享。
 * @property {function} acceptCall - 接听来电。
 * @property {function} rejectCall - 拒绝来电。
 * @property {function} hangUpMedia - 挂断当前通话的媒体流（不关闭连接）。
 * @property {function} handleMessage - 处理与通话相关的  消息。
 * @dependencies Config, Utils, NotificationUIManager, ConnectionManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter
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
    statsInterval: null, // 用于旧的通用统计，自适应音频有自己的定时器
    musicPlayer: null,
    isMusicPlaying: false,
    _boundEnableMusicPlay: null,

    // 音视频编解码器偏好设置
    audioConstraints: { // 增加了 channelCount: 1 以建议获取单声道麦克风输入
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1 // 建议使用单声道麦克风输入
    },
    codecPreferences: {
        audio: [{
            mimeType: 'audio/opus',
            clockRate: 48000, // Opus 通常使用 48kHz 采样率，但 WebRTC 内部可能会处理
            channels: 1,      // 明确指定单声道
            // sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000;dtx=0' // 修改: stereo=0 强制单声道, clockRate 48000 对应opus标准
            sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000;cbr=0;maxplaybackrate=16000;sprop-stereo=0' // 进一步优化：明确单声道，限制播放速率以适应低带宽
        }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },

    _adaptiveAudioIntervalId: null,
    _currentAudioProfileIndex: {}, // Stores index: { peerId1: 2, peerId2: 1 }
    _lastProfileSwitchTime: {},
    _consecutiveGoodChecks: {},   // { peerId1: 0 }
    _consecutiveBadChecks: {},    // { peerId1: 0 }


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
        this.isAudioOnly = false; // 屏幕共享不是纯音频通话
        this.isVideoEnabled = true; // 屏幕共享包含视频
        this.isAudioMuted = false;
        try {
            this.currentPeerId = peerId;
            this.isCaller = true;
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly, // false for screen share
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
            this.isCaller = true;
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
        this.isVideoEnabled = !audioOnly; // 如果是纯音频或对方屏幕共享，本地视频初始不启用
        this.isAudioMuted = false;
        this.isCaller = false;
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
            // 如果是接听屏幕共享，我们只发送音频，不发送本地视频
            if (this.isScreenSharing) this.isVideoEnabled = false;

            await this.startLocalStreamAndSignal(false); // isOfferCreatorForMedia = false
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing, // 我们是否在共享屏幕 (作为接收方，通常是false)
                sender: UserManager.userId
            });
            // _startAdaptiveAudioCheck is called within handleAnswer or startLocalStreamAndSignal after offer/answer
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
        // attemptLocalCameraVideoSending 决定是否尝试获取本地摄像头视频
        // 如果是纯音频通话，则为 false
        // 如果是视频通话，则为 true
        // 如果是发起屏幕共享，则为 false (屏幕流将作为视频源)
        // 如果是接收屏幕共享，则为 false (我们只发送音频，不发送摄像头视频)
        let attemptLocalCameraVideoSending = !this.isAudioOnly && !this.isScreenSharing;

        try {
            if (this.isScreenSharing && this.isCaller) { // 发起方共享屏幕
                this.localStream = await navigator.mediaDevices.getDisplayMedia({video: { cursor: "always" }, audio: true}); // 共享屏幕时也尝试获取系统音频
                this.isVideoEnabled = true; // 屏幕流是视频
                const screenTrack = this.localStream.getVideoTracks()[0];
                if (screenTrack) screenTrack.onended = () => {
                    Utils.log("用户已结束屏幕共享。", Utils.logLevels.INFO);
                    this.hangUpMedia(); // 用户停止共享，则挂断整个媒体
                };
                // 如果屏幕共享未包含音频轨道，尝试单独获取麦克风
                if (this.localStream.getAudioTracks().length === 0) {
                    try {
                        const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                        micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                    } catch (micError) {
                        Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN);
                        // 即使麦克风失败，屏幕共享依然可以进行（无声）
                    }
                }
            } else { // 非屏幕共享发起方 (即普通通话，或接收屏幕共享方)
                if (attemptLocalCameraVideoSending) { // 如果是视频通话，检查有无摄像头
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if(!this.isAudioOnly) NotificationUIManager.showNotification('没有摄像头。切换到纯音频通话。', 'warning');
                        attemptLocalCameraVideoSending = false; // 没有摄像头，强制不尝试获取视频
                        this.isAudioOnly = true; // 标记为纯音频，以免后续逻辑错误
                    }
                }
                // 根据 attemptLocalCameraVideoSending 获取媒体
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: attemptLocalCameraVideoSending ? {} : false, audio: this.audioConstraints });
                this.isVideoEnabled = attemptLocalCameraVideoSending && this.localStream.getVideoTracks()[0]?.readyState !== 'ended';
                if (attemptLocalCameraVideoSending && !this.isVideoEnabled && !this.isAudioOnly) { // 尝试了视频但失败了
                    NotificationUIManager.showNotification('摄像头错误。切换到纯音频通话。', 'error');
                    this.isAudioOnly = true; // 标记为纯音频
                }
            }
        } catch (getUserMediaError) { // 获取媒体失败
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false; // 获取视频失败
            if (this.isScreenSharing && this.isCaller) { // 如果是发起屏幕共享失败
                NotificationUIManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error');
                this.cleanupCallMediaAndState(); // 清理并结束
                throw getUserMediaError; // 抛出错误，中断流程
            } else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) {
                // 如果是普通视频通话尝试获取视频失败
                NotificationUIManager.showNotification(`摄像头错误: ${getUserMediaError.name}。切换到纯音频通话。`, 'error');
            }
            // 尝试备用方案：只获取音频
            try {
                if (this.localStream) this.localStream.getTracks().forEach(t => t.stop()); // 停止可能存在的故障流
                this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                this.isAudioOnly = true; // 强制为纯音频
                this.isVideoEnabled = false;
                if(this.isScreenSharing) this.isScreenSharing = false; // 如果是屏幕共享接收方音频也失败，则退化为普通音频
            } catch (audioError) { // 备用音频也失败
                Utils.log(`备用音频错误: ${audioError.name}`, Utils.logLevels.ERROR);
                this.cleanupCallMediaAndState();
                throw audioError; // 抛出错误，中断流程
            }
        }

        // 设置音视频轨道的启用状态
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
        const conn = ConnectionManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: 没有 PeerConnection。", Utils.logLevels.ERROR); this.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        // 清理旧的发送器，以防重用 PeerConnection 时出现问题
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);}catch(e){Utils.log("移除旧轨道时出错: "+e,Utils.logLevels.WARN);}});

        pc.addEventListener('connectionstatechange', () => { // 使用 addEventListener 以便移除
            if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                Utils.log(`通话 ${this.currentPeerId} 连接已 ${pc.connectionState}。正在挂断通话。`, Utils.logLevels.INFO);
                this.hangUpMedia(false); // 通常不需要再通知对方，因为对方可能也检测到了
            }
        });

        // 添加本地流轨道到 PeerConnection
        this.localStream.getTracks().forEach(track => {
            // 只添加需要发送的轨道：
            // - 音频轨道总是添加
            // - 视频轨道：
            //   - 如果 this.isVideoEnabled 为 true (即非纯音频，且摄像头/屏幕源可用)
            //   - 且 (不是屏幕共享 OR (是屏幕共享且我是发起方))
            //     (这意味着，如果我是屏幕共享接收方，不发送我的摄像头视频)
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

        // 应用初始的默认音频配置
        // this._applyAudioProfileToSender 会在 offer/answer 流程中更合适的位置调用
        // _startAdaptiveAudioCheck 会在 offer/answer 流程中调用，并应用初始配置
        // 但如果作为 offer 创建者，可以在创建 offer 前主动应用一次初始配置
        // if (isOfferCreatorForMedia) {
        //     this._applyAudioProfileToSender(this.currentPeerId, Config.adaptiveAudioQuality.initialProfileIndex);
        // }


        pc.ontrack = (event) => {
            const trackHandler = (track) => {
                if (!track._videoManagerListenersAttached) { // 防止重复添加监听器
                    track.onunmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已取消静音。`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); if (track.kind === 'video' && VideoCallUIManager.remoteVideo?.paused) VideoCallUIManager.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e}`,Utils.logLevels.WARN)); };
                    track.onmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已静音。`, Utils.logLevels.DEBUG); this.updateCurrentCallUIState(); };
                    track.onended = () => {
                        Utils.log(`远程轨道 ${track.id} (${track.kind}) 已结束。`, Utils.logLevels.DEBUG);
                        if (this.remoteStream?.getTrackById(track.id)) try {this.remoteStream.removeTrack(track);}catch(e){Utils.log("从远程流移除轨道时出错: "+e,Utils.logLevels.WARN);}
                        // 如果是对方的屏幕共享轨道结束了 (我是接收方)
                        if (track.kind === 'video' && this.isScreenSharing && !this.isCaller) {
                            Utils.log("远程屏幕共享已结束。正在结束通话部分。", Utils.logLevels.INFO);
                            this.hangUpMedia(false); // 挂断媒体，但不一定关闭连接
                        }
                        else if (this.remoteStream && this.remoteStream.getTracks().length === 0) { // 所有远程轨道都没了
                            if(VideoCallUIManager.remoteVideo) VideoCallUIManager.remoteVideo.srcObject = null;
                            this.remoteStream = null;
                            Utils.log("所有远程轨道已结束。通话部分可能已结束。", Utils.logLevels.INFO);
                        }
                        this.updateCurrentCallUIState();
                    };
                    track._videoManagerListenersAttached = true;
                }
            };

            // 处理接收到的轨道
            if (event.streams && event.streams[0]) { // 通常 WebRTC 使用单个流
                if (VideoCallUIManager.remoteVideo?.srcObject !== event.streams[0]) {
                    if (typeof VideoCallUIManager !== 'undefined') VideoCallUIManager.setRemoteStream(event.streams[0]);
                    this.remoteStream = event.streams[0];
                }
                // 为流中的所有轨道（和事件中的轨道）附加处理器
                if (this.remoteStream) this.remoteStream.getTracks().forEach(t => trackHandler(t));
                if (event.track) trackHandler(event.track); // 有时 event.track 更及时
            } else if (event.track) { // 如果没有 streams 但有 track (例如 plan-b SDP)
                if (!this.remoteStream) {
                    this.remoteStream = new MediaStream();
                    // 仅当 remoteVideo 没有流或流中无轨道时才设置新的空流
                    if (typeof VideoCallUIManager !== 'undefined' && (!VideoCallUIManager.remoteVideo?.srcObject || VideoCallUIManager.remoteVideo.srcObject.getTracks().length === 0)) {
                        VideoCallUIManager.setRemoteStream(this.remoteStream);
                    }
                }
                if (!this.remoteStream.getTrackById(event.track.id)) { // 避免重复添加
                    this.remoteStream.addTrack(event.track);
                }
                // 如果 remoteVideo 的流不是当前的 remoteStream，且 remoteStream 有轨道了，则更新
                if (typeof VideoCallUIManager !== 'undefined' && VideoCallUIManager.remoteVideo?.srcObject !== this.remoteStream && this.remoteStream.getTracks().length > 0) {
                    VideoCallUIManager.setRemoteStream(this.remoteStream);
                }
                trackHandler(event.track);
            }
            this.updateCurrentCallUIState();
        };
        this.setupConnectionMonitoring(pc); // 监控 ICE 连接状态
        if (isOfferCreatorForMedia) await this.createAndSendOffer();
    },

    /**
     * 监控 ICE 连接状态的变化。
     * @param {RTCPeerConnection} pc - 要监控的 PeerConnection 实例。
     */
    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`通话 ICE 状态: ${pc.iceConnectionState} (for ${this.currentPeerId})`, Utils.logLevels.DEBUG);
            // 'failed', 'disconnected', 'closed' 状态通常在 'connectionstatechange' 中处理更全面
            // 但这里也可以保留一个轻量级的日志或通知
            if (this.isCallActive && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed')) {
                if (this.isCallActive) { // 再次检查 isCallActive，因为 hangUpMedia 可能会被多次触发
                    // NotificationUIManager.showNotification('通话连接问题 (ICE)。媒体可能受影响。', 'warning');
                    // 通常 'connectionstatechange' 会处理挂断，这里避免重复通知或操作
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
            const transceivers = pc.getTransceivers();
            transceivers.forEach(transceiver => {
                if (!transceiver.sender || !transceiver.sender.track) return; // 只处理有发送轨道的收发器
                const kind = transceiver.sender.track.kind;

                if (kind === 'audio') {
                    const { codecs } = RTCRtpSender.getCapabilities('audio'); // 获取浏览器支持的音频编解码器
                    // 从我们的偏好列表中筛选出浏览器支持的，并保持偏好顺序
                    const preferredAudioCodecs = this.codecPreferences.audio
                        .map(pref => codecs.find(c =>
                            c.mimeType.toLowerCase() === pref.mimeType.toLowerCase() &&
                            (pref.clockRate ? c.clockRate === pref.clockRate : true) &&
                            (pref.channels ? c.channels === pref.channels : true) &&
                            // 检查 sdpFmtpLine 的关键部分是否匹配 (例如 'useinbandfec=1')
                            (!pref.sdpFmtpLine || (c.sdpFmtpLine && c.sdpFmtpLine.toLowerCase().includes(pref.sdpFmtpLine.split(';')[0].toLowerCase())))
                        ))
                        .filter(c => c); // 过滤掉未找到的

                    if (preferredAudioCodecs.length > 0) {
                        try {
                            transceiver.setCodecPreferences(preferredAudioCodecs);
                            Utils.log(`为音频轨道设置编解码器首选项: ${preferredAudioCodecs.map(c=>c.mimeType).join(', ')}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`设置音频编解码器首选项失败: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                } else if (kind === 'video' && !this.isAudioOnly) { // 只在非纯音频通话时设置视频编解码器
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
     * 修改 SDP 字符串以包含 Opus 编解码器的特定参数 (如强制单声道、FEC等)。
     * @param {string} sdp - 原始 SDP 字符串。
     * @returns {string} - 修改后的 SDP 字符串。
     */
    modifySdpForOpus: function (sdp) {
        // 匹配 Opus rtpmap行，采样率48000，声道数可以是1或2 ( (\/2)? )
        const opusRegex = /a=rtpmap:(\d+) opus\/48000(\/2)?/gm;
        let match;
        let modifiedSdp = sdp;

        // 从 codecPreferences 获取目标 Opus fmtp 参数，现在已包含 stereo=0
        const opusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
        const opusTargetParams = opusPreference ? opusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0'; // 默认值也设为单声道

        while ((match = opusRegex.exec(sdp)) !== null) {
            const opusPayloadType = match[1];
            // 构造目标 fmtp 行，基于 codecPreferences
            const fmtpLineForPayload = `a=fmtp:${opusPayloadType} ${opusTargetParams}`;

            // 查找并替换已存在的此 payload type 的 fmtp 行
            const existingFmtpRegex = new RegExp(`^a=fmtp:${opusPayloadType} .*(\\r\\n)?`, 'm');
            if (existingFmtpRegex.test(modifiedSdp)) {
                modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$1 || '\r\n'));
                Utils.log(`SDP 修改：为 Opus (PT ${opusPayloadType}) 更新 fmtp: ${opusTargetParams}`, Utils.logLevels.DEBUG);
            } else {
                // 如果不存在，则在对应的 rtpmap 行后插入
                const rtpmapLineSignature = `a=rtpmap:${opusPayloadType} opus/48000${match[2] || ''}`; // 保持原始声道数标记或无标记（通常表示1）
                const rtpmapLineIndex = modifiedSdp.indexOf(rtpmapLineSignature);
                if (rtpmapLineIndex !== -1) {
                    const endOfRtpmapLine = modifiedSdp.indexOf('\n', rtpmapLineIndex);
                    const insertPosition = (endOfRtpmapLine !== -1) ? endOfRtpmapLine : modifiedSdp.length; // 找到换行符位置
                    // 插入时确保换行符正确
                    modifiedSdp = modifiedSdp.slice(0, insertPosition) + `\r\n${fmtpLineForPayload}` + modifiedSdp.slice(insertPosition);
                    Utils.log(`SDP 修改：为 Opus (PT ${opusPayloadType}) 添加 fmtp: ${opusTargetParams}`, Utils.logLevels.DEBUG);
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
            this.hangUpMedia(); // 没有PC无法继续，挂断
            return;
        }
        try {
            // 在创建Offer前应用初始音频配置 (如果尚未在setupPeerConnection中完成或需要刷新)
            this._applyAudioProfileToSender(this.currentPeerId,
                this._currentAudioProfileIndex[this.currentPeerId] !== undefined
                    ? this._currentAudioProfileIndex[this.currentPeerId]
                    : Config.adaptiveAudioQuality.initialProfileIndex);

            const offerOptions = {
                offerToReceiveAudio: true,
                // 是否期望接收视频：
                // - 如果不是纯音频通话 (即可能是视频通话或屏幕共享接收方)
                // - 或者 我们正在发起屏幕共享 (期望对方可能回送摄像头画面，虽然通常不会)
                offerToReceiveVideo: !this.isAudioOnly || (this.isScreenSharing && this.isCaller)
            };
            const offer = await conn.peerConnection.createOffer(offerOptions);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);
            ConnectionManager.sendTo(this.currentPeerId, {
                type: 'video-call-offer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing, // 我们是否在共享屏幕
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
            // 考虑是否要通知对方，如果连接已断开，可能无法发送
            return;
        }
        try {
            // 如果收到 offer，意味着对方是呼叫发起方（对于媒体协商而言）
            // 更新我方的通话状态以匹配对方的意图
            if (!this.isCallActive) { // 通常在收到 call-request 后，再收到 offer 时， callactive 应该为 false 或 pending
                this.isScreenSharing = remoteIsScreenShare; // 我方变为屏幕共享的接收方
                this.isAudioOnly = remoteIsAudioOnly && !remoteIsScreenShare; // 如果对方是纯音频且非屏幕共享，则我方也是纯音频
                this.currentPeerId = peerId;
                this.isCaller = false; // 我是媒体协商的应答方
                // 如果对方共享屏幕，我方不应发送视频；否则根据对方是否纯音频决定
                this.isVideoEnabled = !this.isAudioOnly && !this.isScreenSharing;

                // 在设置远程描述前，确保本地流已准备好或正在准备
                // startLocalStreamAndSignal 将处理 isCallActive, isVideoEnabled 等状态
                // 并且内部会调用 setupPeerConnection(false)
                await this.startLocalStreamAndSignal(false); // isOfferCreatorForMedia = false
            }
            // 即使已激活，也可能收到重新协商的offer，此时不应重置上述状态，而是直接处理SDP

            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            // 在创建Answer前应用初始音频配置
            this._applyAudioProfileToSender(peerId,
                this._currentAudioProfileIndex[peerId] !== undefined
                    ? this._currentAudioProfileIndex[peerId]
                    : Config.adaptiveAudioQuality.initialProfileIndex);

            const answer = await conn.peerConnection.createAnswer();
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: this.modifySdpForOpus(answer.sdp)});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly, // 我方是否只发送音频
                isScreenShare: this.isScreenSharing && this.isCaller, // 我方是否在共享屏幕 (通常应答方是 false)
                sender: UserManager.userId
            });
            // 在应答方，一旦发送answer，通话基本建立，启动（或确认启动）自适应音频检测
            this._startAdaptiveAudioCheck(peerId);

        } catch (e) {
            Utils.log("处理提议时出错: " + e, Utils.logLevels.ERROR);
            this.hangUpMedia(); // 协商失败，挂断
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
        const conn = ConnectionManager.connections[peerId];
        if (!conn || !conn.peerConnection) {
            Utils.log(`处理来自 ${peerId} 的应答时没有 PeerConnection。忽略。`, Utils.logLevels.ERROR);
            return;
        }
        try {
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
            Utils.log(`来自 ${peerId} 的应答已处理。`, Utils.logLevels.INFO);
            // 对于发起方，在收到answer后，通话才算真正建立，此时启动自适应音频检测
            this._startAdaptiveAudioCheck(peerId);
        } catch (e) {
            Utils.log("处理应答时出错: " + e, Utils.logLevels.ERROR);
            this.hangUpMedia(); // 协商失败，挂断
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
        if (this.isScreenSharing && this.isCaller) { // 如果是自己正在共享屏幕
            NotificationUIManager.showNotification("屏幕共享期间摄像头不可用。", "warning");
            return;
        }
        // 如果是接收对方的屏幕共享，理论上可以开关自己的摄像头，但UI上可能不显示自己
        // 当前逻辑是 isVideoEnabled 会在接收屏幕共享时设为false，因此这里会受影响

        const videoTrack = this.localStream.getVideoTracks().find(t => t.kind === 'video' && t.readyState === 'live'); // 确保是摄像头轨道，而非屏幕共享轨道（如果有的话）

        // 通常，如果是屏幕共享的发起方，localStream的视频轨道是屏幕，不是摄像头。
        // 如果是普通视频通话，视频轨道是摄像头。
        // 如果我们是屏幕共享的接收方，我们可能没有发送视频轨道。

        if (!videoTrack && !this.isScreenSharing) { // 严格一点，非屏幕共享时才报这个错
            NotificationUIManager.showNotification('本地视频轨道不可用。', 'warning');
            this.isVideoEnabled = false; // 同步状态
            this.updateCurrentCallUIState();
            return;
        }
        if (videoTrack) { // 只有真正有摄像头轨道才操作
            this.isVideoEnabled = !this.isVideoEnabled;
            videoTrack.enabled = this.isVideoEnabled;
        } else {
            // 若无 videoTrack 但 this.isVideoEnabled 为 true，则可能状态不一致，校正它
            this.isVideoEnabled = false;
        }

        this.updateCurrentCallUIState();
        // TODO: 可能需要通知对方视频状态改变，如果实现了动态添加/移除轨道或 renegotiation
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
        // TODO: 可以通过信令通知对方静音状态，供UI显示，但媒体流已实际静音
    },

    /**
     * 在通话开始前，切换纯音频模式。
     * @returns {Promise<void>}
     */
    toggleAudioOnly: async function () {
        if (this.isCallActive || this.isCallPending) { // 通话中或等待中不允许切换
            NotificationUIManager.showNotification("通话中或等待时无法切换模式。", "warning");
            return;
        }
        this.isAudioOnly = !this.isAudioOnly;
        Utils.log("已切换纯音频模式 (通话前): " + this.isAudioOnly, Utils.logLevels.INFO);
        // 如果从视频切换到纯音频，确保 isVideoEnabled 也更新
        this.isVideoEnabled = !this.isAudioOnly;
        this.updateCurrentCallUIState(); // 更新UI按钮状态
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

        this._stopAdaptiveAudioCheck(peerIdToHangUp); // 确保停止对该peer的检测

        if (notifyPeer && (this.isCallActive || this.isCallPending) && peerIdToHangUp) {
            ConnectionManager.sendTo(peerIdToHangUp, {type: 'video-call-end', sender: UserManager.userId});
        }
        // cleanupCallMediaAndState 的参数决定是否关闭 PeerConnection
        // hangUpMedia 通常只关媒体，不关连接，除非是彻底结束。
        // 这里的 false 表示不强制关闭 PeerConnection，让 ConnectionManager 自行决定或等待超时。
        // 但如果通话确实结束了，后续 cleanupCallMediaAndState(true) 会被调用（例如用户点击挂断按钮）
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
        this._stopAdaptiveAudioCheck(peerIdToCancel); // 如果已启动检测（理论上不应在pending时启动）
        // 对于取消操作，通常不关闭 PeerConnection，因为可能还未完全建立或用于其他数据交换
        this.cleanupCallMediaAndState(false);
    },

    /**
     * 清理所有与通话相关的媒体资源和状态。
     * @param {boolean} [closePeerConnectionIfUnused=true] - 是否在没有其他用途（如数据通道）时关闭底层的 RTCPeerConnection。
     *                                                     实际行为可能还需 ConnectionManager 配合。
     */
    cleanupCallMediaAndState: function (closePeerConnectionIfUnused = true) {
        const peerIdCleaned = this.currentPeerId;
        Utils.log(`正在清理通话媒体和状态 (for ${peerIdCleaned || '未知'})。关闭 PC (如果未使用): ${closePeerConnectionIfUnused}`, Utils.logLevels.INFO);

        this.stopMusic(); // 停止所有音乐
        ModalUIManager.hideCallingModal(); // 隐藏呼叫中模态框
        ModalUIManager.hideCallRequest();  // 隐藏来电请求模态框

        if (this.statsInterval) clearInterval(this.statsInterval);
        this.statsInterval = null;

        this._stopAdaptiveAudioCheck(peerIdCleaned); // 停止对该peer的自适应检测

        this.releaseMediaResources(); // 释放本地摄像头/麦克风

        // 从 PeerConnection 中移除轨道
        if (peerIdCleaned) {
            const conn = ConnectionManager.connections[peerIdCleaned];
            if (conn && conn.peerConnection) {
                conn.peerConnection.getSenders().forEach(sender => {
                    if (sender.track) {
                        try {
                            // sender.track.stop(); // 停止轨道不是这里的职责，releaseMediaResources会做
                            conn.peerConnection.removeTrack(sender);
                            Utils.log(`已从 ${peerIdCleaned} 的 PC 中移除轨道 ${sender.track.kind}`, Utils.logLevels.DEBUG);
                        } catch (e) {
                            Utils.log(`从 ${peerIdCleaned} 的 PC 中移除轨道时出错: ${e.message}`, Utils.logLevels.WARN);
                        }
                    }
                });
                // 清理 ontrack 和其他事件监听器，如果它们可能导致内存泄漏
                // conn.peerConnection.ontrack = null; // 或者移除特定监听器
                // conn.peerConnection.oniceconnectionstatechange = null;
                // conn.peerConnection.onconnectionstatechange = null;
                // 注意：如果 ConnectionManager 复用 PeerConnection，则不应设为 null，而是移除特定函数
            }
        }

        // 重置UI元素
        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.setLocalStream(null);
            VideoCallUIManager.setRemoteStream(null);
            VideoCallUIManager.showCallContainer(false);
            VideoCallUIManager.resetPipVisuals();
        }
        this.remoteStream = null; // 清理远程流引用

        // 重置状态变量
        this.isCallActive = false;
        this.isCallPending = false;
        this.isCaller = false;
        this.isAudioMuted = false;
        this.isAudioOnly = false; // 重置为默认非纯音频
        this.isScreenSharing = false;
        this.isVideoEnabled = true; // 重置为默认视频启用

        const previousPeerId = this.currentPeerId; // 暂存
        this.currentPeerId = null; // 最后重置 currentPeerId

        // 关闭 PeerConnection (如果需要)
        if (closePeerConnectionIfUnused && previousPeerId) {
            Utils.log(`作为通话清理的一部分，考虑关闭与 ${previousPeerId} 的 RTCPeerConnection。`, Utils.logLevels.INFO);
            // ConnectionManager.close(previousPeerId, false) 会关闭媒体和数据通道
            // 如果只想关闭媒体相关的部分，而PeerConnection可能仍用于数据通道，则不应在这里调用 close
            // 这里的语义是 "如果这个PeerConnection主要是为这次通话服务的，并且现在通话结束了，就关闭它"
            // 实际的关闭逻辑可能在 ConnectionManager.close 中判断是否有其他活跃的数据通道等。
            // 假设这里的 true 意味着 "如果可以，就关闭它"
            ConnectionManager.closePeerConnection(previousPeerId); // 仅关闭PC，数据通道由ConnectionManager管理
        } else if (previousPeerId) {
            Utils.log(`与 ${previousPeerId} 的 RTCPeerConnection 已保留。媒体已挂断。`, Utils.logLevels.INFO);
        }

        Utils.log('通话媒体和状态已清理。', Utils.logLevels.INFO);
        this.updateCurrentCallUIState(); // 更新UI到挂断后的状态
    },

    /**
     * 释放本地媒体资源（摄像头和麦克风）。
     */
    releaseMediaResources: function () {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop(); // 停止轨道，释放硬件资源
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
                    this.isCallPending = true; // 标记为有挂起的呼叫
                    // message.audioOnly 和 message.isScreenShare 来自对方的视角
                    this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false);
                } else { // 如果忙碌
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

                    // 对方接受了，更新我方状态以匹配初始呼叫时的设定
                    // this.isAudioOnly 和 this.isScreenSharing 应该在 initiateCall 时已设置
                    // message.audioOnly 和 message.isScreenShare 是对方确认的状态，理论上应与我方发起时一致
                    // 如果对方修改了这些（例如强制音频），需要处理，但标准流程下它们应一致
                    // this.isAudioOnly = message.audioOnly || false; // 通常不需要，以发起方为准
                    // this.isScreenSharing = message.isScreenShare || false; 

                    // startLocalStreamAndSignal 将创建媒体流并发起 offer
                    // true 表示我方是媒体协商的 offer 创建者
                    this.startLocalStreamAndSignal(true);
                }
                break;
            case 'video-call-rejected':
                if (this.isCallPending && this.currentPeerId === peerId) {
                    if (this.isCaller) { // 我是呼叫方，对方拒绝
                        this.stopMusic();
                        ModalUIManager.hideCallingModal();
                    } else { // 我是被呼叫方，但我可能通过其他方式取消了请求（理论上不应发生此路径）
                        ModalUIManager.hideCallRequest(); // 也隐藏一下
                    }
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    NotificationUIManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 拒绝。原因: ${message.reason || 'N/A'}`, 'warning');
                    this.cleanupCallMediaAndState(false); // 不关闭连接，对方可能只是拒绝通话
                }
                break;
            case 'video-call-cancel': // 对方取消了呼叫请求
                if (this.isCallPending && !this.isCaller && this.currentPeerId === peerId) { // 我是被呼叫方，对方取消
                    this.stopMusic();
                    ModalUIManager.hideCallRequest();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout); // 我方也可能有超时
                    this.callRequestTimeout = null;
                    NotificationUIManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 取消。`, 'warning');
                    this.cleanupCallMediaAndState(false);
                }
                break;
            case 'video-call-offer':
                // 允许在通话中收到 offer (重新协商) 或在通话前收到 offer (对方直接发起媒体协商)
                if ((!this.isCallActive && !this.isCallPending) || (this.isCallActive && this.currentPeerId === peerId)) {
                    if (!this.isCallActive) this.isCallPending = true; // 如果是首次，标记为pending
                    // message.audioOnly 和 message.isScreenShare 是对方的发送状态
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 offer，但当前状态冲突 (active: ${this.isCallActive}, pending: ${this.isCallPending}, currentPeer: ${this.currentPeerId})。忽略。`, Utils.logLevels.WARN);
                }
                break;
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) { // 必须是激活的、针对当前对方的 answer
                    // message.audioOnly 和 message.isScreenShare 是对方的发送状态
                    this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 answer，但当前状态不匹配。忽略。`, Utils.logLevels.WARN);
                }
                break;
            case 'video-call-end': // 对方挂断了媒体
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    NotificationUIManager.showNotification(`${UserManager.contacts[peerId]?.name || '对方'} 结束了通话媒体。`, 'info');
                    this.cleanupCallMediaAndState(false); // 不主动关闭连接，对方可能只是停止媒体
                }
                break;
            case 'video-call-stats':
                // 已废弃，自适应音频有自己的统计处理
                break;
        }
    },

    // --- 自适应音频质量相关方法 ---
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
        // 如果此 peerId 已有定时器，先清除（理论上不应发生，但作为保险）
        if (this._adaptiveAudioIntervalId && this._adaptiveAudioIntervalId[peerId]) {
            clearInterval(this._adaptiveAudioIntervalId[peerId]);
        }
        if (!this._adaptiveAudioIntervalId) this._adaptiveAudioIntervalId = {};


        this._currentAudioProfileIndex[peerId] = Config.adaptiveAudioQuality.initialProfileIndex;
        this._lastProfileSwitchTime[peerId] = 0; // 记录上次切换时间戳
        this._consecutiveGoodChecks[peerId] = 0;   // 连续良好检测次数
        this._consecutiveBadChecks[peerId] = 0;    // 连续不良检测次数

        // 首次应用初始配置
        this._applyAudioProfileToSender(peerId, Config.adaptiveAudioQuality.initialProfileIndex);

        this._adaptiveAudioIntervalId[peerId] = setInterval(() => {
            this._checkAndAdaptAudioQuality(peerId);
        }, Config.adaptiveAudioQuality.interval);
        Utils.log(`已为 ${peerId} 启动自适应音频质量检测，初始等级: ${Config.adaptiveAudioQuality.audioQualityProfiles[Config.adaptiveAudioQuality.initialProfileIndex].levelName}。`, Utils.logLevels.INFO);
    },

    /**
     * @private
     * @description 停止自适应音频质量检测。
     * @param {string} peerId - (可选) 如果提供，则仅清理特定对方的状态和定时器。
     */
    _stopAdaptiveAudioCheck: function(peerId) {
        if (peerId && this._adaptiveAudioIntervalId && this._adaptiveAudioIntervalId[peerId]) {
            clearInterval(this._adaptiveAudioIntervalId[peerId]);
            delete this._adaptiveAudioIntervalId[peerId];
            Utils.log(`已停止对 ${peerId} 的自适应音频质量检测。`, Utils.logLevels.INFO);

            // 清理与该 peerId 相关的状态
            delete this._currentAudioProfileIndex[peerId];
            delete this._lastProfileSwitchTime[peerId];
            delete this._consecutiveGoodChecks[peerId];
            delete this._consecutiveBadChecks[peerId];

            // 如果 _adaptiveAudioIntervalId 对象为空了，可以删除它
            if (Object.keys(this._adaptiveAudioIntervalId).length === 0) {
                this._adaptiveAudioIntervalId = null;
            }
        } else if (!peerId && this._adaptiveAudioIntervalId) { // 如果没有提供 peerId，停止所有
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
     * @returns {number} - 目标音质等级的索引 (0 至 profiles.length - 1)。
     */
    _determineOptimalQualityLevel: function(peerId, currentStats) {
        const profiles = Config.adaptiveAudioQuality.audioQualityProfiles;
        const currentLevelIndex = this._currentAudioProfileIndex[peerId] !== undefined
            ? this._currentAudioProfileIndex[peerId]
            : Config.adaptiveAudioQuality.initialProfileIndex;

        const { baseGoodConnectionThresholds, stabilityCountForUpgrade, badQualityDowngradeThreshold } = Config.adaptiveAudioQuality;
        let targetLevelIndex = currentLevelIndex;

        // 定义网络状况的判断标准
        // significantlyBetterFactor: 显著优于基线的因子
        // slightlyWorseFactor: 轻微差于基线的因子
        // veryPoorFactor: 非常差的因子
        const significantlyBetterFactor = 0.7;
        const slightlyWorseFactor = 1.3;
        const veryPoorFactor = 2.0;

        // 判断当前网络是否满足基线良好连接标准
        const meetsBaseline = currentStats.rtt <= baseGoodConnectionThresholds.rtt &&
            currentStats.packetLoss <= baseGoodConnectionThresholds.packetLoss && // 对于丢包率，绝对值更重要
            currentStats.jitter <= baseGoodConnectionThresholds.jitter;

        // 判断网络是否显著更好
        const isSignificantlyBetter = currentStats.rtt < baseGoodConnectionThresholds.rtt * significantlyBetterFactor &&
            currentStats.packetLoss < baseGoodConnectionThresholds.packetLoss * significantlyBetterFactor &&
            currentStats.jitter < baseGoodConnectionThresholds.jitter * significantlyBetterFactor;

        // 判断网络是否轻微恶化
        const isSlightlyWorse = currentStats.rtt > baseGoodConnectionThresholds.rtt * slightlyWorseFactor ||
            currentStats.packetLoss > baseGoodConnectionThresholds.packetLoss + 0.01 || // 丢包率增加1%就算恶化
            currentStats.jitter > baseGoodConnectionThresholds.jitter * slightlyWorseFactor;

        // 判断网络是否非常差
        const isVeryPoor = currentStats.rtt > baseGoodConnectionThresholds.rtt * veryPoorFactor ||
            currentStats.packetLoss > baseGoodConnectionThresholds.packetLoss + 0.03 || // 丢包率增加3%就算非常差
            currentStats.jitter > baseGoodConnectionThresholds.jitter * veryPoorFactor;

        // 更新连续检测计数器
        if (meetsBaseline) {
            this._consecutiveGoodChecks[peerId] = (this._consecutiveGoodChecks[peerId] || 0) + 1;
            this._consecutiveBadChecks[peerId] = 0; // 网络良好，重置不良计数
        } else {
            this._consecutiveBadChecks[peerId] = (this._consecutiveBadChecks[peerId] || 0) + 1;
            this._consecutiveGoodChecks[peerId] = 0; // 网络不佳，重置良好计数
        }

        // 尝试提升质量
        if (this._consecutiveGoodChecks[peerId] >= stabilityCountForUpgrade) {
            if (isSignificantlyBetter && targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 2, profiles.length - 1); // 跳两级
            } else if (meetsBaseline && targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 1, profiles.length - 1); // 升一级
            }
            if (targetLevelIndex > currentLevelIndex) { // 如果实际升级了
                this._consecutiveGoodChecks[peerId] = 0; // 重置计数器，下次升级需要重新累积稳定期
            }
        }

        // 尝试降低质量
        if (this._consecutiveBadChecks[peerId] >= badQualityDowngradeThreshold) {
            if (isVeryPoor && targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 2, 0); // 降两级
            } else if (isSlightlyWorse && targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 1, 0); // 降一级
            }
            if (targetLevelIndex < currentLevelIndex) { // 如果实际降级了
                this._consecutiveBadChecks[peerId] = 0; // 重置计数器
            }
        }
        // 确保目标等级在有效范围内
        return Math.max(0, Math.min(targetLevelIndex, profiles.length - 1));
    },


    /**
     * @private
     * @description 周期性检查网络状况并决定是否调整音频质量。
     * @param {string} peerId - 当前通话的对方ID。
     */
    _checkAndAdaptAudioQuality: async function(peerId) {
        if (!peerId || !ConnectionManager.connections[peerId]) {
            Utils.log(`AdaptiveAudioCheck: 对方 ${peerId || '未知'} 的连接信息不存在。跳过。`, Utils.logLevels.WARN);
            return;
        }
        const pc = ConnectionManager.connections[peerId].peerConnection;
        if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            Utils.log(`AdaptiveAudioCheck for ${peerId}: PeerConnection 不存在或已关闭/失败/断开 (${pc?.connectionState}, ${pc?.signalingState})。跳过。`, Utils.logLevels.DEBUG);
            // 考虑在此处停止对此 peerId 的检测，以防 pc 被重用前发生问题
            // this._stopAdaptiveAudioCheck(peerId); // 慎用，除非确定此 pc 不会再恢复
            return;
        }

        try {
            const stats = await pc.getStats();
            let currentRtt = Infinity, currentPacketLoss = 1, currentJitter = Infinity; // 初始化为最差情况

            // 遍历统计报告以提取关键指标
            stats.forEach(report => {
                // 对于发送到远端的 RTP 流 (outbound-rtp)，可以从其关联的远端入站报告 (remote-inbound-rtp) 获取 RTT 和 Jitter
                if (report.type === 'outbound-rtp' && report.kind === 'audio' && report.remoteId) {
                    const remoteInboundReport = stats.get(report.remoteId);
                    if (remoteInboundReport) {
                        if (remoteInboundReport.roundTripTime !== undefined) currentRtt = Math.min(currentRtt, remoteInboundReport.roundTripTime * 1000); // ms
                        if (remoteInboundReport.packetsLost !== undefined && remoteInboundReport.packetsReceived !== undefined) {
                            const totalPackets = remoteInboundReport.packetsLost + remoteInboundReport.packetsReceived + (remoteInboundReport.packetsDiscarded || 0);
                            if (totalPackets > 0) currentPacketLoss = Math.min(currentPacketLoss, (remoteInboundReport.packetsLost + (remoteInboundReport.packetsDiscarded || 0)) / totalPackets);
                        }
                        if (remoteInboundReport.jitter !== undefined) currentJitter = Math.min(currentJitter, remoteInboundReport.jitter * 1000); // ms
                    }
                }
                // 从ICE候选对 (candidate-pair) 中获取 RTT，这通常更直接
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime !== undefined) {
                    currentRtt = Math.min(currentRtt, report.currentRoundTripTime * 1000); // ms
                }
                // 对于接收的 RTP 流 (inbound-rtp)，可以获取本地计算的 Jitter 和丢包率
                if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                    if (report.jitter !== undefined) currentJitter = Math.min(currentJitter, report.jitter * 1000); // ms
                    if (report.packetsLost !== undefined && report.packetsReceived !== undefined) {
                        const totalPackets = report.packetsLost + report.packetsReceived + (report.packetsDiscarded || 0);
                        if (totalPackets > 0) currentPacketLoss = Math.min(currentPacketLoss, (report.packetsLost + (report.packetsDiscarded || 0)) / totalPackets);
                    }
                }
            });

            // 如果任何关键统计数据仍为 Infinity/1，说明未能获取有效数据
            if (!isFinite(currentRtt) && currentPacketLoss === 1 && !isFinite(currentJitter)) {
                Utils.log(`AdaptiveAudioCheck for ${peerId}: 未能获取有效的网络统计数据。跳过调整。`, Utils.logLevels.WARN);
                return;
            }
            // 为未获取到的数据赋予一个较高的惩罚值，以便决策时偏向保守
            if (!isFinite(currentRtt)) currentRtt = Config.adaptiveAudioQuality.baseGoodConnectionThresholds.rtt * 3;
            if (currentPacketLoss === 1 && isFinite(stats.size)) currentPacketLoss = Config.adaptiveAudioQuality.baseGoodConnectionThresholds.packetLoss + 0.1; // 如果有统计但没丢包数据，给个惩罚
            else if (currentPacketLoss === 1) currentPacketLoss = 0.5; // 如果完全没数据，假设极高丢包
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
                Utils.log(`[AudioQualityEval for ${peerId}]: Stats(RTT: ${currentRtt.toFixed(0)}ms, Loss: ${(currentPacketLoss*100).toFixed(2)}%, Jitter: ${currentJitter.toFixed(0)}ms) -> 当前: Lvl ${currentProfileIndex} ('${currentProfileName}'), 目标: Lvl ${optimalLevelIndex} ('${optimalProfileName}')`, Utils.logLevels.INFO);
            }

            const { switchToHigherCooldown, switchToLowerCooldown } = Config.adaptiveAudioQuality;
            const lastSwitchTime = this._lastProfileSwitchTime[peerId] || 0;
            const now = Date.now();

            if (optimalLevelIndex !== currentProfileIndex) { // 仅当目标与当前不同时才考虑切换
                if (optimalLevelIndex > currentProfileIndex) { // 尝试提升
                    if (now - lastSwitchTime > switchToHigherCooldown) {
                        this._switchToAudioProfile(peerId, optimalLevelIndex);
                    } else {
                        Utils.log(`[AudioQualityEval for ${peerId}]: 尝试提升至 '${optimalProfileName}'，但提升冷却期 (${switchToHigherCooldown/1000}s) 未结束。`, Utils.logLevels.DEBUG);
                    }
                } else { // 尝试降低 optimalLevelIndex < currentProfileIndex
                    if (now - lastSwitchTime > switchToLowerCooldown) {
                        this._switchToAudioProfile(peerId, optimalLevelIndex);
                    } else {
                        Utils.log(`[AudioQualityEval for ${peerId}]: 尝试降低至 '${optimalProfileName}'，但降低冷却期 (${switchToLowerCooldown/1000}s) 未结束。`, Utils.logLevels.DEBUG);
                    }
                }
            }
        } catch (error) {
            Utils.log(`在 _checkAndAdaptAudioQuality (for ${peerId}) 中出错: ${error.message || error}`, Utils.logLevels.ERROR);
            // 考虑是否应该停止检测，以避免在错误状态下持续运行
            // this._stopAdaptiveAudioCheck(peerId);
        }
    },

    /**
     * @private
     * @description 切换到指定的音频配置档案。
     * @param {string} peerId - 目标对方ID。
     * @param {number} newLevelIndex - 要切换到的配置档案的索引。
     */
    _switchToAudioProfile: function(peerId, newLevelIndex) {
        if (this._currentAudioProfileIndex[peerId] === newLevelIndex) {
            Utils.log(`请求切换到与当前相同的音频配置 (${newLevelIndex}) for ${peerId}，已跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        this._currentAudioProfileIndex[peerId] = newLevelIndex;
        this._lastProfileSwitchTime[peerId] = Date.now();
        // 重置连续检测计数器，因为质量等级已改变，需要重新评估稳定性
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;

        this._applyAudioProfileToSender(peerId, newLevelIndex);

        const profile = Config.adaptiveAudioQuality.audioQualityProfiles[newLevelIndex];
        const profileName = profile ? profile.levelName : "未知等级";
        const description = profile ? profile.description : "无描述";

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('audioProfileChanged', { peerId: peerId, profileName: profileName, profileIndex: newLevelIndex, description: description });
        }
        NotificationUIManager.showNotification(`音频质量已调整为: ${profileName}`, 'info', 1500); // 短暂提示
        Utils.log(`音频配置已切换为 Lvl ${newLevelIndex} ('${profileName}') for ${peerId}.`, Utils.logLevels.INFO);
    },

    /**
     * @private
     * @description 将指定的音频配置应用到与对方的音频发送器。
     * @param {string} peerId - 目标对方ID。
     * @param {number} levelIndex - 要应用的配置档案的索引。
     */
    _applyAudioProfileToSender: function(peerId, levelIndex) {
        if (!peerId || !ConnectionManager.connections[peerId]) {
            Utils.log(`_applyAudioProfileToSender: 对方 ${peerId || '未知'} 的连接信息不存在。跳过。`, Utils.logLevels.WARN);
            return;
        }
        const pc = ConnectionManager.connections[peerId].peerConnection;
        if (!pc || !this.localStream) { // localStream 可能在清理过程中被置null
            Utils.log(`_applyAudioProfileToSender: PeerConnection 或本地流 (for ${peerId}) 不存在。跳过。PC: ${!!pc}, LocalStream: ${!!this.localStream}`, Utils.logLevels.WARN);
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
                    parameters.encodings = [{}]; // 确保至少有一个 encoding 对象
                }

                let changed = false;
                // 应用码率
                if (audioProfile.maxAverageBitrate && parameters.encodings[0].maxBitrate !== audioProfile.maxAverageBitrate) {
                    parameters.encodings[0].maxBitrate = audioProfile.maxAverageBitrate;
                    changed = true;
                }
                // 应用 DTX (Discontinuous Transmission)
                if (audioProfile.dtx !== undefined && parameters.dtx !== audioProfile.dtx) {
                    // DTX 通常在 RTCRtpSenderParameters 的顶层，而不是 encodings 里
                    // 然而，标准WebRTC API中，DTX的直接控制不常见于getParameters/setParameters
                    // 它更多是在 SDP (a=rtpmap... dtx=1) 中协商
                    // 但如果浏览器支持，可以尝试设置。这里暂时注释，因为支持情况不一。
                    // parameters.dtx = audioProfile.dtx;
                    // changed = true;
                    Utils.log(`DTX 配置 (${audioProfile.dtx}) 建议通过 SDP 进行。当前实现未直接通过 setParameters 修改 DTX。`, Utils.logLevels.DEBUG);
                }
                // 应用 FEC (Forward Error Correction)
                if (audioProfile.useinbandfec !== undefined && parameters.encodings[0].networkPriority !== undefined /* 占位符，FEC不直接在parameters里 */) {
                    // FEC (如 Opus 的 useinbandfec) 通常在 SDP 的 fmtp 行协商
                    // setParameters 可能无法直接控制它。
                    Utils.log(`FEC 配置 (${audioProfile.useinbandfec}) 建议通过 SDP 进行。当前实现未直接通过 setParameters 修改 FEC。`, Utils.logLevels.DEBUG);
                }


                if (changed) {
                    sender.setParameters(parameters)
                        .then(() => Utils.log(`音频配置档案 '${audioProfile.levelName}' (Lvl ${levelIndex}) 已成功应用到发送器 (for ${peerId})。目标码率: ${audioProfile.maxAverageBitrate || '未指定'}`, Utils.logLevels.INFO))
                        .catch(e => Utils.log(`应用音频配置档案 '${audioProfile.levelName}' (for ${peerId}) 时发生错误: ${e.message || e}`, Utils.logLevels.ERROR));
                } else {
                    Utils.log(`音频配置档案 '${audioProfile.levelName}' 无需应用 (for ${peerId})，参数未改变或仅 SDP 控制。当前码率: ${parameters.encodings[0].maxBitrate}`, Utils.logLevels.DEBUG);
                }
            }
        });
    }
};