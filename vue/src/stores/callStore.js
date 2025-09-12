import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { eventBus } from '@/services/eventBus';
import { webrtcService } from '@/services/webrtcService';
import { useUserStore } from './userStore';
import { useUiStore } from './uiStore';
import { useChatStore } from './chatStore';
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
    const incomingCallInfo = ref(null);
    const isFullScreenCallViewVisible = ref(false);
    const callDuration = ref(0);
    const callQuality = ref({}); // { [peerId]: { audio: 'good', video: 'medium' } }
    let callTimer = null;
    let musicPlayer = null;
    let isMusicPlaying = false;
    let boundEnableMusicPlay = null;
    let callRequestTimeout = null;
    let callStartTime = null;

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
    function _resetState(keepPeerId = false) { if (localStream.value) localStream.value.getTracks().forEach(track => track.stop()); localStream.value = null; remoteStream.value = null; if (!keepPeerId) currentPeerId.value = null; isCallActive.value = false; isCallPending.value = false; isAudioMuted.value = false; isVideoEnabled.value = true; isScreenSharing.value = false; incomingCallInfo.value = null; isFullScreenCallViewVisible.value = false; _stopMusic(); _stopCallTimer(); if (callRequestTimeout) clearTimeout(callRequestTimeout); callRequestTimeout = null; callStartTime = null; }
    async function _getMediaStream(options = { video: true, audio: true, screen: false }) { try { if (options.screen) { const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true }); try { const micStream = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints, video: false }); micStream.getAudioTracks().forEach(track => screenStream.addTrack(track)); } catch (micError) { log(`Could not get microphone for screen share: ${micError.message}`, 'WARN'); eventBus.emit('showNotification', { message: '无法获取麦克风，将继续共享但不包含您的声音。', type: 'warning' }); } screenStream.getVideoTracks()[0].onended = () => hangUp(); return screenStream; } return await navigator.mediaDevices.getUserMedia({ video: options.video, audio: options.audio ? AppSettings.media.audioConstraints : false }); } catch (error) { log(`Failed to get media stream: ${error.message}`, 'ERROR'); eventBus.emit('showNotification', { message: `无法访问摄像头或麦克风: ${error.message}`, type: 'error' }); return null; } }

    /**
     * @param {string} chatId The chat ID to add the log to.
     * @param {object} logData Data for the log message.
     * @param {'start'|'end'|'missed'|'declined'|'cancelled'} logData.type The type of log event.
     * @param {string} [logData.callType] 'video', 'audio', 'screenshare'.
     * @param {number} [logData.duration] Call duration in seconds for 'end' type.
     * @param {string} [logData.by] 'self' or 'peer'. Who initiated the action.
     * @param {string} [logData.callerId] The ID of the user who initiated the call.
     */
    async function addCallLogMessage(chatId, logData) {
        const userStore = useUserStore();
        const callTypeMap = { video: '视频通话', audio: '语音通话', screenshare: '屏幕共享' };
        const callType = callTypeMap[logData.callType] || '通话';
        const peerName = userStore.contacts[chatId]?.name || '对方';
        let content = '';

        // Determine if the current user was the one who initiated the original call
        const isOriginalCaller = logData.callerId === userStore.userId;

        switch (logData.type) {
            case 'start':
                content = `发起了${callType}`;
                break;
            case 'end':
                const minutes = Math.floor(logData.duration / 60);
                const seconds = logData.duration % 60;
                const durationString = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
                content = `${callType}已结束，时长 ${durationString}`;
                break;
            case 'missed': // Nobody answered
                content = isOriginalCaller ? '通话未接通' : `你错过了来自 ${peerName} 的${callType}`;
                break;
            case 'declined': // The call was rejected
                content = logData.by === 'self' ? `你已拒绝${callType}` : `对方已拒绝${callType}`;
                break;
            case 'cancelled': // The call was cancelled before being answered
                content = logData.by === 'self' ? `通话已取消` : `对方已取消${callType}`;
                break;
            default:
                return;
        }

        const logMessage = {
            id: `log_${generateId(12)}`,
            type: 'system',
            subType: 'call-log',
            content: content,
            timestamp: new Date().toISOString(),
            callData: logData // Store raw log data for UI rendering
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

    // --- PUBLIC ACTIONS ---
    function startVideoCall() { const chatId = useChatStore().currentChatId; if (chatId) _initiateMediaSession(chatId, { isScreenShare: false, audioOnly: false }); }
    function startAudioCall() { const chatId = useChatStore().currentChatId; if (chatId) _initiateMediaSession(chatId, { isScreenShare: false, audioOnly: true }); }
    function startScreenShare() { const chatId = useChatStore().currentChatId; if (chatId) _initiateMediaSession(chatId, { isScreenShare: true, audioOnly: false }); }

    async function acceptCall() {
        if (!incomingCallInfo.value) return;
        const uiStore = useUiStore();
        const { peerId, audioOnly, isScreenShare } = incomingCallInfo.value;
        _stopMusic();
        uiStore.hideModal();

        const stream = await _getMediaStream({ screen: false, video: !audioOnly, audio: true });
        if (!stream) {
            rejectCall(true); // Internal rejection if media fails
            return;
        }

        currentPeerId.value = peerId;
        isCallActive.value = true;
        isFullScreenCallViewVisible.value = true;
        isCallPending.value = false;
        isScreenSharing.value = isScreenShare;
        isVideoEnabled.value = !audioOnly;
        localStream.value = stream;

        webrtcService.sendMessage(peerId, { type: 'call-accepted', from: useUserStore().userId });
        webrtcService.addStreamToConnection(peerId, stream);
        incomingCallInfo.value = null;
        _startCallTimer();
        const callTypeString = isScreenShare ? 'screenshare' : (audioOnly ? 'audio' : 'video');
        addCallLogMessage(peerId, { type: 'start', callerId: peerId, callType: callTypeString });
    }

    function rejectCall(isInternal = false) {
        let peerIdToNotify;
        let callTypeString = 'video';
        const userStore = useUserStore();

        if (isCaller.value && isCallPending.value) { // You are cancelling your own call
            peerIdToNotify = currentPeerId.value;
            callTypeString = isScreenSharing.value ? 'screenshare' : (!isVideoEnabled.value ? 'audio' : 'video');
            if (!isInternal) {
                webrtcService.sendMessage(peerIdToNotify, { type: 'call-cancel', from: userStore.userId });
                addCallLogMessage(peerIdToNotify, { type: 'cancelled', by: 'self', callType: callTypeString, callerId: userStore.userId });
            }
        } else if (incomingCallInfo.value) { // You are rejecting an incoming call
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

    function toggleAudio() { if (!localStream.value) return; localStream.value.getAudioTracks().forEach(track => { track.enabled = !track.enabled; isAudioMuted.value = !track.enabled; }); }
    function toggleVideo() { if (!localStream.value || isScreenSharing.value) return; localStream.value.getVideoTracks().forEach(track => { track.enabled = !track.enabled; isVideoEnabled.value = track.enabled; }); }
    function minimizeCallView() { isFullScreenCallViewVisible.value = false; }
    function maximizeCallView() { isFullScreenCallViewVisible.value = true; }

    // --- EVENT BUS LISTENERS ---
    eventBus.on('webrtc:stats-updated', ({ peerId, stats }) => {
        if (!callQuality.value[peerId]) callQuality.value[peerId] = {};
        let audioQuality = 'unknown';
        let videoQuality = 'unknown';

        if (stats.packetLoss < 0.02 && stats.rtt < 150 && stats.jitter < 30) {
            audioQuality = 'good';
        } else if (stats.packetLoss < 0.05 && stats.rtt < 400 && stats.jitter < 60) {
            audioQuality = 'medium';
        } else {
            audioQuality = 'poor';
        }

        if (!isScreenSharing.value && isVideoEnabled.value) {
            if (stats.packetLoss < 0.03 && stats.rtt < 250) {
                videoQuality = 'good';
            } else if (stats.packetLoss < 0.07 && stats.rtt < 500) {
                videoQuality = 'medium';
            } else {
                videoQuality = 'poor';
            }
        }

        callQuality.value[peerId].audio = audioQuality;
        callQuality.value[peerId].video = videoQuality;
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
                    _getMediaStream({ screen: isScreenSharing.value, video: isVideoEnabled.value, audio: true }).then(stream => {
                        if (stream) { localStream.value = stream; webrtcService.addStreamToConnection(peerId, stream); _startCallTimer(); addCallLogMessage(peerId, { type: 'start', callerId: userStore.userId, callType: callTypeString }); }
                        else { hangUp(); }
                    });
                }
                break;
            case 'call-end':
                if (isCallActive.value && currentPeerId.value === peerId) {
                    log(`Received call-end from ${peerId}. Ending media session locally.`, 'INFO');
                    hangUp(false); // Do not notify back
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

    eventBus.on('webrtc:stream', ({ peerId, stream }) => { if (currentPeerId.value === peerId) { if (stream instanceof MediaStream) remoteStream.value = stream; else log(`Received invalid stream from peer ${peerId}.`, 'WARN'); } });
    eventBus.on('webrtc:disconnected', (peerId) => { if (currentPeerId.value === peerId) { log(`Call with ${peerId} ended due to connection loss.`, 'WARN'); eventBus.emit('showNotification', { message: '与对方的连接已断开', type: 'warning' }); _resetState(); } });

    return { localStream, remoteStream, currentPeerId, isCallActive, isCallPending, isAudioMuted, isVideoEnabled, isScreenSharing, incomingCallInfo, isFullScreenCallViewVisible, callDurationFormatted, peerContact, currentCallQuality, startVideoCall, startAudioCall, startScreenShare, acceptCall, rejectCall, hangUp, toggleAudio, toggleVideo, minimizeCallView, maximizeCallView, };
});