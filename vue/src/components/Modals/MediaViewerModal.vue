<template>
  <transition name="media-viewer-fade">
    <div v-if="uiStore.activeModal === 'mediaViewer' && content" class="viewer-backdrop" @click.self="close">
      <button class="close-button" @click="close" title="关闭 (Esc)">×</button>
      <div class="media-container">
        <img v-if="content.type === 'image'" :src="content.src" :alt="content.alt" class="media-content"/>
        <video v-if="content.type === 'video'" :src="content.src" class="media-content" controls autoplay></video>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/uiStore';

const uiStore = useUiStore();
const content = computed(() => uiStore.mediaViewerContent);

const close = () => {
  uiStore.hideModal();
};

const handleKeyDown = (event) => {
  if (event.key === 'Escape') {
    close();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
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
  padding: var(--spacing-4); /* Add some padding for safety */
  box-sizing: border-box;
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
  background-color: rgba(220, 53, 69, 0.8); /* Danger color on hover */
  transform: scale(1.1);
}

.media-container {
  /* --- START OF FIX --- */
  /* Allow the container to fill the available space within the backdrop's padding */
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* --- END OF FIX --- */
}

.media-content {
  display: block;
  /* --- START OF FIX --- */
  /* Key properties to ensure the content is fully visible */
  max-width: 100%;
  max-height: 100%;
  width: auto;   /* Allow natural width up to max-width */
  height: auto;  /* Allow natural height up to max-height */
  object-fit: contain; /* This is the magic property! */
  /* --- END OF FIX --- */
  border-radius: var(--border-radius-md);
  box-shadow: 0 0 40px rgba(0,0,0,0.5);
}

/* --- Transitions --- */
.media-viewer-fade-enter-active,
.media-viewer-fade-leave-active {
  transition: opacity 0.3s ease;
}
.media-viewer-fade-enter-from,
.media-viewer-fade-leave-to {
  opacity: 0;
}
.media-viewer-fade-enter-active .media-content,
.media-viewer-fade-leave-active .media-content {
  transition: transform 0.3s ease;
}
.media-viewer-fade-enter-from .media-content,
.media-viewer-fade-leave-to .media-content {
  transform: scale(0.95);
}
</style>