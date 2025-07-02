/**
 * @file WebRTC 连接管理器
 * @description 管理 WebRTC RTCPeerConnection 的生命周期和协商过程。负责创建 Offer/Answer，处理 ICE 候选者，管理连接状态，和数据通道的创建。同时处理重新协商和 "glare" (信令冲突) 情况。
 * @module WebRTCManager
 * @exports {object} WebRTCManager - 对外暴露的 WebRTC 管理器单例。
 * @dependency AppSettings, Utils, NotificationUIManager, VideoCallManager, ChatManager, UserManager, ChatAreaUIManager, EventEmitter
 */
const WebRTCManager = {
    // =================================================================
    // 常量与配置 (Constants & Config)
    // =================================================================

    // 用于手动信令流程的占位符 Peer ID
    MANUAL_PLACEHOLDER_PEER_ID: AppSettings.constants.manualPlaceholderPeerId,

    // =================================================================
    // 状态变量 (State Variables)
    // =================================================================

    // 存储所有 RTCPeerConnection 实例及其详情, 结构: { peerId: { peerConnection, dataChannel, ... } }
    connections: {},
    // 缓存为手动流程收集的 ICE 候选者, 结构: { peerId: [candidateObject, ...] }
    iceCandidates: {},
    // 存储重连尝试的定时器ID, 结构: { peerId: timeoutId }
    connectionTimeouts: {},
    // 记录对每个 Peer 的重连尝试次数, 结构: { peerId: number }
    reconnectAttempts: {},
    // 存储 ICE 收集超时的定时器ID, 结构: { peerId: timeoutId }
    iceTimers: {},
    // 记录 ICE 收集开始的时间戳, 结构: { peerId: timestamp }
    iceGatheringStartTimes: {},

    // 用于发送信令消息的外部回调函数
    _signalingSender: null,
    // 数据通道就绪时的外部回调函数
    _onDataChannelReadyHandler: null,

    // =================================================================
    // 公开方法 (Public Methods)
    // =================================================================

    /**
     * 初始化 WebRTCManager。
     * @function init
     * @param {function} signalingSender - 发送信令消息的回调函数。
     * @param {function} onDataChannelReady - 数据通道就绪时的回调函数。
     */
    init: function(signalingSender, onDataChannelReady) {
        this._signalingSender = signalingSender;
        this._onDataChannelReadyHandler = onDataChannelReady;
        Utils.log("WebRTCManager 初始化。", Utils.logLevels.INFO);
    },

    /**
     * 初始化或重新初始化与指定对等端的 RTCPeerConnection。
     * @function initConnection
     * @param {string} peerId - 对方的 ID。
     * @param {boolean} [isVideoCall=false] - 是否为视频通话连接。
     * @returns {RTCPeerConnection|null} - 返回新创建的 RTCPeerConnection 实例，失败则返回 null。
     */
    initConnection: function (peerId, isVideoCall = false) {
        Utils.log(`WebRTCManager: 尝试初始化与 ${peerId} 的连接。视频通话: ${isVideoCall}`, Utils.logLevels.DEBUG);
        const existingConnDetails = this.connections[peerId];
        // 初始化流程如下：
        // 1. 检查是否存在现有连接
        if (existingConnDetails && existingConnDetails.peerConnection) {
            const pc = existingConnDetails.peerConnection;
            const pcSignalingState = pc.signalingState;
            // 2. 如果连接正在协商中，则复用现有连接
            if (pcSignalingState === 'have-local-offer' || pcSignalingState === 'have-remote-offer') {
                Utils.log(`WebRTCManager: initConnection: 与 ${peerId} 的连接正在协商中 (信令状态: ${pcSignalingState})。正在复用。`, Utils.logLevels.WARN);
                existingConnDetails.isVideoCall = isVideoCall;
                if (!isVideoCall && !pc.ondatachannel && typeof this._onDataChannelReadyHandler === 'function') {
                    pc.ondatachannel = (e) => this._onDataChannelReadyHandler(e.channel, peerId, false);
                }
                return pc;
            }
            // 3. 如果连接状态不佳，则先关闭再重新创建
            Utils.log(`WebRTCManager: initConnection: 存在 ${peerId} 的 PC (信令状态: ${pcSignalingState}, 连接状态: ${pc.connectionState})。正在关闭并重新初始化。`, Utils.logLevels.INFO);
            this.closeConnection(peerId, false);
        }
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID && this.connections[this.MANUAL_PLACEHOLDER_PEER_ID]) {
            Utils.log(`WebRTCManager: 在新的手动初始化之前，明确关闭 ${this.MANUAL_PLACEHOLDER_PEER_ID} 的现有 PC。`, Utils.logLevels.WARN);
            this.closeConnection(this.MANUAL_PLACEHOLDER_PEER_ID, false);
        }

        // 4. 清理旧状态并创建新的 RTCPeerConnection
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

            // 5. 存储新连接的详情和状态
            this.connections[peerId] = {
                peerConnection: newPc,
                dataChannel: null,
                isVideoCall: isVideoCall,
                isAudioOnly: false,
                isScreenShare: false,
                wasInitiatedSilently: false
            };
            this.iceCandidates[peerId] = [];
            this.reconnectAttempts[peerId] = 0;

            // 6. 绑定所有必要的事件监听器
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
     * @function createOffer
     * @param {string} targetPeerId - 目标对方的 ID。
     * @param {object} [options={}] - 连接选项，包含 isVideoCall, isAudioOnly, isScreenShare, isSilent, isManual。
     * @returns {Promise<void>}
     */
    createOffer: async function (targetPeerId, options = {}) {
        const {isVideoCall = false, isAudioOnly = false, isScreenShare = false, isSilent = false, isManual = false} = options;
        Utils.log(`WebRTCManager: 正在为 ${targetPeerId} 创建提议，视频: ${isVideoCall}, 纯音频: ${isAudioOnly}, 屏幕共享: ${isScreenShare}, 手动: ${isManual}`, Utils.logLevels.DEBUG);

        // 1. 获取或初始化 PeerConnection
        let pc = this.connections[targetPeerId]?.peerConnection;
        if (!pc || pc.signalingState === 'closed' || pc.signalingState === 'failed') {
            pc = this.initConnection(targetPeerId, isVideoCall);
        }
        if (!pc) {
            if (!isSilent || isManual) NotificationUIManager.showNotification("初始化连接以创建提议失败。", "error");
            Utils.log(`WebRTCManager: createOffer: initConnection 为 ${targetPeerId} 返回 null。正在中止。`, Utils.logLevels.ERROR);
            return;
        }

        // 2. 处理信令冲突 (glare)
        if (pc.signalingState === 'have-local-offer') {
            if (!isSilent) NotificationUIManager.showNotification(`已向 ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0, 6)} 发送过提议。`, "info");
            return;
        }
        if (pc.signalingState === 'have-remote-offer') {
            // NOTE: Glare condition. 简单的解决方法：ID较大的一方继续，较小的一方退让。
            if (UserManager.userId > targetPeerId) {
                Utils.log(`WebRTCManager: 与 ${targetPeerId} 发生信令冲突(glare)。我方ID较大，继续发送提议。`, Utils.logLevels.WARN);
            } else {
                Utils.log(`WebRTCManager: 与 ${targetPeerId} 发生信令冲突(glare)。我方ID较小，退让并处理对方的提议。`, Utils.logLevels.WARN);
                return;
            }
        }

        // 3. 更新连接状态并创建数据通道或添加媒体轨道
        const connEntry = this.connections[targetPeerId];
        if (connEntry) {
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

        // 4. 创建、设置并发送 Offer
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

            // 5. 根据流程类型（手动或自动）处理 Offer
            if (isManual) {
                this.waitForIceGatheringComplete(targetPeerId, () => {
                    if (typeof this._signalingSender === 'function') {
                        this._signalingSender('manual_offer_ready', targetPeerId, sdpPayload, this.iceCandidates[targetPeerId] || []);
                    }
                    NotificationUIManager.showNotification("提议已创建。请复制信息并发送。", "info");
                });
            } else {
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
     * 处理远程提议 (offer)，能正确处理重新协商和信令冲突。
     * @function handleRemoteOffer
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

        // 流程：
        // 1. 判断是初始协商、重新协商还是信令冲突
        if (pc && pc.signalingState !== 'closed' && pc.signalingState !== 'failed') {
            if (pc.signalingState === 'have-local-offer') { // Glare condition
                if (UserManager.userId > fromUserId) {
                    Utils.log(`WebRTCManager: 与 ${fromUserId} 发生信令冲突(glare)。我方ID较大，忽略对方的提议。`, Utils.logLevels.WARN);
                    return;
                }
                Utils.log(`WebRTCManager: 与 ${fromUserId} 发生信令冲突(glare)。我方ID较小，回滚本地提议以处理对方提议。`, Utils.logLevels.WARN);
                await pc.setLocalDescription({ type: 'rollback' });
                isReNegotiation = true;
            } else if (pc.signalingState === 'stable') { // Re-negotiation
                isReNegotiation = true;
                Utils.log(`WebRTCManager: 收到来自 ${fromUserId} 的重新协商 offer。`, Utils.logLevels.INFO);
            }
        } else {
            // Initial negotiation
            pc = this.initConnection(fromUserId, isVideoCall);
        }
        if (!pc) {
            NotificationUIManager.showNotification("初始化连接以处理提议失败。", "error");
            return;
        }

        // 2. 更新连接状态
        const connEntry = this.connections[fromUserId];
        if (connEntry) {
            connEntry.wasInitiatedSilently = isReNegotiation ? connEntry.wasInitiatedSilently : (connEntry.wasInitiatedSilently && !isManualFlow);
            connEntry.isVideoCall = isVideoCall;
            connEntry.isAudioOnly = isAudioOnly;
            connEntry.isScreenShare = isScreenShare;
        }

        // 3. 设置远程描述、创建并设置本地应答
        try {
            if (typeof sdpString !== 'string' || sdpType !== 'offer') {
                Utils.log(`WebRTCManager: handleRemoteOffer - 无效的SDP字符串或类型 for ${fromUserId}. SDP类型: ${sdpType}`, Utils.logLevels.ERROR);
                this.closeConnection(fromUserId);
                return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription({type: 'offer', sdp: sdpString}));

            // 4. 添加 ICE 候选者
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

            // 5. 发送应答
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
     * @function handleRemoteAnswer
     * @param {string} fromUserId - 发送方的 ID。
     * @param {string} sdpString - SDP 字符串。
     * @param {RTCIceCandidateInit[]} [candidates] - 对方的 ICE 候选者 (可选)。
     * @param {boolean} isVideoCallFlag - 是否为视频通话 (用于状态确认)。
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

        // 1. 校验 SDP 类型和连接状态
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

        // 2. 设置远程描述并添加 ICE 候选者
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

    /**
     * 添加远程 ICE 候选者。
     * @function addRemoteIceCandidate
     * @param {string} fromUserId - 发送方的 ID。
     * @param {RTCIceCandidateInit} candidate - ICE 候选者对象。
     * @returns {Promise<void>}
     */
    addRemoteIceCandidate: async function (fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        // 只有在设置了 remoteDescription 后才能添加 ICE
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

    /**
     * 关闭与指定对方的连接。
     * @function closeConnection
     * @param {string} peerId - 要关闭连接的对方 ID。
     * @param {boolean} [notifyPeer=true] - 是否通知对方连接已关闭（暂未实现）。
     */
    closeConnection: function (peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn) {
            Utils.log(`WebRTCManager: 正在关闭与 ${peerId} 的连接。`, Utils.logLevels.INFO);
            // 1. 清理所有相关定时器
            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);
            delete this.connectionTimeouts[peerId];
            if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
            delete this.iceTimers[peerId];

            // 2. 安全地关闭数据通道
            if (conn.dataChannel) {
                try {
                    conn.dataChannel.onopen = null;
                    conn.dataChannel.onmessage = null;
                    conn.dataChannel.onerror = null;
                    conn.dataChannel.onclose = null;
                    if (conn.dataChannel.readyState !== 'closed') conn.dataChannel.close();
                } catch (e) { /* 忽略错误 */ }
                conn.dataChannel = null;
            }

            // 3. 安全地关闭 PeerConnection
            if (conn.peerConnection) {
                try {
                    conn.peerConnection.onicecandidate = null;
                    conn.peerConnection.onicegatheringstatechange = null;
                    conn.peerConnection.oniceconnectionstatechange = null;
                    conn.peerConnection.onconnectionstatechange = null;
                    conn.peerConnection.ondatachannel = null;
                    conn.peerConnection.ontrack = null;
                    if (conn.peerConnection.signalingState !== 'closed') conn.peerConnection.close();
                } catch (e) { /* 忽略错误 */ }
            }

            // 4. 清理所有状态并发出事件
            delete this.connections[peerId];
            delete this.iceCandidates[peerId];
            delete this.reconnectAttempts[peerId];
            delete this.iceGatheringStartTimes[peerId];
            EventEmitter.emit('connectionClosed', peerId);
        }
    },

    /**
     * 检查是否已与指定对方建立连接。
     * @function isConnectedTo
     * @param {string} peerId - 对方 ID。
     * @returns {boolean} - 如果已连接则返回 true。
     */
    isConnectedTo: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return false;
        const pcOverallState = conn.peerConnection.connectionState;
        if (pcOverallState === 'connected') {
            // 对于视频通话，连接成功即可；对于数据连接，数据通道必须打开
            if (conn.isVideoCall || (conn.dataChannel && conn.dataChannel.readyState === 'open')) return true;
        }
        return false;
    },

    // =================================================================
    // 内部和事件处理方法 (Internal & Event Handlers)
    // =================================================================

    /**
     * 处理本地 ICE 候选者事件。
     * @function handleLocalIceCandidate
     * @param {RTCPeerConnectionIceEvent} event - ICE 事件。
     * @param {string} peerId - 关联的对方 ID。
     */
    handleLocalIceCandidate: function (event, peerId) {
        if (event.candidate) {
            // 缓存候选者以备手动流程使用
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = [];
            this.iceCandidates[peerId].push(event.candidate.toJSON());

            const connData = this.connections[peerId];
            const isManualContext = peerId === this.MANUAL_PLACEHOLDER_PEER_ID;

            // 自动流程下，直接通过信令服务器发送
            if (!isManualContext && typeof this._signalingSender === 'function') {
                const sendSilently = connData?.wasInitiatedSilently || false;
                this._signalingSender('ICE_CANDIDATE', peerId, event.candidate.toJSON(), null, sendSilently);
            }
        }
    },

    /**
     * 等待 ICE 收集完成或超时。
     * @function waitForIceGatheringComplete
     * @param {string} peerId - 对方 ID。
     * @param {function} callback - 完成或超时后执行的回调。
     */
    waitForIceGatheringComplete: function (peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) {
            if (typeof callback === 'function') callback();
            return;
        }
        // 清理可能存在的旧计时器
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
        delete this.iceTimers[peerId];

        if (pc.iceGatheringState === 'complete') {
            if (typeof callback === 'function') callback();
        } else {
            // 设置超时，并轮询检查状态
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
                    onDone();
                    return;
                }
                if (this.connections[peerId].peerConnection.iceGatheringState === 'complete') {
                    onDone();
                }
            }, 200);
        }
    },

    /**
     * 处理 ICE 连接状态变更事件。
     * @function handleIceConnectionStateChange
     * @param {string} peerId - 对方 ID。
     */
    handleIceConnectionStateChange: function (peerId) {
        // NOTE: 此方法目前作为辅助日志和调试，主要依赖 handleRtcConnectionStateChange
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return;
        const pc = conn.peerConnection;
        Utils.log(`WebRTCManager: ICE 连接状态 for ${peerId} 变为: ${pc.iceConnectionState}`, Utils.logLevels.DEBUG);
    },

    /**
     * 处理整体 RTC 连接状态变更事件。
     * @function handleRtcConnectionStateChange
     * @param {string} peerId - 对方 ID。
     */
    handleRtcConnectionStateChange: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`WebRTCManager: RTC 连接状态 for ${peerId} 变为: ${pc.connectionState}`, Utils.logLevels.DEBUG);
        switch (pc.connectionState) {
            case "connected":
                this.reconnectAttempts[peerId] = 0; // 重置重连计数
                if ((conn.isVideoCall || (conn.dataChannel?.readyState === 'open')) && !conn._emittedEstablished) {
                    EventEmitter.emit('connectionEstablished', peerId);
                    conn._emittedEstablished = true;
                }
                break;
            case "disconnected":
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) this.attemptReconnect(peerId); // 非视频通话时尝试重连
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
                    Utils.log(`WebRTCManager: 检测到 ${peerId} 连接已关闭，确保本地状态已清理。`, Utils.logLevels.DEBUG);
                    this.closeConnection(peerId, false); // 确保清理
                }
                break;
        }
    },

    /**
     * 处理 ICE 收集状态变更事件。
     * @function handleIceGatheringStateChange
     * @param {string} peerId - 对方 ID。
     */
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

    /**
     * 尝试重新连接（仅用于数据通道）。
     * @function attemptReconnect
     * @param {string} peerId - 对方 ID。
     */
    attemptReconnect: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn || conn.isVideoCall || this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') return;

        // 重连逻辑：
        // 1. 增加重连次数
        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1;
        const webrtcReconnectConfig = AppSettings.reconnect.webrtc;

        // 2. 检查是否超过最大次数
        if (this.reconnectAttempts[peerId] <= webrtcReconnectConfig.maxAttempts) {
            // 3. 计算指数退避延迟
            const delay = webrtcReconnectConfig.delay * Math.pow(webrtcReconnectConfig.backoffFactor, this.reconnectAttempts[peerId] - 1);
            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]);

            // 4. 设置定时器发起新的 Offer
            this.connectionTimeouts[peerId] = setTimeout(async () => {
                delete this.connectionTimeouts[peerId];
                const currentConn = this.connections[peerId];
                if (currentConn && !this.isConnectedTo(peerId) && currentConn.peerConnection &&
                    !['connecting', 'have-local-offer', 'have-remote-offer'].includes(currentConn.peerConnection.signalingState)) {

                    if (['failed', 'closed', 'disconnected'].includes(currentConn.peerConnection.connectionState)) {
                        this.closeConnection(peerId, false); // 先关闭旧的
                    }
                    await this.createOffer(peerId, {isSilent: true});
                } else if (this.isConnectedTo(peerId)) {
                    this.reconnectAttempts[peerId] = 0; // 如果已重连成功，则重置计数
                }
            }, delay);
        } else {
            // 5. 超过次数则彻底关闭连接
            this.closeConnection(peerId, false);
        }
    },
};