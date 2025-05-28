
const MediaManager = {
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingStartTime: null,
    recordingDuration: 0,

    // 初始化语音录制
    initVoiceRecording: function() {
        // 不再主动请求麦克风权限，而是在按下录音按钮时请求

        // 检查是否在安全上下文(HTTPS)
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            Utils.log('语音录制功能需要HTTPS环境', Utils.logLevels.WARN);

            const voiceButton = document.getElementById('voiceButton');
            voiceButton.disabled = true;
            voiceButton.title = '录音功能需要HTTPS环境';
            voiceButton.innerHTML = '<span id="voiceButtonText">需要HTTPS</span>';

            // 显示提示消息
            UIManager.showNotification('语音录制功能需要HTTPS安全环境才能使用，请使用HTTPS访问本页面。', 'warning');
            return;
        }

        // 检查浏览器是否支持getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Utils.log('浏览器不支持录音功能', Utils.logLevels.WARN);

            const voiceButton = document.getElementById('voiceButton');
            voiceButton.disabled = true;
            voiceButton.title = '您的浏览器不支持录音功能';
            voiceButton.innerHTML = '<span id="voiceButtonText">录音不可用</span>';
            return;
        }

        // 启用录音按钮，但延迟请求权限
        document.getElementById('voiceButton').disabled = false;
        Utils.log('语音录制按钮已启用，将在用户点击时请求权限', Utils.logLevels.INFO);
    },

    // 添加一个新方法来请求麦克风权限
    requestMicrophonePermission: async function() {
        if (this.mediaRecorder) {
            return true; // 已经有权限了
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});

            // 尝试使用更好的编码方式
            const options = {};

            // 尝试使用 opus 编码器
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                options.mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                options.mimeType = 'audio/mp4';
            }

            this.mediaRecorder = new MediaRecorder(stream, options);

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, {type: options.mimeType || 'audio/webm'});
                const reader = new FileReader();

                reader.onloadend = () => {
                    MessageManager.audioData = reader.result;
                    MessageManager.audioDuration = this.recordingDuration;
                    this.displayAudioPreview(reader.result, this.recordingDuration);
                };

                reader.readAsDataURL(audioBlob);
            };

            Utils.log('麦克风权限已获取', Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`获取麦克风权限失败: ${error.message}`, Utils.logLevels.ERROR);

            const voiceButton = document.getElementById('voiceButton');
            voiceButton.disabled = true;
            document.getElementById('voiceButtonText').textContent = '录音不可用';

            // 显示友好的错误提示
            UIManager.showNotification('无法访问麦克风，语音录制功能不可用。', 'error');
            return false;
        }
    },

    // 开始录音
    startRecording: async function() {
        // 先请求权限
        if (!this.mediaRecorder) {
            const permissionGranted = await this.requestMicrophonePermission();
            if (!permissionGranted) return;
        }

        try {
            this.audioChunks = [];
            this.mediaRecorder.start();
            this.recordingStartTime = Date.now();

            const voiceButton = document.getElementById('voiceButton');
            const voiceButtonText = document.getElementById('voiceButtonText');
            const voiceTimer = document.getElementById('voiceTimer');

            voiceButton.classList.add('recording');
            voiceButtonText.textContent = '停止录音';
            voiceTimer.style.display = 'inline';

            this.recordingTimer = setInterval(() => this.updateRecordingTimer(), 1000);
            this.updateRecordingTimer();

            Utils.log('开始录音', Utils.logLevels.DEBUG);
        } catch (error) {
            Utils.log(`开始录音失败: ${error.message}`, Utils.logLevels.ERROR);
        }
    },

    // 停止录音
    stopRecording: function () {
        if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;

        try {
            this.mediaRecorder.stop();
            clearInterval(this.recordingTimer);

            const voiceButton = document.getElementById('voiceButton');
            const voiceButtonText = document.getElementById('voiceButtonText');
            const voiceTimer = document.getElementById('voiceTimer');

            voiceButton.classList.remove('recording');
            voiceButtonText.textContent = '录音';
            voiceTimer.style.display = 'none';

            Utils.log('录音已停止', Utils.logLevels.DEBUG);
        } catch (error) {
            Utils.log(`停止录音失败: ${error.message}`, Utils.logLevels.ERROR);
        }
    },

    // 释放音频资源
    releaseAudioResources: function() {
        // 检查是否有活跃的媒体流
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            // 停止所有音频轨道
            this.mediaRecorder.stream.getTracks().forEach(track => {
                track.stop();
                Utils.log('麦克风资源已释放', Utils.logLevels.DEBUG);
            });
        }

        // 重置录音器
        this.mediaRecorder = null;
    },

    // 更新录音计时器
    updateRecordingTimer: function () {
        const now = Date.now();
        const duration = Math.floor((now - this.recordingStartTime) / 1000);
        this.recordingDuration = duration;

        const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
        const seconds = (duration % 60).toString().padStart(2, '0');
        document.getElementById('voiceTimer').textContent = `${minutes}:${seconds}`;

        // 如果超过最大录制时间，自动停止
        if (duration >= Config.media.maxAudioDuration) {
            this.stopRecording();
        }
    },

    // 显示音频预览
    displayAudioPreview: function (audioData, duration) {
        const container = document.getElementById('audioPreviewContainer');
        const formattedDuration = Utils.formatTime(duration);

        container.innerHTML = `
            <div class="voice-message">
                <button onclick="event.stopPropagation(); MediaManager.playAudio(this)" data-audio="${audioData}">
                    播放
                </button>
                <div class="voice-wave">
                    ${Array(5).fill('<div class="wave-bar"></div>').join('')}
                </div>
                <span class="duration">${formattedDuration}</span>
                <button onclick="MessageManager.cancelAudioData()">取消</button>
            </div>
            `;

        // 音频数据已保存，可以释放麦克风资源
        this.releaseAudioResources();
    },

    // 播放音频
    playAudio: function (button) {
        const audio = new Audio(button.dataset.audio);
        const originalText = button.textContent;

        button.textContent = '播放中...';
        audio.play();

        // 添加波形动画效果
        const waveContainer = button.nextElementSibling;
        if (waveContainer && waveContainer.classList.contains('voice-wave')) {
            waveContainer.classList.add('playing');
        }

        audio.onended = () => {
            button.textContent = originalText;
            if (waveContainer) {
                waveContainer.classList.remove('playing');
            }
        };

        audio.onerror = () => {
            button.textContent = '播放失败';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        };
    },

    // 格式化文件大小
    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 显示文件预览方法
    displayFilePreview: function (fileObj) {
        const container = document.getElementById('filePreviewContainer');
        const fileType = fileObj.type;
        const fileName = fileObj.name;
        let previewHtml = '';

        // 根据文件类型显示不同预览
        if (fileType.startsWith('image/')) {
            // 图片预览
            previewHtml = `
                <div class="file-preview">
                    <div class="file-preview-header">
                        <span>${fileName}</span>
                        <button onclick="MessageManager.cancelFileData()">取消</button>
                    </div>
                    <div class="file-preview-content">
                        <img src="${fileObj.data}" class="image-preview" alt="${fileName}">
                    </div>
                </div>
            `;
        } else if (fileType.startsWith('video/')) {
            // 视频预览
            previewHtml = `
                <div class="file-preview">
                    <div class="file-preview-header">
                        <span>${fileName}</span>
                        <button onclick="MessageManager.cancelFileData()">取消</button>
                    </div>
                    <div class="file-preview-content">
                        <video controls class="video-preview">
                            <source src="${fileObj.data}" type="${fileType}">
                            您的浏览器不支持视频预览
                        </video>
                    </div>
                </div>
            `;
        } else {
            // 其他文件类型，显示文件信息
            const fileSize = this.formatFileSize(fileObj.size);
            const fileIcon = this.getFileIcon(fileType);

            previewHtml = `
                <div class="file-preview">
                    <div class="file-preview-header">
                        <span>${fileName}</span>
                        <button onclick="MessageManager.cancelFileData()">取消</button>
                    </div>
                    <div class="file-preview-content file-info">
                        <div class="file-icon">${fileIcon}</div>
                        <div class="file-details">
                            <div class="file-name">${fileName}</div>
                            <div class="file-size">${fileSize}</div>
                            <div class="file-type">${fileType || '未知类型'}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        container.innerHTML = previewHtml;
    },

    // 获取文件图标
    getFileIcon: function(mimeType) {
        if (!mimeType) return '📄';

        if (mimeType.startsWith('image/')) return '🖼️';
        if (mimeType.startsWith('video/')) return '🎬';
        if (mimeType.startsWith('audio/')) return '🎵';

        if (mimeType === 'application/pdf') return '📕';
        if (mimeType.includes('word')) return '📘';
        if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📗';
        if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📙';

        if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜️';
        if (mimeType.includes('text')) return '📝';

        return '📄';
    },

    // 处理文件选择方法
    handleFileSelect: async function (event) {
        const file = event.target.files[0];
        if (!file) return;

        // 检查文件大小
        const maxFileSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxFileSize) {
            alert(`文件大小不能超过 ${maxFileSize / 1024 / 1024} MB`);
            return;
        }

        try {
            const reader = new FileReader();

            reader.onload = async (e) => {
                const fileData = e.target.result;
                const fileType = file.type;
                const fileName = file.name;
                const fileSize = file.size;

                // 设置消息对象
                MessageManager.selectedFile = {
                    data: fileData,
                    type: fileType,
                    name: fileName,
                    size: fileSize
                };

                // 显示文件预览
                this.displayFilePreview(MessageManager.selectedFile);
            };

            // 使用readAsDataURL读取为base64格式
            reader.readAsDataURL(file);
        } catch (error) {
            Utils.log(`处理文件失败: ${error.message}`, Utils.logLevels.ERROR);
            alert('处理文件失败');
        }
    }
};