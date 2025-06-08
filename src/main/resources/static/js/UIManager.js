// MODIFIED: UIManager.js (Further reduced)
const UIManager = {
    checkWebRTCSupport: function () {
        if (typeof RTCPeerConnection === 'undefined') {
            LayoutManager.updateConnectionStatusIndicator('Browser does not support WebRTC.', 'error');
            return false;
        }
        return true;
    },

    showFullImage: function (src, altText = "Image") {
        const modal = document.createElement('div');
        modal.className = 'modal-like image-viewer';
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001';
        const img = document.createElement('img');
        img.src = src;
        img.alt = altText;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain';
        img.style.borderRadius = 'var(--border-radius)';
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';
        modal.appendChild(img);
        modal.onclick = () => modal.remove();
        document.body.appendChild(modal);
    },
    // Properties previously here (isDetailsPanelVisible, _boundTtsConfigCollapseListener, _boundSaveTtsListener)
    // are now managed within DetailsPanelUIManager and TtsUIManager.
};