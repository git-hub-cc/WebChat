<template>
  <div id="app-root" :class="appRootClasses">
    <!-- ✅ MODIFICATION START: Add the new global mobile header -->
    <MobileGlobalHeader />
    <!-- ✅ MODIFICATION END -->

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

    <Transition
        name="modal-fade"
        @after-leave="uiStore.modalPrefillData = {}"
    >
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
        <ScreenshotEditor v-if="uiStore.activeModal === 'screenshotEditor'" />
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
        <MediaViewerModal v-if="uiStore.activeModal === 'mediaViewer'" />
        <!-- ✅ MODIFICATION START: Add the new LocationViewerModal -->
        <LocationViewerModal v-if="uiStore.activeModal === 'locationViewer'" />
        <!-- ✅ MODIFICATION END -->
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
// ✅ MODIFICATION START: Import ref for back button handling
import { onMounted, onUnmounted, computed, watch, ref } from 'vue';
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
import SettingsModal from '@/components/Modals/SettingsModal.vue';
import NewContactModal from '@/components/Modals/NewContactModal.vue';
import NotificationContainer from '@/components/Shared/NotificationContainer.vue';
import IncomingCallModal from '@/components/Modals/IncomingCallModal.vue';
import VideoCallView from '@/components/ChatView/VideoCallView.vue';
import ScreenshotEditor from '@/components/Modals/ScreenshotEditor.vue';
import ScreenshotGuideModal from '@/components/Modals/ScreenshotGuideModal.vue';
import ContextMenu from '@/components/Shared/ContextMenu.vue';
import ConfirmationModal from '@/components/Modals/ConfirmationModal.vue';
import MediaViewerModal from '@/components/Modals/MediaViewerModal.vue';
import BindManualConnectionModal from '@/components/Modals/BindManualConnectionModal.vue';
import WelcomeHeader from '@/components/ChatView/WelcomeHeader.vue';
import FloatingCallWidget from '@/components/Shared/FloatingCallWidget.vue';
import SettingsModalSkeleton from '@/components/Shared/SettingsModalSkeleton.vue';
import LocationPickerModal from '@/components/Modals/LocationPickerModal.vue';
import MobileGlobalHeader from '@/components/Shared/MobileGlobalHeader.vue';
// ✅ MODIFICATION START: Import the new LocationViewerModal
import LocationViewerModal from '@/components/Modals/LocationViewerModal.vue';
// ✅ MODIFICATION END

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

// ✅ MODIFICATION START: Mobile Keyboard Handling
// This function updates a CSS custom property with the real visual viewport height.
const updateViewportHeight = () => {
  if (window.visualViewport) {
    // We set the CSS variable on the root <html> element for global access.
    document.documentElement.style.setProperty('--visual-viewport-height', `${window.visualViewport.height}px`);
  }
};
// ✅ MODIFICATION END
// ✅ MODIFICATION START: State and logic for custom back button handling
const lastBackPressTime = ref(0);
// ✅ MODIFICATION END

onMounted(async () => {
  uiStore.setAppLoading(true);
  try {
    await settingsStore.init();
    await userStore.init();
    await groupStore.init();
    await chatStore.init();
    await memoryStore.init();
    await webrtcService.init(userStore.userId);
    // --- ✅ MODIFICATION START: Call proactive connection after init ---
    // This runs the first check after all necessary data is loaded.
    webrtcService.proactivelyConnectToOnlineContacts();
    // --- ✅ MODIFICATION END ---
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

  // ✅ MODIFICATION START: Mobile Keyboard Handling
  // Add listener when the component mounts.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportHeight);
    updateViewportHeight(); // Set the initial value.
  }
  // ✅ MODIFICATION START: Add popstate listener for back button
  history.pushState(null, '', location.href); // Initial state to catch first back press
  window.addEventListener('popstate', handleBackButton);
  // ✅ MODIFICATION END
});

// ✅ MODIFICATION START: Mobile Keyboard Handling
// Clean up the event listener when the component is unmounted to prevent memory leaks.
onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', updateViewportHeight);
  }
  // ✅ MODIFICATION START: Remove popstate listener
  window.removeEventListener('popstate', handleBackButton);
  // ✅ MODIFICATION END
});
// ✅ MODIFICATION END

// ✅ MODIFICATION START: Implement the custom back button handler
function handleBackButton() {
  let handled = false;

  // Priority 1: Close any open modal or details panel
  if (uiStore.activeModal) {
    uiStore.hideModal();
    handled = true;
  } else if (uiStore.isDetailsPanelOpen) {
    uiStore.toggleDetailsPanel(false);
    handled = true;
    // Priority 2: Go back from chat view to chat list on mobile
  } else if (uiStore.isChatViewActiveOnMobile) {
    uiStore.isChatViewActiveOnMobile = false;
    handled = true;
  }

  if (handled) {
    // Re-push state to "trap" the user and override default back behavior
    history.pushState(null, '', location.href);
  } else {
    // Priority 3: Double-press to exit logic
    const now = new Date().getTime();
    if (now - lastBackPressTime.value < 1000) {
      history.back(); // Allow the actual back navigation
    } else {
      lastBackPressTime.value = now;
      eventBus.emit('showNotification', { message: '再按一次返回退出', type: 'info', duration: 2000 });
      history.pushState(null, '', location.href); // Trap this back press as well
    }
  }
}
// ✅ MODIFICATION END

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

.modal-wrapper-container {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
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
    align-items: flex-start; /* Align container to top */
  }

  /* ✅ MODIFICATION START: Remove incorrect padding logic from #app-root */
  #app-root.call-widget-active {
    /* This rule is no longer needed on mobile as padding is handled by the container. */
    /* It's still used on desktop, so we set it back to its default here. */
    padding-top: 0;
  }
  /* ✅ MODIFICATION END */

  .app-container {
    display: block;
    border-radius: 0;
    padding-top: 50px;
    box-sizing: border-box;
    /* ✅ MODIFICATION START: Add transition and dynamic padding rule */
    transition: padding-top 0.3s var(--transition-easing);
    /* ✅ MODIFICATION END */
    /* ✅ MODIFICATION START: Mobile Keyboard Handling */
    /* This makes the container resize with the visual viewport (when keyboard appears), */
    /* using 100dvh as a fallback for browsers that don't support the variable. */
    height: var(--visual-viewport-height, 100dvh);
    max-height: var(--visual-viewport-height, 100dvh);
    /* ✅ MODIFICATION END */
  }

  /* ✅ MODIFICATION START: Add new rule for when the call widget is active */
  #app-root.call-widget-active .app-container {
    padding-top: 100px; /* 50px for widget + 50px for header */
  }
  /* ✅ MODIFICATION END */
  /* --- ✅ MODIFICATION START: Add new rule for media viewer --- */
  #app-root.call-widget-active :deep(.viewer-backdrop) {
    padding-top: 50px;
    box-sizing: border-box;
    transition: padding-top 0.3s var(--transition-easing);
  }
  /* --- ✅ MODIFICATION END --- */

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
    padding-top: 50px; /* Same as app-container */
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