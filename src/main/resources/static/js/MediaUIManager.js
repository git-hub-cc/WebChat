// 新文件: MediaUIManager.js (已翻译)
// 职责:
// - 显示录音和所选文件的 UI 预览。
// - 处理从 UI 取消这些预览的操作。
const MediaUIManager = {
    audioPreviewContainerEl: null,
    filePreviewContainerEl: null,

    init: function() {
        this.audioPreviewContainerEl = document.getElementById('audioPreviewContainer');
        this.filePreviewContainerEl = document.getElementById('filePreviewContainer');
        // 预览中的播放/取消事件监听器在创建预览时动态添加。
    },

    displayAudioPreview: function (audioDataUrl, duration) {
        if (!this.audioPreviewContainerEl) {
            Utils.log("未找到音频预览容器。", Utils.logLevels.ERROR);
            return;
        }
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

        if (playBtn && audioEl) {
            playBtn.onclick = () => {
                if (audioEl.paused) {
                    audioEl.play().catch(e => Utils.log("播放预览音频时出错: " + e, Utils.logLevels.ERROR));
                    playBtn.textContent = "暂停";
                } else {
                    audioEl.pause();
                    playBtn.textContent = "播放";
                }
            };
            audioEl.onended = () => { playBtn.textContent = "播放"; };
        }
        if (cancelBtn) cancelBtn.onclick = () => MessageManager.cancelAudioData();
    },

    clearAudioPreview: function() {
        if (this.audioPreviewContainerEl) this.audioPreviewContainerEl.innerHTML = '';
    },

    displayFilePreview: function(fileObj) {
        if (!this.filePreviewContainerEl) {
            Utils.log("未找到文件预览容器。", Utils.logLevels.ERROR);
            return;
        }
        this.filePreviewContainerEl.innerHTML = ''; // 清除之前的预览
        const previewDiv = document.createElement('div');
        previewDiv.className = 'file-preview-item';
        let contentHtml = '';

        if (fileObj.type.startsWith('image/')) {
            contentHtml = `<img src="${fileObj.data}" alt="预览" style="max-height: 50px; border-radius: 4px; margin-right: 8px;"> ${Utils.escapeHtml(fileObj.name)}`;
        } else if (fileObj.type.startsWith('video/')) {
            contentHtml = `🎬 ${Utils.escapeHtml(fileObj.name)} (视频)`;
        } else {
            contentHtml = `📄 ${Utils.escapeHtml(fileObj.name)} (${MediaManager.formatFileSize(fileObj.size)})`; // formatFileSize 作为一个工具函数可以保留在 MediaManager 中
        }
        previewDiv.innerHTML = `<span>${contentHtml}</span><button class="cancel-file-preview" title="移除附件">✕</button>`;
        this.filePreviewContainerEl.appendChild(previewDiv);
        const cancelBtn = this.filePreviewContainerEl.querySelector('.cancel-file-preview');
        if (cancelBtn) cancelBtn.onclick = () => MessageManager.cancelFileData();
    },

    clearFilePreview: function() {
        if (this.filePreviewContainerEl) this.filePreviewContainerEl.innerHTML = '';
    },

    resetRecordingButtonUI: function() { // 从 MediaManager 移来，用于特定的 UI 重置
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            voiceButton.classList.remove('recording');
            voiceButton.innerHTML = '🎙️';
            const timerEl = document.getElementById('recordingVoiceTimer');
            if(timerEl) timerEl.remove();
        }
    },

    updateRecordingButtonTimerUI: function(elapsedSeconds, maxDuration) { // 从 MediaManager 移来
        const voiceButton = document.getElementById('voiceButtonMain'); // 如果需要，假设已被获取
        let voiceTimerEl = document.getElementById('recordingVoiceTimer');

        if (!voiceButton && !voiceTimerEl) return; // 无需更新

        if (!voiceTimerEl && voiceButton && voiceButton.classList.contains('recording')) {
            voiceTimerEl = document.createElement('span');
            voiceTimerEl.id = 'recordingVoiceTimer';
            voiceTimerEl.className = 'audio-timer-indicator';
            voiceButton.appendChild(voiceTimerEl);
        } else if (!voiceButton?.classList.contains('recording') && voiceTimerEl) {
            voiceTimerEl.remove(); // 如果在没有 recording 类的情况下存在，则清理
            return;
        }


        if (voiceTimerEl) {
            voiceTimerEl.textContent = Utils.formatTime(elapsedSeconds);
        }

        if (elapsedSeconds >= maxDuration) {
            // 停止录制的逻辑在 MediaManager 中，UI 只做反映
            NotificationManager.showNotification(`已达到最大录制时间 ${maxDuration}秒。`, 'info');
        }
    },

    setRecordingButtonActive: function(isActive) {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (voiceButton) {
            if (isActive) {
                voiceButton.classList.add('recording');
                voiceButton.innerHTML = '🛑'; // 停止图标
                // 计时器元素将由 updateRecordingButtonTimerUI 添加/更新
            } else {
                this.resetRecordingButtonUI(); // 使用统一的重置函数
            }
        }
    }
};