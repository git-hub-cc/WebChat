import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
    // --- STATE ---
    const isDetailsPanelOpen = ref(false);
    const detailsPanelContent = ref('info');
    const activeModal = ref(null);
    const isAppLoading = ref(true);
    const chatListFilter = ref('all');
    const chatListSearchTerm = ref('');
    const isChatViewActiveOnMobile = ref(false);
    const isContextMenuOpen = ref(false);
    const contextMenuPos = ref({ x: 0, y: 0 });
    const contextMenuItems = ref([]);
    const contextMenuTarget = ref(null);
    const confirmationOptions = ref(null);
    const mediaViewerContent = ref(null);
    // --- ✅ MODIFICATION START: Add state for location viewer ---
    const locationViewerContent = ref(null);
    // --- ✅ MODIFICATION END ---
    const modalPrefillData = ref({});
    const manualSdpText = ref('');
    // --- MODIFICATION START: Add state for dangerous actions ---
    const isPerformingDangerousAction = ref(false);
    // --- MODIFICATION END ---

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
        // --- ✅ MODIFICATION START: Clear location viewer content on modal hide ---
        if (locationViewerContent.value) locationViewerContent.value = null;
        // --- ✅ MODIFICATION END ---
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

    // --- ✅ MODIFICATION START: Add action to show location viewer ---
    function showLocationViewer(content) {
        locationViewerContent.value = content;
        showModal('locationViewer');
    }
    // --- ✅ MODIFICATION END ---

    return {
        isDetailsPanelOpen, detailsPanelContent, activeModal, isAppLoading,
        chatListFilter, chatListSearchTerm, isChatViewActiveOnMobile,
        modalPrefillData, isContextMenuOpen, contextMenuPos, contextMenuItems,
        contextMenuTarget, confirmationOptions, mediaViewerContent,
        locationViewerContent, // Expose new state
        manualSdpText,
        // --- MODIFICATION START: Expose the new state ---
        isPerformingDangerousAction,
        // --- MODIFICATION END ---
        toggleDetailsPanel, showModal, hideModal, setAppLoading,
        showContextMenu, hideContextMenu, showConfirmationModal, showMediaViewer,
        showLocationViewer // Expose new action
    };
});