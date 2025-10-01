<template>
  <header class="mobile-global-header" :style="headerStyle">
    <IconButton icon="☰" title="菜单" @click="uiStore.showModal('settings')" />

    <div class="search-bar-wrapper">
      <span class="search-icon">🔍</span>
      <input
          type="search"
          :value="chatStore.chatListSearchTerm"
          @input="handleSearchInput"
          placeholder="搜索..."
          class="search-bar"
      />
    </div>

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
// ✅ MODIFICATION START: Import computed and callStore
import { computed } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { useChatStore } from '@/stores/chatStore';
import { useCallStore } from '@/stores/callStore'; // Import callStore
import { debounce } from '@/utils';
import IconButton from '@/components/Shared/IconButton.vue';

const uiStore = useUiStore();
const chatStore = useChatStore();
const callStore = useCallStore(); // Get callStore instance

const handleSearchInput = debounce((event) => {
  chatStore.chatListSearchTerm = event.target.value;
}, 250);

// Dynamically set the header's top position based on the call widget's visibility
const headerStyle = computed(() => ({
  top: callStore.isCallActive && !callStore.isFullScreenCallViewVisible ? '50px' : '0'
}));
// ✅ MODIFICATION END
</script>

<style scoped>
/* This header is hidden by default and only shown on mobile */
.mobile-global-header {
  display: none;
}

@media (max-width: 768px) {
  .mobile-global-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
    position: fixed;
    /* ✅ MODIFICATION START: Remove fixed top: 0, it's now handled by style binding */
    /* top: 0; */
    transition: top 0.3s var(--transition-easing); /* Add smooth transition */
    /* ✅ MODIFICATION END */
    left: 0;
    right: 0;
    height: 50px; /* Defined height for the header */
    padding: 0 var(--spacing-3);
    background-color: var(--color-background-panel);
    border-bottom: 1px solid var(--color-border);
    z-index: 20; /* Ensure it's above other content but below modals */
    box-sizing: border-box;
  }

  .search-bar-wrapper {
    flex-grow: 1;
    position: relative;
  }

  .search-icon {
    position: absolute;
    left: var(--spacing-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-tertiary);
    pointer-events: none;
  }

  .search-bar {
    width: 100%;
    height: 36px;
    border-radius: var(--border-radius-pill);
    padding-left: calc(var(--spacing-3) * 2 + 1em);
  }
}
</style>