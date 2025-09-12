import { ref } from 'vue';
import { log, generateFileHash } from '@/utils';
import { eventBus } from './eventBus';
import AppSettings from '@/config/AppSettings';
import { dbService } from './dbService';

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

    stopRecording() {
        if (mediaRecorder.value?.state === 'recording') {
            mediaRecorder.value.stop();
        }
    },

    releaseAudioResources() {
        if (localAudioStream.value) {
            localAudioStream.value.getTracks().forEach(track => track.stop());
            localAudioStream.value = null;
        }
        mediaRecorder.value = null;
    },

    // --- MODIFICATION START: A more robust screen capture implementation ---
    async captureScreen() {
        log('Screenshot capture initiated.', 'INFO');

        // 1. Native Android Bridge
        if (window.Android && typeof window.Android.startScreenCapture === 'function') {
            log('Invoking native Android screen capture...', 'INFO');
            eventBus.emit('showNotification', { message: '请授权屏幕录制以完成截图...', type: 'info' });
            window.Android.startScreenCapture();
            return;
        }

        // 2. Web API Check
        if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
            log('getDisplayMedia API is not supported.', 'ERROR');
            eventBus.emit('showNotification', { message: '您的浏览器不支持屏幕捕获。', type: 'error' });
            return;
        }

        let stream = null;
        let tempVideo = null;

        const cleanup = () => {
            log('Cleaning up screenshot resources.', 'DEBUG');
            stream?.getTracks().forEach(track => track.stop());
            if (tempVideo) {
                tempVideo.remove();
                tempVideo = null;
            }
        };

        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
            log('Successfully obtained MediaStream from getDisplayMedia.', 'DEBUG');

            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                throw new Error("在媒体流中未找到视频轨道。");
            }

            tempVideo = document.createElement('video');
            tempVideo.style.position = 'fixed';
            tempVideo.style.top = '-9999px';
            tempVideo.style.left = '-9999px';
            tempVideo.muted = true;
            tempVideo.srcObject = stream;
            document.body.appendChild(tempVideo);

            tempVideo.onloadedmetadata = async () => {
                log('Video metadata loaded, attempting to play.', 'DEBUG');
                try {
                    await tempVideo.play();
                    log('Temporary video is playing, ready to capture frame.', 'DEBUG');

                    const imageCapture = new ImageCapture(videoTrack);
                    const bitmap = await imageCapture.grabFrame();
                    log('Frame grabbed successfully.', 'DEBUG');

                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    canvas.getContext('2d').drawImage(bitmap, 0, 0);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            log('Canvas converted to Blob successfully.', 'INFO');
                            const dataUrl = URL.createObjectURL(blob);
                            eventBus.emit('screenshot:raw-captured', { dataUrl, blob, originalStream: stream });
                        } else {
                            log('canvas.toBlob() resulted in a null blob.', 'ERROR');
                            eventBus.emit('showNotification', { message: '截图失败：无法生成图片文件。', type: 'error' });
                            cleanup();
                        }
                    }, 'image/png');

                } catch (captureError) {
                    log(`Error during frame capture or processing: ${captureError}`, 'ERROR');
                    eventBus.emit('showNotification', { message: `截图处理失败: ${captureError.message}`, type: 'error' });
                    cleanup();
                }
            };

            videoTrack.onended = () => {
                log('Video track ended, likely by user action.', 'INFO');
                // The editor is responsible for cleanup, but if it happens before the editor opens, we clean up here.
                if (!useUiStore().activeModal === 'screenshotEditor') {
                    cleanup();
                }
            };

        } catch (err) {
            if (err.name === 'NotAllowedError') {
                log('User denied screen sharing permission.', 'INFO');
                eventBus.emit('showNotification', { message: '您取消了屏幕分享。', type: 'info' });
            } else {
                log(`getDisplayMedia failed: ${err}`, 'ERROR');
                eventBus.emit('showNotification', { message: `截图失败: ${err.message}`, type: 'error' });
            }
            cleanup();
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
                    originalStream: null // No stream from native
                });
            }
        });
};