import { ref } from 'vue';
import { log, generateId, generateFileHash } from '@/utils';
import { eventBus } from './eventBus';
import AppSettings from '@/config/AppSettings';
import { dbService } from './dbService';

// --- 模块内部状态 ---
const mediaRecorder = ref(null);
const audioChunks = ref([]);
const recordingStartTime = ref(null);
const localAudioStream = ref(null);

/**
 * 封装所有与本地设备媒体（麦克风、屏幕）交互的底层逻辑。
 */
export const mediaService = {

    // --- 语音录制 ---

    async startRecording() {
        if (mediaRecorder.value?.state === 'recording') return null;

        try {
            if (!localAudioStream.value || localAudioStream.value.getAudioTracks().some(t => t.readyState === 'ended')) {
                this.releaseAudioResources(); // Clean up previous stream if ended
                localAudioStream.value = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints });
            }
            mediaRecorder.value = new MediaRecorder(localAudioStream.value);
            mediaRecorder.value.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.value.push(event.data);
            };

            mediaRecorder.value.onstop = () => {
                if (audioChunks.value.length === 0) return;
                const audioBlob = new Blob(audioChunks.value, { type: mediaRecorder.value.mimeType });
                const duration = Math.round((Date.now() - recordingStartTime.value) / 1000);
                eventBus.emit('recording:complete', { blob: audioBlob, duration });
                audioChunks.value = [];
            };

            mediaRecorder.value.start();
            recordingStartTime.value = Date.now();
            return true;
        } catch (error) {
            log(`获取麦克风权限失败: ${error}`, 'ERROR');
            eventBus.emit('showNotification', { message: '无法访问麦克风。请检查权限。', type: 'error' });
            this.releaseAudioResources();
            return false;
        }
    },

    stopRecording() {
        if (mediaRecorder.value?.state === 'recording') {
            mediaRecorder.value.stop();
        }
        // Don't release resources immediately, wait for onstop event to fire
    },

    releaseAudioResources() {
        if (localAudioStream.value) {
            localAudioStream.value.getTracks().forEach(track => track.stop());
            localAudioStream.value = null;
        }
        mediaRecorder.value = null;
    },

    // --- 截图 ---

    async captureScreen() {
        if (window.Android && typeof window.Android.startScreenCapture === 'function') {
            log('调用原生安卓截图...', 'INFO');
            eventBus.emit('showNotification', { message: '请授权屏幕录制以完成截图...', type: 'info' });
            window.Android.startScreenCapture();
            return;
        }

        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            eventBus.emit('showNotification', { message: '您的浏览器不支持屏幕捕获。', type: 'error' });
            return;
        }

        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });

            setTimeout(async () => {
                if (!stream || !stream.active) return;

                try {
                    const videoTrack = stream.getVideoTracks()[0];
                    // Use ImageCapture for better performance if available
                    const imageCapture = new ImageCapture(videoTrack);
                    const bitmap = await imageCapture.grabFrame();
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    canvas.getContext('2d').drawImage(bitmap, 0, 0);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            const dataUrl = URL.createObjectURL(blob);
                            eventBus.emit('screenshot:raw-captured', { dataUrl, blob, originalStream: stream });
                        } else {
                            stream.getTracks().forEach(track => track.stop());
                        }
                    }, 'image/png');
                } catch (captureError) {
                    log(`处理截图帧时出错: ${captureError}`, 'ERROR');
                    stream.getTracks().forEach(track => track.stop());
                }
            }, 300);

        } catch (err) {
            if (err.name !== 'NotAllowedError') {
                eventBus.emit('showNotification', { message: `截图失败: ${err.message}`, type: 'error' });
            }
        }
    },

    // --- 贴图处理 ---
    async processStickerFile(file) {
        if (file.size > AppSettings.media.maxStickerSize) {
            eventBus.emit('showNotification', { message: `贴图文件过大 (上限 ${AppSettings.media.maxStickerSize / 1024 / 1024}MB)`, type: 'warning' });
            return null;
        }
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
            eventBus.emit('showNotification', { message: '不支持的贴图格式。', type: 'warning' });
            return null;
        }

        try {
            const hash = await generateFileHash(file);
            const stickerData = { id: hash, name: file.name, blob: file };
            await dbService.setItem('stickers', stickerData);
            eventBus.emit('showNotification', { message: '贴图已添加！', type: 'success' });
            return stickerData;
        } catch (error) {
            log(`处理贴图文件时出错: ${error}`, 'ERROR');
            eventBus.emit('showNotification', { message: '保存贴图失败。', type: 'error' });
            return null;
        }
    },
};

// 全局函数，供原生安卓调用
window.handleNativeScreenshot = function(base64DataUrl) {
    log('从原生安卓接收到截图数据', 'INFO');
    if (!base64DataUrl || !base64DataUrl.startsWith('data:image/')) {
        eventBus.emit('showNotification', { message: '从原生应用接收截图失败。', type: 'error' });
        return;
    }

    fetch(base64DataUrl)
        .then(res => res.blob())
        .then(blob => {
            if (blob) {
                const dataUrl = URL.createObjectURL(blob); // Create a URL for consistency, even though we have base64
                eventBus.emit('screenshot:raw-captured', {
                    dataUrl: dataUrl,
                    blob: blob,
                    originalStream: null
                });
            }
        });
};