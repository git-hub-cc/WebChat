/**
 * @file LayoutUIManager.js
 * @description 布局管理器，负责处理应用的响应式 UI 布局。
 *              它根据窗口大小（移动端 vs. 桌面端）动态调整主要区域（如侧边栏和聊天区）的显示和隐藏。
 *              MODIFIED: 在应用主容器上禁用了默认右键菜单，以支持自定义上下文菜单。
 * @module LayoutManager
 * @exports {object} LayoutUIManager - 对外暴露的单例对象，包含布局管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定 resize 事件。
 * @property {function} showChatListArea - 在移动端视图下，显示聊天列表区域并隐藏聊天区域。
 * @property {function} showChatAreaLayout - 在移动端视图下，显示聊天区域并隐藏聊天列表。
 * @property {function} updateConnectionStatusIndicator - 更新全局连接状态指示器的文本和样式。
 * @dependencies DetailsPanelUIManager
 * @dependents AppInitializer (进行初始化), ChatAreaUIManager (打开聊天时调用), ChatManager (返回列表时调用)
 */
const LayoutUIManager = {
    appContainer: null, // 应用主容器
    sidebarNav: null,   // 侧边栏导航
    chatAreaEl: null,   // 主聊天区域
    backToListBtn: null, // "返回列表"按钮 (移动端)

    /**
     * 初始化布局管理器，获取关键的布局元素并监听窗口尺寸变化。
     */
    init: function() {
        this.appContainer = document.querySelector('.app-container');
        this.sidebarNav = document.getElementById('sidebarNav');
        this.chatAreaEl = document.getElementById('chatArea');
        this.backToListBtn = document.getElementById('backToListBtn');

        this.updateResponsiveUI(); // 初始加载时检查一次布局
        window.addEventListener('resize', this.updateResponsiveUI.bind(this)); // 监听窗口大小变化

        if (this.backToListBtn) { // 绑定返回按钮事件
            this.backToListBtn.addEventListener('click', () => this.showChatListArea());
        }

        // MODIFIED: 在应用容器级别禁用默认右键菜单
        if (this.appContainer) {
            this.appContainer.addEventListener('contextmenu', event => {
                // 允许在输入框、文本区域内使用原生右键菜单（用于复制粘贴等）
                const target = event.target;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                    return;
                }
                event.preventDefault();
            });
        }
    },

    /**
     * 根据窗口宽度更新 UI 布局，切换移动端/桌面端视图。
     */
    updateResponsiveUI: function () {
        if (!this.appContainer) return; // 防御性检查

        if (window.innerWidth <= 768) { // 如果是移动端宽度
            this.appContainer.classList.add('mobile-view'); // 添加移动端视图类
            // 在移动端，如果当前不是聊天视图，则默认显示聊天列表
            if (!this.appContainer.classList.contains('chat-view-active')) {
                this.showChatListArea();
            }
        } else { // 如果是桌面端宽度
            // 移除移动端特定类，并确保侧边栏和聊天区都可见
            this.appContainer.classList.remove('mobile-view', 'chat-view-active');
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex'; // 显示侧边栏
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'flex'; // 显示聊天区
        }
    },

    /**
     * 切换到聊天列表视图（主要用于移动端）。
     */
    showChatListArea: function () {
        if (this.appContainer && this.appContainer.classList.contains('mobile-view')) { // 仅在移动端视图下操作
            this.appContainer.classList.remove('chat-view-active'); // 移除聊天视图激活类
            if (this.sidebarNav) this.sidebarNav.style.display = 'flex'; // 显示侧边栏
            if (this.chatAreaEl) this.chatAreaEl.style.display = 'none'; // 隐藏聊天区
        }
        // 当返回到聊天列表时，如果详情面板是打开的，则应将其关闭
        if (typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isPanelAreaVisible) {
            DetailsPanelUIManager.hideSidePanel(); // 隐藏详情面板
        }
    },

    /**
     * 切换到主聊天区域视图（主要用于移动端）。
     */
    showChatAreaLayout: function () {
        if (!this.appContainer || !this.chatAreaEl) return; // 防御性检查

        if (this.appContainer.classList.contains('mobile-view')) { // 仅在移动端视图下操作
            this.appContainer.classList.add('chat-view-active'); // 添加聊天视图激活类
            if (this.sidebarNav) this.sidebarNav.style.display = 'none'; // 隐藏侧边栏
            this.chatAreaEl.style.display = 'flex'; // 显示聊天区
        } else { // 在桌面视图下，确保聊天区域总是可见的
            this.chatAreaEl.style.display = 'flex';
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