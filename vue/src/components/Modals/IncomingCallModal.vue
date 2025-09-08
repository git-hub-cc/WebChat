<template>
  <ModalWrapper :show="uiStore.activeModal === 'incomingCall' || uiStore.activeModal === 'calling'" :title="modalTitle" @close="reject">
    <div class="call-modal-content">
      <Avatar v-if="callInfo" :entity="callInfo" size="xl" class="call-avatar" />

      <h2 class="call-title">{{ title }}</h2>
      <p class="call-name">{{ callInfo?.name || '未知用户' }}</p>

      <div v-if="isIncoming" class="call-actions">
        <button class="btn-reject" @click="reject" title="拒绝">
          <span class="icon">📞</span>
          <span>拒绝</span>
        </button>
        <button class="btn-accept" @click="accept" title="接听">
          <span class="icon">📞</span>
          <span>接听</span>
        </button>
      </div>
      <div v-else class="call-actions">
        <button class="btn-reject" @click="reject" title="取消">
          <span class="icon">📞</span>
          <span>取消</span>
        </button>
      </div>
    </div>
  </ModalWrapper>
</template>

<script setup>
import { computed } from 'vue';
import { useCallStore } from '@/stores/callStore';
import { useUiStore } from '@/stores/uiStore';
import { useUserStore } from '@/stores/userStore';
import ModalWrapper from './ModalWrapper.vue';
import Avatar from '@/components/Shared/Avatar.vue';

const callStore = useCallStore();
const uiStore = useUiStore();
const userStore = useUserStore();

const isIncoming = computed(() => uiStore.activeModal === 'incomingCall');
const modalTitle = computed(() => isIncoming.value ? "来电" : "呼叫中");

const callInfo = computed(() => {
  if (isIncoming.value) {
    const peerId = callStore.incomingCallInfo?.peerId;
    return peerId ? (userStore.contacts[peerId] || { id: peerId, name: `用户 ${peerId.substring(0,4)}` }) : null;
  }
  // For outgoing call
  const peerId = callStore.currentPeerId;
  return peerId ? (userStore.contacts[peerId] || { id: peerId, name: `用户 ${peerId.substring(0,4)}` }) : null;
});

const title = computed(() => {
  if (isIncoming.value) {
    return callStore.incomingCallInfo?.isScreenShare ? '屏幕共享请求' : '语音/视频 来电';
  }
  return callStore.isScreenSharing ? '正在请求共享屏幕...' : '正在呼叫...';
});

const reject = () => {
  callStore.rejectCall();
};
const accept = () => {
  callStore.acceptCall();
};
</script>

<style scoped>
/* 保持原样式不变 */
.call-modal-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--spacing-5) 0;
}
.call-avatar {
  margin-bottom: var(--spacing-4);
  width: 90px;
  height: 90px;
  font-size: 3rem;
}
.call-title {
  font-size: var(--font-size-lg);
  color: var(--color-text-secondary);
}
.call-name {
  font-size: 1.75rem;
  font-weight: var(--font-weight-bold);
  margin-top: var(--spacing-1);
  margin-bottom: var(--spacing-6);
}
.call-actions {
  display: flex;
  justify-content: space-around;
  width: 100%;
  max-width: 250px;
}
.call-actions button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-2);
  color: white;
  border-radius: 50%;
  width: 70px;
  height: 70px;
  justify-content: center;
  border: none;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.call-actions button:hover {
  opacity: 0.9;
  transform: translateY(-2px);
}
.call-actions .icon {
  font-size: 1.8rem;
}
.btn-reject {
  background-color: var(--color-status-danger);
}
.btn-reject .icon {
  transform: rotate(135deg);
}
.btn-accept {
  background-color: var(--color-status-success);
}
</style>