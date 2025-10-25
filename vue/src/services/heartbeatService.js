/**
 * @file heartbeatService.js
 * @description (新文件) 集中管理 WebSocket 和 WebRTC DataChannel 的心跳逻辑。
 *              该服务可以在文件传输等高负载操作期间暂停，并在结束后恢复。
 * @module Services
 */
import { log } from '@/utils';
import AppSettings from '@/config/AppSettings';
import { useTransferStore } from '@/stores/transferStore';

let _transferInProgressCount = 0;
let _wsSendFunc = null;
let _dcSendFunc = null;
let _connectionsRef = null; // A ref to webrtcService.connections

let _wsHeartbeatInterval = null;
let _dcHeartbeatInterval = null;

const _startWsHeartbeat = () => {
    if (_wsHeartbeatInterval) clearInterval(_wsHeartbeatInterval);
    _wsHeartbeatInterval = setInterval(() => {
        if (_transferInProgressCount === 0 && typeof _wsSendFunc === 'function') {
            if (_wsSendFunc({ type: 'PING' })) {
                log('WebSocket: Sent PING heartbeat', 'DEBUG');
            }
        }
    }, AppSettings.network.websocketHeartbeatInterval);
};

const _stopWsHeartbeat = () => {
    if (_wsHeartbeatInterval) {
        clearInterval(_wsHeartbeatInterval);
        _wsHeartbeatInterval = null;
    }
};

const _startDcHeartbeat = () => {
    if (_dcHeartbeatInterval) clearInterval(_dcHeartbeatInterval);
    _dcHeartbeatInterval = setInterval(() => {
        if (_transferInProgressCount === 0 && _connectionsRef?.value && typeof _dcSendFunc === 'function') {
            Object.keys(_connectionsRef.value).forEach(peerId => {
                const conn = _connectionsRef.value[peerId];
                if (conn?.peer?.connected && conn.peer?._channel?.readyState === 'open') {
                    try {
                        conn.lastPingSent = Date.now();
                        _dcSendFunc(peerId, { type: 'datachannel-ping' }, true);

                        if (conn.lastPongReceived && (Date.now() - conn.lastPongReceived > 35000)) {
                            log(`DataChannel to ${peerId} seems unresponsive. Triggering ICE restart.`, 'WARN');
                            // Avoid circular dependency by emitting an event
                            const { webrtcService } = require('@/services/webrtcService'); // Lazy require
                            webrtcService.restartIce(peerId);
                        }
                    } catch (e) {
                        log(`Failed to send DataChannel ping to ${peerId}: ${e.message}`, 'WARN');
                    }
                }
            });
        }
    }, 15000); // Send every 15 seconds
};

const _stopDcHeartbeat = () => {
    if (_dcHeartbeatInterval) {
        clearInterval(_dcHeartbeatInterval);
        _dcHeartbeatInterval = null;
    }
};

export const heartbeatService = {
    /**
     * Initializes the heartbeat service.
     * @param {Function} wsSendFunc - Function to send a WebSocket message.
     * @param {Function} dcSendFunc - Function to send a DataChannel message.
     * @param {import('vue').Ref<object>} connectionsRef - A Vue ref pointing to the connections object in webrtcService.
     */
    init(wsSendFunc, dcSendFunc, connectionsRef) {
        _wsSendFunc = wsSendFunc;
        _dcSendFunc = dcSendFunc;
        _connectionsRef = connectionsRef;

        this.resumeAll(); // Start heartbeats
        log('Heartbeat service initialized and started.', 'INFO');
    },

    /**
     * Pauses all heartbeat activities. Call this before starting a high-load operation like file transfer.
     */
    pause() {
        _transferInProgressCount++;
        log(`Heartbeats paused. Active transfers: ${_transferInProgressCount}`, 'DEBUG');
    },

    /**
     * Resumes all heartbeat activities. Call this after a high-load operation is complete.
     */
    resume() {
        _transferInProgressCount = Math.max(0, _transferInProgressCount - 1);
        log(`Heartbeats resumed. Active transfers: ${_transferInProgressCount}`, 'DEBUG');
    },

    /**
     * Starts all heartbeats if not already running.
     */
    resumeAll() {
        _startWsHeartbeat();
        _startDcHeartbeat();
    },

    /**
     * Stops all heartbeat timers completely.
     */
    shutdown() {
        _stopWsHeartbeat();
        _stopDcHeartbeat();
        _transferInProgressCount = 0;
        log('Heartbeat service shut down.', 'INFO');
    },

    /**
     * Notifies the service that a peer has disconnected, allowing it to adjust
     * the transfer count for any transfers that were in progress with that peer.
     * @param {string} peerId - The ID of the disconnected peer.
     */
    notifyPeerDisconnected(peerId) {
        const transferStore = useTransferStore();
        const activeTransfers = transferStore.countActiveTransfersForPeer(peerId);
        if (activeTransfers > 0) {
            _transferInProgressCount = Math.max(0, _transferInProgressCount - activeTransfers);
            log(`Peer ${peerId} disconnected with ${activeTransfers} active transfer(s). Heartbeat count adjusted to ${_transferInProgressCount}.`, 'WARN');
        }
    },
};