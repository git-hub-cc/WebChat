/**
 * @file 布局 UI 管理器
 * @description 负责应用的响应式 UI 布局。它会根据窗口尺寸（移动端 vs. 桌面端）动态调整核心区域（如侧边栏和聊天区）的显示与隐藏。
 *              该模块通过订阅 Store 的状态变化，以响应式的方式自动更新布局，取代了旧有的命令式 show/hide 方法。
 * @module LayoutManager
 * @exports {object} LayoutUIManager - 导出的布局管理器单例对象。
 * @dependency Store, DetailsPanelUIManager
 */
const LayoutUIManager = {
    // 应用最外层容器的 DOM 引用
    appContainer: null,
    // 侧边栏导航区域的 DOM 引用
    sidebarNav: null,
    // 主聊天区域的 DOM 引用
    chatAreaEl: null,
    // 移动端视图下的“返回列表”按钮的 DOM 引用
    backToListBtn: null,

    /**
     * 初始化布局管理器
     * @function init
     * @description 获取关键 DOM 元素的引用，设置事件监听器以响应窗口尺寸变化，并订阅 Store 的状态更新。
     * @returns {void} 无返回值
     */
    init: function() {
        // 1. 缓存核心 DOM 元素
        this.appContainer = document.querySelector('.app-container');
        this.sidebarNav = document.getElementById('sidebarNav');
        this.chatAreaEl = document.getElementById('chatArea');
        this.backToListBtn = document.getElementById('backToListBtn');

        // 2. 初始化时执行一次响应式布局检查
        this.updateResponsiveUI();
        // 3. 监听窗口尺寸变化事件，动态调整布局
        window.addEventListener('resize', this.updateResponsiveUI.bind(this));

        if (this.backToListBtn) {
            // NOTE: 为移动端的返回按钮添加点击事件，直接向 Store 分发 Action 来改变状态
            this.backToListBtn.addEventListener('click', () => {
                Store.dispatch('SHOW_CHAT_LIST');
            });
        }

        // 4. 订阅 Store 的状态变更，当状态变化时调用 handleStateChange 方法
        Store.subscribe(this.handleStateChange.bind(this));
    },

    /**
     * 处理 Store 状态变更的回调函数
     * @function handleStateChange
     * @description 根据从 Store 接收到的最新状态，更新相关的 UI 部分。
     * @param {object} newState - 最新的应用状态对象。
     * @returns {void} 无返回值
     */
    handleStateChange: function(newState) {
        // 处理流程如下：
        // 1. 如果存在连接状态信息，则更新顶部的连接状态指示器
        if (newState.connectionStatusText) {
            this.updateConnectionStatusIndicator(newState.connectionStatusText, newState.isWebSocketConnected ? 'success' : 'error');
        }

        // 2. 如果当前是移动端视图，则根据 isChatAreaVisible 状态来切换布局
        if (this.appContainer && this.appContainer.classList.contains('mobile-view')) {
            if (newState.isChatAreaVisible) {
                // 显示聊天区，隐藏侧边栏列表
                this.appContainer.classList.add('chat-view-active');
                if (this.sidebarNav) this.sidebarNav.style.display = 'none';
                if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex';
            } else {
                // 显示侧边栏列表，隐藏聊天区
                this.appContainer.classList.remove('chat-view-active');
                if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
                if (this.chatAreaEl) this.chatAreaEl.style.display = 'none';
            }
        }
    },


    /**
     * 根据窗口宽度更新 UI，切换移动端与桌面端视图
     * @function updateResponsiveUI
     * @description 检查当前窗口宽度，并据此添加或移除 'mobile-view' 类，以应用不同的布局样式。
     * @returns {void} 无返回值
     */
    updateResponsiveUI: function () {
        // 防御性编程：确保容器元素存在
        if (!this.appContainer) return;

        // 判断逻辑如下：
        // 1. 如果窗口宽度小于等于 768px，则判定为移动端视图
        if (window.innerWidth <= 768) {
            this.appContainer.classList.add('mobile-view');
            // NOTE: 在切换到移动端视图时，立即使用 Store 中的当前状态来同步 UI，
            // 确保布局（例如聊天区是否可见）与应用状态保持一致。
            const currentState = Store.getState();
            this.handleStateChange(currentState);
        } else {
            // 2. 否则，判定为桌面端视图
            // 移除移动端相关的类名，并将侧边栏和聊天区恢复为默认显示状态
            this.appContainer.classList.remove('mobile-view', 'chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex';
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex';
        }
    },


    /**
     * 更新全局连接状态指示器的文本和样式
     * @function updateConnectionStatusIndicator
     * @param {string} message - 需要显示的状态消息文本。
     * @param {string} [type='info'] - 状态类型，可选值为 'info', 'success', 'warning', 'error'，用于应用不同的 CSS 样式。
     * @returns {void} 无返回值
     */
    updateConnectionStatusIndicator: function (message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');

        // 更新状态文本
        if (statusTextEl) statusTextEl.textContent = message;

        // 更新状态容器的样式
        if (statusContainerEl) {
            // a. 先重置为基础样式类
            statusContainerEl.className = 'status-indicator global';
            // b. 如果类型不是默认的 'info'，则添加对应的状态样式类（如 'status-success'）
            if (type !== 'info') statusContainerEl.classList.add(`status-${type}`);
        }
    },
};