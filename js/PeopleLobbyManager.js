/**
 * @file 人员大厅管理器
 * @description 管理人员大厅的 UI 和逻辑，包括获取在线用户、渲染列表及处理用户交互。
 *              实现了通过 TimerManager 定期刷新在线用户列表，并包含当某个离线联系人连续两次被检测到在线时，尝试自动与其建立连接的逻辑。
 * @module PeopleLobbyManager
 * @exports {object} PeopleLobbyManager - 对外暴露的单例对象。
 * @dependency UserManager, Utils, NotificationUIManager, ModalUIManager, AppSettings, EventEmitter, TimerManager, ConnectionManager
 */
const PeopleLobbyManager = {
    // ==========================================================================
    // 依赖与常量
    // ==========================================================================
    _AUTO_REFRESH_TASK_NAME: 'peopleLobbyAutoRefresh', // 用于 TimerManager 的定时刷新任务的唯一名称
    _AUTO_CONNECT_THRESHOLD: 2, // 连续检测到联系人在线达到此阈值后，触发自动连接

    // ==========================================================================
    // 状态与缓存变量
    // ==========================================================================
    onlineUserIds: [], // 缓存的当前在线用户ID列表 (不包含自己)
    lobbyContainerEl: null,    // 人员大厅的容器 DOM 元素 (#peopleLobbyContent)
    peopleLobbyListEl: null,   // 显示用户列表的 ul 元素 (#peopleLobbyList)
    refreshButtonEl: null,     // 刷新按钮的 DOM 引用
    isLoading: false,          // 标记是否正在从服务器获取在线用户数据
    _autoConnectCounters: new Map(), // 存储联系人连续在线的检测次数，键为 userId，值为次数

    /**
     * 初始化人员大厅管理器
     * @description 获取必要的 DOM 元素引用，绑定事件监听器，并启动定期刷新在线用户的后台任务。
     * @function init
     */
    init: function() {
        // 1. 获取核心 DOM 元素的引用
        this.lobbyContainerEl = document.getElementById('peopleLobbyContent');
        this.peopleLobbyListEl = document.getElementById('peopleLobbyList');
        this.refreshButtonEl = document.getElementById('peopleLobbyRefreshBtn');

        // 2. 为刷新按钮绑定点击事件
        if (this.refreshButtonEl) {
            this.refreshButtonEl.addEventListener('click', this.handleRefreshLobby.bind(this));
        }

        // 3. 启动后台定时刷新任务
        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                this._AUTO_REFRESH_TASK_NAME,
                async () => {
                    // NOTE: 这是一个静默刷新，不会在 UI 上显示加载状态，除非大厅面板本身可见。
                    const success = await this.fetchOnlineUsers(true); // 参数 true 表示静默刷新
                    if (success && this.isVisible()) { // 如果获取成功且大厅可见，则重新渲染列表
                        this.renderLobby();
                    }
                },
                AppSettings.timers.lobbyAutoRefresh || 5000, // 从应用设置获取刷新间隔，默认5秒
                false // 任务默认不立即执行
            );
            Utils.log(`PeopleLobbyManager: 已启动在线用户列表自动刷新任务，间隔 ${AppSettings.timers.lobbyAutoRefresh / 1000 || 5} 秒。`, Utils.logLevels.INFO);
        } else {
            Utils.log('PeopleLobbyManager: TimerManager 未定义，无法启动自动刷新任务。', Utils.logLevels.WARN);
        }
    },

    /**
     * 获取在线用户列表
     * @description 从服务器获取在线用户ID列表，更新内部状态，并触发自动连接逻辑。
     * @function fetchOnlineUsers
     * @param {boolean} [isSilent=false] - 若为 true，则为后台静默刷新，不在 UI 上显示加载指示器。
     * @returns {Promise<boolean>} - 返回一个 Promise，解析为布尔值，表示是否成功获取数据。
     */
    fetchOnlineUsers: async function(isSilent = false) {
        // 1. 根据刷新类型更新 UI 加载状态
        if (!isSilent && this.refreshButtonEl && this.isVisible()) {
            this.refreshButtonEl.classList.add('loading');
        }
        if (!isSilent) {
            this.isLoading = true;
            if (this.isVisible()) this.renderLobby(); // 如果可见，立即渲染加载中状态
        }

        try {
            const lobbyApiUrl = AppSettings.server.lobbyApiEndpoint;
            if (!lobbyApiUrl) {
                throw new Error("人员大厅API端点未配置。");
            }

            // 2. 发起网络请求获取数据
            const response = await fetch(lobbyApiUrl);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`获取在线用户失败: ${response.status} - ${errorText.substring(0, 100)}`);
            }
            const userIds = await response.json();
            const oldOnlineUserIds = new Set(this.onlineUserIds);

            // 3. 处理并存储新的在线用户列表 (过滤掉自己)
            this.onlineUserIds = Array.isArray(userIds) ? userIds.filter(id => id !== UserManager.userId) : [];
            const newOnlineUserIds = new Set(this.onlineUserIds);

            // 4. 检查在线用户列表是否有实际变化，若有变化则发出通知事件
            let changed = false;
            if (oldOnlineUserIds.size !== newOnlineUserIds.size) {
                changed = true;
            } else {
                for (const id of oldOnlineUserIds) {
                    if (!newOnlineUserIds.has(id)) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed && typeof EventEmitter !== 'undefined') {
                EventEmitter.emit('onlineUsersUpdated', [...this.onlineUserIds]);
            }

            // 5. 执行自动连接逻辑
            this.handleAutoConnectLogic(newOnlineUserIds);

            return true;
        } catch (error) {
            Utils.log('PeopleLobbyManager: 获取在线用户时出错: ' + error, Utils.logLevels.ERROR);
            if (!isSilent) NotificationUIManager.showNotification('无法加载在线用户列表。', 'error');
            // NOTE: 在出错时，如果不是静默模式，清空列表并发出事件，以确保UI一致性
            if (this.onlineUserIds.length === 0 && !isSilent) {
                this.onlineUserIds = [];
                if (typeof EventEmitter !== 'undefined') {
                    EventEmitter.emit('onlineUsersUpdated', []);
                }
            }
            return false;
        } finally {
            // 6. 结束时重置加载状态
            this.isLoading = false;
            if (!isSilent && this.refreshButtonEl && this.isVisible()) {
                this.refreshButtonEl.classList.remove('loading');
            }
        }
    },

    /**
     * 渲染人员大厅列表
     * @description 根据当前 isLoading 和 onlineUserIds 状态，清空并重新渲染用户列表 UI。
     * @function renderLobby
     */
    renderLobby: function() {
        if (!this.peopleLobbyListEl) {
            Utils.log('PeopleLobbyManager: 未找到人员大厅列表元素。', Utils.logLevels.ERROR);
            return;
        }
        this.peopleLobbyListEl.innerHTML = ''; // 清空现有列表

        // 1. 如果正在加载中，则显示加载提示
        if (this.isLoading && this.isVisible()) {
            const loadingLi = document.createElement('li');
            loadingLi.className = 'chat-list-item-empty';
            loadingLi.textContent = '正在加载在线用户...';
            this.peopleLobbyListEl.appendChild(loadingLi);
            return;
        }

        // 2. 如果没有在线用户，则显示空状态提示
        if (this.onlineUserIds.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'chat-list-item-empty';
            emptyLi.textContent = '当前无其他在线用户。';
            this.peopleLobbyListEl.appendChild(emptyLi);
            return;
        }

        // 3. 遍历在线用户ID，为每个用户创建并添加列表项
        this.onlineUserIds.forEach(userId => {
            const contact = UserManager.contacts[userId];
            const li = document.createElement('li');
            li.className = 'chat-list-item';
            li.setAttribute('data-id', userId);

            // 确定用户信息
            const isAlreadyContact = !!contact;
            const name = contact ? contact.name : `用户 ${userId.substring(0, 6)}...`;
            const avatarText = contact ? (contact.avatarText || name.charAt(0).toUpperCase()) : userId.charAt(0).toUpperCase();
            const avatarUrl = contact ? contact.avatarUrl : null;

            // 构建头像 HTML
            let avatarContentHtml;
            if (avatarUrl) {
                avatarContentHtml = `<img src="${avatarUrl}" alt="${Utils.escapeHtml(avatarText)}" class="avatar-image" data-fallback-text="${Utils.escapeHtml(avatarText)}" data-entity-id="${userId}">`;
            } else {
                avatarContentHtml = Utils.escapeHtml(avatarText);
            }

            // 填充列表项的内部 HTML
            li.innerHTML = `
                <div class="chat-list-avatar">${avatarContentHtml}</div>
                <div class="chat-list-info">
                    <div class="chat-list-name">${Utils.escapeHtml(name)}</div>
                    <div class="chat-list-preview">${isAlreadyContact ? '已是联系人' : '点击添加'}</div>
                </div>
                ${isAlreadyContact ? `<div class="chat-list-meta"><span class="chat-list-badge" style="background-color: var(--accent-color); color: white;">✓</span></div>` : ''}
            `;

            // 绑定点击事件
            li.addEventListener('click', () => this.handleLobbyUserClick(userId));
            this.peopleLobbyListEl.appendChild(li);
        });
    },

    /**
     * 显示人员大厅
     * @description 使人员大厅容器可见，并立即获取最新数据进行渲染。
     * @function show
     * @returns {Promise<void>}
     */
    show: async function() {
        if (!this.lobbyContainerEl) return;

        // 1. 显示容器
        this.lobbyContainerEl.style.display = 'flex';
        // 2. 设置加载状态并渲染“加载中”UI
        this.isLoading = true;
        this.renderLobby();
        // 3. 获取最新数据
        const success = await this.fetchOnlineUsers();
        // 4. 根据获取结果重新渲染最终的UI
        this.renderLobby(); // 无论成功与否都重新渲染，以显示最终列表或错误/空状态

        Utils.log('PeopleLobbyManager: 人员大厅已显示。', Utils.logLevels.INFO);
    },

    /**
     * 隐藏人员大厅
     * @description 使人员大厅容器不可见。
     * @function hide
     */
    hide: function() {
        if (this.lobbyContainerEl) {
            this.lobbyContainerEl.style.display = 'none';
            Utils.log('PeopleLobbyManager: 人员大厅已隐藏。', Utils.logLevels.INFO);
        }
    },

    /**
     * 检查人员大厅是否可见
     * @function isVisible
     * @returns {boolean} - 如果人员大厅当前可见，则返回 true。
     */
    isVisible: function() {
        return !!(this.lobbyContainerEl && this.lobbyContainerEl.style.display !== 'none');
    },

    /**
     * 处理刷新按钮点击事件
     * @description 手动触发一次在线用户列表的获取和渲染。
     * @function handleRefreshLobby
     */
    handleRefreshLobby: async function() {
        Utils.log('PeopleLobbyManager: 用户点击刷新大厅。', Utils.logLevels.INFO);
        // 流程与 show 类似，但不改变容器的 display 属性
        this.isLoading = true;
        this.renderLobby();
        await this.fetchOnlineUsers();
        this.renderLobby();
    },

    /**
     * 处理大厅用户点击事件
     * @description 当用户点击大厅中的一个用户项时，显示添加联系人模态框。
     * @function handleLobbyUserClick
     * @param {string} userId - 被点击用户的ID。
     */
    handleLobbyUserClick: function(userId) {
        Utils.log(`PeopleLobbyManager: 点击了大厅用户 ${userId}`, Utils.logLevels.DEBUG);
        ModalUIManager.showAddContactModalWithId(userId);
    },

    /**
     * 处理自动连接逻辑 (内部函数)
     * @description 根据最新的在线用户列表，更新计数器并决定是否触发自动连接。
     * @function handleAutoConnectLogic
     * @param {Set<string>} onlineUserIdsSet - 当前所有在线用户的ID集合。
     * @private
     */
    handleAutoConnectLogic: function(onlineUserIdsSet) {
        // 1. 检查依赖项是否就绪
        if (typeof UserManager === 'undefined' || typeof ConnectionManager === 'undefined' || !UserManager.contacts) {
            return;
        }

        const contactsToConnect = [];
        const allContactIds = Object.keys(UserManager.contacts);

        // 2. 遍历所有已知联系人，判断其状态
        for (const contactId of allContactIds) {
            const isContactOnline = onlineUserIdsSet.has(contactId);
            const isContactConnected = ConnectionManager.isConnectedTo(contactId);

            // 3. 如果一个联系人在线但未连接，则增加其连续在线计数
            if (isContactOnline && !isContactConnected) {
                const currentCount = (this._autoConnectCounters.get(contactId) || 0) + 1;
                this._autoConnectCounters.set(contactId, currentCount);

                // 4. 如果计数达到阈值，则将其加入待连接列表，并重置计数器
                if (currentCount >= this._AUTO_CONNECT_THRESHOLD) {
                    contactsToConnect.push(contactId);
                    this._autoConnectCounters.delete(contactId);
                }
            } else {
                // 5. 如果用户不在线或已连接，则清空其计数器
                if (this._autoConnectCounters.has(contactId)) {
                    this._autoConnectCounters.delete(contactId);
                }
            }
        }

        // 6. 如果有待连接的用户，则调用 ConnectionManager 的方法进行连接
        if (contactsToConnect.length > 0) {
            Utils.log(`PeopleLobbyManager: 自动连接条件触发，尝试连接: ${contactsToConnect.join(', ')}`, Utils.logLevels.INFO);
            if (typeof ConnectionManager.autoConnectToContacts === 'function') {
                ConnectionManager.autoConnectToContacts(contactsToConnect);
            } else {
                Utils.log('PeopleLobbyManager: ConnectionManager.autoConnectToContacts 方法未定义。', Utils.logLevels.WARN);
            }
        }
    },

};