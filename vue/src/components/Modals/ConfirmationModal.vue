<template>
  <ModalWrapper :show="true" :title="options.title || '确认操作'" @close="handleCancel">
    <p class="confirmation-message" v-html="formattedMessage"></p>
    <template #footer>
      <button class="btn-secondary" @click="handleCancel">
        {{ options.cancelText || '取消' }}
      </button>
      <button :class="['btn-confirm', options.confirmClass || 'btn-danger']" @click="handleConfirm">
        {{ options.confirmText || '确认' }}
      </button>
    </template>
  </ModalWrapper>
</template>

<script setup>
import { computed } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import ModalWrapper from './ModalWrapper.vue';

const uiStore = useUiStore();
// --- START OF MODIFICATION ---
// Use uiStore.confirmationOptions as the source of truth for the modal's content and behavior.
const options = computed(() => uiStore.confirmationOptions || {});

const formattedMessage = computed(() => {
  return options.value.message?.replace(/\n/g, '<br>') || '';
});

const handleConfirm = () => {
  if (typeof options.value.onConfirm === 'function') {
    options.value.onConfirm();
  }
  uiStore.hideModal();
};

const handleCancel = () => {
  if (typeof options.value.onCancel === 'function') {
    options.value.onCancel();
  }
  uiStore.hideModal();
};
// --- END OF MODIFICATION ---
</script>

<style scoped>
.confirmation-message {
  line-height: 1.6;
  font-size: var(--font-size-base);
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}
.btn-secondary, .btn-confirm {
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
  font-weight: var(--font-weight-medium);
}
.btn-secondary {
  background-color: var(--color-background-elevated);
  border: 1px solid var(--color-border);
}
.btn-danger { background-color: var(--color-status-danger); color: white; }
.btn-primary { background-color: var(--color-brand-primary); color: white; }
</style>