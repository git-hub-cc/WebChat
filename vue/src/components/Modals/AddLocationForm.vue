<template>
  <div class="add-location-form" @click.stop>
    <header class="form-header">
      <h4>添加新地点</h4>
      <button class="close-btn" @click="$emit('cancel')">×</button>
    </header>
    <div class="form-body">
      <div class="form-group">
        <label>坐标</label>
        <p class="coords-display">{{ coordinates.lat.toFixed(6) }}, {{ coordinates.lng.toFixed(6) }}</p>
      </div>
      <div class="form-group">
        <label for="tag-select">标签</label>
        <select id="tag-select" v-model="tag">
          <option value="美食">美食</option>
          <option value="景点">景点</option>
          <option value="购物">购物</option>
          <option value="活动">活动</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <div class="form-group">
        <label for="desc-textarea">描述</label>
        <textarea id="desc-textarea" v-model="description" rows="4" placeholder="分享一下这个地方的特别之处吧..."></textarea>
      </div>
      <div class="form-group">
        <label>图片</label>
        <div class="image-upload-area" @click="triggerFileInput" @dragover.prevent @drop.prevent="handleFileDrop">
          <input type="file" ref="fileInputRef" @change="handleFileChange" accept="image/jpeg, image/png, image/webp" hidden>
          <img v-if="croppedImageUrlPreview" :src="croppedImageUrlPreview" alt="图片预览" class="image-preview">
          <p v-else>点击或拖拽图片到此处</p>
        </div>
      </div>
    </div>
    <footer class="form-footer">
      <button class="btn-secondary" @click="$emit('cancel')">取消</button>
      <button class="btn-primary" @click="handleSubmit" :disabled="!isFormValid">提交分享</button>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { eventBus } from '@/services/eventBus';
import { useUiStore } from '@/stores/uiStore';

const props = defineProps({
  coordinates: {
    type: Object,
    required: true,
  }
});
const emit = defineEmits(['submit', 'cancel']);

const uiStore = useUiStore();
const tag = ref('美食');
const description = ref('');
const croppedImageFile = ref(null);
const croppedImageUrlPreview = ref(null);
const fileInputRef = ref(null);

const isFormValid = computed(() => {
  return description.value.trim() && croppedImageFile.value;
});

function triggerFileInput() {
  fileInputRef.value?.click();
}

function processFile(file) {
  if (!file) return;

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    eventBus.emit('showNotification', { message: '请上传 JPG, PNG 或 WebP 格式的图片。', type: 'warning' });
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    eventBus.emit('showNotification', { message: '原始图片大小不能超过 10MB。', type: 'warning' });
    return;
  }

  // ✅ MODIFICATION: This callback will be executed when the cropper is confirmed
  const onCroppingComplete = (finalFile) => {
    croppedImageFile.value = finalFile;
    if (croppedImageUrlPreview.value) {
      URL.revokeObjectURL(croppedImageUrlPreview.value);
    }
    croppedImageUrlPreview.value = URL.createObjectURL(finalFile);
  };

  const imageSrc = URL.createObjectURL(file);

  // ✅ MODIFICATION: Use the new overlay function and pass the callback
  uiStore.showImageCropperOverlay({
    imageSrc,
    fileName: file.name,
    onComplete: onCroppingComplete,
  });
}

function handleFileChange(event) {
  processFile(event.target.files[0]);
  if(event.target) event.target.value = '';
}

function handleFileDrop(event) {
  processFile(event.dataTransfer.files[0]);
}

function handleSubmit() {
  if (isFormValid.value) {
    emit('submit', {
      latitude: props.coordinates.lat,
      longitude: props.coordinates.lng,
      tag: tag.value,
      description: description.value,
      imageFile: croppedImageFile.value,
    });
  }
}

onUnmounted(() => {
  if (croppedImageUrlPreview.value) {
    URL.revokeObjectURL(croppedImageUrlPreview.value);
  }
});
</script>

<style scoped>
.add-location-form {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 400px;
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 1001; /* Above the map */
  display: flex;
  flex-direction: column;
}
.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-3);
  border-bottom: 1px solid var(--color-border);
}
.form-header h4 {
  margin: 0;
  font-weight: var(--font-weight-semibold);
}
.close-btn { font-size: 1.5rem; color: var(--color-text-secondary); }
.form-body {
  padding: var(--spacing-3);
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}
.form-group label {
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-sm);
}
.coords-display {
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
  background-color: var(--color-background-elevated);
  padding: var(--spacing-2);
  border-radius: var(--border-radius-md);
}
.image-upload-area {
  border: 2px dashed var(--color-border);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-4);
  text-align: center;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: border-color 0.2s ease;
}
.image-upload-area:hover {
  border-color: var(--color-brand-primary);
}
.image-preview {
  max-width: 100%;
  max-height: 100px;
  border-radius: var(--border-radius-sm);
  object-fit: contain;
}
.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
  padding: var(--spacing-3);
  border-top: 1px solid var(--color-border);
}
.btn-primary, .btn-secondary {
  padding: var(--spacing-2) var(--spacing-4);
}
.btn-primary:disabled {
  background-color: var(--color-background-hover);
  cursor: not-allowed;
}
</style>