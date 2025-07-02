/**
 * @file SidebarUIManager.js
 * @description 侧边栏 UI 管理器，负责管理应用左侧边栏内的所有 UI 元素和交互。
 *              包括顶部的标签页（全部、联系人、群组）、搜索框，以及更新聊天列表项的状态（如在线状态）。
 *              REFACTORED: (第2阶段) 现在订阅 Store 来自动更新当前活动聊天项的高亮状态和标签页状态。
 *              REFACTORED (Phase 3): 完全移除了命令式的渲染方法（如 renderChatList），现在完全由 Store 的状态驱动。
 * @module SidebarUIManager
 * @exports {object} SidebarUIManager - 对外暴露的单例对象，包含管理侧边栏 UI 的方法。
 * @dependencies Store, Utils
 * @dependents AppInitializer (进行初始化)
 */
const SidebarUIManager = {
    chatSearchInputEl: null,
    tabAllChatsEl: null,
    tabContactsEl: null,
    tabGroupsEl: null,
    chatListEl: null,

    // 内部状态，用于比较变化，减少不必要的DOM操作
    _currentChatId: null,
    _currentActiveTab: 'all',
    _currentListItems: [],

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function() {
        this.chatSearchInputEl = document.getElementById('chatSearchInput');
        this.tabAllChatsEl = document.getElementById('tabAllChats');
        this.tabContactsEl = document.getElementById('tabContacts');
        this.tabGroupsEl = document.getElementById('tabGroups');
        this.chatListEl = document.getElementById('chatListNav');

        this.bindEvents();

        if (typeof Store !== 'undefined') {
            Store.subscribe(this.handleStateChange.bind(this));
        } else {
            Utils.log("SidebarUIManager: Store 未定义，无法订阅状态变化。", Utils.logLevels.ERROR);
        }
    },

    /**
     * REFACTORED (Phase 3): 处理从 Store 传来的状态变化，根据新状态重新渲染整个侧边栏。
     * @param {object} newState - 最新的应用状态。
     * @param {object} oldState - 变化前的应用状态。
     */
    handleStateChange: function(newState, oldState) {
        // 检查侧边栏相关状态是否发生变化
        if (
            newState.sidebar.activeTab !== oldState.sidebar.activeTab ||
            newState.sidebar.searchQuery !== oldState.sidebar.searchQuery ||
            newState.sidebar.listItems !== oldState.sidebar.listItems || // 比较引用
            newState.currentChatId !== oldState.currentChatId // 当前聊天变化也需要重绘高亮项
        ) {
            this._currentChatId = newState.currentChatId;
            this._currentActiveTab = newState.sidebar.activeTab;
            this._currentListItems = newState.sidebar.listItems;

            this._updateActiveTab(this._currentActiveTab);
            this._renderList(this._currentListItems);
        }
    },

    /**
     * @private
     * 根据传入的 tabName 更新标签页的高亮状态。
     * @param {string} tabName - 'all', 'contacts', 'groups'
     */
    _updateActiveTab: function(tabName) {
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));
        let targetTabId = '';
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active');
    },

    /**
     * REFACTORED (Phase 3): 新增的私有渲染方法，完全基于传入的列表项数据。
     * @param {Array<object>} itemsToRender - 从 Store 获取的待渲染项数组。
     */
    _renderList: function(itemsToRender) {
        if (!this.chatListEl) return;
        this.chatListEl.innerHTML = '';

        if (itemsToRender.length === 0) {
            const filterText = { all: '聊天', contacts: '联系人', groups: '群组' }[this._currentActiveTab] || '项目';
            this.chatListEl.innerHTML = `<li class="chat-list-item-empty">未找到${filterText}。</li>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        const template = document.getElementById('chat-list-item-template').content;

        itemsToRender.forEach(item => {
            const clone = template.cloneNode(true);
            const li = clone.querySelector('.chat-list-item');
            const avatarEl = clone.querySelector('.chat-list-avatar');
            const nameTextEl = clone.querySelector('.name-text');
            const onlineDotEl = clone.querySelector('.online-dot');
            const previewEl = clone.querySelector('.chat-list-preview');
            const timeEl = clone.querySelector('.chat-list-time');
            const badgeEl = clone.querySelector('.chat-list-badge');

            li.dataset.id = item.id;
            li.dataset.type = item.type;
            if (item.id === this._currentChatId) li.classList.add('active'); // 使用内部缓存的 currentChatId
            if (item.type === 'group') li.classList.add('group');
            if (item.isSpecial) li.classList.add('special-contact', item.id);
            if (item.isSpecial) avatarEl.classList.add(item.id);

            nameTextEl.textContent = item.name;
            previewEl.textContent = item.lastMessage;
            timeEl.textContent = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';

            const fallbackText = (item.avatarText) ? Utils.escapeHtml(item.avatarText) : (item.name ? Utils.escapeHtml(item.name.charAt(0).toUpperCase()) : '?');
            if (item.avatarUrl) {
                const img = document.createElement('img');
                img.src = item.avatarUrl;
                img.alt = fallbackText;
                img.className = 'avatar-image';
                img.dataset.fallbackText = fallbackText;
                img.dataset.entityId = item.id;
                img.loading = "lazy";
                avatarEl.appendChild(img);
            } else {
                avatarEl.textContent = fallbackText;
            }

            if (item.type === 'contact' && item.online && !(item.isSpecial && UserManager.contacts[item.id]?.isAI)) {
                onlineDotEl.style.display = 'inline-block';
            } else {
                onlineDotEl.style.display = 'none';
            }

            if (item.unread > 0) {
                badgeEl.textContent = item.unread > 99 ? '99+' : item.unread;
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }

            // REFACTORED (Phase 3): 点击列表项时，只负责 dispatch action。
            li.addEventListener('click', () => {
                ChatManager.openChat(item.id); // ChatManager.openChat 内部也只 dispatch
            });
            fragment.appendChild(li);
        });

        this.chatListEl.appendChild(fragment);
    },

    /**
     * REFACTORED (Phase 3): 事件监听器现在只 dispatch action 来更新 Store 中的过滤器状态。
     */
    bindEvents: function() {
        if (this.tabAllChatsEl) this.tabAllChatsEl.addEventListener('click', () => {
            Store.dispatch('SET_SIDEBAR_FILTER', { tab: 'all' });
        });
        if (this.tabContactsEl) this.tabContactsEl.addEventListener('click', () => {
            Store.dispatch('SET_SIDEBAR_FILTER', { tab: 'contacts' });
        });
        if (this.tabGroupsEl) this.tabGroupsEl.addEventListener('click', () => {
            Store.dispatch('SET_SIDEBAR_FILTER', { tab: 'groups' });
        });

        if (this.chatSearchInputEl) {
            this.chatSearchInputEl.addEventListener('input', (e) => {
                Store.dispatch('SET_SIDEBAR_FILTER', { query: e.target.value });
            });
        }
    },
};