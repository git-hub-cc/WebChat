// 新文件: SidebarUIManager.js (已翻译)
// 职责:
// - 管理侧边栏内的 UI 元素和交互（标签页、搜索、聊天列表项状态）。
// - 根据筛选/搜索条件触发 ChatManager 重新渲染列表。
const SidebarUIManager = {
    chatSearchInputEl: null,
    tabAllChatsEl: null,
    tabContactsEl: null,
    tabGroupsEl: null,

    init: function() {
        this.chatSearchInputEl = document.getElementById('chatSearchInput');
        this.tabAllChatsEl = document.getElementById('tabAllChats');
        this.tabContactsEl = document.getElementById('tabContacts');
        this.tabGroupsEl = document.getElementById('tabGroups');

        this.bindEvents();
    },

    bindEvents: function() {
        if (this.tabAllChatsEl) this.tabAllChatsEl.addEventListener('click', () => ChatManager.renderChatList('all'));
        if (this.tabContactsEl) this.tabContactsEl.addEventListener('click', () => UserManager.renderContactListForSidebar()); // 调用特定的用户/群组管理器渲染方法
        if (this.tabGroupsEl) this.tabGroupsEl.addEventListener('click', () => GroupManager.renderGroupListForSidebar()); // 调用特定的用户/群组管理器渲染方法

        if (this.chatSearchInputEl) this.chatSearchInputEl.addEventListener('input', (e) => this.filterChatList(e.target.value));
    },

    setActiveTab: function (tabName) { // tabName: 'all' (全部), 'contacts' (联系人), 'groups' (群组)
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));
        let targetTabId = '';
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active');
    },

    filterChatList: function (query) {
        // ChatManager.renderChatList 负责实际的筛选逻辑
        ChatManager.renderChatList(ChatManager.currentFilter);
    },

    updateChatListItemStatus: function (peerId, isConnected) {
        const itemEl = document.querySelector(`.chat-list-item[data-id="${peerId}"]`);
        if (itemEl && itemEl.dataset.type === 'contact') {
            if (UserManager.isSpecialContact(peerId)) return;

            const nameEl = itemEl.querySelector('.chat-list-name');
            if (nameEl) {
                let onlineDot = nameEl.querySelector('.online-dot');
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
            // 如果是当前聊天，更新头部状态由 ChatAreaUIManager 处理
        }
    }
};