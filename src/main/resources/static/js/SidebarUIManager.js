// NEW FILE: SidebarUIManager.js
// Responsibilities:
// - Managing UI elements and interactions within the sidebar (tabs, search, chat list item status).
// - Triggering ChatManager to re-render the list based on filters/search.
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
        if (this.tabContactsEl) this.tabContactsEl.addEventListener('click', () => UserManager.renderContactListForSidebar()); // Calls specific User/Group manager render
        if (this.tabGroupsEl) this.tabGroupsEl.addEventListener('click', () => GroupManager.renderGroupListForSidebar()); // Calls specific User/Group manager render

        if (this.chatSearchInputEl) this.chatSearchInputEl.addEventListener('input', (e) => this.filterChatList(e.target.value));
    },

    setActiveTab: function (tabName) { // tabName: 'all', 'contacts', 'groups'
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));
        let targetTabId = '';
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active');
    },

    filterChatList: function (query) {
        // ChatManager.renderChatList handles the actual filtering logic
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
                        onlineDot.title = "Connected";
                        nameEl.appendChild(onlineDot);
                    }
                    onlineDot.style.display = 'inline-block';
                } else {
                    if (onlineDot) onlineDot.style.display = 'none';
                }
            }
            // Updating header status is handled by ChatAreaUIManager if it's the current chat
        }
    }
};