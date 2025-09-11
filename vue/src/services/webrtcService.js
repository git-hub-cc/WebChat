import SimplePeer from 'simple-peer';
import { ref } from 'vue';
import { eventBus } from '@/services/eventBus';
import { dbService } from './dbService';
import { log } from '@/utils';
import AppSettings from '@/config/AppSettings';
import { useUserStore } from '@/stores/userStore';

/**
 * @file webrtcService.js
 * @description (Vue Refactor) 核心 WebRTC 和 WebSocket 服务。
 *              封装了所有实时通信逻辑，包括自动信令和简化的手动信令交换。
 */

// --- Module-level state and constants ---
let currentUserId = null;
const connections = ref({});
const isWebSocketConnected = ref(false);
let websocket = null;
let reconnectAttempts = 0;
let heartbeatInterval = null;
let autoRefreshInterval = null;

const pendingReceivedChunks = {};
const chunkMetaBuffer = {};

const MANUAL_PEER_ID = '_manual_peer_';

// --- WebSocket Core Logic ---
function _sendWsMessage(messageObject) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify(messageObject));
        return true;
    }
    log('WebSocket not connected. Message not sent.', 'WARN');
    return false;
}

function _startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (_sendWsMessage({ type: 'PING' })) {
            log('WebSocket: Sent PING heartbeat', 'DEBUG');
        }
    }, AppSettings.network.websocketHeartbeatInterval);
}

function _stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function _handleWsClose() {
    isWebSocketConnected.value = false;
    _stopHeartbeat();
    eventBus.emit('websocket:status', false);

    if (reconnectAttempts < AppSettings.reconnect.websocket.maxAttempts) {
        reconnectAttempts++;
        const delay = AppSettings.reconnect.websocket.backoffBase * Math.pow(2, reconnectAttempts - 1);
        log(`WebSocket closed. Attempting reconnect #${reconnectAttempts} in ${delay / 1000}s.`, 'WARN');
        setTimeout(() => _connectWebSocket().catch(() => {}), delay);
    } else {
        log('WebSocket max reconnect attempts reached.', 'ERROR');
        eventBus.emit('showNotification', { message: '无法连接到信令服务器，请检查网络或刷新页面。', type: 'error', duration: 10000 });
    }
}

async function _proactivelyConnectToOnlineContacts() {
    const userStore = useUserStore();
    await userStore.fetchOnlineUsers();

    userStore.onlineUserIds.forEach(onlineId => {
        const contact = userStore.contacts[onlineId];
        if (contact && !contact.isOnline) {
            log(`Proactive Connect: Found online contact ${onlineId}. Attempting connection.`, 'INFO');
            webrtcService.createOffer(onlineId, { isSilent: true });
        }
    });
}

function _connectWebSocket() {
    return new Promise((resolve, reject) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) return resolve();
        if (window.location.protocol === 'file:') {
            log('Running from file:// protocol, WebSocket connection skipped.', 'WARN');
            return reject(new Error('Cannot connect from file://'));
        }

        websocket = new WebSocket(AppSettings.server.signalingServerUrl);

        websocket.onopen = async () => {
            log('WebSocket: Connection established.', 'INFO');
            isWebSocketConnected.value = true;
            reconnectAttempts = 0;
            _sendWsMessage({ type: 'REGISTER', userId: currentUserId });
            _startHeartbeat();
            eventBus.emit('websocket:status', true);
            await _proactivelyConnectToOnlineContacts();
            resolve();
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'PONG') return;
            log(`WebSocket: Received message type ${message.type} from ${message.fromUserId || 'server'}`, 'DEBUG');
            if (message.type === 'SIGNAL') {
                eventBus.emit('websocket:signal', message);
            } else {
                eventBus.emit('websocket:message', message);
            }
        };

        websocket.onclose = _handleWsClose;

        websocket.onerror = (error) => {
            log('WebSocket: Error occurred.', 'ERROR');
            websocket.close();
            reject(error);
        };
    });
}

// --- WebRTC (Simple-Peer) Core Logic ---
function _cleanupConnection(peerId) {
    if (connections.value[peerId]) {
        connections.value[peerId].peer?.destroy();
        delete connections.value[peerId];
        delete pendingReceivedChunks[peerId];
        delete chunkMetaBuffer[peerId];
        if (peerId !== MANUAL_PEER_ID) {
            useUserStore().updateContactStatus(peerId, false);
        }
        eventBus.emit('webrtc:disconnected', peerId);
        log(`WebRTC: Cleaned up connection for ${peerId}`, 'INFO');
    }
}

function _handlePeerData(rawData, peerId) {
    const meta = chunkMetaBuffer[peerId];
    if (meta) {
        const assembly = pendingReceivedChunks[peerId]?.[meta.chunkId];
        if (assembly) {
            assembly.chunks[assembly.received] = rawData;
            assembly.received++;
            if (assembly.received === assembly.total) {
                const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });
                delete pendingReceivedChunks[peerId][meta.chunkId];
                delete chunkMetaBuffer[peerId];
                log(`File "${meta.fileName}" received from ${peerId}.`, 'INFO');
                dbService.setItem('fileCache', {
                    id: meta.chunkId,
                    fileBlob: fileBlob,
                    metadata: { name: meta.fileName, type: meta.fileType, size: meta.fileSize }
                }).then(() => {
                    eventBus.emit('file:ready', { fileHash: meta.chunkId });
                });
            }
        }
    } else {
        try {
            const message = JSON.parse(new TextDecoder().decode(rawData));
            if (message.type === 'chunk-meta') {
                chunkMetaBuffer[peerId] = message;
                if (!pendingReceivedChunks[peerId]) pendingReceivedChunks[peerId] = {};
                pendingReceivedChunks[peerId][message.chunkId] = {
                    id: message.chunkId,
                    total: message.totalChunks,
                    received: 0,
                    chunks: new Array(message.totalChunks)
                };
            } else {
                eventBus.emit('webrtc:message', { peerId, message });
            }
        } catch (e) {
            log(`WebRTC: Received non-JSON data from ${peerId}`, 'WARN');
        }
    }
}

function _setupPeerListeners(peer, peerId) {
    peer.on('signal', signalData => {
        if (peerId === MANUAL_PEER_ID) {
            eventBus.emit('webrtc:manual-signal', signalData);
        } else {
            _sendWsMessage({ type: 'SIGNAL', targetUserId: peerId, payload: signalData, userId: currentUserId });
        }
    });

    peer.on('connect', () => {
        log(`WebRTC: DataChannel with ${peerId} is connected.`, 'INFO');
        if (peerId === MANUAL_PEER_ID) {
            eventBus.emit('webrtc:manual-connection-ready');
        } else {
            const userStore = useUserStore();
            userStore.addContact({ id: peerId });
            userStore.updateContactStatus(peerId, true);
        }
        eventBus.emit('webrtc:connected', peerId);
    });

    peer.on('data', rawData => _handlePeerData(rawData, peerId));
    peer.on('stream', remoteStream => eventBus.emit('webrtc:stream', { peerId, stream: remoteStream }));
    peer.on('close', () => _cleanupConnection(peerId));
    peer.on('error', err => {
        log(`WebRTC: Error with ${peerId}: ${err.message}`, 'ERROR');
        _cleanupConnection(peerId);
    });
}

// --- Public Service API ---
export const webrtcService = {
    connections,
    isWebSocketConnected,

    async init(userId) {
        if (!userId) throw new Error("webrtcService init: userId is required.");
        currentUserId = userId;
        eventBus.on('websocket:signal', ({ fromUserId, payload }) => {
            this.handleIncomingSignal(fromUserId, payload);
        });
        try {
            await _connectWebSocket();
            this.startAutoRefresh();
        } catch (error) {
            log('Failed to initialize WebSocket connection.', 'ERROR');
        }
    },

    startAutoRefresh() {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(_proactivelyConnectToOnlineContacts, 30000);
        log('WebRTC Service: Started periodic online user refresh and auto-connect task.', 'INFO');
    },

    stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    },

    createOffer(targetPeerId, options = {}) {
        if (connections.value[targetPeerId]) {
            log(`WebRTC: Connection attempt for ${targetPeerId} already exists. Ignoring.`, 'DEBUG');
            return;
        }
        log(`WebRTC: Creating offer for ${targetPeerId}`, 'INFO');
        const peer = new SimplePeer({
            initiator: true,
            config: AppSettings.peerConnectionConfig,
            trickle: true,
            stream: options.stream || false,
        });
        connections.value[targetPeerId] = { peer };
        _setupPeerListeners(peer, targetPeerId);
    },

    addStreamToConnection(peerId, stream) {
        const conn = connections.value[peerId];
        if (conn?.peer) {
            conn.peer.addStream(stream);
            log(`WebRTC: Stream added to connection with ${peerId}`, 'INFO');
        } else {
            log(`WebRTC: Could not add stream, no connection for ${peerId}`, 'WARN');
        }
    },

    async handleIncomingSignal(fromUserId, payload) {
        let conn = connections.value[fromUserId];
        if (!conn) {
            log(`WebRTC: Received initial signal from ${fromUserId}, creating peer.`, 'INFO');
            const userStore = useUserStore();
            if (!userStore.contacts[fromUserId]) {
                await userStore.addContact({ id: fromUserId });
            }
            const peer = new SimplePeer({ initiator: false, config: AppSettings.peerConnectionConfig, trickle: true });
            connections.value[fromUserId] = { peer };
            _setupPeerListeners(peer, fromUserId);
            conn = connections.value[fromUserId];
        }
        conn.peer.signal(payload);
    },

    sendMessage(peerId, messageObject) {
        const conn = connections.value[peerId];
        if (conn?.peer?.connected) {
            conn.peer.send(JSON.stringify(messageObject));
            return true;
        }
        log(`WebRTC: Cannot send message to ${peerId}, not connected.`, 'WARN');
        return false;
    },

    async sendFile(peerId, fileObject) {
        const conn = connections.value[peerId];
        if (!conn?.peer?.connected) return false;
        const peer = conn.peer;
        const dataChannel = peer._channel;
        const CHUNK_SIZE = AppSettings.media.chunkSize;
        const HIGH_WATER_MARK = AppSettings.network.dataChannelHighThreshold;

        this.sendMessage(peerId, {
            type: 'chunk-meta',
            chunkId: fileObject.hash,
            fileName: fileObject.name,
            fileType: fileObject.type,
            fileSize: fileObject.size,
            totalChunks: Math.ceil(fileObject.blob.size / CHUNK_SIZE),
        });

        let offset = 0;
        while (offset < fileObject.blob.size) {
            if (dataChannel.bufferedAmount > HIGH_WATER_MARK) {
                await new Promise(resolve => {
                    const listener = () => { dataChannel.removeEventListener('bufferedamountlow', listener); resolve(); };
                    dataChannel.addEventListener('bufferedamountlow', listener);
                });
            }
            const chunk = fileObject.blob.slice(offset, offset + CHUNK_SIZE);
            peer.send(chunk);
            offset += chunk.size;
        }
        return true;
    },

    closeConnection(peerId) { _cleanupConnection(peerId); },

    createManualOffer() {
        if (connections.value[MANUAL_PEER_ID]) {
            _cleanupConnection(MANUAL_PEER_ID);
        }
        log('WebRTC: Creating manual offer with trickle:false...', 'INFO');
        const peer = new SimplePeer({
            initiator: true,
            config: AppSettings.peerConnectionConfig,
            trickle: false,
        });
        connections.value[MANUAL_PEER_ID] = { peer };
        _setupPeerListeners(peer, MANUAL_PEER_ID);
        eventBus.emit('showNotification', { message: '连接提议已生成，请复制并发送给对方。', type: 'info' });
    },

    createManualAnswer(offerText) {
        if (!offerText.trim()) {
            eventBus.emit('showNotification', { message: '请先粘贴对方的连接提议。', type: 'warning' });
            return;
        }
        let offerData;
        try { offerData = JSON.parse(offerText); }
        catch (e) { eventBus.emit('showNotification', { message: '提议格式无效 (非JSON)。', type: 'error' }); return; }

        if (offerData.type !== 'offer') {
            eventBus.emit('showNotification', { message: '粘贴的内容不是一个有效的连接提议。', type: 'warning' });
            return;
        }

        if (connections.value[MANUAL_PEER_ID]) {
            _cleanupConnection(MANUAL_PEER_ID);
        }

        log('WebRTC: Handling manual offer, creating answer with trickle:false...', 'INFO');
        const peer = new SimplePeer({ initiator: false, config: AppSettings.peerConnectionConfig, trickle: false });
        connections.value[MANUAL_PEER_ID] = { peer };
        _setupPeerListeners(peer, MANUAL_PEER_ID);
        peer.signal(offerData);
        eventBus.emit('showNotification', { message: '连接应答已生成，请复制并发送给对方。', type: 'info' });
    },

    acceptManualAnswer(answerText) {
        if (!answerText.trim()) {
            eventBus.emit('showNotification', { message: '请先粘贴对方的连接应答。', type: 'warning' });
            return;
        }

        let answerData;
        try { answerData = JSON.parse(answerText); }
        catch (e) { eventBus.emit('showNotification', { message: '应答格式无效 (非JSON)。', type: 'error' }); return; }

        if (answerData.type !== 'answer') {
            eventBus.emit('showNotification', { message: '粘贴的内容不是一个有效的连接应答。', type: 'warning' });
            return;
        }

        const conn = connections.value[MANUAL_PEER_ID];
        if (conn && conn.peer && conn.peer.initiator) {
            log('WebRTC: Handling manual answer to complete connection...', 'INFO');
            conn.peer.signal(answerData);
        } else {
            eventBus.emit('showNotification', { message: '未找到待处理的连接提议。请先创建提议。', type: 'error' });
        }
    },

    async bindManualConnection(targetId) {
        if (!targetId) {
            eventBus.emit('showNotification', { message: '请输入有效的联系人ID。', type: 'error' });
            return false;
        }

        const manualConn = connections.value[MANUAL_PEER_ID];
        if (!manualConn || !manualConn.peer?.connected) {
            eventBus.emit('showNotification', { message: '没有已建立的手动连接可供绑定。', type: 'error' });
            return false;
        }

        if (connections.value[targetId]) {
            log(`WebRTC: A connection for ${targetId} already exists. Cleaning up manual connection.`, 'WARN');
            _cleanupConnection(MANUAL_PEER_ID);
            return true;
        }

        log(`WebRTC: Binding manual connection to contact ID: ${targetId}`, 'INFO');

        connections.value[targetId] = manualConn;
        delete connections.value[MANUAL_PEER_ID];

        manualConn.peer.removeAllListeners();
        _setupPeerListeners(manualConn.peer, targetId);

        const userStore = useUserStore();
        await userStore.addContact({ id: targetId });
        userStore.updateContactStatus(targetId, true);

        eventBus.emit('showNotification', { message: `已成功连接到 ${userStore.contacts[targetId]?.name || targetId}`, type: 'success' });

        return true;
    }
};