/**
 * @file DataChannelHandler.js
 * @description [REFACTORED FOR SIMPLE-PEER] 处理 SimplePeer 数据通道的消息收发、分片和重组逻辑。
 *              负责解析收到的 Uint8Array 数据，将其区分为 JSON 消息或文件块，并分派给相应的管理器。
 *              同时提供统一的 sendData 和 sendFile 方法供上层调用。
 *              MODIFIED: sendFile 方法现在实现了背压（backpressure）处理，以防止在发送大文件时 RTCDataChannel 的发送队列溢出。
 * @module DataChannelHandler
 * @dependencies Utils, AppSettings, UserManager, ChatManager, GroupManager, VideoCallManager, MessageManager, ConnectionManager, EventEmitter, DBManager
 */
const DataChannelHandler = {
    _chunkMetaBuffer: {}, // { peerId: metadataObject }

    /**
     * [REFACTORED] 为给定的 SimplePeer 实例设置事件处理器。
     * @param {SimplePeer} peerInstance - SimplePeer 实例。
     * @param {string} peerId - 与此通道关联的对方 ID。
     */
    setupChannel: function(peerInstance, peerId) {
        // simple-peer 的事件监听器已在 WebRTCManager.initConnection 中统一设置。
        // 这个方法现在主要用于确认和日志记录，或者将来添加特定于非媒体数据通道的逻辑。
        Utils.log(`DataChannelHandler: 已为 peer ${peerId} 确认通道设置。事件监听器由 WebRTCManager 管理。`, Utils.logLevels.DEBUG);
    },

    /**
     * [OPTIMIZED] 处理从 SimplePeer 的 'data' 事件接收到的所有数据。
     * 假定所有传入的 rawData 都是 Uint8Array 类型。
     * @param {Uint8Array} rawData - 收到的原始数据。
     * @param {string} peerId - 数据来源的对方 ID。
     */
    handleData: async function(rawData, peerId) {
        try {
            const meta = this._chunkMetaBuffer[peerId];

            // 逻辑分支：
            // 1. 如果存在文件元数据 (meta)，则将收到的数据视为二进制文件块。
            // 2. 如果不存在元数据，则尝试将数据解码为 JSON 消息。

            if (meta) {
                // --- 处理二进制文件块 ---
                if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
                if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};

                const assembly = ConnectionManager.pendingReceivedChunks[peerId][meta.chunkId];
                if (assembly) {
                    assembly.chunks[assembly.received] = rawData;
                    assembly.received++;
                    if (assembly.received === assembly.total) {
                        const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });
                        delete ConnectionManager.pendingReceivedChunks[peerId][meta.chunkId];
                        delete this._chunkMetaBuffer[peerId]; // 清理元数据，结束文件传输状态

                        Utils.log(`文件 "${meta.fileName}" (ID: ${meta.chunkId}) 从 ${peerId} 接收完毕。`, Utils.logLevels.INFO);

                        await DBManager.setItem('fileCache', {
                            id: meta.chunkId,
                            fileBlob: fileBlob,
                            metadata: { name: meta.fileName, type: meta.fileType, size: meta.fileSize }
                        });

                        EventEmitter.emit('fileDataReady', {
                            fileHash: meta.chunkId,
                            fileType: meta.fileType,
                            fileName: meta.fileName
                        });
                    }
                } else {
                    Utils.log(`收到来自 ${peerId} 的二进制块，但找不到对应的组装信息 (ID: ${meta.chunkId})。忽略。`, Utils.logLevels.WARN);
                }
            } else {
                // --- 解码并处理 JSON 消息 ---
                let messageObject;
                try {
                    const decoder = new TextDecoder('utf-8');
                    const textData = decoder.decode(rawData);
                    messageObject = JSON.parse(textData);
                } catch (parseError) {
                    Utils.log(`收到来自 ${peerId} 的无法解析为 JSON 的数据。可能是一个没有元数据的 stray 文件块。已忽略。`, Utils.logLevels.WARN);
                    return;
                }

                messageObject.sender = messageObject.sender || peerId;

                // 优先处理 'chunk-meta' 消息，它会为后续的文件块设置 meta
                if (messageObject.type === 'chunk-meta') {
                    this._chunkMetaBuffer[peerId] = messageObject;
                    if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
                    if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};
                    ConnectionManager.pendingReceivedChunks[peerId][messageObject.chunkId] = {
                        id: messageObject.chunkId,
                        total: messageObject.totalChunks,
                        received: 0,
                        chunks: new Array(messageObject.totalChunks)
                    };
                    Utils.log(`收到来自 ${peerId} 的文件元数据: "${messageObject.fileName}" (ID: ${messageObject.chunkId})`, Utils.logLevels.INFO);
                    return;
                }

                // 分派其他类型的 JSON 消息
                if (messageObject.type?.startsWith('video-call-')) VideoCallManager.handleMessage(messageObject, peerId);
                else if (messageObject.groupId || messageObject.type?.startsWith('group-')) GroupManager.handleGroupMessage(messageObject);
                else if (messageObject.type === 'retract-message-request') {
                    const senderName = messageObject.senderName || UserManager.contacts[messageObject.sender]?.name || `用户 ${String(messageObject.sender).substring(0, 4)}`;
                    MessageManager._updateMessageToRetractedState(messageObject.originalMessageId, messageObject.sender, false, senderName);
                }
                else {
                    ChatManager.addMessage(peerId, messageObject);
                }
            }
        } catch (e) {
            Utils.log(`DataChannelHandler: 来自 ${peerId} 的 onmessage 严重错误: ${e.message}. 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * [MODIFIED] 异步发送文件，支持任意类型，并处理背压。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} fileObject - 包含文件信息的对象 { blob, hash, name, type, size }。
     * @returns {Promise<boolean>} - 文件成功发送则 resolve(true)。
     */
    sendFile: async function(peerId, fileObject) {
        const conn = WebRTCManager.connections[peerId];
        const peer = conn?.peer;

        if (!peer || !peer.connected) {
            Utils.log(`DataChannelHandler.sendFile: 无法发送到 ${peerId}，连接未建立。`, Utils.logLevels.ERROR);
            return false;
        }

        // 使用 _channel 访问底层的 RTCDataChannel 以检查 bufferedAmount
        const dataChannel = peer._channel;
        if (!dataChannel) {
            Utils.log(`DataChannelHandler.sendFile: 无法访问 ${peerId} 的数据通道。`, Utils.logLevels.ERROR);
            return false;
        }

        const CHUNK_SIZE = AppSettings.media.chunkSize;
        const HIGH_WATER_MARK = AppSettings.network.dataChannelHighThreshold;
        const totalChunks = Math.ceil(fileObject.blob.size / CHUNK_SIZE);

        Utils.log(`准备发送文件 "${fileObject.name}" (大小: ${fileObject.size} bytes) 到 ${peerId}，共 ${totalChunks} 个分片。`, Utils.logLevels.INFO);

        // 步骤 1: 发送元数据
        const metadata = {
            type: 'chunk-meta',
            chunkId: fileObject.hash,
            fileName: fileObject.name,
            fileType: fileObject.type,
            fileSize: fileObject.size,
            totalChunks: totalChunks,
            sender: UserManager.userId
        };
        this.sendData(peerId, metadata);

        // 步骤 2: 分片并发送文件数据，处理背压
        let offset = 0;
        try {
            while (offset < fileObject.blob.size) {
                // 如果缓冲区的字节数超过高水位线，则等待
                if (dataChannel.bufferedAmount > HIGH_WATER_MARK) {
                    await new Promise(resolve => {
                        // 创建一个一次性监听器
                        const listener = () => {
                            dataChannel.removeEventListener('bufferedamountlow', listener);
                            resolve();
                        };
                        dataChannel.addEventListener('bufferedamountlow', listener);
                    });
                }

                const chunk = fileObject.blob.slice(offset, offset + CHUNK_SIZE);
                peer.send(chunk);
                offset += chunk.size;
            }

            Utils.log(`文件 "${fileObject.name}" 已成功发送到 ${peerId}。`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`DataChannelHandler.sendFile: 在发送文件块到 ${peerId} 时出错: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    },

    /**
     * [MODIFIED] 通过数据通道向指定对等端发送 JSON 消息。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} messageObject - 要发送的 JSON 消息对象。
     * @returns {boolean} - 消息是否成功排入发送队列。
     */
    sendData: function (peerId, messageObject) {
        const conn = WebRTCManager.connections[peerId];
        const peer = conn?.peer;

        if (peer && peer.connected) {
            try {
                messageObject.sender = messageObject.sender || UserManager.userId;
                messageObject.timestamp = messageObject.timestamp || new Date().toISOString();
                const messageString = JSON.stringify(messageObject);
                peer.send(messageString);
                return true;
            } catch (error) {
                Utils.log(`DataChannelHandler: 通过数据通道向 ${peerId} 发送时出错: ${error.message}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log(`DataChannelHandler: 无法发送到 ${peerId}: 连接未建立或不存在。`, Utils.logLevels.WARN);
            return false;
        }
    }
};