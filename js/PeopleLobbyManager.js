/**
 * @file PeopleLobbyManager.js
 * @description 管理人员大厅的 UI 和逻辑，包括获取在线用户、渲染列表及处理用户交互。
 *              【核心增强】定期刷新在线用户列表的任务现在会比较前后状态，并为新上线的联系人触发 `contactCameOnline` 事件，
 *              从而驱动智能的、事件驱动的P2P连接建立。
 * @module PeopleLobbyManager
 * @exports {object} PeopleLobbyManager - 对外暴露的单例对象。
 * @property {function} init - 初始化模块，并启动定期刷新任务。
 * @property {function} show - 显示人员大厅并获取最新数据。
 * @property {function} hide - 隐藏人员大厅。
 * @property {function} isVisible - 检查人员大厅是否可见。
 * @property {function} fetchOnlineUsers - 从服务器获取在线用户ID列表。
 * @dependencies UserManager, Utils, NotificationUIManager, ModalUIManager, AppSettings, EventEmitter, TimerManager, ConnectionManager
 */
const PeopleLobbyManager = {
    onlineUserIds: [], // 存储在线用户ID的数组
    _previousOnlineUserIds: new Set(), // [新增] 用于跟踪状态变化，以触发事件
    lobbyContainerEl: null,
    peopleLobbyListEl: null,
    refreshButtonEl: null,
    isLoading: false,
    _AUTO_REFRESH_INTERVAL: 30 * 1000,
    _AUTO_REFRESH_TASK_NAME: 'peopleLobbyAutoRefresh',

    /**
     * 初始化人员大厅管理器，并启动定期刷新在线用户列表的任务。
     */
    init: function() {
        this.lobbyContainerEl = document.getElementById('peopleLobbyContent');
        this.peopleLobbyListEl = document.getElementById('peopleLobbyList');
        this.refreshButtonEl = document.getElementById('peopleLobbyRefreshBtn');
        if (this.refreshButtonEl) {
            this.refreshButtonEl.addEventListener('click', this.handleRefreshLobby.bind(this));
        }

        if (typeof TimerManager !== 'undefined') {
            TimerManager.addPeriodicTask(
                this._AUTO_REFRESH_TASK_NAME,
                async () => {
                    const success = await this.fetchOnlineUsers(true);
                    if (success && this.isVisible()) {
                        this.renderLobby();
                    }
                },
                this._AUTO_REFRESH_INTERVAL,
                false
            );
            Utils.log(`PeopleLobbyManager: 已启动在线用户列表自动刷新任务，间隔 ${this._AUTO_REFRESH_INTERVAL / 1000} 秒。`, Utils.logLevels.INFO);
        } else {
            Utils.log('PeopleLobbyManager: TimerManager 未定义，无法启动自动刷新任务。', Utils.logLevels.WARN);
        }
    },

    /**
     * @description 从服务器获取在线用户ID列表，并处理自动连接逻辑。
     * @param {boolean} [isSilent=false] - 如果为 true，则表示这是一个后台静默刷新。
     * @returns {Promise<boolean>} - 是否成功获取数据。
     */
    fetchOnlineUsers: async function(isSilent = false) {
        if (!isSilent && this.refreshButtonEl && this.isVisible()) {
            this.refreshButtonEl.classList.add('loading');
        }
        if (!isSilent) {
            this.isLoading = true;
            if (this.isVisible()) this.renderLobby();
        }

        try {
            const lobbyApiUrl = AppSettings.server.lobbyApiEndpoint;
            if (!lobbyApiUrl) {
                throw new Error("人员大厅API端点未配置。");
            }

            const response = await fetch(lobbyApiUrl);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`获取在线用户失败: ${response.status} - ${errorText.substring(0, 100)}`);
            }
            const userIds = await response.json();
            const oldOnlineUserIds = new Set(this.onlineUserIds);
            this.onlineUserIds = Array.isArray(userIds) ? userIds.filter(id => id !== UserManager.userId) : [];
            const newOnlineUserIds = new Set(this.onlineUserIds);

            // [核心增强] 比较新旧在线列表，为新上线的联系人触发事件
            this._triggerEventsForStatusChanges(newOnlineUserIds);

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

            return true;
        } catch (error) {
            Utils.log('PeopleLobbyManager: 获取在线用户时出错: ' + error, Utils.logLevels.ERROR);
            if (!isSilent) NotificationUIManager.showNotification('无法加载在线用户列表。', 'error');
            if (this.onlineUserIds.length === 0 && !isSilent) {
                this.onlineUserIds = [];
                if (typeof EventEmitter !== 'undefined') {
                    EventEmitter.emit('onlineUsersUpdated', []);
                }
            }
            return false;
        } finally {
            this.isLoading = false;
            if (!isSilent && this.refreshButtonEl && this.isVisible()) {
                this.refreshButtonEl.classList.remove('loading');
            }
        }
    },

    /**
     * @private
     * @description [新增] 比较新旧在线用户列表，并为新上线的联系人触发 `contactCameOnline` 事件。
     * @param {Set<string>} currentOnlineIds - 当前获取到的在线用户ID集合。
     */
    _triggerEventsForStatusChanges: function(currentOnlineIds) {
        if (!UserManager.contacts || typeof ConnectionManager.isConnectedTo !== 'function') {
            return;
        }

        // 遍历所有当前在线的用户
        for (const onlineId of currentOnlineIds) {
            // 如果这个用户之前不在线，现在在线了，并且是我们的联系人，且我们尚未连接到他
            if (!this._previousOnlineUserIds.has(onlineId) && UserManager.contacts[onlineId] && !ConnectionManager.isConnectedTo(onlineId)) {
                Utils.log(`PeopleLobbyManager: 检测到联系人 ${onlineId} 新上线，触发 'contactCameOnline' 事件。`, Utils.logLevels.INFO);
                EventEmitter.emit('contactCameOnline', onlineId);
            }
        }

        // 更新上一次的在线用户列表状态，为下一次比较做准备
        this._previousOnlineUserIds = currentOnlineIds;
    },

    /**
     * @description 渲染人员大厅列表。
     */
    renderLobby: function() {
        if (!this.peopleLobbyListEl) {
            Utils.log('PeopleLobbyManager: 未找到人员大厅列表元素。', Utils.logLevels.ERROR);
            return;
        }
        this.peopleLobbyListEl.innerHTML = '';

        if (this.isLoading && this.isVisible()) {
            const loadingLi = document.createElement('li');
            loadingLi.className = 'chat-list-item-empty';
            loadingLi.textContent = '正在加载在线用户...';
            this.peopleLobbyListEl.appendChild(loadingLi);
            return;
        }

        if (this.onlineUserIds.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'chat-list-item-empty';
            emptyLi.textContent = '当前无其他在线用户。';
            this.peopleLobbyListEl.appendChild(emptyLi);
            return;
        }

        this.onlineUserIds.forEach(userId => {
            const contact = UserManager.contacts[userId];
            const li = document.createElement('li');
            li.className = 'chat-list-item';
            li.setAttribute('data-id', userId);

            const isAlreadyContact = !!contact;
            const name = contact ? contact.name : `用户 ${userId.substring(0, 6)}...`;
            const avatarText = contact ? (contact.avatarText || name.charAt(0).toUpperCase()) : userId.charAt(0).toUpperCase();
            const avatarUrl = contact ? contact.avatarUrl : null;

            let avatarContentHtml;
            if (avatarUrl) {
                avatarContentHtml = `<img src="${avatarUrl}" alt="${Utils.escapeHtml(avatarText)}" class="avatar-image" data-fallback-text="${Utils.escapeHtml(avatarText)}" data-entity-id="${userId}">`;
            } else {
                avatarContentHtml = Utils.escapeHtml(avatarText);
            }

            li.innerHTML = `
                <div class="chat-list-avatar">${avatarContentHtml}</div>
                <div class="chat-list-info">
                    <div class="chat-list-name">${Utils.escapeHtml(name)}</div>
                    <div class="chat-list-preview">${isAlreadyContact ? '已是联系人' : '点击添加'}</div>
                </div>
                ${isAlreadyContact ? `<div class="chat-list-meta"><span class="chat-list-badge" style="background-color: var(--accent-color); color: white;">✓</span></div>` : ''}
            `;

            li.addEventListener('click', () => this.handleLobbyUserClick(userId));
            this.peopleLobbyListEl.appendChild(li);
        });
    },

    /**
     * @description 处理人员大厅中用户项的点击事件。
     * @param {string} userId - 被点击用户的ID。
     */
    handleLobbyUserClick: function(userId) {
        Utils.log(`PeopleLobbyManager: 点击了大厅用户 ${userId}`, Utils.logLevels.DEBUG);
        ModalUIManager.showAddContactModalWithId(userId);
    },

    /**
     * @description 显示人员大厅。
     * @returns {Promise<void>}
     */
    show: async function() {
        if (!this.lobbyContainerEl) return;

        this.lobbyContainerEl.style.display = 'flex';
        this.isLoading = true;
        this.renderLobby();
        const success = await this.fetchOnlineUsers();
        if (success) {
            this.renderLobby();
        } else {
            this.renderLobby();
        }
        Utils.log('PeopleLobbyManager: 人员大厅已显示。', Utils.logLevels.INFO);
    },

    /**
     * @description 隐藏人员大厅。
     */
    hide: function() {
        if (this.lobbyContainerEl) {
            this.lobbyContainerEl.style.display = 'none';
            Utils.log('PeopleLobbyManager: 人员大厅已隐藏。', Utils.logLevels.INFO);
        }
    },

    /**
     * @description 检查人员大厅当前是否可见。
     * @returns {boolean}
     */
    isVisible: function() {
        return !!(this.lobbyContainerEl && this.lobbyContainerEl.style.display !== 'none');
    },

    /**
     * @description 处理刷新按钮点击事件，重新获取并渲染人员大厅列表。
     */
    handleRefreshLobby: async function() {
        Utils.log('PeopleLobbyManager: 用户点击刷新大厅。', Utils.logLevels.INFO);
        this.isLoading = true;
        this.renderLobby();
        await this.fetchOnlineUsers();
        this.renderLobby();
    }
};