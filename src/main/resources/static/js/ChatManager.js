
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
                    avatarText: contact.avatarText || (contact.isSpecial ? 'S' : contact.name.charAt(0).toUpperCase()),
                    avatarUrl: contact.avatarUrl || null, // Pass avatarUrl
                    lastMessage: contact.lastMessage || (contact.isSpecial ? 'Ready to chat!' : 'No messages yet'),
                    lastTime: contact.lastTime,
                    unread: contact.unread || 0,
                    type: 'contact',
                    online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id), // Special contacts always "online" for UI
                    isSpecial: contact.isSpecial || false
                });
            });
        }

        if (filter === 'all' || filter === 'groups') {
            Object.values(GroupManager.groups).forEach(group => {
                itemsToRender.push({
                    id: group.id,
                    name: group.name,
                    avatarText: '👥', // Groups use text avatar
                    avatarUrl: null,  // Groups don't have image avatars in this setup
                    lastMessage: group.lastMessage || `Members: ${group.members.length}`,
                    lastTime: group.lastTime,
                    unread: group.unread || 0,
                    type: 'group'
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
            if (item.isSpecial) {
                li.classList.add('special-contact', item.id); // Add item.id as class for special contacts
            }
            li.setAttribute('data-id', item.id);
            li.setAttribute('data-type', item.type);

            const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';
            let statusIndicator = '';
            if (item.type === 'contact' && (item.online || UserManager.isSpecialContact(item.id))) {
                statusIndicator = '<span class="online-dot" title="Connected"></span>';
            }

            let avatarContentHtml = '';
            const avatarClass = `chat-list-avatar ${item.isSpecial ? item.id : ''}`; // Add item.id for special contact avatar styling
            if (item.avatarUrl) {
                avatarContentHtml = `<img src="${item.avatarUrl}" alt="${Utils.escapeHtml(item.name.charAt(0))}" class="avatar-image">`;
            } else {
                avatarContentHtml = Utils.escapeHtml(item.avatarText);
            }

            li.innerHTML = `
                <div class="${avatarClass}">${avatarContentHtml}</div>
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
            this.saveCurrentChat();
            const prevActive = document.querySelector(`#chatListNav .chat-list-item.active`);
            if (prevActive) prevActive.classList.remove('active');
        }

        this.currentChatId = chatId;
        UIManager.showChatArea();

        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active');

        if (type === 'group') {
            GroupManager.openGroup(chatId);
        } else {
            const contact = UserManager.contacts[chatId];
            if (contact) {
                if (contact.isSpecial) {
                    UIManager.updateChatHeader(contact.name, (contact.isAI ? 'AI Assistant' : 'Special Contact'), contact.avatarText || 'S');
                    UIManager.setCallButtonsState(false);
                } else {
                    UIManager.updateChatHeader(contact.name, ConnectionManager.isConnectedTo(chatId) ? 'Connected' : `ID: ${contact.id.substring(0,8)}... (Offline)`, contact.name.charAt(0).toUpperCase());
                    UIManager.setCallButtonsState(ConnectionManager.isConnectedTo(chatId), chatId);
                }
                UserManager.clearUnread(chatId);
            }
            document.getElementById('detailsGroupManagement').style.display = 'none';
            document.getElementById('groupActionsDetails').style.display = 'none';
        }

        UIManager.enableChatInterface(true);
        this.loadChatHistory(chatId);

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            setTimeout(() => messageInput.focus(), 0);
        }

        UIManager.toggleDetailsPanel(false);
        UIManager.updateDetailsPanel(chatId, type);
    },

    loadChatHistory: function(chatId) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) {
            Utils.log("ChatManager.loadChatHistory: chatBox element NOT FOUND!", Utils.logLevels.ERROR);
            return;
        }
        chatBox.innerHTML = '';

        const messages = this.chats[chatId] || [];
        const contact = UserManager.contacts[chatId];

        if (messages.length === 0 && chatId) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            if (contact && contact.isSpecial) {
                placeholder.textContent = `Start a conversation with ${contact.name}!`;
            } else if(chatId.startsWith('group_') && GroupManager.groups[chatId]?.owner === UserManager.userId && GroupManager.groups[chatId]?.members.length === 1) {
                placeholder.textContent = "You created this group. Invite members to start chatting!";
            } else {
                placeholder.textContent = "No messages yet. Start the conversation!";
            }
            chatBox.appendChild(placeholder);
        } else {
            messages.forEach(msg => {
                MessageManager.displayMessage(msg, msg.sender === UserManager.userId || msg.originalSender === UserManager.userId);
            });
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) {
            this.chats[chatId] = [];
        }
        // Simple duplicate check (can be improved)
        const lastMsg = this.chats[chatId][this.chats[chatId].length - 1];
        if (lastMsg && lastMsg.timestamp === message.timestamp && lastMsg.content === message.content && lastMsg.sender === message.sender) {
            // Utils.log(`Duplicate message detected for chat ${chatId}. Skipping.`, Utils.logLevels.DEBUG);
            // return; // Commented out as it might be too aggressive
        }


        this.chats[chatId].push(message);

        if (chatId === this.currentChatId) {
            const chatBoxEl = document.getElementById('chatBox');
            if (chatBoxEl) {
                const noMsgPlaceholder = chatBoxEl.querySelector('.system-message');
                if(noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("No messages yet") || noMsgPlaceholder.textContent.includes("You created this group") || noMsgPlaceholder.textContent.includes("Start a conversation with"))) {
                    noMsgPlaceholder.remove();
                }
            }
            if (!message.isThinking) {
                MessageManager.displayMessage(message, message.sender === UserManager.userId || message.originalSender === UserManager.userId);
            }
            if (chatBoxEl) chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
        }

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== this.currentChatId || !document.hasFocus();

        if (isGroup) {
            const group = GroupManager.groups[chatId];
            if (group) {
                let previewText = GroupManager.formatMessagePreview(message);
                await GroupManager.updateGroupLastMessage(chatId, previewText, isUnread);
            }
        } else {
            const contact = UserManager.contacts[chatId];
            if (contact) {
                let previewText = UserManager.formatMessagePreview(message);
                await UserManager.updateContactLastMessage(chatId, previewText, isUnread);
            }
        }

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
                await DBManager.setItem('chats', { id: chatId, messages: [] });
                if (chatId === this.currentChatId) {
                    this.loadChatHistory(chatId);
                }
                if (chatId.startsWith('group_')) {
                    GroupManager.updateGroupLastMessage(chatId, 'Chat cleared', false, true);
                } else {
                    UserManager.updateContactLastMessage(chatId, 'Chat cleared', false, true);
                }
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                if (chatId === this.currentChatId) { // Attempt to reload even on error to reflect memory state
                    this.loadChatHistory(chatId);
                }
                return false;
            }
        }
        return false;
    },

    clearAllChats: async function() {
        UIManager.showConfirmationModal(
            'Are you sure you want to clear ALL chat history? This cannot be undone.',
            async () => {
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {};
                try {
                    for (const id of chatIdsToClear) {
                        await DBManager.setItem('chats', { id: id, messages: [] });
                    }

                    Object.values(UserManager.contacts).forEach(c => {
                        if (c.isSpecial) {
                            const specialDef = UserManager.SPECIAL_CONTACTS_DEFINITIONS.find(sd => sd.id === c.id);
                            UserManager.updateContactLastMessage(c.id, specialDef ? specialDef.initialMessage : 'Chat cleared', false, true);
                        } else {
                            UserManager.updateContactLastMessage(c.id, 'Chat cleared', false, true);
                        }
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, 'Chat cleared', false, true));


                    if (this.currentChatId) {
                        this.loadChatHistory(this.currentChatId);
                    }

                    this.renderChatList(this.currentFilter);
                    UIManager.showNotification('All chat history cleared.', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    UIManager.showNotification('Failed to clear all chat history from database.', 'error');
                    await this.loadChats(); // Potentially reload chats from DB to revert memory state
                    this.renderChatList(this.currentFilter);
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

        if (type === 'contact' && entity.isSpecial) {
            UIManager.showNotification(`${entity.name} is a built-in contact and cannot be deleted. You can clear the chat history if needed.`, 'warning');
            return;
        }

        const entityName = entity.name;
        let confirmMessage = `Are you sure you want to delete contact "${entityName}"? All associated messages will be lost.`;
        if (type === 'group') {
            confirmMessage = `Are you sure you want to ${entity.owner === UserManager.userId ? 'dissolve this group' : 'leave this group'} ("${entityName}")? All associated messages will be lost.`;
        }

        UIManager.showConfirmationModal(
            confirmMessage,
            async () => {
                await this.clearChat(chatId); // Clear chat history first

                if (type === 'group') {
                    if (entity.owner === UserManager.userId) {
                        await GroupManager.dissolveGroup(chatId);
                    } else {
                        await GroupManager.leaveGroup(chatId);
                    }
                } else {
                    await UserManager.removeContact(chatId);
                }

                if (chatId === this.currentChatId) {
                    this.currentChatId = null;
                    UIManager.showNoChatSelected();
                    UIManager.enableChatInterface(false);
                }
                this.renderChatList(this.currentFilter);
            }
        );
    },
};