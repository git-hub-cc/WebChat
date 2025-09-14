<template>
  <div class="details-panel" v-auto-animate="{ duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }">
    <header class="details-header">
      <h3>{{ title }}</h3>
      <IconButton icon="✕" title="关闭" @click="uiStore.toggleDetailsPanel(false)" />
    </header>
    <div class="details-content">
      <!-- --- [动画] START: 优化组件切换动画以消除闪烁 --- -->
      <!-- 使用 mode="out-in" 确保旧组件完全离开后，新组件再进入 -->
      <Transition name="details-content-fade" mode="out-in">
        <KeepAlive>
          <component :is="activeComponent" :key="componentKey" />
        </KeepAlive>
      </Transition>
      <!-- --- [动画] END --- -->
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
import SkeletonLoader from '@/components/Shared/SkeletonLoader.vue';

// --- [动画] START: 为骨架屏也包裹一层过渡，使其加载和消失更平滑 ---
const SmoothSkeletonLoader = {
  template: `
    <Transition name="skeleton-fade" appear>
      <SkeletonLoader type="profile" />
    </Transition>
  `
};
// --- [动画] END ---

// 异步加载子组件，优化初始加载性能
const UserProfile = defineAsyncComponent({
  loader: () => import('./sections/UserProfile.vue'),
  loadingComponent: SmoothSkeletonLoader, // 使用带过渡的骨架屏
  delay: 200, // 仅在加载超过200ms时显示加载状态，避免快速切换时的闪烁
  suspensible: false // 确保与 <Transition> 良好配合
});
const GroupInfo = defineAsyncComponent({
  loader: () => import('./sections/GroupInfo.vue'),
  loadingComponent: SmoothSkeletonLoader,
  delay: 200,
  suspensible: false
});
const PeopleLobby = defineAsyncComponent({
  loader: () => import('./sections/PeopleLobby.vue'),
  loadingComponent: SmoothSkeletonLoader,
  delay: 200,
  suspensible: false
});

const uiStore = useUiStore();
const chatStore = useChatStore();
const userStore = useUserStore();
const groupStore = useGroupStore();

const currentChat = computed(() => {
  const chatId = chatStore.currentChatId;
  if (!chatId) return null;
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
      return currentChat.value?.type === 'group' ? GroupInfo : UserProfile;
    case 'lobby':
      return PeopleLobby;
    default:
      return null;
  }
});

// 当切换聊天或内容类型时，确保组件重新渲染
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

/* --- [动画] START: 优化后的详情面板内容切换动画 --- */
.details-content-fade-enter-active,
.details-content-fade-leave-active {
  transition: opacity 0.2s ease;
}
.details-content-fade-enter-from,
.details-content-fade-leave-to {
  opacity: 0;
}
/*
  为骨架屏（在 SmoothSkeletonLoader 组件内部）添加一个独立的过渡，
  这样它可以在内容加载完成时平滑地消失。
  使用 :deep() 选择器来穿透组件作用域。
*/
:deep(.skeleton-fade-enter-active),
:deep(.skeleton-fade-leave-active) {
  transition: opacity 0.3s ease;
}
:deep(.skeleton-fade-enter-from),
:deep(.skeleton-fade-leave-to) {
  opacity: 0;
}
/* --- [动画] END --- */
</style>