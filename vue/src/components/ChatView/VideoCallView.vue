<template>
  <transition name="call-view-fade">
    <div class="call-view-container" :class="{ 'pip-mode': isPipMode, 'audio-only-mode': isAudioOnly }" ref="callContainerRef">
      <header class="call-view-header">
        <div class="peer-info">
          <p class="peer-name">{{ viewTitle }}</p>
          <div class="status-indicators">
            <p class="call-duration">{{ callStore.callDurationFormatted }}</p>
            <span v-if="callStore.currentCallQuality.audio" class="quality-indicator" :class="qualityClass('audio')" :title="`音频质量: ${qualityText(callStore.currentCallQuality.audio)}`">A</span>
            <span v-if="callStore.currentCallQuality.video && !isAudioOnly" class="quality-indicator" :class="qualityClass('video')" :title="`视频质量: ${qualityText(callStore.currentCallQuality.video)}`">V</span>
          </div>
        </div>
        <button class="icon-button minimize-button" title="最小化通话" @click="callStore.minimizeCallView()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 14H10V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20 10H14V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 10L21 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 21L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </header>

      <div v-if="amISharingScreen" class="sharing-banner">
        🔴 您正在分享屏幕
        <button @click="callStore.hangUp()">停止分享</button>
      </div>

      <div class="video-streams">
        <video ref="mainVideoRef" class="main-video" autoplay playsinline muted></video>

        <canvas
            ref="whiteboardCanvasRef"
            class="whiteboard-canvas"
            :class="{ active: callStore.isWhiteboardActive }"
        ></canvas>

        <video
            v-show="showPipView"
            ref="pipVideoRef" class="pip-video"
            :class="{ 'speaking-indicator': callStore.isSpeaking }"
            autoplay playsinline muted
            v-motion-slide-right
        ></video>

        <div v-if="isAudioOnly" class="audio-only-ui">
          <Avatar :entity="peerContact" size="xl" :is-speaking="callStore.isSpeaking" />
          <p class="audio-peer-name">{{ peerContact?.name }}</p>
        </div>
      </div>

      <WhiteboardToolbar
          v-if="callStore.isWhiteboardActive && callStore.amISharingScreen"
          @tool-selected="callStore.setDrawingTool($event)"
          @color-selected="callStore.setDrawingColor($event)"
          @undo="callStore.undoLastAction()"
          @clear="callStore.clearWhiteboard()"
      />

      <div class="call-controls" v-motion-slide-bottom>
        <IconButton
            v-if="callStore.isScreenSharing && callStore.amISharingScreen"
            icon="🖌️"
            title="白板"
            @click="callStore.toggleWhiteboard()"
            :class="{ active: callStore.isWhiteboardActive }"
        />
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
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useCallStore } from '@/stores/callStore';
import { useSettingsStore } from '@/stores/settingsStore';
import IconButton from '@/components/Shared/IconButton.vue';
import Avatar from '@/components/Shared/Avatar.vue';
import { throttle } from 'lodash-es';
import WhiteboardToolbar from '@/components/Shared/WhiteboardToolbar.vue';
import { log } from '@/utils';

const callStore = useCallStore();
const settingsStore = useSettingsStore();

const mainVideoRef = ref(null);
const pipVideoRef = ref(null);
const callContainerRef = ref(null);
const whiteboardCanvasRef = ref(null);
let whiteboardCtx = null;
let isDrawing = false;
let lastPos = { x: 0, y: 0 };
let resizeObserver = null;

const mainStream = computed(() => callStore.amISharingScreen ? callStore.localStream : callStore.remoteStream);
const pipStream = computed(() => callStore.amISharingScreen ? callStore.remoteStream : callStore.localStream);

const isPipMode = ref(false);
const showQualityMenu = ref(false);
const qualityOptions = {
  'auto': '自动',
  '720p': '高清 (720p)',
  '480p': '标清 (480p)',
};

watch([mainStream, mainVideoRef], ([newStream, videoEl]) => {
  log(`VideoCallView: 组合 watch 触发。newStream ID: ${newStream?.id}, videoEl 存在吗？ ${!!videoEl}`, 'DEBUG');
  if (videoEl && videoEl.srcObject !== newStream) {
    videoEl.srcObject = newStream instanceof MediaStream ? newStream : null;
    log(`VideoCallView: mainVideoRef.srcObject 已被赋值。`, 'INFO');
  }
}, { immediate: true });

watch([pipStream, pipVideoRef], ([newStream, videoEl]) => {
  if (videoEl && videoEl.srcObject !== newStream) {
    videoEl.srcObject = newStream instanceof MediaStream ? newStream : null;
  }
}, { immediate: true });


const peerContact = computed(() => callStore.peerContact);
const isAudioOnly = computed(() => {
  const hasVideoInStreams = (callStore.localStream?.getVideoTracks().some(t => t.readyState === 'live' && t.enabled) ||
      callStore.remoteStream?.getVideoTracks().some(t => t.readyState === 'live' && t.enabled));
  return !hasVideoInStreams;
});
const amISharingScreen = computed(() => callStore.isScreenSharing && callStore.amISharingScreen);

const showPipView = computed(() => {
  return pipStream.value && pipStream.value.getVideoTracks().some(t => t.readyState === 'live') && !isAudioOnly.value;
});

const viewTitle = computed(() => {
  if (callStore.isScreenSharing && !amISharingScreen.value) {
    return `${peerContact.value?.name} 正在分享屏幕`;
  }
  return peerContact.value?.name;
});

const muteButtonIcon = computed(() => callStore.isAudioMuted ? '🔇' : '🎤');
const muteButtonTitle = computed(() => callStore.isAudioMuted ? '取消静音' : '静音');

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

function toggleQualityMenu() { showQualityMenu.value = !showQualityMenu.value; }
function setQuality(key) { callStore.setCallQualityPreset(key); showQualityMenu.value = false; }
function closeQualityMenuOnClickOutside(event) { if (showQualityMenu.value && !event.target.closest('.quality-settings-wrapper')) { showQualityMenu.value = false; } }

function initWhiteboard() {
  if (!whiteboardCanvasRef.value) return;
  whiteboardCtx = whiteboardCanvasRef.value.getContext('2d');
  const videoElement = mainVideoRef.value;
  if (videoElement) {
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (whiteboardCanvasRef.value.width !== width || whiteboardCanvasRef.value.height !== height) {
          whiteboardCanvasRef.value.width = width;
          whiteboardCanvasRef.value.height = height;
          redrawWhiteboard();
        }
      }
    });
    resizeObserver.observe(videoElement);
  }
  whiteboardCanvasRef.value.addEventListener('mousedown', handleDrawStart);
  whiteboardCanvasRef.value.addEventListener('mousemove', throttledHandleDrawMove);
  whiteboardCanvasRef.value.addEventListener('mouseup', handleDrawEnd);
  whiteboardCanvasRef.value.addEventListener('mouseleave', handleDrawEnd);
}

function getNormalizedPos(event) {
  const canvas = whiteboardCanvasRef.value;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / canvas.clientWidth,
    y: (event.clientY - rect.top) / canvas.clientHeight
  };
}

function handleDrawStart(event) {
  if (!callStore.isWhiteboardActive || !callStore.amISharingScreen) return;
  isDrawing = true;
  const pos = getNormalizedPos(event);
  lastPos = pos;
  const actionData = { type: 'draw_start', tool: callStore.currentDrawingTool, color: callStore.currentDrawingColor, ...pos };
  callStore.addDrawingAction(actionData);
}

// --- ✅ MODIFICATION START: Implement real-time rectangle preview ---
const throttledHandleDrawMove = throttle((event) => {
  if (!isDrawing || !callStore.isWhiteboardActive || !callStore.amISharingScreen) return;
  const pos = getNormalizedPos(event);

  if (callStore.currentDrawingTool === 'rect') {
    // 1. Redraw the committed history to clear the previous preview frame.
    redrawWhiteboard();
    // 2. Draw the temporary preview rectangle directly on the canvas.
    //    This does NOT modify the shared drawingHistory.
    if (whiteboardCtx) {
      const canvas = whiteboardCanvasRef.value;
      whiteboardCtx.strokeStyle = callStore.currentDrawingColor;
      whiteboardCtx.lineWidth = 3;
      const x1 = lastPos.x * canvas.width;
      const y1 = lastPos.y * canvas.height;
      const x2 = pos.x * canvas.width;
      const y2 = pos.y * canvas.height;
      whiteboardCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
  } else { // Original logic for the 'pen' tool
    const actionData = { type: 'draw_move', ...pos };
    callStore.addDrawingAction(actionData);
  }
}, 16); // 16ms throttle is ~60fps, suitable for smooth preview
// --- ✅ MODIFICATION END ---


function handleDrawEnd(event) {
  if (!isDrawing) return;
  isDrawing = false;
  const pos = getNormalizedPos(event);
  if (callStore.currentDrawingTool === 'rect') {
    const actionData = { type: 'draw_rect', color: callStore.currentDrawingColor, x1: lastPos.x, y1: lastPos.y, x2: pos.x, y2: pos.y };
    const startIndex = callStore.drawingHistory.findLastIndex(a => a.type === 'draw_start');
    if (startIndex > -1) { callStore.drawingHistory.splice(startIndex); }
    callStore.addDrawingAction(actionData);
  } else {
    const actionData = { type: 'draw_end' };
    callStore.addDrawingAction(actionData);
  }
}

function redrawWhiteboard() {
  if (!whiteboardCtx || !whiteboardCanvasRef.value) return;
  const canvas = whiteboardCanvasRef.value;
  whiteboardCtx.clearRect(0, 0, canvas.width, canvas.height);
  let isDrawingPen = false;
  let currentColor = '#000000';
  callStore.drawingHistory.forEach(action => {
    const x = action.x * canvas.width;
    const y = action.y * canvas.height;
    switch (action.type) {
      case 'draw_start':
        isDrawingPen = action.tool === 'pen';
        if (isDrawingPen) { currentColor = action.color; whiteboardCtx.beginPath(); whiteboardCtx.moveTo(x, y); }
        break;
      case 'draw_move':
        if (isDrawingPen) { whiteboardCtx.strokeStyle = currentColor; whiteboardCtx.lineWidth = 3; whiteboardCtx.lineTo(x, y); whiteboardCtx.stroke(); whiteboardCtx.beginPath(); whiteboardCtx.moveTo(x, y); }
        break;
      case 'draw_end':
        if (isDrawingPen) { whiteboardCtx.closePath(); isDrawingPen = false; }
        break;
      case 'draw_rect':
        const x1 = action.x1 * canvas.width;
        const y1 = action.y1 * canvas.height;
        const x2 = action.x2 * canvas.width;
        const y2 = action.y2 * canvas.height;
        whiteboardCtx.strokeStyle = action.color;
        whiteboardCtx.lineWidth = 3;
        whiteboardCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        break;
    }
  });
}

watch(() => callStore.drawingHistory, redrawWhiteboard, { deep: true });
watch(() => callStore.isWhiteboardActive, (isActive) => { if (!isActive) { redrawWhiteboard(); } });

onMounted(() => {
  document.addEventListener('click', closeQualityMenuOnClickOutside);
  nextTick(initWhiteboard);
});

onUnmounted(() => {
  document.removeEventListener('click', closeQualityMenuOnClickOutside);
  if (resizeObserver) resizeObserver.disconnect();
  if (whiteboardCanvasRef.value) {
    whiteboardCanvasRef.value.removeEventListener('mousedown', handleDrawStart);
    whiteboardCanvasRef.value.removeEventListener('mousemove', throttledHandleDrawMove);
    whiteboardCanvasRef.value.removeEventListener('mouseup', handleDrawEnd);
    whiteboardCanvasRef.value.removeEventListener('mouseleave', handleDrawEnd);
  }
});
</script>

<style scoped>
.call-view-fade-enter-active, .call-view-fade-leave-active {
  transition: opacity 0.3s var(--transition-easing-spring), transform 0.3s var(--transition-easing-spring);
}
.call-view-fade-enter-from, .call-view-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.call-view-container { position: fixed; inset: 0; background-color: #111; z-index: 1200; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.call-view-header { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; padding: var(--spacing-3); background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent); z-index: 1201; justify-content: space-between; }
.minimize-button { color: white; }
.minimize-button svg { width: 24px; height: 24px; }
.peer-info { color: white; }
.peer-name { font-weight: var(--font-weight-semibold); }
.status-indicators { display: flex; align-items: center; gap: var(--spacing-2); font-size: var(--font-size-sm); opacity: 0.8; }
.quality-indicator { font-size: 0.75rem; padding: 2px 6px; border-radius: var(--border-radius-sm); color: white; font-weight: bold; }
.quality-good { background-color: var(--color-status-success); }
.quality-medium { background-color: var(--color-status-warning); }
.quality-poor { background-color: var(--color-status-danger); }
.video-streams { position: absolute; inset: 0; }

.main-video, .pip-video {
  position: absolute;
  object-fit: contain;
  width: 100%;
  height: 100%;
}
.pip-video {
  bottom: 120px;
  right: 20px;
  width: 15vw;
  max-width: 200px;
  min-width: 120px;
  aspect-ratio: 9/16;
  height: auto;
  border: 2px solid white;
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-md);
  transition: box-shadow 0.2s ease-in-out;
}

.whiteboard-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1202;
}
.whiteboard-canvas.active {
  pointer-events: auto;
  cursor: crosshair;
}

.audio-only-ui { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; color: white; }
.audio-peer-name { font-size: 1.5rem; margin-top: var(--spacing-4); }
.call-view-container.audio-only-mode .main-video, .call-view-container.audio-only-mode .pip-video { display: none; }
.call-controls { position: absolute; bottom: 30px; display: flex; gap: var(--spacing-4); background-color: rgba(0, 0, 0, 0.4); padding: var(--spacing-2) var(--spacing-4); border-radius: var(--border-radius-pill); backdrop-filter: blur(5px); z-index: 1203; }
.call-controls .icon-button { color: white; width: 56px; height: 56px; }
.call-controls .icon-button.active { background-color: rgba(255, 255, 255, 0.2); }
.end-call-button { width: 56px; height: 56px; border-radius: 50%; background-color: var(--color-status-danger); color: white; font-size: 1.8rem; transform: rotate(135deg); border: none; display: flex; align-items: center; justify-content: center; }

.speaking-indicator {
  box-shadow: 0 0 15px 5px var(--color-status-success);
}
.sharing-banner {
  position: absolute;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(220, 53, 69, 0.8);
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