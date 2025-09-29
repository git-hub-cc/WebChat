<template>
  <div class="controls-overlay" :class="{ visible: visible, 'is-paused': !isPlaying }">
    <!-- Center Screen Controls -->
    <div class="center-controls">
      <div v-if="isBuffering" class="spinner-container">
        <Spinner size="large" />
      </div>
      <button v-else class="play-pause-center-btn" @click="$emit('play-pause')">
        <svg v-if="!isPlaying" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
      </button>
    </div>

    <!-- Bottom Controls Bar -->
    <div class="bottom-bar">
      <!-- Progress Bar -->
      <div class="progress-bar-container">
        <input
            type="range"
            class="progress-bar"
            :min="0"
            :max="duration"
            :value="currentTime"
            @input="$emit('seek', $event.target.value)"
            :style="{ backgroundSize: progressBackgroundSize }"
        />
      </div>

      <!-- Main Controls Row -->
      <div class="controls-row">
        <div class="controls-left">
          <button class="control-btn" @click="$emit('play-pause')">
            <svg v-if="isPlaying" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
          </button>
          <div class="volume-control">
            <button class="control-btn" @click="$emit('toggle-mute')">
              <svg v-if="isMuted || volume === 0" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path></svg>
              <svg v-else-if="volume > 0.5" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path></svg>
              <svg v-else viewBox="0 0 24 24"><path d="M7 9v6h4l5 5V4L11 9H7zm7.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"></path></svg>
            </button>
            <!-- ✅ MODIFICATION START: Update volume slider step -->
            <input
                type="range"
                class="volume-slider"
                min="0"
                max="1"
                step="0.01"
                :value="isMuted ? 0 : volume"
                @input="$emit('set-volume', $event.target.value)"
                :style="{ backgroundSize: volumeBackgroundSize }"
            />
            <!-- ✅ MODIFICATION END -->
          </div>
        </div>
        <div class="controls-right">
          <span class="time-display">{{ formattedTime }} / {{ formattedDuration }}</span>
          <button class="control-btn" @click="$emit('toggle-fullscreen')">
            <svg v-if="isFullscreen" viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"></path></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"></path></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Spinner from './Spinner.vue';

const props = defineProps({
  visible: Boolean,
  isPlaying: Boolean,
  isBuffering: Boolean,
  currentTime: Number,
  duration: Number,
  volume: Number,
  isMuted: Boolean,
  isFullscreen: Boolean,
});

defineEmits(['play-pause', 'seek', 'toggle-mute', 'set-volume', 'toggle-fullscreen']);

const formatTime = (seconds) => {
  if (isNaN(seconds) || seconds === Infinity) return '00:00';
  const floorSeconds = Math.floor(seconds);
  const min = Math.floor(floorSeconds / 60);
  const sec = floorSeconds % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const formattedTime = computed(() => formatTime(props.currentTime));
const formattedDuration = computed(() => formatTime(props.duration));

const progressBackgroundSize = computed(() => {
  const progress = props.duration > 0 ? (props.currentTime / props.duration) : 0;
  const progressPercent = progress * 100;
  const thumbSize = 16;
  const offset = thumbSize / 2 - progress * thumbSize;
  return `calc(${progressPercent}% + ${offset}px) 100%`;
});

const volumeBackgroundSize = computed(() => {
  const vol = props.isMuted ? 0 : props.volume;
  const volPercent = vol * 100;
  const thumbSize = 12;
  const offset = thumbSize / 2 - vol * thumbSize;
  return `calc(${volPercent}% + ${offset}px) 100%`;
});
</script>

<style scoped>
/* No changes needed in the CSS part */
.controls-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 25%, transparent 75%, rgba(0,0,0,0.4) 100%);
  color: white;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}
.controls-overlay.visible {
  opacity: 1;
  pointer-events: all;
}
.controls-overlay.is-paused {
  background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 25%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0.4) 100%);
}

.center-controls {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.play-pause-center-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background-color: rgba(30, 30, 30, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
}
.play-pause-center-btn:hover { background-color: rgba(30, 30, 30, 0.9); }
.play-pause-center-btn svg {
  fill: white;
  width: 36px;
  height: 36px;
  margin-left: 5px; /* Optical alignment for play icon */
}
.controls-overlay.is-paused .play-pause-center-btn {
  pointer-events: all; /* Make clickable only when paused */
}
.controls-overlay:not(.is-paused) .play-pause-center-btn {
  opacity: 0;
  pointer-events: none;
}
.spinner-container :deep(.spinner-large) {
  border-color: rgba(255, 255, 255, 0.3);
  border-top-color: white;
}

.bottom-bar { padding: var(--spacing-2) var(--spacing-4); }

.progress-bar-container {
  padding: var(--spacing-2) 0;
  cursor: pointer;
}
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 5px;
  /* ✅ FIX: 使用 background-color 替代 background, 并使用 theme-aware 变量 */
  background-color: var(--color-border);
  border-radius: 5px;
  outline: none;
  background-image: linear-gradient(var(--color-brand-primary), var(--color-brand-primary));
  background-repeat: no-repeat;
  transition: height 0.2s ease;
}
input[type="range"]:hover { height: 8px; }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.progress-bar-container:hover input[type="range"]::-webkit-slider-thumb { opacity: 1; }

.controls-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.controls-left, .controls-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}
.control-btn {
  background: none;
  border: none;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.control-btn svg { fill: white; width: 24px; height: 24px; }

.volume-control { display: flex; align-items: center; }
/* ✅ MODIFICATION START: Double the width of the volume slider on hover */
.volume-control:hover .volume-slider { width: 160px; opacity: 1; }
/* ✅ MODIFICATION END */
.volume-slider {
  width: 0;
  opacity: 0;
  transition: width 0.3s ease, opacity 0.3s ease;
  height: 4px;
}
.volume-slider::-webkit-slider-thumb {
  width: 12px;
  height: 12px;
  opacity: 1;
}

.time-display { font-size: var(--font-size-sm); font-family: var(--font-family-mono); }
</style>