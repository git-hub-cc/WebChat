import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useUiStore = defineStore('ui', () => {
    // --- STATE ---
    const isDetailsPanelOpen = ref(false);
    const detailsPanelContent = ref('info');
    const activeModal = ref(null);
    // ✅ MODIFICATION START: Add state for an overlay modal
    const activeOverlayModal = ref(null);
    // ✅ MODIFICATION END
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
    const manualSdpText = ref('');
    const isPerformingDangerousAction = ref(false);

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
        // Also ensure any overlay is closed when the base modal closes
        activeOverlayModal.value = null;

        // Cleanup logic
        modalPrefillData.value = {};
        if (confirmationOptions.value) confirmationOptions.value = null;
        if (mediaViewerContent.value) mediaViewerContent.value = null;
        if (locationViewerContent.value) locationViewerContent.value = null;
        if (imageCropperContent.value) imageCropperContent.value = null;
    }

    // ✅ MODIFICATION START: New functions to manage overlay modals
    function showOverlayModal(modalName, content) {
        if (modalName === 'imageCropper') {
            imageCropperContent.value = content;
        } else if (modalName === 'mediaViewer') {
            mediaViewerContent.value = content;
        } else if (modalName === 'locationViewer') {
            locationViewerContent.value = content;
        }
        // Can be extended for other overlay types like ScreenshotEditor
        else if (modalName === 'screenshotEditor') {
            modalPrefillData.value = content; // ScreenshotEditor uses prefillData
        }
        // WorldMap doesn't need content
        else if (modalName === 'worldMap') {
            // No specific content needed
        }

        activeOverlayModal.value = modalName;
    }

    function hideOverlayModal() {
        activeOverlayModal.value = null;
        // Cleanup specific content
        if (imageCropperContent.value) imageCropperContent.value = null;
        if (mediaViewerContent.value) mediaViewerContent.value = null;
        if (locationViewerContent.value) locationViewerContent.value = null;
    }
    // ✅ MODIFICATION END

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

    // These now use the overlay system
    function showMediaViewer(content) {
        showOverlayModal('mediaViewer', content);
    }

    function showLocationViewer(content) {
        showOverlayModal('locationViewer', content);
    }

    // Renamed for clarity, this now specifically opens the cropper as an overlay
    function showImageCropperOverlay(content) {
        showOverlayModal('imageCropper', content);
    }


    return {
        isDetailsPanelOpen,
        detailsPanelContent,
        activeModal,
        activeOverlayModal, // Expose new state
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
        manualSdpText,
        isPerformingDangerousAction,
        imageCropperContent,
        toggleDetailsPanel,
        showModal,
        hideModal,
        showOverlayModal, // Expose showOverlayModal for other components like ScreenshotEditor
        hideOverlayModal, // Expose new action
        setAppLoading,
        showContextMenu,
        hideContextMenu,
        showConfirmationModal,
        showMediaViewer,
        showLocationViewer,
        showImageCropperOverlay,
    };
});