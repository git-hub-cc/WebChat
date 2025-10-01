<template>
  <header class="welcome-header">
    <div class="spacer"></div>
    <!-- ✅ MODIFICATION START: Moved World Map button here -->
    <IconButton icon="🌍" title="世界地图" @click="uiStore.showModal('worldMap')" />
    <!-- ✅ MODIFICATION END -->
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

const uiStore = useUiStore();
</script>

<style scoped>
.welcome-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-3);
  height: var(--header-height);
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-panel);
  position: relative;
  z-index: 10;
}

.spacer {
  flex-grow: 1;
}

/* ✅ MODIFICATION START: Hide this header entirely on mobile */
@media (max-width: 768px) {
  .welcome-header {
    display: none;
  }
}
/* ✅ MODIFICATION END */
</style>