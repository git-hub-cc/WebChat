/**
 * @file ChatManager.js
 * @description 核心聊天管理器，管理聊天会话数据、状态、UI渲染，并与 ChatAreaUIManager 协作支持消息列表的虚拟滚动。
 * @module ChatManager
 * @exports {object} ChatManager - 对外暴露的单例对象，包含所有聊天管理功能。
 * @dependencies DBManager, UserManager, GroupManager, ConnectionManager, MessageManager, DetailsPanelUIManager, ChatAreaUIManager, SidebarUIManager, NotificationUIManager, Utils, ModalUIManager
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互。
 */
const ChatManager = {
    currentChatId: null, // 当前活动的聊天 ID
    chats: {}, // 结构: { chatId: [messages] }。这是所有消息的真实来源。
    currentFilter: 'all', // 当前聊天列表筛选器: 'all' (全部), 'contacts' (联系人), 'groups' (群组)

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
            await DBManager.init(); // 确保数据库已初始化
            const chatItems = await DBManager.getAllItems('chats');
            this.chats = {}; // 清空内存中的聊天记录
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
                    delete msgCopy.isNewlyCompletedAIResponse; // 移除不应持久化的临时UI状态
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
     * @param {string} [filter='all'] - 筛选条件 ('all', 'contacts', 'groups')。
     */
    renderChatList: function(filter = 'all') {
        this.currentFilter = filter;
        const chatListEl = document.getElementById('chatListNav');
        if(!chatListEl) {
            Utils.log("ChatManager.renderChatList: 未找到 chatListNav 元素！", Utils.logLevels.ERROR);
            return;
        }
        chatListEl.innerHTML = ''; // 清空现有列表
        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab(filter); // 更新标签页高亮

        let itemsToRender = [];

        // 收集联系人
        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                itemsToRender.push({
                    id: contact.id, name: contact.name,
                    avatarText: contact.avatarText || (contact.isSpecial ? 'S' : contact.name.charAt(0).toUpperCase()),
                    avatarUrl: contact.avatarUrl || null,
                    lastMessage: this._formatLastMessagePreview(contact.id, contact.lastMessage, contact.isSpecial ? '准备好聊天！' : '暂无消息'),
                    lastTime: contact.lastTime, unread: contact.unread || 0, type: 'contact',
                    online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id), // AI联系人视觉上总是在线
                    isSpecial: contact.isSpecial || false
                });
            });
        }
        // 收集群组
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

        // 应用搜索框的查询进行进一步筛选
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
            // 对非AI的普通联系人和特殊联系人显示在线状态
            if (item.type === 'contact' && ((item.online && !UserManager.contacts[item.id]?.isAI) || (UserManager.isSpecialContact(item.id) && !UserManager.contacts[item.id]?.isAI))) {
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

    /**
     * @private
     * 辅助函数，格式化最后一条消息预览，处理撤回状态。
     * @param {string} chatId - 聊天ID。
     * @param {string} currentLastMessageText - 当前存储的最后一条消息文本。
     * @param {string} defaultText - 如果没有消息时的默认文本。
     * @returns {string} - 格式化后的预览文本。
     */
    _formatLastMessagePreview: function(chatId, currentLastMessageText, defaultText) {
        const chatHistory = this.chats[chatId];
        if (chatHistory && chatHistory.length > 0) {
            const lastMsg = chatHistory[chatHistory.length - 1];
            if (lastMsg.isRetracted) { // 如果最后一条消息是撤回的
                return lastMsg.content; // 显示撤回提示
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
        if (this.currentChatId === chatId) { // 若已是当前聊天，则聚焦输入框
            const messageInput = document.getElementById('messageInput');
            if (messageInput) setTimeout(() => messageInput.focus(), 0);
            return;
        }

        if (this.currentChatId) { // 保存上一个聊天
            this.saveCurrentChat();
            const prevActive = document.querySelector(`#chatListNav .chat-list-item.active`);
            if (prevActive) prevActive.classList.remove('active');
        }
        this.currentChatId = chatId;

        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active');

        // 更新聊天区域头部
        if (type === 'group') {
            GroupManager.openGroup(chatId);
        } else {
            const contact = UserManager.contacts[chatId];
            if (contact && typeof ChatAreaUIManager !== 'undefined') {
                if (contact.isSpecial && contact.isAI) { // AI助手
                    ChatAreaUIManager.updateChatHeader(contact.name, UserManager.getAiServiceStatusMessage(), contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else if (contact.isSpecial) { // 其他特殊联系人
                    ChatAreaUIManager.updateChatHeader(contact.name, '特殊联系人', contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else { // 普通联系人
                    ChatAreaUIManager.updateChatHeader(contact.name, ConnectionManager.isConnectedTo(chatId) ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`, contact.name.charAt(0).toUpperCase());
                    ChatAreaUIManager.setCallButtonsState(ConnectionManager.isConnectedTo(chatId), chatId);
                }
                UserManager.clearUnread(chatId);
            }
        }

        if (typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.enableChatInterface(true);
            ChatAreaUIManager.setupForChat(chatId); // 初始化虚拟滚动和渲染初始消息
        }
        // 注意：原有的 this.loadChatHistory(chatId) 调用已被 ChatAreaUIManager.setupForChat(chatId) 取代

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto'; // 重置高度
            setTimeout(() => messageInput.focus(), 0); // 异步聚焦
        }
        if (typeof DetailsPanelUIManager !== 'undefined') {
            DetailsPanelUIManager.hideSidePanel();
            DetailsPanelUIManager.updateDetailsPanel(chatId, type);
        }
    },

// /**
//  * 加载并显示指定聊天的历史消息。
//  * 注意：此方法的直接渲染职责已被移交给 ChatAreaUIManager 中的 setupForChat 和 _renderInitialMessageBatch。
//  * 此处保留可能是为了某些内部逻辑，但对于UI渲染，ChatAreaUIManager是主导。
//  * @param {string} chatId - 要加载历史记录的聊天 ID。
//  */
// loadChatHistory: function(chatId) {
//     // 实际的初始消息渲染现在由 ChatAreaUIManager.setupForChat -> _renderInitialMessageBatch 处理。
//     // ChatManager.chats[chatId] 仍然是所有消息的数据源。
// },

    /**
     * 向指定聊天添加一条消息（或更新现有消息），并更新 UI 和数据库。
     * @param {string} chatId - 目标聊天的 ID。
     * @param {object} message - 要添加或更新的消息对象。
     * @returns {Promise<void>}
     */
    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) this.chats[chatId] = [];
        let messageExists = false;

        if (message.id) { // 检查消息是否已存在 (通过ID判断)
            const existingMsgIndex = this.chats[chatId].findIndex(m => m.id === message.id);
            if (existingMsgIndex !== -1) { // 消息已存在，则更新
                this.chats[chatId][existingMsgIndex] = { ...this.chats[chatId][existingMsgIndex], ...message };
                messageExists = true;
                Utils.log(`已更新聊天 ${chatId} 中的消息 ${message.id}`, Utils.logLevels.DEBUG);
            }
        }

        if (!messageExists) { // 消息不存在，则添加
            if (!message.id) message.id = `msg_${Date.now()}_${Utils.generateId(4)}`; // 确保新消息有ID
            this.chats[chatId].push(message);
        }

        // 若是当前聊天，通知 ChatAreaUIManager 处理UI更新
        if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
            if (message.isThinking) { // “正在思考”的临时消息
                MessageManager.displayMessage(message, false); // false表示追加
            } else if (!message.isStreaming && !messageExists) { // 非流式的新消息
                ChatAreaUIManager.handleNewMessageForCurrentChat(message);
            } else if (message.isStreaming && messageExists) { // 流式更新的现有消息
                MessageManager.displayMessage(message, false);
            } else if (!message.isStreaming && messageExists) { // 非流式的更新消息（如撤回）
                MessageManager.displayMessage(message, false);
            }
        }

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== this.currentChatId || !document.hasFocus();

        // 更新侧边栏预览（非流式、非撤回、非思考中的消息）
        if (!message.isStreaming && !message.isRetracted && !message.isThinking) {
            const previewText = isGroup ? GroupManager.formatMessagePreview(message) : UserManager.formatMessagePreview(message);
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, previewText, isUnread);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, previewText, isUnread);
            }
        } else if (message.isRetracted) { // 撤回消息的预览
            const retractedPreview = message.content;
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, retractedPreview, false, true); // forceNoUnread
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, retractedPreview, false, true); // forceNoUnread
            }
        }

        // 保存聊天记录到数据库
        try {
            const messagesForDb = this.chats[chatId].map(msg => {
                const msgCopy = { ...msg };
                delete msgCopy.isNewlyCompletedAIResponse; // 不持久化临时UI标志
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
            this.chats[chatId] = []; // 清空内存
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] }); // 更新数据库
                if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setupForChat(chatId); // 重新设置当前聊天区域
                }
                // 更新侧边栏预览
                const message = '聊天记录已清空';
                if (chatId.startsWith('group_')) GroupManager.updateGroupLastMessage(chatId, message, false, true);
                else UserManager.updateContactLastMessage(chatId, message, false, true);
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setupForChat(chatId); // 尝试从内存状态恢复UI
                }
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
        ModalUIManager.showConfirmationModal(
            '您确定要清空所有聊天记录吗？此操作无法撤销。',
            async () => {
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {}; // 清空内存
                try {
                    for (const id of chatIdsToClear) await DBManager.setItem('chats', { id: id, messages: [] }); // 更新数据库

                    Object.values(UserManager.contacts).forEach(c => { // 更新联系人侧边栏
                        let defaultMsg = '聊天记录已清空';
                        if (c.isSpecial) {
                            const specialDef = (typeof ThemeLoader !== 'undefined' && ThemeLoader.getCurrentSpecialContactsDefinitions) ? ThemeLoader.getCurrentSpecialContactsDefinitions().find(sd => sd.id === c.id) : null;
                            defaultMsg = specialDef ? specialDef.initialMessage : defaultMsg;
                        }
                        UserManager.updateContactLastMessage(c.id, defaultMsg, false, true);
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, '聊天记录已清空', false, true)); // 更新群组侧边栏

                    if (this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                        ChatAreaUIManager.setupForChat(this.currentChatId); // 重设当前聊天区域
                    }
                    this.renderChatList(this.currentFilter); // 重新渲染侧边栏
                    NotificationUIManager.showNotification('所有聊天记录已清空。', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    await this.loadChats(); // 失败时从数据库重新加载
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
        if (!entity) { NotificationUIManager.showNotification(`${type === 'group' ? '群组' : '联系人'}未找到。`, 'error'); return; }

        if (type === 'contact' && entity.isSpecial) { // 特殊联系人不可删除
            NotificationUIManager.showNotification(`${entity.name} 是内置联系人，无法删除。如果需要，您可以清空聊天记录。`, 'warning');
            return;
        }
        const entityName = entity.name;
        let confirmMessage = `您确定要删除联系人 "${entityName}" 吗？所有相关消息都将丢失。`;
        if (type === 'group') {
            confirmMessage = `您确定要${entity.owner === UserManager.userId ? '解散此群组' : '退出此群组'} ("${entityName}") 吗？所有相关消息都将丢失。`;
        }

        ModalUIManager.showConfirmationModal(confirmMessage, async () => {
            await this.clearChat(chatId); // 先清空聊天记录

            if (type === 'group') { // 委托给相应管理器删除
                if (entity.owner === UserManager.userId) await GroupManager.dissolveGroup(chatId);
                else await GroupManager.leaveGroup(chatId);
            } else await UserManager.removeContact(chatId);

            if (chatId === this.currentChatId) { // 若删除的是当前聊天
                this.currentChatId = null;
                if (typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.showNoChatSelected();
                    ChatAreaUIManager.enableChatInterface(false);
                }
            }
            this.renderChatList(this.currentFilter); // 重新渲染侧边栏
        });
    },

    /**
     * 获取指定聊天中特定类型的资源消息（分页，倒序）。
     * @param {string} chatId - 要获取资源的聊天 ID。
     * @param {string} resourceType - 资源类型: 'image', 'video', 'audio', 'file'。
     * @param {number} startIndex - 从符合条件的消息列表中的哪个索引开始（倒序后的索引）。
     * @param {number} limit - 要获取的消息数量。
     * @returns {Promise<Array<object>>} - 解析为消息对象数组的 Promise。
     */
    getMessagesWithResources: async function(chatId, resourceType, startIndex, limit) {
        if (!this.chats[chatId]) {
            return [];
        }
        const allMessages = this.chats[chatId];
        const filteredMessages = [];

        // 从新到旧遍历消息进行筛选
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const msg = allMessages[i];
            if (msg.isRetracted || msg.isThinking) continue; // 跳过已撤回或临时消息

            let isMatch = false;
            switch (resourceType) {
                case 'image':
                    isMatch = msg.type === 'image' || (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('image/'));
                    break;
                case 'video':
                    isMatch = msg.type === 'file' && msg.fileType && msg.fileType.startsWith('video/');
                    break;
                case 'audio': // 包含专属音频消息和音频文件
                    isMatch = msg.type === 'audio' || (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('audio/'));
                    break;
                case 'file': // 通用文件（非图片、视频或专属音频类型）
                    isMatch = msg.type === 'file' && msg.fileType &&
                        !msg.fileType.startsWith('image/') &&
                        !msg.fileType.startsWith('video/') &&
                        !msg.fileType.startsWith('audio/');
                    break;
            }
            if (isMatch) {
                filteredMessages.push(msg); // 按时间倒序收集
            }
        }
        // 对已筛选（并按时间倒序）的列表进行分页
        return filteredMessages.slice(startIndex, startIndex + limit);
    }
};