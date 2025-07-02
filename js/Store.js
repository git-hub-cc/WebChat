/**
 * @file Store.js
 * @description 一个简单的集中式状态管理器 (Store)，用于解耦应用中的各个模块。
 *              采用类似 Redux 的单向数据流思想：
 *              1. UI/逻辑模块通过 `Store.dispatch(action)` 发送一个动作意图。
 *              2. Store 根据 action 类型，在 reducer 中计算出新的 state。
 *              3. Store 保存新 state，并通知所有订阅者 (listeners)。
 *              4. UI 模块接收到通知，从 Store 获取最新 state，并更新自身视图。
 *              REFACTORED: 增强了 State 结构和 Reducers，以支持更全面的 UI 状态解耦。
 *              REFACTORED (Phase 1): Reducers 现在是纯函数，所有副作用都已移至 ActionCreators.js。
 *              REFACTORED (Phase 3): 状态树更加完善，包含了驱动所有 UI 组件渲染所需的数据。
 * @module Store
 * @exports {object} Store - 全局单例的 Store 对象。
 */
const Store = {
    // --- 私有属性 ---
    _state: {
        // 连接与服务状态
        isWebSocketConnected: false,
        isAiServiceHealthy: false,
        connectionStatusText: '初始化中...',

        // 当前聊天与UI布局状态
        currentChatId: null,
        isChatAreaVisible: false, // 主要用于移动端布局
        isDetailsPanelVisible: false,
        detailsPanelContent: null, // 'details' 或 'lobby'

        // REFACTORED (Phase 3): 状态树现在包含了直接驱动列表渲染的数据
        sidebar: {
            activeTab: 'all', // 'all', 'contacts', 'groups'
            listItems: [], // 侧边栏要渲染的条目数组
            searchQuery: '',
        },

        // REFACTORED (Phase 2): 新增更多UI状态以实现解耦
        contactStatuses: {}, // 联系人连接状态: { contactId: 'online' | 'offline' | 'connected' }
        currentChatInfo: { // 当前聊天头部所需的所有信息
            title: '选择一个聊天',
            statusText: '',
            avatarUrl: null,
            avatarText: '?',
            entityType: null, // 'contact' 或 'group'
            entity: null, // 完整的联系人或群组对象
        },
        // REFACTORED: 新增用于媒体预览的状态
        filePreview: null, // { blob, hash, name, type, size, previewUrl }
        audioPreview: null, // { dataUrl, duration }
        // REFACTORED: 用于通知UI消息更新
        lastMessageUpdate: { chatId: null, timestamp: 0 },
    },
    _listeners: new Set(),
    _reducers: {},

    // --- 公开方法 ---

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    },

    getState() {
        return { ...this._state };
    },

    dispatch(actionType, payload) {
        if (typeof Utils !== 'undefined') {
            Utils.log(`Store: 分发 Action -> ${actionType}`, Utils.logLevels.DEBUG);
        }
        const reducer = this._reducers[actionType];
        if (reducer) {
            const oldState = this._state;
            const newState = reducer(this._state, payload);
            if (newState !== oldState) {
                this._state = newState;
                this._listeners.forEach(listener => {
                    try {
                        listener(this._state, oldState);
                    } catch (e) {
                        if (typeof Utils !== 'undefined') {
                            Utils.log(`Store: 执行监听器时出错: ${e.message}`, Utils.logLevels.ERROR);
                        } else {
                            console.error(`Store: Listener error: ${e.message}`);
                        }
                    }
                });
            }
        } else {
            if (typeof Utils !== 'undefined') {
                Utils.log(`Store: 未找到 Action "${actionType}" 对应的 Reducer。`, Utils.logLevels.WARN);
            }
        }
    },

    // --- 内部初始化，注册所有的 Reducers ---
    init() {
        this._reducers = {
            // ==========================================================================
            // 应用与连接状态
            // ==========================================================================
            APP_INITIALIZED: (state, payload) => {
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                return { ...state, isChatAreaVisible: false, isDetailsPanelVisible: false, sidebar: newSidebarState };
            },
            UPDATE_CONNECTION_STATUS: (state, payload) => {
                if (state.isWebSocketConnected === payload.isConnected && state.connectionStatusText === payload.statusText) return state;
                return { ...state, isWebSocketConnected: payload.isConnected, connectionStatusText: payload.statusText };
            },
            UPDATE_AI_SERVICE_STATUS: (state, payload) => {
                if (state.isAiServiceHealthy === payload.isHealthy) return state;
                const newChatInfo = this._calculateChatInfo(state.currentChatId, payload.isHealthy);
                return { ...state, isAiServiceHealthy: payload.isHealthy, currentChatInfo: newChatInfo };
            },
            UPDATE_CONTACT_STATUS: (state, payload) => {
                const { contactId, status } = payload;
                if (state.contactStatuses[contactId] === status) return state;
                const newStatuses = { ...state.contactStatuses, [contactId]: status };
                const newChatInfo = this._calculateChatInfo(state.currentChatId, state.isAiServiceHealthy);
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                return { ...state, contactStatuses: newStatuses, currentChatInfo: newChatInfo, sidebar: newSidebarState };
            },

            // ==========================================================================
            // UI 布局与导航
            // ==========================================================================
            SET_SIDEBAR_FILTER: (state, payload) => {
                const { tab, query } = payload;
                const newTab = tab !== undefined ? tab : state.sidebar.activeTab;
                const newQuery = query !== undefined ? query : state.sidebar.searchQuery;
                if (state.sidebar.activeTab === newTab && state.sidebar.searchQuery === newQuery) return state;
                const newSidebarState = { ...state.sidebar, activeTab: newTab, searchQuery: newQuery, listItems: this._collectSidebarItems(newTab, newQuery) };
                return { ...state, sidebar: newSidebarState };
            },
            OPEN_CHAT: (state, payload) => {
                const { chatId } = payload;
                if (state.currentChatId === chatId && window.innerWidth > 768) {
                    return state;
                }
                const newChatInfo = this._calculateChatInfo(chatId, state.isAiServiceHealthy);
                return { ...state, currentChatId: chatId, isChatAreaVisible: !!chatId, isDetailsPanelVisible: false, detailsPanelContent: null, currentChatInfo: newChatInfo };
            },
            SHOW_CHAT_LIST: (state, payload) => {
                if (!state.isChatAreaVisible) return state;
                return { ...state, isChatAreaVisible: false, isDetailsPanelVisible: false };
            },
            TOGGLE_DETAILS_PANEL: (state, payload) => {
                const { content } = payload;
                const isCurrentlyVisible = state.isDetailsPanelVisible && state.detailsPanelContent === content;
                return { ...state, isDetailsPanelVisible: !isCurrentlyVisible, detailsPanelContent: isCurrentlyVisible ? null : content };
            },
            HIDE_DETAILS_PANEL: (state, payload) => {
                if (!state.isDetailsPanelVisible) return state;
                return { ...state, isDetailsPanelVisible: false, detailsPanelContent: null };
            },

            // ==========================================================================
            // 数据模型更新 (由 Manager 触发，用于通知 UI)
            // ==========================================================================
            DATA_MODIFIED: (state, payload) => {
                // 这个 action 表明底层数据 (contacts, groups, chats) 已变，需要重新计算派生状态
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                const newChatInfo = this._calculateChatInfo(state.currentChatId, state.isAiServiceHealthy);
                return { ...state, sidebar: newSidebarState, currentChatInfo: newChatInfo };
            },
            MESSAGES_UPDATED: (state, payload) => {
                const { chatId } = payload;
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                return { ...state, lastMessageUpdate: { chatId, timestamp: Date.now() }, sidebar: newSidebarState };
            },
        };
    },

    /**
     * @private
     * @description 根据过滤器和搜索查询，从 UserManager 和 GroupManager 收集并格式化侧边栏列表项。
     *              这个函数是 Store 的一部分，因为它直接从数据源计算 State 的一部分。
     * @param {string} filter - 'all', 'contacts', 'groups'
     * @param {string} query - 搜索查询
     * @returns {Array<object>}
     */
    _collectSidebarItems(filter, query) {
        let items = [];
        const lowerCaseQuery = query.toLowerCase();

        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                if (((!contact.isSpecial && !contact.isAI) || contact.isSpecial) && contact.name.toLowerCase().includes(lowerCaseQuery)) {
                    items.push({
                        id: contact.id, name: contact.name, avatarText: contact.avatarText, avatarUrl: contact.avatarUrl,
                        lastMessage: ChatManager._formatLastMessagePreview(contact.id, contact.lastMessage, (contact.isSpecial && contact.isAI) ? '准备好聊天！' : '暂无消息'),
                        lastTime: contact.lastTime, unread: contact.unread || 0, type: 'contact',
                        online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id), isSpecial: contact.isSpecial
                    });
                }
            });
        }
        if (filter === 'all' || filter === 'groups') {
            Object.values(GroupManager.groups).forEach(group => {
                if (group.name.toLowerCase().includes(lowerCaseQuery)) {
                    items.push({
                        id: group.id, name: group.name, avatarText: '👥', avatarUrl: null,
                        lastMessage: ChatManager._formatLastMessagePreview(group.id, group.lastMessage, `成员: ${group.members.length}`),
                        lastTime: group.lastTime, unread: group.unread || 0, type: 'group'
                    });
                }
            });
        }
        items.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));
        return items;
    },

    _calculateChatInfo(chatId, isAiServiceHealthy) {
        if (!chatId) {
            return {
                title: '选择一个聊天', statusText: '', avatarUrl: null, avatarText: '?', entityType: null, entity: null
            };
        }
        const isGroup = chatId.startsWith('group_');
        const entity = isGroup ? (GroupManager.groups[chatId] || null) : (UserManager.contacts[chatId] || null);
        if (!entity) {
            return {
                title: '未知聊天', statusText: '错误：找不到聊天对象', avatarUrl: null, avatarText: '?', entityType: null, entity: null
            };
        }
        let info = {
            title: entity.name,
            avatarUrl: entity.avatarUrl || null,
            avatarText: entity.avatarText || (entity.name ? entity.name.charAt(0) : '?'),
            entityType: isGroup ? 'group' : 'contact',
            entity: entity,
            statusText: ''
        };
        if (isGroup) {
            info.statusText = `${entity.members.length} 名成员 (上限 ${GroupManager.MAX_GROUP_MEMBERS})`;
            info.avatarText = '👥';
        } else {
            const contact = entity;
            if (contact.isAI) {
                const aiStatus = isAiServiceHealthy ? "服务可用" : "服务不可用";
                info.statusText = `AI 助手 - ${aiStatus}`;
            } else if (contact.isSpecial) {
                info.statusText = '特殊联系人';
            } else {
                const isConnected = ConnectionManager.isConnectedTo(chatId);
                info.statusText = isConnected ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`;
            }
        }
        return info;
    }
};