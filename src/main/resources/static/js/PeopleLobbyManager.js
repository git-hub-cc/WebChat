/**
 * @file PeopleLobbyManager.js
 * @description 管理人员大厅的 UI 和逻辑，包括获取在线用户、渲染列表及处理用户交互。
 * @module PeopleLobbyManager
 * @exports {object} PeopleLobbyManager - 对外暴露的单例对象。
 * @property {function} init - 初始化模块。
 * @property {function} show - 显示人员大厅并获取最新数据。
 * @property {function} hide - 隐藏人员大厅。
 * @property {function} isVisible - 检查人员大厅是否可见。
 * @dependencies UserManager, Utils, NotificationUIManager, ModalUIManager, Config
 */
const PeopleLobbyManager = {
    onlineUserIds: [],
    lobbyContainerEl: null,    // 这个是 #peopleLobbyContent
    peopleLobbyListEl: null,   // 这个是 #peopleLobbyList (ul)
    refreshButtonEl: null,     // 新增：刷新按钮引用
    isLoading: false,

    /**
     * 初始化人员大厅管理器。
     */
    init: function() {
        this.lobbyContainerEl = document.getElementById('peopleLobbyContent');
        this.peopleLobbyListEl = document.getElementById('peopleLobbyList');
        // 注意：刷新按钮现在将在 renderLobby 时动态创建或在 index.html 中直接定义
        // 我们将在 renderLobby 中处理它，或者如果它已在 HTML 中，则在此处获取引用
        this.refreshButtonEl = document.getElementById('peopleLobbyRefreshBtn'); // 假设HTML中已有此按钮
        if (this.refreshButtonEl) {
            this.refreshButtonEl.addEventListener('click', this.handleRefreshLobby.bind(this));
        }
    },

    /**
     * @description 从服务器获取在线用户ID列表。
     * @returns {Promise<boolean>} - 是否成功获取数据。
     */
    fetchOnlineUsers: async function() {
        if(this.refreshButtonEl) this.refreshButtonEl.classList.add('loading'); // 添加加载状态
        Utils.log('PeopleLobbyManager: 开始获取在线用户...', Utils.logLevels.INFO);
        try {
            // 确保使用正确的端点。如果 Config.server.apiEndpoint 已经是基础URL，则可能不需要 replace。
            // 假设 Config.server.lobbyApiEndpoint 存储了人员大厅的特定API路径。
            // 为简单起见，我们暂时硬编码或依赖 Config 中有一个明确的 lobby API 端点。
            // 暂时使用之前方案中的替换逻辑，但建议在 Config.js 中为 lobby API 单独配置一个键。
            const lobbyApiUrl = (Config.server.lobbyApiEndpoint ||
                Config.server.apiEndpoint.replace('/v1/chat/completions', '/api/monitor/online-user-ids'));

            const response = await fetch(lobbyApiUrl);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`获取在线用户失败: ${response.status} - ${errorText.substring(0, 100)}`);
            }
            const userIds = await response.json();
            this.onlineUserIds = Array.isArray(userIds) ? userIds.filter(id => id !== UserManager.userId) : [];
            Utils.log(`PeopleLobbyManager: 成功获取在线用户: ${this.onlineUserIds.length} 个`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log('PeopleLobbyManager: 获取在线用户时出错: ' + error, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('无法加载在线用户列表。', 'error');
            this.onlineUserIds = []; // 即使出错也清空，避免显示旧数据
            return false;
        } finally {
            this.isLoading = false;
            if(this.refreshButtonEl) this.refreshButtonEl.classList.remove('loading'); // 移除加载状态
        }
    },

    /**
     * @description 渲染人员大厅列表。
     */
    renderLobby: function() {
        if (!this.peopleLobbyListEl) {
            Utils.log('PeopleLobbyManager: 未找到人员大厅列表元素。', Utils.logLevels.ERROR);
            return;
        }
        this.peopleLobbyListEl.innerHTML = ''; // 清空现有列表

        if (this.onlineUserIds.length === 0 && !this.isLoading) { // 仅在非加载状态下显示空状态
            const emptyLi = document.createElement('li');
            emptyLi.className = 'chat-list-item-empty'; // 复用样式
            emptyLi.textContent = '当前无其他在线用户。';
            this.peopleLobbyListEl.appendChild(emptyLi);
            return;
        }
        if (this.isLoading) { // 如果正在加载，显示加载提示
            const loadingLi = document.createElement('li');
            loadingLi.className = 'chat-list-item-empty';
            loadingLi.textContent = '正在加载在线用户...';
            this.peopleLobbyListEl.appendChild(loadingLi);
            return;
        }


        this.onlineUserIds.forEach(userId => {
            const contact = UserManager.contacts[userId];
            const li = document.createElement('li');
            li.className = 'chat-list-item'; // 复用样式
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

        // 初始渲染时显示加载中，然后获取数据并重新渲染
        this.isLoading = true; // 先设置加载状态
        this.renderLobby(); // 渲染加载提示
        this.lobbyContainerEl.style.display = 'flex';

        const success = await this.fetchOnlineUsers();
        // fetchOnlineUsers 内部会处理 isLoading 状态的重置
        // 无论 fetch 是否成功，都需要重新渲染以反映最新状态（或空状态/错误状态）
        this.renderLobby();

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
        // 显示加载状态并重新获取数据
        this.isLoading = true;
        this.renderLobby(); // 渲染加载提示

        const success = await this.fetchOnlineUsers();
        // fetchOnlineUsers 内部会处理 isLoading 状态的重置
        this.renderLobby(); // 重新渲染列表（成功或失败）
    }
};