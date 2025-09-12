/**
 * @file sttService.js
 * @description (Vue Refactor - NEW FILE)
 *              封装了 Web Speech API 以提供语音转文本 (STT) 功能。
 * @module Services
 */
import { log } from '@/utils';
import { eventBus } from './eventBus';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecognizing = false;
let callbacks = {};

if (!SpeechRecognition) {
    log('Web Speech API is not supported in this browser.', 'WARN');
} else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    recognition.onstart = () => {
        isRecognizing = true;
        log('STT recognition started.', 'INFO');
        if (callbacks.onStart) callbacks.onStart();
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        if (callbacks.onResult) {
            callbacks.onResult(finalTranscript, interimTranscript);
        }
    };

    recognition.onerror = (event) => {
        log(`STT Error: ${event.error}`, 'ERROR');
        if (callbacks.onError) callbacks.onError(event.error);
        isRecognizing = false;
    };

    recognition.onend = () => {
        isRecognizing = false;
        log('STT recognition ended.', 'INFO');
        if (callbacks.onEnd) callbacks.onEnd();
    };
}

export const sttService = {
    /**
     * 初始化STT服务并设置回调。
     * @param {object} cbs - 回调函数对象。
     * @param {function} cbs.onStart - 识别开始时调用。
     * @param {function(string, string)} cbs.onResult - 收到结果时调用 (final, interim)。
     * @param {function(string)} cbs.onError - 发生错误时调用。
     * @param {function} cbs.onEnd - 识别结束时调用。
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
        if (isRecognizing) return;
        try {
            recognition.start();
        } catch (e) {
            log(`STT could not start: ${e.message}`, 'ERROR');
        }
    },

    /**
     * 停止语音识别。
     */
    stop() {
        if (!SpeechRecognition || !isRecognizing) return;
        recognition.stop();
    },

    /**
     * 检查服务是否正在运行。
     * @returns {boolean}
     */
    isListening() {
        return isRecognizing;
    }
};