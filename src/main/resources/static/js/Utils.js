/**
 * @file Utils.js
 * @description 提供一系列通用工具函数，供整个应用程序使用。
 *              包括日志记录、HTML 转义、网络检查、数据分片处理、ID 生成和日期格式化等。
 *              sendInChunks 现在实现了基于 RTCDataChannel.bufferedAmount 的背压控制。
 *              新增: generateFileHash 用于计算文件Blob的SHA-256哈希。
 *              新增: makeElementCollapsible, formatMessageText, clipRectToArea, isPointInRect, showFullImage, showFullVideo 等从其他模块迁移过来的通用工具函数。
 *              新增: fetchApiStream 用于封装流式API请求的通用逻辑。
 *              新增: checkWebRTCSupport 从 UIManager 迁移过来。
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
 * @property {function} makeElementCollapsible - 使指定的头部和内容元素可折叠。
 * @property {function} formatMessageText - 格式化消息文本，转换换行符、URL，并处理流式光标。
 * @property {function} clipRectToArea - 将一个矩形裁剪到指定的区域内。
 * @property {function} isPointInRect - 检查一个点是否位于一个矩形内部。
 * @property {function} showFullImage - 在一个模态框中显示全尺寸图片。
 * @property {function} showFullVideo - 在一个模态框中显示全屏视频。
 * @property {function} fetchApiStream - 发起一个流式 API 请求并处理响应。
 * @property {function} checkWebRTCSupport - 检查浏览器是否支持 WebRTC。
 * @dependencies Config, ConnectionManager (仅在 reassembleChunk 中间接引用), NotificationUIManager (用于 fetchApiStream 错误处理), LayoutUIManager (用于 checkWebRTCSupport)
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
    sendInChunks: async function (dataString, dataChannel, peerId, fileId = null, chunkSize = Config.media.chunkSize || 64 * 1024) {
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
    },

    /**
     * 使指定的头部和内容元素可折叠。
     * 会给头部添加一个展开/收起图标，并处理点击事件。
     * @param {HTMLElement|null} headerEl - 点击以触发展开/折叠的头部元素。
     * @param {HTMLElement|null} contentEl - 要展开/折叠的内容元素。
     */
    makeElementCollapsible: function(headerEl, contentEl) {
        if (headerEl && contentEl) {
            // 确保内容元素有 'collapsible-content' 类
            contentEl.classList.add('collapsible-content');
            // 确保头部元素有 'collapsible-header' 类
            headerEl.classList.add('collapsible-header');

            // 查找或创建折叠图标
            let icon = headerEl.querySelector('.collapse-icon');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'collapse-icon';
                // 尝试将图标插入到头部文本之后，如果找不到文本节点，则追加到末尾
                let textNodeFound = false;
                for (let i = 0; i < headerEl.childNodes.length; i++) {
                    if (headerEl.childNodes[i].nodeType === Node.TEXT_NODE && headerEl.childNodes[i].textContent.trim() !== '') {
                        if (headerEl.childNodes[i].nextSibling) {
                            headerEl.insertBefore(icon, headerEl.childNodes[i].nextSibling);
                        } else {
                            headerEl.appendChild(icon);
                        }
                        textNodeFound = true;
                        break;
                    }
                }
                if (!textNodeFound) { // 如果没有有效文本节点，则直接追加图标
                    headerEl.appendChild(icon);
                }
            }
            // 根据内容元素的初始显示状态设置图标和头部的 'active' 类
            if (contentEl.style.display === 'none' || getComputedStyle(contentEl).display === 'none') {
                icon.textContent = '▶'; // 折叠状态图标
                headerEl.classList.remove('active');
            } else {
                icon.textContent = '▼'; // 展开状态图标
                headerEl.classList.add('active');
            }

            // 移除可能存在的旧监听器，防止重复绑定
            const oldListener = headerEl._collapsibleListener; // 假设之前用此属性存储
            if (oldListener) {
                headerEl.removeEventListener('click', oldListener);
            }

            // 定义并绑定新的点击监听器
            const newListener = function() { // 使用 function 关键字以确保 this 指向 headerEl
                this.classList.toggle('active'); // 切换头部 'active' 类
                const currentIcon = this.querySelector('.collapse-icon');
                if (contentEl.style.display === "block" || contentEl.style.display === "") {
                    contentEl.style.display = "none"; // 折叠内容
                    if(currentIcon) currentIcon.textContent = '▶'; // 更新为折叠图标
                } else {
                    contentEl.style.display = "block"; // 展开内容
                    if(currentIcon) currentIcon.textContent = '▼'; // 更新为展开图标
                }
            };
            headerEl.addEventListener('click', newListener);
            headerEl._collapsibleListener = newListener; // 保存监听器引用，以便将来移除
        }
    },

    /**
     * 格式化消息文本，转换换行符为 <br>，将 URL 转换为可点击的链接，并处理流式光标。
     * @param {string} text - 要格式化的原始文本。
     * @returns {string} - 格式化后的 HTML 字符串。
     */
    formatMessageText: function (text) {
        if (typeof text !== 'string') return '';
        let escapedText = Utils.escapeHtml(text); // HTML转义
        escapedText = escapedText.replace(/ {2,}/g, ' '); // 替换多个空格为一个
        escapedText = escapedText.replace(/\n/g, '<br>'); // 换行符转<br>
        escapedText = escapedText.replace(/▍/g, '<span class="streaming-cursor">▍</span>'); // 流式光标
        // URL转链接
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return escapedText.replace(urlRegex, function (url) {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    },

    /**
     * 将一个矩形裁剪到指定的区域内。
     * 返回一个新的、位于全局坐标系下的裁剪后矩形 {x, y, w, h}，
     * 如果两个矩形没有重叠部分，则返回 null。
     * @param {object} rect - 需要被裁剪的矩形，格式为 {x, y, w, h}。
     * @param {object} clipArea - 用于裁剪的区域，格式为 {x, y, w, h}。
     * @returns {object|null} 裁剪后的矩形对象，或在无重叠时返回 null。
     */
    clipRectToArea: function(rect, clipArea) {
        if (!rect || !clipArea) return null; // 防御性检查

        // 计算重叠区域的左上角坐标
        const finalX = Math.max(rect.x, clipArea.x);
        const finalY = Math.max(rect.y, clipArea.y);

        // 计算重叠区域的右下角坐标
        const rectRight = rect.x + rect.w;
        const rectBottom = rect.y + rect.h;
        const clipAreaRight = clipArea.x + clipArea.w;
        const clipAreaBottom = clipArea.y + clipArea.h;
        const finalRight = Math.min(rectRight, clipAreaRight);
        const finalBottom = Math.min(rectBottom, clipAreaBottom);

        // 计算重叠区域的宽度和高度
        const finalW = finalRight - finalX;
        const finalH = finalBottom - finalY;

        if (finalW <= 0 || finalH <= 0) { // 如果没有重叠
            return null;
        }
        // 返回裁剪后的矩形
        return { x: finalX, y: finalY, w: finalW, h: finalH };
    },

    /**
     * 检查一个点是否位于一个矩形内部。
     * @param {number} px - 点的X坐标。
     * @param {number} py - 点的Y坐标。
     * @param {object} rect - 矩形对象 {x, y, w, h}。
     * @returns {boolean} 是否在内部。
     */
    isPointInRect: function(px, py, rect) {
        return rect && px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
    },

    /**
     * 在一个覆盖全屏的模态框中显示一张图片。
     * @param {string} src - 图片的源 URL。
     * @param {string} [altText="图片"] - 图片的替代文本。
     */
    showFullImage: function (src, altText = "图片") {
        const modal = document.createElement('div'); // 创建模态框容器
        modal.className = 'modal-like image-viewer'; // 应用样式
        // 设置模态框样式
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001'; // 确保在顶层

        const img = document.createElement('img'); // 创建图片元素
        img.src = src;
        img.alt = altText;
        // 设置图片样式
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain'; // 保持图片比例
        img.style.borderRadius = 'var(--border-radius)'; // 应用圆角
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)'; // 添加阴影

        modal.appendChild(img); // 将图片添加到模态框
        // 点击模态框任意位置关闭
        modal.addEventListener('click', () => {
            modal.remove();
            // 如果 src 是 Object URL，调用者应负责 revoke
            // 但通常对于图片，src 是 Data URL 或普通 URL，不需要 revoke
            if (src.startsWith('blob:')) { // 简单检查是否为 Object URL
                URL.revokeObjectURL(src);
                Utils.log(`Object URL ${src.substring(0, 50)}... 已释放 (showFullImage)。`, Utils.logLevels.DEBUG);
            }
        });
        document.body.appendChild(modal); // 将模态框添加到body
    },

    /**
     * 在一个覆盖全屏的模态框中显示一个视频。
     * @param {string} src - 视频的源 URL (通常是 Object URL)。
     * @param {string} [altText="视频"] - 视频的替代文本或标题。
     * @param {string} [fileType] - 视频的 MIME 类型，可选。
     */
    showFullVideo: function (src, altText = "视频", fileType) {
        const modal = document.createElement('div');
        modal.className = 'modal-like video-viewer'; // 与图片查看器类似的类名
        modal.style.backgroundColor = 'rgba(0,0,0,0.9)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001';

        const videoContainer = document.createElement('div');
        videoContainer.style.display = 'flex';
        videoContainer.style.alignItems = 'center';
        videoContainer.style.justifyContent = 'center';
        videoContainer.style.width = '95vw';
        videoContainer.style.height = '95vh';
        videoContainer.style.position = 'relative';


        const video = document.createElement('video');
        video.src = src;
        video.controls = true;
        video.autoplay = true;
        video.style.display = 'block';
        video.style.maxHeight = '100%';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        video.style.width = 'auto';
        video.style.objectFit = 'contain';
        video.style.borderRadius = 'var(--border-radius)';
        video.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';
        if (fileType) {
            const source = document.createElement('source');
            source.src = src;
            source.type = fileType;
            video.appendChild(source);
        }
        video.setAttribute('title', altText);

        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.className = 'modal-close-button top-right';
        closeButton.style.position = 'absolute';
        closeButton.style.top = '10px';
        closeButton.style.right = '10px';
        closeButton.style.zIndex = '1002';
        closeButton.style.fontSize = '1.8em';
        closeButton.style.padding = '0.1em 0.4em';
        closeButton.style.lineHeight = '1';
        closeButton.style.background = 'rgba(30, 30, 30, 0.7)';
        closeButton.style.color = 'white';
        closeButton.style.border = 'none';
        closeButton.style.borderRadius = '50%';
        closeButton.style.cursor = 'pointer';
        closeButton.setAttribute('aria-label', '关闭视频');


        const closeModalAndRevoke = () => {
            video.pause();
            URL.revokeObjectURL(src); // 关键：释放 Object URL
            Utils.log(`Object URL ${src.substring(0, 50)}... 已释放 (showFullVideo)。`, Utils.logLevels.DEBUG);
            modal.remove();
        };

        closeButton.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡到 videoContainer 或 modal
            closeModalAndRevoke();
        });

        // 点击 videoContainer 但非 video 元素或关闭按钮本身时关闭
        videoContainer.addEventListener('click', (event) => {
            if (event.target === videoContainer) { // 只有当直接点击 videoContainer 时
                closeModalAndRevoke();
            }
        });

        // 点击最外层 modal 背景（videoContainer之外）时关闭
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeModalAndRevoke();
            }
        });


        videoContainer.appendChild(video);
        videoContainer.appendChild(closeButton);
        modal.appendChild(videoContainer);
        document.body.appendChild(modal);

        video.focus();
    },

    /**
     * 发起一个流式 API 请求并处理响应。
     * @param {string} url - API 端点 URL。
     * @param {object} requestBody - 请求体对象。
     * @param {object} headers - 请求头对象。
     * @param {function} onChunkReceived - 处理接收到的每个数据块的回调函数。它接收 (jsonChunk) 作为参数。
     * @param {function} onStreamEnd - 流结束时调用的回调函数。它接收 (fullResponseContent) 作为参数。
     * @returns {Promise<void>}
     * @throws {Error} 如果请求失败或响应无效。
     */
    fetchApiStream: async function(url, requestBody, headers, onChunkReceived, onStreamEnd) {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.text();
            Utils.log(`API 错误 (${response.status}): ${errorData}`, Utils.logLevels.ERROR);
            throw new Error(`API 请求失败，状态码 ${response.status}。`);
        }

        let fullResponseContent = "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { value, done: readerDone } = await reader.read();
            if (readerDone) {
                buffer += decoder.decode(); // 解码最后一部分
                break;
            }
            buffer += decoder.decode(value, { stream: true });

            let stopStreaming = (buffer.trim() === "[DONE]" || buffer.includes("[DONE]"));
            if (stopStreaming) {
                buffer = buffer.substring(0, buffer.indexOf("[DONE]"));
            }

            let boundary = 0;
            while (boundary < buffer.length) {
                const startIdx = buffer.indexOf('{', boundary);
                if (startIdx === -1) {
                    buffer = buffer.substring(boundary);
                    break;
                }
                let openBraces = 0;
                let endIdx = -1;
                for (let i = startIdx; i < buffer.length; i++) {
                    if (buffer[i] === '{') openBraces++;
                    else if (buffer[i] === '}') {
                        openBraces--;
                        if (openBraces === 0) {
                            endIdx = i;
                            break;
                        }
                    }
                }

                if (endIdx !== -1) {
                    const jsonString = buffer.substring(startIdx, endIdx + 1);
                    try {
                        const jsonChunk = JSON.parse(jsonString);
                        if (jsonChunk.choices && jsonChunk.choices[0]?.delta?.content) {
                            const chunkContent = jsonChunk.choices[0].delta.content;
                            fullResponseContent += chunkContent;
                            if (typeof onChunkReceived === 'function') {
                                onChunkReceived(jsonChunk);
                            }
                        }
                    } catch (e) {
                        Utils.log(`解析 API 流 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN);
                    }
                    boundary = endIdx + 1;
                    if (boundary >= buffer.length) buffer = "";
                } else {
                    buffer = buffer.substring(startIdx);
                    break;
                }
            }
            if (stopStreaming) break;
        }

        if (typeof onStreamEnd === 'function') {
            onStreamEnd(fullResponseContent);
        }
    },

    /**
     * 检查浏览器是否支持 WebRTC (RTCPeerConnection)。
     * 如果不支持，会更新全局状态指示器并返回 false。
     * @returns {boolean} - true 表示支持，false 表示不支持。
     */
    checkWebRTCSupport: function () {
        if (typeof RTCPeerConnection === 'undefined') { // 检查 RTCPeerConnection 是否定义
            if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.updateConnectionStatusIndicator) {
                LayoutUIManager.updateConnectionStatusIndicator('浏览器不支持 WebRTC。', 'error'); // 更新状态指示
            } else {
                Utils.log("LayoutUIManager 未定义，无法更新 WebRTC 支持状态指示。", Utils.logLevels.WARN);
            }
            return false;
        }
        return true;
    },
};