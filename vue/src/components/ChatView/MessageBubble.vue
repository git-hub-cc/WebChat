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
      <div v-if="message.toolCallInfo || message.isThinking" class="tool-call-indicator">
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <span>{{ message.toolCallInfo ? `正在使用工具: ${message.toolCallInfo.name}...` : '思考中...' }}</span>
      </div>
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

        <!-- ✅ MODIFICATION START: Location content is now a clickable viewer trigger -->
        <div v-else-if="message.type === 'location'" class="location-content" @click="openLocationViewer">
          <div class="location-icon">📍</div>
          <div class="location-info">
            <div class="location-title">位置信息</div>
            <div class="location-coords">
              {{ message.latitude.toFixed(4) }}, {{ message.longitude.toFixed(4) }}
            </div>
          </div>
        </div>
        <!-- ✅ MODIFICATION END -->

        <div v-else-if="isMedia" class="media-content" @click="handleMediaClick">
          <div v-if="message.status === 'receiving'" class="media-placeholder receiving">
            <div class="transfer-info">
              <span class="file-name" :title="message.fileName">{{ message.fileName }}</span>
              <progress
                  v-if="transferProgress"
                  :value="transferProgress.receivedBytes"
                  :max="transferProgress.totalBytes"
                  class="transfer-progress"
              ></progress>
              <span class="transfer-stats">
                {{ formatSize(transferProgress?.receivedBytes || 0) }} / {{ formatSize(message.fileSize) }}
                <span v-if="transferProgress && transferProgress.etaSeconds < Infinity"> - ETA: {{ formatEta(transferProgress.etaSeconds) }}</span>
              </span>
            </div>
          </div>

          <div v-else>
            <div v-if="message.type === 'sticker'" class="sticker-wrapper">
              <div class="media-placeholder" v-if="!displayUrl">
                <SkeletonLoader type="grid-item" :shimmer="true" />
              </div>
              <img v-if="displayUrl" :src="displayUrl" :alt="message.fileName || 'sticker'" class="sticker-image" loading="lazy">
            </div>
            <div v-else-if="isPreviewableMedia" class="media-preview-container">
              <div class="media-placeholder" v-if="!thumbnailSource">
                <SkeletonLoader type="grid-item" :shimmer="true" />
              </div>
              <div v-if="thumbnailSource" class="video-preview">
                <img :src="thumbnailSource" :alt="message.fileName || 'media preview'" class="media-image" loading="lazy">
                <div v-if="message.fileType?.startsWith('video/')" class="play-overlay">
                  <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5v14l11-7z"></path>
                  </svg>
                </div>
              </div>
            </div>
            <div v-else class="file-info-wrapper">
              <div class="file-icon-container">{{ getFileExtension(message.fileName) }}</div>
              <div class="file-info-text">
                <div class="file-name" :title="message.fileName || '文件'">{{ message.fileName || '文件' }}</div>
                <div class="file-meta">{{ formatSize(message.size) }}</div>
              </div>
            </div>
          </div>
        </div>


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
          <span v-else-if="message.status === 'sent' || message.status === 'delivered'" class="delivered">✓</span>
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
import { useTransferStore } from '@/stores/transferStore';
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
const transferStore = useTransferStore();

const isMyMessage = computed(() => props.message.sender === userStore.userId);
const isGroupChat = computed(() => !!props.message.groupId);
const senderContact = computed(() => userStore.contacts[props.message.sender]);
const isCharacterMessage = computed(() => !isMyMessage.value && senderContact.value?.isSpecial);
const wrapperClasses = computed(() => ({ 'sent': isMyMessage.value, 'received': !isMyMessage.value, 'system-wrapper': props.message.type === 'system' || props.message.isRetracted }));
const senderName = computed(() => senderContact.value ? senderContact.value.name : `用户 ${String(props.message.sender).substring(0, 4)}`);
const formattedContent = computed(() => props.message.type === 'text' && props.message.content ? formatMessageText(props.message.content) : '');
const formattedTimestamp = computed(() => new Date(props.message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const displayUrl = ref(null);
const posterUrl = ref(null);
const isPlaying = ref(false);

const waveformRef = ref(null);
let wavesurfer = null;

const isMedia = computed(() => ['file', 'image', 'video', 'sticker', 'audio'].includes(props.message.type));
const isPreviewableMedia = computed(() => {
  const type = props.message.fileType;
  if (!type) return false;
  return type.startsWith('image/') || type.startsWith('video/');
});

const thumbnailSource = computed(() => {
  if (props.message.fileType?.startsWith('video/')) {
    return posterUrl.value;
  }
  if (props.message.fileType?.startsWith('image/')) {
    return displayUrl.value;
  }
  return null;
});

const getFileExtension = (name) => name?.split('.').pop()?.substring(0, 4).toUpperCase() || 'FILE';
const formatSize = (bytes) => { if (typeof bytes !== 'number' || isNaN(bytes)) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; };
const formatDuration = (seconds) => { if (typeof seconds !== 'number') return '0:00'; const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60); return `${min}:${sec < 10 ? '0' : ''}${sec}`; };
const ttsAudioPlayer = ref(null);
const ttsState = computed(() => ttsStore.messageTtsState[props.message.id] || 'idle');
const showTtsControl = computed(() => isCharacterMessage.value && senderContact.value?.aiConfig?.tts?.enabled && props.message.type === 'text' && props.message.content?.trim().length > 0 && !props.message.isStreaming);

const transferProgress = computed(() => transferStore.transfers[props.message.fileHash]);

const formatEta = (seconds) => {
  if (seconds === Infinity || !seconds) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};

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

// ✅ MODIFICATION START: Add handler to open the location viewer
function openLocationViewer() {
  uiStore.showLocationViewer({
    latitude: props.message.latitude,
    longitude: props.message.longitude
  });
}
// ✅ MODIFICATION END

watch(ttsState, (newState, oldState) => { const audioUrl = ttsStore.audioUrlCache.get(props.message.id); if (newState === 'playing' && audioUrl) { if (!ttsAudioPlayer.value) { ttsAudioPlayer.value = new Audio(audioUrl); ttsAudioPlayer.value.onended = () => ttsStore.setPlaybackFinished(props.message.id); ttsAudioPlayer.value.onpause = () => ttsStore.setPlaybackFinished(props.message.id); } ttsAudioPlayer.value.play().catch(e => { log(`Error playing TTS audio: ${e.message}`, 'ERROR'); ttsStore.messageTtsState[props.message.id] = 'error'; }); } else if (newState === 'ready' && oldState === 'playing') { if (ttsAudioPlayer.value) ttsAudioPlayer.value.pause(); } });
function toggleTtsPlay() { ttsStore.togglePlay(props.message.id); }
function retryTts() { ttsStore.requestTtsForMessage({ ...props.message, senderContact: senderContact.value }); }
async function loadMedia() {
  if (!isMedia.value || !props.message.fileHash) return;
  const mainUrl = await mediaCacheService.getUrl(props.message.fileHash);
  if (mainUrl) displayUrl.value = mainUrl;

  if (props.message.fileType?.startsWith('video/')) {
    const thumbUrl = await mediaCacheService.getUrl(props.message.fileHash, true);
    if (thumbUrl) posterUrl.value = thumbUrl;
  }

  if (!mainUrl) eventBus.on('file:ready', handleFileReady);
}
function handleFileReady({ fileHash }) {
  if (fileHash === props.message.fileHash) {
    posterUrl.value = null; // Reset poster to force re-evaluation
    loadMedia();
    eventBus.off('file:ready', handleFileReady);
  }
}
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
function toggleAudioPlay() { if (wavesurfer) wavesurfer.playPause(); }

function showContextMenu(event) {
  if (props.message.type === 'system' || props.message.isRetracted) return;
  const items = [];

  // ✅ MODIFICATION START: Add "Copy" option for text messages
  if (props.message.type === 'text' && props.message.content) {
    items.push({
      label: '复制',
      action: () => {
        // Remove streaming cursor and trim whitespace before copying
        const textToCopy = props.message.content.replace(/▍/g, '').trim();
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
              eventBus.emit('showNotification', { message: '已复制到剪贴板', type: 'success' });
            })
            .catch(err => {
              log(`复制失败: ${err}`, 'ERROR');
              eventBus.emit('showNotification', { message: '复制失败', type: 'error' });
            });
      }
    });
  }
  // ✅ MODIFICATION END

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

  items.push({
    label: '删除',
    action: () => uiStore.showConfirmationModal({ message: "确定要删除这条消息吗？此操作仅在您本地生效。", onConfirm: () => chatStore.deleteMessage(props.message.id) }),
    class: 'danger'
  });

  if (chatStore.isMessageRetractable(props.message.id)) {
    items.push({ label: '撤回', action: () => chatStore.retractMessage(props.message.id) });
  }


  if (items.length > 0) {
    uiStore.showContextMenu({ event, items, target: { type: 'message', id: props.message.id } });
  }
}
async function resend() { if (props.message.status !== 'failed' || !isMyMessage.value) return; await chatStore.resendFailedMessages(chatStore.currentChatId); }

// ✅ FIX START: Move WaveSurfer initialization into a reactive watch effect
watch(displayUrl, async (newUrl, oldUrl) => {
  // Cleanup previous instance if it exists
  if (wavesurfer) {
    wavesurfer.destroy();
    wavesurfer = null;
  }

  // Initialize new instance if the URL is valid and it's an audio message
  if (newUrl && props.message.type === 'audio' && waveformRef.value) {
    try {
      wavesurfer = WaveSurfer.create({
        container: waveformRef.value,
        url: newUrl,
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
    } catch (error) {
      log(`Failed to create WaveSurfer instance: ${error}`, 'ERROR');
    }
  }
}, { immediate: true });
// ✅ FIX END

onMounted(() => {
  if (showTtsControl.value && ttsState.value === 'idle') {
    ttsStore.requestTtsForMessage({ ...props.message, senderContact: senderContact.value });
  }
  // The initial loadMedia call is now triggered by the watch effect on message hash/status
});

watch(() => [props.message.fileHash, props.message.status], ([newHash, newStatus]) => {
  if (newStatus !== 'receiving') {
    loadMedia();
  }
}, { immediate: true });

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

.message-bubble { max-width: 75%; padding: var(--spacing-2) var(--spacing-3); border-radius: var(--border-radius-lg); position: relative; word-wrap: break-word; box-shadow: var(--shadow-sm); }
.message-wrapper.sent .message-bubble { background-color: var(--color-message-sent-bg); color: var(--color-message-sent-text); border-bottom-right-radius: var(--border-radius-sm); }
.message-wrapper.received .message-bubble { background-color: var(--color-message-received-bg); color: var(--color-message-received-text); border-bottom-left-radius: var(--border-radius-sm); }
.sender-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-brand-secondary); margin-bottom: var(--spacing-1); }
.message-content { line-height: var(--line-height-base); white-space: pre-wrap; }
.message-bubble.character-message { background: var(--character-message-bg, var(--color-message-received-bg)); border: 1px solid var(--character-accent-color, transparent); box-shadow: 0 0 8px var(--character-glow-color, transparent); }
.message-bubble.character-message .sender-name { color: var(--character-primary-color, var(--color-brand-secondary)); }
.media-content {
  cursor: pointer;
  flex-grow: 1;
  min-width: 0;
}
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
  background-color: var(--color-background-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
}

.media-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-elevated);
}

.media-image, .video-preview video { width: 100%; height: 100%; object-fit: cover; }
.video-preview { position: relative; width: 100%; height: 100%; }

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
  pointer-events: none;
}
.media-preview-container:hover .play-overlay {
  opacity: 1;
}
.play-overlay svg {
  width: 48px;
  height: 48px;
  fill: white;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
}

.file-info-wrapper { display: flex; align-items: center; gap: var(--spacing-3); padding: var(--spacing-2); background: rgba(0,0,0,0.02); border-radius: var(--border-radius-md); min-width: 250px; min-height: 80px; cursor: pointer; box-sizing: border-box; }
.colorscheme-dark .file-info-wrapper { background: rgba(255,255,255,0.05); }
.file-icon-container { width: 40px; height: 40px; flex-shrink: 0; background-color: var(--color-background-hover); border-radius: var(--border-radius-md); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--color-text-secondary); }
.file-info-text { overflow: hidden; }
.file-info-text .file-name {
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
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

.media-placeholder.receiving {
  position: relative;
  flex-direction: row;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-2) var(--spacing-3);
  width: 100%;
  max-width: 280px;
  min-height: 88px;
  height: auto;
  background-color: var(--color-background-elevated);
  border: 1px dashed var(--color-border);
  box-sizing: border-box;
}
.media-placeholder.receiving :deep(.spinner-small) {
  flex-shrink: 0;
}
.transfer-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  flex-grow: 1;
  overflow: hidden;
  gap: var(--spacing-1);
  min-width: 0;
}
.transfer-info .file-name {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
.transfer-progress {
  width: 100%;
  margin-top: var(--spacing-1);
}
.transfer-stats {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

/* --- ✅ MODIFICATION START --- */
.location-content {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  min-width: 250px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.location-content:hover {
  opacity: 0.8;
}

.location-icon {
  font-size: 2.5rem;
  flex-shrink: 0;
  opacity: 0.7;
}
.location-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  text-align: left;
}
.location-title {
  font-weight: var(--font-weight-semibold);
}
.location-coords {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
}
/* --- ✅ MODIFICATION END --- */
</style>