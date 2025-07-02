/**
 * @file 侧边栏 UI 管理器
 * @description 负责管理应用左侧边栏内的所有 UI 元素和交互，包括标签页切换、搜索和聊天列表的渲染。
 *              该模块已重构为完全由中心化状态（Store）驱动，它订阅 Store 的变化，并根据最新的状态数据重新渲染整个侧边栏，
 *              而不是通过命令式方法手动更新 DOM。
 * @module SidebarUIManager
 * @exports {object} SidebarUIManager - 对外暴露的单例对象，包含管理侧边栏 UI 的方法。
 * @dependency Store, Utils, ChatManager, UserManager
 */
const SidebarUIManager = {
    // DOM 元素引用
    chatSearchInputEl: null,
    tabAllChatsEl: null,
    tabContactsEl: null,
    tabGroupsEl: null,
    chatListEl: null,

    // 内部状态缓存，用于与新状态进行比较，以确定是否需要重新渲染
    _currentChatId: null,
    _currentActiveTab: 'all',
    _currentListItems: [],

    /**
     * 初始化模块。
     * @description 获取所有需要的 DOM 元素引用，绑定事件监听器，并订阅 Store 的状态变化。
     * @function init
     */
    init: function() {
        this.chatSearchInputEl = document.getElementById('chatSearchInput');
        this.tabAllChatsEl = document.getElementById('tabAllChats');
        this.tabContactsEl = document.getElementById('tabContacts');
        this.tabGroupsEl = document.getElementById('tabGroups');
        this.chatListEl = document.getElementById('chatListNav');

        this.bindEvents();

        // 订阅 Store，当状态变化时调用 handleStateChange 方法
        if (typeof Store !== 'undefined') {
            Store.subscribe(this.handleStateChange.bind(this));
        } else {
            Utils.log("SidebarUIManager: Store 未定义，无法订阅状态变化。", Utils.logLevels.ERROR);
        }
    },

    /**
     * 处理从 Store 传来的状态变化。
     * @description 这是 Store 的订阅回调函数。它会比较新旧状态中与侧边栏相关的部分，
     *              如果发生变化，则触发侧边栏的重新渲染。
     * @function handleStateChange
     * @param {object} newState - 最新的应用状态。
     * @param {object} oldState - 变化前的应用状态。
     */
    handleStateChange: function(newState, oldState) {
        // 检查侧边栏相关状态是否发生变化
        // 1. 检查活动标签页、搜索词或列表项数组引用是否改变
        // 2. 检查当前聊天 ID 是否改变（用于更新高亮项）
        if (
            newState.sidebar.activeTab !== oldState.sidebar.activeTab ||
            newState.sidebar.searchQuery !== oldState.sidebar.searchQuery ||
            newState.sidebar.listItems !== oldState.sidebar.listItems ||
            newState.currentChatId !== oldState.currentChatId
        ) {
            // 更新内部缓存的状态
            this._currentChatId = newState.currentChatId;
            this._currentActiveTab = newState.sidebar.activeTab;
            this._currentListItems = newState.sidebar.listItems;

            // 根据新状态更新 UI
            this._updateActiveTab(this._currentActiveTab);
            this._renderList(this._currentListItems);
        }
    },

    /**
     * (内部) 根据传入的 tabName 更新标签页的激活（高亮）状态。
     * @private
     * @function _updateActiveTab
     * @param {string} tabName - 要激活的标签页名称 ('all', 'contacts', 'groups')。
     */
    _updateActiveTab: function(tabName) {
        // 移除所有标签的 active 类
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));

        // 确定目标标签页的 ID
        let targetTabId = '';
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        // 为目标标签页添加 active 类
        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active');
    },

    /**
     * (内部) 基于传入的数据渲染整个聊天列表。
     * @description 这是侧边栏的核心渲染函数，它完全基于 Store 提供的 `itemsToRender` 数组来构建 DOM，
     *              实现了 UI 和数据的分离。
     * @private
     * @function _renderList
     * @param {Array<object>} itemsToRender - 从 Store 获取的、经过过滤和排序的待渲染项数组。
     */
    _renderList: function(itemsToRender) {
        if (!this.chatListEl) return;
        this.chatListEl.innerHTML = ''; // 清空现有列表，准备重新渲染

        // 如果列表为空，显示提示信息
        if (itemsToRender.length === 0) {
            const filterText = { all: '聊天', contacts: '联系人', groups: '群组' }[this._currentActiveTab] || '项目';
            this.chatListEl.innerHTML = `<li class="chat-list-item-empty">未找到${filterText}。</li>`;
            return;
        }

        const fragment = document.createDocumentFragment(); // 使用文档片段以提高性能
        const template = document.getElementById('chat-list-item-template').content; // 获取列表项模板

        itemsToRender.forEach(item => {
            const clone = template.cloneNode(true); // 克隆模板

            // 获取模板中的各个元素
            const li = clone.querySelector('.chat-list-item');
            const avatarEl = clone.querySelector('.chat-list-avatar');
            const nameTextEl = clone.querySelector('.name-text');
            const onlineDotEl = clone.querySelector('.online-dot');
            const previewEl = clone.querySelector('.chat-list-preview');
            const timeEl = clone.querySelector('.chat-list-time');
            const badgeEl = clone.querySelector('.chat-list-badge');

            // 填充数据
            li.dataset.id = item.id;
            li.dataset.type = item.type;
            if (item.id === this._currentChatId) li.classList.add('active'); // 高亮当前聊天项
            if (item.type === 'group') li.classList.add('group');
            if (item.isSpecial) li.classList.add('special-contact', item.id);
            if (item.isSpecial) avatarEl.classList.add(item.id);

            nameTextEl.textContent = item.name;
            previewEl.textContent = item.lastMessage;
            timeEl.textContent = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';

            // 设置头像（图片或回退文本）
            const fallbackText = (item.avatarText) ? Utils.escapeHtml(item.avatarText) : (item.name ? Utils.escapeHtml(item.name.charAt(0).toUpperCase()) : '?');
            if (item.avatarUrl) {
                const img = document.createElement('img');
                img.src = item.avatarUrl;
                img.alt = fallbackText;
                img.className = 'avatar-image';
                img.dataset.fallbackText = fallbackText;
                img.dataset.entityId = item.id;
                img.loading = "lazy"; // 启用图片懒加载
                avatarEl.appendChild(img);
            } else {
                avatarEl.textContent = fallbackText;
            }

            // 设置在线状态指示器
            if (item.type === 'contact' && item.online && !(item.isSpecial && UserManager.contacts[item.id]?.isAI)) {
                onlineDotEl.style.display = 'inline-block';
            } else {
                onlineDotEl.style.display = 'none';
            }

            // 设置未读消息角标
            if (item.unread > 0) {
                badgeEl.textContent = item.unread > 99 ? '99+' : item.unread;
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }

            // 绑定点击事件，用于打开聊天
            // NOTE: 此处不再直接操作 UI，而是调用 ChatManager 的方法，该方法会 dispatch action。
            li.addEventListener('click', () => {
                ChatManager.openChat(item.id);
            });
            fragment.appendChild(li);
        });

        this.chatListEl.appendChild(fragment); // 将构建好的列表一次性插入 DOM
    },

    /**
     * 绑定侧边栏的静态事件监听器。
     * @description 这些监听器仅负责 dispatch action 来更新 Store 中的过滤器状态，UI 的更新由 `handleStateChange` 统一处理。
     * @function bindEvents
     */
    bindEvents: function() {
        // 标签页点击事件：dispatch action 更新激活的标签页
        if (this.tabAllChatsEl) this.tabAllChatsEl.addEventListener('click', () => {
            Store.dispatch('SET_SIDEBAR_FILTER', { tab: 'all' });
        });
        if (this.tabContactsEl) this.tabContactsEl.addEventListener('click', () => {
            Store.dispatch('SET_SIDEBAR_FILTER', { tab: 'contacts' });
        });
        if (this.tabGroupsEl) this.tabGroupsEl.addEventListener('click', () => {
            Store.dispatch('SET_SIDEBAR_FILTER', { tab: 'groups' });
        });

        // 搜索框输入事件：dispatch action 更新搜索关键词
        if (this.chatSearchInputEl) {
            this.chatSearchInputEl.addEventListener('input', (e) => {
                Store.dispatch('SET_SIDEBAR_FILTER', { query: e.target.value });
            });
        }
    },
};