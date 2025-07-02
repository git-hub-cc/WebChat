/**
 * @file 集中式状态管理器 (Store)
 * @description 采用类似 Redux 的单向数据流思想，作为应用全局状态的唯一真实来源，以解耦各模块。
 *              工作流程：
 *              1. 业务逻辑层通过 `Store.dispatch(action)` 发送动作。
 *              2. Store 根据动作类型调用对应的 reducer 函数。
 *              3. Reducer 是一个纯函数，接收旧 state 和 payload，计算并返回新 state。
 *              4. Store 保存新 state，并通知所有订阅者（通常是 UI 模块）。
 *              5. UI 模块接收通知，从 Store 获取最新 state 并更新视图。
 * @module Store
 * @exports {object} Store - 全局单例的 Store 对象。
 * @dependency Utils, UserManager, GroupManager, ChatManager, ConnectionManager
 */
const Store = {
    // ==========================================================================
    // 内部状态与属性
    // ==========================================================================
    // 存储所有 reducer 函数，键为 action 类型，值为 reducer 函数
    _reducers: {},
    // 存储所有订阅 Store 变化的监听器函数
    _listeners: new Set(),
    // 应用的唯一状态树
    _state: {
        // --- 连接与服务状态 ---
        isWebSocketConnected: false,    // WebSocket 是否已连接
        isAiServiceHealthy: false,      // AI 服务是否健康可用
        connectionStatusText: '初始化中...', // 显示在 UI 上的连接状态文本

        // --- UI 布局与导航状态 ---
        currentChatId: null,        // 当前打开的聊天窗口的 ID
        isChatAreaVisible: false,   // 聊天区域是否可见 (主要用于移动端响应式布局)
        isDetailsPanelVisible: false, // 详情面板（包含联系人详情或人员大厅）是否可见
        detailsPanelContent: null,  // 详情面板当前显示的内容 ('details' 或 'lobby')

        // --- 侧边栏状态 (驱动 SidebarUI 渲染) ---
        sidebar: {
            activeTab: 'all',       // 当前激活的标签页 ('all', 'contacts', 'groups')
            listItems: [],          // 经过筛选和排序后，实际要渲染到列表中的条目数组
            searchQuery: '',        // 搜索框中的查询文本
        },

        // --- 派生状态 (由底层数据计算而来，用于驱动其他 UI 组件) ---
        // 存储各个联系人的在线状态: { contactId: 'online' | 'offline' | 'connected' }
        contactStatuses: {},
        // 当前聊天窗口头部所需的所有信息，避免 UI 组件自行计算
        currentChatInfo: {
            title: '选择一个聊天',
            statusText: '',
            avatarUrl: null,
            avatarText: '?',
            entityType: null, // 'contact' 或 'group'
            entity: null,     // 完整的联系人或群组对象引用
        },
        // --- 消息与媒体预览状态 ---
        lastMessageUpdate: { chatId: null, timestamp: 0 }, // 用于精确触发UI更新的最新消息标记
    },

    /**
     * 初始化 Store
     * @description 注册应用中所有的 reducer 函数。此方法必须在应用启动时调用一次。
     * @function init
     */
    init() {
        this._reducers = {
            // ==========================================================================
            // 应用与连接状态 Reducers
            // ==========================================================================
            APP_INITIALIZED: (state, payload) => {
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems('all', '') };
                return { ...state, isChatAreaVisible: false, isDetailsPanelVisible: false, sidebar: newSidebarState };
            },
            UPDATE_CONNECTION_STATUS: (state, payload) => {
                // 性能优化：如果状态未变，则返回原 state 对象，避免不必要的重渲染
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
                // NOTE: 联系人状态变化可能影响侧边栏和聊天头部的显示，因此需要重新计算
                const newChatInfo = this._calculateChatInfo(state.currentChatId, state.isAiServiceHealthy);
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                return { ...state, contactStatuses: newStatuses, currentChatInfo: newChatInfo, sidebar: newSidebarState };
            },

            // ==========================================================================
            // UI 布局与导航 Reducers
            // ==========================================================================
            SET_SIDEBAR_FILTER: (state, payload) => {
                const { tab, query } = payload;
                const newTab = tab !== undefined ? tab : state.sidebar.activeTab;
                const newQuery = query !== undefined ? query : state.sidebar.searchQuery;
                if (state.sidebar.activeTab === newTab && state.sidebar.searchQuery === newQuery) return state;
                // 当筛选条件变化时，重新计算侧边栏列表项
                const newSidebarState = { ...state.sidebar, activeTab: newTab, searchQuery: newQuery, listItems: this._collectSidebarItems(newTab, newQuery) };
                return { ...state, sidebar: newSidebarState };
            },
            OPEN_CHAT: (state, payload) => {
                const { chatId } = payload;
                // 在桌面端，重复点击同一个聊天不应有任何反应
                if (state.currentChatId === chatId && window.innerWidth > 768) {
                    return state;
                }
                const newChatInfo = this._calculateChatInfo(chatId, state.isAiServiceHealthy);
                return { ...state, currentChatId: chatId, isChatAreaVisible: !!chatId, isDetailsPanelVisible: false, detailsPanelContent: null, currentChatInfo: newChatInfo };
            },
            SHOW_CHAT_LIST: (state, payload) => {
                // NOTE: 此 action 主要用于移动端，从聊天界面返回到聊天列表
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
            // 数据模型更新 Reducers (由数据管理器触发，用以通知 UI 刷新)
            // ==========================================================================
            DATA_MODIFIED: (state, payload) => {
                // NOTE: 这是一个通用 action，表明底层数据(联系人、群组等)已变，需要重新计算所有派生状态
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                const newChatInfo = this._calculateChatInfo(state.currentChatId, state.isAiServiceHealthy);
                return { ...state, sidebar: newSidebarState, currentChatInfo: newChatInfo };
            },
            MESSAGES_UPDATED: (state, payload) => {
                const { chatId } = payload;
                // 消息更新会影响侧边栏的最后消息预览和排序
                const newSidebarState = { ...state.sidebar, listItems: this._collectSidebarItems(state.sidebar.activeTab, state.sidebar.searchQuery) };
                return { ...state, lastMessageUpdate: { chatId, timestamp: Date.now() }, sidebar: newSidebarState };
            },
        };
    },

    /**
     * 订阅状态变化
     * @description 注册一个监听器函数，当 Store 的 state 发生变化时，该函数将被调用。
     * @function subscribe
     * @param {function} listener - 状态变化时要执行的回调函数。它会接收 (newState, oldState) 作为参数。
     * @returns {function} 返回一个取消订阅的函数。调用此函数即可移除监听器。
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener); // 返回一个用于取消订阅的函数
    },

    /**
     * 获取当前状态
     * @description 返回当前应用状态树的一个浅拷贝。
     * @function getState
     * @returns {object} 当前的状态对象。
     */
    getState() {
        return { ...this._state };
    },

    /**
     * 分发一个 Action
     * @description 这是改变 Store 状态的唯一方式。
     * @function dispatch
     * @param {string} actionType - Action 的类型，必须与 init 中注册的 reducer 键名匹配。
     * @param {*} [payload] - 随 Action 一起传递的数据。
     */
    dispatch(actionType, payload) {
        // 1. 查找与 action 类型对应的 reducer
        const reducer = this._reducers[actionType];

        if (reducer) {
            const oldState = this._state;
            // 2. 调用 reducer 计算新 state
            const newState = reducer(this._state, payload);

            // 3. 如果 reducer 返回了新的 state 对象，则更新 state 并通知所有监听者
            if (newState !== oldState) {
                this._state = newState;
                this._listeners.forEach(listener => {
                    try {
                        listener(this._state, oldState);
                    } catch (e) {
                        console.error(`Store: 执行监听器时出错: ${e.message}`, e);
                    }
                });
            }
        } else {
            Utils.log(`Store: 未找到 Action "${actionType}" 对应的 Reducer。`, Utils.logLevels.WARN);
        }
    },

    // --------------------------------------------------------------------------
    // 内部派生状态计算函数 (Private)
    // --------------------------------------------------------------------------

    /**
     * 收集并格式化侧边栏列表项 (内部函数)
     * @description 根据过滤器和搜索查询，从 UserManager 和 GroupManager 收集原始数据，并格式化为 UI 渲染所需的结构。
     * @function _collectSidebarItems
     * @param {string} filter - 筛选类型 ('all', 'contacts', 'groups')
     * @param {string} query - 搜索查询字符串
     * @returns {Array<object>} - 格式化并排序后的侧边栏项目数组。
     * @private
     */
    _collectSidebarItems(filter, query) {
        let items = [];
        const lowerCaseQuery = query.toLowerCase();

        // 1. 根据筛选条件，收集联系人
        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
               // BUGFIX: 只显示非AI联系人或属于当前主题的特殊(AI)联系人
                const isThemeContact = UserManager.isSpecialContactInCurrentTheme(contact.id);
                if (!contact.isAI || isThemeContact) {
                    if (contact.name.toLowerCase().includes(lowerCaseQuery)) {
                        items.push({
                            id: contact.id, name: contact.name, avatarText: contact.avatarText, avatarUrl: contact.avatarUrl,
                            lastMessage: ChatManager._formatLastMessagePreview(contact.id, contact.lastMessage, '暂无消息'),
                            lastTime: contact.lastTime, unread: contact.unread || 0, type: 'contact',
                            online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id), isSpecial: contact.isSpecial
                        });
                    }
                }
            });
        }

        // 2. 根据筛选条件，收集群组
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

        // 3. 按最后消息时间对所有项目进行降序排序
        items.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));
        return items;
    },

    /**
     * 计算当前聊天窗口的头部信息 (内部函数)
     * @description 根据当前聊天 ID 和服务状态，计算出 ChatHeaderUI 组件所需的所有信息。
     * @function _calculateChatInfo
     * @param {string|null} chatId - 当前聊天的 ID。
     * @param {boolean} isAiServiceHealthy - AI 服务的健康状态。
     * @returns {object} - 包含 title, statusText, avatar 等信息的对象。
     * @private
     */
    _calculateChatInfo(chatId, isAiServiceHealthy) {
        // 1. 处理未选择任何聊天的情况
        if (!chatId) {
            return { title: '选择一个聊天', statusText: '', avatarUrl: null, avatarText: '?', entityType: null, entity: null };
        }

        // 2. 确定实体类型（群组或联系人）并获取实体对象
        const isGroup = chatId.startsWith('group_');
        const entity = isGroup ? (GroupManager.groups[chatId] || null) : (UserManager.contacts[chatId] || null);

        // 3. 处理找不到实体的情况
        if (!entity) {
            return { title: '未知聊天', statusText: '错误：找不到聊天对象', avatarUrl: null, avatarText: '?', entityType: null, entity: null };
        }

        // 4. 构建基础信息
        let info = {
            title: entity.name,
            avatarUrl: entity.avatarUrl || null,
            avatarText: entity.avatarText || (entity.name ? entity.name.charAt(0) : '?'),
            entityType: isGroup ? 'group' : 'contact',
            entity: entity,
            statusText: ''
        };

        // 5. 根据实体类型计算详细的状态文本
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
                info.statusText = isConnected ? '已连接' : `在线 (未连接)`;
            }
        }
        return info;
    }
};