/**
 * @file ChatManager.js
 * @description 核心聊天管理器，负责管理所有聊天会话的数据、状态和 UI 渲染。
 * @module ChatManager
 * @exports {object} ChatManager - 对外暴露的单例对象，包含所有聊天管理功能。
 * @property {string|null} currentChatId - 当前活动的聊天 ID。
 * @property {object} chats - 存储所有聊天消息的对象，格式为 { chatId: [messages] }。
 * @property {function} init - 初始化模块，从数据库加载聊天记录。
 * @property {function} renderChatList - 根据筛选条件渲染侧边栏的聊天列表。
 * @property {function} openChat - 打开指定的聊天会话，加载其历史记录并更新 UI。
 * @property {function} addMessage -向指定聊天添加一条消息，并更新 UI 和数据库。
 * @property {function} clearChat - 清空指定聊天的所有消息。
 * @property {function} clearAllChats - 清空所有聊天的消息。
 * @dependencies DBManager, UserManager, GroupManager, ConnectionManager, MessageManager, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager, NotificationManager, Utils, ModalManager
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互。
 */
const ChatManager = {
    currentChatId: null,
    chats: {}, // 结构: { chatId: [messages] }
    currentFilter: 'all', // 'all' (全部), 'contacts' (联系人), 'groups' (群组)

    /**
     * 初始化聊天管理器，从数据库加载所有聊天记录。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadChats();
        this.renderChatList(this.currentFilter); // 初始渲染聊天列表
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
                // 在保存到数据库前，移除临时的 UI 状态属性
                const messagesForDb = this.chats[this.currentChatId].map(msg => {
                    const msgCopy = { ...msg };
                    delete msgCopy.isNewlyCompletedAIResponse;
                    // 新增：确保 isRetracted 和 retractedBy 字段被保存
                    // 如果消息对象中已经有这些字段，它们会被自动包含
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

    /**
     * 根据筛选条件渲染侧边栏的聊天列表。
     * @param {string} [filter='all'] - 筛选条件 ('all', 'contacts', 'groups')。
     */
    renderChatList: function(filter = 'all') {
        // ... (原有 renderChatList 内容基本保持不变，确保预览文本能处理撤回消息) ...
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
                itemsToRender.push({
                    id: contact.id, name: contact.name,
                    avatarText: contact.avatarText || (contact.isSpecial ? 'S' : contact.name.charAt(0).toUpperCase()),
                    avatarUrl: contact.avatarUrl || null,
                    // 确保 lastMessage 处理已撤回的情况
                    lastMessage: this._formatLastMessagePreview(contact.id, contact.lastMessage, contact.isSpecial ? '准备好聊天！' : '暂无消息'),
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
                    lastMessage: this._formatLastMessagePreview(group.id, group.lastMessage, `成员: ${group.members.length}`),
                    lastTime: group.lastTime, unread: group.unread || 0, type: 'group'
                });
            });
        }

        // 按最后一条消息的时间降序排序
        itemsToRender.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));

        // 应用搜索查询
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

        // 渲染每个聊天项
        itemsToRender.forEach(item => {
            const li = document.createElement('li');
            li.className = `chat-list-item ${item.id === this.currentChatId ? 'active' : ''} ${item.type === 'group' ? 'group' : ''}`;
            if (item.isSpecial) li.classList.add('special-contact', item.id);
            li.setAttribute('data-id', item.id);
            li.setAttribute('data-type', item.type);
            const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';
            // 在线状态指示器
            let statusIndicator = '';
            if (item.type === 'contact' && (item.online || UserManager.isSpecialContact(item.id))) {
                statusIndicator = '<span class="online-dot" title="已连接"></span>';
            }
            // 头像内容
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

    /**
     * @private
     * 辅助函数，格式化最后一条消息预览，特别是处理撤回状态。
     * @param {string} chatId - 聊天ID。
     * @param {string} currentLastMessageText - 当前存储的最后一条消息文本。
     * @param {string} defaultText - 如果没有消息时的默认文本。
     * @returns {string} - 格式化后的预览文本。
     */
    _formatLastMessagePreview: function(chatId, currentLastMessageText, defaultText) {
        const chatHistory = this.chats[chatId];
        if (chatHistory && chatHistory.length > 0) {
            const lastMsg = chatHistory[chatHistory.length - 1];
            if (lastMsg.isRetracted) {
                return lastMsg.content; // "你撤回了一条消息" 或 "对方撤回了一条消息"
            }
        }
        return currentLastMessageText || defaultText;
    },


    /**
     * 打开指定的聊天会话。
     * @param {string} chatId - 要打开的聊天的 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    openChat: function(chatId, type) {
        if (this.currentChatId) {
            this.saveCurrentChat();
            const prevActive = document.querySelector(`#chatListNav .chat-list-item.active`);
            if (prevActive) prevActive.classList.remove('active');
        }
        this.currentChatId = chatId;
        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showChatArea();

        // 激活新的聊天项
        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active');

        // 根据类型委托给相应的管理器处理
        if (type === 'group') {
            GroupManager.openGroup(chatId);
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

        // 重置并聚焦输入框
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            setTimeout(() => messageInput.focus(), 0);
        }
        // 打开新聊天时，关闭详情面板并为其准备新内容
        if (typeof DetailsPanelUIManager !== 'undefined') {
            DetailsPanelUIManager.toggleDetailsPanel(false); // 改为 toggleChatDetailsView() 或 hideSidePanel()
            DetailsPanelUIManager.updateDetailsPanel(chatId, type);
        }
    },

    /**
     * 加载并显示指定聊天的历史消息。
     * @param {string} chatId - 要加载历史记录的聊天 ID。
     */
    loadChatHistory: function(chatId) {
        const chatBox = document.getElementById('chatBox');
        if (!chatBox) {
            Utils.log("ChatManager.loadChatHistory: 未找到 chatBox 元素！", Utils.logLevels.ERROR);
            return;
        }
        chatBox.innerHTML = '';
        const messages = this.chats[chatId] || [];
        const contact = UserManager.contacts[chatId];

        // 如果没有消息，显示占位符文本
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
                delete msgToDisplay.isNewlyCompletedAIResponse; // 不传递临时状态
                MessageManager.displayMessage(msgToDisplay, msgToDisplay.sender === UserManager.userId || msgToDisplay.originalSender === UserManager.userId);
            });
        }
        chatBox.scrollTop = chatBox.scrollHeight;
    },

    /**
     * 向指定聊天添加一条消息，并更新 UI 和数据库。
     * 如果消息已存在 (通过 message.id 判断)，则会更新该消息。
     * @param {string} chatId - 目标聊天的 ID。
     * @param {object} message - 要添加或更新的消息对象。
     * @returns {Promise<void>}
     */
    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) this.chats[chatId] = [];
        let messageExists = false;

        // 检查消息是否已存在，如果存在则更新
        if (message.id) {
            const existingMsgIndex = this.chats[chatId].findIndex(m => m.id === message.id);
            if (existingMsgIndex !== -1) {
                // 合并新旧消息，新消息的属性优先
                this.chats[chatId][existingMsgIndex] = { ...this.chats[chatId][existingMsgIndex], ...message };
                messageExists = true;
                Utils.log(`已更新聊天 ${chatId} 中的消息 ${message.id}`, Utils.logLevels.DEBUG);
            }
        }

        // 如果消息不存在，则添加到末尾
        if (!messageExists) {
            // 为新消息确保有ID (如果MessageManager.sendMessage没提供)
            if (!message.id) {
                message.id = `msg_${Date.now()}_${Utils.generateId(4)}`;
                Utils.log(`为聊天 ${chatId} 中的新消息生成ID: ${message.id}`, Utils.logLevels.DEBUG);
            }
            this.chats[chatId].push(message);
        }

        // 如果是当前聊天，则实时更新 UI
        if (chatId === this.currentChatId) {
            const chatBoxEl = document.getElementById('chatBox');
            if (chatBoxEl) {
                const noMsgPlaceholder = chatBoxEl.querySelector('.system-message:not(.thinking):not(.reconnect-prompt):not(.retracted)');
                if (noMsgPlaceholder && (noMsgPlaceholder.textContent.includes("暂无消息") || noMsgPlaceholder.textContent.includes("您创建了此群组") || noMsgPlaceholder.textContent.includes("开始对话"))) {
                    if (!message.isThinking && !message.isStreaming && !message.isRetracted) noMsgPlaceholder.remove();
                }
            }
            if (!message.isThinking) { // 不显示临时的“正在思考”消息，它们由 displayMessage 直接处理
                MessageManager.displayMessage(message, message.sender === UserManager.userId || message.originalSender === UserManager.userId);
            }
            if (chatBoxEl) chatBoxEl.scrollTop = chatBoxEl.scrollHeight;
        }

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== this.currentChatId || !document.hasFocus();

        if (!message.isStreaming && !message.isRetracted) { // 已撤回消息不应作为最新消息预览
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, GroupManager.formatMessagePreview(message), isUnread);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, UserManager.formatMessagePreview(message), isUnread);
            }
        } else if (message.isRetracted) { // 如果是撤回消息，预览应显示撤回状态
            const retractedPreview = message.content; // "你撤回了一条消息" 或 "对方撤回了一条消息"
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, retractedPreview, false, true);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, retractedPreview, false, true);
            }
        }
        try {
            const messagesForDb = this.chats[chatId].map(msg => {
                const msgCopy = { ...msg };
                delete msgCopy.isNewlyCompletedAIResponse;
                // 确保 isRetracted 和 retractedBy 字段被保存
                return msgCopy;
            });
            await DBManager.setItem('chats', { id: chatId, messages: messagesForDb });
        } catch (error) {
            Utils.log(`保存消息到数据库失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 清空指定聊天的所有消息。
     * @param {string} chatId - 要清空的聊天 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    clearChat: async function(chatId) {
        if (chatId && this.chats[chatId]) {
            this.chats[chatId] = [];
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] });
                if (chatId === this.currentChatId) this.loadChatHistory(chatId);
                // 更新侧边栏预览
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

    /**
     * 清空所有聊天的聊天记录。
     * @returns {Promise<void>}
     */
    clearAllChats: async function() {
        ModalManager.showConfirmationModal(
            '您确定要清空所有聊天记录吗？此操作无法撤销。',
            async () => {
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {};
                try {
                    for (const id of chatIdsToClear) await DBManager.setItem('chats', { id: id, messages: [] });
                    // 更新所有联系人和群组的侧边栏预览
                    Object.values(UserManager.contacts).forEach(c => {
                        if (c.isSpecial) {
                            const specialDef = UserManager.SPECIAL_CONTACTS_DEFINITIONS.find(sd => sd.id === c.id);
                            UserManager.updateContactLastMessage(c.id, specialDef ? specialDef.initialMessage : '聊天记录已清空', false, true);
                        } else UserManager.updateContactLastMessage(c.id, '聊天记录已清空', false, true);
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, '聊天记录已清空', false, true));
                    // 如果当前聊天被清空，重新加载
                    if (this.currentChatId) this.loadChatHistory(this.currentChatId);
                    this.renderChatList(this.currentFilter);
                    NotificationManager.showNotification('所有聊天记录已清空。', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    // 失败时从数据库重新加载以恢复状态
                    await this.loadChats();
                    this.renderChatList(this.currentFilter);
                }
            }
        );
    },

    /**
     * 删除一个聊天（联系人或群组）。
     * @param {string} chatId - 要删除的聊天 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
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
            // 委托给相应的管理器执行删除操作
            if (type === 'group') {
                if (entity.owner === UserManager.userId) await GroupManager.dissolveGroup(chatId);
                else await GroupManager.leaveGroup(chatId);
            } else await UserManager.removeContact(chatId);
            // 如果删除的是当前聊天，则返回到“未选择聊天”界面
            if (chatId === this.currentChatId) {
                this.currentChatId = null;
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.enableChatInterface(false);
            }
            this.renderChatList(this.currentFilter);
        });
    },
};