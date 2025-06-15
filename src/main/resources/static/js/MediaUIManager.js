/**
 * @file MediaUIManager.js
 * @description 媒体 UI 管理器，负责处理与媒体相关的用户界面元素，如录音和文件选择的预览。
 *              它将 UI 展示逻辑与 MediaManager 的核心功能逻辑分离。
 * @module MediaUIManager
 * @exports {object} MediaUIManager - 对外暴露的单例对象，包含管理媒体 UI 的方法。
 * @property {function} init - 初始化模块，获取 DOM 元素。
 * @property {function} displayAudioPreview - 显示录制完成的音频预览。
 * @property {function} displayFilePreview - 显示用户选择的文件的预览。
 * @property {function} setRecordingButtonActive - 设置录音按钮的激活（录制中）状态和 UI。
 * @dependencies Utils, MessageManager, MediaManager, NotificationManager
 * @dependents AppInitializer (进行初始化), MediaManager (调用以更新 UI), EventEmitter (监听截图事件)
 */
const MediaUIManager = {
    audioPreviewContainerEl: null,
    filePreviewContainerEl: null,

    /**
     * 初始化模块，获取 UI 元素的引用。
     */
    init: function() {
        this.audioPreviewContainerEl = document.getElementById('audioPreviewContainer');
        this.filePreviewContainerEl = document.getElementById('filePreviewContainer');
        // 预览中的播放/取消事件监听器在创建预览时动态添加。

        // 监听截图完成事件以更新预览
        EventEmitter.on('screenshotTakenForPreview', (fileObject) => {
            this.displayFilePreview(fileObject);
        });
    },

    /**
     * 在输入区域显示录制完成的音频预览。
     * @param {string} audioDataUrl - 音频数据的 Base64 URL。
     * @param {number} duration - 音频时长（秒）。
     */
    displayAudioPreview: function (audioDataUrl, duration) {
        if (!this.audioPreviewContainerEl) {
            Utils.log("未找到音频预览容器。", Utils.logLevels.ERROR);
            return;
        }
        // 清除文件预览（如果存在）
        if (this.filePreviewContainerEl) this.filePreviewContainerEl.innerHTML = '';
        MessageManager.selectedFile = null; // 确保文件也被清空

        const formattedDuration = Utils.formatTime(duration);
        this.audioPreviewContainerEl.innerHTML = `
<div class="voice-message-preview">
    <span>🎙️ 语音消息 (${formattedDuration})</span>
<audio controls src="${audioDataUrl}" style="display:none;"></audio>
<button class="btn-play-preview">播放</button>
<button class="btn-cancel-preview">取消</button>
</div>
`;
        const playBtn = this.audioPreviewContainerEl.querySelector('.btn-play-preview');
        const cancelBtn = this.audioPreviewContainerEl.querySelector('.btn-cancel-preview');
        const audioEl = this.audioPreviewContainerEl.querySelector('audio');

        // 绑定预览播放按钮的事件
        if (playBtn && audioEl) {
            playBtn.addEventListener('click', () => { // 使用 addEventListener
                if (audioEl.paused) {
                    audioEl.play().catch(e => Utils.log("播放预览音频时出错: " + e, Utils.logLevels.ERROR));
                    playBtn.textContent = "暂停";
                } else {
                    audioEl.pause();
                    playBtn.textContent = "播放";
                }
            });
            audioEl.onended = () => { playBtn.textContent = "播放"; };
        }
        // 绑定取消按钮的事件
        if (cancelBtn) cancelBtn.addEventListener('click', () => MessageManager.cancelAudioData()); // 使用 addEventListener
    },

    /**
     * 清除音频预览 UI。
     */
    clearAudioPreview: function() {
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
    },

    /**
     * 在输入区域显示用户选择的文件的预览。
     * @param {object} fileObj - 包含文件信息（data (URL for preview), type, name, size, blob?）的对象。
     */
    displayFilePreview: function(fileObj) {
        if (!this.filePreviewContainerEl) {
            Utils.log("未找到文件预览容器。", Utils.logLevels.ERROR);
            return;
        }
        // 清除音频预览（如果存在）
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
        MessageManager.audioData = null; // 确保音频数据也被清空
        MessageManager.audioDuration = 0;


        this.filePreviewContainerEl.innerHTML = ''; // 清除之前的预览
        const previewDiv = document.createElement('div');
        previewDiv.className = 'file-preview-item';
        let contentHtml = '';

        // fileObj.data 此时应该是 Object URL (来自截图) 或 Data URL (来自文件选择)
        if (fileObj.type.startsWith('image/')) {
            contentHtml = `<img src="${fileObj.data}" alt="预览" style="max-height: 50px; border-radius: 4px; margin-right: 8px;"> ${Utils.escapeHtml(fileObj.name)}`;
        } else if (fileObj.type.startsWith('video/')) {
            contentHtml = `🎬 ${Utils.escapeHtml(fileObj.name)} (视频)`;
        } else {
            contentHtml = `📄 ${Utils.escapeHtml(fileObj.name)} (${MediaManager.formatFileSize(fileObj.size)})`;
        }
        previewDiv.innerHTML = `<span>${contentHtml}</span><button class="cancel-file-preview" title="移除附件">✕</button>`;
        this.filePreviewContainerEl.appendChild(previewDiv);
        const cancelBtn = this.filePreviewContainerEl.querySelector('.cancel-file-preview');
        if (cancelBtn) cancelBtn.addEventListener('click', () => MessageManager.cancelFileData()); // 使用 addEventListener
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
            voiceButton.classList.remove('recording');
            voiceButton.innerHTML = '🎙️';
            const timerEl = document.getElementById('recordingVoiceTimer');
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

        if (!voiceTimerEl && voiceButton.classList.contains('recording')) {
            voiceTimerEl = document.createElement('span');
            voiceTimerEl.id = 'recordingVoiceTimer';
            voiceTimerEl.className = 'audio-timer-indicator';
            voiceButton.appendChild(voiceTimerEl);
        } else if (!voiceButton?.classList.contains('recording') && voiceTimerEl) {
            voiceTimerEl.remove(); // 如果按钮不再是录音状态，则清理计时器
            return;
        }

        if (voiceTimerEl) {
            voiceTimerEl.textContent = Utils.formatTime(elapsedSeconds);
        }

        if (elapsedSeconds >= maxDuration) {
            NotificationManager.showNotification(`已达到最大录制时间 ${maxDuration}秒。`, 'info');
        }
    },

    /**
     * 设置录音按钮的激活（录制中）状态和 UI。
     * @param {boolean} isActive - 是否处于激活状态。
     */
    setRecordingButtonActive: function(isActive) {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            if (isActive) {
                voiceButton.classList.add('recording');
                voiceButton.innerHTML = '🛑'; // 录制时显示停止图标
            } else {
                this.resetRecordingButtonUI(); // 停止时重置按钮
            }
        }
    }
};