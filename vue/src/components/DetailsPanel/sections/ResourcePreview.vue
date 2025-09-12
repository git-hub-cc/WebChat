<template>
  <div class="resource-preview-root">
    <input type="search" v-model="searchQuery" placeholder="搜索资源..." class="resource-search" />

    <nav class="resource-tabs">
      <button :class="{ active: activeTab === 'media' }" @click="switchTab('media')">媒体</button>
      <button :class="{ active: activeTab === 'text' }" @click="switchTab('text')">文本</button>
      <button :class="{ active: activeTab === 'files' }" @click="switchTab('files')">文件</button>
      <button :class="{ active: activeTab === 'calendar' }" @click="switchTab('calendar')">日历</button>
    </nav>

    <div class="resource-content" ref="scrollContainerRef">
      <div v-if="activeTab !== 'calendar'" class="resource-view-wrapper">
        <RecycleScroller
            v-if="filteredResources.length > 0"
            class="scroller"
            :class="{ 'grid-view': activeTab !== 'text', 'list-view': activeTab === 'text' }"
            :items="filteredResources"
            :item-size="itemSize"
            key-field="id"
            :buffer="200"
            :grid-items="gridColumns"
            direction="vertical"
            v-slot="{ item }"
        >
          <component
              :is="itemComponent"
              :item="item"
              @click="scrollToMessage(item.id)"
          />
        </RecycleScroller>

        <div v-if="isLoading && filteredResources.length === 0" class="loading-spinner"><Spinner /></div>
        <div v-if="!isLoading && filteredResources.length === 0" class="empty-state">
          {{ searchQuery ? '无匹配结果' : '此分类下无资源' }}
        </div>
      </div>

      <div v-if="activeTab === 'calendar'" class="calendar-wrapper">
        <CalendarView :chat-id="chatId" @select-date="scrollToDate" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { log } from '@/utils';
import Spinner from '@/components/Shared/Spinner.vue';
import { eventBus } from '@/services/eventBus';
import { RecycleScroller } from 'vue-virtual-scroller';
import CalendarView from './CalendarView.vue';

const ResourceGridItem = defineAsyncComponent(() => import('./ResourceGridItem.vue'));
const ResourceTextItem = defineAsyncComponent(() => import('./ResourceTextItem.vue'));

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

const filteredResources = computed(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return allResources.value;
  return allResources.value.filter(item => {
    const contentToSearch = item.type === 'text' ? item.content : item.fileName;
    return contentToSearch?.toLowerCase().includes(query);
  });
});

const itemComponent = computed(() => {
  return activeTab.value === 'text' ? ResourceTextItem : ResourceGridItem;
});

const gridColumns = computed(() => {
  return activeTab.value === 'text' ? 1 : 3;
});

const itemSize = computed(() => {
  if (activeTab.value === 'text') {
    return 72; // Fixed height for list items
  }
  if (scrollContainerRef.value) {
    const containerWidth = scrollContainerRef.value.clientWidth;
    return (containerWidth - 16) / 3; // Approx width for square grid items
  }
  return 100;
});

function getResourceTypeForTab(tab) {
  switch (tab) {
    case 'media': return 'imagery';
    case 'text': return 'text';
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
  }
  try {
    const rawMessages = chatStore.getMessagesWithResources(props.chatId, getResourceTypeForTab(activeTab.value), allResources.value.length, 21);
    if (rawMessages.length === 0) hasMore.value = false;
    allResources.value.push(...rawMessages);
  } catch (error) {
    log(`加载资源失败: ${error}`, 'ERROR');
  } finally {
    isLoading.value = false;
  }
}

function switchTab(tab) {
  activeTab.value = tab;
  if (tab !== 'calendar') {
    loadResources(true);
  }
}

function scrollToMessage(messageId) {
  eventBus.emit('chat:scroll-to-message', messageId);
}

function scrollToDate(dateString) {
  eventBus.emit('chat:scroll-to-date', { chatId: props.chatId, dateString });
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
});
</script>

<style scoped>
.resource-preview-root { display: flex; flex-direction: column; height: 100%; }
.resource-search { margin: var(--spacing-3); width: calc(100% - var(--spacing-3) * 2); }
.resource-tabs { display: flex; justify-content: space-around; border-bottom: 1px solid var(--color-border); flex-shrink: 0; }
.resource-tabs button { padding: var(--spacing-3); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); border-bottom: 2px solid transparent; }
.resource-tabs button.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); }
.resource-content { flex-grow: 1; overflow-y: auto; position: relative; }
.scroller { height: 100%; }
.resource-view-wrapper { height: 100%; }
.loading-spinner, .empty-state { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); color: var(--color-text-secondary); }
.calendar-wrapper { padding: var(--spacing-3); }

.scroller.grid-view { padding: var(--spacing-2); }
.scroller.grid-view :deep(.vue-recycle-scroller__item-wrapper) {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-1);
}

/* --- START OF FIX: Styles for list view --- */
.scroller.list-view :deep(.vue-recycle-scroller__item-view) {
  /* This forces the item's container to fill the width */
  width: 100% !important;
  max-width: 100%;
}
/* --- END OF FIX --- */
</style>