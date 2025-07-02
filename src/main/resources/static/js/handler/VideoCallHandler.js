/**
 * @file VideoCallHandler.js
 * @description 视频通话的底层协议和 WebRTC 协商处理器。
 *              负责处理核心的 WebRTC 媒体协商、信令消息响应和自适应音频质量控制。
 *              这是一个内部模块，由 VideoCallManager 管理。
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
            clockRate: 48000,
            channels: 1,
            sdpFmtpLine: 'minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=24000;cbr=0;maxplaybackrate=16000;sprop-stereo=0'
        }],
        video: [{mimeType: 'video/VP9'}, {mimeType: 'video/VP8'}, {mimeType: 'video/H264'}]
    },
    _currentAudioProfileIndex: {},
    _lastProfileSwitchTime: {},
    _consecutiveGoodChecks: {},
    _consecutiveBadChecks: {},
    _lastNegotiatedSdpFmtpLine: {},

    /**
     * 初始化处理器并存储对管理器的引用。
     * @param {object} managerInstance - VideoCallManager 的实例。
     */
    init: function(managerInstance) {
        this.manager = managerInstance;
        this._lastNegotiatedSdpFmtpLine = {};
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
        this.manager.state.isAudioOnly = audioOnly;
        this.manager.state.isScreenShare = isScreenShare;
        this.manager.state.isVideoEnabled = !audioOnly;
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
            if (this.manager.state.isScreenSharing) this.manager.state.isVideoEnabled = false;

            await this.startLocalStreamAndSignal(false);
            ConnectionManager.sendTo(this.manager.state.currentPeerId, {
                type: 'video-call-accepted',
                audioOnly: this.manager.state.isAudioOnly,
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
        this._stopAdaptiveAudioCheck(peerIdToCancel);
        this.manager.cleanupCallMediaAndState();
    },

    startLocalStreamAndSignal: async function (isOfferCreatorForMedia) {
        let attemptLocalCameraVideoSending = !this.manager.state.isAudioOnly && !this.manager.state.isScreenSharing;

        try {
            if (this.manager.state.isScreenSharing && this.manager.state.isCaller) {
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
                if (attemptLocalCameraVideoSending) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    if (!devices.some(d => d.kind === 'videoinput')) {
                        if(!this.manager.state.isAudioOnly) NotificationUIManager.showNotification('没有摄像头。切换到纯音频通话。', 'warning');
                        attemptLocalCameraVideoSending = false;
                        this.manager.state.isAudioOnly = true;
                    }
                }
                this.manager.state.localStream = await navigator.mediaDevices.getUserMedia({ video: attemptLocalCameraVideoSending ? {} : false, audio: this.audioConstraints });
                this.manager.state.isVideoEnabled = attemptLocalCameraVideoSending && this.manager.state.localStream.getVideoTracks()[0]?.readyState !== 'ended';
                if (attemptLocalCameraVideoSending && !this.manager.state.isVideoEnabled && !this.manager.state.isAudioOnly) {
                    NotificationUIManager.showNotification('摄像头错误。切换到纯音频通话。', 'error');
                    this.manager.state.isAudioOnly = true;
                }
            }
        } catch (getUserMediaError) {
            Utils.log(`getUserMedia/getDisplayMedia 错误: ${getUserMediaError.name}`, Utils.logLevels.ERROR);
            this.manager.state.isVideoEnabled = false;
            if (this.manager.state.isScreenSharing && this.manager.state.isCaller) {
                NotificationUIManager.showNotification(`屏幕共享错误: ${getUserMediaError.name}。`, 'error');
                this.manager.cleanupCallMediaAndState();
                throw getUserMediaError;
            } else if (!this.manager.state.isScreenSharing && attemptLocalCameraVideoSending && !this.manager.state.isAudioOnly) {
                NotificationUIManager.showNotification(`摄像头错误: ${getUserMediaError.name}。切换到纯音频通话。`, 'error');
            }
            try {
                if (this.manager.state.localStream) this.manager.state.localStream.getTracks().forEach(t => t.stop());
                this.manager.state.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: this.audioConstraints });
                this.manager.state.isAudioOnly = true;
                this.manager.state.isVideoEnabled = false;
                if(this.manager.state.isScreenSharing) this.manager.state.isScreenSharing = false;
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
            if (track.kind === 'audio' ||
                (track.kind === 'video' && this.manager.state.isVideoEnabled && (!this.manager.state.isScreenSharing || (this.manager.state.isScreenSharing && this.manager.state.isCaller)))) {
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
                offerToReceiveVideo: !this.manager.state.isAudioOnly || (this.manager.state.isScreenSharing && this.manager.state.isCaller)
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
                audioOnly: this.manager.state.isAudioOnly,
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
                this.manager.state.isAudioOnly = remoteIsAudioOnly && !remoteIsScreenShare;
                this.manager.state.currentPeerId = peerId;
                this.manager.state.isCaller = false;
                this.manager.state.isVideoEnabled = !this.manager.state.isAudioOnly && !this.manager.state.isScreenSharing;
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
                audioOnly: this.manager.state.isAudioOnly,
                isScreenShare: this.manager.state.isScreenSharing && this.manager.state.isCaller,
                sender: UserManager.userId
            });

            this._startAdaptiveAudioCheck(peerId);

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
            this._startAdaptiveAudioCheck(peerId);
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
    _startAdaptiveAudioCheck: function(peerId) {
        if (!peerId) {
            Utils.log("尝试为未定义的 peerId 启动自适应音频检测，已跳过。", Utils.logLevels.WARN);
            return;
        }
        const taskName = `adaptiveAudio_${peerId}`;
        if (typeof TimerManager !== 'undefined' && TimerManager.hasTask(taskName)) {
            return;
        }
        this._currentAudioProfileIndex[peerId] = AppSettings.adaptiveAudioQuality.initialProfileIndex;
        this._lastProfileSwitchTime[peerId] = 0;
        this._consecutiveGoodChecks[peerId] = 0;
        this._consecutiveBadChecks[peerId] = 0;
        this._applyAudioProfileToSender(peerId, AppSettings.adaptiveAudioQuality.initialProfileIndex);
        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                taskName,
                () => this._checkAndAdaptAudioQuality(peerId),
                AppSettings.adaptiveAudioQuality.interval
            );
            Utils.log(`已为 ${peerId} 启动自适应音频质量检测 (via TimerManager)，初始等级: ${AppSettings.adaptiveAudioQuality.audioQualityProfiles[AppSettings.adaptiveAudioQuality.initialProfileIndex].levelName} (isCaller: ${this.manager.state.isCaller})。`, Utils.logLevels.INFO);
        } else {
            Utils.log("VideoCallHandler: TimerManager 未定义，无法启动自适应音频检测。", Utils.logLevels.ERROR);
        }
    },

    _stopAdaptiveAudioCheck: function(peerId) {
        if (peerId && typeof TimerManager !== 'undefined') {
            const taskName = `adaptiveAudio_${peerId}`;
            TimerManager.removePeriodicTask(taskName);
            Utils.log(`已停止对 ${peerId} 的自适应音频质量检测 (via TimerManager)。`, Utils.logLevels.INFO);
            delete this._currentAudioProfileIndex[peerId];
            delete this._lastProfileSwitchTime[peerId];
            delete this._consecutiveGoodChecks[peerId];
            delete this._consecutiveBadChecks[peerId];
        } else if (!peerId && typeof TimerManager !== 'undefined') {
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
    // ... (接上一部分的代码) ...

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
            if (!isFinite(currentRtt)) currentRtt = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.rtt * 3;
            if (currentPacketLoss === 1 && isFinite(stats.size)) currentPacketLoss = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.packetLoss + 0.1;
            else if (currentPacketLoss === 1) currentPacketLoss = 0.5;
            if (!isFinite(currentJitter)) currentJitter = AppSettings.adaptiveAudioQuality.baseGoodConnectionThresholds.jitter * 3;


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
                Utils.log(`[AudioQualityEval for ${peerId} (Caller: ${this.manager.state.isCaller})]: Stats(RTT: ${currentRtt.toFixed(0)}ms, Loss: ${(currentPacketLoss*100).toFixed(2)}%, Jitter: ${currentJitter.toFixed(0)}ms) -> 当前: Lvl ${currentProfileIndex} ('${currentProfileName}'), 目标: Lvl ${optimalLevelIndex} ('${optimalProfileName}')`, Utils.logLevels.INFO);
            }

            const { switchToHigherCooldown, switchToLowerCooldown } = AppSettings.adaptiveAudioQuality;
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

    _switchToAudioProfile: function(peerId, newLevelIndex) {
        if (this._currentAudioProfileIndex[peerId] === newLevelIndex && this.manager.state.isCallActive) {
            Utils.log(`请求切换到与当前相同的音频配置 (${newLevelIndex}) for ${peerId}，已跳过。`, Utils.logLevels.DEBUG);
            return;
        }

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

        if (this.manager.state.isCallActive && newSdpFmtpLine && newSdpFmtpLine !== currentNegotiatedSdpLine) {
            if (this.manager.state.isCaller) {
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
        Utils.log(`音频配置已切换为 Lvl ${newLevelIndex} ('${profileName}') for ${peerId}. New sdpFmtpLine: ${newSdpFmtpLine || 'N/A'}. Current negotiated sdpFmtpLine: ${currentNegotiatedSdpLine || 'N/A'}. (isCaller: ${this.manager.state.isCaller})`, Utils.logLevels.INFO);
    },

    _applyAudioProfileToSender: function(peerId, levelIndex) {
        if (!peerId || typeof WebRTCManager === 'undefined' || !WebRTCManager.connections[peerId]) {
            Utils.log(`_applyAudioProfileToSender: 对方 ${peerId || '未知'} 的连接信息不存在。跳过。`, Utils.logLevels.WARN);
            return;
        }
        const pc = WebRTCManager.connections[peerId].peerConnection;
        if (!pc || !this.manager.state.localStream) {
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
                if (audioProfile.maxAverageBitrate && parameters.encodings[0].maxBitrate !== audioProfile.maxAverageBitrate) {
                    parameters.encodings[0].maxBitrate = audioProfile.maxAverageBitrate;
                    changed = true;
                }

                if (changed) {
                    sender.setParameters(parameters)
                        .then(() => Utils.log(`音频配置档案 '${audioProfile.levelName}' (Lvl ${levelIndex}) 的码率 (${audioProfile.maxAverageBitrate}) 已成功应用到发送器 (for ${peerId})。`, Utils.logLevels.INFO))
                        .catch(e => Utils.log(`应用音频配置档案 '${audioProfile.levelName}' (for ${peerId}) 的码率时发生错误: ${e.message || e}`, Utils.logLevels.ERROR));
                } else {
                    Utils.log(`音频配置档案 '${audioProfile.levelName}' (Lvl ${levelIndex}) 无需应用码率 (for ${peerId})，参数未改变。当前码率: ${parameters.encodings[0].maxBitrate}`, Utils.logLevels.DEBUG);
                }
            }
        });
    },
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

        // 评估当前网络是否满足基准良好连接
        const meetsBaseline = currentStats.rtt <= baseGoodConnectionThresholds.rtt &&
            currentStats.packetLoss <= baseGoodConnectionThresholds.packetLoss &&
            currentStats.jitter <= baseGoodConnectionThresholds.jitter;

        // 评估当前网络是否显著优于基准
        const isSignificantlyBetter = currentStats.rtt < baseGoodConnectionThresholds.rtt * significantlyBetterFactor &&
            currentStats.packetLoss < baseGoodConnectionThresholds.packetLoss * significantlyBetterFactor &&
            currentStats.jitter < baseGoodConnectionThresholds.jitter * significantlyBetterFactor;

        // 评估当前网络是否略差于基准
        const isSlightlyWorse = currentStats.rtt > baseGoodConnectionThresholds.rtt * slightlyWorseFactor ||
            currentStats.packetLoss > baseGoodConnectionThresholds.packetLoss + 0.01 || // 丢包率增加1%
            currentStats.jitter > baseGoodConnectionThresholds.jitter * slightlyWorseFactor;

        // 评估当前网络是否非常差
        const isVeryPoor = currentStats.rtt > baseGoodConnectionThresholds.rtt * veryPoorFactor ||
            currentStats.packetLoss > baseGoodConnectionThresholds.packetLoss + 0.03 || // 丢包率增加3%
            currentStats.jitter > baseGoodConnectionThresholds.jitter * veryPoorFactor;

        // 更新连续好/坏检查的计数器
        if (meetsBaseline) {
            this._consecutiveGoodChecks[peerId] = (this._consecutiveGoodChecks[peerId] || 0) + 1;
            this._consecutiveBadChecks[peerId] = 0; // 重置坏检查计数器
        } else {
            this._consecutiveBadChecks[peerId] = (this._consecutiveBadChecks[peerId] || 0) + 1;
            this._consecutiveGoodChecks[peerId] = 0; // 重置好检查计数器
        }

        // 决策逻辑：升级
        if (this._consecutiveGoodChecks[peerId] >= stabilityCountForUpgrade) {
            if (isSignificantlyBetter && targetLevelIndex < profiles.length - 1) {
                // 网络非常好，尝试跳两级提升
                targetLevelIndex = Math.min(targetLevelIndex + 2, profiles.length - 1);
            } else if (meetsBaseline && targetLevelIndex < profiles.length - 1) {
                // 网络良好，提升一级
                targetLevelIndex = Math.min(targetLevelIndex + 1, profiles.length - 1);
            }
            // 如果决定升级，重置好检查计数器，以要求新一轮的稳定期
            if (targetLevelIndex > currentLevelIndex) {
                this._consecutiveGoodChecks[peerId] = 0;
            }
        }

        // 决策逻辑：降级
        if (this._consecutiveBadChecks[peerId] >= badQualityDowngradeThreshold) {
            if (isVeryPoor && targetLevelIndex > 0) {
                // 网络非常差，尝试跳两级降级
                targetLevelIndex = Math.max(targetLevelIndex - 2, 0);
            } else if (isSlightlyWorse && targetLevelIndex > 0) {
                // 网络略差，降级一级
                targetLevelIndex = Math.max(targetLevelIndex - 1, 0);
            }
            // 如果决定降级，重置坏检查计数器，以要求新一轮的评估
            if (targetLevelIndex < currentLevelIndex) {
                this._consecutiveBadChecks[peerId] = 0;
            }
        }

        // 确保最终的目标等级在有效范围内
        return Math.max(0, Math.min(targetLevelIndex, profiles.length - 1));
    }
};

