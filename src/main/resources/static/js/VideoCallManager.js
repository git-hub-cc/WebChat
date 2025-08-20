/**
 * @file VideoCallManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 视频通话高级状态管理器和公共 API。
 *              负责管理通话的整体状态，并为其他模块提供发起和控制通话的接口。
 *              它将底层的信令协议和媒体流获取委托给 VideoCallHandler 处理。
 *              FIXED: 实现了 playMusic 和 stopMusic 的完整逻辑，并处理了浏览器自动播放限制。
 *              OPTIMIZED: 挂断通话时不再销毁底层的WebRTC连接，仅移除媒体流，以实现快速重拨。
 * @module VideoCallManager
 * @exports {object} VideoCallManager
 * @dependencies VideoCallHandler, AppSettings, Utils, NotificationUIManager, ConnectionManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter
 */
const VideoCallManager = {
    state: {
        localStream: null,
        remoteStream: null,
        currentPeerId: null,
        isCallActive: false,
        isCaller: false,
        isCallPending: false,
        isAudioMuted: false,
        isVideoEnabled: true,
        isAudioOnly: false,
        isScreenSharing: false,
    },

    musicPlayer: null,
    isMusicPlaying: false,
    callRequestTimeout: null,
    _boundEnableMusicPlay: null,

    init: function () {
        VideoCallHandler.init(this);
        try {
            this.musicPlayer = new Audio(AppSettings.media.music);
            this.musicPlayer.loop = true;
        } catch (e) {
            this.musicPlayer = null;
            Utils.log("无法创建呼叫音乐播放器。", Utils.logLevels.ERROR);
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。通话功能已禁用。', Utils.logLevels.ERROR);
            return false;
        }
        return true;
    },

    handleMessage: function (message, peerId) {
        if (message.type === 'video-call-request') {
            if (window.Android && typeof window.Android.showIncomingCall === 'function') {
                const callerName = UserManager.contacts[peerId]?.name || peerId;
                Utils.log(`[Native Call] 正在为 ${callerName} 触发原生来电通知。`, Utils.logLevels.INFO);
                window.Android.showIncomingCall(callerName, peerId);
            }
        }
        if (message.type === 'video-call-cancel' || message.type === 'video-call-end' || message.type === 'video-call-rejected') {
            if (window.Android && typeof window.Android.cancelIncomingCall === 'function') {
                Utils.log(`[Native Call] 正在取消原生来电通知。`, Utils.logLevels.INFO);
                window.Android.cancelIncomingCall();
            }
        }
        VideoCallHandler.handleMessage(message, peerId);
    },

    _initiateMediaSession: function(peerId, options = {}) {
        const { audioOnly = false, isScreenShare = false } = options;
        if (this.state.isCallActive || this.state.isCallPending) {
            NotificationUIManager.showNotification('已有通话正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId || !ConnectionManager.isConnectedTo(peerId)) {
            NotificationUIManager.showNotification('请选择一个已连接的伙伴开始通话。', 'error');
            return;
        }

        this.state.isAudioOnly = audioOnly;
        this.state.isScreenSharing = isScreenShare;
        this.state.isVideoEnabled = !audioOnly;
        this.state.isAudioMuted = false;
        this.state.currentPeerId = peerId;
        this.state.isCaller = true;
        this.state.isCallPending = true;

        ConnectionManager.sendTo(peerId, {
            type: 'video-call-request',
            audioOnly: this.state.isAudioOnly,
            isScreenShare: this.state.isScreenSharing,
            sender: UserManager.userId
        });

        const callType = isScreenShare ? '屏幕共享' : (audioOnly ? '语音通话' : '视频通话');
        // MODIFIED: 传递正确的取消函数
        ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => VideoCallHandler.cancelPendingCall(), () => this.stopMusic(), callType);
        this.playMusic();

        this.callRequestTimeout = setTimeout(() => {
            if (this.state.isCallPending) {
                // VideoCallHandler.cancelPendingCall will handle the signaling
                VideoCallHandler.cancelPendingCall();
                NotificationUIManager.showNotification('呼叫超时，对方无应答。', 'warning');
            }
        }, AppSettings.timeouts.callRequest);
    },

    initiateAudioCall: function (peerId) {
        this._initiateMediaSession(peerId, { audioOnly: true });
    },

    initiateCall: function(peerId) {
        this._initiateMediaSession(peerId, { audioOnly: false });
    },

    initiateScreenShare: function (peerId) {
        this._initiateMediaSession(peerId, { isScreenShare: true });
    },

    toggleCamera: function () {
        if (!this.state.isCallActive || !this.state.localStream) return;

        const videoTrack = this.state.localStream.getVideoTracks()[0];
        if (videoTrack) {
            this.state.isVideoEnabled = !this.state.isVideoEnabled;
            videoTrack.enabled = this.state.isVideoEnabled;
            this.updateCurrentCallUIState();
        } else {
            NotificationUIManager.showNotification('本地视频轨道不可用。', 'warning');
        }
    },

    toggleAudio: function () {
        if (!this.state.isCallActive || !this.state.localStream) return;
        const audioTrack = this.state.localStream.getAudioTracks()[0];
        if(audioTrack) {
            this.state.isAudioMuted = !this.state.isAudioMuted;
            audioTrack.enabled = !this.state.isAudioMuted;
            this.updateCurrentCallUIState();
        } else {
            NotificationUIManager.showNotification('本地音频轨道不可用。', 'warning');
        }
    },

    toggleAudioOnly: function () {
        if (this.state.isCallActive || this.state.isCallPending) {
            NotificationUIManager.showNotification("通话中或等待时无法切换模式。", "warning");
            return;
        }
        this.state.isAudioOnly = !this.state.isAudioOnly;
        this.state.isVideoEnabled = !this.state.isAudioOnly;
        this.updateCurrentCallUIState();
    },

    /**
     * [REFACTORED] 挂断当前激活的媒体会话。
     * 此操作会移除音视频流，但会保持底层的 WebRTC 数据通道连接。
     * @param {boolean} [notifyPeer=true] - 是否通过数据通道通知对方。
     */
    hangUpMedia: function (notifyPeer = true) {
        const peerIdToHangUp = this.state.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToHangUp || '未知'} 挂断媒体会话。通知: ${notifyPeer}`, Utils.logLevels.INFO);

        if (!this.state.isCallActive || !peerIdToHangUp) {
            // 如果没有激活的通话，只需确保清理状态即可
            this.cleanupCallMediaAndState();
            return;
        }

        // 通过数据通道通知对方通话结束
        if (notifyPeer) {
            ConnectionManager.sendTo(peerIdToHangUp, {type: 'video-call-end', sender: UserManager.userId});
        }

        // 从 WebRTC 连接中移除媒体流，触发重新协商
        if (this.state.localStream) {
            WebRTCManager.removeStreamFromConnection(peerIdToHangUp, this.state.localStream);
        }

        // 清理媒体相关的状态和UI，但保持底层连接
        this.cleanupCallMediaAndState();
    },

    playMusic: function (isRetry = false) {
        if (this.musicPlayer && !this.isMusicPlaying) {
            this.isMusicPlaying = true;
            const playPromise = this.musicPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    Utils.log(`播放呼叫音乐失败: ${error.name} - ${error.message}`, Utils.logLevels.WARN);
                    this.isMusicPlaying = false;
                    if (error.name === 'NotAllowedError' && !isRetry) {
                        NotificationUIManager.showNotification('浏览器阻止了呼叫铃声自动播放。请与页面交互后重试。', 'warning');
                        this._boundEnableMusicPlay = () => this.playMusic(true);
                        document.body.addEventListener('click', this._boundEnableMusicPlay, { once: true });
                    }
                });
            }
        }
    },

    stopMusic: function () {
        if (this.musicPlayer && this.isMusicPlaying) {
            this.musicPlayer.pause();
            this.musicPlayer.currentTime = 0;
            this.isMusicPlaying = false;
            Utils.log("呼叫音乐已停止。", Utils.logLevels.DEBUG);

            if (this._boundEnableMusicPlay) {
                document.body.removeEventListener('click', this._boundEnableMusicPlay);
                this._boundEnableMusicPlay = null;
            }
        }
    },

    updateCurrentCallUIState: function () {
        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.updateUIForCallState(this.state);
        }
    },

    /**
     * [REFACTORED] 清理与媒体会话相关的状态和UI，但保留底层数据连接。
     */
    cleanupCallMediaAndState: function () {
        const peerIdCleaned = this.state.currentPeerId;
        Utils.log(`正在清理媒体会话状态 (for ${peerIdCleaned || '未知'})。底层连接将保持。`, Utils.logLevels.INFO);

        if (window.Android && typeof window.Android.cancelIncomingCall === 'function') {
            window.Android.cancelIncomingCall();
        }

        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        this.stopMusic();
        ModalUIManager.hideCallingModal();
        ModalUIManager.hideCallRequest();

        VideoCallHandler._stopAdaptiveMediaChecks(peerIdCleaned);

        this.releaseMediaResources();

        VideoCallUIManager.setLocalStream(null);
        VideoCallUIManager.setRemoteStream(null);
        VideoCallUIManager.showCallContainer(false);
        VideoCallUIManager.resetPipVisuals();

        // 重置所有与媒体会话相关的状态属性
        this.state.localStream = null;
        this.state.remoteStream = null;
        this.state.isCallActive = false;
        this.state.isCallPending = false;
        this.state.isAudioMuted = false;
        this.state.isAudioOnly = false;
        this.state.isScreenSharing = false;
        this.state.isVideoEnabled = true;
        this.state.currentPeerId = null; // 媒体会话结束，清除当前通话伙伴ID
        this.state.isCaller = false;

        Utils.log('媒体会话状态已清理。', Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    releaseMediaResources: function () {
        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(track => {
                track.stop();
            });
            this.state.localStream = null;
        }
    }
};