// 新文件: LayoutManager.js (已翻译)
// 职责:
// - 管理响应式 UI 布局（移动端 vs. 桌面端）。
// - 在移动端视图下显示/隐藏主要应用区域（侧边栏、聊天区）。
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

        this.updateResponsiveUI(); // 初始检查
        window.addEventListener('resize', this.updateResponsiveUI.bind(this));

        if (this.backToListBtn) {
            this.backToListBtn.addEventListener('click', () => this.showChatListArea());
        }
    },

    updateResponsiveUI: function () {
        if (!this.appContainer) return;

        if (window.innerWidth <= 768) {
            this.appContainer.classList.add('mobile-view');
            // 如果在移动端未处于活动聊天视图，则显示聊天列表
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
        // 当显示聊天列表时，如果详情面板可见，则应将其隐藏
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible) {
            DetailsPanelUIManager.toggleDetailsPanel(false);
        }
    },

    showChatAreaLayout: function () { // 已重命名以避免与 ChatAreaUIManager 的 showChatArea 冲突
        if (!this.appContainer || !this.chatAreaEl) return;

        if (this.appContainer.classList.contains('mobile-view')) {
            this.appContainer.classList.add('chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'none';
            this.chatAreaEl.style.display = 'flex';
        } else {
            // 桌面视图下，确保聊天区域可见（如果之前被隐藏）
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