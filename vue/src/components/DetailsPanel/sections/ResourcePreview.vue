<template>
  <div class="resource-preview-root">
    <input type="search" v-model="searchQuery" placeholder="搜索资源..." class="resource-search" />

    <nav class="resource-tabs">
      <button :class="{ active: activeTab === 'media' }" @click="switchTab('media')">媒体</button>
      <button :class="{ active: activeTab === 'files' }" @click="switchTab('files')">文件</button>
      <button :class="{ active: activeTab === 'calendar' }" @click="switchTab('calendar')">日历</button>
    </nav>

    <div class="resource-content" ref="scrollContainerRef">
      <!-- Media/Files Grid View -->
      <div v-if="activeTab !== 'calendar'" class="resource-grid-wrapper">
        <RecycleScroller
            v-if="filteredResources.length > 0"
            class="scroller"
            :items="filteredResources"
            :item-size="100"
            key-field="id"
            :buffer="200"
            v-slot="{ item }"
        >
          <div class="resource-item" @click="scrollToMessage(item.id)">
            <img v-if="isImage(item.fileType)" :src="item.thumbnailUrl" class="thumbnail" loading="lazy" />
            <div v-else-if="isVideo(item.fileType)" class="thumbnail video-thumb">
              <video :src="item.thumbnailUrl" muted preload="metadata"></video>
              <span>▶</span>
            </div>
            <div v-else class="thumbnail file-thumb">
              <span>{{ getFileExtension(item.fileName) }}</span>
            </div>
            <div class="file-name">{{ item.fileName }}</div>
          </div>
        </RecycleScroller>

        <div v-if="isLoading" class="loading-spinner"><Spinner /></div>
        <div v-if="!isLoading && filteredResources.length === 0" class="empty-state">
          {{ searchQuery ? '无匹配结果' : '此分类下无资源' }}
        </div>
      </div>

      <!-- Calendar View -->
      <div v-if="activeTab === 'calendar'" class="calendar-wrapper">
        <p>日历功能正在开发中...</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { dbService } from '@/services/dbService';
import { log } from '@/utils';
import Spinner from '@/components/Shared/Spinner.vue';
import { eventBus } from '@/services/eventBus';
import { RecycleScroller } from 'vue-virtual-scroller';

const props = defineProps({
  chatId: { type: String, required: true }
});

const chatStore = useChatStore();
const scrollContainerRef = ref(null);

const activeTab = ref('media');
const searchQuery = ref('');
const allResources = ref([]);
const isLoading = ref(false);
const hasMore = ref(true);

let objectUrls = new Map();

const filteredResources = computed(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return allResources.value;
  return allResources.value.filter(item => item.fileName?.toLowerCase().includes(query));
});

const isImage = (type) => type?.startsWith('image/');
const isVideo = (type) => type?.startsWith('video/');
const getFileExtension = (name) => name?.split('.').pop()?.substring(0, 4).toUpperCase() || 'FILE';

function getResourceTypeForTab(tab) {
  switch (tab) {
    case 'media': return 'imagery';
    case 'files': return 'other';
    default: return 'all';
  }
}

async function loadResources(reset = false) {
  if (isLoading.value || (!hasMore.value && !reset)) return;
  isLoading.value = true;

  if (reset) {
    allResources.value = [];
    hasMore.value = true;
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls.clear();
  }

  try {
    const rawMessages = chatStore.getMessagesWithResources(props.chatId, getResourceTypeForTab(activeTab.value), allResources.value.length, 20);

    if (rawMessages.length === 0) {
      hasMore.value = false;
      return;
    }

    const processedItems = await Promise.all(rawMessages.map(async msg => {
      const cacheItem = await dbService.getItem('fileCache', msg.fileHash);
      let thumbnailUrl = '';
      if (cacheItem?.fileBlob) {
        const url = URL.createObjectURL(cacheItem.fileBlob);
        objectUrls.set(msg.id, url);
        thumbnailUrl = url;
      }
      return { ...msg, thumbnailUrl };
    }));
    allResources.value.push(...processedItems);

  } catch (error) {
    log(`加载资源失败: ${error}`, 'ERROR');
  } finally {
    isLoading.value = false;
  }
}

function switchTab(tab) {
  activeTab.value = tab;
  loadResources(true);
}

function scrollToMessage(messageId) {
  eventBus.emit('chat:scroll-to-message', messageId);
}

function handleScroll() {
  const el = scrollContainerRef.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
    loadResources();
  }
}

onMounted(() => {
  loadResources(true);
  scrollContainerRef.value?.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  scrollContainerRef.value?.removeEventListener('scroll', handleScroll);
  objectUrls.forEach(URL.revokeObjectURL);
});

</script>

<style scoped>
.resource-preview-root { display: flex; flex-direction: column; height: 100%; }
.resource-search { margin: var(--spacing-3); width: calc(100% - var(--spacing-3) * 2); }
.resource-tabs { display: flex; justify-content: space-around; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.resource-tabs button { padding: var(--spacing-3); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
.resource-tabs button.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); }
.resource-content { flex-grow: 1; overflow-y: auto; }
.scroller { height: 100%; }
.resource-grid-wrapper { height: 100%; }
.resource-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: var(--spacing-1); padding: var(--spacing-2); }
.resource-item { aspect-ratio: 1; border-radius: var(--border-radius-md); overflow: hidden; position: relative; cursor: pointer; background-color: var(--color-background-elevated); }
.thumbnail { width: 100%; height: 100%; object-fit: cover; }
.video-thumb, .file-thumb { display: flex; align-items: center; justify-content: center; flex-direction: column; }
.video-thumb video { width: 100%; height: 100%; object-fit: cover; }
.video-thumb span { position: absolute; color: white; font-size: 1.5rem; background: rgba(0,0,0,0.3); border-radius: 50%; padding: 5px; pointer-events: none; }
.file-thumb span { font-weight: bold; font-size: 1rem; color: var(--color-text-secondary); }
.file-name { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.6), transparent); color: white; font-size: var(--font-size-xs); padding: var(--spacing-1); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.loading-spinner { display: flex; justify-content: center; padding: var(--spacing-4); }
.empty-state { text-align: center; padding: var(--spacing-5); color: var(--color-text-secondary); }
</style>