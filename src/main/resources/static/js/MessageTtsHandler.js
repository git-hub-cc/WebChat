/**
 * @file MessageTtsHandler.js
 * @description 文本转语音 (TTS) 处理器，负责处理 AI 消息的语音合成功能。
 *              包括清理文本、向 TTS API 发送请求、处理响应以及管理消息中的播放控件 UI。
 *              现在实现了 TTS 音频的 IndexedDB 缓存。
 *              更新：cleanTextForTts 现在仅保留中日韩字符、拉丁字母、数字、中英文逗号句号，其他标点替换为英文逗号。
 *              修复：TTS 音频现在缓存于 IndexedDB，播放时通过 Object URL 加载，以优化性能和管理。
 * @module MessageTtsHandler
 * @exports {object} MessageTtsHandler - 对外暴露的单例对象，包含所有 TTS 相关处理方法。
 * @property {function} requestTtsForMessage - 为指定消息文本请求 TTS 音频。
 * @property {function} playTtsAudioFromControl - 处理播放/暂停 TTS 音调的点击事件。
 * @property {function} addTtsPlaceholder - 在消息中添加一个加载中的占位符。
 * @dependencies Config, Utils, UserManager, NotificationUIManager, AiApiHandler, DBManager
 * @dependents MessageManager (当 AI 消息完成时调用)
 */
const MessageTtsHandler = {
    _currentlyPlayingTtsAudio: null,
    _currentlyPlayingTtsButton: null,
    _TTS_CACHE_STORE_NAME: 'ttsCache',

    /**
     * 清理文本，以适应TTS。
     * 规则：
     * 1. 移除 Markdown 风格的强调、各类括号及其内容。
     * 2. 保留中日韩字符 (Unicode ranges: \u4e00-\u9fff, \u3040-\u309f, \u30a0-\u30ff, \uff65-\uff9f, \uac00-\ud7af)。
     * 3. 保留拉丁字母 (a-zA-Z) 和数字 (0-9)。
     * 4. 保留英文逗号 (,), 英文句号 (.), 中文逗号 (，), 中文句号 (。)。
     * 5. 其他所有标点符号都替换为英文逗号 (,).
     * 6. 移除所有非上述保留或转换的字符（例如，表情符号等）。
     * 7. 对逗号和句号进行规范化处理。
     * @param {string} text - 原始消息文本。
     * @returns {string} - 清理后的纯文本。
     */
    cleanTextForTts: function (text) {
        if (typeof text !== 'string') return '';
        let cleanedText = text;

        // 1. Remove Markdown-style emphasis, and various bracketed/parenthesized content
        cleanedText = cleanedText.replace(/\*.*?\*/g, '');
        cleanedText = cleanedText.replace(/【.*?】/g, ''); // Chinese square brackets
        cleanedText = cleanedText.replace(/\[.*?\\]/g, ''); // Square brackets
        cleanedText = cleanedText.replace(/\(.*?\)/g, ''); // Parentheses
        cleanedText = cleanedText.replace(/（.*?）/g, ''); // Full-width parentheses

        // 2. Define characters to keep as is, and punctuation to convert to an English comma
        // Keep: CJK characters, Latin letters (a-zA-Z), Digits (0-9),
        // English comma, English period, Chinese comma (，), Chinese period (。)
        const keepCharsRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7afa-zA-Z0-9,.\uff0c\uff0e]/u;

        // Punctuation to convert to an English comma (,)
        const convertToCommaPunctuationRegex = /[!?"#$%&'()*+\-\/:;<=>@[\\\]^_`{|}~\u3001\uff01\uff1f\uff1b\uff1a\u2013\u2014\u2026「」『』《》〈〉·～]/gu;

        let resultBuilder = "";
        for (let i = 0; i < cleanedText.length; i++) {
            const char = cleanedText[i];
            if (keepCharsRegex.test(char)) {
                resultBuilder += char;
            } else if (convertToCommaPunctuationRegex.test(char)) {
                resultBuilder += ",";
            }
            // Characters not matching either regex (e.g., emojis, other symbols not in convertToComma) are dropped.
        }
        cleanedText = resultBuilder;

        // 3. Normalize all kept Chinese commas (，) to English commas (,)
        //    and all kept Chinese periods (。) to English periods (.)
        cleanedText = cleanedText.replace(/\uff0c/g, '，'); // ， to ，
        cleanedText = cleanedText.replace(/\uff0e/g, '。'); // 。 to 。

        // 4. Consolidate multiple commas into a single English comma,
        //    and multiple periods into a single English period.
        cleanedText = cleanedText.replace(/,{2,}/g, '，');
        cleanedText = cleanedText.replace(/\.{2,}/g, '。');

        // 5. Handle mixed sequences like ",." or ".,". Generally, a period is a stronger separator.
        //    Remove commas if they are directly adjacent to a period.
        cleanedText = cleanedText.replace(/,\./g, '。'); // Sequence ",." becomes "."
        cleanedText = cleanedText.replace(/\.,/g, '。'); // Sequence ".," becomes "."

        // 6. Remove any leading or trailing commas or periods that might exist after processing.
        cleanedText = cleanedText.replace(/^[,.]+/, '');
        cleanedText = cleanedText.replace(/[,.]+$/, '');

        // 7. Ensure a space around Latin words/numbers if they are adjacent to CJK characters
        // or punctuation (comma/period), to improve TTS readability.
        // This is a common pattern that helps TTS engines.
        // Example: "你好world" -> "你好 world", "world你好" -> "world 你好"
        // "数字123你好" -> "数字123 你好", "你好123" -> "你好 123"
        // "你好,world" -> "你好, world" (no, comma is fine)
        // "world.你好" -> "world. 你好" (no, period is fine)

        // Add space after CJK if followed by Latin/Number, unless already a space or punctuation
        cleanedText = cleanedText.replace(/([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7af])([a-zA-Z0-9])(?![,\s.])/gu, '$1 $2');
        // Add space before CJK if preceded by Latin/Number, unless already a space or punctuation
        cleanedText = cleanedText.replace(/([a-zA-Z0-9])([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7af])(?<![,\s.])/gu, '$1 $2');

        // Normalize multiple spaces that might have been introduced or existed.
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

        return cleanedText;
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
     * @private
     * 生成 TTS 请求的缓存键。
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
            // Fallback to a simpler, less robust key if crypto fails (should not happen in modern browsers)
            return `tts_fallback_${encodeURIComponent(payload.text)}_${encodeURIComponent(payload.model_name || 'default_model')}`;
        }
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
            version: apiVersion, sample_steps: ttsConfig.sample_steps !== undefined ? ttsConfig.sample_steps : 16,
            if_sr: ttsConfig.if_sr !== undefined ? ttsConfig.if_sr : false, model_name: ttsConfig.model_name,
            speaker_name: ttsConfig.speaker_name, prompt_text_lang: ttsConfig.prompt_text_lang || "中文",
            emotion: ttsConfig.emotion || "默认", text: text, text_lang: ttsConfig.text_lang || "中文",
            top_k: ttsConfig.top_k || 10, top_p: ttsConfig.top_p || 1, temperature: ttsConfig.temperature || 1,
            text_split_method: ttsConfig.text_split_method || "按标点符号切", batch_size: ttsConfig.batch_size || 10,
            batch_threshold: ttsConfig.batch_threshold || 0.75, split_bucket: ttsConfig.split_bucket === undefined ? true : ttsConfig.split_bucket,
            speed_facter: ttsConfig.speed_facter || 1, fragment_interval: ttsConfig.fragment_interval || 0.3,
            media_type: ttsConfig.media_type || "wav", parallel_infer: ttsConfig.parallel_infer === undefined ? true : ttsConfig.parallel_infer,
            repetition_penalty: ttsConfig.repetition_penalty || 1.35, seed: ttsConfig.seed === undefined ? -1 : ttsConfig.seed,
        };
        if (ttsConfig.speaker_name === undefined && ttsConfig.tts_mode === 'Dynamic') {
            // Potentially remove payload.speaker_name if not needed and undefined, but ensure API compatibility
        }

        Utils.log(`MessageTtsHandler: TTS 请求。端点='${currentTtsApiEndpoint}', ttsId 为 ${ttsId}`, Utils.logLevels.DEBUG);
        // Utils.log(`MessageTtsHandler: TTS 请求体: ${JSON.stringify(payload)}`, Utils.logLevels.DEBUG);

        const cacheKey = await this._generateCacheKey(payload);
        Utils.log(`MessageTtsHandler: TTS 缓存键 (ttsId ${ttsId}): ${cacheKey}`, Utils.logLevels.DEBUG);

        try {
            // 1. Check cache
            const cachedItem = await DBManager.getItem(this._TTS_CACHE_STORE_NAME, cacheKey);
            if (cachedItem && cachedItem.audioBlob instanceof Blob && cachedItem.audioBlob.size > 0) {
                Utils.log(`TTS Cache HIT for key ${cacheKey} (ttsId ${ttsId}). Using cached audio.`, Utils.logLevels.INFO);
                this.updateTtsControlToPlay(parentContainer, ttsId, cacheKey);
                return;
            }
            Utils.log(`TTS Cache MISS for key ${cacheKey} (ttsId ${ttsId}). Fetching from API.`, Utils.logLevels.DEBUG);

            // 2. If cache miss, fetch from API
            const headers = {
                'Content-Type': 'application/json', 'Authorization': 'Bearer guest', 'Referer': 'https://tts.acgnai.top/',
                'sec-ch-ua-platform': '"Windows"', 'sec-ch-ua': navigator.userAgentData ? navigator.userAgentData.brands.map(b => `"${b.brand}";v="${b.version}"`).join(", ") : '"Chromium";v="100", "Google Chrome";v="100"',
                'sec-ch-ua-mobile': '?0', 'User-Agent': navigator.userAgent, 'Accept': 'application/json, text/plain, */*', 'DNT': '1'
            };

            const response = await fetch(currentTtsApiEndpoint, {
                method: 'POST', headers: headers, body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`TTS API 请求失败，状态码 ${response.status}: ${errorData.substring(0,150)}`);
            }
            const result = await response.json();

            if (result.audio_url) {
                // 3. Fetch the audio blob from the URL provided by the API
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

                // 4. Store in cache
                Utils.log(`MessageTtsHandler: Caching audio blob for key ${cacheKey} (ttsId ${ttsId}), size: ${audioBlob.size}`, Utils.logLevels.DEBUG);
                await DBManager.setItem(this._TTS_CACHE_STORE_NAME, { id: cacheKey, audioBlob: audioBlob });

                // 5. Update UI to play using cacheKey
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
     * 将 TTS 控件更新为播放按钮。
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
            playButton.dataset.cacheKey = cacheKey; // Store cache key
            playButton.title = "播放/暂停语音";
            playButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.playTtsAudioFromControl(playButton);
            });
            ttsControlContainer.appendChild(playButton);
        }
    },

    /**
     * 处理播放/暂停 TTS 音频的点击事件。
     * @param {HTMLElement} buttonElement - 被点击的播放按钮。
     */
    playTtsAudioFromControl: async function (buttonElement) {
        const cacheKey = buttonElement.dataset.cacheKey;
        if (!cacheKey) {
            Utils.log("TTS Playback: Cache key not found on button.", Utils.logLevels.WARN);
            return;
        }

        // If this button is already playing and we click it again (toggle pause/play)
        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) {
                this._currentlyPlayingTtsAudio.play().catch(e => {
                    Utils.log("恢复播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR);
                    // UI update for error can be added here if needed
                });
                buttonElement.classList.add('playing');
            } else {
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing');
            }
            return;
        }

        // Stop and clean up any currently playing audio
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

        // Fetch audio from DB
        try {
            const cachedItem = await DBManager.getItem(this._TTS_CACHE_STORE_NAME, cacheKey);
            if (!cachedItem || !cachedItem.audioBlob || !(cachedItem.audioBlob instanceof Blob) || cachedItem.audioBlob.size === 0) {
                Utils.log(`TTS Playback: Audio blob not found or invalid in cache for key ${cacheKey}.`, Utils.logLevels.ERROR);
                buttonElement.innerHTML = '💾'; // Icon for cache miss / DB error
                buttonElement.title = "音频缓存未找到或无效，请尝试重试TTS生成。";
                // Consider adding a retry mechanism or more specific error UI
                setTimeout(() => {
                    if (buttonElement.innerHTML === '💾') {
                        buttonElement.innerHTML = '';
                        buttonElement.title = "播放/暂停语音";
                    }
                }, 3000);
                return;
            }

            const audioBlob = cachedItem.audioBlob;
            const objectURL = URL.createObjectURL(audioBlob);
            buttonElement.dataset.objectUrl = objectURL; // Store for revocation

            this._currentlyPlayingTtsAudio = new Audio(objectURL);
            this._currentlyPlayingTtsButton = buttonElement;

            this._currentlyPlayingTtsAudio.play()
                .then(() => {
                    buttonElement.classList.add('playing');
                })
                .catch(e => {
                    Utils.log("播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR);
                    buttonElement.classList.remove('playing');
                    buttonElement.innerHTML = '⚠️'; buttonElement.title = "初始化音频时出错";
                    setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音"; } }, 2000);

                    URL.revokeObjectURL(objectURL);
                    delete buttonElement.dataset.objectUrl;
                    if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                        this._currentlyPlayingTtsAudio = null;
                        this._currentlyPlayingTtsButton = null;
                    }
                });

            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                URL.revokeObjectURL(objectURL);
                delete buttonElement.dataset.objectUrl;
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    this._currentlyPlayingTtsAudio = null;
                    this._currentlyPlayingTtsButton = null;
                }
            };

            this._currentlyPlayingTtsAudio.onerror = (event) => {
                Utils.log(`TTS 音频播放期间出错: ${event.target.error ? event.target.error.message : "未知错误"}`, Utils.logLevels.ERROR);
                buttonElement.classList.remove('playing');
                buttonElement.innerHTML = '⚠️'; buttonElement.title = "播放音频时出错";
                setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音"; } }, 2000);

                URL.revokeObjectURL(objectURL);
                delete buttonElement.dataset.objectUrl;
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    this._currentlyPlayingTtsAudio = null;
                    this._currentlyPlayingTtsButton = null;
                }
            };

        } catch (dbError) {
            Utils.log(`TTS Playback: Error fetching audio from DB for key ${cacheKey}: ${dbError}`, Utils.logLevels.ERROR);
            buttonElement.innerHTML = '⚠️'; buttonElement.title = "读取音频缓存失败";
            setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音"; } }, 2000);
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
                    Utils.log(`无法重试 TTS: 未找到联系人 ${senderId} 或 TTS 配置。`, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少配置。", "error");
                    return;
                }
                if (!messageContentElement) {
                    Utils.log("无法重试 TTS: 未找到消息内容元素。", Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少消息内容。", "error");
                    return;
                }
                // It's important that the retry logic correctly identifies the original text and ttsConfig
                // For simplicity, we assume the original text is still available.
                // If the message content was modified (e.g. by Markdown rendering), this might need adjustment.
                // Assuming messageContentElement.textContent provides the source text for TTS.
                const rawText = messageContentElement.textContent; // Or however the original text for TTS is obtained
                const cleanedText = this.cleanTextForTts(rawText);
                const currentTtsConfig = contact.aiConfig.tts;
                if (cleanedText && currentTtsConfig) {
                    Utils.log(`正在为 ttsId ${ttsId} 重试 TTS。清理后的文本: "${cleanedText.substring(0,50)}..."`, Utils.logLevels.INFO);
                    this.addTtsPlaceholder(parentContainer, ttsId); // Show loading spinner again
                    this.requestTtsForMessage(cleanedText, currentTtsConfig, parentContainer, ttsId);
                } else {
                    Utils.log(`无法为 ttsId ${ttsId} 重试 TTS: 清理后的文本或 TTS 配置为空。`, Utils.logLevels.WARN);
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少必要数据。", "error");
                }
            });
            ttsControlContainer.appendChild(errorButton);
        }
    }
};