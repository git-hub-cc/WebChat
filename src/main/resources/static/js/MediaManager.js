/**
 * @file MediaManager.js
 * @description 核心媒体管理器，负责处理媒体相关的核心逻辑，如麦克风权限、语音录制、文件处理和屏幕截图。
 *              它不直接操作 UI，而是将 UI 更新委托给 MediaUIManager 或通过 EventEmitter 通知。
 *              截图功能现在会将原始截图数据传递给 ScreenshotEditorUIManager 进行编辑。
 *              用户同意分享后，延迟1秒进行截图。
 * @module MediaManager
 * @exports {object} MediaManager - 对外暴露的单例对象，包含媒体处理的核心方法。
 * @property {function} initVoiceRecording - 初始化语音录制功能，检查浏览器支持。
 * @property {function} startRecording - 开始录制语音。
 * @property {function} stopRecording - 停止录制语音。
 * @property {function} processFile - 处理用户选择或拖放的文件，进行大小检查并读取数据。
 * @property {function} handleFileSelect - 处理文件输入框的 change 事件。
 * @property {function} captureScreen - 捕获屏幕或窗口内容作为截图。
 * @dependencies Config, Utils, NotificationManager, MessageManager, MediaUIManager, EventEmitter
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (绑定录音和截图按钮事件), MessageManager (播放语音消息)
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
     * 同时，初始化对截图编辑完成和取消事件的监听。
     */
    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true;
        }
        // 检查截图 API 支持
        const screenshotMainBtn = document.getElementById('screenshotMainBtn');
        if (screenshotMainBtn && typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            Utils.log('浏览器不支持 getDisplayMedia API。截图功能将不可用。', Utils.logLevels.WARN);
            screenshotMainBtn.disabled = true;
            screenshotMainBtn.title = '截图功能不可用';
        }

        // 监听截图编辑完成和取消事件
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('screenshotEditingComplete', function(editedFileObject) {
                MessageManager.selectedFile = editedFileObject; // 将编辑后的图片设置为待发送文件
                if (typeof MediaUIManager !== 'undefined') {
                    MediaUIManager.displayFilePreview(editedFileObject); // 调用UI管理器显示预览
                }
                Utils.log('Edited screenshot ready for preview.', Utils.logLevels.INFO);
                NotificationManager.showNotification('截图编辑完成，已添加到预览。', 'success');
            });

            EventEmitter.on('screenshotEditingCancelled', function() {
                Utils.log('Screenshot editing was cancelled by user or editor.', Utils.logLevels.INFO);
                if (MessageManager.selectedFile && MessageManager.selectedFile.name && MessageManager.selectedFile.name.startsWith("screenshot_temp_")) {
                    MessageManager.cancelFileData();
                }
                NotificationManager.showNotification('截图操作已取消。', 'info');
            });
        } else {
            Utils.log('MediaManager.init: EventEmitter 未定义，无法监听截图编辑事件。', Utils.logLevels.WARN);
        }
    },

    /**
     * 请求麦克风使用权限。如果已获取，则直接返回。
     * @returns {Promise<boolean>} - 是否成功获取权限。
     */
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
                if (this.audioChunks.length === 0) {
                    Utils.log("未录制到音频数据。", Utils.logLevels.WARN);
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
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(true);
            this._updateRecordingTimerInterval();
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
            this.mediaRecorder.stop();
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
            if (elapsedSeconds >= Config.media.maxAudioDuration) this.stopRecording();
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
        if (MessageManager.audioData) {
            NotificationManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                MessageManager.selectedFile = { data: e.target.result, type: file.type, name: file.name, size: file.size, blob: file };
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
        if(event && event.target) {
            event.target.value = '';
        }
    },

    /**
     * @description 捕获屏幕或窗口内容作为截图。用户同意分享后，延迟1秒再进行实际截图，然后将数据发送给编辑器。
     * @returns {Promise<void>}
     */
    captureScreen: async function() {
        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            NotificationManager.showNotification('您的浏览器不支持屏幕捕获功能。', 'error');
            return;
        }
        if (MessageManager.audioData) {
            NotificationManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        if (MessageManager.selectedFile) {
            NotificationManager.showNotification('已有待发送的文件。请先取消。', 'warning');
            return;
        }

        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });

            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                NotificationManager.showNotification('无法获取视频流用于截图。', 'error');
                stream.getTracks().forEach(track => track.stop());
                return;
            }

            NotificationManager.showNotification('1秒后截取屏幕...', 'info', 1000); // 提示用户1秒后截图

            setTimeout(async () => {
                // 确保流仍然活动，用户可能在延迟期间关闭了共享
                if (!stream || !stream.active || videoTrack.readyState === 'ended') {
                    Utils.log('MediaManager.captureScreen: 延迟后屏幕共享流已停止或无效。', Utils.logLevels.WARN);
                    if (stream) stream.getTracks().forEach(track => track.stop()); // 确保再次停止
                    return;
                }

                try {
                    const imageCapture = new ImageCapture(videoTrack);
                    const bitmap = await imageCapture.grabFrame();

                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(bitmap, 0, 0);

                    canvas.toBlob(function(blob) {
                        if (!blob) {
                            NotificationManager.showNotification('截图失败：无法生成图片 Blob。', 'error');
                            // 此时 stream 变量在 setTimeout 的回调中，但 ScreenshotEditorUIManager 预期会接收到它并停止
                            // 但如果这里失败了，最好也尝试停止
                            if (stream) stream.getTracks().forEach(track => track.stop());
                            return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = function() {
                            const dataUrl = reader.result;
                            if (typeof EventEmitter !== 'undefined') {
                                EventEmitter.emit('rawScreenshotCaptured', {
                                    dataUrl: dataUrl,
                                    blob: blob,
                                    originalStream: stream
                                });
                                Utils.log("Raw screenshot captured after delay, event emitted.", Utils.logLevels.INFO);
                            } else {
                                Utils.log("MediaManager.captureScreen: EventEmitter 未定义，无法发送截图数据到编辑器。", Utils.logLevels.ERROR);
                                if (stream) stream.getTracks().forEach(track => track.stop());
                            }
                        };
                        reader.onerror = function() {
                            NotificationManager.showNotification('截图失败：无法读取图片数据。', 'error');
                            if (stream) stream.getTracks().forEach(track => track.stop());
                        };
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                } catch (captureError) {
                    Utils.log(`延迟截图或处理时出错: ${captureError.message}`, Utils.logLevels.ERROR);
                    NotificationManager.showNotification(`截图处理失败: ${captureError.message}`, 'error');
                    if (stream) stream.getTracks().forEach(track => track.stop());
                }
            }, 1000); // 延迟1000毫秒 (1秒)

        } catch (err) {
            Utils.log('屏幕捕获初始设置失败: ' + err.message, Utils.logLevels.ERROR);
            if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                NotificationManager.showNotification('截图功能启动失败: ' + err.message, 'error');
            } else {
                NotificationManager.showNotification('截图已取消或未授权。', 'info');
            }
            if (stream) { // 如果在获取流后但在延迟前出错
                stream.getTracks().forEach(track => track.stop());
            }
        }
    }
};