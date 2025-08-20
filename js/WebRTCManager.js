/**
 * @file WebRTCManager.js
 * @description [REFACTORED FOR SIMPLE-PEER] 管理 WebRTC 连接的生命周期。
 *              使用 `simple-peer` 库来抽象化复杂的 SDP 和 ICE 协商过程。
 *              负责创建和管理 SimplePeer 实例，并将其事件（如连接、数据、流）桥接到应用内部的事件系统。
 *              OPTIMIZED: 现在支持复用已存在的 PeerConnection 来添加/移除媒体流，实现持久化数据连接。
 * @module WebRTCManager
 * @exports {object} WebRTCManager
 */
const WebRTCManager = {
    connections: {},
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

    _signalingSender: null,
    _onDataChannelReadyHandler: null,
    _onStreamReadyHandler: null,

    init: function(signalingSender, onDataChannelReady, onStreamReady) {
        this._signalingSender = signalingSender;
        this._onDataChannelReadyHandler = onDataChannelReady;
        this._onStreamReadyHandler = onStreamReady;
        Utils.log("WebRTCManager (SimplePeer) 初始化。", Utils.logLevels.INFO);
    },

    /**
     * [REFACTORED] 使用 SimplePeer 创建或获取一个连接实例。
     * 如果与 peerId 的连接已存在，则复用该连接并可选择添加新的媒体流。
     * @param {string} peerId - 对方的 ID.
     * @param {object} options - 连接选项 { initiator, stream, isVideoCall, isAudioOnly, isScreenShare }.
     * @returns {SimplePeer|null} 新创建或已存在的 SimplePeer 实例。
     */
    initConnection: function(peerId, options = {}) {
        const { initiator = false, stream = null, isVideoCall = false, isAudioOnly = false, isScreenShare = false } = options;

        if (this.connections[peerId] && this.connections[peerId].peer) {
            const peer = this.connections[peerId].peer;
            Utils.log(`WebRTCManager: 复用已存在的 peer 连接: ${peerId}.`, Utils.logLevels.INFO);
            if (stream) {
                // simple-peer 会自动处理移除旧流和添加新流的逻辑
                peer.addStream(stream);
                Utils.log(`WebRTCManager: 已将新媒体流添加到现有连接 ${peerId}.`, Utils.logLevels.DEBUG);
            }
            return peer;
        }

        Utils.log(`WebRTCManager: 为 ${peerId} 初始化新的 SimplePeer 实例。发起者: ${initiator}`, Utils.logLevels.INFO);

        try {
            const peer = new SimplePeer({
                initiator: initiator,
                config: AppSettings.peerConnectionConfig,
                stream: stream,
                trickle: true,
            });

            this.connections[peerId] = {
                peer: peer,
                isVideoCall: isVideoCall,
                isAudioOnly: isAudioOnly,
                isScreenShare: isScreenShare,
                wasInitiatedSilently: false,
                _emittedEstablished: false
            };

            peer.on('signal', signalData => {
                if (typeof this._signalingSender === 'function') {
                    Utils.log(`WebRTCManager: 为 ${peerId} 生成信令数据。`, Utils.logLevels.DEBUG);
                    this._signalingSender('SIGNAL', peerId, signalData, null);
                }
            });

            peer.on('connect', () => {
                const connEntry = this.connections[peerId];
                if (connEntry && !connEntry._emittedEstablished) {
                    Utils.log(`WebRTCManager: 与 ${peerId} 的数据通道已连接。`, Utils.logLevels.INFO);
                    EventEmitter.emit('connectionEstablished', peerId);
                    connEntry._emittedEstablished = true;
                }
                if (typeof this._onDataChannelReadyHandler === 'function' && connEntry) {
                    this._onDataChannelReadyHandler(peer, peerId);
                }
            });

            peer.on('stream', remoteStream => {
                Utils.log(`WebRTCManager: 收到来自 ${peerId} 的远程媒体流。`, Utils.logLevels.INFO);
                if (typeof this._onStreamReadyHandler === 'function') {
                    this._onStreamReadyHandler(remoteStream, peerId);
                }
            });

            peer.on('data', data => {
                if (typeof DataChannelHandler !== 'undefined' && DataChannelHandler.handleData) {
                    DataChannelHandler.handleData(data, peerId);
                }
            });

            peer.on('close', () => {
                Utils.log(`WebRTCManager: 与 ${peerId} 的连接已关闭。`, Utils.logLevels.WARN);
                EventEmitter.emit('connectionClosed', peerId);
                this.closeConnection(peerId, false);
            });

            peer.on('error', err => {
                Utils.log(`WebRTCManager: 与 ${peerId} 的连接发生错误: ${err.message}`, Utils.logLevels.ERROR);
                EventEmitter.emit('connectionFailed', peerId);
                this.closeConnection(peerId, false);
            });

            return peer;
        } catch (error) {
            Utils.log(`WebRTCManager: 创建 SimplePeer 实例失败: ${error.message}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`创建连接失败: ${error.message}`, 'error');
            return null;
        }
    },

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

    handleRemoteSignal: function(fromUserId, signalData) {
        let conn = this.connections[fromUserId];

        if (!conn || !conn.peer) {
            Utils.log(`WebRTCManager: 收到来自 ${fromUserId} 的初始信令，创建非发起方 peer。`, Utils.logLevels.INFO);
            this.initConnection(fromUserId, { initiator: false });
            conn = this.connections[fromUserId];
        }

        if (conn && conn.peer) {
            conn.peer.signal(signalData);
        } else {
            Utils.log(`WebRTCManager: 无法处理来自 ${fromUserId} 的信令，因为无法创建或找到 peer 实例。`, Utils.logLevels.ERROR);
        }
    },

    isConnectedTo: function(peerId) {
        const conn = this.connections[peerId];
        return !!(conn && conn.peer && conn.peer.connected);
    },

    /**
     * [NEW] 从一个活动的连接中移除媒体流，这会触发重新协商但不会断开数据通道。
     * @param {string} peerId - 对方的 ID。
     * @param {MediaStream} stream - 要移除的媒体流。
     */
    removeStreamFromConnection: function(peerId, stream) {
        const conn = this.connections[peerId];
        if (conn && conn.peer && stream) {
            conn.peer.removeStream(stream);
            Utils.log(`WebRTCManager: 已从与 ${peerId} 的连接中移除媒体流。`, Utils.logLevels.INFO);
        }
    },

    closeConnection: function(peerId, notifyPeer = true) {
        const conn = this.connections[peerId];
        if (conn && conn.peer) {
            Utils.log(`WebRTCManager: 正在销毁与 ${peerId} 的连接。`, Utils.logLevels.INFO);
            conn.peer.destroy();
        }
        if (this.connections[peerId]) {
            delete this.connections[peerId];
        }
    },
};