/**
 * @file 文本转语音 (TTS) 处理器
 * @description 负责处理 AI 消息的语音合成功能。包括清理文本、向 TTS API 发送请求、处理响应以及管理消息中的播放控件 UI。
 *              实现了 TTS 音频的 IndexedDB 缓存，以优化性能和管理。
 * @module TtsApiHandler
 * @exports {object} TtsApiHandler - 对外暴露的单例对象，包含所有 TTS 相关处理方法。
 * @dependency AppSettings, Utils, UserManager, NotificationUIManager, AiApiHandler, DBManager
 * @dependents MessageManager (当 AI 消息完成时调用)
 */
const TtsApiHandler = {
    // 缓存当前正在播放的 Audio 对象
    _currentlyPlayingTtsAudio: null,
    // 缓存当前正在播放的音频对应的播放按钮
    _currentlyPlayingTtsButton: null,
    // IndexedDB 缓存对象存储的名称
    _TTS_CACHE_STORE_NAME: 'ttsCache',

    // =========================================================================
    //                            公开方法 (Public Methods)
    // =========================================================================

    /**
     * 清理文本以适应 TTS 服务，移除不必要的字符和格式。
     * @function cleanTextForTts
     * @param {string} text - 原始消息文本。
     * @returns {string} - 清理后的纯文本。
     * @example cleanTextForTts("你好呀！【开心】*今天*天气不错。") // "你好呀，今天天气不错。"
     */
    cleanTextForTts: function (text) {
        if (typeof text !== 'string') return '';
        let cleanedText = text;

        // 处理流程如下：
        // 1. 移除 Markdown 风格的强调、各类括号及其内容。
        cleanedText = cleanedText.replace(/\*.*?\*/g, '');
        cleanedText = cleanedText.replace(/【.*?】/g, '');
        cleanedText = cleanedText.replace(/\[.*?\\]/g, '');
        cleanedText = cleanedText.replace(/\(.*?\)/g, '');
        cleanedText = cleanedText.replace(/（.*?）/g, '');

        // 2. 定义保留字符和需要转换的标点符号。
        const keepCharsRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7afa-zA-Z0-9,.\uff0c\uff0e]/u;
        const convertToCommaPunctuationRegex = /[!?"#$%&'()*+\-\/:;<=>@[\\\]^_`{|}~\u3001\uff01\uff1f\uff1b\uff1a\u2013\u2014\u2026「」『』《》〈〉·～]/gu;

        // 3. 遍历字符串，构建清理后的文本。
        let resultBuilder = "";
        for (let i = 0; i < cleanedText.length; i++) {
            const char = cleanedText[i];
            if (keepCharsRegex.test(char)) {
                resultBuilder += char;
            } else if (convertToCommaPunctuationRegex.test(char)) {
                resultBuilder += ",";
            }
        }
        cleanedText = resultBuilder;

        // 4. 规范化逗号和句号。
        cleanedText = cleanedText.replace(/\uff0c/g, '，');
        cleanedText = cleanedText.replace(/\uff0e/g, '。');
        cleanedText = cleanedText.replace(/,{2,}/g, '，');
        cleanedText = cleanedText.replace(/\.{2,}/g, '。');
        cleanedText = cleanedText.replace(/,\./g, '。');
        cleanedText = cleanedText.replace(/\.,/g, '。');

        // 5. 移除首尾可能存在的逗号或句号。
        cleanedText = cleanedText.replace(/^[,.]+/, '');
        cleanedText = cleanedText.replace(/[,.]+$/, '');

        // 6. 在中日韩字符与拉丁字母/数字之间添加空格，以改善TTS的可读性。
        cleanedText = cleanedText.replace(/([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7af])([a-zA-Z0-9])(?![,\s.])/gu, '$1 $2');
        cleanedText = cleanedText.replace(/([a-zA-Z0-9])([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7af])(?<![,\s.])/gu, '$1 $2');

        // 7. 规范化可能引入或已存在的多个空格。
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

        return cleanedText;
    },

    /**
     * 在消息 UI 中添加一个加载中的占位符（旋转图标）。
     * @function addTtsPlaceholder
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
     * @function requestTtsForMessage
     * @param {string} text - 清理后的消息文本。
     * @param {object} ttsConfig - 该 AI 角色的 TTS 配置。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 与此 TTS 请求关联的唯一 ID。
     * @returns {Promise<void>}
     */
    requestTtsForMessage: async function (text, ttsConfig, parentContainer, ttsId) {
        // 处理流程如下：
        // 1. 获取生效的 TTS API 端点配置。
        // 2. 根据 TTS 配置和文本内容，生成一个唯一的缓存键 (SHA-256哈希)。
        // 3. 检查 IndexedDB 中是否存在该缓存键对应的音频。
        //    3a. 如果缓存命中，则直接使用缓存的音频 Blob，并更新 UI 为可播放状态。
        //    3b. 如果缓存未命中，则继续下一步。
        // 4. 向 TTS API 发送请求。
        // 5. 获取 API 响应中的音频 URL，并下载音频 Blob。
        // 6. 将下载的音频 Blob 存入 IndexedDB 缓存。
        // 7. 更新 UI 为可播放状态。
        // 8. 处理所有过程中的错误，并更新 UI 为错误状态。
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig();
        const baseTtsApiEndpoint = effectiveConfig.ttsApiEndpoint;

        if (!baseTtsApiEndpoint) {
            Utils.log("TTS 未触发: TTS API 端点未配置。", Utils.logLevels.WARN);
            this.updateTtsControlToError(parentContainer, ttsId, "TTS 端点未配置");
            return;
        }
        const currentTtsApiEndpoint = baseTtsApiEndpoint.endsWith('/') ? baseTtsApiEndpoint + 'infer_single' : baseTtsApiEndpoint + '/infer_single';
        const apiVersion = ttsConfig.version || 'v4';

        const payload = {
            version: apiVersion,
            sample_steps: ttsConfig.sample_steps !== undefined ? ttsConfig.sample_steps : 16,
            if_sr: ttsConfig.if_sr !== undefined ? ttsConfig.if_sr : false,
            model_name: ttsConfig.model_name,
            speaker_name: ttsConfig.speaker_name,
            prompt_text_lang: ttsConfig.prompt_text_lang || "中文",
            emotion: ttsConfig.emotion || "默认",
            text: text,
            text_lang: ttsConfig.text_lang || "中文",
            top_k: ttsConfig.top_k || 10,
            top_p: ttsConfig.top_p || 1,
            temperature: ttsConfig.temperature || 1,
            text_split_method: ttsConfig.text_split_method || "按标点符号切",
            batch_size: ttsConfig.batch_size || 10,
            batch_threshold: ttsConfig.batch_threshold || 0.75,
            split_bucket: ttsConfig.split_bucket === undefined ? true : ttsConfig.split_bucket,
            speed_facter: ttsConfig.speed_facter || 1,
            fragment_interval: ttsConfig.fragment_interval || 0.3,
            media_type: ttsConfig.media_type || "wav",
            parallel_infer: ttsConfig.parallel_infer === undefined ? true : ttsConfig.parallel_infer,
            repetition_penalty: ttsConfig.repetition_penalty || 1.35,
            seed: ttsConfig.seed === undefined ? -1 : ttsConfig.seed,
        };

        Utils.log(`MessageTtsHandler: TTS 请求。端点='${currentTtsApiEndpoint}', ttsId 为 ${ttsId}`, Utils.logLevels.DEBUG);
        const cacheKey = await this._generateCacheKey(payload);
        Utils.log(`MessageTtsHandler: TTS 缓存键 (ttsId ${ttsId}): ${cacheKey}`, Utils.logLevels.DEBUG);

        try {
            const cachedItem = await DBManager.getItem(this._TTS_CACHE_STORE_NAME, cacheKey);
            if (cachedItem && cachedItem.audioBlob instanceof Blob && cachedItem.audioBlob.size > 0) {
                Utils.log(`TTS Cache HIT for key ${cacheKey} (ttsId ${ttsId}). Using cached audio.`, Utils.logLevels.INFO);
                this.updateTtsControlToPlay(parentContainer, ttsId, cacheKey);
                return;
            }
            Utils.log(`TTS Cache MISS for key ${cacheKey} (ttsId ${ttsId}). Fetching from API.`, Utils.logLevels.DEBUG);

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer guest',
                'Referer': 'https://tts.acgnai.top/',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua': navigator.userAgentData ? navigator.userAgentData.brands.map(b => `"${b.brand}";v="${b.version}"`).join(", ") : '"Chromium";v="100", "Google Chrome";v="100"',
                'sec-ch-ua-mobile': '?0',
                'User-Agent': navigator.userAgent,
                'Accept': 'application/json, text/plain, */*',
                'DNT': '1'
            };

            const response = await fetch(currentTtsApiEndpoint, { method: 'POST', headers: headers, body: JSON.stringify(payload) });

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`TTS API 请求失败，状态码 ${response.status}: ${errorData.substring(0,150)}`);
            }
            const result = await response.json();

            if (result.audio_url) {
                Utils.log(`MessageTtsHandler: Fetching audio blob for ttsId ${ttsId} from ${result.audio_url}`, Utils.logLevels.DEBUG);
                const audioResponse = await fetch(result.audio_url);
                if (!audioResponse.ok) {
                    const errorText = await audioResponse.text().catch(() => "无法读取错误响应体");
                    throw new Error(`获取 TTS 音频失败。状态: ${audioResponse.status}。URL: ${result.audio_url}。响应: ${errorText.substring(0,100)}`);
                }
                const audioBlob = await audioResponse.blob();
                if (audioBlob.size === 0) {
                    throw new Error(`获取 TTS 失败: 收到空的 blob。URL: ${result.audio_url}`);
                }

                Utils.log(`MessageTtsHandler: Caching audio blob for key ${cacheKey} (ttsId ${ttsId}), size: ${audioBlob.size}`, Utils.logLevels.DEBUG);
                await DBManager.setItem(this._TTS_CACHE_STORE_NAME, { id: cacheKey, audioBlob: audioBlob });

                this.updateTtsControlToPlay(parentContainer, ttsId, cacheKey);
            } else {
                throw new Error(`TTS API 响应缺少 audio_url。消息: ${result.msg || '未知错误'}`);
            }
        } catch (error) {
            Utils.log(`处理 ttsId ${ttsId} 的 TTS 时出错 (CacheKey: ${cacheKey}): ${error.message}`, Utils.logLevels.ERROR);
            if (Utils.currentLogLevel <= Utils.logLevels.DEBUG && error.stack) Utils.log(error.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, error.message);
        }
    },

    /**
     * 处理播放/暂停 TTS 音频的点击事件。
     * @function playTtsAudioFromControl
     * @param {HTMLElement} buttonElement - 被点击的播放按钮。
     */
    playTtsAudioFromControl: async function (buttonElement) {
        // 处理流程如下:
        // 1. 从按钮的 dataset 中获取音频的缓存键。
        // 2. 如果当前点击的按钮已经在播放，则切换播放/暂停状态。
        // 3. 如果有其他音频正在播放，则停止它，并释放相关的 Object URL 资源。
        // 4. 从 IndexedDB 中获取音频 Blob。
        // 5. 创建一个新的 Object URL，并用它创建一个新的 Audio 对象。
        // 6. 播放音频，并处理播放成功/失败/结束的事件，在事件回调中正确管理UI状态和释放 Object URL。
        const cacheKey = buttonElement.dataset.cacheKey;
        if (!cacheKey) {
            Utils.log("TTS Playback: Cache key not found on button.", Utils.logLevels.WARN);
            return;
        }

        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) {
                this._currentlyPlayingTtsAudio.play().catch(e => Utils.log("恢复播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR));
                buttonElement.classList.add('playing');
            } else {
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing');
            }
            return;
        }

        if (this._currentlyPlayingTtsAudio) {
            this._currentlyPlayingTtsAudio.pause();
            if (this._currentlyPlayingTtsButton && this._currentlyPlayingTtsButton.dataset.objectUrl) {
                URL.revokeObjectURL(this._currentlyPlayingTtsButton.dataset.objectUrl);
                delete this._currentlyPlayingTtsButton.dataset.objectUrl;
            }
            if (this._currentlyPlayingTtsButton) {
                this._currentlyPlayingTtsButton.classList.remove('playing');
            }
        }
        this._currentlyPlayingTtsAudio = null;
        this._currentlyPlayingTtsButton = null;

        try {
            const cachedItem = await DBManager.getItem(this._TTS_CACHE_STORE_NAME, cacheKey);
            if (!cachedItem || !cachedItem.audioBlob || !(cachedItem.audioBlob instanceof Blob) || cachedItem.audioBlob.size === 0) {
                throw new Error("音频缓存未找到或无效。");
            }

            const audioBlob = cachedItem.audioBlob;
            const objectURL = URL.createObjectURL(audioBlob);
            buttonElement.dataset.objectUrl = objectURL;

            this._currentlyPlayingTtsAudio = new Audio(objectURL);
            this._currentlyPlayingTtsButton = buttonElement;

            this._currentlyPlayingTtsAudio.play()
                .then(() => buttonElement.classList.add('playing'))
                .catch(e => {
                    Utils.log("播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR);
                    buttonElement.classList.remove('playing');
                    buttonElement.innerHTML = '⚠️';
                    URL.revokeObjectURL(objectURL);
                    delete buttonElement.dataset.objectUrl;
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                });

            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                URL.revokeObjectURL(objectURL);
                delete buttonElement.dataset.objectUrl;
                if (this._currentlyPlayingTtsButton === buttonElement) {
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                }
            };

            this._currentlyPlayingTtsAudio.onerror = (event) => {
                Utils.log(`TTS 音频播放期间出错: ${event.target.error ? event.target.error.message : "未知错误"}`, Utils.logLevels.ERROR);
                buttonElement.classList.remove('playing');
                URL.revokeObjectURL(objectURL);
                delete buttonElement.dataset.objectUrl;
            };

        } catch (error) {
            Utils.log(`TTS Playback: 播放音频时出错 (key ${cacheKey}): ${error}`, Utils.logLevels.ERROR);
            buttonElement.innerHTML = '⚠️';
            buttonElement.title = `播放失败: ${error.message}`;
            setTimeout(() => {
                if (buttonElement.innerHTML === '⚠️') {
                    buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音";
                }
            }, 3000);
        }
    },

    // =========================================================================
    //                            内部工具方法 (Internal Utilities)
    // =========================================================================

    /**
     * 生成 TTS 请求的缓存键 (SHA-256哈希)。
     * @private
     * @param {object} payload - 用于 TTS API 请求的负载对象。
     * @returns {Promise<string>} - SHA-256 哈希字符串。
     */
    _generateCacheKey: async function(payload) {
        try {
            const payloadString = JSON.stringify(payload);
            const encoder = new TextEncoder();
            const data = encoder.encode(payloadString);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            Utils.log(`生成 TTS 缓存键失败: ${error}`, Utils.logLevels.ERROR);
            return `tts_fallback_${encodeURIComponent(payload.text)}_${encodeURIComponent(payload.model_name || 'default_model')}`;
        }
    },

    /**
     * 将 TTS 控件更新为播放按钮。
     * @private
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 关联的 TTS ID。
     * @param {string} cacheKey - 用于从 IndexedDB 检索音频的缓存键。
     */
    updateTtsControlToPlay: function (parentContainer, ttsId, cacheKey) {
        const ttsControlContainer = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (ttsControlContainer) {
            ttsControlContainer.innerHTML = '';
            const playButton = document.createElement('button');
            playButton.className = 'tts-play-button';
            playButton.dataset.cacheKey = cacheKey;
            playButton.title = "播放/暂停语音";
            playButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.playTtsAudioFromControl(playButton);
            });
            ttsControlContainer.appendChild(playButton);
        }
    },

    /**
     * 将 TTS 控件更新为错误/重试状态。
     * @private
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
            errorButton.addEventListener('click', (e) => {
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
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少配置。", "error");
                    return;
                }
                if (!messageContentElement) {
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少消息内容。", "error");
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
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少必要数据。", "error");
                }
            });
            ttsControlContainer.appendChild(errorButton);
        }
    }
};