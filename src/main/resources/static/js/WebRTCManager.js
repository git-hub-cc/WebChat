/**
 * @file WebRTCManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 管理 WebRTC 连接的生命周期。
 *              使用 `simple-peer` 库来抽象化复杂的 SDP 和 ICE 协商过程。
 *              负责创建和管理 SimplePeer 实例，并将其事件（如连接、数据、流）桥接到应用内部的事件系统。
 * @module WebRTCManager
 * @exports {object} WebRTCManager
 */
const WebRTCManager = {
    // [MODIFIED] connections 对象现在存储 { peer: SimplePeer, ... }
    connections: {}, // { peerId: { peer: SimplePeer, isVideoCall, wasInitiatedSilently, ... } }
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

    _signalingSender: null,
    _onDataChannelReadyHandler: null, // Note: This is now triggered on 'connect' event
    _onStreamReadyHandler: null, // [NEW] Callback for when a remote stream is received

    /**
     * 初始化 WebRTCManager.
     * @param {function} signalingSender - 发送信令消息的回调.
     * @param {function} onDataChannelReady - 数据通道就绪时的回调.
     * @param {function} onStreamReady - 远程媒体流就绪时的回调.
     */
    init: function(signalingSender, onDataChannelReady, onStreamReady) {
        this._signalingSender = signalingSender;
        this._onDataChannelReadyHandler = onDataChannelReady;
        this._onStreamReadyHandler = onStreamReady;
        Utils.log("WebRTCManager (SimplePeer) 初始化。", Utils.logLevels.INFO);
    },

    /**
     * [REFACTORED] 使用 SimplePeer 创建或获取一个连接实例。
     * 这是所有连接创建的入口点。
     * @param {string} peerId - 对方的 ID.
     * @param {object} options - 连接选项 { initiator, stream, isVideoCall, isAudioOnly, isScreenShare }.
     * @returns {SimplePeer|null} 新创建或已存在的 SimplePeer 实例。
     */
    initConnection: function(peerId, options = {}) {
        const { initiator = false, stream = null, isVideoCall = false, isAudioOnly = false, isScreenShare = false } = options;

        if (this.connections[peerId] && this.connections[peerId].peer) {
            Utils.log(`WebRTCManager: 已存在与 ${peerId} 的连接。将复用实例。`, Utils.logLevels.INFO);
            // 如果需要，可以更新流
            if (stream && this.connections[peerId].peer.localStream !== stream) {
                this.connections[peerId].peer.addStream(stream);
            }
            return this.connections[peerId].peer;
        }

        Utils.log(`WebRTCManager: 为 ${peerId} 初始化新的 SimplePeer 实例。发起者: ${initiator}`, Utils.logLevels.INFO);

        try {
            const peer = new SimplePeer({
                initiator: initiator,
                config: AppSettings.peerConnectionConfig,
                stream: stream,
                trickle: true, // 启用 trickle ICE 以加快连接速度
            });

            this.connections[peerId] = {
                peer: peer,
                isVideoCall: isVideoCall,
                isAudioOnly: isAudioOnly,
                isScreenShare: isScreenShare,
                wasInitiatedSilently: false, // 将由 createOffer 设置
                _emittedEstablished: false
            };

            // --- 核心事件监听 ---

            // 1. 'signal' 事件：当有信令数据需要发送给对方时触发
            peer.on('signal', signalData => {
                if (typeof this._signalingSender === 'function') {
                    Utils.log(`WebRTCManager: 为 ${peerId} 生成信令数据。`, Utils.logLevels.DEBUG);
                    this._signalingSender('SIGNAL', peerId, signalData, null);
                }
            });

            // 2. 'connect' 事件：数据通道建立成功
            peer.on('connect', () => {
                const connEntry = this.connections[peerId];
                if (connEntry && !connEntry._emittedEstablished) {
                    Utils.log(`WebRTCManager: 与 ${peerId} 的数据通道已连接。`, Utils.logLevels.INFO);
                    EventEmitter.emit('connectionEstablished', peerId);
                    connEntry._emittedEstablished = true;
                }
                if (typeof this._onDataChannelReadyHandler === 'function' && connEntry) {
                    // 传递 peer 实例，因为 simple-peer 将数据通道抽象掉了
                    this._onDataChannelReadyHandler(peer, peerId);
                }
            });

            // 3. 'stream' 事件：收到远程媒体流
            peer.on('stream', remoteStream => {
                Utils.log(`WebRTCManager: 收到来自 ${peerId} 的远程媒体流。`, Utils.logLevels.INFO);
                if (typeof this._onStreamReadyHandler === 'function') {
                    this._onStreamReadyHandler(remoteStream, peerId);
                }
            });

            // 4. 'data' 事件：收到数据
            peer.on('data', data => {
                // 将数据传递给 DataChannelHandler 处理
                if (typeof DataChannelHandler !== 'undefined' && DataChannelHandler.handleData) {
                    DataChannelHandler.handleData(data, peerId);
                }
            });

            // 5. 'close' 事件：连接已关闭
            peer.on('close', () => {
                Utils.log(`WebRTCManager: 与 ${peerId} 的连接已关闭。`, Utils.logLevels.WARN);
                EventEmitter.emit('connectionClosed', peerId);
                this.closeConnection(peerId, false); // 清理本地状态
            });

            // 6. 'error' 事件：发生错误
            peer.on('error', err => {
                Utils.log(`WebRTCManager: 与 ${peerId} 的连接发生错误: ${err.message}`, Utils.logLevels.ERROR);
                EventEmitter.emit('connectionFailed', peerId);
                this.closeConnection(peerId, false); // 错误后清理
            });

            return peer;
        } catch (error) {
            Utils.log(`WebRTCManager: 创建 SimplePeer 实例失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`创建连接失败: ${error.message}`, 'error');
            return null;
        }
    },

    /**
     * [REFACTORED] 发起一个 WebRTC 连接。
     * @param {string} targetPeerId - 目标对方的 ID。
     * @param {object} [options={}] - 连接选项，如 { isVideoCall, stream, isSilent }.
     */
    createOffer: function(targetPeerId, options = {}) {
        const { isSilent = false, ...peerOptions } = options;
        const peer = this.initConnection(targetPeerId, { ...peerOptions, initiator: true });

        if (peer && this.connections[targetPeerId]) {
            this.connections[targetPeerId].wasInitiatedSilently = isSilent;
            if (!isSilent && ChatManager.currentChatId === targetPeerId) {
                ChatAreaUIManager.updateChatHeaderStatus(`正在连接到 ${UserManager.contacts[targetPeerId]?.name || targetPeerId.substring(0, 8)}...`);
            }
        }
    },

    /**
     * [REFACTORED] 处理收到的远程信令数据。
     * @param {string} fromUserId - 发送方的 ID。
     * @param {object} signalData - simple-peer 的信令数据。
     */
    handleRemoteSignal: function(fromUserId, signalData) {
        let conn = this.connections[fromUserId];

        // 如果连接不存在，创建一个非发起方实例
        if (!conn || !conn.peer) {
            Utils.log(`WebRTCManager: 收到来自 ${fromUserId} 的初始信令，创建非发起方 peer。`, Utils.logLevels.INFO);
            this.initConnection(fromUserId, { initiator: false });
            conn = this.connections[fromUserId];
        }

        if (conn && conn.peer) {
            // 将信令数据传递给 simple-peer 实例
            conn.peer.signal(signalData);
        } else {
            Utils.log(`WebRTCManager: 无法处理来自 ${fromUserId} 的信令，因为无法创建或找到 peer 实例。`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 检查与指定对等方的数据通道是否已连接。
     * @param {string} peerId - 对方的 ID。
     * @returns {boolean}
     */
    isConnectedTo: function(peerId) {
        const conn = this.connections[peerId];
        return !!(conn && conn.peer && conn.peer.connected);
    },

    /**
     * [REFACTORED] 关闭与指定对等端的连接。
     * @param {string} peerId - 对方的 ID。
     * @param {boolean} [notifyPeer=true] - (不再使用，但保留签名以兼容)
     */
    closeConnection: function(peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn && conn.peer) {
            Utils.log(`WebRTCManager: 正在销毁与 ${peerId} 的连接。`, Utils.logLevels.INFO);
            conn.peer.destroy();
        }
        // 从映射中删除，以确保状态干净
        if (this.connections[peerId]) {
            delete this.connections[peerId];
        }
    },
};