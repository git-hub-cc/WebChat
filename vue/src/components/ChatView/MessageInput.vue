<template>
  <div class="message-input-root">
    <transition name="preview-fade">
      <div v-if="preview" class="preview-container">
        <!-- Preview container content remains the same -->
        <div v-if="preview.type === 'audio'" class="audio-preview">
          <button @click="playPreviewAudio" class="btn-play-preview">
            {{ isPreviewPlaying ? '❚❚' : '▶' }}
          </button>
          <div ref="previewWaveformRef" class="preview-waveform-container"></div>
          <span class="preview-duration">{{ formatDuration(preview.duration) }}</span>
          <button @click="cancelPreview" class="btn-cancel-preview">✕</button>
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

    <div v-if="isRecordingLocked" class="locked-recording-bar">
      <!-- Locked recording bar remains the same -->
      <div class="recording-indicator">🔴</div>
      <div class="recording-timer">{{ formatDuration(recordingDuration) }}</div>
      <div class="spacer"></div>
      <button @click="cancelLockedRecording" class="btn-cancel-recording">取消</button>
      <button @click="sendLockedRecording" class="btn-send-recording">发送</button>
    </div>

    <div v-else class="input-container" :class="{ 'recording-active': isRecording }">
      <transition name="cancel-hint-fade">
        <div v-if="isRecording && !isRecordingLocked" class="cancel-hint" :class="{ active: isSlidToCancel }">
          <span v-if="isSlidToCancel" class="hint-text">松开即可取消</span>
        </div>
      </transition>

      <div class="input-main-area" :class="{ 'slide-away': isSlidToCancel }">
        <IconButton icon="😀" title="表情/贴图" @click.stop="toggleEmojiPicker" />
        <IconButton icon="📎" title="附加文件" @click="triggerFileInput" />
        <textarea
            ref="textareaRef"
            v-model="newMessage"
            @keydown="handleKeyDown"
            @input="handleInput"
            @paste="handlePaste"
            :placeholder="inputPlaceholder"
            class="message-textarea"
            :readonly="isSttActive"
        ></textarea>
      </div>

      <!-- --- [动画] START: 为按钮切换添加滑动和淡入淡出动画 --- -->
      <div class="input-actions-area">
        <TransitionGroup name="actions-slide-fade">
          <IconButton v-if="!newMessage && !isRecording && !isSttActive" key="screenshot" icon="📸" title="截图" @click="handleScreenshot" />

          <div v-if="!newMessage || isSttActive" key="voice" class="voice-button-wrapper">
            <!-- STT button for AI chats -->
            <IconButton
                v-if="isCurrentChatWithAI"
                :icon="isSttActive ? '🛑' : '🎙️'"
                :title="sttButtonTitle"
                @mousedown.prevent="startStt"
                @mouseup.prevent="stopStt"
                @touchstart.prevent="startStt"
                @touchend.prevent="stopStt"
                class="voice-button"
                :class="{ 'stt-active': isSttActive }"
            />
            <!-- Audio recording button for regular chats -->
            <template v-else>
              <transition name="lock-hint-fade">
                <div v-if="isRecording && !isRecordingLocked" class="lock-hint">
                  <span class="lock-icon">🔒</span>
                  <span class="arrow">↑</span>
                  <span class="hint-text">上滑锁定</span>
                </div>
              </transition>
              <IconButton
                  :icon="isRecording ? '🛑' : '🎙️'"
                  :title="isRecording ? `录音中... ${formatDuration(recordingDuration)}` : '按住录音'"
                  @mousedown.prevent="startRecording"
                  @mouseup.prevent="stopRecording"
                  @mousemove.prevent="handleRecordingMove"
                  @touchstart.prevent="startRecording"
                  @touchend.prevent="stopRecording"
                  @touchmove.prevent="handleRecordingMove"
                  class="voice-button"
                  :class="{ recording: isRecording }"
              />
            </template>
          </div>

          <IconButton v-else key="send" icon="➤" title="发送" @click="send" class="send-button" />
        </TransitionGroup>
      </div>
      <!-- --- [动画] END --- -->

    </div>
    <EmojiPicker
        :show="isEmojiPickerVisible"
        @select-emoji="insertEmoji"
        @select-sticker="sendSticker"
    />
    <input type="file" ref="fileInputRef" @change="handleFileSelect" style="display:none;" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';
import { useGroupStore } from '@/stores/groupStore';
import { useUiStore } from '@/stores/uiStore';
import IconButton from '@/components/Shared/IconButton.vue';
import EmojiPicker from '@/components/Shared/EmojiPicker.vue';
import AiMentionList from './AiMentionList.vue';
import { mediaService } from '@/services/mediaService';
import { webrtcService } from '@/services/webrtcService';
import { generateFileHash } from '@/utils';
import { eventBus } from '@/services/eventBus';
import WaveSurfer from 'wavesurfer.js';
import { sttService } from '@/services/sttService';

const chatStore = useChatStore();
const userStore = useUserStore();
const groupStore = useGroupStore();
const uiStore = useUiStore();

const newMessage = ref('');
const textareaRef = ref(null);
const fileInputRef = ref(null);
const isEmojiPickerVisible = ref(false);
const preview = ref(null);
const isRecording = ref(false);
const recordingDuration = ref(0);
let recordingInterval = null;
let typingTimeout = null;

const previewWaveformRef = ref(null);
let previewWavesurfer = null;
const isPreviewPlaying = ref(false);

const showMentionList = ref(false);
const mentionSuggestions = ref([]);

const isRecordingLocked = ref(false);
const startCoords = ref({ x: 0, y: 0 });
const isSlidToCancel = ref(false);
const LOCK_THRESHOLD = -60;
const CANCEL_THRESHOLD = -80;

const isSttActive = ref(false);
const wasSttStoppedManually = ref(false);
const sttStatusMessage = ref('');
const sttFinalizedTranscript = ref('');
const isCurrentChatWithAI = computed(() => {
  if (!chatStore.currentChatId) return false;
  const contact = userStore.contacts[chatStore.currentChatId];
  return contact?.isAI === true;
});

const inputPlaceholder = computed(() => {
  if (sttStatusMessage.value) return sttStatusMessage.value;
  if (isSttActive.value) return '正在聆听，请说话...';
  return '输入消息...';
});

const sttButtonTitle = computed(() => {
  if (isSttActive.value) return '停止识别';
  return '语音输入 (按住说话)';
});


const adjustTextareaHeight = () => { nextTick(() => { const textarea = textareaRef.value; if (textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`; } }); };
const handleKeyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !isSttActive.value) { event.preventDefault(); send(); } };
const triggerFileInput = () => fileInputRef.value?.click();

function send() { if (preview.value) { if (preview.value.type === 'audio' || preview.value.type === 'file') { chatStore.sendMessage({ file: preview.value }); } cancelPreview(); } if (newMessage.value.trim()) { chatStore.sendMessage({ content: newMessage.value.trim() }); newMessage.value = ''; adjustTextareaHeight(); } }
function sendSticker(sticker) { chatStore.sendMessage({ sticker }); isEmojiPickerVisible.value = false; }
function insertEmoji(emoji) { const textarea = textareaRef.value; const start = textarea.selectionStart; const end = textarea.selectionEnd; newMessage.value = newMessage.value.substring(0, start) + emoji + newMessage.value.substring(end); nextTick(() => { textarea.selectionStart = textarea.selectionEnd = start + emoji.length; textarea.focus(); }); }
function toggleEmojiPicker() { isEmojiPickerVisible.value = !isEmojiPickerVisible.value; }
function closeEmojiPicker(event) { if (isEmojiPickerVisible.value && !event.target.closest('.picker-container, .input-container')) { isEmojiPickerVisible.value = false; } }
async function handleFileSelect(event) { const file = event.target.files[0]; if (file) await processFile(file); if(event.target) event.target.value = ''; }
async function handlePaste(event) { const file = event.clipboardData.files[0]; if (file?.type.startsWith('image/')) { event.preventDefault(); await processFile(file); } }
async function processFile(file) {
  cancelPreview();
  const hash = await generateFileHash(file);
  const isImage = file.type.startsWith('image/');
  preview.value = {
    type: 'file',
    blob: file,
    hash,
    name: file.name,
    fileType: file.type,
    size: file.size,
    isImage,
    url: isImage ? URL.createObjectURL(file) : null
  };
}

function cancelPreview() { if (preview.value?.url) { URL.revokeObjectURL(preview.value.url); } if (previewWavesurfer) { previewWavesurfer.destroy(); previewWavesurfer = null; } preview.value = null; isPreviewPlaying.value = false; }
function playPreviewAudio() { if (previewWavesurfer) { previewWavesurfer.playPause(); } }
watch(preview, (newPreview, oldPreview) => { if (oldPreview && previewWavesurfer) { previewWavesurfer.destroy(); previewWavesurfer = null; isPreviewPlaying.value = false; } if (newPreview && newPreview.type === 'audio') { nextTick(() => { if (previewWaveformRef.value) { previewWavesurfer = WaveSurfer.create({ container: previewWaveformRef.value, url: newPreview.url, height: 32, waveColor: 'var(--color-text-tertiary)', progressColor: 'var(--color-brand-secondary)', cursorWidth: 1, cursorColor: 'var(--color-brand-primary)', barWidth: 2, barRadius: 2, }); previewWavesurfer.on('play', () => isPreviewPlaying.value = true); previewWavesurfer.on('pause', () => isPreviewPlaying.value = false); previewWavesurfer.on('finish', () => isPreviewPlaying.value = false); } }); } });

const formatDuration = (seconds) => { const min = Math.floor(seconds / 60); const sec = seconds % 60; return `${min}:${sec < 10 ? '0' : ''}${sec}`; };

// --- MODIFICATION START: Replaced toggleStt with start/stop functions for Push-to-Talk ---
function startStt() {
  if (isSttActive.value) return; // Prevent multiple starts
  sttFinalizedTranscript.value = newMessage.value ? newMessage.value + ' ' : '';
  sttService.start();
}

function stopStt() {
  if (!isSttActive.value) return; // Prevent stopping if not active
  wasSttStoppedManually.value = true;
  sttService.stop();
}
// --- MODIFICATION END ---

async function startRecording(event) { if (isRecording.value) return; cancelPreview(); const success = await mediaService.startRecording(); if (success) { isRecording.value = true; const touch = event.touches ? event.touches[0] : event; startCoords.value = { x: touch.clientX, y: touch.clientY }; recordingDuration.value = 0; recordingInterval = setInterval(() => { recordingDuration.value++; }, 1000); } }
function stopRecording() { if (!isRecording.value) return; if (isRecordingLocked.value) return; clearInterval(recordingInterval); if (!isSlidToCancel.value) { mediaService.stopRecording(); } else { mediaService.stopRecording(true); } isRecording.value = false; isSlidToCancel.value = false; }
function handleRecordingMove(event) { if (!isRecording.value || isRecordingLocked.value) return; const touch = event.touches ? event.touches[0] : event; const deltaY = touch.clientY - startCoords.value.y; const deltaX = touch.clientX - startCoords.value.x; if (deltaY < LOCK_THRESHOLD) { isRecordingLocked.value = true; startCoords.value = { x: 0, y: 0 }; } else if (deltaX < CANCEL_THRESHOLD) { isSlidToCancel.value = true; } else { isSlidToCancel.value = false; } }
function cancelLockedRecording() { isRecordingLocked.value = false; isRecording.value = false; clearInterval(recordingInterval); mediaService.stopRecording(true); }
function sendLockedRecording() { isRecordingLocked.value = false; isRecording.value = false; clearInterval(recordingInterval); mediaService.stopRecording(); }
function onRecordingComplete({ blob, duration }) { cancelPreview(); const url = URL.createObjectURL(blob); preview.value = { type: 'audio', blob, duration, url, hash: `audio_${Date.now()}`, name: `voice-message.webm`, fileType: blob.type, size: blob.size, }; }

// ✅ START OF FIX
async function handleScreenshot() {
  // Directly call mediaService to capture a screenshot.
  // The 'true' flag indicates this is for a screenshot, not a call.
  // The 'detail' contentHint is better for static images.
  await mediaService.captureScreen('detail', true);
}
// ✅ END OF FIX

function handleRawScreenshot(screenshotData) { uiStore.showModal('screenshotEditor', screenshotData); }

function onScreenshotComplete(fileObject) {
  cancelPreview();
  preview.value = {
    type: 'file',
    ...fileObject,
    isImage: true,
    url: URL.createObjectURL(fileObject.blob)
  };
}

function handleInput() { adjustTextareaHeight(); handleTypingIndicator(); handleMentionPopup(); }
function handleTypingIndicator() { if (typingTimeout) clearTimeout(typingTimeout); webrtcService.sendTyping(chatStore.currentChatId); typingTimeout = setTimeout(() => {}, 2000); }
function handleMentionPopup() { const text = newMessage.value; const cursorPos = textareaRef.value.selectionStart; const textBeforeCursor = text.substring(0, cursorPos); const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@'); if (lastAtSymbolIndex !== -1 && chatStore.currentChatId.startsWith('group_')) { const group = groupStore.groups[chatStore.currentChatId]; if (group) { mentionSuggestions.value = group.members.map(id => userStore.contacts[id]).filter(contact => contact?.isAI && contact.name.toLowerCase().includes(query.toLowerCase())); showMentionList.value = mentionSuggestions.value.length > 0; } } else { showMentionList.value = false; } }
function handleMentionSelect(user) { const text = newMessage.value; const cursorPos = textareaRef.value.selectionStart; const textBeforeCursor = text.substring(0, cursorPos); const lastAtSymbolIndex = textBeforeCursor.lastIndexOf('@'); const prefix = text.substring(0, lastAtSymbolIndex); const suffix = text.substring(cursorPos); newMessage.value = `${prefix}@${user.name} ${suffix}`; showMentionList.value = false; nextTick(() => { const newCursorPos = prefix.length + `@${user.name} `.length; textareaRef.value.focus(); textareaRef.value.setSelectionRange(newCursorPos, newCursorPos); }); }

onMounted(() => {
  document.addEventListener('click', closeEmojiPicker);
  eventBus.on('recording:complete', onRecordingComplete);
  eventBus.on('screenshot:editing-complete', onScreenshotComplete);
  eventBus.on('file:dropped', processFile);
  eventBus.on('screenshot:raw-captured', handleRawScreenshot);

  sttService.init({
    onStart: () => {
      isSttActive.value = true;
      wasSttStoppedManually.value = false;
      sttStatusMessage.value = '';
    },
    onResult: (event) => {
      let interimTranscript = '';
      let currentFinalized = '';
      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinalized += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      newMessage.value = sttFinalizedTranscript.value + currentFinalized + interimTranscript;

      adjustTextareaHeight();
      sttStatusMessage.value = '';
    },
    onError: (error) => {
      sttStatusMessage.value = error === 'no-speech' ? '未检测到语音，请重试...' : '语音识别出错';
      setTimeout(() => {
        if (sttStatusMessage.value) sttStatusMessage.value = '';
      }, 3000);
    },
    onEnd: () => {
      isSttActive.value = false;
      if (wasSttStoppedManually.value) {
        wasSttStoppedManually.value = false;
        sttFinalizedTranscript.value = ''; // Reset for the next session
        if (newMessage.value.trim()) {
          send();
        }
      }
    }
  });
});
onUnmounted(() => {
  document.removeEventListener('click', closeEmojiPicker);
  eventBus.off('recording:complete', onRecordingComplete);
  eventBus.off('screenshot:editing-complete', onScreenshotComplete);
  eventBus.off('file:dropped', processFile);
  eventBus.off('screenshot:raw-captured', handleRawScreenshot);
  if (recordingInterval) clearInterval(recordingInterval);
  if (typingTimeout) clearTimeout(typingTimeout);
  cancelPreview();
  if (sttService.isListening()) sttService.stop();
});
</script>

<style scoped>
.message-input-root { padding: var(--spacing-2) var(--spacing-4); background-color: var(--color-background-panel); border-top: 1px solid var(--color-border); flex-shrink: 0; position: relative; }
.input-container { display: flex; align-items: flex-end; background-color: var(--color-background-elevated); padding: var(--spacing-1) var(--spacing-2); position: relative; border-radius: var(--border-radius-lg); overflow: hidden; }
.locked-recording-bar { display: flex; align-items: center; background-color: var(--color-background-elevated); padding: var(--spacing-1) var(--spacing-2); position: relative; border-radius: var(--border-radius-lg); }
.message-textarea { flex-grow: 1; border: none; background: transparent; padding: var(--spacing-2); resize: none; max-height: 150px; overflow-y: auto; line-height: 1.4; outline: none; box-shadow: none; }
.message-textarea:read-only {
  color: var(--color-text-primary);
  background-color: var(--color-background-hover);
  cursor: default;
}
.send-button { background-color: var(--color-brand-primary); color: white; border-radius: 50%; width: 36px; height: 36px; font-size: 1.2rem; }
.voice-button.recording { color: var(--color-status-danger); animation: pulse 1.5s infinite; }
.voice-button.stt-active { color: var(--color-brand-primary); animation: pulse-stt 1.5s infinite; }
@keyframes pulse-stt { 0% { box-shadow: 0 0 0 0 rgba(var(--color-brand-primary), 0.4); } 70% { box-shadow: 0 0 0 10px rgba(var(--color-brand-primary), 0); } 100% { box-shadow: 0 0 0 0 rgba(var(--color-brand-primary), 0); } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(var(--color-status-danger), 0.4); } 70% { box-shadow: 0 0 0 10px rgba(var(--color-status-danger), 0); } 100% { box-shadow: 0 0 0 0 rgba(var(--color-status-danger), 0); } }
.preview-container { padding: var(--spacing-2); margin-bottom: var(--spacing-2); background: var(--color-background-hover); border-radius: var(--border-radius-md); font-size: var(--font-size-sm); display: flex; justify-content: space-between; align-items: center; }
.preview-actions { display: flex; gap: var(--spacing-2); }
.preview-actions button { border-radius: 4px; padding: 4px 8px; color: white; font-weight: 500;}
.btn-cancel { background: var(--color-status-danger); }
.file-preview-image { max-height: 40px; border-radius: 4px; margin-right: var(--spacing-2); }
.file-preview { display: flex; align-items: center; gap: var(--spacing-2); width: 100%; justify-content: space-between; }
.audio-preview { display: flex; align-items: center; gap: var(--spacing-2); width: 100%; }
.btn-play-preview { width: 32px; height: 32px; border-radius: 50%; background-color: var(--color-brand-secondary); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.2rem; }
.preview-waveform-container { flex-grow: 1; height: 32px; }
.preview-duration { color: var(--color-text-secondary); }
.btn-cancel-preview { width: 32px; height: 32px; border-radius: 50%; background: none; color: var(--color-status-danger); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 1.5rem; }
.preview-fade-enter-active, .preview-fade-leave-active { transition: all 0.2s ease; }
.preview-fade-enter-from, .preview-fade-leave-to { opacity: 0; transform: translateY(-10px); }
.input-container.recording-active { background-color: transparent; }
.input-main-area { display: flex; align-items: flex-end; flex-grow: 1; transition: transform 0.3s ease; }
.input-main-area.slide-away { transform: translateX(-80px); }
.input-actions-area { display: flex; align-items: flex-end; }

/* --- [动画] START: 按钮切换动画样式 --- */
.input-actions-area {
  position: relative;
  display: flex;
  align-items: flex-end;
  /* Set a fixed width to contain the animating buttons */
  width: 120px; /* Adjust as needed, e.g., 40px * 2 + gaps */
  justify-content: flex-end;
}
.actions-slide-fade-enter-active,
.actions-slide-fade-leave-active {
  transition: all 0.25s var(--transition-easing-spring);
}
.actions-slide-fade-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.actions-slide-fade-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
/* Ensure leaving items don't affect layout */
.actions-slide-fade-leave-active {
  position: absolute;
}
/* --- [动画] END --- */


.cancel-hint {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding-left: var(--spacing-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  transition: opacity 0.3s ease;
}
.cancel-hint.active { color: var(--color-status-danger); font-weight: var(--font-weight-semibold); }
.cancel-hint-fade-enter-active, .cancel-hint-fade-leave-active { transition: opacity 0.2s ease; }
.cancel-hint-fade-enter-from, .cancel-hint-fade-leave-to { opacity: 0; }

.voice-button-wrapper { position: relative; display: flex; align-items: center; justify-content: center; }
.lock-hint { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; background-color: rgba(0, 0, 0, 0.7); color: white; padding: var(--spacing-2); border-radius: var(--border-radius-md); pointer-events: none; }
.lock-hint .arrow { font-size: 1.2rem; animation: bounce 1.5s infinite; }
.lock-hint .hint-text { font-size: var(--font-size-xs); white-space: nowrap; }
@keyframes bounce { 0%, 20%, 50%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-8px); } 60% { transform: translateY(-4px); } }
.lock-hint-fade-enter-active, .lock-hint-fade-leave-active { transition: opacity 0.3s ease; }
.lock-hint-fade-enter-from, .lock-hint-fade-leave-to { opacity: 0; }

.locked-recording-bar { padding: var(--spacing-2) var(--spacing-3); gap: var(--spacing-3); }
.recording-indicator { color: var(--color-status-danger); animation: pulse-dot 1.5s infinite ease-in-out; }
@keyframes pulse-dot { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
.recording-timer { font-family: var(--font-family-mono); color: var(--color-text-primary); font-weight: var(--font-weight-medium); }
.spacer { flex-grow: 1; }
.btn-cancel-recording, .btn-send-recording { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); padding: var(--spacing-1) var(--spacing-3); border-radius: var(--border-radius-md); }
.btn-cancel-recording { color: var(--color-text-secondary); }
.btn-send-recording { background-color: var(--color-brand-primary); color: white; }
</style>