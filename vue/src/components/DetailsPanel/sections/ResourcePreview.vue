<template>
  <div class="resource-preview-root">
    <input type="search" :value="searchQuery" @input="handleSearchInput" placeholder="搜索资源..." class="resource-search" />

    <nav class="resource-tabs">
      <button :class="{ active: activeTab === 'media' }" @click="switchTab('media')">媒体</button>
      <button :class="{ active: activeTab === 'text' }" @click="switchTab('text')">文本</button>
      <button :class="{ active: activeTab === 'files' }" @click="switchTab('files')">文件</button>
      <button :class="{ active: activeTab === 'calendar' }" @click="switchTab('calendar')">日历</button>
    </nav>

    <div class="resource-content" ref="scrollContainerRef">
      <div v-if="isLoading && filteredResources.length === 0" class="loading-state">
        <SkeletonLoader v-if="activeTab !== 'text'" type="grid" />
        <SkeletonLoader v-else type="list-item" v-for="i in 4" :key="i" />
      </div>

      <div v-else-if="activeTab !== 'calendar'" class="resource-view-wrapper">
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

        <!-- --- MODIFICATION START: Improved empty state with SVG --- -->
        <div v-if="!isLoading && filteredResources.length === 0" class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"></path>
          </svg>
          <p>{{ searchQuery ? '无匹配结果' : '此分类下无资源' }}</p>
        </div>
        <!-- --- MODIFICATION END --- -->
      </div>

      <div v-if="activeTab === 'calendar'" class="calendar-wrapper">
        <CalendarView :chat-id="chatId" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { log, debounce } from '@/utils';
import { eventBus } from '@/services/eventBus';
import { RecycleScroller } from 'vue-virtual-scroller';
import CalendarView from './CalendarView.vue';
import SkeletonLoader from '@/components/Shared/SkeletonLoader.vue';

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

const handleSearchInput = debounce((event) => {
  searchQuery.value = event.target.value;
}, 300);

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
    return 72;
  }
  if (scrollContainerRef.value) {
    const containerWidth = scrollContainerRef.value.clientWidth;
    const padding = 8 * 2;
    const gap = 8;
    return (containerWidth - padding - gap * (gridColumns.value - 1)) / gridColumns.value;
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
  searchQuery.value = '';
  if (tab !== 'calendar') {
    loadResources(true);
  }
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
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  padding: var(--spacing-4);
}
/* --- MODIFICATION START: Styles for empty state icon --- */
.empty-state-icon {
  width: 64px;
  height: 64px;
  opacity: 0.3;
  margin-bottom: var(--spacing-3);
}
.empty-state p {
  line-height: 1.5;
}
/* --- MODIFICATION END --- */
.loading-state {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  height: 100%;
}
.calendar-wrapper { padding: var(--spacing-3); }
.scroller.grid-view { padding: var(--spacing-2); }
.scroller.list-view { padding: 0; }

:deep(.scroller.list-view .vue-recycle-scroller__item-view) {
  width: 100% !important;
}
</style>