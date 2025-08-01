/**
 * @file DataChannelHandler.js
 * @description 处理 RTCDataChannel 的消息收发、分片和重组逻辑。
 *              现在原生支持二进制文件传输的分片和重组。
 *              FIXED: 当文件数据接收并缓存完毕后，触发 'fileDataReady' 事件，以便UI异步更新预览。
 *              MODIFIED: 新增 sendFile 方法，实现任意类型文件的分片发送功能。
 * @module DataChannelHandler
 * @exports {object} DataChannelHandler
 * @dependencies Utils, AppSettings, UserManager, ChatManager, GroupManager, VideoCallManager, MessageManager, ConnectionManager, EventEmitter, DBManager
 */
const DataChannelHandler = {
    _chunkMetaBuffer: {}, // { peerId: metadataObject }

    /**
     * 为给定的 RTCDataChannel 设置事件处理器。
     * @param {RTCDataChannel} channel - 数据通道实例。
     * @param {string} peerId - 与此通道关联的对方 ID。
     * @param {boolean} isManualPlaceholderOrigin - 指示此通道是否源自手动连接的占位符。
     * @param {object} connectionEntry - WebRTCManager 中对应的连接条目。
     */
    setupChannel: function(channel, peerId, isManualPlaceholderOrigin, connectionEntry) {
        let currentContextPeerId = peerId;
        if (isManualPlaceholderOrigin) Object.defineProperty(channel, '_isManualPlaceholderOrigin', { value: true, writable: false, configurable: true });

        if (!connectionEntry) {
            Utils.log(`DataChannelHandler.setupChannel: 未找到 ${currentContextPeerId} 的连接条目。通道 ${channel.label} 设置中止。`, Utils.logLevels.WARN);
            try { channel.close(); } catch(e) {/*忽略*/}
            return;
        }

        if (channel._dchListenersAttached) {
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${currentContextPeerId}) 的监听器已设置。跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        if (connectionEntry.dataChannel && connectionEntry.dataChannel !== channel && connectionEntry.dataChannel.readyState === 'open') {
            Utils.log(`DataChannelHandler.setupChannel: ${currentContextPeerId} 已存在活跃数据通道。关闭新通道 ${channel.label}。`, Utils.logLevels.WARN);
            try { channel.close(); } catch (e) { /*忽略*/ }
            return;
        }

        // NEW: Set binaryType to 'arraybuffer' for efficient binary transfer
        channel.binaryType = 'arraybuffer';

        connectionEntry.dataChannel = channel;
        Object.defineProperty(channel, '_dchListenersAttached', { value: true, writable: true, configurable: true });
        Object.defineProperty(channel, '_dchHasOpened', { value: false, writable: true, configurable: true });

        Utils.log(`DataChannelHandler.setupChannel: 正在为通道 ${channel.label} (for ${currentContextPeerId}) 设置事件监听器。`, Utils.logLevels.DEBUG);

        channel.onopen = async () => { /* ... onopen logic remains the same ... */
            if (channel._dchHasOpened) {
                Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${currentContextPeerId}) onopen 已处理。忽略。`, Utils.logLevels.DEBUG);
                return;
            }
            channel._dchHasOpened = true;

            let finalPeerId = currentContextPeerId;
            const isPlaceholderOriginChan = !!channel._isManualPlaceholderOrigin;

            if (isPlaceholderOriginChan && currentContextPeerId === WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID) {
                let resolved = false;
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) {
                    finalPeerId = resolvedId;
                    resolved = true;
                    Utils.log(`DataChannelHandler.setupChannel: onopen - 占位符通道成功解析为 ${finalPeerId}。`, Utils.logLevels.DEBUG);
                }
                if (!resolved) { Utils.log(`DataChannelHandler.setupChannel: onopen - 无法从占位符通道解析真实 peerId。`, Utils.logLevels.ERROR); return; }
            } else {
                finalPeerId = currentContextPeerId;
            }

            const logPeerIdForOpen = finalPeerId;
            const connFromWebRTC = WebRTCManager.connections[logPeerIdForOpen];
            Utils.log(`DataChannelHandler: 与 ${logPeerIdForOpen} 的数据通道 ("${channel.label}") 已打开。(静默: ${connFromWebRTC?.wasInitiatedSilently || false}, 占位符源: ${isPlaceholderOriginChan})`, Utils.logLevels.INFO);

            const contactName = UserManager.contacts[logPeerIdForOpen]?.name || logPeerIdForOpen.substring(0, 8) + '...';
            if (connFromWebRTC && (!connFromWebRTC.wasInitiatedSilently || ChatManager.currentChatId === logPeerIdForOpen) && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.updateChatHeaderStatus(`已连接到 ${contactName}`);
            }
            ConnectionManager._ensureContactExistsForPeer(finalPeerId, isPlaceholderOriginChan);


            if (isPlaceholderOriginChan && logPeerIdForOpen !== UserManager.userId && logPeerIdForOpen !== WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID &&
                (ChatManager.currentChatId === null || ChatManager.currentChatId === WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID )) {
                ChatManager.openChat(logPeerIdForOpen, 'contact');
            }
            EventEmitter.emit('connectionEstablished', logPeerIdForOpen);
            if (connFromWebRTC && ChatManager.currentChatId === logPeerIdForOpen && !connFromWebRTC.isVideoCall && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.setCallButtonsState(true, logPeerIdForOpen);
            }
            if (WebRTCManager.reconnectAttempts[logPeerIdForOpen] !== undefined) {
                WebRTCManager.reconnectAttempts[logPeerIdForOpen] = 0;
            }
        };

        channel.onclose = () => { /* ... onclose logic remains the same ... */
            let finalPeerId = currentContextPeerId;
            const isPlaceholderOriginChan = !!channel._isManualPlaceholderOrigin;
            if (isPlaceholderOriginChan) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onclose 触发。`, Utils.logLevels.DEBUG);
            channel._dchHasOpened = false; channel._dchListenersAttached = false;

            const connFromWebRTC = WebRTCManager.connections[finalPeerId];
            const pcState = connFromWebRTC?.peerConnection?.connectionState;
            if (pcState !== 'closed' && pcState !== 'failed') {
                EventEmitter.emit('connectionDisconnected', finalPeerId);
            }
            if (ChatManager.currentChatId === finalPeerId && typeof ChatAreaUIManager !== 'undefined') {
                ChatAreaUIManager.setCallButtonsState(false);
                if (connFromWebRTC && !connFromWebRTC.wasInitiatedSilently) {
                    ChatAreaUIManager.updateChatHeaderStatus(`已断开连接`);
                }
            }
            if (connFromWebRTC?.dataChannel === channel) {
                connFromWebRTC.dataChannel = null;
            }
        };

        channel.onerror = (errorEvent) => { /* ... onerror logic remains the same ... */
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onerror 触发。Error: ${JSON.stringify(errorEvent, Object.getOwnPropertyNames(errorEvent))}. State: ${channel.readyState}`, Utils.logLevels.ERROR);
        };

        channel.onmessage = async (event) => { // MODIFIED to be async
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) { /* ... placeholder resolution logic remains the same ... */
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (!resolvedId) { Utils.log(`DataChannelHandler.onmessage (通道源 ${currentContextPeerId}): 无法解析真实 peerId。忽略。`, Utils.logLevels.WARN); return; }
                finalPeerId = resolvedId;
            }
            if (channel.readyState !== 'open') { /* ... state check remains the same ... */
                Utils.log(`DataChannelHandler.onmessage: 通道 ${channel.label} (for ${finalPeerId}) 收到消息，但状态为 ${channel.readyState}。忽略。`, Utils.logLevels.WARN); return;
            }

            try {
                const rawData = event.data;

                // --- MODIFICATION START: Handle binary and string data separately ---
                if (rawData instanceof ArrayBuffer) {
                    // This is a binary chunk (part of a file)
                    const meta = this._chunkMetaBuffer[finalPeerId];
                    if (!meta) {
                        Utils.log(`收到来自 ${finalPeerId} 的二进制块，但没有元数据。忽略。`, Utils.logLevels.WARN);
                        return;
                    }
                    if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
                    if (!ConnectionManager.pendingReceivedChunks[finalPeerId]) ConnectionManager.pendingReceivedChunks[finalPeerId] = {};

                    const assembly = ConnectionManager.pendingReceivedChunks[finalPeerId][meta.chunkId];
                    if (assembly) {
                        // Store the received ArrayBuffer
                        assembly.chunks[assembly.received] = rawData;
                        assembly.received++;

                        // Check if reassembly is complete
                        if (assembly.received === assembly.total) {
                            const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });
                            delete ConnectionManager.pendingReceivedChunks[finalPeerId][meta.chunkId];
                            delete this._chunkMetaBuffer[finalPeerId];

                            Utils.log(`文件 "${meta.fileName}" (ID: ${meta.chunkId}) 从 ${finalPeerId} 接收完毕。`, Utils.logLevels.INFO);

                            // Reassembly is complete, now cache the file.
                            await DBManager.setItem('fileCache', {
                                id: meta.chunkId,
                                fileBlob: fileBlob,
                                metadata: { name: meta.fileName, type: meta.fileType, size: meta.fileSize }
                            });

                            // --- MODIFICATION START: Emit event on completion ---
                            // Notify the application that this file's data is now ready in the cache.
                            EventEmitter.emit('fileDataReady', {
                                fileHash: meta.chunkId,
                                fileType: meta.fileType,
                                fileName: meta.fileName
                            });
                            // --- MODIFICATION END ---
                        }
                    }
                } else if (typeof rawData === 'string') {
                    // This is a JSON message
                    const messageObject = JSON.parse(rawData);

                    if (messageObject.type === 'chunk-meta') {
                        // This is metadata for an incoming file. Store it.
                        this._chunkMetaBuffer[finalPeerId] = messageObject;
                        if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
                        if (!ConnectionManager.pendingReceivedChunks[finalPeerId]) ConnectionManager.pendingReceivedChunks[finalPeerId] = {};
                        ConnectionManager.pendingReceivedChunks[finalPeerId][messageObject.chunkId] = {
                            id: messageObject.chunkId,
                            total: messageObject.totalChunks,
                            received: 0,
                            chunks: new Array(messageObject.totalChunks)
                        };
                        Utils.log(`收到来自 ${finalPeerId} 的文件元数据: "${messageObject.fileName}" (ID: ${messageObject.chunkId})`, Utils.logLevels.INFO);
                        return; // Wait for binary chunks
                    }

                    // Handle other non-chunked JSON messages
                    messageObject.sender = messageObject.sender || finalPeerId;
                    if (!messageObject.id) messageObject.id = `msg_${Date.now()}_${Utils.generateId(4)}`;

                    if (messageObject.type?.startsWith('video-call-')) VideoCallManager.handleMessage(messageObject, finalPeerId);
                    else if (messageObject.groupId || messageObject.type?.startsWith('group-')) GroupManager.handleGroupMessage(messageObject);
                    else if (messageObject.type === 'retract-message-request') {
                        const senderName = messageObject.senderName || UserManager.contacts[messageObject.sender]?.name || `用户 ${String(messageObject.sender).substring(0, 4)}`;
                        MessageManager._updateMessageToRetractedState(messageObject.originalMessageId, messageObject.sender, false, senderName);
                        ConnectionManager.sendTo(messageObject.sender, { type: 'retract-message-confirm', originalMessageId: messageObject.originalMessageId, sender: UserManager.userId });
                    } else if (messageObject.type === 'retract-message-confirm') {
                        // Log or handle confirmation if needed
                    } else {
                        // This now handles text, audio, file, and the new sticker type
                        ChatManager.addMessage(finalPeerId, messageObject);
                    }
                }
                // --- MODIFICATION END ---
            } catch (e) {
                Utils.log(`DataChannelHandler: 来自 ${finalPeerId} 的 onmessage 严重错误: ${e.message}. 数据: ${String(event.data).substring(0, 100)} 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    // --- MODIFICATION START ---

    /**
     * @description (新增) 异步发送文件，支持任意类型。
     *              该函数将文件分片，先发送元数据，然后逐个发送文件块。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} fileObject - 包含文件信息的对象，至少需要 { blob, hash, name, type, size }。
     * @returns {Promise<boolean>} - 一个 Promise，文件成功发送则 resolve(true)，否则 reject 或 resolve(false)。
     */
    sendFile: async function(peerId, fileObject) {
        const conn = WebRTCManager.connections[peerId];
        const channel = conn?.dataChannel;

        if (!channel || channel.readyState !== 'open') {
            Utils.log(`DataChannelHandler.sendFile: 无法发送到 ${peerId}，数据通道未打开。状态: ${channel?.readyState}`, Utils.logLevels.ERROR);
            return false;
        }

        const fileBlob = fileObject.blob;
        // 使用 AppSettings 中的配置或一个合理的默认值
        const CHUNK_SIZE = AppSettings?.rtc?.chunkSize || 64 * 1024; // 64 KB
        const totalChunks = Math.ceil(fileBlob.size / CHUNK_SIZE);

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
        try {
            channel.send(JSON.stringify(metadata));
        } catch (error) {
            Utils.log(`DataChannelHandler.sendFile: 发送元数据到 ${peerId} 失败: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }

        // 步骤 2: 分片并发送文件数据
        let offset = 0;
        let chunkIndex = 0;

        try {
            while (offset < fileBlob.size) {
                // 处理背压：如果缓冲区已满，则等待
                while (channel.bufferedAmount > AppSettings.network.dataChannelHighThreshold) {
                    await new Promise(resolve => setTimeout(resolve, 50)); // 等待 50ms
                }

                const chunk = fileBlob.slice(offset, offset + CHUNK_SIZE);
                const arrayBuffer = await chunk.arrayBuffer();

                channel.send(arrayBuffer);

                offset += arrayBuffer.byteLength;
                chunkIndex++;

                // 可以在这里触发进度更新事件
                // EventEmitter.emit('fileSendProgress', { peerId, fileHash: fileObject.hash, progress: (chunkIndex / totalChunks) * 100 });
            }
            Utils.log(`文件 "${fileObject.name}" 已成功发送到 ${peerId} 的发送队列。`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`DataChannelHandler.sendFile: 在发送文件块 #${chunkIndex} 到 ${peerId} 时出错: ${error.message}`, Utils.logLevels.ERROR);
            // 可以在这里发送一个取消消息
            return false;
        }
    },

    // --- MODIFICATION END ---

    /**
     * 通过数据通道向指定对等端发送消息。现在只处理字符串消息。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} messageObject - 要发送的 JSON 消息对象。
     * @returns {boolean} - 消息是否成功（排入）发送。
     */
    sendData: function (peerId, messageObject) {
        const conn = WebRTCManager.connections[peerId];
        if (conn?.dataChannel?.readyState === 'open') {
            try {
                messageObject.sender = messageObject.sender || UserManager.userId;
                messageObject.timestamp = messageObject.timestamp || new Date().toISOString();
                const messageString = JSON.stringify(messageObject);
                conn.dataChannel.send(messageString);
                return true;
            } catch (error) {
                Utils.log(`DataChannelHandler: 通过数据通道向 ${peerId} 发送时出错: ${error.message}`, Utils.logLevels.ERROR);
                return false;
            }
        } else {
            Utils.log(`DataChannelHandler: 无法发送到 ${peerId}: 数据通道未打开/不存在。DC: ${conn?.dataChannel?.readyState}, PC: ${conn?.peerConnection?.connectionState}`, Utils.logLevels.WARN);
            return false;
        }
    }
};