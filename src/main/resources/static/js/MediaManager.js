/**
 * @file MediaManager.js
 * @description 核心媒体管理器，负责处理媒体相关的核心逻辑，如麦克风权限、语音录制、文件处理和屏幕截图。
 *              它不直接操作 UI，而是将 UI 更新委托给 MediaUIManager 或通过 EventEmitter 通知。
 *              截图功能现在会将原始截图数据传递给 ScreenshotEditorUIManager 进行编辑。
 *              用户同意分享后，延迟1秒进行截图。
 *              修改: processFile 和截图现在会计算文件哈希，并将Blob和哈希传递给MessageManager，而不是Data URL。
 * @module MediaManager
 * @exports {object} MediaManager - 对外暴露的单例对象，包含媒体处理的核心方法。
 * @property {function} initVoiceRecording - 初始化语音录制功能，检查浏览器支持。
 * @property {function} startRecording - 开始录制语音。
 * @property {function} stopRecording - 停止录制语音。
 * @property {function} processFile - 处理用户选择或拖放的文件，进行大小检查并读取数据。
 * @property {function} handleFileSelect - 处理文件输入框的 change 事件。
 * @property {function} captureScreen - 捕获屏幕或窗口内容作为截图。
 * @dependencies Config, Utils, NotificationUIManager, MessageManager, MediaUIManager, EventEmitter
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (绑定录音和截图按钮事件), MessageManager (播放语音消息)
 */
const MediaManager = {
    mediaRecorder: null, // MediaRecorder 实例
    audioChunks: [],     // 存储录制的音频数据块
    recordingTimer: null, // 录音计时器
    recordingStartTime: null, // 录音开始时间
    recordingDuration: 0,   // 录音时长
    audioStream: null,    // 本地音频流

    /**
     * 初始化语音录制功能，检查浏览器是否支持媒体设备 API。
     * 同时，初始化对截图编辑完成和取消事件的监听。
     */
    initVoiceRecording: function() {
        const voiceButton = document.getElementById('voiceButtonMain');
        // 检查 getUserMedia 支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持媒体设备。', Utils.logLevels.WARN);
            if(voiceButton) voiceButton.disabled = true; // 禁用语音按钮
        }
        // 检查截图 API (getDisplayMedia) 支持
        const screenshotMainBtn = document.getElementById('screenshotMainBtn');
        if (screenshotMainBtn && typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            Utils.log('浏览器不支持 getDisplayMedia API。截图功能将不可用。', Utils.logLevels.WARN);
            screenshotMainBtn.disabled = true; // 禁用截图按钮
            screenshotMainBtn.title = '截图功能不可用';
        }

        // 监听截图编辑完成和取消事件 (通过 EventEmitter)
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.on('screenshotEditingComplete', async function(editedFileObject) { // editedFileObject 包含 { blob, hash, name, type, size, previewUrl }
                // 将编辑后的图片设置为待发送文件
                MessageManager.selectedFile = editedFileObject; // editedFileObject 已经包含了所需的全部信息
                // 调用UI管理器显示预览
                if (typeof MediaUIManager !== 'undefined') {
                    MediaUIManager.displayFilePreview(editedFileObject); // 使用包含 previewUrl 的对象
                }
                Utils.log('Edited screenshot ready for preview.', Utils.logLevels.INFO);
                NotificationUIManager.showNotification('截图编辑完成，已添加到预览。', 'success');
            });

            EventEmitter.on('screenshotEditingCancelled', function() {
                Utils.log('Screenshot editing was cancelled by user or editor.', Utils.logLevels.INFO);
                // 如果当前预览的是临时截图文件，则取消它
                if (MessageManager.selectedFile && MessageManager.selectedFile.name && MessageManager.selectedFile.name.startsWith("screenshot_temp_")) { // 假设临时截图有特定前缀
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
     * @returns {Promise<boolean>} - 是否成功获取权限。
     */
    requestMicrophonePermission: async function() {
        // 如果已有活动的录制器或流，则认为权限已获取
        if (this.mediaRecorder && this.audioStream?.active && this.mediaRecorder.state !== "inactive") return true;
        this.releaseAudioResources(); // 先释放旧资源
        try {
            // 请求麦克风权限
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: Config.media.audioConstraints || true });
            // 设置 MediaRecorder 选项，优先使用 opus 编码的 webm
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) { // 如果不支持，尝试 ogg
                options.mimeType = 'audio/ogg;codecs=opus';
                if(!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'audio/webm'; // 再回退到普通 webm
            }
            this.mediaRecorder = new MediaRecorder(this.audioStream, options); // 创建录制器
            // 数据可用时，添加到 chunks 数组
            this.mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) this.audioChunks.push(event.data); };
            // 录制停止时，处理音频数据
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length === 0) { // 如果没有录到数据
                    Utils.log("未录制到音频数据。", Utils.logLevels.WARN);
                    this.releaseAudioResources(); // 释放资源
                    return;
                }
                // 将音频块合并为 Blob
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                const reader = new FileReader(); // 使用 FileReader 转为 Data URL
                reader.onloadend = () => {
                    MessageManager.audioData = reader.result; // 存储音频数据 (Data URL)
                    MessageManager.audioDuration = this.recordingDuration; // 存储时长
                    // 更新UI显示音频预览
                    if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayAudioPreview(reader.result, this.recordingDuration);
                };
                reader.readAsDataURL(audioBlob);
                this.audioChunks = []; // 清空音频块
            };
            Utils.log('麦克风权限已授予。', Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`获取麦克风权限时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('麦克风访问被拒绝或不可用。', 'error');
            const voiceButton = document.getElementById('voiceButtonMain');
            if(voiceButton) voiceButton.disabled = true; // 禁用语音按钮
            this.releaseAudioResources(); // 释放资源
            return false;
        }
    },

    /**
     * 开始录制语音。
     * @returns {Promise<void>}
     */
    startRecording: async function() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return; // 如果已在录制，则返回
        const permissionGranted = await this.requestMicrophonePermission(); // 请求权限
        if (!permissionGranted) return; // 无权限则返回
        try {
            this.audioChunks = []; // 清空旧数据块
            this.mediaRecorder.start(); // 开始录制
            this.recordingStartTime = Date.now(); // 记录开始时间
            this.recordingDuration = 0; // 重置时长
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(true); // 更新UI状态
            this._updateRecordingTimerInterval(); // 启动计时器更新
            Utils.log('音频录制已开始。', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`开始录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources(); // 出错时释放资源
        }
    },

    /**
     * 停止录制语音。
     */
    stopRecording: function() {
        if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') { // 如果未在录制
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false); // 重置UI
            this.releaseAudioResources(); // 释放资源
            return;
        }
        try {
            this.mediaRecorder.stop(); // 停止录制
            clearInterval(this.recordingTimer); // 清除计时器
            this.recordingTimer = null;
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.setRecordingButtonActive(false); // 更新UI状态
            Utils.log('音频录制已停止。', Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`停止录制失败: ${error}`, Utils.logLevels.ERROR);
            this.releaseAudioResources(); // 出错时释放资源
        }
    },

    /**
     * @private
     * 启动一个定时器，定期更新录音时长，并通知 MediaUIManager 更新 UI。
     */
    _updateRecordingTimerInterval: function() {
        if (this.recordingTimer) clearInterval(this.recordingTimer); // 清除旧定时器
        const updateUI = () => {
            if (!this.recordingStartTime) return; // 如果未开始录制，则返回
            const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000); // 计算已录制秒数
            this.recordingDuration = elapsedSeconds; // 更新时长
            // 更新UI显示计时器
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.updateRecordingButtonTimerUI(elapsedSeconds, Config.media.maxAudioDuration);
            // 如果达到最大时长，则停止录制
            if (elapsedSeconds >= Config.media.maxAudioDuration) this.stopRecording();
        };
        updateUI(); // 立即执行一次
        this.recordingTimer = setInterval(updateUI, 1000); // 每秒执行一次
    },

    /**
     * 播放指定的语音消息。
     * @param {HTMLElement} buttonElement - 被点击的播放按钮元素。
     */
    playAudio: function(buttonElement) {
        const audioDataUrl = buttonElement.dataset.audio; // 获取音频数据URL
        if (!audioDataUrl) return;

        // 如果当前按钮正在播放，则暂停并移除播放实例
        const existingAudio = buttonElement.querySelector('audio.playing-audio-instance');
        if (existingAudio) {
            existingAudio.pause();
            existingAudio.remove();
            buttonElement.innerHTML = '▶'; // 重置按钮图标
            return;
        }

        // 停止其他所有正在播放的音频实例
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
        // 播放结束时处理
        audio.onended = () => { buttonElement.innerHTML = '▶'; audio.remove(); };
        // 播放错误时处理
        audio.onerror = () => { buttonElement.innerHTML = '⚠️'; setTimeout(() => {buttonElement.innerHTML = '▶'; audio.remove();}, 2000); };
    },

    /**
     * 释放所有音频资源，如停止麦克风流。
     */
    releaseAudioResources: function() {
        if (this.audioStream) { // 停止所有轨道
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
            Utils.log('麦克风流已释放。', Utils.logLevels.INFO);
        }
        // 停止 MediaRecorder (如果正在录制)
        if (this.mediaRecorder?.state !== "inactive") try { this.mediaRecorder.stop(); } catch(e) { /* 忽略停止错误 */ }
        this.mediaRecorder = null; this.audioChunks = []; // 重置录制器和数据块
        if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; } // 清除计时器
    },

    /**
     * 格式化文件大小为可读字符串（如 KB, MB）。
     * @param {number} bytes - 文件大小（字节）。
     * @returns {string} - 格式化后的字符串。
     */
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']; // 大小单位
        const i = Math.floor(Math.log(bytes) / Math.log(k)); // 计算单位索引
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; // 格式化输出
    },

    /**
     * 处理用户选择或拖放的文件。
     * @param {File} file - 要处理的文件对象。
     * @returns {Promise<void>}
     */
    processFile: async function(file) {
        if (!file) return;
        // 检查文件大小
        if (file.size > Config.media.maxFileSize) {
            NotificationUIManager.showNotification(`文件过大。最大: ${this.formatFileSize(Config.media.maxFileSize)}。`, 'error');
            return;
        }
        // 如果已有待发送音频，则提示用户
        if (MessageManager.audioData) {
            NotificationUIManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        try {
            const fileHash = await Utils.generateFileHash(file); // 计算文件哈希
            const previewUrl = URL.createObjectURL(file); // 为预览创建Object URL

            // 存储文件信息到 MessageManager
            MessageManager.selectedFile = {
                blob: file, // 原始File对象 (也是Blob)
                hash: fileHash,
                name: file.name,
                type: file.type,
                size: file.size,
                previewUrl: previewUrl // 用于预览的Object URL
            };
            // 更新UI显示文件预览
            if (typeof MediaUIManager !== 'undefined') MediaUIManager.displayFilePreview(MessageManager.selectedFile);
        } catch (error) {
            Utils.log(`处理文件时出错: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('处理文件时出错。', 'error');
        }
    },

    /**
     * 处理文件输入框的 change 事件。
     * @param {Event} event - change 事件对象。
     * @returns {Promise<void>}
     */
    handleFileSelect: async function(event) {
        const file = event.target.files[0]; // 获取选择的第一个文件
        if (file) {
            await this.processFile(file); // 处理文件
        }
        // 重置文件输入框，以便可以再次选择同一个文件
        if(event && event.target) {
            event.target.value = '';
        }
    },

    /**
     * @description 捕获屏幕或窗口内容作为截图。用户同意分享后，延迟1秒再进行实际截图，然后将数据发送给编辑器。
     * @returns {Promise<void>}
     */
    captureScreen: async function() {
        // 检查 API 支持
        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            NotificationUIManager.showNotification('您的浏览器不支持屏幕捕获功能。', 'error');
            return;
        }
        // 检查是否有待发送的媒体
        if (MessageManager.audioData) {
            NotificationUIManager.showNotification('已有待发送的语音消息。请先取消。', 'warning');
            return;
        }
        if (MessageManager.selectedFile) {
            NotificationUIManager.showNotification('已有待发送的文件。请先取消。', 'warning');
            return;
        }

        let stream = null; // 屏幕共享流
        try {
            // 请求屏幕共享权限
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' }, // 捕获光标
                audio: false // 不捕获音频
            });

            const videoTrack = stream.getVideoTracks()[0]; // 获取视频轨道
            if (!videoTrack) { // 如果无视频轨道
                NotificationUIManager.showNotification('无法获取视频流用于截图。', 'error');
                stream.getTracks().forEach(track => track.stop()); // 停止流
                return;
            }

            NotificationUIManager.showNotification('1秒后截取屏幕...', 'info', 1000); // 提示用户

            setTimeout(async () => { // 延迟1秒截图
                // 再次检查流是否仍然活动
                if (!stream || !stream.active || videoTrack.readyState === 'ended') {
                    Utils.log('MediaManager.captureScreen: 延迟后屏幕共享流已停止或无效。', Utils.logLevels.WARN);
                    if (stream) stream.getTracks().forEach(track => track.stop());
                    return;
                }

                try {
                    const imageCapture = new ImageCapture(videoTrack); // 创建 ImageCapture 实例
                    const bitmap = await imageCapture.grabFrame(); // 抓取当前帧

                    // 将位图绘制到 Canvas
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(bitmap, 0, 0);

                    // 将 Canvas 内容转为 Blob
                    canvas.toBlob(async function(blob) { // 注意这里变成 async
                        if (!blob) { // 如果生成 Blob 失败
                            NotificationUIManager.showNotification('截图失败：无法生成图片 Blob。', 'error');
                            if (stream) stream.getTracks().forEach(track => track.stop());
                            return;
                        }
                        // 将 Blob 转为 Data URL (用于传递给编辑器，编辑器内部可能需要Data URL显示)
                        const reader = new FileReader();
                        reader.onloadend = function() {
                            const dataUrl = reader.result;
                            // 通过 EventEmitter 发送原始截图数据给编辑器
                            if (typeof EventEmitter !== 'undefined') {
                                EventEmitter.emit('rawScreenshotCaptured', { // 编辑器接收原始 dataUrl 和 blob
                                    dataUrl: dataUrl, // 编辑器仍然使用 dataUrl 进行初始显示和编辑
                                    blob: blob,       // 编辑器也接收 blob，以便在编辑确认后使用
                                    originalStream: stream // 传递原始流，以便编辑器可以停止它
                                });
                                Utils.log("Raw screenshot captured after delay, event emitted.", Utils.logLevels.INFO);
                            } else {
                                Utils.log("MediaManager.captureScreen: EventEmitter 未定义，无法发送截图数据到编辑器。", Utils.logLevels.ERROR);
                                if (stream) stream.getTracks().forEach(track => track.stop()); // 确保停止流
                            }
                        };
                        reader.onerror = function() { // 读取 Blob 失败
                            NotificationUIManager.showNotification('截图失败：无法读取图片数据。', 'error');
                            if (stream) stream.getTracks().forEach(track => track.stop());
                        };
                        reader.readAsDataURL(blob);
                    }, 'image/png'); // 指定输出格式为 PNG
                } catch (captureError) { // 截图处理错误
                    Utils.log(`延迟截图或处理时出错: ${captureError.message}`, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification(`截图处理失败: ${captureError.message}`, 'error');
                    if (stream) stream.getTracks().forEach(track => track.stop());
                }
            }, 1000); // 延迟1秒

        } catch (err) { // 请求屏幕共享权限失败
            Utils.log('屏幕捕获初始设置失败: ' + err.message, Utils.logLevels.ERROR);
            if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') { // 如果不是用户取消或拒绝
                NotificationUIManager.showNotification('截图功能启动失败: ' + err.message, 'error');
            } else {
                NotificationUIManager.showNotification('截图已取消或未授权。', 'info');
            }
            if (stream) { // 如果在获取流后出错
                stream.getTracks().forEach(track => track.stop());
            }
        }
    }
};