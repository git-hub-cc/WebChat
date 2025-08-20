/**
 * @file VideoCallHandler.js
 * @description [REFACTORED FOR SIMPLE-PEER] 视频通话的协议和媒体流处理器。
 *              负责处理通话请求、接受、拒绝等高级信令，并获取本地媒体流。
 *              它将底层的连接建立和媒体协商完全委托给 WebRTCManager(SimplePeer)。
 * @module VideoCallHandler
 * @exports {object} VideoCallHandler
 * @dependencies AppSettings, Utils, NotificationUIManager, ConnectionManager, WebRTCManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter, TimerManager
 */
const VideoCallHandler = {
    manager: null, // 对 VideoCallManager 实例的引用

    // 媒体约束和自适应质量相关的配置和状态
    audioConstraints: AppSettings.media.audioConstraints,
    _currentAudioProfileIndex: {},
    _lastProfileSwitchTime: {},
    _consecutiveGoodChecks: {},
    _consecutiveBadChecks: {},
    _lastNegotiatedSdpFmtpLine: {},
    _currentVideoProfileIndex: {},
    _lastVideoProfileSwitchTime_video: {},
    _consecutiveGoodChecks_video: {},
    _consecutiveBadChecks_video: {},

    /**
     * 初始化处理器。
     * @param {object} managerInstance - VideoCallManager 的实例。
     */
    init: function(managerInstance) {
        this.manager = managerInstance;
        Utils.log("VideoCallHandler (SimplePeer) 已初始化。", Utils.logLevels.INFO);
    },

    /**
     * 处理来自对等端的所有视频通话相关信令消息。
     * @param {object} message - 消息对象。
     * @param {string} peerId - 发送方ID。
     */
    handleMessage: function (message, peerId) {
        switch (message.type) {
            case 'video-call-request':
                if (!this.manager.state.isCallActive && !this.manager.state.isCallPending) {
                    this.manager.state.isCallPending = true;
                    this.showCallRequest(peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    ConnectionManager.sendTo(peerId, { type: 'video-call-rejected', reason: 'busy', sender: UserManager.userId });
                }
                break;
            case 'video-call-accepted':
                if (this.manager.state.isCallPending && this.manager.state.isCaller && this.manager.state.currentPeerId === peerId) {
                    this.manager.stopMusic();
                    ModalUIManager.hideCallingModal();
                    if (this.manager.callRequestTimeout) clearTimeout(this.manager.callRequestTimeout);
                    this.manager.callRequestTimeout = null;
                    this.startLocalStreamAndSignal(true);
                }
                break;
            case 'video-call-rejected':
            case 'video-call-cancel':
            case 'video-call-end':
                if ((this.manager.state.isCallActive || this.manager.state.isCallPending) && this.manager.state.currentPeerId === peerId) {
                    const reason = message.reason ||
                        (message.type === 'video-call-cancel' ? '对方取消' :
                            (message.type === 'video-call-rejected' ? '对方拒绝' : '对方挂断'));
                    NotificationUIManager.showNotification(`通话结束: ${reason}`, 'info');
                    this.manager.cleanupCallMediaAndState();
                }
                break;
        }
    },

    /**
     * [REFACTORED] 获取本地媒体流并指示 WebRTCManager 发起连接。
     * @param {boolean} isOfferCreator - 是否是发起方。
     */
    startLocalStreamAndSignal: async function (isOfferCreator) {
        const isScreenShare = this.manager.state.isScreenSharing;
        const isAudioOnly = this.manager.state.isAudioOnly;
        const peerId = this.manager.state.currentPeerId;

        let localStream = null;
        try {
            if (isScreenShare) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
                let micStream = null;
                try {
                    micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                } catch (micError) {
                    Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN);
                    NotificationUIManager.showNotification('无法获取麦克风，将继续共享但不包含您的声音。', 'warning');
                }
                const finalTracks = [...screenStream.getVideoTracks(), ...screenStream.getAudioTracks(), ...(micStream ? micStream.getAudioTracks() : [])];
                localStream = new MediaStream(finalTracks);
                const screenVideoTrack = screenStream.getVideoTracks()[0];
                if (screenVideoTrack) {
                    screenVideoTrack.onended = () => this.manager.hangUpMedia();
                }
            } else {
                let attemptVideo = !isAudioOnly;
                if (attemptVideo) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        attemptVideo = false;
                        NotificationUIManager.showNotification('未找到摄像头，切换至纯音频模式。', 'warning');
                    }
                }
                localStream = await navigator.mediaDevices.getUserMedia({ video: attemptVideo, audio: this.audioConstraints });
            }
        } catch (error) {
            Utils.log(`获取媒体流失败: ${error.name}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`获取媒体设备失败: ${error.message}`, 'error');
            this.manager.cleanupCallMediaAndState();
            if (isOfferCreator) {
                ConnectionManager.sendTo(peerId, { type: 'video-call-cancel', reason: 'media_error', sender: UserManager.userId });
            }
            return;
        }

        this.manager.state.localStream = localStream;
        VideoCallUIManager.setLocalStream(localStream);
        VideoCallUIManager.showCallContainer(true);

        this.manager.state.isCallActive = true;
        this.manager.state.isCallPending = false;
        this.manager.updateCurrentCallUIState();

        WebRTCManager.initConnection(peerId, {
            initiator: isOfferCreator,
            stream: localStream,
            isVideoCall: true,
            isAudioOnly: isAudioOnly,
            isScreenShare: isScreenShare
        });

        this._startAdaptiveMediaChecks(peerId);
    },

    acceptCall: function () {
        ModalUIManager.hideCallRequest();
        this.manager.stopMusic();
        ConnectionManager.sendTo(this.manager.state.currentPeerId, { type: 'video-call-accepted', sender: UserManager.userId });
        this.startLocalStreamAndSignal(false);
    },

    rejectCall: function () {
        ModalUIManager.hideCallRequest();
        this.manager.stopMusic();
        ConnectionManager.sendTo(this.manager.state.currentPeerId, { type: 'video-call-rejected', reason: 'user_rejected', sender: UserManager.userId });
        this.manager.cleanupCallMediaAndState();
    },

    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        this.manager.state.currentPeerId = peerId;
        this.manager.state.isAudioOnly = audioOnly;
        this.manager.state.isScreenSharing = isScreenShare;
        this.manager.state.isCaller = false;
        ModalUIManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.manager.playMusic();
    },

    cancelPendingCall: function () {
        const peerIdToCancel = this.manager.state.currentPeerId;
        if (this.manager.callRequestTimeout) clearTimeout(this.manager.callRequestTimeout);
        this.manager.callRequestTimeout = null;
        this._stopAdaptiveMediaChecks(peerIdToCancel);
        this.manager.cleanupCallMediaAndState();
    },

    _getPeerConnection: function(peerId) {
        const peerInstance = WebRTCManager.connections[peerId]?.peer;
        // simple-peer v9+ exposes the pc via a private property `_pc`. Use with caution.
        return peerInstance ? (peerInstance._pc || peerInstance.pc) : null;
    },

    _startAdaptiveMediaChecks: function(peerId) {
        if (!peerId) return;
        const taskName = `adaptiveMedia_${peerId}`;
        if (TimerManager.hasTask(taskName)) return;

        TimerManager.addPeriodicTask(
            taskName,
            () => this._checkAndAdaptMediaQuality(peerId),
            AppSettings.adaptiveAudioQuality.interval
        );
    },

    _stopAdaptiveMediaChecks: function(peerId) {
        const stopForPeer = (id) => {
            TimerManager.removePeriodicTask(`adaptiveMedia_${id}`);
            delete this._currentAudioProfileIndex[id];
            delete this._lastProfileSwitchTime[id];
            delete this._consecutiveGoodChecks[id];
            delete this._consecutiveBadChecks[id];
            delete this._currentVideoProfileIndex[id];
            delete this._lastVideoProfileSwitchTime_video[id];
            delete this._consecutiveGoodChecks_video[id];
            delete this._consecutiveBadChecks_video[id];
        };
        if(peerId) stopForPeer(peerId);
    },

    _checkAndAdaptMediaQuality: async function(peerId) {
        const pc = this._getPeerConnection(peerId);
        if (!pc || pc.connectionState !== 'connected') return;

        try {
            const stats = await pc.getStats();
            let currentRtt = Infinity, currentPacketLoss = 1, currentJitter = Infinity;

            stats.forEach(report => {
                if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
                    if (report.roundTripTime !== undefined) currentRtt = Math.min(currentRtt, report.roundTripTime * 1000);
                    if (report.jitter !== undefined) currentJitter = Math.min(currentJitter, report.jitter * 1000);
                }
                if (report.type === 'outbound-rtp' && report.kind === 'video') {
                    const sent = report.packetsSent || 0;
                    const lost = stats.get(report.remoteId)?.packetsLost || 0;
                    if (sent > 0) currentPacketLoss = Math.min(currentPacketLoss, lost / sent);
                }
            });

            if (!isFinite(currentRtt) || currentPacketLoss === 1 || !isFinite(currentJitter)) {
                return;
            }

            const currentStats = { rtt: currentRtt, packetLoss: currentPacketLoss, jitter: currentJitter };

            if (AppSettings.adaptiveAudioQuality.enabled) {
                this._adaptAudioQuality(peerId, currentStats);
            }
            if (AppSettings.adaptiveVideoQuality.enabled) {
                this._adaptVideoQuality(peerId, currentStats);
            }
        } catch (error) {
            Utils.log(`自适应质量检查失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    _adaptAudioQuality: function(peerId, currentStats) {
        const config = AppSettings.adaptiveAudioQuality;
        const optimalLevelIndex = this._determineOptimalQualityLevel(peerId, currentStats, config, this._consecutiveGoodChecks, this._consecutiveBadChecks, '_currentAudioProfileIndex');
        const currentProfileIndex = this._currentAudioProfileIndex[peerId] ?? config.initialProfileIndex;

        if (optimalLevelIndex !== currentProfileIndex) {
            const now = Date.now();
            const cooldown = optimalLevelIndex > currentProfileIndex ? config.switchToHigherCooldown : config.switchToLowerCooldown;
            if (now - (this._lastProfileSwitchTime[peerId] || 0) > cooldown) {
                this._switchToAudioProfile(peerId, optimalLevelIndex);
            }
        }
    },

    _switchToAudioProfile: function(peerId, newLevelIndex) {
        this._currentAudioProfileIndex[peerId] = newLevelIndex;
        this._lastProfileSwitchTime[peerId] = Date.now();
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;
        this._applyAudioProfileToSender(peerId, newLevelIndex);

        const newProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[newLevelIndex];
        NotificationUIManager.showNotification(`音频质量已调整为: ${newProfile.levelName}`, 'info', 1500);
    },

    _applyAudioProfileToSender: function(peerId, levelIndex) {
        const pc = this._getPeerConnection(peerId);
        if (!pc) return;
        const audioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[levelIndex];
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (audioSender && audioProfile) {
            const params = audioSender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = audioProfile.maxAverageBitrate;
            audioSender.setParameters(params).catch(e => Utils.log(`应用音频码率失败: ${e}`, Utils.logLevels.ERROR));
        }
    },

    _determineOptimalQualityLevel: function(peerId, currentStats, config, goodChecks, badChecks, stateKey) {
        const { baseGoodConnectionThresholds, stabilityCountForUpgrade, badQualityDowngradeThreshold, videoQualityProfiles, audioQualityProfiles } = config;
        const profiles = audioQualityProfiles || videoQualityProfiles;
        let targetLevelIndex = this[stateKey][peerId] ?? config.initialProfileIndex;

        const meetsBaseline = currentStats.rtt <= baseGoodConnectionThresholds.rtt &&
            currentStats.packetLoss <= baseGoodConnectionThresholds.packetLoss &&
            currentStats.jitter <= baseGoodConnectionThresholds.jitter;

        if (meetsBaseline) {
            goodChecks[peerId] = (goodChecks[peerId] || 0) + 1;
            badChecks[peerId] = 0;
        } else {
            badChecks[peerId] = (badChecks[peerId] || 0) + 1;
            goodChecks[peerId] = 0;
        }

        if (goodChecks[peerId] >= stabilityCountForUpgrade) {
            targetLevelIndex = Math.min(targetLevelIndex + 1, profiles.length - 1);
            goodChecks[peerId] = 0;
        }

        if (badChecks[peerId] >= badQualityDowngradeThreshold) {
            targetLevelIndex = Math.max(targetLevelIndex - 1, 0);
            badChecks[peerId] = 0;
        }
        return targetLevelIndex;
    },

    _adaptVideoQuality: function(peerId, currentStats) {
        const config = AppSettings.adaptiveVideoQuality;
        const optimalLevelIndex = this._determineOptimalQualityLevel(peerId, currentStats, config, this._consecutiveGoodChecks_video, this._consecutiveBadChecks_video, '_currentVideoProfileIndex');
        const currentProfileIndex = this._currentVideoProfileIndex[peerId] ?? config.initialProfileIndex;

        if (optimalLevelIndex !== currentProfileIndex) {
            const now = Date.now();
            const cooldown = optimalLevelIndex > currentProfileIndex ? config.switchToHigherCooldown : config.switchToLowerCooldown;
            if (now - (this._lastVideoProfileSwitchTime_video[peerId] || 0) > cooldown) {
                this._switchToVideoProfile(peerId, optimalLevelIndex);
            }
        }
    },

    _switchToVideoProfile: function(peerId, newLevelIndex) {
        this._currentVideoProfileIndex[peerId] = newLevelIndex;
        this._lastVideoProfileSwitchTime_video[peerId] = Date.now();
        this._consecutiveGoodChecks_video[peerId] = 0;
        this._consecutiveBadChecks_video[peerId] = 0;
        this._applyVideoProfileToSender(peerId, newLevelIndex);

        const newProfile = AppSettings.adaptiveVideoQuality.videoQualityProfiles[newLevelIndex];
        NotificationUIManager.showNotification(`视频质量已调整为: ${newProfile.levelName}`, 'info', 1500);
    },

    _applyVideoProfileToSender: async function(peerId, levelIndex) {
        const pc = this._getPeerConnection(peerId);
        if (!pc) return;
        const videoProfile = AppSettings.adaptiveVideoQuality.videoQualityProfiles[levelIndex];
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender && videoProfile) {
            const params = videoSender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            Object.assign(params.encodings[0], {
                maxBitrate: videoProfile.maxBitrate,
                maxFramerate: videoProfile.maxFramerate,
                scaleResolutionDownBy: videoProfile.scaleResolutionDownBy
            });
            await videoSender.setParameters(params).catch(e => Utils.log(`应用视频参数失败: ${e}`, Utils.logLevels.ERROR));
        }
    }
};