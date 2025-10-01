<template>
  <div id="app-root" :class="appRootClasses">
    <MobileGlobalHeader />

    <Transition name="app-fade" mode="out-in">
      <div v-if="uiStore.isAppLoading" class="loading-overlay">
        <AppSkeletonLoader />
      </div>

      <div v-else class="app-container" :class="appContainerClasses">
        <aside class="sidebar-container">
          <ChatList />
        </aside>

        <div class="main-content-wrapper">
          <main class="main-view-container">
            <ChatView v-if="chatStore.currentChatId" :key="chatStore.currentChatId" />
            <div v-else class="welcome-view">
              <WelcomeHeader />
              <WelcomeScreen />
            </div>
          </main>

          <aside
              class="details-panel-container"
              :class="{ 'is-open': uiStore.isDetailsPanelOpen }"
          >
            <Transition name="details-content-fade" mode="out-in">
              <DetailsPanel v-if="uiStore.isDetailsPanelOpen" :key="chatStore.currentChatId" />
            </Transition>
          </aside>
        </div>
      </div>
    </Transition>

    <!-- ✅ MODIFICATION: Base Modal Layer -->
    <Transition name="modal-fade" @after-leave="uiStore.modalPrefillData = {}">
      <div class="modal-wrapper-container" v-if="uiStore.activeModal">
        <SettingsModal
            v-if="uiStore.activeModal === 'settings'"
            @close="uiStore.hideModal()"
            v-motion-pop
        />
        <NewContactModal
            v-if="uiStore.activeModal === 'newContact'"
            @close="uiStore.hideModal()"
            v-motion-pop
        />
        <LocationPickerModal
            v-if="uiStore.activeModal === 'locationPicker'"
            v-motion-pop
        />
        <BindManualConnectionModal
            v-if="uiStore.activeModal === 'bindManualConnection'"
            v-motion-pop
        />
        <ScreenshotGuideModal
            v-if="uiStore.activeModal === 'screenshotGuide'"
            v-motion-pop
        />
        <IncomingCallModal
            v-if="uiStore.activeModal === 'incomingCall' || uiStore.activeModal === 'calling'"
            v-motion-pop
        />
        <ConfirmationModal
            v-if="uiStore.activeModal === 'confirmation'"
            v-motion-pop
        />
        <WorldMapModal v-if="uiStore.activeModal === 'worldMap'" v-motion-pop />
      </div>
    </Transition>

    <!-- ✅ MODIFICATION: Overlay Modal Layer -->
    <Transition name="modal-fade">
      <div class="modal-overlay-wrapper" v-if="uiStore.activeOverlayModal">
        <ScreenshotEditor v-if="uiStore.activeOverlayModal === 'screenshotEditor'" />
        <MediaViewerModal v-if="uiStore.activeOverlayModal === 'mediaViewer'" />
        <LocationViewerModal v-if="uiStore.activeOverlayModal === 'locationViewer'" />
        <ImageCropperModal v-if="uiStore.activeOverlayModal === 'imageCropper'" />
      </div>
    </Transition>


    <VideoCallView v-if="callStore.isCallActive && callStore.isFullScreenCallViewVisible" />
    <FloatingCallWidget v-if="callStore.isCallActive && !callStore.isFullScreenCallViewVisible" />
    <NotificationContainer />
    <ContextMenu />
    <link id="theme-stylesheet" rel="stylesheet" :href="themeHref" />

    <Transition name="theme-transition-fade">
      <div v-if="settingsStore.isThemeTransitioning" class="modal-skeleton-wrapper">
        <SettingsModalSkeleton v-motion-pop />
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, computed, watch, ref, defineAsyncComponent } from 'vue';
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

import AppSkeletonLoader from '@/components/Shared/AppSkeletonLoader.vue';
import ChatList from '@/components/ChatList/ChatList.vue';
import ChatView from '@/components/ChatView/ChatView.vue';
import WelcomeScreen from '@/components/ChatView/WelcomeScreen.vue';
import DetailsPanel from '@/components/DetailsPanel/DetailsPanel.vue';
import NotificationContainer from '@/components/Shared/NotificationContainer.vue';
import VideoCallView from '@/components/ChatView/VideoCallView.vue';
import ContextMenu from '@/components/Shared/ContextMenu.vue';
import WelcomeHeader from '@/components/ChatView/WelcomeHeader.vue';
import FloatingCallWidget from '@/components/Shared/FloatingCallWidget.vue';
import SettingsModalSkeleton from '@/components/Shared/SettingsModalSkeleton.vue';
import MobileGlobalHeader from '@/components/Shared/MobileGlobalHeader.vue';

const SettingsModal = defineAsyncComponent(() => import('@/components/Modals/SettingsModal.vue'));
const NewContactModal = defineAsyncComponent(() => import('@/components/Modals/NewContactModal.vue'));
const LocationPickerModal = defineAsyncComponent(() => import('@/components/Modals/LocationPickerModal.vue'));
const BindManualConnectionModal = defineAsyncComponent(() => import('@/components/Modals/BindManualConnectionModal.vue'));
const ScreenshotEditor = defineAsyncComponent(() => import('@/components/Modals/ScreenshotEditor.vue'));
const ScreenshotGuideModal = defineAsyncComponent(() => import('@/components/Modals/ScreenshotGuideModal.vue'));
const IncomingCallModal = defineAsyncComponent(() => import('@/components/Modals/IncomingCallModal.vue'));
const ConfirmationModal = defineAsyncComponent(() => import('@/components/Modals/ConfirmationModal.vue'));
const MediaViewerModal = defineAsyncComponent(() => import('@/components/Modals/MediaViewerModal.vue'));
const LocationViewerModal = defineAsyncComponent(() => import('@/components/Modals/LocationViewerModal.vue'));
const WorldMapModal = defineAsyncComponent(() => import('@/components/Modals/WorldMapModal.vue'));
const ImageCropperModal = defineAsyncComponent(() => import('@/components/Modals/ImageCropperModal.vue'));

const userStore = useUserStore();
const chatStore = useChatStore();
const groupStore = useGroupStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();
const callStore = useCallStore();
const memoryStore = useMemoryStore();

const appContainerClasses = computed(() => ({
  'details-panel-open': uiStore.isDetailsPanelOpen,
  'chat-active': uiStore.isChatViewActiveOnMobile
}));

const appRootClasses = computed(() => ({
  'call-widget-active': callStore.isCallActive && !callStore.isFullScreenCallViewVisible
}));

const themeHref = computed(() => {
  const themeConfig = settingsStore.currentTheme;
  return themeConfig?.css ? `${themeConfig.css.replace(/^public\//, '')}` : '';
});

const updateViewportHeight = () => {
  if (window.visualViewport) {
    document.documentElement.style.setProperty('--visual-viewport-height', `${window.visualViewport.height}px`);
  }
};
const lastBackPressTime = ref(0);

onMounted(async () => {
  uiStore.setAppLoading(true);
  try {
    await settingsStore.init();
    await userStore.init();
    await groupStore.init();
    await chatStore.init();
    await memoryStore.init();
    await webrtcService.init(userStore.userId);
    webrtcService.proactivelyConnectToOnlineContacts();
    apiService.checkAiServiceHealth().then(isHealthy => {
      userStore.updateAiServiceStatus(isHealthy);
    });
    eventBus.on('webrtc:manual-connection-ready', () => {
      uiStore.showModal('bindManualConnection');
    });
  } catch (error) {
    console.error("应用初始化失败:", error);
  } finally {
    setTimeout(() => uiStore.setAppLoading(false), 500);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportHeight);
    updateViewportHeight();
  }
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', handleBackButton);
});

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', updateViewportHeight);
  }
  window.removeEventListener('popstate', handleBackButton);
});

function handleBackButton() {
  let handled = false;

  if (uiStore.activeOverlayModal) {
    uiStore.hideOverlayModal();
    handled = true;
  } else if (uiStore.activeModal) {
    uiStore.hideModal();
    handled = true;
  } else if (uiStore.isDetailsPanelOpen) {
    uiStore.toggleDetailsPanel(false);
    handled = true;
  } else if (uiStore.isChatViewActiveOnMobile) {
    uiStore.isChatViewActiveOnMobile = false;
    handled = true;
  }

  if (handled) {
    history.pushState(null, '', location.href);
  } else {
    const now = new Date().getTime();
    if (now - lastBackPressTime.value < 1000) {
      history.back();
    } else {
      lastBackPressTime.value = now;
      eventBus.emit('showNotification', { message: '再按一次返回退出', type: 'info', duration: 2000 });
      history.pushState(null, '', location.href);
    }
  }
}

watch(
    () => settingsStore.customBackgrounds[settingsStore.effectiveColorScheme],
    (bgUrl) => {
      document.body.style.backgroundImage = bgUrl ? `url(${bgUrl})` : 'none';
    },
    { immediate: true }
);

watch(() => [settingsStore.currentThemeKey, settingsStore.effectiveColorScheme],
    ([newThemeKey, newScheme], [oldThemeKey, oldScheme] = []) => {
      if (oldThemeKey) document.body.classList.remove(`theme-${oldThemeKey}`);
      if (oldScheme) document.body.classList.remove(`colorscheme-${oldScheme}`);
      if (newThemeKey) document.body.classList.add(`theme-${newThemeKey}`);
      if (newScheme) document.body.classList.add(`colorscheme-${newScheme}`);
    },
    { immediate: true }
);
</script>

<style>
#app-root {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-family-base),serif;
  transition: padding-top 0.3s var(--transition-easing);
}

#app-root.call-widget-active {
  padding-top: 50px;
}

body {
  transition: background-image 0.5s ease-in-out, background-color 0.5s ease-in-out;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.app-container {
  display: flex;
  width: 100%;
  height: 100%;
  max-width: var(--max-app-width);
  max-height: 95dvh;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  position: relative;
  background-color: var(--color-background-panel);
}

.sidebar-container, .main-view-container, .details-panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.sidebar-container {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background-color: var(--color-background-panel);
}
.details-panel-container {
  background-color: var(--color-background-panel);
  border-left: 1px solid var(--color-border);
}
.main-view-container {
  border-left: 1px solid var(--color-border);
}

.main-content-wrapper {
  display: flex;
  flex-grow: 1;
  overflow: hidden;
  position: relative;
}

.main-view-container {
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
}

.details-panel-container {
  flex-shrink: 0;
  width: 0;
  transition: width 0.4s var(--transition-easing-spring);
  will-change: width;
}

.details-panel-container.is-open {
  width: var(--details-panel-width);
}

.details-panel-container :deep(.details-panel) {
  width: var(--details-panel-width);
  transform: translateX(100%);
  transition: transform 0.4s var(--transition-easing-spring);
}
.details-panel-container.is-open :deep(.details-panel) {
  transform: translateX(0);
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
  padding-top: var(--app-root-padding-top, 0);
  box-sizing: border-box;
}

.app-fade-enter-active,
.app-fade-leave-active {
  transition: opacity 0.5s ease-in-out;
}
.app-fade-enter-from,
.app-fade-leave-to {
  opacity: 0;
}

.modal-wrapper-container,
.modal-overlay-wrapper {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-overlay-wrapper {
  z-index: 1050; /* Higher z-index for the overlay layer */
}


.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s var(--transition-easing);
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-skeleton-wrapper {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
}

.theme-transition-fade-enter-active {
  transition: opacity 0.3s ease-in-out;
}
.theme-transition-fade-leave-active {
  transition: opacity 0.3s ease-in-out 0.1s;
}
.theme-transition-fade-enter-from,
.theme-transition-fade-leave-to {
  opacity: 0;
}


@media (max-width: 1024px) {
  .details-panel-container {
    position: absolute;
    top: 0;
    right: 0;
    width: var(--details-panel-width);
    height: 100%;
    transform: translateX(100%);
    transition: transform 0.4s var(--transition-easing-spring);
    z-index: 100;
    will-change: transform;
  }
  .details-panel-container.is-open {
    transform: translateX(0);
    width: var(--details-panel-width);
  }
  .details-panel-container :deep(.details-panel) {
    transform: none;
    transition: none;
  }
}

@media (max-width: 768px) {
  #app-root {
    align-items: flex-start;
  }

  #app-root.call-widget-active {
    padding-top: 0;
  }

  .app-container {
    display: block;
    border-radius: 0;
    padding-top: 50px;
    box-sizing: border-box;
    transition: padding-top 0.3s var(--transition-easing);
    height: var(--visual-viewport-height, 100dvh);
    max-height: var(--visual-viewport-height, 100dvh);
  }

  #app-root.call-widget-active .app-container {
    padding-top: 100px;
  }
  #app-root.call-widget-active :deep(.viewer-backdrop) {
    padding-top: 50px;
    box-sizing: border-box;
    transition: padding-top 0.3s var(--transition-easing);
  }

  .main-content-wrapper {
    height: 100%;
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
    padding-top: 50px;
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
  .details-panel-container.is-open {
    width: 85vw;
  }
  .details-panel-container :deep(.details-panel) {
    width: 100%;
  }
}
</style>