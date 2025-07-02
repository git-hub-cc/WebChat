/**
 * @file 核心媒体管理器 (MediaManager.js)
 * @description 负责处理媒体相关的核心逻辑，如麦克风权限、语音录制、文件处理和屏幕截图。它不直接操作 UI，而是通过 EventEmitter 或委托给 MediaUIManager 进行界面更新。
 *              截图功能会将原始截图数据传递给 ScreenshotEditorUIManager 进行编辑。
 *              用户同意分享屏幕后，会延迟片刻再进行截图。
 *              注意：processFile 和截图功能现在会计算文件哈希，并将 Blob 和哈希传递给 MessageManager，而非 Data URL。
 * @module MediaManager
 * @exports {object} MediaManager - 对外暴露的单例对象，包含媒体处理的核心方法。
 * @dependency AppSettings, Utils, NotificationUIManager, MessageManager, MediaUIManager, EventEmitter
 */
const MediaManager = {
    // MediaRecorder 实例
    mediaRecorder: null,
    // 存储录制的音频数据块
    audioChunks: [],
    // 录音计时器的句柄
    recordingTimer: null,
    // 录音开始的时间戳
    recordingStartTime: null,

    // 录音时长（秒）
    recordingDuration: 0,
    // 本地音频流 (来自麦克风)
    audioStream: null,

    /**
     * 初始化语音录制功能，检查浏览器 API 支持情况，并设置截图编辑事件的监听器。
     * @function initVoiceRecording
     * @returns {void}
     */
    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        // 检查 getUserMedia API 是否受支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true; // 若不支持则禁用语音按钮
        }
        // 检查 getDisplayMedia API 是否受支持
        const screenshotMainBtn = document.getElementById('screenshotMainBtn');
        if (screenshotMainBtn && typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            Utils.log('浏览器不支持 getDisplayMedia API。截图功能将不可用。', Utils.logLevels.WARN);
            screenshotMainBtn.disabled = true; // 若不支持则禁用截图按钮
            screenshotMainBtn.title = '截图功能不可用';
        }

        // NOTE: 通过 EventEmitter 监听截图编辑器的事件
        if (typeof EventEmitter !== 'undefined') {
            // 监听截图编辑完成事件
            EventEmitter.on('screenshotEditingComplete', async function(editedFileObject) { // editedFileObject 包含 { blob, hash, name, type, size, previewUrl }
                // 将编辑后的图片文件对象设置为待发送文件
                MessageManager.selectedFile = editedFileObject;
                // 调用 UI 管理器显示预览
                if (typeof MediaUIManager !== 'undefined') {
                    MediaUIManager.displayFilePreview(editedFileObject);
                }
                Utils.log('已准备好预览编辑后的截图。', Utils.logLevels.INFO);
                NotificationUIManager.showNotification('截图编辑完成，已添加到预览。', 'success');
            });

            // 监听截图编辑取消事件
            EventEmitter.on('screenshotEditingCancelled', function() {
                Utils.log('用户或编辑器取消了截图编辑。', Utils.logLevels.INFO);
                // 如果当前预览的是临时截图文件，则取消它
                if (MessageManager.selectedFile && MessageManager.selectedFile.name && MessageManager.selectedFile.name.startsWith("screenshot_temp_")) {
                    MessageManager.cancelFileData();
                }
                NotificationUIManager.showNotification('截图操作已取消。', 'info');
            });
        } else {
            Utils.log('MediaManager.init: EventEmitter 未定义，无法监听截图编辑事件。', Utils.logLevels.WARN);
        }
    },

    /**
     * 请求麦克风使用权限。如果已获取，则直接返回。
     * @function requestMicrophonePermission
     * @returns {Promise<boolean>} 是否成功获取权限。
     */
    requestMicrophonePermission: async function() {
        // 处理流程如下：
        // 1. 如果已有活动的录音实例，则认为权限已获取，直接返回。
        if (this.mediaRecorder && this.audioStream?.active && this.mediaRecorder.state !== "inactive") return true;

        // 2. 释放可能存在的旧资源。
        this.releaseAudioResources();
        try {
            // 3. 请求麦克风权限。
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints || true });

            // 4. 设置 MediaRecorder 选项，优先使用 opus 编码的 webm，并做兼容性回退。
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/ogg;codecs=opus';
                if(!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'audio/webm';
            }
            this.mediaRecorder = new MediaRecorder(this.audioStream, options);

            // 5. 设置事件监听器。
            // 当有音频数据可用时，存入数据块数组
            this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data); };
            // 当录制停止时，处理最终的音频数据
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length === 0) {
                    Utils.log("未录制到音频数据。", Utils.logLevels.WARN);
                    this.releaseAudioResources();
                    return;
                }
                // 将音频块合并为 Blob，并转为 Data URL 以供预览和发送
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.onloadend = () => {
                    MessageManager.audioData = reader.result; // 存储音频数据 (Data URL)
                    MessageManager.audioDuration = this.recordingDuration; // 存储时长
                    if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayAudioPreview(reader.result, this.recordingDuration);
                };
                reader.readAsDataURL(audioBlob);
                this.audioChunks = []; // 清空数据块
            };
            Utils.log('麦克风权限已授予。', Utils.logLevels.INFO);
            return true;
        } catch (error) {
            // 6. 如果出错，则记录日志、通知用户并禁用相关功能。
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
     * @function startRecording
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
     * @function stopRecording
     * @returns {void}
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
     * 内部方法：启动一个定时器，定期更新录音时长并通知 UI 更新。
     * @function _updateRecordingTimerInterval
     * @returns {void}
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
     * @function playAudio
     * @param {HTMLElement} buttonElement - 被点击的播放按钮元素。
     * @returns {void}
     */
    playAudio: function(buttonElement) {
        const audioDataUrl = buttonElement.dataset.audio;
        if (!audioDataUrl) return;

        // 查找当前按钮下的播放实例
        const existingAudio = buttonElement.querySelector('audio.playing-audio-instance');
        if (existingAudio) {
            // 如果存在，则暂停并移除，实现“点击同按钮暂停”
            existingAudio.pause();
            existingAudio.remove();
            buttonElement.innerHTML = '▶'; // 重置按钮图标
            return;
        }

        // 停止页面上所有其他正在播放的音频实例
        document.querySelectorAll('audio.playing-audio-instance').forEach(aud => {
            aud.pause();
            const btn = aud.closest('.voice-message')?.querySelector('.play-voice-btn');
            if(btn) btn.innerHTML = '▶'; // 重置其他按钮图标
            aud.remove();
        });

        // 创建新的 Audio 对象并播放
        const audio = new Audio(audioDataUrl);
        audio.className = "playing-audio-instance"; // 添加类名以便查找
        buttonElement.innerHTML = '❚❚'; // 设置为暂停图标
        audio.play().catch(e => { Utils.log("播放音频时出错: "+e, Utils.logLevels.ERROR); buttonElement.innerHTML = '▶'; });
        audio.onended = () => { buttonElement.innerHTML = '▶'; audio.remove(); };
        audio.onerror = () => { buttonElement.innerHTML = '⚠️'; setTimeout(() => {buttonElement.innerHTML = '▶'; audio.remove();}, 2000); };
    },

    /**
     * 释放所有音频资源，如停止麦克风流和录音器。
     * @function releaseAudioResources
     * @returns {void}
     */
    releaseAudioResources: function() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
            Utils.log('麦克风流已释放。', Utils.logLevels.INFO);
        }
        if (this.mediaRecorder?.state !== "inactive") try { this.mediaRecorder.stop(); } catch(e) { /* 忽略停止错误 */ }
        this.mediaRecorder = null; this.audioChunks = [];
        if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; }
    },

    /**
     * 格式化文件大小为可读字符串（如 KB, MB）。
     * @function formatFileSize
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
     * @function processFile
     * @param {File} file - 要处理的文件对象。
     * @returns {Promise<void>}
     */
    processFile: async function(file) {
        if (!file) return;
        // 检查文件大小
        if (file.size > AppSettings.media.maxFileSize) {
            NotificationUIManager.showNotification(`文件过大。最大: ${this.formatFileSize(AppSettings.media.maxFileSize)}。`, 'error');
            return;
        }
        // 如果已有待发送音频，则提示用户
        if (MessageManager.audioData) {
            NotificationUIManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        try {
            // 处理流程如下：
            // 1. 计算文件哈希。
            const fileHash = await Utils.generateFileHash(file);
            // 2. 为预览创建 Object URL。
            const previewUrl = URL.createObjectURL(file);

            // 3. 构造文件对象并存储到 MessageManager，以备发送。
            MessageManager.selectedFile = {
                blob: file, // 原始 File 对象 (也是 Blob)
                hash: fileHash,
                name: file.name,
                type: file.type,
                size: file.size,
                previewUrl: previewUrl // 用于预览的 Object URL
            };
            // 4. 更新 UI 显示文件预览。
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayFilePreview(MessageManager.selectedFile);
        } catch (error) {
            Utils.log(`处理文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理文件时出错。', 'error');
        }
    },

    /**
     * 处理用户上传的贴图文件。
     * @function processStickerFile
     * @param {File} file - 要处理的贴图文件对象。
     * @returns {Promise<void>}
     */
    processStickerFile: async function(file) {
        if (!file) return;

        // 1. 检查文件大小
        if (file.size > AppSettings.media.maxStickerSize) {
            NotificationUIManager.showNotification(`贴图文件过大。最大: ${this.formatFileSize(AppSettings.media.maxStickerSize)}。`, 'error');
            return;
        }

        // 2. 检查文件类型
        const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            NotificationUIManager.showNotification('不支持的贴图文件类型。请使用 PNG, JPG, GIF 或 WEBP。', 'error');
            return;
        }

        try {
            // 3. 计算文件哈希作为唯一ID
            const fileHash = await Utils.generateFileHash(file);
            const stickerFileObject = {
                id: fileHash,
                name: file.name,
                blob: file
            };
            // 4. 触发事件，将处理好的贴图对象传递给UI层进行下一步操作（如保存）。
            EventEmitter.emit('stickerFileProcessed', stickerFileObject);
        } catch (error) {
            Utils.log(`处理贴图文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理贴图文件时出错。', 'error');
        }
    },

    /**
     * 处理文件输入框的 change 事件。
     * @function handleFileSelect
     * @param {Event} event - change 事件对象。
     * @returns {Promise<void>}
     */
    handleFileSelect: async function(event) {
        const file = event.target.files[0];
        if (file) {
            await this.processFile(file);
        }
        // NOTE: 重置文件输入框的值，确保可以再次选择同一个文件。
        if(event && event.target) {
            event.target.value = '';
        }
    },

    /**
     * 捕获屏幕或窗口内容作为截图。
     * @function captureScreen
     * @description 用户同意分享后，延迟片刻再进行实际截图，然后将数据发送给编辑器。
     * @returns {Promise<void>}
     */
    captureScreen: async function() {
        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            NotificationUIManager.showNotification('您的浏览器不支持屏幕捕获功能。', 'error');
            return;
        }
        // 检查是否有其他待发送的媒体
        if (MessageManager.audioData || MessageManager.selectedFile) {
            NotificationUIManager.showNotification('已有待发送的媒体。请先取消。', 'warning');
            return;
        }

        let stream = null;
        try {
            // 处理流程如下：
            // 1. 请求用户授权屏幕共享。
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });

            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                NotificationUIManager.showNotification('无法获取视频流用于截图。', 'error');
                stream.getTracks().forEach(track => track.stop());
                return;
            }

            // 2. 延迟片刻（0.3秒）再截图，给用户切换窗口或准备的时间。
            setTimeout(async () => {
                if (!stream || !stream.active || videoTrack.readyState === 'ended') {
                    Utils.log('延迟后屏幕共享流已停止或无效。', Utils.logLevels.WARN);
                    if (stream) stream.getTracks().forEach(track => track.stop());
                    return;
                }

                try {
                    // 3. 使用 ImageCapture API 从视频轨道抓取当前帧。
                    const imageCapture = new ImageCapture(videoTrack);
                    const bitmap = await imageCapture.grabFrame();

                    // 4. 将抓取的帧绘制到 Canvas 上。
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(bitmap, 0, 0);

                    // 5. 将 Canvas 内容转换为 Blob 对象。
                    canvas.toBlob(async function(blob) {
                        if (!blob) {
                            NotificationUIManager.showNotification('截图失败：无法生成图片 Blob。', 'error');
                            if (stream) stream.getTracks().forEach(track => track.stop());
                            return;
                        }
                        // 6. 将 Blob 转换为 Data URL，以供编辑器使用。
                        const reader = new FileReader();
                        reader.onloadend = function() {
                            const dataUrl = reader.result;
                            // 7. 通过 EventEmitter 发送原始截图数据给编辑器模块。
                            if (typeof EventEmitter !== 'undefined') {
                                EventEmitter.emit('rawScreenshotCaptured', {
                                    dataUrl: dataUrl,
                                    blob: blob,
                                    originalStream: stream // 传递流，以便编辑器在完成后可以停止它
                                });
                                Utils.log("已捕获原始截图并发送事件。", Utils.logLevels.INFO);
                            } else {
                                Utils.log("EventEmitter 未定义，无法发送截图数据到编辑器。", Utils.logLevels.ERROR);
                                if (stream) stream.getTracks().forEach(track => track.stop());
                            }
                        };
                        reader.onerror = function() {
                            NotificationUIManager.showNotification('截图失败：无法读取图片数据。', 'error');
                            if (stream) stream.getTracks().forEach(track => track.stop());
                        };
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                } catch (captureError) {
                    Utils.log(`延迟截图或处理时出错: ${captureError.message}`, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification(`截图处理失败: ${captureError.message}`, 'error');
                    if (stream) stream.getTracks().forEach(track => track.stop());
                }
            }, 300);

        } catch (err) {
            Utils.log('屏幕捕获初始设置失败: ' + err.message, Utils.logLevels.ERROR);
            if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                NotificationUIManager.showNotification('截图功能启动失败: ' + err.message, 'error');
            } else {
                NotificationUIManager.showNotification('截图已取消或未授权。', 'info');
            }
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        }
    }
};