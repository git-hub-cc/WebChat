/**
 * @file Utils.js
 * @description 提供一系列通用工具函数，供整个应用程序使用。
 *              包括日志记录、HTML 转义、网络检查、数据分片处理、ID 生成和日期格式化等。
 *              sendInChunks 现在实现了基于 RTCDataChannel.bufferedAmount 的背压控制。
 *              新增: generateFileHash 用于计算文件Blob的SHA-256哈希。
 * @module Utils
 * @exports {object} Utils - 对外暴露的单例对象，包含所有工具函数。
 * @property {function} log - 根据设置的日志级别在控制台打印日志。
 * @property {function} escapeHtml - 转义 HTML 特殊字符以防止 XSS。
 * @property {function} checkNetworkType - 使用 WebRTC 检测网络能力（IPv4/IPv6, UDP/TCP）。
 * @property {function} sendInChunks - 将大数据字符串分片发送，并处理背压。
 * @property {function} reassembleChunk - 将接收到的数据分片重组为完整数据。
 * @property {function} generateId - 生成一个指定长度的随机 ID。
 * @property {function} formatDate - 将 Date 对象格式化为用户友好的字符串。
 * @property {function} truncateFileName - 如果文件名太长，则截断文件名并添加省略号。
 * @property {function} generateFileHash - 计算文件Blob的SHA-256哈希。
 * @dependencies Config, ConnectionManager (仅在 reassembleChunk 中间接引用)
 * @dependents 几乎所有其他模块。
 */
const _Utils_logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, ALL: 4 }; // 定义日志级别

const Utils = {
    logLevels: _Utils_logLevels, // 暴露日志级别常量
    currentLogLevel: _Utils_logLevels.DEBUG, // 默认日志级别

    // 定义用于 sendInChunks 的常量
    BUFFERED_AMOUNT_HIGH_THRESHOLD: 1 * 1024 * 1024, // 缓冲量高水位阈值 (1MB)
    BUFFER_CHECK_INTERVAL: 50, // 缓冲量检查间隔 (50ms)

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
        if (level >= this.currentLogLevel) { // 只打印高于或等于当前级别的日志
            const timestamp = new Date().toLocaleTimeString(); // 获取当前时间
            const prefixes = { 0: '[DBG]', 1: '[INF]', 2: '[WRN]', 3: '[ERR]' }; // 日志级别前缀
            const prefix = prefixes[level] || '[LOG]'; // 默认前缀
            const logMessage = `[${timestamp}] ${prefix} ${message}`; // 构建日志消息

            // 根据级别选择合适的 console 方法
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
        if (typeof str !== 'string') return ''; // 如果不是字符串，则返回空
        return str.replace(/[&<>"']/g, function (match) { // 替换特殊字符
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
            const pc = new RTCPeerConnection(); // 创建 PeerConnection
            const candidates = []; // 存储 ICE 候选者
            let candidateGatheringDone = false; // 标记收集是否完成

            pc.onicecandidate = (e) => { // ICE 候选者事件
                if (e.candidate) {
                    candidates.push(e.candidate); // 添加候选者
                } else { // e.candidate 为 null 表示收集完成
                    candidateGatheringDone = true;
                }
            };

            pc.createDataChannel("check"); // 创建数据通道以触发 ICE 收集
            const offer = await pc.createOffer(); // 创建提议
            await pc.setLocalDescription(offer); // 设置本地描述

            // 等待 ICE 候选者收集完成或超时
            await new Promise(resolve => {
                const startTime = Date.now();
                const checkInterval = setInterval(() => {
                    if (candidateGatheringDone || (Date.now() - startTime > 1500)) { // 超时1.5秒
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100); // 每100ms检查一次
            });

            pc.close(); // 关闭 PeerConnection

            // 分析候选者信息
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
     * 将大数据字符串分片发送，并实现了基于 RTCDataChannel.bufferedAmount 的背压控制。
     * @param {string} dataString - 要发送的完整数据字符串。
     * @param {RTCDataChannel} dataChannel - 用于发送数据的 RTCDataChannel 实例。
     * @param {string} peerId - 接收方的 ID。
     * @param {string|null} [fileId=null] - 文件的唯一 ID，用于标识分片所属。
     * @param {number} [chunkSize=Config.chunkSize] - 每个分片的大小。
     */
    sendInChunks: async function (dataString, dataChannel, peerId, fileId = null, chunkSize = Config.chunkSize || 64 * 1024) {
        // 如果数据不大，直接发送
        if (dataString.length <= chunkSize) {
            try {
                dataChannel.send(dataString);
            } catch (e) {
                Utils.log(`Utils.sendInChunks: 直接发送小数据时出错 (to ${peerId}): ${e.message}`, Utils.logLevels.ERROR);
            }
            return;
        }

        const totalChunks = Math.ceil(dataString.length / chunkSize); // 计算总分片数
        const currentFileId = fileId || `${Date.now()}-${Utils.generateId(6)}`; // 生成文件ID

        Utils.log(`正在向 ${peerId} (ID: ${currentFileId}) 发送大数据，共 ${totalChunks} 个分片。缓冲阈值: ${this.BUFFERED_AMOUNT_HIGH_THRESHOLD} bytes.`, Utils.logLevels.INFO);

        try {
            // 首先发送元数据，包含总分片数和原始类型
            dataChannel.send(JSON.stringify({
                type: 'chunk-meta',
                chunkId: currentFileId,
                totalChunks: totalChunks,
                originalType: JSON.parse(dataString).type // 假设 dataString 是有效的JSON字符串
            }));

            // 记录待发送的分片信息 (在 ConnectionManager 中管理)
            if (!ConnectionManager.pendingSentChunks) ConnectionManager.pendingSentChunks = {};
            ConnectionManager.pendingSentChunks[currentFileId] = {
                total: totalChunks,
                sent: 0,
                dataLength: dataString.length
            };

            for (let i = 0; i < totalChunks; i++) {
                // 背压控制：如果缓冲量过高，则等待
                while (dataChannel.bufferedAmount > this.BUFFERED_AMOUNT_HIGH_THRESHOLD) {
                    Utils.log(`Utils.sendInChunks: 缓冲到 ${peerId} 已满 (${dataChannel.bufferedAmount} > ${this.BUFFERED_AMOUNT_HIGH_THRESHOLD}). Chunk ${i+1}/${totalChunks} (ID: ${currentFileId}). 等待 ${this.BUFFER_CHECK_INTERVAL}ms.`, Utils.logLevels.DEBUG);
                    await new Promise(resolve => setTimeout(resolve, this.BUFFER_CHECK_INTERVAL));
                    // 检查数据通道是否仍然可用
                    if (dataChannel.readyState !== 'open') {
                        Utils.log(`Utils.sendInChunks: DataChannel 到 ${peerId} 在发送分片 ${i+1} (ID: ${currentFileId}) 期间关闭。中止发送。`, Utils.logLevels.WARN);
                        if (ConnectionManager.pendingSentChunks[currentFileId]) {
                            delete ConnectionManager.pendingSentChunks[currentFileId]; // 清理待发送记录
                        }
                        return; // 中止发送
                    }
                }

                const start = i * chunkSize; // 分片起始位置
                const end = Math.min(dataString.length, start + chunkSize); // 分片结束位置
                const chunkData = dataString.substring(start, end); // 获取分片数据

                // 发送分片数据
                dataChannel.send(JSON.stringify({
                    type: 'chunk-data',
                    chunkId: currentFileId,
                    index: i, // 分片索引
                    payload: chunkData
                }));

                // 更新待发送记录
                const pending = ConnectionManager.pendingSentChunks[currentFileId];
                if (pending) {
                    pending.sent++;
                    if (pending.sent === pending.total) { // 如果所有分片已发送
                        delete ConnectionManager.pendingSentChunks[currentFileId];
                        Utils.log(`已向 ${peerId} 发送完 ${currentFileId} 的所有分片。`, Utils.logLevels.INFO);
                    }
                }
                // 每个分片发送后稍微yield，给事件循环处理其他任务的机会
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        } catch (error) {
            Utils.log(`Utils.sendInChunks: 发送分片到 ${peerId} (ID: ${currentFileId}) 时发生错误: ${error.message}`, Utils.logLevels.ERROR);
            if (ConnectionManager.pendingSentChunks && ConnectionManager.pendingSentChunks[currentFileId]) {
                delete ConnectionManager.pendingSentChunks[currentFileId]; // 清理
            }
        }
    },

    /**
     * 将接收到的数据分片重组为完整数据。
     * @param {object} message - 包含分片信息的消息对象。
     * @param {string} peerId - 发送方的 ID。
     * @returns {object|null} - 如果所有分片都已收到，则返回重组后的消息对象；否则返回 null。
     */
    reassembleChunk: function(message, peerId) {
        // 初始化接收分片存储 (在 ConnectionManager 中管理)
        if (!ConnectionManager.pendingReceivedChunks) ConnectionManager.pendingReceivedChunks = {};
        if (!ConnectionManager.pendingReceivedChunks[peerId]) ConnectionManager.pendingReceivedChunks[peerId] = {};

        const peerChunks = ConnectionManager.pendingReceivedChunks[peerId];

        if (message.type === 'chunk-meta') { // 如果是元数据消息
            // 存储元数据
            peerChunks[message.chunkId] = {
                id: message.chunkId,
                total: message.totalChunks,
                received: 0,
                chunks: new Array(message.totalChunks), // 初始化分片数组
                originalType: message.originalType
            };
            Utils.log(`正在从 ${peerId} 接收分片数据 ${message.chunkId}，总数: ${message.totalChunks}。原始类型: ${message.originalType}`, Utils.logLevels.DEBUG);
            return null; // 等待数据分片
        }

        if (message.type === 'chunk-data') { // 如果是数据分片消息
            const assembly = peerChunks[message.chunkId]; // 获取对应的组装信息
            if (assembly && assembly.chunks[message.index] === undefined) { // 如果存在且此分片未收到
                assembly.chunks[message.index] = message.payload; // 存储分片数据
                assembly.received++; // 更新已收到的分片数

                if (assembly.received === assembly.total) { // 如果所有分片都已收到
                    const fullDataString = assembly.chunks.join(''); // 合并分片
                    const assembledId = assembly.id;
                    const originalType = assembly.originalType;
                    delete peerChunks[message.chunkId]; // 清理组装信息
                    Utils.log(`已从 ${peerId} 接收完 ${assembledId} 的所有分片。已重组。原始类型为: ${originalType}。总长度: ${fullDataString.length}`, Utils.logLevels.INFO);
                    try {
                        const reassembledMessage = JSON.parse(fullDataString); // 解析重组后的JSON
                        // 校验类型
                        if (reassembledMessage.type !== originalType) {
                            Utils.log(`重组后的消息类型 (${reassembledMessage.type}) 与存储的原始类型 (${originalType}) (ID: ${assembledId}) 不同。将使用重组后的类型。`, Utils.logLevels.WARN);
                        }
                        return reassembledMessage; // 返回重组后的消息对象
                    } catch (e) {
                        Utils.log(`解析来自 ${peerId} 的重组消息时出错 (ID: ${assembledId}, 原始类型: ${originalType}): ${e.message}`, Utils.logLevels.ERROR);
                        return null;
                    }
                }
                return null; // 分片未收全，继续等待
            } else if (assembly && assembly.chunks[message.index] !== undefined) { // 如果是重复分片
                Utils.log(`收到来自 ${peerId} 的重复分片 ${message.index} (ID: ${message.chunkId}, 原始类型: ${assembly.originalType})。正在忽略。`, Utils.logLevels.WARN);
                return null;
            } else { // 未知或已完成的分片
                Utils.log(`收到来自 ${peerId} 的未知/已完成组合的分片数据 ${message.chunkId} (消息中类型: ${message.type})。正在忽略。`, Utils.logLevels.WARN);
                return null;
            }
        }
        // 非分片消息，直接返回null (理论上不应由reassembleChunk处理)
        Utils.log(`Utils.reassembleChunk 收到来自 ${peerId} 的非分片消息类型: ${message.type}。返回 null。`, Utils.logLevels.WARN);
        return null;
    },

    /**
     * 生成一个指定长度的随机字符串 ID。
     * @param {number} [length=8] - ID 的长度。
     * @returns {string} - 生成的随机 ID。
     */
    generateId: function(length = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // 排除易混淆字符
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
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0'); // 计算分钟
        const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0'); // 计算秒数
        return `${minutes}:${seconds}`;
    },

    /**
     * 将 Date 对象格式化为用户友好的、相对的日期时间字符串（如 "今天 14:30", "昨天 10:00"）。
     * @param {Date} dateObj - 要格式化的 Date 对象。
     * @param {boolean} [includeTime=true] - 是否在结果中包含时间。
     * @returns {string} - 格式化后的日期字符串。
     */
    formatDate: function(dateObj, includeTime = true) {
        if (!(dateObj instanceof Date) || isNaN(dateObj)) { // 检查日期对象是否有效
            return '无效日期';
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 今天零点
        const yesterday = new Date(today); // 昨天零点
        yesterday.setDate(today.getDate() - 1);

        let dateString;
        if (dateObj >= today) { // 如果是今天
            dateString = includeTime ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '今天';
        } else if (dateObj >= yesterday) { // 如果是昨天
            dateString = '昨天' + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        } else if (dateObj.getFullYear() === now.getFullYear()){ // 如果是今年内（非今天昨天）
            dateString = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        else { // 更早的日期
            dateString = dateObj.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
        }
        return dateString;
    },

    /**
     * 如果文件名太长，则截断文件名并添加省略号。
     * @param {string} filename - 原始文件名。
     * @param {number} maxLength - 显示的最大长度，超出则截断。
     * @returns {string} - 截断后的文件名（如果需要），否则为原始文件名。
     */
    truncateFileName: function(filename, maxLength) {
        if (typeof filename !== 'string') return ''; // 检查是否为字符串
        if (filename.length > maxLength) { // 如果长度超过最大值
            return filename.substring(0, maxLength) + "..."; // 截断并添加省略号
        }
        return filename; // 否则返回原始文件名
    },

    /**
     * 计算文件Blob的SHA-256哈希值。
     * @param {Blob} blob - 要计算哈希的文件Blob对象。
     * @returns {Promise<string>} - 文件的SHA-256哈希字符串。
     * @throws {Error} 如果输入不是Blob或哈希计算失败。
     */
    generateFileHash: async function(blob) {
        if (!(blob instanceof Blob)) {
            throw new Error("generateFileHash: 输入必须是一个Blob对象。");
        }
        try {
            const buffer = await blob.arrayBuffer(); // 将Blob转为ArrayBuffer
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer); // 计算哈希
            const hashArray = Array.from(new Uint8Array(hashBuffer)); // 转为字节数组
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // 转为16进制字符串
        } catch (error) {
            this.log(`generateFileHash: 计算哈希失败 - ${error.message}`, this.logLevels.ERROR);
            throw error; // 重新抛出错误，让调用者处理
        }
    }
};