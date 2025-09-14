<template>
  <div class="modal-container">
    <header class="modal-header">
      <h2>{{ title }}</h2>
      <IconButton icon="✕" title="关闭" @click="close" />
    </header>
    <main class="modal-body">
      <slot></slot>
    </main>
    <footer class="modal-footer" v-if="$slots.footer">
      <slot name="footer"></slot>
    </footer>
  </div>
</template>

<script setup>
import IconButton from '@/components/Shared/IconButton.vue';

const props = defineProps({
  // 'show' prop is no longer needed as the parent <Transition> controls visibility.
  title: {
    type: String,
    default: 'Modal',
  },
});

const emit = defineEmits(['close']);

const close = () => {
  emit('close');
};
</script>

<style scoped>
/* .modal-backdrop is now moved to App.vue as .modal-wrapper-container */

.modal-container {
  background: var(--color-background-panel);
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  width: 90vw;
  max-width: 500px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.modal-header h2 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.modal-body {
  padding: var(--spacing-4);
  overflow-y: auto;
  flex-grow: 1;
}

.modal-footer {
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
  flex-shrink: 0;
}
</style>