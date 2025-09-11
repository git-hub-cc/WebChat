<template>
  <transition name="call-view-fade">
    <div class="call-view-container" :class="{ 'pip-mode': isPipMode, 'audio-only-mode': isAudioOnly }" ref="callContainerRef">
      <!-- NEW: Header with minimize button -->
      <header class="call-view-header">
        <IconButton
            icon="↓"
            title="最小化通话"
            @click="callStore.minimizeCallView()"
            class="minimize-button"
        />
        <div class="peer-info">
          <p class="peer-name">{{ peerContact?.name }}</p>
          <p class="call-duration">{{ callStore.callDurationFormatted }}</p>
        </div>
      </header>

      <div class="video-streams">
        <video ref="remoteVideoRef" class="remote-video" autoplay playsinline></video>
        <video v-show="!isAudioOnly" ref="localVideoRef" class="local-video" autoplay playsinline muted></video>
        <div v-if="isAudioOnly" class="audio-only-ui">
          <Avatar :entity="peerContact" size="xl" />
          <p class="audio-peer-name">{{ peerContact?.name }}</p>
        </div>
      </div>

      <div class="call-controls">
        <IconButton
            :icon="callStore.isVideoEnabled ? '📹' : '🚫'"
            :title="callStore.isVideoEnabled ? '关闭摄像头' : '开启摄像头'"
            @click="callStore.toggleVideo()"
            v-if="!callStore.isScreenSharing && !isAudioOnly"
            :class="{ active: callStore.isVideoEnabled }"
        />
        <IconButton
            :icon="callStore.isAudioMuted ? '🔇' : '🎤'"
            :title="callStore.isAudioMuted ? '取消静音' : '静音'"
            @click="callStore.toggleAudio()"
            :class="{ active: !callStore.isAudioMuted }"
        />
        <IconButton
            icon="🖥️"
            title="停止共享"
            @click="callStore.hangUp()"
            v-if="callStore.isScreenSharing"
        />
        <button class="end-call-button" @click="callStore.hangUp()" title="挂断">📞</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { useCallStore } from '@/stores/callStore';
import IconButton from '@/components/Shared/IconButton.vue';
import Avatar from '@/components/Shared/Avatar.vue';

const callStore = useCallStore();
const localVideoRef = ref(null);
const remoteVideoRef = ref(null);
const callContainerRef = ref(null);

const isPipMode = ref(false); // This component no longer controls PIP mode directly, but kept for potential future use

watch(() => callStore.localStream, (newStream) => {
  if (localVideoRef.value) {
    localVideoRef.value.srcObject = newStream instanceof MediaStream ? newStream : null;
  }
}, { immediate: true });

watch(() => callStore.remoteStream, (newStream) => {
  if (remoteVideoRef.value) {
    remoteVideoRef.value.srcObject = newStream instanceof MediaStream ? newStream : null;
  }
}, { immediate: true });

const peerContact = computed(() => callStore.peerContact);

const isAudioOnly = computed(() => {
  const hasRemoteVideo = callStore.remoteStream?.getVideoTracks().some(t => t.readyState === 'live');
  return !callStore.isVideoEnabled && !hasRemoteVideo;
});

</script>

<style scoped>
.call-view-container {
  position: fixed; inset: 0; background-color: #111;
  z-index: 1200; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
/* --- NEW STYLES --- */
.call-view-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  padding: var(--spacing-3);
  background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent);
  z-index: 1201;
}
.minimize-button {
  color: white;
  font-size: 1.8rem;
}
.peer-info {
  margin-left: var(--spacing-3);
  color: white;
}
.peer-name {
  font-weight: var(--font-weight-semibold);
}
.call-duration {
  font-size: var(--font-size-sm);
  opacity: 0.8;
}
/* --- END NEW STYLES --- */

.video-streams { position: absolute; inset: 0; }
.remote-video, .local-video {
  position: absolute; object-fit: contain; width: 100%; height: 100%;
}
.local-video {
  /* MODIFIED: Adjusted for header presence */
  bottom: 120px;
  right: 20px; width: 15vw; max-width: 200px;
  min-width: 120px; aspect-ratio: 9/16; height: auto;
  border: 2px solid white; border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-md);
}
.audio-only-ui {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 100%; height: 100%; color: white;
}
.audio-peer-name { font-size: 1.5rem; margin-top: var(--spacing-4); }
.call-view-container.audio-only-mode .remote-video, .call-view-container.audio-only-mode .local-video {
  display: none;
}
.call-controls {
  position: absolute; bottom: 30px; display: flex; gap: var(--spacing-4);
  background-color: rgba(0, 0, 0, 0.4); padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-pill); backdrop-filter: blur(5px);
  z-index: 1201;
}
.call-controls .icon-button {
  color: white;
  width: 56px;
  height: 56px;
}
.call-controls .icon-button.active {
  background-color: rgba(255, 255, 255, 0.2);
}
.end-call-button {
  width: 56px; height: 56px; border-radius: 50%;
  background-color: var(--color-status-danger); color: white;
  font-size: 1.8rem; transform: rotate(135deg); border: none;
  display: flex; align-items: center; justify-content: center;
}
.call-view-fade-enter-active, .call-view-fade-leave-active {
  transition: opacity 0.3s ease;
}
.call-view-fade-enter-from, .call-view-fade-leave-to {
  opacity: 0;
}
</style>