<template>
  <div class="resource-item-wrapper">
    <div class="resource-item">
      <img v-if="isImage(item.fileType) && thumbnailUrl" :src="thumbnailUrl" class="thumbnail" loading="lazy" />
      <div v-else-if="isVideo(item.fileType) && thumbnailUrl" class="thumbnail video-thumb">
        <video :src="thumbnailUrl" muted preload="metadata"></video>
        <span>▶</span>
      </div>
      <div v-else-if="!thumbnailUrl && (isImage(item.fileType) || isVideo(item.fileType))" class="thumbnail loading-thumb"><Spinner /></div>
      <div v-else class="thumbnail file-thumb">
        <span>{{ getFileExtension(item.fileName) }}</span>
      </div>
      <!-- Removed file-name from here for a cleaner look, it's redundant with the icon -->
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { mediaCacheService } from '@/services/mediaCacheService';
import Spinner from '@/components/Shared/Spinner.vue';

const props = defineProps({
  item: { type: Object, required: true }
});

const thumbnailUrl = ref(null);

const isImage = (type) => type?.startsWith('image/');
const isVideo = (type) => type?.startsWith('video/');
const getFileExtension = (name) => name?.split('.').pop()?.substring(0, 4).toUpperCase() || 'FILE';

onMounted(async () => {
  if (props.item.fileHash) {
    thumbnailUrl.value = await mediaCacheService.getUrl(props.item.fileHash);
  }
});
</script>

<style scoped>
/* --- START OF MODIFICATION: Styles for a 3-column grid --- */
.resource-item-wrapper {
  /* This forces the item to be a square */
  aspect-ratio: 1 / 1;
  padding: 2px; /* Small padding for visual separation */
}
.resource-item {
  width: 100%;
  height: 100%;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background-color: var(--color-background-elevated);
  display: flex; /* Center content within the item */
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
}
.resource-item:hover {
  transform: scale(1.05);
  box-shadow: var(--shadow-md);
  z-index: 1;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.thumbnail { width: 100%; height: 100%; object-fit: cover; }
.video-thumb, .file-thumb, .loading-thumb { display: flex; align-items: center; justify-content: center; flex-direction: column; background-color: var(--color-background-hover); }
.video-thumb video { display: none; }
.video-thumb span { position: absolute; color: white; font-size: 1.5rem; background: rgba(0,0,0,0.3); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.file-thumb span { font-weight: bold; font-size: 1rem; color: var(--color-text-secondary); }
/* --- END OF MODIFICATION --- */
</style>