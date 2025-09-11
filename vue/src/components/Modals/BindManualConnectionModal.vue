<template>
  <ModalWrapper :show="true" title="绑定手动连接" @close="closeModal">
    <div class="bind-connection-content">
      <p>手动连接已建立！请输入对方的用户ID以关联此连接并开始聊天。</p>

      <div class="input-group">
        <label for="peer-id-input">对方的用户ID</label>
        <input
            id="peer-id-input"
            type="text"
            v-model="peerId"
            placeholder="粘贴对方的完整用户ID"
            ref="inputRef"
        />
      </div>

    </div>
    <template #footer>
      <button class="btn-secondary" @click="closeModal">稍后绑定</button>
      <button class="btn-primary" @click="handleBindConnection" :disabled="!peerId.trim()">
        绑定并开始聊天
      </button>
    </template>
  </ModalWrapper>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useUiStore } from '@/stores/uiStore';
import { webrtcService } from '@/services/webrtcService';
import { eventBus } from '@/services/eventBus';

const uiStore = useUiStore();
const peerId = ref('');
const inputRef = ref(null);

onMounted(() => {
  // Automatically focus the input field when the modal opens
  inputRef.value?.focus();
});

const handleBindConnection = async () => {
  const success = await webrtcService.bindManualConnection(peerId.value.trim());
  if (success) {
    closeModal();
  }
};

const closeModal = () => {
  uiStore.hideModal();
  eventBus.emit('showNotification', {
    message: '手动连接仍在后台，您之后仍可再次打开设置进行绑定。',
    type: 'info',
    duration: 7000
  });
};
</script>

<style scoped>
.bind-connection-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

p {
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.input-group label {
  font-weight: var(--font-weight-medium);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
}

.btn-secondary, .btn-primary {
  padding: var(--spacing-2) var(--spacing-4);
  border-radius: var(--border-radius-md);
  font-weight: var(--font-weight-medium);
}
.btn-secondary {
  background-color: var(--color-background-elevated);
  border: 1px solid var(--color-border);
}
.btn-primary {
  background-color: var(--color-brand-primary);
  color: var(--color-text-on-brand);
}
.btn-primary:disabled {
  background-color: var(--color-background-hover);
  color: var(--color-text-secondary);
  cursor: not-allowed;
}
</style>