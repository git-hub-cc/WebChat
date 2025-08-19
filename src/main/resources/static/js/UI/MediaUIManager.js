/**
 * @file MediaUIManager.js
 * @description 媒体 UI 管理器，负责处理与媒体相关的用户界面元素，如录音和文件选择的预览。
 *              它将 UI 展示逻辑与 MediaManager 的核心功能逻辑分离。
 *              文件名过长时，在预览和消息中会进行截断显示。
 *              修改: displayFilePreview 现在使用 fileObj.previewUrl (一个Object URL) 来显示预览。
 *              新增: renderMediaThumbnail 用于在指定占位符中渲染图片或视频的缩略图。
 *              FIXED: renderMediaThumbnail 现在会在缓存未命中时显示加载状态，并等待 'fileDataReady' 事件。
 *              FIXED: 修复了视频缩略图因浏览器处理时序问题导致的加载失败，通过延迟 video.load() 调用来解决。
 * @module MediaUIManager
 * @exports {object} MediaUIManager - 对外暴露的单例对象，包含管理媒体 UI 的方法。
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
        if (!this.audioPreviewContainerEl) return;
        this.clearFilePreview(); // 确保文件预览被清除
        MessageManager.selectedFile = null;

        const template = document.getElementById('audio-preview-template').content.cloneNode(true);
        const previewDiv = template.querySelector('.voice-message-preview');
        const durationEl = template.querySelector('.preview-duration');
        const audioEl = template.querySelector('.preview-audio-player');
        const playBtn = template.querySelector('.btn-play-preview');
        const cancelBtn = template.querySelector('.btn-cancel-preview');

        durationEl.textContent = Utils.formatTime(duration);
        audioEl.src = audioDataUrl;

        playBtn.addEventListener('click', () => {
            if (audioEl.paused) {
                audioEl.play().catch(e => Utils.log("播放预览音频时出错: " + e, Utils.logLevels.ERROR));
                playBtn.textContent = "暂停";
            } else {
                audioEl.pause();
                playBtn.textContent = "播放";
            }
        });
        audioEl.onended = () => { playBtn.textContent = "播放"; };

        cancelBtn.addEventListener('click', () => MessageManager.cancelAudioData());

        this.audioPreviewContainerEl.innerHTML = '';
        this.audioPreviewContainerEl.appendChild(previewDiv);
    },

    /**
     * 在输入区域显示用户选择的文件的预览。
     * @param {object} fileObj - 包含文件信息...的对象。
     */
    displayFilePreview: function(fileObj) {
        if (!this.filePreviewContainerEl) return;
        this.clearAudioPreview();
        MessageManager.audioData = null;

        const template = document.getElementById('file-preview-template').content.cloneNode(true);
        const previewDiv = template.querySelector('.file-preview-item');
        const contentEl = template.querySelector('.preview-content');

        const originalFileName = fileObj.name;
        const escapedFileName = Utils.escapeHtml(originalFileName);
        const displayFileName = Utils.truncateFileName(escapedFileName, 25);

        if (fileObj.type.startsWith('image/') && fileObj.previewUrl) {
            const img = document.createElement('img');
            img.src = fileObj.previewUrl;
            img.alt = "预览";
            img.style.maxHeight = '50px';
            img.style.borderRadius = '4px';
            img.style.marginRight = '8px';
            img.title = escapedFileName;
            img.loading = "lazy";
            contentEl.appendChild(img);
            contentEl.appendChild(document.createTextNode(displayFileName));
        } else {
            const icon = fileObj.type.startsWith('video/') ? '🎬' : '📄';
            const fileTypeText = fileObj.type.startsWith('video/') ? ' (视频)' : ` (${MediaManager.formatFileSize(fileObj.size)})`;
            contentEl.innerHTML = `${icon} <span title="${escapedFileName}">${displayFileName}</span>${fileTypeText}`;
        }

        template.querySelector('.cancel-file-preview').addEventListener('click', () => MessageManager.cancelFileData());

        this.filePreviewContainerEl.innerHTML = '';
        this.filePreviewContainerEl.appendChild(previewDiv);
    },

    /**
     * 清除音频预览 UI。
     */
    clearAudioPreview: function() {
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
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
                placeholderDiv.innerHTML = '<div class="spinner"></div>';
                placeholderDiv.title = '正在接收文件...';
                placeholderDiv.dataset.awaitingHash = fileHash;
                Utils.log(`MediaUIManager.renderMediaThumbnail: 文件缓存未找到 (hash: ${fileHash})，设置加载状态。`, Utils.logLevels.DEBUG);
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
                placeholderDiv.innerHTML = '❔';
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
                // --- FIX START ---
                // Defer loading slightly to give the browser time to process the src assignment.
                // This often resolves timing-related media loading failures.
                mediaElement.setAttribute('playsinline', ''); // Good practice for mobile browsers.
                setTimeout(() => mediaElement.load(), 0);
                // --- FIX END ---
            }

            try {
                const dimensions = await loadPromise;
                if (!isForResourceGrid) {
                    let { width, height } = dimensions;
                    if (width === 0 || height === 0) {
                        Utils.log(`renderMediaThumbnail: 无法获取媒体尺寸 (hash: ${fileHash})`, Utils.logLevels.WARN);
                        width = 150; height = 100;
                    }
                    const aspectRatio = width / height;
                    const MAX_WIDTH = 150; const MAX_HEIGHT = 150;
                    if (aspectRatio > 1) { mediaElement.style.width = `${MAX_WIDTH}px`; mediaElement.style.height = 'auto'; }
                    else { mediaElement.style.height = `${MAX_HEIGHT}px`; mediaElement.style.width = 'auto'; }
                    mediaElement.style.maxWidth = `${MAX_WIDTH}px`; mediaElement.style.maxHeight = `${MAX_HEIGHT}px`;
                }

                placeholderDiv.innerHTML = '';
                placeholderDiv.appendChild(mediaElement);
                placeholderDiv.dataset.objectUrlForRevoke = objectURL;

            } catch (loadError) {
                Utils.log(`加载媒体缩略图尺寸失败 (hash: ${fileHash}): ${loadError.message}`, Utils.logLevels.ERROR);
                placeholderDiv.innerHTML = '⚠️';
                placeholderDiv.title = '预览加载失败。';
                URL.revokeObjectURL(objectURL);
            }
        } catch (dbError) {
            Utils.log(`从DB获取媒体用于缩略图失败 (hash: ${fileHash}): ${dbError.message}`, Utils.logLevels.ERROR);
            placeholderDiv.innerHTML = '⚠️';
            placeholderDiv.title = '无法获取资源。';
        }
    }
};