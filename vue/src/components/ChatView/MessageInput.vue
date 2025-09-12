<template>
  <div class="message-input-root">
    <transition name="preview-fade">
      <div v-if="preview" class="preview-container">
        <div v-if="preview.type === 'audio'" class="audio-preview">
          <span>🎙️ 语音消息 ({{ formatDuration(preview.duration) }})</span>
          <div class="preview-actions">
            <button @click="playPreviewAudio" class="btn-play">播放</button>
            <button @click="cancelPreview" class="btn-cancel">取消</button>
          </div>
        </div>
        <div v-if="preview.type === 'file'" class="file-preview">
          <img v-if="preview.isImage" :src="preview.url" class="file-preview-image" alt="Image Preview"/>
          <span v-else>📎 {{ preview.name }}</span>
          <div class="preview-actions">
            <button @click="cancelPreview" class="btn-cancel">取消</button>
          </div>
        </div>
      </div>
    </transition>

    <AiMentionList :show="showMentionList" :suggestions="mentionSuggestions" @select="handleMentionSelect" />

    <div class="input-container">
      <IconButton icon="😀" title="表情/贴图" @click.stop="toggleEmojiPicker" />
      <IconButton icon="📎" title="附加文件" @click="triggerFileInput" />
      <textarea
          ref="textareaRef"
          v-model="newMessage"
          @keydown="handleKeyDown"
          @input="handleInput"
          @paste="handlePaste"
          placeholder="输入消息..."
          class="message-textarea"
      ></textarea>

      <IconButton v-if="!newMessage && !isRecording" icon="📸" title="截图" @click="handleScreenshot" />
      <IconButton
          v-if="!newMessage"
          :icon="isRecording ? '🛑' : '🎙️'"
          :title="isRecording ? `录音中... ${formatDuration(recordingDuration)}` : '按住录音'"
          @mousedown="startRecording"
          @mouseup="stopRecording"
          @mouseleave="stopRecording"
          @touchstart.prevent="startRecording"
          @touchend.prevent="stopRecording"
          class="voice-button"
          :class="{ recording: isRecording }"
      />
      <IconButton v-else icon="➤" title="发送" @click="send" class="send-button" />

      <EmojiPicker
          :show="isEmojiPickerVisible"
          @select-emoji="insertEmoji"
          @select-sticker="sendSticker"
      />
    </div>
    <input type="file" ref="fileInputRef" @change="handleFileSelect" style="display:none;" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';
import { useGroupStore } from '@/stores/groupStore';
import IconButton from '@/components/Shared/IconButton.vue';
import EmojiPicker from '@/components/Shared/EmojiPicker.vue';
import AiMentionList from './AiMentionList.vue';
import { mediaService } from '@/services/mediaService';
import { webrtcService } from '@/services/webrtcService';
import { generateFileHash } from '@/utils';
import { eventBus } from '@/services/eventBus';

const chatStore = useChatStore();
const userStore = useUserStore();
const groupStore = useGroupStore();

const newMessage = ref('');
const textareaRef = ref(null);
const fileInputRef = ref(null);
const isEmojiPickerVisible = ref(false);
const preview = ref(null);
const isRecording = ref(false);
const recordingDuration = ref(0);
let recordingInterval = null;
let previewAudio = null;
let typingTimeout = null;

const showMentionList = ref(false);
const mentionSuggestions = ref([]);

const adjustTextareaHeight = () => { nextTick(() => { const textarea = textareaRef.value; if (textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`; } }); };
const handleKeyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) { event.preventDefault(); send(); } };
const triggerFileInput = () => fileInputRef.value?.click();

function send() { if (preview.value) { if (preview.value.type === 'audio' || preview.value.type === 'file') { chatStore.sendMessage({ file: preview.value }); } cancelPreview(); } if (newMessage.value.trim()) { chatStore.sendMessage({ content: newMessage.value.trim() }); newMessage.value = ''; adjustTextareaHeight(); } }
function sendSticker(sticker) { chatStore.sendMessage({ sticker }); isEmojiPickerVisible.value = false; }
function insertEmoji(emoji) { const textarea = textareaRef.value; const start = textarea.selectionStart; const end = textarea.selectionEnd; newMessage.value = newMessage.value.substring(0, start) + emoji + newMessage.value.substring(end); nextTick(() => { textarea.selectionStart = textarea.selectionEnd = start + emoji.length; textarea.focus(); }); }
function toggleEmojiPicker() { isEmojiPickerVisible.value = !isEmojiPickerVisible.value; }
function closeEmojiPicker(event) { if (isEmojiPickerVisible.value && !event.target.closest('.picker-container, .input-container')) { isEmojiPickerVisible.value = false; } }
async function handleFileSelect(event) { const file = event.target.files[0]; if (file) await processFile(file); if(event.target) event.target.value = ''; }
async function handlePaste(event) { const file = event.clipboardData.files[0]; if (file?.type.startsWith('image/')) { event.preventDefault(); await processFile(file); } }
async function processFile(file) { cancelPreview(); const hash = await generateFileHash(file); const isImage = file.type.startsWith('image/'); preview.value = { type: 'file', blob: file, hash, name: file.name, fileType: file.type, size: file.size, isImage, url: isImage ? URL.createObjectURL(file) : null }; }
function cancelPreview() { if (preview.value?.url) URL.revokeObjectURL(preview.value.url); if (previewAudio) { previewAudio.pause(); previewAudio = null; } preview.value = null; }
function playPreviewAudio() { if (preview.value?.url) { if (previewAudio) previewAudio.pause(); previewAudio = new Audio(preview.value.url); previewAudio.play(); } }
const formatDuration = (seconds) => { const min = Math.floor(seconds / 60); const sec = seconds % 60; return `${min}:${sec < 10 ? '0' : ''}${sec}`; };
async function startRecording() { cancelPreview(); const success = await mediaService.startRecording(); if (success) { isRecording.value = true; recordingDuration.value = 0; recordingInterval = setInterval(() => { recordingDuration.value++; }, 1000); } }
function stopRecording() { if (!isRecording.value) return; clearInterval(recordingInterval); isRecording.value = false; mediaService.stopRecording(); }
function onRecordingComplete({ blob, duration }) { cancelPreview(); const url = URL.createObjectURL(blob); preview.value = { type: 'audio', blob, duration, url, hash: `audio_${Date.now()}`, name: `voice-message.webm`, fileType: blob.type, size: blob.size, }; }
function handleScreenshot() { mediaService.captureScreen(); }
function onScreenshotComplete(fileObject) { cancelPreview(); preview.value = { type: 'file', ...fileObject, isImage: true, url: URL.createObjectURL(fileObject.blob) }; }

function handleInput() {
  adjustTextareaHeight();
  handleTypingIndicator();
  handleMentionPopup();
}
function handleTypingIndicator() {
  if (typingTimeout) clearTimeout(typingTimeout);
  webrtcService.sendTyping(chatStore.currentChatId);
  typingTimeout = setTimeout(() => {
    // Stop sending typing indicator after a pause
  }, 2000);
}
function handleMentionPopup() {
  const text = newMessage.value;
  const cursorPos = textareaRef.value.selectionStart;
  const textBeforeCursor = text.substring(0, cursorPos);
  const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@');
  if (lastAtSymbolIndex !== -1 && chatStore.currentChatId.startsWith('group_')) {
    const query = textBeforeCursor.substring(lastAtSymbolIndex + 1);
    const group = groupStore.groups[chatStore.currentChatId];
    if (group) {
      mentionSuggestions.value = group.members
          .map(id => userStore.contacts[id])
          .filter(contact => contact?.isAI && contact.name.toLowerCase().includes(query.toLowerCase()));
      showMentionList.value = mentionSuggestions.value.length > 0;
    }
  } else {
    showMentionList.value = false;
  }
}
function handleMentionSelect(user) {
  const text = newMessage.value;
  const cursorPos = textareaRef.value.selectionStart;
  const textBeforeCursor = text.substring(0, cursorPos);
  const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@');
  const prefix = text.substring(0, lastAtSymbolIndex);
  const suffix = text.substring(cursorPos);
  newMessage.value = `${prefix}@${user.name} ${suffix}`;
  showMentionList.value = false;
  nextTick(() => {
    const newCursorPos = prefix.length + `@${user.name} `.length;
    textareaRef.value.focus();
    textareaRef.value.setSelectionRange(newCursorPos, newCursorPos);
  });
}

onMounted(() => {
  document.addEventListener('click', closeEmojiPicker);
  eventBus.on('recording:complete', onRecordingComplete);
  eventBus.on('screenshot:editing-complete', onScreenshotComplete);
  eventBus.on('file:dropped', processFile);
});
onUnmounted(() => {
  document.removeEventListener('click', closeEmojiPicker);
  eventBus.off('recording:complete', onRecordingComplete);
  eventBus.off('screenshot:editing-complete', onScreenshotComplete);
  eventBus.off('file:dropped', processFile);
  if (recordingInterval) clearInterval(recordingInterval);
  if (typingTimeout) clearTimeout(typingTimeout);
  cancelPreview();
});
</script>

<style scoped>
.message-input-root { padding: var(--spacing-2) var(--spacing-4); background-color: var(--color-background-panel); border-top: 1px solid var(--color-border); flex-shrink: 0; position: relative; }
.input-container { display: flex; align-items: flex-end; background-color: var(--color-background-elevated); padding: var(--spacing-1) var(--spacing-2); position: relative; border-radius: var(--border-radius-lg); }
.message-textarea { flex-grow: 1; border: none; background: transparent; padding: var(--spacing-2); resize: none; max-height: 150px; overflow-y: auto; line-height: 1.4; outline: none; box-shadow: none; }
.send-button { background-color: var(--color-brand-primary); color: white; border-radius: 50%; width: 36px; height: 36px; font-size: 1.2rem; }
.voice-button.recording { color: var(--color-status-danger); animation: pulse 1.5s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--color-status-danger-rgb), 0.4); } 70% { box-shadow: 0 0 0 10px rgba(var(--color-status-danger-rgb), 0); } 100% { box-shadow: 0 0 0 0 rgba(var(--color-status-danger-rgb), 0); } }
.preview-container { padding: var(--spacing-2); margin-bottom: var(--spacing-2); background: var(--color-background-hover); border-radius: var(--border-radius-md); font-size: var(--font-size-sm); display: flex; justify-content: space-between; align-items: center; }
.preview-actions { display: flex; gap: var(--spacing-2); }
.preview-actions button { border-radius: 4px; padding: 4px 8px; color: white; font-weight: 500;}
.btn-cancel { background: var(--color-status-danger); }
.btn-play { background: var(--color-status-success); }
.file-preview-image { max-height: 40px; border-radius: 4px; margin-right: var(--spacing-2); }
.file-preview, .audio-preview { display: flex; align-items: center; gap: var(--spacing-2); width: 100%; justify-content: space-between; }
.preview-fade-enter-active, .preview-fade-leave-active { transition: all 0.2s ease; }
.preview-fade-enter-from, .preview-fade-leave-to { opacity: 0; transform: translateY(-10px); }
</style>