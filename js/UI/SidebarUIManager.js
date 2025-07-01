/**
 * @file SidebarUIManager.js
 * @description 侧边栏 UI 管理器，负责管理应用左侧边栏内的所有 UI 元素和交互。
 *              包括顶部的标签页（全部、联系人、群组）、搜索框，以及更新聊天列表项的状态（如在线状态）。
 *              REFACTORED: (第2阶段) 现在订阅 Store 来自动更新当前活动聊天项的高亮状态和标签页状态。
 * @module SidebarUIManager
 * @exports {object} SidebarUIManager - 对外暴露的单例对象，包含管理侧边栏 UI 的方法。
 * @dependencies ChatManager, UserManager, GroupManager, Store
 * @dependents AppInitializer (进行初始化), ChatManager (设置活动标签)
 */
const SidebarUIManager = {
    chatSearchInputEl: null, // 聊天搜索输入框
    tabAllChatsEl: null,     // “全部”标签页
    tabContactsEl: null,   // “联系人”标签页
    tabGroupsEl: null,     // “群组”标签页
    chatListEl: null,      // 聊天列表的 <ul> 元素

    _currentChatId: null, // 内部状态，用于比较变化
    _currentActiveTab: 'all', // 内部状态，用于比较变化
    _currentContactStatuses: {}, // 内部状态，用于比较变化

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     * REFACTORED: 新增了对 Store 的订阅。
     */
    init: function() {
        this.chatSearchInputEl = document.getElementById('chatSearchInput');
        this.tabAllChatsEl = document.getElementById('tabAllChats');
        this.tabContactsEl = document.getElementById('tabContacts');
        this.tabGroupsEl = document.getElementById('tabGroups');
        this.chatListEl = document.getElementById('chatListNav');

        this.bindEvents(); // 绑定事件

        if (typeof Store !== 'undefined') {
            Store.subscribe(this.handleStateChange.bind(this));
        } else {
            Utils.log("SidebarUIManager: Store 未定义，无法订阅状态变化。", Utils.logLevels.ERROR);
        }
    },

    /**
     * REFACTORED (Phase 2): 处理从 Store 传来的状态变化。
     * @param {object} newState - 最新的应用状态。
     */
    handleStateChange: function(newState) {
        // 更新活动聊天项
        if (newState.currentChatId !== this._currentChatId) {
            this._currentChatId = newState.currentChatId;
            this._updateActiveListItem(this._currentChatId);
        }

        // 更新活动标签页
        if (newState.activeSidebarTab !== this._currentActiveTab) {
            this._currentActiveTab = newState.activeSidebarTab;
            this._updateActiveTab(this._currentActiveTab);
        }

        // 更新联系人在线状态
        if (JSON.stringify(newState.contactStatuses) !== JSON.stringify(this._currentContactStatuses)) {
            this._currentContactStatuses = { ...newState.contactStatuses };
            this._updateAllContactStatuses(this._currentContactStatuses);
        }
    },

    /**
     * @private
     * 根据传入的 chatId 更新聊天列表中的高亮项。
     * @param {string|null} chatId - 要高亮的聊天项的 ID。
     */
    _updateActiveListItem: function(chatId) {
        if (!this.chatListEl) return;

        const currentActiveItem = this.chatListEl.querySelector('.chat-list-item.active');
        if (currentActiveItem) {
            currentActiveItem.classList.remove('active');
        }

        if (chatId) {
            const newActiveItem = this.chatListEl.querySelector(`.chat-list-item[data-id="${chatId}"]`);
            if (newActiveItem) {
                newActiveItem.classList.add('active');
            }
        }
    },

    /**
     * @private
     * REFACTORED (Phase 2): 根据传入的 tabName 更新标签页的高亮状态。
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
     * @private
     * REFACTORED (Phase 2): 根据状态对象批量更新所有联系人的状态指示灯。
     * @param {object} statuses - { contactId: 'online' | 'offline' | 'connected' }
     */
    _updateAllContactStatuses: function(statuses) {
        if (!this.chatListEl) return;
        Object.keys(statuses).forEach(contactId => {
            const itemEl = this.chatListEl.querySelector(`.chat-list-item[data-id="${contactId}"]`);
            if (itemEl && itemEl.dataset.type === 'contact' && !UserManager.isSpecialContact(contactId)) {
                const nameEl = itemEl.querySelector('.chat-list-name');
                if (nameEl) {
                    let onlineDot = nameEl.querySelector('.online-dot');
                    const isConnected = statuses[contactId] === 'connected';
                    if (isConnected) {
                        if (!onlineDot) {
                            onlineDot = document.createElement('span');
                            onlineDot.className = 'online-dot';
                            onlineDot.title = "已连接";
                            nameEl.appendChild(onlineDot);
                        }
                        onlineDot.style.display = 'inline-block';
                    } else {
                        if (onlineDot) onlineDot.style.display = 'none';
                    }
                }
            }
        });
    },

    /**
     * 绑定侧边栏内的 UI 事件监听器。
     */
    bindEvents: function() {
        // REFACTORED (Phase 2): 标签页点击现在分发 Action 到 Store
        if (this.tabAllChatsEl) this.tabAllChatsEl.addEventListener('click', () => {
            Store.dispatch('SET_ACTIVE_TAB', { tab: 'all' });
            ChatManager.renderChatList('all');
        });
        if (this.tabContactsEl) this.tabContactsEl.addEventListener('click', () => {
            Store.dispatch('SET_ACTIVE_TAB', { tab: 'contacts' });
            UserManager.renderContactListForSidebar();
        });
        if (this.tabGroupsEl) this.tabGroupsEl.addEventListener('click', () => {
            Store.dispatch('SET_ACTIVE_TAB', { tab: 'groups' });
            GroupManager.renderGroupListForSidebar();
        });

        if (this.chatSearchInputEl) this.chatSearchInputEl.addEventListener('input', (e) => this.filterChatList(e.target.value));
    },

    /**
     * 根据搜索查询触发聊天列表的筛选。
     * 实际的筛选逻辑由 ChatManager.renderChatList 处理。
     * @param {string} query - 搜索框中的查询字符串。
     */
    filterChatList: function (query) {
        ChatManager.renderChatList(ChatManager.currentFilter);
    },
};