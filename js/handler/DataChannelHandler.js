/**
 * @file 数据通道处理器
 * @description 处理 RTCDataChannel 的消息收发、分片和重组逻辑。
 *              原生支持二进制文件传输的分片和重组。
 *              修复了并发文件传输时，文件元数据被覆盖导致接收失败的严重bug。
 * @module DataChannelHandler
 * @exports {object} DataChannelHandler - 包含所有数据通道处理方法的单例对象。
 * @dependency Utils, AppSettings, UserManager, ChatManager, GroupManager, VideoCallManager, MessageManager, ConnectionManager, DBManager
 */
const DataChannelHandler = {
    // BUGFIX: _chunkMetaBuffer 现在为每个文件哈希 (chunkId) 存储元数据，以支持并发传输。
    // 结构: { peerId: { chunkId1: metadata1, chunkId2: metadata2 } }
    _chunkMetaBuffer: {},

    /**
     * 为给定的 RTCDataChannel 设置事件处理器。
     * @function setupChannel
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

        // 设置二进制类型为 'arraybuffer' 以实现高效的二进制传输
        channel.binaryType = 'arraybuffer';

        connectionEntry.dataChannel = channel;
        Object.defineProperty(channel, '_dchListenersAttached', { value: true, writable: true, configurable: true });
        Object.defineProperty(channel, '_dchHasOpened', { value: false, writable: true, configurable: true });

        Utils.log(`DataChannelHandler.setupChannel: 正在为通道 ${channel.label} (for ${currentContextPeerId}) 设置事件监听器。`, Utils.logLevels.DEBUG);

        // 数据通道打开事件
        channel.onopen = async () => {
            if (channel._dchHasOpened) {
                Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${currentContextPeerId}) onopen 已处理。忽略。`, Utils.logLevels.DEBUG);
                return;
            }
            channel._dchHasOpened = true;

            let finalPeerId = currentContextPeerId;
            const isPlaceholderOriginChan = !!channel._isManualPlaceholderOrigin;

            if (isPlaceholderOriginChan && currentContextPeerId === AppSettings.constants.manualPlaceholderPeerId) {
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

            if (isPlaceholderOriginChan && logPeerIdForOpen !== UserManager.userId && logPeerIdForOpen !== AppSettings.constants.manualPlaceholderPeerId &&
                (ChatManager.currentChatId === null || ChatManager.currentChatId === AppSettings.constants.manualPlaceholderPeerId )) {
                ChatManager.openChat(logPeerIdForOpen, 'contact');
            }
            EventEmitter.emit('connectionEstablished', logPeerIdForOpen);

            if (WebRTCManager.reconnectAttempts[logPeerIdForOpen] !== undefined) {
                WebRTCManager.reconnectAttempts[logPeerIdForOpen] = 0;
            }
        };

        // 数据通道关闭事件
        channel.onclose = () => {
            let finalPeerId = currentContextPeerId;
            const isPlaceholderOriginChan = !!channel._isManualPlaceholderOrigin;
            if (isPlaceholderOriginChan) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onclose 触发。`, Utils.logLevels.DEBUG);
            channel._dchHasOpened = false; channel._dchListenersAttached = false;

            // 在通道关闭时清理此对等方的元数据缓冲区
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

        // 数据通道错误事件
        channel.onerror = (errorEvent) => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onerror 触发。Error: ${JSON.stringify(errorEvent, Object.getOwnPropertyNames(errorEvent))}. State: ${channel.readyState}`, Utils.logLevels.ERROR);
        };

        // 数据通道消息事件
        channel.onmessage = async (event) => {
            // 消息处理流程如下:
            // 1. 解析对等方 ID (peerId)，处理手动连接的占位符情况。
            // 2. 检查通道状态，如果不是 'open' 则忽略消息。
            // 3. 判断消息类型：
            //    3a. 如果是 ArrayBuffer (二进制数据)，则将其视为文件分片。
            //        - 查找并使用对应的文件元数据。
            //        - 将分片存入重组缓冲区。
            //        - 如果文件所有分片已接收完毕：
            //          - 重组文件为 Blob。
            //          - 将文件 Blob 存入 IndexedDB 缓存 (fileCache)。
            //          - 清理元数据和重组缓冲区。
            //          - (关键修复) 此时才将文件/贴图消息添加到聊天 UI。
            //    3b. 如果是字符串 (JSON)，则解析为消息对象。
            //        - 如果是 'chunk-meta' (文件元数据)，则创建并存储重组缓冲区。
            //        - 如果是 'file' 或 'sticker' 消息，(关键修复) 忽略它，等待二进制数据完成。
            //        - 如果是其他类型 (text, audio, video-call-*, group-*, retract-message-*)，则路由到相应的管理器处理。
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

                // --- 处理二进制和字符串数据 ---
                if (rawData instanceof ArrayBuffer) {
                    // 这是文件的一个二进制分片
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

                    const chunkId = activeChunkIds[activeChunkIds.length - 1]; // 假设它是最新的一个
                    const meta = this._chunkMetaBuffer[finalPeerId]?.[chunkId];

                    if (!meta) {
                        Utils.log(`收到来自 ${finalPeerId} 的二进制块，但没有元数据 (chunkId: ${chunkId})。忽略。`, Utils.logLevels.WARN);
                        return;
                    }

                    const assembly = pendingChunksForPeer[chunkId];
                    if (assembly) {
                        assembly.chunks[assembly.received] = rawData;
                        assembly.received++;

                        // 检查重组是否完成
                        if (assembly.received === assembly.total) {
                            const fileBlob = new Blob(assembly.chunks, { type: meta.fileType });

                            // 清理元数据缓冲区
                            delete this._chunkMetaBuffer[finalPeerId][meta.chunkId];
                            if (Object.keys(this._chunkMetaBuffer[finalPeerId]).length === 0) {
                                delete this._chunkMetaBuffer[finalPeerId];
                            }
                            delete ConnectionManager.pendingReceivedChunks[finalPeerId][meta.chunkId];
                            Utils.log(`文件 "${meta.fileName}" (ID: ${meta.chunkId}) 从 ${finalPeerId} 接收完毕。`, Utils.logLevels.INFO);

                            // 存入IndexedDB缓存
                            await DBManager.setItem('fileCache', {
                                id: meta.chunkId,
                                fileBlob: fileBlob,
                                metadata: { name: meta.fileName, type: meta.fileType, size: meta.fileSize }
                            });

                            // 文件缓存后，将消息添加到聊天UI
                            const messageToDisplay = {
                                id: meta.originalMessageId || `msg_${Date.now()}_${Utils.generateId(4)}`,
                                type: (meta.fileType.startsWith('image/') && meta.fileName.startsWith('sticker_')) ? 'sticker' : 'file',
                                fileId: meta.chunkId,
                                fileName: meta.fileName,
                                fileType: meta.fileType,
                                size: meta.fileSize,
                                fileHash: meta.chunkId,
                                timestamp: meta.timestamp || new Date().toISOString(),
                                sender: finalPeerId
                            };
                            ChatManager.addMessage(finalPeerId, messageToDisplay);
                        }
                    }
                } else if (typeof rawData === 'string') {
                    // 这是 JSON 消息
                    const messageObject = JSON.parse(rawData);

                    if (messageObject.type === 'chunk-meta') {
                        // 这是传入文件的元数据，存储它
                        if (!this._chunkMetaBuffer[finalPeerId]) {
                            this._chunkMetaBuffer[finalPeerId] = {};
                        }
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
                        return; // 等待二进制分片
                    }

                    // BUGFIX: 不在此处将文件/贴图消息添加到聊天UI
                    // 这是为了防止在文件数据完全接收前就尝试渲染缩略图而导致的竞争条件。
                    // 我们现在忽略这些消息，让二进制分片完成逻辑来处理UI添加。
                    if (messageObject.type === 'file' || messageObject.type === 'sticker') {
                        Utils.log(`DataChannelHandler: 收到 ${messageObject.type} 类型消息 for ${messageObject.fileHash}。等待文件块完成。`, Utils.logLevels.DEBUG);
                        const meta = this._chunkMetaBuffer[finalPeerId]?.[messageObject.fileHash];
                        if (meta) {
                            meta.originalMessageId = messageObject.id;
                            meta.timestamp = messageObject.timestamp;
                        }
                        return; // 重要：在此停止处理
                    }

                    // 处理其他非分片的JSON消息
                    messageObject.sender = messageObject.sender || finalPeerId;
                    if (!messageObject.id) messageObject.id = `msg_${Date.now()}_${Utils.generateId(4)}`;

                    if (messageObject.type?.startsWith('video-call-')) VideoCallManager.handleMessage(messageObject, finalPeerId);
                    else if (messageObject.groupId || messageObject.type?.startsWith('group-')) GroupManager.handleGroupMessage(messageObject);
                    else if (messageObject.type === 'retract-message-request') {
                        const senderName = messageObject.senderName || UserManager.contacts[messageObject.sender]?.name || `用户 ${String(messageObject.sender).substring(0, 4)}`;
                        MessageManager._updateMessageToRetractedState(messageObject.originalMessageId, messageObject.sender, false, senderName);
                        ConnectionManager.sendTo(messageObject.sender, { type: 'retract-message-confirm', originalMessageId: messageObject.originalMessageId, sender: UserManager.userId });
                    } else if (messageObject.type === 'retract-message-confirm') {
                        // 如果需要，记录或处理确认
                    } else {
                        // 处理文本、音频等消息
                        ChatManager.addMessage(finalPeerId, messageObject);
                    }
                }
            } catch (e) {
                Utils.log(`DataChannelHandler: 来自 ${finalPeerId} 的 onmessage 严重错误: ${e.message}. 数据: ${String(event.data).substring(0, 100)} 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    /**
     * 通过数据通道向指定对等端发送消息（仅处理字符串化的JSON消息）。
     * @function sendData
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