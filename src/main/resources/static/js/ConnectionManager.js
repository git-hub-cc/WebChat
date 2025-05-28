const ConnectionManager = {
    connections: {},  // 存储多个连接
    iceCandidates: {},
    connectionTimeouts: {},
    reconnectAttempts: {},
    iceTimers: {},
    iceGatheringStartTimes: {},
    connectionStrengths: {},
    pendingChunks: {},
    websocket: null,
    isWebSocketConnected: false,

    // WebSocket连接管理
    connectWebSocket: function() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            try {
                // todo 这里可能需要修改
                this.websocket = new WebSocket('ws://localhost:8080/signaling');

                this.websocket.onopen = () => {
                    this.isWebSocketConnected = true;
                    UIManager.updateStatus('信令服务器连接成功');
                    Utils.log('WebSocket连接已建立', Utils.logLevels.INFO);

                    // 注册用户
                    this.registerUser();
                    resolve();
                };

                this.websocket.onmessage = (event) => {
                    this.handleSignalingMessage(JSON.parse(event.data));
                };

                this.websocket.onclose = () => {
                    this.isWebSocketConnected = false;
                    UIManager.updateStatus('信令服务器连接断开');
                    Utils.log('WebSocket连接已关闭', Utils.logLevels.WARN);

                    // 尝试重连
                    setTimeout(() => {
                        if (!this.isWebSocketConnected) {
                            this.connectWebSocket();
                        }
                    }, 3000);
                };

                this.websocket.onerror = (error) => {
                    Utils.log('WebSocket连接错误: ' + error, Utils.logLevels.ERROR);
                    reject(error);
                };

            } catch (error) {
                Utils.log('创建WebSocket连接失败: ' + error.message, Utils.logLevels.ERROR);
                reject(error);
            }
        });
    },

    // 注册用户到信令服务器
    registerUser: function() {
        if (!UserManager.userId) {
            Utils.log('用户ID未设置，无法注册', Utils.logLevels.ERROR);
            return;
        }

        const message = {
            type: 'REGISTER',
            userId: UserManager.userId
        };

        this.sendSignalingMessage(message);
    },

    // 发送信令消息
    sendSignalingMessage: function(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
            Utils.log('发送信令消息: ' + message.type, Utils.logLevels.DEBUG);
        } else {
            Utils.log('WebSocket未连接，无法发送信令消息', Utils.logLevels.ERROR);
        }
    },

    // 处理信令消息
    handleSignalingMessage: function(message) {
        Utils.log('收到信令消息: ' + message.type, Utils.logLevels.DEBUG);

        switch (message.type) {
            case 'SUCCESS':
                UIManager.updateStatus('用户注册成功: ' + (message.userId || UserManager.userId));
                break;

            case 'ERROR':
                UIManager.updateStatus('信令错误: ' + message.message);
                UIManager.showNotification('信令错误: ' + message.message, 'error');
                break;

            case 'OFFER':
                this.handleRemoteOffer(message);
                break;

            case 'ANSWER':
                this.handleRemoteAnswer(message);
                break;

            case 'ICE_CANDIDATE':
                this.handleRemoteIceCandidate(message);
                break;

            default:
                Utils.log('未知的信令消息类型: ' + message.type, Utils.logLevels.WARN);
        }
    },

    // 处理远程Offer
    handleRemoteOffer: async function(message) {
        const fromUserId = message.fromUserId;

        try {
            // 显示连接请求通知
            // const accept = confirm(`用户 ${fromUserId} 请求与您建立连接，是否接受？`);
            // if (!accept) {
            //     return;
            // }

            // 初始化连接
            if (!this.init(fromUserId)) {
                throw new Error('无法初始化WebRTC连接');
            }

            const conn = this.connections[fromUserId];

            // 设置远程描述
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));

            // 添加ICE候选者
            if (message.candidates && message.candidates.length > 0) {
                for (const candidate of message.candidates) {
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }

            // 创建应答
            const answer = await conn.peerConnection.createAnswer();
            await conn.peerConnection.setLocalDescription(answer);

            UIManager.updateStatus(`正在与${fromUserId}建立连接...`);

            // 等待ICE收集完成后发送answer
            this.waitForIceGatheringComplete(fromUserId, () => {
                const answerMessage = {
                    type: 'ANSWER',
                    userId: UserManager.userId,
                    targetUserId: fromUserId,
                    sdp: conn.peerConnection.localDescription,
                    candidates: this.iceCandidates[fromUserId] || []
                };

                this.sendSignalingMessage(answerMessage);
            });

            // 如果用户不在联系人列表中，添加
            if (!UserManager.contacts[fromUserId]) {
                UserManager.addContact(fromUserId);
            }

        } catch (error) {
            Utils.log(`处理远程Offer失败: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.updateStatus(`处理连接请求失败: ${error.message}`);
        }
    },

    // 处理远程Answer
    handleRemoteAnswer: async function(message) {
        const fromUserId = message.fromUserId;

        try {
            if (!this.connections[fromUserId]) {
                throw new Error('未找到与该用户的连接');
            }

            const conn = this.connections[fromUserId];

            // 设置远程描述
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));

            // 添加ICE候选者
            if (message.candidates && message.candidates.length > 0) {
                for (const candidate of message.candidates) {
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }

            UIManager.updateStatus(`正在与${fromUserId}完成连接...`);

        } catch (error) {
            Utils.log(`处理远程Answer失败: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.updateStatus(`处理连接响应失败: ${error.message}`);
        }
    },

    // 处理远程ICE候选者
    handleRemoteIceCandidate: async function(message) {
        const fromUserId = message.fromUserId;

        try {
            const conn = this.connections[fromUserId];
            if (conn && conn.peerConnection) {
                await conn.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                Utils.log('已添加远程ICE候选', Utils.logLevels.DEBUG);
            }
        } catch (error) {
            Utils.log(`添加远程ICE候选失败: ${error.message}`, Utils.logLevels.ERROR);
        }
    },

    // 等待ICE收集完成
    waitForIceGatheringComplete: function(peerId, callback) {
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return;

        if (conn.peerConnection.iceGatheringState === 'complete') {
            callback();
            return;
        }

        const checkInterval = setInterval(() => {
            if (conn.peerConnection.iceGatheringState === 'complete') {
                clearInterval(checkInterval);
                callback();
            }
        }, 100);

        // 超时处理
        setTimeout(() => {
            clearInterval(checkInterval);
            if (conn.peerConnection.iceGatheringState !== 'complete') {
                Utils.log('ICE收集超时，使用当前候选者', Utils.logLevels.WARN);
                callback();
            }
        }, Config.timeouts.iceGathering || 10000);
    },

    // 初始化连接
    init: function (peerId) {
        if (this.connections[peerId]) {
            this.close(peerId);
        }

        try {
            // 创建新的配置，基于当前网络状况
            let currentConfig = {...Config.peerConnectionConfig};
            currentConfig.iceServers = Config.iceServers;

            this.connections[peerId] = {
                peerConnection: new RTCPeerConnection(currentConfig),
                dataChannel: null
            };

            const pc = this.connections[peerId].peerConnection;

            pc.onicecandidate = (e) => this.handleIceCandidate(e, peerId);
            pc.onicegatheringstatechange = (e) => this.handleIceGatheringStateChange(e, peerId);
            pc.oniceconnectionstatechange = (e) => this.handleIceConnectionStateChange(e, peerId);
            pc.ondatachannel = (e) => this.handleDataChannel(e, peerId);

            this.iceCandidates[peerId] = [];
            this.reconnectAttempts[peerId] = 0;

            Utils.log(`与${peerId}的WebRTC连接已初始化`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`初始化连接失败: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    },

    // 处理ICE候选者
    handleIceCandidate: function (event, peerId) {
        if (event.candidate) {
            if (!this.iceCandidates[peerId]) {
                this.iceCandidates[peerId] = [];
            }
            this.iceCandidates[peerId].push(event.candidate);
            Utils.log(`收集到ICE候选: ${event.candidate.type} ${event.candidate.protocol}`, Utils.logLevels.DEBUG);

            // 如果连接已建立，通过信令服务器发送候选者（启用Trickle ICE）
            const conn = this.connections[peerId];
            if (conn && conn.dataChannel && conn.dataChannel.readyState === 'open') {
                this.sendIceCandidateViaSignaling(event.candidate, peerId);
            }
        }
    },

    // 通过信令服务器发送ICE候选者
    sendIceCandidateViaSignaling: function(candidate, peerId) {
        const message = {
            type: 'ICE_CANDIDATE',
            userId: UserManager.userId,
            targetUserId: peerId,
            candidate: candidate
        };

        this.sendSignalingMessage(message);
    },

    // 处理ICE收集状态变化
    handleIceGatheringStateChange: function (event, peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;

        const state = pc.iceGatheringState;

        switch (state) {
            case 'gathering':
                UIManager.updateStatus('正在收集网络信息...');
                this.startIceTimer(peerId);
                this.iceGatheringStartTimes[peerId] = Date.now();
                break;

            case 'complete':
                this.stopIceTimer(peerId);
                const duration = (Date.now() - this.iceGatheringStartTimes[peerId]) / 1000;
                UIManager.updateStatus(`网络信息收集完成 (${duration.toFixed(1)}秒)`);
                break;
        }
    },

    // 处理ICE连接状态变化
    handleIceConnectionStateChange: function (event, peerId) {
        const pc = this.connections[peerId]?.peerConnection;
        if (!pc) return;

        const state = pc.iceConnectionState;
        UIManager.updateStatus(`ICE状态: ${state}`);

        switch (state) {
            case 'checking':
                this.startConnectionTimeout(peerId);
                EventEmitter.emit('connectionChecking', peerId);
                break;

            case 'connected':
                this.clearConnectionTimeout(peerId);
                this.connectionStrengths[peerId] = this.calculateConnectionStrength(peerId);
                UIManager.updateConnectionState(true);
                EventEmitter.emit('connectionEstablished', peerId);

                // 更新视频通话按钮状态
                if (ChatManager.currentChatId === peerId) {
                    const videoCallButton = document.getElementById('videoCallButton');
                    if (videoCallButton) {
                        videoCallButton.disabled = false;
                        videoCallButton.onclick = () => VideoCallManager.initiateCall(peerId);
                    }
                }
                break;

            case 'disconnected':
                this.handleDisconnection(peerId);
                EventEmitter.emit('connectionDisconnected', peerId);
                break;

            case 'failed':
                this.handleConnectionFailure(peerId);
                EventEmitter.emit('connectionFailed', peerId);
                break;

            case 'closed':
                UIManager.updateConnectionState(false);
                EventEmitter.emit('connectionClosed', peerId);
                break;
        }
    },

    // 启动ICE收集计时器
    startIceTimer: function (peerId) {
        this.stopIceTimer(peerId);
        this.iceTimers[peerId] = setTimeout(() => {
            const pc = this.connections[peerId]?.peerConnection;
            if (pc && pc.iceGatheringState !== 'complete') {
                Utils.log('ICE收集超时，使用当前可用连接', Utils.logLevels.WARN);
                UIManager.updateStatus('网络信息收集超时，使用当前可用连接');
            }
        }, Config.timeouts.iceGathering);
    },

    // 停止ICE收集计时器
    stopIceTimer: function (peerId) {
        if (this.iceTimers[peerId]) {
            clearTimeout(this.iceTimers[peerId]);
            this.iceTimers[peerId] = null;
        }
    },

    // 处理接收到的ICE候选者
    handleIncomingIceCandidate: async function (candidate, peerId) {
        try {
            const conn = this.connections[peerId];
            if (conn && conn.peerConnection) {
                await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                Utils.log('已添加远程ICE候选', Utils.logLevels.DEBUG);
            }
        } catch (error) {
            Utils.log(`添加远程ICE候选失败: ${error.message}`, Utils.logLevels.ERROR);
        }
    },

    // 启用Trickle ICE（实时发送ICE候选者）
    enableTrickleIce: function (peerId) {
        Utils.log('启用Trickle ICE', Utils.logLevels.DEBUG);
        // 已在handleIceCandidate处理
    },

    // 标准ICE重启
    restartIce: async function (peerId) {
        try {
            const conn = this.connections[peerId];
            if (!conn || !conn.peerConnection || conn.peerConnection.signalingState !== 'stable') {
                return;
            }

            Utils.log('正在尝试ICE重启', Utils.logLevels.INFO);

            const offer = await conn.peerConnection.createOffer({iceRestart: true});
            await conn.peerConnection.setLocalDescription(offer);

            // 通过信令服务器发送重启offer
            this.waitForIceGatheringComplete(peerId, () => {
                const offerMessage = {
                    type: 'OFFER',
                    userId: UserManager.userId,
                    targetUserId: peerId,
                    sdp: conn.peerConnection.localDescription,
                    candidates: this.iceCandidates[peerId] || []
                };

                this.sendSignalingMessage(offerMessage);
            });

            UIManager.updateStatus('正在协商重新连接...');
        } catch (error) {
            Utils.log(`ICE重启失败: ${error.message}`, Utils.logLevels.ERROR);
        }
    },

    // 使用中继服务器重启ICE
    restartIceWithRelay: async function (peerId) {
        try {
            const conn = this.connections[peerId];
            if (!conn || !conn.peerConnection) {
                throw new Error('没有活动的连接');
            }

            // 调整配置，强制使用中继
            const relayConfig = {
                ...Config.peerConnectionConfig,
                iceTransportPolicy: 'relay'
            };
            relayConfig.iceServers = Config.iceServers;

            conn.peerConnection.setConfiguration(relayConfig);

            Utils.log('正在使用中继服务器重新协商连接', Utils.logLevels.INFO);

            if (conn.peerConnection.signalingState === 'stable') {
                const offer = await conn.peerConnection.createOffer({iceRestart: true});
                await conn.peerConnection.setLocalDescription(offer);
                UIManager.updateStatus('正在尝试使用中继服务器重连...');

                // 通过信令服务器发送重启offer
                this.waitForIceGatheringComplete(peerId, () => {
                    const offerMessage = {
                        type: 'OFFER',
                        userId: UserManager.userId,
                        targetUserId: peerId,
                        sdp: conn.peerConnection.localDescription,
                        candidates: this.iceCandidates[peerId] || []
                    };

                    this.sendSignalingMessage(offerMessage);
                });
            }
        } catch (error) {
            Utils.log(`重连尝试失败: ${error.message}`, Utils.logLevels.ERROR);
            // 继续尝试下一次重连或最终放弃
            this.handleConnectionFailure(peerId);
        }
    },

    // 启动连接超时
    startConnectionTimeout: function (peerId) {
        this.clearConnectionTimeout(peerId);
        this.connectionTimeouts[peerId] = setTimeout(() => {
            const pc = this.connections[peerId]?.peerConnection;
            if (pc && pc.iceConnectionState === 'checking') {
                Utils.log('连接建立超时', Utils.logLevels.WARN);
                this.handleConnectionFailure(peerId);
            }
        }, Config.timeouts.connection);
    },

    // 清除连接超时
    clearConnectionTimeout: function (peerId) {
        if (this.connectionTimeouts[peerId]) {
            clearTimeout(this.connectionTimeouts[peerId]);
            this.connectionTimeouts[peerId] = null;
        }
    },

    // 处理连接失败
    handleConnectionFailure: function (peerId) {
        UIManager.updateStatus('连接失败');
        UIManager.updateConnectionState(false);

        if (!this.reconnectAttempts[peerId]) {
            this.reconnectAttempts[peerId] = 0;
        }

        if (this.reconnectAttempts[peerId] < Config.reconnect.maxAttempts) {
            const delay = Config.reconnect.delay * Math.pow(Config.reconnect.backoffFactor, this.reconnectAttempts[peerId]);
            this.reconnectAttempts[peerId]++;

            UIManager.updateStatus(`正在尝试重新连接 (${this.reconnectAttempts[peerId]}/${Config.reconnect.maxAttempts})...`, delay);

            setTimeout(() => {
                this.restartIceWithRelay(peerId);
            }, delay);
        } else {
            UIManager.updateStatus('连接失败，请重新开始连接流程');
            this.resetConnection(peerId);
        }
    },

    // 处理连接断开
    handleDisconnection: function (peerId) {
        UIManager.updateStatus('连接断开，尝试重连...');
        UIManager.updateConnectionState(false, 'disconnected');

        // 使用指数退避重连
        const delay = 1000;
        setTimeout(() => {
            const pc = this.connections[peerId]?.peerConnection;
            if (pc && pc.iceConnectionState === 'disconnected') {
                this.restartIce(peerId);
            }
        }, delay);
    },

    // 处理数据通道
    handleDataChannel: function (event, peerId) {
        this.setupDataChannel(event.channel, peerId);
    },

    // 发送ICE候选者（通过数据通道）
    sendIceCandidate: function (candidate, peerId) {
        const conn = this.connections[peerId];
        if (conn && conn.dataChannel && conn.dataChannel.readyState === 'open') {
            try {
                const message = {
                    type: 'ice-candidate',
                    candidate: candidate,
                    sender: UserManager.userId
                };
                conn.dataChannel.send(JSON.stringify(message));
                Utils.log('已发送ICE候选', Utils.logLevels.DEBUG);
            } catch (error) {
                Utils.log(`发送ICE候选失败: ${error.message}`, Utils.logLevels.ERROR);
            }
        }
    },

    // 设置数据通道
    setupDataChannel: function (channel, peerId) {
        if (!this.connections[peerId]) {
            this.connections[peerId] = { peerConnection: null, dataChannel: null };
        }

        this.connections[peerId].dataChannel = channel;
        const conn = this.connections[peerId];

        conn.dataChannel.onopen = () => {
            Utils.log(`与${peerId}的数据通道已打开`, Utils.logLevels.INFO);
            UIManager.updateStatus("连接已建立，可以开始聊天");
            UIManager.enableChatInterface(true);
            EventEmitter.emit('dataChannelOpen', peerId);

            // 首次连接成功后自动交换更多ICE候选
            this.enableTrickleIce(peerId);

            // 开始连接质量监控
            this.startConnectionMonitoring(peerId);

            // 如果当前正在查看该联系人的聊天，启用视频通话按钮
            if (ChatManager.currentChatId === peerId) {
                const videoCallButton = document.getElementById('videoCallButton');
                if (videoCallButton) {
                    videoCallButton.disabled = false;
                    videoCallButton.onclick = () => VideoCallManager.initiateCall(peerId);
                }
            }
        };

        conn.dataChannel.onclose = () => {
            Utils.log(`与${peerId}的数据通道已关闭`, Utils.logLevels.INFO);
            UIManager.updateStatus("连接已关闭");

            // 如果当前正在查看该联系人的聊天，禁用视频通话按钮
            if (ChatManager.currentChatId === peerId) {
                const videoCallButton = document.getElementById('videoCallButton');
                if (videoCallButton) {
                    videoCallButton.disabled = true;
                }
            }

            EventEmitter.emit('dataChannelClosed', peerId);
        };

        conn.dataChannel.onmessage = (event) => {
            try {
                // 尝试解析JSON消息
                const message = JSON.parse(event.data);

                // 添加发送者信息
                if (!message.sender) {
                    message.sender = peerId;
                }

                // 添加时间戳
                if (!message.timestamp) {
                    message.timestamp = new Date().toISOString();
                }

                // 检查是否是群组相关消息
                if (message.groupId ||
                    message.type === 'group-invite' ||
                    message.type === 'group-removed' ||
                    message.type === 'group-member-added' ||
                    message.type === 'group-member-removed') {

                    // 交给群聊管理器处理
                    if (GroupManager && GroupManager.handleGroupMessage(message)) {
                        return; // 已处理群聊消息
                    }
                }

                // 检查是否是视频通话相关消息
                if (message.type && message.type.startsWith('video-call-')) {
                    if (VideoCallManager) {
                        VideoCallManager.handleMessage(message, peerId);
                    }
                    return;
                }

                switch (message.type) {
                    case 'ice-candidate':
                        this.handleIncomingIceCandidate(message.candidate, peerId);
                        break;

                    case 'file-meta':
                        // 初始化文件块收集
                        if (!this.pendingChunks[peerId]) {
                            this.pendingChunks[peerId] = {};
                        }
                        this.pendingChunks[peerId][message.id] = {
                            chunks: new Array(message.totalChunks),
                            received: 0,
                            total: message.totalChunks
                        };
                        break;

                    case 'file-chunk':
                        // 收集文件块
                        if (this.pendingChunks[peerId] && this.pendingChunks[peerId][message.id]) {
                            this.pendingChunks[peerId][message.id].chunks[message.index] = message.chunk;
                            this.pendingChunks[peerId][message.id].received++;

                            // 检查是否已收到所有块
                            if (this.pendingChunks[peerId][message.id].received === this.pendingChunks[peerId][message.id].total) {
                                const completeData = this.pendingChunks[peerId][message.id].chunks.join('');
                                delete this.pendingChunks[peerId][message.id];

                                // 解析并显示完整消息
                                const fullMessage = JSON.parse(completeData);
                                fullMessage.sender = peerId;

                                // 添加到聊天记录并显示
                                if (ChatManager) {
                                    ChatManager.addMessage(peerId, fullMessage);
                                }

                                // 更新联系人最后消息
                                let previewText = '[文件]';
                                if (fullMessage.type === 'file' || fullMessage.type === 'image') {
                                    if (fullMessage.fileType) {
                                        if (fullMessage.fileType.startsWith('image/')) previewText = '[图片]';
                                        else if (fullMessage.fileType.startsWith('video/')) previewText = '[视频]';
                                        else if (fullMessage.fileType.startsWith('audio/')) previewText = '[音频]';
                                    }
                                }
                                else if (fullMessage.type === 'audio') previewText = '[语音]';

                                if (UserManager) {
                                    UserManager.updateContactLastMessage(
                                        peerId,
                                        previewText,
                                        ChatManager.currentChatId !== peerId
                                    );
                                }
                            }
                        }
                        break;

                    default:
                        // 普通消息添加到聊天记录
                        if (ChatManager) {
                            ChatManager.addMessage(peerId, message);
                        }

                        // 更新联系人最后消息
                        let previewText = '';
                        if (message.type === 'text') {
                            previewText = message.content;
                        } else if (message.type === 'file' || message.type === 'image') {
                            if (message.fileType) {
                                if (message.fileType.startsWith('image/')) previewText = '[图片]';
                                else if (message.fileType.startsWith('video/')) previewText = '[视频]';
                                else if (message.fileType.startsWith('audio/')) previewText = '[音频]';
                                else previewText = '[文件]';
                            } else {
                                previewText = '[文件]';
                            }
                        } else if (message.type === 'audio') {
                            previewText = '[语音]';
                        } else {
                            previewText = '[消息]';
                        }

                        if (UserManager) {
                            UserManager.updateContactLastMessage(
                                peerId,
                                previewText,
                                ChatManager && ChatManager.currentChatId !== peerId
                            );
                        }
                }
            } catch (e) {
                // 如果不是JSON，作为普通文本显示
                const textMessage = {
                    type: 'text',
                    content: event.data,
                    sender: peerId,
                    timestamp: new Date().toISOString()
                };

                if (ChatManager) {
                    ChatManager.addMessage(peerId, textMessage);
                }

                if (UserManager) {
                    UserManager.updateContactLastMessage(
                        peerId,
                        event.data,
                        ChatManager && ChatManager.currentChatId !== peerId
                    );
                }
            }
        };

        conn.dataChannel.onerror = (error) => {
            Utils.log(`数据通道错误: ${error.message || '未知错误'}`, Utils.logLevels.ERROR);
            EventEmitter.emit('dataChannelError', error, peerId);
        };
    },

    // 开始连接质量监测
    startConnectionMonitoring: function (peerId) {
        const monitoringInterval = setInterval(async () => {
            const conn = this.connections[peerId];
            if (!conn || !conn.peerConnection || !conn.dataChannel || conn.dataChannel.readyState !== 'open') {
                clearInterval(monitoringInterval);
                return;
            }

            try {
                const stats = await conn.peerConnection.getStats();
                let currentRoundTripTime = null;
                let bytesReceived = 0;
                let bytesSent = 0;
                let localCandidateType = null;
                let remoteCandidateType = null;

                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        currentRoundTripTime = report.currentRoundTripTime;
                        // 保存UDP或TCP连接类型
                        if (report.localCandidateId && report.remoteCandidateId) {
                            stats.forEach(s => {
                                if (s.id === report.localCandidateId) {
                                    localCandidateType = `${s.candidateType}/${s.protocol}`;
                                }
                                if (s.id === report.remoteCandidateId) {
                                    remoteCandidateType = `${s.candidateType}/${s.protocol}`;
                                }
                            });
                        }
                    }

                    if (report.type === 'data-channel') {
                        bytesReceived += report.bytesReceived || 0;
                        bytesSent += report.bytesSent || 0;
                    }
                });

                // 只在有效RTT时更新连接质量
                if (currentRoundTripTime !== null) {
                    if (UIManager && UIManager.updateConnectionQuality) {
                        UIManager.updateConnectionQuality(currentRoundTripTime);
                    }
                    this.connectionStrengths[peerId] = this.calculateConnectionStrength(peerId, currentRoundTripTime);

                    Utils.log(`连接监测: RTT=${currentRoundTripTime.toFixed(3)}s, 本地=${localCandidateType}, 远程=${remoteCandidateType}, 传输=${bytesReceived + bytesSent}字节`,
                        Utils.logLevels.DEBUG);

                    // 如果连接质量很差，尝试重新协商
                    if (currentRoundTripTime > 1.5 && this.connectionStrengths[peerId] < 30) {
                        this.considerReconnection(peerId);
                    }
                }
            } catch (error) {
                Utils.log(`获取连接统计失败: ${error.message}`, Utils.logLevels.ERROR);
            }
        }, Config.timeouts.networkCheck || 5000);
    },

    // 计算连接强度 (0-100)
    calculateConnectionStrength: function (peerId, rtt = null) {
        const conn = this.connections[peerId];
        if (!conn || !conn.peerConnection) return 0;

        let strength = 0;

        // 基于ICE连接状态
        switch (conn.peerConnection.iceConnectionState) {
            case 'connected':
                strength += 60;
                break;
            case 'completed':
                strength += 70;
                break;
            case 'checking':
                strength += 30;
                break;
            case 'disconnected':
                strength += 10;
                break;
            default:
                strength += 0;
        }

        // 如果RTT可用，根据延迟调整
        if (rtt !== null) {
            if (rtt < 0.1) strength += 30;
            else if (rtt < 0.3) strength += 20;
            else if (rtt < 0.7) strength += 10;
            else if (rtt > 1.0) strength -= 20;
        }

        // 确保在0-100范围内
        return Math.max(0, Math.min(100, strength));
    },

    // 在连接质量差时考虑重连
    considerReconnection: function (peerId) {
        if (!this.reconnectAttempts[peerId]) {
            this.reconnectAttempts[peerId] = 0;
        }

        if (this.reconnectAttempts[peerId] < (Config.reconnect?.maxAttempts || 3)) {
            Utils.log('检测到连接质量差，尝试重新协商...', Utils.logLevels.WARN);
            this.restartIce(peerId);
        }
    },

    // 重置连接
    resetConnection: function (peerId) {
        if (this.connections[peerId]) {
            this.close(peerId);
        }

        this.connections[peerId] = null;
        this.iceCandidates[peerId] = [];
        this.reconnectAttempts[peerId] = 0;

        if (UIManager && UIManager.resetConnectionControls) {
            UIManager.resetConnectionControls();
        }
    },

    // 关闭连接
    close: function (peerId) {
        this.stopIceTimer(peerId);
        this.clearConnectionTimeout(peerId);

        const conn = this.connections[peerId];
        if (!conn) return;

        if (conn.dataChannel) {
            try {
                conn.dataChannel.close();
            } catch (e) {
                // 忽略关闭错误
            }
            conn.dataChannel = null;
        }

        if (conn.peerConnection) {
            try {
                conn.peerConnection.close();
            } catch (e) {
                // 忽略关闭错误
            }
            conn.peerConnection = null;
        }

        if (UIManager) {
            UIManager.updateStatus('连接已关闭');
            if (UIManager.enableChatInterface) {
                UIManager.enableChatInterface(false);
            }
        }
    },

    // 创建连接请求（通过信令服务器）
    createOffer: async function (targetPeerId) {
        if (!UIManager || !UIManager.checkWebRTCSupport()) return;

        // 确保WebSocket连接
        if (!this.isWebSocketConnected) {
            try {
                await this.connectWebSocket();
            } catch (error) {
                UIManager.updateStatus('无法连接到信令服务器');
                return;
            }
        }

        // 如果没有提供目标ID，尝试获取
        if (!targetPeerId) {
            if (ChatManager && ChatManager.currentChatId) {
                targetPeerId = ChatManager.currentChatId;
            } else {
                targetPeerId = prompt('请输入要连接的用户ID:');
                if (!targetPeerId) return;
            }
        }

        try {
            if (!this.init(targetPeerId)) {
                throw new Error('无法初始化WebRTC连接');
            }

            const conn = this.connections[targetPeerId];

            // 创建数据通道
            conn.dataChannel = conn.peerConnection.createDataChannel("messageChannel", {
                ordered: true,
                maxRetransmits: 30
            });

            this.setupDataChannel(conn.dataChannel, targetPeerId);

            // 创建offer
            const offer = await conn.peerConnection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });

            await conn.peerConnection.setLocalDescription(offer);
            UIManager.updateStatus("正在收集网络信息...");

            // 短暂延迟后更新SDP（让ICE收集开始）
            setTimeout(() => this.updateSdpText(targetPeerId), 1000);

            // 等待ICE收集完成后发送offer
            this.waitForIceGatheringComplete(targetPeerId, () => {
                const offerMessage = {
                    type: 'OFFER',
                    userId: UserManager.userId,
                    targetUserId: targetPeerId,
                    sdp: conn.peerConnection.localDescription,
                    candidates: this.iceCandidates[targetPeerId] || []
                };

                this.sendSignalingMessage(offerMessage);
                UIManager.updateStatus(`正在向${targetPeerId}发送连接请求...`);
            });

            // 只禁用当前操作的按钮，不影响其他连接
            // if (UIManager.disableConnectionButtons) {
            //     UIManager.disableConnectionButtons('offer');
            // }

            // 如果用户不在联系人列表中，添加
            if (UserManager && !UserManager.contacts[targetPeerId]) {
                await UserManager.addContact(targetPeerId);
            }
        } catch (error) {
            Utils.log(`创建连接请求失败: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.updateStatus('创建连接请求失败');
        }
    },

    // 更新SDP文本
    updateSdpText: function (peerId) {
        if (!peerId || !this.connections[peerId]) return;

        const conn = this.connections[peerId];
        if (!conn.peerConnection || !conn.peerConnection.localDescription) {
            return;
        }

        const connectionInfo = {
            sdp: conn.peerConnection.localDescription,
            candidates: this.iceCandidates[peerId] || [],
            userId: UserManager.userId
        };

        document.getElementById('sdpText').value = JSON.stringify(connectionInfo);
    },

    // 检查是否已连接到特定用户
    isConnectedTo: function(peerId) {
        const conn = this.connections[peerId];
        return conn &&
            conn.dataChannel &&
            conn.dataChannel.readyState === 'open' &&
            conn.peerConnection &&
            (conn.peerConnection.iceConnectionState === 'connected' ||
                conn.peerConnection.iceConnectionState === 'completed');
    },


    createAnswer: async function () {
        try {
            // 解析对方的SDP
            const sdpText = document.getElementById('sdpText').value.trim();
            document.getElementById('sdpText').value = '';
            if (!sdpText) {
                throw new Error('请先粘贴对方的连接信息');
            }

            const offerData = JSON.parse(sdpText);

            if (!offerData.sdp) {
                throw new Error('无效的连接信息格式');
            }

            // 获取对方ID
            const targetPeerId = offerData.userId || prompt('请输入对方的用户ID:');
            if (!targetPeerId) {
                throw new Error('需要对方ID才能建立连接');
            }

            if (!this.init(targetPeerId)) {
                throw new Error('无法初始化WebRTC连接');
            }

            const conn = this.connections[targetPeerId];

            // 设置远程描述
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(offerData.sdp));

            // 添加ICE候选者
            if (offerData.candidates && offerData.candidates.length > 0) {
                for (const candidate of offerData.candidates) {
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }

            // 创建应答
            const answer = await conn.peerConnection.createAnswer();
            await conn.peerConnection.setLocalDescription(answer);

            UIManager.updateStatus("正在收集网络信息...");

            // 短暂延迟后更新SDP
            setTimeout(() => this.updateSdpText(targetPeerId), 1000);

            UIManager.disableConnectionButtons('answer');

            // 如果用户不在联系人列表中，添加
            if (!UserManager.contacts[targetPeerId]) {
                UserManager.addContact(targetPeerId);
            }
        } catch (error) {
            Utils.log(`创建连接响应失败: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.updateStatus(`创建连接响应失败: ${error.message}`);
        }
    },

    // 处理连接响应
    handleAnswer: async function () {
        try {
            // 解析对方的SDP
            const sdpText = document.getElementById('sdpText').value.trim();
            if (!sdpText) {
                throw new Error('请先粘贴对方的连接信息');
            }

            const answerData = JSON.parse(sdpText);

            if (!answerData.sdp) {
                throw new Error('无效的连接信息格式');
            }

            // 获取对方ID
            const targetPeerId = answerData.userId;
            if (!targetPeerId) {
                throw new Error('连接信息中缺少用户ID');
            }

            if (!this.connections[targetPeerId]) {
                throw new Error('未找到与该用户的连接，请先创建连接请求');
            }

            const conn = this.connections[targetPeerId];

            // 设置远程描述
            await conn.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData.sdp));

            // 添加ICE候选者
            if (answerData.candidates && answerData.candidates.length > 0) {
                for (const candidate of answerData.candidates) {
                    await conn.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }

            UIManager.updateStatus("正在建立连接...");
            UIManager.disableConnectionButtons('complete');
            // 清空连接信息
            document.getElementById('sdpText').value = "";

            // 如果用户不在联系人列表中，添加
            if (!UserManager.contacts[targetPeerId]) {
                UserManager.addContact(targetPeerId);
            }
        } catch (error) {
            Utils.log(`处理连接响应失败: ${error.message}`, Utils.logLevels.ERROR);
            UIManager.updateStatus(`处理连接响应失败: ${error.message}`);
        }
    },

    // 向特定用户发送消息
    sendTo: function(peerId, message) {
        const conn = this.connections[peerId];
        if (!conn || !conn.dataChannel || conn.dataChannel.readyState !== 'open') {
            if (UIManager && UIManager.showNotification) {
                UIManager.showNotification(`无法发送消息，与${peerId}的连接未建立`, 'error');
            }
            return false;
        }

        try {
            // 确保消息是对象
            let msgToSend = message;
            if (typeof message !== 'object') {
                msgToSend = {
                    type: 'text',
                    content: message,
                    sender: UserManager.userId,
                    timestamp: new Date().toISOString()
                };
            } else {
                // 添加发送者ID
                msgToSend.sender = UserManager.userId;
                if (!msgToSend.timestamp) {
                    msgToSend.timestamp = new Date().toISOString();
                }
            }

            conn.dataChannel.send(JSON.stringify(msgToSend));
            return true;
        } catch (error) {
            Utils.log(`发送消息失败: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    },

    // 重置所有连接
    resetAllConnections: function() {
        // 确认对话框
        if (!confirm('确定要重置所有连接吗？这将断开所有现有连接。')) {
            return;
        }

        // 关闭所有连接
        for (const peerId in this.connections) {
            this.close(peerId);
        }

        // 关闭WebSocket连接
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
            this.isWebSocketConnected = false;
        }

        // 清空连接列表
        this.connections = {};
        this.iceCandidates = {};
        this.connectionTimeouts = {};
        this.reconnectAttempts = {};
        this.iceTimers = {};
        this.iceGatheringStartTimes = {};
        this.connectionStrengths = {};
        this.pendingChunks = {};

        // 重置UI
        if (UIManager) {
            if (UIManager.resetConnectionControls) {
                UIManager.resetConnectionControls();
            }
            UIManager.updateStatus('所有连接已重置');
            if (UIManager.enableChatInterface) {
                UIManager.enableChatInterface(false);
            }
            if (UIManager.showNotification) {
                UIManager.showNotification('所有连接已重置', 'info');
            }
        }

        Utils.log('所有连接已重置', Utils.logLevels.INFO);

        return true;
    },

    // 初始化连接管理器
    initialize: async function() {
        try {
            // 连接到信令服务器
            await this.connectWebSocket();
            Utils.log('ConnectionManager初始化完成', Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`ConnectionManager初始化失败: ${error.message}`, Utils.logLevels.ERROR);
            return false;
        }
    }
};