
/**
 * @file MediaManager.js
 * @description 核心媒体管理器，负责处理媒体相关的核心逻辑，如麦克风权限、语音录制状态管理以及文件处理。
 *              它不直接操作 UI，而是将 UI 更新委托给 MediaUIManager。
 * @module MediaManager
 * @exports {object} MediaManager - 对外暴露的单例对象，包含媒体处理的核心方法。
 * @property {function} initVoiceRecording - 初始化语音录制功能，检查浏览器支持。
 * @property {function} startRecording - 开始录制语音。
 * @property {function} stopRecording - 停止录制语音。
 * @property {function} processFile - 处理用户选择或拖放的文件，进行大小检查并读取数据。
 * @property {function} handleFileSelect - 处理文件输入框的 change 事件。
 * @dependencies Config, Utils, NotificationManager, MessageManager, MediaUIManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (绑定录音按钮事件), MessageManager (播放语音消息)
 */
const MediaManager = {
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingStartTime: null,
    recordingDuration: 0,
    audioStream: null,

    /**
     * 初始化语音录制功能，检查浏览器是否支持媒体设备 API。
     */
    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true;
        }
    },

    /**
     * 请求麦克风使用权限。如果已获取，则直接返回。
     * @returns {Promise<boolean>} - 是否成功获取权限。
     */
    requestMicrophonePermission: async function() {
        // 如果录音实例已存在且活跃，则无需重新请求
        if (this.mediaRecorder && this.audioStream?.active && this.mediaRecorder.state !== "inactive") return true;
        this.releaseAudioResources();
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: Config.media.audioConstraints || true });
            // 尝试使用推荐的 MIME 类型，如果不支持则回退
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/ogg;codecs=opus';
                if(!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'audio/webm';
            }
            this.mediaRecorder = new MediaRecorder(this.audioStream, options);
            // 当有可用音频数据时，将其存入 audioChunks 数组
            this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data); };
            // 当录音停止时，处理收集到的音频数据
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length === 0) {
                    Utils.log("未录制到音频数据。", Utils.logLevels.WARN);
                    this.releaseAudioResources();
                    return;
                }
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    // 将音频数据和时长存入 MessageManager，并通知 MediaUIManager 显示预览
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

    /**
     * 开始录制语音。
     * @returns {Promise<void>}
     */
    startRecording: async function() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return;
        const permissionGranted = await this.requestMicrophonePermission();
        if (!permissionGranted) return;
        try {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();
            this.recordingDuration = 0;
            // 通知 MediaUIManager 更新按钮状态
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(true);
            this._updateRecordingTimerInterval(); // 启动 UI 计时器
            Utils.log('音频录制已开始。', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`开始录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    /**
     * 停止录制语音。
     */
    stopRecording: function() {
        if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
            this.releaseAudioResources();
            return;
        }
        try {
            this.mediaRecorder.stop(); // 这将触发 ondataavailable 和 onstop 事件
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
            Utils.log('音频录制已停止。', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`停止录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    /**
     * @private
     * 启动一个定时器，定期更新录音时长，并通知 MediaUIManager 更新 UI。
     */
    _updateRecordingTimerInterval: function() {
        if (this.recordingTimer) clearInterval(this.recordingTimer);
        const updateUI = () => {
            if (!this.recordingStartTime) return;
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            this.recordingDuration = elapsedSeconds;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.updateRecordingButtonTimerUI(elapsedSeconds, Config.media.maxAudioDuration);
            // 达到最大时长后自动停止
            if (elapsedSeconds >= Config.media.maxAudioDuration) this.stopRecording();
        };
        updateUI(); // 立即执行一次
        this.recordingTimer = setInterval(updateUI, 1000);
    },

    /**
     * 播放指定的语音消息。
     * @param {HTMLElement} buttonElement - 被点击的播放按钮元素。
     */
    playAudio: function(buttonElement) {
        const audioDataUrl = buttonElement.dataset.audio;
        if (!audioDataUrl) return;
        const existingAudio = buttonElement.querySelector('audio.playing-audio-instance');
        // 如果点击的是正在播放的按钮，则暂停/移除音频
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.remove();
            buttonElement.innerHTML = '▶';
            return;
        }

        // 停止其他所有正在播放的语音消息
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

    /**
     * 释放所有音频资源，如停止麦克风流。
     */
    releaseAudioResources: function() {
        if (this.audioStream) { this.audioStream.getTracks().forEach(track => track.stop()); this.audioStream = null; Utils.log('麦克风流已释放。', Utils.logLevels.INFO); }
        if (this.mediaRecorder?.state !== "inactive") try { this.mediaRecorder.stop(); } catch(e) { /* 忽略 */ }
        this.mediaRecorder = null; this.audioChunks = [];
        if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; }
    },

    /**
     * 格式化文件大小为可读字符串（如 KB, MB）。
     * @param {number} bytes - 文件大小（字节）。
     * @returns {string} - 格式化后的字符串。
     */
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    /**
     * 处理用户选择或拖放的文件。
     * @param {File} file - 要处理的文件对象。
     * @returns {Promise<void>}
     */
    processFile: async function(file) {
        if (!file) return;
        if (file.size > Config.media.maxFileSize) {
            NotificationManager.showNotification(`文件过大。最大: ${this.formatFileSize(Config.media.maxFileSize)}。`, 'error');
            return;
        }
        // 防止同时暂存语音消息和文件
        if (MessageManager.audioData) {
            NotificationManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                // 将文件数据存入 MessageManager，并通知 MediaUIManager 显示预览
                MessageManager.selectedFile = { data: e.target.result, type: file.type, name: file.name, size: file.size };
                if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayFilePreview(MessageManager.selectedFile);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            Utils.log(`处理文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationManager.showNotification('处理文件时出错。', 'error');
        }
    },

    /**
     * 处理文件输入框的 change 事件。
     * @param {Event} event - change 事件对象。
     * @returns {Promise<void>}
     */
    handleFileSelect: async function(event) {
        const file = event.target.files[0];
        if (file) {
            await this.processFile(file);
        }
        // 清空输入值，以便可以再次选择同一个文件
        if(event && event.target) {
            event.target.value = '';
        }
    },
};