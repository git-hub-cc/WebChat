// MODIFIED: UIManager.js (已进一步精简) (已翻译)
const UIManager = {
    checkWebRTCSupport: function () {
        if (typeof RTCPeerConnection === 'undefined') {
            LayoutManager.updateConnectionStatusIndicator('浏览器不支持 WebRTC。', 'error');
            return false;
        }
        return true;
    },

    showFullImage: function (src, altText = "图片") {
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
    // 先前在此处的属性 (isDetailsPanelVisible, _boundTtsConfigCollapseListener, _boundSaveTtsListener)
    // 现已分别由 DetailsPanelUIManager 和 TtsUIManager 管理。
};