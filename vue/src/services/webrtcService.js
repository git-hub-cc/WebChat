import SimplePeer from 'simple-peer';
import { ref } from 'vue';
import { eventBus } from '@/services/eventBus';
import { dbService } from './dbService';
import { log } from '@/utils';
import AppSettings from '@/config/AppSettings';
import { useUserStore } from '@/stores/userStore';

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
// NEW: Map to track pending acknowledgements for reliable messaging
const pendingAcks = new Map();

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

async function _proactivelyConnectToOnlineContacts() {
    const userStore = useUserStore();
    await userStore.fetchOnlineUsers(); // Refresh the list of online users first
    userStore.onlineUserIds.forEach(onlineId => {
        const contact = userStore.contacts[onlineId];
        const isConnected = connections.value[onlineId]?.isConnected ?? false;
        if (contact && !contact.isAI && !isConnected) {
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
            await _proactivelyConnectToOnlineContacts(); // Proactively connect after WS is open
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
        websocket.onclose = () => {
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
        };
        websocket.onerror = (error) => {
            log('WebSocket: Error occurred.', 'ERROR');
            websocket.close(); // Ensure it triggers onclose for reconnect logic
            reject(error);
        };
    });
}

function _cleanupConnection(peerId) {
    if (connections.value[peerId]) {
        connections.value[peerId].peer?.destroy();
        delete connections.value[peerId];
        delete pendingReceivedChunks[peerId];
        delete chunkMetaBuffer[peerId];
        useUserStore().updateContactStatus(peerId, false);
        eventBus.emit('webrtc:disconnected', peerId);
        log(`WebRTC: Cleaned up connection for ${peerId}`, 'INFO');
    }
}

function _handlePeerData(rawData, peerId) {
    const meta = chunkMetaBuffer[peerId];
    if (meta) { // This is a file chunk
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
    } else { // This is a JSON message
        try {
            const message = JSON.parse(new TextDecoder().decode(rawData));

            // --- RELIABLE MESSAGING LOGIC ---
            if (message.type === 'message-ack') {
                const ackInfo = pendingAcks.get(message.ackId);
                if (ackInfo) {
                    clearTimeout(ackInfo.timeout);
                    ackInfo.resolve(); // Resolve the promise for sendMessage
                    pendingAcks.delete(message.ackId);
                    log(`ACK received for message ${message.ackId}`, 'DEBUG');
                }
                return; // ACK handled, no further processing needed
            }
            // If it's not an ACK, send one back immediately
            if (message.id) {
                webrtcService.sendMessage(peerId, { type: 'message-ack', ackId: message.id }, true); // true to suppress ack loop
            }
            // --- END RELIABLE MESSAGING LOGIC ---

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
    peer.on('connect', async () => {
        log(`WebRTC: DataChannel with ${peerId} is connected.`, 'INFO');
        if (connections.value[peerId]) {
            connections.value[peerId].isConnected = true;
        }
        if (peerId === MANUAL_PEER_ID) {
            eventBus.emit('webrtc:manual-connection-ready');
        } else {
            const userStore = useUserStore();
            if (!userStore.contacts[peerId]) {
                await userStore.addContact({ id: peerId });
            }
            userStore.updateContactStatus(peerId, true);
        }
        eventBus.emit('webrtc:connected', peerId);
    });
    peer.on('data', rawData => _handlePeerData(rawData, peerId));
    peer.on('stream', remoteStream => {
        if (remoteStream instanceof MediaStream) {
            log(`WebRTC: Received a valid remote stream from ${peerId}.`, 'INFO');
            eventBus.emit('webrtc:stream', { peerId, stream: remoteStream });
        } else {
            log(`WebRTC: Received an invalid or null stream from ${peerId}.`, 'WARN');
        }
    });
    peer.on('close', () => { _cleanupConnection(peerId); });
    peer.on('error', err => { log(`WebRTC: Error with ${peerId}: ${err.message}`, 'ERROR'); _cleanupConnection(peerId); });
}

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
        if (connections.value[targetPeerId]?.isConnected) {
            log(`WebRTC: Connection to ${targetPeerId} is already connected. Ignoring new offer.`, 'DEBUG');
            return;
        }
        if (connections.value[targetPeerId] && !connections.value[targetPeerId].isConnected) {
            log(`WebRTC: Offer for ${targetPeerId} is already in progress. Ignoring new offer.`, 'DEBUG');
            if (options.stream && connections.value[targetPeerId].peer.streams[0] !== options.stream) {
                log(`WebRTC: Updating stream for ongoing offer to ${targetPeerId}.`, 'DEBUG');
                this.addStreamToConnection(targetPeerId, options.stream);
            }
            return;
        }
        log(`WebRTC: Creating offer for ${targetPeerId}`, 'INFO');
        const peer = new SimplePeer({
            initiator: true,
            config: AppSettings.peerConnectionConfig,
            trickle: true,
            stream: options.stream || false,
        });
        connections.value[targetPeerId] = { peer, isConnected: false };
        _setupPeerListeners(peer, targetPeerId);
    },

    addStreamToConnection(peerId, stream) {
        const conn = connections.value[peerId];
        if (conn?.peer) {
            log(`WebRTC: Adding stream to existing peer for ${peerId}.`, 'INFO');
            if (conn.peer.streams && conn.peer.streams.length > 0) {
                conn.peer.removeStream(conn.peer.streams[0]);
            }
            conn.peer.addStream(stream);
        } else {
            log(`WebRTC: No peer found for ${peerId}. Initiating new connection with stream.`, 'INFO');
            this.createOffer(peerId, { stream });
        }
    },

    removeStreamFromConnection(peerId, stream) {
        const conn = connections.value[peerId];
        if (conn?.peer?.connected && stream) {
            try {
                conn.peer.removeStream(stream);
                log(`WebRTC: Media stream removed from connection with ${peerId}. Data channel remains.`, 'INFO');
            } catch (error) {
                log(`WebRTC: Error removing stream from ${peerId}: ${error.message}`, 'ERROR');
            }
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
            connections.value[fromUserId] = { peer, isConnected: false };
            _setupPeerListeners(peer, fromUserId);
            conn = connections.value[fromUserId];
        }
        conn.peer.signal(payload);
    },

    sendMessage(peerId, messageObject, isAck = false) {
        return new Promise((resolve, reject) => {
            const conn = connections.value[peerId];
            if (!conn?.peer?.connected) {
                log(`WebRTC: Cannot send message to ${peerId}, not connected.`, 'WARN');
                return reject(new Error('not connected'));
            }

            try {
                const messageString = JSON.stringify(messageObject);
                conn.peer.send(messageString);

                if (isAck || !messageObject.id) { // Do not wait for ACK for ACK messages or messages without an ID
                    return resolve();
                }

                const timeout = setTimeout(() => {
                    pendingAcks.delete(messageObject.id);
                    log(`Message ${messageObject.id} to ${peerId} timed out.`, 'WARN');
                    reject(new Error('timeout'));
                }, 5000); // 5 second timeout for ACK

                pendingAcks.set(messageObject.id, { resolve, reject, timeout });
            } catch (error) {
                log(`WebRTC: Error sending message to ${peerId}: ${error.message}`, 'ERROR');
                reject(error);
            }
        });
    },

    async sendFile(peerId, fileObject) {
        const conn = connections.value[peerId];
        if (!conn?.peer?.connected) return false;
        const peer = conn.peer;
        const dataChannel = peer._channel;
        const CHUNK_SIZE = AppSettings.media.chunkSize;
        const HIGH_WATER_MARK = AppSettings.network.dataChannelHighThreshold;

        try {
            await this.sendMessage(peerId, {
                type: 'chunk-meta',
                chunkId: fileObject.hash,
                fileName: fileObject.name,
                fileType: fileObject.type,
                fileSize: fileObject.size,
                totalChunks: Math.ceil(fileObject.blob.size / CHUNK_SIZE),
            });
        } catch (error) {
            log(`Failed to send file metadata for "${fileObject.name}" to ${peerId}. Aborting.`, 'ERROR');
            return false;
        }

        let offset = 0;
        try {
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
        } catch (error) {
            log(`WebRTC: Error sending file chunks to ${peerId}: ${error.message}`, 'ERROR');
            return false;
        }
    },

    closeConnection(peerId) { _cleanupConnection(peerId); },

    createManualOffer() {
        if (connections.value[MANUAL_PEER_ID]) _cleanupConnection(MANUAL_PEER_ID);
        const peer = new SimplePeer({ initiator: true, config: AppSettings.peerConnectionConfig, trickle: false });
        connections.value[MANUAL_PEER_ID] = { peer, isConnected: false };
        _setupPeerListeners(peer, MANUAL_PEER_ID);
        eventBus.emit('showNotification', { message: '连接提议已生成，请复制并发送给对方。', type: 'info' });
    },

    createManualAnswer(offerText) {
        if (!offerText.trim()) { eventBus.emit('showNotification', { message: '请先粘贴对方的连接提议。', type: 'warning' }); return; }
        let offerData;
        try { offerData = JSON.parse(offerText); }
        catch (e) { eventBus.emit('showNotification', { message: '提议格式无效 (非JSON)。', type: 'error' }); return; }
        if (offerData.type !== 'offer') { eventBus.emit('showNotification', { message: '粘贴的内容不是一个有效的连接提议。', type: 'warning' }); return; }
        if (connections.value[MANUAL_PEER_ID]) _cleanupConnection(MANUAL_PEER_ID);
        const peer = new SimplePeer({ initiator: false, config: AppSettings.peerConnectionConfig, trickle: true });
        connections.value[MANUAL_PEER_ID] = { peer, isConnected: false };
        _setupPeerListeners(peer, MANUAL_PEER_ID);
        peer.signal(offerData);
        eventBus.emit('showNotification', { message: '连接应答已生成，请复制并发送给对方。', type: 'info' });
    },

    acceptManualAnswer(answerText) {
        if (!answerText.trim()) { eventBus.emit('showNotification', { message: '请先粘贴对方的连接应答。', type: 'warning' }); return; }
        let answerData;
        try { answerData = JSON.parse(answerText); }
        catch (e) { eventBus.emit('showNotification', { message: '应答格式无效 (非JSON)。', type: 'error' }); return; }
        if (answerData.type !== 'answer') { eventBus.emit('showNotification', { message: '粘贴的内容不是一个有效的连接应答。', type: 'warning' }); return; }
        const conn = connections.value[MANUAL_PEER_ID];
        if (conn && conn.peer && conn.peer.initiator) {
            conn.peer.signal(answerData);
        } else {
            eventBus.emit('showNotification', { message: '未找到待处理的连接提议。请先创建提议。', type: 'error' });
        }
    },

    async bindManualConnection(targetId) {
        if (!targetId) { eventBus.emit('showNotification', { message: '请输入有效的联系人ID。', type: 'error' }); return false; }
        const manualConn = connections.value[MANUAL_PEER_ID];
        if (!manualConn || !manualConn.peer?.connected) { eventBus.emit('showNotification', { message: '没有已建立的手动连接可供绑定。', type: 'error' }); return false; }
        if (connections.value[targetId]) { _cleanupConnection(MANUAL_PEER_ID); return true; }
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