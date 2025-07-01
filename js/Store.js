/**
 * @file Store.js
 * @description 一个简单的集中式状态管理器 (Store)，用于解耦应用中的各个模块。
 *              采用类似 Redux 的单向数据流思想：
 *              1. UI/逻辑模块通过 `Store.dispatch(action)` 发送一个动作意图。
 *              2. Store 根据 action 类型，在 reducer 中计算出新的 state。
 *              3. Store 保存新 state，并通知所有订阅者 (listeners)。
 *              4. UI 模块接收到通知，从 Store 获取最新 state，并更新自身视图。
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

        // REFACTORED (Phase 2): 新增更多UI状态
        activeSidebarTab: 'all', // 'all', 'contacts', 'groups'
        contactStatuses: {}, // { contactId: 'online' | 'offline' | 'connected' }
        currentChatInfo: { // 存储当前聊天头部所需的信息
            title: '选择一个聊天',
            statusText: '',
            avatarUrl: null,
            avatarText: '?',
            entityType: null, // 'contact' 或 'group'
            entity: null, // 完整的联系人或群组对象
        },
    },
    _listeners: new Set(), // 存储所有订阅回调函数的集合
    _reducers: {},         // 存储所有 action 类型对应的 reducer 函数

    // --- 公开方法 ---

    /**
     * 订阅 state 的变化。
     * @param {Function} listener - 当 state 改变时要执行的回调函数。
     * @returns {Function} 一个用于取消订阅的函数。
     */
    subscribe(listener) {
        this._listeners.add(listener);
        // 返回一个取消订阅的函数，方便组件在销毁时清理
        return () => this._listeners.delete(listener);
    },

    /**
     * 获取当前的 state 对象。
     * @returns {object} 当前的应用状态。
     */
    getState() {
        // 返回 state 的一个浅拷贝，防止外部直接修改
        return { ...this._state };
    },

    /**
     * 分发一个 action。这是改变 state 的唯一方式。
     * @param {string} actionType - Action 的类型 (例如 'OPEN_CHAT')。
     * @param {object} [payload] - 与 action 相关的数据。
     */
    dispatch(actionType, payload) {
        if (typeof Utils !== 'undefined') {
            Utils.log(`Store: 分发 Action -> ${actionType}`, Utils.logLevels.DEBUG);
        }

        // 查找并执行对应的 reducer
        const reducer = this._reducers[actionType];
        if (reducer) {
            const newState = reducer(this._state, payload);
            // 检查 state 是否真的发生了变化
            if (newState !== this._state) {
                this._state = newState; // 更新 state
                // 通知所有订阅者
                this._listeners.forEach(listener => {
                    try {
                        listener(this._state);
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
            /**
             * 应用初始化完成
             */
            APP_INITIALIZED: (state, payload) => {
                // 初始化时，聊天区和详情面板都不可见
                return {
                    ...state,
                    isChatAreaVisible: false,
                    isDetailsPanelVisible: false,
                };
            },

            /**
             * 更新WebSocket连接状态
             */
            UPDATE_CONNECTION_STATUS: (state, payload) => {
                return {
                    ...state,
                    isWebSocketConnected: payload.isConnected,
                    connectionStatusText: payload.statusText,
                };
            },

            /**
             * 更新AI服务健康状态
             */
            UPDATE_AI_SERVICE_STATUS: (state, payload) => {
                return {
                    ...state,
                    isAiServiceHealthy: payload.isHealthy,
                };
            },

            /**
             * REFACTORED (Phase 2): 新增 Reducer，用于更新联系人状态
             */
            UPDATE_CONTACT_STATUS: (state, payload) => {
                const { contactId, status } = payload; // status: 'online', 'offline', 'connected'
                const newStatuses = { ...state.contactStatuses, [contactId]: status };

                // 检查当前聊天头是否需要更新
                if (state.currentChatId === contactId) {
                    const newChatInfo = this._calculateChatInfo(contactId, state.isAiServiceHealthy);
                    return { ...state, contactStatuses: newStatuses, currentChatInfo: newChatInfo };
                }

                return { ...state, contactStatuses: newStatuses };
            },

            /**
             * REFACTORED (Phase 2): 新增 Reducer，用于设置侧边栏活动标签
             */
            SET_ACTIVE_TAB: (state, payload) => {
                const { tab } = payload;
                if (state.activeSidebarTab === tab) return state;
                return { ...state, activeSidebarTab: tab };
            },

            /**
             * 打开一个聊天
             */
            OPEN_CHAT: (state, payload) => {
                const { chatId } = payload;
                if (state.currentChatId === chatId && state.isChatAreaVisible) {
                    return state;
                }

                const newChatInfo = this._calculateChatInfo(chatId, state.isAiServiceHealthy);

                return {
                    ...state,
                    currentChatId: chatId,
                    isChatAreaVisible: !!chatId,
                    isDetailsPanelVisible: false,
                    detailsPanelContent: null,
                    currentChatInfo: newChatInfo, // 同时更新聊天头部信息
                };
            },

            /**
             * (移动端) 返回聊天列表视图
             */
            SHOW_CHAT_LIST: (state, payload) => {
                return {
                    ...state,
                    isChatAreaVisible: false,
                    isDetailsPanelVisible: false,
                };
            },

            /**
             * 切换详情面板的显示/隐藏状态
             */
            TOGGLE_DETAILS_PANEL: (state, payload) => {
                const { content } = payload; // 'details' 或 'lobby'
                const isCurrentlyVisible = state.isDetailsPanelVisible && state.detailsPanelContent === content;

                return {
                    ...state,
                    isDetailsPanelVisible: !isCurrentlyVisible,
                    detailsPanelContent: isCurrentlyVisible ? null : content,
                };
            },

            /**
             * 强制隐藏详情面板
             */
            HIDE_DETAILS_PANEL: (state, payload) => {
                if (!state.isDetailsPanelVisible) {
                    return state;
                }
                return {
                    ...state,
                    isDetailsPanelVisible: false,
                    detailsPanelContent: null,
                };
            },
        };
    },

    /**
     * @private
     * REFACTORED (Phase 2): 新增私有辅助函数，用于计算当前聊天的头部信息
     * @param {string|null} chatId - 当前聊天ID
     * @param {boolean} isAiServiceHealthy - AI服务健康状态
     * @returns {object} - 计算出的 currentChatInfo 对象
     */
    _calculateChatInfo(chatId, isAiServiceHealthy) {
        if (!chatId) {
            return {
                title: '选择一个聊天', statusText: '', avatarUrl: null, avatarText: '?', entityType: null, entity: null
            };
        }

        const isGroup = chatId.startsWith('group_');
        const entity = isGroup ? GroupManager.groups[chatId] : UserManager.contacts[chatId];

        if (!entity) {
            return {
                title: '未知聊天', statusText: '错误：找不到聊天对象', avatarUrl: null, avatarText: '?', entityType: null, entity: null
            };
        }

        let info = {
            title: entity.name,
            avatarUrl: entity.avatarUrl || null,
            avatarText: entity.avatarText || '?',
            entityType: isGroup ? 'group' : 'contact',
            entity: entity
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
                // 连接状态现在从Store获取，但这里暂时用旧方式，因为contactStatuses可能还没更新
                const isConnected = ConnectionManager.isConnectedTo(chatId);
                info.statusText = isConnected ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`;
            }
        }
        return info;
    }
};
