/**
 * @file ChatManager.js
 * @description 核心聊天管理器，负责管理聊天会话数据、状态，并与 UI 管理器协作以支持消息列表的虚拟滚动。
 *              该模块的主要职责是存储和管理来自个人和群组的消息（包括用户消息和系统消息），并与 GroupManager 协作，在群成员或群信息更新时刷新 UI。
 *              修复说明：`getDatesWithMessages` 方法现在使用 UTC 日期来生成日期字符串，以解决因时区差异导致资源预览日历中 `scrollToDate` 功能失效的问题。
 *              重构说明 (Phase 2): 不再直接调用 SidebarUIManager 或 ChatAreaUIManager，而是通过 Store 更新状态，实现数据与视图的分离。
 *              重构说明 (Phase 3): 完全移除了对 UI 的直接渲染调用（如 renderChatList）。现在它只负责管理聊天数据，并通过 `dispatch('DATA_MODIFIED')` 通知 Store 数据已变更。
 * @module ChatManager
 * @exports {object} ChatManager - 对外暴露的单例对象，包含所有聊天管理功能。
 * @dependency DBManager, UserManager, GroupManager, ConnectionManager, MessageManager, NotificationUIManager, Utils, ModalUIManager, Store
 */
const ChatManager = {
    // 当前活动（正在查看）的聊天窗口ID
    currentChatId: null,
    // 内存中的聊天数据缓存，结构为 { chatId: [messageObject, ...] }
    chats: {},

    /**
     * 初始化聊天管理器，从数据库加载所有聊天记录到内存。
     * @function init
     * @returns {Promise<void>}
     */
    init: async function() {
        // 1. 加载所有聊天记录
        await this.loadChats();
        // 2. 订阅 Store 的状态变化，以同步当前聊天ID
        Store.subscribe(state => {
            this.currentChatId = state.currentChatId;
        });
    },

    /**
     * 打开一个聊天窗口。此方法仅负责处理数据和分发 action，UI 的更新由其他模块响应 Store 变化来完成。
     * @function openChat
     * @param {string} chatId - 要打开的聊天 ID。
     */
    openChat: function(chatId) {
        // 在宽屏设备上，如果点击当前已打开的聊天，则不执行任何操作
        if (this.currentChatId === chatId && window.innerWidth > 768) {
            return;
        }
        // 如果之前有打开的聊天，先保存其聊天记录
        if (this.currentChatId) {
            this.saveCurrentChat();
        }

        // 更新当前聊天ID
        this.currentChatId = chatId;

        // 清除未读消息标记
        const isGroup = chatId && chatId.startsWith('group_');
        if (isGroup) {
            GroupManager.clearUnread(chatId);
        } else if (chatId) {
            UserManager.clearUnread(chatId);
        }

        // 分发 action 通知 Store 聊天已打开，以便其他模块（如 UI 管理器）可以响应
        Store.dispatch('OPEN_CHAT', { chatId: chatId });

        // 自动聚焦到消息输入框
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = ''; // 清空输入框
            messageInput.style.height = 'auto'; // 重置高度
            setTimeout(() => messageInput.focus(), 0); // 延迟聚焦以确保UI渲染完成
        }
    },

    /**
     * 向指定聊天添加一条消息。此方法只负责数据操作，并通过分发 action 通知 Store。
     * @function addMessage
     * @param {string} chatId - 目标聊天的 ID。
     * @param {object} message - 要添加的消息对象。
     * @returns {Promise<void>}
     */
    addMessage: async function(chatId, message) {
        // 处理流程如下：
        // 1. 确保该聊天的消息数组存在
        if (!this.chats[chatId]) this.chats[chatId] = [];
        let messageExists = false;

        // 2. 如果消息带有ID，检查是否为更新现有消息
        if (message.id) {
            const existingMsgIndex = this.chats[chatId].findIndex(m => m.id === message.id);
            if (existingMsgIndex !== -1) {
                // 更新现有消息
                this.chats[chatId][existingMsgIndex] = { ...this.chats[chatId][existingMsgIndex], ...message };
                messageExists = true;
                Utils.log(`已更新聊天 ${chatId} 中的消息 ${message.id}`, Utils.logLevels.DEBUG);
            }
        }

        // 3. 如果是新消息，则为其生成ID并添加到数组
        if (!messageExists) {
            if (!message.id) message.id = `msg_${Date.now()}_${Utils.generateId(4)}`;
            this.chats[chatId].push(message);
        }

        const isGroup = chatId.startsWith('group_');
        const isUnread = chatId !== Store.getState().currentChatId || !document.hasFocus();

        // 4. 更新侧边栏的最后消息预览和未读状态
        if (!message.isStreaming && !message.isRetracted && !message.isThinking) {
            // 对于普通消息
            const previewText = isGroup ? GroupManager.formatMessagePreview(message) : UserManager.formatMessagePreview(message);
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, previewText, isUnread);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, previewText, isUnread);
            }
        } else if (message.isRetracted) {
            // 对于撤回的消息
            const retractedPreview = message.content;
            if (isGroup) {
                if (GroupManager.groups[chatId]) await GroupManager.updateGroupLastMessage(chatId, retractedPreview, false, true);
            } else {
                if (UserManager.contacts[chatId]) await UserManager.updateContactLastMessage(chatId, retractedPreview, false, true);
            }
        }

        // 5. 将更新后的聊天记录保存到数据库并通知 Store
        try {
            // 创建消息副本以进行数据库存储，移除临时的UI状态字段
            const messagesForDb = this.chats[chatId].map(msg => {
                const msgCopy = { ...msg };
                delete msgCopy.isNewlyCompletedAIResponse;
                return msgCopy;
            });
            await DBManager.setItem('chats', { id: chatId, messages: messagesForDb });
            // 通知 Store 消息已更新，以便UI可以重新渲染
            Store.dispatch('MESSAGES_UPDATED', { chatId });
        } catch (error) {
            Utils.log(`保存消息到数据库失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 清空指定聊天的所有消息。此方法只负责数据操作，并通过分发 action 通知。
     * @function clearChat
     * @param {string} chatId - 要清空的聊天 ID。
     * @returns {Promise<boolean>} 操作是否成功。
     */
    clearChat: async function(chatId) {
        if (chatId && this.chats[chatId]) {
            this.chats[chatId] = []; // 清空内存中的消息
            try {
                await DBManager.setItem('chats', { id: chatId, messages: [] }); // 清空数据库中的消息
                const message = '聊天记录已清空';
                // 更新侧边栏预览
                if (chatId.startsWith('group_')) {
                    GroupManager.updateGroupLastMessage(chatId, message, false, true);
                } else {
                    UserManager.updateContactLastMessage(chatId, message, false, true);
                }
                Store.dispatch('MESSAGES_UPDATED', { chatId }); // 通知UI更新
                return true;
            } catch (error) {
                Utils.log(`清空聊天记录失败 (${chatId}): ${error}`, Utils.logLevels.ERROR);
                Store.dispatch('MESSAGES_UPDATED', { chatId }); // 即使失败也尝试更新UI
                return false;
            }
        }
        return false;
    },

    /**
     * 清空所有聊天记录。协调逻辑移至 Action Creator。
     * @function clearAllChats
     * @returns {Promise<void>}
     */
    async clearAllChats() {
        ModalUIManager.showConfirmationModal(
            '您确定要清空所有聊天记录吗？此操作无法撤销。',
            async () => {
                // 1. 记录要清空的聊天ID，并清空内存中的数据
                const chatIdsToClear = Object.keys(this.chats);
                this.chats = {};
                try {
                    // 2. 遍历并清空数据库中的每条聊天记录
                    for (const id of chatIdsToClear) {
                        await DBManager.setItem('chats', { id: id, messages: [] });
                    }
                    // 3. 更新所有联系人和群组的侧边栏预览文本
                    Object.values(UserManager.contacts).forEach(c => {
                        let defaultMsg = '聊天记录已清空';
                        // 对特殊联系人使用其初始消息作为预览
                        if (c.isSpecial) {
                            const specialDef = (typeof ThemeLoader !== 'undefined' && ThemeLoader.getCurrentSpecialContactsDefinitions) ? ThemeLoader.getCurrentSpecialContactsDefinitions().find(sd => sd.id === c.id) : null;
                            defaultMsg = specialDef ? specialDef.initialMessage : defaultMsg;
                        }
                        UserManager.updateContactLastMessage(c.id, defaultMsg, false, true);
                    });
                    Object.values(GroupManager.groups).forEach(g => GroupManager.updateGroupLastMessage(g.id, '聊天记录已清空', false, true));

                    // 4. 如果当前聊天被清空，通知UI更新
                    if (this.currentChatId) {
                        Store.dispatch('MESSAGES_UPDATED', { chatId: this.currentChatId });
                    }
                    // 5. 触发全局数据修改通知，以便侧边栏等刷新
                    Store.dispatch('DATA_MODIFIED');
                    NotificationUIManager.showNotification('所有聊天记录已清空。', 'success');
                } catch (error) {
                    // 错误处理：回滚操作
                    Utils.log('清空所有聊天记录失败: ' + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification('从数据库清空所有聊天记录失败。', 'error');
                    await this.loadChats(); // 重新从数据库加载数据
                    Store.dispatch('DATA_MODIFIED'); // 通知UI刷新
                }
            }
        );
    },

    /**
     * 删除一个聊天（联系人或群组）。协调逻辑移至 Action Creator。
     * @function deleteChat
     * @param {string} chatId - 要删除的聊天 ID。
     * @param {string} type - 实体类型，'contact' 或 'group'。
     */
    deleteChat: function(chatId, type) {
        // 1. 查找要删除的实体（联系人或群组）
        const entity = type === 'group' ? GroupManager.groups[chatId] : UserManager.contacts[chatId];
        if (!entity) {
            NotificationUIManager.showNotification(`${type === 'group' ? '群组' : '联系人'}未找到。`, 'error');
            return;
        }

        // 2. 检查是否为当前主题的内置联系人，如果是则不可删除
        if (type === 'contact' && UserManager.isSpecialContactInCurrentTheme(entity.id)) {
            NotificationUIManager.showNotification(`${entity.name} 是当前主题的内置联系人，无法删除。如果需要，您可以清空聊天记录。`, 'warning');
            return;
        }

        // 3. 构建并显示确认对话框
        const entityName = entity.name;
        let confirmMessage = `您确定要删除联系人 "${entityName}" 吗？所有相关消息都将丢失。`;
        if (type === 'group') {
            const actionText = entity.owner === UserManager.userId ? '解散此群组' : '退出此群组';
            confirmMessage = `您确定要${actionText} ("${entityName}") 吗？所有相关消息都将丢失。`;
        }

        // 4. 在用户确认后执行删除操作
        ModalUIManager.showConfirmationModal(confirmMessage, async () => {
            await this.clearChat(chatId); // 首先清空聊天记录

            // 根据类型执行解散、退出或删除操作
            if (type === 'group') {
                if (entity.owner === UserManager.userId) await GroupManager.dissolveGroup(chatId);
                else await GroupManager.leaveGroup(chatId);
            } else {
                await UserManager.removeContact(chatId);
            }

            // 如果删除的是当前聊天，则关闭聊天窗口
            if (chatId === Store.getState().currentChatId) {
                Store.dispatch('OPEN_CHAT', { chatId: null });
            }
            // 通知全局数据已修改
            Store.dispatch('DATA_MODIFIED');
        });
    },

    /**
     * 获取指定聊天中包含特定类型资源的消息列表（用于资源预览）。
     * @function getMessagesWithResources
     * @param {string} chatId - 聊天 ID。
     * @param {string} resourceType - 资源类型（'imagery', 'text', 'other', 'image', 'video', 'audio', 'file'）。
     * @param {number} startIndex - 开始索引，用于分页。
     * @param {number} limit - 每页数量限制。
     * @returns {Promise<Array<object>>} - 过滤后的消息对象数组。
     */
    getMessagesWithResources: async function(chatId, resourceType, startIndex, limit) {
        if (!this.chats[chatId]) {
            return [];
        }
        const allMessages = this.chats[chatId];
        const filteredMessages = [];
        // 从后往前遍历，以获取最新的消息
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const msg = allMessages[i];
            if (msg.isRetracted || msg.isThinking) continue; // 跳过已撤回或正在生成的消息

            let isMatch = false;
            // 根据资源类型进行匹配
            switch (resourceType) {
                case 'imagery': // 图片和视频
                    isMatch = (msg.type === 'image') ||
                        (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('image/')) ||
                        (msg.type === 'file' && msg.fileType && msg.fileType.startsWith('video/'));
                    break;
                case 'text': // 纯文本
                    isMatch = msg.type === 'text';
                    break;
                case 'other': // 其他类型文件
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
        // 应用分页
        return filteredMessages.slice(startIndex, startIndex + limit);
    },

    /**
     * 获取指定聊天中所有有消息的日期列表（用于资源预览日历）。
     * @function getDatesWithMessages
     * @param {string} chatId - 聊天 ID。
     * @returns {Promise<Array<string>>} - 日期字符串（'YYYY-MM-DD'）数组，按降序排列。
     */
    getDatesWithMessages: async function(chatId) {
        if (!this.chats[chatId]) return [];
        const dates = new Set();
        this.chats[chatId].forEach(msg => {
            if (msg.timestamp && !msg.isThinking && !msg.isRetracted) {
                // 使用 UTC 日期以避免时区问题
                const date = new Date(msg.timestamp);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                dates.add(`${year}-${month}-${day}`);
            }
        });
        // 转换为数组并按日期降序排序
        return Array.from(dates).sort((a,b) => new Date(b).getTime() - new Date(a).getTime());
    },

    /**
     * @private
     * 格式化最后一条消息的预览文本。此方法由 Store 的内部逻辑调用。
     * @function _formatLastMessagePreview
     * @param {string} chatId - 聊天ID。
     * @param {string} currentLastMessageText - 当前存储的最后消息文本。
     * @param {string} defaultText - 如果没有消息时的默认文本。
     * @returns {string} 格式化后的预览文本。
     */
    _formatLastMessagePreview: function(chatId, currentLastMessageText, defaultText) {
        const chatHistory = this.chats[chatId];
        if (chatHistory && chatHistory.length > 0) {
            const lastMsg = chatHistory[chatHistory.length - 1];
            // 如果最后一条消息被撤回，预览应显示撤回提示
            if (lastMsg.isRetracted) {
                return lastMsg.content;
            }
        }
        // 否则返回当前文本或默认文本
        return currentLastMessageText || defaultText;
    },

    /**
     * 从 IndexedDB 加载所有聊天记录到内存中。
     * @function loadChats
     * @returns {Promise<void>}
     */
    loadChats: async function() {
        try {
            await DBManager.init();
            const chatItems = await DBManager.getAllItems('chats');
            this.chats = {}; // 清空现有缓存
            if (chatItems && chatItems.length > 0) {
                chatItems.forEach(item => {
                    // 确保 messages 字段是一个数组
                    this.chats[item.id] = Array.isArray(item.messages) ? item.messages : [];
                });
            }
        } catch (error) {
            Utils.log(`加载聊天记录失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 将当前活动聊天的消息保存到数据库。
     * @function saveCurrentChat
     * @returns {Promise<void>}
     */
    saveCurrentChat: async function() {
        if (this.currentChatId && this.chats[this.currentChatId]) {
            try {
                // 创建消息副本以进行数据库存储，移除临时的UI状态字段
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
};