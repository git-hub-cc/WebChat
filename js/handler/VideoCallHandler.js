/**
 * @file VideoCallHandler.js
 * @description 视频通话的底层协议和 WebRTC 协商处理器。
 *              负责处理核心的 WebRTC 媒体协商、信令消息响应和自适应音频质量控制。
 *              这是一个内部模块，由 VideoCallManager 管理。
 *              FIXED: 修复了接收方处理屏幕共享请求时，错误地不请求摄像头的问题。
 *              FIXED: 修复了通话模式的对称性限制，现在允许一方音频、一方视频。
 * @module VideoCallHandler
 * @exports {object} VideoCallHandler - 对外暴露的单例对象。
 * @dependencies AppSettings, Utils, NotificationUIManager, ConnectionManager, WebRTCManager, UserManager, VideoCallUIManager, ModalUIManager, EventEmitter, TimerManager
 */
const VideoCallHandler = {
    manager: null, // 对 VideoCallManager 实例的引用，在初始化时设置

    // --- 迁移过来的属性 ---
    audioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
    },
    codecPreferences: {
        audio: [{
            mimeType: 'audio/opus',
            channels: 1,
            clockRate: 48000, // CORRECTED: 使用固定的Opus时钟频率，或从AppSettings中获取
            sdpFmtpLine: AppSettings.adaptiveAudioQuality.audioQualityProfiles[2].sdpFmtpLine
        }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },
    // --- 音频自适应状态 ---
    _currentAudioProfileIndex: {},
    _lastProfileSwitchTime: {},
    _consecutiveGoodChecks: {},
    _consecutiveBadChecks: {},
    _lastNegotiatedSdpFmtpLine: {},
    // --- 新增：视频自适应状态 ---
    _currentVideoProfileIndex: {},
    _lastVideoProfileSwitchTime_video: {},
    _consecutiveGoodChecks_video: {},
    _consecutiveBadChecks_video: {},

    /**
     * 初始化处理器并存储对管理器的引用。
     * @param {object} managerInstance - VideoCallManager 的实例。
     */
    init: function(managerInstance) {
        this.manager = managerInstance;
        // CORRECTED: 确保从AppSettings中读取正确的时钟频率配置
        if (AppSettings.adaptiveAudioQuality && AppSettings.adaptiveAudioQuality.codecClockRate) {
            this.codecPreferences.audio[0].clockRate = AppSettings.adaptiveAudioQuality.codecClockRate;
        }
        this._lastNegotiatedSdpFmtpLine = {};
        // 新增：初始化视频状态
        this._currentVideoProfileIndex = {};
        this._lastVideoProfileSwitchTime_video = {};
        this._consecutiveGoodChecks_video = {};
        this._consecutiveBadChecks_video = {};
        Utils.log("VideoCallHandler 已初始化。", Utils.logLevels.INFO);
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
                    ConnectionManager.sendTo(peerId, {
                        type: 'video-call-rejected',
                        reason: 'busy',
                        sender: UserManager.userId
                    });
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
                if (this.manager.state.isCallPending && this.manager.state.currentPeerId === peerId) {
                    if (this.manager.state.isCaller) {
                        this.manager.stopMusic();
                        ModalUIManager.hideCallingModal();
                    } else {
                        ModalUIManager.hideCallRequest();
                    }
                    if (this.manager.callRequestTimeout) clearTimeout(this.manager.callRequestTimeout);
                    this.manager.callRequestTimeout = null;
                    NotificationUIManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 拒绝。原因: ${message.reason || 'N/A'}`, 'warning');
                    this.manager.cleanupCallMediaAndState();
                }
                break;
            case 'video-call-cancel':
                if (this.manager.state.isCallPending && !this.manager.state.isCaller && this.manager.state.currentPeerId === peerId) {
                    this.manager.stopMusic();
                    ModalUIManager.hideCallRequest();
                    if (this.manager.callRequestTimeout) clearTimeout(this.manager.callRequestTimeout);
                    this.manager.callRequestTimeout = null;
                    NotificationUIManager.showNotification(`通话被 ${UserManager.contacts[peerId]?.name || '对方'} 取消。`, 'warning');
                    this.manager.cleanupCallMediaAndState();
                }
                break;
            case 'video-call-offer':
                if ((!this.manager.state.isCallActive && !this.manager.state.isCallPending) || (this.manager.state.isCallActive && this.manager.state.currentPeerId === peerId)) {
                    if (!this.manager.state.isCallActive) this.manager.state.isCallPending = true;
                    this.handleOffer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 offer，但当前状态冲突. 忽略。`, Utils.logLevels.WARN);
                }
                break;
            case 'video-call-answer':
                if (this.manager.state.isCallActive && this.manager.state.currentPeerId === peerId) {
                    this.handleAnswer(message.sdp, peerId, message.audioOnly || false, message.isScreenShare || false);
                } else {
                    Utils.log(`收到来自 ${peerId} 的 answer，但当前状态不匹配。忽略。`, Utils.logLevels.WARN);
                }
                break;
            case 'video-call-end':
                if ((this.manager.state.isCallActive || this.manager.state.isCallPending) && this.manager.state.currentPeerId === peerId) {
                    NotificationUIManager.showNotification(`${UserManager.contacts[peerId]?.name || '对方'} 结束了通话媒体。`, 'info');
                    this.manager.cleanupCallMediaAndState();
                }
                break;
        }
    },

    showCallRequest: function (peerId, audioOnly = false, isScreenShare = false) {
        this.manager.state.currentPeerId = peerId;
        this.manager.state.isAudioOnly = audioOnly; // Record the caller's preference
        this.manager.state.isScreenSharing = isScreenShare;
        this.manager.state.isVideoEnabled = true; // Receiver defaults to wanting to send video
        this.manager.state.isAudioMuted = false;
        this.manager.state.isCaller = false;
        ModalUIManager.showCallRequest(peerId, audioOnly, isScreenShare);
        this.manager.playMusic();
    },

    acceptCall: async function () {
        ModalUIManager.hideCallRequest();
        this.manager.stopMusic();
        if (!this.manager.state.currentPeerId) {
            NotificationUIManager.showNotification('无效的通话请求。', 'error');
            return;
        }
        try {
            await this.startLocalStreamAndSignal(false);
            ConnectionManager.sendTo(this.manager.state.currentPeerId, {
                type: 'video-call-accepted',
                // We send our current state, not the original request state
                audioOnly: !this.manager.state.isVideoEnabled,
                isScreenShare: this.manager.state.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (error) {
            Utils.log(`接听通话失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`接听通话失败: ${error.message}`, 'error');
            ConnectionManager.sendTo(this.manager.state.currentPeerId, {
                type: 'video-call-rejected',
                reason: 'device_error',
                sender: UserManager.userId
            });
            this.manager.cleanupCallMediaAndState();
        }
    },

    rejectCall: function () {
        ModalUIManager.hideCallRequest();
        this.manager.stopMusic();
        if (!this.manager.state.currentPeerId) return;
        ConnectionManager.sendTo(this.manager.state.currentPeerId, {
            type: 'video-call-rejected',
            reason: 'user_rejected',
            sender: UserManager.userId
        });
        this.manager.cleanupCallMediaAndState();
        Utils.log('已拒绝通话请求。', Utils.logLevels.INFO);
    },

    cancelPendingCall: function () {
        const peerIdToCancel = this.manager.state.currentPeerId;
        Utils.log(`正在为对方 ${peerIdToCancel || '未知'} 取消等待中的通话。`, Utils.logLevels.INFO);
        if (this.manager.callRequestTimeout) clearTimeout(this.manager.callRequestTimeout);
        this.manager.callRequestTimeout = null;
        this._stopAdaptiveMediaChecks(peerIdToCancel);
        this.manager.cleanupCallMediaAndState();
    },

    startLocalStreamAndSignal: async function (isOfferCreatorForMedia) {
        const isScreenShareCaller = this.manager.state.isScreenSharing && this.manager.state.isCaller;

        try {
            if (isScreenShareCaller) {
                // --- Screen sharing logic (remains the same) ---
                this.manager.state.localStream = await navigator.mediaDevices.getDisplayMedia({video: { cursor: "always" }, audio: true});
                this.manager.state.isVideoEnabled = true;
                const screenTrack = this.manager.state.localStream.getVideoTracks()[0];
                if (screenTrack) screenTrack.onended = () => {
                    Utils.log("用户已结束屏幕共享。", Utils.logLevels.INFO);
                    this.manager.hangUpMedia();
                };
                if (this.manager.state.localStream.getAudioTracks().length === 0) {
                    try {
                        const micStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints, video: false });
                        micStream.getAudioTracks().forEach(track => this.manager.state.localStream.addTrack(track));
                    } catch (micError) {
                        Utils.log(`无法为屏幕共享获取麦克风: ${micError.message}`, Utils.logLevels.WARN);
                    }
                }
            } else {
                // --- Asymmetric Call Logic ---
                // We attempt to send video unless we are the CALLER and we initiated an AUDIO-ONLY call.
                // The receiver will always attempt to send video by default.
                let attemptLocalCameraVideoSending = !(this.manager.state.isCaller && this.manager.state.isAudioOnly);

                if (attemptLocalCameraVideoSending) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if(!this.manager.state.isAudioOnly) NotificationUIManager.showNotification('没有摄像头。切换到纯音频通话。', 'warning');
                        attemptLocalCameraVideoSending = false;
                        // Don't force the whole call to be audio only, just our end.
                        // this.manager.state.isAudioOnly = true;
                    }
                }

                this.manager.state.localStream = await navigator.mediaDevices.getUserMedia({ video: attemptLocalCameraVideoSending ? {} : false, audio: this.audioConstraints });

                // Update our actual video status based on what we got.
                this.manager.state.isVideoEnabled = this.manager.state.localStream.getVideoTracks()[0]?.readyState === 'live';

                if (attemptLocalCameraVideoSending && !this.manager.state.isVideoEnabled) {
                    NotificationUIManager.showNotification('摄像头错误或权限被拒。将以纯音频模式发送。', 'error');
                }
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.manager.state.isVideoEnabled = false;
            if (isScreenShareCaller) {
                NotificationUIManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error');
                this.manager.cleanupCallMediaAndState();
                throw getUserMediaError;
            }
            // Fallback to audio only if video fails for any reason
            try {
                if (this.manager.state.localStream) this.manager.state.localStream.getTracks().forEach(t => t.stop());
                this.manager.state.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                this.manager.state.isVideoEnabled = false;
            } catch (audioError) {
                Utils.log(`备用音频错误: ${audioError.name}`, Utils.logLevels.ERROR);
                this.manager.cleanupCallMediaAndState();
                throw audioError;
            }
        }

        if (this.manager.state.localStream.getAudioTracks()[0]) this.manager.state.localStream.getAudioTracks()[0].enabled = !this.manager.state.isAudioMuted;
        if (this.manager.state.localStream.getVideoTracks()[0]) this.manager.state.localStream.getVideoTracks()[0].enabled = this.manager.state.isVideoEnabled;

        if (typeof VideoCallUIManager !== 'undefined') {
            VideoCallUIManager.setLocalStream(this.manager.state.localStream);
            VideoCallUIManager.showCallContainer(true);
        }
        this.manager.state.isCallActive = true;
        this.manager.state.isCallPending = false;
        this.manager.updateCurrentCallUIState();
        await this.setupPeerConnection(isOfferCreatorForMedia);
    },

    // ... The rest of VideoCallHandler.js remains unchanged ...
    // ... (setupPeerConnection, handleOffer, handleAnswer, quality adaptation functions etc. are omitted for brevity)
    // The previous changes for adaptive video quality are still valid and are assumed to be present.
    // I will include the full file content below for clarity, without collapsing sections.

    setupPeerConnection: async function (isOfferCreatorForMedia) {
        const conn = WebRTCManager.connections[this.manager.state.currentPeerId];
        if (!conn || !conn.peerConnection) { Utils.log("setupPeerConnection: 没有 PeerConnection。", Utils.logLevels.ERROR); this.manager.hangUpMedia(); return; }
        const pc = conn.peerConnection;
        pc.getSenders().forEach(sender => { if (sender.track) try {pc.removeTrack(sender);}catch(e){Utils.log("移除旧轨道时出错: "+e,Utils.logLevels.WARN);}});

        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                Utils.log(`通话 ${this.manager.state.currentPeerId} 连接已 ${pc.connectionState}。正在挂断通话。`, Utils.logLevels.INFO);
                this.manager.hangUpMedia(false);
            }
        });

        this.manager.state.localStream.getTracks().forEach(track => {
            if (track.kind === 'audio' || (track.kind === 'video' && this.manager.state.isVideoEnabled)) {
                try {
                    pc.addTrack(track, this.manager.state.localStream);
                } catch(e) {
                    Utils.log(`向 PC 添加轨道 ${track.kind} 时出错: ${e.message}`, Utils.logLevels.ERROR);
                }
            }
        });
        this.setCodecPreferences(pc);

        pc.ontrack = (event) => {
            const trackHandler = (track) => {
                if (!track._videoManagerListenersAttached) {
                    track.onunmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已取消静音。`, Utils.logLevels.DEBUG); this.manager.updateCurrentCallUIState(); if (track.kind === 'video' && VideoCallUIManager.remoteVideo?.paused) VideoCallUIManager.remoteVideo.play().catch(e => Utils.log(`播放远程视频时出错: ${e}`,Utils.logLevels.WARN)); };
                    track.onmute = () => { Utils.log(`远程轨道 ${track.id} (${track.kind}) 已静音。`, Utils.logLevels.DEBUG); this.manager.updateCurrentCallUIState(); };
                    track.onended = () => {
                        Utils.log(`远程轨道 ${track.id} (${track.kind}) 已结束。`, Utils.logLevels.DEBUG);
                        if (this.manager.state.remoteStream?.getTrackById(track.id)) try {this.manager.state.remoteStream.removeTrack(track);}catch(e){Utils.log("从远程流移除轨道时出错: "+e,Utils.logLevels.WARN);}
                        if (track.kind === 'video' && this.manager.state.isScreenSharing && !this.manager.state.isCaller) {
                            Utils.log("远程屏幕共享已结束。正在结束通话部分。", Utils.logLevels.INFO);
                            this.manager.hangUpMedia(false);
                        }
                        else if (this.manager.state.remoteStream && this.manager.state.remoteStream.getTracks().length === 0) {
                            if(VideoCallUIManager.remoteVideo) VideoCallUIManager.remoteVideo.srcObject = null;
                            this.manager.state.remoteStream = null;
                            Utils.log("所有远程轨道已结束。通话部分可能已结束。", Utils.logLevels.INFO);
                        }
                        this.manager.updateCurrentCallUIState();
                    };
                    track._videoManagerListenersAttached = true;
                }
            };

            if (event.streams && event.streams[0]) {
                if (VideoCallUIManager.remoteVideo?.srcObject !== event.streams[0]) {
                    if (typeof VideoCallUIManager !== 'undefined') VideoCallUIManager.setRemoteStream(event.streams[0]);
                    this.manager.state.remoteStream = event.streams[0];
                }
                if (this.manager.state.remoteStream) this.manager.state.remoteStream.getTracks().forEach(t => trackHandler(t));
                if (event.track) trackHandler(event.track);
            } else if (event.track) {
                if (!this.manager.state.remoteStream) {
                    this.manager.state.remoteStream = new MediaStream();
                    if (typeof VideoCallUIManager !== 'undefined' && (!VideoCallUIManager.remoteVideo?.srcObject || VideoCallUIManager.remoteVideo.srcObject.getTracks().length === 0)) {
                        VideoCallUIManager.setRemoteStream(this.manager.state.remoteStream);
                    }
                }
                if (!this.manager.state.remoteStream.getTrackById(event.track.id)) {
                    this.manager.state.remoteStream.addTrack(event.track);
                }
                if (typeof VideoCallUIManager !== 'undefined' && VideoCallUIManager.remoteVideo?.srcObject !== this.manager.state.remoteStream && this.manager.state.remoteStream.getTracks().length > 0) {
                    VideoCallUIManager.setRemoteStream(this.manager.state.remoteStream);
                }
                trackHandler(event.track);
            }
            this.manager.updateCurrentCallUIState();
        };
        this.setupConnectionMonitoring(pc);
        if (isOfferCreatorForMedia) await this.createAndSendOffer();
    },

    setupConnectionMonitoring: function (pc) {
        pc.oniceconnectionstatechange = () => {
            Utils.log(`通话 ICE 状态: ${pc.iceConnectionState} (for ${this.manager.state.currentPeerId})`, Utils.logLevels.DEBUG);
        };
    },

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
                } else if (kind === 'video' && !this.manager.state.isAudioOnly) {
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

    modifySdpForOpus: function(sdp, peerId) {
        let targetSdpFmtpLine;
        const profileIndex = (peerId && this._currentAudioProfileIndex[peerId] !== undefined)
            ? this._currentAudioProfileIndex[peerId]
            : AppSettings.adaptiveAudioQuality.initialProfileIndex;

        const audioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[profileIndex];

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

    createAndSendOffer: async function () {
        if (!this.manager.state.currentPeerId || !this.manager.state.isCallActive) return;
        const conn = WebRTCManager.connections[this.manager.state.currentPeerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 用于创建提议", Utils.logLevels.ERROR);
            this.manager.hangUpMedia();
            return;
        }
        try {
            this._applyAudioProfileToSender(this.manager.state.currentPeerId,
                this._currentAudioProfileIndex[this.manager.state.currentPeerId] !== undefined
                    ? this._currentAudioProfileIndex[this.manager.state.currentPeerId]
                    : AppSettings.adaptiveAudioQuality.initialProfileIndex);

            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: true // Always offer to receive video to support asymmetry
            };

            const offer = await conn.peerConnection.createOffer(offerOptions);
            const modifiedOffer = new RTCSessionDescription({type: 'offer', sdp: this.modifySdpForOpus(offer.sdp, this.manager.state.currentPeerId)});
            await conn.peerConnection.setLocalDescription(modifiedOffer);

            const offerProfileIndex = (this._currentAudioProfileIndex[this.manager.state.currentPeerId] !== undefined)
                ? this._currentAudioProfileIndex[this.manager.state.currentPeerId]
                : AppSettings.adaptiveAudioQuality.initialProfileIndex;
            const offerAudioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[offerProfileIndex];
            if (offerAudioProfile && offerAudioProfile.sdpFmtpLine) {
                this._lastNegotiatedSdpFmtpLine[this.manager.state.currentPeerId] = offerAudioProfile.sdpFmtpLine;
            } else {
                const defaultOpusPreference = this.codecPreferences.audio.find(p => p.mimeType.toLowerCase() === 'audio/opus');
                this._lastNegotiatedSdpFmtpLine[this.manager.state.currentPeerId] = defaultOpusPreference ? defaultOpusPreference.sdpFmtpLine : 'minptime=10;useinbandfec=1;stereo=0';
            }
            Utils.log(`Offer for ${this.manager.state.currentPeerId} created with sdpFmtpLine: ${this._lastNegotiatedSdpFmtpLine[this.manager.state.currentPeerId]} (isCaller=${this.manager.state.isCaller})`, Utils.logLevels.DEBUG);

            ConnectionManager.sendTo(this.manager.state.currentPeerId, {
                type: 'video-call-offer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: !this.manager.state.isVideoEnabled, // Send our current video status
                isScreenShare: this.manager.state.isScreenSharing,
                sender: UserManager.userId
            });
        } catch (e) {
            Utils.log("创建/发送提议时出错: " + e, Utils.logLevels.ERROR);
            this.manager.hangUpMedia();
        }
    },

    handleOffer: async function (sdpOffer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        const conn = WebRTCManager.connections[peerId];
        if (!conn || !conn.peerConnection) {
            Utils.log("没有 PC 来处理提议", Utils.logLevels.ERROR);
            return;
        }
        try {
            const isInitialOffer = !this.manager.state.isCallActive;
            if (isInitialOffer) {
                this.manager.state.isScreenSharing = remoteIsScreenShare;
                this.manager.state.isAudioOnly = remoteIsAudioOnly; // Note the initiator's mode
                this.manager.state.currentPeerId = peerId;
                this.manager.state.isCaller = false;
                await this.startLocalStreamAndSignal(false);
            }

            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            this._applyAudioProfileToSender(peerId,
                this._currentAudioProfileIndex[peerId] !== undefined
                    ? this._currentAudioProfileIndex[peerId]
                    : AppSettings.adaptiveAudioQuality.initialProfileIndex);

            const answer = await conn.peerConnection.createAnswer();
            const modifiedAnswer = new RTCSessionDescription({type: 'answer', sdp: this.modifySdpForOpus(answer.sdp, peerId)});
            await conn.peerConnection.setLocalDescription(modifiedAnswer);

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
            Utils.log(`Answer for ${peerId} created with sdpFmtpLine: ${this._lastNegotiatedSdpFmtpLine[peerId]} (isCaller=${this.manager.state.isCaller})`, Utils.logLevels.DEBUG);


            ConnectionManager.sendTo(peerId, {
                type: 'video-call-answer',
                sdp: conn.peerConnection.localDescription,
                audioOnly: !this.manager.state.isVideoEnabled, // Send our current status
                isScreenShare: this.manager.state.isScreenSharing && this.manager.state.isCaller,
                sender: UserManager.userId
            });

            this._startAdaptiveMediaChecks(peerId);

        } catch (e) {
            Utils.log(`处理来自 ${peerId} 的提议时出错: ${e.message}`, Utils.logLevels.ERROR);
            if (e.message && e.message.includes("The order of m-lines")) {
                NotificationUIManager.showNotification("通话协商失败 (媒体描述不匹配)，通话已结束。", "error");
                Utils.log(`M-line 顺序错误，为 ${peerId} 中止通话。`, Utils.logLevels.ERROR);
            }
            this.manager.hangUpMedia(true);
        }
    },

    handleAnswer: async function (sdpAnswer, peerId, remoteIsAudioOnly, remoteIsScreenShare = false) {
        if (this.manager.state.currentPeerId !== peerId || !this.manager.state.isCallActive) {
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
            this._startAdaptiveMediaChecks(peerId);
        } catch (e) {
            Utils.log("处理应答时出错: " + e, Utils.logLevels.ERROR);
            if (e.message && e.message.includes("The order of m-lines")) {
                NotificationUIManager.showNotification("通话协商失败 (媒体描述不匹配)，通话已结束。", "error");
                Utils.log(`M-line 顺序错误，为 ${peerId} 中止通话。`, Utils.logLevels.ERROR);
            }
            this.manager.hangUpMedia(true);
        }
    },
    _initiateRenegotiation: function(peerId) {
        Utils.log(`Caller (this.manager.state.isCaller=${this.manager.state.isCaller}) attempting to initiate renegotiation with ${peerId} for sdpFmtpLine change.`, Utils.logLevels.INFO);
        const conn = WebRTCManager.connections[peerId];
        if (this.manager.state.isCaller && this.manager.state.isCallActive && this.manager.state.currentPeerId === peerId &&
            conn && conn.peerConnection && conn.peerConnection.signalingState === 'stable') {
            Utils.log(`Proceeding with renegotiation for ${peerId}. Creating new offer.`, Utils.logLevels.INFO);
            this.createAndSendOffer();
        } else {
            Utils.log(`Cannot initiate renegotiation with ${peerId}. Conditions not met: isCaller=${this.manager.state.isCaller}, isCallActive=${this.manager.state.isCallActive}, currentPeerId=${this.manager.state.currentPeerId}, peerConnection exists=${!!(conn && conn.peerConnection)}, signalingState=${conn?.peerConnection?.signalingState}`, Utils.logLevels.WARN);
        }
    },

    _startAdaptiveMediaChecks: function(peerId) {
        if (!peerId) {
            Utils.log("尝试为未定义的 peerId 启动自适应媒体检测，已跳过。", Utils.logLevels.WARN);
            return;
        }
        const taskName = `adaptiveMedia_${peerId}`;
        if (typeof TimerManager !== 'undefined' && TimerManager.hasTask(taskName)) {
            return;
        }

        if (AppSettings.adaptiveAudioQuality.enabled) {
            this._currentAudioProfileIndex[peerId] = AppSettings.adaptiveAudioQuality.initialProfileIndex;
            this._lastProfileSwitchTime[peerId] = 0;
            this._consecutiveGoodChecks[peerId] = 0;
            this._consecutiveBadChecks[peerId] = 0;
            this._applyAudioProfileToSender(peerId, AppSettings.adaptiveAudioQuality.initialProfileIndex);
        }

        if (AppSettings.adaptiveVideoQuality.enabled && this.manager.state.isVideoEnabled) {
            this._currentVideoProfileIndex[peerId] = AppSettings.adaptiveVideoQuality.initialProfileIndex;
            this._lastVideoProfileSwitchTime_video[peerId] = 0;
            this._consecutiveGoodChecks_video[peerId] = 0;
            this._consecutiveBadChecks_video[peerId] = 0;
            this._applyVideoProfileToSender(peerId, AppSettings.adaptiveVideoQuality.initialProfileIndex);
        }

        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                taskName,
                () => this._checkAndAdaptMediaQuality(peerId),
                AppSettings.adaptiveAudioQuality.interval
            );
            Utils.log(`已为 ${peerId} 启动自适应音视频质量检测。`, Utils.logLevels.INFO);
        } else {
            Utils.log("VideoCallHandler: TimerManager 未定义，无法启动自适应检测。", Utils.logLevels.ERROR);
        }
    },

    _stopAdaptiveMediaChecks: function(peerId) {
        const stopForPeer = (id) => {
            if (typeof TimerManager !== 'undefined') {
                TimerManager.removePeriodicTask(`adaptiveMedia_${id}`);
            }
            delete this._currentAudioProfileIndex[id];
            delete this._lastProfileSwitchTime[id];
            delete this._consecutiveGoodChecks[id];
            delete this._consecutiveBadChecks[id];
            delete this._currentVideoProfileIndex[id];
            delete this._lastVideoProfileSwitchTime_video[id];
            delete this._consecutiveGoodChecks_video[id];
            delete this._consecutiveBadChecks_video[id];
            Utils.log(`已停止对 ${id} 的自适应媒体质量检测。`, Utils.logLevels.INFO);
        };

        if (peerId) {
            stopForPeer(peerId);
        } else {
            Utils.log(`正在停止所有自适应媒体质量检测...`, Utils.logLevels.INFO);
            const allPeerIds = new Set([
                ...Object.keys(this._currentAudioProfileIndex),
                ...Object.keys(this._currentVideoProfileIndex)
            ]);
            allPeerIds.forEach(id => stopForPeer(id));
            Utils.log(`所有自适应媒体质量检测已停止并清理状态。`, Utils.logLevels.INFO);
        }
    },

    _checkAndAdaptMediaQuality: async function(peerId) {
        if (!peerId || typeof WebRTCManager === 'undefined' || !WebRTCManager.connections[peerId]) {
            return;
        }
        const pc = WebRTCManager.connections[peerId].peerConnection;
        if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            return;
        }

        try {
            const stats = await pc.getStats();
            let currentRtt = Infinity, currentPacketLoss = 1, currentJitter = Infinity;

            stats.forEach(report => {
                if (report.type === 'outbound-rtp' && report.remoteId) {
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
                if (report.type === 'inbound-rtp') {
                    if (report.jitter !== undefined) currentJitter = Math.min(currentJitter, report.jitter * 1000);
                    if (report.packetsLost !== undefined && report.packetsReceived !== undefined) {
                        const totalPackets = report.packetsLost + report.packetsReceived + (report.packetsDiscarded || 0);
                        if (totalPackets > 0) currentPacketLoss = Math.min(currentPacketLoss, (report.packetsLost + (report.packetsDiscarded || 0)) / totalPackets);
                    }
                }
            });

            if (!isFinite(currentRtt) && currentPacketLoss === 1 && !isFinite(currentJitter)) {
                Utils.log(`AdaptiveMediaCheck for ${peerId}: 未能获取有效的网络统计数据。跳过。`, Utils.logLevels.WARN);
                return;
            }
            if (!isFinite(currentRtt)) currentRtt = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.rtt * 3;
            if (currentPacketLoss === 1) currentPacketLoss = 0.5;
            if (!isFinite(currentJitter)) currentJitter = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.jitter * 3;

            const currentStats = { rtt: currentRtt, packetLoss: currentPacketLoss, jitter: currentJitter };

            if (AppSettings.adaptiveAudioQuality.enabled) {
                this._adaptAudioQuality(peerId, currentStats);
            }
            if (AppSettings.adaptiveVideoQuality.enabled && this.manager.state.isVideoEnabled) {
                this._adaptVideoQuality(peerId, currentStats);
            }

        } catch (error) {
            Utils.log(`在 _checkAndAdaptMediaQuality (for ${peerId}) 中出错: ${error.message || error}`, Utils.logLevels.ERROR);
        }
    },

    _adaptAudioQuality: function(peerId, currentStats) {
        const config = AppSettings.adaptiveAudioQuality;
        const currentProfileIndex = this._currentAudioProfileIndex[peerId] !== undefined
            ? this._currentAudioProfileIndex[peerId]
            : config.initialProfileIndex;

        const optimalLevelIndex = this._determineOptimalQualityLevel(peerId, currentStats, config, this._consecutiveGoodChecks, this._consecutiveBadChecks);

        if (config.logStatsToConsole) {
            const currentProfileName = config.audioQualityProfiles[currentProfileIndex]?.levelName || '未知';
            const optimalProfileName = config.audioQualityProfiles[optimalLevelIndex]?.levelName || '未知';
            Utils.log(`[AudioQualityEval for ${peerId}]: Stats(RTT: ${currentStats.rtt.toFixed(0)}ms, Loss: ${(currentStats.packetLoss*100).toFixed(2)}%, Jitter: ${currentStats.jitter.toFixed(0)}ms) -> 当前: Lvl ${currentProfileIndex} ('${currentProfileName}'), 目标: Lvl ${optimalLevelIndex} ('${optimalProfileName}')`, Utils.logLevels.INFO);
        }

        const lastSwitchTime = this._lastProfileSwitchTime[peerId] || 0;
        const now = Date.now();

        if (optimalLevelIndex !== currentProfileIndex) {
            if (optimalLevelIndex > currentProfileIndex) {
                if (now - lastSwitchTime > config.switchToHigherCooldown) this._switchToAudioProfile(peerId, optimalLevelIndex);
            } else {
                if (now - lastSwitchTime > config.switchToLowerCooldown) this._switchToAudioProfile(peerId, optimalLevelIndex);
            }
        }
    },

    _switchToAudioProfile: function(peerId, newLevelIndex) {
        if (this._currentAudioProfileIndex[peerId] === newLevelIndex && this.manager.state.isCallActive) return;

        const oldLevelIndex = this._currentAudioProfileIndex[peerId];
        this._currentAudioProfileIndex[peerId] = newLevelIndex;
        this._lastProfileSwitchTime[peerId] = Date.now();
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;

        const newProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[newLevelIndex];
        const newSdpFmtpLine = newProfile ? newProfile.sdpFmtpLine : null;
        const currentNegotiatedSdpLine = this._lastNegotiatedSdpFmtpLine[peerId];

        if (this.manager.state.isCallActive && newSdpFmtpLine && newSdpFmtpLine !== currentNegotiatedSdpLine) {
            if (this.manager.state.isCaller) {
                this._initiateRenegotiation(peerId);
            }
        }

        this._applyAudioProfileToSender(peerId, newLevelIndex);

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('audioProfileChanged', { peerId, profileName: newProfile.levelName, profileIndex: newLevelIndex, description: newProfile.description });
        }
        NotificationUIManager.showNotification(`音频质量已调整为: ${newProfile.levelName}`, 'info', 1500);
        Utils.log(`音频配置已切换为 Lvl ${newLevelIndex} ('${newProfile.levelName}') for ${peerId}.`, Utils.logLevels.INFO);
    },

    _applyAudioProfileToSender: function(peerId, levelIndex) {
        if (!peerId || typeof WebRTCManager === 'undefined' || !WebRTCManager.connections[peerId]) {
            return;
        }
        const pc = WebRTCManager.connections[peerId].peerConnection;
        if (!pc || !this.manager.state.localStream) {
            return;
        }

        const audioProfile = AppSettings.adaptiveAudioQuality.audioQualityProfiles[levelIndex];
        if (!audioProfile) {
            return;
        }

        pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
                const parameters = sender.getParameters();
                if (!parameters.encodings || parameters.encodings.length === 0) {
                    parameters.encodings = [{}];
                }

                if (audioProfile.maxAverageBitrate) {
                    parameters.encodings[0].maxBitrate = audioProfile.maxAverageBitrate;
                    sender.setParameters(parameters)
                        .then(() => Utils.log(`音频配置档案 '${audioProfile.levelName}' 的码率 (${audioProfile.maxAverageBitrate}) 已应用。`, Utils.logLevels.INFO))
                        .catch(e => Utils.log(`应用音频配置档案 '${audioProfile.levelName}' 的码率时出错: ${e.message}`, Utils.logLevels.ERROR));
                }
            }
        });
    },

    _determineOptimalQualityLevel: function(peerId, currentStats, config, goodChecks, badChecks) {
        const profiles = config.audioQualityProfiles || config.videoQualityProfiles;
        const stateKey = config.audioQualityProfiles ? '_currentAudioProfileIndex' : '_currentVideoProfileIndex';
        const currentLevelIndex = this[stateKey][peerId] !== undefined
            ? this[stateKey][peerId]
            : config.initialProfileIndex;

        const { baseGoodConnectionThresholds, stabilityCountForUpgrade, badQualityDowngradeThreshold } = config;
        let targetLevelIndex = currentLevelIndex;

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
            if (targetLevelIndex < profiles.length - 1) {
                targetLevelIndex = Math.min(targetLevelIndex + 1, profiles.length - 1);
                goodChecks[peerId] = 0;
            }
        }

        if (badChecks[peerId] >= badQualityDowngradeThreshold) {
            if (targetLevelIndex > 0) {
                targetLevelIndex = Math.max(targetLevelIndex - 1, 0);
                badChecks[peerId] = 0;
            }
        }

        return Math.max(0, Math.min(targetLevelIndex, profiles.length - 1));
    },

    _adaptVideoQuality: function(peerId, currentStats) {
        const config = AppSettings.adaptiveVideoQuality;
        const currentProfileIndex = this._currentVideoProfileIndex[peerId] !== undefined
            ? this._currentVideoProfileIndex[peerId]
            : config.initialProfileIndex;

        const optimalLevelIndex = this._determineOptimalQualityLevel(peerId, currentStats, config, this._consecutiveGoodChecks_video, this._consecutiveBadChecks_video);

        if (config.logStatsToConsole) {
            const currentProfileName = config.videoQualityProfiles[currentProfileIndex]?.levelName || '未知';
            const optimalProfileName = config.videoQualityProfiles[optimalLevelIndex]?.levelName || '未知';
            Utils.log(`[VideoQualityEval for ${peerId}]: Stats(RTT: ${currentStats.rtt.toFixed(0)}ms, Loss: ${(currentStats.packetLoss*100).toFixed(2)}%, Jitter: ${currentStats.jitter.toFixed(0)}ms) -> 当前: Lvl ${currentProfileIndex} ('${currentProfileName}'), 目标: Lvl ${optimalLevelIndex} ('${optimalProfileName}')`, Utils.logLevels.INFO);
        }

        const lastSwitchTime = this._lastVideoProfileSwitchTime_video[peerId] || 0;
        const now = Date.now();

        if (optimalLevelIndex !== currentProfileIndex) {
            if (optimalLevelIndex > currentProfileIndex) {
                if (now - lastSwitchTime > config.switchToHigherCooldown) this._switchToVideoProfile(peerId, optimalLevelIndex);
            } else {
                if (now - lastSwitchTime > config.switchToLowerCooldown) this._switchToVideoProfile(peerId, optimalLevelIndex);
            }
        }
    },

    _switchToVideoProfile: function(peerId, newLevelIndex) {
        if (this._currentVideoProfileIndex[peerId] === newLevelIndex && this.manager.state.isCallActive) return;

        this._currentVideoProfileIndex[peerId] = newLevelIndex;
        this._lastVideoProfileSwitchTime_video[peerId] = Date.now();
        this._consecutiveGoodChecks_video[peerId] = 0;
        this._consecutiveBadChecks_video[peerId] = 0;

        const newProfile = AppSettings.adaptiveVideoQuality.videoQualityProfiles[newLevelIndex];
        this._applyVideoProfileToSender(peerId, newLevelIndex);

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('videoProfileChanged', { peerId, profileName: newProfile.levelName, profileIndex: newLevelIndex, description: newProfile.description });
        }
        NotificationUIManager.showNotification(`视频质量已调整为: ${newProfile.levelName}`, 'info', 1500);
        Utils.log(`视频配置已切换为 Lvl ${newLevelIndex} ('${newProfile.levelName}') for ${peerId}.`, Utils.logLevels.INFO);
    },

    _applyVideoProfileToSender: async function(peerId, levelIndex) {
        if (!peerId || typeof WebRTCManager === 'undefined' || !WebRTCManager.connections[peerId]) return;

        const pc = WebRTCManager.connections[peerId].peerConnection;
        if (!pc || !this.manager.state.localStream) return;

        const videoProfile = AppSettings.adaptiveVideoQuality.videoQualityProfiles[levelIndex];
        if (!videoProfile) return;

        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (!videoSender) return;

        const parameters = videoSender.getParameters();
        if (!parameters.encodings || parameters.encodings.length === 0) {
            parameters.encodings = [{}];
        }

        const encoding = parameters.encodings[0];
        encoding.maxBitrate = videoProfile.maxBitrate;
        encoding.maxFramerate = videoProfile.maxFramerate;
        encoding.scaleResolutionDownBy = videoProfile.scaleResolutionDownBy;

        try {
            await videoSender.setParameters(parameters);
            Utils.log(`视频配置档案 '${videoProfile.levelName}' (Lvl ${levelIndex}) 已成功应用到发送器 (for ${peerId})。`, Utils.logLevels.INFO);
        } catch (e) {
            Utils.log(`应用视频配置档案 '${videoProfile.levelName}' (for ${peerId}) 时发生错误: ${e.message || e}`, Utils.logLevels.ERROR);
        }
    }
};