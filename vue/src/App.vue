<template>
  <div id="app-root" :style="backgroundStyle">
    <!-- 全局加载遮罩 -->
    <div v-if="uiStore.isAppLoading" class="loading-overlay">
      <Spinner />
      <div class="loading-text">连接中，请稍候...</div>
    </div>

    <!-- 主应用容器 -->
    <div v-else class="app-container" :class="appContainerClasses">
      <aside class="sidebar-container">
        <ChatList />
      </aside>

      <main class="main-view-container">
        <ChatView v-if="chatStore.currentChatId" :key="chatStore.currentChatId" />
        <div v-else class="welcome-view">
          <WelcomeHeader />
          <WelcomeScreen />
        </div>
      </main>

      <aside v-if="uiStore.isDetailsPanelOpen" class="details-panel-container">
        <DetailsPanel :key="chatStore.currentChatId" />
      </aside>
    </div>

    <!-- 模态框 -->
    <SettingsModal v-if="uiStore.activeModal === 'settings'" @close="uiStore.hideModal()" />
    <NewContactModal v-if="uiStore.activeModal === 'newContact'" @close="uiStore.hideModal()" />
    <BindManualConnectionModal v-if="uiStore.activeModal === 'bindManualConnection'" />
    <ScreenshotEditor v-if="uiStore.activeModal === 'screenshotEditor'" />
    <IncomingCallModal v-if="uiStore.activeModal === 'incomingCall' || uiStore.activeModal === 'calling'" />
    <ConfirmationModal v-if="uiStore.activeModal === 'confirmation'" />
    <MediaViewerModal v-if="uiStore.activeModal === 'mediaViewer'" />

    <!-- ======================================================= -->
    <!-- MODIFICATION START: Conditional Call View Rendering     -->
    <!-- ======================================================= -->
    <!-- 全屏通话视图 -->
    <VideoCallView v-if="callStore.isCallActive && callStore.isFullScreenCallViewVisible" />
    <!-- 浮动通话小部件 -->
    <FloatingCallWidget v-if="callStore.isCallActive && !callStore.isFullScreenCallViewVisible" />
    <!-- ======================================================= -->
    <!-- MODIFICATION END                                        -->
    <!-- ======================================================= -->

    <!-- 全局通知 -->
    <NotificationContainer />

    <!-- 全局右键菜单 -->
    <ContextMenu />

    <!-- 动态主题样式表 -->
    <link id="theme-stylesheet" rel="stylesheet" :href="themeHref" />
  </div>
</template>

<script setup>
import { onMounted, computed, watch } from 'vue';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useGroupStore } from '@/stores/groupStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { useCallStore } from '@/stores/callStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { webrtcService } from '@/services/webrtcService';
import { apiService } from '@/services/apiService';
import { eventBus } from '@/services/eventBus';

// 导入组件
import ChatList from '@/components/ChatList/ChatList.vue';
import ChatView from '@/components/ChatView/ChatView.vue';
import WelcomeScreen from '@/components/ChatView/WelcomeScreen.vue';
import DetailsPanel from '@/components/DetailsPanel/DetailsPanel.vue';
import SettingsModal from '@/components/Modals/SettingsModal.vue';
import NewContactModal from '@/components/Modals/NewContactModal.vue';
import NotificationContainer from '@/components/Shared/NotificationContainer.vue';
import Spinner from '@/components/Shared/Spinner.vue';
import IncomingCallModal from '@/components/Modals/IncomingCallModal.vue';
import VideoCallView from '@/components/ChatView/VideoCallView.vue';
import ScreenshotEditor from '@/components/Modals/ScreenshotEditor.vue';
import ContextMenu from '@/components/Shared/ContextMenu.vue';
import ConfirmationModal from '@/components/Modals/ConfirmationModal.vue';
import MediaViewerModal from '@/components/Modals/MediaViewerModal.vue';
import BindManualConnectionModal from '@/components/Modals/BindManualConnectionModal.vue';
import WelcomeHeader from '@/components/ChatView/WelcomeHeader.vue';
// --- NEW: Import FloatingCallWidget ---
import FloatingCallWidget from '@/components/Shared/FloatingCallWidget.vue';

// 初始化 stores
const userStore = useUserStore();
const chatStore = useChatStore();
const groupStore = useGroupStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const callStore = useCallStore();
const memoryStore = useMemoryStore();

// --- 计算属性 (unchanged) ---
const appContainerClasses = computed(() => ({
  'details-panel-open': uiStore.isDetailsPanelOpen,
  'chat-active': uiStore.isChatViewActiveOnMobile
}));
const backgroundStyle = computed(() => {
  const bgUrl = settingsStore.customBackgrounds[settingsStore.effectiveColorScheme];
  return bgUrl ? { '--custom-background-image': `url(${bgUrl})` } : {};
});
const themeHref = computed(() => {
  const themeConfig = settingsStore.currentTheme;
  return themeConfig?.css ? `/${themeConfig.css.replace(/^public\//, '')}` : '';
});

// --- 生命周期钩子 & 侦听器 (unchanged) ---
onMounted(async () => {
  uiStore.setAppLoading(true);
  try {
    await settingsStore.init();
    await userStore.init();
    await groupStore.init();
    await chatStore.init();
    await memoryStore.init();
    await webrtcService.init(userStore.userId);
    apiService.checkAiServiceHealth().then(isHealthy => {
      userStore.updateAiServiceStatus(isHealthy);
    });
    eventBus.on('webrtc:manual-connection-ready', () => {
      uiStore.showModal('bindManualConnection');
    });
  } catch (error) {
    console.error("应用初始化失败:", error);
  } finally {
    setTimeout(() => uiStore.setAppLoading(false), 300);
  }
});
watch(() => [settingsStore.currentThemeKey, settingsStore.effectiveColorScheme, settingsStore.isThemeTransitioning],
    ([newThemeKey, newScheme, newIsTransitioning], [oldThemeKey, oldScheme] = []) => {
      if (oldThemeKey) document.body.classList.remove(`theme-${oldThemeKey}`);
      if (oldScheme) document.body.classList.remove(`colorscheme-${oldScheme}`);
      if (newThemeKey) document.body.classList.add(`theme-${newThemeKey}`);
      if (newScheme) document.body.classList.add(`colorscheme-${newScheme}`);
      if (newIsTransitioning) document.documentElement.classList.add('is-transitioning');
      else document.documentElement.classList.remove('is-transitioning');
    },
    { immediate: true }
);
</script>

<style>
/* Global styles are unchanged */
#app-root {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-page);
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  transition: background-image 0.5s ease-in-out, background-color 0.5s ease-in-out;
  background-size: cover;
  background-position: center;
  background-image: var(--custom-background-image, none);
}
.app-container {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  width: 100%;
  height: 100%;
  max-width: var(--max-app-width);
  max-height: 95dvh;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  position: relative;
  transition: grid-template-columns 0.3s var(--transition-easing);
  background-color: var(--color-background-panel);
}
.app-container.details-panel-open {
  grid-template-columns: var(--sidebar-width) 1fr var(--details-panel-width);
}
.sidebar-container, .main-view-container, .details-panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.sidebar-container {
  background-color: var(--color-background-panel);
}
.details-panel-container {
  background-color: var(--color-background-panel);
  border-left: 1px solid var(--color-border);
}
.main-view-container {
  border-left: 1px solid var(--color-border);
}
.welcome-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.welcome-view > .welcome-screen {
  flex-grow: 1;
}
.loading-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-page);
  z-index: 9999;
}
.loading-text {
  margin-top: 1rem;
  font-size: 1.2rem;
  color: var(--color-text-secondary);
}
@media (max-width: 1024px) {
  .app-container.details-panel-open {
    grid-template-columns: var(--sidebar-width) 1fr;
  }
  .details-panel-container {
    position: absolute;
    top: 0;
    right: 0;
    width: var(--details-panel-width);
    height: 100%;
    transform: translateX(100%);
    transition: transform 0.3s var(--transition-easing);
    z-index: 100;
  }
  .app-container.details-panel-open .details-panel-container {
    transform: translateX(0);
  }
}
@media (max-width: 768px) {
  .app-container {
    grid-template-columns: 1fr;
    max-height: 100dvh;
    border-radius: 0;
  }
  .sidebar-container {
    width: 100%;
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    z-index: 10;
    transform: translateX(0);
    transition: transform 0.3s var(--transition-easing);
  }
  .main-view-container {
    border-left: none;
  }
  .app-container.chat-active .sidebar-container {
    transform: translateX(-100%);
  }
  .details-panel-container {
    width: 85vw;
    max-width: 320px;
  }
}
@keyframes reveal-in {
  from { clip-path: circle(0% at var(--clip-x) var(--clip-y)); }
  to { clip-path: circle(150% at var(--clip-x) var(--clip-y)); }
}
html.is-transitioning::view-transition-new(root) {
  animation: reveal-in 0.5s ease-in-out;
  mix-blend-mode: normal;
}
html.is-transitioning::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
</style>