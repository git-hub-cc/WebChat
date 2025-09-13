<template>
  <transition name="call-view-fade">
    <div class="call-view-container" :class="{ 'pip-mode': isPipMode, 'audio-only-mode': isAudioOnly }" ref="callContainerRef">
      <header class="call-view-header">
        <IconButton icon="↓" title="最小化通话" @click="callStore.minimizeCallView()" class="minimize-button" />
        <div class="peer-info">
          <p class="peer-name">{{ viewTitle }}</p>
          <div class="status-indicators">
            <p class="call-duration">{{ callStore.callDurationFormatted }}</p>
            <span v-if="callStore.currentCallQuality.audio" class="quality-indicator" :class="qualityClass('audio')" :title="`音频质量: ${qualityText(callStore.currentCallQuality.audio)}`">A</span>
            <span v-if="callStore.currentCallQuality.video && !isAudioOnly" class="quality-indicator" :class="qualityClass('video')" :title="`视频质量: ${qualityText(callStore.currentCallQuality.video)}`">V</span>
          </div>
        </div>
      </header>

      <div v-if="amISharingScreen" class="sharing-banner">
        🔴 您正在分享屏幕
        <button @click="callStore.hangUp()">停止分享</button>
      </div>

      <div class="video-streams">
        <video ref="remoteVideoRef" class="remote-video" autoplay playsinline></video>
        <!-- --- MODIFICATION START: Hide local video whenever screen sharing is active --- -->
        <video v-show="!isAudioOnly && !callStore.isScreenSharing" ref="localVideoRef" class="local-video" :class="{ 'speaking-indicator': callStore.isSpeaking }" autoplay playsinline muted></video>
        <!-- --- MODIFICATION END --- -->
        <div v-if="isAudioOnly" class="audio-only-ui">
          <Avatar :entity="peerContact" size="xl" :is-speaking="callStore.isSpeaking" />
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
            :icon="muteButtonIcon"
            :title="muteButtonTitle"
            @click="callStore.toggleAudio()"
            :class="{ active: !callStore.isAudioMuted }"
        />
        <div class="quality-settings-wrapper" v-if="!callStore.isScreenSharing && !isAudioOnly">
          <IconButton
              icon="⚙️"
              title="通话质量"
              @click="toggleQualityMenu"
              class="settings-button"
          />
          <transition name="quality-menu-fade">
            <div v-if="showQualityMenu" class="quality-menu">
              <button
                  v-for="(label, key) in qualityOptions"
                  :key="key"
                  @click="setQuality(key)"
                  :class="{ active: callStore.currentQualityPreset === key }"
              >
                {{ label }}
              </button>
            </div>
          </transition>
        </div>
        <button class="end-call-button" @click="callStore.hangUp()" title="挂断">📞</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { useCallStore } from '@/stores/callStore';
import { useSettingsStore } from '@/stores/settingsStore';
import IconButton from '@/components/Shared/IconButton.vue';
import Avatar from '@/components/Shared/Avatar.vue';

const callStore = useCallStore();
const settingsStore = useSettingsStore();
const localVideoRef = ref(null);
const remoteVideoRef = ref(null);
const callContainerRef = ref(null);

const isPipMode = ref(false);
const showQualityMenu = ref(false);
const qualityOptions = {
  'auto': '自动',
  '720p': '高清 (720p)',
  '480p': '标清 (480p)',
};

watch(() => callStore.localStream, (newStream) => { if (localVideoRef.value) localVideoRef.value.srcObject = newStream instanceof MediaStream ? newStream : null; }, { immediate: true });
watch(() => callStore.remoteStream, (newStream) => { if (remoteVideoRef.value) remoteVideoRef.value.srcObject = newStream instanceof MediaStream ? newStream : null; }, { immediate: true });

const peerContact = computed(() => callStore.peerContact);
const isAudioOnly = computed(() => { const hasRemoteVideo = callStore.remoteStream?.getVideoTracks().some(t => t.readyState === 'live'); return !callStore.isVideoEnabled && !hasRemoteVideo; });

const amISharingScreen = computed(() => callStore.isScreenSharing && callStore.amISharingScreen);

const viewTitle = computed(() => {
  if (callStore.isScreenSharing && !amISharingScreen.value) {
    return `${peerContact.value?.name} 正在分享屏幕`;
  }
  return peerContact.value?.name;
});

const muteButtonIcon = computed(() => {
  return callStore.isAudioMuted ? '🔇' : '🎤';
});

const muteButtonTitle = computed(() => {
  return callStore.isAudioMuted ? '取消静音' : '静音';
});

const qualityClass = (type) => {
  const quality = callStore.currentCallQuality[type];
  if (quality === 'good') return 'quality-good';
  if (quality === 'medium') return 'quality-medium';
  if (quality === 'poor') return 'quality-poor';
  return '';
};

const qualityText = (quality) => {
  if (quality === 'good') return '良好';
  if (quality === 'medium') return '一般';
  if (quality === 'poor') return '较差';
  return '未知';
};

function toggleQualityMenu() {
  showQualityMenu.value = !showQualityMenu.value;
}

function setQuality(key) {
  callStore.setCallQualityPreset(key);
  showQualityMenu.value = false;
}

function closeQualityMenuOnClickOutside(event) {
  if (showQualityMenu.value && !event.target.closest('.quality-settings-wrapper')) {
    showQualityMenu.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', closeQualityMenuOnClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', closeQualityMenuOnClickOutside);
});

</script>

<style scoped>
.call-view-container { position: fixed; inset: 0; background-color: #111; z-index: 1200; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.call-view-header { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; padding: var(--spacing-3); background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent); z-index: 1201; }
.minimize-button { color: white; font-size: 1.8rem; }
.peer-info { margin-left: var(--spacing-3); color: white; }
.peer-name { font-weight: var(--font-weight-semibold); }
.status-indicators { display: flex; align-items: center; gap: var(--spacing-2); font-size: var(--font-size-sm); opacity: 0.8; }
.quality-indicator { font-size: 0.75rem; padding: 2px 6px; border-radius: var(--border-radius-sm); color: white; font-weight: bold; }
.quality-good { background-color: var(--color-status-success); }
.quality-medium { background-color: var(--color-status-warning); }
.quality-poor { background-color: var(--color-status-danger); }
.video-streams { position: absolute; inset: 0; }
.remote-video, .local-video { position: absolute; object-fit: contain; width: 100%; height: 100%; }
.local-video { bottom: 120px; right: 20px; width: 15vw; max-width: 200px; min-width: 120px; aspect-ratio: 9/16; height: auto; border: 2px solid white; border-radius: var(--border-radius-md); box-shadow: var(--shadow-md); transition: box-shadow 0.2s ease-in-out; }
.audio-only-ui { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; color: white; }
.audio-peer-name { font-size: 1.5rem; margin-top: var(--spacing-4); }
.call-view-container.audio-only-mode .remote-video, .call-view-container.audio-only-mode .local-video { display: none; }
.call-controls { position: absolute; bottom: 30px; display: flex; gap: var(--spacing-4); background-color: rgba(0, 0, 0, 0.4); padding: var(--spacing-2) var(--spacing-4); border-radius: var(--border-radius-pill); backdrop-filter: blur(5px); z-index: 1201; }
.call-controls .icon-button { color: white; width: 56px; height: 56px; }
.call-controls .icon-button.active { background-color: rgba(255, 255, 255, 0.2); }
.end-call-button { width: 56px; height: 56px; border-radius: 50%; background-color: var(--color-status-danger); color: white; font-size: 1.8rem; transform: rotate(135deg); border: none; display: flex; align-items: center; justify-content: center; }

.speaking-indicator {
  box-shadow: 0 0 15px 5px var(--color-status-success);
}
.sharing-banner {
  position: absolute;
  top: 80px; /* Below the header */
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(var(--color-status-danger-rgb), 0.8);
  color: white;
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
  z-index: 1201;
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  font-weight: var(--font-weight-semibold);
}
.sharing-banner button {
  background-color: white;
  color: var(--color-status-danger);
  border: none;
  border-radius: var(--border-radius-sm);
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-sm);
  cursor: pointer;
}


.quality-settings-wrapper { position: relative; display: flex; align-items: center; }
.quality-menu { position: absolute; bottom: calc(100% + var(--spacing-2)); left: 50%; transform: translateX(-50%); background-color: var(--color-background-panel); border-radius: var(--border-radius-md); box-shadow: var(--shadow-lg); overflow: hidden; width: 150px; }
.quality-menu button { width: 100%; padding: var(--spacing-2) var(--spacing-3); text-align: left; font-size: var(--font-size-sm); transition: background-color 0.1s ease; }
.quality-menu button:hover { background-color: var(--color-background-hover); }
.quality-menu button.active { background-color: var(--color-background-active); font-weight: var(--font-weight-semibold); color: var(--color-brand-primary); }
.quality-menu-fade-enter-active,
.quality-menu-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.quality-menu-fade-enter-from,
.quality-menu-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(10px); }

.call-view-fade-enter-active, .call-view-fade-leave-active { transition: opacity 0.3s ease; }
.call-view-fade-enter-from, .call-view-fade-leave-to { opacity: 0; }
</style>