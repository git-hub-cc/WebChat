import AppSettings from '@/config/AppSettings';

/**
 * 根据设置的日志级别在控制台打印日志。
 * @param {string} message - 要打印的日志消息。
 * @param {('DEBUG'|'INFO'|'WARN'|'ERROR')} [level='DEBUG'] - 日志级别。
 */
export const log = (message, level = 'DEBUG') => {
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

/**
 * 计算文件Blob的SHA-256哈希值。
 * @param {Blob} blob - 要计算哈希的文件Blob对象。
 * @returns {Promise<string>} - 文件的SHA-256哈希字符串。
 */
export async function generateFileHash(blob) {
    if (!(blob instanceof Blob)) {
        throw new Error("Input must be a Blob object.");
    }
    try {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        log(`Failed to generate file hash: ${error.message}`, 'ERROR');
        throw error;
    }
}

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