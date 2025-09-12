import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { useChatStore } from './chatStore';
import { useSettingsStore } from './settingsStore';
import { useGroupStore } from './groupStore';
import { useUiStore } from './uiStore';
import { generateId, log } from '@/utils';
import { webrtcService } from '@/services/webrtcService';
import { apiService } from '@/services/apiService';
import AppSettings from '@/config/AppSettings';
import { DEFAULT_TTS_CONFIG } from '@/config/ttsDefaults';

export const useUserStore = defineStore('user', () => {
    // --- STATE ---
    const userId = ref(null);
    const userName = ref('我');
    const contacts = ref({});
    const isAiServiceHealthy = ref(false);
    const aiServiceStatusMessage = ref("状态检查中...");
    const onlineUserIds = ref([]);
    const typingContacts = ref({});

    // --- GETTERS ---
    const getContactCombinedStatus = computed(() => (contactId) => {
        const contact = contacts.value[contactId];
        const isConnected = webrtcService.connections.value[contactId]?.isConnected ?? false;
        const isLobbyOnline = onlineUserIds.value.includes(contactId);

        if (typingContacts.value[contactId]) {
            return { isOnlineDisplay: true, isConnected: true, isLobbyOnline: true, isAi: false, statusText: '正在输入...', statusClass: 'online' };
        }

        if (contact?.isAI) {
            return { isOnlineDisplay: isAiServiceHealthy.value, isConnected: isAiServiceHealthy.value, isLobbyOnline: isAiServiceHealthy.value, isAi: true, statusText: aiServiceStatusMessage.value, statusClass: isAiServiceHealthy.value ? 'online' : 'offline' };
        }
        if (contact?.isSpecial) {
            return { isOnlineDisplay: true, isConnected: true, isLobbyOnline: true, isAi: false, statusText: '特殊联系人', statusClass: 'online' };
        }

        if (isConnected) {
            return { isOnlineDisplay: true, isConnected: true, isLobbyOnline: true, isAi: false, statusText: '在线 (已连接)', statusClass: 'online' };
        }
        if (isLobbyOnline) {
            return { isOnlineDisplay: true, isConnected: false, isLobbyOnline: true, isAi: false, statusText: '在线 (未连接)', statusClass: 'warning' };
        }

        return { isOnlineDisplay: false, isConnected: false, isLobbyOnline: false, isAi: false, statusText: '离线', statusClass: 'offline' };
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
            if (c.isAI) {
                c.aiConfig = c.aiConfig || {};
                c.aiConfig.tts = { ...DEFAULT_TTS_CONFIG, ...(c.aiConfig.tts || {}) };
            }
            contactsMap[c.id] = { type: 'contact', ...c, isOnline: false };
        });
        contacts.value = contactsMap;
        await ensureSpecialContacts();
        eventBus.on('themeChanged', ensureSpecialContacts);
        eventBus.on('apiSettingsChanged', () => apiService.checkAiServiceHealth().then(updateAiServiceStatus));
        eventBus.on('webrtc:connected', (peerId) => {
            const chatStore = useChatStore();
            chatStore.resendFailedMessages(peerId);
        });
        eventBus.on('webrtc:typing', ({ peerId }) => {
            if (typingContacts.value[peerId]) clearTimeout(typingContacts.value[peerId].timer);
            const timer = setTimeout(() => {
                delete typingContacts.value[peerId];
            }, 3000);
            typingContacts.value[peerId] = { timer };
        });
        log(`用户Store已初始化。ID: ${userId.value}`, 'INFO');
    }

    async function ensureSpecialContacts() {
        const settingsStore = useSettingsStore();
        const chatStore = useChatStore();
        if (!settingsStore.currentTheme || !settingsStore.currentSpecialContacts) {
            log('ensureSpecialContacts: Theme or special contact definitions not loaded yet. Skipping sync.', 'WARN');
            return;
        }
        const newThemeDefs = settingsStore.currentSpecialContacts;
        const newThemeDefIds = new Set(newThemeDefs.map(def => def.id));
        const newContactsState = {};
        const dbWritePromises = [];
        const idsToRemoveFromDb = [];
        for (const contactId in contacts.value) {
            const contact = contacts.value[contactId];
            if (!contact.isSpecial || contact.isImported) {
                newContactsState[contactId] = contact;
            }
        }
        for (const def of newThemeDefs) {
            const existingContact = contacts.value[def.id];
            const baseData = { ...def, isSpecial: true, type: 'contact' };
            newContactsState[def.id] = {
                ...baseData,
                lastMessage: existingContact?.lastMessage || def.initialMessage || '你好！',
                lastTime: existingContact?.lastTime || new Date(0).toISOString(),
                unread: existingContact?.unread || 0,
                selectedChapterId: existingContact?.selectedChapterId ?? (def.selectedChapterId || null),
                aiConfig: {
                    ...(def.aiConfig || {}),
                    ...(existingContact?.aiConfig || {}),
                    tts: {
                        ...DEFAULT_TTS_CONFIG,
                        ...(def.aiConfig?.tts || {}),
                        ...(existingContact?.aiConfig?.tts || {})
                    }
                }
            };
            dbWritePromises.push(dbService.setItem('contacts', newContactsState[def.id]));
        }
        for (const contactId in contacts.value) {
            const contact = contacts.value[contactId];
            if (contact.isSpecial && !contact.isImported && !newThemeDefIds.has(contactId)) {
                idsToRemoveFromDb.push(contactId);
            }
        }
        if (idsToRemoveFromDb.length > 0) {
            log(`Pruning ${idsToRemoveFromDb.length} old theme characters from DB: ${idsToRemoveFromDb.join(', ')}`, 'INFO');
            for (const idToRemove of idsToRemoveFromDb) {
                dbWritePromises.push(dbService.removeItem('contacts', idToRemove));
                dbWritePromises.push(chatStore.deleteChatHistory(idToRemove));
            }
        }
        contacts.value = newContactsState;
        await Promise.all(dbWritePromises);
        log(`Special contacts synced to theme: ${settingsStore.currentThemeKey}`, 'INFO');
    }

    async function addContact(contactData) {
        if (!contactData || !contactData.id) {
            eventBus.emit('showNotification', { message: '添加联系人失败：ID无效', type: 'error'});
            return false;
        }
        if (contactData.id === userId.value) {
            eventBus.emit('showNotification', { message: '你不能添加自己为联系人', type: 'warning'});
            return false;
        }
        const settingsStore = useSettingsStore();
        if (settingsStore.currentSpecialContacts.some(sc => sc.id === contactData.id) && !contactData.isImported) {
            eventBus.emit('showNotification', { message: '这是内置的特殊联系人，不能手动添加或修改。', type: 'warning'});
            return false;
        }
        const existingContact = contacts.value[contactData.id];
        const finalName = contactData.name?.trim() || existingContact?.name || `用户 ${contactData.id.substring(0, 4)}`;
        const defaultAiConfig = { tts: { ...DEFAULT_TTS_CONFIG } };
        let updated = false;

        // --- MODIFICATION START: Centralize post-add/update logic ---
        const postAction = () => {
            // If the user is in the online list, attempt to connect immediately
            if (onlineUserIds.value.includes(contactData.id)) {
                eventBus.emit('showNotification', { message: `联系人 "${finalName}" 已添加/更新，正在尝试连接...`, type: 'info' });
                webrtcService.createOffer(contactData.id, { isSilent: false });
            }
        };
        // --- MODIFICATION END ---

        if (existingContact) {
            if (existingContact.name !== finalName) { existingContact.name = finalName; updated = true; }
            if (contactData.avatarUrl !== undefined && existingContact.avatarUrl !== contactData.avatarUrl) { existingContact.avatarUrl = contactData.avatarUrl; updated = true; }
            if (contactData.avatarText !== undefined && existingContact.avatarText !== contactData.avatarText) { existingContact.avatarText = contactData.avatarText; updated = true; }
            if (contactData.isAI !== undefined && existingContact.isAI !== contactData.isAI) { existingContact.isAI = contactData.isAI; updated = true; }
            if (contactData.isSpecial !== undefined && existingContact.isSpecial !== contactData.isSpecial) { existingContact.isSpecial = contactData.isSpecial; updated = true; }
            if (contactData.isImported !== undefined && existingContact.isImported !== contactData.isImported) { existingContact.isImported = contactData.isImported; updated = true; }
            if (contactData.aboutDetails !== undefined && existingContact.aboutDetails !== contactData.aboutDetails) { existingContact.aboutDetails = contactData.aboutDetails; updated = true; }
            if (contactData.chapters !== undefined && existingContact.chapters !== contactData.chapters) { existingContact.chapters = contactData.chapters; updated = true; }
            if (contactData.selectedChapterId !== undefined && existingContact.selectedChapterId !== contactData.selectedChapterId) { existingContact.selectedChapterId = contactData.selectedChapterId; updated = true; }
            if (contactData.aiConfig) {
                existingContact.aiConfig = existingContact.aiConfig || {};
                Object.assign(existingContact.aiConfig, contactData.aiConfig);
                existingContact.aiConfig.tts = { ...DEFAULT_TTS_CONFIG, ...(existingContact.aiConfig.tts || {}), ...(contactData.aiConfig.tts || {}) };
                updated = true;
            }
            if (updated) {
                await dbService.setItem('contacts', existingContact);
                log(`Updated contact: ${finalName} (${contactData.id})`, 'INFO');
                postAction(); // Trigger connection attempt on update too
            } else {
                eventBus.emit('showNotification', { message: `${finalName} 已存在，且信息无更改。`, type: 'info'});
            }
        } else {
            const newContact = {
                id: contactData.id, name: finalName, lastMessage: '', lastTime: new Date().toISOString(),
                unread: 0, isOnline: false, type: 'contact',
                avatarText: contactData.avatarText || finalName.charAt(0).toUpperCase(),
                avatarUrl: contactData.avatarUrl || null, isAI: contactData.isAI || false,
                isSpecial: contactData.isSpecial || false, isImported: contactData.isImported || false,
                aiConfig: contactData.aiConfig ? { ...contactData.aiConfig, tts: { ...DEFAULT_TTS_CONFIG, ...(contactData.aiConfig.tts || {}) } } : defaultAiConfig,
                aboutDetails: contactData.aboutDetails || null, chapters: contactData.chapters || [],
                selectedChapterId: contactData.selectedChapterId || null
            };
            contacts.value[contactData.id] = newContact;
            await dbService.setItem('contacts', newContact);
            log(`Added new contact: ${finalName} (${contactData.id})`, 'INFO');
            postAction(); // Trigger connection attempt on new add
        }
        return true;
    }

    function updateContactStatus(contactId, isConnected) { log(`Connection status change for ${contactId}: ${isConnected}`, 'DEBUG'); }
    function updateAiServiceStatus(isHealthy) { isAiServiceHealthy.value = isHealthy; aiServiceStatusMessage.value = isHealthy ? "AI 服务可用" : "AI 服务不可用"; log(`AI service status updated to: ${isHealthy}.`, 'INFO'); }

    async function fetchOnlineUsers() {
        try {
            const response = await fetch(AppSettings.server.lobbyApiEndpoint);
            if (!response.ok) throw new Error(`Server responded with ${response.status}`);
            const userIds = await response.json();
            const newOnlineIds = Array.isArray(userIds) ? userIds.filter(id => id !== userId.value) : [];

            // --- MODIFICATION START: Trigger proactive connection if online list changes ---
            if (JSON.stringify(onlineUserIds.value) !== JSON.stringify(newOnlineIds)) {
                onlineUserIds.value = newOnlineIds;
                log(`在线用户列表已更新: ${onlineUserIds.value.length} users online.`, 'INFO');
                // Call the proactive connection logic in webrtcService
                webrtcService.proactivelyConnectToOnlineContacts();
            }
            // --- MODIFICATION END ---

            return true;
        } catch (error) {
            log(`获取在线用户列表失败: ${error}`, 'ERROR');
            return false;
        }
    }

    async function removeContact(contactId) { if (!contacts.value[contactId]) return false; const settingsStore = useSettingsStore(); if (settingsStore.currentSpecialContacts.some(c => c.id === contactId) && !contacts.value[contactId].isImported) { eventBus.emit('showNotification', { message: '无法删除当前主题的内置角色。', type: 'warning' }); return false; } await useGroupStore().removeMemberFromAllGroups(contactId); webrtcService.closeConnection(contactId); delete contacts.value[contactId]; await dbService.removeItem('contacts', contactId); const chatStore = useChatStore(); await chatStore.deleteChatHistory(contactId); if (chatStore.currentChatId === contactId) chatStore.openChat(null); eventBus.emit('showNotification', { message: '联系人已删除', type: 'success' }); return true; }
    async function clearUnread(contactId) { if (contacts.value[contactId] && contacts.value[contactId].unread > 0) { contacts.value[contactId].unread = 0; await dbService.setItem('contacts', contacts.value[contactId]); } }
    async function incrementUnread(contactId) { if (contacts.value[contactId]) { contacts.value[contactId].unread = (contacts.value[contactId].unread || 0) + 1; await dbService.setItem('contacts', contacts.value[contactId]); } }
    async function updateContactLastMessage(contactId, messageText) { if (contacts.value[contactId]) { contacts.value[contactId].lastMessage = messageText; contacts.value[contactId].lastTime = new Date().toISOString(); await dbService.setItem('contacts', contacts.value[contactId]); } }

    async function removeAllContacts() {
        const uiStore = useUiStore();
        uiStore.isPerformingDangerousAction = true;
        try {
            const settingsStore = useSettingsStore();
            const specialContactIds = new Set(settingsStore.currentSpecialContacts.map(c => c.id));
            const contactIdsToRemove = Object.keys(contacts.value).filter(id => !specialContactIds.has(id));
            if (contactIdsToRemove.length === 0) {
                eventBus.emit('showNotification', { message: '没有可清除的联系人。', type: 'info' });
                return;
            }
            for (const id of contactIdsToRemove) {
                await removeContact(id);
            }
            eventBus.emit('showNotification', { message: '所有手动添加的联系人已清空。', type: 'success' });
        } finally {
            uiStore.isPerformingDangerousAction = false;
        }
    }

    async function setSelectedChapterForAI(contactId, chapterId) { const contact = contacts.value[contactId]; if (contact?.isAI) { contact.selectedChapterId = chapterId; await dbService.setItem('contacts', contact); log(`AI ${contactId} chapter set to: ${chapterId || 'Default'}`, 'INFO'); } }
    async function saveTtsSettings(contactId, ttsConfigFromUi) { const contact = contacts.value[contactId]; if (contact?.isAI) { if (!contact.aiConfig) contact.aiConfig = {}; contact.aiConfig.tts = { ...DEFAULT_TTS_CONFIG, ...(contact.aiConfig.tts || {}), ...ttsConfigFromUi, }; await dbService.setItem('contacts', contact); log(`TTS settings saved for contact ${contactId}`, 'INFO'); eventBus.emit('showNotification', { message: 'TTS 设置已保存', type: 'success' }); } }

    return {
        userId, userName, contacts, isAiServiceHealthy, aiServiceStatusMessage, onlineUserIds, getContactCombinedStatus, typingContacts,
        init, fetchOnlineUsers, addContact, removeContact, updateAiServiceStatus, updateContactStatus, clearUnread,
        incrementUnread, updateContactLastMessage, removeAllContacts, setSelectedChapterForAI, saveTtsSettings,
        ensureSpecialContacts
    };
});