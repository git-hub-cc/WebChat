import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { eventBus } from '@/services/eventBus';
import { webrtcService } from '@/services/webrtcService';
import { useUserStore } from './userStore';
import { useUiStore } from './uiStore';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import { log, generateId } from '@/utils';
import AppSettings from '@/config/AppSettings';

export const useCallStore = defineStore('call', () => {
    // --- STATE ---
    const localStream = ref(null);
    const remoteStream = ref(null);
    const currentPeerId = ref(null);
    const isCallActive = ref(false);
    const isCaller = ref(false);
    const isCallPending = ref(false);
    const isAudioMuted = ref(false);
    const isVideoEnabled = ref(true);
    const isScreenSharing = ref(false);
    const amISharingScreen = ref(false); // Tracks if the local user initiated the share
    const incomingCallInfo = ref(null);
    const isFullScreenCallViewVisible = ref(false);
    const callDuration = ref(0);
    const callQuality = ref({});
    const currentQualityPreset = ref('auto');
    // ✅ MODIFICATION START: Add state for screen share quality
    const currentScreenShareQualityPreset = ref('auto');
    // ✅ MODIFICATION END
    const isSpeaking = ref(false);
    const pendingScreenShareStream = ref(null);
    const globalAudioElement = ref(null);

    // [新增] 白板功能相关状态
    const isWhiteboardActive = ref(false);
    const currentDrawingTool = ref('pen');
    const currentDrawingColor = ref('#FF0000'); // 默认为红色
    const drawingHistory = ref([]); // 存储所有绘图操作

    let callTimer = null;
    let musicPlayer = null;
    let isMusicPlaying = false;
    let boundEnableMusicPlay = null;
    let callRequestTimeout = null;
    let callStartTime = null;
    let audioContext = null;
    let analyserNode = null;
    let vadInterval = null;

    // --- GETTERS ---
    const peerContact = computed(() => {
        const userStore = useUserStore();
        const peerId = currentPeerId.value || incomingCallInfo.value?.peerId;
        return peerId ? userStore.contacts[peerId] : null;
    });
    const callDurationFormatted = computed(() => {
        const minutes = Math.floor(callDuration.value / 60).toString().padStart(2, '0');
        const seconds = (callDuration.value % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    });
    const currentCallQuality = computed(() => callQuality.value[currentPeerId.value] || { audio: 'N/A', video: 'N/A' });

    // --- PRIVATE HELPERS ---
    function _initMusicPlayer() { if (!musicPlayer) { try { musicPlayer = new Audio(AppSettings.media.music); musicPlayer.loop = true; } catch (e) { log(`无法创建呼叫音乐播放器: ${e.message}`, 'ERROR'); } } }
    async function _playMusic(isRetry = false) { _initMusicPlayer(); if (musicPlayer && !isMusicPlaying) { try { await musicPlayer.play(); isMusicPlaying = true; if (boundEnableMusicPlay) { document.body.removeEventListener('click', boundEnableMusicPlay); boundEnableMusicPlay = null; } } catch (error) { log(`播放呼叫音乐失败: ${error.name} - ${error.message}`, 'WARN'); isMusicPlaying = false; if (error.name === 'NotAllowedError' && !isRetry) { eventBus.emit('showNotification', { message: '浏览器阻止了铃声自动播放。请点击页面任意位置以启用声音。', type: 'warning' }); boundEnableMusicPlay = () => _playMusic(true); document.body.addEventListener('click', boundEnableMusicPlay, { once: true }); } } } }
    function _stopMusic() { if (musicPlayer && isMusicPlaying) { musicPlayer.pause(); musicPlayer.currentTime = 0; isMusicPlaying = false; } if (boundEnableMusicPlay) { document.body.removeEventListener('click', boundEnableMusicPlay); boundEnableMusicPlay = null; } }
    function _startCallTimer() { if (callTimer) clearInterval(callTimer); callStartTime = Date.now(); callDuration.value = 0; callTimer = setInterval(() => { callDuration.value = Math.round((Date.now() - callStartTime) / 1000); }, 1000); }
    function _stopCallTimer() { if (callTimer) clearInterval(callTimer); callTimer = null; }
    function _startVoiceActivityDetector() {
        if (!localStream.value || vadInterval) return;
        const audioTracks = localStream.value.getAudioTracks();
        if (audioTracks.length === 0) return;

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(new MediaStream([audioTracks[0]]));
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 512;
            analyserNode.smoothingTimeConstant = 0.5;
            source.connect(analyserNode);

            const bufferLength = analyserNode.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            vadInterval = setInterval(() => {
                analyserNode.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((acc, val) => acc + val, 0);
                const average = sum / bufferLength;
                isSpeaking.value = average > 5;
            }, 100);
            log('Voice Activity Detector started.', 'INFO');
        } catch(e) {
            log(`Failed to start VAD: ${e.message}`, 'ERROR');
        }
    }
    function _stopVoiceActivityDetector() {
        if (vadInterval) clearInterval(vadInterval);
        vadInterval = null;
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
        audioContext = null;
        analyserNode = null;
        isSpeaking.value = false;
        log('Voice Activity Detector stopped.', 'INFO');
    }
    function _updateMicState() {
        if (!localStream.value) return;
        const audioTracks = localStream.value.getAudioTracks();
        if (audioTracks.length === 0) return;

        const shouldBeEnabled = !isAudioMuted.value;

        audioTracks.forEach(track => {
            if (track.enabled !== shouldBeEnabled) {
                track.enabled = shouldBeEnabled;
            }
        });
    }

    function _resetState(keepPeerId = false) {
        _stopVoiceActivityDetector();
        if (localStream.value) { localStream.value.getTracks().forEach(track => track.stop()); } localStream.value = null;
        if (pendingScreenShareStream.value) {
            pendingScreenShareStream.value.getTracks().forEach(track => track.stop());
            pendingScreenShareStream.value = null;
        }
        remoteStream.value = null; if (!keepPeerId) { currentPeerId.value = null; } isCallActive.value = false; isCallPending.value = false; isAudioMuted.value = false; isVideoEnabled.value = true; isScreenSharing.value = false;
        amISharingScreen.value = false;
        incomingCallInfo.value = null; isFullScreenCallViewVisible.value = false; _stopMusic(); _stopCallTimer(); if (callRequestTimeout) { clearTimeout(callRequestTimeout); } callRequestTimeout = null; callStartTime = null; currentQualityPreset.value = 'auto';
        // ✅ MODIFICATION START: Reset screen share quality preset
        currentScreenShareQualityPreset.value = 'auto';
        // ✅ MODIFICATION END

        // [新增] 重置白板状态
        isWhiteboardActive.value = false;
        drawingHistory.value = [];

        if (globalAudioElement.value) {
            globalAudioElement.value.srcObject = null;
        }
    }

    async function _getMediaStream(options = { video: true, audio: true, screen: false }) {
        const settingsStore = useSettingsStore();

        const handleTrackEnded = (event) => {
            log(`Media track ended: ${event.target.kind}`, 'WARN');
            if (event.target.kind === 'video' && !isScreenSharing.value) {
                isVideoEnabled.value = false;
                eventBus.emit('showNotification', { message: '摄像头已断开，切换到语音通话。', type: 'warning' });
            }
        };

        let mediaResult = null;
        if (options.screen) {
            try {
                // ✅ MODIFICATION START: Apply initial screen share quality settings
                const preset = AppSettings.media.screenSharePresets[currentScreenShareQualityPreset.value] || AppSettings.media.screenSharePresets['auto'];
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: 'always',
                        ...preset.resolution,
                        frameRate: preset.frameRate
                    },
                    audio: false
                });
                // ✅ MODIFICATION END
                const finalStream = new MediaStream();
                screenStream.getVideoTracks().forEach(track => finalStream.addTrack(track));

                try {
                    const micStream = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints, video: false });
                    micStream.getAudioTracks().forEach(track => finalStream.addTrack(track));
                } catch (micError) {
                    log(`Could not get microphone for screen share: ${micError.message}`, 'WARN');
                    eventBus.emit('showNotification', { message: '无法获取麦克风，将继续共享但不包含您的声音。', type: 'warning' });
                }

                finalStream.getVideoTracks()[0].onended = () => hangUp();
                mediaResult = { stream: finalStream, videoEnabled: true, audioEnabled: true };
            } catch (error) {
                log(`Failed to get screen stream: ${error.message}`, 'ERROR');
                if (error.name !== 'NotAllowedError') { // Don't show error if user just cancels
                    eventBus.emit('showNotification', { message: `无法共享屏幕: ${error.message}`, type: 'error' });
                }
                return null;
            }
        } else { // Standard camera/mic logic
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: options.video,
                    audio: options.audio ? AppSettings.media.audioConstraints : false
                });
                stream.getTracks().forEach(track => track.onended = handleTrackEnded);
                mediaResult = { stream, videoEnabled: options.video, audioEnabled: options.audio };
            } catch (error) {
                if (error.name !== 'NotFoundError' && error.name !== 'DevicesNotFoundError') {
                    log(`Failed to get media stream: ${error.message}`, 'ERROR');
                    eventBus.emit('showNotification', { message: `无法访问摄像头或麦克风: ${error.message}`, type: 'error' });
                    return null;
                }
                log(`Initial media request failed (${error.name}). Trying fallbacks without prompts.`, 'WARN');

                // Fallback 1: Try audio-only (when camera fails)
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: AppSettings.media.audioConstraints });
                    audioStream.getTracks().forEach(track => track.onended = handleTrackEnded);
                    mediaResult = { stream: audioStream, videoEnabled: false, audioEnabled: true };
                    log('Camera failed, proceeding with audio-only stream for video call.', 'INFO');
                } catch (audioError) {
                    log(`Audio-only fallback also failed: ${audioError.message}`, 'WARN');
                }

                // Fallback 2: If audio also failed, try video-only (when mic fails)
                if (!mediaResult) {
                    try {
                        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                        videoStream.getTracks().forEach(track => track.onended = handleTrackEnded);
                        mediaResult = { stream: videoStream, videoEnabled: true, audioEnabled: false };
                        log('Microphone failed, proceeding with video-only stream for video call.', 'INFO');
                    } catch (videoError) {
                        log(`Video-only fallback also failed: ${videoError.message}`, 'WARN');
                    }
                }

                // If all fallbacks fail, show a final error message
                if (!mediaResult) {
                    eventBus.emit('showNotification', {
                        message: '无法访问任何摄像头或麦克风。请检查它们是否已连接、在系统设置中启用，并且未被其他应用占用。',
                        type: 'error', duration: 8000
                    });
                    return null;
                }
            }
        }

        if (mediaResult && mediaResult.stream && settingsStore.isAiNoiseSuppressionEnabled) {
            log('AI Noise Suppression is enabled. Processing stream...', 'INFO');
            eventBus.emit('showNotification', { message: 'AI 智能降噪已开启', type: 'info' });
        }
        return mediaResult;
    }

    async function addCallLogMessage(chatId, logData) {
        const userStore = useUserStore();
        const callTypeMap = { video: '视频通话', audio: '语音通话', screenshare: '屏幕共享' };
        const callType = callTypeMap[logData.callType] || '通话';
        const peerName = userStore.contacts[chatId]?.name || '对方';
        const selfName = userStore.userName;
        let content = '';

        const isOriginalCaller = logData.callerId === userStore.userId;

        switch (logData.type) {
            case 'start':
                content = `${isOriginalCaller ? selfName : peerName} 发起了${callType}`;
                break;
            case 'end':
                const minutes = Math.floor(logData.duration / 60);
                const seconds = logData.duration % 60;
                const durationString = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
                content = `${callType}已结束，时长 ${durationString}`;
                break;
            case 'missed':
                content = isOriginalCaller ? `${selfName} 发起的${callType}未被接听` : `你错过了来自 ${peerName} 的${callType}`;
                break;
            case 'declined':
                content = logData.by === 'self' ? `你拒绝了${callType}` : `${peerName} 拒绝了${callType}`;
                break;
            case 'cancelled':
                content = isOriginalCaller ? `${selfName} 取消了${callType}` : `${peerName} 取消了${callType}`;
                break;
            default:
                return;
        }

        const logMessage = {
            id: `log_${generateId(12)}`,
            type: 'system', subType: 'call-log', content: content,
            timestamp: new Date().toISOString(), callData: logData
        };
        await useChatStore().addMessage(chatId, logMessage);
    }

    function _initiateMediaSession(peerId, options = { isScreenShare: false, audioOnly: false }) {
        if (isCallActive.value || isCallPending.value) {
            eventBus.emit('showNotification', { message: '已在通话中', type: 'warning' });
            return;
        }
        const userStore = useUserStore();
        currentPeerId.value = peerId;
        isCaller.value = true;
        isCallPending.value = true;
        isScreenSharing.value = options.isScreenShare;
        amISharingScreen.value = options.isScreenShare;
        isVideoEnabled.value = !options.isScreenShare && !options.audioOnly;
        const callType = options.isScreenShare ? 'screenshare-request' : 'call-request';
        webrtcService.sendMessage(peerId, { type: callType, from: userStore.userId, audioOnly: options.audioOnly });
        useUiStore().showModal('calling');
        _playMusic();

        callRequestTimeout = setTimeout(() => {
            if (isCallPending.value) {
                eventBus.emit('showNotification', { message: '对方无应答', type: 'info' });
                webrtcService.sendMessage(peerId, { type: 'call-cancel', from: userStore.userId });
                const callTypeString = isScreenSharing.value ? 'screenshare' : (isVideoEnabled.value ? 'video' : 'audio');
                addCallLogMessage(peerId, { type: 'missed', callType: callTypeString, callerId: userStore.userId });
                _resetState();
                useUiStore().hideModal();
            }
        }, AppSettings.timeouts.callRequest);
    }

    function startVideoCall() { const chatId = useChatStore().currentChatId; if (chatId) _initiateMediaSession(chatId, { isScreenShare: false, audioOnly: false }); }
    function startAudioCall() { const chatId = useChatStore().currentChatId; if (chatId) _initiateMediaSession(chatId, { isScreenShare: false, audioOnly: true }); }
    function startScreenShare() {
        const chatId = useChatStore().currentChatId;
        if (!chatId) return;
        if (isCallActive.value || isCallPending.value) {
            eventBus.emit('showNotification', { message: '已在通话中', type: 'warning' });
            return;
        }
        useUiStore().showModal('screenshotGuide');
    }

    function initiateScreenShareWithStream(stream) {
        const chatId = useChatStore().currentChatId;
        if (!chatId || !stream) return;
        pendingScreenShareStream.value = stream;
        _initiateMediaSession(chatId, { isScreenShare: true, audioOnly: false });
    }

    async function acceptCall() {
        if (!incomingCallInfo.value) return;
        const uiStore = useUiStore();
        const { peerId, audioOnly, isScreenShare } = incomingCallInfo.value;
        _stopMusic();
        uiStore.hideModal();

        const mediaOptions = {
            screen: false,
            video: isScreenShare ? false : !audioOnly,
            audio: true
        };
        const mediaResult = await _getMediaStream(mediaOptions);

        if (!mediaResult || !mediaResult.stream) {
            rejectCall(true);
            return;
        }
        const { stream, videoEnabled, audioEnabled } = mediaResult;

        currentPeerId.value = peerId;
        isCallActive.value = true;
        isFullScreenCallViewVisible.value = true;
        isCallPending.value = false;
        isScreenSharing.value = isScreenShare;
        isVideoEnabled.value = videoEnabled;
        isAudioMuted.value = !audioEnabled;
        localStream.value = stream;

        webrtcService.sendMessage(peerId, { type: 'call-accepted', from: useUserStore().userId });
        webrtcService.addStreamToConnection(peerId, stream);
        incomingCallInfo.value = null;
        _startCallTimer();
        _startVoiceActivityDetector();
        _updateMicState();
        const callTypeString = isScreenShare ? 'screenshare' : (audioOnly ? 'audio' : 'video');
        addCallLogMessage(peerId, { type: 'start', callerId: peerId, callType: callTypeString });
    }

    function rejectCall(isInternal = false) {
        let peerIdToNotify;
        let callTypeString = 'video';
        const userStore = useUserStore();

        if (isCaller.value && isCallPending.value) {
            peerIdToNotify = currentPeerId.value;
            callTypeString = isScreenSharing.value ? 'screenshare' : (!isVideoEnabled.value ? 'audio' : 'video');
            if (!isInternal) {
                webrtcService.sendMessage(peerIdToNotify, { type: 'call-cancel', from: userStore.userId });
                addCallLogMessage(peerIdToNotify, { type: 'cancelled', by: 'self', callType: callTypeString, callerId: userStore.userId });
            }
        } else if (incomingCallInfo.value) {
            peerIdToNotify = incomingCallInfo.value.peerId;
            callTypeString = incomingCallInfo.value.isScreenShare ? 'screenshare' : (incomingCallInfo.value.audioOnly ? 'audio' : 'video');
            if (!isInternal) {
                webrtcService.sendMessage(peerIdToNotify, { type: 'call-rejected', from: userStore.userId });
                addCallLogMessage(peerIdToNotify, { type: 'declined', by: 'self', callType: callTypeString, callerId: peerIdToNotify });
            }
        }
        _resetState();
        useUiStore().hideModal();
    }

    function hangUp(notifyPeer = true) {
        const peerId = currentPeerId.value;
        if ((!isCallActive.value && !isCallPending.value) || !peerId) return;

        log(`Hanging up media for peer ${peerId}. Notify: ${notifyPeer}`, 'INFO');
        _stopCallTimer();

        if (isCallActive.value) {
            const callTypeString = isScreenSharing.value ? 'screenshare' : (!isVideoEnabled.value ? 'audio' : 'video');
            addCallLogMessage(peerId, { type: 'end', duration: callDuration.value, callType: callTypeString });
        }

        if (notifyPeer) {
            webrtcService.sendMessage(peerId, { type: 'call-end', from: useUserStore().userId });
        }

        if (localStream.value) {
            webrtcService.removeStreamFromConnection(peerId, localStream.value);
        }
        _resetState(true);
    }

    function toggleAudio() {
        if (!localStream.value) return;
        isAudioMuted.value = !isAudioMuted.value;
        _updateMicState();
    }

    function toggleVideo() { if (!localStream.value || isScreenSharing.value) return; localStream.value.getVideoTracks().forEach(track => { track.enabled = !track.enabled; isVideoEnabled.value = track.enabled; }); }
    function minimizeCallView() { isFullScreenCallViewVisible.value = false; }
    function maximizeCallView() { isFullScreenCallViewVisible.value = true; }

    function setCallQualityPreset(presetKey) {
        if (!currentPeerId.value || !AppSettings.media.qualityPresets[presetKey]) return;
        currentQualityPreset.value = presetKey;
        const preset = AppSettings.media.qualityPresets[presetKey];
        webrtcService.adjustPeerBitrate(currentPeerId.value, { maxBitrate: preset.maxBitrate, resolution: preset.resolution });
        log(`Manual quality preset applied: ${presetKey}`, 'INFO');
    }

    // ✅ MODIFICATION START: Add action for setting screen share quality
    function setScreenShareQualityPreset(presetKey) {
        if (!currentPeerId.value || !isScreenSharing.value || !amISharingScreen.value) return;
        if (!AppSettings.media.screenSharePresets[presetKey]) return;

        currentScreenShareQualityPreset.value = presetKey;
        const preset = AppSettings.media.screenSharePresets[presetKey];
        webrtcService.adjustScreenShareParameters(currentPeerId.value, {
            resolution: preset.resolution,
            frameRate: preset.frameRate,
        });
        log(`Screen share quality preset applied: ${presetKey}`, 'INFO');
    }
    // ✅ MODIFICATION END

    function setGlobalAudioElement(element) {
        globalAudioElement.value = element;
    }

    // [新增] 白板相关 actions
    function toggleWhiteboard(isActive) {
        if (typeof isActive !== 'boolean') {
            isWhiteboardActive.value = !isWhiteboardActive.value;
        } else {
            isWhiteboardActive.value = isActive;
        }

        // 通知对端白板状态变化
        if (isCallActive.value && currentPeerId.value) {
            webrtcService.sendMessage(currentPeerId.value, {
                type: 'whiteboard_action',
                payload: {
                    type: 'state_change',
                    isActive: isWhiteboardActive.value,
                }
            });
        }

        // 如果关闭白板，清空历史记录
        if (!isWhiteboardActive.value) {
            drawingHistory.value = [];
        }
    }

    function setDrawingTool(tool) {
        currentDrawingTool.value = tool;
    }

    function setDrawingColor(color) {
        currentDrawingColor.value = color;
    }

    function addDrawingAction(actionData) {
        if (!isWhiteboardActive.value) return;
        drawingHistory.value.push(actionData);
        webrtcService.sendMessage(currentPeerId.value, {
            type: 'whiteboard_action',
            payload: actionData
        });
    }

    function undoLastAction() {
        if (!isWhiteboardActive.value) return;
        // 移除最后一次完整的绘图操作（例如，一次完整的画笔 stroke）
        let lastStartIndex = -1;
        for (let i = drawingHistory.value.length - 1; i >= 0; i--) {
            if (drawingHistory.value[i].type === 'draw_start' || drawingHistory.value[i].type === 'draw_rect') {
                lastStartIndex = i;
                break;
            }
        }
        if (lastStartIndex > -1) {
            drawingHistory.value.splice(lastStartIndex);
            // 发送指令让对端同步
            webrtcService.sendMessage(currentPeerId.value, {
                type: 'whiteboard_action',
                payload: { type: 'undo' }
            });
        }
    }

    function clearWhiteboard() {
        if (!isWhiteboardActive.value) return;
        drawingHistory.value = [];
        webrtcService.sendMessage(currentPeerId.value, {
            type: 'whiteboard_action',
            payload: { type: 'clear' }
        });
    }

    // [修改] 监听远端白板指令
    eventBus.on('webrtc:whiteboard-action', ({ peerId, action }) => {
        if (isCallActive.value && currentPeerId.value === peerId) {
            switch (action.type) {
                case 'state_change':
                    isWhiteboardActive.value = action.isActive;
                    if (!action.isActive) {
                        drawingHistory.value = []; // 清空画布
                    }
                    break;
                case 'undo':
                    // 与本地逻辑相同，移除最后一次完整的绘图
                    let lastStartIndex = -1;
                    for (let i = drawingHistory.value.length - 1; i >= 0; i--) {
                        if (drawingHistory.value[i].type === 'draw_start' || drawingHistory.value[i].type === 'draw_rect') {
                            lastStartIndex = i;
                            break;
                        }
                    }
                    if (lastStartIndex > -1) {
                        drawingHistory.value.splice(lastStartIndex);
                    }
                    break;
                case 'clear':
                    drawingHistory.value = [];
                    break;
                default:
                    // 接收并添加绘图指令
                    drawingHistory.value.push(action);
                    break;
            }
        }
    });

    eventBus.on('webrtc:stats-updated', ({ peerId, stats }) => {
        if (!callQuality.value[peerId]) callQuality.value[peerId] = {};
        let audioQuality = 'unknown', videoQuality = 'unknown';

        if (stats.packetLoss < 0.02 && stats.rtt < 150 && stats.jitter < 30) audioQuality = 'good';
        else if (stats.packetLoss < 0.05 && stats.rtt < 400 && stats.jitter < 60) audioQuality = 'medium';
        else audioQuality = 'poor';

        if (!isScreenSharing.value && isVideoEnabled.value) {
            if (stats.packetLoss < 0.03 && stats.rtt < 250) videoQuality = 'good';
            else if (stats.packetLoss < 0.07 && stats.rtt < 500) videoQuality = 'medium';
            else videoQuality = 'poor';
        }

        callQuality.value[peerId] = { audio: audioQuality, video: videoQuality };

        if (currentQualityPreset.value === 'auto' && peerId === currentPeerId.value && !isScreenSharing.value && isVideoEnabled.value) {
            const { poorNetworkThreshold, goodNetworkThreshold, downgradeBitrate } = AppSettings.media.abr;
            if (stats.packetLoss > poorNetworkThreshold.packetLoss || stats.rtt > poorNetworkThreshold.rtt) {
                webrtcService.adjustPeerBitrate(peerId, { maxBitrate: downgradeBitrate });
                log(`ABR: Poor network detected. Downgrading bitrate for ${peerId}.`, 'INFO');
            } else if (stats.packetLoss < goodNetworkThreshold.packetLoss && stats.rtt < goodNetworkThreshold.rtt) {
                webrtcService.adjustPeerBitrate(peerId, { maxBitrate: null });
                log(`ABR: Network condition improved. Restoring auto bitrate for ${peerId}.`, 'INFO');
            }
        }
    });

    eventBus.on('webrtc:message', ({ peerId, message }) => {
        const userStore = useUserStore();
        const callTypeString = message.isScreenShare ? 'screenshare' : (message.audioOnly ? 'audio' : 'video');

        switch (message.type) {
            case 'call-request':
            case 'screenshare-request':
                if (isCallActive.value || isCallPending.value) { webrtcService.sendMessage(peerId, { type: 'call-rejected', reason: 'busy', from: userStore.userId }); return; }
                incomingCallInfo.value = { peerId, name: userStore.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`, isScreenShare: message.type === 'screenshare-request', audioOnly: message.audioOnly || false };
                isCallPending.value = true;
                _playMusic();
                useUiStore().showModal('incomingCall');
                break;
            case 'call-accepted':
                if (isCaller.value && isCallPending.value && currentPeerId.value === peerId) {
                    clearTimeout(callRequestTimeout); _stopMusic(); isCallPending.value = false; isCallActive.value = true; isFullScreenCallViewVisible.value = true; useUiStore().hideModal();
                    if (isScreenSharing.value && pendingScreenShareStream.value) {
                        localStream.value = pendingScreenShareStream.value;
                        pendingScreenShareStream.value = null; // Consume the stream
                        webrtcService.addStreamToConnection(peerId, localStream.value);
                        _startCallTimer();
                        _startVoiceActivityDetector();
                        _updateMicState();
                        addCallLogMessage(peerId, { type: 'start', callerId: userStore.userId, callType: callTypeString });
                    } else {
                        _getMediaStream({ screen: isScreenSharing.value, video: isVideoEnabled.value, audio: true }).then(mediaResult => {
                            if (mediaResult && mediaResult.stream) {
                                localStream.value = mediaResult.stream;
                                webrtcService.addStreamToConnection(peerId, mediaResult.stream);
                                _startCallTimer();
                                _startVoiceActivityDetector();
                                _updateMicState();
                                addCallLogMessage(peerId, { type: 'start', callerId: userStore.userId, callType: callTypeString });
                            } else { hangUp(); }
                        });
                    }
                }
                break;
            case 'call-end':
                if (isCallActive.value && currentPeerId.value === peerId) {
                    log(`Received call-end from ${peerId}. Ending media session locally.`, 'INFO');
                    hangUp(false);
                    eventBus.emit('showNotification', { message: '对方已挂断', type: 'info' });
                }
                break;
            case 'call-rejected':
                if (isCaller.value && isCallPending.value && currentPeerId.value === peerId) {
                    addCallLogMessage(peerId, { type: 'declined', by: 'peer', callType: callTypeString, callerId: userStore.userId });
                    _resetState();
                    useUiStore().hideModal();
                    eventBus.emit('showNotification', { message: '对方已拒绝通话', type: 'info' });
                }
                break;
            case 'call-cancel':
                if (!isCaller.value && isCallPending.value && incomingCallInfo.value?.peerId === peerId) {
                    addCallLogMessage(peerId, { type: 'cancelled', by: 'peer', callType: callTypeString, callerId: peerId });
                    _resetState();
                    useUiStore().hideModal();
                    eventBus.emit('showNotification', { message: '对方已取消', type: 'info' });
                }
                break;
        }
    });

    eventBus.on('webrtc:stream', ({ peerId, stream }) => { if (currentPeerId.value === peerId) { if (stream instanceof MediaStream) { remoteStream.value = stream;
        if (globalAudioElement.value) {
            globalAudioElement.value.srcObject = stream;
        }
    } else { log(`Received invalid stream from peer ${peerId}.`, 'WARN'); } } });
    eventBus.on('webrtc:disconnected', (peerId) => { if (currentPeerId.value === peerId) { log(`Call with ${peerId} ended due to connection loss.`, 'WARN'); eventBus.emit('showNotification', { message: '与对方的连接已断开', type: 'warning' }); _resetState(); } });

    return {
        localStream, remoteStream, currentPeerId, isCallActive, isCallPending, isAudioMuted,
        isVideoEnabled, isScreenSharing, incomingCallInfo, isFullScreenCallViewVisible,
        callDurationFormatted, peerContact, currentCallQuality, currentQualityPreset,
        // ✅ MODIFICATION START: Expose screen share state
        currentScreenShareQualityPreset,
        // ✅ MODIFICATION END
        amISharingScreen,
        isSpeaking,
        // [新增] 导出白板相关状态和 actions
        isWhiteboardActive, currentDrawingTool, currentDrawingColor, drawingHistory,
        toggleWhiteboard, setDrawingTool, setDrawingColor, addDrawingAction, undoLastAction, clearWhiteboard,

        startVideoCall, startAudioCall, startScreenShare, acceptCall, rejectCall, hangUp,
        toggleAudio, toggleVideo, minimizeCallView, maximizeCallView, setCallQualityPreset,
        // ✅ MODIFICATION START: Expose screen share action
        setScreenShareQualityPreset,
        // ✅ MODIFICATION END
        initiateScreenShareWithStream,
        setGlobalAudioElement,
    };
});