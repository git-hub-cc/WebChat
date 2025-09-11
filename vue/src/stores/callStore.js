import { defineStore } from 'pinia';
import { ref } from 'vue';
import { eventBus } from '@/services/eventBus';
import { webrtcService } from '@/services/webrtcService';
import { useUserStore } from './userStore';
import { useUiStore } from './uiStore';
import { useChatStore } from './chatStore';
import { log } from '@/utils';
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

    let callRequestTimeout = null;
    let musicPlayer = null;
    let isMusicPlaying = false;
    let boundEnableMusicPlay = null;

    // --- PRIVATE HELPERS ---
    function _initMusicPlayer() {
        if (!musicPlayer) {
            try {
                musicPlayer = new Audio(AppSettings.media.music);
                musicPlayer.loop = true;
            } catch (e) {
                log(`无法创建呼叫音乐播放器: ${e.message}`, 'ERROR');
            }
        }
    }

    async function _playMusic(isRetry = false) {
        _initMusicPlayer();
        if (musicPlayer && !isMusicPlaying) {
            try {
                await musicPlayer.play();
                isMusicPlaying = true;
                if (boundEnableMusicPlay) {
                    document.body.removeEventListener('click', boundEnableMusicPlay);
                    boundEnableMusicPlay = null;
                }
            } catch (error) {
                log(`播放呼叫音乐失败: ${error.name} - ${error.message}`, 'WARN');
                isMusicPlaying = false;
                if (error.name === 'NotAllowedError' && !isRetry) {
                    eventBus.emit('showNotification', { message: '浏览器阻止了铃声自动播放。请点击页面任意位置以启用声音。', type: 'warning' });
                    boundEnableMusicPlay = () => _playMusic(true);
                    document.body.addEventListener('click', boundEnableMusicPlay, { once: true });
                }
            }
        }
    }

    function _stopMusic() {
        if (musicPlayer && isMusicPlaying) {
            musicPlayer.pause();
            musicPlayer.currentTime = 0;
            isMusicPlaying = false;
        }
        if (boundEnableMusicPlay) {
            document.body.removeEventListener('click', boundEnableMusicPlay);
            boundEnableMusicPlay = null;
        }
    }

    function _resetState(keepPeerId = false) {
        if (localStream.value) {
            localStream.value.getTracks().forEach(track => track.stop());
        }
        localStream.value = null;
        remoteStream.value = null;
        // If keepPeerId is false, this is a full reset.
        if (!keepPeerId) {
            currentPeerId.value = null;
        }
        isCallActive.value = false;
        isCaller.value = false;
        isCallPending.value = false;
        isAudioMuted.value = false;
        isVideoEnabled.value = true;
        isScreenSharing.value = false;
        incomingCallInfo.value = null;
        _stopMusic();
        if (callRequestTimeout) clearTimeout(callRequestTimeout);
        callRequestTimeout = null;
    }

    async function _getMediaStream(options = { video: true, audio: true, screen: false }) {
        try {
            if (options.screen) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: true });
                try {
                    const micStream = await navigator.mediaDevices.getUserMedia({ audio: AppSettings.media.audioConstraints, video: false });
                    micStream.getAudioTracks().forEach(track => screenStream.addTrack(track));
                } catch (micError) {
                    log(`Could not get microphone for screen share: ${micError.message}`, 'WARN');
                    eventBus.emit('showNotification', { message: '无法获取麦克风，将继续共享但不包含您的声音。', type: 'warning' });
                }
                screenStream.getVideoTracks()[0].onended = () => hangUp();
                return screenStream;
            }
            return await navigator.mediaDevices.getUserMedia({
                video: options.video,
                audio: options.audio ? AppSettings.media.audioConstraints : false
            });
        } catch (error) {
            log(`Failed to get media stream: ${error.message}`, 'ERROR');
            eventBus.emit('showNotification', { message: `无法访问摄像头或麦克风: ${error.message}`, type: 'error' });
            return null;
        }
    }

    // --- INTERNAL ACTION ---
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
                _resetState();
                useUiStore().hideModal();
            }
        }, AppSettings.timeouts.callRequest);
    }

    // --- PUBLIC ACTIONS ---
    function startVideoCall() {
        const chatId = useChatStore().currentChatId;
        if (chatId) _initiateMediaSession(chatId, { isScreenShare: false, audioOnly: false });
    }

    function startAudioCall() {
        const chatId = useChatStore().currentChatId;
        if (chatId) _initiateMediaSession(chatId, { isScreenShare: false, audioOnly: true });
    }

    function startScreenShare() {
        const chatId = useChatStore().currentChatId;
        if (chatId) _initiateMediaSession(chatId, { isScreenShare: true, audioOnly: false });
    }

    async function acceptCall() {
        if (!incomingCallInfo.value) return;
        const uiStore = useUiStore();
        const { peerId, audioOnly } = incomingCallInfo.value;
        _stopMusic();
        uiStore.hideModal();
        const stream = await _getMediaStream({ screen: false, video: !audioOnly, audio: true });
        if (!stream) {
            rejectCall(true);
            return;
        }
        currentPeerId.value = peerId;
        isCallActive.value = true;
        isCallPending.value = false;
        isScreenSharing.value = false;
        isVideoEnabled.value = !audioOnly;
        localStream.value = stream;
        webrtcService.sendMessage(peerId, { type: 'call-accepted', from: useUserStore().userId });
        webrtcService.addStreamToConnection(peerId, stream);
        incomingCallInfo.value = null;
    }

    function rejectCall(isInternal = false) {
        let peerIdToNotify;
        if (isCaller.value && isCallPending.value) {
            peerIdToNotify = currentPeerId.value;
            if (!isInternal) webrtcService.sendMessage(peerIdToNotify, { type: 'call-cancel', from: useUserStore().userId });
        } else if (incomingCallInfo.value) {
            peerIdToNotify = incomingCallInfo.value.peerId;
            if (!isInternal) webrtcService.sendMessage(peerIdToNotify, { type: 'call-rejected', from: useUserStore().userId });
        }
        _resetState();
        useUiStore().hideModal();
    }

    // --- MODIFIED HANGUP LOGIC ---
    function hangUp(notifyPeer = true) {
        const peerId = currentPeerId.value;
        if ((!isCallActive.value && !isCallPending.value) || !peerId) return;

        log(`Hanging up media for peer ${peerId}. Notify: ${notifyPeer}`, 'INFO');

        if (notifyPeer) {
            webrtcService.sendMessage(peerId, { type: 'call-end', from: useUserStore().userId });
        }

        // Remove the media stream from the connection, but don't destroy the connection itself.
        if (localStream.value) {
            webrtcService.removeStreamFromConnection(peerId, localStream.value);
        }

        _resetState(true); // Reset state but keep peerId for context
    }

    function toggleAudio() {
        if (!localStream.value) return;
        localStream.value.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
            isAudioMuted.value = !track.enabled;
        });
    }

    function toggleVideo() {
        if (!localStream.value || isScreenSharing.value) return;
        localStream.value.getVideoTracks().forEach(track => {
            track.enabled = !track.enabled;
            isVideoEnabled.value = track.enabled;
        });
    }

    // --- EVENT BUS LISTENERS ---
    eventBus.on('webrtc:message', ({ peerId, message }) => {
        const userStore = useUserStore();
        switch (message.type) {
            case 'call-request':
            case 'screenshare-request':
                if (isCallActive.value || isCallPending.value) {
                    webrtcService.sendMessage(peerId, { type: 'call-rejected', reason: 'busy', from: userStore.userId });
                    return;
                }
                incomingCallInfo.value = {
                    peerId,
                    name: userStore.contacts[peerId]?.name || `用户 ${peerId.substring(0, 4)}`,
                    isScreenShare: message.type === 'screenshare-request',
                    audioOnly: message.audioOnly || false
                };
                isCallPending.value = true;
                _playMusic();
                useUiStore().showModal('incomingCall');
                break;

            case 'call-accepted':
                if (isCaller.value && isCallPending.value && currentPeerId.value === peerId) {
                    clearTimeout(callRequestTimeout);
                    _stopMusic();
                    isCallPending.value = false;
                    isCallActive.value = true;
                    useUiStore().hideModal();
                    _getMediaStream({
                        screen: isScreenSharing.value,
                        video: isVideoEnabled.value,
                        audio: true
                    }).then(stream => {
                        if (stream) {
                            localStream.value = stream;
                            webrtcService.addStreamToConnection(peerId, stream);
                        } else {
                            hangUp();
                        }
                    });
                }
                break;

            // --- MODIFIED: Handle call-end by calling hangUp without notifying back ---
            case 'call-end':
                if (isCallActive.value && currentPeerId.value === peerId) {
                    log(`Received call-end from ${peerId}. Ending media session locally.`, 'INFO');
                    hangUp(false); // Do not notify the peer back
                    eventBus.emit('showNotification', { message: '对方已挂断', type: 'info' });
                }
                break;

            case 'call-rejected':
            case 'call-cancel':
                if ( (isCallPending.value || isCallActive.value) && (currentPeerId.value === peerId || incomingCallInfo.value?.peerId === peerId) ) {
                    _resetState();
                    useUiStore().hideModal();
                    eventBus.emit('showNotification', { message: '通话已结束', type: 'info' });
                }
                break;
        }
    });

    eventBus.on('webrtc:stream', ({ peerId, stream }) => {
        if (currentPeerId.value === peerId) {
            if (stream instanceof MediaStream) {
                remoteStream.value = stream;
            } else {
                log(`Received an invalid stream object from peer ${peerId}. Ignoring.`, 'WARN');
            }
        }
    });

    eventBus.on('webrtc:disconnected', (peerId) => {
        // Now, this is the primary way a call is fully terminated due to network issues
        if (currentPeerId.value === peerId) {
            log(`Call with ${peerId} ended due to connection loss.`, 'WARN');
            eventBus.emit('showNotification', { message: '与对方的连接已断开', type: 'warning' });
            _resetState();
        }
    });

    return {
        localStream, remoteStream, currentPeerId, isCallActive, isCallPending, isAudioMuted, isVideoEnabled, isScreenSharing, incomingCallInfo,
        startVideoCall, startAudioCall, startScreenShare,
        acceptCall, rejectCall, hangUp, toggleAudio, toggleVideo
    };
});