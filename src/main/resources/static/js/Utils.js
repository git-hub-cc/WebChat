const _Utils_logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, ALL: 4 }; // 类私有变量

const Utils = {
    logLevels: _Utils_logLevels,
    currentLogLevel: _Utils_logLevels.DEBUG, // 默认值，可由 setLogLevelFromConfig 覆盖

    setLogLevelFromConfig: function() {
        if (typeof Config !== 'undefined' && Config.logLevel && typeof Config.logLevel === 'string') {
            this.currentLogLevel = this.logLevels[Config.logLevel.toUpperCase()] || this.logLevels.DEBUG;
            // console.log(`Utils: 日志级别已设置为 ${Config.logLevel} (${this.currentLogLevel})`); // 用于初始化时的健全性检查
        }
    },

    log: function (message, level = this.logLevels.DEBUG) {
        if (level >= this.currentLogLevel) {
            const timestamp = new Date().toLocaleTimeString();
            const prefixes = { 0: '[DBG]', 1: '[INF]', 2: '[WRN]', 3: '[ERR]' };
            const prefix = prefixes[level] || '[LOG]';

            const logMessage = `[${timestamp}] ${prefix} ${message}`;

            // console 输出
            if (level === this.logLevels.ALL) console.log(logMessage);
            else if (level === this.logLevels.ERROR) console.error(logMessage);
            else if (level === this.logLevels.DEBUG) console.debug(logMessage);
            else if (level === this.logLevels.WARN) console.warn(logMessage);
            else if (level === this.logLevels.INFO) console.info(logMessage);
        }
    },

    escapeHtml: function(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
            }[match];
        });
    },

    checkNetworkType: async function () {
        try {
            const pc = new RTCPeerConnection(); // 使用默认配置进行基本的主机候选者收集
            const candidates = [];
            let candidateGatheringDone = false;

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    candidates.push(e.candidate);
                } else {
                    candidateGatheringDone = true;
                }
            };

            pc.createDataChannel("check");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            await new Promise(resolve => {
                const startTime = Date.now();
                const checkInterval = setInterval(() => {
                    if (candidateGatheringDone || (Date.now() - startTime > 1500)) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });

            pc.close();

            const hasIPv4 = candidates.some(c => c.address && c.address.includes('.'));
            const hasIPv6 = candidates.some(c => c.address && c.address.includes(':'));
            const hasRelay = candidates.some(c => c.type === 'relay');
            const hasUdp = candidates.some(c => c.protocol === 'udp');
            const hasTcp = candidates.some(c => c.protocol === 'tcp');

            return {
                ipv4: hasIPv4,
                ipv6: hasIPv6,
                relay: hasRelay,
                udp: hasUdp,
                tcp: hasTcp,
                count: candidates.length,
                error: null
            };
        } catch (error) {
            Utils.log(`网络类型检查失败: ${error.message}`, Utils.logLevels.ERROR);
            return { ipv4: false, ipv6: false, relay: false, udp: false, tcp: false, count: 0, error: error.message };
        }
    },

    sendInChunks: function (dataString, sendFunc, peerId, fileId = null, chunkSize = Config.chunkSize || 64 * 1024) {
        if (dataString.length <= chunkSize) {
            return sendFunc(dataString);
        }

        const totalChunks = Math.ceil(dataString.length / chunkSize);
        const currentFileId = fileId || `${Date.now()}-${Utils.generateId(6)}`;

        Utils.log(`正在向 ${peerId} (ID: ${currentFileId}) 发送大数据，共 ${totalChunks} 个分片。`, Utils.logLevels.INFO);

        sendFunc(JSON.stringify({
            type: 'chunk-meta',
            chunkId: currentFileId,
            totalChunks: totalChunks,
            originalType: JSON.parse(dataString).type
        }));

        if (!ConnectionManager.pendingSentChunks) ConnectionManager.pendingSentChunks = {};
        ConnectionManager.pendingSentChunks[currentFileId] = {
            total: totalChunks,
            sent: 0,
            data: dataString
        };

        for (let i = 0; i < totalChunks; i++) {
            ((currentIndex) => {
                setTimeout(() => {
                    const start = currentIndex * chunkSize;
                    const end = Math.min(dataString.length, start + chunkSize);
                    const chunkData = dataString.substring(start, end);

                    sendFunc(JSON.stringify({
                        type: 'chunk-data',
                        chunkId: currentFileId,
                        index: currentIndex,
                        payload: chunkData
                    }));

                    const pending = ConnectionManager.pendingSentChunks[currentFileId];
                    if (pending) {
                        pending.sent++;
                        if (pending.sent === pending.total) {
                            delete ConnectionManager.pendingSentChunks[currentFileId];
                            Utils.log(`已向 ${peerId} 发送完 ${currentFileId} 的所有分片。`, Utils.logLevels.INFO);
                        }
                    }
                }, currentIndex * 20);
            })(i);
        }
    },
    reassembleChunk: function(message, peerId) {
        if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
        if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};

        const peerChunks = ConnectionManager.pendingReceivedChunks[peerId];

        if (message.type === 'chunk-meta') {
            peerChunks[message.chunkId] = {
                id: message.chunkId,
                total: message.totalChunks,
                received: 0,
                chunks: new Array(message.totalChunks),
                originalType: message.originalType
            };
            Utils.log(`正在从 ${peerId} 接收分片数据 ${message.chunkId}，总数: ${message.totalChunks}。原始类型: ${message.originalType}`, Utils.logLevels.DEBUG);
            return null;
        }

        if (message.type === 'chunk-data') {
            const assembly = peerChunks[message.chunkId];
            if (assembly && assembly.chunks[message.index] === undefined) {
                assembly.chunks[message.index] = message.payload;
                assembly.received++;

                if (assembly.received === assembly.total) {
                    const fullDataString = assembly.chunks.join('');
                    const assembledId = assembly.id;
                    const originalType = assembly.originalType;
                    delete peerChunks[message.chunkId];

                    Utils.log(`已从 ${peerId} 接收完 ${assembledId} 的所有分片。已重组。原始类型为: ${originalType}。总长度: ${fullDataString.length}`, Utils.logLevels.INFO);
                    try {
                        const reassembledMessage = JSON.parse(fullDataString);
                        if (reassembledMessage.type !== originalType) {
                            Utils.log(`重组后的消息类型 (${reassembledMessage.type}) 与存储的原始类型 (${originalType}) (ID: ${assembledId}) 不同。将使用重组后的类型。`, Utils.logLevels.WARN);
                        }
                        return reassembledMessage;
                    } catch (e) {
                        Utils.log(`解析来自 ${peerId} 的重组消息时出错 (ID: ${assembledId}, 原始类型: ${originalType}): ${e.message}`, Utils.logLevels.ERROR);
                        return null;
                    }
                }
                return null;
            } else if (assembly && assembly.chunks[message.index] !== undefined) {
                Utils.log(`收到来自 ${peerId} 的重复分片 ${message.index} (ID: ${message.chunkId}, 原始类型: ${assembly.originalType})。正在忽略。`, Utils.logLevels.WARN);
                return null;
            } else {
                Utils.log(`收到来自 ${peerId} 的未知/已完成组合的分片数据 ${message.chunkId} (消息中类型: ${message.type})。正在忽略。`, Utils.logLevels.WARN);
                return null;
            }
        }
        Utils.log(`Utils.reassembleChunk 收到来自 ${peerId} 的非分片消息类型: ${message.type}。返回 null。`, Utils.logLevels.WARN);
        return null;
    },

    generateId: function(length = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

        return Array.from({ length }, () =>
            chars.charAt(Math.floor(Math.random() * chars.length))
        ).join('');
    },

    formatTime: function(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    },

    formatDate: function(dateObj, includeTime = true) {
        if (!(dateObj instanceof Date) || isNaN(dateObj)) {
            return '无效日期';
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        let dateString;
        if (dateObj >= today) { // 今天
            dateString = includeTime ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '今天';
        } else if (dateObj >= yesterday) { // 昨天
            dateString = '昨天' + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        } else if (dateObj.getFullYear() === now.getFullYear()){ // 今年，但比昨天更早
            dateString = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        else { // 比今年更早
            dateString = dateObj.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        return dateString;
    }
};