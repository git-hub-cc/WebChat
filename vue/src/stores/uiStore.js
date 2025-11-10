import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
    // --- STATE ---
    const isDetailsPanelOpen = ref(false);
    const detailsPanelContent = ref('info');
    const activeModal = ref(null);
    const activeOverlayModal = ref(null);
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
    const locationViewerContent = ref(null);
    const imageCropperContent = ref(null);
    const modalPrefillData = ref({});
    const isPerformingDangerousAction = ref(false);
    // --- [移除] ---
    // const manualSdpText = ref('');
    // const commentModalContent = ref(null); // No longer needed

    // ✅ MODIFICATION START: Add new state for EmojiPicker
    const isEmojiPickerVisible = ref(false);
    // ✅ MODIFICATION END

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

    // ✅ MODIFICATION START: Add new action to control EmojiPicker
    function toggleEmojiPicker(forceState) {
        if (typeof forceState === 'boolean') {
            isEmojiPickerVisible.value = forceState;
        } else {
            isEmojiPickerVisible.value = !isEmojiPickerVisible.value;
        }
    }
    // ✅ MODIFICATION END

    function showModal(modalName, prefillData = {}) {
        modalPrefillData.value = prefillData;
        // --- [移除] ---
        // if (modalName === 'comment') { ... } // No longer needed
        activeModal.value = modalName;
    }

    function hideModal() {
        // ✅ MODIFICATION START: Also hide emoji picker when a modal is hidden
        if (isEmojiPickerVisible.value) {
            isEmojiPickerVisible.value = false;
        }
        // ✅ MODIFICATION END
        activeModal.value = null;
        activeOverlayModal.value = null;
        modalPrefillData.value = {};
        if (confirmationOptions.value) confirmationOptions.value = null;
        if (mediaViewerContent.value) mediaViewerContent.value = null;
        if (locationViewerContent.value) locationViewerContent.value = null;
        if (imageCropperContent.value) imageCropperContent.value = null;
        // --- [移除] ---
        // if (commentModalContent.value) commentModalContent.value = null; // No longer needed
    }

    function showOverlayModal(modalName, content) {
        if (modalName === 'imageCropper') {
            imageCropperContent.value = content;
        } else if (modalName === 'mediaViewer') {
            mediaViewerContent.value = content;
        } else if (modalName === 'locationViewer') {
            locationViewerContent.value = content;
        }
        else if (modalName === 'screenshotEditor') {
            modalPrefillData.value = content;
        }
        else if (modalName === 'worldMap') {
            // No specific content needed
        }
        activeOverlayModal.value = modalName;
    }

    function hideOverlayModal() {
        activeOverlayModal.value = null;
        if (imageCropperContent.value) imageCropperContent.value = null;
        if (mediaViewerContent.value) mediaViewerContent.value = null;
        if (locationViewerContent.value) locationViewerContent.value = null;
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
        showOverlayModal('mediaViewer', content);
    }

    function showLocationViewer(content) {
        showOverlayModal('locationViewer', content);
    }

    function showImageCropperOverlay(content) {
        showOverlayModal('imageCropper', content);
    }


    return {
        isDetailsPanelOpen,
        detailsPanelContent,
        activeModal,
        activeOverlayModal,
        isAppLoading,
        chatListFilter,
        chatListSearchTerm,
        isChatViewActiveOnMobile,
        modalPrefillData,
        isContextMenuOpen,
        contextMenuPos,
        contextMenuItems,
        contextMenuTarget,
        confirmationOptions,
        mediaViewerContent,
        locationViewerContent,
        isPerformingDangerousAction,
        imageCropperContent,
        // ✅ MODIFICATION START: Expose new state and action
        isEmojiPickerVisible,
        // ✅ MODIFICATION END
        toggleDetailsPanel,
        showModal,
        hideModal,
        showOverlayModal,
        hideOverlayModal,
        setAppLoading,
        showContextMenu,
        hideContextMenu,
        showConfirmationModal,
        showMediaViewer,
        showLocationViewer,
        showImageCropperOverlay,
        // ✅ MODIFICATION START: Expose new state and action
        toggleEmojiPicker,
        // ✅ MODIFICATION END
    };
});