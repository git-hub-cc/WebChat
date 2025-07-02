/**
 * @file ChatManager.js
 * @description 核心聊天管理器，管理聊天会话数据、状态，并与 ChatAreaUIManager 协作支持消息列表的虚拟滚动。
 *              负责存储和显示来自个人和群组的消息，包括系统消息和用户消息。
 *              与 GroupManager 协作，在群成员变更或群信息更新时刷新UI。
 *              修复：getDatesWithMessages 现在使用UTC日期来生成日期字符串，以解决资源预览日历中因时区导致 scrollToDate 功能失效的问题。
 *              REFACTORED: (第2阶段) 不再直接调用 SidebarUIManager 或 ChatAreaUIManager，而是通过 Store 更新状态。
 *              REFACTORED (Phase 3): 完全移除了对 UI 的直接渲染调用，例如 renderChatList。现在它只负责管理聊天数据，并通过 dispatch('DATA_MODIFIED') 来通知 Store 数据已变更。
 * @module ChatManager
 * @exports {object} ChatManager - 对外暴露的单例对象，包含所有聊天管理功能。
 * @dependencies DBManager, UserManager, GroupManager, ConnectionManager, MessageManager, NotificationUIManager, Utils, ModalUIManager, Store
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互。
 */
const ChatManager = {
    currentChatId: null,
    chats: {}, // { chatId: [messageObject, ...] }

    /**
     * 初始化聊天管理器，从数据库加载所有聊天记录。
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadChats();
        Store.subscribe(state => {
            this.currentChatId = state.currentChatId;
        });
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
     * REFACTORED (Phase 3): 移除 renderChatList 方法。UI渲染现在由 SidebarUIManager 响应 Store 变化来完成。
     */
    // renderChatList: function(filter = 'all') { ... } // REMOVED

    /**
     * @private
     * 格式化最后一条消息的预览文本。此方法现在被 Store._collectSidebarItems 调用。
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
     * REFACTORED (Phase 3): openChat 现在只负责处理数据和 dispatch action。
     * @param {string} chatId - 要打开的聊天 ID。
     */
    openChat: function(chatId) {
        if (this.currentChatId === chatId && window.innerWidth > 768) {
            return;
        }
        if (this.currentChatId) {
            this.saveCurrentChat();
        }
        this.currentChatId = chatId;

        const isGroup = chatId && chatId.startsWith('group_');
        if (isGroup) {
            GroupManager.clearUnread(chatId);
        } else if (chatId) {
            UserManager.clearUnread(chatId);
        }

        Store.dispatch('OPEN_CHAT', { chatId: chatId });

        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            setTimeout(() => messageInput.focus(), 0);
        }
    },

    /**
     * REFACTORED (Phase 3): addMessage 现在只负责数据操作，并通过 dispatch 通知 Store。
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

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== Store.getState().currentChatId || !document.hasFocus();

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
            Store.dispatch('MESSAGES_UPDATED', { chatId });
        } catch (error) {
            Utils.log(`保存消息到数据库失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * REFACTORED (Phase 3): 清理数据，并通过 dispatch 通知。
     * @param {string} chatId - 要清空的聊天 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    clearChat: async function(chatId) {
        if (chatId && this.chats[chatId]) {
            this.chats[chatId] = [];
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] });
                const message = '聊天记录已清空';
                if (chatId.startsWith('group_')) GroupManager.updateGroupLastMessage(chatId, message, false, true);
                else UserManager.updateContactLastMessage(chatId, message, false, true);
                Store.dispatch('MESSAGES_UPDATED', { chatId });
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                Store.dispatch('MESSAGES_UPDATED', { chatId });
                return false;
            }
        }
        return false;
    },

    /**
     * REFACTORED (Phase 3): 协调逻辑移至 Action Creator。
     */
    async clearAllChats() {
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
                    if (this.currentChatId) {
                        Store.dispatch('MESSAGES_UPDATED', { chatId: this.currentChatId });
                    }
                    Store.dispatch('DATA_MODIFIED');
                    NotificationUIManager.showNotification('所有聊天记录已清空。', 'success');
                } catch (error) {
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    await this.loadChats();
                    Store.dispatch('DATA_MODIFIED');
                }
            }
        );
    },

    /**
     * REFACTORED (Phase 3): 协调逻辑移至 Action Creator。
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
            if (chatId === Store.getState().currentChatId) {
                Store.dispatch('OPEN_CHAT', { chatId: null });
            }
            Store.dispatch('DATA_MODIFIED');
        });
    },

    // ... (getMessagesWithResources, getDatesWithMessages 保持不变)
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
    getDatesWithMessages: async function(chatId) {
        if (!this.chats[chatId]) return [];
        const dates = new Set();
        this.chats[chatId].forEach(msg => {
            if (msg.timestamp && !msg.isThinking && !msg.isRetracted) {
                const date = new Date(msg.timestamp);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                dates.add(`${year}-${month}-${day}`);
            }
        });
        return Array.from(dates).sort((a,b) => new Date(b).getTime() - new Date(a).getTime());
    }
};