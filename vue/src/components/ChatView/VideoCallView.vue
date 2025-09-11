<template>
  <transition name="call-view-fade">
    <div v-if="callStore.isCallActive" class="call-view-container" :class="{ 'pip-mode': isPipMode, 'audio-only-mode': isAudioOnly }" ref="callContainerRef">
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
        <IconButton
            :icon="isPipMode ? '↗️' : '↙️'"
            title="画中画"
            @click="togglePip"
            v-if="!isAudioOnly"
        />
        <button class="end-call-button" @click="callStore.hangUp()" title="挂断">📞</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import { useCallStore } from '@/stores/callStore';
import { useUserStore } from '@/stores/userStore';
import IconButton from '@/components/Shared/IconButton.vue';
import Avatar from '@/components/Shared/Avatar.vue';

const callStore = useCallStore();
const userStore = useUserStore();
const localVideoRef = ref(null);
const remoteVideoRef = ref(null);
const isPipMode = ref(false);
const callContainerRef = ref(null);

// --- START OF FIX ---
// The watcher now robustly handles both valid MediaStream objects and null values.
watch(() => callStore.localStream, (newStream) => {
  if (localVideoRef.value) {
    if (newStream instanceof MediaStream) {
      localVideoRef.value.srcObject = newStream;
    } else {
      localVideoRef.value.srcObject = null; // Correctly handle stream removal
    }
  }
});
watch(() => callStore.remoteStream, (newStream) => {
  if (remoteVideoRef.value) {
    if (newStream instanceof MediaStream) {
      remoteVideoRef.value.srcObject = newStream;
    } else {
      remoteVideoRef.value.srcObject = null; // Correctly handle stream removal
    }
  }
});
// --- END OF FIX ---


const peerContact = computed(() => userStore.contacts[callStore.currentPeerId]);

const isAudioOnly = computed(() => {
  const hasRemoteVideo = callStore.remoteStream?.getVideoTracks().some(t => t.readyState === 'live');
  return !callStore.isVideoEnabled && !hasRemoteVideo;
});

function togglePip() {
  isPipMode.value = !isPipMode.value;
}

// Draggable PIP Logic
let dragInfo = { active: false, x: 0, y: 0, initialX: 0, initialY: 0 };
function dragStart(e) {
  if (e.target.closest('button')) return;
  dragInfo.active = true;
  dragInfo.initialX = e.clientX - dragInfo.x;
  dragInfo.initialY = e.clientY - dragInfo.y;
  window.addEventListener('mousemove', drag);
  window.addEventListener('mouseup', dragEnd);
}
function drag(e) {
  if (!dragInfo.active) return;
  e.preventDefault();
  dragInfo.x = e.clientX - dragInfo.initialX;
  dragInfo.y = e.clientY - dragInfo.initialY;
  if (callContainerRef.value) {
    callContainerRef.value.style.transform = `translate3d(${dragInfo.x}px, ${dragInfo.y}px, 0)`;
  }
}
function dragEnd() {
  dragInfo.active = false;
  window.removeEventListener('mousemove', drag);
  window.removeEventListener('mouseup', dragEnd);
}
watch(isPipMode, (isPip) => {
  const el = callContainerRef.value;
  if (isPip && el) {
    el.addEventListener('mousedown', dragStart);
    el.style.cursor = 'grab';
  } else if (el) {
    el.removeEventListener('mousedown', dragStart);
    el.style.cursor = 'default';
    el.style.transform = '';
    dragInfo = { active: false, x: 0, y: 0, initialX: 0, initialY: 0 };
  }
});
</script>

<style scoped>
.call-view-container {
  position: fixed; inset: 0; background-color: #111;
  z-index: 1200; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.video-streams { position: absolute; inset: 0; }
.remote-video, .local-video {
  position: absolute; object-fit: contain; width: 100%; height: 100%;
}
.local-video {
  bottom: 80px; right: 20px; width: 15vw; max-width: 200px;
  min-width: 120px; aspect-ratio: 9/16; height: auto;
  border: 2px solid white; border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-md);
}
.audio-only-ui {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 100%; height: 100%; color: white;
}
.audio-peer-name { font-size: 1.5rem; }
.call-view-container.audio-only-mode .remote-video, .call-view-container.audio-only-mode .local-video {
  display: none;
}
.call-controls {
  position: absolute; bottom: 20px; display: flex; gap: var(--spacing-3);
  background-color: rgba(0, 0, 0, 0.4); padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-pill); backdrop-filter: blur(5px);
}
.call-controls .icon-button.active {
  background-color: rgba(255, 255, 255, 0.2);
  color: white;
}
.end-call-button {
  width: 56px; height: 56px; border-radius: 50%;
  background-color: var(--color-status-danger); color: white;
  font-size: 1.8rem; transform: rotate(135deg); border: none;
  display: flex; align-items: center; justify-content: center;
}
.call-view-container.pip-mode {
  inset: auto; bottom: 20px; right: 20px; width: 25vw;
  min-width: 300px; max-width: 400px; aspect-ratio: 16 / 9;
  border-radius: var(--border-radius-lg); overflow: hidden;
  box-shadow: var(--shadow-lg); cursor: grab;
}
.pip-mode .local-video { display: none; }
.pip-mode .call-controls {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; background-color: rgba(0,0,0,0.5);
  transition: opacity 0.2s ease; border-radius: 0;
  align-items: center; justify-content: center;
}
.pip-mode:hover .call-controls { opacity: 1; }
.call-view-fade-enter-active, .call-view-fade-leave-active {
  transition: opacity 0.3s ease;
}
.call-view-fade-enter-from, .call-view-fade-leave-to {
  opacity: 0;
}
</style>