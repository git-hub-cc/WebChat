/**
 * @file MediaManager.js
 * @description [MODIFIED FOR NATIVE INTEGRATION] 核心媒体管理器，负责处理媒体相关的核心逻辑。
 *              截图功能现在支持调用原生 Android 接口，以提供更好的移动端体验。
 * @module MediaManager
 * @exports {object} MediaManager
 * @dependencies AppSettings, Utils, NotificationUIManager, MessageManager, MediaUIManager, EventEmitter
 */
const MediaManager = {
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingStartTime: null,
    recordingDuration: 0,
    audioStream: null,

    /**
     * 初始化语音录制和截图功能，并设置事件监听器。
     */
    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true;
        }

        const screenshotMainBtn = document.getElementById('screenshotMainBtn');
        if (screenshotMainBtn && typeof navigator.mediaDevices.getDisplayMedia !== 'function' && !(window.Android && typeof window.Android.startScreenCapture === 'function')) {
            Utils.log('浏览器和原生环境均不支持截图功能。', Utils.logLevels.WARN);
            screenshotMainBtn.disabled = true;
            screenshotMainBtn.title = '截图功能不可用';
        }

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('screenshotEditingComplete', async (editedFileObject) => {
                MessageManager.selectedFile = editedFileObject;
                if (typeof MediaUIManager !== 'undefined') {
                    MediaUIManager.displayFilePreview(editedFileObject);
                }
                Utils.log('编辑后的截图已准备好预览。', Utils.logLevels.INFO);
                NotificationUIManager.showNotification('截图编辑完成，已添加到预览。', 'success');
            });

            EventEmitter.on('screenshotEditingCancelled', () => {
                Utils.log('截图编辑已被用户或编辑器取消。', Utils.logLevels.INFO);
                if (MessageManager.selectedFile && MessageManager.selectedFile.name?.startsWith("screenshot_temp_")) {
                    MessageManager.cancelFileData();
                }
                NotificationUIManager.showNotification('截图操作已取消。', 'info');
            });
        }
    },

    /**
     * 请求麦克风使用权限。
     * @returns {Promise<boolean>} - 是否成功获取权限。
     */
    requestMicrophonePermission: async function() {
        if (this.mediaRecorder && this.audioStream?.active && this.mediaRecorder.state !== "inactive") return true;
        this.releaseAudioResources();
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints || true });
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/ogg;codecs=opus';
                if(!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'audio/webm';
            }
            this.mediaRecorder = new MediaRecorder(this.audioStream, options);
            this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data); };
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length === 0) {
                    this.releaseAudioResources();
                    return;
                }
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
            return true;
        } catch (error) {
            Utils.log(`获取麦克风权限时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('麦克风访问被拒绝或不可用。', 'error');
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
        if (this.mediaRecorder?.state === 'recording') return;
        const permissionGranted = await this.requestMicrophonePermission();
        if (!permissionGranted) return;
        try {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();
            this.recordingDuration = 0;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(true);
            this._updateRecordingTimerInterval();
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
            this.mediaRecorder.stop();
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false);
        } catch (error) {
            Utils.log(`停止录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources();
        }
    },

    /**
     * @private
     * 启动一个定时器，定期更新录音时长。
     */
    _updateRecordingTimerInterval: function() {
        if (this.recordingTimer) clearInterval(this.recordingTimer);
        const updateUI = () => {
            if (!this.recordingStartTime) return;
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            this.recordingDuration = elapsedSeconds;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.updateRecordingButtonTimerUI(elapsedSeconds, AppSettings.media.maxAudioDuration);
            if (elapsedSeconds >= AppSettings.media.maxAudioDuration) this.stopRecording();
        };
        updateUI();
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
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.remove();
            buttonElement.innerHTML = '▶';
            return;
        }

        document.querySelectorAll('audio.playing-audio-instance').forEach(aud => {
            aud.pause();
            const btn = aud.closest('.voice-message')?.querySelector('.play-voice-btn');
            if(btn) btn.innerHTML = '▶';
            aud.remove();
        });

        const audio = new Audio(audioDataUrl);
        audio.className = "playing-audio-instance";
        buttonElement.innerHTML = '❚❚';
        audio.play().catch(e => { buttonElement.innerHTML = '▶'; });
        audio.onended = () => { buttonElement.innerHTML = '▶'; audio.remove(); };
        audio.onerror = () => { buttonElement.innerHTML = '⚠️'; setTimeout(() => {buttonElement.innerHTML = '▶'; audio.remove();}, 2000); };
    },

    /**
     * 释放所有音频资源。
     */
    releaseAudioResources: function() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        if (this.mediaRecorder?.state !== "inactive") try { this.mediaRecorder.stop(); } catch(e) {}
        this.mediaRecorder = null;
        this.audioChunks = [];
        if (this.recordingTimer) clearInterval(this.recordingTimer);
        this.recordingTimer = null;
    },

    /**
     * 格式化文件大小为可读字符串。
     * @param {number} bytes - 文件大小（字节）。
     * @returns {string} - 格式化后的字符串。
     */
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
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
        if (file.size > AppSettings.media.maxFileSize) {
            NotificationUIManager.showNotification(`文件过大。最大: ${this.formatFileSize(AppSettings.media.maxFileSize)}。`, 'error');
            return;
        }
        if (MessageManager.audioData) {
            NotificationUIManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        try {
            const fileHash = await Utils.generateFileHash(file);
            const previewUrl = URL.createObjectURL(file);

            MessageManager.selectedFile = {
                blob: file, hash: fileHash, name: file.name,
                type: file.type, size: file.size, previewUrl: previewUrl
            };
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayFilePreview(MessageManager.selectedFile);
        } catch (error) {
            Utils.log(`处理文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理文件时出错。', 'error');
        }
    },

    /**
     * 处理用户上传的贴图文件。
     * @param {File} file - 要处理的贴图文件对象。
     * @returns {Promise<void>}
     */
    processStickerFile: async function(file) {
        if (!file) return;

        if (file.size > AppSettings.media.maxStickerSize) {
            NotificationUIManager.showNotification(`贴图文件过大。最大: ${this.formatFileSize(AppSettings.media.maxStickerSize)}。`, 'error');
            return;
        }

        const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            NotificationUIManager.showNotification('不支持的贴图文件类型。请使用 PNG, JPG, GIF 或 WEBP。', 'error');
            return;
        }

        try {
            const fileHash = await Utils.generateFileHash(file);
            const stickerFileObject = { id: fileHash, name: file.name, blob: file };
            EventEmitter.emit('stickerFileProcessed', stickerFileObject);
        } catch (error) {
            Utils.log(`处理贴图文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理贴图文件时出错。', 'error');
        }
    },

    /**
     * 处理文件输入框的 change 事件。
     * @param {Event} event - change 事件对象。
     */
    handleFileSelect: async function(event) {
        const file = event.target.files[0];
        if (file) {
            await this.processFile(file);
        }
        if(event && event.target) {
            event.target.value = '';
        }
    },

    /**
     * 捕获屏幕或窗口内容作为截图。
     * @returns {Promise<void>}
     */
    captureScreen: async function() {
        if (MessageManager.audioData || MessageManager.selectedFile) {
            NotificationUIManager.showNotification('已有待发送的媒体，请先取消。', 'warning');
            return;
        }

        if (window.Android && typeof window.Android.startScreenCapture === 'function') {
            Utils.log('正在调用原生 Android 截图功能。', Utils.logLevels.INFO);
            NotificationUIManager.showNotification('请授权屏幕录制权限以截图...', 'info');
            window.Android.startScreenCapture();
            return;
        }

        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            NotificationUIManager.showNotification('您的浏览器不支持屏幕捕获功能。', 'error');
            return;
        }

        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });

            setTimeout(async () => {
                if (!stream || !stream.active) {
                    return;
                }
                try {
                    const videoTrack = stream.getVideoTracks()[0];
                    const imageCapture = new ImageCapture(videoTrack);
                    const bitmap = await imageCapture.grabFrame();
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    canvas.getContext('2d').drawImage(bitmap, 0, 0);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            const dataUrl = URL.createObjectURL(blob);
                            EventEmitter.emit('rawScreenshotCaptured', { dataUrl, blob, originalStream: stream });
                            // The URL is now managed by the editor, which will revoke it.
                        } else if (stream) {
                            stream.getTracks().forEach(track => track.stop());
                        }
                    }, 'image/png');
                } catch (captureError) {
                    Utils.log(`延迟截图或处理时出错: ${captureError.message}`, Utils.logLevels.ERROR);
                    if (stream) stream.getTracks().forEach(track => track.stop());
                }
            }, 300);

        } catch (err) {
            if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                NotificationUIManager.showNotification('截图功能启动失败: ' + err.message, 'error');
            } else {
                NotificationUIManager.showNotification('截图已取消或未授权。', 'info');
            }
            if (stream) stream.getTracks().forEach(track => track.stop());
        }
    }
};