<template>
  <!--
    欢迎界面的专属头部。
    提供对全局操作的访问，如菜单和人员大厅，
    即使用户没有选择任何聊天。
  -->
  <header class="welcome-header">
    <!-- MODIFICATION: Menu button removed -->
    <div class="spacer"></div> <!-- Pushes the lobby button to the right -->
    <IconButton
        icon="👥"
        title="人员大厅"
        @click="uiStore.toggleDetailsPanel(true, 'lobby')"
    />
  </header>
</template>

<script setup>
import { useUiStore } from '@/stores/uiStore';
import IconButton from '@/components/Shared/IconButton.vue';

// 获取 UI store 以触发模态框和面板的显示
const uiStore = useUiStore();
</script>

<style scoped>
.welcome-header {
  display: flex;
  align-items: center;
  justify-content: space-between; /* This will work with the spacer */
  padding: 0 var(--spacing-3);
  height: var(--header-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-panel);
  position: relative;
  z-index: 10; /* Ensures it's above the welcome screen content if needed */
}

.spacer {
  flex-grow: 1; /* This empty div takes up all available space */
}
</style>