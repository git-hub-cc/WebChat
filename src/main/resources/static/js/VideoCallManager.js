/**
 * @file VideoCallManager.js
 * @description 视频通话高级状态管理器和公共 API。
 *              负责管理通话的整体状态，并为其他模块提供发起和控制通话的接口。
 *              它将底层的 WebRTC 协商逻辑委托给 VideoCallHandler 处理。
 * @module VideoCallManager
 * @exports {object} VideoCallManager
 * @dependencies VideoCallHandler, AppSettings, Utils, NotificationUIManager, ConnectionManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter
 */
const VideoCallManager = {
    // 高级状态统一管理
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
     * 从 ConnectionManager 接收信令消息并转发给处理器。
     * @param {object} message - 消息对象。
     * @param {string} peerId - 发送方 ID。
     */
    handleMessage: function (message, peerId) {
        VideoCallHandler.handleMessage(message, peerId);
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
        if (this.state.isCallActive || this.state.isCallPending) {
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

        this.state.isScreenSharing = true;
        this.state.isAudioOnly = false;
        this.state.isVideoEnabled = true;
        this.state.isAudioMuted = false;

        try {
            this.state.currentPeerId = peerId;
            this.state.isCaller = true;
            this.state.isCallPending = true;

            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.state.isAudioOnly,
                isScreenShare: this.state.isScreenSharing,
                sender: UserManager.userId
            });

            ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), '屏幕共享');
            this.playMusic();

            this.callRequestTimeout = setTimeout(() => {
                if (this.state.isCallPending) {
                    ConnectionManager.sendTo(this.state.currentPeerId, {
                        type: 'video-call-cancel',
                        sender: UserManager.userId
                    });
                    this.cancelPendingCall();
                }
            }, AppSettings.timeouts.callRequest);
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
     */
    initiateCall: async function (peerId, audioOnly = false) {
        if (this.state.isCallActive || this.state.isCallPending) {
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

        this.state.isAudioOnly = audioOnly;
        this.state.isScreenSharing = false;
        this.state.isVideoEnabled = !audioOnly;
        this.state.isAudioMuted = false;
        try {
            this.state.currentPeerId = peerId;
            this.state.isCaller = true;
            this.state.isCallPending = true;

            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.state.isAudioOnly,
                isScreenShare: this.state.isScreenSharing,
                sender: UserManager.userId
            });

            ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), this.state.isAudioOnly ? '语音通话' : '视频通话');
            this.playMusic();

            this.callRequestTimeout = setTimeout(() => {
                if (this.state.isCallPending) {
                    ConnectionManager.sendTo(this.state.currentPeerId, {
                        type: 'video-call-cancel',
                        sender: UserManager.userId
                    });
                    this.cancelPendingCall();
                }
            }, AppSettings.timeouts.callRequest);
        } catch (error) {
            Utils.log(`发起通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('发起通话失败。', 'error');
            this.cleanupCallMediaAndState();
        }
    },

    /**
     * 切换摄像头开关。
     */
    toggleCamera: function () {
        if (!this.state.isCallActive || !this.state.localStream) {
            NotificationUIManager.showNotification("通话未激活或本地流不存在。", "warning");
            return;
        }
        if (this.state.isAudioOnly) {
            NotificationUIManager.showNotification("纯音频通话中摄像头不可用。", "warning");
            return;
        }
        if (this.state.isScreenSharing && this.state.isCaller) {
            NotificationUIManager.showNotification("屏幕共享期间摄像头不可用。", "warning");
            return;
        }

        const videoTrack = this.state.localStream.getVideoTracks().find(t => t.kind === 'video' && t.readyState === 'live');

        if (!videoTrack && !this.state.isScreenSharing) {
            NotificationUIManager.showNotification('本地视频轨道不可用。', 'warning');
            this.state.isVideoEnabled = false;
            this.updateCurrentCallUIState();
            return;
        }
        if (videoTrack) {
            this.state.isVideoEnabled = !this.state.isVideoEnabled;
            videoTrack.enabled = this.state.isVideoEnabled;
        } else {
            this.state.isVideoEnabled = false;
        }

        this.updateCurrentCallUIState();
    },

    /**
     * 切换麦克风静音状态。
     */
    toggleAudio: function () {
        if (!this.state.isCallActive || !this.state.localStream || !this.state.localStream.getAudioTracks()[0]) {
            NotificationUIManager.showNotification("通话未激活或本地音频轨道不存在。", "warning");
            return;
        }
        this.state.isAudioMuted = !this.state.isAudioMuted;
        this.state.localStream.getAudioTracks()[0].enabled = !this.state.isAudioMuted;
        this.updateCurrentCallUIState();
    },

    /**
     * 切换通话是否为纯音频模式（仅在通话前有效）。
     */
    toggleAudioOnly: async function () {
        if (this.state.isCallActive || this.state.isCallPending) {
            NotificationUIManager.showNotification("通话中或等待时无法切换模式。", "warning");
            return;
        }
        this.state.isAudioOnly = !this.state.isAudioOnly;
        Utils.log("已切换纯音频模式 (通话前): " + this.state.isAudioOnly, Utils.logLevels.INFO);
        this.state.isVideoEnabled = !this.state.isAudioOnly;
        this.updateCurrentCallUIState();
    },

    /**
     * 挂断当前通话或取消等待中的通话。
     * @param {boolean} [notifyPeer=true] - 是否发送挂断信令给对方。
     */
    hangUpMedia: function (notifyPeer = true) {
        const peerIdToHangUp = this.state.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToHangUp || '未知'} 挂断媒体。通知: ${notifyPeer}`, Utils.logLevels.INFO);

        if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
        this.callRequestTimeout = null;

        VideoCallHandler._stopAdaptiveAudioCheck(peerIdToHangUp);

        if (notifyPeer && (this.state.isCallActive || this.state.isCallPending) && peerIdToHangUp) {
            ConnectionManager.sendTo(peerIdToHangUp, {type: 'video-call-end', sender: UserManager.userId});
        }

        this.cleanupCallMediaAndState();
    },

    /**
     * 播放等待音。
     * @param {boolean} [isRetry=false] - 是否为重试播放。
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
     * 停止等待音。
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
     * 根据当前状态更新通话相关的UI。
     */
    updateCurrentCallUIState: function () {
        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.updateUIForCallState(this.state);
        }
    },

    /**
     * 清理所有通话相关的媒体资源和状态。
     */
    cleanupCallMediaAndState: function () {
        const peerIdCleaned = this.state.currentPeerId;
        Utils.log(`正在清理通话媒体和状态 (for ${peerIdCleaned || '未知'})。`, Utils.logLevels.INFO);

        this.stopMusic();
        ModalUIManager.hideCallingModal();
        ModalUIManager.hideCallRequest();

        VideoCallHandler._stopAdaptiveAudioCheck(peerIdCleaned);
        if (peerIdCleaned) {
            delete VideoCallHandler._lastNegotiatedSdpFmtpLine[peerIdCleaned];
        } else {
            VideoCallHandler._lastNegotiatedSdpFmtpLine = {};
        }

        this.releaseMediaResources();

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

        // 重置所有状态属性
        this.state.remoteStream = null;
        this.state.isCallActive = false;
        this.state.isCallPending = false;
        this.state.isAudioMuted = false;
        this.state.isAudioOnly = false;
        this.state.isScreenSharing = false;
        this.state.isVideoEnabled = true;
        this.state.currentPeerId = null;

        Utils.log('通话媒体和状态已清理。', Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    /**
     * 释放本地媒体流资源。
     */
    releaseMediaResources: function () {
        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(track => {
                track.stop();
                Utils.log(`已停止本地轨道: ${track.kind} id: ${track.id}`, Utils.logLevels.DEBUG);
            });
            this.state.localStream = null;
        }
    }
};