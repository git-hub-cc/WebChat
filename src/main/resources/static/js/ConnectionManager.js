/**
 * @file ConnectionManager.js
 * @description 核心连接管理器，协调 WebSocket, WebRTC 和数据通道处理。
 *              为群组管理提供关键的连接状态检查 (isConnectedTo) 和点对点消息发送 (sendTo) 功能。
 *              MODIFIED: 优化了当信令服务器不可用时创建提议的用户引导。
 *              FIXED: 修复了 autoConnectToContacts 逻辑，确保它能正确识别并重新连接到已断开但仍有旧连接对象的在线联系人。
 * @module ConnectionManager
 * @exports {object} ConnectionManager - 对外暴露的单例对象。
 * @property {function} initialize - 初始化所有底层连接管理器。
 * @property {function} createOffer - 发起一个 WebRTC 连接提议。
 * @property {function} sendTo - 通过数据通道发送应用层消息。
 * @property {function} close - 关闭与指定对等端的连接。
 * @property {boolean} isWebSocketConnected - WebSocket 连接状态。
 * @property {function} isConnectedTo - 检查与指定对等方的数据通道是否已连接。
 * @dependencies UserManager, WebSocketManager, WebRTCManager, DataChannelHandler, Utils, AppSettings, LayoutUIManager, NotificationUIManager, ChatManager, ChatAreaUIManager, GroupManager, PeopleLobbyManager, ModalUIManager, EventEmitter
 */
const ConnectionManager = {
    // ... (其他属性和方法保持不变) ...
    pendingSentChunks: {},
    pendingReceivedChunks: {},
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

    _ensureContactExistsForPeer: async function (peerId, isManualContextOrPlaceholderOrigin = false) {
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
            Utils.log(`ConnectionManager._ensureContactExistsForPeer: 跳过为内部占位符ID ${peerId} 创建联系人。`, Utils.logLevels.DEBUG);
            return;
        }

        if (peerId && peerId !== UserManager.userId && !UserManager.contacts[peerId]) {
            try {
                await UserManager.addContact(peerId, `用户 ${peerId.substring(0, 4)}`, false);
                Utils.log(`ConnectionManager: 自动为新的连接对方 ${peerId} 创建了联系人记录。`, Utils.logLevels.INFO);
            } catch (error) {
                Utils.log(`ConnectionManager: 自动为 ${peerId} 创建联系人时出错: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    initialize: function () {
        WebRTCManager.init(
            (type, targetPeerId, payload, candidates, isSilent) => {
                if (type === 'manual_offer_ready' || type === 'manual_answer_ready') {
                    const sdpData = {
                        sdp: {type: payload.sdpType, sdp: payload.sdp},
                        candidates: candidates || [],
                        userId: UserManager.userId,
                        isVideoCall: payload.isVideoCall,
                        isAudioOnly: payload.isAudioOnly,
                        isScreenShare: payload.isScreenShare
                    };
                    this.updateSdpTextInModal(targetPeerId, sdpData);
                } else {
                    let msg;
                    if (type === 'OFFER' || type === 'ANSWER') {
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, ...payload};
                    } else if (type === 'ICE_CANDIDATE') {
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, candidate: payload};
                    } else {
                        Utils.log(`ConnectionManager: _signalingSender 收到来自 WebRTCManager 的意外类型 '${type}'。将使用通用扩展。`, Utils.logLevels.WARN);
                        msg = {type: type, userId: UserManager.userId, targetUserId: targetPeerId, ...payload};
                    }
                    WebSocketManager.sendRawMessage(msg, isSilent);
                }
            },
            (channel, peerId, isManualPlaceholderOrigin) => {
                const connectionEntry = WebRTCManager.connections[peerId];
                this._ensureContactExistsForPeer(peerId, isManualPlaceholderOrigin).then(() => {
                    DataChannelHandler.setupChannel(channel, peerId, isManualPlaceholderOrigin, connectionEntry);
                });
            }
        );

        return WebSocketManager.init(
            (message) => this.handleSignalingMessage(message),
            (isConnected) => {
                if (isConnected) {
                    WebSocketManager.sendRawMessage({type: 'REGISTER', userId: UserManager.userId}, false);
                }
            }
        );
    },

    get isWebSocketConnected() {
        return WebSocketManager.isWebSocketConnected;
    },

    handleSignalingMessage: async function (message) {
        // ... (方法保持不变) ...
        Utils.log(`ConnectionManager: 已收到 WS (经WebSocketManager): ${message.type} 来自 ${message.fromUserId || '服务器'}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        if (fromUserId && fromUserId !== UserManager.userId) {
            await this._ensureContactExistsForPeer(fromUserId);
        }

        switch (message.type) {
            case 'SUCCESS':
                LayoutUIManager.updateConnectionStatusIndicator(`用户注册成功: ${UserManager.userId.substring(0, 8)}...`);
                this.autoConnectToContacts();
                break;
            case 'ERROR':
                if (!message.message.includes('不在线')) {
                    NotificationUIManager.showNotification(`信令错误: ${message.message}`, 'error');
                }
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
                if (!wasSilentAttempt) {
                    NotificationUIManager.showNotification(`用户 ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0, 8) + '...'} 未找到或离线。`, 'warning');
                }
                if (ChatManager.currentChatId === message.targetUserId && !wasSilentAttempt && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.updateChatHeaderStatus(`用户未找到或离线`);
                }
                if (WebRTCManager.connections[message.targetUserId]) {
                    this.close(message.targetUserId, false);
                }
                break;
            default:
                Utils.log('ConnectionManager: 未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    createOffer: async function (targetPeerId = null, options = {}) {
        // ... (方法保持不变) ...
        const {isSilent = false, isManual = false} = options;
        let finalTargetPeerId = targetPeerId;

        if (isManual) {
            finalTargetPeerId = WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID;
        } else {
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                Utils.log(`ConnectionManager.createOffer: 目标 ${targetPeerId} 是AI，不发起 WebRTC 连接。`, Utils.logLevels.INFO);
                return;
            }
            if (!finalTargetPeerId && ChatManager.currentChatId && ChatManager.currentChatId !== UserManager.userId && !ChatManager.currentChatId.startsWith('group_')) {
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
                Utils.log("ConnectionManager.createOffer: 不能连接到自己。", Utils.logLevels.WARN);
                return;
            }
            if (!UserManager.userId) {
                Utils.log("ConnectionManager.createOffer: 当前用户ID未设置。", Utils.logLevels.ERROR);
                return;
            }

            if (!this.isWebSocketConnected) {
                if (!isSilent) {
                    const guideMessage = '信令服务器未连接。请使用“菜单” > “高级功能”中的“手动创建提议”来建立连接。';
                    NotificationUIManager.showNotification(guideMessage, 'warning', 10000);
                }
                return;
            }
        }

        await WebRTCManager.createOffer(finalTargetPeerId, options);
    },

    /**
     * MODIFIED: 自动连接逻辑修复。
     */
    autoConnectToContacts: async function () {
        Utils.log("ConnectionManager: 尝试自动连接到联系人...", Utils.logLevels.INFO);
        const fetchSuccess = await PeopleLobbyManager.fetchOnlineUsers(true); // silent fetch
        if (!fetchSuccess) {
            Utils.log("ConnectionManager: 获取在线用户列表失败，无法自动连接。", Utils.logLevels.WARN);
            return;
        }
        const onlineUserIdsFromLobby = new Set(PeopleLobbyManager.onlineUserIds || []);
        if (onlineUserIdsFromLobby.size === 0) {
            Utils.log("ConnectionManager: 大厅中没有其他在线用户可供自动连接。", Utils.logLevels.INFO);
            return;
        }
        if (!UserManager.contacts || Object.keys(UserManager.contacts).length === 0) {
            Utils.log("ConnectionManager: 没有本地联系人可供自动连接。", Utils.logLevels.INFO);
            return;
        }

        let offerDelay = 0;
        const contactsToPotentiallyConnect = [];

        // --- FIX START: Improved logic to identify reconnectable contacts ---
        for (const contactId of Object.keys(UserManager.contacts)) {
            if (contactId === UserManager.userId || UserManager.contacts[contactId]?.isAI) {
                continue; // Skip self and AI contacts
            }

            const existingConn = WebRTCManager.connections[contactId];

            // If there's no connection object at all, it's a potential candidate.
            if (!existingConn || !existingConn.peerConnection) {
                contactsToPotentiallyConnect.push(contactId);
                continue;
            }

            // If a connection object exists, check its state thoroughly.
            // A connection is considered "dead" and reconnectable if it's in a failed, closed, or disconnected state.
            // It should NOT be reconnected if it's currently stable, new, or in the process of connecting/negotiating.
            const pc = existingConn.peerConnection;
            const connectionState = pc.connectionState;
            const signalingState = pc.signalingState;

            const isDead = ['failed', 'closed', 'disconnected'].includes(connectionState);
            const isNegotiating = ['have-local-offer', 'have-remote-offer'].includes(signalingState);
            const isConnecting = connectionState === 'connecting';

            if (isDead && !isNegotiating && !isConnecting) {
                contactsToPotentiallyConnect.push(contactId);
            }
        }
        // --- FIX END ---

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
                        // Use createOffer which internally handles re-initialization if needed.
                        await this.createOffer(id, { isSilent: true });
                    } catch (error) {
                        Utils.log(`ConnectionManager: 自动连接到 ${id} 时出错: ${error.message}`, Utils.logLevels.WARN);
                    }
                }, delay);
            })(idToConnect, offerDelay);
            offerDelay += 200;
        }
    },

    // ... (其他方法 handleAnswer, createAnswer 等保持不变) ...
    handleAnswer: async function (options = {}) {
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
                if (pc.signalingState === 'stable' && WebRTCManager.isConnectedTo(fromUserId)) {
                    NotificationUIManager.showNotification(`已连接到 ${fromUserId}。`, "info");
                } else {
                    NotificationUIManager.showNotification(`错误: 与 ${fromUserId} 的连接处于意外状态 (${pc.signalingState})。`, "error");
                }
                ModalUIManager.toggleModal('mainMenuModal', false);
                return;
            }

            await this._ensureContactExistsForPeer(fromUserId, true);
            await WebRTCManager.handleRemoteAnswer(fromUserId, answerData.sdp.sdp, answerData.candidates, placeholderConn.isVideoCall, placeholderConn.isAudioOnly, placeholderConn.isScreenShare, 'answer');
            NotificationUIManager.showNotification(`正在处理来自 ${UserManager.contacts[fromUserId]?.name || fromUserId.substring(0, 6)} 的应答...`, "info");
            ModalUIManager.toggleModal('mainMenuModal', false);
        } catch (e) {
            NotificationUIManager.showNotification("处理应答时出错: " + e.message, "error");
            Utils.log("CM.handleAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
        }
    },
    createAnswer: async function (options = {}) {
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
            Utils.log("CM.createAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
            if (sdpTextEl) sdpTextEl.value = `错误: ${e.message}`;
        }
    },

    sendTo: function (peerId, messageObject) {
        return DataChannelHandler.sendData(peerId, messageObject);
    },

    isConnectedTo: function (peerId) {
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) {
            return true;
        }
        return WebRTCManager.isConnectedTo(peerId);
    },

    close: function (peerId, notifyPeer = true) {
        WebRTCManager.closeConnection(peerId, notifyPeer);
        if (ChatManager.currentChatId === peerId && typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.updateChatHeaderStatus(`已与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)}... 断开连接`);
            ChatAreaUIManager.setCallButtonsState(false);
        }
    },

    updateSdpTextInModal: function (peerIdToGetSdpFrom, sdpData) {
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

    resolvePeerIdForChannel: function (channel) {
        for (const peerId in WebRTCManager.connections) {
            if (WebRTCManager.connections[peerId]?.dataChannel === channel && peerId !== WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID) {
                return peerId;
            }
        }
        return null;
    }
};