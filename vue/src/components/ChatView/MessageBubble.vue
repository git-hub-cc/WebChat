<template>
  <div class="message-wrapper" :class="wrapperClasses" @contextmenu.prevent="showContextMenu" @dblclick="showContextMenu">
    <!-- MODIFICATION START: New block for Call Log System Messages -->
    <div v-if="message.type === 'system' && message.subType === 'call-log'" class="system-message call-log">
      <span class="call-icon">{{ callIcon }}</span>
      <span class="message-content">{{ message.content }}</span>
    </div>
    <!-- MODIFICATION END -->

    <!-- Regular Message Bubble -->
    <div v-else class="message-bubble" :class="{ 'character-message': isCharacterMessage, [message.sender]: isCharacterMessage }">
      <div v-if="!isMyMessage && isGroupChat && !message.isRetracted" class="sender-name">
        {{ senderName }}
      </div>

      <!-- Main content area -->
      <div class="content-wrapper">
        <!-- Text Content -->
        <div v-if="message.type === 'text' && !message.isRetracted" class="message-content" v-html="formattedContent"></div>

        <!-- Audio Content -->
        <div v-else-if="message.type === 'audio'" class="audio-content">
          <button @click="toggleAudioPlay" class="play-button">{{ isPlaying ? '❚❚' : '▶' }}</button>
          <div class="waveform-placeholder"></div>
          <span>{{ formatDuration(message.duration) }}</span>
        </div>

        <!-- Unified Media Content (Image, Video, Sticker, File) -->
        <div v-else-if="isMedia" class="media-content" @click="handleMediaClick">
          <!-- Sticker has no border/padding -->
          <div v-if="message.type === 'sticker'" class="sticker-wrapper">
            <img v-if="displayUrl" :src="displayUrl" :alt="message.fileName" class="sticker-image" loading="lazy" />
            <Spinner v-else />
          </div>

          <!-- Image/Video have a container -->
          <div v-else-if="message.type === 'image' || message.type === 'video'" class="media-preview-container">
            <img v-if="message.type === 'image' && displayUrl" :src="displayUrl" class="media-image" loading="lazy" />
            <div v-else-if="message.type === 'video' && displayUrl" class="video-preview">
              <video :src="displayUrl" preload="metadata" muted playsinline></video>
              <div class="play-overlay">▶</div>
            </div>
            <div v-else-if="!displayUrl" class="thumbnail-loading"><Spinner /></div>
          </div>

          <!-- Generic File has icon and info -->
          <div v-else-if="message.type === 'file'" class="file-info-wrapper">
            <div class="file-icon-container"><span>{{ getFileExtension(message.fileName) }}</span></div>
            <div class="file-info-text">
              <div class="file-name" :title="message.fileName">{{ message.fileName }}</div>
              <div class="file-meta">{{ formatSize(message.size) }}</div>
            </div>
          </div>
        </div>

        <!-- System/Retracted Message Content -->
        <div v-else-if="message.type === 'system' || message.isRetracted" class="message-content system-message">
          <div v-if="message.toolCallInfo" class="tool-call-indicator">
            <Spinner size="x-small" />
            <span>正在使用工具: {{ message.toolCallInfo.name }}...</span>
          </div>
          <span v-else>{{ message.content }}</span>
        </div>

        <!-- TTS Control (only for text messages) -->
        <div v-if="showTtsControl" class="tts-control">
          <button v-if="ttsState === 'ready' || ttsState === 'playing'" @click.stop="toggleTtsPlay" class="tts-button" :class="{ playing: ttsState === 'playing' }" title="播放/暂停语音"></button>
          <Spinner v-if="ttsState === 'loading'" size="x-small" />
          <button v-if="ttsState === 'error'" @click.stop="retryTts" class="tts-button error" title="TTS失败, 点击重试">⚠️</button>
        </div>
      </div>

      <!-- Message Metadata -->
      <div v-if="!message.isRetracted && message.type !== 'system'" class="message-meta">
        <span class="timestamp">{{ formattedTimestamp }}</span>
        <span v-if="isMyMessage" class="status-icon">
          <Spinner v-if="message.status === 'sending'" size="x-small" />
          <span v-else-if="message.status === 'sent'">✓</span>
          <span v-else-if="message.status === 'delivered'" class="delivered">✓✓</span>
          <span v-else-if="message.status === 'failed'" class="failed-icon" title="发送失败，点击重试" @click="resend">✗</span>
        </span>
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
import { eventBus } from '@/services/eventBus';
import AppSettings from '@/config/AppSettings';
import { mediaCacheService } from '@/services/mediaCacheService';

const props = defineProps({ message: { type: Object, required: true } });
const userStore = useUserStore();
const uiStore = useUiStore();
const chatStore = useChatStore();
const ttsStore = useTtsStore();

const isMyMessage = computed(() => props.message.sender === userStore.userId);
const isGroupChat = computed(() => !!props.message.groupId);
const senderContact = computed(() => userStore.contacts[props.message.sender]);
const isCharacterMessage = computed(() => !isMyMessage.value && senderContact.value?.isSpecial);
const wrapperClasses = computed(() => ({ 'sent': isMyMessage.value, 'received': !isMyMessage.value, 'system-wrapper': props.message.type === 'system' }));
const senderName = computed(() => senderContact.value ? senderContact.value.name : `用户 ${String(props.message.sender).substring(0, 4)}`);
const formattedContent = computed(() => props.message.type === 'text' && props.message.content ? formatMessageText(props.message.content) : '');
const formattedTimestamp = computed(() => new Date(props.message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const displayUrl = ref(null);
const isPlaying = ref(false);
let audioPlayer = null;
const isMedia = computed(() => ['file', 'image', 'video', 'sticker', 'audio'].includes(props.message.type));
const getFileExtension = (name) => name?.split('.').pop()?.substring(0, 4).toUpperCase() || 'FILE';
const formatSize = (bytes) => { if (typeof bytes !== 'number') return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(2)} MB`; };
const formatDuration = (seconds) => { if (typeof seconds !== 'number') return '0:00'; const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60); return `${min}:${sec < 10 ? '0' : ''}${sec}`; };
const ttsAudioPlayer = ref(null);
const ttsState = computed(() => ttsStore.messageTtsState[props.message.id] || 'idle');
const showTtsControl = computed(() => isCharacterMessage.value && senderContact.value?.aiConfig?.tts?.enabled && props.message.type === 'text' && props.message.content?.trim().length > 0 && !props.message.isStreaming);

const callIcon = computed(() => {
  if (props.message.subType !== 'call-log' || !props.message.callData) return '';
  const { type, by, callerId } = props.message.callData;
  const isOriginalCaller = callerId === userStore.userId;

  if (type === 'start' || type === 'end') return '📞';
  if (type === 'missed') return isOriginalCaller ? '📞↗' : '📞↙'; // Outgoing missed vs Incoming missed
  if (type === 'declined') return '📞🚫';
  if (type === 'cancelled') return '📞↩️';
  return '📞';
});

watch(ttsState, (newState, oldState) => { const audioUrl = ttsStore.audioUrlCache.get(props.message.id); if (newState === 'playing' && audioUrl) { if (!ttsAudioPlayer.value) { ttsAudioPlayer.value = new Audio(audioUrl); ttsAudioPlayer.value.onended = () => ttsStore.setPlaybackFinished(props.message.id); ttsAudioPlayer.value.onpause = () => ttsStore.setPlaybackFinished(props.message.id); } ttsAudioPlayer.value.play().catch(e => { log(`Error playing TTS audio: ${e.message}`, 'ERROR'); ttsStore.messageTtsState[props.message.id] = 'error'; }); } else if (newState === 'ready' && oldState === 'playing') { if (ttsAudioPlayer.value) ttsAudioPlayer.value.pause(); } });
function toggleTtsPlay() { ttsStore.togglePlay(props.message.id); }
function retryTts() { ttsStore.requestTtsForMessage({ ...props.message, senderContact: senderContact.value }); }
async function loadMedia() { if (!isMedia.value || !props.message.fileHash) return; const url = await mediaCacheService.getUrl(props.message.fileHash); if (url) displayUrl.value = url; else eventBus.on('file:ready', handleFileReady); }
function handleFileReady({ fileHash }) { if (fileHash === props.message.fileHash) { loadMedia(); eventBus.off('file:ready', handleFileReady); } }
function handleMediaClick() { if (displayUrl.value && (props.message.type === 'image' || props.message.type === 'video')) { uiStore.showMediaViewer({ type: props.message.type, src: displayUrl.value, alt: props.message.fileName }); } else if (displayUrl.value && props.message.type === 'file') { const a = document.createElement('a'); a.href = displayUrl.value; a.download = props.message.fileName || 'download'; document.body.appendChild(a); a.click(); document.body.removeChild(a); } }
function toggleAudioPlay() { if (!displayUrl.value) return; if (!audioPlayer) { audioPlayer = new Audio(displayUrl.value); audioPlayer.onended = () => isPlaying.value = false; audioPlayer.onpause = () => isPlaying.value = false; audioPlayer.onplaying = () => isPlaying.value = true; } isPlaying.value ? audioPlayer.pause() : audioPlayer.play().catch(e => log(`Error playing audio preview: ${e}`, 'ERROR')); }
function showContextMenu(event) { if (props.message.type === 'system' || props.message.isRetracted) return; const items = [{ label: '删除', action: () => uiStore.showConfirmationModal({ message: "确定要删除这条消息吗？此操作仅在您本地生效。", onConfirm: () => chatStore.deleteMessage(props.message.id) }), class: 'danger' }]; if (isMyMessage.value && Date.now() - new Date(props.message.timestamp).getTime() < AppSettings.ui.messageRetractionWindow) { items.push({ label: '撤回', action: () => chatStore.retractMessage(props.message.id) }); } uiStore.showContextMenu({ event, items, target: { type: 'message', id: props.message.id } }); }
async function resend() { if (props.message.status !== 'failed' || !isMyMessage.value) return; await chatStore.resendFailedMessages(chatStore.currentChatId); }
onMounted(() => { if (showTtsControl.value && ttsState.value === 'idle') { ttsStore.requestTtsForMessage({ ...props.message, senderContact: senderContact.value }); } });
watch(() => props.message.fileHash, loadMedia, { immediate: true });
onUnmounted(() => { eventBus.off('file:ready', handleFileReady); if (audioPlayer) { audioPlayer.pause(); audioPlayer.src = ''; audioPlayer = null; } if (ttsAudioPlayer.value) { ttsAudioPlayer.value.pause(); ttsAudioPlayer.value = null; } });
</script>

<style scoped>
.message-wrapper { display: flex; margin-bottom: var(--spacing-2); padding: 0 var(--spacing-1); }
.message-wrapper.sent { justify-content: flex-end; }
.message-wrapper.received { justify-content: flex-start; }
.message-wrapper.system-wrapper { justify-content: center; }
.message-bubble { max-width: 75%; padding: var(--spacing-2) var(--spacing-3); border-radius: var(--border-radius-lg); position: relative; word-wrap: break-word; box-shadow: var(--shadow-sm); }
.message-wrapper.sent .message-bubble { background-color: var(--color-message-sent-bg); color: var(--color-message-sent-text); border-bottom-right-radius: var(--border-radius-sm); }
.message-wrapper.received .message-bubble { background-color: var(--color-message-received-bg); color: var(--color-message-received-text); border-bottom-left-radius: var(--border-radius-sm); }
.sender-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-brand-secondary); margin-bottom: var(--spacing-1); }
.message-content { line-height: var(--line-height-base); white-space: pre-wrap; }
.system-message { width: 100%; text-align: center; font-size: var(--font-size-sm); color: var(--color-text-secondary); padding: var(--spacing-1) 0; }
.message-bubble.character-message { background: var(--character-message-bg, var(--color-message-received-bg)); border: 1px solid var(--character-accent-color, transparent); }
.message-bubble.character-message .sender-name { color: var(--character-primary-color, var(--color-brand-secondary)); }

/* Media & File Styles */
.media-content { cursor: pointer; }
.sticker-wrapper { padding: 0; background: transparent !important; }
.sticker-image { max-width: 128px; max-height: 128px; display: block; }
.audio-content { display: flex; align-items: center; gap: var(--spacing-2); min-width: 180px; }
.play-button { font-size: 1.5rem; width: 32px; height: 32px; border-radius: 50%; background: var(--color-brand-primary); color: white; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.waveform-placeholder { flex-grow: 1; height: 2px; background: var(--color-border); }
.media-preview-container { width: auto; height: auto; max-width: 300px; max-height: 300px; border-radius: var(--border-radius-md); overflow: hidden; background-color: var(--color-background-hover); display: flex; align-items: center; justify-content: center; }
.media-image, .video-preview video { width: 100%; height: 100%; object-fit: cover; }
.video-preview { position: relative; width: 100%; height: 100%; }
.video-preview .play-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 2rem; color: white; background: rgba(0,0,0,0.4); border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.thumbnail-loading { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.file-info-wrapper { display: flex; align-items: center; gap: var(--spacing-3); padding: var(--spacing-2); background: rgba(0,0,0,0.02); border-radius: var(--border-radius-md); min-width: 200px; cursor: default; }
.colorscheme-dark .file-info-wrapper { background: rgba(255,255,255,0.05); }
.file-icon-container { width: 40px; height: 40px; flex-shrink: 0; background-color: var(--color-background-hover); border-radius: var(--border-radius-md); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--color-text-secondary); }
.file-info-text { overflow: hidden; }
.file-name { font-weight: var(--font-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-meta { font-size: var(--font-size-xs); color: var(--color-text-secondary); }

/* Meta & Status Styles */
.message-meta { display: flex; justify-content: flex-end; align-items: center; font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: var(--spacing-1); float: right; clear: both; }
.message-wrapper.sent .message-meta { color: rgba(255, 255, 255, 0.7); }
.status-icon { margin-left: var(--spacing-1); display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; font-family: sans-serif; }
.status-icon .delivered { color: var(--color-brand-primary); }
.message-wrapper.sent .status-icon .delivered { color: #7cfc00; }
.status-icon :deep(.spinner-x-small) { width: 12px; height: 12px; border-width: 2px; }
.failed-icon { color: var(--color-status-danger); font-weight: bold; cursor: pointer; }

/* System & Tool Call Styles */
.tool-call-indicator { display: flex; align-items: center; gap: var(--spacing-2); font-style: italic; }
.tool-call-indicator .spinner { width: 1em; height: 1em; border-width: 2px; }

/* TTS Styles */
.content-wrapper { display: flex; align-items: flex-start; gap: var(--spacing-2); }
.tts-control { flex-shrink: 0; margin-top: 4px; }
.tts-button { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--color-brand-primary); font-size: 1.1rem; transition: background-color 0.2s ease; }
.tts-button:hover { background-color: var(--color-background-hover); }
.tts-button::before { content: '▶'; }
.tts-button.playing::before { content: '❚❚'; font-size: 0.9rem; }
.tts-button.error { color: var(--color-status-danger); font-size: 1.1rem; }
.tts-button.error::before { content: none; }

/* --- MODIFICATION START: Styles for the new call log message type --- */
.system-message.call-log {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-1) var(--spacing-3);
  background-color: var(--color-message-system-bg);
  border-radius: var(--border-radius-pill);
}

.call-icon {
  font-size: 1rem;
  opacity: 0.8;
}
/* --- MODIFICATION END --- */
</style>