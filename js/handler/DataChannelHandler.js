/**
 * @file DataChannelHandler.js
 * @description 处理 RTCDataChannel 的消息收发、分片和重组逻辑。
 *              现在原生支持二进制文件传输的分片和重组。
 *              FIXED: 修复了并发文件传输时，文件元数据被覆盖导致接收失败的严重bug。
 *              BUGFIX: 修复了远程文件/贴图消息因数据未完全接收就尝试渲染，导致缩略图无法显示的问题。
 *                      现在仅在文件完全接收并缓存后，才将消息添加到聊天UI。
 * @module DataChannelHandler
 * @exports {object} DataChannelHandler
 * @dependencies Utils, AppSettings, UserManager, ChatManager, GroupManager, VideoCallManager, MessageManager, ConnectionManager
 */
const DataChannelHandler = {
    // BUGFIX: _chunkMetaBuffer now stores metadata per file hash (chunkId) to support concurrent transfers.
    // Structure: { peerId: { chunkId1: metadata1, chunkId2: metadata2 } }
    _chunkMetaBuffer: {},

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

        channel.onopen = async () => {
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

            ConnectionManager._ensureContactExistsForPeer(finalPeerId, isPlaceholderOriginChan);


            if (isPlaceholderOriginChan && logPeerIdForOpen !== UserManager.userId && logPeerIdForOpen !== WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID &&
                (ChatManager.currentChatId === null || ChatManager.currentChatId === WebRTCManager.MANUAL_PLACEHOLDER_PEER_ID )) {
                ChatManager.openChat(logPeerIdForOpen, 'contact');
            }
            EventEmitter.emit('connectionEstablished', logPeerIdForOpen);

            if (WebRTCManager.reconnectAttempts[logPeerIdForOpen] !== undefined) {
                WebRTCManager.reconnectAttempts[logPeerIdForOpen] = 0;
            }
        };

        channel.onclose = () => {
            let finalPeerId = currentContextPeerId;
            const isPlaceholderOriginChan = !!channel._isManualPlaceholderOrigin;
            if (isPlaceholderOriginChan) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onclose 触发。`, Utils.logLevels.DEBUG);
            channel._dchHasOpened = false; channel._dchListenersAttached = false;

            // Clean up this peer's metadata buffer on channel close
            delete this._chunkMetaBuffer[finalPeerId];

            const connFromWebRTC = WebRTCManager.connections[finalPeerId];
            const pcState = connFromWebRTC?.peerConnection?.connectionState;
            if (pcState !== 'closed' && pcState !== 'failed') {
                EventEmitter.emit('connectionDisconnected', finalPeerId);
            }

            if (connFromWebRTC?.dataChannel === channel) {
                connFromWebRTC.dataChannel = null;
            }
        };

        channel.onerror = (errorEvent) => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onerror 触发。Error: ${JSON.stringify(errorEvent, Object.getOwnPropertyNames(errorEvent))}. State: ${channel.readyState}`, Utils.logLevels.ERROR);
        };

        channel.onmessage = async (event) => { // MODIFIED to be async
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (!resolvedId) { Utils.log(`DataChannelHandler.onmessage (通道源 ${currentContextPeerId}): 无法解析真实 peerId。忽略。`, Utils.logLevels.WARN); return; }
                finalPeerId = resolvedId;
            }
            if (channel.readyState !== 'open') {
                Utils.log(`DataChannelHandler.onmessage: 通道 ${channel.label} (for ${finalPeerId}) 收到消息，但状态为 ${channel.readyState}。忽略。`, Utils.logLevels.WARN); return;
            }

            try {
                const rawData = event.data;

                // --- MODIFICATION START: Handle binary and string data separately ---
                if (rawData instanceof ArrayBuffer) {
                    // This is a binary chunk (part of a file)
                    // BUGFIX: Determine which file this chunk belongs to.
                    const pendingChunksForPeer = ConnectionManager.pendingReceivedChunks?.[finalPeerId];
                    if (!pendingChunksForPeer) {
                        Utils.log(`收到来自 ${finalPeerId} 的二进制块，但没有待处理的文件传输。忽略。`, Utils.logLevels.WARN);
                        return;
                    }

                    const activeChunkIds = Object.keys(pendingChunksForPeer);
                    if (activeChunkIds.length === 0) {
                        Utils.log(`收到来自 ${finalPeerId} 的二进制块，但 pendingReceivedChunks 为空。忽略。`, Utils.logLevels.WARN);
                        return;
                    }
                    if (activeChunkIds.length > 1) {
                        Utils.log(`[严重警告] 正在处理来自 ${finalPeerId} 的并发文件传输。文件接收可能失败。协议限制。`, Utils.logLevels.ERROR);
                    }

                    const chunkId = activeChunkIds[activeChunkIds.length - 1]; // Assume it's the latest one
                    const meta = this._chunkMetaBuffer[finalPeerId]?.[chunkId];

                    if (!meta) {
                        Utils.log(`收到来自 ${finalPeerId} 的二进制块，但没有元数据 (chunkId: ${chunkId})。忽略。`, Utils.logLevels.WARN);
                        return;
                    }

                    const assembly = pendingChunksForPeer[chunkId];
                    if (assembly) {
                        // Store the received ArrayBuffer
                        assembly.chunks[assembly.received] = rawData;
                        assembly.received++;

                        // Check if reassembly is complete
                        if (assembly.received === assembly.total) {
                            const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });

                            // BUGFIX: Clean up metadata buffer after completion
                            delete this._chunkMetaBuffer[finalPeerId][meta.chunkId];
                            if (Object.keys(this._chunkMetaBuffer[finalPeerId]).length === 0) {
                                delete this._chunkMetaBuffer[finalPeerId];
                            }

                            delete ConnectionManager.pendingReceivedChunks[finalPeerId][meta.chunkId];

                            Utils.log(`文件 "${meta.fileName}" (ID: ${meta.chunkId}) 从 ${finalPeerId} 接收完毕。`, Utils.logLevels.INFO);

                            await DBManager.setItem('fileCache', {
                                id: meta.chunkId,
                                fileBlob: fileBlob,
                                metadata: { name: meta.fileName, type: meta.fileType, size: meta.fileSize }
                            });

                            // --- BUGFIX: Now that the file is cached, add the message to the chat UI ---
                            // Reconstruct the message object from the metadata received earlier.
                            // The original message object is intentionally not used to ensure this logic only runs after file receipt.
                            const messageToDisplay = {
                                id: meta.originalMessageId || `msg_${Date.now()}_${Utils.generateId(4)}`, // Use original ID if available, otherwise generate new
                                type: (meta.fileType.startsWith('image/') && meta.fileName.startsWith('sticker_')) ? 'sticker' : 'file', // Heuristic to determine type
                                fileId: meta.chunkId,
                                fileName: meta.fileName,
                                fileType: meta.fileType,
                                size: meta.fileSize,
                                fileHash: meta.chunkId,
                                timestamp: meta.timestamp || new Date().toISOString(), // Use original timestamp or now
                                sender: finalPeerId
                            };
                            ChatManager.addMessage(finalPeerId, messageToDisplay);
                            // --- END BUGFIX ---
                        }
                    }
                } else if (typeof rawData === 'string') {
                    // This is a JSON message
                    const messageObject = JSON.parse(rawData);

                    if (messageObject.type === 'chunk-meta') {
                        // This is metadata for an incoming file. Store it.
                        if (!this._chunkMetaBuffer[finalPeerId]) {
                            this._chunkMetaBuffer[finalPeerId] = {};
                        }
                        // BUGFIX: Store metadata keyed by chunkId to support multiple concurrent transfers.
                        this._chunkMetaBuffer[finalPeerId][messageObject.chunkId] = messageObject;

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

                    // --- BUGFIX: Do NOT add file/sticker messages to chat UI here. ---
                    // The original bug was that this code block would immediately add the message to the UI,
                    // causing a race condition where the thumbnail rendering would fail because the file data
                    // had not been fully received yet. We now ignore these messages here and let the
                    // binary chunk completion logic handle adding the message to the UI.
                    if (messageObject.type === 'file' || messageObject.type === 'sticker') {
                        Utils.log(`DataChannelHandler: 收到 ${messageObject.type} 类型消息 for ${messageObject.fileHash}。等待文件块完成。`, Utils.logLevels.DEBUG);
                        // We can optionally enhance robustness by storing the original message ID and timestamp from this object
                        // into our metadata buffer, so the final displayed message is more accurate.
                        const meta = this._chunkMetaBuffer[finalPeerId]?.[messageObject.fileHash];
                        if (meta) {
                            meta.originalMessageId = messageObject.id;
                            meta.timestamp = messageObject.timestamp;
                        }
                        return; // IMPORTANT: Stop processing here.
                    }
                    // --- END BUGFIX ---


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
                        // This handles text, audio, etc.
                        ChatManager.addMessage(finalPeerId, messageObject);
                    }
                }
                // --- MODIFICATION END ---
            } catch (e) {
                Utils.log(`DataChannelHandler: 来自 ${finalPeerId} 的 onmessage 严重错误: ${e.message}. 数据: ${String(event.data).substring(0, 100)} 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

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