/**
 * @file TtsApiHandler.js
 * @description 文本转语音 (TTS) 处理器，负责处理 AI 消息的语音合成功能。
 *              包括清理文本、向 TTS API 发送请求、处理响应以及管理消息中的播放控件 UI。
 *              现在实现了 TTS 音频的 IndexedDB 缓存。
 *              更新：cleanTextForTts 现在仅保留中日韩字符、拉丁字母、数字、中英文逗号句号，其他标点替换为英文逗号。
 *              修复：TTS 音频现在缓存于 IndexedDB，播放时通过 Object URL 加载，以优化性能和管理。
 * @module MessageTtsHandler
 * @exports {object} TtsApiHandler - 对外暴露的单例对象，包含所有 TTS 相关处理方法。
 * @property {function} requestTtsForMessage - 为指定消息文本请求 TTS 音频。
 * @property {function} playTtsAudioFromControl - 处理播放/暂停 TTS 音调的点击事件。
 * @property {function} addTtsPlaceholder - 在消息中添加一个加载中的占位符。
 * @dependencies AppSettings, Utils, UserManager, NotificationUIManager, AiApiHandler, DBManager
 * @dependents MessageManager (当 AI 消息完成时调用)
 */
const TtsApiHandler = {
    _currentlyPlayingTtsAudio: null, // 当前正在播放的 Audio 对象
    _currentlyPlayingTtsButton: null, // 当前正在播放的音频对应的播放按钮
    _TTS_CACHE_STORE_NAME: 'ttsCache', // IndexedDB 缓存表名

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

        // 1. 移除 Markdown 风格的强调、各类括号及其内容
        cleanedText = cleanedText.replace(/\*.*?\*/g, ''); // 移除 *强调*
        cleanedText = cleanedText.replace(/【.*?】/g, ''); // 移除 【中文方括号】
        cleanedText = cleanedText.replace(/\[.*?\\]/g, ''); // 移除 [方括号]
        cleanedText = cleanedText.replace(/\(.*?\)/g, ''); // 移除 (圆括号)
        cleanedText = cleanedText.replace(/（.*?）/g, ''); // 移除 （全角圆括号）

        // 2. 定义保留字符和需要转换的标点符号
        // 保留: 中日韩字符, 拉丁字母, 数字, 英文逗号/句号, 中文逗号/句号
        const keepCharsRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7afa-zA-Z0-9,.\uff0c\uff0e]/u;
        // 转换为英文逗号的标点
        const convertToCommaPunctuationRegex = /[!?"#$%&'()*+\-\/:;<=>@[\\\]^_`{|}~\u3001\uff01\uff1f\uff1b\uff1a\u2013\u2014\u2026「」『』《》〈〉·～]/gu;

        let resultBuilder = ""; // 用于构建清理后的文本
        for (let i = 0; i < cleanedText.length; i++) {
            const char = cleanedText[i];
            if (keepCharsRegex.test(char)) { // 如果是保留字符
                resultBuilder += char;
            } else if (convertToCommaPunctuationRegex.test(char)) { // 如果是需要转换的标点
                resultBuilder += ","; // 替换为英文逗号
            }
            // 其他字符（如表情符号）将被丢弃
        }
        cleanedText = resultBuilder;

        // 3. 规范化逗号和句号
        cleanedText = cleanedText.replace(/\uff0c/g, '，'); // 统一中文逗号 (虽然正则已包含，确保一致性)
        cleanedText = cleanedText.replace(/\uff0e/g, '。'); // 统一中文句号

        // 4. 合并连续的逗号和句号
        cleanedText = cleanedText.replace(/,{2,}/g, '，'); // 多个逗号变一个中文逗号
        cleanedText = cleanedText.replace(/\.{2,}/g, '。'); // 多个句号变一个中文句号

        // 5. 处理逗号和句号混合的情况，句号优先
        cleanedText = cleanedText.replace(/,\./g, '。'); // ",." -> "。"
        cleanedText = cleanedText.replace(/\.,/g, '。'); // ".," -> "。"

        // 6. 移除首尾可能存在的逗号或句号
        cleanedText = cleanedText.replace(/^[,.]+/, '');
        cleanedText = cleanedText.replace(/[,.]+$/, '');

        // 7. 在中日韩字符与拉丁字母/数字之间添加空格，以改善TTS的可读性
        // CJK后跟拉丁/数字
        cleanedText = cleanedText.replace(/([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7af])([a-zA-Z0-9])(?![,\s.])/gu, '$1 $2');
        // 拉丁/数字后跟CJK
        cleanedText = cleanedText.replace(/([a-zA-Z0-9])([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\uac00-\ud7af])(?<![,\s.])/gu, '$1 $2');

        // 规范化可能引入或已存在的多个空格
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

        return cleanedText;
    },

    /**
     * 在消息 UI 中添加一个加载中的占位符（旋转图标）。
     * @param {HTMLElement} parentContainer - 消息内容的父容器元素。
     * @param {string} ttsId - 与此 TTS 请求关联的唯一 ID。
     */
    addTtsPlaceholder: function (parentContainer, ttsId) {
        // 移除可能存在的旧控件
        const existingControl = parentContainer.querySelector(`.tts-control-container[data-tts-id="${ttsId}"]`);
        if (existingControl) existingControl.remove();

        const ttsControlContainer = document.createElement('span');
        ttsControlContainer.className = 'tts-control-container';
        ttsControlContainer.dataset.ttsId = ttsId; // 存储TTS ID
        const spinner = document.createElement('span');
        spinner.className = 'tts-loading-spinner'; // 加载动画
        ttsControlContainer.appendChild(spinner);
        parentContainer.appendChild(ttsControlContainer); // 添加到父容器
    },

    /**
     * @private
     * 生成 TTS 请求的缓存键 (SHA-256哈希)。
     * @param {object} payload - 用于 TTS API 请求的负载对象。
     * @returns {Promise<string>} - SHA-256 哈希字符串。
     */
    _generateCacheKey: async function(payload) {
        try {
            const payloadString = JSON.stringify(payload); // 将负载对象转为字符串
            const encoder = new TextEncoder();
            const data = encoder.encode(payloadString); // 编码为UTF-8字节
            const hashBuffer = await crypto.subtle.digest('SHA-256', data); // 计算哈希
            const hashArray = Array.from(new Uint8Array(hashBuffer)); // 转为字节数组
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // 转为16进制字符串
        } catch (error) {
            Utils.log(`生成 TTS 缓存键失败: ${error}`, Utils.logLevels.ERROR);
            // 如果加密API失败，使用简化的回退键 (不推荐，但作为备选)
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
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig(); // 获取生效的AI配置
        const baseTtsApiEndpoint = effectiveConfig.ttsApiEndpoint; // 获取TTS API端点

        if (!baseTtsApiEndpoint) { // 如果端点未配置
            Utils.log("TTS 未触发: TTS API 端点未配置。", Utils.logLevels.WARN);
            this.updateTtsControlToError(parentContainer, ttsId, "TTS 端点未配置"); // 更新UI为错误状态
            return;
        }
        // 构建完整的TTS API URL
        const currentTtsApiEndpoint = baseTtsApiEndpoint.endsWith('/') ? baseTtsApiEndpoint + 'infer_single' : baseTtsApiEndpoint + '/infer_single';
        const apiVersion = ttsConfig.version || 'v4'; // API 版本

        // 构建请求负载
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
            top_p: ttsConfig.top_p || 1, // API文档示例为1，但通常Top P是0-1的浮点数
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
        // 根据TTS模式调整负载 (例如，动态模式下若未指定speaker_name，可能API不需要此参数)
        // if (ttsConfig.speaker_name === undefined && ttsConfig.tts_mode === 'Dynamic') {
        //     delete payload.speaker_name;
        // }

        Utils.log(`MessageTtsHandler: TTS 请求。端点='${currentTtsApiEndpoint}', ttsId 为 ${ttsId}`, Utils.logLevels.DEBUG);

        const cacheKey = await this._generateCacheKey(payload); // 生成缓存键
        Utils.log(`MessageTtsHandler: TTS 缓存键 (ttsId ${ttsId}): ${cacheKey}`, Utils.logLevels.DEBUG);

        try {
            // 1. 检查缓存
            const cachedItem = await DBManager.getItem(this._TTS_CACHE_STORE_NAME, cacheKey);
            if (cachedItem && cachedItem.audioBlob instanceof Blob && cachedItem.audioBlob.size > 0) { // 如果缓存命中且有效
                Utils.log(`TTS Cache HIT for key ${cacheKey} (ttsId ${ttsId}). Using cached audio.`, Utils.logLevels.INFO);
                this.updateTtsControlToPlay(parentContainer, ttsId, cacheKey); // 更新UI为播放状态
                return;
            }
            Utils.log(`TTS Cache MISS for key ${cacheKey} (ttsId ${ttsId}). Fetching from API.`, Utils.logLevels.DEBUG);

            // 2. 如果缓存未命中，则从API获取
            const headers = { // 构建请求头
                'Content-Type': 'application/json',
                'Authorization': 'Bearer guest', // API可能需要的认证
                'Referer': 'https://tts.acgnai.top/', // API可能需要的Referer
                'sec-ch-ua-platform': '"Windows"', // 模拟浏览器环境
                'sec-ch-ua': navigator.userAgentData ? navigator.userAgentData.brands.map(b => `"${b.brand}";v="${b.version}"`).join(", ") : '"Chromium";v="100", "Google Chrome";v="100"',
                'sec-ch-ua-mobile': '?0',
                'User-Agent': navigator.userAgent,
                'Accept': 'application/json, text/plain, */*',
                'DNT': '1' // "Do Not Track"
            };

            const response = await fetch(currentTtsApiEndpoint, { // 发送请求
                method: 'POST', headers: headers, body: JSON.stringify(payload)
            });

            if (!response.ok) { // 如果API响应不成功
                const errorData = await response.text();
                throw new Error(`TTS API 请求失败，状态码 ${response.status}: ${errorData.substring(0,150)}`);
            }
            const result = await response.json(); // 解析响应JSON

            if (result.audio_url) { // 如果响应包含音频URL
                // 3. 从API提供的URL获取音频Blob
                Utils.log(`MessageTtsHandler: Fetching audio blob for ttsId ${ttsId} from ${result.audio_url}`, Utils.logLevels.DEBUG);
                const audioResponse = await fetch(result.audio_url);
                if (!audioResponse.ok) {
                    const errorText = await audioResponse.text().catch(() => "无法读取错误响应体");
                    throw new Error(`获取 TTS 音频失败。状态: ${audioResponse.status}。URL: ${result.audio_url}。响应: ${errorText.substring(0,100)}`);
                }
                const audioBlob = await audioResponse.blob(); // 获取Blob对象
                if (audioBlob.size === 0) { // 检查Blob是否为空
                    throw new Error(`获取 TTS 失败: 收到空的 blob。URL: ${result.audio_url}`);
                }

                // 4. 存入缓存
                Utils.log(`MessageTtsHandler: Caching audio blob for key ${cacheKey} (ttsId ${ttsId}), size: ${audioBlob.size}`, Utils.logLevels.DEBUG);
                await DBManager.setItem(this._TTS_CACHE_STORE_NAME, { id: cacheKey, audioBlob: audioBlob });

                // 5. 更新UI为播放状态，使用缓存键
                this.updateTtsControlToPlay(parentContainer, ttsId, cacheKey);

            } else { // 如果API响应缺少音频URL
                throw new Error(`TTS API 响应缺少 audio_url。消息: ${result.msg || '未知错误'}`);
            }
        } catch (error) {
            Utils.log(`处理 ttsId ${ttsId} 的 TTS 时出错 (CacheKey: ${cacheKey}): ${error.message}`, Utils.logLevels.ERROR);
            if (Utils.currentLogLevel <= Utils.logLevels.DEBUG && error.stack) Utils.log(error.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, error.message); // 更新UI为错误状态
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
            ttsControlContainer.innerHTML = ''; // 清空旧控件
            const playButton = document.createElement('button');
            playButton.className = 'tts-play-button'; // 播放按钮样式
            playButton.dataset.cacheKey = cacheKey; // 存储缓存键
            playButton.title = "播放/暂停语音";
            playButton.addEventListener('click', (e) => { // 绑定点击事件
                e.stopPropagation(); // 防止事件冒泡
                this.playTtsAudioFromControl(playButton); // 调用播放逻辑
            });
            ttsControlContainer.appendChild(playButton);
        }
    },

    /**
     * 处理播放/暂停 TTS 音频的点击事件。
     * @param {HTMLElement} buttonElement - 被点击的播放按钮。
     */
    playTtsAudioFromControl: async function (buttonElement) {
        const cacheKey = buttonElement.dataset.cacheKey; // 获取缓存键
        if (!cacheKey) {
            Utils.log("TTS Playback: Cache key not found on button.", Utils.logLevels.WARN);
            return;
        }

        // 如果当前点击的按钮正在播放，则切换播放/暂停状态
        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) { // 如果已暂停，则播放
                this._currentlyPlayingTtsAudio.play().catch(e => {
                    Utils.log("恢复播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR);
                });
                buttonElement.classList.add('playing'); // 添加播放中样式
            } else { // 如果正在播放，则暂停
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing'); // 移除播放中样式
            }
            return;
        }

        // 如果有其他音频正在播放，则停止它并清理资源
        if (this._currentlyPlayingTtsAudio) {
            this._currentlyPlayingTtsAudio.pause();
            if (this._currentlyPlayingTtsButton && this._currentlyPlayingTtsButton.dataset.objectUrl) {
                URL.revokeObjectURL(this._currentlyPlayingTtsButton.dataset.objectUrl); // 释放旧的Object URL
                delete this._currentlyPlayingTtsButton.dataset.objectUrl;
            }
            if (this._currentlyPlayingTtsButton) {
                this._currentlyPlayingTtsButton.classList.remove('playing'); // 移除旧按钮的播放样式
            }
        }
        this._currentlyPlayingTtsAudio = null; // 清理引用
        this._currentlyPlayingTtsButton = null;

        // 从 IndexedDB 获取音频
        try {
            const cachedItem = await DBManager.getItem(this._TTS_CACHE_STORE_NAME, cacheKey);
            if (!cachedItem || !cachedItem.audioBlob || !(cachedItem.audioBlob instanceof Blob) || cachedItem.audioBlob.size === 0) {
                Utils.log(`TTS Playback: Audio blob not found or invalid in cache for key ${cacheKey}.`, Utils.logLevels.ERROR);
                buttonElement.innerHTML = '💾'; // 显示缓存未命中/错误图标
                buttonElement.title = "音频缓存未找到或无效，请尝试重试TTS生成。";
                setTimeout(() => { // 短暂显示后恢复
                    if (buttonElement.innerHTML === '💾') {
                        buttonElement.innerHTML = ''; // 清空图标，CSS会显示默认播放图标
                        buttonElement.title = "播放/暂停语音";
                    }
                }, 3000);
                return;
            }

            const audioBlob = cachedItem.audioBlob;
            const objectURL = URL.createObjectURL(audioBlob); // 创建 Object URL
            buttonElement.dataset.objectUrl = objectURL; // 存储以便后续释放

            this._currentlyPlayingTtsAudio = new Audio(objectURL); // 创建新的 Audio 对象
            this._currentlyPlayingTtsButton = buttonElement; // 更新当前播放按钮

            this._currentlyPlayingTtsAudio.play() // 播放音频
                .then(() => {
                    buttonElement.classList.add('playing'); // 添加播放中样式
                })
                .catch(e => { // 播放失败处理
                    Utils.log("播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR);
                    buttonElement.classList.remove('playing');
                    buttonElement.innerHTML = '⚠️'; buttonElement.title = "初始化音频时出错";
                    setTimeout(() => { if (buttonElement.innerHTML === '⚠️') { buttonElement.innerHTML = ''; buttonElement.title = "播放/暂停语音"; } }, 2000);

                    URL.revokeObjectURL(objectURL); // 释放 Object URL
                    delete buttonElement.dataset.objectUrl;
                    // 清理当前播放引用
                    if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                        this._currentlyPlayingTtsAudio = null;
                        this._currentlyPlayingTtsButton = null;
                    }
                });

            // 音频播放结束时的处理
            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                URL.revokeObjectURL(objectURL);
                delete buttonElement.dataset.objectUrl;
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    this._currentlyPlayingTtsAudio = null;
                    this._currentlyPlayingTtsButton = null;
                }
            };

            // 音频播放错误时的处理
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

        } catch (dbError) { // 处理数据库读取错误
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
            ttsControlContainer.innerHTML = ''; // 清空旧控件
            const errorButton = document.createElement('button');
            errorButton.className = 'tts-retry-button'; // 重试按钮样式
            errorButton.textContent = '⚠️'; // 错误图标
            errorButton.title = `TTS 错误: ${errorMessage.substring(0,100)}。点击重试。`;
            errorButton.addEventListener('click', (e) => { // 绑定重试事件
                e.stopPropagation();
                const messageElement = parentContainer.closest('.message'); // 获取父消息元素
                if (!messageElement) {
                    Utils.log("无法找到 TTS 重试的父消息元素。", Utils.logLevels.ERROR);
                    return;
                }
                const senderId = messageElement.dataset.senderId; // 获取发送者ID
                const contact = UserManager.contacts[senderId]; // 获取联系人信息
                const messageContentElement = messageElement.querySelector('.message-content'); // 获取消息内容元素

                // 检查必要信息是否存在
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

                const rawText = messageContentElement.textContent; // 获取原始文本（假设它未被修改）
                const cleanedText = this.cleanTextForTts(rawText); // 清理文本
                const currentTtsConfig = contact.aiConfig.tts; // 获取TTS配置

                if (cleanedText && currentTtsConfig) { // 如果文本和配置有效
                    Utils.log(`正在为 ttsId ${ttsId} 重试 TTS。清理后的文本: "${cleanedText.substring(0,50)}..."`, Utils.logLevels.INFO);
                    this.addTtsPlaceholder(parentContainer, ttsId); // 显示加载占位符
                    this.requestTtsForMessage(cleanedText, currentTtsConfig, parentContainer, ttsId); // 重新请求TTS
                } else {
                    Utils.log(`无法为 ttsId ${ttsId} 重试 TTS: 清理后的文本或 TTS 配置为空。`, Utils.logLevels.WARN);
                    NotificationUIManager.showNotification("无法重试 TTS: 缺少必要数据。", "error");
                }
            });
            ttsControlContainer.appendChild(errorButton);
        }
    }
};