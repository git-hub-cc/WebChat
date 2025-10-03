<template>
  <div class="resource-preview-root">
    <input type="search" id="resource-search-input" :value="searchQuery" @input="handleSearchInput" placeholder="搜索资源..." class="resource-search" aria-label="搜索聊天中的资源" />

    <nav class="resource-tabs">
      <button :class="{ active: activeTab === 'media' }" @click="switchTab('media')">媒体</button>
      <button :class="{ active: activeTab === 'text' }" @click="switchTab('text')">文本</button>
      <button :class="{ active: activeTab === 'files' }" @click="switchTab('files')">文件</button>
      <button :class="{ active: activeTab === 'location' }" @click="switchTab('location')">位置</button>
      <button :class="{ active: activeTab === 'calendar' }" @click="switchTab('calendar')">日历</button>
    </nav>

    <!-- ✅ FIX START: Moved ref to the persistent parent container -->
    <div class="resource-content" ref="containerRef">
      <div v-if="isLoading" class="loading-state">
        <SkeletonLoader v-if="activeTab !== 'text' && activeTab !== 'location'" type="grid" />
        <SkeletonLoader v-else type="list-item" v-for="i in 4" :key="i" />
      </div>

      <div v-else-if="filteredResources.length > 0" class="resource-view-wrapper">
        <RecycleScroller
            class="scroller"
            :class="{ 'grid-view': activeTab === 'media' || activeTab === 'files', 'list-view': activeTab === 'text' || activeTab === 'location' }"
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
              @click="handleItemClick(item)"
          />
        </RecycleScroller>
      </div>
      <!-- ✅ FIX END -->

      <div v-else-if="activeTab === 'calendar'" class="calendar-wrapper">
        <CalendarView :chat-id="chatId" />
      </div>

      <div v-else class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"></path>
        </svg>
        <p>{{ searchQuery ? '无匹配结果' : '此分类下无资源' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chatStore';
import { useUiStore } from '@/stores/uiStore';
import { debounce } from '@/utils';
import { RecycleScroller } from 'vue-virtual-scroller';
import SkeletonLoader from '@/components/Shared/SkeletonLoader.vue';
import { eventBus } from '@/services/eventBus';
import { mediaCacheService } from '@/services/mediaCacheService';

const ResourceGridItem = defineAsyncComponent(() => import('./ResourceGridItem.vue'));
const ResourceTextItem = defineAsyncComponent(() => import('./ResourceTextItem.vue'));
const ResourceLocationItem = defineAsyncComponent(() => import('./ResourceLocationItem.vue'));
const CalendarView = defineAsyncComponent(() => import('./CalendarView.vue'));

const props = defineProps({
  chatId: {
    type: String,
    required: true,
  },
});

const chatStore = useChatStore();
const uiStore = useUiStore();

const searchQuery = ref('');
const activeTab = ref('media');
const isLoading = ref(false);

const containerRef = ref(null);
const containerWidth = ref(0);
let resizeObserver = null;

onMounted(() => {
  if (containerRef.value) {
    // Initialize with current width
    containerWidth.value = containerRef.value.clientWidth;
    // Set up observer for future changes
    resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        containerWidth.value = entries[0].contentRect.width;
      }
    });
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  if (resizeObserver && containerRef.value) {
    resizeObserver.unobserve(containerRef.value);
  }
});

const handleSearchInput = debounce((event) => {
  searchQuery.value = event.target.value;
}, 300);

const switchTab = (tab) => {
  activeTab.value = tab;
  searchQuery.value = '';
};

const resources = computed(() => {
  if (!props.chatId) return [];
  const resourceTypeMap = {
    media: 'imagery',
    text: 'text',
    files: 'other',
    location: 'location',
  };
  const resourceType = resourceTypeMap[activeTab.value];
  if (!resourceType) return [];
  return chatStore.getMessagesWithResources(props.chatId, resourceType);
});

const filteredResources = computed(() => {
  const sourceArray = resources.value || []; // Defensive check
  if (!searchQuery.value.trim()) {
    return sourceArray;
  }
  const query = searchQuery.value.toLowerCase().trim();
  return sourceArray.filter(item =>
      (item.originalSenderName?.toLowerCase().includes(query)) ||
      (item.content?.toLowerCase().includes(query)) ||
      (item.fileName?.toLowerCase().includes(query))
  );
});

const gridColumns = computed(() => {
  if (activeTab.value === 'media' || activeTab.value === 'files') {
    return 3;
  }
  return undefined;
});

const itemSize = computed(() => {
  if ((activeTab.value === 'media' || activeTab.value === 'files') && containerWidth.value > 0) {
    // The library positions items absolutely, so we just need to provide the correct item width.
    // The `gap` is handled by the item's own padding.
    // Use Math.floor to avoid sub-pixel issues that might cause wrapping.
    return Math.floor(containerWidth.value / gridColumns.value);
  }
  return 72; // Default height for list items
});

const itemComponent = computed(() => {
  switch (activeTab.value) {
    case 'media':
    case 'files':
      return ResourceGridItem;
    case 'text':
      return ResourceTextItem;
    case 'location':
      return ResourceLocationItem;
    default:
      return null;
  }
});

async function handleItemClick(item) {
  if (item.type === 'location') {
    uiStore.showLocationViewer({
      latitude: item.latitude,
      longitude: item.longitude,
    });
  } else if (['image', 'video', 'sticker'].includes(item.type)) {
    const url = await mediaCacheService.getUrl(item.fileHash);
    if (url) {
      uiStore.showMediaViewer({
        type: item.type,
        fileType: item.fileType,
        src: url,
        alt: item.fileName,
      });
    } else {
      eventBus.emit('showNotification', { message: '无法加载媒体资源', type: 'error' });
    }
  } else {
    eventBus.emit('chat:scroll-to-message', item.id);
    if (window.innerWidth <= 768) {
      uiStore.toggleDetailsPanel(false);
      uiStore.isChatViewActiveOnMobile = true;
    }
  }
}
</script>

<style scoped>
.resource-preview-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.resource-search {
  width: calc(100% - var(--spacing-4) * 2);
  margin: var(--spacing-4) var(--spacing-4) 0;
  border-radius: var(--border-radius-pill);
  flex-shrink: 0;
}

.resource-tabs {
  display: flex;
  justify-content: space-around;
  border-bottom: 1px solid var(--color-border);
  margin: var(--spacing-3) var(--spacing-4) 0;
  flex-shrink: 0;
}
.resource-tabs button {
  padding: var(--spacing-2) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
  flex-grow: 1;
}
.resource-tabs button.active {
  color: var(--color-brand-primary);
  border-bottom-color: var(--color-brand-primary);
}

.resource-content {
  flex-grow: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.resource-view-wrapper {
  flex-grow: 1;
  min-height: 0;
  padding: 0;
}

.scroller {
  height: 100%;
  overflow-y: auto;
}

.grid-view {
  /* No grid properties needed here, the library handles it */
}

.list-view {
  display: flex;
  flex-direction: column;
}

.loading-state, .empty-state {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  text-align: center;
  gap: var(--spacing-3);
  padding: var(--spacing-4);
}

.empty-state-icon {
  width: 48px;
  height: 48px;
  opacity: 0.3;
}

.calendar-wrapper {
  padding: var(--spacing-2);
}
</style>