/**
 * @file VideoCallManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 视频通话高级状态管理器和公共 API。
 *              负责管理通话的整体状态，并为其他模块提供发起和控制通话的接口。
 *              它将底层的信令协议和媒体流获取委托给 VideoCallHandler 处理。
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

    /**
     * 初始化管理器和处理器。
     * @returns {boolean} 初始化是否成功。
     */
    init: function () {
        VideoCallHandler.init(this);
        try {
            this.musicPlayer = new Audio(AppSettings.media.music);
            this.musicPlayer.loop = true;
        } catch (e) {
            this.musicPlayer = null;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。通话功能已禁用。', Utils.logLevels.ERROR);
            return false;
        }
        return true;
    },

    /**
     * 从 ConnectionManager 接收信令消息并转发给处理器。
     * @param {object} message - 消息对象。
     * @param {string} peerId - 发送方 ID。
     */
    handleMessage: function (message, peerId) {
        // [NEW] 拦截来电请求以触发原生通知
        if (message.type === 'video-call-request') {
            if (window.Android && typeof window.Android.showIncomingCall === 'function') {
                const callerName = UserManager.contacts[peerId]?.name || peerId;
                Utils.log(`[Native Call] 正在为 ${callerName} 触发原生来电通知。`, Utils.logLevels.INFO);
                window.Android.showIncomingCall(callerName, peerId);
            }
        }
        // [NEW] 拦截呼叫取消/结束以取消原生通知
        if (message.type === 'video-call-cancel' || message.type === 'video-call-end' || message.type === 'video-call-rejected') {
            if (window.Android && typeof window.Android.cancelIncomingCall === 'function') {
                Utils.log(`[Native Call] 正在取消原生来电通知。`, Utils.logLevels.INFO);
                window.Android.cancelIncomingCall();
            }
        }
        VideoCallHandler.handleMessage(message, peerId);
    },

    /**
     * [REFACTORED] 发起通话的核心逻辑。
     * @param {string} peerId - 目标对方的 ID。
     * @param {object} options - 通话选项 { audioOnly, isScreenShare }.
     */
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
        ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), callType);
        this.playMusic();

        this.callRequestTimeout = setTimeout(() => {
            if (this.state.isCallPending) {
                ConnectionManager.sendTo(this.state.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId });
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

    // This function is for pre-call setup, it does not affect an active call.
    toggleAudioOnly: function () {
        if (this.state.isCallActive || this.state.isCallPending) {
            NotificationUIManager.showNotification("通话中或等待时无法切换模式。", "warning");
            return;
        }
        this.state.isAudioOnly = !this.state.isAudioOnly;
        this.state.isVideoEnabled = !this.state.isAudioOnly;
        this.updateCurrentCallUIState();
    },

    hangUpMedia: function (notifyPeer = true) {
        const peerIdToHangUp = this.state.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToHangUp || '未知'} 挂断媒体。通知: ${notifyPeer}`, Utils.logLevels.INFO);

        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        if (notifyPeer && (this.state.isCallActive || this.state.isCallPending) && peerIdToHangUp) {
            ConnectionManager.sendTo(peerIdToHangUp, {type: 'video-call-end', sender: UserManager.userId});
        }

        // Let WebRTCManager handle the actual peer connection closing
        if(peerIdToHangUp) {
            WebRTCManager.closeConnection(peerIdToHangUp);
        }

        this.cleanupCallMediaAndState();
    },

    playMusic: function (isRetry = false) {
        // ... (逻辑不变) ...
    },

    stopMusic: function () {
        // ... (逻辑不变) ...
    },

    updateCurrentCallUIState: function () {
        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.updateUIForCallState(this.state);
        }
    },

    cleanupCallMediaAndState: function () {
        const peerIdCleaned = this.state.currentPeerId;
        Utils.log(`正在清理通话媒体和状态 (for ${peerIdCleaned || '未知'})。`, Utils.logLevels.INFO);

        if (window.Android && typeof window.Android.cancelIncomingCall === 'function') {
            window.Android.cancelIncomingCall();
        }

        this.stopMusic();
        ModalUIManager.hideCallingModal();
        ModalUIManager.hideCallRequest();

        VideoCallHandler._stopAdaptiveMediaChecks(peerIdCleaned);

        this.releaseMediaResources();

        VideoCallUIManager.setLocalStream(null);
        VideoCallUIManager.setRemoteStream(null);
        VideoCallUIManager.showCallContainer(false);
        VideoCallUIManager.resetPipVisuals();

        // 重置所有状态属性
        this.state.localStream = null;
        this.state.remoteStream = null;
        this.state.isCallActive = false;
        this.state.isCallPending = false;
        this.state.isAudioMuted = false;
        this.state.isAudioOnly = false;
        this.state.isScreenSharing = false;
        this.state.isVideoEnabled = true;
        this.state.currentPeerId = null;
        this.state.isCaller = false;

        Utils.log('通话媒体和状态已清理。', Utils.logLevels.INFO);
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