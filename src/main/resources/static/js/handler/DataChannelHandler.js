/**
 * @file DataChannelHandler.js
 * @description 处理 RTCDataChannel 的消息收发、分片和重组逻辑。
 * @module DataChannelHandler
 * @exports {object} DataChannelHandler
 * @dependencies Utils, AppSettings, UserManager, ChatManager, GroupManager, VideoCallManager, MessageManager, ConnectionManager (临时的，用于分片状态)
 */
const DataChannelHandler = {
    // 注意：pendingSentChunks 和 pendingReceivedChunks 状态理论上应属于此模块，
    // 但由于最小侵入原则和 Utils.sendInChunks/reassembleChunk 对 ConnectionManager 的依赖，
    // 暂时让 ConnectionManager 保持这些状态。理想情况下，这些状态和函数应完全内聚在此模块。
    // 为了简化当前步骤，我们假设这些状态仍由 ConnectionManager 间接管理或通过回调访问。

    /**
     * 为给定的 RTCDataChannel 设置事件处理器。
     * @param {RTCDataChannel} channel - 数据通道实例。
     * @param {string} peerId - 与此通道关联的对方 ID。
     * @param {boolean} isManualPlaceholderOrigin - 指示此通道是否源自手动连接的占位符。
     * @param {object} connectionEntry - WebRTCManager 中对应的连接条目，用于更新 dataChannel 状态。
     */
    setupChannel: function(channel, peerId, isManualPlaceholderOrigin, connectionEntry) {
        let currentContextPeerId = peerId; // 用于回调内部，避免闭包问题
        if (isManualPlaceholderOrigin) {
            Object.defineProperty(channel, '_isManualPlaceholderOrigin', { value: true, writable: false, configurable: true });
        }

        if (!connectionEntry) {
            Utils.log(`DataChannelHandler.setupChannel: 未找到 ${currentContextPeerId} 的连接条目。通道 ${channel.label} 设置中止。`, Utils.logLevels.WARN);
            try { channel.close(); } catch(e) {/*忽略*/}
            return;
        }

        if (channel._dchListenersAttached) { // _dchListenersAttached 防止重复绑定
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${currentContextPeerId}) 的监听器已设置。跳过。`, Utils.logLevels.DEBUG);
            return;
        }

        if (connectionEntry.dataChannel && connectionEntry.dataChannel !== channel && connectionEntry.dataChannel.readyState === 'open') {
            Utils.log(`DataChannelHandler.setupChannel: ${currentContextPeerId} 已存在活跃数据通道。关闭新通道 ${channel.label}。`, Utils.logLevels.WARN);
            try { channel.close(); } catch (e) { /*忽略*/ }
            return;
        }

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

        channel.onclose = () => {
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

        channel.onerror = (errorEvent) => {
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (resolvedId) finalPeerId = resolvedId;
            }
            Utils.log(`DataChannelHandler.setupChannel: 通道 ${channel.label} (for ${finalPeerId}) onerror 触发。Error: ${JSON.stringify(errorEvent, Object.getOwnPropertyNames(errorEvent))}. State: ${channel.readyState}`, Utils.logLevels.ERROR);
        };

        channel.onmessage = async (event) => { // Made async to handle await for blob conversion
            let finalPeerId = currentContextPeerId;
            if (channel._isManualPlaceholderOrigin) {
                const resolvedId = ConnectionManager.resolvePeerIdForChannel(channel);
                if (!resolvedId) { Utils.log(`DataChannelHandler.onmessage (通道源 ${currentContextPeerId}): 无法解析真实 peerId。忽略。`, Utils.logLevels.WARN); return; }
                finalPeerId = resolvedId;
            }
            if (channel.readyState !== 'open') { Utils.log(`DataChannelHandler.onmessage: 通道 ${channel.label} (for ${finalPeerId}) 收到消息，但状态为 ${channel.readyState}。忽略。`, Utils.logLevels.WARN); return; }

            try {
                const rawMessage = event.data;
                let messageObjectToProcess; let parsedJson;
                if (typeof rawMessage === 'string') {
                    try { parsedJson = JSON.parse(rawMessage); }
                    catch (e) {
                        // If not JSON, assume it's a simple text message (though this path should be rare with current design)
                        messageObjectToProcess = { type: 'text', content: rawMessage, sender: finalPeerId, timestamp: new Date().toISOString(), id: `text_${Date.now()}_${Utils.generateId(3)}`};
                    }
                } else {
                    Utils.log(`DataChannelHandler: 收到来自 ${finalPeerId} 的非字符串数据类型，当前不支持。`, Utils.logLevels.WARN);
                    return;
                }

                if (parsedJson) {
                    if (parsedJson.type === 'chunk-meta' || parsedJson.type === 'chunk-data') {
                        const reassembledData = Utils.reassembleChunk(parsedJson, finalPeerId);
                        if (reassembledData) { // If reassembly is complete
                            messageObjectToProcess = reassembledData; // This might be a 'file-transfer' or other type
                            // Now, check if the reassembled message is a file-transfer
                            if (messageObjectToProcess.type === 'file-transfer') {
                                Utils.log(`DataChannelHandler: (重组后) 收到来自 ${finalPeerId} 的文件传输: ${messageObjectToProcess.fileName}`, Utils.logLevels.INFO);
                                try {
                                    const base64ToBlob = async (base64, type = 'application/octet-stream') => {
                                        const res = await fetch(base64); // fetch can handle data URLs
                                        return await res.blob();
                                    };
                                    const receivedBlob = await base64ToBlob(messageObjectToProcess.fileData, messageObjectToProcess.fileType);
                                    await DBManager.setItem('fileCache', {
                                        id: messageObjectToProcess.fileHash,
                                        fileBlob: receivedBlob,
                                        metadata: { name: messageObjectToProcess.fileName, type: messageObjectToProcess.fileType, size: messageObjectToProcess.size }
                                    });
                                    Utils.log(`DataChannelHandler: (重组后) 文件 ${messageObjectToProcess.fileName} 已存入接收方的 fileCache。`, Utils.logLevels.INFO);
                                    // Transform to a 'file' message for ChatManager
                                    messageObjectToProcess = {
                                        id: messageObjectToProcess.id || `file_${Date.now()}_${Utils.generateId(3)}`,
                                        type: 'file',
                                        fileId: messageObjectToProcess.fileHash,
                                        fileName: messageObjectToProcess.fileName,
                                        fileType: messageObjectToProcess.fileType,
                                        size: messageObjectToProcess.size,
                                        fileHash: messageObjectToProcess.fileHash,
                                        timestamp: messageObjectToProcess.timestamp || new Date().toISOString(),
                                        sender: finalPeerId,
                                        originalSender: messageObjectToProcess.sender,
                                        originalSenderName: messageObjectToProcess.senderName || UserManager.contacts[messageObjectToProcess.sender]?.name || `用户 ${String(messageObjectToProcess.sender).substring(0,4)}`,
                                        groupId: messageObjectToProcess.groupId
                                    };
                                } catch (fileProcessingError) {
                                    Utils.log(`DataChannelHandler: (重组后) 处理接收到的文件 ${messageObjectToProcess.fileName} 时出错: ${fileProcessingError}`, Utils.logLevels.ERROR);
                                    NotificationUIManager.showNotification(`接收文件 ${messageObjectToProcess.fileName} 失败。`, 'error');
                                    return;
                                }
                            } else if (messageObjectToProcess.type === 'retract-message-request') {
                                Utils.log(`DataChannelHandler: (重组后) 收到来自 ${finalPeerId} 的消息撤回请求: ${JSON.stringify(messageObjectToProcess)}`, Utils.logLevels.INFO);
                                const senderName = messageObjectToProcess.senderName || UserManager.contacts[messageObjectToProcess.sender]?.name || `用户 ${String(messageObjectToProcess.sender).substring(0, 4)}`;
                                MessageManager._updateMessageToRetractedState(messageObjectToProcess.originalMessageId, messageObjectToProcess.sender, false, senderName);
                                ConnectionManager.sendTo(messageObjectToProcess.sender, { type: 'retract-message-confirm', originalMessageId: messageObjectToProcess.originalMessageId, sender: UserManager.userId });
                                return;
                            }
                            // Other reassembled types will be processed below
                        } else { return; } // Chunk not complete yet
                    } else if (parsedJson.type === 'file-transfer') { // Direct (non-chunked) file transfer
                        Utils.log(`DataChannelHandler: 收到来自 ${finalPeerId} 的直接文件传输: ${parsedJson.fileName}`, Utils.logLevels.INFO);
                        try {
                            const base64ToBlob = async (base64, type = 'application/octet-stream') => {
                                const res = await fetch(base64);
                                return await res.blob();
                            };
                            const receivedBlob = await base64ToBlob(parsedJson.fileData, parsedJson.fileType);
                            await DBManager.setItem('fileCache', {
                                id: parsedJson.fileHash,
                                fileBlob: receivedBlob,
                                metadata: { name: parsedJson.fileName, type: parsedJson.fileType, size: parsedJson.size }
                            });
                            Utils.log(`DataChannelHandler: 直接文件 ${parsedJson.fileName} 已存入接收方的 fileCache。`, Utils.logLevels.INFO);
                            messageObjectToProcess = {
                                id: parsedJson.id || `file_${Date.now()}_${Utils.generateId(3)}`,
                                type: 'file',
                                fileId: parsedJson.fileHash,
                                fileName: parsedJson.fileName,
                                fileType: parsedJson.fileType,
                                size: parsedJson.size,
                                fileHash: parsedJson.fileHash,
                                timestamp: parsedJson.timestamp || new Date().toISOString(),
                                sender: finalPeerId,
                                originalSender: parsedJson.sender,
                                originalSenderName: parsedJson.senderName || UserManager.contacts[parsedJson.sender]?.name || `用户 ${String(parsedJson.sender).substring(0,4)}`,
                                groupId: parsedJson.groupId
                            };
                        } catch (fileProcessingError) {
                            Utils.log(`DataChannelHandler: 处理直接接收的文件 ${parsedJson.fileName} 时出错: ${fileProcessingError}`, Utils.logLevels.ERROR);
                            NotificationUIManager.showNotification(`接收文件 ${parsedJson.fileName} 失败。`, 'error');
                            return;
                        }
                    } else if (parsedJson.type === 'retract-message-request') {
                        Utils.log(`DataChannelHandler: 收到来自 ${finalPeerId} 的消息撤回请求: ${JSON.stringify(parsedJson)}`, Utils.logLevels.INFO);
                        const senderName = parsedJson.senderName || UserManager.contacts[parsedJson.sender]?.name || `用户 ${String(parsedJson.sender).substring(0, 4)}`;
                        MessageManager._updateMessageToRetractedState(parsedJson.originalMessageId, parsedJson.sender, false, senderName); // Pass sender as chatId for direct messages
                        ConnectionManager.sendTo(parsedJson.sender, { type: 'retract-message-confirm', originalMessageId: parsedJson.originalMessageId, sender: UserManager.userId });
                        return;
                    } else if (parsedJson.type === 'retract-message-confirm') {
                        Utils.log(`DataChannelHandler: 收到来自 ${finalPeerId} 的消息撤回确认 (ID: ${parsedJson.originalMessageId})。`, Utils.logLevels.INFO);
                        return;
                    } else { messageObjectToProcess = parsedJson; }
                }

                if (!messageObjectToProcess) {
                    Utils.log(`DataChannelHandler: 来自 ${finalPeerId} 的 onmessage：无法确定消息对象。`, Utils.logLevels.DEBUG);
                    return;
                }

                messageObjectToProcess.sender = messageObjectToProcess.sender || finalPeerId;
                if (!messageObjectToProcess.id) messageObjectToProcess.id = `msg_${Date.now()}_${Utils.generateId(4)}`;

                if (messageObjectToProcess.type?.startsWith('video-call-')) VideoCallManager.handleMessage(messageObjectToProcess, finalPeerId);
                else if (messageObjectToProcess.groupId || messageObjectToProcess.type?.startsWith('group-')) GroupManager.handleGroupMessage(messageObjectToProcess);
                else ChatManager.addMessage(finalPeerId, messageObjectToProcess);
            } catch (e) {
                Utils.log(`DataChannelHandler: 来自 ${finalPeerId} 的 onmessage 严重错误: ${e.message}. 数据: ${String(event.data).substring(0, 100)} 堆栈: ${e.stack}`, Utils.logLevels.ERROR);
            }
        };
    },

    /**
     * 通过数据通道向指定对等端发送消息，处理分片。
     * @param {string} peerId - 接收方的 ID。
     * @param {object} messageObject - 要发送的消息对象。
     * @returns {boolean} - 消息是否成功（排入）发送。
     */
    sendData: function (peerId, messageObject) {
        const conn = WebRTCManager.connections[peerId];
        if (conn?.dataChannel?.readyState === 'open') {
            try {
                messageObject.sender = messageObject.sender || UserManager.userId;
                messageObject.timestamp = messageObject.timestamp || new Date().toISOString();
                const messageString = JSON.stringify(messageObject);

                if (messageString.length > AppSettings.media.chunkSize) {
                    Utils.sendInChunks(
                        messageString,
                        conn.dataChannel,
                        peerId,
                        // For file-transfer, the fileId could be its hash or a generated ID.
                        // If it's a large non-file message, a generic ID is fine.
                        (messageObject.type === 'file-transfer' ? messageObject.fileHash : null) || `msg-chunks-${Date.now()}`
                    );
                } else {
                    conn.dataChannel.send(messageString);
                }
                return true;
            } catch (error) {
                Utils.log(`DataChannelHandler: 通过数据通道向 ${peerId} 发送时出错: ${error.message}`, Utils.logLevels.ERROR);
                if (error.name === 'OperationError' && error.message.includes('send queue is full')) {
                    Utils.log(`DataChannelHandler: RTCDataChannel send queue is full for ${peerId}. Size: ${messageString.length}. Buffered: ${conn.dataChannel.bufferedAmount}`, Utils.logLevels.WARN);
                }
                return false;
            }
        } else {
            Utils.log(`DataChannelHandler: 无法发送到 ${peerId}: 数据通道未打开/不存在。DC: ${conn?.dataChannel?.readyState}, PC: ${conn?.peerConnection?.connectionState}`, Utils.logLevels.WARN);
            return false;
        }
    }
};