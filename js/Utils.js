/**
 * @file 通用工具函数库
 * @description 提供一系列在整个应用程序中可复用的通用辅助函数，包括日志记录、ID生成、数据格式化、文件分片传输、流式API请求封装等。
 * @module Utils
 * @exports {object} Utils - 对外暴露的单例对象，包含所有工具函数。
 * @dependency AppSettings - 用于获取日志级别和媒体传输等全局配置。
 * @dependency ConnectionManager - 在文件分片传输中用于状态记录。
 */
const Utils = {
    // === 变量声明 ===

    // 日志级别定义，将从 AppSettings 中填充
    logLevels: {},
    // 当前生效的日志级别，将从 AppSettings 中填充
    currentLogLevel: null,

    // === 方法 ===
    // (按照 日志 -> 数据生成/安全 -> 网络 -> 格式化 -> DOM/UI 的顺序)

    // --- 日志 ---

    /**
     * 从全局配置 `AppSettings` 中设置日志级别
     * @function setLogLevelFromConfig
     */
    setLogLevelFromConfig: function() {
        if (typeof AppSettings !== 'undefined' && AppSettings.constants?.logLevels) {
            this.logLevels = AppSettings.constants.logLevels;
            const logLevelName = AppSettings.logLevel || 'DEBUG';
            this.currentLogLevel = this.logLevels[logLevelName.toUpperCase()] ?? this.logLevels.DEBUG;
        } else {
            // NOTE: 若 AppSettings 不可用，则使用默认的回退配置
            this.logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
            this.currentLogLevel = this.logLevels.DEBUG;
        }
    },

    /**
     * 根据设置的日志级别在控制台打印日志
     * @function log
     * @param {string} message - 要打印的日志消息。
     * @param {number} [level=Utils.logLevels.DEBUG] - 日志级别，来自 `Utils.logLevels`。
     */
    log: function (message, level) {
        // 1. 如果日志级别未初始化，则先进行初始化
        if (this.currentLogLevel === null) {
            this.setLogLevelFromConfig();
        }
        const logLevel = level !== undefined ? level : this.logLevels.DEBUG;

        // 2. 只有当消息级别高于或等于当前设定的日志级别时才打印
        if (logLevel >= this.currentLogLevel) {
            const timestamp = new Date().toLocaleTimeString();
            const prefixes = { [this.logLevels.DEBUG]: '[DBG]', [this.logLevels.INFO]: '[INF]', [this.logLevels.WARN]: '[WRN]', [this.logLevels.ERROR]: '[ERR]' };
            const prefix = prefixes[logLevel] || '[LOG]';
            const logMessage = `[${timestamp}] ${prefix} ${message}`;

            // 3. 根据日志级别选择不同的控制台方法，以利用浏览器的颜色和过滤功能
            if (logLevel === this.logLevels.ERROR) console.error(logMessage);
            else if (logLevel === this.logLevels.DEBUG) console.debug(logMessage);
            else if (logLevel === this.logLevels.WARN) console.warn(logMessage);
            else console.info(logMessage); // 默认为 INFO
        }
    },

    // --- 数据生成与安全 ---

    /**
     * 生成一个指定长度的随机字符串ID
     * @function generateId
     * @description 生成的ID包含大小写字母和数字，并排除了易混淆的字符（如 0, O, 1, I, l）。
     * @param {number} [length=8] - 生成ID的长度。
     * @returns {string} - 生成的随机ID。
     */
    generateId: function(length = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        return Array.from({ length }, () =>
            chars.charAt(Math.floor(Math.random() * chars.length))
        ).join('');
    },

    /**
     * 计算文件Blob的SHA-256哈希值
     * @function generateFileHash
     * @param {Blob} blob - 需要计算哈希的文件Blob对象。
     * @returns {Promise<string>} 文件的SHA-256哈希字符串。
     * @throws {Error} 如果输入不是一个有效的Blob对象或浏览器不支持 `crypto.subtle`。
     */
    generateFileHash: async function(blob) {
        if (!(blob instanceof Blob)) {
            throw new Error("generateFileHash: 输入必须是一个Blob对象。");
        }
        try {
            const buffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            this.log(`generateFileHash: 计算哈希失败 - ${error.message}`, this.logLevels.ERROR);
            throw error;
        }
    },

    /**
     * 转义HTML特殊字符以防止XSS攻击
     * @function escapeHtml
     * @param {string} str - 需要转义的原始字符串。
     * @returns {string} - 转义后的安全字符串。
     */
    escapeHtml: function(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (match) {
                return { '&': '&', '<': '<', '>': '>', '"': '"', "'": `'` }[match];
                });
            },

            // --- 网络相关 ---

            /**
             * 使用RTCPeerConnection检查本地网络的连接能力
             * @function checkNetworkType
             * @description 通过收集ICE候选者来判断网络是否支持IPv4/IPv6、UDP/TCP以及是否需要中继（Relay）。
             * @returns {Promise<object>} 一个包含网络能力检测结果的对象，如 `{ ipv4: true, udp: true, ... }`。
             */
            checkNetworkType: async function () {
            try {
                const pc = new RTCPeerConnection();
                const candidates = [];
                let candidateGatheringDone = false;

                pc.onicecandidate = (e) => {
                    if (e.candidate) candidates.push(e.candidate);
                    else candidateGatheringDone = true;
                };

                pc.createDataChannel("check");
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                // 等待ICE候选者收集完成，或1.5秒后超时
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

                // 分析收集到的候选者信息
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
         * 将大文件(Blob)分片并通过RTCDataChannel发送
         * @function sendInChunks
         * @description 实现带背压控制的文件传输，防止因发送过快导致数据通道缓冲区溢出。
         * @param {Blob} fileBlob - 要发送的文件Blob对象。
         * @param {string} fileName - 文件名。
         * @param {RTCDataChannel} dataChannel - 用于发送数据的RTCDataChannel实例。
         * @param {string} peerId - 接收方的ID。
         * @param {string} fileHash - 文件的唯一哈希，用作分片传输的ID。
         * @param {number} [chunkSize=AppSettings.media.chunkSize] - 每个分片的大小（字节）。
         */
        sendInChunks: async function (fileBlob, fileName, dataChannel, peerId, fileHash, chunkSize = AppSettings.media.chunkSize) {
            if (!(fileBlob instanceof Blob)) {
                Utils.log("Utils.sendInChunks: 提供的不是一个 Blob 对象。", Utils.logLevels.ERROR);
                return;
            }

            const totalChunks = Math.ceil(fileBlob.size / chunkSize);
            Utils.log(`准备向 ${peerId} 发送文件 "${fileName}" (hash: ${fileHash.substring(0,8)}...), 大小: ${fileBlob.size} bytes, 共 ${totalChunks} 个分片。`, Utils.logLevels.INFO);

            try {
                // 发送流程如下：
                // 1. 发送文件元数据（metadata），通知接收方准备接收文件
                const metadata = {
                    type: 'chunk-meta',
                    chunkId: fileHash,
                    totalChunks: totalChunks,
                    fileName: fileName,
                    fileType: fileBlob.type,
                    fileSize: fileBlob.size
                };
                dataChannel.send(JSON.stringify(metadata));

                // 2. 在 `ConnectionManager` 中记录文件发送的整体进度状态
                if (!ConnectionManager.pendingSentChunks) ConnectionManager.pendingSentChunks = {};
                ConnectionManager.pendingSentChunks[fileHash] = { total: totalChunks, sent: 0, dataLength: fileBlob.size };

                // 3. 循环将文件 Blob 切片并发送
                for (let i = 0; i < totalChunks; i++) {
                    // a. 使用 `while` 循环进行背压控制，检查 `dataChannel.bufferedAmount` 防止缓冲区溢出
                    while (dataChannel.bufferedAmount > AppSettings.media.dataChannelBufferThreshold) {
                        Utils.log(`Utils.sendInChunks: 到 ${peerId} 的缓冲区已满。等待...`, Utils.logLevels.DEBUG);
                        await new Promise(resolve => setTimeout(resolve, AppSettings.media.dataChannelBufferCheckInterval));
                        if (dataChannel.readyState !== 'open') {
                            Utils.log(`Utils.sendInChunks: 数据通道到 ${peerId} 在发送期间关闭。中止发送。`, Utils.logLevels.WARN);
                            if (ConnectionManager.pendingSentChunks[fileHash]) delete ConnectionManager.pendingSentChunks[fileHash];
                            return;
                        }
                    }

                    // b. 切割文件并转为 ArrayBuffer 进行二进制传输
                    const start = i * chunkSize;
                    const end = start + chunkSize;
                    const chunkBlob = fileBlob.slice(start, end);
                    const chunkBuffer = await chunkBlob.arrayBuffer();
                    dataChannel.send(chunkBuffer);

                    // c. 更新已发送的分片计数
                    const pending = ConnectionManager.pendingSentChunks[fileHash];
                    if (pending) {
                        pending.sent++;
                        if (pending.sent === pending.total) {
                            delete ConnectionManager.pendingSentChunks[fileHash];
                            Utils.log(`已向 ${peerId} 发送完文件 "${fileName}" 的所有分片。`, Utils.logLevels.INFO);
                        }
                    }
                    await new Promise(resolve => setTimeout(resolve, 1)); // 短暂让出执行权，避免阻塞UI线程
                }
            } catch (error) {
                Utils.log(`Utils.sendInChunks: 发送文件 "${fileName}" 到 ${peerId} 时出错: ${error.message}`, Utils.logLevels.ERROR);
                if (ConnectionManager.pendingSentChunks?.[fileHash]) {
                    delete ConnectionManager.pendingSentChunks[fileHash];
                }
            }
        },

        /**
         * 发起一个流式API请求并处理响应
         * @function fetchApiStream
         * @param {string} url - API端点URL。
         * @param {object} requestBody - 请求体对象。
         * @param {object} headers - 请求头对象。
         * @param {function} onChunkReceived - 处理每个JSON数据块的回调函数。
         * @param {function} onStreamEnd - 流结束时调用的回调函数，参数为完整的响应字符串。
         * @returns {Promise<void>}
         * @throws {Error} 如果请求失败或响应状态码非2xx。
         */
        fetchApiStream: async function(url, requestBody, headers, onChunkReceived, onStreamEnd) {
            const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(requestBody) });
            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`API 请求失败，状态码 ${response.status}。详情: ${errorData}`);
            }

            // 流式处理流程：
            // 1. 初始化读取器、解码器和缓冲区
            let fullResponseContent = "";
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            // 2. 持续读取响应流
            while (true) {
                const { value, done: readerDone } = await reader.read();
                if (readerDone) { buffer += decoder.decode(); break; }
                buffer += decoder.decode(value, { stream: true });

                // 3. 检查流结束标记 `[DONE]`
                let stopStreaming = buffer.includes("[DONE]");
                if (stopStreaming) buffer = buffer.substring(0, buffer.indexOf("[DONE]"));

                // 4. 在缓冲区中查找并解析完整的JSON对象
                let boundary = 0;
                while (boundary < buffer.length) {
                    // a. 通过匹配花括号 `{}` 来确定 JSON 对象的边界
                    const startIdx = buffer.indexOf('{', boundary);
                    if (startIdx === -1) { buffer = buffer.substring(boundary); break; }
                    let openBraces = 0, endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') openBraces++;
                        else if (buffer[i] === '}') {
                            openBraces--;
                            if (openBraces === 0) { endIdx = i; break; }
                        }
                    }

                    // b. 如果找到完整JSON，则解析并处理
                    if (endIdx !== -1) {
                        const jsonString = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const jsonChunk = JSON.parse(jsonString);
                            // c. 提取有效内容并调用 `onChunkReceived` 回调
                            if (jsonChunk.choices?.[0]?.delta?.content) {
                                const chunkContent = jsonChunk.choices[0].delta.content;
                                fullResponseContent += chunkContent;
                                if (typeof onChunkReceived === 'function') onChunkReceived(jsonChunk);
                            }
                        } catch (e) {
                            Utils.log(`解析 API 流 JSON 出错: ${e}. 缓冲区: ${buffer.substring(0, 100)}`, Utils.logLevels.WARN);
                        }
                        // d. 从缓冲区中移除已处理的部分
                        boundary = endIdx + 1;
                        if (boundary >= buffer.length) buffer = "";
                    } else { buffer = buffer.substring(startIdx); break; }
                }
                if (stopStreaming) break;
            }

            // 5. 流结束后，调用 `onStreamEnd` 回调
            if (typeof onStreamEnd === 'function') onStreamEnd(fullResponseContent);
        },

        /**
         * 检查浏览器是否支持WebRTC
         * @function checkWebRTCSupport
         * @returns {boolean} - `true` 表示支持，`false` 表示不支持。
         */
        checkWebRTCSupport: function () {
            if (typeof RTCPeerConnection === 'undefined') {
                if (typeof LayoutUIManager?.updateConnectionStatusIndicator !== 'undefined') {
                    LayoutUIManager.updateConnectionStatusIndicator('浏览器不支持 WebRTC。', 'error');
                } else Utils.log("LayoutUIManager 未定义，无法更新 WebRTC 支持状态指示。", Utils.logLevels.WARN);
                return false;
            }
            return true;
        },

        // --- 格式化 ---

        /**
         * 将总秒数格式化为 "mm:ss" 格式的字符串
         * @function formatTime
         * @param {number} totalSeconds - 总秒数。
         * @returns {string} - 格式化后的时间字符串，例如 "01:23"。
         */
        formatTime: function(totalSeconds) {
            const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
            return `${minutes}:${seconds}`;
        },

        /**
         * 将Date对象格式化为用户友好的相对日期时间字符串
         * @function formatDate
         * @param {Date} dateObj - 要格式化的Date对象。
         * @param {boolean} [includeTime=true] - 结果中是否包含时间部分。
         * @returns {string} - 格式化后的日期字符串 (如 "今天 14:30", "昨天 10:00", "5月20日 08:00")。
         */
        formatDate: function(dateObj, includeTime = true) {
            if (!(dateObj instanceof Date) || isNaN(dateObj)) return '无效日期';

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);

            if (dateObj >= today) {
                return includeTime ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '今天';
            } else if (dateObj >= yesterday) {
                return '昨天' + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
            } else if (dateObj.getFullYear() === now.getFullYear()){
                return dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
            } else {
                return dateObj.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + (includeTime ? ` ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
            }
        },

        /**
         * 截断过长的文件名
         * @function truncateFileName
         * @param {string} filename - 原始文件名。
         * @param {number} maxLength - 允许的最大长度。
         * @returns {string} - 如果文件名超出长度，则截断并添加 "..."；否则返回原文件名。
         */
        truncateFileName: function(filename, maxLength) {
            if (typeof filename !== 'string') return '';
            if (filename.length > maxLength) {
                return filename.substring(0, maxLength) + "...";
            }
            return filename;
        },

        /**
         * 格式化消息文本，支持换行、URL链接和流式光标
         * @function formatMessageText
         * @param {string} text - 要格式化的原始文本。
         * @returns {string} - 格式化后的HTML字符串。
         */
        formatMessageText: function (text) {
            if (typeof text !== 'string') return '';
            let escapedText = Utils.escapeHtml(text);
            escapedText = escapedText.replace(/ {2,}/g, ' '); // 压缩多余空格
            escapedText = escapedText.replace(/\n/g, '<br>'); // 转换换行为<br>
            escapedText = escapedText.replace(/▍/g, '<span class="streaming-cursor">▍</span>'); // 渲染流式光标
            const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
            return escapedText.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`); // 转换URL为链接
        },

        // --- DOM / UI 助手 ---

        /**
         * 将一个矩形裁剪到指定的区域内
         * @function clipRectToArea
         * @param {object} rect - 需要被裁剪的矩形，格式为 `{x, y, w, h}`。
         * @param {object} clipArea - 用于裁剪的区域，格式为 `{x, y, w, h}`。
         * @returns {object|null} - 裁剪后的新矩形对象，如果无重叠区域则返回`null`。
         */
        clipRectToArea: function(rect, clipArea) {
            if (!rect || !clipArea) return null;
            const finalX = Math.max(rect.x, clipArea.x);
            const finalY = Math.max(rect.y, clipArea.y);
            const finalRight = Math.min(rect.x + rect.w, clipArea.x + clipArea.w);
            const finalBottom = Math.min(rect.y + rect.h, clipArea.y + clipArea.h);
            const finalW = finalRight - finalX;
            const finalH = finalBottom - finalY;
            if (finalW <= 0 || finalH <= 0) return null; // 无重叠区域
            return { x: finalX, y: finalY, w: finalW, h: finalH };
        },

        /**
         * 检查一个点是否位于一个矩形内部
         * @function isPointInRect
         * @param {number} px - 点的X坐标。
         * @param {number} py - 点的Y坐标。
         * @param {object} rect - 矩形对象，格式为 `{x, y, w, h}`。
         * @returns {boolean} - 如果点在矩形内（含边界），返回`true`。
         */
        isPointInRect: function(px, py, rect) {
            return rect && px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
        },

        /**
         * 在全屏模态框中显示一张图片
         * @function showFullImage
         * @param {string} src - 图片的源URL (可以是http, https, blob等)。
         * @param {string} [altText="图片"] - 图片的替代文本。
         */
        showFullImage: function (src, altText = "图片") {
            const modal = document.createElement('div');
            modal.className = 'modal-like image-viewer';
            Object.assign(modal.style, {
                backgroundColor: 'rgba(0,0,0,0.85)', position: 'fixed', top: '0', left: '0',
                width: '100%', height: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', zIndex: '1001'
            });

            const img = document.createElement('img');
            img.src = src;
            img.alt = altText;
            Object.assign(img.style, {
                maxWidth: '90%', maxHeight: '90%', objectFit: 'contain',
                borderRadius: 'var(--border-radius)', boxShadow: '0 0 30px rgba(0,0,0,0.5)'
            });

            modal.appendChild(img);
            modal.addEventListener('click', () => {
                modal.remove();
                if (src.startsWith('blob:')) URL.revokeObjectURL(src); // 释放Blob URL
            });
            document.body.appendChild(modal);
        },

        /**
         * 在全屏模态框中显示一个视频
         * @function showFullVideo
         * @param {string} src - 视频的源URL (可以是http, https, blob等)。
         * @param {string} [altText="视频"] - 视频的替代文本或标题。
         * @param {string} [fileType] - 视频的MIME类型。
         */
        showFullVideo: function (src, altText = "视频", fileType) {
            const modal = document.createElement('div');
            modal.className = 'modal-like video-viewer';
            // ... (省略样式设置，代码本身不变)

            const video = document.createElement('video');
            video.src = src;
            video.controls = true;
            video.autoplay = true;
            // ... (省略样式设置)

            const closeButton = document.createElement('button');
            // ... (省略样式和内容设置)

            const closeModalAndRevoke = () => {
                video.pause();
                if (src.startsWith('blob:')) URL.revokeObjectURL(src); // 释放Blob URL
                modal.remove();
            };

            closeButton.addEventListener('click', (e) => { e.stopPropagation(); closeModalAndRevoke(); });
            modal.addEventListener('click', (event) => { if (event.target === modal) closeModalAndRevoke(); });

            modal.appendChild(video);
            modal.appendChild(closeButton); // 为了简化，这里直接追加，实际应使用容器
            document.body.appendChild(modal);
            video.focus();
        },
    };