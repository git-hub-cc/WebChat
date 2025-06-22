/**
 * @file ChatManager.js
 * @description 核心聊天管理器，管理聊天会话数据、状态、UI渲染，并与 ChatAreaUIManager 协作支持消息列表的虚拟滚动。
 *              优化：侧边栏联系人列表现在只显示当前主题定义的AI角色和普通联系人。
 *              更新：移除了群主消息转发的相关逻辑，因为群组连接已改为 Mesh 架构。
 * @module ChatManager
 * @exports {object} ChatManager - 对外暴露的单例对象，包含所有聊天管理功能。
 * @dependencies DBManager, UserManager, GroupManager, ConnectionManager, MessageManager, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager, NotificationUIManager, Utils, ModalUIManager
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互。
 */
const ChatManager = {
    currentChatId: null,
    chats: {},
    currentFilter: 'all',

    /**
     * 初始化聊天管理器，从数据库加载所有聊天记录。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadChats();
        this.renderChatList(this.currentFilter);
    },

    /**
     * 从 IndexedDB 加载所有聊天记录到内存中。
     * @returns {Promise<void>}
     */
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

    /**
     * 将当前活动聊天的消息保存到数据库。
     * @returns {Promise<void>}
     */
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
            } catch (error){
                Utils.log(`保存当前聊天记录失败 (${this.currentChatId}): ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    /**
     * 根据筛选条件渲染侧边栏的聊天列表。
     * 联系人列表现在只显示当前主题的特殊AI和普通联系人。
     * @param {string} [filter='all'] - 筛选条件 ('all', 'contacts', 'groups')。
     */
    renderChatList: function(filter = 'all') {
        this.currentFilter = filter;
        const chatListEl = document.getElementById('chatListNav');
        if(!chatListEl) {
            Utils.log("ChatManager.renderChatList: 未找到 chatListNav 元素！", Utils.logLevels.ERROR);
            return;
        }
        chatListEl.innerHTML = '';
        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab(filter);

        let itemsToRender = [];

        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                // 条件判断:
                // 1. 普通联系人 (!contact.isSpecial && !contact.isAI)
                // 2. 或者 是当前主题的特殊联系人 (contact.isSpecial)
                //    (UserManager.ensureSpecialContacts 保证了 contact.isSpecial 只对当前主题特殊联系人有效)
                //    AI历史联系人 (isSpecial: false, isAI: true) 不会在这里显示
                if ((!contact.isSpecial && !contact.isAI) || contact.isSpecial) {
                    itemsToRender.push({
                        id: contact.id,
                        name: contact.name,
                        // contact.isSpecial 现在准确反映了它是否为 *当前主题* 的特殊联系人
                        avatarText: contact.avatarText || (contact.isSpecial ? 'S' : contact.name.charAt(0).toUpperCase()),
                        avatarUrl: contact.avatarUrl || null,
                        lastMessage: this._formatLastMessagePreview(contact.id, contact.lastMessage,
                            (contact.isSpecial && contact.isAI) ? '准备好聊天！' : '暂无消息'),
                        lastTime: contact.lastTime,
                        unread: contact.unread || 0,
                        type: 'contact',
                        // online状态：当前主题的特殊联系人（包括AI和非AI特殊）通常视为一直在线
                        // 普通联系人则基于ConnectionManager的状态
                        online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id),
                        isSpecial: contact.isSpecial // 这个isSpecial是由UserManager根据当前主题维护的
                    });
                }
            });
        }
        if (filter === 'all' || filter === 'groups') {
            Object.values(GroupManager.groups).forEach(group => {
                itemsToRender.push({
                    id: group.id, name: group.name, avatarText: '👥', avatarUrl: null,
                    lastMessage: this._formatLastMessagePreview(group.id, group.lastMessage, `成员: ${group.members.length}`),
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
            // item.isSpecial 仍然准确反映是否为当前主题特殊联系人
            if (item.isSpecial) li.classList.add('special-contact', item.id);
            li.setAttribute('data-id', item.id);
            li.setAttribute('data-type', item.type);
            const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';

            let statusIndicator = '';
            // 在线状态指示器：只为非AI的联系人（无论是普通还是当前主题特殊非AI）且已连接的显示
            // 当前主题的特殊AI联系人，其 item.online 已被设为 true，所以也会显示点（如果需要区分，可以再加条件）
            if (item.type === 'contact' && item.online && !(item.isSpecial && UserManager.contacts[item.id]?.isAI) ) {
                statusIndicator = '<span class="online-dot" title="已连接"></span>';
            }


            let avatarContentHtml;
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

    _formatLastMessagePreview: function(chatId, currentLastMessageText, defaultText) {
        const chatHistory = this.chats[chatId];
        if (chatHistory && chatHistory.length > 0) {
            const lastMsg = chatHistory[chatHistory.length - 1];
            if (lastMsg.isRetracted) {
                return lastMsg.content;
            }
        }
        return currentLastMessageText || defaultText;
    },

    openChat: function(chatId, type) {
        // Check if we are in mobile view.
        // Access LayoutUIManager.appContainer if LayoutUIManager is initialized, otherwise query directly.
        const isMobileView = (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) ?
            LayoutUIManager.appContainer.classList.contains('mobile-view') :
            document.querySelector('.app-container')?.classList.contains('mobile-view'); // Fallback

        if (this.currentChatId === chatId) {
            if (isMobileView) {
                // In mobile view, even if it's the same chat, we need to ensure the chat area is shown
                // if the user clicked on the chat item from the list.
                if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.showChatAreaLayout) {
                    LayoutUIManager.showChatAreaLayout();
                }
            }
            const messageInput = document.getElementById('messageInput');
            if (messageInput) setTimeout(() => messageInput.focus(), 0);
            return;
        }

        if (this.currentChatId) {
            this.saveCurrentChat();
            const prevActive = document.querySelector(`#chatListNav .chat-list-item.active`);
            if (prevActive) prevActive.classList.remove('active');
        }
        this.currentChatId = chatId;

        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active');

        if (type === 'group') {
            GroupManager.openGroup(chatId);
        } else { // type === 'contact'
            const contact = UserManager.contacts[chatId];
            if (contact && typeof ChatAreaUIManager !== 'undefined') {
                // contact.isSpecial 现在准确反映了它是否为当前主题定义的特殊联系人
                if (contact.isSpecial && contact.isAI) { // 当前主题的特殊AI
                    ChatAreaUIManager.updateChatHeader(contact.name, UserManager.getAiServiceStatusMessage(), contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else if (contact.isSpecial && !contact.isAI) { // 当前主题的特殊非AI
                    ChatAreaUIManager.updateChatHeader(contact.name, '特殊联系人', contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else { // 普通联系人 (contact.isSpecial is false)
                    ChatAreaUIManager.updateChatHeader(contact.name, ConnectionManager.isConnectedTo(chatId) ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`, contact.name.charAt(0).toUpperCase());
                    ChatAreaUIManager.setCallButtonsState(ConnectionManager.isConnectedTo(chatId), chatId);
                }
                UserManager.clearUnread(chatId);
            }
        }

        if (typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.enableChatInterface(true);
            ChatAreaUIManager.setupForChat(chatId);
        }

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            setTimeout(() => messageInput.focus(), 0);
        }
        if (typeof DetailsPanelUIManager !== 'undefined') {
            DetailsPanelUIManager.hideSidePanel();
            DetailsPanelUIManager.updateDetailsPanel(chatId, type);
        }
    },

    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) this.chats[chatId] = [];
        let messageExists = false;

        if (message.id) {
            const existingMsgIndex = this.chats[chatId].findIndex(m => m.id === message.id);
            if (existingMsgIndex !== -1) {
                this.chats[chatId][existingMsgIndex] = { ...this.chats[chatId][existingMsgIndex], ...message };
                messageExists = true;
                Utils.log(`已更新聊天 ${chatId} 中的消息 ${message.id}`, Utils.logLevels.DEBUG);
            }
        }

        if (!messageExists) {
            if (!message.id) message.id = `msg_${Date.now()}_${Utils.generateId(4)}`;
            this.chats[chatId].push(message);
        }

        if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
            if (message.isThinking) {
                MessageManager.displayMessage(message, false);
            } else if (!message.isStreaming && !messageExists) {
                ChatAreaUIManager.handleNewMessageForCurrentChat(message);
            } else if (message.isStreaming && messageExists) {
                MessageManager.displayMessage(message, false);
            } else if (!message.isStreaming && messageExists) {
                MessageManager.displayMessage(message, false);
            }
        }

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== this.currentChatId || !document.hasFocus();

        if (!message.isStreaming && !message.isRetracted && !message.isThinking) {
            const previewText = isGroup ? GroupManager.formatMessagePreview(message) : UserManager.formatMessagePreview(message);
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, previewText, isUnread);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, previewText, isUnread);
            }
        } else if (message.isRetracted) {
            const retractedPreview = message.content;
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, retractedPreview, false, true);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, retractedPreview, false, true);
            }
        }

        // 移除了群主转发逻辑
        // if (isGroup &&
        //     GroupManager.groups[chatId] &&
        //     GroupManager.groups[chatId].owner === UserManager.userId && ... ) { ... }

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
                if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setupForChat(chatId);
                }
                const message = '聊天记录已清空';
                if (chatId.startsWith('group_')) GroupManager.updateGroupLastMessage(chatId, message, false, true);
                else UserManager.updateContactLastMessage(chatId, message, false, true);
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setupForChat(chatId);
                }
                return false;
            }
        }
        return false;
    },

    clearAllChats: async function() {
        ModalUIManager.showConfirmationModal(
            '您确定要清空所有聊天记录吗？此操作无法撤销。',
            async () => {
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {};
                try {
                    for (const id of chatIdsToClear) await DBManager.setItem('chats', { id: id, messages: [] });

                    Object.values(UserManager.contacts).forEach(c => {
                        let defaultMsg = '聊天记录已清空';
                        if (c.isSpecial) { // 这里的 isSpecial 准确反映了当前主题
                            const specialDef = (typeof ThemeLoader !== 'undefined' && ThemeLoader.getCurrentSpecialContactsDefinitions) ? ThemeLoader.getCurrentSpecialContactsDefinitions().find(sd => sd.id === c.id) : null;
                            defaultMsg = specialDef ? specialDef.initialMessage : defaultMsg;
                        }
                        UserManager.updateContactLastMessage(c.id, defaultMsg, false, true);
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, '聊天记录已清空', false, true));

                    if (this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                        ChatAreaUIManager.setupForChat(this.currentChatId);
                    }
                    this.renderChatList(this.currentFilter);
                    NotificationUIManager.showNotification('所有聊天记录已清空。', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    await this.loadChats();
                    this.renderChatList(this.currentFilter);
                }
            }
        );
    },

    deleteChat: function(chatId, type) {
        const entity = type === 'group' ? GroupManager.groups[chatId] : UserManager.contacts[chatId];
        if (!entity) { NotificationUIManager.showNotification(`${type === 'group' ? '群组' : '联系人'}未找到。`, 'error'); return; }

        // 使用 UserManager.isSpecialContactInCurrentTheme 来判断是否为当前主题的特殊联系人
        if (type === 'contact' && UserManager.isSpecialContactInCurrentTheme(entity.id)) {
            NotificationUIManager.showNotification(`${entity.name} 是当前主题的内置联系人，无法删除。如果需要，您可以清空聊天记录。`, 'warning');
            return;
        }
        const entityName = entity.name;
        let confirmMessage = `您确定要删除联系人 "${entityName}" 吗？所有相关消息都将丢失。`;
        if (type === 'group') {
            confirmMessage = `您确定要${entity.owner === UserManager.userId ? '解散此群组' : '退出此群组'} ("${entityName}") 吗？所有相关消息都将丢失。`;
        }

        ModalUIManager.showConfirmationModal(confirmMessage, async () => {
            await this.clearChat(chatId);

            if (type === 'group') {
                if (entity.owner === UserManager.userId) await GroupManager.dissolveGroup(chatId);
                else await GroupManager.leaveGroup(chatId);
            } else await UserManager.removeContact(chatId); // UserManager.removeContact 会处理 isSpecialContactInCurrentTheme

            if (chatId === this.currentChatId) {
                this.currentChatId = null;
                if (typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.showNoChatSelected();
                    ChatAreaUIManager.enableChatInterface(false);
                }
            }
            this.renderChatList(this.currentFilter);
        });
    },

    getMessagesWithResources: async function(chatId, resourceType, startIndex, limit) {
        if (!this.chats[chatId]) {
            return [];
        }
        const allMessages = this.chats[chatId];
        const filteredMessages = [];

        for (let i = allMessages.length - 1; i >= 0; i--) {
            const msg = allMessages[i];
            if (msg.isRetracted || msg.isThinking) continue;

            let isMatch = false;
            switch (resourceType) {
                case 'image':
                    isMatch = msg.type === 'image' || (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('image/'));
                    break;
                case 'video':
                    isMatch = msg.type === 'file' && msg.fileType && msg.fileType.startsWith('video/');
                    break;
                case 'audio':
                    isMatch = msg.type === 'audio' || (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('audio/'));
                    break;
                case 'file':
                    isMatch = msg.type === 'file' && msg.fileType &&
                        !msg.fileType.startsWith('image/') &&
                        !msg.fileType.startsWith('video/') &&
                        !msg.fileType.startsWith('audio/');
                    break;
            }
            if (isMatch) {
                filteredMessages.push(msg);
            }
        }
        return filteredMessages.slice(startIndex, startIndex + limit);
    }
};