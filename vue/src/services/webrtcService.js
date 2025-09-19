import SimplePeer from 'simple-peer';
import { ref } from 'vue';
import { eventBus } from '@/services/eventBus';
import { dbService } from './dbService';
import { log } from '@/utils';
import AppSettings from '@/config/AppSettings';
import { useUserStore } from '@/stores/userStore';
import { useTransferStore } from '@/stores/transferStore';
import { throttle } from 'lodash-es';

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
const statsIntervals = new Map();

// Throttled function to update transfer stats without overwhelming the system.
const _throttledCalculateStats = throttle(() => {
    const transferStore = useTransferStore();
    transferStore.calculateStats();
}, 500, { leading: false, trailing: true });


function _sendWsMessage(messageObject) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify(messageObject));
        return true;
    }
    log('WebSocket 未连接。消息未发送。', 'WARN');
    return false;
}

function _startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (_sendWsMessage({ type: 'PING' })) {
            log('WebSocket: 已发送 PING 心跳', 'DEBUG');
        }
    }, AppSettings.network.websocketHeartbeatInterval);
}

function _stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

async function proactivelyConnectToOnlineContacts() {
    const userStore = useUserStore();
    await userStore.fetchAllOnlineUsers();
    userStore.allOnlineUsers.forEach(onlineUser => {
        const contactId = onlineUser.userId;
        const contact = userStore.contacts[contactId];
        const conn = connections.value[contactId];
        const isConnected = conn?.isConnected ?? false;
        const isConnecting = conn && !conn.isConnected;

        if (contact && !contact.isAI && !isConnected && !isConnecting) {
            log(`主动连接: 发现全网在线联系人 ${contactId}。尝试连接。`, 'INFO');
            webrtcService.createOffer(contactId, { isSilent: true });
        }
    });
}

function _connectWebSocket() {
    return new Promise((resolve, reject) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) return resolve();
        if (window.location.protocol === 'file:') {
            log('正在从 file:// 协议运行，WebSocket 连接已跳过。', 'WARN');
            return reject(new Error('无法从 file:// 连接'));
        }
        websocket = new WebSocket(AppSettings.server.signalingServerUrl);
        websocket.onopen = async () => {
            log('WebSocket: 连接已建立。', 'INFO');
            isWebSocketConnected.value = true;
            reconnectAttempts = 0;
            _sendWsMessage({ type: 'REGISTER', userId: currentUserId });
            _startHeartbeat();
            eventBus.emit('websocket:status', true);
            await webrtcService.proactivelyConnectToOnlineContacts();
            resolve();
        };
        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'PONG') return;
            log(`WebSocket: 收到消息，类型 ${message.type} 来自 ${message.fromUserId || '服务器'}`, 'DEBUG');

            if (message.type === 'SIGNAL') {
                eventBus.emit('websocket:signal', message);
            } else if (message.type === 'APP_MESSAGE') {
                log(`收到来自 ${message.fromUserId} 的 APP_MESSAGE，负载类型: ${message.payload.type}`, 'DEBUG');
                eventBus.emit('webrtc:message', { peerId: message.fromUserId, message: message.payload });
            } else {
                eventBus.emit('websocket:message', message);
            }
        };
        websocket.onclose = () => {
            isWebSocketConnected.value = false;
            _stopHeartbeat();
            eventBus.emit('websocket:status', false);
            if (reconnectAttempts < AppSettings.reconnect.websocket.maxAttempts) {
                const delay = Math.min(
                    AppSettings.reconnect.websocket.backoffBase * Math.pow(2, reconnectAttempts),
                    AppSettings.reconnect.websocket.maxDelay
                );
                const jitter = delay * 0.2 * Math.random(); // Add jitter
                reconnectAttempts++;
                log(`WebSocket 已关闭。将在 ${(delay + jitter) / 1000}秒 后尝试第 ${reconnectAttempts} 次重连。`, 'WARN');
                setTimeout(() => _connectWebSocket().catch(() => {}), delay + jitter);
            } else {
                log('WebSocket 达到最大重连次数。', 'ERROR');
                eventBus.emit('showNotification', { message: '无法连接到信令服务器，请检查网络或刷新页面。', type: 'error', duration: 10000 });
            }
        };
        websocket.onerror = (error) => {
            log('WebSocket: 发生错误。', 'ERROR');
            websocket.close(); // Ensure close event is fired for reconnect logic
            reject(error);
        };
    });
}

function _cleanupConnection(peerId) {
    if (statsIntervals.has(peerId)) {
        clearInterval(statsIntervals.get(peerId));
        statsIntervals.delete(peerId);
    }
    const conn = connections.value[peerId];
    if (conn) {
        if (conn.iceCheckingTimeout) clearTimeout(conn.iceCheckingTimeout);
        conn.peer?.destroy();
        delete connections.value[peerId];
        delete pendingReceivedChunks[peerId];
        delete chunkMetaBuffer[peerId];
        // Fail any ongoing transfers from this peer
        const transferStore = useTransferStore();
        transferStore.failTransfersForPeer(peerId);
        // ✅ MODIFICATION START: Update userStore with connection details on cleanup
        useUserStore().updateContactConnectionDetails(peerId, { isConnected: false, connectionType: null });
        // ✅ MODIFICATION END
        eventBus.emit('webrtc:disconnected', peerId);
        log(`WebRTC: 已清理 ${peerId} 的连接`, 'INFO');
    }
}
function _handlePeerData(rawData, peerId) {
    const meta = chunkMetaBuffer[peerId];
    if (meta) { // This is a binary file chunk
        const transferStore = useTransferStore();
        transferStore.updateProgress(meta.chunkId, rawData.byteLength);
        _throttledCalculateStats(); // Update stats based on progress

        const assembly = pendingReceivedChunks[peerId]?.[meta.chunkId];
        if (assembly) {
            assembly.chunks[assembly.received] = rawData;
            assembly.received++;
            if (assembly.received === assembly.total) {
                const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });
                const receivedMeta = { ...meta };
                delete pendingReceivedChunks[peerId][meta.chunkId];
                delete chunkMetaBuffer[peerId];

                transferStore.endTransfer(receivedMeta.chunkId); // Mark transfer as complete

                log(`文件 "${receivedMeta.fileName}" 已从 ${peerId} 接收。`, 'INFO');
                dbService.setItem('fileCache', {
                    id: receivedMeta.chunkId,
                    fileBlob: fileBlob,
                    metadata: { name: receivedMeta.fileName, type: receivedMeta.fileType, size: receivedMeta.fileSize }
                }).then(() => {
                    eventBus.emit('file:ready', { fileHash: receivedMeta.chunkId, messageId: receivedMeta.messageId });
                    if (receivedMeta.messageId) {
                        webrtcService.sendMessage(peerId, { type: 'file-transfer-complete', ackId: receivedMeta.messageId }, true);
                    }
                });
            }
        }
    } else { // This is a JSON message
        try {
            const message = JSON.parse(new TextDecoder().decode(rawData));
            if (message.type === 'retract-message-request') {
                eventBus.emit('message:retracted', {
                    chatId: message.groupId || peerId,
                    messageId: message.messageId,
                    retractedByName: message.retractedByName
                });
                webrtcService.sendMessage(peerId, { type: 'retract-message-ack', messageId: message.messageId }, true);
                return;
            }
            if (message.type === 'retract-message-ack') {
                eventBus.emit('message:retracted-ack', { messageId: message.messageId });
                return;
            }
            if (message.type === 'message-ack') { eventBus.emit('message:delivered', { messageId: message.ackId, peerId }); return; }
            if (message.type === 'file-transfer-complete') { eventBus.emit('message:file-delivered', { messageId: message.ackId, peerId }); return; }
            if (message.id) { if (message.type === 'text' || message.type.startsWith('call-') || message.type === 'typing') { webrtcService.sendMessage(peerId, { type: 'message-ack', ackId: message.id }, true); } }
            if (message.type === 'typing') { eventBus.emit('webrtc:typing', { peerId }); return; }
            if (message.type === 'chunk-meta') {
                chunkMetaBuffer[peerId] = message;
                if (!pendingReceivedChunks[peerId]) pendingReceivedChunks[peerId] = {};
                pendingReceivedChunks[peerId][message.chunkId] = {
                    id: message.chunkId,
                    total: message.totalChunks,
                    received: 0,
                    chunks: new Array(message.totalChunks)
                };
                // Emit event for chatStore to create a placeholder message
                eventBus.emit('file:transfer-initiated', {
                    peerId,
                    messageId: message.messageId,
                    fileHash: message.chunkId,
                    fileName: message.fileName,
                    fileSize: message.fileSize,
                    fileType: message.fileType
                });
            } else {
                eventBus.emit('webrtc:message', { peerId, message });
            }
        } catch (e) {
            log(`WebRTC: 从 ${peerId} 收到非JSON数据`, 'WARN');
        }
    }
}
function _startStatsPolling(peer, peerId) {
    if (statsIntervals.has(peerId)) { clearInterval(statsIntervals.get(peerId)); }
    const intervalId = setInterval(() => {
        if (!peer || !peer.connected) { clearInterval(statsIntervals.get(peerId)); statsIntervals.delete(peerId); return; }
        peer.getStats((err, statsReports) => {
            if (err) { log(`获取 ${peerId} 的 WebRTC 统计信息时出错: ${err.message}`, 'WARN'); return; }
            if (!Array.isArray(statsReports)) { log(` ${peerId} 的统计信息格式异常。期望为数组。`, 'WARN'); return; }
            let rtt = null, jitter = null, packetsLost = 0, packetsSent = 0;
            const remoteInboundReports = {};
            statsReports.forEach(report => { if (report.type === 'remote-inbound-rtp') { remoteInboundReports[report.id] = report; } });
            statsReports.forEach(report => {
                if (report.type === 'remote-inbound-rtp' && (report.kind === 'video' || report.kind === 'audio')) {
                    if (report.roundTripTime !== undefined && (rtt === null || report.roundTripTime < rtt)) { rtt = report.roundTripTime * 1000; }
                    if (report.jitter !== undefined && (jitter === null || report.jitter < jitter)) { jitter = report.jitter * 1000; }
                }
                if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.kind === 'audio')) {
                    packetsSent += report.packetsSent || 0;
                    const remoteReport = remoteInboundReports[report.remoteId];
                    if (remoteReport && remoteReport.packetsLost) { packetsLost += remoteReport.packetsLost; }
                }
            });
            const totalPackets = packetsSent + packetsLost;
            const packetLossRate = totalPackets > 0 ? (packetsLost / totalPackets) : 0;
            if (rtt !== null || jitter !== null) {
                eventBus.emit('webrtc:stats-updated', { peerId, stats: { rtt, jitter, packetLoss: packetLossRate } });
            }
        });
    }, 5000);
    statsIntervals.set(peerId, intervalId);
}

// ✅ MODIFICATION START: New function for connection type diagnostics
async function _diagnoseConnectionType(peer, peerId) {
    const userStore = useUserStore();
    try {
        // Simple-peer uses callbacks, so we wrap getStats in a Promise
        const stats = await new Promise((resolve, reject) => {
            peer.getStats((err, reports) => {
                if (err) return reject(err);
                resolve(reports);
            });
        });

        let connectionType = 'unknown';

        // The stats object from simple-peer is an array of reports
        const candidatePairs = stats.filter(report => report.type === 'candidate-pair' && report.state === 'succeeded');

        if (candidatePairs.length > 0) {
            const activePair = candidatePairs[0]; // Usually the first succeeded pair is the active one
            const localCandidate = stats.find(r => r.id === activePair.localCandidateId);
            const remoteCandidate = stats.find(r => r.id === activePair.remoteCandidateId);

            if (localCandidate && remoteCandidate) {
                const localType = localCandidate.candidateType;
                const remoteType = remoteCandidate.candidateType;
                log(`[DIAGNOSTIC] Connection to ${peerId}: Local=${localType} -> Remote=${remoteType}`, 'INFO');

                if (localType === 'relay' || remoteType === 'relay') {
                    connectionType = 'relay';
                } else if (localType === 'srflx' || remoteType === 'srflx') {
                    connectionType = 'p2p';
                } else if (localType === 'host' && remoteType === 'host') {
                    connectionType = 'p2p-lan';
                }
            }
        }

        if (connectionType !== 'unknown') {
            log(`[DIAGNOSTIC] Final connection type for ${peerId} is: ${connectionType.toUpperCase()}`, 'INFO');
            userStore.updateContactConnectionDetails(peerId, { connectionType });
        } else {
            log(`[DIAGNOSTIC] Could not determine final connection type for ${peerId}.`, 'WARN');
            userStore.updateContactConnectionDetails(peerId, { connectionType: 'unknown' });
        }
    } catch (e) {
        log(`[DIAGNOSTIC] Failed to get stats for peer ${peerId}: ${e.message}`, 'ERROR');
        userStore.updateContactConnectionDetails(peerId, { connectionType: 'error' });
    }
}
// ✅ MODIFICATION END

function _setupPeerListeners(peer, peerId) {
    peer.on('signal', signalData => {
        if (peerId === MANUAL_PEER_ID) {
            eventBus.emit('webrtc:manual-signal', signalData);
        } else {
            _sendWsMessage({ type: 'SIGNAL', targetUserId: peerId, payload: signalData, userId: currentUserId });
        }
    });
    peer.on('connect', async () => {
        log(`WebRTC: 与 ${peerId} 的 DataChannel 已连接。`, 'INFO');
        const conn = connections.value[peerId];
        if (conn) {
            if (conn.iceCheckingTimeout) clearTimeout(conn.iceCheckingTimeout);
            conn.isConnected = true;
        }
        _startStatsPolling(peer, peerId);

        // ✅ MODIFICATION START: Trigger connection diagnostics
        _diagnoseConnectionType(peer, peerId);
        // ✅ MODIFICATION END

        if (peerId === MANUAL_PEER_ID) {
            eventBus.emit('webrtc:manual-connection-ready');
        } else {
            const userStore = useUserStore();
            if (!userStore.contacts[peerId]) await userStore.addContact({ id: peerId });
            // The userStore now handles more detailed status updates
            userStore.updateContactConnectionDetails(peerId, { isConnected: true });
        }
        eventBus.emit('webrtc:connected', peerId);
    });
    peer.on('data', rawData => _handlePeerData(rawData, peerId));
    peer.on('stream', remoteStream => {
        if (remoteStream instanceof MediaStream) {
            log(`WebRTC: 从 ${peerId} 收到一个有效的远程流。`, 'INFO');
            eventBus.emit('webrtc:stream', { peerId, stream: remoteStream });
        } else {
            log(`WebRTC: 从 ${peerId} 收到一个无效或null的流。`, 'WARN');
        }
    });

    peer.on('iceStateChange', (iceConnectionState) => {
        log(`WebRTC: ${peerId} ICE state changed to ${iceConnectionState}`, 'DEBUG');
        const conn = connections.value[peerId];
        if (!conn) return;

        if (conn.iceCheckingTimeout) clearTimeout(conn.iceCheckingTimeout);

        if (iceConnectionState === 'checking') {
            conn.iceCheckingTimeout = setTimeout(() => {
                log(`WebRTC: ${peerId} ICE checking timed out. Cleaning up.`, 'WARN');
                _cleanupConnection(peerId);
            }, AppSettings.timeouts.iceChecking);
        } else if (iceConnectionState === 'failed' || iceConnectionState === 'disconnected') {
            log(`WebRTC: Connection to ${peerId} is unstable or failed. Attempting ICE restart.`, 'WARN');
            webrtcService.restartIce(peerId);
        }
    });

    peer.on('close', () => { _cleanupConnection(peerId); });
    peer.on('error', err => { log(`WebRTC: 与 ${peerId} 发生错误: ${err.message}`, 'ERROR'); _cleanupConnection(peerId); });
}

export const webrtcService = {
    connections,
    isWebSocketConnected,
    async init(userId) {
        if (!userId) throw new Error("webrtcService init: 必须提供 userId。");
        currentUserId = userId;
        eventBus.on('websocket:signal', ({ fromUserId, payload }) => {
            this.handleIncomingSignal(fromUserId, payload);
        });
        try {
            await _connectWebSocket();
            this.startAutoRefresh();
        } catch (error) {
            log('初始化WebSocket连接失败。', 'ERROR');
        }
    },
    sendViaSignaling(targetUserId, payload) {
        if (!isWebSocketConnected.value) {
            log(`无法发送信令消息给 ${targetUserId}: WebSocket 未连接。`, 'ERROR');
            eventBus.emit('showNotification', { message: '无法发送邀请：未连接到服务器。', type: 'error' });
            return false;
        }
        log(`正在通过 WebSocket 向 ${targetUserId} 发送应用消息。类型: ${payload.type}`, 'INFO');
        return _sendWsMessage({
            type: 'APP_MESSAGE',
            userId: currentUserId,
            targetUserId: targetUserId,
            payload: payload
        });
    },
    startAutoRefresh() {
        if (autoRefreshInterval) clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(proactivelyConnectToOnlineContacts, 30000);
        log('WebRTC 服务: 已启动周期性在线用户刷新和自动连接任务。', 'INFO');
    },
    stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    },
    proactivelyConnectToOnlineContacts,
    createOffer(targetPeerId, options = {}) {
        if (connections.value[targetPeerId]?.isConnected) {
            log(`WebRTC: 到 ${targetPeerId} 的连接已存在。忽略新提议。`, 'DEBUG');
            return;
        }
        if (connections.value[targetPeerId] && !connections.value[targetPeerId].isConnected) {
            log(`WebRTC: 针对 ${targetPeerId} 的提议已在进行中。忽略新提议。`, 'DEBUG');
            if (options.stream && connections.value[targetPeerId].peer.streams[0] !== options.stream) {
                log(`WebRTC: 正在为进行中的提议更新到 ${targetPeerId} 的流。`, 'DEBUG');
                this.addStreamToConnection(targetPeerId, options.stream);
            }
            return;
        }
        log(`WebRTC: 正在为 ${targetPeerId} 创建提议`, 'INFO');
        const peer = new SimplePeer({
            initiator: true,
            config: AppSettings.peerConnectionConfig,
            trickle: true,
            stream: options.stream || false,
        });
        connections.value[targetPeerId] = { peer, isConnected: false, iceCheckingTimeout: null };
        _setupPeerListeners(peer, targetPeerId);
    },
    addStreamToConnection(peerId, stream) {
        const conn = connections.value[peerId];
        if (conn?.peer) {
            log(`WebRTC: 正在向 ${peerId} 的现有对等连接添加流。`, 'INFO');
            if (conn.peer.streams && conn.peer.streams.length > 0) {
                conn.peer.removeStream(conn.peer.streams[0]);
            }
            conn.peer.addStream(stream);
        } else {
            log(`WebRTC: 未找到 ${peerId} 的对等连接。正在使用流初始化新连接。`, 'INFO');
            this.createOffer(peerId, { stream });
        }
    },
    removeStreamFromConnection(peerId, stream) {
        const conn = connections.value[peerId];
        if (conn?.peer?.connected && stream) {
            try {
                conn.peer.removeStream(stream);
                log(`WebRTC: 已从与 ${peerId} 的连接中移除媒体流。数据通道保持连接。`, 'INFO');
            } catch (error) {
                log(`WebRTC: 从 ${peerId} 移除流时出错: ${error.message}`, 'ERROR');
            }
        }
    },
    async handleIncomingSignal(fromUserId, payload) {
        let conn = connections.value[fromUserId];
        if (!conn) {
            log(`WebRTC: 收到来自 ${fromUserId} 的初始信令，正在创建对等连接。`, 'INFO');
            const userStore = useUserStore();
            if (!userStore.contacts[fromUserId]) await userStore.addContact({ id: fromUserId });
            const peer = new SimplePeer({ initiator: false, config: AppSettings.peerConnectionConfig, trickle: true });
            connections.value[fromUserId] = { peer, isConnected: false, iceCheckingTimeout: null };
            _setupPeerListeners(peer, fromUserId);
            conn = connections.value[fromUserId];
        }
        conn.peer.signal(payload);
    },
    sendMessage(peerId, messageObject, isAck = false) {
        const conn = connections.value[peerId];
        if (!conn?.peer?.connected) {
            log(`WebRTC: 无法向 ${peerId} 发送消息，未连接。`, 'WARN');
            throw new Error('not connected');
        }
        try {
            const messageString = JSON.stringify(messageObject);
            conn.peer.send(messageString);
            return true;
        } catch (error) {
            log(`WebRTC: 向 ${peerId} 发送消息时出错: ${error.message}`, 'ERROR');
            throw error;
        }
    },
    sendTyping(peerId) {
        const conn = connections.value[peerId];
        if (conn?.peer?.connected) {
            try {
                conn.peer.send(JSON.stringify({ type: 'typing' }));
            } catch (error) {
                log(`向 ${peerId} 发送输入中指示失败: ${error.message}`, 'WARN');
            }
        }
    },
    async sendFile(peerId, fileObject) {
        const conn = connections.value[peerId];
        if (!conn?.peer?.connected) return false;
        const peer = conn.peer;
        const dataChannel = peer._channel;
        const CHUNK_SIZE = AppSettings.media.chunkSize;
        const HIGH_WATER_MARK = AppSettings.network.dataChannelHighThreshold;
        try {
            this.sendMessage(peerId, {
                type: 'chunk-meta',
                messageId: fileObject.messageId,
                chunkId: fileObject.hash,
                fileName: fileObject.name,
                fileType: fileObject.type,
                fileSize: fileObject.size,
                totalChunks: Math.ceil(fileObject.blob.size / CHUNK_SIZE),
            });
        } catch (error) {
            log(`向 ${peerId} 发送文件元数据 "${fileObject.name}" 失败。中止。`, 'ERROR');
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
            log(`WebRTC: 向 ${peerId} 发送文件块时出错: ${error.message}`, 'ERROR');
            return false;
        }
    },
    closeConnection(peerId) { _cleanupConnection(peerId); },
    restartIce(peerId) {
        const conn = connections.value[peerId];
        if (conn && conn.peer) {
            log(`WebRTC: Manually restarting ICE for peer ${peerId}`, 'INFO');
            conn.peer.destroy();
            this.createOffer(peerId);
        }
    },
    async adjustPeerBitrate(peerId, { maxBitrate, resolution }) {
        const conn = connections.value[peerId];
        if (!conn || !conn.peer || !conn.peer.connected) return;

        const videoSender = conn.peer._pc.getSenders().find(s => s.track?.kind === 'video');
        if (!videoSender) {
            log(`Cannot adjust bitrate: No active video sender found for peer ${peerId}. (This is expected for audio-only calls)`, 'DEBUG');
            return;
        }

        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
        }
        if (maxBitrate) {
            params.encodings[0].maxBitrate = maxBitrate;
        } else {
            delete params.encodings[0].maxBitrate;
        }

        await videoSender.setParameters(params);
        log(`WebRTC: Adjusted bitrate for ${peerId} to ${maxBitrate ? maxBitrate / 1000 + 'kbps' : 'auto'}.`, 'INFO');

        if (resolution && videoSender.track) {
            try {
                await videoSender.track.applyConstraints({
                    height: { ideal: resolution.height }
                });
                log(`WebRTC: Adjusted resolution for ${peerId} to ideal height ${resolution.height}p.`, 'INFO');
            } catch (e) {
                log(`WebRTC: Failed to apply resolution constraint for ${peerId}: ${e.message}`, 'ERROR');
            }
        }
    },
    async testNetwork() {
        const results = { stun: 'Testing...', turnUdp: 'Pending...', turnTcp: 'Pending...', turnTls: 'Pending...' };
        const testPeerConnection = new RTCPeerConnection({ iceServers: AppSettings.peerConnectionConfig.iceServers });

        const candidatePromise = new Promise(resolve => {
            const candidates = [];
            testPeerConnection.onicecandidate = (e) => {
                if (e.candidate) {
                    candidates.push(e.candidate);
                } else {
                    resolve(candidates);
                }
            };
            setTimeout(() => resolve(candidates), AppSettings.timeouts.iceGathering);
        });

        testPeerConnection.createDataChannel('test');
        testPeerConnection.createOffer().then(offer => testPeerConnection.setLocalDescription(offer));

        const gatheredCandidates = await candidatePromise;
        testPeerConnection.close();

        if (gatheredCandidates.length > 0) {
            const hasSrflx = gatheredCandidates.some(c => c.type === 'srflx');
            results.stun = hasSrflx ? 'OK' : 'Failed';
            results.turnUdp = gatheredCandidates.some(c => c.type === 'relay' && c.protocol === 'udp') ? 'OK' : 'Failed';
            results.turnTcp = gatheredCandidates.some(c => c.type === 'relay' && c.protocol === 'tcp') ? 'OK' : 'Failed';
            // Simple-peer doesn't expose TLS info directly, we infer it from port 443
            results.turnTls = gatheredCandidates.some(c => c.type === 'relay' && c.port === 443) ? 'OK' : 'Failed';
        } else {
            results.stun = results.turnUdp = results.turnTcp = results.turnTls = 'Failed';
        }
        return results;
    },
    createManualOffer() {
        if (connections.value[MANUAL_PEER_ID]) _cleanupConnection(MANUAL_PEER_ID);
        const peer = new SimplePeer({ initiator: true, config: AppSettings.peerConnectionConfig, trickle: false });
        connections.value[MANUAL_PEER_ID] = { peer, isConnected: false, iceCheckingTimeout: null };
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
        connections.value[MANUAL_PEER_ID] = { peer, isConnected: false, iceCheckingTimeout: null };
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
        userStore.updateContactConnectionDetails(targetId, { isConnected: true });
        eventBus.emit('showNotification', { message: `已成功连接到 ${userStore.contacts[targetId]?.name || targetId}`, type: 'success' });
        return true;
    }
};