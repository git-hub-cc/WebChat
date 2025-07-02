/**
 * @file 视频通话核心逻辑管理器
 * @description 负责处理视频/音频通话和屏幕共享的所有核心功能，包括媒体流的获取、信令交换、连接协商以及通话状态管理。基于网络状况进行自适应音频质量调整，并支持动态修改音频参数以优化弱网环境下的表现。
 * @module VideoCallManager
 * @exports {object} VideoCallManager - 对外暴露的单例对象，包含所有通话管理方法。
 * @dependency AppSettings, Utils, NotificationUIManager, ConnectionManager, WebRTCManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter, TimerManager
 */
const VideoCallManager = {
    // =================================================================
    // 状态变量 (State Variables)
    // =================================================================

    // 本地媒体流
    localStream: null,
    // 远端媒体流
    remoteStream: null,
    // 当前通话的对方ID
    currentPeerId: null,
    // 标识通话是否处于活动状态
    isCallActive: false,
    // 标识当前客户端是否为呼叫发起方（对重新协商控制至关重要）
    isCaller: false,

    // 标识是否存在一个等待接听或响应的通话请求
    isCallPending: false,
    // 标识音频是否静音
    isAudioMuted: false,
    // 标识视频是否启用
    isVideoEnabled: true,
    // 标识是否为纯音频通话
    isAudioOnly: false,
    // 呼叫请求的超时计时器ID
    callRequestTimeout: null,
    // 标识是否正在进行屏幕共享
    isScreenSharing: false,
    // 音乐播放器实例
    musicPlayer: null,
    // 标识音乐是否正在播放
    isMusicPlaying: false,
    // 用于处理浏览器自动播放策略的绑定函数引用
    _boundEnableMusicPlay: null,

    // =================================================================
    // 配置常量 (Configuration Constants)
    // =================================================================

    // 获取音频流时的约束条件
    audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1 // 强制使用单声道，优化性能
    },
    // WebRTC 编解码器优先级配置
    codecPreferences: {
        audio: [{ // 此为默认/备用配置，实际使用的 sdpFmtpLine 来自自适应音频质量配置
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 1,
            sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000;cbr=0;maxplaybackrate=16000;sprop-stereo=0'
        }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },

    // =================================================================
    // 自适应音频内部状态 (Adaptive Audio Internal State)
    // =================================================================

    // 存储每个对方当前的音频质量配置索引, e.g., { peerId: 1 }
    _currentAudioProfileIndex: {},
    // 存储每个对方上次切换配置的时间戳, e.g., { peerId: 1678886400000 }
    _lastProfileSwitchTime: {},
    // 存储每个对方连续网络良好的检查次数, e.g., { peerId: 3 }
    _consecutiveGoodChecks: {},
    // 存储每个对方连续网络差的检查次数, e.g., { peerId: 1 }
    _consecutiveBadChecks: {},
    // 存储每个对方上次成功协商的 sdpFmtpLine
    _lastNegotiatedSdpFmtpLine: {},


    // =================================================================
    // 公开方法 (Public Methods)
    // =================================================================

    /**
     * 初始化视频通话管理器，包括设置音乐播放器。
     * @function init
     * @returns {boolean} - 初始化是否成功。
     */
    init: function () {
        // 1. 初始化音乐播放器
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

        // 2. 检查浏览器是否支持媒体设备 API
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。通话功能已禁用。', Utils.logLevels.ERROR);
            return false;
        }

        // 3. 确保内部状态被清空
        this._lastNegotiatedSdpFmtpLine = {};
        return true;
    },

    /**
     * 发起一个纯音频通话。
     * @function initiateAudioCall
     * @param {string} peerId - 目标对方的 ID。
     */
    initiateAudioCall: function (peerId) {
        this.initiateCall(peerId, true);
    },

    /**
     * 发起屏幕共享。
     * @function initiateScreenShare
     * @param {string} peerId - 目标对方的 ID。
     * @returns {Promise<void>}
     */
    initiateScreenShare: async function (peerId) {
        // 1. 检查通话状态，防止重复发起
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

        // 2. 设置屏幕共享状态
        this.isScreenSharing = true;
        this.isAudioOnly = false;
        this.isVideoEnabled = true;
        this.isAudioMuted = false;

        try {
            // 3. 发送屏幕共享请求
            this.currentPeerId = peerId;
            this.isCaller = true; // 当前客户端是发起方
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });

            // 4. 显示呼叫中界面并播放音乐
            ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), '屏幕共享');
            this.playMusic();

            // 5. 设置30秒超时，若对方未响应则自动取消
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
     * @function initiateCall
     * @param {string} peerId - 目标对方的 ID。
     * @param {boolean} [audioOnly=false] - 是否为纯音频通话。
     * @returns {Promise<void>}
     */
    initiateCall: async function (peerId, audioOnly = false) {
        // 1. 检查通话状态，防止重复发起
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

        // 2. 设置通话状态
        this.isAudioOnly = audioOnly;
        this.isScreenSharing = false;
        this.isVideoEnabled = !audioOnly;
        this.isAudioMuted = false;
        try {
            // 3. 发送通话请求
            this.currentPeerId = peerId;
            this.isCaller = true; // 当前客户端是发起方
            this.isCallPending = true;
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-request',
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing,
                sender: UserManager.userId
            });

            // 4. 显示呼叫中界面并播放音乐
            ModalUIManager.showCallingModal(UserManager.contacts[peerId]?.name || '对方', () => this.hangUpMedia(), () => this.stopMusic(), this.isAudioOnly ? '语音通话' : '视频通话');
            this.playMusic();

            // 5. 设置30秒超时，若对方未响应则自动取消
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
     * @function showCallRequest
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
        this.isCaller = false; // 当前客户端是接收方
        ModalUIManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.playMusic();
    },

    /**
     * 接听来电。
     * @function acceptCall
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

            // 作为接听方，等待对方（Caller）发起媒体协商 Offer
            // 因此 isOfferCreatorForMedia 为 false
            await this.startLocalStreamAndSignal(false);

            // 发送接听成功的消息给对方
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
     * @function rejectCall
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
        this.cleanupCallMediaAndState(false); // 清理状态，但不关闭底层连接
        Utils.log('已拒绝通话请求。', Utils.logLevels.INFO);
    },

    /**
     * 切换本地摄像头的启用/禁用状态。
     * @function toggleCamera
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
     * @function toggleAudio
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
     * @function toggleAudioOnly
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
     * @function hangUpMedia
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
     * @function cancelPendingCall
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
     * @function cleanupCallMediaAndState
     * @param {boolean} [closePeerConnectionIfUnused=true] - 是否在没有其他用途（如数据通道）时关闭底层的 RTCPeerConnection。
     */
    cleanupCallMediaAndState: function (closePeerConnectionIfUnused = true) {
        const peerIdCleaned = this.currentPeerId;
        Utils.log(`正在清理通话媒体和状态 (for ${peerIdCleaned || '未知'})。关闭 PC (如果未使用): ${closePeerConnectionIfUnused}`, Utils.logLevels.INFO);

        // 1. 停止音乐并隐藏所有通话相关的模态框
        this.stopMusic();
        ModalUIManager.hideCallingModal();
        ModalUIManager.hideCallRequest();

        // 2. 停止自适应音频检测
        this._stopAdaptiveAudioCheck(peerIdCleaned);
        if (peerIdCleaned) {
            delete this._lastNegotiatedSdpFmtpLine[peerIdCleaned];
        } else {
            this._lastNegotiatedSdpFmtpLine = {};
        }

        // 3. 释放媒体资源（摄像头/麦克风）
        this.releaseMediaResources();

        // 4. 从 PeerConnection 中移除轨道
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

        // 5. 重置 UI 状态
        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.setLocalStream(null);
            VideoCallUIManager.setRemoteStream(null);
            VideoCallUIManager.showCallContainer(false);
            VideoCallUIManager.resetPipVisuals();
        }
        this.remoteStream = null;

        // 6. 重置所有状态变量
        this.isCallActive = false;
        this.isCallPending = false;
        this.isAudioMuted = false;
        this.isAudioOnly = false;
        this.isScreenSharing = false;
        this.isVideoEnabled = true;

        const previousPeerId = this.currentPeerId;
        this.currentPeerId = null;

        // 7. 根据参数决定是否关闭底层 PeerConnection
        if (closePeerConnectionIfUnused && previousPeerId) {
            Utils.log(`作为通话清理的一部分，考虑关闭与 ${previousPeerId} 的 RTCPeerConnection。`, Utils.logLevels.INFO);
            ConnectionManager.close(previousPeerId); // <-- 正确的调用
        } else if (previousPeerId) {
            Utils.log(`与 ${previousPeerId} 的 RTCPeerConnection 已保留。媒体已挂断。`, Utils.logLevels.INFO);
        }

        Utils.log('通话媒体和状态已清理。', Utils.logLevels.INFO);
        this.updateCurrentCallUIState();
    },

    /**
     * 释放本地媒体资源（摄像头和麦克风）。
     * @function releaseMediaResources
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
     * @function handleMessage
     * @param {object} message - 从数据通道接收到的消息对象。
     * @param {string} peerId - 发送方的 ID。
     */
    handleMessage: function (message, peerId) {
        switch (message.type) {
            // 收到通话请求
            case 'video-call-request':
                if (!this.isCallActive && !this.isCallPending) {
                    this.isCallPending = true;
                    this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    // 如果正忙，则自动拒绝
                    ConnectionManager.sendTo(peerId, {
                        type: 'video-call-rejected',
                        reason: 'busy',
                        sender: UserManager.userId
                    });
                }
                break;
            // 对方接听了通话
            case 'video-call-accepted':
                if (this.isCallPending && this.isCaller && this.currentPeerId === peerId) {
                    this.stopMusic();
                    ModalUIManager.hideCallingModal();
                    if (this.callRequestTimeout) clearTimeout(this.callRequestTimeout);
                    this.callRequestTimeout = null;
                    // 作为呼叫方，在对方接听后，开始获取媒体流并创建 Offer
                    this.startLocalStreamAndSignal(true);
                }
                break;
            // 对方拒绝了通话
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
            // 对方取消了通话请求
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
            // 收到媒体协商的 Offer
            case 'video-call-offer':
                if ((!this.isCallActive && !this.isCallPending) || (this.isCallActive && this.currentPeerId === peerId)) {
                    if (!this.isCallActive) this.isCallPending = true;
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 offer，但当前状态冲突. 忽略。`, Utils.logLevels.WARN);
                }
                break;
            // 收到媒体协商的 Answer
            case 'video-call-answer':
                if (this.isCallActive && this.currentPeerId === peerId) {
                    this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 answer，但当前状态不匹配。忽略。`, Utils.logLevels.WARN);
                }
                break;
            // 对方结束了通话
            case 'video-call-end':
                if ((this.isCallActive || this.isCallPending) && this.currentPeerId === peerId) {
                    NotificationUIManager.showNotification(`${UserManager.contacts[peerId]?.name || '对方'} 结束了通话媒体。`, 'info');
                    this.cleanupCallMediaAndState(false);
                }
                break;
        }
    },

    // =================================================================
    // 内部逻辑和工具方法 (Internal & Utility Methods)
    // =================================================================

    /**
     * 播放呼叫音乐。处理浏览器自动播放策略。
     * @function playMusic
     * @param {boolean} [isRetry=false] - 是否为用户交互后的重试播放。
     */
    playMusic: function (isRetry = false) {
        if (this.musicPlayer && this.musicPlayer.paused && !this.isMusicPlaying) {
            Utils.log("正在尝试播放音乐...", Utils.logLevels.DEBUG);
            this.musicPlayer.play().then(() => {
                this.isMusicPlaying = true;
                Utils.log("音乐正在播放。", Utils.logLevels.INFO);
                // 如果是重试播放成功，移除之前添加的事件监听器
                if (isRetry && this._boundEnableMusicPlay) {
                    document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                    document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                    delete this._boundEnableMusicPlay;
                }
            }).catch(error => {
                Utils.log(`播放音乐时出错: ${error.name} - ${error.message}`, Utils.logLevels.ERROR);
                // NOTE: 处理浏览器自动播放策略，需要用户交互才能播放音频
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
     * @function stopMusic
     */
    stopMusic: function () {
        if (this.musicPlayer && (!this.musicPlayer.paused || this.isMusicPlaying)) {
            this.musicPlayer.pause();
            this.musicPlayer.currentTime = 0;
            this.isMusicPlaying = false;
            Utils.log("音乐已停止。", Utils.logLevels.INFO);
            // 清理可能存在的事件监听器
            if (this._boundEnableMusicPlay) {
                document.body.removeEventListener('click', this._boundEnableMusicPlay, {capture: true});
                document.body.removeEventListener('touchstart', this._boundEnableMusicPlay, {capture: true});
                delete this._boundEnableMusicPlay;
            }
        }
    },

    /**
     * 更新当前通话的 UI 状态。
     * @function updateCurrentCallUIState
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
     * 获取本地媒体流并开始信令交换。
     * @function startLocalStreamAndSignal
     * @param {boolean} isOfferCreatorForMedia - 当前用户是否为媒体协商的发起方。
     * @returns {Promise<void>}
     * @throws {Error} 如果获取媒体设备失败。
     */
    startLocalStreamAndSignal: async function (isOfferCreatorForMedia) {
        let attemptLocalCameraVideoSending = !this.isAudioOnly && !this.isScreenSharing;

        try {
            // 流程：根据通话类型（屏幕共享/视频/音频）获取合适的媒体流
            // 1. 如果是发起方的屏幕共享
            if (this.isScreenSharing && this.isCaller) {
                this.localStream = await navigator.mediaDevices.getDisplayMedia({video: { cursor: "always" }, audio: true});
                this.isVideoEnabled = true;
                const screenTrack = this.localStream.getVideoTracks()[0];
                if (screenTrack) screenTrack.onended = () => {
                    Utils.log("用户已结束屏幕共享。", Utils.logLevels.INFO);
                    this.hangUpMedia();
                };
                // 如果屏幕共享未包含音频，尝试获取麦克风音频
                if (this.localStream.getAudioTracks().length === 0) {
                    try {
                        const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                        micStream.getAudioTracks().forEach(track => this.localStream.addTrack(track));
                    } catch (micError) {
                        Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN);
                    }
                }
            } else { // 2. 如果是普通视频或音频通话
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
        } catch (getUserMediaError) { // 3. 媒体获取失败处理
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.isVideoEnabled = false;
            // 如果是屏幕共享发起失败，则直接中止
            if (this.isScreenSharing && this.isCaller) {
                NotificationUIManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error');
                this.cleanupCallMediaAndState();
                throw getUserMediaError;
            } else if (!this.isScreenSharing && attemptLocalCameraVideoSending && !this.isAudioOnly) {
                NotificationUIManager.showNotification(`摄像头错误: ${getUserMediaError.name}。切换到纯音频通话。`, 'error');
            }
            // 尝试回退到纯音频模式
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

        // 根据当前状态设置轨道启用状态
        if (this.localStream.getAudioTracks()[0]) this.localStream.getAudioTracks()[0].enabled = !this.isAudioMuted;
        if (this.localStream.getVideoTracks()[0]) this.localStream.getVideoTracks()[0].enabled = this.isVideoEnabled;

        // 设置UI并激活通话
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
     * @function setupPeerConnection
     * @param {boolean} isOfferCreatorForMedia - 当前用户是否为媒体协商的发起方。
     * @returns {Promise<void>}
     */
    setupPeerConnection: async function (isOfferCreatorForMedia) {
        const conn = WebRTCManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: 没有 PeerConnection。", Utils.logLevels.ERROR); this.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        // 清理旧的发送器
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);}catch(e){Utils.log("移除旧轨道时出错: "+e,Utils.logLevels.WARN);}});

        // 监听连接状态变化
        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                Utils.log(`通话 ${this.currentPeerId} 连接已 ${pc.connectionState}。正在挂断通话。`, Utils.logLevels.INFO);
                this.hangUpMedia(false);
            }
        });

        // 添加本地媒体轨道到 PeerConnection
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

        // 处理接收到的远程轨道
        pc.ontrack = (event) => {
            const trackHandler = (track) => {
                // NOTE: 防止重复添加监听器
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

            // 将轨道附加到远程流
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
     * 创建并发送一个媒体协商的提议 (offer)。
     * @function createAndSendOffer
     * @returns {Promise<void>}
     */
    createAndSendOffer: async function () {
        if (!this.currentPeerId || !this.isCallActive) return;
        const conn = WebRTCManager.connections[this.currentPeerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 用于创建提议", Utils.logLevels.ERROR);
            this.hangUpMedia();
            return;
        }
        try {
            // 1. 应用当前选择的音频配置
            this._applyAudioProfileToSender(this.currentPeerId,
                this._currentAudioProfileIndex[this.currentPeerId] !== undefined
                    ? this._currentAudioProfileIndex[this.currentPeerId]
                    : AppSettings.adaptiveAudioQuality.initialProfileIndex);

            // 2. 创建 Offer
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: !this.isAudioOnly || (this.isScreenSharing && this.isCaller)
            };
            const offer = await conn.peerConnection.createOffer(offerOptions);

            // 3. 修改 SDP 以包含 Opus 音频参数
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp, this.currentPeerId)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);

            // 4. 记录当前协商的 SDP 参数
            const offerProfileIndex = (this._currentAudioProfileIndex[this.currentPeerId] !== undefined)
                ? this._currentAudioProfileIndex[this.currentPeerId]
                : AppSettings.adaptiveAudioQuality.initialProfileIndex;
            const offerAudioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[offerProfileIndex];
            if (offerAudioProfile && offerAudioProfile.sdpFmtpLine) {
                this._lastNegotiatedSdpFmtpLine[this.currentPeerId] = offerAudioProfile.sdpFmtpLine;
            } else {
                const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
                this._lastNegotiatedSdpFmtpLine[this.currentPeerId] = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0';
            }
            Utils.log(`Offer for ${this.currentPeerId} created with sdpFmtpLine: ${this._lastNegotiatedSdpFmtpLine[this.currentPeerId]} (isCaller=${this.isCaller})`, Utils.logLevels.DEBUG);

            // 5. 发送 Offer 给对方
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
     * @function handleOffer
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
            const isInitialOffer = !this.isCallActive;

            // 1. 如果是初始 Offer，设置通话状态
            if (isInitialOffer) {
                this.isScreenSharing = remoteIsScreenShare;
                this.isAudioOnly = remoteIsAudioOnly && !remoteIsScreenShare;
                this.currentPeerId = peerId;
                this.isCaller = false; // 收到 Offer，所以是接收方
                this.isVideoEnabled = !this.isAudioOnly && !this.isScreenSharing;
                await this.startLocalStreamAndSignal(false);
            }

            // 2. 设置远程 SDP 描述
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            // 3. 应用音频配置
            this._applyAudioProfileToSender(peerId,
                this._currentAudioProfileIndex[peerId] !== undefined
                    ? this._currentAudioProfileIndex[peerId]
                    : AppSettings.adaptiveAudioQuality.initialProfileIndex);

            // 4. 创建 Answer
            const answer = await conn.peerConnection.createAnswer();
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: this.modifySdpForOpus(answer.sdp, peerId)});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);

            // 5. 记录协商的 SDP 参数
            const answerProfileIndex = (this._currentAudioProfileIndex[peerId] !== undefined)
                ? this._currentAudioProfileIndex[peerId]
                : AppSettings.adaptiveAudioQuality.initialProfileIndex;
            const answerAudioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[answerProfileIndex];
            if (answerAudioProfile && answerAudioProfile.sdpFmtpLine) {
                this._lastNegotiatedSdpFmtpLine[peerId] = answerAudioProfile.sdpFmtpLine;
            } else {
                const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
                this._lastNegotiatedSdpFmtpLine[peerId] = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0';
            }
            Utils.log(`Answer for ${peerId} created with sdpFmtpLine: ${this._lastNegotiatedSdpFmtpLine[peerId]} (isCaller=${this.isCaller})`, Utils.logLevels.DEBUG);

            // 6. 发送 Answer 给对方
            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: this.isAudioOnly,
                isScreenShare: this.isScreenSharing && this.isCaller,
                sender: UserManager.userId
            });

            // 7. 启动自适应音频检测
            this._startAdaptiveAudioCheck(peerId);

        } catch (e) {
            Utils.log(`处理来自 ${peerId} 的提议时出错: ${e.message}`, Utils.logLevels.ERROR);
            // NOTE: m-line 顺序错误是一个常见的 WebRTC 协商问题，通常无法恢复，需要中止通话。
            if (e.message && e.message.includes("The order of m-lines")) {
                NotificationUIManager.showNotification("通话协商失败 (媒体描述不匹配)，通话已结束。", "error");
                Utils.log(`M-line 顺序错误，为 ${peerId} 中止通话。`, Utils.logLevels.ERROR);
            }
            this.hangUpMedia(true); // 发生错误时，通知对方并挂断
        }
    },

    /**
     * 处理远程媒体应答 (answer)。
     * @function handleAnswer
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

            // 作为 Offer 发起方，在收到 Answer 后启动自适应音频检测
            this._startAdaptiveAudioCheck(peerId);
        } catch (e) {
            Utils.log("处理应答时出错: " + e, Utils.logLevels.ERROR);
            if (e.message && e.message.includes("The order of m-lines")) {
                NotificationUIManager.showNotification("通话协商失败 (媒体描述不匹配)，通话已结束。", "error");
                Utils.log(`M-line 顺序错误，为 ${peerId} 中止通话。`, Utils.logLevels.ERROR);
            }
            this.hangUpMedia(true);
        }
    },

    /**
     * 监控 ICE 连接状态的变化。
     * @function setupConnectionMonitoring
     * @param {RTCPeerConnection} pc - 要监控的 PeerConnection 实例。
     */
    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`通话 ICE 状态: ${pc.iceConnectionState} (for ${this.currentPeerId})`, Utils.logLevels.DEBUG);
            // NOTE: 'failed', 'disconnected', 'closed' 状态由 'connectionstatechange' 事件处理，更为可靠
        };
    },

    /**
     * 为 PeerConnection 设置首选的音视频编解码器。
     * @function setCodecPreferences
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
     * @function modifySdpForOpus
     * @param {string} sdp - 原始 SDP 字符串。
     * @param {string} peerId - 当前操作关联的对方ID，用于获取该对方的音频配置。
     * @returns {string} - 修改后的 SDP 字符串。
     */
    modifySdpForOpus: function(sdp, peerId) {
        let targetSdpFmtpLine;
        const profileIndex = (peerId && this._currentAudioProfileIndex[peerId] !== undefined)
            ? this._currentAudioProfileIndex[peerId]
            : AppSettings.adaptiveAudioQuality.initialProfileIndex;

        const audioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[profileIndex];

        // 1. 确定要使用的 sdpFmtpLine
        if (audioProfile && audioProfile.sdpFmtpLine) {
            targetSdpFmtpLine = audioProfile.sdpFmtpLine;
            Utils.log(`modifySdpForOpus for ${peerId}: 使用来自配置 ${profileIndex} ('${audioProfile.levelName}') 的 sdpFmtpLine: ${targetSdpFmtpLine}`, Utils.logLevels.DEBUG);
        } else {
            const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
            targetSdpFmtpLine = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0'; // 备用方案
            Utils.log(`modifySdpForOpus for ${peerId}: 回退到 ${audioProfile ? '无配置' : '默认'} sdpFmtpLine: ${targetSdpFmtpLine}`, Utils.logLevels.DEBUG);
        }

        // 2. 在 SDP 中找到 Opus 编解码器并修改其 a=fmtp 行
        const opusRegex = /a=rtpmap:(\d+) opus\/48000(\/2)?/gm;
        let match;
        let modifiedSdp = sdp;
        const opusTargetParams = targetSdpFmtpLine;

        while ((match = opusRegex.exec(sdp)) !== null) {
            const opusPayloadType = match[1];
            const fmtpLineForPayload = `a=fmtp:${opusPayloadType} ${opusTargetParams}`;
            const existingFmtpRegex = new RegExp(`^a=fmtp:${opusPayloadType} .*(\\r\\n)?`, 'm');

            if (existingFmtpRegex.test(modifiedSdp)) {
                // 如果已存在，则替换
                modifiedSdp = modifiedSdp.replace(existingFmtpRegex, fmtpLineForPayload + (RegExp.$1 || '\r\n'));
                Utils.log(`SDP 修改：为 Opus (PT ${opusPayloadType}, Peer ${peerId}) 更新 fmtp: ${opusTargetParams}`, Utils.logLevels.DEBUG);
            } else {
                // 如果不存在，则在 rtpmap 行后插入
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


    // --- 自适应音频质量相关方法 ---

    /**
     * @private
     * @description 由呼叫发起方 (caller) 启动 WebRTC 重新协商流程。通常在需要更改 SDP 参数 (如 sdpFmtpLine) 时调用。
     * @function _initiateRenegotiation
     * @param {string} peerId - 需要重新协商的对方ID。
     */
    _initiateRenegotiation: function(peerId) {
        Utils.log(`呼叫方 (this.isCaller=${this.isCaller}) 尝试与 ${peerId} 发起重新协商以更改 sdpFmtpLine。`, Utils.logLevels.INFO);
        const conn = WebRTCManager.connections[peerId];

        // NOTE: 确保只有原始呼叫方在稳定状态下才能发起重新协商
        if (this.isCaller && this.isCallActive && this.currentPeerId === peerId &&
            conn && conn.peerConnection && conn.peerConnection.signalingState === 'stable') {

            Utils.log(`正在为 ${peerId} 继续重新协商。创建新的提议。`, Utils.logLevels.INFO);
            // createAndSendOffer 会使用更新后的 _currentAudioProfileIndex 来获取新的 sdpFmtpLine
            this.createAndSendOffer();
        } else {
            Utils.log(`无法与 ${peerId} 发起重新协商。条件不满足: isCaller=${this.isCaller}, isCallActive=${this.isCallActive}, currentPeerId=${this.currentPeerId}, peerConnection 存在=${!!(conn && conn.peerConnection)}, signalingState=${conn?.peerConnection?.signalingState}`, Utils.logLevels.WARN);
        }
    },

    /**
     * @private
     * @description 启动周期性的网络状况检查以调整音频质量。
     * @function _startAdaptiveAudioCheck
     * @param {string} peerId - 当前通话的对方ID。
     */
    _startAdaptiveAudioCheck: function(peerId) {
        if (!peerId) {
            Utils.log("尝试为未定义的 peerId 启动自适应音频检测，已跳过。", Utils.logLevels.WARN);
            return;
        }
        const taskName = `adaptiveAudio_${peerId}`;
        if (typeof TimerManager !== 'undefined' && TimerManager.hasTask(taskName)) {
            return; // 任务已在运行
        }

        // 初始化该对方的自适应音频状态
        this._currentAudioProfileIndex[peerId] = AppSettings.adaptiveAudioQuality.initialProfileIndex;
        this._lastProfileSwitchTime[peerId] = 0;
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;

        // 应用初始码率
        this._applyAudioProfileToSender(peerId, AppSettings.adaptiveAudioQuality.initialProfileIndex);

        // 使用 TimerManager 添加周期性任务
        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                taskName,
                () => this._checkAndAdaptAudioQuality(peerId),
                AppSettings.adaptiveAudioQuality.interval
            );
            Utils.log(`已为 ${peerId} 启动自适应音频质量检测 (via TimerManager)，初始等级: ${AppSettings.adaptiveAudioQuality.audioQualityProfiles[AppSettings.adaptiveAudioQuality.initialProfileIndex].levelName} (isCaller: ${this.isCaller})。`, Utils.logLevels.INFO);
        } else {
            Utils.log("VideoCallManager: TimerManager 未定义，无法启动自适应音频检测。", Utils.logLevels.ERROR);
        }
    },

    /**
     * @private
     * @description 停止自适应音频质量检测。
     * @function _stopAdaptiveAudioCheck
     * @param {string} [peerId] - (可选) 如果提供，则仅清理特定对方的状态和定时器。
     */
    _stopAdaptiveAudioCheck: function(peerId) {
        if (peerId && typeof TimerManager !== 'undefined') {
            // 停止并清理指定对方的任务和状态
            const taskName = `adaptiveAudio_${peerId}`;
            TimerManager.removePeriodicTask(taskName);
            Utils.log(`已停止对 ${peerId} 的自适应音频质量检测 (via TimerManager)。`, Utils.logLevels.INFO);
            delete this._currentAudioProfileIndex[peerId];
            delete this._lastProfileSwitchTime[peerId];
            delete this._consecutiveGoodChecks[peerId];
            delete this._consecutiveBadChecks[peerId];
        } else if (!peerId && typeof TimerManager !== 'undefined') { // 如果未提供 peerId，则停止所有任务
            Utils.log(`正在停止所有自适应音频质量检测 (via TimerManager)...`, Utils.logLevels.INFO);
            for (const id in this._currentAudioProfileIndex) {
                if (this._currentAudioProfileIndex.hasOwnProperty(id)) {
                    TimerManager.removePeriodicTask(`adaptiveAudio_${id}`);
                }
            }
            this._currentAudioProfileIndex = {};
            this._lastProfileSwitchTime = {};
            this._consecutiveGoodChecks = {};
            this._consecutiveBadChecks = {};
            Utils.log(`所有自适应音频质量检测已停止并清理状态 (via TimerManager)。`, Utils.logLevels.INFO);
        }
    },

    /**
     * @private
     * @description 周期性检查网络状况并决定是否调整音频质量。
     * @function _checkAndAdaptAudioQuality
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
            // 1. 获取 WebRTC 统计数据
            const stats = await pc.getStats();
            let currentRtt = Infinity, currentPacketLoss = 1, currentJitter = Infinity;

            // 2. 从统计报告中解析出 RTT、丢包率和抖动
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

            // 3. 处理统计数据无效的情况
            if (!isFinite(currentRtt) && currentPacketLoss === 1 && !isFinite(currentJitter)) {
                Utils.log(`AdaptiveAudioCheck for ${peerId}: 未能获取有效的网络统计数据。跳过调整。`, Utils.logLevels.WARN);
                return;
            }
            if (!isFinite(currentRtt)) currentRtt = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.rtt * 3;
            if (currentPacketLoss === 1 && isFinite(stats.size)) currentPacketLoss = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.packetLoss + 0.1;
            else if (currentPacketLoss === 1) currentPacketLoss = 0.5;
            if (!isFinite(currentJitter)) currentJitter = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.jitter * 3;

            // 4. 根据网络状况决定最佳质量等级
            const currentStats = { rtt: currentRtt, packetLoss: currentPacketLoss, jitter: currentJitter };
            const currentProfileIndex = this._currentAudioProfileIndex[peerId] !== undefined
                ? this._currentAudioProfileIndex[peerId]
                : AppSettings.adaptiveAudioQuality.initialProfileIndex;

            const optimalLevelIndex = this._determineOptimalQualityLevel(peerId, currentStats);

            const currentProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[currentProfileIndex];
            const optimalProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[optimalLevelIndex];
            const currentProfileName = currentProfile ? currentProfile.levelName : `索引 ${currentProfileIndex}`;
            const optimalProfileName = optimalProfile ? optimalProfile.levelName : `索引 ${optimalLevelIndex}`;

            if (AppSettings.adaptiveAudioQuality.logStatsToConsole) {
                Utils.log(`[AudioQualityEval for ${peerId} (Caller: ${this.isCaller})]: Stats(RTT: ${currentRtt.toFixed(0)}ms, Loss: ${(currentPacketLoss*100).toFixed(2)}%, Jitter: ${currentJitter.toFixed(0)}ms) -> 当前: Lvl ${currentProfileIndex} ('${currentProfileName}'), 目标: Lvl ${optimalLevelIndex} ('${optimalProfileName}')`, Utils.logLevels.INFO);
            }

            // 5. 检查是否需要切换以及是否满足冷却时间
            const { switchToHigherCooldown, switchToLowerCooldown } = AppSettings.adaptiveAudioQuality;
            const lastSwitchTime = this._lastProfileSwitchTime[peerId] || 0;
            const now = Date.now();

            if (optimalLevelIndex !== currentProfileIndex) {
                if (optimalLevelIndex > currentProfileIndex) { // 提升质量
                    if (now - lastSwitchTime > switchToHigherCooldown) {
                        this._switchToAudioProfile(peerId, optimalLevelIndex);
                    } else {
                        Utils.log(`[AudioQualityEval for ${peerId}]: 尝试提升至 '${optimalProfileName}'，但提升冷却期未结束。`, Utils.logLevels.DEBUG);
                    }
                } else { // 降低质量
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
     * @description 根据当前网络统计数据决定最佳的音频质量等级索引。
     * @function _determineOptimalQualityLevel
     * @param {string} peerId - 对方ID。
     * @param {object} currentStats - 包含 {rtt, packetLoss, jitter} 的对象。
     * @returns {number} - 目标音质等级的索引。
     */
    _determineOptimalQualityLevel: function(peerId, currentStats) {
        const profiles = AppSettings.adaptiveAudioQuality.audioQualityProfiles;
        const currentLevelIndex = this._currentAudioProfileIndex[peerId] !== undefined
            ? this._currentAudioProfileIndex[peerId]
            : AppSettings.adaptiveAudioQuality.initialProfileIndex;

        const { baseGoodConnectionThresholds, stabilityCountForUpgrade, badQualityDowngradeThreshold } = AppSettings.adaptiveAudioQuality;
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

        // 1. 更新连续好/坏网络计数
        if (meetsBaseline) {
            this._consecutiveGoodChecks[peerId] = (this._consecutiveGoodChecks[peerId] || 0) + 1;
            this._consecutiveBadChecks[peerId] = 0;
        } else {
            this._consecutiveBadChecks[peerId] = (this._consecutiveBadChecks[peerId] || 0) + 1;
            this._consecutiveGoodChecks[peerId] = 0;
        }

        // 2. 决定是否提升质量（网络持续良好）
        if (this._consecutiveGoodChecks[peerId] >= stabilityCountForUpgrade) {
            if (isSignificantlyBetter && targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 2, profiles.length - 1); // 大幅提升
            } else if (meetsBaseline && targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 1, profiles.length - 1); // 小幅提升
            }
            if (targetLevelIndex > currentLevelIndex) {
                this._consecutiveGoodChecks[peerId] = 0; // 重置计数
            }
        }

        // 3. 决定是否降低质量（网络持续不佳）
        if (this._consecutiveBadChecks[peerId] >= badQualityDowngradeThreshold) {
            if (isVeryPoor && targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 2, 0); // 大幅降低
            } else if (isSlightlyWorse && targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 1, 0); // 小幅降低
            }
            if (targetLevelIndex < currentLevelIndex) {
                this._consecutiveBadChecks[peerId] = 0; // 重置计数
            }
        }
        return Math.max(0, Math.min(targetLevelIndex, profiles.length - 1));
    },

    /**
     * @private
     * @description 切换到指定的音频配置档案，并根据需要触发重新协商。
     * @function _switchToAudioProfile
     * @param {string} peerId - 目标对方ID。
     * @param {number} newLevelIndex - 要切换到的配置档案的索引。
     */
    _switchToAudioProfile: function(peerId, newLevelIndex) {
        if (this._currentAudioProfileIndex[peerId] === newLevelIndex && this.isCallActive) {
            Utils.log(`请求切换到与当前相同的音频配置 (${newLevelIndex}) for ${peerId}，已跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        // 1. 更新内部状态
        const oldLevelIndex = this._currentAudioProfileIndex[peerId];
        this._currentAudioProfileIndex[peerId] = newLevelIndex;
        this._lastProfileSwitchTime[peerId] = Date.now();
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;

        const newProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[newLevelIndex];
        const newSdpFmtpLine = newProfile ? newProfile.sdpFmtpLine : null;

        const oldProfileFallbackSdpLine = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus')?.sdpFmtpLine || 'minptime=10;useinbandfec=1;stereo=0';
        const oldProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[oldLevelIndex];
        const currentNegotiatedSdpLine = this._lastNegotiatedSdpFmtpLine[peerId] || (oldProfile ? oldProfile.sdpFmtpLine : oldProfileFallbackSdpLine);

        // 2. 检查是否需要通过重新协商来改变 SDP 参数
        if (this.isCallActive && newSdpFmtpLine && newSdpFmtpLine !== currentNegotiatedSdpLine) {
            if (this.isCaller) { // NOTE: 只有原始呼叫方能发起重新协商
                Utils.log(`[AudioQuality for ${peerId}]: 呼叫方需要将 sdpFmtpLine 从 '${currentNegotiatedSdpLine}' 更改为 '${newSdpFmtpLine}'。正在发起重新协商。`, Utils.logLevels.INFO);
                this._initiateRenegotiation(peerId);
            } else {
                Utils.log(`[AudioQuality for ${peerId}]: 接收方检测到需要将 sdpFmtpLine 更改为 '${newProfile.levelName}'。等待呼叫方发起协商。`, Utils.logLevels.INFO);
            }
        }

        // 3. 应用新的码率等参数
        this._applyAudioProfileToSender(peerId, newLevelIndex);

        const profileName = newProfile ? newProfile.levelName : "未知等级";
        const description = newProfile ? newProfile.description : "无描述";

        // 4. 发出事件并通知用户
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('audioProfileChanged', { peerId: peerId, profileName: profileName, profileIndex: newLevelIndex, description: description });
        }
        NotificationUIManager.showNotification(`音频质量已调整为: ${profileName}`, 'info', 1500);
        Utils.log(`音频配置已切换为 Lvl ${newLevelIndex} ('${profileName}') for ${peerId}. New sdpFmtpLine: ${newSdpFmtpLine || 'N/A'}. Current negotiated sdpFmtpLine: ${currentNegotiatedSdpLine || 'N/A'}. (isCaller: ${this.isCaller})`, Utils.logLevels.INFO);
    },

    /**
     * @private
     * @description 将指定的音频配置应用到与对方的音频发送器。
     * @function _applyAudioProfileToSender
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

        const audioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[levelIndex];
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
                // 应用最大码率
                if (audioProfile.maxAverageBitrate && parameters.encodings[0].maxBitrate !== audioProfile.maxAverageBitrate) {
                    parameters.encodings[0].maxBitrate = audioProfile.maxAverageBitrate;
                    changed = true;
                }
                // NOTE: DTX 和 FEC 主要通过 SDP (sdpFmtpLine) 在协商时处理。通过 setParameters 直接控制的标准化程度较低。

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