/**
 * @file ConnectionManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 核心连接管理器，协调 WebSocket 和 WebRTC (SimplePeer) 通信。
 *              负责将 SimplePeer 生成的信令数据通过 WebSocket 转发，并将收到的信令数据传递给 WebRTCManager。
 *              提供了简化的手动连接流程。
 * @module ConnectionManager
 * @exports {object} ConnectionManager
 * @dependencies UserManager, WebSocketManager, WebRTCManager, DataChannelHandler, Utils, AppSettings, LayoutUIManager, NotificationUIManager, ChatManager, ChatAreaUIManager, GroupManager, PeopleLobbyManager, ModalUIManager, EventEmitter
 */
const ConnectionManager = {
    pendingSentChunks: {},
    pendingReceivedChunks: {},
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_', // 与 WebRTCManager 保持一致

    _ensureContactExistsForPeer: async function (peerId) {
        if (peerId === this.MANUAL_PLACEHOLDER_PEER_ID) {
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

    /**
     * 初始化 ConnectionManager。
     * @returns {Promise<void>}
     */
    initialize: function () {
        // WebRTCManager.init 现在接收三个回调
        WebRTCManager.init(
            // 1. Signaling Sender: 当 SimplePeer 需要发送信令时调用
            (type, targetPeerId, payload) => {
                const isManual = targetPeerId === this.MANUAL_PLACEHOLDER_PEER_ID;
                if (isManual) {
                    // 对于手动连接，直接更新模态框的文本区域
                    this.updateSdpTextInModal(targetPeerId, payload);
                } else {
                    // 对于自动连接，通过 WebSocket 发送
                    const signalMessage = {
                        type: 'SIGNAL',
                        userId: UserManager.userId,
                        targetUserId: targetPeerId,
                        payload: payload
                    };
                    WebSocketManager.sendRawMessage(signalMessage);
                }
            },
            // 2. Data Channel Ready Handler: 当数据通道连接成功时调用
            (peerInstance, peerId) => {
                DataChannelHandler.setupChannel(peerInstance, peerId);
            },
            // 3. Stream Ready Handler: 当远程媒体流到达时调用
            (remoteStream, peerId) => {
                if (VideoCallManager && VideoCallUIManager) {
                    VideoCallManager.state.remoteStream = remoteStream;
                    VideoCallUIManager.setRemoteStream(remoteStream);
                }
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

    /**
     * [REFACTORED] 处理从 WebSocket 收到的信令消息。
     * @param {object} message - 从 WebSocket 收到的消息对象。
     */
    handleSignalingMessage: async function (message) {
        Utils.log(`ConnectionManager: 已收到 WS: ${message.type} 来自 ${message.fromUserId || '服务器'}`, Utils.logLevels.DEBUG);
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
            case 'USER_NOT_FOUND':
                const reason = message.message || `用户 ${message.targetUserId?.substring(0,8)}... 未找到`;
                NotificationUIManager.showNotification(`信令消息: ${reason}`, 'warning');
                this.close(message.targetUserId, false); // 清理本地连接状态
                break;
            // 所有 WebRTC 相关的信令都通过 SIGNAL 类型处理
            case 'SIGNAL':
                if (fromUserId && message.payload) {
                    WebRTCManager.handleRemoteSignal(fromUserId, message.payload);
                } else {
                    Utils.log(`ConnectionManager: 收到无效的 SIGNAL 消息: ${JSON.stringify(message)}`, Utils.logLevels.WARN);
                }
                break;
            default:
                Utils.log('ConnectionManager: 未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    /**
     * [REFACTORED] 发起一个 WebRTC 连接提议。
     * @param {string|null} targetPeerId - 目标对方的 ID。
     * @param {object} options - 连接选项。
     */
    createOffer: async function (targetPeerId = null, options = {}) {
        const { isSilent = false, isManual = false, ...peerOptions } = options;
        let finalTargetPeerId = targetPeerId;

        if (isManual) {
            finalTargetPeerId = this.MANUAL_PLACEHOLDER_PEER_ID;
            this.updateSdpTextInModal(finalTargetPeerId, "生成中...");
        } else {
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                return;
            }
            if (!finalTargetPeerId) {
                NotificationUIManager.showNotification("请先选择一个联系人。", "warning");
                return;
            }
            if (!this.isWebSocketConnected) {
                const guideMessage = '信令服务器未连接。请使用“菜单” > “高级”中的手动连接功能。';
                NotificationUIManager.showNotification(guideMessage, 'warning', 10000);
                return;
            }
        }
        WebRTCManager.createOffer(finalTargetPeerId, { isSilent, isManual, ...peerOptions });
    },

    /**
     * [REFACTORED] 自动连接逻辑。
     */
    autoConnectToContacts: async function () {
        Utils.log("ConnectionManager: 尝试自动连接到联系人...", Utils.logLevels.INFO);
        const fetchSuccess = await PeopleLobbyManager.fetchOnlineUsers(true);
        if (!fetchSuccess) {
            Utils.log("ConnectionManager: 获取在线用户列表失败，无法自动连接。", Utils.logLevels.WARN);
            return;
        }
        const onlineUserIds = new Set(PeopleLobbyManager.onlineUserIds || []);
        let offerDelay = 0;

        for (const contactId in UserManager.contacts) {
            if (onlineUserIds.has(contactId) && !this.isConnectedTo(contactId) && !UserManager.contacts[contactId].isAI) {
                Utils.log(`ConnectionManager: 发现一个在线但未连接的联系人: ${contactId}。尝试静默连接。`, Utils.logLevels.INFO);
                ((id, delay) => {
                    setTimeout(() => this.createOffer(id, { isSilent: true }), delay);
                })(contactId, offerDelay);
                offerDelay += 200;
            }
        }
    },

    /**
     * [REFACTORED] 处理手动应答。
     */
    handleAnswer: async function (options = {}) {
        const { isManual = false } = options;
        if (!isManual) return;

        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴应答信息。", "warning");
            return;
        }
        try {
            const answerData = JSON.parse(sdpTextEl.value);
            const peerInstance = WebRTCManager.connections[this.MANUAL_PLACEHOLDER_PEER_ID]?.peer;
            if (peerInstance) {
                peerInstance.signal(answerData);
                sdpTextEl.value = '';
                ModalUIManager.toggleModal('mainMenuModal', false);
            } else {
                NotificationUIManager.showNotification("错误: 未找到待处理的手动提议。", "error");
            }
        } catch (e) {
            NotificationUIManager.showNotification("处理应答时出错: 无效的JSON格式。", "error");
            Utils.log("CM.handleAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
        }
    },

    /**
     * [REFACTORED] 创建手动应答。
     */
    createAnswer: async function (options = {}) {
        const { isManual = false } = options;
        if (!isManual) return;

        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl || !sdpTextEl.value) {
            NotificationUIManager.showNotification("请先粘贴提议信息。", "warning");
            return;
        }
        try {
            const offerData = JSON.parse(sdpTextEl.value);
            sdpTextEl.value = '正在生成应答...';

            const peer = WebRTCManager.initConnection(offerData.userId, { initiator: false });
            if (peer) {
                // simple-peer will automatically generate the answer signal
                peer.on('signal', signalData => {
                    this.updateSdpTextInModal(offerData.userId, signalData);
                    NotificationUIManager.showNotification("应答已创建。请复制信息并发送。", "info");
                });
                peer.signal(offerData); // Pass the offer signal
            } else {
                throw new Error("无法初始化 Peer 连接来创建应答。");
            }
        } catch (e) {
            NotificationUIManager.showNotification("创建应答时出错: " + e.message, "error");
            Utils.log("CM.createAnswer (手动) 出错: " + e, Utils.logLevels.ERROR);
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
        if (ChatManager.currentChatId === peerId) {
            ChatAreaUIManager.updateChatHeaderStatus(`已与 ${UserManager.contacts[peerId]?.name || peerId.substring(0, 8)}... 断开连接`);
            ChatAreaUIManager.setCallButtonsState(false);
        }
    },

    updateSdpTextInModal: function (peerId, signalData) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;
        if (typeof signalData === 'string') {
            sdpTextEl.value = signalData;
        } else {
            const dataToShare = { ...signalData, userId: UserManager.userId };
            sdpTextEl.value = JSON.stringify(dataToShare, null, 2);
        }
    },
};