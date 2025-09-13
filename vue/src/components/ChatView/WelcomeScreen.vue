<template>
  <div class="welcome-screen">
    <!-- --- MODIFICATION START --- -->
    <div class="logo-container">
      <!-- Replaced inline SVG with an img tag pointing to the public favicon -->
      <img src="/icons/favicon.svg" alt="WebChat Logo" width="64" height="64">
    </div>
    <!-- --- MODIFICATION END --- -->
    <h2>WebChat</h2>
    <p>从左侧列表中选择一个聊天开始对话，或点击 "+" 添加新朋友。</p>
    <p class="status-indicator">
      状态: <span class="status-text">{{ statusMessage }}</span>
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { webrtcService } from '@/services/webrtcService';

const userStore = useUserStore();

const statusMessage = computed(() => {
  if (!userStore.userId) return '初始化中...';
  if (!webrtcService.isWebSocketConnected.value) return '信令服务器未连接';
  return `已连接 - 你的ID: ${userStore.userId}`;
});
</script>

<style scoped>
.welcome-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  color: var(--color-text-secondary);
  text-align: center;
  background-color: var(--color-background-elevated);
  padding: var(--spacing-5);
}

/* --- MODIFICATION START --- */
.logo-container {
  margin-bottom: var(--spacing-4);
  opacity: 0.8;
  transform: scale(1.2); /* Make it a bit larger */
}
/* --- MODIFICATION END --- */

h2 {
  font-size: 2rem;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}

p {
  line-height: 1.6;
  max-width: 320px;
}

.status-indicator {
  margin-top: var(--spacing-5);
  font-size: var(--font-size-sm);
  padding: var(--spacing-1) var(--spacing-3);
  background-color: var(--color-background-page);
  border-radius: var(--border-radius-pill);
}
</style>