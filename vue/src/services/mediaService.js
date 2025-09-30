import { ref } from 'vue';
// --- MODIFICATION START: Import the new unified hashing function ---
import { log, generateHash } from '@/utils';
// --- MODIFICATION END ---
import { eventBus } from './eventBus';
import AppSettings from '@/config/AppSettings';
import { dbService } from './dbService';
// --- MODIFICATION START: Import uiStore to check for screenshot editor ---
import { useUiStore } from '@/stores/uiStore';
// --- MODIFICATION END ---

const mediaRecorder = ref(null);
const audioChunks = ref([]);
const recordingStartTime = ref(null);
const localAudioStream = ref(null);

export const mediaService = {

    async startRecording() {
        if (mediaRecorder.value?.state === 'recording') return null;

        try {
            if (!localAudioStream.value || localAudioStream.value.getAudioTracks().some(t => t.readyState === 'ended')) {
                this.releaseAudioResources();
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

    stopRecording(cancel = false) {
        if (mediaRecorder.value?.state === 'recording') {
            mediaRecorder.value.stop();
        }
        if (cancel) {
            audioChunks.value = [];
        }
    },

    releaseAudioResources() {
        if (localAudioStream.value) {
            localAudioStream.value.getTracks().forEach(track => track.stop());
            localAudioStream.value = null;
        }
        mediaRecorder.value = null;
    },

    async checkDevices() {
        const result = {
            video: { status: 'unchecked', stream: null, error: null },
            audio: { status: 'unchecked', stream: null, error: null },
        };

        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            result.video.status = 'ok';
            result.video.stream = videoStream;
        } catch (e) {
            result.video.error = e.name;
            if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
                result.video.status = 'not_found';
            } else if (e.name === 'NotAllowedError') {
                result.video.status = 'denied';
            } else {
                result.video.status = 'error';
            }
        }

        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            result.audio.status = 'ok';
            audioStream.getTracks().forEach(track => track.stop());
        } catch (e) {
            result.audio.error = e.name;
            if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
                result.audio.status = 'not_found';
            } else if (e.name === 'NotAllowedError') {
                result.audio.status = 'denied';
            } else {
                result.audio.status = 'error';
            }
        }
        return result;
    },

    // --- MODIFICATION START: Refactored captureScreen for both screenshots and screen sharing ---
    async captureScreen(contentHint = 'motion', forScreenshot = false) {
        log(`Screen capture initiated. For screenshot: ${forScreenshot}`, 'INFO');

        if (window.Android && typeof window.Android.startScreenCapture === 'function') {
            log('Invoking native Android screen capture...', 'INFO');
            eventBus.emit('showNotification', { message: '请授权屏幕录制以完成操作...', type: 'info' });
            window.Android.startScreenCapture();
            return null; // Native handler will call back
        }

        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            log('getDisplayMedia API is not supported.', 'ERROR');
            eventBus.emit('showNotification', { message: '您的浏览器不支持屏幕捕获。', type: 'error' });
            return null;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always', contentHint },
                audio: false
            });
            log('Successfully obtained MediaStream from getDisplayMedia.', 'DEBUG');

            // If the goal is just screen sharing, return the stream immediately.
            if (!forScreenshot) {
                return stream;
            }

            // --- Logic below is now ONLY for taking a single screenshot ---
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                throw new Error("在媒体流中未找到视频轨道。");
            }

            const tempVideo = document.createElement('video');
            tempVideo.style.position = 'fixed';
            tempVideo.style.top = '-9999px';
            tempVideo.style.left = '-9999px';
            tempVideo.muted = true;
            tempVideo.srcObject = stream;
            document.body.appendChild(tempVideo);

            videoTrack.onended = () => {
                log('Video track ended, likely by user action.', 'INFO');
                if (tempVideo) tempVideo.remove();
                if (!useUiStore().activeModal === 'screenshotEditor') {
                    stream.getTracks().forEach(track => track.stop());
                }
            };

            await new Promise((resolve, reject) => {
                tempVideo.onloadedmetadata = resolve;
                tempVideo.onerror = reject;
            });
            await tempVideo.play();

            const imageCapture = new ImageCapture(videoTrack);
            const bitmap = await imageCapture.grabFrame();

            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

            if (blob) {
                log('Canvas converted to Blob successfully for screenshot.', 'INFO');
                const dataUrl = URL.createObjectURL(blob);
                // The editor will be responsible for stopping the stream tracks
                eventBus.emit('screenshot:raw-captured', { dataUrl, blob, originalStream: stream });
            } else {
                throw new Error('canvas.toBlob() resulted in a null blob.');
            }

            // Clean up the temporary video element
            tempVideo.remove();
            return null; // Return null as the result was handled via event bus

        } catch (err) {
            if (err.name === 'NotAllowedError') {
                log('User denied screen sharing permission.', 'INFO');
                eventBus.emit('showNotification', { message: '您取消了屏幕分享。', type: 'info' });
            } else {
                log(`getDisplayMedia failed: ${err}`, 'ERROR');
                eventBus.emit('showNotification', { message: `操作失败: ${err.message}`, type: 'error' });
            }
            return null; // Explicitly return null on failure
        }
    },
    // --- MODIFICATION END ---

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
            // --- MODIFICATION START: Use the new worker-based hash function ---
            const hash = await generateHash(file);
            // --- MODIFICATION END ---
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
                const dataUrl = URL.createObjectURL(blob);
                eventBus.emit('screenshot:raw-captured', {
                    dataUrl: dataUrl,
                    blob: blob,
                    originalStream: null
                });
            }
        });
};