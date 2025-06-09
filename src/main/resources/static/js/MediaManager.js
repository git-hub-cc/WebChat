// MODIFIED: MediaManager.js (已翻译为中文)
// - UI 预览逻辑已移至 MediaUIManager.js。
// - 调用 MediaUIManager 进行 UI 更新。
// - 添加了 processFile 函数以处理来自点击和拖放的文件。
const MediaManager = {
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingStartTime: null,
    recordingDuration: 0,
    audioStream: null,

    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true;
        }
        // voiceButton 的事件监听器（mousedown, mouseup, touchstart, touchend）
        // 比较复杂，可以在这里或在 ChatAreaUIManager 中管理。
        // 目前，由于它们触发 MediaManager 的方法，暂时保留在 AppInitializer/ChatAreaUIManager 中。
    },

    requestMicrophonePermission: async function() {
        if (this.mediaRecorder && this.audioStream?.active && this.mediaRecorder.state !== "inactive") return true;
        this.releaseAudioResources();
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: Config.media.audioConstraints || true });
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/ogg;codecs=opus';
                if(!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'audio/webm';
            }
            this.mediaRecorder = new MediaRecorder(this.audioStream, options);
            this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data); };
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length === 0) { Utils.log("未录制到音频数据。", Utils.logLevels.WARN); this.releaseAudioResources(); return; }
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    MessageManager.audioData = reader.result;
                    MessageManager.audioDuration = this.recordingDuration;
                    if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayAudioPreview(reader.result, this.recordingDuration);
                };
                reader.readAsDataURL(audioBlob);
                this.audioChunks = [];
            };
            Utils.log('麦克风权限已授予。', Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`获取麦克风权限时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('麦克风访问被拒绝或不可用。', 'error');
            const voiceButton = document.getElementById('voiceButtonMain');
            if(voiceButton) voiceButton.disabled = true;
            this.releaseAudioResources();
            return false;
        }
    },

    startRecording: async function() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
        const permissionGranted = await this.requestMicrophonePermission();
        if (!permissionGranted) return;
        try {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();
            this.recordingDuration = 0;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(true);
            this._updateRecordingTimerInterval(); // 开始 UI 计时器更新
            Utils.log('音频录制已开始。', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`开始录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    stopRecording: function() {
        if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
            this.releaseAudioResources();
            return;
        }
        try {
            this.mediaRecorder.stop(); // 触发 ondataavailable 和 onstop
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
            Utils.log('音频录制已停止。', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`停止录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    _updateRecordingTimerInterval: function() { // 重命名以避免与 UI 函数冲突
        if (this.recordingTimer) clearInterval(this.recordingTimer); // 清除任何现有的计时器
        const updateUI = () => {
            if (!this.recordingStartTime) return;
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            this.recordingDuration = elapsedSeconds;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.updateRecordingButtonTimerUI(elapsedSeconds, Config.media.maxAudioDuration);
            if (elapsedSeconds >= Config.media.maxAudioDuration) this.stopRecording();
        };
        updateUI(); // 初始调用
        this.recordingTimer = setInterval(updateUI, 1000);
    },

    // resetRecordingButton 和 updateRecordingButtonTimer 现已移至 MediaUIManager

    playAudio: function(buttonElement) { // 用于播放接收/发送的语音消息，而不是预览
        const audioDataUrl = buttonElement.dataset.audio;
        if (!audioDataUrl) return;
        const existingAudio = buttonElement.querySelector('audio.playing-audio-instance');
        if (existingAudio) { existingAudio.pause(); existingAudio.remove(); buttonElement.innerHTML = '▶'; return; }

        document.querySelectorAll('audio.playing-audio-instance').forEach(aud => {
            aud.pause();
            const btn = aud.closest('.voice-message')?.querySelector('.play-voice-btn');
            if(btn) btn.innerHTML = '▶';
            aud.remove();
        });

        const audio = new Audio(audioDataUrl);
        audio.className = "playing-audio-instance";
        buttonElement.innerHTML = '❚❚';
        audio.play().catch(e => { Utils.log("播放音频时出错: "+e, Utils.logLevels.ERROR); buttonElement.innerHTML = '▶'; });
        audio.onended = () => { buttonElement.innerHTML = '▶'; audio.remove(); };
        audio.onerror = () => { buttonElement.innerHTML = '⚠️'; setTimeout(() => {buttonElement.innerHTML = '▶'; audio.remove();}, 2000); };
    },

    releaseAudioResources: function() {
        if (this.audioStream) { this.audioStream.getTracks().forEach(track => track.stop()); this.audioStream = null; Utils.log('麦克风流已释放。', Utils.logLevels.INFO); }
        if (this.mediaRecorder?.state !== "inactive") try { this.mediaRecorder.stop(); } catch(e) { /* 忽略 */ }
        this.mediaRecorder = null; this.audioChunks = [];
        if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; }
    },

    formatFileSize: function(bytes) { // 工具函数，可以留在这里或移至 Utils.js
        if (bytes === 0) return '0 Bytes';
        const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // displayFilePreview 现已移至 MediaUIManager

    processFile: async function(file) {
        if (!file) return;
        if (file.size > Config.media.maxFileSize) {
            NotificationManager.showNotification(`文件过大。最大: ${this.formatFileSize(Config.media.maxFileSize)}。`, 'error');
            return;
        }
        // 不能同时暂存语音消息和文件
        if (MessageManager.audioData) {
            NotificationManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                MessageManager.selectedFile = { data: e.target.result, type: file.type, name: file.name, size: file.size };
                if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayFilePreview(MessageManager.selectedFile);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            Utils.log(`处理文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('处理文件时出错。', 'error');
        }
    },

    handleFileSelect: async function(event) {
        const file = event.target.files[0];
        if (file) {
            await this.processFile(file);
        }
        // 清空输入值很重要，这样同一个文件才能再次被选择
        if(event && event.target) {
            event.target.value = '';
        }
    },
};