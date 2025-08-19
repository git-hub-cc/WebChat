/**
 * @file ConnectionManager.js
 * @description 【重构】核心连接管理器，协调 WebSocket 和 WebRTC (simple-peer) 的交互。
 *              此类现在负责将应用层的连接请求转换为对 WebRTCManager 的调用，
 *              并将 WebRTCManager (simple-peer) 生成的信令通过 WebSocket 发送出去。
 *              它还负责接收 WebSocket 消息并将其路由到 WebRTCManager。
 * @module ConnectionManager
 * @exports {object} ConnectionManager - 对外暴露的单例对象。
 * @dependencies UserManager, WebSocketManager, WebRTCManager, DataChannelHandler, Utils, EventEmitter
 */
const ConnectionManager = {
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

    /**
     * 初始化 ConnectionManager。
     * 设置 WebSocket 监听器和来自 WebRTCManager 的应用事件监听器。
     * @returns {Promise<void>}
     */
    initialize: function () {
        // [MODIFIED] 初始化 WebRTCManager，并提供一个信令发送回调函数
        WebRTCManager.init((peerId, signalData, isSilent) => {
            const message = {
                type: 'SIGNAL',
                userId: UserManager.userId,
                targetUserId: peerId,
                payload: signalData
            };
            WebSocketManager.sendRawMessage(message, isSilent);
        });

        // [NEW] 监听应用级的 WebRTC 事件
        this._setupAppEventListeners();

        // 初始化 WebSocket，并提供一个信令消息处理回调
        return WebSocketManager.init(
            (message) => this.handleSignalingMessage(message)
        );
    },

    get isWebSocketConnected() {
        return WebSocketManager.isWebSocketConnected;
    },

    /**
     * 处理从信令服务器接收到的消息。
     * @param {object} message - 从 WebSocketManager 传来的消息对象。
     */
    handleSignalingMessage: async function (message) {
        Utils.log(`ConnectionManager: 已收到 WS: ${message.type} 来自 ${message.fromUserId || '服务器'}`, Utils.logLevels.DEBUG);
        const fromUserId = message.fromUserId;

        // 确保联系人存在
        if (fromUserId && fromUserId !== UserManager.userId && !UserManager.contacts[fromUserId]) {
            await UserManager.addContact(fromUserId, `用户 ${fromUserId.substring(0, 4)}`, false);
        }

        switch (message.type) {
            case 'SUCCESS':
                LayoutUIManager.updateConnectionStatusIndicator(`用户注册成功: ${UserManager.userId.substring(0, 8)}...`);
                break;
            case 'ERROR':
                // ... (error handling remains the same) ...
                if (!message.message.includes('不在线')) {
                    NotificationUIManager.showNotification(`信令错误: ${message.message}`, 'error');
                }
                Utils.log(`ConnectionManager: 信令服务器错误: ${message.message}`, Utils.logLevels.ERROR);
                break;
            case 'SIGNAL':
                // [MODIFIED] 统一处理所有信令数据
                WebRTCManager.handleSignal(fromUserId, message.payload);
                break;
            case 'USER_NOT_FOUND':
                // ... (user not found logic remains largely the same) ...
                NotificationUIManager.showNotification(`用户 ${UserManager.contacts[message.targetUserId]?.name || message.targetUserId.substring(0, 8) + '...'} 未找到或离线。`, 'warning');
                this.close(message.targetUserId);
                break;
            default:
                Utils.log('ConnectionManager: 未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    /**
     * [REFACTORED] 发起或响应一个 P2P 连接。
     * @param {string | null} targetPeerId - 目标对方的 ID。对于手动连接，可以为 null。
     * @param {object} [options={}] - 连接选项。
     * @param {boolean} [options.isSilent=false] - 是否为静默连接。
     * @param {boolean} [options.isManual=false] - 是否为手动连接流程。
     * @param {boolean} [options.initiator=true] - 是否为连接发起方 (simple-peer option)。
     * @param {MediaStream} [options.stream=false] - 要附加的媒体流 (simple-peer option)。
     * @returns {Peer|null} 返回创建的 simple-peer 实例。
     */
    connectToPeer: function (targetPeerId, options = {}) {
        const { isSilent = false, isManual = false, ...peerOptions } = options;
        let finalTargetPeerId = targetPeerId;

        if (isManual) {
            finalTargetPeerId = this.MANUAL_PLACEHOLDER_PEER_ID;
        } else {
            if (UserManager.isSpecialContact(targetPeerId) && UserManager.contacts[targetPeerId]?.isAI) {
                Utils.log(`ConnectionManager.connectToPeer: 目标 ${targetPeerId} 是AI，不发起 WebRTC 连接。`, Utils.logLevels.INFO);
                return null;
            }
            if (!finalTargetPeerId) {
                NotificationUIManager.showNotification("连接失败：未提供目标ID。", "error");
                return null;
            }
            if (!this.isWebSocketConnected) {
                if (!isSilent) {
                    NotificationUIManager.showNotification('信令服务器未连接。请使用手动连接功能。', 'warning');
                }
                return null;
            }
        }

        // 默认是发起方
        if (peerOptions.initiator === undefined) {
            peerOptions.initiator = true;
        }

        return WebRTCManager.getConnection(finalTargetPeerId, { ...peerOptions, isSilent });
    },


    /**
     * 通过数据通道发送应用层消息。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} messageObject - 要发送的 JSON 消息对象。
     * @returns {boolean} - 消息是否成功发送。
     */
    sendTo: function (peerId, messageObject) {
        const peer = WebRTCManager.getPeer(peerId);
        if (peer && peer.connected) {
            try {
                const messageString = JSON.stringify(messageObject);
                peer.send(messageString);
                return true;
            } catch (error) {
                Utils.log(`ConnectionManager: 发送数据到 ${peerId} 失败: ${error.message}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log(`ConnectionManager: 无法发送到 ${peerId}: 连接不存在或未就绪。`, Utils.logLevels.WARN);
            return false;
        }
    },

    /**
     * 检查与指定对等方的数据通道是否已连接。
     * @param {string} peerId - 对方的 ID。
     * @returns {boolean} - 是否已连接。
     */
    isConnectedTo: function (peerId) {
        if (UserManager.isSpecialContact(peerId) && UserManager.contacts[peerId]?.isAI) {
            return true;
        }
        return WebRTCManager.isConnectedTo(peerId);
    },

    /**
     * 关闭与指定对等端的连接。
     * @param {string} peerId - 对方的 ID。
     */
    close: function (peerId) {
        WebRTCManager.closeConnection(peerId);
    },

    /**
     * @private
     * 设置应用级的事件监听器，响应来自 WebRTCManager 的事件。
     */
    _setupAppEventListeners: function() {
        EventEmitter.on('connectionEstablished', (peerId) => {
            if (ChatAreaUIManager) ChatAreaUIManager.setCallButtonsStateForPeer(peerId, true);
            if (SidebarUIManager) SidebarUIManager.updateChatListItemStatus(peerId, true);
        });

        const handleDisconnect = (peerId) => {
            if (ChatAreaUIManager) ChatAreaUIManager.setCallButtonsStateForPeer(peerId, false);
            if (SidebarUIManager) SidebarUIManager.updateChatListItemStatus(peerId, false);
        };

        EventEmitter.on('connectionDisconnected', handleDisconnect);
        EventEmitter.on('connectionFailed', handleDisconnect);
        EventEmitter.on('connectionClosed', handleDisconnect);

        EventEmitter.on('contactCameOnline', (contactId) => {
            Utils.log(`ConnectionManager: 监听到联系人 ${contactId} 上线，将尝试静默连接。`, Utils.logLevels.INFO);
            this.connectToPeer(contactId, { isSilent: true });
        });
    },

    /**
     * 更新手动连接模态框中的 SDP 文本。
     * @param {string} peerId - 对方的 ID (通常是 placeholder)。
     * @param {object} signalData - simple-peer 的信令数据。
     */
    updateSdpTextInModal: function (peerId, signalData) {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (!sdpTextEl) return;

        const dataToDisplay = {
            userId: UserManager.userId,
            signal: signalData
            // 不再需要包含 isVideoCall 等信息，simple-peer 的信令已包含所有需要的信息
        };
        sdpTextEl.value = JSON.stringify(dataToDisplay, null, 2);
    }
};