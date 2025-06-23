
/**
 * @file ConnectionManager.js
 * @description 核心连接管理器，协调 WebSocket, WebRTC 和数据通道处理。
 * @module ConnectionManager
 * @exports {object} ConnectionManager - 对外暴露的单例对象。
 * @property {function} initialize - 初始化所有底层连接管理器。
 * @property {function} createOffer - 发起一个 WebRTC 连接提议。
 * @property {function} sendTo - 通过数据通道发送应用层消息。
 * @property {function} close - 关闭与指定对等端的连接。
 * @property {boolean} isWebSocketConnected - WebSocket 连接状态。
 * @dependencies UserManager, ..., WebSocketManager, WebRTCManager, DataChannelHandler
 */
const ConnectionManager = {
    // 状态 pendingSentChunks 和 pendingReceivedChunks 仍然保留在这里，因为 Utils.sendInChunks/reassembleChunk 依赖它们。
    // 这是一个可以后续优化的点，将分片状态和逻辑完全内聚到 DataChannelHandler。
    pendingSentChunks: {},
    pendingReceivedChunks: {},
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

    /**
     * @private (保留)
     */
    _ensureContactExistsForPeer: async function (peerId, isManualContextOrPlaceholderOrigin = false) {
        // ... (代码同第2部分)
        if (!isManualContextOrPlaceholderOrigin && peerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
            Utils.log(`ConnectionManager._ensureContactExistsForPeer: 跳过为占位符ID ${peerId} 创建联系人 (非手动/占位符起源上下文)。`, Utils.logLevels.DEBUG);
            return;
        }
        if (peerId && peerId !== UserManager.userId &&
            (peerId !== this.MANUAL_PLACEHOLDER_PEER_ID || isManualContextOrPlaceholderOrigin) &&
            !UserManager.contacts[peerId]) {
            try {
                await UserManager.addContact(peerId, `用户 ${peerId.substring(0, 4)}`, false);
                Utils.log(`ConnectionManager: 自动为新的连接对方 ${peerId} 创建了联系人记录。`, Utils.logLevels.INFO);
            } catch (error) {
                Utils.log(`ConnectionManager: 自动为 ${peerId} 创建联系人时出错: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    /**
     * 初始化连接管理器。
     * @returns {Promise<void>} - A promise from WebSocketManager.init().
     */
    initialize: function () {
        WebRTCManager.init(
            (type, targetPeerId, payload, candidates, isSilent) => { // WebRTC 信令发送回调
                if (type === 'manual_offer_ready' || type === 'manual_answer_ready') {
                    const sdpData = {
                        sdp: {type: payload.sdpType, sdp: payload.sdp},
                        candidates: candidates || [], userId: UserManager.userId,
                        isVideoCall: payload.isVideoCall, isAudioOnly: payload.isAudioOnly,
                        isScreenShare: payload.isScreenShare
                    };
                    this.updateSdpTextInModal(targetPeerId, sdpData);
                } else {
                    let msg;
                    if (type === 'OFFER' || type === 'ANSWER') { // OFFER and ANSWER have payload with sdp, sdpType, etc.
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, ...payload};
                    } else if (type === 'ICE_CANDIDATE') {
                        // For ICE_CANDIDATE, payload IS the candidate object itself
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, candidate: payload};
                    } else {
                        // Fallback for any other types, though not typically expected from WebRTCManager for direct WS sending
                        // This case might need review if other types are introduced.
                        Utils.log(`ConnectionManager: _signalingSender received unexpected type '${type}' from WebRTCManager. Using generic spread.`, Utils.logLevels.WARN);
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, ...payload};
                    }
                    WebSocketManager.sendRawMessage(msg, isSilent);
                }
            },
            (channel, peerId, isManualPlaceholderOrigin) => { // WebRTC 数据通道就绪回调
                const connectionEntry = WebRTCManager.connections[peerId];
                DataChannelHandler.setupChannel(channel, peerId, isManualPlaceholderOrigin, connectionEntry);
            }
        );

        return WebSocketManager.init( // Return the promise from WebSocketManager.init
            (message) => this.handleSignalingMessage(message), // WebSocket 消息回调
            (isConnected) => { // WebSocket 状态变更回调
                if (isConnected) {
                    WebSocketManager.sendRawMessage({type: 'REGISTER', userId: UserManager.userId}, false);
                }
            }
        );
    },

    get isWebSocketConnected() {
        return WebSocketManager.isWebSocketConnected;
    },
    handleSignalingMessage: function (message) {
        Utils.log(`ConnectionManager: 已收到 WS (经WebSocketManager): ${message.type} 来自 ${message.fromUserId || '服务器'}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;
        switch (message.type) {
            case 'SUCCESS':
                LayoutUIManager.updateConnectionStatusIndicator(`用户注册成功: ${UserManager.userId.substring(0, 8)}...`);
                this.autoConnectToContacts();
                break;
            case 'ERROR':
                if (!message.message.includes('不在线')) NotificationUIManager.showNotification(`信令错误: ${message.message}`, 'error');
                Utils.log(`ConnectionManager: 信令服务器错误: ${message.message}`, Utils.logLevels.ERROR);
                break;
            case 'OFFER':
                WebRTCManager.handleRemoteOffer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ANSWER':
                WebRTCManager.handleRemoteAnswer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ICE_CANDIDATE':
                WebRTCManager.addRemoteIceCandidate(fromUserId, message.candidate);
                break;
            case 'USER_NOT_FOUND':
                const connDetails = WebRTCManager.connections[message.targetUserId];
                const wasSilentAttempt = connDetails?.wasInitiatedSilently || false;
                if (!wasSilentAttempt) NotificationUIManager.showNotification(`用户 ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0, 8) + '...'} 未找到或离线。`, 'warning');
                if (ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt && typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.updateChatHeaderStatus(`用户未找到或离线`);
                if (WebRTCManager.connections[message.targetUserId]) this.close(message.targetUserId, false);
                break;
            default:
                Utils.log('ConnectionManager: 未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    createOffer: async function (targetPeerId = null, options = {}) { /* ... (同第2部分，调用 WebRTCManager) ... */
        const {isSilent = false, isManual = false} = options;
        let finalTargetPeerId = targetPeerId;

        if (isManual) {
            finalTargetPeerId = WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID;
        } else {
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                return;
            }
            if (!targetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) {
                finalTargetPeerId = ChatManager.currentChatId;
            }
            if (!finalTargetPeerId && !isSilent) {
                const userInputId = prompt('请输入对方 ID:');
                if (!userInputId) {
                    NotificationUIManager.showNotification("已取消: 未提供对方 ID。", "info");
                    return;
                }
                finalTargetPeerId = userInputId;
            } else if (!finalTargetPeerId && isSilent) {
                Utils.log("ConnectionManager: 静默创建提议时缺少目标 ID。", Utils.logLevels.WARN);
                return;
            }

            if (finalTargetPeerId === UserManager.userId) {
                return;
            }
            if (!UserManager.userId) {
                return;
            }
            if (!this.isWebSocketConnected) {
                try {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器未连接。正在尝试...", "info");
                    await WebSocketManager.connect();
                    if (this.isWebSocketConnected) WebSocketManager.sendRawMessage({type: 'REGISTER', userId: UserManager.userId}, false);
                } catch (e) {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器连接失败。无法创建提议。", "error");
                    return;
                }
                if (!this.isWebSocketConnected) {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器连接仍然失败。", "error");
                    return;
                }
            }
        }
        await WebRTCManager.createOffer(finalTargetPeerId, options);
    },
    autoConnectToContacts: async function () { /* ... (同第2部分，调用 WebRTCManager) ... */
        Utils.log("ConnectionManager: 尝试自动连接到联系人...", Utils.logLevels.INFO);
        const fetchSuccess = await PeopleLobbyManager.fetchOnlineUsers();
        if (!fetchSuccess) {
            Utils.log("ConnectionManager: 获取在线用户列表失败。", Utils.logLevels.WARN);
            return;
        }
        const onlineUserIdsFromLobby = new Set(PeopleLobbyManager.onlineUserIds || []);
        if (onlineUserIdsFromLobby.size === 0) {
            Utils.log("ConnectionManager: 大厅中没有其他在线用户。", Utils.logLevels.INFO);
            return;
        }
        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) {
            Utils.log("ConnectionManager: 没有可自动连接的联系人。", Utils.logLevels.INFO);
            return;
        }

        let offerDelay = 0;
        const contactsToPotentiallyConnect = [];
        for (const contactId of Object.keys(UserManager.contacts)) {
            if (contactId === UserManager.userId) continue;
            const contact = UserManager.contacts[contactId];
            if (contact && contact.isAI) continue;
            if (WebRTCManager.isConnectedTo(contactId)) continue;
            const existingConn = WebRTCManager.connections[contactId];
            if (existingConn?.peerConnection && (existingConn.peerConnection.signalingState !== 'closed' && existingConn.peerConnection.signalingState !== 'failed')) continue; // 简化：如果PC存在且没关闭/失败，则跳过
            contactsToPotentiallyConnect.push(contactId);
        }
        const contactsToConnect = contactsToPotentiallyConnect.filter(id => onlineUserIdsFromLobby.has(id));
        if (contactsToConnect.length === 0) {
            Utils.log("ConnectionManager: 没有符合自动连接条件的在线联系人。", Utils.logLevels.INFO);
            return;
        }
        Utils.log(`ConnectionManager: 找到 ${contactsToConnect.length} 个在线联系人进行自动连接: ${contactsToConnect.join(', ')}`, Utils.logLevels.INFO);

        for (const idToConnect of contactsToConnect) {
            ((id, delay) => {
                setTimeout(async () => {
                    try {
                        await WebRTCManager.createOffer(id, {isSilent: true});
                    } catch (error) {
                        Utils.log(`ConnectionManager: 自动连接到 ${id} 时出错: ${error.message}`, Utils.logLevels.WARN);
                    }
                }, delay);
            })(idToConnect, offerDelay);
            offerDelay += 200;
        }
    },
    handleAnswer: async function (options = {}) { /* ... (同第2部分，调用 WebRTCManager) ... */
        const {isManual = false} = options;
        if (!isManual) return;
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴应答信息。", "warning");
            return;
        }
        try {
            const answerData = JSON.parse(sdpTextEl.value);
            sdpTextEl.value = '';
            if (!answerData.sdp?.sdp || answerData.sdp.type !== 'answer' || !answerData.userId) {
                NotificationUIManager.showNotification("无效的应答数据格式。", "error");
                return;
            }
            if (answerData.userId === UserManager.userId) {
                NotificationUIManager.showNotification("无法处理来自自己的应答。", "warning");
                return;
            }

            const fromUserId = answerData.userId;
            const placeholderConn = WebRTCManager.connections[WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID];
            if (!placeholderConn?.peerConnection) {
                NotificationUIManager.showNotification(`错误: 未找到待处理的手动提议。`, "error");
                return;
            }

            WebRTCManager.connections[fromUserId] = placeholderConn;
            delete WebRTCManager.connections[WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID];
            ['iceCandidates', 'reconnectAttempts', 'iceTimers', 'iceGatheringStartTimes', 'connectionTimeouts'].forEach(storeKey => {
                if (WebRTCManager[storeKey]?.[WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID]) {
                    WebRTCManager[storeKey][fromUserId] = WebRTCManager[storeKey][WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID];
                    delete WebRTCManager[storeKey][WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID];
                }
            });
            const pc = placeholderConn.peerConnection;
            if (pc.signalingState !== 'have-local-offer') {
                if (pc.signalingState === 'stable' && WebRTCManager.isConnectedTo(fromUserId)) NotificationUIManager.showNotification(`已连接到 ${fromUserId}。`, "info");
                else NotificationUIManager.showNotification(`错误: 与 ${fromUserId} 的连接处于意外状态 (${pc.signalingState})。`, "error");
                ModalUIManager.toggleModal('mainMenuModal', false);
                return;
            }
            await this._ensureContactExistsForPeer(fromUserId, true);
            await WebRTCManager.handleRemoteAnswer(fromUserId, answerData.sdp.sdp, answerData.candidates, placeholderConn.isVideoCall, placeholderConn.isAudioOnly, placeholderConn.isScreenShare, 'answer');
            NotificationUIManager.showNotification(`正在处理来自 ${UserManager.contacts[fromUserId]?.name || fromUserId.substring(0, 6)} 的应答...`, "info");
            ModalUIManager.toggleModal('mainMenuModal', false);
        } catch (e) {
            NotificationUIManager.showNotification("处理应答时出错: " + e.message, "error");
            Utils.log("CM.handleAnswer (手动) 出错: " + e, 3);
        }
    },
    createAnswer: async function (options = {}) { /* ... (同第2部分，调用 WebRTCManager) ... */
        const {isManual = false} = options;
        if (!isManual) return;
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴提议信息。", "warning");
            return;
        }
        try {
            const offerData = JSON.parse(sdpTextEl.value);
            if (!offerData.sdp?.sdp || offerData.sdp.type !== 'offer' || !offerData.userId) {
                NotificationUIManager.showNotification("无效的提议数据格式。", "error");
                return;
            }
            if (offerData.userId === UserManager.userId) {
                NotificationUIManager.showNotification("无法处理来自自己的提议。", "warning");
                return;
            }
            const fromUserId = offerData.userId;
            sdpTextEl.value = '正在生成应答...';
            await WebRTCManager.handleRemoteOffer(fromUserId, offerData.sdp.sdp, offerData.candidates, offerData.isVideoCall, offerData.isAudioOnly, offerData.isScreenShare, 'offer', true);
            NotificationUIManager.showNotification("已开始生成应答。模态框内容将会更新。", "info");
        } catch (e) {
            NotificationUIManager.showNotification("创建应答时出错: " + e.message, "error");
            Utils.log("CM.createAnswer (手动) 出错: " + e, 3);
            if (sdpTextEl) sdpTextEl.value = `错误: ${e.message}`;
        }
    },

    // setupDataChannel 现在完全委托给 DataChannelHandler
    setupDataChannel: function (channel, peerIdArg, isManualPlaceholderOrigin = false) {
        const connectionEntry = WebRTCManager.connections[peerIdArg]; // 获取 WebRTCManager 中的连接条目
        DataChannelHandler.setupChannel(channel, peerIdArg, isManualPlaceholderOrigin, connectionEntry);
    },

    /**
     * 通过数据通道向指定对等端发送消息。
     */
    sendTo: function (peerId, messageObject) {
        return DataChannelHandler.sendData(peerId, messageObject); // 委托给 DataChannelHandler
    },

    isConnectedTo: function (peerId) { /* ... (同第2部分，调用 WebRTCManager) ... */
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) return true;
        return WebRTCManager.isConnectedTo(peerId);
    },
    close: function (peerId, notifyPeer = true) { /* ... (同第2部分，调用 WebRTCManager) ... */
        WebRTCManager.closeConnection(peerId, notifyPeer);
        if (ChatManager.currentChatId === peerId && typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.updateChatHeaderStatus(`已与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)}... 断开连接`);
            ChatAreaUIManager.setCallButtonsState(false);
        }
    },
    closePeerConnection: function (peerId) { /* ... (同第2部分，调用 WebRTCManager) ... */
        WebRTCManager.closePeerConnectionMedia(peerId);
    },

    updateSdpTextInModal: function (peerIdToGetSdpFrom, sdpData) { /* ... (逻辑不变) ... */
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;
        if (sdpData && sdpData.sdp) {
            sdpTextEl.value = JSON.stringify(sdpData, null, 2);
        } else {
            const conn = WebRTCManager.connections[peerIdToGetSdpFrom];
            const pc = conn?.peerConnection;
            sdpTextEl.value = `正在为 ${peerIdToGetSdpFrom} 生成 ${pc?.localDescription ? pc.localDescription.type : '信息'}... (ICE状态: ${pc?.iceGatheringState})`;
        }
    },

    /**
     * 用于 DataChannelHandler 解析手动占位符通道的辅助方法。
     * @param {RTCDataChannel} channel - 数据通道实例。
     * @returns {string|null} - 解析出的真实 peerId，如果找不到则返回 null。
     */
    resolvePeerIdForChannel: function (channel) {
        for (const peerId in WebRTCManager.connections) {
            if (WebRTCManager.connections[peerId]?.dataChannel === channel && peerId !== WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID) {
                return peerId;
            }
        }
        return null;
    }
};