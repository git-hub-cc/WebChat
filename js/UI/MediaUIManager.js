/**
 * @file 媒体 UI 管理器
 * @description 负责处理与媒体相关的用户界面元素，例如录音和文件选择后的预览界面。它将 UI 展示逻辑与核心功能逻辑分离，实现关注点分离。
 * @module MediaUIManager
 * @exports {object} MediaUIManager - 对外暴露的单例对象，包含所有管理媒体 UI 的方法。
 * @dependency Utils, MessageManager, MediaManager, NotificationUIManager, DBManager, EventEmitter
 */
const MediaUIManager = {
    // 音频预览 UI 的容器元素
    audioPreviewContainerEl: null,
    // 文件预览 UI 的容器元素
    filePreviewContainerEl: null,

    /**
     * 初始化模块，获取并缓存必要的 DOM 元素引用。
     * @function init
     * @returns {void}
     */
    init: function() {
        this.audioPreviewContainerEl = document.getElementById('audioPreviewContainer');
        this.filePreviewContainerEl = document.getElementById('filePreviewContainer');
        // NOTE: 预览界面中的播放/取消等事件监听器，在各自的预览创建函数中动态添加。
    },

    /**
     * 显示录制完成的音频预览界面。
     * @function displayAudioPreview
     * @param {string} audioDataUrl - 音频数据的 Base64 格式 URL。
     * @param {number} duration - 音频的总时长（单位：秒）。
     * @returns {void}
     */
    displayAudioPreview: function (audioDataUrl, duration) {
        if (!this.audioPreviewContainerEl) return;
        // 清理流程：
        // 1. 清除任何已存在的文件预览
        // 2. 重置 MessageManager 中的文件选择状态
        this.clearFilePreview();
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
     * 显示用户所选文件的预览界面。
     * @function displayFilePreview
     * @param {object} fileObj - 包含文件详情（name, type, size, previewUrl等）的对象。
     * @returns {void}
     */
    displayFilePreview: function(fileObj) {
        if (!this.filePreviewContainerEl) return;
        // 清理流程：
        // 1. 清除任何已存在的音频预览
        // 2. 重置 MessageManager 中的音频数据状态
        this.clearAudioPreview();
        MessageManager.audioData = null;

        const template = document.getElementById('file-preview-template').content.cloneNode(true);
        const previewDiv = template.querySelector('.file-preview-item');
        const contentEl = template.querySelector('.preview-content');

        const originalFileName = fileObj.name;
        const escapedFileName = Utils.escapeHtml(originalFileName);
        const displayFileName = Utils.truncateFileName(escapedFileName, 25); // 截断过长的文件名以优化显示

        // 根据文件类型决定预览样式
        if (fileObj.type.startsWith('image/') && fileObj.previewUrl) {
            // 对于图片类型，创建并显示图片缩略图
            const img = document.createElement('img');
            img.src = fileObj.previewUrl;
            img.alt = "文件预览";
            img.style.maxHeight = '50px';
            img.style.borderRadius = '4px';
            img.style.marginRight = '8px';
            img.title = escapedFileName; // 鼠标悬停时显示完整文件名
            img.loading = "lazy";
            contentEl.appendChild(img);
            contentEl.appendChild(document.createTextNode(displayFileName));
        } else {
            // 对于非图片文件（如视频、普通文件），显示图标和文件名
            const icon = fileObj.type.startsWith('video/') ? '🎬' : '📄';
            const fileTypeText = fileObj.type.startsWith('video/') ? ' (视频)' : ` (${MediaManager.formatFileSize(fileObj.size)})`;
            contentEl.innerHTML = `${icon} <span title="${escapedFileName}">${displayFileName}</span>${fileTypeText}`;
        }

        template.querySelector('.cancel-file-preview').addEventListener('click', () => MessageManager.cancelFileData());

        this.filePreviewContainerEl.innerHTML = '';
        this.filePreviewContainerEl.appendChild(previewDiv);
    },

    /**
     * 清除音频预览的 UI 显示。
     * @function clearAudioPreview
     * @returns {void}
     */
    clearAudioPreview: function() {
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
    },

    /**
     * 清除文件预览的 UI 显示。
     * @function clearFilePreview
     * @returns {void}
     */
    clearFilePreview: function() {
        if (this.filePreviewContainerEl) this.filePreviewContainerEl.innerHTML = '';
    },

    /**
     * 将录音按钮的 UI 重置到默认（非录制）状态。
     * @function resetRecordingButtonUI
     * @returns {void}
     */
    resetRecordingButtonUI: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            voiceButton.classList.remove('recording');
            voiceButton.innerHTML = '🎙️'; // 重置为麦克风图标
            const timerEl = document.getElementById('recordingVoiceTimer');
            if(timerEl) timerEl.remove(); // 移除计时器显示
        }
    },

    /**
     * 在录音按钮上更新计时器显示。
     * @function updateRecordingButtonTimerUI
     * @param {number} elapsedSeconds - 当前已录制的秒数。
     * @param {number} maxDuration - 最大允许的录制秒数。
     * @returns {void}
     */
    updateRecordingButtonTimerUI: function(elapsedSeconds, maxDuration) {
        const voiceButton = document.getElementById('voiceButtonMain');
        let voiceTimerEl = document.getElementById('recordingVoiceTimer');

        if (!voiceButton) return;

        // 如果计时器元素不存在且当前处于录制状态，则创建它
        if (!voiceTimerEl && voiceButton.classList.contains('recording')) {
            voiceTimerEl = document.createElement('span');
            voiceTimerEl.id = 'recordingVoiceTimer';
            voiceTimerEl.className = 'audio-timer-indicator';
            voiceButton.appendChild(voiceTimerEl);
        } else if (!voiceButton?.classList.contains('recording') && voiceTimerEl) {
            // 如果已退出录制状态，则移除计时器
            voiceTimerEl.remove();
            return;
        }

        if (voiceTimerEl) {
            voiceTimerEl.textContent = Utils.formatTime(elapsedSeconds);
        }

        // 当达到最大录制时间时，发出通知
        if (elapsedSeconds >= maxDuration) {
            NotificationUIManager.showNotification(`已达到最大录制时间 ${maxDuration}秒。`, 'info');
        }
    },

    /**
     * 设置录音按钮的激活状态（录制中或非录制中）。
     * @function setRecordingButtonActive
     * @param {boolean} isActive - true 表示进入录制状态，false 表示退出。
     * @returns {void}
     */
    setRecordingButtonActive: function(isActive) {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            if (isActive) {
                voiceButton.classList.add('recording');
                voiceButton.innerHTML = '🛑'; // 切换为停止图标
            } else {
                this.resetRecordingButtonUI(); // 恢复为默认状态
            }
        }
    },

    /**
     * 在指定的占位符中渲染图片或视频的缩略图。
     * @function renderMediaThumbnail
     * @param {HTMLElement} placeholderDiv - 用于显示缩略图或加载状态的容器元素。
     * @param {string} fileHash - 文件的唯一哈希值，用作 IndexedDB 的键。
     * @param {string} fileType - 文件的 MIME 类型 (例如 'image/jpeg')。
     * @param {string} [altText='媒体预览'] - 媒体元素的 'alt' 属性文本。
     * @param {boolean} [isForResourceGrid=false] - 标识是否用于资源网格，以应用不同的样式。
     * @returns {Promise<void>}
     */
    renderMediaThumbnail: async function(placeholderDiv, fileHash, fileType, altText = '媒体预览', isForResourceGrid = false) {
        if (!placeholderDiv || !fileHash || !fileType) {
            Utils.log("MediaUIManager.renderMediaThumbnail: 参数不足。", Utils.logLevels.WARN);
            if(placeholderDiv) placeholderDiv.innerHTML = '⚠️';
            return;
        }

        // 渲染流程如下：
        // 1. 尝试从 IndexedDB (fileCache) 中根据文件哈希获取缓存的 Blob 数据。
        // 2. 如果缓存不存在，显示错误图标并终止。
        // 3. 根据文件类型 (image/* 或 video/*) 创建对应的 HTML 媒体元素 (<img> 或 <video>)。
        // 4. 使用 URL.createObjectURL() 为 Blob 创建一个临时的本地 URL。
        // 5. 监听媒体元素的加载事件 (load/loadedmetadata) 以确保资源已准备好。
        // 6. 加载成功后，计算并设置合适的缩略图尺寸，然后将其插入到占位符中。
        // 7. 存储 Object URL，以便在元素被销毁时能够手动释放内存。
        // 8. 统一捕获并处理数据库读取或媒体加载过程中发生的任何错误。
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
                // NOTE: 仅为聊天消息中的缩略图设置动态尺寸，资源网格中的尺寸由 CSS 控制。
                if (!isForResourceGrid) {
                    let { width, height } = dimensions;
                    if (width === 0 || height === 0) {
                        Utils.log(`renderMediaThumbnail: 无法获取媒体尺寸 (hash: ${fileHash})`, Utils.logLevels.WARN);
                        width = 150; height = 100; // 提供一个默认的回退尺寸
                    }
                    const aspectRatio = width / height;
                    const MAX_WIDTH = 150; const MAX_HEIGHT = 150;
                    if (aspectRatio > 1) { mediaElement.style.width = `${MAX_WIDTH}px`; mediaElement.style.height = 'auto'; }
                    else { mediaElement.style.height = `${MAX_HEIGHT}px`; mediaElement.style.width = 'auto'; }
                    mediaElement.style.maxWidth = `${MAX_WIDTH}px`;
                    mediaElement.style.maxHeight = `${MAX_HEIGHT}px`;
                }

                placeholderDiv.innerHTML = '';
                placeholderDiv.appendChild(mediaElement);
                // NOTE: 将 Object URL 存储在 dataset 中，以便后续可以由其他模块（如 MessageManager）在删除消息时统一释放。
                placeholderDiv.dataset.objectUrlForRevoke = objectURL;

            } catch (loadError) {
                Utils.log(`加载媒体缩略图尺寸失败 (hash: ${fileHash}): ${loadError.message}`, Utils.logLevels.ERROR);
                placeholderDiv.innerHTML = '⚠️';
                placeholderDiv.title = '预览加载失败。';
                URL.revokeObjectURL(objectURL); // 发生错误时，立即释放 URL
            }
        } catch (dbError) {
            Utils.log(`从DB获取媒体用于缩略图失败 (hash: ${fileHash}): ${dbError.message}`, Utils.logLevels.ERROR);
            placeholderDiv.innerHTML = '⚠️';
            placeholderDiv.title = '无法获取资源。';
        }
    }
};