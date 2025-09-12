<template>
  <ModalWrapper :show="true" title="准备截图" @close="cancel">
    <div class="guide-content">
      <div class="guide-icon">🖥️</div>
      <h3>即将开始屏幕截图</h3>
      <p class="guide-text">为了完成截图，您的浏览器会请求您授权并选择要分享的屏幕内容。</p>
      <p class="guide-tip">为了获得最佳效果，请在弹出的窗口中选择 **“整个屏幕”** 或 **“Screen”** 选项。</p>
    </div>
    <template #footer>
      <button class="btn-secondary" @click="cancel">取消</button>
      <button class="btn-primary" @click="proceed">好的，开始截图</button>
    </template>
  </ModalWrapper>
</template>

<script setup>
import { useUiStore } from '@/stores/uiStore';
import { mediaService } from '@/services/mediaService';
import ModalWrapper from './ModalWrapper.vue';

const uiStore = useUiStore();

function cancel() {
  uiStore.hideModal();
}

function proceed() {
  // 1. 先关闭我们自己的模态框
  uiStore.hideModal();
  // 2. 立即触发原生的屏幕捕获流程
  mediaService.captureScreen();
}
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