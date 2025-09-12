<template>
  <div class="details-panel">
    <header class="details-header">
      <h3>{{ title }}</h3>
      <IconButton icon="✕" title="关闭" @click="uiStore.toggleDetailsPanel(false)" />
    </header>
    <div class="details-content">
      <!-- 使用 Vue 的动态组件 :is 来根据状态切换视图 -->
      <KeepAlive>
        <component :is="activeComponent" :key="componentKey" />
      </KeepAlive>
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';
import { useGroupStore } from '@/stores/groupStore';
import IconButton from '@/components/Shared/IconButton.vue';
// --- MODIFICATION START: Import SkeletonLoader instead of Spinner ---
import SkeletonLoader from '@/components/Shared/SkeletonLoader.vue';
// --- MODIFICATION END ---

// 异步加载子组件，优化初始加载性能
const UserProfile = defineAsyncComponent({
  loader: () => import('./sections/UserProfile.vue'),
  // --- MODIFICATION START: Use SkeletonLoader as the placeholder ---
  loadingComponent: SkeletonLoader,
  // --- MODIFICATION END ---
});
const GroupInfo = defineAsyncComponent({
  loader: () => import('./sections/GroupInfo.vue'),
  // --- MODIFICATION START: Use SkeletonLoader as the placeholder ---
  loadingComponent: SkeletonLoader,
  // --- MODIFICATION END ---
});
const PeopleLobby = defineAsyncComponent({
  loader: () => import('./sections/PeopleLobby.vue'),
  // --- MODIFICATION START: Use SkeletonLoader as the placeholder ---
  loadingComponent: SkeletonLoader,
  // --- MODIFICATION END ---
});

const uiStore = useUiStore();
const chatStore = useChatStore();
const userStore = useUserStore();
const groupStore = useGroupStore();

const currentChat = computed(() => {
  const chatId = chatStore.currentChatId;
  if (!chatId) return null;
  // 统一从 userStore 和 groupStore 获取实体
  return userStore.contacts[chatId] || groupStore.groups[chatId];
});

const title = computed(() => {
  switch (uiStore.detailsPanelContent) {
    case 'info':
      return currentChat.value ? `${currentChat.value.name} 信息` : '信息';
    case 'lobby':
      return '人员大厅';
    default:
      return '详情';
  }
});

const activeComponent = computed(() => {
  switch (uiStore.detailsPanelContent) {
    case 'info':
      // 根据当前聊天类型决定显示用户还是群组信息
      return currentChat.value?.type === 'group' ? GroupInfo : UserProfile;
    case 'lobby':
      return PeopleLobby;
    default:
      return null;
  }
});

// 当切换聊天时，确保组件也重新渲染
const componentKey = computed(() => `${uiStore.detailsPanelContent}-${chatStore.currentChatId}`);

</script>

<style scoped>
.details-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-4);
  height: var(--header-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}

.details-header h3 {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.details-content {
  flex-grow: 1;
  overflow-y: auto;
}
</style>