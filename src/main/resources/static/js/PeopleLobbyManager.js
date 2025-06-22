/**
 * @file PeopleLobbyManager.js
 * @description 管理人员大厅的 UI 和逻辑，包括获取在线用户、渲染列表及处理用户交互。
 * @module PeopleLobbyManager
 * @exports {object} PeopleLobbyManager - 对外暴露的单例对象。
 * @property {function} init - 初始化模块。
 * @property {function} show - 显示人员大厅并获取最新数据。
 * @property {function} hide - 隐藏人员大厅。
 * @property {function} isVisible - 检查人员大厅是否可见。
 * @dependencies UserManager, Utils, NotificationUIManager, ModalUIManager, Config, EventEmitter
 */
const PeopleLobbyManager = {
    onlineUserIds: [], // 存储在线用户ID的数组
    lobbyContainerEl: null,    // 人员大厅的容器元素 (#peopleLobbyContent)
    peopleLobbyListEl: null,   // 显示用户列表的 ul 元素 (#peopleLobbyList)
    refreshButtonEl: null,     // 刷新按钮的引用
    isLoading: false,          // 标记是否正在加载数据

    /**
     * 初始化人员大厅管理器。
     */
    init: function() {
        this.lobbyContainerEl = document.getElementById('peopleLobbyContent');
        this.peopleLobbyListEl = document.getElementById('peopleLobbyList');
        this.refreshButtonEl = document.getElementById('peopleLobbyRefreshBtn'); // 获取刷新按钮
        if (this.refreshButtonEl) { // 绑定刷新按钮事件
            this.refreshButtonEl.addEventListener('click', this.handleRefreshLobby.bind(this));
        }
    },

    /**
     * @description 从服务器获取在线用户ID列表。
     * @returns {Promise<boolean>} - 是否成功获取数据。
     */
    fetchOnlineUsers: async function() {
        if(this.refreshButtonEl) this.refreshButtonEl.classList.add('loading'); // 添加加载状态样式
        Utils.log('PeopleLobbyManager: 开始获取在线用户...', Utils.logLevels.INFO);
        try {
            // 使用 Config 中定义的人员大厅API端点
            const lobbyApiUrl = Config.server.lobbyApiEndpoint;
            if (!lobbyApiUrl) {
                throw new Error("人员大厅API端点未配置。");
            }

            const response = await fetch(lobbyApiUrl); // 发送请求
            if (!response.ok) { // 检查响应状态
                const errorText = await response.text();
                throw new Error(`获取在线用户失败: ${response.status} - ${errorText.substring(0, 100)}`);
            }
            const userIds = await response.json(); // 解析JSON响应
            // 过滤掉当前用户自己
            this.onlineUserIds = Array.isArray(userIds) ? userIds.filter(id => id !== UserManager.userId) : [];
            Utils.log(`PeopleLobbyManager: 成功获取在线用户: ${this.onlineUserIds.length} 个`, Utils.logLevels.INFO);

            // 触发事件，通知其他模块在线用户列表已更新
            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.emit('onlineUsersUpdated', [...this.onlineUserIds]);
            }

            return true;
        } catch (error) {
            Utils.log('PeopleLobbyManager: 获取在线用户时出错: ' + error, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('无法加载在线用户列表。', 'error');
            this.onlineUserIds = []; // 出错时清空列表
            if (typeof EventEmitter !== 'undefined') { // 即使出错也触发事件，以便UI可以更新为空状态
                EventEmitter.emit('onlineUsersUpdated', []);
            }
            return false;
        } finally {
            this.isLoading = false; // 重置加载状态
            if(this.refreshButtonEl) this.refreshButtonEl.classList.remove('loading'); // 移除加载状态样式
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

        if (this.isLoading) { // 如果正在加载，显示加载提示
            const loadingLi = document.createElement('li');
            loadingLi.className = 'chat-list-item-empty';
            loadingLi.textContent = '正在加载在线用户...';
            this.peopleLobbyListEl.appendChild(loadingLi);
            return;
        }

        if (this.onlineUserIds.length === 0) { // 如果没有在线用户
            const emptyLi = document.createElement('li');
            emptyLi.className = 'chat-list-item-empty'; // 复用聊天列表的空状态样式
            emptyLi.textContent = '当前无其他在线用户。';
            this.peopleLobbyListEl.appendChild(emptyLi);
            return;
        }

        // 遍历在线用户并创建列表项
        this.onlineUserIds.forEach(userId => {
            const contact = UserManager.contacts[userId]; // 检查是否已是联系人
            const li = document.createElement('li');
            li.className = 'chat-list-item'; // 复用聊天列表项样式
            li.setAttribute('data-id', userId);

            const isAlreadyContact = !!contact;
            const name = contact ? contact.name : `用户 ${userId.substring(0, 6)}...`; // 显示名称或部分ID
            const avatarText = contact ? (contact.avatarText || name.charAt(0).toUpperCase()) : userId.charAt(0).toUpperCase();
            const avatarUrl = contact ? contact.avatarUrl : null;

            // 构建头像HTML
            let avatarContentHtml;
            if (avatarUrl) {
                avatarContentHtml = `<img src="${avatarUrl}" alt="${Utils.escapeHtml(avatarText)}" class="avatar-image" data-fallback-text="${Utils.escapeHtml(avatarText)}" data-entity-id="${userId}">`;
            } else {
                avatarContentHtml = Utils.escapeHtml(avatarText);
            }

            // 构建列表项HTML
            li.innerHTML = `
    <div class="chat-list-avatar">${avatarContentHtml}</div>
<div class="chat-list-info">
    <div class="chat-list-name">${Utils.escapeHtml(name)}</div>
    <div class="chat-list-preview">${isAlreadyContact ? '已是联系人' : '点击添加'}</div>
</div>
${isAlreadyContact ? `<div class="chat-list-meta"><span class="chat-list-badge" style="background-color: var(--accent-color); color: white;">✓</span></div>` : ''}
`; // 如果已是联系人，显示一个标记

            li.addEventListener('click', () => this.handleLobbyUserClick(userId)); // 绑定点击事件
            this.peopleLobbyListEl.appendChild(li);
        });
    },

    /**
     * @description 处理人员大厅中用户项的点击事件。
     * @param {string} userId - 被点击用户的ID。
     */
    handleLobbyUserClick: function(userId) {
        Utils.log(`PeopleLobbyManager: 点击了大厅用户 ${userId}`, Utils.logLevels.DEBUG);
        // 调用 ModalUIManager 显示添加联系人模态框并预填ID
        ModalUIManager.showAddContactModalWithId(userId);
    },

    /**
     * @description 显示人员大厅。
     * @returns {Promise<void>}
     */
    show: async function() {
        if (!this.lobbyContainerEl) return; // 防御性检查

        this.isLoading = true; // 设置加载状态
        this.renderLobby(); // 初始渲染（会显示加载中）
        this.lobbyContainerEl.style.display = 'flex'; // 显示容器

        await this.fetchOnlineUsers(); // 获取最新数据
        // fetchOnlineUsers 内部会重置 isLoading
        this.renderLobby(); // 重新渲染列表（显示数据或空状态）

        Utils.log('PeopleLobbyManager: 人员大厅已显示。', Utils.logLevels.INFO);
    },

    /**
     * @description 隐藏人员大厅。
     */
    hide: function() {
        if (this.lobbyContainerEl) {
            this.lobbyContainerEl.style.display = 'none'; // 隐藏容器
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
        this.isLoading = true; // 设置加载状态
        this.renderLobby(); // 渲染加载提示
        await this.fetchOnlineUsers(); // 获取数据
        this.renderLobby(); // 重新渲染列表
    }
};