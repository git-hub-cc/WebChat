<template>
  <!-- --- [动画] START: ModalWrapper 已被移至 App.vue，此处不再需要 --- -->
  <ModalWrapper :show="true" title="准备共享屏幕" @close="cancel">
    <div class="guide-content">
      <div class="guide-icon">🖥️</div>
      <h3>即将开始屏幕共享</h3>
      <p class="guide-text">为了完成共享，您的浏览器会请求您授权并选择要分享的屏幕内容。</p>
      <!-- ✅ MODIFICATION START: Updated hint text -->
      <p class="guide-tip">为了获得最佳效果，请在弹出的窗口中选择 **“整个屏幕”** 选项，并勾选 **“分享系统音频”**。</p>
      <!-- ✅ MODIFICATION END -->
    </div>
    <template #footer>
      <button class="btn-secondary" @click="cancel">取消</button>
      <button class="btn-primary" @click="proceed">好的，开始选择</button>
    </template>
  </ModalWrapper>
  <!-- --- [动画] END --- -->
</template>

<script setup>
import { useUiStore } from '@/stores/uiStore';
// --- MODIFICATION START: Import callStore ---
import { useCallStore } from '@/stores/callStore';
// --- MODIFICATION END ---
import { mediaService } from '@/services/mediaService';
import ModalWrapper from './ModalWrapper.vue';

const uiStore = useUiStore();
// --- MODIFICATION START: Get callStore instance ---
const callStore = useCallStore();
// --- MODIFICATION END ---

function cancel() {
  uiStore.hideModal();
}

// --- MODIFICATION START: Updated proceed logic for Scheme A ---
async function proceed() {
  // 1. Hide our guide modal first to present a clean UI for the browser's native prompt.
  uiStore.hideModal();

  // 2. Await the user's selection from the mediaService.
  //    This will now return a MediaStream or null.
  const stream = await mediaService.captureScreen();

  // 3. If a stream was successfully captured, initiate the call request with it.
  if (stream) {
    callStore.initiateScreenShareWithStream(stream);
  }
  // If the user cancelled, stream will be null and we do nothing further.
}
// --- MODIFICATION END ---
</script>

<style scoped>
.guide-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--spacing-3);
  padding: var(--spacing-3) 0;
}

.guide-icon {
  font-size: 3.5rem;
  line-height: 1;
  padding: var(--spacing-4);
  background-color: var(--color-background-elevated);
  border-radius: 50%;
  margin-bottom: var(--spacing-2);
}

h3 {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.guide-text {
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.guide-tip {
  margin-top: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  background-color: var(--color-background-elevated);
  border-left: 4px solid var(--color-brand-primary);
  border-radius: var(--border-radius-md);
  font-size: var(--font-size-sm);
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
  color: white;
}
</style>