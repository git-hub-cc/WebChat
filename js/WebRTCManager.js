
/**
 * @file WebRTCManager.js
 * @description 管理 WebRTC RTCPeerConnection 的生命周期和协商过程。
 *              负责创建 Offer/Answer, 处理 ICE 候选者, 管理连接状态, 和数据通道的初始创建。
 *              FIX: 修复了 handleRemoteOffer 逻辑，使其能正确处理重新协商，而不是销毁重建连接。
 *              新增了对 "glare" (冲突) 情况的基本处理。
 * @module WebRTCManager
 * @exports {object} WebRTCManager
 */
const WebRTCManager = {
    connections: {}, // { peerId: { peerConnection, dataChannel, isVideoCall, wasInitiatedSilently, ... } }
    iceCandidates: {}, // { peerId: [candidateObject, ...] }
    connectionTimeouts: {}, // { peerId: timeoutId } for reconnect attempts
    reconnectAttempts: {}, // { peerId: number }
    iceTimers: {}, // { peerId: timeoutId } for ICE gathering
    iceGatheringStartTimes: {}, // { peerId: timestamp }
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_', // 与 ConnectionManager 保持一致

    _signalingSender: null, // 用于发送信令消息的回调
    _onDataChannelReadyHandler: null, // 数据通道就绪时的回调

    /**
     * 初始化 WebRTCManager。
     * @param {function} signalingSender - 发送信令消息的回调。
     * @param {function} onDataChannelReady - 数据通道就绪时的回调。
     */
    init: function(signalingSender, onDataChannelReady) {
        this._signalingSender = signalingSender;
        this._onDataChannelReadyHandler = onDataChannelReady;
        Utils.log("WebRTCManager 初始化。", Utils.logLevels.INFO);
    },

    /**
     * 初始化或重新初始化与指定对等端的 RTCPeerConnection。
     * @param {string} peerId - 对方的 ID。
     * @param {boolean} [isVideoCall=false] - 是否为视频通话连接。
     * @returns {RTCPeerConnection|null} - 新创建的或 null。
     */
    initConnection: function (peerId, isVideoCall = false) {
        Utils.log(`WebRTCManager: 尝试初始化与 ${peerId} 的连接。视频通话: ${isVideoCall}`, Utils.logLevels.DEBUG);
        const existingConnDetails = this.connections[peerId];
        if (existingConnDetails && existingConnDetails.peerConnection) {
            const pc = existingConnDetails.peerConnection;
            const pcSignalingState = pc.signalingState;
            if (pcSignalingState === 'have-local-offer' || pcSignalingState === 'have-remote-offer') {
                Utils.log(`WebRTCManager: initConnection: 与 ${peerId} 的连接正在协商中 (信令状态: ${pcSignalingState})。正在复用。`, Utils.logLevels.WARN);
                existingConnDetails.isVideoCall = isVideoCall;
                if (!isVideoCall && !pc.ondatachannel && typeof this._onDataChannelReadyHandler === 'function') {
                    pc.ondatachannel = (e) => this._onDataChannelReadyHandler(e.channel, peerId, false);
                }
                return pc;
            }
            Utils.log(`WebRTCManager: initConnection: 存在 ${peerId} 的 PC (信令状态: ${pcSignalingState}, 连接状态: ${pc.connectionState})。正在关闭并重新初始化。`, Utils.logLevels.INFO);
            this.closeConnection(peerId, false);
        }
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID && this.connections[this.MANUAL_PLACEHOLDER_PEER_ID]) {
            Utils.log(`WebRTCManager: 在新的手动初始化之前，明确关闭 ${this.MANUAL_PLACEHOLDER_PEER_ID} 的现有 PC。`, Utils.logLevels.WARN);
            this.closeConnection(this.MANUAL_PLACEHOLDER_PEER_ID, false);
        }
        delete this.connections[peerId];
        delete this.iceCandidates[peerId];
        delete this.reconnectAttempts[peerId];
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
        delete this.iceTimers[peerId];
        delete this.iceGatheringStartTimes[peerId];
        Utils.log(`WebRTCManager: 为 ${peerId} 初始化新的 RTCPeerConnection。视频通话: ${isVideoCall}`, Utils.logLevels.INFO);
        try {
            const rtcConfig = AppSettings.peerConnectionConfig;
            Utils.log(`WebRTCManager: 使用配置为 ${peerId} 初始化 RTCPeerConnection: ${JSON.stringify(rtcConfig)}`, Utils.logLevels.DEBUG);
            const newPc = new RTCPeerConnection(rtcConfig);

            this.connections[peerId] = {
                peerConnection: newPc,
                dataChannel: null, // Will be populated by DataChannelHandler or ConnectionManager
                isVideoCall: isVideoCall,
                isAudioOnly: false,
                isScreenShare: false,
                wasInitiatedSilently: false
            };
            this.iceCandidates[peerId] = [];
            this.reconnectAttempts[peerId] = 0;

            newPc.onicecandidate = (e) => this.handleLocalIceCandidate(e, peerId);
            newPc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            newPc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            newPc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);

            if (!isVideoCall && typeof this._onDataChannelReadyHandler === 'function') {
                newPc.ondatachannel = (e) => {
                    const isPlaceholderOrigin = peerId === this.MANUAL_PLACEHOLDER_PEER_ID;
                    this._onDataChannelReadyHandler(e.channel, peerId, isPlaceholderOrigin);
                };
            }
            return newPc;
        } catch (error) {
            Utils.log(`WebRTCManager: 严重错误: 初始化 ${peerId} 的 PC 失败: ${error.message}\n堆栈: ${error.stack}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`为 ${peerId} 设置连接时出错: ${error.message}`, 'error');
            delete this.connections[peerId];
            return null;
        }
    },

    /**
     * 创建一个 WebRTC 提议 (offer)。
     * @param {string} targetPeerId - 目标对方的 ID。
     * @param {object} [options={}] - 连接选项。
     * @returns {Promise<void>}
     */
    createOffer: async function (targetPeerId, options = {}) {
        const {isVideoCall = false, isAudioOnly = false, isScreenShare = false, isSilent = false, isManual = false} = options;
        Utils.log(`WebRTCManager: 正在为 ${targetPeerId} 创建提议，视频: ${isVideoCall}, 纯音频: ${isAudioOnly}, 屏幕共享: ${isScreenShare}, 手动: ${isManual}`, Utils.logLevels.DEBUG);

        let pc = this.connections[targetPeerId]?.peerConnection;
        if (!pc || pc.signalingState === 'closed' || pc.signalingState === 'failed') {
            pc = this.initConnection(targetPeerId, isVideoCall);
        }

        if (!pc) {
            if (!isSilent || isManual) NotificationUIManager.showNotification("初始化连接以创建提议失败。", "error");
            Utils.log(`WebRTCManager: createOffer: initConnection 为 ${targetPeerId} 返回 null。正在中止。`, Utils.logLevels.ERROR);
            return;
        }

        if (pc.signalingState === 'have-local-offer') {
            if (!isSilent) NotificationUIManager.showNotification(`已向 ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0, 6)} 发送过提议。`, "info");
            return;
        }
        if (pc.signalingState === 'have-remote-offer') {
            // Glare condition. Let's decide who backs off. Simple rule: higher ID proceeds.
            if (UserManager.userId > targetPeerId) {
                Utils.log(`WebRTCManager: Glare detected with ${targetPeerId}. We are proceeding with our offer.`, Utils.logLevels.WARN);
            } else {
                Utils.log(`WebRTCManager: Glare detected with ${targetPeerId}. We are polite and will handle their offer instead. Aborting our offer.`, Utils.logLevels.WARN);
                // The incoming offer will be handled by handleRemoteOffer.
                return;
            }
        }

        const connEntry = this.connections[targetPeerId];
        if (connEntry) { /* ... connEntry update logic remains the same ... */
            connEntry.isVideoCall = isVideoCall;
            connEntry.isAudioOnly = isAudioOnly;
            connEntry.isScreenShare = isScreenShare;
            connEntry.wasInitiatedSilently = isSilent && !isManual;
        }

        if (pc.signalingState === 'stable' || pc.signalingState === 'new') {
            if (!isVideoCall) {
                if (connEntry && (!connEntry.dataChannel || connEntry.dataChannel.readyState === 'closed')) {
                    const dataChannel = pc.createDataChannel('chatChannel', {reliable: true});
                    if (typeof this._onDataChannelReadyHandler === 'function') {
                        this._onDataChannelReadyHandler(dataChannel, targetPeerId, targetPeerId === this.MANUAL_PLACEHOLDER_PEER_ID);
                    }
                }
            } else {
                if (VideoCallManager.localStream) {
                    pc.getSenders().forEach(sender => { if (sender.track) try { pc.removeTrack(sender); } catch (e) { Utils.log(`WebRTCManager: 移除旧轨道时出错: ${e}`, Utils.logLevels.WARN); }});
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if ((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                } else {
                    Utils.log("WebRTCManager: 视频通话提议时本地流不可用。", Utils.logLevels.WARN);
                }
            }
        }

        try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: isVideoCall && !isAudioOnly });
            await pc.setLocalDescription(offer);
            Utils.log(`WebRTCManager: 为 ${targetPeerId} 创建提议成功。状态: ${pc.signalingState}。(手动: ${isManual})`, Utils.logLevels.INFO);
            if (!pc.localDescription) {
                if (!isSilent || isManual) NotificationUIManager.showNotification("错误: 无法确定本地详情。", "error");
                this.closeConnection(targetPeerId);
                return;
            }

            const sdpPayload = {
                sdp: pc.localDescription.sdp,
                sdpType: pc.localDescription.type,
                isVideoCall, isAudioOnly, isScreenShare
            };

            if (isManual) {
                this.waitForIceGatheringComplete(targetPeerId, () => {
                    if (typeof this._signalingSender === 'function') {
                        this._signalingSender('manual_offer_ready', targetPeerId, sdpPayload, this.iceCandidates[targetPeerId] || []);
                    }
                    NotificationUIManager.showNotification("提议已创建。请复制信息并发送。", "info");
                });
            } else {
                if (!isSilent && ChatManager.currentChatId === targetPeerId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.updateChatHeaderStatus(`正在连接到 ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0, 8)}...`);
                }
                if (typeof this._signalingSender === 'function') {
                    this._signalingSender('OFFER', targetPeerId, sdpPayload, null, isSilent);
                }
            }
        } catch (error) {
            Utils.log(`WebRTCManager: 为 ${targetPeerId} 创建提议时发生 WebRTC 错误: ${error.message}\n堆栈: ${error.stack}`, Utils.logLevels.ERROR);
            if (!isSilent || isManual) NotificationUIManager.showNotification(`连接提议错误: ${error.message}`, 'error');
            this.closeConnection(targetPeerId);
        }
    },

    /**
     * MODIFIED: 处理远程提议 (offer)，能正确处理重新协商。
     * @param {string} fromUserId - 发送方的 ID。
     * @param {string} sdpString - SDP 字符串。
     * @param {RTCIceCandidateInit[]} [candidates] - 对方的 ICE 候选者 (可选)。
     * @param {boolean} isVideoCall - 是否为视频通话。
     * @param {boolean} isAudioOnly - 是否为纯音频通话。
     * @param {boolean} isScreenShare - 是否为屏幕共享。
     * @param {string} sdpType - SDP 类型 (应为 'offer')。
     * @param {boolean} [isManualFlow=false] - 是否为手动流程。
     * @returns {Promise<void>}
     */
    handleRemoteOffer: async function (fromUserId, sdpString, candidates, isVideoCall, isAudioOnly, isScreenShare, sdpType, isManualFlow = false) {
        let pc = this.connections[fromUserId]?.peerConnection;
        let isReNegotiation = false;

        // --- FIX START: Logic to handle re-negotiation without destroying the connection ---
        if (pc && pc.signalingState !== 'closed' && pc.signalingState !== 'failed') {
            // Connection exists, check signaling state
            if (pc.signalingState === 'have-local-offer') {
                // Glare condition
                if (UserManager.userId > fromUserId) {
                    Utils.log(`WebRTCManager: Glare detected with ${fromUserId}. We are impolite and will ignore their offer.`, Utils.logLevels.WARN);
                    return; // Ignore their offer, let them handle ours
                }
                // We are the "polite" peer, we will handle their offer.
                // We must first rollback our local offer.
                Utils.log(`WebRTCManager: Glare detected with ${fromUserId}. We are polite and will handle their offer. Rolling back local offer.`, Utils.logLevels.WARN);
                await pc.setLocalDescription({ type: 'rollback' });
                isReNegotiation = true;
            } else if (pc.signalingState === 'stable') {
                isReNegotiation = true;
                Utils.log(`WebRTCManager: 收到来自 ${fromUserId} 的重新协商 offer。`, Utils.logLevels.INFO);
            }
        } else {
            // No existing or usable connection, create a new one
            pc = this.initConnection(fromUserId, isVideoCall);
        }
        if (!pc) {
            NotificationUIManager.showNotification("初始化连接以处理提议失败。", "error");
            return;
        }

        const connEntry = this.connections[fromUserId];
        if (connEntry) {
            // Update connection flags
            connEntry.wasInitiatedSilently = isReNegotiation ? connEntry.wasInitiatedSilently : (connEntry.wasInitiatedSilently && !isManualFlow);
            connEntry.isVideoCall = isVideoCall;
            connEntry.isAudioOnly = isAudioOnly;
            connEntry.isScreenShare = isScreenShare;
        }

        try {
            if (typeof sdpString !== 'string' || sdpType !== 'offer') {
                Utils.log(`WebRTCManager: handleRemoteOffer - 无效的SDP字符串或类型 for ${fromUserId}. SDP类型: ${sdpType}`, Utils.logLevels.ERROR);
                this.closeConnection(fromUserId);
                return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription({type: 'offer', sdp: sdpString}));

            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object' && pc.remoteDescription && pc.signalingState !== 'closed') {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`WebRTCManager: 为 ${fromUserId} 添加来自提议的远程 ICE 时出错: ${e}`, Utils.logLevels.WARN));
                    }
                }
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (!pc.localDescription) {
                Utils.log(`WebRTCManager: handleRemoteOffer - setLocalDescription (answer) 失败 for ${fromUserId}.`, Utils.logLevels.ERROR);
                this.closeConnection(fromUserId);
                return;
            }

            const sdpPayload = {
                sdp: pc.localDescription.sdp,
                sdpType: pc.localDescription.type,
                isVideoCall: connEntry?.isVideoCall || false,
                isAudioOnly: connEntry?.isAudioOnly || false,
                isScreenShare: connEntry?.isScreenShare || false
            };

            if (isManualFlow) {
                this.waitForIceGatheringComplete(fromUserId, () => {
                    if (typeof this._signalingSender === 'function') {
                        this._signalingSender('manual_answer_ready', fromUserId, sdpPayload, this.iceCandidates[fromUserId] || []);
                    }
                    NotificationUIManager.showNotification("应答已创建。请复制信息并发送。", "info");
                });
            } else {
                if (typeof this._signalingSender === 'function') {
                    this._signalingSender('ANSWER', fromUserId, sdpPayload, null, false);
                }
            }
        } catch (error) {
            Utils.log(`WebRTCManager: 处理来自 ${fromUserId} 的远程提议失败: ${error.message}\n堆栈: ${error.stack}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`处理提议时出错: ${error.message}`, 'error');
            VideoCallManager.hangUpMedia(false);
            this.closeConnection(fromUserId);
        }
    },

    /**
     * 处理远程应答 (answer)。
     * @param {string} fromUserId - 发送方的 ID。
     * @param {string} sdpString - SDP 字符串。
     * @param {RTCIceCandidateInit[]} [candidates] - 对方的 ICE 候选者 (可选)。
     * @param {boolean} isVideoCallFlag - 是否为视频通话。 (用于日志和状态确认)
     * @param {boolean} isAudioOnlyFlag - 是否为纯音频通话。
     * @param {boolean} isScreenShareFlag - 是否为屏幕共享。
     * @param {string} sdpType - SDP 类型 (应为 'answer')。
     * @returns {Promise<void>}
     */
    handleRemoteAnswer: async function (fromUserId, sdpString, candidates, isVideoCallFlag, isAudioOnlyFlag, isScreenShareFlag, sdpType) {
        const conn = this.connections[fromUserId];
        if (!conn?.peerConnection) {
            Utils.log(`WebRTCManager: handleRemoteAnswer: 没有 ${fromUserId} 的活动连接。`, Utils.logLevels.WARN);
            return;
        }
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;

        if (sdpType !== 'answer') {
            if (!wasSilentContext) NotificationUIManager.showNotification(`协议错误: 应为 answer 类型的 SDP。`, 'error');
            Utils.log(`WebRTCManager: handleRemoteAnswer - 收到非 answer 类型的 SDP for ${fromUserId}. 类型: ${sdpType}`, Utils.logLevels.ERROR);
            this.closeConnection(fromUserId);
            return;
        }
        if (pc.signalingState !== 'have-local-offer') {
            if (!wasSilentContext) {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) {
                    Utils.log(`WebRTCManager: 与 ${fromUserId} 的连接已稳定。应答可能延迟到达。`, Utils.logLevels.INFO);
                } else {
                    NotificationUIManager.showNotification(`处理 ${fromUserId} 的应答时连接状态错误。状态: ${pc.signalingState}。`, 'error');
                }
            }
            return;
        }
        try {
            if (typeof sdpString !== 'string') {
                Utils.log(`WebRTCManager: handleRemoteAnswer - 无效的 SDP 字符串 for ${fromUserId}.`, Utils.logLevels.ERROR);
                this.closeConnection(fromUserId);
                return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription({type: 'answer', sdp: sdpString}));
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object' && pc.remoteDescription && pc.signalingState !== 'closed') {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`WebRTCManager: 为 ${fromUserId} 添加来自应答的远程 ICE 时出错: ${e}`, Utils.logLevels.WARN));
                    }
                }
            }
        } catch (error) {
            Utils.log(`WebRTCManager: 为 ${fromUserId} 设置远程应答/ICE 失败: ${error.message} (状态: ${pc.signalingState})`, Utils.logLevels.ERROR);
            if (!wasSilentContext) NotificationUIManager.showNotification(`处理应答时出错: ${error.message}`, 'error');
            this.closeConnection(fromUserId);
        }
    },

    addRemoteIceCandidate: async function (fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        if (conn?.peerConnection?.remoteDescription && conn.peerConnection.signalingState !== 'closed') {
            try {
                if (candidate && typeof candidate === 'object' && (candidate.candidate || candidate.sdpMid || candidate.sdpMLineIndex !== undefined)) {
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (error) {
                Utils.log(`WebRTCManager: 添加来自 ${fromUserId} 的远程 ICE 时出错 (状态: ${conn.peerConnection.signalingState}): ${error}`, Utils.logLevels.WARN);
            }
        }
    },

    handleLocalIceCandidate: function (event, peerId) {
        if (event.candidate) {
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate.toJSON());
            const connData = this.connections[peerId];
            const isManualContext = peerId === this.MANUAL_PLACEHOLDER_PEER_ID;
            if (!isManualContext && typeof this._signalingSender === 'function') {
                const sendSilently = connData?.wasInitiatedSilently || false;
                this._signalingSender('ICE_CANDIDATE', peerId, event.candidate.toJSON(), null, sendSilently);
            }
        }
    },

    waitForIceGatheringComplete: function (peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) {
            if (typeof callback === 'function') callback();
            return;
        }
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
        delete this.iceTimers[peerId];
        if (pc.iceGatheringState === 'complete') {
            if (typeof callback === 'function') callback();
        } else {
            this.iceGatheringStartTimes[peerId] = Date.now();
            let checkInterval;
            const onDone = () => {
                if (checkInterval) clearInterval(checkInterval);
                checkInterval = null;
                const timerExists = !!this.iceTimers[peerId];
                if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
                delete this.iceTimers[peerId];
                if (typeof callback === 'function' && timerExists) callback();
            };
            this.iceTimers[peerId] = setTimeout(() => {
                Utils.log(`WebRTCManager: 为 ${peerId} 的 ICE 收集超时。继续执行。状态: ${pc.iceGatheringState}`, Utils.logLevels.WARN);
                onDone();
            }, AppSettings.timeouts.iceGathering);
            checkInterval = setInterval(() => {
                if (!this.connections[peerId]?.peerConnection) {
                    if (checkInterval) clearInterval(checkInterval);
                    if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                    return;
                }
                if (this.connections[peerId].peerConnection.iceGatheringState === 'complete') {
                    onDone();
                }
            }, 200);
        }
    },

    handleIceConnectionStateChange: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`WebRTCManager: ICE 连接状态 for ${peerId} 变为: ${pc.iceConnectionState}`, Utils.logLevels.DEBUG);
        switch (pc.iceConnectionState) {
            case 'connected': case 'completed':
                if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
                break;
            case 'disconnected':
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) this.attemptReconnect(peerId);
                break;
            case 'failed':
                if (!wasSilentContext) NotificationUIManager.showNotification(`与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)} 的连接失败。`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.closeConnection(peerId, false);
                break;
            case 'closed':
                if (this.connections[peerId]) this.closeConnection(peerId, false);
                break;
        }
    },

    handleRtcConnectionStateChange: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`WebRTCManager: RTC 连接状态 for ${peerId} 变为: ${pc.connectionState}`, Utils.logLevels.DEBUG);
        switch (pc.connectionState) {
            case "connected":
                if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
                if ((conn.isVideoCall || (conn.dataChannel?.readyState === 'open')) && !conn._emittedEstablished) {
                    EventEmitter.emit('connectionEstablished', peerId);
                    conn._emittedEstablished = true;
                }
                break;
            case "disconnected":
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) this.attemptReconnect(peerId);
                if (conn) conn._emittedEstablished = false;
                break;
            case "failed":
                if (!wasSilentContext) NotificationUIManager.showNotification(`与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)} 的连接严重失败。`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.closeConnection(peerId, false);
                if (conn) conn._emittedEstablished = false;
                break;
            case "closed":
                if(conn) conn._emittedEstablished = false;
                if (this.connections[peerId]) {
                    Utils.log(`WebRTCManager: handleRtcConnectionStateChange - ${peerId} is 'closed', ensuring local state cleanup if not already done.`, Utils.logLevels.DEBUG);
                }
                break;
        }
    },

    attemptReconnect: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn || conn.isVideoCall || this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') return;
        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        if (this.reconnectAttempts[peerId] <= AppSettings.reconnect.maxAttempts) {
            const delay = AppSettings.reconnect.delay * Math.pow(AppSettings.reconnect.backoffFactor, this.reconnectAttempts[peerId] - 1);
            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);
            this.connectionTimeouts[peerId] = setTimeout(async () => {
                delete this.connectionTimeouts[peerId];
                const currentConn = this.connections[peerId];
                if (currentConn && !this.isConnectedTo(peerId) && currentConn.peerConnection &&
                    currentConn.peerConnection.connectionState !== 'connecting' &&
                    currentConn.peerConnection.signalingState !== 'have-local-offer' &&
                    currentConn.peerConnection.signalingState !== 'have-remote-offer') {
                    if (['failed', 'closed', 'disconnected'].includes(currentConn.peerConnection.connectionState)) {
                        this.closeConnection(peerId, false); // 先关闭旧的
                    }
                    await this.createOffer(peerId, {isSilent: true});
                } else if (this.isConnectedTo(peerId)) {
                    if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0;
                }
            }, delay);
        } else {
            this.closeConnection(peerId, false);
        }
    },

    isConnectedTo: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return false;
        const pcOverallState = conn.peerConnection.connectionState;
        if (pcOverallState === 'connected') {
            if (conn.isVideoCall || (conn.dataChannel && conn.dataChannel.readyState === 'open')) return true;
        }
        return false;
    },

    closeConnection: function (peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn) {
            Utils.log(`WebRTCManager: 正在关闭与 ${peerId} 的连接。`, Utils.logLevels.INFO);
            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);
            delete this.connectionTimeouts[peerId];
            if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
            delete this.iceTimers[peerId];
            if (conn.dataChannel) {
                try {
                    if (conn.dataChannel.onopen) conn.dataChannel.onopen = null;
                    if (conn.dataChannel.onmessage) conn.dataChannel.onmessage = null;
                    if (conn.dataChannel.onerror) conn.dataChannel.onerror = null;
                    const originalOnClose = conn.dataChannel.onclose;
                    conn.dataChannel.onclose = () => {
                        Utils.log(`WebRTCManager: DataChannel for ${peerId} explicitly closed as part of PC cleanup.`, Utils.logLevels.DEBUG);
                        if (typeof originalOnClose === 'function') originalOnClose();
                    };
                    if (conn.dataChannel.readyState !== 'closed') conn.dataChannel.close();
                } catch (e) { /* 忽略 */ }
                conn.dataChannel = null;
            }
            if (conn.peerConnection) {
                try {
                    conn.peerConnection.onicecandidate = null;
                    conn.peerConnection.onicegatheringstatechange = null;
                    conn.peerConnection.oniceconnectionstatechange = null;
                    conn.peerConnection.onconnectionstatechange = null;
                    conn.peerConnection.ondatachannel = null;
                    conn.peerConnection.ontrack = null;
                    if (conn.peerConnection.signalingState !== 'closed') conn.peerConnection.close();
                } catch (e) { /* 忽略 */ }
            }
            delete this.connections[peerId];
            delete this.iceCandidates[peerId];
            delete this.reconnectAttempts[peerId];
            delete this.iceGatheringStartTimes[peerId];
            EventEmitter.emit('connectionClosed', peerId);
        }
    },

    closePeerConnectionMedia: function(peerId) {
        const conn = this.connections[peerId];
        if (conn && conn.peerConnection && conn.peerConnection.signalingState !== 'closed') {
            Utils.log(`WebRTCManager: 明确关闭 PeerConnection for ${peerId} (媒体部分)。`, Utils.logLevels.INFO);
            try {
                conn.peerConnection.close();
            } catch (e) { /* ... */ }
        }
    },

    handleIceGatheringStateChange: function (peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;
        Utils.log(`WebRTCManager: ICE 收集状态 for ${peerId} 变为: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);
        if (pc.iceGatheringState === 'gathering' && !this.iceGatheringStartTimes[peerId]) {
            this.iceGatheringStartTimes[peerId] = Date.now();
        } else if (pc.iceGatheringState === 'complete') {
            const duration = (Date.now() - (this.iceGatheringStartTimes[peerId] || Date.now())) / 1000;
            Utils.log(`WebRTCManager: 为 ${peerId} 的 ICE 收集完成，耗时 ${duration}秒。候选者数量: ${this.iceCandidates[peerId]?.length || 0}`, Utils.logLevels.DEBUG);
            delete this.iceGatheringStartTimes[peerId];
        }
    },
};