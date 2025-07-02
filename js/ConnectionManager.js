/**
 * @file ConnectionManager.js
 * @description 核心连接管理器，负责协调 WebSocket 信令、WebRTC 点对点连接和数据通道。
 *              为群组管理、在线状态同步和用户间通信提供关键的连接状态检查 (isConnectedTo) 和消息发送 (sendTo) 功能。
 *              重构说明 (Phase 2): 不再直接调用 ChatManager 打开聊天，而是通过分发 Action 到 Store 来触发状态变更。
 * @module ConnectionManager
 * @exports {object} ConnectionManager - 对外暴露的单例对象，包含所有连接管理功能。
 * @property {function} initialize - 初始化所有底层连接管理器。
 * @property {function} createOffer - 发起一个 WebRTC 连接提议。
 * @property {function} sendTo - 通过数据通道发送应用层消息。
 * @property {function} close - 关闭与指定对等端的连接。
 * @property {boolean} isWebSocketConnected - WebSocket 的连接状态。
 * @property {function} isConnectedTo - 检查与指定对等方的数据通道是否已连接。
 * @dependency UserManager, WebSocketManager, WebRTCManager, DataChannelHandler, Utils, AppSettings, LayoutUIManager, NotificationUIManager, ChatManager, ChatAreaUIManager, GroupManager, PeopleLobbyManager, ModalUIManager, EventEmitter, Store
 */
const ConnectionManager = {
    // 手动连接模式下使用的占位符对等端ID，与WebRTCManager保持一致
    MANUAL_PLACEHOLDER_PEER_ID: AppSettings.constants.manualPlaceholderPeerId,
    // NOTE: 以下分片状态保留在此处，因为 Utils.sendInChunks/reassembleChunk 依赖它们。
    // 这是一个可以后续优化的点，未来可将分片状态和逻辑完全内聚到 DataChannelHandler 中。
    // 记录待发送的分块数据
    pendingSentChunks: {},
    // 记录待接收和重组的分块数据
    pendingReceivedChunks: {},


    /**
     * 初始化连接管理器，设置并协调底层的 WebSocketManager 和 WebRTCManager。
     * @function initialize
     * @returns {Promise<void>} 一个从 WebSocketManager.init() 返回的 Promise，表示 WebSocket 连接尝试的结果。
     */
    initialize: function () {
        WebRTCManager.init(
            // 1. WebRTC 信令发送回调 (sendSignalingMessageCb)
            // 当 WebRTCManager 需要发送信令消息（如 offer, answer, candidate）时，会调用此函数
            (type, targetPeerId, payload, candidates, isSilent) => {
                if (type === 'manual_offer_ready' || type === 'manual_answer_ready') {
                    // 手动连接模式：将 SDP 和候选者信息打包成 JSON，用于手动复制粘贴
                    const sdpData = {
                        sdp: {type: payload.sdpType, sdp: payload.sdp},
                        candidates: candidates || [], // 确保 candidates 数组存在
                        userId: UserManager.userId,
                        isVideoCall: payload.isVideoCall,
                        isAudioOnly: payload.isAudioOnly,
                        isScreenShare: payload.isScreenShare
                    };
                    this.updateSdpTextInModal(targetPeerId, sdpData);
                } else {
                    // 自动连接模式：通过 WebSocket 发送标准信令消息
                    let msg;
                    if (type === 'OFFER' || type === 'ANSWER') {
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, ...payload};
                    } else if (type === 'ICE_CANDIDATE') {
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, candidate: payload};
                    } else {
                        // 兼容未知或扩展的信令类型
                        Utils.log(`ConnectionManager: _signalingSender 收到来自 WebRTCManager 的意外类型 '${type}'。将使用通用扩展。`, Utils.logLevels.WARN);
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, ...payload};
                    }
                    WebSocketManager.sendRawMessage(msg, isSilent);
                }
            },
            // 2. WebRTC 数据通道就绪回调 (onDataChannelReadyCb)
            // 当 WebRTC 数据通道成功建立时调用此函数
            (channel, peerId, isManualPlaceholderOrigin) => {
                const connectionEntry = WebRTCManager.connections[peerId];
                // 确保在设置数据通道之前，已为对方创建了联系人记录
                this._ensureContactExistsForPeer(peerId, isManualPlaceholderOrigin).then(() => {
                    DataChannelHandler.setupChannel(channel, peerId, isManualPlaceholderOrigin, connectionEntry);

                    // REFACTORED: 如果是通过手动占位符建立的连接，并且当前没有打开聊天，则自动打开与新连接用户的聊天
                    const isPlaceholderOriginChan = !!channel._isManualPlaceholderOrigin;
                    if (isPlaceholderOriginChan && peerId === AppSettings.constants.manualPlaceholderPeerId) {
                        const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                        if (resolvedId && (Store.getState().currentChatId === null || Store.getState().currentChatId === AppSettings.constants.manualPlaceholderPeerId)) {
                            Store.dispatch('OPEN_CHAT', { chatId: resolvedId });
                        }
                    }
                });
            }
        );

        // 3. 初始化 WebSocketManager 并返回其 Promise
        return WebSocketManager.init(
            (message) => this.handleSignalingMessage(message), // WebSocket 消息回调
            (isConnected) => { // WebSocket 状态变更回调
                if (isConnected) {
                    // WebSocket 连接成功后，立即向服务器注册当前用户ID
                    WebSocketManager.sendRawMessage({type: 'REGISTER', userId: UserManager.userId}, false);
                }
            }
        );
    },

    /**
     * 发起一个 WebRTC 连接提议（Offer）。
     * @function createOffer
     * @param {string|null} [targetPeerId=null] - 目标对等端的 ID。如果为 null，则尝试使用当前聊天ID或提示用户输入。
     * @param {object} [options={}] - 连接选项，例如 {isSilent, isManual, isVideoCall, isAudioOnly, isScreenShare}。
     * @returns {Promise<void>}
     */
    createOffer: async function (targetPeerId = null, options = {}) {
        const {isSilent = false, isManual = false} = options;
        let finalTargetPeerId = targetPeerId;

        // 处理流程：
        // 1. 确定目标 ID
        if (isManual) {
            finalTargetPeerId = AppSettings.constants.manualPlaceholderPeerId; // 手动模式使用占位符ID
        } else {
            // 自动模式
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                // NOTE: 不与 AI 建立 WebRTC 连接
                Utils.log(`ConnectionManager.createOffer: 目标 ${targetPeerId} 是AI，不发起 WebRTC 连接。`, Utils.logLevels.INFO);
                return;
            }
            if (!finalTargetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) {
                finalTargetPeerId = ChatManager.currentChatId;
            }
            if (!finalTargetPeerId && !isSilent) { // 如果仍无目标ID且非静默模式，提示用户输入
                const userInputId = prompt('请输入对方 ID:');
                if (!userInputId) {
                    NotificationUIManager.showNotification("已取消: 未提供对方 ID。", "info");
                    return;
                }
                finalTargetPeerId = userInputId;
            } else if (!finalTargetPeerId && isSilent) { // 静默模式下必须有目标ID
                Utils.log("ConnectionManager: 静默创建提议时缺少目标 ID。", Utils.logLevels.WARN);
                return;
            }

            if (finalTargetPeerId === UserManager.userId) { // 不能连接自己
                Utils.log("ConnectionManager.createOffer: 不能连接到自己。", Utils.logLevels.WARN);
                return;
            }
            if (!UserManager.userId) { // 当前用户ID必须存在
                Utils.log("ConnectionManager.createOffer: 当前用户ID未设置。", Utils.logLevels.ERROR);
                return;
            }

            // 2. 确保信令服务器（WebSocket）已连接
            if (!this.isWebSocketConnected) {
                try {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器未连接。正在尝试...", "info");
                    await WebSocketManager.connect(); // 等待连接尝试
                    if (this.isWebSocketConnected) {
                        WebSocketManager.sendRawMessage({type: 'REGISTER', userId: UserManager.userId}, false);
                    }
                } catch (e) {
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器连接失败。无法创建提议。", "error");
                    return;
                }
                if (!this.isWebSocketConnected) { // 再次检查
                    if (!isSilent) NotificationUIManager.showNotification("信令服务器连接仍然失败。", "error");
                    return;
                }
            }
        }
        // 3. 调用 WebRTCManager 创建提议
        await WebRTCManager.createOffer(finalTargetPeerId, options);
    },

    /**
     * 处理从 WebSocketManager 接收到的信令消息。
     * @function handleSignalingMessage
     * @param {object} message - 解析后的 JSON 消息对象。
     */
    handleSignalingMessage: async function (message) {
        Utils.log(`ConnectionManager: 已收到 WS (经WebSocketManager): ${message.type} 来自 ${message.fromUserId || '服务器'}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        // 在处理来自其他用户的信令前，确保本地存在该用户的联系人记录
        if (fromUserId && fromUserId !== UserManager.userId) {
            await this._ensureContactExistsForPeer(fromUserId);
        }

        switch (message.type) {
            case 'SUCCESS': // 通常是注册成功的响应
                            // REFACTORED (Phase 1): 使用 Store 更新连接状态
                Store.dispatch('UPDATE_CONNECTION_STATUS', {
                    isConnected: true,
                    statusText: `用户注册成功: ${UserManager.userId.substring(0, 8)}...`
                });
                this.autoConnectToContacts(); // 尝试自动连接到已保存的在线联系人
                break;
            case 'ERROR': // 信令服务器返回的错误
                // 如果错误不是关于用户不在线（这种错误在USER_NOT_FOUND中处理），则显示通知
                if (!message.message.includes('不在线')) {
                    NotificationUIManager.showNotification(`信令错误: ${message.message}`, 'error');
                }
                Utils.log(`ConnectionManager: 信令服务器错误: ${message.message}`, Utils.logLevels.ERROR);
                break;
            case 'OFFER': // 收到来自对方的 WebRTC 提议
                WebRTCManager.handleRemoteOffer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ANSWER': // 收到来自对方的 WebRTC 应答
                WebRTCManager.handleRemoteAnswer(fromUserId, message.sdp, message.candidates, message.isVideoCall, message.isAudioOnly, message.isScreenShare, message.sdpType);
                break;
            case 'ICE_CANDIDATE': // 收到来自对方的 ICE 候选者
                WebRTCManager.addRemoteIceCandidate(fromUserId, message.candidate);
                break;
            case 'USER_NOT_FOUND': // 信令服务器通知目标用户未找到或不在线
                const connDetails = WebRTCManager.connections[message.targetUserId];
                const wasSilentAttempt = connDetails?.wasInitiatedSilently || false;
                // 如果不是静默尝试连接，则显示通知
                if (!wasSilentAttempt) {
                    NotificationUIManager.showNotification(`用户 ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0, 8) + '...'} 未找到或离线。`, 'warning');
                }
                // 关闭与此用户的 WebRTC 连接（如果存在）
                if (WebRTCManager.connections[message.targetUserId]) {
                    this.close(message.targetUserId, false); // false表示不通知对方（因为对方不在线）
                }
                break;
            default:
                Utils.log('ConnectionManager: 未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    /**
     * 处理手动输入的 SDP 应答。
     * @function handleAnswer
     * @param {object} [options={}] - 选项，例如 {isManual: true}。
     * @returns {Promise<void>}
     */
    handleAnswer: async function (options = {}) {
        const {isManual = false} = options;
        if (!isManual) return; // 此方法仅用于手动流程

        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴应答信息。", "warning");
            return;
        }
        try {
            // 1. 解析应答数据
            const answerData = JSON.parse(sdpTextEl.value);
            sdpTextEl.value = ''; // 清空输入框

            // 2. 校验应答数据格式
            if (!answerData.sdp?.sdp || answerData.sdp.type !== 'answer' || !answerData.userId) {
                NotificationUIManager.showNotification("无效的应答数据格式。", "error");
                return;
            }
            if (answerData.userId === UserManager.userId) {
                NotificationUIManager.showNotification("无法处理来自自己的应答。", "warning");
                return;
            }

            const fromUserId = answerData.userId;
            // 3. 获取手动占位符连接，并将其替换为真实用户ID的连接
            const placeholderConn = WebRTCManager.connections[AppSettings.constants.manualPlaceholderPeerId];
            if (!placeholderConn?.peerConnection) {
                NotificationUIManager.showNotification(`错误: 未找到待处理的手动提议。`, "error");
                return;
            }
            WebRTCManager.connections[fromUserId] = placeholderConn;
            delete WebRTCManager.connections[AppSettings.constants.manualPlaceholderPeerId];

            // 4. 迁移相关状态到新ID下
            ['iceCandidates', 'reconnectAttempts', 'iceTimers', 'iceGatheringStartTimes', 'connectionTimeouts'].forEach(storeKey => {
                if (WebRTCManager[storeKey]?.[AppSettings.constants.manualPlaceholderPeerId]) {
                    WebRTCManager[storeKey][fromUserId] = WebRTCManager[storeKey][AppSettings.constants.manualPlaceholderPeerId];
                    delete WebRTCManager[storeKey][AppSettings.constants.manualPlaceholderPeerId];
                }
            });

            const pc = placeholderConn.peerConnection;
            // 5. 检查信令状态是否适合处理应答
            if (pc.signalingState !== 'have-local-offer') {
                if (pc.signalingState === 'stable' && WebRTCManager.isConnectedTo(fromUserId)) {
                    NotificationUIManager.showNotification(`已连接到 ${fromUserId}。`, "info");
                } else {
                    NotificationUIManager.showNotification(`错误: 与 ${fromUserId} 的连接处于意外状态 (${pc.signalingState})。`, "error");
                }
                ModalUIManager.toggleModal('mainMenuModal', false);
                return;
            }

            // 6. 确保联系人存在，并调用 WebRTCManager 处理应答
            await this._ensureContactExistsForPeer(fromUserId, true);
            await WebRTCManager.handleRemoteAnswer(fromUserId, answerData.sdp.sdp, answerData.candidates, placeholderConn.isVideoCall, placeholderConn.isAudioOnly, placeholderConn.isScreenShare, 'answer');
            NotificationUIManager.showNotification(`正在处理来自 ${UserManager.contacts[fromUserId]?.name || fromUserId.substring(0, 6)} 的应答...`, "info");
            ModalUIManager.toggleModal('mainMenuModal', false);
        } catch (e) {
            NotificationUIManager.showNotification("处理应答时出错: " + e.message, "error");
            Utils.log("CM.handleAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
        }
    },

    /**
     * 处理手动输入的 SDP 提议，并创建应答。
     * @function createAnswer
     * @param {object} [options={}] - 选项，例如 {isManual: true}。
     * @returns {Promise<void>}
     */
    createAnswer: async function (options = {}) {
        const {isManual = false} = options;
        if (!isManual) return; // 此方法仅用于手动流程

        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴提议信息。", "warning");
            return;
        }
        try {
            // 1. 解析提议数据
            const offerData = JSON.parse(sdpTextEl.value);

            // 2. 校验提议数据格式
            if (!offerData.sdp?.sdp || offerData.sdp.type !== 'offer' || !offerData.userId) {
                NotificationUIManager.showNotification("无效的提议数据格式。", "error");
                return;
            }
            if (offerData.userId === UserManager.userId) {
                NotificationUIManager.showNotification("无法处理来自自己的提议。", "warning");
                return;
            }
            const fromUserId = offerData.userId;
            sdpTextEl.value = '正在生成应答...'; // 更新模态框文本

            // 3. 调用 WebRTCManager 处理远程提议，并标记为手动流程
            await WebRTCManager.handleRemoteOffer(fromUserId, offerData.sdp.sdp, offerData.candidates, offerData.isVideoCall, offerData.isAudioOnly, offerData.isScreenShare, 'offer', true);
            NotificationUIManager.showNotification("已开始生成应答。模态框内容将会更新。", "info");
        } catch (e) {
            NotificationUIManager.showNotification("创建应答时出错: " + e.message, "error");
            Utils.log("CM.createAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
            if (sdpTextEl) sdpTextEl.value = `错误: ${e.message}`; // 在模态框中显示错误
        }
    },

    /**
     * 通过数据通道向指定对等端发送消息。此方法委托给 DataChannelHandler。
     * @function sendTo
     * @param {string} peerId - 接收方的 ID。
     * @param {object} messageObject - 要发送的消息对象。
     * @returns {boolean} - 消息是否成功（排入队列）发送。
     */
    sendTo: function (peerId, messageObject) {
        return DataChannelHandler.sendData(peerId, messageObject);
    },

    /**
     * 检查与指定对等端的数据通道是否已连接。
     * @function isConnectedTo
     * @param {string} peerId - 要检查的对方 ID。
     * @returns {boolean} - 如果已连接则返回 true，否则返回 false。
     */
    isConnectedTo: function (peerId) {
        // AI 联系人被视为“始终连接”，因为它们不通过 WebRTC 通信
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) {
            return true;
        }
        // 否则，查询 WebRTCManager 的真实连接状态
        return WebRTCManager.isConnectedTo(peerId);
    },

    /**
     * 关闭与指定对等端的连接。
     * @function close
     * @param {string} peerId - 要关闭连接的对方 ID。
     * @param {boolean} [notifyPeer=true] - 是否通知对方连接已关闭。
     */
    close: function (peerId, notifyPeer = true) {
        // 委托给 WebRTCManager 处理关闭逻辑
        WebRTCManager.closeConnection(peerId, notifyPeer);
        // REFACTORED (Phase 1): 不再直接操作UI，UI会通过订阅Store来响应连接状态的变化。
    },

    /**
     * 获取 WebSocket 的连接状态。
     * @type {boolean}
     */
    get isWebSocketConnected() {
        return WebSocketManager.isWebSocketConnected;
    },

    /**
     * @private
     * 确保与对方的连接存在本地联系人记录。
     * 此方法在收到来自未知对方的消息或在手动连接中解析出真实ID时被内部调用。
     * @function _ensureContactExistsForPeer
     * @param {string} peerId - 对方的ID。
     * @param {boolean} [isManualContextOrPlaceholderOrigin=false] - 指示此调用是否源于手动连接流程。
     * @returns {Promise<void>}
     */
    _ensureContactExistsForPeer: async function (peerId, isManualContextOrPlaceholderOrigin = false) {
        // FIX: 永远不应为内部占位符ID创建用户联系人。
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
            Utils.log(`ConnectionManager._ensureContactExistsForPeer: 跳过为内部占位符ID ${peerId} 创建联系人。`, Utils.logLevels.DEBUG);
            return;
        }

        // 对于任何其他（真实）的 peerId，检查是否是新联系人并添加
        if (peerId && peerId !== UserManager.userId && !UserManager.contacts[peerId]) {
            try {
                // establishConnection=false 以避免循环调用
                await UserManager.addContact(peerId, `用户 ${peerId.substring(0, 4)}`, false);
                Utils.log(`ConnectionManager: 自动为新的连接对方 ${peerId} 创建了联系人记录。`, Utils.logLevels.INFO);
            } catch (error) {
                Utils.log(`ConnectionManager: 自动为 ${peerId} 创建联系人时出错: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    /**
     * 自动连接到已知的在线联系人。
     * 此方法通常在 WebSocket 注册成功后调用。
     * @function autoConnectToContacts
     * @returns {Promise<void>}
     */
    autoConnectToContacts: async function () {
        Utils.log("ConnectionManager: 尝试自动连接到联系人...", Utils.logLevels.INFO);
        // 1. 获取在线用户列表
        const fetchSuccess = await PeopleLobbyManager.fetchOnlineUsers();
        if (!fetchSuccess) {
            Utils.log("ConnectionManager: 获取在线用户列表失败，无法自动连接。", Utils.logLevels.WARN);
            return;
        }
        const onlineUserIdsFromLobby = new Set(PeopleLobbyManager.onlineUserIds || []);
        if (onlineUserIdsFromLobby.size === 0) {
            Utils.log("ConnectionManager: 大厅中没有其他在线用户可供自动连接。", Utils.logLevels.INFO);
            return;
        }

        // 2. 检查本地联系人列表
        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) {
            Utils.log("ConnectionManager: 没有本地联系人可供自动连接。", Utils.logLevels.INFO);
            return;
        }

        let offerDelay = 0; // 用于错开提议发送时间，避免信令风暴
        const contactsToPotentiallyConnect = [];

        // 3. 筛选出可以尝试连接的联系人（非AI，未连接，且不在连接中）
        for (const contactId of Object.keys(UserManager.contacts)) {
            if (contactId === UserManager.userId) continue;
            const contact = UserManager.contacts[contactId];
            if (contact && contact.isAI) continue;
            if (WebRTCManager.isConnectedTo(contactId)) continue;

            const existingConn = WebRTCManager.connections[contactId];
            if (existingConn?.peerConnection &&
                (existingConn.peerConnection.signalingState !== 'closed' && existingConn.peerConnection.signalingState !== 'failed')) {
                continue;
            }
            contactsToPotentiallyConnect.push(contactId);
        }

        // 4. 找出同时在本地联系人列表和在线用户列表中的联系人
        const contactsToConnect = contactsToPotentiallyConnect.filter(id => onlineUserIdsFromLobby.has(id));
        if (contactsToConnect.length === 0) {
            Utils.log("ConnectionManager: 没有符合自动连接条件的在线联系人。", Utils.logLevels.INFO);
            return;
        }
        Utils.log(`ConnectionManager: 找到 ${contactsToConnect.length} 个在线联系人进行自动连接: ${contactsToConnect.join(', ')}`, Utils.logLevels.INFO);

        // 5. 逐个发起静默连接提议，并设置延迟
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
            offerDelay += 200; // 递增延迟
        }
    },

    /**
     * 更新手动连接模态框中的 SDP 文本。
     * @function updateSdpTextInModal
     * @param {string} peerIdToGetSdpFrom - 通常是占位符ID。
     * @param {object} sdpData - 包含 sdp, candidates, userId 等的 SDP 数据对象。
     */
    updateSdpTextInModal: function (peerIdToGetSdpFrom, sdpData) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;

        if (sdpData && sdpData.sdp) {
            // 如果提供了完整的SDP数据，格式化并显示
            sdpTextEl.value = JSON.stringify(sdpData, null, 2);
        } else {
            // 否则，显示正在生成的状态
            const conn = WebRTCManager.connections[peerIdToGetSdpFrom];
            const pc = conn?.peerConnection;
            sdpTextEl.value = `正在为 ${peerIdToGetSdpFrom} 生成 ${pc?.localDescription ? pc.localDescription.type : '信息'}... (ICE状态: ${pc?.iceGatheringState})`;
        }
    },

    /**
     * 辅助方法，用于在手动连接流程中，根据数据通道实例反向解析出真实的 peerId。
     * @function resolvePeerIdForChannel
     * @param {RTCDataChannel} channel - 数据通道实例。
     * @returns {string|null} 解析出的真实 peerId，如果找不到则返回 null。
     */
    resolvePeerIdForChannel: function (channel) {
        // 遍历 WebRTCManager 中的连接，查找与给定通道匹配的非占位符ID
        for (const peerId in WebRTCManager.connections) {
            if (WebRTCManager.connections[peerId]?.dataChannel === channel && peerId !== AppSettings.constants.manualPlaceholderPeerId) {
                return peerId;
            }
        }
        return null; // 未找到匹配
    }
};