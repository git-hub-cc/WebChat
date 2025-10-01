<template>
  <div class="cropper-modal-backdrop" @click.self="cancel">
    <div class="cropper-container" v-motion-pop>
      <header class="cropper-header">
        <h3>裁剪图片</h3>
      </header>
      <div class="cropper-wrapper">
        <cropper
            ref="cropperRef"
            class="image-cropper"
            :src="imageSrc"
            :stencil-props="{
            aspectRatio: 16/9
          }"
        />
      </div>
      <footer class="cropper-footer">
        <button class="btn-secondary" @click="cancel">取消</button>
        <button class="btn-primary" @click="confirm" :disabled="isProcessing">
          {{ isProcessing ? '处理中...' : '确认' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Cropper } from 'vue-advanced-cropper';
import { compressImage } from '@/utils';
import { eventBus } from '@/services/eventBus';

const props = defineProps({
  imageSrc: { type: String, required: true },
  fileName: { type: String, required: true },
});

const emit = defineEmits(['complete', 'cancel']);

const cropperRef = ref(null);
const isProcessing = ref(false);

async function confirm() {
  if (!cropperRef.value) return;
  isProcessing.value = true;
  try {
    const { canvas } = cropperRef.value.getResult();
    const compressedBlob = await compressImage(canvas, 100);

    const finalFile = new File([compressedBlob], props.fileName, {
      type: compressedBlob.type,
      lastModified: Date.now()
    });

    emit('complete', finalFile);

  } catch (error) {
    console.error("图片裁剪或压缩失败:", error);
    eventBus.emit('showNotification', { message: '图片处理失败', type: 'error' });
  } finally {
    isProcessing.value = false;
  }
}

function cancel() {
  emit('cancel');
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    cancel();
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown));
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown));
</script>

<style scoped>
.cropper-modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  /* ✅ MODIFICATION START: Set a high z-index to appear above the parent modal */
  z-index: 1600; /* Higher than WorldMapModal's backdrop */
  /* ✅ MODIFICATION END */
}

.cropper-container {
  background: var(--color-background-panel);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  width: 90vw;
  max-width: 600px;
  height: 70vh;
  max-height: 600px;
  display: flex;
  flex-direction: column;
}

.cropper-header, .cropper-footer {
  padding: var(--spacing-3) var(--spacing-4);
  flex-shrink: 0;
}

.cropper-header {
  border-bottom: 1px solid var(--color-border);
}
.cropper-footer {
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}

.cropper-wrapper {
  flex-grow: 1;
  background-color: var(--color-background-page);
  position: relative;
  /* ✅ FIX START: Prevent the cropper from overflowing its container and pushing the footer out of view. */
  /* This is a classic flexbox fix that allows the container to shrink smaller than its content's intrinsic size. */
  min-height: 0;
  /* ✅ FIX END */
}
.image-cropper {
  width: 100%;
  height: 100%;
}

.btn-primary, .btn-secondary {
  padding: var(--spacing-2) var(--spacing-4);
}
.btn-primary:disabled {
  background-color: var(--color-background-hover);
  cursor: not-allowed;
}
</style>