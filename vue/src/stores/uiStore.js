import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * @file uiStore.js
 * @description (Vue Refactor) Manages global UI state, such as which panels or modals are open.
 */
export const useUiStore = defineStore('ui', () => {
    // --- STATE ---
    const isDetailsPanelOpen = ref(false);
    const detailsPanelContent = ref('info'); // 'info', 'lobby'
    const activeModal = ref(null); // 'settings', 'newContact', 'calling', 'incomingCall', 'screenshotEditor', 'confirmation', 'mediaViewer', 'bindManualConnection'
    const isAppLoading = ref(true);
    const chatListFilter = ref('all');
    const chatListSearchTerm = ref('');
    const isChatViewActiveOnMobile = ref(false);

    // Context Menu State
    const isContextMenuOpen = ref(false);
    const contextMenuPos = ref({ x: 0, y: 0 });
    const contextMenuItems = ref([]);
    const contextMenuTarget = ref(null);

    // Confirmation Modal State
    const confirmationOptions = ref(null);
    const mediaViewerContent = ref(null);
    const modalPrefillData = ref({});

    // Manual Connection State
    const manualSdpText = ref('');

    // --- ACTIONS ---
    function toggleDetailsPanel(forceState, content = 'info') {
        if (typeof forceState === 'boolean') {
            isDetailsPanelOpen.value = forceState;
        } else {
            isDetailsPanelOpen.value = !(isDetailsPanelOpen.value && detailsPanelContent.value === content);
        }
        if (isDetailsPanelOpen.value) {
            detailsPanelContent.value = content;
        }
    }

    function showModal(modalName, prefillData = {}) {
        modalPrefillData.value = prefillData;
        activeModal.value = modalName;
    }

    function hideModal() {
        activeModal.value = null;
        modalPrefillData.value = {};
        if (confirmationOptions.value) confirmationOptions.value = null;
        if (mediaViewerContent.value) mediaViewerContent.value = null;
    }

    function setAppLoading(isLoading) {
        isAppLoading.value = isLoading;
    }

    function showContextMenu({ event, items, target }) {
        contextMenuPos.value = { x: event.clientX, y: event.clientY };
        contextMenuItems.value = items;
        contextMenuTarget.value = target;
        isContextMenuOpen.value = true;
    }

    function hideContextMenu() {
        isContextMenuOpen.value = false;
        contextMenuItems.value = [];
        contextMenuTarget.value = null;
    }

    function showConfirmationModal(options) {
        confirmationOptions.value = options;
        showModal('confirmation');
    }

    function showMediaViewer(content) {
        mediaViewerContent.value = content;
        showModal('mediaViewer');
    }

    return {
        isDetailsPanelOpen, detailsPanelContent, activeModal, isAppLoading,
        chatListFilter, chatListSearchTerm, isChatViewActiveOnMobile,
        modalPrefillData, isContextMenuOpen, contextMenuPos, contextMenuItems,
        contextMenuTarget, confirmationOptions, mediaViewerContent,
        manualSdpText,
        toggleDetailsPanel, showModal, hideModal, setAppLoading,
        showContextMenu, hideContextMenu, showConfirmationModal, showMediaViewer
    };
});