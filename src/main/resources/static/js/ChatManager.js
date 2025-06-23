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
    chats: {}, // { chatId: [messageObject, ...] }
    currentFilter: 'all', // 'all', 'contacts', 'groups'

    /**
     * 初始化聊天管理器，从数据库加载所有聊天记录。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadChats();
        this.renderChatList(this.currentFilter); // 初始渲染列表
    },

    /**
     * 从 IndexedDB 加载所有聊天记录到内存中。
     * @returns {Promise<void>}
     */
    loadChats: async function() {
        try {
            await DBManager.init(); // 确保数据库已初始化
            const chatItems = await DBManager.getAllItems('chats');
            this.chats = {}; // 清空现有内存中的聊天记录
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
                // 在保存到数据库前，移除或转换临时状态属性 (如 isNewlyCompletedAIResponse)
                const messagesForDb = this.chats[this.currentChatId].map(msg => {
                    const msgCopy = { ...msg };
                    delete msgCopy.isNewlyCompletedAIResponse; // 移除临时状态
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
        chatListEl.innerHTML = ''; // 清空现有列表
        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab(filter); // 更新侧边栏标签状态

        let itemsToRender = [];

        // 收集联系人
        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                // 条件判断:
                // 1. 普通联系人 (!contact.isSpecial && !contact.isAI)
                // 2. 或者 是当前主题的特殊联系人 (contact.isSpecial)
                //    (UserManager.ensureSpecialContacts 保证了 contact.isSpecial 只对当前主题特殊联系人有效)
                //    历史AI联系人 (isSpecial: false, isAI: true) 不会在这里显示
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

        // 按最后消息时间排序
        itemsToRender.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));

        // 应用搜索过滤
        const chatSearchInputEl = document.getElementById('chatSearchInput');
        const searchQuery = chatSearchInputEl ? chatSearchInputEl.value.toLowerCase() : "";
        if (searchQuery) {
            itemsToRender = itemsToRender.filter(item => item.name.toLowerCase().includes(searchQuery));
        }

        // 处理空列表情况
        if (itemsToRender.length === 0) {
            const filterText = { all: '聊天', contacts: '联系人', groups: '群组' }[filter] || '项目';
            chatListEl.innerHTML = `<li class="chat-list-item-empty">未找到${filterText}。</li>`;
            return;
        }

        // 渲染列表项
        itemsToRender.forEach(item => {
            const li = document.createElement('li');
            li.className = `chat-list-item ${item.id === this.currentChatId ? 'active' : ''} ${item.type === 'group' ? 'group' : ''}`;
            // item.isSpecial 仍然准确反映是否为当前主题特殊联系人
            if (item.isSpecial) li.classList.add('special-contact', item.id); // 添加特殊联系人特定类和ID类
            li.setAttribute('data-id', item.id);
            li.setAttribute('data-type', item.type);
            const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';

            let statusIndicator = '';
            // 在线状态指示器：只为非AI的联系人（无论是普通还是当前主题特殊非AI）且已连接的显示
            // 当前主题的特殊AI联系人，其 item.online 已被设为 true，所以也会显示点（如果需要区分，可以再加条件）
            if (item.type === 'contact' && item.online && !(item.isSpecial && UserManager.contacts[item.id]?.isAI) ) { // 排除当前主题的特殊AI
                statusIndicator = '<span class="online-dot" title="已连接"></span>';
            }


            // 头像内容
            let avatarContentHtml;
            const avatarClass = `chat-list-avatar ${item.isSpecial ? item.id : ''}`; // 为特殊联系人头像添加ID类
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
     * 格式化最后一条消息的预览文本。如果消息已被撤回，则显示撤回提示。
     * @param {string} chatId - 聊天ID。
     * @param {string} currentLastMessageText - 当前存储的最后消息文本。
     * @param {string} defaultText - 如果没有消息时的默认文本。
     * @returns {string} - 格式化后的预览文本。
     */
    _formatLastMessagePreview: function(chatId, currentLastMessageText, defaultText) {
        const chatHistory = this.chats[chatId];
        if (chatHistory && chatHistory.length > 0) {
            const lastMsg = chatHistory[chatHistory.length - 1];
            if (lastMsg.isRetracted) { // 检查消息是否已撤回
                return lastMsg.content; // 撤回消息通常包含 "xx撤回了一条消息"
            }
        }
        return currentLastMessageText || defaultText; // 否则返回当前或默认文本
    },


    /**
     * 打开指定的聊天会话。
     * @param {string} chatId - 要打开的聊天 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    openChat: function(chatId, type) {
        // 检查是否在移动端视图
        // 如果 LayoutUIManager 已初始化，则使用其 appContainer，否则直接查询DOM
        const isMobileView = (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) ?
            LayoutUIManager.appContainer.classList.contains('mobile-view') :
            document.querySelector('.app-container')?.classList.contains('mobile-view'); // 回退方案

        if (this.currentChatId === chatId) {
            if (isMobileView) {
                // 在移动端，即使是同一个聊天，如果用户从列表点击，也需要确保聊天区域显示
                if (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.showChatAreaLayout) {
                    LayoutUIManager.showChatAreaLayout();
                }
            }
            const messageInput = document.getElementById('messageInput'); // 聚焦输入框
            if (messageInput) setTimeout(() => messageInput.focus(), 0);
            return; // 如果是同一个聊天，则不执行后续操作
        }

        // 保存上一个聊天的状态
        if (this.currentChatId) {
            this.saveCurrentChat(); // 保存消息
            const prevActive = document.querySelector(`#chatListNav .chat-list-item.active`);
            if (prevActive) prevActive.classList.remove('active'); // 移除旧的激活状态
        }
        this.currentChatId = chatId; // 设置新的当前聊天ID

        const currentActive = document.querySelector(`#chatListNav .chat-list-item[data-id="${chatId}"]`);
        if (currentActive) currentActive.classList.add('active'); // 高亮新选中的聊天项

        if (type === 'group') { // 如果是群组
            GroupManager.openGroup(chatId); // 调用 GroupManager 处理群组特定的打开逻辑
        } else { // 如果是联系人
            const contact = UserManager.contacts[chatId];
            if (contact && typeof ChatAreaUIManager !== 'undefined') {
                // contact.isSpecial 现在准确反映了它是否为当前主题定义的特殊联系人
                if (contact.isSpecial && contact.isAI) { // 当前主题的特殊AI
                    ChatAreaUIManager.updateChatHeader(contact.name, UserManager.getAiServiceStatusMessage(), contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false); // AI 不支持通话
                } else if (contact.isSpecial && !contact.isAI) { // 当前主题的特殊非AI
                    ChatAreaUIManager.updateChatHeader(contact.name, '特殊联系人', contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false); // 特殊非AI联系人可能不支持通话
                } else { // 普通联系人 (contact.isSpecial is false)
                    ChatAreaUIManager.updateChatHeader(contact.name, ConnectionManager.isConnectedTo(chatId) ? '已连接' : `ID: ${contact.id.substring(0,8)}... (离线)`, contact.name.charAt(0).toUpperCase());
                    ChatAreaUIManager.setCallButtonsState(ConnectionManager.isConnectedTo(chatId), chatId); // 根据连接状态设置通话按钮
                }
                UserManager.clearUnread(chatId); // 清除未读消息
            }
        }

        // 设置聊天区域UI
        if (typeof ChatAreaUIManager !== 'undefined') {
            ChatAreaUIManager.enableChatInterface(true); // 启用输入框等
            ChatAreaUIManager.setupForChat(chatId); // 设置聊天区域，包括虚拟滚动
        }

        // 清空并聚焦输入框
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto'; // 重置输入框高度
            setTimeout(() => messageInput.focus(), 0); // 延迟聚焦
        }
        // 更新或隐藏详情面板
        if (typeof DetailsPanelUIManager !== 'undefined') {
            DetailsPanelUIManager.hideSidePanel(); // 先隐藏
            DetailsPanelUIManager.updateDetailsPanel(chatId, type); // 再根据新聊天更新
        }
    },

    /**
     * 向指定聊天添加一条消息，并处理 UI 更新和数据持久化。
     * @param {string} chatId - 目标聊天的 ID。
     * @param {object} message - 要添加的消息对象。
     * @returns {Promise<void>}
     */
    addMessage: async function(chatId, message) {
        if (!this.chats[chatId]) this.chats[chatId] = []; // 如果聊天记录不存在，则初始化
        let messageExists = false;

        // 如果消息有ID，检查是否已存在，存在则更新
        if (message.id) {
            const existingMsgIndex = this.chats[chatId].findIndex(m => m.id === message.id);
            if (existingMsgIndex !== -1) {
                // 合并新旧消息属性，优先使用新消息的
                this.chats[chatId][existingMsgIndex] = { ...this.chats[chatId][existingMsgIndex], ...message };
                messageExists = true;
                Utils.log(`已更新聊天 ${chatId} 中的消息 ${message.id}`, Utils.logLevels.DEBUG);
            }
        }

        if (!messageExists) { // 如果消息不存在，则添加
            if (!message.id) message.id = `msg_${Date.now()}_${Utils.generateId(4)}`; // 生成唯一ID
            this.chats[chatId].push(message);
        }

        // 更新UI（如果当前聊天是活动聊天）
        if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
            if (message.isThinking) { // 如果是“正在思考”消息
                MessageManager.displayMessage(message, false);
            } else if (!message.isStreaming && !messageExists) { // 如果是新消息（非流式，非更新）
                ChatAreaUIManager.handleNewMessageForCurrentChat(message);
            } else if (message.isStreaming && messageExists) { // 如果是流式消息更新
                MessageManager.displayMessage(message, false);
            } else if (!message.isStreaming && messageExists) { // 如果是普通消息更新
                MessageManager.displayMessage(message, false);
            }
        }

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== this.currentChatId || !document.hasFocus(); // 判断是否为未读

        // 更新最后消息预览和未读计数 (排除流式和思考中的消息)
        if (!message.isStreaming && !message.isRetracted && !message.isThinking) {
            const previewText = isGroup ? GroupManager.formatMessagePreview(message) : UserManager.formatMessagePreview(message);
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, previewText, isUnread);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, previewText, isUnread);
            }
        } else if (message.isRetracted) { // 如果是撤回消息
            const retractedPreview = message.content; // 撤回消息的内容通常是 "xx撤回了一条消息"
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, retractedPreview, false, true); // 不增加未读，强制清除
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, retractedPreview, false, true);
            }
        }

        // 移除了群主转发逻辑，因为已改为Mesh架构

        // 保存到数据库
        try {
            const messagesForDb = this.chats[chatId].map(msg => {
                const msgCopy = { ...msg };
                delete msgCopy.isNewlyCompletedAIResponse; // 移除临时状态属性
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
            this.chats[chatId] = []; // 清空内存中的消息
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] }); // 更新数据库
                if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setupForChat(chatId); // 重新设置聊天区域UI
                }
                // 更新最后消息预览
                const message = '聊天记录已清空';
                if (chatId.startsWith('group_')) GroupManager.updateGroupLastMessage(chatId, message, false, true);
                else UserManager.updateContactLastMessage(chatId, message, false, true);
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                // 即使数据库操作失败，也尝试刷新UI，以反映内存中的状态
                if (chatId === this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.setupForChat(chatId);
                }
                return false;
            }
        }
        return false; // 如果聊天ID无效或聊天记录不存在
    },

    /**
     * 清空所有聊天记录（包括联系人和群组的）。
     * @returns {Promise<void>}
     */
    clearAllChats: async function() {
        ModalUIManager.showConfirmationModal( // 显示确认对话框
            '您确定要清空所有聊天记录吗？此操作无法撤销。',
            async () => { // 用户确认后的操作
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {}; // 清空内存中的所有聊天记录
                try {
                    // 逐个清空数据库中的聊天记录
                    for (const id of chatIdsToClear) await DBManager.setItem('chats', { id: id, messages: [] });

                    // 更新所有联系人和群组的最后消息预览
                    Object.values(UserManager.contacts).forEach(c => {
                        let defaultMsg = '聊天记录已清空';
                        if (c.isSpecial) { // 这里的 isSpecial 准确反映了当前主题
                            const specialDef = (typeof ThemeLoader !== 'undefined' && ThemeLoader.getCurrentSpecialContactsDefinitions) ? ThemeLoader.getCurrentSpecialContactsDefinitions().find(sd => sd.id === c.id) : null;
                            defaultMsg = specialDef ? specialDef.initialMessage : defaultMsg;
                        }
                        UserManager.updateContactLastMessage(c.id, defaultMsg, false, true);
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, '聊天记录已清空', false, true));

                    // 如果当前有打开的聊天，则刷新其UI
                    if (this.currentChatId && typeof ChatAreaUIManager !== 'undefined') {
                        ChatAreaUIManager.setupForChat(this.currentChatId);
                    }
                    this.renderChatList(this.currentFilter); // 重新渲染聊天列表
                    NotificationUIManager.showNotification('所有聊天记录已清空。', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    // 如果出错，尝试从数据库重新加载以恢复状态
                    await this.loadChats();
                    this.renderChatList(this.currentFilter);
                }
            }
        );
    },

    /**
     * 删除指定的聊天（联系人或群组）。
     * @param {string} chatId - 要删除的聊天 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    deleteChat: function(chatId, type) {
        const entity = type === 'group' ? GroupManager.groups[chatId] : UserManager.contacts[chatId];
        if (!entity) { // 实体不存在
            NotificationUIManager.showNotification(`${type === 'group' ? '群组' : '联系人'}未找到。`, 'error');
            return;
        }

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

        ModalUIManager.showConfirmationModal(confirmMessage, async () => { // 显示确认对话框
            await this.clearChat(chatId); // 先清空聊天记录

            // 根据类型执行删除操作
            if (type === 'group') {
                if (entity.owner === UserManager.userId) await GroupManager.dissolveGroup(chatId); // 群主解散
                else await GroupManager.leaveGroup(chatId); // 成员离开
            } else await UserManager.removeContact(chatId); // UserManager.removeContact 会处理 isSpecialContactInCurrentTheme

            // 如果删除的是当前聊天，则重置UI
            if (chatId === this.currentChatId) {
                this.currentChatId = null;
                if (typeof ChatAreaUIManager !== 'undefined') {
                    ChatAreaUIManager.showNoChatSelected();
                    ChatAreaUIManager.enableChatInterface(false);
                }
            }
            this.renderChatList(this.currentFilter); // 重新渲染聊天列表
        });
    },

    /**
     * 获取指定聊天中包含特定类型资源的消息。
     * @param {string} chatId - 聊天ID。
     * @param {string} resourceType - 资源类型 ('imagery', 'text', 'other', 'image', 'video', 'audio', 'file')。
     * @param {number} startIndex - 开始获取的索引。
     * @param {number} limit - 要获取的最大数量。
     * @returns {Promise<Array<object>>} - 包含资源消息的数组。
     */
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
                case 'imagery':
                    isMatch = (msg.type === 'image') ||
                        (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('image/')) ||
                        (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('video/'));
                    break;
                case 'text':
                    isMatch = msg.type === 'text';
                    break;
                case 'other':
                    isMatch = msg.type === 'audio' ||
                        (msg.type === 'file' && msg.fileType &&
                            !msg.fileType.startsWith('image/') &&
                            !msg.fileType.startsWith('video/'));
                    break;
                case 'image': // 保留旧的单一类型，以防直接调用
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
    },

    /**
     * 获取指定聊天中所有有消息的日期。
     * @param {string} chatId - 聊天ID。
     * @returns {Promise<Array<string>>} - YYYY-MM-DD格式的日期字符串数组。
     */
    getDatesWithMessages: async function(chatId) {
        if (!this.chats[chatId]) return [];
        const dates = new Set();
        this.chats[chatId].forEach(msg => {
            if (msg.timestamp && !msg.isThinking && !msg.isRetracted) { // 只考虑实际的、非临时消息
                const date = new Date(msg.timestamp);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                dates.add(`${year}-${month}-${day}`);
            }
        });
        return Array.from(dates).sort((a,b) => new Date(b).getTime() - new Date(a).getTime()); // 按日期降序返回
    }
};