import { defineStore } from 'pinia';
import { ref } from 'vue';
import { debounce } from '@/utils';

// --- ✅ MODIFICATION START: Debounced function to save sidebar width ---
const saveSidebarWidthDebounced = debounce((width) => {
    localStorage.setItem('sidebarWidth', width.toString());
}, 500);
// --- ✅ MODIFICATION END ---


export const useUiStore = defineStore('ui', () => {
    // --- STATE ---
    // ✅ MODIFICATION START: Add sidebarWidth state, loading from localStorage
    const sidebarWidth = ref(parseInt(localStorage.getItem('sidebarWidth') || '320', 10));
    // ✅ MODIFICATION END
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
    const isEmojiPickerVisible = ref(false);

    // --- ACTIONS ---

    // ✅ MODIFICATION START: Add action to set sidebar width
    /**
     * Sets the width of the chat list sidebar.
     * @param {number} newWidth - The new width in pixels.
     */
    function setSidebarWidth(newWidth) {
        const minWidth = 200;  // Minimum width (for avatar-only view)
        const maxWidth = 600; // A reasonable maximum width

        // Clamp the width within the defined bounds
        const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

        if (sidebarWidth.value !== clampedWidth) {
            sidebarWidth.value = clampedWidth;
            // Persist the new width to localStorage using a debounced function
            saveSidebarWidthDebounced(clampedWidth);
        }
    }
    // ✅ MODIFICATION END

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

    function toggleEmojiPicker(forceState) {
        if (typeof forceState === 'boolean') {
            isEmojiPickerVisible.value = forceState;
        } else {
            isEmojiPickerVisible.value = !isEmojiPickerVisible.value;
        }
    }

    function showModal(modalName, prefillData = {}) {
        modalPrefillData.value = prefillData;
        activeModal.value = modalName;
    }

    function hideModal() {
        if (isEmojiPickerVisible.value) {
            isEmojiPickerVisible.value = false;
        }
        activeModal.value = null;
        activeOverlayModal.value = null;
        modalPrefillData.value = {};
        if (confirmationOptions.value) confirmationOptions.value = null;
        if (mediaViewerContent.value) mediaViewerContent.value = null;
        if (locationViewerContent.value) locationViewerContent.value = null;
        if (imageCropperContent.value) imageCropperContent.value = null;
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
        // ✅ MODIFICATION START: Expose new state and action
        sidebarWidth,
        // ✅ MODIFICATION END
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
        isEmojiPickerVisible,
        // ✅ MODIFICATION START: Expose new state and action
        setSidebarWidth,
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
        toggleEmojiPicker,
    };
});