<template>
  <transition name="media-viewer-fade">
    <div
        v-if="uiStore.activeModal === 'mediaViewer' && content"
        class="viewer-backdrop"
        :class="{ 'widget-active': isWidgetActive }"
        @click.self="close"
        @mousemove="showControls"
    >
      <button class="close-button" @click="close" title="关闭 (Esc)">×</button>
      <div class="media-container" ref="mediaContainerRef" v-motion-pop>
        <img
            v-if="isImage"
            :src="content.src"
            :alt="content.alt"
            class="media-content"
        />
        <div v-else-if="isVideo" class="video-wrapper">
          <video
              ref="videoRef"
              :src="content.src"
              class="media-content"
              autoplay
              @click="handlePlayPause"
          ></video>
          <CustomVideoControls
              :visible="controlsVisible"
              :is-playing="isPlaying"
              :is-buffering="isBuffering"
              :current-time="currentTime"
              :duration="duration"
              :volume="currentVolume"
              :is-muted="isMuted"
              :is-fullscreen="isFullscreen"
              @play-pause="handlePlayPause"
              @seek="handleSeek"
              @set-volume="handleSetVolume"
              @toggle-mute="handleToggleMute"
              @toggle-fullscreen="handleToggleFullscreen"
          />
        </div>
        <iframe
            v-else-if="isPdf"
            :src="content.src"
            class="media-content iframe-content"
            frameborder="0"
        ></iframe>
        <div v-else-if="isText" class="text-preview-wrapper">
          <pre class="media-content text-content">{{ textFileContent || '加载中...' }}</pre>
        </div>
        <div v-else class="unsupported-preview">
          <p>不支持预览此文件类型</p>
          <span>{{ content.alt }}</span>
          <button @click="downloadFile">下载文件</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { useCallStore } from '@/stores/callStore';
import CustomVideoControls from '@/components/Shared/CustomVideoControls.vue';

const uiStore = useUiStore();
const callStore = useCallStore();
const content = computed(() => uiStore.mediaViewerContent);
const textFileContent = ref('');

const isWidgetActive = computed(() => callStore.isCallActive && !callStore.isFullScreenCallViewVisible);

const isImage = computed(() => content.value?.fileType?.startsWith('image/') || content.value?.type === 'image');
const isVideo = computed(() => content.value?.fileType?.startsWith('video/') || content.value?.type === 'video');
const isPdf = computed(() => content.value?.fileType === 'application/pdf');
const isText = computed(() => content.value?.fileType?.startsWith('text/'));

// State and logic for custom video player
const videoRef = ref(null);
const mediaContainerRef = ref(null);
const isPlaying = ref(false);
const isBuffering = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const currentVolume = ref(1);
const isMuted = ref(false);
const isFullscreen = ref(false);
const controlsVisible = ref(true);
let hideControlsTimeout = null;

const updateVideoState = () => {
  if (!videoRef.value) return;
  isPlaying.value = !videoRef.value.paused;
  currentTime.value = videoRef.value.currentTime;
  duration.value = videoRef.value.duration;
  currentVolume.value = videoRef.value.volume;
  isMuted.value = videoRef.value.muted;
};

// ✅ FIX: Add guard clauses to all event handlers that access videoRef.value
const onTimeUpdate = () => { if (videoRef.value) currentTime.value = videoRef.value.currentTime; };
const onDurationChange = () => { if (videoRef.value) duration.value = videoRef.value.duration; };
const onPlay = () => { isPlaying.value = true; isBuffering.value = false; };
const onPause = () => { isPlaying.value = false; };
const onVolumeChange = () => { if (videoRef.value) { currentVolume.value = videoRef.value.volume; isMuted.value = videoRef.value.muted; } };
const onWaiting = () => { isBuffering.value = true; };
const onPlaying = () => { isBuffering.value = false; };

// ✅ FIX: Define the onFullscreenChange handler
const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

const handlePlayPause = () => videoRef.value?.paused ? videoRef.value?.play() : videoRef.value?.pause();
const handleSeek = (newTime) => { if(videoRef.value) videoRef.value.currentTime = newTime; };
const handleSetVolume = (newVolume) => { if(videoRef.value) { videoRef.value.volume = newVolume; videoRef.value.muted = false; } };
const handleToggleMute = () => { if(videoRef.value) videoRef.value.muted = !videoRef.value.muted; };
const handleToggleFullscreen = () => {
  if (!document.fullscreenElement) {
    mediaContainerRef.value?.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};

const showControls = () => {
  controlsVisible.value = true;
  if (hideControlsTimeout) clearTimeout(hideControlsTimeout);
  hideControlsTimeout = setTimeout(() => {
    if (isPlaying.value) {
      controlsVisible.value = false;
    }
  }, 3000);
};

const close = () => {
  uiStore.hideModal();
};

const handleKeyDown = (event) => {
  if (event.key === 'Escape') {
    if (isFullscreen.value) {
      document.exitFullscreen();
    } else {
      close();
    }
  }
  if (isVideo.value && event.key === ' ' && videoRef.value) {
    event.preventDefault();
    handlePlayPause();
  }
};

watch(content, async (newContent) => {
  if (newContent && isText.value) {
    try {
      const response = await fetch(newContent.src);
      if (!response.ok) throw new Error('Network response was not ok');
      textFileContent.value = await response.text();
    } catch (error) {
      textFileContent.value = '无法加载文件内容。';
      console.error("Error fetching text file for preview:", error);
    }
  } else {
    textFileContent.value = '';
  }

  if (newContent && isVideo.value) {
    await nextTick();
    const video = videoRef.value;
    if (video) {
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('durationchange', onDurationChange);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('volumechange', onVolumeChange);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('playing', onPlaying);
      updateVideoState();
      showControls();
    }
  }
}, { immediate: true });

function downloadFile() {
  if (!content.value?.src) return;
  const a = document.createElement('a');
  a.href = content.value.src;
  a.download = content.value.alt || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  const video = videoRef.value;
  if (video) {
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('durationchange', onDurationChange);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('volumechange', onVolumeChange);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('playing', onPlaying);
  }
  if (hideControlsTimeout) clearTimeout(hideControlsTimeout);
});
</script>

<style scoped>
.viewer-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  padding: var(--spacing-4);
  box-sizing: border-box;
  transition: top 0.3s var(--transition-easing), height 0.3s var(--transition-easing);
}

.viewer-backdrop.widget-active {
  top: 50px;
  height: calc(100% - 50px);
}

.close-button {
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: rgba(30, 30, 30, 0.7);
  color: white;
  font-size: 2rem;
  line-height: 1;
  border: none;
  cursor: pointer;
  z-index: 1501;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.close-button:hover {
  background-color: rgba(220, 53, 69, 0.8);
  transform: scale(1.1);
}

.media-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-content {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--border-radius-md);
  box-shadow: 0 0 40px rgba(0,0,0,0.5);
}
.iframe-content {
  width: 90vw;
  height: 90vh;
  max-width: 1200px;
  background-color: white;
}
.text-preview-wrapper {
  width: 90vw;
  height: 90vh;
  max-width: 1200px;
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-md);
  overflow: hidden;
  display: flex;
}
.text-content {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: var(--spacing-4);
  font-family: var(--font-family-mono);
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  text-align: left;
}
.unsupported-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-4);
  color: white;
  padding: var(--spacing-5);
  background: var(--color-background-elevated);
  border-radius: var(--border-radius-lg);
  text-align: center;
}
.unsupported-preview p {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}
.unsupported-preview span {
  font-family: var(--font-family-mono);
  opacity: 0.8;
}
.unsupported-preview button {
  background-color: var(--color-brand-primary);
  color: white;
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
}

.media-viewer-fade-enter-active,
.media-viewer-fade-leave-active {
  transition: opacity 0.3s var(--transition-easing);
}
.media-viewer-fade-enter-from,
.media-viewer-fade-leave-to {
  opacity: 0;
}
.video-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-wrapper .media-content {
  border-radius: 0;
  box-shadow: none;
}
</style>