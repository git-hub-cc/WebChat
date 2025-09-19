<template>
  <div class="chat-view" @dragenter.prevent="handleDragEnter" @dragover.prevent @dragleave.prevent="handleDragLeave" @drop.prevent="handleDrop">
    <ChatHeader :chat-id="chatStore.currentChatId" />
    <MessageArea :chat-id="chatStore.currentChatId" />
    <MessageInput :chat-id="chatStore.currentChatId" />
    <transition name="drag-fade">
      <div v-if="isDraggingOver" class="drag-overlay">
        <div class="drag-overlay-text">拖拽文件到此处发送</div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { eventBus } from '@/services/eventBus';
import ChatHeader from './ChatHeader.vue';
import MessageArea from './MessageArea.vue';
import MessageInput from './MessageInput.vue';

const chatStore = useChatStore();

// Drag & Drop state
const isDraggingOver = ref(false);
let dragCounter = 0;

function handleDragEnter(event) {
  if (event.dataTransfer.types.includes('Files')) {
    dragCounter++;
    isDraggingOver.value = true;
  }
}

function handleDragLeave() {
  dragCounter--;
  if (dragCounter === 0) {
    isDraggingOver.value = false;
  }
}

function handleDrop(event) {
  dragCounter = 0;
  isDraggingOver.value = false;
  const file = event.dataTransfer.files[0];
  if (file) {
    // Since MessageInput handles previews, we can emit an event for it
    eventBus.emit('file:dropped', file);
  }
}
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-background-page);
  position: relative;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  background-color: rgba(var(--color-brand-primary), 0.8);
  border: 3px dashed white;
  border-radius: var(--border-radius-lg);
  margin: var(--spacing-3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
  pointer-events: none;
}

.drag-overlay-text {
  color: white;
  font-size: 1.5rem;
  font-weight: bold;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
}

.drag-fade-enter-active, .drag-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drag-fade-enter-from, .drag-fade-leave-to {
  opacity: 0;
}
</style>