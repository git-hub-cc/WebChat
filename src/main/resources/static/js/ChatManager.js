// MODIFIED: ChatManager.js (已翻译为中文)
// - 对 UIManager 的面板更新调用现在转到 DetailsPanelUIManager。
// - 对 UIManager 的聊天区域更新调用现在转到 ChatAreaUIManager。
// - 对 UIManager 的侧边栏更新调用现在转到 SidebarUIManager。
const ChatManager = {
    currentChatId: null,
    chats: {}, // { chatId: [messages] }
    currentFilter: 'all', // 'all', 'contacts', 'groups'

    init: async function() {
        await this.loadChats();
        this.renderChatList(this.currentFilter); // 初始渲染
    },

    loadChats: async function() {
        try {
            await DBManager.init();
            const chatItems = await DBManager.getAllItems('chats');
            this.chats = {};
            if (chatItems && chatItems.length > 0) {
                chatItems.forEach(item => {
                    this.chats[item.id] = Array.isArray(item.messages) ? item.messages : [];
                });
            }
        } catch (error) {
            Utils.log(`加载聊天记录失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveCurrentChat: async function() {
        if (this.currentChatId && this.chats[this.currentChatId]) {
            try {
                const messagesForDb = this.chats[this.currentChatId].map(msg => {
                    const msgCopy = { ...msg };
                    delete msgCopy.isNewlyCompletedAIResponse;
                    return msgCopy;
                });
                await DBManager.setItem('chats', {
                    id: this.currentChatId,
                    messages: messagesForDb
                });
            } catch (error) {
                Utils.log(`保存当前聊天记录失败 (${this.currentChatId}): ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    renderChatList: function(filter = 'all') {
        this.currentFilter = filter;
        const chatListEl = document.getElementById('chatListNav');
        if(!chatListEl) {
            Utils.log("ChatManager.renderChatList: 未找到 chatListNav 元素！", Utils.logLevels.ERROR);
            return;
        }
        chatListEl.innerHTML = '';

        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab(filter); // 更新侧边栏中的活动标签

        let itemsToRender = [];
        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                itemsToRender.push({
                    id: contact.id, name: contact.name,
                    avatarText: contact.avatarText || (contact.isSpecial ? 'S' : contact.name.charAt(0).toUpperCase()),
                    avatarUrl: contact.avatarUrl || null,
                    lastMessage: contact.lastMessage || (contact.isSpecial ? '准备好聊天！' : '暂无消息'),
                    lastTime: contact.lastTime, unread: contact.unread || 0, type: 'contact',
                    online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id),
                    isSpecial: contact.isSpecial || false
                });
            });
        }
        if (filter === 'all' || filter === 'groups') {
            Object.values(GroupManager.groups).forEach(group => {
                itemsToRender.push({
                    id: group.id, name: group.name, avatarText: '👥', avatarUrl: null,
                    lastMessage: group.lastMessage || `成员: ${group.members.length}`,
                    lastTime: group.lastTime, unread: group.unread || 0, type: 'group'
                });
            });
        }

        itemsToRender.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));

        const chatSearchInputEl = document.getElementById('chatSearchInput');
        const searchQuery = chatSearchInputEl ? chatSearchInputEl.value.toLowerCase() : "";
        if (searchQuery) {
            itemsToRender = itemsToRender.filter(item => item.name.toLowerCase().includes(searchQuery));
        }

        if (itemsToRender.length === 0) {
            const filterText = { all: '聊天', contacts: '联系人', groups: '群组' }[filter] || '项目';
            chatListEl.innerHTML = `<li class="chat-list-item-empty">未找到${filterText}。</li>`;
            return;
        }

        itemsToRender.forEach(item => {
            const li = document.createElement('li');
            li.className = `chat-list-item ${item.id === this.currentChatId ? 'active' : ''} ${item.type === 'group' ? 'group' : ''}`;
            if (item.isSpecial) li.classList.add('special-contact', item.id);
            li.setAttribute('data-id', item.id);
            li.setAttribute('data-type', item.type);
            const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';
            let statusIndicator = '';
            if (item.type === 'contact' && (item.online || UserManager.isSpecialContact(item.id))) {
                statusIndicator = '<span class="online-dot" title="已连接"></span>';
            }
            let avatarContentHtml = '';
            const avatarClass = `chat-list-avatar ${item.isSpecial ? item.id : ''}`;
            let fallbackText = (item.avatarText) ? Utils.escapeHtml(item.avatarText) :
                (item.name && item.name.length > 0) ? Utils.escapeHtml(item.name.charAt(0).toUpperCase()) : '?';
            if (item.avatarUrl) {
                avatarContentHtml = `<img src="${item.avatarUrl}" alt="${fallbackText}" class="avatar-image" data-fallback-text="${fallbackText}" data-entity-id="${item.id}">`;
            } else {
                avatarContentHtml = fallbackText;
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
                </div>`;
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
        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showChatArea();

        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active');

        if (type === 'group') {
            GroupManager.openGroup(chatId); // GroupManager 会调用 ChatAreaUIManager.updateChatHeader
        } else {
            const contact = UserManager.contacts[chatId];
            if (contact && typeof ChatAreaUIManager !== 'undefined') {
                if (contact.isSpecial) {
                    ChatAreaUIManager.updateChatHeader(contact.name, (contact.isAI ? 'AI 助手' : '特殊联系人'), contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else {
                    ChatAreaUIManager.updateChatHeader(contact.name, ConnectionManager.isConnectedTo(chatId) ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`, contact.name.charAt(0).toUpperCase());
                    ChatAreaUIManager.setCallButtonsState(ConnectionManager.isConnectedTo(chatId), chatId);
                }
                UserManager.clearUnread(chatId);
            }
        }
        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.enableChatInterface(true);
        this.loadChatHistory(chatId);

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            setTimeout(() => messageInput.focus(), 0);
        }
        if (typeof DetailsPanelUIManager !== 'undefined') {
            DetailsPanelUIManager.toggleDetailsPanel(false); // 打开新聊天时关闭详情
            DetailsPanelUIManager.updateDetailsPanel(chatId, type); // 更新内容（初始时将是隐藏的）
        }
    },

    loadChatHistory: function(chatId) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) {
            Utils.log("ChatManager.loadChatHistory: 未找到 chatBox 元素！", Utils.logLevels.ERROR);
            return;
        }
        chatBox.innerHTML = '';
        const messages = this.chats[chatId] || [];
        const contact = UserManager.contacts[chatId];

        if (messages.length === 0 && chatId) {
            const placeholder = document.createElement('div');
            placeholder.className = "system-message";
            if (contact && contact.isSpecial) placeholder.textContent = `与 ${contact.name} 开始对话吧！`;
            else if(chatId.startsWith('group_') && GroupManager.groups[chatId]?.owner === UserManager.userId && GroupManager.groups[chatId]?.members.length === 1) {
                placeholder.textContent = "您创建了此群组。邀请成员开始聊天吧！";
            } else placeholder.textContent = "暂无消息。开始对话吧！";
            chatBox.appendChild(placeholder);
        } else {
            messages.forEach(msg => {
                const msgToDisplay = { ...msg };
                delete msgToDisplay.isNewlyCompletedAIResponse;
                MessageManager.displayMessage(msgToDisplay, msgToDisplay.sender === UserManager.userId || msgToDisplay.originalSender === UserManager.userId);
            });
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) this.chats[chatId] = [];
        let messageExists = false;
        if (message.id) {
            const existingMsgIndex = this.chats[chatId].findIndex(m => m.id === message.id);
            if (existingMsgIndex !== -1) {
                this.chats[chatId][existingMsgIndex] = { ...this.chats[chatId][existingMsgIndex], ...message };
                messageExists = true;
            }
        }
        if (!messageExists) {
            this.chats[chatId].push(message);
        }

        if (chatId === this.currentChatId) {
            const chatBoxEl = document.getElementById('chatBox');
            if (chatBoxEl) {
                const noMsgPlaceholder = chatBoxEl.querySelector('.system-message:not(.thinking):not(.reconnect-prompt)');
                if(noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
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

        if (!message.isStreaming) {
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, GroupManager.formatMessagePreview(message), isUnread);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, UserManager.formatMessagePreview(message), isUnread);
            }
        }
        try {
            const messagesForDb = this.chats[chatId].map(msg => {
                const msgCopy = { ...msg };
                delete msgCopy.isNewlyCompletedAIResponse;
                return msgCopy;
            });
            await DBManager.setItem('chats', { id: chatId, messages: messagesForDb });
        } catch (error) {
            Utils.log(`保存消息到数据库失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
        }
    },

    clearChat: async function(chatId) {
        if (chatId && this.chats[chatId]) {
            this.chats[chatId] = [];
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] });
                if (chatId === this.currentChatId) this.loadChatHistory(chatId);
                if (chatId.startsWith('group_')) GroupManager.updateGroupLastMessage(chatId, '聊天记录已清空', false, true);
                else UserManager.updateContactLastMessage(chatId, '聊天记录已清空', false, true);
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                if (chatId === this.currentChatId) this.loadChatHistory(chatId);
                return false;
            }
        }
        return false;
    },

    clearAllChats: async function() {
        ModalManager.showConfirmationModal( // 使用 ModalManager
            '您确定要清空所有聊天记录吗？此操作无法撤销。',
            async () => {
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {};
                try {
                    for (const id of chatIdsToClear) await DBManager.setItem('chats', { id: id, messages: [] });
                    Object.values(UserManager.contacts).forEach(c => {
                        if (c.isSpecial) {
                            const specialDef = UserManager.SPECIAL_CONTACTS_DEFINITIONS.find(sd => sd.id === c.id);
                            UserManager.updateContactLastMessage(c.id, specialDef ? specialDef.initialMessage : '聊天记录已清空', false, true);
                        } else UserManager.updateContactLastMessage(c.id, '聊天记录已清空', false, true);
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, '聊天记录已清空', false, true));
                    if (this.currentChatId) this.loadChatHistory(this.currentChatId);
                    this.renderChatList(this.currentFilter);
                    NotificationManager.showNotification('所有聊天记录已清空。', 'success'); // 使用 NotificationManager
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    await this.loadChats();
                    this.renderChatList(this.currentFilter);
                }
            }
        );
    },

    deleteChat: function(chatId, type) {
        const entity = type === 'group' ? GroupManager.groups[chatId] : UserManager.contacts[chatId];
        if (!entity) { NotificationManager.showNotification(`${type === 'group' ? '群组' : '联系人'}未找到。`, 'error'); return; }
        if (type === 'contact' && entity.isSpecial) {
            NotificationManager.showNotification(`${entity.name} 是内置联系人，无法删除。如果需要，您可以清空聊天记录。`, 'warning');
            return;
        }
        const entityName = entity.name;
        let confirmMessage = `您确定要删除联系人 "${entityName}" 吗？所有相关消息都将丢失。`;
        if (type === 'group') {
            confirmMessage = `您确定要${entity.owner === UserManager.userId ? '解散此群组' : '退出此群组'} ("${entityName}") 吗？所有相关消息都将丢失。`;
        }

        ModalManager.showConfirmationModal(confirmMessage, async () => {
            await this.clearChat(chatId);
            if (type === 'group') {
                if (entity.owner === UserManager.userId) await GroupManager.dissolveGroup(chatId);
                else await GroupManager.leaveGroup(chatId);
            } else await UserManager.removeContact(chatId);
            if (chatId === this.currentChatId) {
                this.currentChatId = null;
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.enableChatInterface(false);
            }
            this.renderChatList(this.currentFilter);
        });
    },
};