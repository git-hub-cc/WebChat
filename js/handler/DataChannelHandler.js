/**
 * @file DataChannelHandler.js
 * @description [REFACTORED FOR SIMPLE-PEER] 处理 SimplePeer 数据通道的消息收发、分片和重组逻辑。
 *              负责解析收到的数据（JSON 消息或文件块），并将它们分派给相应的管理器。
 *              同时提供统一的 sendData 和 sendFile 方法供上层调用。
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
     * [NEW] 处理从 SimplePeer 的 'data' 事件接收到的所有数据。
     * @param {ArrayBuffer|string} rawData - 收到的原始数据。
     * @param {string} peerId - 数据来源的对方 ID。
     */
    handleData: async function(rawData, peerId) {
        try {
            // --- 处理二进制文件块 ---
            if (rawData instanceof ArrayBuffer) {
                const meta = this._chunkMetaBuffer[peerId];
                if (!meta) {
                    Utils.log(`收到来自 ${peerId} 的二进制块，但没有元数据。忽略。`, Utils.logLevels.WARN);
                    return;
                }
                if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
                if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};

                const assembly = ConnectionManager.pendingReceivedChunks[peerId][meta.chunkId];
                if (assembly) {
                    assembly.chunks[assembly.received] = rawData;
                    assembly.received++;
                    if (assembly.received === assembly.total) {
                        const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });
                        delete ConnectionManager.pendingReceivedChunks[peerId][meta.chunkId];
                        delete this._chunkMetaBuffer[peerId];

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
                }
            }
            // --- 处理 JSON 字符串消息 ---
            else if (typeof rawData === 'string') {
                const messageObject = JSON.parse(rawData);
                messageObject.sender = messageObject.sender || peerId;

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
            } else {
                // simple-peer v9+ uses Uint8Array, we need to decode it.
                const decoder = new TextDecoder('utf-8');
                const textData = decoder.decode(rawData);
                this.handleData(textData, peerId);
            }
        } catch (e) {
            Utils.log(`DataChannelHandler: 来自 ${peerId} 的 onmessage 严重错误: ${e.message}. 数据类型: ${rawData.constructor.name} 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * [MODIFIED] 异步发送文件，支持任意类型。
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

        const CHUNK_SIZE = AppSettings?.media?.chunkSize || 256 * 1024;
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

        // 步骤 2: 分片并发送文件数据
        let offset = 0;
        try {
            while (offset < fileObject.blob.size) {
                const chunk = fileObject.blob.slice(offset, offset + CHUNK_SIZE);
                // simple-peer 可以直接发送 Blob/File
                peer.send(chunk);
                offset += chunk.size;
            }
            Utils.log(`文件 "${fileObject.name}" 已成功发送到 ${peerId} 的发送队列。`, Utils.logLevels.INFO);
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