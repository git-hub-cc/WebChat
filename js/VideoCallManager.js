/**
 * @file VideoCallManager.js
 * @description 【重构】视频通话高级状态管理器和公共 API。
 *              此类现在与 simple-peer 集成，负责管理通话的整体状态，并通过 ConnectionManager
 *              创建和管理携带媒体流的 simple-peer 连接。
 *              移除了手动的SDP处理和自适应质量控制逻辑，以依赖 simple-peer 的内部协商。
 *              新增了 handleRemoteStream 方法来处理从 simple-peer 'stream' 事件到达的媒体流。
 * @module VideoCallManager
 * @exports {object} VideoCallManager
 * @dependencies AppSettings, Utils, NotificationUIManager, ConnectionManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter, WebRTCManager
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
     * 初始化管理器。
     */
    init: function () {
        // 不再需要初始化 VideoCallHandler
        try {
            this.musicPlayer = new Audio(AppSettings.media.music);
            this.musicPlayer.loop = true;
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
     * 处理来自对方的通话相关消息（非WebRTC信令）。
     * @param {object} message - 消息对象。
     * @param {string} peerId - 发送方 ID。
     */
    handleMessage: function (message, peerId) {
        // [MODIFIED] 现在只处理应用层通话信令，WebRTC信令由ConnectionManager/WebRTCManager处理
        switch (message.type) {
            case 'video-call-request':
                if (!this.state.isCallActive && !this.state.isCallPending) {
                    this.state.isCallPending = true;
                    if (window.Android && typeof window.Android.showIncomingCall === 'function') {
                        const callerName = UserManager.contacts[peerId]?.name || peerId;
                        Utils.log(`[Native Call] 正在为 ${callerName} 触发原生来电通知。`, Utils.logLevels.INFO);
                        window.Android.showIncomingCall(callerName, peerId);
                    }
                    this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    ConnectionManager.sendTo(peerId, { type: 'video-call-rejected', reason: 'busy', sender: UserManager.userId });
                }
                break;
            case 'video-call-accepted':
                if (this.state.isCallPending && this.state.isCaller && this.state.currentPeerId === peerId) {
                    this.manager.stopMusic();
                    ModalUIManager.hideCallingModal();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    // 现在接受方会发起连接，发起方只需等待 'stream' 和 'connect' 事件
                    Utils.log(`呼叫被 ${peerId} 接受，等待对方发起连接...`, Utils.logLevels.INFO);
                }
                break;
            case 'video-call-rejected':
            case 'video-call-cancel':
            case 'video-call-end':
                if ((this.state.isCallActive || this.state.isCallPending) && this.state.currentPeerId === peerId) {
                    const reasonText = {
                        'video-call-rejected': `通话被 ${UserManager.contacts[peerId]?.name || '对方'} 拒绝。`,
                        'video-call-cancel': `通话被 ${UserManager.contacts[peerId]?.name || '对方'} 取消。`,
                        'video-call-end': `${UserManager.contacts[peerId]?.name || '对方'} 结束了通话。`
                    }[message.type];

                    if (window.Android && typeof window.Android.cancelIncomingCall === 'function') {
                        Utils.log(`[Native Call] 正在取消原生来电通知。`, Utils.logLevels.INFO);
                        window.Android.cancelIncomingCall();
                    }
                    NotificationUIManager.showNotification(reasonText, 'info');
                    this.cleanupCallMediaAndState();
                }
                break;
        }
    },

    /**
     * [NEW] 处理从 simple-peer 'stream' 事件到达的远程媒体流。
     * @param {string} peerId - 流来源的对方 ID。
     * @param {MediaStream} stream - 远程媒体流。
     */
    handleRemoteStream: function(peerId, stream) {
        if (this.state.currentPeerId === peerId && this.state.isCallActive) {
            Utils.log(`VideoCallManager: 已接收到来自 ${peerId} 的远程流。`, Utils.logLevels.INFO);
            this.state.remoteStream = stream;
            VideoCallUIManager.setRemoteStream(stream);
            this.updateCurrentCallUIState();
        } else {
            Utils.log(`VideoCallManager: 收到来自 ${peerId} 的流，但当前通话状态不匹配。忽略。`, Utils.logLevels.WARN);
        }
    },

    /**
     * 发起一个通话（视频或纯音频）。
     * @param {string} peerId - 目标对方的 ID。
     * @param {boolean} [audioOnly=false] - 是否为纯音频通话。
     */
    initiateCall: async function (peerId, audioOnly = false) {
        if (this.state.isCallActive || this.state.isCallPending) {
            NotificationUIManager.showNotification('已有通话正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId || !ConnectionManager.isConnectedTo(peerId)) {
            NotificationUIManager.showNotification('请选择一个已连接的伙伴进行通话。', 'error');
            return;
        }

        this.state.isAudioOnly = audioOnly;
        this.state.isScreenSharing = false;
        this.state.isVideoEnabled = !audioOnly;
        this.state.isAudioMuted = false;
        this.state.currentPeerId = peerId;
        this.state.isCaller = true;
        this.state.isCallPending = true;

        // 仅发送请求，不获取媒体流。等待对方接受后再获取。
        ConnectionManager.sendTo(peerId, {
            type: 'video-call-request',
            audioOnly: this.state.isAudioOnly,
            isScreenShare: false,
            sender: UserManager.userId
        });

        ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), audioOnly ? '语音通话' : '视频通话');
        this.playMusic();

        this.callRequestTimeout = setTimeout(() => {
            if (this.state.isCallPending) {
                ConnectionManager.sendTo(this.state.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId });
                this.cancelPendingCall();
            }
        }, AppSettings.timeouts.callRequest);
    },

    /**
     * 接受通话请求。
     */
    acceptCall: async function () {
        ModalUIManager.hideCallRequest();
        this.manager.stopMusic();
        if (!this.state.currentPeerId) {
            NotificationUIManager.showNotification('无效的通话请求。', 'error');
            return;
        }

        try {
            // 1. 接受方获取本地媒体流
            await this._startLocalStream();

            // 2. 发送接受信令
            ConnectionManager.sendTo(this.state.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: !this.state.isVideoEnabled, // 发送自己当前的模式
                isScreenShare: false,
                sender: UserManager.userId
            });

            // 3. 创建 non-initiator peer 并传入流，它将等待对方的 offer
            ConnectionManager.connectToPeer(this.state.currentPeerId, {
                initiator: false,
                stream: this.state.localStream
            });

            // 4. 更新UI状态
            VideoCallUIManager.setLocalStream(this.state.localStream);
            VideoCallUIManager.showCallContainer(true);
            this.state.isCallActive = true;
            this.state.isCallPending = false;
            this.updateCurrentCallUIState();
        } catch (error) {
            Utils.log(`接听通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`接听通话失败: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.state.currentPeerId, { type: 'video-call-rejected', reason: 'device_error', sender: UserManager.userId });
            this.cleanupCallMediaAndState();
        }
    },


    /**
     * @private
     * 获取本地媒体流（摄像头/麦克风或屏幕）。
     */
    _startLocalStream: async function() {
        this.releaseMediaResources(); // 清理旧的流

        try {
            if (this.state.isScreenSharing) {
                // ... [屏幕共享逻辑不变，见原 VideoCallHandler] ...
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
                this.state.isVideoEnabled = true;
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints, video: false });
                } catch (micError) {
                    NotificationUIManager.showNotification('无法获取麦克风，将继续共享但不包含您的声音。', 'warning');
                }
                const finalTracks = [];
                const screenVideoTrack = screenStream.getVideoTracks()[0];
                if (screenVideoTrack) {
                    screenVideoTrack.onended = () => this.hangUpMedia();
                    finalTracks.push(screenVideoTrack);
                }
                if (screenStream.getAudioTracks()[0]) finalTracks.push(screenStream.getAudioTracks()[0]);
                if (micStream && micStream.getAudioTracks()[0]) finalTracks.push(micStream.getAudioTracks()[0]);
                this.state.localStream = new MediaStream(finalTracks);
            } else {
                let attemptVideo = !this.state.isAudioOnly;
                if(attemptVideo) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if(!this.state.isAudioOnly) NotificationUIManager.showNotification('没有摄像头。切换到纯音频通话。', 'warning');
                        attemptVideo = false;
                    }
                }
                this.state.localStream = await navigator.mediaDevices.getUserMedia({
                    video: attemptVideo ? {} : false,
                    audio: AppSettings.media.audioConstraints
                });
                this.state.isVideoEnabled = this.state.localStream.getVideoTracks().length > 0;
            }
            // 应用初始静音/视频状态
            if (this.state.localStream.getAudioTracks()[0]) this.state.localStream.getAudioTracks()[0].enabled = !this.state.isAudioMuted;
            if (this.state.localStream.getVideoTracks()[0]) this.state.localStream.getVideoTracks()[0].enabled = this.state.isVideoEnabled;

        } catch (error) {
            Utils.log(`获取媒体流失败: ${error.name}`, Utils.logLevels.ERROR);
            this.state.isVideoEnabled = false;
            // 尝试回退到纯音频
            try {
                this.state.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: AppSettings.media.audioConstraints });
            } catch(audioError) {
                Utils.log(`备用音频流获取失败: ${audioError.name}`, Utils.logLevels.ERROR);
                this.cleanupCallMediaAndState();
                throw audioError; // 向上抛出，让调用者处理
            }
        }
    },


    /**
     * 挂断当前通话或取消等待中的通话。
     * @param {boolean} [notifyPeer=true] - 是否发送挂断信令给对方。
     */
    hangUpMedia: function (notifyPeer = true) {
        const peerIdToHangUp = this.state.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToHangUp || '未知'} 挂断媒体。通知: ${notifyPeer}`, Utils.logLevels.INFO);

        if (notifyPeer && (this.state.isCallActive || this.state.isCallPending) && peerIdToHangUp) {
            ConnectionManager.sendTo(peerIdToHangUp, { type: 'video-call-end', sender: UserManager.userId });
        }
        // simple-peer 的 destroy 会处理 RTCPeerConnection 的关闭
        WebRTCManager.closeConnection(peerIdToHangUp);
        this.cleanupCallMediaAndState();
    },

    /**
     * 清理所有通话相关的媒体资源和状态。
     */
    cleanupCallMediaAndState: function () {
        Utils.log(`正在清理通话媒体和状态 (for ${this.state.currentPeerId || '未知'})。`, Utils.logLevels.INFO);
        if (window.Android && typeof window.Android.cancelIncomingCall === 'function') {
            window.Android.cancelIncomingCall();
        }
        this.stopMusic();
        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        ModalUIManager.hideCallingModal();
        ModalUIManager.hideCallRequest();
        this.releaseMediaResources();

        if (VideoCallUIManager) {
            VideoCallUIManager.setLocalStream(null);
            VideoCallUIManager.setRemoteStream(null);
            VideoCallUIManager.showCallContainer(false);
            VideoCallUIManager.resetPipVisuals();
        }

        // 重置所有状态
        this.state = {
            localStream: null, remoteStream: null, currentPeerId: null, isCallActive: false,
            isCaller: false, isCallPending: false, isAudioMuted: false, isVideoEnabled: true,
            isAudioOnly: false, isScreenSharing: false,
        };
        this.updateCurrentCallUIState();
    },


    // ... (其他方法如 toggleCamera, toggleAudio, playMusic, stopMusic, releaseMediaResources, updateCurrentCallUIState 基本保持不变，
    // 只是它们现在直接操作 localStream.getTracks()，而不需要通过 RTCRtpSender)
    toggleCamera: function () {
        if (!this.state.isCallActive || !this.state.localStream) return;
        if (this.state.isAudioOnly || this.state.isScreenSharing) return;

        const videoTrack = this.state.localStream.getVideoTracks()[0];
        if (videoTrack) {
            this.state.isVideoEnabled = !this.state.isVideoEnabled;
            videoTrack.enabled = this.state.isVideoEnabled;
            this.updateCurrentCallUIState();
        }
    },

    toggleAudio: function () {
        if (!this.state.isCallActive || !this.state.localStream) return;
        const audioTrack = this.state.localStream.getAudioTracks()[0];
        if (audioTrack) {
            this.state.isAudioMuted = !this.state.isAudioMuted;
            audioTrack.enabled = !this.state.isAudioMuted;
            this.updateCurrentCallUIState();
        }
    },

    playMusic: function() {
        if (this.musicPlayer && this.musicPlayer.paused) {
            this.musicPlayer.play().catch(e => {
                if (e.name === 'NotAllowedError') {
                    NotificationUIManager.showNotification("音乐播放被阻止。请点击/触摸以启用。", "warning");
                    const enableAudio = () => this.playMusic();
                    document.body.addEventListener('click', enableAudio, { once: true });
                }
            });
        }
    },
    stopMusic: function() {
        if (this.musicPlayer && !this.musicPlayer.paused) {
            this.musicPlayer.pause();
            this.musicPlayer.currentTime = 0;
        }
    },
    releaseMediaResources: function () {
        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(track => track.stop());
            this.state.localStream = null;
        }
    },
    updateCurrentCallUIState: function () {
        if (VideoCallUIManager) {
            VideoCallUIManager.updateUIForCallState(this.state);
        }
    },
    // 以下方法在 simple-peer 模式下不再需要，因为协商是自动的
    // showCallRequest, rejectCall, cancelPendingCall, initiateScreenShare, toggleAudioOnly
    // initiateAudioCall
    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        this.state.currentPeerId = peerId;
        this.state.isAudioOnly = audioOnly;
        this.state.isScreenSharing = isScreenShare;
        this.state.isCaller = false;
        ModalUIManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.playMusic();
    },
    rejectCall: function () {
        ModalUIManager.hideCallRequest();
        this.manager.stopMusic();
        if (!this.state.currentPeerId) return;
        ConnectionManager.sendTo(this.state.currentPeerId, { type: 'video-call-rejected', reason: 'user_rejected', sender: UserManager.userId });
        this.cleanupCallMediaAndState();
    },
    cancelPendingCall: function () {
        this.cleanupCallMediaAndState();
    },
    initiateScreenShare: async function(peerId) {
        if (this.state.isCallActive || this.state.isCallPending) {
            NotificationUIManager.showNotification('已有通话/共享正在进行或等待中。', 'warning');
            return;
        }
        if (!peerId) peerId = ChatManager.currentChatId;
        if (!peerId || !ConnectionManager.isConnectedTo(peerId)) {
            NotificationUIManager.showNotification('请选择一个已连接的伙伴以共享屏幕。', 'error');
            return;
        }
        this.state.isScreenSharing = true;
        this.state.isAudioOnly = false;
        this.state.isVideoEnabled = true;
        this.state.isAudioMuted = false;
        this.state.currentPeerId = peerId;
        this.state.isCaller = true;
        this.state.isCallPending = true;

        ConnectionManager.sendTo(peerId, {
            type: 'video-call-request',
            audioOnly: false,
            isScreenShare: true,
            sender: UserManager.userId
        });
        ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), '屏幕共享');
        this.playMusic();
        this.callRequestTimeout = setTimeout(() => {
            if (this.state.isCallPending) {
                ConnectionManager.sendTo(this.state.currentPeerId, { type: 'video-call-cancel', sender: UserManager.userId });
                this.cancelPendingCall();
            }
        }, AppSettings.timeouts.callRequest);
    },
    toggleAudioOnly: function() {
        if(this.state.isCallActive || this.state.isCallPending) return;
        this.state.isAudioOnly = !this.state.isAudioOnly;
        this.state.isVideoEnabled = !this.state.isAudioOnly;
        this.updateCurrentCallUIState();
    },
    initiateAudioCall: function(peerId) {
        this.initiateCall(peerId, true);
    }
};