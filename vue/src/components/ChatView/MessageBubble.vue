<template>
  <div
      class="message-wrapper"
      :class="{ ...wrapperClasses, 'consecutive': isConsecutive }"
      @contextmenu.prevent="showContextMenu"
      @dblclick="showContextMenu"
      v-motion-slide-bottom
      :delay="100"
  >
    <div v-if="message.type === 'system' || message.isRetracted" class="system-message">
      <!-- --- [动画] START: 优化 AI 思考中动画 --- -->
      <div v-if="message.toolCallInfo || message.isThinking" class="tool-call-indicator">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <span>{{ message.toolCallInfo ? `正在使用工具: ${message.toolCallInfo.name}...` : '思考中...' }}</span>
      </div>
      <!-- --- [动画] END --- -->
      <div v-else-if="message.subType === 'call-log'" class="call-log-content">
        <span class="call-icon">{{ callIcon }}</span>
        <span>{{ message.content }}</span>
      </div>
      <span v-else>{{ message.content }}</span>
    </div>

    <div v-else class="message-bubble" :class="{ 'character-message': isCharacterMessage, [message.sender]: isCharacterMessage }">
      <div v-if="!isMyMessage && isGroupChat" class="sender-name">
        {{ senderName }}
      </div>
      <div class="content-wrapper">
        <div v-if="message.type === 'text'" class="message-content" v-html="formattedContent"></div>

        <div v-else-if="message.type === 'audio'" class="audio-content">
          <button class="play-button" @click="toggleAudioPlay">{{ isPlaying ? '❚❚' : '▶' }}</button>
          <div ref="waveformRef" class="waveform-container"></div>
          <span class="duration-label">{{ formatDuration(message.duration) }}</span>
        </div>

        <!-- --- MODIFICATION START: Updated media handling for previews and placeholders --- -->
        <div v-else-if="isMedia" class="media-content" @click="handleMediaClick">
          <div v-if="message.type === 'sticker'" class="sticker-wrapper">
            <!-- --- [动画] START: 应用骨架屏加载动画 --- -->
            <div class="media-placeholder" v-if="!displayUrl">
              <SkeletonLoader type="grid-item" :shimmer="true" />
            </div>
            <!-- --- [动画] END --- -->
            <img v-if="displayUrl" :src="displayUrl" :alt="message.fileName || 'sticker'" class="sticker-image">
          </div>
          <div v-else-if="isPreviewableMedia" class="media-preview-container">
            <!-- --- [动画] START: 应用骨架屏加载动画 --- -->
            <div class="media-placeholder" v-if="!displayUrl">
              <SkeletonLoader type="grid-item" :shimmer="true" />
            </div>
            <!-- --- [动画] END --- -->
            <div v-if="displayUrl" class="video-preview">
              <video v-if="message.fileType?.startsWith('video/')" :src="displayUrl" preload="metadata"></video>
              <img v-else :src="displayUrl" :alt="message.fileName || 'image preview'" class="media-image">
              <div v-if="message.fileType?.startsWith('video/')" class="play-overlay">▶</div>
            </div>
          </div>
          <div v-else class="file-info-wrapper">
            <div class="file-icon-container">{{ getFileExtension(message.fileName) }}</div>
            <div class="file-info-text">
              <div class="file-name">{{ message.fileName || '文件' }}</div>
              <div class="file-meta">{{ formatSize(message.size) }}</div>
            </div>
          </div>
        </div>
        <!-- --- MODIFICATION END --- -->


        <div v-if="showTtsControl" class="tts-control">
          <button v-if="ttsState === 'error'" class="tts-button error" title="TTS 错误, 点击重试" @click.stop="retryTts">⚠️</button>
          <Spinner v-else-if="ttsState === 'loading'" size="x-small" />
          <button v-else-if="ttsState === 'ready' || ttsState === 'playing'" class="tts-button" :class="{ playing: ttsState === 'playing' }" @click.stop="toggleTtsPlay" :title="ttsState === 'playing' ? '暂停' : '播放'"></button>
        </div>
      </div>
      <div v-if="!message.isRetracted && message.type !== 'system'" class="message-meta">
        <span class="timestamp">{{ formattedTimestamp }}</span>
        <div v-if="isMyMessage" class="status-icon">
          <Spinner v-if="message.status === 'sending'" size="x-small" />
          <span v-else-if="message.status === 'sent'" class="delivered">✓</span>
          <span v-else-if="message.status === 'failed'" class="failed-icon" title="发送失败，点击重试" @click="resend">!</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted, watch, onMounted } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useUiStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useTtsStore } from '@/stores/ttsStore';
import { formatMessageText, log } from '@/utils';
import Spinner from '@/components/Shared/Spinner.vue';
import SkeletonLoader from '@/components/Shared/SkeletonLoader.vue';
import { eventBus } from '@/services/eventBus';
import { mediaCacheService } from '@/services/mediaCacheService';
import WaveSurfer from 'wavesurfer.js';

const props = defineProps({
  message: { type: Object, required: true },
  isConsecutive: { type: Boolean, default: false }
});

const userStore = useUserStore();
const uiStore = useUiStore();
const chatStore = useChatStore();
const ttsStore = useTtsStore();

const isMyMessage = computed(() => props.message.sender === userStore.userId);
const isGroupChat = computed(() => !!props.message.groupId);
const senderContact = computed(() => userStore.contacts[props.message.sender]);
const isCharacterMessage = computed(() => !isMyMessage.value && senderContact.value?.isSpecial);
const wrapperClasses = computed(() => ({ 'sent': isMyMessage.value, 'received': !isMyMessage.value, 'system-wrapper': props.message.type === 'system' || props.message.isRetracted }));
const senderName = computed(() => senderContact.value ? senderContact.value.name : `用户 ${String(props.message.sender).substring(0, 4)}`);
const formattedContent = computed(() => props.message.type === 'text' && props.message.content ? formatMessageText(props.message.content) : '');
const formattedTimestamp = computed(() => new Date(props.message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const displayUrl = ref(null);
const isPlaying = ref(false);

const waveformRef = ref(null);
let wavesurfer = null;

const isMedia = computed(() => ['file', 'image', 'video', 'sticker', 'audio'].includes(props.message.type));
// --- MODIFICATION START: New computed property to identify previewable media ---
const isPreviewableMedia = computed(() => {
  const type = props.message.fileType;
  if (!type) return false;
  return type.startsWith('image/') || type.startsWith('video/');
});
// --- MODIFICATION END ---
const getFileExtension = (name) => name?.split('.').pop()?.substring(0, 4).toUpperCase() || 'FILE';
const formatSize = (bytes) => { if (typeof bytes !== 'number') return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; };
const formatDuration = (seconds) => { if (typeof seconds !== 'number') return '0:00'; const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60); return `${min}:${sec < 10 ? '0' : ''}${sec}`; };
const ttsAudioPlayer = ref(null);
const ttsState = computed(() => ttsStore.messageTtsState[props.message.id] || 'idle');
const showTtsControl = computed(() => isCharacterMessage.value && senderContact.value?.aiConfig?.tts?.enabled && props.message.type === 'text' && props.message.content?.trim().length > 0 && !props.message.isStreaming);

const callIcon = computed(() => {
  if (props.message.subType !== 'call-log' || !props.message.callData) return '';
  const { type, callerId } = props.message.callData;
  const isOriginalCaller = callerId === userStore.userId;
  if (type === 'start' || type === 'end') return '📞';
  if (type === 'missed') return isOriginalCaller ? '↗' : '↙';
  if (type === 'declined') return '🚫';
  if (type === 'cancelled') return '↩️';
  return '📞';
});

watch(ttsState, (newState, oldState) => { const audioUrl = ttsStore.audioUrlCache.get(props.message.id); if (newState === 'playing' && audioUrl) { if (!ttsAudioPlayer.value) { ttsAudioPlayer.value = new Audio(audioUrl); ttsAudioPlayer.value.onended = () => ttsStore.setPlaybackFinished(props.message.id); ttsAudioPlayer.value.onpause = () => ttsStore.setPlaybackFinished(props.message.id); } ttsAudioPlayer.value.play().catch(e => { log(`Error playing TTS audio: ${e.message}`, 'ERROR'); ttsStore.messageTtsState[props.message.id] = 'error'; }); } else if (newState === 'ready' && oldState === 'playing') { if (ttsAudioPlayer.value) ttsAudioPlayer.value.pause(); } });
function toggleTtsPlay() { ttsStore.togglePlay(props.message.id); }
function retryTts() { ttsStore.requestTtsForMessage({ ...props.message, senderContact: senderContact.value }); }
async function loadMedia() { if (!isMedia.value || !props.message.fileHash) return; const url = await mediaCacheService.getUrl(props.message.fileHash); if (url) displayUrl.value = url; else eventBus.on('file:ready', handleFileReady); }
function handleFileReady({ fileHash }) { if (fileHash === props.message.fileHash) { loadMedia(); eventBus.off('file:ready', handleFileReady); } }
// --- MODIFICATION START: Updated media click handler for previews ---
function handleMediaClick() {
  const type = props.message.fileType;
  const isPreviewable = type && (type.startsWith('image/') || type.startsWith('video/') || type === 'application/pdf' || type.startsWith('text/'));
  if (displayUrl.value && isPreviewable) {
    uiStore.showMediaViewer({
      type: props.message.type,
      fileType: type,
      src: displayUrl.value,
      alt: props.message.fileName,
    });
  } else if (displayUrl.value) {
    const a = document.createElement('a');
    a.href = displayUrl.value;
    a.download = props.message.fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
// --- MODIFICATION END ---

function toggleAudioPlay() { if (wavesurfer) wavesurfer.playPause(); }

function showContextMenu(event) {
  if (props.message.type === 'system' || props.message.isRetracted) return;
  const items = [{
    label: '删除',
    action: () => uiStore.showConfirmationModal({ message: "确定要删除这条消息吗？此操作仅在您本地生效。", onConfirm: () => chatStore.deleteMessage(props.message.id) }),
    class: 'danger'
  }];
  if (chatStore.isMessageRetractable(props.message.id)) {
    items.push({ label: '撤回', action: () => chatStore.retractMessage(props.message.id) });
  }
  // --- MODIFICATION START: Add context menu for file messages ---
  if (isMedia.value && displayUrl.value) {
    const type = props.message.fileType;
    const isPreviewable = type && (type.startsWith('image/') || type.startsWith('video/') || type === 'application/pdf' || type.startsWith('text/'));
    if (isPreviewable) {
      items.unshift({ label: '预览', action: handleMediaClick });
    }
    items.unshift({
      label: '下载',
      action: () => {
        const a = document.createElement('a');
        a.href = displayUrl.value;
        a.download = props.message.fileName || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
  }
  // --- MODIFICATION END ---
  uiStore.showContextMenu({ event, items, target: { type: 'message', id: props.message.id } });
}
async function resend() { if (props.message.status !== 'failed' || !isMyMessage.value) return; await chatStore.resendFailedMessages(chatStore.currentChatId); }

onMounted(async () => {
  if (showTtsControl.value && ttsState.value === 'idle') {
    ttsStore.requestTtsForMessage({ ...props.message, senderContact: senderContact.value });
  }

  if (props.message.type === 'audio' && waveformRef.value) {
    await loadMedia();
    if (displayUrl.value) {
      wavesurfer = WaveSurfer.create({
        container: waveformRef.value,
        url: displayUrl.value,
        height: 38,
        waveColor: 'rgba(128, 128, 128, 0.5)',
        progressColor: 'var(--color-brand-primary)',
        cursorWidth: 2,
        cursorColor: 'var(--color-brand-primary-dark)',
        barWidth: 3,
        barRadius: 3,
        interact: true,
      });
      wavesurfer.on('play', () => isPlaying.value = true);
      wavesurfer.on('pause', () => isPlaying.value = false);
      wavesurfer.on('finish', () => isPlaying.value = false);
      wavesurfer.on('error', (err) => log(`WaveSurfer error: ${err}`, 'ERROR'));
    }
  }
});

watch(() => props.message.fileHash, loadMedia, { immediate: true });

onUnmounted(() => {
  eventBus.off('file:ready', handleFileReady);
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }
  if (ttsAudioPlayer.value) {
    ttsAudioPlayer.value.pause();
    ttsAudioPlayer.value = null;
  }
});
</script>

<style scoped>
.message-wrapper { display: flex; margin-bottom: var(--spacing-2); padding: 0 var(--spacing-1); }
.message-wrapper.consecutive { margin-top: calc(-1 * var(--spacing-2) + 4px); }
.message-wrapper.consecutive .sender-name { display: none; }
.message-wrapper.sent { justify-content: flex-end; }
.message-wrapper.received { justify-content: flex-start; }
.message-wrapper.system-wrapper { justify-content: center; }

.system-message { display: inline-block; max-width: 80%; padding: var(--spacing-1) var(--spacing-3); margin: var(--spacing-1) 0; font-size: var(--font-size-sm); color: var(--color-message-system-text, var(--color-text-secondary)); background-color: var(--color-message-system-bg); border-radius: var(--border-radius-pill); text-align: center; word-wrap: break-word; }
.call-log-content, .tool-call-indicator { display: flex; align-items: center; gap: var(--spacing-2); }
.tool-call-indicator { font-style: italic; }
.call-icon { font-size: 1rem; opacity: 0.8; }
.tool-call-indicator :deep(.spinner-x-small) { width: 1em; height: 1em; border-width: 2px; }

/* --- [动画] START: 思考中动画 --- */
.thinking-dots { display: flex; gap: 3px; }
.thinking-dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background-color: var(--color-text-secondary);
  animation: thinking-bounce 1.4s infinite ease-in-out both;
}
.thinking-dots span:nth-child(1) { animation-delay: -0.32s; }
.thinking-dots span:nth-child(2) { animation-delay: -0.16s; }
@keyframes thinking-bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1.0); }
}
/* --- [动画] END --- */


.message-bubble { max-width: 75%; padding: var(--spacing-2) var(--spacing-3); border-radius: var(--border-radius-lg); position: relative; word-wrap: break-word; box-shadow: var(--shadow-sm); }
.message-wrapper.sent .message-bubble { background-color: var(--color-message-sent-bg); color: var(--color-message-sent-text); border-bottom-right-radius: var(--border-radius-sm); }
.message-wrapper.received .message-bubble { background-color: var(--color-message-received-bg); color: var(--color-message-received-text); border-bottom-left-radius: var(--border-radius-sm); }
.sender-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-brand-secondary); margin-bottom: var(--spacing-1); }
.message-content { line-height: var(--line-height-base); white-space: pre-wrap; }
.message-bubble.character-message { background: var(--character-message-bg, var(--color-message-received-bg)); border: 1px solid var(--character-accent-color, transparent); box-shadow: 0 0 8px var(--character-glow-color, transparent); }
.message-bubble.character-message .sender-name { color: var(--character-primary-color, var(--color-brand-secondary)); }
.media-content { cursor: pointer; }
.sticker-wrapper { padding: 0; background: transparent !important; position: relative; width: 128px; height: 128px; }
.sticker-image { max-width: 100%; max-height: 100%; display: block; }
.audio-content { display: flex; align-items: center; gap: var(--spacing-2); min-width: 300px; }
.play-button { font-size: 1.5rem; width: 32px; height: 32px; border-radius: 50%; background: var(--color-brand-primary); color: white; display:flex; align-items:center; justify-content:center; flex-shrink:0; border: none; cursor: pointer; }
.waveform-container { flex-grow: 1; height: 38px; }
.duration-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
.message-wrapper.sent .duration-label { color: rgba(255, 255, 255, 0.7); }

.media-preview-container {
  position: relative;
  width: auto;
  height: auto;
  max-width: 300px;
  max-height: 300px;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  /* --- MODIFICATION START: Styles for placeholder --- */
  background-color: var(--color-background-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Add an aspect-ratio to prevent layout shift. Assume a common ratio. */
  aspect-ratio: 16 / 9;
  /* --- MODIFICATION END --- */
}

.media-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-elevated);
}

/* --- [动画] START: 移除 Spinner，改为骨架屏组件 --- */
/* The spinner component is replaced by the SkeletonLoader component in the template. */
/* --- [动画] END --- */


.media-image, .video-preview video { width: 100%; height: 100%; object-fit: cover; }
.video-preview { position: relative; width: 100%; height: 100%; }
.video-preview .play-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 2rem; color: white; background: rgba(0,0,0,0.4); border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.file-info-wrapper { display: flex; align-items: center; gap: var(--spacing-3); padding: var(--spacing-2); background: rgba(0,0,0,0.02); border-radius: var(--border-radius-md); min-width: 200px; cursor: pointer; }
.colorscheme-dark .file-info-wrapper { background: rgba(255,255,255,0.05); }
.file-icon-container { width: 40px; height: 40px; flex-shrink: 0; background-color: var(--color-background-hover); border-radius: var(--border-radius-md); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--color-text-secondary); }
.file-info-text { overflow: hidden; }
.file-name { font-weight: var(--font-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-meta { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.message-meta { display: flex; justify-content: flex-end; align-items: center; font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: var(--spacing-1); float: right; clear: both; }
.message-wrapper.sent .message-meta { color: rgba(255, 255, 255, 0.7); }
.status-icon { margin-left: var(--spacing-1); display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; font-family: sans-serif; }
.status-icon .delivered { color: var(--color-brand-primary); }
.message-wrapper.sent .status-icon .delivered { color: #7cfc00; }
.status-icon :deep(.spinner-x-small) { width: 12px; height: 12px; border-width: 2px; }
.failed-icon { color: var(--color-status-danger); font-weight: bold; cursor: pointer; }
.content-wrapper { display: flex; align-items: flex-start; gap: var(--spacing-2); }
.tts-control { flex-shrink: 0; margin-top: 4px; }
.tts-button { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--color-brand-primary); font-size: 1.1rem; transition: background-color 0.2s ease; background: none; border: none; cursor: pointer; padding: 0; }
.tts-button:hover { background-color: var(--color-background-hover); }
.tts-button::before { content: '▶'; }
.tts-button.playing::before { content: '❚❚'; font-size: 0.9rem; }
.tts-button.error { color: var(--color-status-danger); font-size: 1.1rem; }
.tts-button.error::before { content: none; }
</style>