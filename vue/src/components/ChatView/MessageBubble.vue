<template>
  <div class="message-wrapper" :class="wrapperClasses" @contextmenu.prevent="showContextMenu" @dblclick="showContextMenu">
    <div class="message-bubble" :class="{ 'character-message': isCharacterMessage, [message.sender]: isCharacterMessage }">
      <div v-if="!isMyMessage && isGroupChat && !message.isRetracted" class="sender-name">
        {{ senderName }}
      </div>

      <!-- Text Message -->
      <div v-if="message.type === 'text' && !message.isRetracted" class="message-content" v-html="formattedContent"></div>

      <!-- Sticker Message -->
      <div v-else-if="message.type === 'sticker'" class="sticker-content">
        <img v-if="displayUrl" :src="displayUrl" :alt="message.fileName" class="sticker-image" loading="lazy" />
        <Spinner v-else />
      </div>

      <!-- Audio Message -->
      <div v-else-if="message.type === 'audio'" class="audio-content">
        <button @click="toggleAudioPlay" class="play-button">{{ isPlaying ? '❚❚' : '▶' }}</button>
        <div class="waveform-placeholder"></div>
        <span>{{ formatDuration(message.duration) }}</span>
      </div>

      <!-- File/Image/Video Message -->
      <div v-else-if="message.type === 'file'" class="file-content" @click="handleMediaClick">
        <div class="file-thumbnail">
          <img v-if="isImage && displayUrl" :src="displayUrl" class="media-image" loading="lazy" />
          <div v-else-if="isVideo && displayUrl" class="video-preview">
            <video :src="displayUrl" preload="metadata"></video>
            <div class="play-overlay">▶</div>
          </div>
          <div v-else-if="!displayUrl && (isImage || isVideo)" class="thumbnail-loading"><Spinner /></div>
          <div v-else class="file-icon"><span>{{ getFileExtension(message.fileName) }}</span></div>
        </div>
        <div class="file-info">
          <div class="file-name" :title="message.fileName">{{ message.fileName }}</div>
          <div class="file-meta">{{ formatSize(message.size) }}</div>
        </div>
      </div>

      <!-- System or Retracted Message -->
      <div v-else-if="message.type === 'system' || message.isRetracted" class="message-content system-message">
        <!-- [MODIFIED] MCP Tool Use UI -->
        <div v-if="message.toolCallInfo" class="tool-call-indicator">
          <Spinner size="small" />
          <span>正在使用工具: {{ message.toolCallInfo.name }}...</span>
        </div>
        <span v-else>{{ message.content }}</span>
      </div>

      <div v-if="!message.isRetracted" class="message-meta">
        <span class="timestamp">{{ formattedTimestamp }}</span>
        <span v-if="isMyMessage" class="status-icon">{{ statusIcon }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted, watch } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useUiStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { formatMessageText, log } from '@/utils';
import Spinner from '@/components/Shared/Spinner.vue';
import { eventBus } from '@/services/eventBus';
import AppSettings from '@/config/AppSettings';
import { mediaCacheService } from '@/services/mediaCacheService';

const props = defineProps({ message: { type: Object, required: true } });

const userStore = useUserStore();
const uiStore = useUiStore();
const chatStore = useChatStore();

const isMyMessage = computed(() => props.message.sender === userStore.userId);
const isGroupChat = computed(() => !!props.message.groupId);
const senderContact = computed(() => userStore.contacts[props.message.sender]);
const isCharacterMessage = computed(() => !isMyMessage.value && senderContact.value?.isSpecial);
const wrapperClasses = computed(() => ({ 'sent': isMyMessage.value, 'received': !isMyMessage.value }));
const senderName = computed(() => senderContact.value ? senderContact.value.name : `用户 ${String(props.message.sender).substring(0, 4)}`);
const formattedContent = computed(() => props.message.type === 'text' && props.message.content ? formatMessageText(props.message.content) : '');
const formattedTimestamp = computed(() => new Date(props.message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const statusIcon = computed(() => ({ sending: '🕒', sent: '✓', delivered: '✓✓', failed: '❌' }[props.message.status] || ''));

const displayUrl = ref(null);
const isPlaying = ref(false);
let audioPlayer = null;

const isImage = computed(() => props.message.fileType?.startsWith('image/'));
const isVideo = computed(() => props.message.fileType?.startsWith('video/'));
const isMediaFile = computed(() => ['file', 'sticker', 'audio'].includes(props.message.type));
const getFileExtension = (name) => name?.split('.').pop()?.substring(0, 4).toUpperCase() || 'FILE';
const formatSize = (bytes) => {
  if (typeof bytes !== 'number') return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
const formatDuration = (seconds) => {
  if (typeof seconds !== 'number') return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
};

async function loadMedia() {
  if (!isMediaFile.value || !props.message.fileHash) return;
  const url = await mediaCacheService.getUrl(props.message.fileHash);
  if (url) {
    displayUrl.value = url;
  } else {
    eventBus.on('file:ready', handleFileReady);
  }
}
function handleFileReady({ fileHash }) {
  if (fileHash === props.message.fileHash) {
    log(`'file:ready' event received for message ${props.message.id}. Reloading media.`, 'DEBUG');
    loadMedia();
    eventBus.off('file:ready', handleFileReady);
  }
}
function handleMediaClick() {
  if (displayUrl.value && (isImage.value || isVideo.value)) {
    uiStore.showMediaViewer({ type: isVideo.value ? 'video' : 'image', src: displayUrl.value, alt: props.message.fileName });
  } else if (displayUrl.value) {
    const a = document.createElement('a');
    a.href = displayUrl.value;
    a.download = props.message.fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
function toggleAudioPlay() {
  if (!displayUrl.value) return;
  if (!audioPlayer) {
    audioPlayer = new Audio(displayUrl.value);
    audioPlayer.onended = () => { isPlaying.value = false; };
    audioPlayer.onpause = () => { isPlaying.value = false; };
    audioPlayer.onplaying = () => { isPlaying.value = true; };
  }
  isPlaying.value ? audioPlayer.pause() : audioPlayer.play().catch(e => log(`Error playing audio preview: ${e}`, 'ERROR'));
}
function showContextMenu(event) {
  if (props.message.type === 'system' || props.message.isRetracted) return;
  const items = [{
    label: '删除',
    action: () => uiStore.showConfirmationModal({ message: "确定要删除这条消息吗？此操作仅在您本地生效。", onConfirm: () => chatStore.deleteMessage(props.message.id) }),
    class: 'danger'
  }];
  if (isMyMessage.value && Date.now() - new Date(props.message.timestamp).getTime() < AppSettings.ui.messageRetractionWindow) {
    items.push({ label: '撤回', action: () => chatStore.retractMessage(props.message.id) });
  }
  uiStore.showContextMenu({ event, items, target: { type: 'message', id: props.message.id } });
}

watch(() => props.message.fileHash, loadMedia, { immediate: true });

onUnmounted(() => {
  eventBus.off('file:ready', handleFileReady);
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.src = '';
    audioPlayer = null;
  }
});
</script>

<style scoped>
/* Styles remain unchanged, with addition of tool-call-indicator */
.message-wrapper { display: flex; margin-bottom: var(--spacing-2); padding: 0 var(--spacing-1); }
.message-wrapper.sent { justify-content: flex-end; }
.message-wrapper.received { justify-content: flex-start; }
.message-bubble { max-width: 75%; padding: var(--spacing-2) var(--spacing-3); border-radius: var(--border-radius-lg); position: relative; word-wrap: break-word; box-shadow: var(--shadow-sm); }
.message-wrapper.sent .message-bubble { background-color: var(--color-message-sent-bg); color: var(--color-message-sent-text); border-bottom-right-radius: var(--border-radius-sm); }
.message-wrapper.received .message-bubble { background-color: var(--color-message-received-bg); color: var(--color-message-received-text); border-bottom-left-radius: var(--border-radius-sm); }
.sender-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-brand-secondary); margin-bottom: var(--spacing-1); }
.message-content { line-height: var(--line-height-base); white-space: pre-wrap; }
.system-message { width: 100%; text-align: center; font-size: var(--font-size-sm); color: var(--color-text-secondary); padding: var(--spacing-1) 0; }
.message-bubble.character-message { background: var(--character-message-bg, var(--color-message-received-bg)); border: 1px solid var(--character-accent-color, transparent); }
.message-bubble.character-message .sender-name { color: var(--character-primary-color, var(--color-brand-secondary)); }
.sticker-content img { max-width: 128px; max-height: 128px; display: block; }
.audio-content { display: flex; align-items: center; gap: var(--spacing-2); min-width: 180px; }
.play-button { font-size: 1.5rem; width: 32px; height: 32px; border-radius: 50%; background: var(--color-brand-primary); color: white; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.waveform-placeholder { flex-grow: 1; height: 2px; background: var(--color-border); }
.file-content { display: flex; align-items: center; gap: var(--spacing-3); cursor: pointer; padding: var(--spacing-2); background: rgba(0,0,0,0.02); border-radius: var(--border-radius-md); }
.colorscheme-dark .file-content { background: rgba(255,255,255,0.05); }
.file-thumbnail { width: 50px; height: 50px; flex-shrink: 0; background-color: var(--color-background-hover); border-radius: var(--border-radius-md); display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
.media-image, .video-preview video { width: 100%; height: 100%; object-fit: cover; }
.video-preview { position: relative; }
.video-preview .play-overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 1.5rem; color: white; background: rgba(0,0,0,0.4); border-radius: 50%; padding: 4px; pointer-events: none; }
.file-icon { font-weight: bold; color: var(--color-text-secondary); }
.file-info { overflow: hidden; }
.file-name { font-weight: var(--font-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-meta { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.message-meta { display: flex; justify-content: flex-end; align-items: center; font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: var(--spacing-1); float: right; clear: both; }
.message-wrapper.sent .message-meta { color: rgba(255, 255, 255, 0.7); }
.status-icon { margin-left: var(--spacing-1); }
.tool-call-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-style: italic;
}
.tool-call-indicator .spinner {
  width: 1em;
  height: 1em;
  border-width: 2px;
}
</style>