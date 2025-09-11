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

export const useChatStore = defineStore('chat', () => {
    // --- STATE ---
    const chats = ref({}); // { [chatId]: message[] }
    const currentChatId = ref(null);

    // --- GETTERS ---
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

    const filteredChatList = computed(() => {
        const uiStore = useUiStore();
        const term = uiStore.chatListSearchTerm.toLowerCase().trim();
        return sortedChatList.value.filter(item => {
            const typeFilter = uiStore.chatListFilter === 'all' ? item.type : uiStore.chatListFilter;
            const typeMatch = item.type === typeFilter;
            const termMatch = !term || item.name.toLowerCase().includes(term);
            return typeMatch || (uiStore.chatListFilter === 'all' && termMatch);
        });
    });

    const currentChatMessages = computed(() => chats.value[currentChatId.value] || []);
    const getMessagesWithResources = computed(() => (chatId, resourceType, offset, limit) => {
        const allMessages = chats.value[chatId] || [];
        const filtered = [];
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (filtered.length >= offset + limit) break;
            const msg = allMessages[i];
            if (msg.isRetracted || msg.isThinking) continue;

            let isMatch = false;
            switch(resourceType) {
                case 'imagery': isMatch = msg.fileType?.startsWith('image/') || msg.fileType?.startsWith('video/') || msg.type === 'sticker'; break;
                case 'text': isMatch = msg.type === 'text'; break;
                case 'other': isMatch = msg.type === 'file' && !msg.fileType?.startsWith('image/') && !msg.fileType?.startsWith('video/') && !msg.type === 'sticker' || msg.type === 'audio'; break;
            }
            if(isMatch) filtered.push(msg);
        }
        return filtered.slice(offset, offset + limit);
    });

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
        return Array.from(dates).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    });

    // --- ACTIONS ---
    async function init() {
        const chatItems = await dbService.getAllItems('chats');
        const cleanedChats = {};
        const updatePromises = [];

        chatItems.forEach(item => {
            if (item.messages && Array.isArray(item.messages)) {
                // --- START OF FIX ---
                // Filter out any temporary messages (thinking, streaming) that might have been
                // left in the DB due to an app crash or improper shutdown.
                const cleanedMessages = item.messages.filter(msg => !msg.isThinking && !msg.isStreaming && !msg.toolCallInfo);
                if (cleanedMessages.length < item.messages.length) {
                    log(`ChatStore Init: 清理了聊天 ${item.id} 中 ${item.messages.length - cleanedMessages.length} 条未完成/临时消息。`, 'INFO');
                    const updatedItem = { ...item, messages: cleanedMessages };
                    updatePromises.push(dbService.setItem('chats', updatedItem));
                }
                cleanedChats[item.id] = cleanedMessages;
            } else {
                cleanedChats[item.id] = [];
            }
        });

        chats.value = cleanedChats;
        if (updatePromises.length > 0) Promise.all(updatePromises).catch(error => log(`清理数据库中未完成消息时出错: ${error}`, 'ERROR'));
        // --- END OF FIX ---
        log('聊天Store已初始化', 'INFO');
        eventBus.on('webrtc:message', handleIncomingMessage);
    }

    function formatPreview(message) {
        if (!message) return '';
        if (message.isRetracted) return '消息已撤回';
        if (message.toolCallInfo) return `正在使用工具: ${message.toolCallInfo.name}`;

        let senderPrefix = '';
        const userStore = useUserStore();
        if (message.groupId && message.sender !== userStore.userId) {
            senderPrefix = `${userStore.contacts[message.sender]?.name || '成员'}: `;
        }
        let content = '';
        switch (message.type) {
            case 'text': content = message.content; break;
            case 'image': content = '[图片]'; break;
            case 'sticker': content = '[贴图]'; break;
            case 'video': content = '[视频]'; break;
            case 'audio': content = '[语音消息]'; break;
            case 'file': content = `[文件] ${message.fileName || ''}`; break;
            case 'system': return message.content;
            default: content = '新消息';
        }
        const previewText = `${senderPrefix}${content}`;
        return previewText.length > 30 ? previewText.slice(0, 27) + '...' : previewText;
    }

    // --- START OF FIX ---
    // This action now intelligently updates or pushes messages
    async function addMessage(chatId, message) {
        if (!chats.value[chatId]) {
            chats.value[chatId] = [];
        }

        const existingIndex = chats.value[chatId].findIndex(m => m.id === message.id);

        if (existingIndex > -1) {
            // Update existing message, especially useful for streaming updates
            Object.assign(chats.value[chatId][existingIndex], message);
        } else {
            // Push new message
            chats.value[chatId].push(message);
        }

        // Only persist non-temporary messages to DB
        if (!message.isThinking && !message.isStreaming && !message.toolCallInfo) {
            await dbService.setItem('chats', { id: chatId, messages: Array.from(chats.value[chatId]) });
        }
    }
    // --- END OF FIX ---

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
            messagePayload = { type: 'sticker', fileHash: sticker.id, fileName: sticker.name, fileType: sticker.blob.type, size: sticker.size };
        } else if (content) {
            messagePayload = { type: 'text', content };
        } else return;

        const fullMessage = { id: generateId(16), sender: userStore.userId, timestamp, status: 'sending', ...messagePayload };
        await addMessage(targetId, fullMessage);

        const contact = userStore.contacts[targetId];
        const isGroup = targetId.startsWith('group_');

        if (contact?.isAI) {
            if (content) apiService.sendAiMessage(targetId, contact, content, currentChatMessages.value.slice(-15));
            else eventBus.emit('showNotification', { message: '不支持向 AI 发送文件或贴图', type: 'warning' });
        } else if (isGroup) {
            useGroupStore().broadcastMessage(targetId, fullMessage, file || sticker);
            // Ensure the persisted message gets the final 'sent' status
            await addMessage(targetId, { ...fullMessage, status: 'sent' });
        } else {
            const success = webrtcService.sendMessage(targetId, fullMessage);
            if (file || sticker) {
                const fileData = { blob: (file || sticker).blob, hash: (file || sticker).hash || (file || sticker).id, name: (file || sticker).name, type: (file || sticker).fileType || (file || sticker).blob.type, size: (file || sticker).size };
                webrtcService.sendFile(targetId, fileData);
            }
            // Ensure the persisted message gets the final status
            await addMessage(targetId, { ...fullMessage, status: success ? 'sent' : 'failed' });
            if (!success) eventBus.emit('showNotification', { message: '消息发送失败，对方可能不在线。', type: 'error' });
        }
    }

    async function handleIncomingMessage({ peerId, message }) {
        const chatId = message.groupId || peerId;
        if (message.type === 'retract-message-ack') {
            await _updateMessageToRetractedState(message.messageId, chatId, message.retractedByName);
            return;
        }
        await addMessage(chatId, { ...message, status: 'delivered' });
        if (currentChatId.value !== chatId || !document.hasFocus()) {
            if (message.groupId) useGroupStore().incrementUnread(chatId);
            else useUserStore().incrementUnread(chatId);
        }
    }

    function openChat(chatId) {
        currentChatId.value = chatId;
        useUiStore().toggleDetailsPanel(false);
        if (chatId?.startsWith('group_')) useGroupStore().clearUnread(chatId);
        else if (chatId) useUserStore().clearUnread(chatId);
        log(`打开聊天: ${chatId}`, 'INFO');
    }

    async function deleteChatHistory(chatId) {
        chats.value[chatId] = [];
        await dbService.setItem('chats', { id: chatId, messages: [] });
        if (chatId.startsWith('group_')) useGroupStore().updateGroupLastMessage(chatId, '聊天记录已清空');
        else useUserStore().updateContactLastMessage(chatId, '聊天记录已清空');
    }

    async function clearAllChats() {
        eventBus.emit('showConfirmation', {
            message: '确定要清空所有聊天记录吗？此操作无法撤销。',
            onConfirm: async () => {
                chats.value = {};
                await dbService.clearStore('chats');
                Object.keys(useUserStore().contacts).forEach(id => useUserStore().updateContactLastMessage(id, ''));
                Object.keys(useGroupStore().groups).forEach(id => useGroupStore().updateGroupLastMessage(id, ''));
                eventBus.emit('showNotification', { message: '所有聊天记录已清空', type: 'success' });
            }
        });
    }

    async function deleteMessage(messageId) {
        const chatId = Object.keys(chats.value).find(cid => chats.value[cid].some(m => m.id === messageId));
        if (!chatId) return;
        const messageIndex = chats.value[chatId]?.findIndex(m => m.id === messageId);
        if (messageIndex > -1) {
            chats.value[chatId].splice(messageIndex, 1);
            await dbService.setItem('chats', { id: chatId, messages: chats.value[chatId] });
        }
    }

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
        const retractInfo = { type: 'retract-message-ack', messageId, retractedByName: userStore.userName };
        if (chatId.startsWith('group_')) useGroupStore().broadcastMessage(chatId, retractInfo);
        else webrtcService.sendMessage(chatId, retractInfo);
        await _updateMessageToRetractedState(messageId, chatId, "你");
    }

    async function _updateMessageToRetractedState(messageId, chatId, retractedByName) {
        if (!chats.value[chatId]) return;
        const messageIndex = chats.value[chatId].findIndex(m => m.id === messageId);
        if (messageIndex > -1) {
            const originalMessage = chats.value[chatId][messageIndex];
            const retractedMessage = { ...originalMessage, type: 'system', isRetracted: true, content: `${retractedByName} 撤回了一条消息` };
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