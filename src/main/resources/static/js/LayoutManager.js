/**
 * @file LayoutManager.js
 * @description 布局管理器，负责处理应用的响应式 UI 布局。
 *              它根据窗口大小（移动端 vs. 桌面端）动态调整主要区域（如侧边栏和聊天区）的显示和隐藏。
 * @module LayoutManager
 * @exports {object} LayoutManager - 对外暴露的单例对象，包含布局管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定 resize 事件。
 * @property {function} showChatListArea - 在移动端视图下，显示聊天列表区域并隐藏聊天区域。
 * @property {function} showChatAreaLayout - 在移动端视图下，显示聊天区域并隐藏聊天列表。
 * @property {function} updateConnectionStatusIndicator - 更新全局连接状态指示器的文本和样式。
 * @dependencies DetailsPanelUIManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (打开聊天时调用), ChatManager (返回列表时调用)
 */
const LayoutManager = {
    appContainer: null,
    sidebarNav: null,
    chatAreaEl: null,
    backToListBtn: null,

    /**
     * 初始化布局管理器，获取关键的布局元素并监听窗口尺寸变化。
     */
    init: function() {
        this.appContainer = document.querySelector('.app-container');
        this.sidebarNav = document.getElementById('sidebarNav');
        this.chatAreaEl = document.getElementById('chatArea');
        this.backToListBtn = document.getElementById('backToListBtn');

        this.updateResponsiveUI(); // 初始加载时检查一次
        window.addEventListener('resize', this.updateResponsiveUI.bind(this));

        if (this.backToListBtn) {
            this.backToListBtn.addEventListener('click', () => this.showChatListArea());
        }
    },

    /**
     * 根据窗口宽度更新 UI 布局，切换移动端/桌面端视图。
     */
    updateResponsiveUI: function () {
        if (!this.appContainer) return;

        if (window.innerWidth <= 768) {
            this.appContainer.classList.add('mobile-view');
            // 在移动端，如果当前不是聊天视图，则默认显示聊天列表
            if (!this.appContainer.classList.contains('chat-view-active')) {
                this.showChatListArea();
            }
        } else {
            // 在桌面端，移除移动端特定类，并确保侧边栏和聊天区都可见
            this.appContainer.classList.remove('mobile-view', 'chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex';
        }
    },

    /**
     * 切换到聊天列表视图（主要用于移动端）。
     */
    showChatListArea: function () {
        if (this.appContainer && this.appContainer.classList.contains('mobile-view')) {
            this.appContainer.classList.remove('chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'none';
        }
        // 当返回到聊天列表时，如果详情面板是打开的，则应将其关闭
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isDetailsPanelVisible) {
            DetailsPanelUIManager.toggleDetailsPanel(false);
        }
    },

    /**
     * 切换到主聊天区域视图（主要用于移动端）。
     */
    showChatAreaLayout: function () {
        if (!this.appContainer || !this.chatAreaEl) return;

        if (this.appContainer.classList.contains('mobile-view')) {
            this.appContainer.classList.add('chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'none';
            this.chatAreaEl.style.display = 'flex';
        } else {
            // 在桌面视图下，确保聊天区域总是可见的
            this.chatAreaEl.style.display = 'flex';
        }
    },

    /**
     * 更新全局连接状态指示器的文本和样式。
     * @param {string} message - 要显示的状态消息。
     * @param {string} [type='info'] - 状态类型 ('info', 'success', 'warning', 'error')，用于应用不同样式。
     */
    updateConnectionStatusIndicator: function (message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');
        if (statusTextEl) statusTextEl.textContent = message;
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator global'; // 重置类名
            if (type !== 'info') statusContainerEl.classList.add(`status-${type}`);
        }
    },
};