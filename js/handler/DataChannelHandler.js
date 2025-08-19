/**
 * @file DataChannelHandler.js
 * @description 【重构】处理 RTCDataChannel 的消息接收、分片和重组逻辑。
 *              此类不再直接与 RTCDataChannel 事件交互，而是作为 simple-peer 'data' 事件的回调处理器。
 *              它负责区分JSON消息和二进制文件块，并正确处理它们。
 *              sendFile 方法现在直接使用 simple-peer 实例的 send 方法。
 * @module DataChannelHandler
 * @exports {object} DataChannelHandler
 * @dependencies Utils, AppSettings, UserManager, ChatManager, GroupManager, VideoCallManager, MessageManager, ConnectionManager, EventEmitter, DBManager, WebRTCManager
 */
const DataChannelHandler = {
    _chunkMetaBuffer: {}, // { peerId: metadataObject }

    /**
     * @private
     * @deprecated setupChannel 已被移除。所有通道事件由 WebRTCManager 中的 simple-peer 实例处理。
     */
    setupChannel: function() {
        Utils.log("DataChannelHandler.setupChannel 已被废弃，请勿调用。", Utils.logLevels.WARN);
    },

    /**
     * [REFACTORED] 从 simple-peer 的 'data' 事件接收数据。
     * 负责解析消息类型（字符串JSON或二进制ArrayBuffer）并进行相应处理。
     * @param {string} peerId - 数据来源的对方 ID。
     * @param {string|ArrayBuffer} rawData - 接收到的原始数据。
     */
    receiveData: async function(peerId, rawData) {
        try {
            if (rawData instanceof ArrayBuffer) {
                // 这是二进制文件块
                this._handleBinaryChunk(peerId, rawData);
            } else if (typeof rawData === 'string') {
                // 这是JSON消息
                const messageObject = JSON.parse(rawData);
                if (messageObject.type === 'chunk-meta') {
                    this._handleChunkMetadata(peerId, messageObject);
                } else {
                    this._handleJsonMessage(peerId, messageObject);
                }
            } else {
                // simple-peer v9+ might send Buffer objects in Node.js environments,
                // but in browser it should be ArrayBuffer. We can convert if needed.
                if (typeof Buffer !== 'undefined' && rawData instanceof Buffer) {
                    this._handleBinaryChunk(peerId, rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength));
                } else {
                    Utils.log(`DataChannelHandler: 收到来自 ${peerId} 的未知数据类型。`, Utils.logLevels.WARN);
                }
            }
        } catch (e) {
            Utils.log(`DataChannelHandler: 来自 ${peerId} 的 onmessage 严重错误: ${e.message}. 数据: ${String(rawData).substring(0, 100)}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * @private
     * 处理接收到的二进制文件块。
     * @param {string} peerId - 数据来源的对方 ID。
     * @param {ArrayBuffer} arrayBuffer - 接收到的二进制数据块。
     */
    _handleBinaryChunk: async function(peerId, arrayBuffer) {
        const meta = this._chunkMetaBuffer[peerId];
        if (!meta) {
            Utils.log(`收到来自 ${peerId} 的二进制块，但没有元数据。忽略。`, Utils.logLevels.WARN);
            return;
        }

        if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
        if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};

        const assembly = ConnectionManager.pendingReceivedChunks[peerId][meta.chunkId];
        if (assembly) {
            assembly.chunks[assembly.received] = arrayBuffer;
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
    },

    /**
     * @private
     * 处理文件块的元数据消息。
     * @param {string} peerId - 数据来源的对方 ID。
     * @param {object} metadata - 文件元数据对象。
     */
    _handleChunkMetadata: function(peerId, metadata) {
        this._chunkMetaBuffer[peerId] = metadata;
        if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
        if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};
        ConnectionManager.pendingReceivedChunks[peerId][metadata.chunkId] = {
            id: metadata.chunkId,
            total: metadata.totalChunks,
            received: 0,
            chunks: new Array(metadata.totalChunks)
        };
        Utils.log(`收到来自 ${peerId} 的文件元数据: "${metadata.fileName}" (ID: ${metadata.chunkId})`, Utils.logLevels.INFO);
    },

    /**
     * @private
     * 处理非文件块的普通JSON消息。
     * @param {string} peerId - 数据来源的对方 ID。
     * @param {object} messageObject - 解析后的JSON消息对象。
     */
    _handleJsonMessage: function(peerId, messageObject) {
        messageObject.sender = messageObject.sender || peerId;
        if (!messageObject.id) messageObject.id = `msg_${Date.now()}_${Utils.generateId(4)}`;

        if (messageObject.type?.startsWith('video-call-')) {
            VideoCallManager.handleMessage(messageObject, peerId);
        } else if (messageObject.groupId || messageObject.type?.startsWith('group-')) {
            GroupManager.handleGroupMessage(messageObject);
        } else if (messageObject.type === 'retract-message-request') {
            const senderName = messageObject.senderName || UserManager.contacts[messageObject.sender]?.name || `用户 ${String(messageObject.sender).substring(0, 4)}`;
            MessageManager._updateMessageToRetractedState(messageObject.originalMessageId, messageObject.sender, false, senderName);
        } else {
            ChatManager.addMessage(peerId, messageObject);
        }
    },

    /**
     * @description [REFACTORED] 异步发送文件，使用 simple-peer 实例。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} fileObject - 包含文件信息的对象 { blob, hash, name, type, size }。
     * @returns {Promise<boolean>} - 文件成功发送则 resolve(true)。
     */
    sendFile: async function(peerId, fileObject) {
        const peer = WebRTCManager.getPeer(peerId);
        if (!peer || !peer.connected) {
            Utils.log(`DataChannelHandler.sendFile: 无法发送到 ${peerId}，连接不存在或未就绪。`, Utils.logLevels.ERROR);
            return false;
        }

        const fileBlob = fileObject.blob;
        const CHUNK_SIZE = AppSettings.media.chunkSize;
        const totalChunks = Math.ceil(fileBlob.size / CHUNK_SIZE);

        Utils.log(`准备发送文件 "${fileObject.name}" 到 ${peerId}，共 ${totalChunks} 个分片。`, Utils.logLevels.INFO);

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
        try {
            peer.send(JSON.stringify(metadata));
        } catch (error) {
            Utils.log(`DataChannelHandler.sendFile: 发送元数据到 ${peerId} 失败: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }

        // 步骤 2: 分片并发送文件数据
        let offset = 0;
        let chunkIndex = 0;

        try {
            while (offset < fileBlob.size) {
                // simple-peer 内部处理背压，我们不需要手动等待
                const chunk = fileBlob.slice(offset, offset + CHUNK_SIZE);
                // simple-peer可以直接发送Blob或ArrayBuffer
                peer.send(chunk);
                offset += chunk.size;
                chunkIndex++;
            }
            Utils.log(`文件 "${fileObject.name}" 已成功提交到 ${peerId} 的发送队列。`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`DataChannelHandler.sendFile: 在发送文件块 #${chunkIndex} 到 ${peerId} 时出错: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    },

    /**
     * @deprecated sendData 已被 ConnectionManager.sendTo 替代。
     *             此方法保留是为了向后兼容，但应逐步淘汰。
     */
    sendData: function (peerId, messageObject) {
        Utils.log("DataChannelHandler.sendData is deprecated. Use ConnectionManager.sendTo instead.", Utils.logLevels.WARN);
        return ConnectionManager.sendTo(peerId, messageObject);
    }
};