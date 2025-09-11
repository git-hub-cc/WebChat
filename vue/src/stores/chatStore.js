import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { dbService } from '@/services/dbService';
import { apiService } from '@/services/apiService';
import { webrtcService } from '@/services/webrtcService';
import { useUserStore } from './userStore';
import { useUiStore } from './uiStore';
import { useGroupStore } from './groupStore';
import { generateId, log } from '@/utils';
import { eventBus } from '@/services/eventBus';
import AppSettings from '@/config/AppSettings';

/**
 * @file chatStore.js
 * @description (Vue Refactor) 管理所有聊天相关的状态和核心业务逻辑，
 *              包括消息记录、当前聊天状态、消息发送与接收、以及为UI提供计算好的数据。
 */
export const useChatStore = defineStore('chat', () => {
    // --- STATE ---
    const chats = ref({}); // { [chatId]: message[] }
    const currentChatId = ref(null);

    // --- GETTERS ---

    /**
     * 计算属性：生成一个包含所有联系人和群组的、按最新消息时间排序的列表。
     */
    const sortedChatList = computed(() => {
        const userStore = useUserStore();
        const groupStore = useGroupStore();

        const allItems = [
            ...Object.values(userStore.contacts),
            ...Object.values(groupStore.groups),
        ].map(item => {
            const chatHistory = chats.value[item.id];
            let lastMessage = item.initialMessage || (item.type === 'group' ? '群组已创建' : '开始聊天吧！');
            let lastTime = item.lastTime || new Date(0).toISOString();
            let unread = item.unread || 0;

            if (chatHistory?.length > 0) {
                const lastMsg = chatHistory[chatHistory.length - 1];
                if (lastMsg) {
                    lastMessage = formatPreview(lastMsg);
                    lastTime = lastMsg.timestamp;
                }
            }
            return { ...item, lastMessage, lastTime, unread };
        });

        return allItems.sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
    });

    /**
     * 计算属性：基于排序后的列表、当前过滤器和搜索词，生成最终在侧边栏显示的聊天列表。
     */
    const filteredChatList = computed(() => {
        const uiStore = useUiStore();
        const term = uiStore.chatListSearchTerm.toLowerCase().trim();
        return sortedChatList.value.filter(item => {
            const typeMatch = uiStore.chatListFilter === 'all' || item.type === uiStore.chatListFilter;
            const termMatch = !term || item.name.toLowerCase().includes(term);
            return typeMatch && termMatch;
        });
    });

    /**
     * 计算属性：获取当前活动聊天的所有消息。
     */
    const currentChatMessages = computed(() => chats.value[currentChatId.value] || []);

    /**
     * Getter as a function: 获取指定聊天的资源消息，支持分页。
     */
    const getMessagesWithResources = computed(() => (chatId, resourceType, offset, limit) => {
        const allMessages = chats.value[chatId] || [];
        const filtered = [];
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (filtered.length >= offset + limit) break;
            const msg = allMessages[i];
            if (msg.isRetracted || msg.isThinking) continue;

            let isMatch = false;
            switch(resourceType) {
                case 'imagery': isMatch = msg.fileType?.startsWith('image/') || msg.fileType?.startsWith('video/'); break;
                case 'text': isMatch = msg.type === 'text'; break;
                case 'other': isMatch = msg.type === 'file' && !msg.fileType?.startsWith('image/') && !msg.fileType?.startsWith('video/'); break;
            }
            if(isMatch) filtered.push(msg);
        }
        return filtered.slice(offset, offset + limit);
    });

    /**
     * Getter as a function: 获取指定聊天中所有有消息的日期。
     */
    const getDatesWithMessages = computed(() => (chatId) => {
        if (!chats.value[chatId]) return [];
        const dates = new Set();
        chats.value[chatId].forEach(msg => {
            if (msg.timestamp && !msg.isThinking && !msg.isRetracted) {
                const date = new Date(msg.timestamp);
                const year = date.getUTCFullYear();
                const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                const day = String(date.getUTCDate()).padStart(2, '0');
                dates.add(`${year}-${month}-${day}`);
            }
        });
        return Array.from(dates).sort((a,b) => new Date(b).getTime() - new Date(a).getTime());
    });

    // --- ACTIONS ---

    /**
     * 初始化 Chat Store，从数据库加载聊天记录并清理临时状态。
     */
    async function init() {
        const chatItems = await dbService.getAllItems('chats');
        const cleanedChats = {};
        const updatePromises = [];

        chatItems.forEach(item => {
            if (item.messages && Array.isArray(item.messages)) {
                // 移除任何可能因异常关闭而残留的 "思考中" 或 "流式" 状态消息
                const cleanedMessages = item.messages.filter(msg => !msg.isThinking && !msg.isStreaming);
                if (cleanedMessages.length < item.messages.length) {
                    log(`ChatStore Init: 清理了聊天 ${item.id} 中 ${item.messages.length - cleanedMessages.length} 条未完成的消息。`, 'INFO');
                    const updatedItem = { ...item, messages: cleanedMessages };
                    updatePromises.push(dbService.setItem('chats', updatedItem));
                }
                cleanedChats[item.id] = cleanedMessages;
            } else {
                cleanedChats[item.id] = [];
            }
        });

        chats.value = cleanedChats;

        if (updatePromises.length > 0) {
            Promise.all(updatePromises).catch(error => log(`ChatStore Init: 清理数据库中的未完成消息时出错: ${error}`, 'ERROR'));
        }

        log('聊天Store已初始化', 'INFO');
        eventBus.on('webrtc:message', handleIncomingMessage);
    }

    /**
     * 格式化消息预览文本。
     */
    function formatPreview(message) {
        if (!message) return '';
        if (message.isRetracted) return '消息已撤回';
        let senderPrefix = '';
        const userStore = useUserStore();
        if (message.groupId && message.sender !== userStore.userId) {
            const senderName = userStore.contacts[message.sender]?.name || '成员';
            senderPrefix = `${senderName}: `;
        }
        let content = '';
        switch (message.type) {
            case 'text': content = message.content; break;
            case 'image': case 'sticker': content = '[图片]'; break;
            case 'video': content = '[视频]'; break;
            case 'audio': content = '[语音消息]'; break;
            case 'file': content = `[文件] ${message.fileName || ''}`; break;
            case 'system': return message.content;
            default: content = '新消息';
        }
        const previewText = `${senderPrefix}${content}`;
        return previewText.length > 30 ? previewText.slice(0, 27) + '...' : previewText;
    }

    /**
     * 向指定聊天添加或更新一条消息，并持久化到数据库。
     */
    async function addMessage(chatId, message) {
        if (!chats.value[chatId]) chats.value[chatId] = [];
        const existingIndex = chats.value[chatId].findIndex(m => m.id === message.id);
        if (existingIndex > -1) {
            // Update existing message
            Object.assign(chats.value[chatId][existingIndex], message);
        } else {
            // Add new message
            chats.value[chatId].push(message);
        }
        // Persist the entire chat history for this chat
        await dbService.setItem('chats', { id: chatId, messages: Array.from(chats.value[chatId]) });
    }

    /**
     * 发送消息的核心 action。
     */
    async function sendMessage({ content = null, file = null, sticker = null }) {
        if (!currentChatId.value) return;
        const targetId = currentChatId.value;
        const userStore = useUserStore();
        const timestamp = new Date().toISOString();
        let messagePayload;

        if (file) {
            const fileToCache = { id: file.hash, fileBlob: file.blob, metadata: { name: file.name, type: file.fileType, size: file.size } };
            await dbService.setItem('fileCache', fileToCache);
            messagePayload = { type: 'file', fileName: file.name, fileType: file.fileType, size: file.size, fileHash: file.hash };
        } else if (sticker) {
            const stickerToCache = { id: sticker.id, fileBlob: sticker.blob, metadata: { name: sticker.name, type: sticker.blob.type, size: sticker.blob.size } };
            await dbService.setItem('fileCache', stickerToCache);
            messagePayload = { type: 'sticker', fileHash: sticker.id, fileName: sticker.name, fileType: sticker.blob.type, size: sticker.blob.size };
        } else if (content) {
            messagePayload = { type: 'text', content };
        } else {
            return;
        }

        const fullMessage = {
            id: generateId(16),
            sender: userStore.userId,
            timestamp,
            status: 'sending',
            ...messagePayload
        };

        await addMessage(targetId, fullMessage);

        const contact = userStore.contacts[targetId];
        const isGroup = targetId.startsWith('group_');

        if (contact?.isAI) {
            if (content) {
                apiService.sendAiMessage(targetId, contact, content, currentChatMessages.value.slice(-15));
            } else {
                eventBus.emit('showNotification', { message: '不支持向 AI 发送文件或贴图', type: 'warning' });
            }
        } else if (isGroup) {
            useGroupStore().broadcastMessage(targetId, fullMessage, file || sticker);
            addMessage(targetId, { ...fullMessage, status: 'sent' });
        } else {
            const success = webrtcService.sendMessage(targetId, fullMessage);
            if (file || sticker) {
                const fileData = file || sticker;
                const plainFileObject = {
                    blob: fileData.blob,
                    hash: fileData.hash || fileData.id,
                    name: fileData.name,
                    type: fileData.fileType || fileData.blob.type,
                    size: fileData.size
                };
                webrtcService.sendFile(targetId, plainFileObject);
            }
            if (success) {
                addMessage(targetId, { ...fullMessage, status: 'sent' });
            } else {
                addMessage(targetId, { ...fullMessage, status: 'failed' });
                eventBus.emit('showNotification', { message: '消息发送失败，对方可能不在线。', type: 'error' });
            }
        }
    }

    /**
     * 处理从 WebRTC 收到的消息。
     */
    async function handleIncomingMessage({ peerId, message }) {
        const chatId = message.groupId || peerId;
        if (message.type === 'retract-message-ack') {
            await _updateMessageToRetractedState(message.messageId, chatId, message.retractedByName);
            return;
        }
        addMessage(chatId, { ...message, status: 'delivered' });
        const uiStore = useUiStore();
        if (currentChatId.value !== chatId || !document.hasFocus()) {
            if (message.groupId) {
                useGroupStore().incrementUnread(chatId);
            } else {
                useUserStore().incrementUnread(chatId);
            }
        }
    }

    /**
     * 打开一个聊天。
     */
    function openChat(chatId) {
        currentChatId.value = chatId;
        useUiStore().toggleDetailsPanel(false);
        if (chatId?.startsWith('group_')) {
            useGroupStore().clearUnread(chatId);
        } else if (chatId) {
            useUserStore().clearUnread(chatId);
        }
        log(`打开聊天: ${chatId}`, 'INFO');
    }

    /**
     * 清空指定聊天的历史记录。
     */
    async function deleteChatHistory(chatId) {
        chats.value[chatId] = [];
        await dbService.setItem('chats', { id: chatId, messages: [] });
        if (chatId.startsWith('group_')) {
            useGroupStore().updateGroupLastMessage(chatId, '聊天记录已清空');
        } else {
            useUserStore().updateContactLastMessage(chatId, '聊天记录已清空');
        }
    }

    /**
     * 清空所有聊天记录。
     */
    async function clearAllChats() {
        eventBus.emit('showConfirmation', {
            message: '确定要清空所有聊天记录吗？此操作无法撤销。',
            onConfirm: async () => {
                chats.value = {};
                await dbService.clearStore('chats');
                const userStore = useUserStore();
                const groupStore = useGroupStore();
                Object.keys(userStore.contacts).forEach(id => userStore.updateContactLastMessage(id, ''));
                Object.keys(groupStore.groups).forEach(id => groupStore.updateGroupLastMessage(id, ''));
                eventBus.emit('showNotification', { message: '所有聊天记录已清空', type: 'success' });
            }
        });
    }

    /**
     * 从本地删除单条消息。
     */
    async function deleteMessage(messageId) {
        const chatId = Object.keys(chats.value).find(cid => chats.value[cid].some(m => m.id === messageId));
        if (!chatId) return;

        const messageIndex = chats.value[chatId]?.findIndex(m => m.id === messageId);
        if (messageIndex > -1) {
            chats.value[chatId].splice(messageIndex, 1);
            await dbService.setItem('chats', { id: chatId, messages: chats.value[chatId] });
        }
    }

    /**
     * 撤回自己发送的消息。
     */
    async function retractMessage(messageId) {
        const chatId = currentChatId.value;
        if (!chatId) return;
        const message = chats.value[chatId]?.find(m => m.id === messageId);
        const userStore = useUserStore();

        if (!message || message.sender !== userStore.userId) return;
        if (Date.now() - new Date(message.timestamp).getTime() > AppSettings.ui.messageRetractionWindow) {
            eventBus.emit('showNotification', { message: '消息已超过可撤回时间', type: 'warning' });
            return;
        }

        const retractInfo = {
            type: 'retract-message-ack',
            messageId,
            retractedByName: userStore.userName
        };

        if (chatId.startsWith('group_')) {
            useGroupStore().broadcastMessage(chatId, retractInfo);
        } else {
            webrtcService.sendMessage(chatId, retractInfo);
        }

        await _updateMessageToRetractedState(messageId, chatId, "你");
    }

    /**
     * @private
     * 将消息更新为“已撤回”状态。
     */
    async function _updateMessageToRetractedState(messageId, chatId, retractedByName) {
        if (!chats.value[chatId]) return;
        const messageIndex = chats.value[chatId].findIndex(m => m.id === messageId);
        if (messageIndex > -1) {
            const originalMessage = chats.value[chatId][messageIndex];
            const retractedMessage = {
                ...originalMessage,
                type: 'system',
                isRetracted: true,
                content: `${retractedByName} 撤回了一条消息`
            };
            chats.value[chatId][messageIndex] = retractedMessage;
            await dbService.setItem('chats', { id: chatId, messages: chats.value[chatId] });
        }
    }

    return {
        chats, currentChatId, filteredChatList, currentChatMessages, getMessagesWithResources, getDatesWithMessages,
        init, addMessage, sendMessage, openChat, deleteChatHistory, clearAllChats, formatPreview,
        deleteMessage, retractMessage
    };
});