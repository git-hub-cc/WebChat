/**
 * @file MessageTtsHandler.js
 * @description 文本转语音 (TTS) 处理器，负责处理 AI 消息的语音合成功能。
 *              包括清理文本、向 TTS API 发送请求、处理响应以及管理消息中的播放控件 UI。
 * @module MessageTtsHandler
 * @exports {object} MessageTtsHandler - 对外暴露的单例对象，包含所有 TTS 相关处理方法。
 * @property {function} requestTtsForMessage - 为指定消息文本请求 TTS 音频。
 * @property {function} playTtsAudioFromControl - 处理播放/暂停 TTS 音频的点击事件。
 * @property {function} addTtsPlaceholder - 在消息中添加一个加载中的占位符。
 * @dependencies Config, Utils, UserManager, NotificationManager
 * @dependents MessageManager (当 AI 消息完成时调用)
 */
const MessageTtsHandler = {
    _currentlyPlayingTtsAudio: null,  // 当前正在播放的 Audio 实例
    _currentlyPlayingTtsButton: null, // 当前正在播放的按钮元素

    /**
     * 清理文本，移除不适合 TTS 的特殊字符、标记等。
     * @param {string} text - 原始消息文本。
     * @returns {string} - 清理后的纯文本。
     */
    cleanTextForTts: function (text) {
        if (typeof text !== 'string') return '';
        let cleanedText = text;
        // 移除 Markdown 格式和括号内容
        cleanedText = cleanedText.replace(/\*.*?\*/g, '');
        cleanedText = cleanedText.replace(/【.*?】/g, '');
        cleanedText = cleanedText.replace(/\[.*?\]/g, '');
        cleanedText = cleanedText.replace(/\(.*?\)/g, '');
        cleanedText = cleanedText.replace(/（.*?）/g, '');
        // 仅保留中、日、英、数字和基本标点
        const allowedCharsRegex = /[^\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\u3000-\u303f\uff01-\uff5ea-zA-Z0-9\s.,!?;:'"-]/g;
        cleanedText = cleanedText.replace(allowedCharsRegex, ' ');
        // 合并多个空格
        cleanedText = cleanedText.replace(/\s+/g, ' ');
        return cleanedText.trim();
    },

    /**
     * 在消息 UI 中添加一个加载中的占位符（旋转图标）。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 与此 TTS 请求关联的唯一 ID。
     */
    addTtsPlaceholder: function (parentContainer, ttsId) {
        const existingControl = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (existingControl) existingControl.remove();

        const ttsControlContainer = document.createElement('span');
        ttsControlContainer.className = 'tts-control-container';
        ttsControlContainer.dataset.ttsId = ttsId;
        const spinner = document.createElement('span');
        spinner.className = 'tts-loading-spinner';
        ttsControlContainer.appendChild(spinner);
        parentContainer.appendChild(ttsControlContainer);
    },

    /**
     * 为指定消息文本请求 TTS 音频。
     * @param {string} text - 清理后的消息文本。
     * @param {object} ttsConfig - 该 AI 角色的 TTS 配置。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 与此 TTS 请求关联的唯一 ID。
     * @returns {Promise<void>}
     */
    requestTtsForMessage: async function (text, ttsConfig, parentContainer, ttsId) {
        const currentTtsApiEndpoint = window.Config?.server?.ttsApiEndpoint;
        if (!currentTtsApiEndpoint) {
            Utils.log("TTS 未触发: 全局 TTS API 端点未配置。", Utils.logLevels.WARN);
            this.updateTtsControlToError(parentContainer, ttsId, "TTS 端点未配置");
            return;
        }

        const payload = {
            access_token: "guest", model_name: ttsConfig.model_name, speaker_name: ttsConfig.speaker_name,
            prompt_text_lang: ttsConfig.prompt_text_lang || "中文", emotion: ttsConfig.emotion || "默认",
            text: text, text_lang: ttsConfig.text_lang || "中文", top_k: ttsConfig.top_k || 10,
            top_p: ttsConfig.top_p || 1, temperature: ttsConfig.temperature || 1,
            text_split_method: ttsConfig.text_split_method || "按标点符号切", batch_size: ttsConfig.batch_size || 10,
            batch_threshold: ttsConfig.batch_threshold || 0.75, split_bucket: ttsConfig.split_bucket === undefined ? true : ttsConfig.split_bucket,
            speed_facter: ttsConfig.speed_facter || 1, fragment_interval: ttsConfig.fragment_interval || 0.3,
            media_type: ttsConfig.media_type || "wav", parallel_infer: ttsConfig.parallel_infer === undefined ? true : ttsConfig.parallel_infer,
            repetition_penalty: ttsConfig.repetition_penalty || 1.35, seed: ttsConfig.seed === undefined ? -1 : ttsConfig.seed,
        };
        Utils.log(`MessageTtsHandler: TTS 请求。端点='${currentTtsApiEndpoint}'，ttsId 为 ${ttsId}`, Utils.logLevels.DEBUG);

        try {
            const response = await fetch(currentTtsApiEndpoint, {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`TTS API 请求失败，状态码 ${response.status}: ${errorData.substring(0,150)}`);
            }
            const result = await response.json();
            if (result.audio_url) {
                this._preloadAndSetAudio(result.audio_url, parentContainer, ttsId);
            } else {
                throw new Error(`TTS API 响应缺少 audio_url。消息: ${result.msg || '未知错误'}`);
            }
        } catch (error) {
            Utils.log(`处理 ttsId ${ttsId} 的 TTS 时出错: ${error.message}`, Utils.logLevels.ERROR);
            if (Utils.logLevel <= Utils.logLevels.DEBUG && error.stack) Utils.log(error.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, error.message);
        }
    },

    /**
     * @private
     * 预加载 TTS 音频文件并设置为可播放状态。
     * @param {string} audioUrl - 从 TTS API 获取的音频 URL。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 与此 TTS 请求关联的唯一 ID。
     * @returns {Promise<void>}
     */
    _preloadAndSetAudio: async function(audioUrl, parentContainer, ttsId) {
        try {
            Utils.log(`MessageTtsHandler: 正在为 ttsId ${ttsId} 预加载来自 ${audioUrl} 的 TTS 音频`, Utils.logLevels.DEBUG);
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
                const errorText = await audioResponse.text().catch(() => "无法读取错误响应体");
                throw new Error(`获取 TTS 音频失败。状态: ${audioResponse.status}。URL: ${audioUrl}。响应: ${errorText.substring(0,100)}`);
            }
            const audioBlob = await audioResponse.blob();
            if (audioBlob.size === 0) throw new Error(`获取 TTS 失败: 收到空的 blob。URL: ${audioUrl}`);
            const preloadedAudioObjectURL = URL.createObjectURL(audioBlob);
            Utils.log(`MessageTtsHandler: ttsId ${ttsId} 的 TTS 音频已预加载。Object URL: ${preloadedAudioObjectURL}`, Utils.logLevels.DEBUG);
            this.updateTtsControlToPlay(parentContainer, ttsId, preloadedAudioObjectURL);
        } catch (preloadError) {
            Utils.log(`预加载 ttsId ${ttsId} 的 TTS 音频时出错 (URL: ${audioUrl}): ${preloadError.message}`, Utils.logLevels.ERROR);
            if (Utils.logLevel <= Utils.logLevels.DEBUG && preloadError.stack) Utils.log(preloadError.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, "音频加载失败");
        }
    },

    /**
     * 将 TTS 控件更新为播放按钮。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 关联的 TTS ID。
     * @param {string} audioUrl - 预加载的音频 Object URL。
     */
    updateTtsControlToPlay: function (parentContainer, ttsId, audioUrl) {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = ''; // 清空加载图标
            const playButton = document.createElement('button');
            playButton.className = 'tts-play-button';
            playButton.dataset.audioUrl = audioUrl;
            playButton.title = "播放/暂停语音";
            playButton.onclick = (e) => { e.stopPropagation(); this.playTtsAudioFromControl(playButton); };
            ttsControlContainer.appendChild(playButton);
        }
    },

    /**
     * 处理播放/暂停 TTS 音频的点击事件。
     * @param {HTMLElement} buttonElement - 被点击的播放按钮。
     */
    playTtsAudioFromControl: function (buttonElement) {
        const audioUrl = buttonElement.dataset.audioUrl;
        if (!audioUrl) return;

        const revokeCurrentAudioObjectURL = (audioInstance) => {
            if (audioInstance && audioInstance.src && audioInstance.src.startsWith('blob:') && audioInstance.dataset.managedObjectURL === 'true') {
                URL.revokeObjectURL(audioInstance.src);
                Utils.log(`已撤销 object URL: ${audioInstance.src}`, Utils.logLevels.DEBUG);
                delete audioInstance.dataset.managedObjectURL;
            }
        };

        // 如果点击的是当前正在播放的音频
        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) {
                this._currentlyPlayingTtsAudio.play().catch(e => Utils.log("恢复播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR));
                buttonElement.classList.add('playing');
            } else {
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing');
            }
        } else {
            // 停止上一个正在播放的音频
            if (this._currentlyPlayingTtsAudio) {
                this._currentlyPlayingTtsAudio.pause();
                revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                if (this._currentlyPlayingTtsButton) this._currentlyPlayingTtsButton.classList.remove('playing');
            }
            // 创建并播放新的音频
            this._currentlyPlayingTtsAudio = new Audio(audioUrl);
            this._currentlyPlayingTtsButton = buttonElement;
            if (audioUrl.startsWith('blob:')) this._currentlyPlayingTtsAudio.dataset.managedObjectURL = 'true';

            this._currentlyPlayingTtsAudio.play().then(() => buttonElement.classList.add('playing'))
                .catch(e => {
                    Utils.log("播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR);
                    buttonElement.classList.remove('playing');
                    buttonElement.innerHTML = '⚠️'; buttonElement.title = "初始化音频时出错";
                    setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音"; } }, 2000);
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                });
            // 播放结束时的清理
            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                }
            };
            // 播放错误时的处理
            this._currentlyPlayingTtsAudio.onerror = (event) => {
                Utils.log(`TTS 音频播放期间出错: ${event.target.error ? event.target.error.message : "未知错误"}`, Utils.logLevels.ERROR);
                buttonElement.classList.remove('playing');
                buttonElement.innerHTML = '⚠️'; buttonElement.title = "播放音频时出错";
                setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音"; } }, 2000);
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                }
            };
        }
    },

    /**
     * 将 TTS 控件更新为错误/重试状态。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 关联的 TTS ID。
     * @param {string} [errorMessage="TTS 失败"] - 要显示的错误信息。
     */
    updateTtsControlToError: function (parentContainer, ttsId, errorMessage = "TTS 失败") {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = '';
            const errorButton = document.createElement('button');
            errorButton.className = 'tts-retry-button';
            errorButton.textContent = '⚠️';
            errorButton.title = `TTS 错误: ${errorMessage.substring(0,100)}。点击重试。`;

            // 点击重试按钮时，重新请求 TTS
            errorButton.onclick = (e) => {
                e.stopPropagation();
                const messageElement = parentContainer.closest('.message');
                if (!messageElement) {
                    Utils.log("无法找到 TTS 重试的父消息元素。", Utils.logLevels.ERROR);
                    return;
                }
                const senderId = messageElement.dataset.senderId;
                const contact = UserManager.contacts[senderId];
                const messageContentElement = messageElement.querySelector('.message-content');
                if (!contact || !contact.isAI || !contact.aiConfig || !contact.aiConfig.tts) {
                    Utils.log(`无法重试 TTS: 未找到联系人 ${senderId} 或 TTS 配置。`, Utils.logLevels.ERROR);
                    NotificationManager.showNotification("无法重试 TTS: 缺少配置。", "error");
                    return;
                }
                if (!messageContentElement) {
                    Utils.log("无法重试 TTS: 未找到消息内容元素。", Utils.logLevels.ERROR);
                    NotificationManager.showNotification("无法重试 TTS: 缺少消息内容。", "error");
                    return;
                }
                const rawText = messageContentElement.textContent;
                const cleanedText = this.cleanTextForTts(rawText);
                const currentTtsConfig = contact.aiConfig.tts;
                if (cleanedText && currentTtsConfig) {
                    Utils.log(`正在为 ttsId ${ttsId} 重试 TTS。清理后的文本: "${cleanedText.substring(0,50)}..."`, Utils.logLevels.INFO);
                    this.addTtsPlaceholder(parentContainer, ttsId);
                    this.requestTtsForMessage(cleanedText, currentTtsConfig, parentContainer, ttsId);
                } else {
                    Utils.log(`无法为 ttsId ${ttsId} 重试 TTS: 清理后的文本或 TTS 配置为空。`, Utils.logLevels.WARN);
                    NotificationManager.showNotification("无法重试 TTS: 缺少必要数据。", "error");
                }
            };
            ttsControlContainer.appendChild(errorButton);
        }
    }
};