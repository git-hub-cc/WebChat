/**
 * @file Utils.js
 * @description 提供一系列通用工具函数，供整个应用程序使用。
 *              包括日志记录、HTML 转义、网络检查、数据分片处理、ID 生成和日期格式化等。
 * @module Utils
 * @exports {object} Utils - 对外暴露的单例对象，包含所有工具函数。
 * @property {function} log - 根据设置的日志级别在控制台打印日志。
 * @property {function} escapeHtml - 转义 HTML 特殊字符以防止 XSS。
 * @property {function} checkNetworkType - 使用 WebRTC 检测网络能力（IPv4/IPv6, UDP/TCP）。
 * @property {function} sendInChunks - 将大数据字符串分片发送。
 * @property {function} reassembleChunk - 将接收到的数据分片重组为完整数据。
 * @property {function} generateId - 生成一个指定长度的随机 ID。
 * @property {function} formatDate - 将 Date 对象格式化为用户友好的字符串。
 * @dependencies Config, ConnectionManager
 * @dependents 几乎所有其他模块。
 */
const _Utils_logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, ALL: 4 };

const Utils = {
    logLevels: _Utils_logLevels,
    currentLogLevel: _Utils_logLevels.DEBUG,

    /**
     * 从全局配置 `Config.logLevel` 中设置当前的日志级别。
     */
    setLogLevelFromConfig: function() {
        if (typeof Config !== 'undefined' && Config.logLevel && typeof Config.logLevel === 'string') {
            this.currentLogLevel = this.logLevels[Config.logLevel.toUpperCase()] || this.logLevels.DEBUG;
        }
    },

    /**
     * 根据设置的日志级别在控制台打印日志。
     * @param {string} message - 要打印的日志消息。
     * @param {number} [level=this.logLevels.DEBUG] - 日志级别 (DEBUG, INFO, WARN, ERROR)。
     */
    log: function (message, level = this.logLevels.DEBUG) {
        if (level >= this.currentLogLevel) {
            const timestamp = new Date().toLocaleTimeString();
            const prefixes = { 0: '[DBG]', 1: '[INF]', 2: '[WRN]', 3: '[ERR]' };
            const prefix = prefixes[level] || '[LOG]';
            const logMessage = `[${timestamp}] ${prefix} ${message}`;

            if (level === this.logLevels.ALL) console.log(logMessage);
            else if (level === this.logLevels.ERROR) console.error(logMessage);
            else if (level === this.logLevels.DEBUG) console.debug(logMessage);
            else if (level === this.logLevels.WARN) console.warn(logMessage);
            else if (level === this.logLevels.INFO) console.info(logMessage);
        }
    },

    /**
     * 转义 HTML 特殊字符以防止跨站脚本（XSS）攻击。
     * @param {string} str - 需要转义的原始字符串。
     * @returns {string} - 转义后的安全字符串。
     */
    escapeHtml: function(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
            }[match];
        });
    },

    /**
     * 使用 RTCPeerConnection 检查本地网络的连接能力（如 UDP/TCP 支持）。
     * @returns {Promise<object>} - 一个包含网络能力检测结果的对象。
     */
    checkNetworkType: async function () {
        try {
            const pc = new RTCPeerConnection();
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

            // 等待 ICE 候选者收集完成或超时
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

            return { ipv4: hasIPv4, ipv6: hasIPv6, relay: hasRelay, udp: hasUdp, tcp: hasTcp, count: candidates.length, error: null };
        } catch (error) {
            Utils.log(`网络类型检查失败: ${error.message}`, Utils.logLevels.ERROR);
            return { ipv4: false, ipv6: false, relay: false, udp: false, tcp: false, count: 0, error: error.message };
        }
    },

    /**
     * 将大数据字符串分片发送。
     * @param {string} dataString - 要发送的完整数据字符串。
     * @param {function} sendFunc - 用于发送单个分片的函数。
     * @param {string} peerId - 接收方的 ID。
     * @param {string|null} [fileId=null] - 文件的唯一 ID，用于标识分片所属。
     * @param {number} [chunkSize=Config.chunkSize] - 每个分片的大小。
     */
    sendInChunks: function (dataString, sendFunc, peerId, fileId = null, chunkSize = Config.chunkSize || 64 * 1024) {
        if (dataString.length <= chunkSize) {
            return sendFunc(dataString);
        }

        const totalChunks = Math.ceil(dataString.length / chunkSize);
        const currentFileId = fileId || `${Date.now()}-${Utils.generateId(6)}`;

        Utils.log(`正在向 ${peerId} (ID: ${currentFileId}) 发送大数据，共 ${totalChunks} 个分片。`, Utils.logLevels.INFO);

        // 首先发送元数据
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

        // 依次发送每个数据分片
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

    /**
     * 将接收到的数据分片重组为完整数据。
     * @param {object} message - 包含分片信息的消息对象。
     * @param {string} peerId - 发送方的 ID。
     * @returns {object|null} - 如果所有分片都已收到，则返回重组后的消息对象；否则返回 null。
     */
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

    /**
     * 生成一个指定长度的随机字符串 ID。
     * @param {number} [length=8] - ID 的长度。
     * @returns {string} - 生成的随机 ID。
     */
    generateId: function(length = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        return Array.from({ length }, () =>
            chars.charAt(Math.floor(Math.random() * chars.length))
        ).join('');
    },

    /**
     * 将总秒数格式化为 "mm:ss" 格式的字符串。
     * @param {number} totalSeconds - 总秒数。
     * @returns {string} - 格式化后的时间字符串。
     */
    formatTime: function(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    },

    /**
     * 将 Date 对象格式化为用户友好的、相对的日期时间字符串（如 "今天 14:30", "昨天 10:00"）。
     * @param {Date} dateObj - 要格式化的 Date 对象。
     * @param {boolean} [includeTime=true] - 是否在结果中包含时间。
     * @returns {string} - 格式化后的日期字符串。
     */
    formatDate: function(dateObj, includeTime = true) {
        if (!(dateObj instanceof Date) || isNaN(dateObj)) {
            return '无效日期';
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        let dateString;
        if (dateObj >= today) {
            dateString = includeTime ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '今天';
        } else if (dateObj >= yesterday) {
            dateString = '昨天' + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        } else if (dateObj.getFullYear() === now.getFullYear()){
            dateString = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        else {
            dateString = dateObj.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        return dateString;
    }
};