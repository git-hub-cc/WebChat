/**
 * @file MessageTtsHandler.js
 * @description 文本转语音 (TTS) 处理器，负责处理 AI 消息的语音合成功能。
 *              包括清理文本、向 TTS API 发送请求、处理响应以及管理消息中的播放控件 UI。
 * @module MessageTtsHandler
 * @exports {object} MessageTtsHandler - 对外暴露的单例对象，包含所有 TTS 相关处理方法。
 * @property {function} requestTtsForMessage - 为指定消息文本请求 TTS 音频。
 * @property {function} playTtsAudioFromControl - 处理播放/暂停 TTS 音频的点击事件。
 * @property {function} addTtsPlaceholder - 在消息中添加一个加载中的占位符。
 * @dependencies Config, Utils, UserManager, NotificationManager, AiApiHandler
 * @dependents MessageManager (当 AI 消息完成时调用)
 */
const MessageTtsHandler = {
    _currentlyPlayingTtsAudio: null,
    _currentlyPlayingTtsButton: null,

    /**
     * 清理文本，移除不适合 TTS 的特殊字符、标记等。
     * @param {string} text - 原始消息文本。
     * @returns {string} - 清理后的纯文本。
     */
    cleanTextForTts: function (text) {
        if (typeof text !== 'string') return '';
        let cleanedText = text;
        cleanedText = cleanedText.replace(/\*.*?\*/g, '');
        cleanedText = cleanedText.replace(/【.*?】/g, '');
        cleanedText = cleanedText.replace(/\[.*?\]/g, '');
        cleanedText = cleanedText.replace(/\(.*?\)/g, '');
        cleanedText = cleanedText.replace(/（.*?）/g, '');
        const allowedCharsRegex = /[^\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uff65-\uff9f\u3000-\u303f\uff01-\uff5ea-zA-Z0-9\s.,!?;:'"-]/g;
        cleanedText = cleanedText.replace(allowedCharsRegex, ' ');
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
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig();
        const baseTtsApiEndpoint = effectiveConfig.ttsApiEndpoint;

        if (!baseTtsApiEndpoint) {
            Utils.log("TTS 未触发: TTS API 端点未配置。", Utils.logLevels.WARN);
            this.updateTtsControlToError(parentContainer, ttsId, "TTS 端点未配置");
            return;
        }
        const currentTtsApiEndpoint = baseTtsApiEndpoint.endsWith('/') ? baseTtsApiEndpoint + 'infer_single' : baseTtsApiEndpoint + '/infer_single';

        // 从 ttsConfig 中安全地获取 version，如果不存在则使用默认值
        const apiVersion = ttsConfig.version || 'v4'; // 默认 v4

        const payload = {
            version: apiVersion, // 使用从配置中获取的版本
            sample_steps: ttsConfig.sample_steps !== undefined ? ttsConfig.sample_steps : 16, // 确保有默认值
            if_sr: ttsConfig.if_sr !== undefined ? ttsConfig.if_sr : false,
            model_name: ttsConfig.model_name, speaker_name: ttsConfig.speaker_name, // speaker_name 现在可能与 model_name 含义重叠
            prompt_text_lang: ttsConfig.prompt_text_lang || "中文", emotion: ttsConfig.emotion || "默认",
            text: text, text_lang: ttsConfig.text_lang || "中文", top_k: ttsConfig.top_k || 10,
            top_p: ttsConfig.top_p || 1, temperature: ttsConfig.temperature || 1, // 确保 top_p 使用其配置值或默认值
            text_split_method: ttsConfig.text_split_method || "按标点符号切", batch_size: ttsConfig.batch_size || 10,
            batch_threshold: ttsConfig.batch_threshold || 0.75, split_bucket: ttsConfig.split_bucket === undefined ? true : ttsConfig.split_bucket,
            speed_facter: ttsConfig.speed_facter || 1, fragment_interval: ttsConfig.fragment_interval || 0.3,
            media_type: ttsConfig.media_type || "wav", parallel_infer: ttsConfig.parallel_infer === undefined ? true : ttsConfig.parallel_infer,
            repetition_penalty: ttsConfig.repetition_penalty || 1.35, seed: ttsConfig.seed === undefined ? -1 : ttsConfig.seed,
        };
        // 对于 speaker_name，如果它不存在于 ttsConfig 中 (因为现在可能由 model_name 决定)，则从 payload 中移除，避免发送空值或不正确的值
        if (ttsConfig.speaker_name === undefined && ttsConfig.tts_mode === 'Dynamic') { //仅在动态模式下考虑移除
            // 根据新的API，model_name 本身就可能包含speaker信息，所以不需要单独的speaker_name
            // 如果API /infer_single 仍然需要speaker_name，即使它与model_name部分重复，则不应删除它
            // 假设现在的 model_name 如 "星穹铁道-中文-藿藿_ZH" 已足够，不需要独立的 speaker_name
        }


        Utils.log(`MessageTtsHandler: TTS 请求。端点='${currentTtsApiEndpoint}', ttsId 为 ${ttsId}`, Utils.logLevels.DEBUG);
        Utils.log(`MessageTtsHandler: TTS 请求体: ${JSON.stringify(payload)}`, Utils.logLevels.DEBUG);


        // 构建请求头
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer guest',
            'Referer': 'https://tts.acgnai.top/',
            'sec-ch-ua-platform': '"Windows"', // 示例，实际中此头部由浏览器控制
            'sec-ch-ua': navigator.userAgentData ? navigator.userAgentData.brands.map(b => `"${b.brand}";v="${b.version}"`).join(", ") : '"Chromium";v="100", "Google Chrome";v="100"', // 尝试获取真实值
            'sec-ch-ua-mobile': '?0',
            'User-Agent': navigator.userAgent,
            'Accept': 'application/json, text/plain, */*',
            'DNT': '1'
        };

        try {
            const response = await fetch(currentTtsApiEndpoint, {
                method: 'POST', headers: headers, body: JSON.stringify(payload)
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
            const audioBlobOriginal = await audioResponse.blob();
            if (audioBlobOriginal.size === 0) throw new Error(`获取 TTS 失败: 收到空的 blob。URL: ${audioUrl}`);

            Utils.log(`MessageTtsHandler: ttsId ${ttsId} 音频原始大小: ${audioBlobOriginal.size} bytes`, Utils.logLevels.DEBUG);

            let processedAudioBlob = audioBlobOriginal; // Default to original blob
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            try {
                const arrayBuffer = await audioBlobOriginal.arrayBuffer();
                const decodedAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const sampleRate = decodedAudioBuffer.sampleRate;
                const numberOfChannels = decodedAudioBuffer.numberOfChannels;
                const totalDurationSec = decodedAudioBuffer.duration;

                Utils.log(`MessageTtsHandler: ttsId ${ttsId} 音频原始总时长: ${totalDurationSec.toFixed(2)}s.`, Utils.logLevels.DEBUG);

                // --- 条件：仅当音频时长大于1分钟 (60秒) 时才进行处理 ---
                if (totalDurationSec > 60) {
                    Utils.log(`MessageTtsHandler: ttsId ${ttsId} 音频时长超过60秒，将尝试删除指定片段。`, Utils.logLevels.DEBUG);
                    const startTimeToDeleteSec = 10;
                    const durationToDeleteSec = 60; // 1 minute
                    const endTimeToDeleteSec = startTimeToDeleteSec + durationToDeleteSec;

                    // 确保删除的开始时间在音频总时长内，否则没有意义去创建新buffer
                    if (totalDurationSec <= startTimeToDeleteSec) {
                        Utils.log(`MessageTtsHandler: ttsId ${ttsId} 音频时长 (${totalDurationSec.toFixed(2)}s) 小于删除开始时间 (${startTimeToDeleteSec}s)，不进行删除操作。`, Utils.logLevels.DEBUG);
                        // processedAudioBlob 已经是 audioBlobOriginal，所以这里无需额外操作
                    } else {
                        const startSampleToDelete = Math.floor(startTimeToDeleteSec * sampleRate);
                        let endSampleToDelete = Math.floor(endTimeToDeleteSec * sampleRate);

                        // 确保删除范围不超出音频总长度
                        if (endSampleToDelete > decodedAudioBuffer.length) {
                            endSampleToDelete = decodedAudioBuffer.length;
                        }

                        let samplesToDeleteCount = 0;
                        if (startSampleToDelete < endSampleToDelete) {
                            samplesToDeleteCount = endSampleToDelete - startSampleToDelete;
                        }

                        if (samplesToDeleteCount > 0) {
                            const newLength = decodedAudioBuffer.length - samplesToDeleteCount;

                            if (newLength <= 0) {
                                Utils.log(`MessageTtsHandler: ttsId ${ttsId} 删除后音频长度为0或负数，将使用空音频。`, Utils.logLevels.WARN);
                                const emptyBuffer = audioContext.createBuffer(numberOfChannels, 1, sampleRate); // 1 sample of silence
                                processedAudioBlob = this._audioBufferToWav(emptyBuffer);
                            } else {
                                const modifiedAudioBuffer = audioContext.createBuffer(
                                    numberOfChannels,
                                    newLength,
                                    sampleRate
                                );

                                for (let channel = 0; channel < numberOfChannels; channel++) {
                                    const originalChannelData = decodedAudioBuffer.getChannelData(channel);
                                    const newChannelData = modifiedAudioBuffer.getChannelData(channel);

                                    // 复制第一部分 (删除点之前)
                                    for (let i = 0; i < startSampleToDelete; i++) {
                                        newChannelData[i] = originalChannelData[i];
                                    }

                                    // 复制第二部分 (删除点之后)
                                    for (let i = 0; i < originalChannelData.length - endSampleToDelete; i++) {
                                        newChannelData[startSampleToDelete + i] = originalChannelData[endSampleToDelete + i];
                                    }
                                }
                                Utils.log(`MessageTtsHandler: ttsId ${ttsId} 音频已处理，新长度: ${modifiedAudioBuffer.duration.toFixed(2)}s`, Utils.logLevels.DEBUG);
                                processedAudioBlob = this._audioBufferToWav(modifiedAudioBuffer);
                            }
                        } else {
                            Utils.log(`MessageTtsHandler: ttsId ${ttsId} 无有效样本可删除 (可能删除范围在音频之外或无效)。将使用原始音频。`, Utils.logLevels.DEBUG);
                            // processedAudioBlob 已经是 audioBlobOriginal
                        }
                    }
                } else {
                    Utils.log(`MessageTtsHandler: ttsId ${ttsId} 音频时长 (${totalDurationSec.toFixed(2)}s) 不足60秒，将使用原始音频。`, Utils.logLevels.DEBUG);
                    // processedAudioBlob 已经是 audioBlobOriginal，所以这里无需额外操作
                }
            } catch (processingError) {
                Utils.log(`MessageTtsHandler: ttsId ${ttsId} 处理音频时出错: ${processingError.message}. 将使用原始音频。`, Utils.logLevels.ERROR);
                if (Utils.logLevel <= Utils.logLevels.DEBUG && processingError.stack) Utils.log(processingError.stack, Utils.logLevels.DEBUG);
                // 发生处理错误时，回退到使用原始音频
                processedAudioBlob = audioBlobOriginal; // 确保回退
            } finally {
                if (audioContext && audioContext.state !== 'closed') {
                    audioContext.close().catch(e => Utils.log(`Error closing AudioContext: ${e}`, Utils.logLevels.WARN));
                }
            }

            Utils.log(`MessageTtsHandler: ttsId ${ttsId} 处理后音频大小: ${processedAudioBlob.size} bytes`, Utils.logLevels.DEBUG);
            const preloadedAudioObjectURL = URL.createObjectURL(processedAudioBlob);
            Utils.log(`MessageTtsHandler: ttsId ${ttsId} 的 TTS 音频已预加载 (可能已处理)。Object URL: ${preloadedAudioObjectURL}`, Utils.logLevels.DEBUG);
            this.updateTtsControlToPlay(parentContainer, ttsId, preloadedAudioObjectURL);

        } catch (preloadError) {
            Utils.log(`预加载 ttsId ${ttsId} 的 TTS 音频时出错 (URL: ${audioUrl}): ${preloadError.message}`, Utils.logLevels.ERROR);
            if (Utils.logLevel <= Utils.logLevels.DEBUG && preloadError.stack) Utils.log(preloadError.stack, Utils.logLevels.DEBUG);
            this.updateTtsControlToError(parentContainer, ttsId, "音频加载失败");
        }
    },

// Helper function _audioBufferToWav remains the same
    _audioBufferToWav: function(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const C = numOfChan;
        const R = buffer.sampleRate;
        const L = buffer.length;
        const bitDepth = 16;

        const headerSize = 44;
        const dataSize = L * C * (bitDepth / 8);
        const fileSize = headerSize + dataSize;

        const wavBuffer = new ArrayBuffer(fileSize);
        const view = new DataView(wavBuffer);

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        writeString(view, 0, 'RIFF');
        view.setUint32(4, fileSize - 8, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, C, true);
        view.setUint32(24, R, true);
        view.setUint32(28, R * C * (bitDepth / 8), true);
        view.setUint16(32, C * (bitDepth / 8), true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = 44;
        for (let i = 0; i < L; i++) {
            for (let ch = 0; ch < C; ch++) {
                const channelData = buffer.getChannelData(ch);
                let sample = channelData[i];
                if (sample > 1) sample = 1;
                if (sample < -1) sample = -1;
                sample = Math.floor(sample * 32767);
                view.setInt16(offset, sample, true);
                offset += 2;
            }
        }
        return new Blob([view], { type: 'audio/wav' });
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
            ttsControlContainer.innerHTML = '';
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

        if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
            if (this._currentlyPlayingTtsAudio.paused) {
                this._currentlyPlayingTtsAudio.play().catch(e => Utils.log("恢复播放 TTS 音频时出错: " + e, Utils.logLevels.ERROR));
                buttonElement.classList.add('playing');
            } else {
                this._currentlyPlayingTtsAudio.pause();
                buttonElement.classList.remove('playing');
            }
        } else {
            if (this._currentlyPlayingTtsAudio) {
                this._currentlyPlayingTtsAudio.pause();
                revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                if (this._currentlyPlayingTtsButton) this._currentlyPlayingTtsButton.classList.remove('playing');
            }
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
            this._currentlyPlayingTtsAudio.onended = () => {
                buttonElement.classList.remove('playing');
                if (this._currentlyPlayingTtsAudio && this._currentlyPlayingTtsButton === buttonElement) {
                    revokeCurrentAudioObjectURL(this._currentlyPlayingTtsAudio);
                    this._currentlyPlayingTtsAudio = null; this._currentlyPlayingTtsButton = null;
                }
            };
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