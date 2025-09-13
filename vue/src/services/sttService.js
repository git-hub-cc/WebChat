/**
 * @file sttService.js
 * @description (Vue Refactor - NEW FILE)
 *              封装了 Web Speech API 以提供语音转文本 (STT) 功能。
 *              [MODIFIED] 实现了守护式重启机制以应对 API 的不稳定性。
 *              [MODIFIED] 将原始 onresult 事件直接传递给回调，以实现更灵活的文本处理（如追加模式）。
 * @module Services
 */
import { log } from '@/utils';
import { eventBus } from './eventBus';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let callbacks = {};
// Internal state for robust handling.
// Tracks if the service *should* be running, allowing for automatic restarts.
let _shouldBeRunning = false;

if (!SpeechRecognition) {
    log('Web Speech API is not supported in this browser.', 'WARN');
} else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    recognition.onstart = () => {
        log('STT recognition started.', 'INFO');
        if (callbacks.onStart) callbacks.onStart();
    };

    // --- MODIFICATION START: Pass the raw event object ---
    // The component is now responsible for processing the results.
    // This allows for more advanced logic like appending text.
    recognition.onresult = (event) => {
        if (callbacks.onResult) {
            callbacks.onResult(event);
        }
    };
    // --- MODIFICATION END ---

    recognition.onerror = (event) => {
        log(`STT Error: ${event.error}`, 'ERROR');
        if (callbacks.onError) callbacks.onError(event.error);
    };

    recognition.onend = () => {
        log('STT recognition ended.', 'INFO');
        if (_shouldBeRunning) {
            log('STT stopped unexpectedly. Restarting automatically...', 'WARN');
            try {
                recognition.start();
            } catch (e) {
                log(`Error restarting STT: ${e.message}`, 'ERROR');
            }
        } else {
            if (callbacks.onEnd) callbacks.onEnd();
        }
    };
}

export const sttService = {
    /**
     * 初始化STT服务并设置回调。
     * @param {object} cbs - 回调函数对象。
     * @param {function} cbs.onStart - 识别开始时调用。
     * @param {function(SpeechRecognitionEvent)} cbs.onResult - 收到结果时调用，传递原始事件对象。
     * @param {function(string)} cbs.onError - 发生错误时调用。
     * @param {function} cbs.onEnd - 识别结束时调用 (仅在手动停止后)。
     */
    init(cbs) {
        if (!SpeechRecognition) return;
        callbacks = cbs;
    },

    /**
     * 开始语音识别。
     */
    start() {
        if (!SpeechRecognition) {
            eventBus.emit('showNotification', { message: '您的浏览器不支持语音输入。', type: 'error' });
            return;
        }
        if (_shouldBeRunning) return;
        try {
            _shouldBeRunning = true;
            recognition.start();
        } catch (e) {
            log(`STT could not start: ${e.message}`, 'ERROR');
            _shouldBeRunning = false;
        }
    },

    /**
     * 停止语音识别。
     */
    stop() {
        if (!SpeechRecognition || !_shouldBeRunning) return;
        _shouldBeRunning = false;
        recognition.stop();
    },

    /**
     * 检查服务是否正在运行。
     * @returns {boolean}
     */
    isListening() {
        return _shouldBeRunning;
    }
};