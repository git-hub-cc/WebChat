import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import { useGroupStore } from './groupStore';
import { generateId, log } from '@/utils';
import { webrtcService } from '@/services/webrtcService';
import AppSettings from '@/config/AppSettings';

export const useUserStore = defineStore('user', () => {
    // --- STATE ---
    const userId = ref(null);
    const userName = ref('我');
    const contacts = ref({});
    const isAiServiceHealthy = ref(false);
    const aiServiceStatusMessage = ref("状态检查中...");
    const onlineUserIds = ref([]);

    // --- GETTERS ---
    const getContactStatus = computed(() => {
        return (contact) => {
            if (!contact) return { text: '未知', className: 'offline' };
            if (contact.isAI) {
                return {
                    text: aiServiceStatusMessage.value,
                    className: isAiServiceHealthy.value ? 'online' : 'offline'
                };
            }
            if (contact.isSpecial) {
                return { text: '特殊联系人', className: 'online' };
            }
            return {
                text: contact.isOnline ? '在线' : '离线',
                className: contact.isOnline ? 'online' : 'offline'
            };
        };
    });

    // --- ACTIONS ---
    async function init() {
        let userData = await dbService.getItem('user', 'currentUser');
        if (userData?.userId) {
            userId.value = userData.userId;
            userName.value = userData.userName || `用户 ${userId.value.substring(0, 4)}`;
        } else {
            userId.value = generateId(8);
            userName.value = `用户 ${userId.value.substring(0, 4)}`;
            await dbService.setItem('user', { id: 'currentUser', userId: userId.value, userName: userName.value });
        }

        const dbContacts = await dbService.getAllItems('contacts');
        const contactsMap = {};
        dbContacts.forEach(c => {
            contactsMap[c.id] = { type: 'contact', ...c, isOnline: false };
        });
        contacts.value = contactsMap;

        await ensureSpecialContacts();
        eventBus.on('themeChanged', ensureSpecialContacts);
        log(`用户Store已初始化。ID: ${userId.value}`, 'INFO');
    }

    async function ensureSpecialContacts() {
        const settingsStore = useSettingsStore();
        if (!settingsStore.currentTheme || !settingsStore.currentSpecialContacts) {
            log('ensureSpecialContacts: 主题或特殊联系人定义尚未加载。', 'WARN');
            return;
        }

        const newDefs = settingsStore.currentSpecialContacts;
        const processedIds = new Set();
        const savePromises = [];

        for (const def of newDefs) {
            processedIds.add(def.id);
            const existing = contacts.value[def.id];
            const baseData = { ...def, isSpecial: true, type: 'contact' };

            if (existing) {
                const updatedContact = { ...existing, ...baseData, name: def.name };
                if (updatedContact.isAI) {
                    updatedContact.isOnline = isAiServiceHealthy.value;
                }
                contacts.value[def.id] = updatedContact;
            } else {
                contacts.value[def.id] = {
                    ...baseData,
                    lastMessage: def.initialMessage || '你好！',
                    lastTime: new Date(0).toISOString(),
                    unread: 0,
                    isOnline: baseData.isAI ? isAiServiceHealthy.value : false
                };
            }
            savePromises.push(dbService.setItem('contacts', contacts.value[def.id]));
        }

        for (const id in contacts.value) {
            if (contacts.value[id].isSpecial && !processedIds.has(id) && !contacts.value[id].isImported) {
                contacts.value[id].isSpecial = false;
                savePromises.push(dbService.setItem('contacts', contacts.value[id]));
            }
        }
        await Promise.all(savePromises);
        log(`特殊联系人已同步至主题: ${settingsStore.currentThemeKey}`, 'INFO');
    }

    async function addContact(contactData) {
        if (!contactData || !contactData.id) {
            eventBus.emit('showNotification', { message: '添加联系人失败：ID无效', type: 'error'});
            return false;
        }
        if (contactData.id === userId.value) {
            return false;
        }

        const existingContact = contacts.value[contactData.id];
        const finalName = contactData.name?.trim() || existingContact?.name || `用户 ${contactData.id.substring(0, 4)}`;

        if (existingContact) {
            if (existingContact.name !== finalName) {
                existingContact.name = finalName;
                await dbService.setItem('contacts', existingContact);
                log(`Updated contact name for ${contactData.id} to "${existingContact.name}"`, 'INFO');
            }
        } else {
            const newContact = {
                lastMessage: '',
                lastTime: new Date().toISOString(),
                unread: 0,
                isOnline: false,
                type: 'contact',
                ...contactData,
                name: finalName,
            };
            contacts.value[contactData.id] = newContact;
            await dbService.setItem('contacts', newContact);
            log(`Added new contact: ${finalName} (${contactData.id})`, 'INFO');
        }
        return true;
    }

    async function updateContactStatus(contactId, isOnline) {
        const contact = contacts.value[contactId];
        if (contact && contact.isOnline !== isOnline) {
            contact.isOnline = isOnline;
            await dbService.setItem('contacts', contact);
            log(`Contact status updated: ${contact.name} is now ${isOnline ? 'online' : 'offline'}`, 'DEBUG');
        }
    }

    function updateAiServiceStatus(isHealthy) {
        isAiServiceHealthy.value = isHealthy;
        aiServiceStatusMessage.value = isHealthy ? "AI 服务可用" : "AI 服务不可用";

        Object.values(contacts.value).forEach(contact => {
            if (contact.isAI) {
                contact.isOnline = isHealthy;
            }
        });
        log(`AI service status updated to: ${isHealthy}. All AI contacts' online status synced.`, 'INFO');
    }

    async function removeContact(contactId) {
        if (!contacts.value[contactId]) return false;
        const settingsStore = useSettingsStore();
        if (settingsStore.currentSpecialContacts.some(c => c.id === contactId) && !contacts.value[contactId].isImported) {
            eventBus.emit('showNotification', { message: '无法删除当前主题的内置角色。', type: 'warning' });
            return false;
        }
        const groupStore = useGroupStore();
        await groupStore.removeMemberFromAllGroups(contactId);
        webrtcService.closeConnection(contactId);
        delete contacts.value[contactId];
        await dbService.removeItem('contacts', contactId);
        const chatStore = useChatStore();
        await chatStore.deleteChatHistory(contactId);
        if (chatStore.currentChatId === contactId) {
            chatStore.openChat(null);
        }
        eventBus.emit('showNotification', { message: '联系人已删除', type: 'success' });
        return true;
    }

    async function fetchOnlineUsers() {
        try {
            const response = await fetch(AppSettings.server.lobbyApiEndpoint);
            if (!response.ok) throw new Error(`Server responded with ${response.status}`);
            const userIds = await response.json();
            onlineUserIds.value = Array.isArray(userIds) ? userIds.filter(id => id !== userId.value) : [];
            log(`在线用户列表已更新: ${onlineUserIds.value.length} users online.`, 'INFO');
        } catch (error) {
            log(`获取在线用户列表失败: ${error}`, 'ERROR');
            onlineUserIds.value = [];
        }
    }

    async function clearUnread(contactId) {
        if (contacts.value[contactId] && contacts.value[contactId].unread > 0) {
            contacts.value[contactId].unread = 0;
            await dbService.setItem('contacts', contacts.value[contactId]);
        }
    }

    async function incrementUnread(contactId) {
        if (contacts.value[contactId]) {
            contacts.value[contactId].unread = (contacts.value[contactId].unread || 0) + 1;
            await dbService.setItem('contacts', contacts.value[contactId]);
        }
    }

    async function updateContactLastMessage(contactId, messageText) {
        if (contacts.value[contactId]) {
            contacts.value[contactId].lastMessage = messageText;
            contacts.value[contactId].lastTime = new Date().toISOString();
            await dbService.setItem('contacts', contacts.value[contactId]);
        }
    }

    async function removeAllContacts() {
        const settingsStore = useSettingsStore();
        const specialContactIds = new Set(settingsStore.currentSpecialContacts.map(c => c.id));
        const contactIdsToRemove = Object.keys(contacts.value).filter(id => !specialContactIds.has(id));
        for (const id of contactIdsToRemove) {
            await removeContact(id);
        }
        eventBus.emit('showNotification', { message: '所有手动添加的联系人已清空。', type: 'success' });
    }

    async function setSelectedChapterForAI(contactId, chapterId) {
        const contact = contacts.value[contactId];
        if (contact?.isAI) {
            contact.selectedChapterId = chapterId;
            await dbService.setItem('contacts', contact);
            log(`AI ${contactId} chapter set to: ${chapterId || 'Default'}`, 'INFO');
        }
    }

    return {
        userId,
        userName,
        contacts,
        isAiServiceHealthy,
        aiServiceStatusMessage,
        onlineUserIds,
        getContactStatus,
        init,
        fetchOnlineUsers,
        addContact,
        removeContact,
        updateAiServiceStatus,
        updateContactStatus,
        clearUnread,
        incrementUnread,
        updateContactLastMessage,
        removeAllContacts,
        setSelectedChapterForAI,
    };
});