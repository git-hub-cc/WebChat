/**
 * @file WebRTCManager.js
 * @description 【重构】使用 simple-peer 库管理 WebRTC 连接的生命周期。
 *              此类现在作为 simple-peer 实例的工厂和管理器，将底层的 WebRTC 复杂性完全抽象掉。
 *              它监听 simple-peer 实例的事件，并将其转换为应用范围内的 EventEmitter 事件。
 * @module WebRTCManager
 * @exports {object} WebRTCManager
 * @dependencies simple-peer, Utils, EventEmitter, DataChannelHandler, VideoCallManager
 */
const WebRTCManager = {
    peers: {}, // { peerId: simplePeerInstance }
    _signalingSender: null,
    MANUAL_PLACEHOLDER_PEER_ID: '_manual_placeholder_peer_id_',

    /**
     * 初始化 WebRTCManager。
     * @param {function} signalingSender - 发送信令消息的回调函数。
     */
    init: function(signalingSender) {
        this._signalingSender = signalingSender;
        Utils.log("WebRTCManager (simple-peer) 初始化。", Utils.logLevels.INFO);
    },

    /**
     * 获取或创建一个与指定 peerId 的连接。
     * @param {string} peerId - 对方的 ID。
     * @param {object} options - simple-peer 的配置选项 (e.g., { initiator: true, stream: localStream }).
     * @returns {Peer|null} 返回一个 simple-peer 实例，如果创建失败则返回 null。
     */
    getConnection: function(peerId, options = {}) {
        if (this.peers[peerId] && !this.peers[peerId].destroyed) {
            Utils.log(`WebRTCManager: 正在复用与 ${peerId} 的现有连接。`, Utils.logLevels.DEBUG);
            return this.peers[peerId];
        }

        Utils.log(`WebRTCManager: 正在为 ${peerId} 创建新的 simple-peer 连接。发起者: ${!!options.initiator}`, Utils.logLevels.INFO);

        try {
            const peer = new SimplePeer({
                initiator: !!options.initiator,
                trickle: true, // 启用 ICE Trickling 以加快连接速度
                config: AppSettings.peerConnectionConfig,
                stream: options.stream || false, // 传入媒体流（如果存在）
            });

            this.peers[peerId] = peer;
            this._setupPeerEventHandlers(peer, peerId, options.isSilent);

            return peer;
        } catch (error) {
            Utils.log(`WebRTCManager: 创建 simple-peer 实例失败 for ${peerId}: ${error}`, Utils.logLevels.ERROR);
            return null;
        }
    },

    /**
     * @private
     * 为 simple-peer 实例设置事件处理器。
     * @param {Peer} peer - simple-peer 实例。
     * @param {string} peerId - 与此实例关联的对方 ID。
     * @param {boolean} isSilent - 是否为静默连接尝试。
     */
    _setupPeerEventHandlers: function(peer, peerId, isSilent) {
        peer.on('signal', signalData => {
            Utils.log(`WebRTCManager: 'signal' 事件 from peer ${peerId}`, Utils.logLevels.DEBUG);
            if (this._signalingSender) {
                this._signalingSender(peerId, signalData, isSilent);
            }
        });

        peer.on('connect', () => {
            Utils.log(`WebRTCManager: 'connect' 事件: 与 ${peerId} 的数据通道已建立。`, Utils.logLevels.INFO);
            EventEmitter.emit('connectionEstablished', peerId);
        });

        peer.on('data', data => {
            // 所有数据（JSON 和二进制块的元数据）都通过 'data' 事件到达
            DataChannelHandler.receiveData(peerId, data);
        });

        peer.on('stream', stream => {
            Utils.log(`WebRTCManager: 'stream' 事件: 收到来自 ${peerId} 的远程媒体流。`, Utils.logLevels.INFO);
            if (VideoCallManager && typeof VideoCallManager.handleRemoteStream === 'function') {
                VideoCallManager.handleRemoteStream(peerId, stream);
            } else {
                VideoCallUIManager.setRemoteStream(stream);
            }
        });

        peer.on('close', () => {
            Utils.log(`WebRTCManager: 'close' 事件: 与 ${peerId} 的连接已关闭。`, Utils.logLevels.INFO);
            EventEmitter.emit('connectionClosed', peerId);
            this.cleanupPeer(peerId);
        });

        peer.on('error', err => {
            Utils.log(`WebRTCManager: 'error' 事件 from peer ${peerId}: ${err.message}`, Utils.logLevels.ERROR);
            EventEmitter.emit('connectionFailed', peerId);
            this.cleanupPeer(peerId);
        });
    },

    /**
     * 处理从信令服务器收到的信号。
     * @param {string} fromUserId - 信号的来源用户 ID。
     * @param {object} signalData - simple-peer 的信令数据。
     */
    handleSignal: function(fromUserId, signalData) {
        let peer = this.peers[fromUserId];
        if (!peer) {
            Utils.log(`WebRTCManager: 收到来自 ${fromUserId} 的信号，但没有活动的 peer 实例。正在创建新的非发起者 peer。`, Utils.logLevels.INFO);
            // 如果收到一个 offer 信号，我们需要创建一个非发起者 peer 来响应
            peer = this.getConnection(fromUserId, { initiator: false });
            if (!peer) return;
        }

        // 将信号数据喂给 peer 实例
        peer.signal(signalData);
    },

    /**
     * 检查与指定 peerId 的连接是否已建立。
     * @param {string} peerId - 对方的 ID。
     * @returns {boolean} - 如果连接已建立且数据通道打开，则返回 true。
     */
    isConnectedTo: function(peerId) {
        return this.peers[peerId] && this.peers[peerId].connected;
    },

    /**
     * 获取一个已存在的 peer 实例。
     * @param {string} peerId - 对方的 ID。
     * @returns {Peer|undefined}
     */
    getPeer: function(peerId) {
        return this.peers[peerId];
    },

    /**
     * 关闭并清理与指定 peerId 的连接。
     * @param {string} peerId - 对方的 ID。
     */
    closeConnection: function(peerId) {
        if (this.peers[peerId]) {
            Utils.log(`WebRTCManager: 正在主动关闭与 ${peerId} 的连接。`, Utils.logLevels.INFO);
            this.peers[peerId].destroy(); // simple-peer 的销毁方法会触发 'close' 事件
        }
    },

    /**
     * @private
     * 从管理器中移除 peer 实例的引用。
     * @param {string} peerId - 对方的 ID。
     */
    cleanupPeer: function(peerId) {
        if (this.peers[peerId]) {
            delete this.peers[peerId];
            Utils.log(`WebRTCManager: 已清理 ${peerId} 的 peer 实例。`, Utils.logLevels.DEBUG);
        }
    }
};