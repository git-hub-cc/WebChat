/**
 * @file ConnectionManager.js
 * @description 核心连接管理器，负责处理 WebRTC 对等连接和与信令服务器的 WebSocket 通信。
 *              实现了心跳机制以保持 WebSocket 活跃，以及指数退避的自动重连策略。
 *              新增：处理消息撤回的信令。自动连接逻辑现在会优先尝试连接在线的好友。
 *              sendTo 方法现在在调用 Utils.sendInChunks 时传递 dataChannel 对象。
 *              重构：将自动添加新联系人的逻辑提取到 _ensureContactExistsForPeer 方法。
 *              重构：改进 setupDataChannel 以防止重复监听器绑定和处理潜在的事件竞争。
 * @module ConnectionManager
 * @exports {object} ConnectionManager - 对外暴露的单例对象，包含所有连接管理功能。
 * @property {function} initialize - 初始化并连接到 WebSocket 信令服务器。
 * @property {function} createOffer - 创建并发送一个 WebRTC 连接提议给对等端。
 * @property {function} handleRemoteOffer - 处理远端发送的连接提议并创建应答。
 * @property {function} handleRemoteAnswer - 处理远端发送的应答。
 * @property {function} sendTo - 通过已建立的数据通道向指定对等端发送消息。
 * @property {function} close - 关闭与指定对等端的连接。
 * @property {boolean} isWebSocketConnected - 指示当前是否已连接到 WebSocket 服务器。
 * @dependencies UserManager, ChatManager, Config, Utils, NotificationUIManager, EventEmitter, LayoutUIManager, VideoCallManager, ModalUIManager, MessageManager, PeopleLobbyManager
 * @dependents AppInitializer (初始化), UserManager (自动连接), GroupManager (广播), VideoCallManager (建立媒体流)
 */
const ConnectionManager = {
    connections: {}, // { peerId: { peerConnection, dataChannel, isVideoCall, ... } }
    iceCandidates: {}, // { peerId: [candidateObject, ...] }
    connectionTimeouts: {}, // { peerId: timeoutId } for reconnect attempts
    reconnectAttempts: {}, // { peerId: number }
    iceTimers: {}, // { peerId: timeoutId } for ICE gathering
    iceGatheringStartTimes: {}, // { peerId: timestamp }
    websocket: null,
    isWebSocketConnected: false,
    signalingServerUrl: Config.server.signalingServerUrl,
    pendingSentChunks: {}, // { fileId: { total, sent, dataLength } }
    pendingReceivedChunks: {}, // { peerId: { chunkId: { total, received, chunks, originalType } } }
    heartbeatInterval: null,
    wsReconnectAttempts: 0,
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_', // 手动连接时的占位符ID

    /**
     * @private
     * @description 确保与指定 peerId 的联系人存在。如果不存在，则自动创建。
     * @param {string} peerId - 对方的ID。
     * @param {boolean} [isManualContextOrPlaceholderOrigin=false] - 指示此peerId是否来自手动连接流程或通道最初是为占位符创建的。
     *                                                            如果是占位符起源的通道，即使peerId已解析，此标志仍应为true。
     */
    _ensureContactExistsForPeer: async function(peerId, isManualContextOrPlaceholderOrigin = false) {
        // 如果不是手动上下文/占位符起源，并且 peerId 是占位符本身，则不创建联系人。
        if (!isManualContextOrPlaceholderOrigin && peerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
            Utils.log(`ConnectionManager._ensureContactExistsForPeer: 跳过为占位符ID ${peerId} 创建联系人 (非手动/占位符起源上下文)。`, Utils.logLevels.DEBUG);
            return;
        }

        // 只要 peerId 有效（不是自己，也不是占位符本身除非在特定手动流中），并且联系人不存在，就尝试创建。
        if (peerId && peerId !== UserManager.userId &&
            (peerId !== this.MANUAL_PLACEHOLDER_PEER_ID || isManualContextOrPlaceholderOrigin) && // 允许为手动上下文中的占位符ID（如果未解析）或已解析的ID创建
            !UserManager.contacts[peerId]) {
            try {
                // 为新连接的对方创建一个默认名称的联系人
                await UserManager.addContact(peerId, `用户 ${peerId.substring(0, 4)}`, false); // false 表示不立即尝试建立连接（因为连接正在建立中）
                Utils.log(`ConnectionManager: 自动为新的连接对方 ${peerId} 创建了联系人记录。`, Utils.logLevels.INFO);
            } catch (error) {
                Utils.log(`ConnectionManager: 自动为 ${peerId} 创建联系人时出错: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    /**
     * 初始化连接管理器，主要是连接到 WebSocket 信令服务器（如果尚未连接）。
     */
    initialize: function () {
        if (!this.isWebSocketConnected && (!this.websocket || this.websocket.readyState === WebSocket.CLOSED)) {
            this.connectWebSocket();
        }
        // 其他初始化逻辑（如果需要）
    },

    /**
     * 连接到 WebSocket 信令服务器。
     * @returns {Promise<void>} - 连接成功或失败时解析/拒绝的 Promise。
     */
    connectWebSocket: function () {
        if (this.websocket && (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING)) {
            return Promise.resolve(); // 如果已连接或正在连接，则直接返回
        }
        LayoutUIManager.updateConnectionStatusIndicator('正在连接信令服务器...');
        Utils.log('ConnectionManager: 尝试连接到 WebSocket: ' + this.signalingServerUrl, Utils.logLevels.INFO);
        return new Promise((resolve, reject) => {
            try {
                this.websocket = new WebSocket(this.signalingServerUrl);

                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    this.wsReconnectAttempts = 0; // 重置重连尝试次数
                    LayoutUIManager.updateConnectionStatusIndicator('信令服务器已连接。');
                    Utils.log('ConnectionManager: WebSocket 连接已建立。', Utils.logLevels.INFO);
                    this.registerUser(); // 注册用户
                    this.startHeartbeat(); // 启动心跳
                    EventEmitter.emit('websocketStatusUpdate'); // 触发状态更新事件
                    resolve();
                };
                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        if (message.type === 'PONG') { // 处理心跳回复
                            Utils.log('ConnectionManager: 收到 WebSocket 心跳回复 (PONG)', Utils.logLevels.DEBUG);
                            return;
                        }
                        this.handleSignalingMessage(message); // 处理其他信令消息
                    } catch (e) {
                        Utils.log('ConnectionManager: 解析信令消息时出错: ' + e, Utils.logLevels.ERROR);
                    }
                };
                this.websocket.onclose = () => {
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false;
                    this.stopHeartbeat(); // 停止心跳
                    this.wsReconnectAttempts++;
                    Utils.log(`ConnectionManager: WebSocket 连接已关闭。正在进行第 ${this.wsReconnectAttempts} 次重连尝试...`, Utils.logLevels.WARN);
                    if (this.wsReconnectAttempts <= 10) { // 最多尝试10次
                        const delay = Math.min(30000, 1000 * Math.pow(2, this.wsReconnectAttempts)); // 指数退避
                        LayoutUIManager.updateConnectionStatusIndicator(`信令服务器已断开。${delay / 1000}秒后尝试重连...`);
                        Utils.log(`ConnectionManager: 下一次重连将在 ${delay / 1000} 秒后。`, Utils.logLevels.WARN);
                        if (oldStatus) EventEmitter.emit('websocketStatusUpdate'); // 仅在状态真正改变时触发
                        setTimeout(() => this.connectWebSocket(), delay);
                    } else {
                        LayoutUIManager.updateConnectionStatusIndicator('信令服务器连接失败。自动重连已停止。');
                        NotificationUIManager.showNotification('无法连接到信令服务器。请检查您的网络并手动刷新或重新连接。', 'error');
                        Utils.log('ConnectionManager: 已达到最大重连次数 (10)，停止自动重连。', Utils.logLevels.ERROR);
                        if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    }
                };
                this.websocket.onerror = (error) => {
                    Utils.log('ConnectionManager: WebSocket 错误: ' + JSON.stringify(error), Utils.logLevels.ERROR);
                    LayoutUIManager.updateConnectionStatusIndicator('信令服务器连接错误。');
                    const oldStatus = this.isWebSocketConnected;
                    this.isWebSocketConnected = false; // 确保在错误时也更新状态
                    if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                    // reject(error); // 可以考虑是否在这里 reject Promise，取决于调用者如何处理
                };
            } catch (error) {
                Utils.log('ConnectionManager: 创建 WebSocket 连接失败: ' + error, Utils.logLevels.ERROR);
                LayoutUIManager.updateConnectionStatusIndicator('连接信令服务器失败。');
                const oldStatus = this.isWebSocketConnected;
                this.isWebSocketConnected = false;
                if (oldStatus) EventEmitter.emit('websocketStatusUpdate');
                reject(error);
            }
        });
    },

    /**
     * 启动 WebSocket 心跳机制，以保持连接活跃并检测断线。
     */
    startHeartbeat: function () {
        this.stopHeartbeat(); // 先停止可能存在的旧心跳
        this.heartbeatInterval = setInterval(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({type: 'PING'})); // 发送 PING 消息
                Utils.log('ConnectionManager: 发送 WebSocket 心跳 (PING)', Utils.logLevels.DEBUG);
            }
        }, 25000); // 每25秒发送一次
    },

    /**
     * 停止 WebSocket 心跳定时器。
     */
    stopHeartbeat: function () {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            Utils.log('ConnectionManager: 已停止 WebSocket 心跳', Utils.logLevels.DEBUG);
        }
    },

    /**
     * 向信令服务器注册当前用户。
     */
    registerUser: function () {
        if (!UserManager.userId) { // 确保用户ID已存在
            Utils.log('ConnectionManager: 用户 ID 未设置，无法注册。', Utils.logLevels.ERROR);
            return;
        }
        const message = {type: 'REGISTER', userId: UserManager.userId};
        this.sendSignalingMessage(message, false); // false 表示这不是内部静默操作
    },

    /**
     * 通过 WebSocket 发送信令消息。
     * @param {object} message - 要发送的消息对象。
     * @param {boolean} [isInternalSilentFlag=false] - 是否为内部静默操作，用于控制错误通知的显示。
     */
    sendSignalingMessage: function (message, isInternalSilentFlag = false) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const messageString = JSON.stringify(message);
            this.websocket.send(messageString);
            Utils.log(`ConnectionManager: 已发送 WS: ${message.type} 至 ${message.targetUserId || '服务器'} (来自 ${message.userId || 'N/A'}) ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        } else {
            Utils.log('ConnectionManager: WebSocket 未连接，无法发送信令消息。', Utils.logLevels.ERROR);
            if (!isInternalSilentFlag) { // 如果不是静默操作，则显示通知
                if (window.location.protocol === 'file:') { // 特殊处理本地文件运行的情况
                    NotificationUIManager.showNotification('正从本地文件系统运行。信令服务器可能不可用。消息未发送。', 'warning');
                } else {
                    NotificationUIManager.showNotification('未连接到信令服务器。消息未发送。', 'error');
                }
            }
        }
    },

    /**
     * 处理从信令服务器接收到的消息。
     * @param {object} message - 从 WebSocket 收到的消息对象。
     */
    handleSignalingMessage: function (message) {
        Utils.log(`ConnectionManager: 已收到 WS: ${message.type} 来自 ${message.fromUserId || '服务器'} ${message.sdp ? '[SDP]' : ''} ${message.candidate ? '[ICE]' : ''}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId; // 消息来源用户ID
        switch (message.type) {
            case 'SUCCESS': // 用户注册成功
                LayoutUIManager.updateConnectionStatusIndicator(`用户注册成功: ${UserManager.userId.substring(0, 8)}...`);
                this.autoConnectToContacts(); // 尝试自动连接联系人
                break;
            case 'ERROR': // 信令服务器返回错误
                if (!message.message.includes('不在线')) { // 过滤掉常见的“不在线”错误，避免过多通知
                    NotificationUIManager.showNotification(`信令错误: ${message.message}`, 'error');
                }
                Utils.log(`ConnectionManager: 信令服务器错误: ${message.message}`, Utils.logLevels.ERROR);
                break;
            case 'OFFER': // 收到连接提议
                this.handleRemoteOffer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ANSWER': // 收到连接应答
                this.handleRemoteAnswer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ICE_CANDIDATE': // 收到 ICE 候选者
                this.handleRemoteIceCandidate(fromUserId, message.candidate);
                break;
            case 'USER_NOT_FOUND': // 目标用户未找到
                const connDetails = this.connections[message.targetUserId];
                const wasSilentAttempt = connDetails?.wasInitiatedSilently || false; // 判断是否为静默尝试连接
                if (!wasSilentAttempt) {
                    NotificationUIManager.showNotification(`用户 ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0, 8) + '...'} 未找到或离线。`, 'warning');
                }
                Utils.log(`ConnectionManager: 用户 ${message.targetUserId} 未找到。(静默尝试: ${wasSilentAttempt})`, Utils.logLevels.WARN);
                if (ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.updateChatHeaderStatus(`用户未找到或离线`);
                }
                if (this.connections[message.targetUserId]) this.close(message.targetUserId, false); // 关闭相关连接
                break;
            default:
                Utils.log('ConnectionManager: 未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    /**
     * 初始化或重新初始化与指定对等端的 RTCPeerConnection。
     * @param {string} peerId - 对方的 ID。
     * @param {boolean} [isVideoCall=false] - 这是否是一个视频通话连接。
     * @returns {RTCPeerConnection|null} - 新创建的或 null（如果失败）。
     */
    initConnection: function (peerId, isVideoCall = false) {
        Utils.log(`ConnectionManager: 尝试初始化与 ${peerId} 的连接。视频通话: ${isVideoCall}`, Utils.logLevels.DEBUG);
        const existingConnDetails = this.connections[peerId];
        if (existingConnDetails && existingConnDetails.peerConnection) {
            const pc = existingConnDetails.peerConnection;
            const pcSignalingState = pc.signalingState;
            // 如果连接正在协商中，则尝试复用
            if (pcSignalingState === 'have-local-offer' || pcSignalingState === 'have-remote-offer') {
                Utils.log(`ConnectionManager: initConnection: 与 ${peerId} 的连接正在协商中 (信令状态: ${pcSignalingState})。正在复用。`, Utils.logLevels.WARN);
                existingConnDetails.isVideoCall = isVideoCall; // 更新视频通话状态
                // 确保数据通道事件监听器已设置（如果不是视频通话）
                if (!isVideoCall && !pc.ondatachannel) {
                    pc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
                }
                return pc;
            }
            Utils.log(`ConnectionManager: initConnection: 存在 ${peerId} 的 PC (信令状态: ${pcSignalingState}, 连接状态: ${pc.connectionState})。正在关闭并重新初始化。`, Utils.logLevels.INFO);
            this.close(peerId, false); // 关闭现有连接以便重新初始化
        }
        // 特殊处理手动连接占位符ID
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID && this.connections[this.MANUAL_PLACEHOLDER_PEER_ID]) {
            Utils.log(`ConnectionManager: 在新的手动初始化之前，明确关闭 ${this.MANUAL_PLACEHOLDER_PEER_ID} 的现有 PC。`, Utils.logLevels.WARN);
            this.close(this.MANUAL_PLACEHOLDER_PEER_ID, false);
        }
        // 清理旧的状态
        delete this.connections[peerId];
        delete this.iceCandidates[peerId];
        delete this.reconnectAttempts[peerId];
        if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
        delete this.iceTimers[peerId];
        delete this.iceGatheringStartTimes[peerId];

        Utils.log(`ConnectionManager: 为 ${peerId} 初始化新的 RTCPeerConnection。视频通话: ${isVideoCall}`, Utils.logLevels.INFO);
        try {
            const rtcConfig = Config.peerConnectionConfig; // 获取 WebRTC 配置
            Utils.log(`ConnectionManager: 使用配置为 ${peerId} 初始化 RTCPeerConnection: ${JSON.stringify(rtcConfig)}`, Utils.logLevels.DEBUG);
            const newPc = new RTCPeerConnection(rtcConfig);
            // 存储新的连接信息
            this.connections[peerId] = {
                peerConnection: newPc,
                dataChannel: null,
                isVideoCall: isVideoCall,
                isAudioOnly: false, // 默认为非纯音频
                isScreenShare: false, // 默认为非屏幕共享
                wasInitiatedSilently: false // 是否为静默连接
            };
            this.iceCandidates[peerId] = []; // 初始化ICE候选者数组
            this.reconnectAttempts[peerId] = 0; // 重置重连尝试次数
            // 绑定事件监听器
            newPc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            newPc.onicegatheringstatechange = () => this.handleIceGatheringStateChange(peerId);
            newPc.oniceconnectionstatechange = () => this.handleIceConnectionStateChange(peerId);
            newPc.onconnectionstatechange = () => this.handleRtcConnectionStateChange(peerId);
            if (!isVideoCall) { // 如果不是视频通话，则设置数据通道监听器
                newPc.ondatachannel = (e) => this.setupDataChannel(e.channel, peerId);
            }
            return newPc;
        } catch (error) {
            Utils.log(`ConnectionManager: 严重错误: 初始化 ${peerId} 的 PC 失败: ${error.message}\n堆栈: ${error.stack}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`为 ${peerId} 设置连接时出错: ${error.message}`, 'error');
            delete this.connections[peerId]; // 清理失败的连接尝试
            return null;
        }
    },

    /**
     * 创建一个 WebRTC 提议 (offer) 并通过信令服务器发送给对方。
     * @param {string|null} targetPeerId - 目标对方的 ID。如果为 null，会尝试使用当前聊天 ID 或提示输入。
     * @param {object} [options={}] - 连接选项。
     * @param {boolean} [options.isVideoCall=false] - 是否为视频通话。
     * @param {boolean} [options.isAudioOnly=false] - 是否为纯音频通话。
     * @param {boolean} [options.isSilent=false] - 是否为静默操作（不显示通知）。
     * @param {boolean} [options.isManual=false] - 是否为手动连接流程。
     * @returns {Promise<void>}
     */
    createOffer: async function (targetPeerId = null, options = {}) {
        const {isVideoCall = false, isAudioOnly = false, isSilent = false, isManual = false} = options;
        let promptedForId = false; // 标记是否通过 prompt 获取ID

        if (isManual) { // 手动连接流程
            Utils.log("ConnectionManager: 手动创建提议。", Utils.logLevels.INFO);
            targetPeerId = this.MANUAL_PLACEHOLDER_PEER_ID; // 使用占位符ID
        } else { // 非手动连接
            // 检查是否是AI联系人
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                if (!isSilent) NotificationUIManager.showNotification(`无法与 ${UserManager.contacts[targetPeerId]?.name || "AI"} 进行连接。`, "info");
                else Utils.log(`ConnectionManager: 已跳过向 AI ${UserManager.contacts[targetPeerId]?.name} 发送提议。`, Utils.logLevels.DEBUG);
                return;
            }
            // 确定目标ID
            if (!targetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) {
                targetPeerId = ChatManager.currentChatId;
            }
            if (!targetPeerId && !isSilent) { // 如果仍无目标ID且非静默，则提示用户输入
                targetPeerId = prompt('请输入对方 ID:');
                promptedForId = true;
                if (!targetPeerId) {
                    NotificationUIManager.showNotification("已取消: 未提供对方 ID。", "info");
                    return;
                }
            } else if (!targetPeerId && isSilent) { // 静默操作但无目标ID
                Utils.log("ConnectionManager: 静默创建提议时缺少目标 ID。正在中止。", Utils.logLevels.WARN);
                return;
            }
            // 检查是否是自己或用户ID无效
            if (targetPeerId === UserManager.userId) {
                if (!isSilent) NotificationUIManager.showNotification("无法连接到自己。", "warning");
                else Utils.log("ConnectionManager: 已跳过向自己发送提议。", Utils.logLevels.DEBUG);
                if (promptedForId && document.getElementById('modalSdpText')) document.getElementById('modalSdpText').value = "无法连接到自己。";
                return;
            }
            if (!UserManager.userId) {
                if (!isSilent) NotificationUIManager.showNotification("您的用户 ID 不可用。", "error");
                return;
            }
            // 检查WebSocket连接
            if (!this.isWebSocketConnected) {
                try {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器未连接。正在尝试...", "info");
                    await this.connectWebSocket();
                } catch (e) {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器连接失败。无法创建提议。", "error");
                    return;
                }
            }
        }

        Utils.log(`ConnectionManager: 正在为 ${targetPeerId} 创建提议，来自: ${UserManager.userId}, 视频: ${isVideoCall}, 纯音频: ${isAudioOnly}, 静默: ${isSilent}, 手动: ${isManual}`, Utils.logLevels.DEBUG);
        const pc = this.initConnection(targetPeerId, isVideoCall); // 初始化 PeerConnection
        if (!pc) {
            if (!isSilent || isManual) NotificationUIManager.showNotification("初始化连接以创建提议失败。", "error");
            Utils.log(`ConnectionManager: createOffer: initConnection 为 ${targetPeerId} 返回 null。正在中止。`, Utils.logLevels.ERROR);
            return;
        }
        // 检查信令状态，防止重复操作
        if (pc.signalingState === 'have-local-offer') {
            if (!isSilent) NotificationUIManager.showNotification(`已向 ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0, 6)} 发送过提议。`, "info");
            return;
        }
        if (pc.signalingState === 'have-remote-offer') {
            if (!isSilent) NotificationUIManager.showNotification(`已收到对方的提议。无法创建新提议。`, "info");
            return;
        }
        // 更新连接详情
        if (this.connections[targetPeerId]) {
            this.connections[targetPeerId].isVideoCall = isVideoCall;
            this.connections[targetPeerId].isAudioOnly = isAudioOnly;
            this.connections[targetPeerId].isScreenShare = options.isScreenShare || false;
            this.connections[targetPeerId].wasInitiatedSilently = isSilent && !isManual;
        } else if (targetPeerId !== this.MANUAL_PLACEHOLDER_PEER_ID) { // 防御性代码，理论上不应发生
            Utils.log(`ConnectionManager: createOffer - this.connections[${targetPeerId}] 在 initConnection 后意外未定义。`, Utils.logLevels.ERROR);
            this.connections[targetPeerId] = { // 重新初始化部分结构
                peerConnection: pc, dataChannel: null, isVideoCall, isAudioOnly,
                isScreenShare: options.isScreenShare || false, wasInitiatedSilently: isSilent && !isManual
            };
        }

        if (pc.signalingState === 'stable' || pc.signalingState === 'new') { // 只有在稳定状态才创建数据通道或添加轨道
            if (!isVideoCall) { // 如果不是视频通话，创建数据通道
                const connEntry = this.connections[targetPeerId];
                if (!connEntry || !connEntry.dataChannel || connEntry.dataChannel.readyState === 'closed') {
                    const dataChannel = pc.createDataChannel('chatChannel', {reliable: true});
                    this.setupDataChannel(dataChannel, targetPeerId);
                }
            } else { // 如果是视频通话，添加媒体轨道
                if (VideoCallManager.localStream) {
                    // 先移除所有旧的发送器（如果有）
                    pc.getSenders().forEach(sender => {
                        if (sender.track) try {
                            pc.removeTrack(sender);
                        } catch (e) {
                            Utils.log(`ConnectionManager: 移除旧轨道时出错: ${e}`, Utils.logLevels.WARN);
                        }
                    });
                    // 添加新的轨道
                    VideoCallManager.localStream.getTracks().forEach(track => {
                        if ((track.kind === 'video' && !isAudioOnly) || track.kind === 'audio') {
                            pc.addTrack(track, VideoCallManager.localStream);
                        }
                    });
                } else {
                    Utils.log("ConnectionManager: 视频通话提议时本地流不可用。", Utils.logLevels.WARN);
                }
            }
        }
        // 创建并发送提议
        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: isVideoCall && !isAudioOnly // 根据是否纯音频决定是否接收视频
            });
            await pc.setLocalDescription(offer); // 设置本地描述
            Utils.log(`ConnectionManager: 为 ${targetPeerId} 创建提议成功。状态: ${pc.signalingState}。(手动: ${isManual})`, Utils.logLevels.INFO);
            if (!pc.localDescription) { // 检查本地描述是否成功设置
                if (!isSilent || isManual) NotificationUIManager.showNotification("错误: 无法确定本地详情。", "error");
                this.close(targetPeerId);
                return;
            }
            if (isManual) { // 如果是手动流程，等待ICE收集完成并更新模态框
                this.waitForIceGatheringComplete(targetPeerId, () => {
                    this.updateSdpTextInModal(targetPeerId);
                    NotificationUIManager.showNotification("提议已创建。请复制信息并发送。", "info");
                });
            } else { // 自动流程，通过信令服务器发送
                if (!isSilent && ChatManager.currentChatId === targetPeerId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.updateChatHeaderStatus(`正在连接到 ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0, 8)}...`);
                }
                const offerMessagePayload = {
                    type: 'OFFER',
                    userId: UserManager.userId,
                    targetUserId: targetPeerId,
                    sdp: pc.localDescription.sdp, // 发送SDP字符串
                    sdpType: pc.localDescription.type, // 发送SDP类型
                    isVideoCall, isAudioOnly,
                    isScreenShare: options.isScreenShare || false
                };
                this.sendSignalingMessage(offerMessagePayload, isSilent);
            }
        } catch (error) {
            Utils.log(`ConnectionManager: 为 ${targetPeerId} 创建提议时发生 WebRTC 错误: ${error.message}\n堆栈: ${error.stack}`, Utils.logLevels.ERROR);
            if (!isSilent || isManual) NotificationUIManager.showNotification(`连接提议错误: ${error.message}`, 'error');
            this.close(targetPeerId); // 出错时关闭连接
        }
    },

    /**
     * 自动连接到所有非 AI、非自己、未连接且在线的联系人。
     * @returns {Promise<void>}
     */
    autoConnectToContacts: async function () {
        Utils.log("ConnectionManager: 尝试自动连接到联系人...", Utils.logLevels.INFO);

        // 获取在线用户列表
        const fetchSuccess = await PeopleLobbyManager.fetchOnlineUsers();
        if (!fetchSuccess) {
            Utils.log("ConnectionManager: 获取在线用户列表失败。将不执行基于在线状态的自动连接。", Utils.logLevels.WARN);
            return;
        }

        const onlineUserIdsFromLobby = new Set(PeopleLobbyManager.onlineUserIds || []);
        if (onlineUserIdsFromLobby.size === 0) {
            Utils.log("ConnectionManager: 大厅中没有其他在线用户。无需自动连接。", Utils.logLevels.INFO);
            return;
        }

        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) {
            Utils.log("ConnectionManager: 没有可自动连接的联系人。", Utils.logLevels.INFO);
            return;
        }

        let offerDelay = 0; // 用于错开提议发送时间
        const contactsToPotentiallyConnect = [];

        // 筛选出需要连接的联系人
        for (const contactId of Object.keys(UserManager.contacts)) {
            if (contactId === UserManager.userId) continue; // 不连接自己

            const contact = UserManager.contacts[contactId];
            if (contact && contact.isAI) continue; // 不连接AI

            if (this.isConnectedTo(contactId)) continue; // 如果已连接，则跳过

            // 如果连接正在进行中，也跳过
            const existingConn = this.connections[contactId];
            if (existingConn?.peerConnection &&
                (existingConn.peerConnection.signalingState === 'have-local-offer' ||
                    existingConn.peerConnection.signalingState === 'have-remote-offer' ||
                    existingConn.peerConnection.connectionState === 'connecting' ||
                    existingConn.dataChannel?.readyState === 'connecting')) {
                continue;
            }
            contactsToPotentiallyConnect.push(contactId);
        }

        // 只连接在大厅中也在线的联系人
        const contactsToConnect = contactsToPotentiallyConnect.filter(id => onlineUserIdsFromLobby.has(id));

        if (contactsToConnect.length === 0) {
            Utils.log("ConnectionManager: 没有符合自动连接条件的在线联系人。", Utils.logLevels.INFO);
            return;
        }

        Utils.log(`ConnectionManager: 找到 ${contactsToConnect.length} 个符合条件的在线联系人进行自动连接: ${contactsToConnect.join(', ')}`, Utils.logLevels.INFO);

        // 依次发送提议
        for (const idToConnect of contactsToConnect) {
            ((id, delay) => {
                setTimeout(async () => {
                    try {
                        Utils.log(`ConnectionManager: 自动连接尝试 -> ${id}`, Utils.logLevels.DEBUG);
                        await this.createOffer(id, {isSilent: true}); // 静默发送提议
                    } catch (error) {
                        Utils.log(`ConnectionManager: 自动连接到 ${id} 时出错: ${error.message}`, Utils.logLevels.WARN);
                    }
                }, delay);
            })(idToConnect, offerDelay);
            offerDelay += 200; // 每个提议间隔200ms
        }
    },

    /**
     * 手动处理粘贴的应答 (answer) 信息。
     * @param {object} [options={}] - 选项。
     * @param {boolean} [options.isManual=false] - 必须为 true。
     * @returns {Promise<void>}
     */
    handleAnswer: async function (options = {}) {
        const {isManual = false} = options;
        if (!isManual) return; // 只处理手动流程
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴应答信息。", "warning");
            return;
        }
        try {
            const answerData = JSON.parse(sdpTextEl.value); // 解析粘贴的JSON
            sdpTextEl.value = ''; // 清空输入框
            // 校验应答数据格式
            if (!answerData.sdp?.sdp || answerData.sdp.type !== 'answer' || !answerData.userId) {
                NotificationUIManager.showNotification("无效的应答数据格式。", "error");
                return;
            }
            if (answerData.userId === UserManager.userId) { // 不能处理自己的应答
                NotificationUIManager.showNotification("无法处理来自自己的应答。", "warning");
                return;
            }
            const fromUserId = answerData.userId; // 获取应答方ID
            // 将占位符连接替换为真实用户ID的连接
            const placeholderConn = this.connections[this.MANUAL_PLACEHOLDER_PEER_ID];
            if (!placeholderConn?.peerConnection) {
                NotificationUIManager.showNotification(`错误: 未找到待处理的手动提议。`, "error");
                return;
            }
            this.connections[fromUserId] = placeholderConn; // 替换
            delete this.connections[this.MANUAL_PLACEHOLDER_PEER_ID];
            // 迁移相关状态
            ['iceCandidates', 'reconnectAttempts', 'iceTimers', 'iceGatheringStartTimes', 'connectionTimeouts'].forEach(storeKey => {
                if (this[storeKey]?.[this.MANUAL_PLACEHOLDER_PEER_ID]) {
                    this[storeKey][fromUserId] = this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID];
                    delete this[storeKey][this.MANUAL_PLACEHOLDER_PEER_ID];
                }
            });
            const pc = placeholderConn.peerConnection;
            // 检查连接状态
            if (pc.signalingState !== 'have-local-offer') {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) NotificationUIManager.showNotification(`已连接到 ${fromUserId}。`, "info");
                else NotificationUIManager.showNotification(`错误: 与 ${fromUserId} 的连接处于意外状态 (${pc.signalingState})。`, "error");
                ModalUIManager.toggleModal('mainMenuModal', false); // 关闭模态框
                return;
            }

            await this._ensureContactExistsForPeer(fromUserId, true); // 确保联系人存在

            // 处理远程应答
            await this.handleRemoteAnswer(fromUserId, answerData.sdp.sdp, answerData.candidates, placeholderConn.isVideoCall, placeholderConn.isAudioOnly, placeholderConn.isScreenShare, 'answer');
            NotificationUIManager.showNotification(`正在处理来自 ${UserManager.contacts[fromUserId]?.name || fromUserId.substring(0, 6)} 的应答...`, "info");
            ModalUIManager.toggleModal('mainMenuModal', false); // 关闭模态框
        } catch (e) {
            NotificationUIManager.showNotification("处理应答时出错: " + e.message, "error");
            Utils.log("ConnectionManager.handleAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
        }
    },

    /**
     * 处理远程应答 (answer)。
     * @param {string} fromUserId - 发送方的 ID。
     * @param {string} sdpString - SDP 字符串。
     * @param {RTCIceCandidate[]} candidates - 对方的 ICE 候选者。
     * @param {boolean} isVideoCallFlag - 是否为视频通话。
     * @param {boolean} isAudioOnlyFlag - 是否为纯音频通话。
     * @param {boolean} isScreenShareFlag - 是否为屏幕共享。
     * @param {string} sdpType - SDP 类型 (应为 'answer')。
     * @returns {Promise<void>}
     */
    handleRemoteAnswer: async function (fromUserId, sdpString, candidates, isVideoCallFlag, isAudioOnlyFlag, isScreenShareFlag, sdpType) {
        const conn = this.connections[fromUserId];
        if (!conn?.peerConnection) { // 检查连接是否存在
            Utils.log(`ConnectionManager: handleRemoteAnswer: 没有 ${fromUserId} 的活动连接。`, Utils.logLevels.WARN);
            return;
        }
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false; // 是否为静默连接上下文
        if (sdpType !== 'answer') { // 校验SDP类型
            if (!wasSilentContext) NotificationUIManager.showNotification(`协议错误: 应为 answer 类型的 SDP。`, 'error');
            this.close(fromUserId);
            return;
        }
        // 检查信令状态
        if (pc.signalingState !== 'have-local-offer') {
            if (!wasSilentContext) {
                if (pc.signalingState === 'stable' && this.isConnectedTo(fromUserId)) {
                    Utils.log(`ConnectionManager: 与 ${fromUserId} 的连接已稳定。应答可能延迟到达。`, Utils.logLevels.INFO);
                } else {
                    NotificationUIManager.showNotification(`处理 ${fromUserId} 的应答时连接状态错误。状态: ${pc.signalingState}。`, 'error');
                }
            }
            return;
        }
        try {
            if (typeof sdpString !== 'string') { // 校验SDP字符串
                this.close(fromUserId);
                return;
            }
            // 设置远程描述
            await pc.setRemoteDescription(new RTCSessionDescription({type: 'answer', sdp: sdpString}));
            // 添加 ICE 候选者
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object' && pc.remoteDescription && pc.signalingState !== 'closed') {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`ConnectionManager: 为 ${fromUserId} 添加来自应答的远程 ICE 时出错: ${e}`, Utils.logLevels.WARN));
                    }
                }
            }
        } catch (error) {
            Utils.log(`ConnectionManager: 为 ${fromUserId} 设置远程应答/ICE 失败: ${error.message} (状态: ${pc.signalingState})`, Utils.logLevels.ERROR);
            if (!wasSilentContext) NotificationUIManager.showNotification(`处理应答时出错: ${error.message}`, 'error');
            this.close(fromUserId); // 出错时关闭连接
        }
    },

    /**
     * 手动创建应答 (answer)。
     * @param {object} [options={}] - 选项。
     * @param {boolean} [options.isManual=false] - 必须为 true。
     * @returns {Promise<void>}
     */
    createAnswer: async function (options = {}) {
        const {isManual = false} = options;
        if (!isManual) return; // 只处理手动流程
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴提议信息。", "warning");
            return;
        }
        try {
            const offerData = JSON.parse(sdpTextEl.value); // 解析提议数据
            // 校验提议数据格式
            if (!offerData.sdp?.sdp || offerData.sdp.type !== 'offer' || !offerData.userId) {
                NotificationUIManager.showNotification("无效的提议数据格式。", "error");
                return;
            }
            if (offerData.userId === UserManager.userId) { // 不能处理自己的提议
                NotificationUIManager.showNotification("无法处理来自自己的提议。", "warning");
                return;
            }
            const fromUserId = offerData.userId; // 获取提议方ID
            sdpTextEl.value = '正在生成应答...'; // 更新模态框文本
            const pc = this.initConnection(fromUserId, offerData.isVideoCall || false); // 初始化 PeerConnection
            if (!pc) {
                NotificationUIManager.showNotification("初始化连接以创建应答失败。", "error");
                sdpTextEl.value = '错误: 初始化连接失败。';
                return;
            }
            // 更新连接详情
            if (this.connections[fromUserId]) {
                this.connections[fromUserId].wasInitiatedSilently = false; // 手动流程不是静默的
                this.connections[fromUserId].isVideoCall = offerData.isVideoCall || false;
                this.connections[fromUserId].isAudioOnly = offerData.isAudioOnly || false;
                this.connections[fromUserId].isScreenShare = offerData.isScreenShare || false;
            }
            // 处理远程提议
            await this.handleRemoteOffer(fromUserId, offerData.sdp.sdp, offerData.candidates, offerData.isVideoCall, offerData.isAudioOnly, offerData.isScreenShare, 'offer', true);
            NotificationUIManager.showNotification("已开始生成应答。模态框内容将会更新。", "info");
        } catch (e) {
            NotificationUIManager.showNotification("创建应答时出错: " + e.message, "error");
            Utils.log("ConnectionManager.createAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
            if (sdpTextEl) sdpTextEl.value = `错误: ${e.message}`;
        }
    },

    /**
     * 处理远程提议 (offer)。
     * @param {string} fromUserId - 发送方的 ID。
     * @param {string} sdpString - SDP 字符串。
     * @param {RTCIceCandidate[]} candidates - 对方的 ICE 候选者。
     * @param {boolean} isVideoCall - 是否为视频通话。
     * @param {boolean} isAudioOnly - 是否为纯音频通话。
     * @param {boolean} isScreenShare - 是否为屏幕共享。
     * @param {string} sdpType - SDP 类型 (应为 'offer')。
     * @param {boolean} [isManualFlow=false] - 是否为手动流程。
     * @returns {Promise<void>}
     */
    handleRemoteOffer: async function (fromUserId, sdpString, candidates, isVideoCall, isAudioOnly, isScreenShare, sdpType, isManualFlow = false) {
        if (isManualFlow) { // 如果是手动流程，确保联系人存在
            await this._ensureContactExistsForPeer(fromUserId, true);
        }

        let pc = this.connections[fromUserId]?.peerConnection;
        // 如果连接不存在或状态不适合处理提议，则重新初始化
        if (!pc || (!isManualFlow && pc.signalingState !== 'stable' && pc.signalingState !== 'new')) {
            pc = this.initConnection(fromUserId, isVideoCall);
        }
        if (!pc) { // 初始化失败
            NotificationUIManager.showNotification("初始化连接以处理提议失败。", "error");
            return;
        }
        // 更新连接详情
        if (this.connections[fromUserId]) {
            this.connections[fromUserId].wasInitiatedSilently = this.connections[fromUserId].wasInitiatedSilently && !isManualFlow;
            this.connections[fromUserId].isVideoCall = isVideoCall;
            this.connections[fromUserId].isAudioOnly = isAudioOnly;
            this.connections[fromUserId].isScreenShare = isScreenShare || false;
        }
        try {
            // 校验SDP
            if (typeof sdpString !== 'string' || sdpType !== 'offer') {
                this.close(fromUserId);
                return;
            }
            // 设置远程描述
            await pc.setRemoteDescription(new RTCSessionDescription({type: 'offer', sdp: sdpString}));
            // 添加 ICE 候选者
            if (candidates && Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'object' && pc.remoteDescription && pc.signalingState !== 'closed') {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => Utils.log(`ConnectionManager: 为 ${fromUserId} 添加来自提议的远程 ICE 时出错: ${e}`, Utils.logLevels.WARN));
                    }
                }
            }
            // 创建并设置本地应答
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (!pc.localDescription) { // 检查本地描述是否成功设置
                this.close(fromUserId);
                return;
            }
            // 根据流程类型处理应答
            if (isManualFlow) { // 手动流程
                this.waitForIceGatheringComplete(fromUserId, () => {
                    this.updateSdpTextInModal(fromUserId);
                    NotificationUIManager.showNotification("应答已创建。请复制信息并发送。", "info");
                });
            } else { // 自动流程
                const answerPayload = {
                    type: 'ANSWER',
                    userId: UserManager.userId,
                    targetUserId: fromUserId,
                    sdp: pc.localDescription.sdp,
                    sdpType: pc.localDescription.type,
                    isVideoCall: this.connections[fromUserId]?.isVideoCall || false,
                    isAudioOnly: this.connections[fromUserId]?.isAudioOnly || false,
                    isScreenShare: this.connections[fromUserId]?.isScreenShare || false
                };
                this.sendSignalingMessage(answerPayload, false);
            }
        } catch (error) {
            Utils.log(`ConnectionManager: 处理来自 ${fromUserId} 的远程提议失败: ${error.message}\n堆栈: ${error.stack}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`处理提议时出错: ${error.message}`, 'error');
            this.close(fromUserId); // 出错时关闭连接
        }
    },

    /**
     * 处理远程 ICE 候选者。
     * @param {string} fromUserId - 发送方的 ID。
     * @param {RTCIceCandidate} candidate - ICE 候选者对象。
     * @returns {Promise<void>}
     */
    handleRemoteIceCandidate: async function (fromUserId, candidate) {
        const conn = this.connections[fromUserId];
        // 确保连接存在、远程描述已设置且连接未关闭
        if (conn?.peerConnection?.remoteDescription && conn.peerConnection.signalingState !== 'closed') {
            try {
                if (candidate && typeof candidate === 'object' && (candidate.candidate || candidate.sdpMid || candidate.sdpMLineIndex !== undefined)) {
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (error) {
                Utils.log(`ConnectionManager: 添加来自 ${fromUserId} 的远程 ICE 时出错 (状态: ${conn.peerConnection.signalingState}): ${error}`, Utils.logLevels.WARN);
            }
        }
    },

    /**
     * RTCPeerConnection 的 onicecandidate 事件处理器。
     * @param {RTCPeerConnectionIceEvent} event - 事件对象。
     * @param {string} peerId - 相关的对方 ID。
     */
    handleIceCandidate: function (event, peerId) {
        if (event.candidate) { // 如果有候选者
            if (!this.iceCandidates[peerId]) this.iceCandidates[peerId] = []; // 初始化数组
            this.iceCandidates[peerId].push(event.candidate.toJSON()); // 存储候选者
            const connData = this.connections[peerId];
            // 判断是否为手动上下文
            const isManualContext = peerId === this.MANUAL_PLACEHOLDER_PEER_ID ||
                (connData && connData.wasInitiatedSilently === false &&
                 (document.getElementById('modalCreateOfferBtn')?.disabled || document.getElementById('modalCreateAnswerBtn')?.disabled));

            if (!isManualContext && peerId !== this.MANUAL_PLACEHOLDER_PEER_ID) { // 非手动流程，则发送候选者
                const sendSilently = connData?.wasInitiatedSilently || false;
                this.sendSignalingMessage({
                    type: 'ICE_CANDIDATE',
                    userId: UserManager.userId,
                    targetUserId: peerId,
                    candidate: event.candidate.toJSON()
                }, sendSilently);
            }
        }
        // 如果 event.candidate 为 null，表示 ICE 收集完成，在 handleIceGatheringStateChange 中处理
    },

    /**
     * 等待 ICE 收集完成或超时。
     * @param {string} peerId - 相关的对方 ID。
     * @param {function} callback - 完成或超时后执行的回调。
     */
    waitForIceGatheringComplete: function (peerId, callback) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) { // 如果连接不存在，直接回调
            if (typeof callback === 'function') callback();
            return;
        }
        // 清理可能存在的旧定时器
        if (this.iceTimers[peerId]) {
            clearTimeout(this.iceTimers[peerId]);
            delete this.iceTimers[peerId];
        }
        // 如果已完成，直接回调
        if (pc.iceGatheringState === 'complete') {
            if (typeof callback === 'function') callback();
        } else { // 否则设置超时和轮询
            this.iceGatheringStartTimes[peerId] = Date.now(); // 记录开始时间
            let checkInterval;
            const onDone = () => { // 完成处理函数
                if (checkInterval) clearInterval(checkInterval);
                checkInterval = null;
                const timerExists = !!this.iceTimers[peerId]; // 检查定时器是否仍然存在
                if (this.iceTimers[peerId]) {
                    clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                }
                if (typeof callback === 'function' && timerExists) callback(); // 只有在定时器实际存在时才回调
            };
            // 设置超时定时器
            this.iceTimers[peerId] = setTimeout(() => {
                Utils.log(`ConnectionManager: 为 ${peerId} 的 ICE 收集超时。继续执行。状态: ${pc.iceGatheringState}`, Utils.logLevels.WARN);
                onDone();
            }, Config.timeouts.iceGathering);
            // 设置轮询检查状态
            checkInterval = setInterval(() => {
                if (!this.connections[peerId]?.peerConnection) { // 如果连接中途丢失
                    if (checkInterval) clearInterval(checkInterval);
                    if (this.iceTimers[peerId]) clearTimeout(this.iceTimers[peerId]);
                    delete this.iceTimers[peerId];
                    return;
                }
                if (this.connections[peerId].peerConnection.iceGatheringState === 'complete') {
                    onDone(); // 收集完成
                }
            }, 200); // 每200ms检查一次
        }
    },

    /**
     * 设置数据通道的事件处理器。
     * @param {RTCDataChannel} channel - 数据通道对象。
     * @param {string} peerIdArg - 相关的对方 ID。
     */
    setupDataChannel: function (channel, peerIdArg) {
        let currentContextPeerId = peerIdArg; // 当前上下文中的对方ID
        // 如果通道是为手动占位符创建的，则标记它
        if (currentContextPeerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
            Object.defineProperty(channel, '_isManualPlaceholderOrigin', { value: true, writable: false, configurable: true });
        }

        const connDetails = this.connections[currentContextPeerId];
        if (!connDetails) { // 如果连接详情不存在，则关闭通道
            Utils.log(`setupDataChannel: 连接详情 ${currentContextPeerId} 不存在，关闭通道 ${channel.label}。`, Utils.logLevels.WARN);
            try { channel.close(); } catch (e) { /*忽略关闭错误*/ }
            return;
        }

        // 防止重复绑定监听器
        if (channel._cmListenersAttached) {
            Utils.log(`setupDataChannel: 通道 ${channel.label} (for ${currentContextPeerId}) 的监听器已设置。跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        // 如果已存在一个活跃的数据通道，则关闭新的通道
        if (connDetails.dataChannel && connDetails.dataChannel !== channel && connDetails.dataChannel.readyState === 'open') {
            Utils.log(`setupDataChannel: ${currentContextPeerId} 已存在活跃数据通道。关闭新通道 ${channel.label}。`, Utils.logLevels.WARN);
            try { channel.close(); } catch (e) { /*忽略关闭错误*/ }
            return;
        }

        connDetails.dataChannel = channel; // 存储数据通道
        // 标记监听器已附加，并跟踪 onopen 是否已执行，以防止竞争条件下的重复处理
        Object.defineProperty(channel, '_cmListenersAttached', { value: true, writable: true, configurable: true });
        Object.defineProperty(channel, '_cmHasOpened', { value: false, writable: true, configurable: true });

        Utils.log(`setupDataChannel: 正在为通道 ${channel.label} (for ${currentContextPeerId}) 设置事件监听器。`, Utils.logLevels.DEBUG);

        channel.onopen = async () => {
            if (channel._cmHasOpened) { // 如果 onopen 已处理过，则忽略
                Utils.log(`setupDataChannel: 通道 ${channel.label} (for ${currentContextPeerId}) 的 onopen 已处理过。忽略重复触发。`, Utils.logLevels.DEBUG);
                return;
            }
            channel._cmHasOpened = true; // 标记已处理

            try {
                let finalPeerId = currentContextPeerId; // 最终确定的对方ID
                const isPlaceholderOrigin = !!channel._isManualPlaceholderOrigin;

                // 如果通道源于占位符且当前ID仍是占位符，则尝试解析真实ID
                if (isPlaceholderOrigin && currentContextPeerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
                    Utils.log(`ConnectionManager: DataChannel onopen: 通道源于占位符，但 currentContextPeerId 仍是占位符。`, Utils.logLevels.WARN);
                    let resolved = false;
                    for (const actualIdInMap in this.connections) { // 遍历所有连接查找匹配的通道
                        if (this.connections[actualIdInMap]?.dataChannel === channel && actualIdInMap !== this.MANUAL_PLACEHOLDER_PEER_ID) {
                            finalPeerId = actualIdInMap;
                            resolved = true;
                            Utils.log(`ConnectionManager: DataChannel onopen: 占位符通道成功解析为 ${finalPeerId}。`, Utils.logLevels.DEBUG);
                            break;
                        }
                    }
                    if (!resolved) { // 如果无法解析，则记录错误并返回
                        Utils.log(`ConnectionManager: DataChannel onopen: 无法从占位符通道解析出真实 peerId。`, Utils.logLevels.ERROR);
                        return;
                    }
                } else {
                    finalPeerId = currentContextPeerId; // ID已经是（推测）正确的
                }


                const logPeerIdForOpen = finalPeerId;
                Utils.log(`ConnectionManager: 与 ${logPeerIdForOpen} 的数据通道 ("${channel.label}") 已打开。(静默: ${this.connections[logPeerIdForOpen]?.wasInitiatedSilently || false}, 占位符源: ${isPlaceholderOrigin})`, Utils.logLevels.INFO);

                const contactName = UserManager.contacts[logPeerIdForOpen]?.name || logPeerIdForOpen.substring(0, 8) + '...';
                // 更新聊天头部状态
                if (this.connections[logPeerIdForOpen] && (!this.connections[logPeerIdForOpen].wasInitiatedSilently || ChatManager.currentChatId === logPeerIdForOpen) && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.updateChatHeaderStatus(`已连接到 ${contactName}`);
                }

                await this._ensureContactExistsForPeer(finalPeerId, isPlaceholderOrigin); // 确保联系人存在

                // 如果是手动连接且已解析ID，且当前无聊天或聊天为占位符，则打开新聊天
                if (isPlaceholderOrigin && logPeerIdForOpen !== UserManager.userId && logPeerIdForOpen !== this.MANUAL_PLACEHOLDER_PEER_ID &&
                    (ChatManager.currentChatId === null || ChatManager.currentChatId === this.MANUAL_PLACEHOLDER_PEER_ID )) {
                    ChatManager.openChat(logPeerIdForOpen, 'contact');
                }

                EventEmitter.emit('connectionEstablished', logPeerIdForOpen); // 触发连接建立事件
                // 更新通话按钮状态
                if (this.connections[logPeerIdForOpen] && ChatManager.currentChatId === logPeerIdForOpen && !this.connections[logPeerIdForOpen].isVideoCall && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setCallButtonsState(true, logPeerIdForOpen);
                }
                // 重置重连尝试次数
                if (this.reconnectAttempts[logPeerIdForOpen] !== undefined) {
                    this.reconnectAttempts[logPeerIdForOpen] = 0;
                }
            } catch (e) { // 处理 onopen 内部的错误
                let finalPeerIdForError = currentContextPeerId; // 回退ID
                if (channel._isManualPlaceholderOrigin) { // 再次尝试解析ID以用于日志
                    for (const actualIdInMap in this.connections) {
                        if (this.connections[actualIdInMap]?.dataChannel === channel) {
                            finalPeerIdForError = actualIdInMap; break;
                        }
                    }
                }
                Utils.log(`ConnectionManager: 与 ${finalPeerIdForError} 的数据通道 ("${channel.label}") 的 onopen 处理程序中发生错误: ${e.message}\nStack: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };

        channel.onclose = () => { // 数据通道关闭时
            let finalPeerId = currentContextPeerId;
            const isPlaceholderOrigin = !!channel._isManualPlaceholderOrigin;
            if (isPlaceholderOrigin) { // 尝试解析ID
                for (const actualId in this.connections) {
                    if (this.connections[actualId]?.dataChannel === channel) {
                        finalPeerId = actualId; break;
                    }
                }
            }

            Utils.log(`ConnectionManager: 通道 ${channel.label} (for ${finalPeerId}) onclose 触发。`, Utils.logLevels.DEBUG);
            channel._cmHasOpened = false; // 重置 onopen 状态
            channel._cmListenersAttached = false; // 重置监听器附加状态

            const pcState = this.connections[finalPeerId]?.peerConnection?.connectionState;
            if (pcState !== 'closed' && pcState !== 'failed') { // 如果不是因为PC关闭/失败导致的通道关闭
                EventEmitter.emit('connectionDisconnected', finalPeerId); // 触发断开连接事件
            }
            // 更新UI状态
            if (ChatManager.currentChatId === finalPeerId && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.setCallButtonsState(false);
                if (this.connections[finalPeerId] && !this.connections[finalPeerId].wasInitiatedSilently) {
                    ChatAreaUIManager.updateChatHeaderStatus(`已断开连接`);
                }
            }
            // 清理数据通道引用
            if (this.connections[finalPeerId]?.dataChannel === channel) {
                this.connections[finalPeerId].dataChannel = null;
            }
        };

        channel.onerror = (errorEvent) => { // 数据通道发生错误时
            let finalPeerId = currentContextPeerId; // 回退ID
            if (channel._isManualPlaceholderOrigin) { // 尝试解析ID
                for (const actualIdInMap in this.connections) {
                    if (this.connections[actualIdInMap]?.dataChannel === channel) {
                        finalPeerId = actualIdInMap; break;
                    }
                }
            }
            Utils.log(`ConnectionManager: 通道 ${channel.label} (for ${finalPeerId}) onerror 触发。Error event: ${JSON.stringify(errorEvent, Object.getOwnPropertyNames(errorEvent))}`, Utils.logLevels.ERROR);
            Utils.log(`ConnectionManager: 通道 ${channel.label} 当前状态: ${channel.readyState}`, Utils.logLevels.DEBUG);
        };

        channel.onmessage = (event) => { // 收到数据通道消息时
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) { // 尝试解析ID
                let resolved = false;
                for (const actualId in this.connections) {
                    if (this.connections[actualId]?.dataChannel === channel) {
                        finalPeerId = actualId; resolved = true; break;
                    }
                }
                if (!resolved) { // 如果无法解析，则忽略消息
                    Utils.log(`ConnectionManager: DataChannel onmessage (通道源 ${currentContextPeerId}): 无法解析真实 peerId。忽略消息。`, Utils.logLevels.WARN);
                    return;
                }
            }

            // 如果通道未打开，则忽略消息
            if (channel.readyState !== 'open') {
                Utils.log(`ConnectionManager: 通道 ${channel.label} (for ${finalPeerId}) 收到消息，但状态为 ${channel.readyState}。忽略。`, Utils.logLevels.WARN);
                return;
            }

            try {
                const rawMessage = event.data;
                let messageObjectToProcess;
                let parsedJson;

                if (typeof rawMessage === 'string') { // 如果是字符串数据
                    try {
                        parsedJson = JSON.parse(rawMessage); // 尝试解析为JSON
                    } catch (e) { // 如果解析失败，则视为普通文本消息
                        messageObjectToProcess = {
                            type: 'text',
                            content: rawMessage,
                            sender: finalPeerId,
                            timestamp: new Date().toISOString(),
                            id: `text_${Date.now()}_${Utils.generateId(3)}`
                        };
                    }
                } else { // 不支持非字符串数据
                    Utils.log(`ConnectionManager: 收到来自 ${finalPeerId} 的非字符串数据类型，当前不支持。`, Utils.logLevels.WARN);
                    return;
                }

                if (parsedJson) { // 如果成功解析为JSON
                    if (parsedJson.type === 'chunk-meta' || parsedJson.type === 'chunk-data') { // 处理分片消息
                        const reassembledData = Utils.reassembleChunk(parsedJson, finalPeerId);
                        if (reassembledData) { // 如果分片重组完成
                            messageObjectToProcess = reassembledData;
                            // 再次检查重组后的数据类型，特别是撤回请求
                            if (messageObjectToProcess.type === 'retract-message-request') {
                                Utils.log(`ConnectionManager: (重组后) 收到来自 ${finalPeerId} 的消息撤回请求: ${JSON.stringify(messageObjectToProcess)}`, Utils.logLevels.INFO);
                                const senderName = messageObjectToProcess.senderName || UserManager.contacts[messageObjectToProcess.sender]?.name || `用户 ${String(messageObjectToProcess.sender).substring(0, 4)}`;
                                MessageManager._updateMessageToRetractedState(messageObjectToProcess.originalMessageId, messageObjectToProcess.sender, false, senderName);
                                // 向对方发送撤回确认
                                ConnectionManager.sendTo(messageObjectToProcess.sender, {
                                    type: 'retract-message-confirm',
                                    originalMessageId: messageObjectToProcess.originalMessageId,
                                    sender: UserManager.userId
                                });
                                return; // 处理完毕
                            }
                        } else {
                            return; // 分片未完成，等待后续分片
                        }
                    } else if (parsedJson.type === 'retract-message-request') { // 处理非分片的撤回请求
                        Utils.log(`ConnectionManager: 收到来自 ${finalPeerId} 的消息撤回请求: ${JSON.stringify(parsedJson)}`, Utils.logLevels.INFO);
                        const senderName = parsedJson.senderName || UserManager.contacts[parsedJson.sender]?.name || `用户 ${String(parsedJson.sender).substring(0, 4)}`;
                        MessageManager._updateMessageToRetractedState(parsedJson.originalMessageId, parsedJson.sender, false, senderName);
                        ConnectionManager.sendTo(parsedJson.sender, {
                            type: 'retract-message-confirm',
                            originalMessageId: parsedJson.originalMessageId,
                            sender: UserManager.userId
                        });
                        return;
                    } else if (parsedJson.type === 'retract-message-confirm') { // 处理撤回确认
                        Utils.log(`ConnectionManager: 收到来自 ${finalPeerId} 的消息撤回确认 (ID: ${parsedJson.originalMessageId})。本地UI已乐观更新。`, Utils.logLevels.INFO);
                        return;
                    } else { // 其他类型的JSON消息
                        messageObjectToProcess = parsedJson;
                    }
                }

                if (!messageObjectToProcess) { // 如果无法确定消息对象
                    Utils.log(`ConnectionManager: 来自 ${finalPeerId} 的数据通道 onmessage：无法确定消息对象。原始数据: ${String(rawMessage).substring(0, 100)}`, Utils.logLevels.WARN);
                    return;
                }

                // 确保消息有发送者和ID
                messageObjectToProcess.sender = messageObjectToProcess.sender || finalPeerId;
                if (!messageObjectToProcess.id) messageObjectToProcess.id = `msg_${Date.now()}_${Utils.generateId(4)}`;

                // 根据消息类型分发处理
                if (messageObjectToProcess.type?.startsWith('video-call-')) { // 视频通话相关消息
                    VideoCallManager.handleMessage(messageObjectToProcess, finalPeerId);
                } else if (messageObjectToProcess.groupId || messageObjectToProcess.type?.startsWith('group-')) { // 群组相关消息
                    GroupManager.handleGroupMessage(messageObjectToProcess);
                } else { // 普通聊天消息
                    ChatManager.addMessage(finalPeerId, messageObjectToProcess);
                }
            } catch (e) {
                Utils.log(`ConnectionManager: 来自 ${finalPeerId} 的数据通道 onmessage 严重错误: ${e.message}. 数据: ${String(event.data).substring(0, 100)} 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    /**
     * 处理 iceConnectionState 变化。
     * @param {string} peerId - 相关的对方 ID。
     */
    handleIceConnectionStateChange: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`ConnectionManager: ICE 连接状态 for ${peerId} 变为: ${pc.iceConnectionState}`, Utils.logLevels.DEBUG);
        switch (pc.iceConnectionState) {
            case 'connected': // ICE 连接成功 (但媒体可能仍在协商)
            case 'completed': // ICE 协商完成
                if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0; // 重置重连尝试
                break;
            case 'disconnected': // ICE 连接断开
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) this.attemptReconnect(peerId); // 如果不是视频通话，尝试重连
                break;
            case 'failed': // ICE 连接失败
                if (!wasSilentContext) NotificationUIManager.showNotification(`与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)} 的连接失败。`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false); // 关闭连接
                break;
            case 'closed': // ICE 连接已关闭
                if (this.connections[peerId]) this.close(peerId, false); // 确保本地状态同步
                break;
        }
    },

    /**
     * 处理 connectionState 变化 (更新的 API)。
     * @param {string} peerId - 相关的对方 ID。
     */
    handleRtcConnectionStateChange: function (peerId) {
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return;
        const pc = conn.peerConnection;
        const wasSilentContext = conn.wasInitiatedSilently || false;
        Utils.log(`ConnectionManager: RTC 连接状态 for ${peerId} 变为: ${pc.connectionState}`, Utils.logLevels.DEBUG);
        switch (pc.connectionState) {
            case "connected": // 连接成功
                if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0; // 重置重连尝试
                // 确保在媒体流和数据通道都准备好后才触发 connectionEstablished
                if ((conn.isVideoCall || (conn.dataChannel?.readyState === 'open')) && !conn._emittedEstablished) {
                    EventEmitter.emit('connectionEstablished', peerId);
                    conn._emittedEstablished = true; // 标记已触发，避免重复
                }
                break;
            case "disconnected": // 连接断开
                EventEmitter.emit('connectionDisconnected', peerId);
                if (!conn.isVideoCall) this.attemptReconnect(peerId); // 尝试重连
                conn._emittedEstablished = false; // 重置标记
                break;
            case "failed": // 连接失败
                if (!wasSilentContext) NotificationUIManager.showNotification(`与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)} 的连接严重失败。`, 'error');
                EventEmitter.emit('connectionFailed', peerId);
                this.close(peerId, false); // 关闭连接
                conn._emittedEstablished = false;
                break;
            case "closed": // 连接已关闭
                if(conn) conn._emittedEstablished = false;
                if (this.connections[peerId]) { // 如果本地仍有记录，则清理
                    Utils.log(`handleRtcConnectionStateChange: ${peerId} is 'closed', ensuring local state cleanup.`, Utils.logLevels.DEBUG);
                    // this.close(peerId, false); // close 方法会处理删除 this.connections[peerId]
                }
                break;
        }
    },

    /**
     * 尝试重新连接断开的对等端。
     * @param {string} peerId - 要重连的对方 ID。
     */
    attemptReconnect: function (peerId) {
        const conn = this.connections[peerId];
        // 如果连接不存在、是视频通话、已连接或正在连接，则不重连
        if (!conn || conn.isVideoCall || this.isConnectedTo(peerId) || conn.peerConnection?.connectionState === 'connecting') return;
        this.reconnectAttempts[peerId] = (this.reconnectAttempts[peerId] || 0) + 1; // 增加尝试次数
        if (this.reconnectAttempts[peerId] <= Config.reconnect.maxAttempts) { // 检查是否超过最大尝试次数
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId] - 1); // 计算延迟
            if (this.connectionTimeouts[peerId]) clearTimeout(this.connectionTimeouts[peerId]); // 清理旧的超时
            this.connectionTimeouts[peerId] = setTimeout(async () => {
                delete this.connectionTimeouts[peerId]; // 删除超时记录
                const currentConn = this.connections[peerId];
                // 再次检查连接状态，确保在尝试重连前状态仍然是断开的
                if (currentConn && !this.isConnectedTo(peerId) && currentConn.peerConnection &&
                    currentConn.peerConnection.connectionState !== 'connecting' &&
                    currentConn.peerConnection.signalingState !== 'have-local-offer' &&
                    currentConn.peerConnection.signalingState !== 'have-remote-offer') {
                    // 如果连接已失败、关闭或断开，则先关闭旧连接
                    if (['failed', 'closed', 'disconnected'].includes(currentConn.peerConnection.connectionState)) {
                        this.close(peerId, false);
                    }
                    await this.createOffer(peerId, {isSilent: true}); // 静默创建提议
                } else if (this.isConnectedTo(peerId)) { // 如果在等待期间已重新连接
                    if (this.reconnectAttempts[peerId] !== undefined) this.reconnectAttempts[peerId] = 0; // 重置尝试次数
                }
            }, delay);
        } else { // 达到最大尝试次数
            this.close(peerId, false); // 关闭连接
        }
    },

    /**
     * 通过数据通道向指定对等端发送消息，并处理分片逻辑。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} messageObject - 要发送的消息对象。
     * @returns {boolean} - 消息是否成功（排入）发送。
     */
    sendTo: function (peerId, messageObject) {
        const conn = this.connections[peerId];
        if (conn?.dataChannel?.readyState === 'open') { // 检查数据通道是否打开
            try {
                // 确保消息有发送者和时间戳
                messageObject.sender = messageObject.sender || UserManager.userId;
                messageObject.timestamp = messageObject.timestamp || new Date().toISOString();
                const messageString = JSON.stringify(messageObject);

                if (messageString.length > Config.chunkSize) { // 如果消息大于分片大小
                    Utils.sendInChunks(
                        messageString,
                        conn.dataChannel, // 传递 dataChannel 对象
                        peerId,
                        // 为文件或音频消息提供文件ID，否则为undefined
                        (messageObject.type === 'file' || messageObject.type === 'audio') ? (messageObject.fileId || messageObject.fileName || `blob-${Date.now()}`) : undefined
                    );
                } else { // 直接发送小消息
                    conn.dataChannel.send(messageString);
                }
                return true;
            } catch (error) {
                Utils.log(`ConnectionManager: 通过数据通道向 ${peerId} 发送时出错: ${error.message}`, Utils.logLevels.ERROR);
                // 处理发送队列已满的错误
                if (error.name === 'OperationError' && error.message.includes('send queue is full')) {
                    Utils.log(`ConnectionManager: RTCDataChannel send queue is full for ${peerId}. Message size: ${messageString.length}. Buffered: ${conn.dataChannel.bufferedAmount}`, Utils.logLevels.WARN);
                }
                return false;
            }
        } else {
            Utils.log(`ConnectionManager: 无法发送到 ${peerId}: 数据通道未打开/不存在。DC: ${conn?.dataChannel?.readyState}, PC: ${conn?.peerConnection?.connectionState}`, Utils.logLevels.WARN);
            return false;
        }
    },

    /**
     * 检查是否与指定对等端建立了有效连接。
     * @param {string} peerId - 要检查的对方 ID。
     * @returns {boolean} - 是否已连接。
     */
    isConnectedTo: function (peerId) {
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) return true; // AI 联系人视为始终连接
        const conn = this.connections[peerId];
        if (!conn?.peerConnection) return false; // 连接不存在
        const pcOverallState = conn.peerConnection.connectionState;
        if (pcOverallState === 'connected') { // 如果 PeerConnection 已连接
            // 对于视频通话，或数据通道已打开，则视为已连接
            if (conn.isVideoCall || (conn.dataChannel?.readyState === 'open')) return true;
        }
        return false;
    },

    /**
     * 关闭与指定对等端的连接。
     * @param {string} peerId - 要关闭连接的对方 ID。
     * @param {boolean} [notifyPeer=true] - 是否通知对方连接已关闭（当前未使用）。
     */
    close: function (peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn) {
            Utils.log(`ConnectionManager: 正在关闭与 ${peerId} 的连接。通知: ${notifyPeer}`, Utils.logLevels.INFO);
            // 清理各种定时器
            if (this.connectionTimeouts[peerId]) {
                clearTimeout(this.connectionTimeouts[peerId]);
                delete this.connectionTimeouts[peerId];
            }
            if (this.iceTimers[peerId]) {
                clearTimeout(this.iceTimers[peerId]);
                delete this.iceTimers[peerId];
            }
            // 关闭数据通道
            if (conn.dataChannel) {
                try {
                    // 标记监听器已分离
                    if (conn.dataChannel._cmListenersAttached) conn.dataChannel._cmListenersAttached = false;
                    if (conn.dataChannel._cmHasOpened) conn.dataChannel._cmHasOpened = false;

                    // 清理事件处理器
                    conn.dataChannel.onopen = null;
                    conn.dataChannel.onmessage = null;
                    conn.dataChannel.onerror = null;
                    const originalOnClose = conn.dataChannel.onclose; // 保存原始 onclose
                    conn.dataChannel.onclose = () => { // 包装 onclose
                        Utils.log(`DataChannel for ${peerId} explicitly closed.`, Utils.logLevels.DEBUG);
                        if (typeof originalOnClose === 'function') originalOnClose();
                    };
                    if (conn.dataChannel.readyState !== 'closed') {
                        conn.dataChannel.close(); // 关闭通道
                    }
                } catch (e) {
                    Utils.log(`ConnectionManager: 关闭数据通道 for ${peerId} 时出错: ${e.message}`, Utils.logLevels.WARN);
                }
            }
            // 关闭 PeerConnection
            if (conn.peerConnection) {
                try {
                    // 清理事件处理器
                    conn.peerConnection.onicecandidate = null;
                    conn.peerConnection.onicegatheringstatechange = null;
                    conn.peerConnection.oniceconnectionstatechange = null;
                    conn.peerConnection.onconnectionstatechange = null;
                    conn.peerConnection.ondatachannel = null;
                    conn.peerConnection.ontrack = null;
                    if (conn.peerConnection.signalingState !== 'closed') {
                        conn.peerConnection.close(); // 关闭 PeerConnection
                    }
                } catch (e) {
                    Utils.log(`ConnectionManager: 关闭 PeerConnection for ${peerId} 时出错: ${e.message}`, Utils.logLevels.WARN);
                }
            }
            // 清理本地存储
            delete this.connections[peerId];
            delete this.iceCandidates[peerId];
            delete this.reconnectAttempts[peerId];
            delete this.iceGatheringStartTimes[peerId];
            // 更新UI
            if (ChatManager.currentChatId === peerId && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.updateChatHeaderStatus(`已与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)}... 断开连接`);
                ChatAreaUIManager.setCallButtonsState(false);
            }
            EventEmitter.emit('connectionClosed', peerId); // 触发连接关闭事件
        } else {
            Utils.log(`ConnectionManager: 尝试关闭与 ${peerId} 的连接，但未找到连接对象。`, Utils.logLevels.DEBUG);
        }
    },

    /**
     * 仅关闭 PeerConnection（通常由 VideoCallManager 调用）。
     * 不会立即清理数据通道或完整的连接记录。
     * @param {string} peerId - 目标对方ID。
     */
    closePeerConnection: function(peerId) {
        const conn = this.connections[peerId];
        if (conn && conn.peerConnection && conn.peerConnection.signalingState !== 'closed') {
            Utils.log(`ConnectionManager: 明确关闭 PeerConnection for ${peerId} (媒体部分)。`, Utils.logLevels.INFO);
            try {
                conn.peerConnection.close();
            } catch (e) {
                Utils.log(`ConnectionManager: 关闭 PeerConnection for ${peerId} (媒体部分) 时出错: ${e.message}`, Utils.logLevels.WARN);
            }
        } else {
            Utils.log(`ConnectionManager: 尝试关闭 PeerConnection for ${peerId} (媒体部分)，但未找到 PC 或已关闭。`, Utils.logLevels.DEBUG);
        }
    },

    /**
     * 在模态框中更新手动连接的 SDP 文本。
     * @param {string} peerIdToGetSdpFrom - 要获取 SDP 的对方 ID。
     */
    updateSdpTextInModal: function (peerIdToGetSdpFrom) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;
        const conn = this.connections[peerIdToGetSdpFrom];
        const pc = conn?.peerConnection;
        if (pc?.localDescription) { // 如果有本地描述
            const sdpType = pc.localDescription.type;
            // 构建包含 SDP 和 ICE 候选者的连接信息对象
            const connectionInfo = {
                sdp: {type: sdpType, sdp: pc.localDescription.sdp},
                candidates: this.iceCandidates[peerIdToGetSdpFrom] || [],
                userId: UserManager.userId,
                isVideoCall: conn?.isVideoCall || false,
                isAudioOnly: conn?.isAudioOnly || false,
                isScreenShare: conn?.isScreenShare || false
            };
            sdpTextEl.value = JSON.stringify(connectionInfo, null, 2); // 格式化为JSON字符串
        } else { // 如果本地描述不存在
            sdpTextEl.value = `正在为 ${peerIdToGetSdpFrom} 生成 ${pc?.localDescription ? pc.localDescription.type : '信息'}... (ICE状态: ${pc?.iceGatheringState})`;
        }
    },

    /**
     * 处理 iceGatheringState 变化。
     * @param {string} peerId - 相关的对方 ID。
     */
    handleIceGatheringStateChange: function (peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;
        Utils.log(`ConnectionManager: ICE 收集状态 for ${peerId} 变为: ${pc.iceGatheringState}`, Utils.logLevels.DEBUG);
        if (pc.iceGatheringState === 'gathering' && !this.iceGatheringStartTimes[peerId]) {
            this.iceGatheringStartTimes[peerId] = Date.now(); // 记录开始时间
        } else if (pc.iceGatheringState === 'complete') { // 收集完成
            const duration = (Date.now() - (this.iceGatheringStartTimes[peerId] || Date.now())) / 1000;
            Utils.log(`ConnectionManager: 为 ${peerId} 的 ICE 收集完成，耗时 ${duration}秒。候选者数量: ${this.iceCandidates[peerId]?.length || 0}`, Utils.logLevels.DEBUG);
            delete this.iceGatheringStartTimes[peerId]; // 清理开始时间记录
            // 注意: 实际发送ICE候选者是在 onicecandidate 事件中处理的
        }
    },
};