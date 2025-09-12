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
import { useTtsStore } from './ttsStore';

export const useChatStore = defineStore('chat', () => {
    const chats = ref({});
    const currentChatId = ref(null);
    const temporaryMessages = ref({});

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
            const typeFilter = uiStore.chatListFilter === 'all' ? true : item.type === uiStore.chatListFilter;
            const termMatch = !term || item.name.toLowerCase().includes(term);
            return typeFilter && termMatch;
        });
    });

    const currentChatMessages = computed(() => {
        const persistent = chats.value[currentChatId.value] || [];
        const temporary = temporaryMessages.value[currentChatId.value] || [];
        const sortedMessages = [...persistent, ...temporary]
            .filter(m => m && m.id)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // --- MODIFICATION START: Calculate isConsecutive property here ---
        return sortedMessages.map((msg, index, allMsgs) => {
            if (index === 0) {
                return { ...msg, isConsecutive: false };
            }
            const prevMsg = allMsgs[index - 1];
            const isConsecutive = msg && prevMsg &&
                msg.sender === prevMsg.sender &&
                msg.type !== 'system' && !msg.isRetracted &&
                prevMsg.type !== 'system' && !prevMsg.isRetracted;
            return { ...msg, isConsecutive };
        });
        // --- MODIFICATION END ---
    });

    const isMessageRetractable = computed(() => (messageId) => {
        const chatId = Object.keys(chats.value).find(cid => chats.value[cid].some(m => m.id === messageId));
        if (!chatId) return false;

        const message = chats.value[chatId].find(m => m.id === messageId);
        const userStore = useUserStore();

        if (!message || message.sender !== userStore.userId) return false;
        if (message.isRetracted || message.type === 'system') return false;

        return Date.now() - new Date(message.timestamp).getTime() < AppSettings.ui.messageRetractionWindow;
    });


    const getMessagesWithResources = computed(() => (chatId, resourceType, offset, limit) => {
        const allMessages = chats.value[chatId] || [];
        const filtered = [];
        for (let i = allMessages.length - 1; i >= 0; i--) {
            if (filtered.length >= offset + limit) break;
            const msg = allMessages[i];
            if (msg.isRetracted || msg.isThinking || msg.isStreaming || msg.toolCallInfo) continue;
            let isMatch = false;
            switch(resourceType) {
                case 'imagery': isMatch = ['image', 'video', 'sticker'].includes(msg.type); break;
                case 'text': isMatch = msg.type === 'text'; break;
                case 'other': isMatch = ['file', 'audio'].includes(msg.type); break;
            }
            if(isMatch) filtered.push(msg);
        }
        return filtered.slice(offset, offset + limit);
    });

    const getDatesWithMessages = computed(() => (chatId) => {
        if (!chats.value[chatId]) return [];
        const dates = new Set();
        chats.value[chatId].forEach(msg => {
            if (msg.timestamp && !msg.isThinking && !msg.isRetracted && !msg.isStreaming && !msg.toolCallInfo) {
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
                const cleanedMessages = item.messages.filter(msg => msg && msg.id && !msg.isThinking && !msg.isStreaming && !msg.toolCallInfo);
                if (cleanedMessages.length < item.messages.length) {
                    log(`ChatStore Init: Cleaned ${item.messages.length - cleanedMessages.length} temporary messages from chat ${item.id}.`, 'INFO');
                    const updatedItem = { ...item, messages: cleanedMessages };
                    updatePromises.push(dbService.setItem('chats', updatedItem));
                }
                cleanedChats[item.id] = cleanedMessages;
            } else {
                cleanedChats[item.id] = [];
            }
        });
        chats.value = cleanedChats;
        if (updatePromises.length > 0) Promise.all(updatePromises).catch(error => log(`Error cleaning up DB messages: ${error}`, 'ERROR'));
        log('Chat Store initialized', 'INFO');

        eventBus.on('webrtc:message', handleIncomingMessage);
        eventBus.on('message:delivered', ({ messageId, peerId }) => { _updateMessageState(peerId, messageId, { status: 'delivered' }); });
        eventBus.on('message:file-delivered', ({ messageId, peerId }) => { _updateMessageState(peerId, messageId, { status: 'delivered' }); });
        eventBus.on('message:retracted', ({ chatId, messageId, retractedByName }) => {
            _updateMessageToRetractedState(messageId, chatId, retractedByName);
        });
    }

    function formatPreview(message) {
        if (!message) return '';
        if (message.type === 'system' && message.subType === 'call-log') return message.content;
        if (message.isRetracted) return '消息已撤回';
        if (message.toolCallInfo) return `正在使用工具: ${message.toolCallInfo.name}`;
        if (message.isThinking) return `思考中...`;
        if (message.isStreaming) return `正在输入...`;
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

    async function _updateMessageState(chatId, messageId, updates) {
        if (!chats.value[chatId]) return;
        const messageIndex = chats.value[chatId].findIndex(m => m.id === messageId);
        if (messageIndex > -1) {
            Object.assign(chats.value[chatId][messageIndex], updates);
            const messagesToSave = JSON.parse(JSON.stringify(chats.value[chatId]));
            await dbService.setItem('chats', { id: chatId, messages: messagesToSave });
        }
    }

    async function addMessage(chatId, message) {
        if (!chats.value[chatId]) chats.value[chatId] = [];
        const existingIndex = chats.value[chatId].findIndex(m => m.id === message.id);
        if (existingIndex > -1) {
            Object.assign(chats.value[chatId][existingIndex], message);
        } else {
            chats.value[chatId].push(message);
        }
        if (!message.isThinking && !message.isStreaming && !message.toolCallInfo) {
            const messagesToSave = JSON.parse(JSON.stringify(chats.value[chatId]));
            await dbService.setItem('chats', { id: chatId, messages: messagesToSave });
        }
    }

    async function sendMessage({ content = null, file = null, sticker = null }, isResend = false) {
        if (!currentChatId.value) return;
        const targetId = currentChatId.value;
        const userStore = useUserStore();
        const groupStore = useGroupStore();

        const contact = userStore.contacts[targetId];
        const isGroup = targetId.startsWith('group_');

        let messagePayload;
        let fileDataForTransport = null;
        const messageId = generateId(16);

        if (file || sticker) {
            const mediaData = file || sticker;
            const mediaBlob = mediaData.blob;
            const mediaHash = mediaData.hash || mediaData.id;
            let messageType = 'file';
            if (mediaData.type === 'audio') messageType = 'audio';
            else if (sticker) messageType = 'sticker';
            else if (mediaData.fileType?.startsWith('image/')) messageType = 'image';
            else if (mediaData.fileType?.startsWith('video/')) messageType = 'video';

            await dbService.setItem('fileCache', {
                id: mediaHash,
                fileBlob: mediaBlob,
                metadata: { name: mediaData.name, type: mediaData.fileType || mediaBlob.type, size: mediaData.size || mediaBlob.size }
            });

            messagePayload = {
                type: messageType,
                fileHash: mediaHash,
                fileName: mediaData.name,
                fileType: mediaData.fileType || mediaBlob.type,
                size: mediaData.size || mediaBlob.size,
                ...(messageType === 'audio' && { duration: mediaData.duration })
            };

            fileDataForTransport = {
                blob: mediaBlob,
                hash: mediaHash,
                name: mediaData.name,
                type: mediaData.fileType || mediaBlob.type,
                size: mediaData.size || mediaBlob.size,
                messageId: messageId
            };
        } else if (content) {
            messagePayload = { type: 'text', content };
        } else return;

        const fullMessage = {
            id: messageId,
            sender: userStore.userId,
            timestamp: new Date().toISOString(),
            status: 'sending',
            ...messagePayload
        };

        await addMessage(targetId, fullMessage);

        // --- Centralized Sending Logic ---
        if (contact?.isAI) {
            await apiService.sendAiMessage(targetId, content, chats.value[targetId]?.slice(-15) || []);
            _updateMessageState(targetId, fullMessage.id, { status: 'sent' });
        } else if (isGroup) {
            groupStore.broadcastMessage(targetId, fullMessage, { file: fileDataForTransport });
            _updateMessageState(targetId, fullMessage.id, { status: 'sent' });
            const group = groupStore.groups[targetId];
            if (group && content) {
                group.members.forEach(memberId => {
                    const memberContact = userStore.contacts[memberId];
                    if (memberContact?.isAI && content.includes(`@${memberContact.name}`)) {
                        const historyForAI = chats.value[targetId]?.filter(m => m.id !== fullMessage.id).slice(-15) || [];
                        apiService.sendGroupAiMessage(targetId, memberId, content, userStore.userId, historyForAI);
                    }
                });
            }
        } else { // P2P
            try {
                webrtcService.sendMessage(targetId, fullMessage);
                if (fileDataForTransport) {
                    await webrtcService.sendFile(targetId, fileDataForTransport);
                }
                await _updateMessageState(targetId, fullMessage.id, { status: 'sent' });
                log(`Message ${fullMessage.id} sent to ${targetId}`, 'INFO');
            } catch (error) {
                await _updateMessageState(targetId, fullMessage.id, { status: 'failed' });
                log(`Message ${fullMessage.id} failed to send to ${targetId}: ${error.message}`, 'ERROR');
                if (!isResend) {
                    eventBus.emit('showNotification', { message: '消息发送失败，对方可能已离线。', type: 'error' });
                }
            }
        }
    }

    async function resendFailedMessages(peerId) {
        if (!chats.value[peerId]) return;
        const failedMessages = chats.value[peerId].filter(m => m.status === 'failed' && m.sender === useUserStore().userId);
        if (failedMessages.length === 0) return;
        log(`Found ${failedMessages.length} failed messages for ${peerId}. Resending...`, 'INFO');
        eventBus.emit('showNotification', { message: `正在为 ${useUserStore().contacts[peerId]?.name || '用户'} 重发 ${failedMessages.length} 条失败的消息...`, type: 'info' });

        chats.value[peerId] = chats.value[peerId].filter(m => m.status !== 'failed' || m.sender !== useUserStore().userId);

        for (const message of failedMessages) {
            const fileBlob = message.fileHash ? (await dbService.getItem('fileCache', message.fileHash))?.fileBlob : null;
            const payload = {
                content: message.content,
                file: message.fileHash && (message.type === 'file' || message.type === 'image' || message.type === 'video' || message.type === 'audio') ? {
                    hash: message.fileHash, name: message.fileName, fileType: message.fileType, size: message.size, blob: fileBlob,
                    ...(message.type === 'audio' && {duration: message.duration})
                } : null,
                sticker: message.fileHash && message.type === 'sticker' ? {
                    id: message.fileHash, name: message.fileName, size: message.size, blob: fileBlob
                } : null
            };
            if ((payload.file || payload.sticker) && !payload.file?.blob && !payload.sticker?.blob) {
                log(`Cannot resend file message ${message.id} as blob is missing from cache.`, 'ERROR');
                await addMessage(peerId, { ...message, status: 'failed' });
                continue;
            }
            await sendMessage(payload, true);
        }
    }

    async function handleIncomingMessage({ peerId, message }) {
        if (message.type === 'retract-message-ack') {
            log(`Retraction confirmed for message ${message.messageId}`, 'DEBUG');
            return;
        }
        if (message.type === 'group-join') { return; }

        const chatId = message.groupId || peerId;
        await addMessage(chatId, { ...message, status: 'delivered' });
        if (currentChatId.value !== chatId || !document.hasFocus()) {
            if (message.groupId) { useGroupStore().incrementUnread(chatId); }
            else { useUserStore().incrementUnread(chatId); }
        }
        const userStore = useUserStore();
        const senderContact = userStore.contacts[message.sender];
        if (message.isNewlyCompletedAIResponse && senderContact?.isAI && senderContact.aiConfig?.tts?.enabled && message.type === 'text' && message.content?.trim()) {
            const ttsStore = useTtsStore();
            ttsStore.requestTtsForMessage({ ...message, senderContact });
        }
    }

    function openChat(chatId) {
        if (currentChatId.value === chatId) return;
        if (currentChatId.value && temporaryMessages.value[currentChatId.value]) {
            temporaryMessages.value[currentChatId.value] = [];
        }
        currentChatId.value = chatId;
        useUiStore().toggleDetailsPanel(false);
        if (chatId?.startsWith('group_')) useGroupStore().clearUnread(chatId);
        else if (chatId) useUserStore().clearUnread(chatId);
        log(`Opening chat: ${chatId}`, 'INFO');
    }

    async function deleteChatHistory(chatId) {
        if (chats.value[chatId]) {
            chats.value[chatId] = [];
            await dbService.setItem('chats', { id: chatId, messages: [] });
            if (chatId.startsWith('group_')) useGroupStore().updateGroupLastMessage(chatId, '聊天记录已清空');
            else useUserStore().updateContactLastMessage(chatId, '聊天记录已清空');
        }
    }

    async function clearAllChats() {
        if (Object.keys(chats.value).length === 0) {
            eventBus.emit('showNotification', { message: '没有聊天记录可清空。', type: 'info' });
            return;
        }
        // --- MODIFICATION START: Add loading state for dangerous action ---
        const uiStore = useUiStore();
        uiStore.isPerformingDangerousAction = true;
        try {
            chats.value = {};
            await dbService.clearStore('chats');
            Object.keys(useUserStore().contacts).forEach(id => useUserStore().updateContactLastMessage(id, ''));
            Object.keys(useGroupStore().groups).forEach(id => useGroupStore().updateGroupLastMessage(id, ''));
            eventBus.emit('showNotification', { message: '所有聊天记录已清空', type: 'success' });
        } finally {
            uiStore.isPerformingDangerousAction = false;
        }
        // --- MODIFICATION END ---
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
        if (!isMessageRetractable.value(messageId) || !chatId) {
            if (isMessageRetractable.value(messageId) === false) { // Check explicitly for false to avoid firing on initial undefined
                eventBus.emit('showNotification', { message: '消息已超过可撤回时间', type: 'warning' });
            }
            return;
        }
        const userStore = useUserStore();
        const retractInfo = {
            type: 'retract-message-request',
            messageId,
            retractedByName: userStore.userName
        };
        try {
            if (chatId.startsWith('group_')) {
                useGroupStore().broadcastMessage(chatId, retractInfo);
            } else {
                webrtcService.sendMessage(chatId, retractInfo);
            }
            // Optimistically update local UI
            await _updateMessageToRetractedState(messageId, chatId, "你");
        } catch (error) {
            log(`Failed to send retract command for message ${messageId}: ${error.message}`, 'ERROR');
            eventBus.emit('showNotification', { message: '撤回失败，对方可能已离线。', type: 'error' });
        }
    }

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
            // Replace the message in the array
            chats.value[chatId][messageIndex] = retractedMessage;
            await dbService.setItem('chats', { id: chatId, messages: JSON.parse(JSON.stringify(chats.value[chatId])) });
        }
    }

    function addTemporaryMessage(chatId, message) { if (!temporaryMessages.value[chatId]) temporaryMessages.value[chatId] = []; temporaryMessages.value[chatId].push(message); }
    function updateTemporaryMessage(chatId, messageId, newContent) { const tempChat = temporaryMessages.value[chatId]; if (tempChat) { const msg = tempChat.find(m => m.id === messageId); if (msg) msg.content = newContent; } }
    function removeTemporaryMessage(chatId, messageId) { if (temporaryMessages.value[chatId]) { temporaryMessages.value[chatId] = temporaryMessages.value[chatId].filter(m => m.id !== messageId); } }

    return {
        chats, currentChatId, filteredChatList, currentChatMessages, isMessageRetractable, getMessagesWithResources, getDatesWithMessages,
        init, addMessage, sendMessage, openChat, deleteChatHistory, clearAllChats, formatPreview,
        deleteMessage, retractMessage,
        addTemporaryMessage, updateTemporaryMessage, removeTemporaryMessage,
        resendFailedMessages,
        _updateMessageToRetractedState
    };
});