/**
 * @file ChatManager.js
 * @description 核心聊天管理器，管理聊天会话数据、状态、UI渲染，并与 ChatAreaUIManager 协作支持消息列表的虚拟滚动。
 *              负责存储和显示来自个人和群组的消息，包括系统消息和用户消息。
 *              与 GroupManager 协作，在群成员变更或群信息更新时刷新UI。
 *              修复：getDatesWithMessages 现在使用UTC日期来生成日期字符串，以解决资源预览日历中因时区导致 scrollToDate 功能失效的问题。
 *              OPTIMIZED: renderChatList 现在使用增量更新DOM，而不是完全重绘，以提高性能和流畅度。
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
     * OPTIMIZED: 根据筛选条件渲染侧边栏的聊天列表，使用增量更新以提高性能。
     * @param {string} [filter='all'] - 筛选条件 ('all', 'contacts', 'groups')。
     */
    renderChatList: function(filter = 'all') {
        this.currentFilter = filter;
        const chatListEl = document.getElementById('chatListNav');
        if (!chatListEl) {
            Utils.log("ChatManager.renderChatList: 未找到 chatListNav 元素！", Utils.logLevels.ERROR);
            return;
        }

        if (typeof SidebarUIManager !== 'undefined') SidebarUIManager.setActiveTab(filter);

        let itemsToRender = this._collectItemsToRender(filter);
        const searchQuery = document.getElementById('chatSearchInput')?.value.toLowerCase() || "";
        if (searchQuery) {
            itemsToRender = itemsToRender.filter(item => item.name.toLowerCase().includes(searchQuery));
        }

        // OPTIMIZATION: 使用增量更新DOM，而不是 innerHTML = ''
        const existingNodes = new Map();
        chatListEl.querySelectorAll('.chat-list-item').forEach(node => {
            existingNodes.set(node.dataset.id, node);
        });

        const fragment = document.createDocumentFragment();

        itemsToRender.forEach(item => {
            const existingNode = existingNodes.get(item.id);
            if (existingNode) {
                this._updateChatListItem(existingNode, item);
                existingNodes.delete(item.id);
            } else {
                const template = document.getElementById('chat-list-item-template').content;
                const clone = template.cloneNode(true);
                this._populateChatListItem(clone, item);
                fragment.appendChild(clone);
            }
        });

        // 删除不再需要的节点
        existingNodes.forEach(node => node.remove());

        // 添加新节点
        if (fragment.childElementCount > 0) {
            chatListEl.appendChild(fragment);
        }

        if (chatListEl.children.length === 0) {
            const filterText = { all: '聊天', contacts: '联系人', groups: '群组' }[filter] || '项目';
            chatListEl.innerHTML = `<li class="chat-list-item-empty">未找到${filterText}。</li>`;
        }
    },

    /**
     * @private
     * 辅助函数：填充一个新的聊天列表项。
     * @param {DocumentFragment} clone - 从模板克隆的文档片段。
     * @param {object} item - 列表项的数据。
     */
    _populateChatListItem(clone, item) {
        const li = clone.querySelector('.chat-list-item');
        li.addEventListener('click', () => this.openChat(item.id, item.type));
        this._updateChatListItem(li, item); // 复用更新逻辑来填充所有内容
    },

    /**
     * @private
     * 辅助函数：更新一个已存在的聊天列表项。
     * @param {HTMLElement} li - 要更新的列表项元素。
     * @param {object} item - 新的列表项数据。
     */
    _updateChatListItem(li, item) {
        const nameTextEl = li.querySelector('.name-text');
        const previewEl = li.querySelector('.chat-list-preview');
        const timeEl = li.querySelector('.chat-list-time');
        const badgeEl = li.querySelector('.chat-list-badge');
        const onlineDotEl = li.querySelector('.online-dot');
        const avatarEl = li.querySelector('.chat-list-avatar');

        // 更新数据和激活状态
        li.dataset.id = item.id;
        li.dataset.type = item.type;
        li.classList.toggle('active', item.id === this.currentChatId);
        li.classList.toggle('group', item.type === 'group');
        li.classList.toggle('special-contact', item.isSpecial);
        if (item.isSpecial) {
            li.classList.add(item.id);
            avatarEl.classList.add(item.id);
        } else {
            // 移除可能存在的旧特殊类
            Array.from(li.classList).forEach(cls => {
                if(ThemeLoader.themes[cls.replace(/-深色|-浅色/,'')] || cls.startsWith('AI_')){
                    li.classList.remove(cls);
                }
            });
            Array.from(avatarEl.classList).forEach(cls => {
                if(ThemeLoader.themes[cls.replace(/-深色|-浅色/,'')] || cls.startsWith('AI_')){
                    avatarEl.classList.remove(cls);
                }
            });
        }

        // 更新内容 (只在必要时更新以减少重绘)
        if (nameTextEl.textContent !== item.name) nameTextEl.textContent = item.name;
        if (previewEl.textContent !== item.lastMessage) previewEl.textContent = item.lastMessage;

        const formattedTime = item.lastTime ? Utils.formatDate(new Date(item.lastTime)) : '';
        if (timeEl.textContent !== formattedTime) timeEl.textContent = formattedTime;

        // 更新头像
        const fallbackText = (item.avatarText) ? Utils.escapeHtml(item.avatarText) : (item.name ? Utils.escapeHtml(item.name.charAt(0).toUpperCase()) : '?');
        const existingImg = avatarEl.querySelector('img');
        if (item.avatarUrl) {
            if (!existingImg || existingImg.src !== item.avatarUrl) {
                avatarEl.innerHTML = '';
                const img = document.createElement('img');
                img.src = item.avatarUrl;
                img.alt = fallbackText;
                img.className = 'avatar-image';
                img.dataset.fallbackText = fallbackText;
                img.dataset.entityId = item.id;
                img.loading = "lazy";
                avatarEl.appendChild(img);
            }
        } else {
            if (existingImg) existingImg.remove();
            if (avatarEl.textContent !== fallbackText) avatarEl.textContent = fallbackText;
        }

        // 更新状态指示器
        const shouldShowOnlineDot = item.type === 'contact' && item.online && !(item.isSpecial && UserManager.contacts[item.id]?.isAI);
        onlineDotEl.style.display = shouldShowOnlineDot ? 'inline-block' : 'none';

        const unreadCount = item.unread > 99 ? '99+' : item.unread;
        if (item.unread > 0) {
            if (badgeEl.style.display !== 'inline-block' || badgeEl.textContent !== unreadCount) {
                badgeEl.textContent = unreadCount;
                badgeEl.style.display = 'inline-block';
            }
        } else {
            if (badgeEl.style.display !== 'none') {
                badgeEl.style.display = 'none';
            }
        }
    },


    /**
     * @private
     * 收集并格式化用于渲染列表项的数据。
     * @param {string} filter - 筛选条件。
     * @returns {Array<object>} - 待渲染项的数组。
     */
    _collectItemsToRender(filter) {
        let items = [];
        // 收集联系人
        if (filter === 'all' || filter === 'contacts') {
            Object.values(UserManager.contacts).forEach(contact => {
                if ((!contact.isSpecial && !contact.isAI) || contact.isSpecial) {
                    items.push({
                        id: contact.id, name: contact.name, avatarText: contact.avatarText, avatarUrl: contact.avatarUrl,
                        lastMessage: this._formatLastMessagePreview(contact.id, contact.lastMessage, (contact.isSpecial && contact.isAI) ? '准备好聊天！' : '暂无消息'),
                        lastTime: contact.lastTime, unread: contact.unread || 0, type: 'contact',
                        online: contact.isSpecial ? true : ConnectionManager.isConnectedTo(contact.id), isSpecial: contact.isSpecial
                    });
                }
            });
        }
        // 收集群组
        if (filter === 'all' || filter === 'groups') {
            Object.values(GroupManager.groups).forEach(group => {
                items.push({
                    id: group.id, name: group.name, avatarText: '👥', avatarUrl: null,
                    lastMessage: this._formatLastMessagePreview(group.id, group.lastMessage, `成员: ${group.members.length}`),
                    lastTime: group.lastTime, unread: group.unread || 0, type: 'group'
                });
            });
        }
        // 排序
        items.sort((a, b) => (b.lastTime && a.lastTime) ? new Date(b.lastTime) - new Date(a.lastTime) : (b.lastTime ? 1 : -1));
        return items;
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
            if (lastMsg.isRetracted) {
                return lastMsg.content;
            }
        }
        return currentLastMessageText || defaultText;
    },

    /**
     * 打开指定的聊天会话。
     * @param {string} chatId - 要打开的聊天 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    openChat: function(chatId, type) {
        const isMobileView = (typeof LayoutUIManager !== 'undefined' && LayoutUIManager.appContainer) ?
            LayoutUIManager.appContainer.classList.contains('mobile-view') :
            document.querySelector('.app-container')?.classList.contains('mobile-view');

        if (this.currentChatId === chatId) {
            if (isMobileView) {
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
            GroupManager.openGroup(chatId); // GroupManager 会处理群组UI更新和未读清除
        } else {
            const contact = UserManager.contacts[chatId];
            if (contact && typeof ChatAreaUIManager !== 'undefined') {
                if (contact.isSpecial && contact.isAI) {
                    ChatAreaUIManager.updateChatHeader(contact.name, UserManager.getAiServiceStatusMessage(), contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else if (contact.isSpecial && !contact.isAI) {
                    ChatAreaUIManager.updateChatHeader(contact.name, '特殊联系人', contact.avatarText || 'S');
                    ChatAreaUIManager.setCallButtonsState(false);
                } else {
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

    /**
     * 向指定聊天添加一条消息，并处理 UI 更新和数据持久化。
     * @param {string} chatId - 目标聊天的 ID。
     * @param {object} message - 要添加的消息对象。
     * @returns {Promise<void>}
     */
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

    /**
     * 清空所有聊天记录（包括联系人和群组的）。
     * @returns {Promise<void>}
     */
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
                        if (c.isSpecial) {
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

    /**
     * 删除指定的聊天（联系人或群组）。
     * @param {string} chatId - 要删除的聊天 ID。
     * @param {string} type - 聊天类型 ('contact' 或 'group')。
     */
    deleteChat: function(chatId, type) {
        const entity = type === 'group' ? GroupManager.groups[chatId] : UserManager.contacts[chatId];
        if (!entity) {
            NotificationUIManager.showNotification(`${type === 'group' ? '群组' : '联系人'}未找到。`, 'error');
            return;
        }

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
            } else await UserManager.removeContact(chatId);

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
    },

    /**
     * 获取指定聊天中所有有消息的日期。
     * 日期字符串现在基于消息的UTC日期生成，以解决 `ChatAreaUIManager.scrollToDate`
     * 可能因 `new Date("YYYY-MM-DD")` 解析为UTC午夜而导致的问题。
     * @param {string} chatId - 聊天ID。
     * @returns {Promise<Array<string>>} - YYYY-MM-DD格式的UTC日期字符串数组。
     */
    getDatesWithMessages: async function(chatId) {
        if (!this.chats[chatId]) return [];
        const dates = new Set();
        this.chats[chatId].forEach(msg => {
            if (msg.timestamp && !msg.isThinking && !msg.isRetracted) {
                const date = new Date(msg.timestamp); // Message timestamp is UTC (ISO string)
                // Generate date string based on UTC components
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0'); // getUTCMonth is 0-indexed
                const day = String(date.getUTCDate()).padStart(2, '0');
                dates.add(`${year}-${month}-${day}`);
            }
        });
        // Sort dates. new Date("YYYY-MM-DD") parses as UTC midnight, so getTime() is comparable.
        return Array.from(dates).sort((a,b) => new Date(b).getTime() - new Date(a).getTime());
    }
};