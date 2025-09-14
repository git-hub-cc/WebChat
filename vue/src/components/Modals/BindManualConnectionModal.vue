<template>
  <!-- --- [动画] START: ModalWrapper 已被移至 App.vue，此处不再需要 --- -->
  <ModalWrapper :show="true" title="手动连接工具" @close="closeModal">
    <div class="manual-connection-content">

      <!-- Step 1: Create/Paste Offer -->
      <div class="step">
        <h4>步骤 1: 提议</h4>
        <p>如果你是发起方，点击“创建提议”。如果你是接收方，将对方的提议粘贴到下方文本框。</p>
        <button class="btn-secondary" @click="createManualOffer">创建连接提议</button>
      </div>

      <!-- Step 2: Create/Paste Answer -->
      <div class="step">
        <h4>步骤 2: 应答</h4>
        <p>如果你是接收方，点击“创建应答”。如果你是发起方，将对方的应答粘贴到下方文本框。</p>
        <button class="btn-secondary" @click="createManualAnswer">创建应答 (粘贴提议后)</button>
      </div>

      <!-- Text Area for Signaling Data -->
      <div class="step">
        <h4>连接信息</h4>
        <textarea
            v-model="uiStore.manualSdpText"
            placeholder="在此粘贴或查看连接信息..."
            rows="6"
        ></textarea>
        <button class="btn-secondary" @click="copySdpText">复制我的信息</button>
      </div>

      <!-- Step 3: Finalize Connection -->
      <div class="step">
        <h4>步骤 3: 绑定</h4>
        <p>如果你是发起方，在粘贴对方的应答后，点击“接受应答”。连接成功后，输入对方ID完成绑定。</p>
        <button class="btn-secondary" @click="acceptManualAnswer">接受应答 (粘贴应答后)</button>

        <div v-if="isManualConnectionReady" class="bind-section">
          <input
              type="text"
              v-model="peerId"
              placeholder="输入对方的用户ID"
          />
          <button class="btn-primary" @click="handleBindConnection" :disabled="!peerId.trim()">
            绑定连接
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn-secondary" @click="closeModal">关闭</button>
    </template>
  </ModalWrapper>
  <!-- --- [动画] END --- -->
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import ModalWrapper from './ModalWrapper.vue';
import { useUiStore } from '@/stores/uiStore';
import { webrtcService } from '@/services/webrtcService';
import { eventBus } from '@/services/eventBus';
import { log } from '@/utils';

const uiStore = useUiStore();
const peerId = ref('');
const isManualConnectionReady = ref(false);

const onManualSignal = (signal) => { uiStore.manualSdpText = JSON.stringify(signal, null, 2); };
const onManualConnectionReady = () => {
  isManualConnectionReady.value = true;
  eventBus.emit('showNotification', { message: '手动连接已建立！请输入对方ID以绑定。', type: 'success' });
};

onMounted(() => {
  eventBus.on('webrtc:manual-signal', onManualSignal);
  eventBus.on('webrtc:manual-connection-ready', onManualConnectionReady);
});
onUnmounted(() => {
  eventBus.off('webrtc:manual-signal', onManualSignal);
  eventBus.off('webrtc:manual-connection-ready', onManualConnectionReady);
});

const createManualOffer = () => {
  uiStore.manualSdpText = '';
  isManualConnectionReady.value = false;
  webrtcService.createManualOffer();
};
const createManualAnswer = () => webrtcService.createManualAnswer(uiStore.manualSdpText);
const acceptManualAnswer = () => webrtcService.acceptManualAnswer(uiStore.manualSdpText);
const copySdpText = () => {
  if (uiStore.manualSdpText) {
    navigator.clipboard.writeText(uiStore.manualSdpText);
    eventBus.emit('showNotification', { message: '连接信息已复制！', type: 'success' });
  }
};
const handleBindConnection = async () => {
  const success = await webrtcService.bindManualConnection(peerId.value.trim());
  if (success) closeModal();
};
const closeModal = () => {
  uiStore.hideModal();
  if (!isManualConnectionReady.value) {
    log('手动连接流程已关闭，但未完成绑定。', 'WARN');
    webrtcService.closeConnection('_manual_peer_');
  }
};
</script>

<style scoped>
.manual-connection-content { display: flex; flex-direction: column; gap: var(--spacing-4); }
.step { border-left: 3px solid var(--color-border); padding-left: var(--spacing-3); }
.step h4 { font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-1); }
.step p { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.5; margin-bottom: var(--spacing-2); }
.step .btn-secondary { width: 100%; text-align: left; justify-content: flex-start; margin-bottom: var(--spacing-2); }
textarea { width: 100%; resize: vertical; margin-bottom: var(--spacing-2); }
.bind-section { margin-top: var(--spacing-3); display: flex; flex-direction: column; gap: var(--spacing-2); }
.btn-primary:disabled { background-color: var(--color-background-hover); cursor: not-allowed; }
</style>