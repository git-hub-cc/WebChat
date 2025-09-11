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
      <div class="file-name">{{ item.fileName }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
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
.resource-item-wrapper { display: flex; justify-content: center; align-items: center; }
.resource-item { width: 90px; height: 90px; border-radius: var(--border-radius-md); overflow: hidden; position: relative; cursor: pointer; background-color: var(--color-background-elevated); }
.thumbnail { width: 100%; height: 100%; object-fit: cover; }
.video-thumb, .file-thumb, .loading-thumb { display: flex; align-items: center; justify-content: center; flex-direction: column; background-color: var(--color-background-hover); }
.video-thumb video { display: none; }
.video-thumb span { position: absolute; color: white; font-size: 1.5rem; background: rgba(0,0,0,0.3); border-radius: 50%; padding: 5px; }
.file-thumb span { font-weight: bold; font-size: 1rem; color: var(--color-text-secondary); }
.file-name { display: none; }
</style>