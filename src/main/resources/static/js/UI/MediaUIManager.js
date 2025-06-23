/**
 * @file MediaUIManager.js
 * @description 媒体 UI 管理器，负责处理与媒体相关的用户界面元素，如录音和文件选择的预览。
 *              它将 UI 展示逻辑与 MediaManager 的核心功能逻辑分离。
 *              文件名过长时，在预览和消息中会进行截断显示。
 *              修改: displayFilePreview 现在使用 fileObj.previewUrl (一个Object URL) 来显示预览。
 *              新增: renderMediaThumbnail 用于在指定占位符中渲染图片或视频的缩略图。
 * @module MediaUIManager
 * @exports {object} MediaUIManager - 对外暴露的单例对象，包含管理媒体 UI 的方法。
 * @property {function} init - 初始化模块，获取 DOM 元素。
 * @property {function} displayAudioPreview - 显示录制完成的音频预览。
 * @property {function} displayFilePreview - 显示用户选择的文件的预览。
 * @property {function} setRecordingButtonActive - 设置录音按钮的激活（录制中）状态和 UI。
 * @property {function} renderMediaThumbnail - (新增) 通用方法，在提供的占位符中渲染图片或视频缩略图。
 * @dependencies Utils, MessageManager, MediaManager, NotificationUIManager, EventEmitter, DBManager
 * @dependents AppInitializer (进行初始化), MediaManager (调用以更新 UI), EventEmitter (监听截图事件), MessageManager, ResourcePreviewUIManager (使用 renderMediaThumbnail)
 */
const MediaUIManager = {
    audioPreviewContainerEl: null, // 音频预览容器元素
    filePreviewContainerEl: null,  // 文件预览容器元素

    /**
     * 初始化模块，获取 UI 元素的引用。
     */
    init: function() {
        this.audioPreviewContainerEl = document.getElementById('audioPreviewContainer');
        this.filePreviewContainerEl = document.getElementById('filePreviewContainer');
        // 预览中的播放/取消事件监听器在创建预览时动态添加。

        // 监听截图完成事件以更新预览 (注意: 这个事件现在由MediaManager在 'screenshotEditingComplete' 后触发，并传递处理好的fileObject)
        // EventEmitter.on('screenshotTakenForPreview', (fileObject) => { // 这个事件可能不再需要，或者语义已变
        //     this.displayFilePreview(fileObject); // 显示文件预览
        // });
    },

    /**
     * 在输入区域显示录制完成的音频预览。
     * @param {string} audioDataUrl - 音频数据的 Base64 URL。
     * @param {number} duration - 音频时长（秒）。
     */
    displayAudioPreview: function (audioDataUrl, duration) {
        if (!this.audioPreviewContainerEl) { // 防御性检查
            Utils.log("未找到音频预览容器。", Utils.logLevels.ERROR);
            return;
        }
        // 清除文件预览（如果存在），因为一次只能预览一种媒体
        if (this.filePreviewContainerEl) this.filePreviewContainerEl.innerHTML = '';
        if (MessageManager.selectedFile) { // 清空MessageManager中的文件和其预览URL
            if (MessageManager.selectedFile.previewUrl) {
                URL.revokeObjectURL(MessageManager.selectedFile.previewUrl);
            }
            MessageManager.selectedFile = null;
        }


        const formattedDuration = Utils.formatTime(duration); // 格式化时长
        // 构建音频预览HTML
        this.audioPreviewContainerEl.innerHTML = `
<div class="voice-message-preview">
    <span>🎙️ 语音消息 (${formattedDuration})</span>
<audio controls src="${audioDataUrl}" style="display:none;"></audio> <!-- 隐藏默认播放器 -->
<button class="btn-play-preview">播放</button>
<button class="btn-cancel-preview">取消</button>
</div>
`;
        const playBtn = this.audioPreviewContainerEl.querySelector('.btn-play-preview');
        const cancelBtn = this.audioPreviewContainerEl.querySelector('.btn-cancel-preview');
        const audioEl = this.audioPreviewContainerEl.querySelector('audio'); // 获取<audio>元素

        // 绑定预览播放按钮的事件
        if (playBtn && audioEl) {
            playBtn.addEventListener('click', () => {
                if (audioEl.paused) { // 如果暂停，则播放
                    audioEl.play().catch(e => Utils.log("播放预览音频时出错: " + e, Utils.logLevels.ERROR));
                    playBtn.textContent = "暂停";
                } else { // 如果正在播放，则暂停
                    audioEl.pause();
                    playBtn.textContent = "播放";
                }
            });
            audioEl.onended = () => { playBtn.textContent = "播放"; }; // 播放结束时重置按钮文本
        }
        // 绑定取消按钮的事件
        if (cancelBtn) cancelBtn.addEventListener('click', () => MessageManager.cancelAudioData());
    },

    /**
     * 清除音频预览 UI。
     */
    clearAudioPreview: function() {
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
    },

    /**
     * 在输入区域显示用户选择的文件的预览。
     * @param {object} fileObj - 包含文件信息（blob, hash, name, type, size, previewUrl）的对象。
     */
    displayFilePreview: function(fileObj) {
        if (!this.filePreviewContainerEl) { // 防御性检查
            Utils.log("未找到文件预览容器。", Utils.logLevels.ERROR);
            return;
        }
        // 清除音频预览（如果存在）
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
        MessageManager.audioData = null;
        MessageManager.audioDuration = 0;


        this.filePreviewContainerEl.innerHTML = ''; // 清除之前的预览
        const previewDiv = document.createElement('div');
        previewDiv.className = 'file-preview-item';

        const originalFileName = fileObj.name; // 保留原始文件名
        const escapedOriginalFileName = Utils.escapeHtml(originalFileName); // 转义HTML字符
        const displayFileName = Utils.truncateFileName(escapedOriginalFileName, 25); // 截断文件名以适应预览区 (25字符)

        let contentHtml;

        // 使用 previewUrl (Object URL) 进行预览
        if (fileObj.type.startsWith('image/') && fileObj.previewUrl) {
            contentHtml = `<img src="${fileObj.previewUrl}" alt="预览" style="max-height: 50px; border-radius: 4px; margin-right: 8px;" title="${escapedOriginalFileName}"> ${displayFileName}`;
        } else if (fileObj.type.startsWith('video/') && fileObj.previewUrl) {
            contentHtml = `🎬 <span title="${escapedOriginalFileName}">${displayFileName}</span> (视频) <video src="${fileObj.previewUrl}" style="display:none;" controls></video>`; // 预览时可以不显示播放器，或显示一个小的
        } else { // 其他文件类型
            contentHtml = `📄 <span title="${escapedOriginalFileName}">${displayFileName}</span> (${MediaManager.formatFileSize(fileObj.size)})`;
        }
        previewDiv.innerHTML = `<span>${contentHtml}</span><button class="cancel-file-preview" title="移除附件">✕</button>`;

        // 如果主要内容在span内（非图片情况），则在该span上设置title属性
        const mainSpan = previewDiv.querySelector('span');
        if(mainSpan && !(fileObj.type.startsWith('image/') && fileObj.previewUrl)) {
            const fileNameSpan = mainSpan.querySelector('span[title]'); // 查找特定的文件名span
            if (fileNameSpan) { // 如果存在
                fileNameSpan.title = escapedOriginalFileName;
            } else { // 否则设置在主span上
                mainSpan.title = escapedOriginalFileName;
            }
        }


        this.filePreviewContainerEl.appendChild(previewDiv);
        const cancelBtn = this.filePreviewContainerEl.querySelector('.cancel-file-preview');
        if (cancelBtn) cancelBtn.addEventListener('click', () => MessageManager.cancelFileData()); // 绑定取消事件
    },

    /**
     * 清除文件预览 UI。
     */
    clearFilePreview: function() {
        if (this.filePreviewContainerEl) this.filePreviewContainerEl.innerHTML = '';
    },

    /**
     * 重置录音按钮到其默认状态。
     */
    resetRecordingButtonUI: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            voiceButton.classList.remove('recording'); // 移除录制中样式
            voiceButton.innerHTML = '🎙️'; // 重置图标
            const timerEl = document.getElementById('recordingVoiceTimer'); // 移除计时器
            if(timerEl) timerEl.remove();
        }
    },

    /**
     * 更新录音按钮上的计时器显示。
     * @param {number} elapsedSeconds - 已录制的秒数。
     * @param {number} maxDuration - 最大录制秒数。
     */
    updateRecordingButtonTimerUI: function(elapsedSeconds, maxDuration) {
        const voiceButton = document.getElementById('voiceButtonMain');
        let voiceTimerEl = document.getElementById('recordingVoiceTimer');

        if (!voiceButton) return;

        // 如果计时器不存在且按钮处于录制状态，则创建计时器元素
        if (!voiceTimerEl && voiceButton.classList.contains('recording')) {
            voiceTimerEl = document.createElement('span');
            voiceTimerEl.id = 'recordingVoiceTimer';
            voiceTimerEl.className = 'audio-timer-indicator';
            voiceButton.appendChild(voiceTimerEl);
        } else if (!voiceButton?.classList.contains('recording') && voiceTimerEl) {
            // 如果按钮不再是录音状态，则清理计时器
            voiceTimerEl.remove();
            return;
        }

        if (voiceTimerEl) { // 更新计时器文本
            voiceTimerEl.textContent = Utils.formatTime(elapsedSeconds);
        }

        // 如果达到最大录制时间，显示通知
        if (elapsedSeconds >= maxDuration) {
            NotificationUIManager.showNotification(`已达到最大录制时间 ${maxDuration}秒。`, 'info');
        }
    },

    /**
     * 设置录音按钮的激活（录制中）状态和 UI。
     * @param {boolean} isActive - 是否处于激活状态。
     */
    setRecordingButtonActive: function(isActive) {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            if (isActive) { // 如果激活
                voiceButton.classList.add('recording'); // 添加录制中样式
                voiceButton.innerHTML = '🛑'; // 显示停止图标
            } else { // 如果非激活
                this.resetRecordingButtonUI(); // 重置按钮UI
            }
        }
    },

    /**
     * @description (新增) 通用方法，在提供的占位符中渲染图片或视频缩略图。
     *              它会尝试从 IndexedDB (DBManager) 获取文件 Blob，然后创建对象URL并设置到 img/video 元素。
     * @param {HTMLElement} placeholderDiv - 用于显示缩略图或加载状态的占位符元素。
     * @param {string} fileHash - 文件哈希，用作缓存键。
     * @param {string} fileType - 文件MIME类型。
     * @param {string} [altText='媒体预览'] - 图片或视频的 alt 文本。
     * @param {boolean} [isForResourceGrid=false] - 指示此缩略图是否用于资源预览网格，会应用不同样式。
     * @returns {Promise<void>}
     */
    renderMediaThumbnail: async function(placeholderDiv, fileHash, fileType, altText = '媒体预览', isForResourceGrid = false) {
        if (!placeholderDiv || !fileHash || !fileType) {
            Utils.log("MediaUIManager.renderMediaThumbnail: 参数不足。", Utils.logLevels.WARN);
            if(placeholderDiv) placeholderDiv.innerHTML = '⚠️';
            return;
        }

        try {
            const cachedItem = await DBManager.getItem('fileCache', fileHash);
            if (!cachedItem || !cachedItem.fileBlob) {
                placeholderDiv.innerHTML = '⚠️';
                placeholderDiv.title = '无法加载预览：文件缓存未找到。';
                Utils.log(`MediaUIManager.renderMediaThumbnail: 文件缓存未找到 (hash: ${fileHash})`, Utils.logLevels.WARN);
                return;
            }

            const blob = cachedItem.fileBlob;
            const objectURL = URL.createObjectURL(blob);

            let mediaElement;
            let loadEventName;

            if (fileType.startsWith('image/')) {
                mediaElement = document.createElement('img');
                mediaElement.alt = altText;
                loadEventName = 'load';
            } else if (fileType.startsWith('video/')) {
                mediaElement = document.createElement('video');
                mediaElement.muted = true;
                mediaElement.preload = "metadata";
                mediaElement.alt = altText;
                loadEventName = 'loadedmetadata';
            } else {
                URL.revokeObjectURL(objectURL);
                Utils.log(`MediaUIManager.renderMediaThumbnail: 不支持的类型 ${fileType} (hash: ${fileHash})`, Utils.logLevels.WARN);
                placeholderDiv.innerHTML = '❔'; // 未知类型图标
                return;
            }

            mediaElement.classList.add(isForResourceGrid ? 'message-thumbnail-resource' : 'message-thumbnail');

            const loadPromise = new Promise((resolve, reject) => {
                mediaElement.addEventListener(loadEventName, () => {
                    const dimensions = fileType.startsWith('image/') ?
                        { width: mediaElement.naturalWidth, height: mediaElement.naturalHeight } :
                        { width: mediaElement.videoWidth, height: mediaElement.videoHeight };
                    resolve(dimensions);
                }, { once: true });
                mediaElement.addEventListener('error', () => reject(new Error(`${fileType.startsWith('image/') ? 'Image' : 'Video'} load error for thumbnail`)), { once: true });
            });

            mediaElement.src = objectURL;
            if (fileType.startsWith('video/')) {
                mediaElement.load();
            }

            try {
                const dimensions = await loadPromise;
                if (!isForResourceGrid) { // 仅为聊天消息中的缩略图设置尺寸
                    let { width, height } = dimensions;
                    if (width === 0 || height === 0) {
                        Utils.log(`renderMediaThumbnail: 无法获取媒体尺寸 (hash: ${fileHash})`, Utils.logLevels.WARN);
                        width = 150; height = 100; // Default fallback
                    }
                    const aspectRatio = width / height;
                    const MAX_WIDTH = 150; const MAX_HEIGHT = 150;
                    if (aspectRatio > 1) { mediaElement.style.width = `${MAX_WIDTH}px`; mediaElement.style.height = 'auto'; }
                    else { mediaElement.style.height = `${MAX_HEIGHT}px`; mediaElement.style.width = 'auto'; }
                    mediaElement.style.maxWidth = `${MAX_WIDTH}px`; mediaElement.style.maxHeight = `${MAX_HEIGHT}px`;
                }

                placeholderDiv.innerHTML = '';
                placeholderDiv.appendChild(mediaElement);
                // 存储 Object URL 以便后续由 MessageManager (deleteMessageLocally) 或 ResourcePreviewUIManager (清理时) 释放
                placeholderDiv.dataset.objectUrlForRevoke = objectURL;

            } catch (loadError) {
                Utils.log(`加载媒体缩略图尺寸失败 (hash: ${fileHash}): ${loadError.message}`, Utils.logLevels.ERROR);
                placeholderDiv.innerHTML = '⚠️';
                placeholderDiv.title = '预览加载失败。';
                URL.revokeObjectURL(objectURL); // 释放 URL
            }
        } catch (dbError) {
            Utils.log(`从DB获取媒体用于缩略图失败 (hash: ${fileHash}): ${dbError.message}`, Utils.logLevels.ERROR);
            placeholderDiv.innerHTML = '⚠️';
            placeholderDiv.title = '无法获取资源。';
        }
    }
};