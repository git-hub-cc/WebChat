const ChatManager = {
    currentChatId: null,
    chats: {}, // { chatId: [messages] }
    currentFilter: 'all', // 'all', 'contacts', 'groups'

    init: async function() {
        await this.loadChats();
        this.renderChatList(this.currentFilter); // Initial render
    },

    loadChats: async function() {
        try {
            await DBManager.init();
            const chatItems = await DBManager.getAllItems('chats');
            this.chats = {};
            if (chatItems && chatItems.length > 0) {
                chatItems.forEach(item => {
                    this.chats[item.id] = item.messages || [];
                });
            }
        } catch (error) {
            Utils.log(`加载聊天记录失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveCurrentChat: async function() {
        if (this.currentChatId && this.chats[this.currentChatId]) {
            try {
                await DBManager.setItem('chats', {
                    id: this.currentChatId,
                    messages: this.chats[this.currentChatId]
                });
            } catch (error) {
                Utils.log(`保存当前聊天记录失败 (${this.currentChatId}): ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    renderChatList: function(filter = 'all') {
        this.currentFilter = filter;
        const chatListEl = document.getElementById('chatListNav');
        chatListEl.innerHTML = '';

        UIManager.setActiveTab(filter);

        let itemsToRender = [];

        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                itemsToRender.push({
                    id: contact.id,
                    name: contact.name,
                    avatarText: contact.name.charAt(0).toUpperCase(),
                    lastMessage: contact.lastMessage || 'No messages yet',
                    lastTime: contact.lastTime,
                    unread: contact.unread || 0,
                    type: 'contact',
                    online: ConnectionManager.isConnectedTo(contact.id) // Key for green dot
                });
            });
        }

        if (filter === 'all' || filter === 'groups') {
            Object.values(GroupManager.groups).forEach(group => {
                itemsToRender.push({
                    id: group.id,
                    name: group.name,
                    avatarText: '👥',
                    lastMessage: group.lastMessage || `Members: ${group.members.length}`,
                    lastTime: group.lastTime,
                    unread: group.unread || 0,
                    type: 'group'
                    // 'online' status is not typically directly applicable to groups in the same way
                });
            });
        }

        itemsToRender.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));


        const searchQuery = document.getElementById('chatSearchInput').value.toLowerCase();
        if (searchQuery) {
            itemsToRender = itemsToRender.filter(item => item.name.toLowerCase().includes(searchQuery));
        }

        if (itemsToRender.length === 0) {
            chatListEl.innerHTML = `<li class="chat-list-item-empty">No ${filter !== 'all' ? filter : 'chats'} found.</li>`;
            return;
        }

        itemsToRender.forEach(item => {
            const li = document.createElement('li');
            li.className = `chat-list-item ${item.id === this.currentChatId ? 'active' : ''} ${item.type === 'group' ? 'group' : ''}`;
            li.setAttribute('data-id', item.id);
            li.setAttribute('data-type', item.type);

            const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';
            let statusIndicator = '';
            if (item.type === 'contact' && item.online) { // Check 'online' property
                statusIndicator = '<span class="online-dot" title="Connected"></span>';
            }

            li.innerHTML = `
                <div class="chat-list-avatar">${item.avatarText}</div>
                <div class="chat-list-info">
                    <div class="chat-list-name">${Utils.escapeHtml(item.name)} ${statusIndicator}</div>
                    <div class="chat-list-preview">${Utils.escapeHtml(item.lastMessage)}</div>
                </div>
                <div class="chat-list-meta">
                    <div class="chat-list-time">${formattedTime}</div>
                    ${item.unread > 0 ? `<div class="chat-list-badge">${item.unread > 99 ? '99+' : item.unread}</div>` : ''}
                </div>
            `;
            li.addEventListener('click', () => this.openChat(item.id, item.type));
            chatListEl.appendChild(li);
        });
    },

    openChat: function(chatId, type) {
        if (this.currentChatId) {
            this.saveCurrentChat(); // Save previous chat before switching
            const prevActive = document.querySelector(`#chatListNav .chat-list-item.active`);
            if (prevActive) prevActive.classList.remove('active');
        }

        this.currentChatId = chatId;
        UIManager.showChatArea(); // Make chat area visible (handles mobile view)

        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active');

        if (type === 'group') {
            GroupManager.openGroup(chatId);
        } else { // Contact
            const contact = UserManager.contacts[chatId];
            if (contact) {
                UIManager.updateChatHeader(contact.name, ConnectionManager.isConnectedTo(chatId) ? 'Connected' : `ID: ${contact.id.substring(0,8)}... (Offline)`, contact.name.charAt(0).toUpperCase());
                UserManager.clearUnread(chatId); // Clear unread for this contact
                UIManager.setCallButtonsState(ConnectionManager.isConnectedTo(chatId), chatId);
            }
            // Hide group-specific elements in details panel
            const detailsGroupManagement = document.getElementById('detailsGroupManagement');
            if (detailsGroupManagement) detailsGroupManagement.style.display = 'none';
            const groupActionsDetails = document.getElementById('groupActionsDetails');
            if (groupActionsDetails) groupActionsDetails.style.display = 'none';
        }

        UIManager.enableChatInterface(true); // Enable input, send button etc.
        this.loadChatHistory(chatId);

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = ''; // Clear message input
            messageInput.style.height = 'auto'; // Reset height
            setTimeout(() => messageInput.focus(), 0); // Focus after UI updates
        }

        UIManager.toggleDetailsPanel(false); // Close details panel if open
        UIManager.updateDetailsPanel(chatId, type); // Update details panel for the new chat
    },

    loadChatHistory: function(chatId) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) {
            Utils.log("ChatManager.loadChatHistory: chatBox element NOT FOUND!", Utils.logLevels.ERROR);
            return;
        }
        chatBox.innerHTML = ''; // Clear previous messages

        const messages = this.chats[chatId] || [];
        if (messages.length === 0 && chatId) { // Check if chatId is valid
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            placeholder.textContent = "No messages yet. Start the conversation!";
            if(chatId.startsWith('group_') && GroupManager.groups[chatId]?.owner === UserManager.userId && GroupManager.groups[chatId]?.members.length === 1) {
                placeholder.textContent = "You created this group. Invite members to start chatting!";
            }
            chatBox.appendChild(placeholder);
        } else {
            messages.forEach(msg => {
                MessageManager.displayMessage(msg, msg.sender === UserManager.userId || msg.originalSender === UserManager.userId);
            });
        }
        chatBox.scrollTop = chatBox.scrollHeight; // Scroll to bottom
    },

    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) {
            this.chats[chatId] = [];
        }
        // Simple duplicate check for last message (can be more sophisticated)
        const lastMsg = this.chats[chatId][this.chats[chatId].length - 1];
        if (lastMsg && lastMsg.timestamp === message.timestamp && lastMsg.content === message.content && lastMsg.sender === message.sender) {
            // Utils.log(`Duplicate message detected for chat ${chatId}. Skipping add.`, Utils.logLevels.DEBUG);
            // return; // Optional: Prevent adding exact duplicates received too close
        }

        this.chats[chatId].push(message);

        if (chatId === this.currentChatId) {
            const chatBoxEl = document.getElementById('chatBox'); // Re-fetch for safety
            if (chatBoxEl) {
                const noMsgPlaceholder = chatBoxEl.querySelector('.system-message');
                if(noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("No messages yet") || noMsgPlaceholder.textContent.includes("You created this group"))) {
                    noMsgPlaceholder.remove();
                }
            }
            MessageManager.displayMessage(message, message.sender === UserManager.userId || message.originalSender === UserManager.userId);
            if (chatBoxEl) chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
        }

        const isGroup = chatId.startsWith('group_');
        // Increment unread if chat is not current or document doesn't have focus
        const isUnread = chatId !== this.currentChatId || !document.hasFocus();

        if (isGroup) {
            const group = GroupManager.groups[chatId];
            if (group) {
                let previewText = GroupManager.formatMessagePreview(message);
                await GroupManager.updateGroupLastMessage(chatId, previewText, isUnread);
            }
        } else { // Contact
            const contact = UserManager.contacts[chatId];
            if (contact) {
                let previewText = UserManager.formatMessagePreview(message);
                await UserManager.updateContactLastMessage(chatId, previewText, isUnread);
            }
        }

        // Save to DB
        try {
            await DBManager.setItem('chats', { id: chatId, messages: this.chats[chatId] });
        } catch (error) {
            Utils.log(`保存消息到DB失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
        }
    },

    clearChat: async function(chatId) {
        if (chatId && this.chats[chatId]) {
            this.chats[chatId] = [];
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] }); // Save empty messages
                if (chatId === this.currentChatId) {
                    this.loadChatHistory(chatId); // Reload history (will show placeholder)
                }
                // Update last message in contact/group list
                if (chatId.startsWith('group_')) {
                    GroupManager.updateGroupLastMessage(chatId, 'Chat cleared', false, true);
                } else {
                    UserManager.updateContactLastMessage(chatId, 'Chat cleared', false, true);
                }
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                // Attempt to reload UI even if DB fails
                if (chatId === this.currentChatId) {
                    this.loadChatHistory(chatId);
                }
                return false; // Indicate failure
            }
        }
        return false; // Chat not found or no messages
    },

    clearAllChats: async function() {
        UIManager.showConfirmationModal(
            'Are you sure you want to clear ALL chat history? This cannot be undone.',
            async () => { // onConfirm
                this.chats = {}; // Clear in-memory chats
                try {
                    await DBManager.clearStore('chats'); // Clear DB store
                    if (this.currentChatId) { // If a chat is open, reload its history
                        this.loadChatHistory(this.currentChatId);
                    }
                    // Reset last message for all contacts and groups
                    Object.values(UserManager.contacts).forEach(c => UserManager.updateContactLastMessage(c.id, 'Chat cleared', false, true));
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, 'Chat cleared', false, true));

                    this.renderChatList(this.currentFilter); // Re-render chat list
                    UIManager.showNotification('All chat history cleared.', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    UIManager.showNotification('Failed to clear all chat history from database.', 'error');
                }
            }
        );
    },

    deleteChat: function(chatId, type) {
        const entity = type === 'group' ? GroupManager.groups[chatId] : UserManager.contacts[chatId];
        if (!entity) {
            UIManager.showNotification(`${type === 'group' ? 'Group' : 'Contact'} not found.`, 'error');
            return;
        }
        const entityName = entity.name;
        let confirmMessage = `Are you sure you want to delete contact "${entityName}"? All associated messages will be lost.`;
        if (type === 'group') {
            confirmMessage = `Are you sure you want to ${entity.owner === UserManager.userId ? 'dissolve this group' : 'leave this group'} ("${entityName}")? All associated messages will be lost.`;
        }


        UIManager.showConfirmationModal(
            confirmMessage,
            async () => { // onConfirm
                await this.clearChat(chatId); // Clear messages first for this chat

                if (type === 'group') {
                    if (entity.owner === UserManager.userId) { // Dissolve if owner
                        await GroupManager.dissolveGroup(chatId);
                    } else { // Leave if member
                        await GroupManager.leaveGroup(chatId);
                    }
                } else { // Contact
                    await UserManager.removeContact(chatId); // Removes from contacts DB and closes connection
                }

                if (chatId === this.currentChatId) { // If the deleted chat was open
                    this.currentChatId = null;
                    UIManager.showNoChatSelected();
                    UIManager.enableChatInterface(false);
                }
                this.renderChatList(this.currentFilter); // Re-render chat list
            }
        );
    },
};