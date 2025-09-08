<template>
  <transition name="context-menu-fade">
    <div
        v-if="uiStore.isContextMenuOpen"
        class="context-menu"
        :style="menuStyle"
        ref="menuRef"
    >
      <button
          v-for="(item, index) in uiStore.contextMenuItems"
          :key="index"
          class="context-menu-item"
          :class="item.class"
          @click="executeAction(item.action)"
      >
        {{ item.label }}
      </button>
    </div>
  </transition>
</template>

<script setup>
import {computed, ref, onMounted, onUnmounted, watch, nextTick} from 'vue';
import { useUiStore } from '@/stores/uiStore';

const uiStore = useUiStore();
const menuRef = ref(null);

const menuStyle = computed(() => {
  const { x, y } = uiStore.contextMenuPos;
  // This is a placeholder. We'll adjust it after the element is rendered.
  return {
    top: `${y}px`,
    left: `${x}px`,
    visibility: 'hidden', // Initially hidden to prevent flicker
  };
});

function executeAction(action) {
  if (typeof action === 'function') {
    action();
  }
  uiStore.hideContextMenu();
}

function handleClickOutside(event) {
  if (uiStore.isContextMenuOpen && menuRef.value && !menuRef.value.contains(event.target)) {
    uiStore.hideContextMenu();
  }
}

watch(() => uiStore.isContextMenuOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      if (menuRef.value) {
        const { x, y } = uiStore.contextMenuPos;
        const menuWidth = menuRef.value.offsetWidth;
        const menuHeight = menuRef.value.offsetHeight;

        let adjustedX = x;
        let adjustedY = y;

        if (x + menuWidth > window.innerWidth) {
          adjustedX = window.innerWidth - menuWidth - 5;
        }
        if (y + menuHeight > window.innerHeight) {
          adjustedY = window.innerHeight - menuHeight - 5;
        }
        menuRef.value.style.left = `${adjustedX}px`;
        menuRef.value.style.top = `${adjustedY}px`;
        menuRef.value.style.visibility = 'visible';
      }
    });
  }
});


onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('contextmenu', handleClickOutside, true); // Close on another right-click
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('contextmenu', handleClickOutside, true);
});

</script>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 2000;
  background-color: var(--color-background-panel);
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-1) 0;
  min-width: 160px;
  border: 1px solid var(--color-border);
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: var(--spacing-2) var(--spacing-4);
  text-align: left;
  font-size: var(--font-size-sm);
  transition: background-color 0.1s ease;
}

.context-menu-item:hover {
  background-color: var(--color-background-hover);
}

.context-menu-item.danger {
  color: var(--color-status-danger);
}

.context-menu-item.danger:hover {
  background-color: rgba(220, 53, 69, 0.1);
}

.context-menu-fade-enter-active,
.context-menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.context-menu-fade-enter-from,
.context-menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>