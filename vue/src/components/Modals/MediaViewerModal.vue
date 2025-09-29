<template>
  <transition name="media-viewer-fade">
    <!-- ✅ MODIFICATION START: Add dynamic class for widget adjustment -->
    <div
        v-if="uiStore.activeModal === 'mediaViewer' && content"
        class="viewer-backdrop"
        :class="{ 'widget-active': isWidgetActive }"
        @click.self="close"
    >
      <!-- ✅ MODIFICATION END -->
      <button class="close-button" @click="close" title="关闭 (Esc)">×</button>
      <div class="media-container" v-motion-pop>
        <!-- --- MODIFICATION START: Use robust computed properties for type checking --- -->
        <img
            v-if="isImage"
            :src="content.src"
            :alt="content.alt"
            class="media-content"
        />
        <video
            v-else-if="isVideo"
            :src="content.src"
            class="media-content"
            controls
            autoplay
        ></video>
        <iframe
            v-else-if="isPdf"
            :src="content.src"
            class="media-content iframe-content"
            frameborder="0"
        ></iframe>
        <div v-else-if="isText" class="text-preview-wrapper">
          <pre class="media-content text-content">{{ textFileContent || '加载中...' }}</pre>
        </div>
        <div v-else class="unsupported-preview">
          <p>不支持预览此文件类型</p>
          <span>{{ content.alt }}</span>
          <button @click="downloadFile">下载文件</button>
        </div>
        <!-- --- MODIFICATION END --- -->
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useUiStore } from '@/stores/uiStore';
// ✅ MODIFICATION START: Import callStore to detect the floating widget
import { useCallStore } from '@/stores/callStore';
// ✅ MODIFICATION END

const uiStore = useUiStore();
// ✅ MODIFICATION START: Create callStore instance
const callStore = useCallStore();
// ✅ MODIFICATION END
const content = computed(() => uiStore.mediaViewerContent);
const textFileContent = ref('');

// ✅ MODIFICATION START: Create computed property to check for active widget
const isWidgetActive = computed(() => callStore.isCallActive && !callStore.isFullScreenCallViewVisible);
// ✅ MODIFICATION END

// --- MODIFICATION START: Create robust computed properties for type checking ---
const isImage = computed(() => {
  if (!content.value) return false;
  return content.value.fileType?.startsWith('image/') || content.value.type === 'image';
});
const isVideo = computed(() => {
  if (!content.value) return false;
  return content.value.fileType?.startsWith('video/') || content.value.type === 'video';
});
const isPdf = computed(() => {
  if (!content.value) return false;
  return content.value.fileType === 'application/pdf';
});
const isText = computed(() => {
  if (!content.value) return false;
  return content.value.fileType?.startsWith('text/');
});
// --- MODIFICATION END ---

const close = () => {
  uiStore.hideModal();
};

const handleKeyDown = (event) => {
  if (event.key === 'Escape') {
    close();
  }
};

watch(content, async (newContent) => {
  if (newContent && isText.value) { // Use the computed property here
    try {
      const response = await fetch(newContent.src);
      if (!response.ok) throw new Error('Network response was not ok');
      textFileContent.value = await response.text();
    } catch (error) {
      textFileContent.value = '无法加载文件内容。';
      console.error("Error fetching text file for preview:", error);
    }
  } else {
    textFileContent.value = '';
  }
}, { immediate: true });

function downloadFile() {
  if (!content.value?.src) return;
  const a = document.createElement('a');
  a.href = content.value.src;
  a.download = content.value.alt || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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
  padding: var(--spacing-4);
  box-sizing: border-box;
  /* ✅ MODIFICATION START: Add transition for smooth layout adjustment */
  transition: top 0.3s var(--transition-easing), height 0.3s var(--transition-easing);
  /* ✅ MODIFICATION END */
}

/* ✅ MODIFICATION START: New style to adjust layout when widget is active */
.viewer-backdrop.widget-active {
  top: 50px; /* Height of the floating widget */
  height: calc(100% - 50px);
}
/* ✅ MODIFICATION END */

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
  background-color: rgba(220, 53, 69, 0.8);
  transform: scale(1.1);
}

.media-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-content {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--border-radius-md);
  box-shadow: 0 0 40px rgba(0,0,0,0.5);
}
.iframe-content {
  width: 90vw;
  height: 90vh;
  max-width: 1200px;
  background-color: white;
}
.text-preview-wrapper {
  width: 90vw;
  height: 90vh;
  max-width: 1200px;
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-md);
  overflow: hidden;
  display: flex;
}
.text-content {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: var(--spacing-4);
  font-family: var(--font-family-mono);
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  text-align: left;
}
.unsupported-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-4);
  color: white;
  padding: var(--spacing-5);
  background: var(--color-background-elevated);
  border-radius: var(--border-radius-lg);
  text-align: center;
}
.unsupported-preview p {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}
.unsupported-preview span {
  font-family: var(--font-family-mono);
  opacity: 0.8;
}
.unsupported-preview button {
  background-color: var(--color-brand-primary);
  color: white;
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
}

/* --- [动画] START: 媒体查看器动画 --- */
.media-viewer-fade-enter-active,
.media-viewer-fade-leave-active {
  transition: opacity 0.3s var(--transition-easing);
}
.media-viewer-fade-enter-from,
.media-viewer-fade-leave-to {
  opacity: 0;
}
/* VueUse Motion will handle the pop animation on .media-container */
/* --- [动画] END --- */
</style>