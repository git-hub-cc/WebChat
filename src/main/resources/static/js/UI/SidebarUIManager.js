/**
 * @file SidebarUIManager.js
 * @description 侧边栏 UI 管理器，负责管理应用左侧边栏内的所有 UI 元素和交互。
 *              包括顶部的标签页（全部、联系人、群组）、搜索框，以及更新聊天列表项的状态（如在线状态）。
 * @module SidebarUIManager
 * @exports {object} SidebarUIManager - 对外暴露的单例对象，包含管理侧边栏 UI 的方法。
 * @property {function} init - 初始化模块，获取 DOM 元素并绑定事件。
 * @property {function} setActiveTab - 设置并高亮显示当前活动的标签页。
 * @property {function} filterChatList - 根据搜索框的输入触发聊天列表的重新渲染。
 * @property {function} updateChatListItemStatus - 更新指定联系人在列表中的在线状态指示器。
 * @dependencies ChatManager, UserManager, GroupManager
 * @dependents AppInitializer (进行初始化), ChatManager (设置活动标签), EventEmitter (用于更新状态)
 */
const SidebarUIManager = {
    chatSearchInputEl: null, // 聊天搜索输入框
    tabAllChatsEl: null,     // “全部”标签页
    tabContactsEl: null,   // “联系人”标签页
    tabGroupsEl: null,     // “群组”标签页

    /**
     * 初始化模块，获取所有需要的 DOM 元素引用并绑定核心事件。
     */
    init: function() {
        this.chatSearchInputEl = document.getElementById('chatSearchInput');
        this.tabAllChatsEl = document.getElementById('tabAllChats');
        this.tabContactsEl = document.getElementById('tabContacts');
        this.tabGroupsEl = document.getElementById('tabGroups');

        this.bindEvents(); // 绑定事件
    },

    /**
     * 绑定侧边栏内的 UI 事件监听器。
     */
    bindEvents: function() {
        // 绑定标签页点击事件，触发 ChatManager 重新渲染列表
        if (this.tabAllChatsEl) this.tabAllChatsEl.addEventListener('click', () => ChatManager.renderChatList('all'));
        if (this.tabContactsEl) this.tabContactsEl.addEventListener('click', () => UserManager.renderContactListForSidebar());
        if (this.tabGroupsEl) this.tabGroupsEl.addEventListener('click', () => GroupManager.renderGroupListForSidebar());

        // 绑定搜索框的输入事件
        if (this.chatSearchInputEl) this.chatSearchInputEl.addEventListener('input', (e) => this.filterChatList(e.target.value));
    },

    /**
     * 设置并高亮显示当前活动的标签页。
     * @param {string} tabName - 要激活的标签页名称 ('all', 'contacts', 'groups')。
     */
    setActiveTab: function (tabName) {
        // 移除所有标签页的激活状态
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));
        let targetTabId = ''; // 目标标签页的ID
        // 根据名称确定ID
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active'); // 添加激活状态
    },

    /**
     * 根据搜索查询触发聊天列表的筛选。
     * 实际的筛选逻辑由 ChatManager.renderChatList 处理。
     * @param {string} query - 搜索框中的查询字符串。
     */
    filterChatList: function (query) {
        // 调用 ChatManager 重新渲染列表，它会使用当前的过滤器和搜索查询
        ChatManager.renderChatList(ChatManager.currentFilter);
    },

    /**
     * 更新指定联系人在聊天列表中的在线状态指示器。
     * @param {string} peerId - 要更新状态的联系人 ID。
     * @param {boolean} isConnected - 是否已连接。
     */
    updateChatListItemStatus: function (peerId, isConnected) {
        const itemEl = document.querySelector(`.chat-list-item[data-id="${peerId}"]`); // 查找列表项
        if (itemEl && itemEl.dataset.type === 'contact') { // 确保是联系人项
            // 特殊联系人（包括主题AI和非AI）总是显示为在线（或由其自身逻辑决定），无需此通用状态更新
            if (UserManager.isSpecialContact(peerId)) return;

            const nameEl = itemEl.querySelector('.chat-list-name'); // 查找名称元素
            if (nameEl) {
                let onlineDot = nameEl.querySelector('.online-dot'); // 查找在线状态点
                if (isConnected) { // 如果已连接
                    if (!onlineDot) { // 如果点不存在，则创建
                        onlineDot = document.createElement('span');
                        onlineDot.className = 'online-dot';
                        onlineDot.title = "已连接";
                        nameEl.appendChild(onlineDot);
                    }
                    onlineDot.style.display = 'inline-block'; // 显示点
                } else { // 如果未连接
                    if (onlineDot) onlineDot.style.display = 'none'; // 隐藏点
                }
            }
        }
    }
};