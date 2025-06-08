// NEW FILE: LayoutManager.js
// Responsibilities:
// - Managing responsive UI layout (mobile vs. desktop).
// - Showing/hiding major app sections (sidebar, chat area) for mobile view.
const LayoutManager = {
    appContainer: null,
    sidebarNav: null,
    chatAreaEl: null,
    backToListBtn: null,

    init: function() {
        this.appContainer = document.querySelector('.app-container');
        this.sidebarNav = document.getElementById('sidebarNav');
        this.chatAreaEl = document.getElementById('chatArea');
        this.backToListBtn = document.getElementById('backToListBtn');

        this.updateResponsiveUI(); // Initial check
        window.addEventListener('resize', this.updateResponsiveUI.bind(this));

        if (this.backToListBtn) {
            this.backToListBtn.addEventListener('click', () => this.showChatListArea());
        }
    },

    updateResponsiveUI: function () {
        if (!this.appContainer) return;

        if (window.innerWidth <= 768) {
            this.appContainer.classList.add('mobile-view');
            // If not actively in chat view on mobile, show chat list
            if (!this.appContainer.classList.contains('chat-view-active')) {
                this.showChatListArea();
            }
        } else {
            this.appContainer.classList.remove('mobile-view', 'chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex';
        }
    },

    showChatListArea: function () {
        if (this.appContainer && this.appContainer.classList.contains('mobile-view')) {
            this.appContainer.classList.remove('chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'none';
        }
        // When showing chat list, details panel should be hidden if visible
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible) {
            DetailsPanelUIManager.toggleDetailsPanel(false);
        }
    },

    showChatAreaLayout: function () { // Renamed to avoid conflict with ChatAreaUIManager's showChatArea
        if (!this.appContainer || !this.chatAreaEl) return;

        if (this.appContainer.classList.contains('mobile-view')) {
            this.appContainer.classList.add('chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'none';
            this.chatAreaEl.style.display = 'flex';
        } else {
            // Desktop view, ensure chat area is visible if it was hidden
            this.chatAreaEl.style.display = 'flex';
        }
    },
    updateConnectionStatusIndicator: function (message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');
        if (statusTextEl) statusTextEl.textContent = message;
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator global';
            if (type !== 'info') statusContainerEl.classList.add(`status-${type}`);
        }
    },
};