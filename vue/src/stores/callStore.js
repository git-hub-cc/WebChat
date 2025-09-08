import { defineStore } from 'pinia';
import { ref } from 'vue';
import { eventBus } from '@/services/eventBus';
import { webrtcService } from '@/services/webrtcService';
import { useUserStore } from './userStore';
import { useUiStore } from './uiStore';
import { log } from '@/utils';
import AppSettings from '@/config/AppSettings';

/**
 * Manages all real-time audio/video call states and core logic.
 */
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
    const incomingCallInfo = ref(null); // { peerId, name, isScreenShare }

    let callRequestTimeout = null;
    let musicPlayer = null;

    // --- PRIVATE HELPERS ---

    function _initMusicPlayer() {
        if (!musicPlayer) {
            musicPlayer = new Audio(AppSettings.media.music);
            musicPlayer.loop = true;
        }
    }

    async function _playMusic() {
        _initMusicPlayer();
        try {
            await musicPlayer.play();
        } catch (error) {
            log(`Could not auto-play call music: ${error.message}`, 'WARN');
        }
    }

    function _stopMusic() {
        if (musicPlayer) {
            musicPlayer.pause();
            musicPlayer.currentTime = 0;
        }
    }

    function _resetState() {
        if (localStream.value) {
            localStream.value.getTracks().forEach(track => track.stop());
        }
        localStream.value = null;
        remoteStream.value = null;
        currentPeerId.value = null;
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

    // --- ACTIONS ---

    async function startCall(peerId, options = { isScreenShare: false, isAudioOnly: false }) {
        if (isCallActive.value || isCallPending.value) {
            eventBus.emit('showNotification', { message: '已在通话中', type: 'warning' });
            return;
        }
        const userStore = useUserStore();
        currentPeerId.value = peerId;
        isCaller.value = true;
        isCallPending.value = true;
        isScreenSharing.value = options.isScreenShare;
        isVideoEnabled.value = !options.isScreenShare && !options.isAudioOnly;

        const callType = options.isScreenShare ? 'screenshare-request' : 'call-request';
        webrtcService.sendMessage(peerId, { type: callType, from: userStore.userId, audioOnly: options.isAudioOnly });

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

    async function acceptCall() {
        if (!incomingCallInfo.value) return;
        const uiStore = useUiStore();
        const { peerId, isScreenShare, audioOnly } = incomingCallInfo.value;

        _stopMusic();
        uiStore.hideModal();

        const stream = await _getMediaStream({ screen: false, video: !audioOnly, audio: true });
        if (!stream) {
            rejectCall(true); // Reject internally if media fails
            return;
        }

        currentPeerId.value = peerId;
        isCallActive.value = true;
        isCallPending.value = false;
        isScreenSharing.value = false; // We are receiving, not sharing
        isVideoEnabled.value = !audioOnly;
        localStream.value = stream;

        webrtcService.sendMessage(peerId, { type: 'call-accepted', from: useUserStore().userId });
        webrtcService.createOffer(peerId, { stream });

        incomingCallInfo.value = null;
    }

    function rejectCall(isInternal = false) {
        let peerIdToNotify;
        if (isCaller.value && isCallPending.value) {
            peerIdToNotify = currentPeerId.value;
            if(!isInternal) webrtcService.sendMessage(peerIdToNotify, { type: 'call-cancel', from: useUserStore().userId });
        } else if (incomingCallInfo.value) {
            peerIdToNotify = incomingCallInfo.value.peerId;
            if(!isInternal) webrtcService.sendMessage(peerIdToNotify, { type: 'call-rejected', from: useUserStore().userId });
        }

        _resetState();
        useUiStore().hideModal();
    }

    function hangUp() {
        if ((!isCallActive.value && !isCallPending.value) || !currentPeerId.value) return;
        webrtcService.sendMessage(currentPeerId.value, { type: 'call-end', from: useUserStore().userId });
        webrtcService.closeConnection(currentPeerId.value);
        _resetState();
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

            case 'call-rejected':
            case 'call-cancel':
            case 'call-end':
                if (currentPeerId.value === peerId || incomingCallInfo.value?.peerId === peerId) {
                    _resetState();
                    useUiStore().hideModal();
                    eventBus.emit('showNotification', { message: '通话已结束', type: 'info' });
                }
                break;
        }
    });

    eventBus.on('webrtc:stream', ({ peerId, stream }) => {
        if (currentPeerId.value === peerId) {
            remoteStream.value = stream;
        }
    });

    eventBus.on('webrtc:disconnected', (peerId) => {
        if (currentPeerId.value === peerId) {
            hangUp();
        }
    });

    return {
        localStream, remoteStream, currentPeerId, isCallActive, isCallPending, isAudioMuted, isVideoEnabled, isScreenSharing, incomingCallInfo, isCaller,
        startCall, acceptCall, rejectCall, hangUp, toggleAudio, toggleVideo
    };
});