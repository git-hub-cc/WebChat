/**
 * @file LayoutUIManager.js
 * @description 布局管理器，负责处理应用的响应式 UI 布局。
 *              它根据窗口大小（移动端 vs. 桌面端）动态调整主要区域（如侧边栏和聊天区）的显示和隐藏。
 *              REFACTORED: (第2阶段) 不再有公开的 showChatArea/showChatListArea 方法，而是订阅 Store 并根据 state 自动更新布局。
 *              REFACTORED (Phase 1): 事件监听器现在调用 ActionCreators.js 中的函数，而不是直接 dispatch action。（本文件在此阶段无此类变更）
 * @module LayoutManager
 * @exports {object} LayoutUIManager - 对外暴露的单例对象，包含布局管理方法。
 * @dependencies DetailsPanelUIManager, Store
 * @dependents AppInitializer (进行初始化)
 */
const LayoutUIManager = {
    appContainer: null, // 应用主容器
    sidebarNav: null,   // 侧边栏导航
    chatAreaEl: null,   // 主聊天区域
    backToListBtn: null, // "返回列表"按钮 (移动端)

    /**
     * 初始化布局管理器，获取关键的布局元素并监听窗口尺寸变化。
     * REFACTORED: 新增了对 Store 的订阅。
     */
    init: function() {
        this.appContainer = document.querySelector('.app-container');
        this.sidebarNav = document.getElementById('sidebarNav');
        this.chatAreaEl = document.getElementById('chatArea');
        this.backToListBtn = document.getElementById('backToListBtn');

        this.updateResponsiveUI(); // 初始加载时检查一次布局
        window.addEventListener('resize', this.updateResponsiveUI.bind(this)); // 监听窗口大小变化

        if (this.backToListBtn) {
            // REFACTORED: 点击返回按钮时，分发一个 Action 到 Store
            this.backToListBtn.addEventListener('click', () => {
                Store.dispatch('SHOW_CHAT_LIST');
            });
        }

        // REFACTORED: 订阅 Store 的状态变化
        Store.subscribe(this.handleStateChange.bind(this));
    },

    /**
     * REFACTORED: 新增方法，用于处理从 Store 传来的状态变化。
     * @param {object} newState - 最新的应用状态。
     */
    handleStateChange: function(newState) {
        // 更新连接状态指示器
        if (newState.connectionStatusText) {
            this.updateConnectionStatusIndicator(newState.connectionStatusText, newState.isWebSocketConnected ? 'success' : 'error');
        }

        // 根据 isChatAreaVisible 状态更新移动端布局
        if (this.appContainer && this.appContainer.classList.contains('mobile-view')) {
            if (newState.isChatAreaVisible) {
                this.appContainer.classList.add('chat-view-active');
                if (this.sidebarNav) this.sidebarNav.style.display = 'none';
                if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex';
            } else {
                this.appContainer.classList.remove('chat-view-active');
                if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
                if (this.chatAreaEl) this.chatAreaEl.style.display = 'none';
            }
        }
    },


    /**
     * 根据窗口宽度更新 UI 布局，切换移动端/桌面端视图。
     */
    updateResponsiveUI: function () {
        if (!this.appContainer) return; // 防御性检查

        if (window.innerWidth <= 768) { // 如果是移动端宽度
            this.appContainer.classList.add('mobile-view'); // 添加移动端视图类
            // REFACTORED: 移动端视图的显隐逻辑现在由 handleStateChange 驱动，
            // 这里只需确保在进入移动端视图时，UI与当前Store状态一致。
            const currentState = Store.getState();
            this.handleStateChange(currentState);
        } else { // 如果是桌面端宽度
            // 移除移动端特定类，并确保侧边栏和聊天区都可见
            this.appContainer.classList.remove('mobile-view', 'chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex'; // 显示侧边栏
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex'; // 显示聊天区
        }
    },


    /**
     * 更新全局连接状态指示器的文本和样式。
     * @param {string} message - 要显示的状态消息。
     * @param {string} [type='info'] - 状态类型 ('info', 'success', 'warning', 'error')，用于应用不同样式。
     */
    updateConnectionStatusIndicator: function (message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText'); // 获取状态文本元素
        const statusContainerEl = document.getElementById('connectionStatusGlobal'); // 获取状态容器元素
        if (statusTextEl) statusTextEl.textContent = message; // 更新文本
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator global'; // 重置类名
            if (type !== 'info') statusContainerEl.classList.add(`status-${type}`); // 根据类型添加特定样式类
        }
    },
};