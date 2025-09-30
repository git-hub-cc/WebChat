import AppSettings from '@/config/AppSettings';

/**
 * 根据设置的日志级别在控制台打印日志。
 * @param {string} message - 要打印的日志消息。
 * @param {('DEBUG'|'INFO'|'WARN'|'ERROR')} [level='DEBUG'] - 日志级别。
 */
export const log = (message, level = 'DEBUG') => {
    // 在生产环境下，直接跳过所有日志记录逻辑
    return;
    const levelMap = AppSettings.logLevels;
    const currentLogLevel = levelMap[AppSettings.logLevel] ?? levelMap.DEBUG;

    if (levelMap[level] >= currentLogLevel) {
        const timestamp = new Date().toLocaleTimeString();
        const prefixes = { DEBUG: '[DBG]', INFO: '[INF]', WARN: '[WRN]', ERROR: '[ERR]' };
        const prefix = prefixes[level] || '[LOG]';
        const logMessage = `[${timestamp}] ${prefix} ${message}`;

        switch (level) {
            case 'ERROR': console.error(logMessage); break;
            case 'WARN': console.warn(logMessage); break;
            case 'INFO': console.info(logMessage); break;
            default: console.log(logMessage); break; // console.debug is often hidden by default
        }
    }
};

/**
 * --- MODIFICATION START: Added debounce utility function ---
 * 创建一个防抖函数，该函数会从上一次被调用后，延迟 `delay` 毫秒后调用 `func` 方法。
 * @param {Function} func - 要防抖的函数。
 * @param {number} [delay=300] - 延迟的毫秒数。
 * @returns {Function} - 返回新的防抖函数。
 */
export const debounce = (func, delay = 300) => {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
};
/**
 * --- MODIFICATION END ---
 */

/**
 * 生成一个指定长度的随机字符串 ID。
 * @param {number} [length=8] - ID 的长度。
 * @returns {string} - 生成的随机 ID。
 */
export const generateId = (length = 8) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

/**
 * 将 Date 对象格式化为用户友好的、相对的日期时间字符串。
 * @param {Date} dateObj - 要格式化的 Date 对象。
 * @returns {string} - 格式化后的日期字符串 (e.g., "14:30", "昨天", "9月12日")。
 */
export const formatDate = (dateObj) => {
    if (!(dateObj instanceof Date) || isNaN(dateObj)) return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (dateObj >= today) {
        return dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (dateObj >= yesterday) {
        return '昨天';
    } else {
        return dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
};

/**
 * 格式化消息文本，转换换行符、URL，并处理流式光标。
 * @param {string} text - 要格式化的原始文本。
 * @returns {string} - 格式化后的 HTML 字符串。
 */
export const formatMessageText = (text) => {
    if (typeof text !== 'string') return '';

    const escapeHtml = (str) => str.replace(/[&<>"']/g, match => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[match]));

    let escapedText = escapeHtml(text);
    escapedText = escapedText.replace(/\n/g, '<br>');
    escapedText = escapedText.replace(/▍/g, '<span class="streaming-cursor">▍</span>');

    // Regex to find URLs
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return escapedText.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
};

// --- MODIFICATION START: Web Worker implementation for hashing ---

// Worker pool to avoid creating new workers for every hash.
const workerPool = {
    hash: null,
};

/**
 * [NEW] Uses a Web Worker to calculate the SHA-256 hash of a file Blob.
 * This is the high-performance method that avoids blocking the main thread.
 * @param {Blob} blob - The file Blob object to hash.
 * @returns {Promise<string>} A promise that resolves with the file's SHA-256 hash string.
 */
function generateFileHashWithWorker(blob) {
    return new Promise((resolve, reject) => {
        // Fallback for browsers that don't support Web Workers
        if (!window.Worker) {
            console.warn("Web Worker not supported. Falling back to main thread hashing.");
            return generateFileHashOnMainThread(blob).then(resolve).catch(reject);
        }

        // Initialize or get the existing worker from the pool
        if (!workerPool.hash) {
            try {
                workerPool.hash = new Worker('hash.worker.js'); // Path relative to index.html
            } catch (error) {
                console.error("Failed to create hash worker. Falling back to main thread.", error);
                return generateFileHashOnMainThread(blob).then(resolve).catch(reject);
            }
        }
        const worker = workerPool.hash;

        // Create a unique ID for this specific hashing task
        const id = Date.now() + Math.random();

        const messageHandler = (event) => {
            // Ensure the response corresponds to this specific task
            if (event.data.id === id) {
                worker.removeEventListener('message', messageHandler); // Clean up the listener
                if (event.data.error) {
                    reject(new Error(event.data.error));
                } else {
                    resolve(event.data.hash);
                }
            }
        };

        worker.addEventListener('message', messageHandler);
        worker.addEventListener('error', (err) => {
            worker.removeEventListener('message', messageHandler);
            reject(err);
        });

        // Send the blob to the worker to start processing.
        // We do not use transferable objects ([blob]) because the main thread
        // still needs the blob to create object URLs for previews.
        worker.postMessage({ fileBlob: blob, id });
    });
}

/**
 * [RENAMED & FALLBACK] Calculates the SHA-256 hash on the main thread.
 * Kept as a fallback for older browsers or if the worker fails.
 * @param {Blob} blob - The file Blob object to hash.
 * @returns {Promise<string>} A promise that resolves with the file's SHA-256 hash string.
 */
async function generateFileHashOnMainThread(blob) {
    if (!(blob instanceof Blob)) {
        throw new Error("Input must be a Blob object.");
    }
    try {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        log(`Failed to generate file hash on main thread: ${error.message}`, 'ERROR');
        throw error;
    }
}

/**
 * [EXPORTED] A unified hash generation function that prioritizes using a Web Worker.
 * All parts of the app should use this function for hashing.
 */
export const generateHash = generateFileHashWithWorker;
// Kept the old export for backward compatibility in case I missed a spot, but it's now an alias.
export const generateFileHash = generateFileHashOnMainThread;

// --- MODIFICATION END ---


/**
 * 发起一个流式 API 请求并处理响应。
 * @param {string} url - API 端点 URL。
 * @param {object} requestBody - 请求体对象。
 * @param {object} headers - 请求头对象。
 * @param {function} onChunkReceived - 处理接收到的每个数据块的回调函数。
 * @param {function} onStreamEnd - 流结束时调用的回调函数。
 */
export async function fetchApiStream(url, requestBody, headers, onChunkReceived, onStreamEnd) {
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorData}`);
    }

    if (!response.body) {
        throw new Error("Response body is null, cannot process stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = ""; // Accumulate full content for the end callback

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process line by line, as chunks can be partial
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
            const chunkLine = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);

            if (chunkLine.startsWith('data:')) {
                const jsonStr = chunkLine.substring(5).trim();
                if (jsonStr === '[DONE]') {
                    if (onStreamEnd) onStreamEnd(fullContent);
                    return;
                }

                try {
                    const jsonChunk = JSON.parse(jsonStr);
                    const chunkContent = jsonChunk.choices?.[0]?.delta?.content;
                    if (chunkContent) {
                        fullContent += chunkContent;
                        if (onChunkReceived) onChunkReceived(jsonChunk);
                    }
                } catch (e) {
                    log(`Error parsing stream JSON chunk: "${jsonStr}" - ${e.message}`, 'WARN');
                }
            }
        }
    }

    // Call onStreamEnd for non-[DONE] terminated streams
    if (onStreamEnd) onStreamEnd(fullContent);
}

/**
 * --- ✅ MODIFICATION START: Added video thumbnail generator ---
 * 从视频 Blob 生成一张预览图 (Data URL)。
 * @param {Blob} videoBlob - 视频的 Blob 对象。
 * @returns {Promise<string>} - 返回一个包含预览图的 Data URL 字符串。
 */
export const generateVideoThumbnail = (videoBlob) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const url = URL.createObjectURL(videoBlob);

        video.style.display = 'none'; // 隐藏视频元素
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = url;

        const cleanup = () => {
            URL.revokeObjectURL(url);
            video.remove();
            canvas.remove();
        };

        // 监听 'loadeddata' 事件，确保视频元数据已加载
        video.onloadeddata = () => {
            // 设置 canvas 尺寸与视频一致
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            // 寻址到视频的某一帧 (例如 0.1s 处，比 0s 更可靠)
            video.currentTime = 0.1;
        };

        // 监听 'seeked' 事件，确保寻址操作已完成
        video.onseeked = () => {
            if (!context) {
                cleanup();
                reject(new Error('无法获取 Canvas 2D 上下文'));
                return;
            }
            // 将当前视频帧绘制到 canvas 上
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            // 从 canvas 导出图片 Data URL
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // 压缩质量为 80%

            cleanup();
            resolve(dataUrl);
        };

        video.onerror = (err) => {
            cleanup();
            reject(new Error('视频加载或解码失败'));
        };

        document.body.appendChild(video); // 必须添加到 DOM 才能触发加载事件
    });
};
/**
 * --- ✅ MODIFICATION END ---
 */