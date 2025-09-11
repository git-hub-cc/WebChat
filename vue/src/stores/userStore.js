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
    const onlineUserIds = ref([]); // From Lobby API

    // --- GETTERS ---

    // MODIFICATION: Consolidated getter for all online status logic
    const getContactCombinedStatus = computed(() => (contactId) => {
        const contact = contacts.value[contactId];
        if (!contact) {
            return {
                isOnlineDisplay: false,
                isConnected: false,
                isLobbyOnline: false,
                isAi: false,
                statusText: '未知',
                statusClass: 'offline'
            };
        }

        const isConnectedViaWebRTC = webrtcService.connections.value[contactId]?.isConnected ?? false;
        const isLobbyOnline = onlineUserIds.value.includes(contactId);

        if (contact.isAI) {
            return {
                isOnlineDisplay: isAiServiceHealthy.value,
                isConnected: isAiServiceHealthy.value, // AI "connected" if service is healthy
                isLobbyOnline: isAiServiceHealthy.value, // AI "lobby online" if service is healthy
                isAi: true,
                statusText: aiServiceStatusMessage.value,
                statusClass: isAiServiceHealthy.value ? 'online' : 'offline'
            };
        }

        if (contact.isSpecial) { // Non-AI special contacts
            return {
                isOnlineDisplay: true, // Special contacts are always 'online' conceptually
                isConnected: true, // Assuming special contacts are always "connected" in a logical sense
                isLobbyOnline: true,
                isAi: false,
                statusText: '特殊联系人',
                statusClass: 'online'
            };
        }

        // Regular user contacts
        if (isConnectedViaWebRTC) {
            return {
                isOnlineDisplay: true,
                isConnected: true,
                isLobbyOnline: true, // If WebRTC connected, they must be Lobby Online
                isAi: false,
                statusText: '在线 (已连接)',
                statusClass: 'online'
            };
        } else if (isLobbyOnline) {
            return {
                isOnlineDisplay: true,
                isConnected: false,
                isLobbyOnline: true,
                isAi: false,
                statusText: '在线 (未连接)',
                statusClass: 'warning' // Indicate online but not connected
            };
        } else {
            return {
                isOnlineDisplay: false,
                isConnected: false,
                isLobbyOnline: false,
                isAi: false,
                statusText: '离线',
                statusClass: 'offline'
            };
        }
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
            contactsMap[c.id] = { type: 'contact', ...c, isOnline: false }; // isOnline will be updated later
        });
        contacts.value = contactsMap;

        await ensureSpecialContacts();
        eventBus.on('themeChanged', ensureSpecialContacts);
        eventBus.on('apiSettingsChanged', () => apiService.checkAiServiceHealth().then(updateAiServiceStatus));
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
                // MODIFICATION: Merge instead of overwrite specific fields
                const updatedContact = {
                    ...existing,
                    ...baseData,
                    name: def.name,
                    avatarText: def.avatarText,
                    avatarUrl: def.avatarUrl,
                    aboutDetails: def.aboutDetails,
                    chapters: def.chapters,
                    // Keep existing selectedChapterId unless def explicitly overrides it
                    selectedChapterId: existing.selectedChapterId || def.selectedChapterId || null,
                    // Ensure TTS config is preserved/merged
                    aiConfig: {
                        ...(existing.aiConfig || {}),
                        ...(baseData.aiConfig || {}),
                        tts: {
                            ...(existing.aiConfig?.tts || {}),
                            ...(baseData.aiConfig?.tts || {}),
                        }
                    }
                };
                // Ensure AI-specific default values are set if missing after merge
                if (updatedContact.isAI) {
                    if (!updatedContact.aiConfig) updatedContact.aiConfig = {};
                    if (!updatedContact.aiConfig.tts) updatedContact.aiConfig.tts = {};
                    if (updatedContact.aiConfig.tts.tts_mode === undefined) updatedContact.aiConfig.tts.tts_mode = 'Preset';
                    if (updatedContact.aiConfig.tts.version === undefined) updatedContact.aiConfig.tts.version = 'v4';
                    updatedContact.isOnline = isAiServiceHealthy.value;
                }
                contacts.value[def.id] = updatedContact;
            } else {
                contacts.value[def.id] = {
                    ...baseData,
                    lastMessage: def.initialMessage || '你好！',
                    lastTime: new Date(0).toISOString(),
                    unread: 0,
                    isOnline: baseData.isAI ? isAiServiceHealthy.value : false,
                    selectedChapterId: def.selectedChapterId || null // Ensure this is set
                };
                // Ensure AI-specific default values for new contact
                if (contacts.value[def.id].isAI) {
                    if (!contacts.value[def.id].aiConfig) contacts.value[def.id].aiConfig = {};
                    if (!contacts.value[def.id].aiConfig.tts) contacts.value[def.id].aiConfig.tts = {};
                    if (contacts.value[def.id].aiConfig.tts.tts_mode === undefined) contacts.value[def.id].aiConfig.tts.tts_mode = 'Preset';
                    if (contacts.value[def.id].aiConfig.tts.version === undefined) contacts.value[def.id].aiConfig.tts.version = 'v4';
                }
            }
            savePromises.push(dbService.setItem('contacts', contacts.value[def.id]));
        }

        for (const id in contacts.value) {
            // If an existing contact was special but is no longer in newDefs (and not imported), mark as non-special
            if (contacts.value[id].isSpecial && !processedIds.has(id) && !contacts.value[id].isImported) {
                contacts.value[id].isSpecial = false;
                // If it was an AI, it effectively stops being an AI managed by theme, but we keep isAI true
                // for history purposes unless explicitly overwritten.
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
            eventBus.emit('showNotification', { message: '你不能添加自己为联系人', type: 'warning'});
            return false;
        }

        // Prevent adding theme-defined special contacts manually
        const settingsStore = useSettingsStore();
        if (settingsStore.currentSpecialContacts.some(sc => sc.id === contactData.id) && !contactData.isImported) {
            eventBus.emit('showNotification', { message: '这是内置的特殊联系人，不能手动添加或修改。', type: 'warning'});
            return false;
        }

        const existingContact = contacts.value[contactData.id];
        const finalName = contactData.name?.trim() || existingContact?.name || `用户 ${contactData.id.substring(0, 4)}`;

        const defaultAiConfig = { tts: { tts_mode: 'Preset', version: 'v4' } };

        let updated = false;
        if (existingContact) {
            // Update existing contact
            if (existingContact.name !== finalName) { existingContact.name = finalName; updated = true; }
            if (contactData.avatarUrl !== undefined && existingContact.avatarUrl !== contactData.avatarUrl) { existingContact.avatarUrl = contactData.avatarUrl; updated = true; }
            if (contactData.avatarText !== undefined && existingContact.avatarText !== contactData.avatarText) { existingContact.avatarText = contactData.avatarText; updated = true; }
            if (contactData.isAI !== undefined && existingContact.isAI !== contactData.isAI) { existingContact.isAI = contactData.isAI; updated = true; }
            if (contactData.isSpecial !== undefined && existingContact.isSpecial !== contactData.isSpecial) { existingContact.isSpecial = contactData.isSpecial; updated = true; }
            if (contactData.isImported !== undefined && existingContact.isImported !== contactData.isImported) { existingContact.isImported = contactData.isImported; updated = true; }
            if (contactData.aboutDetails !== undefined && existingContact.aboutDetails !== contactData.aboutDetails) { existingContact.aboutDetails = contactData.aboutDetails; updated = true; }
            if (contactData.chapters !== undefined && existingContact.chapters !== contactData.chapters) { existingContact.chapters = contactData.chapters; updated = true; }
            if (contactData.selectedChapterId !== undefined && existingContact.selectedChapterId !== contactData.selectedChapterId) { existingContact.selectedChapterId = contactData.selectedChapterId; updated = true; }

            // Deep merge aiConfig, especially TTS
            if (contactData.aiConfig) {
                existingContact.aiConfig = existingContact.aiConfig || {};
                Object.assign(existingContact.aiConfig, contactData.aiConfig);
                if (contactData.aiConfig.tts) {
                    existingContact.aiConfig.tts = existingContact.aiConfig.tts || {};
                    Object.assign(existingContact.aiConfig.tts, contactData.aiConfig.tts);
                }
                updated = true;
            }
            if (updated) {
                await dbService.setItem('contacts', existingContact);
                eventBus.emit('showNotification', { message: `${finalName} 信息已更新`, type: 'success'});
                log(`Updated contact: ${finalName} (${contactData.id})`, 'INFO');
            } else {
                eventBus.emit('showNotification', { message: `${finalName} 已存在，且信息无更改。`, type: 'info'});
            }

        } else {
            // Create new contact
            const newContact = {
                id: contactData.id,
                name: finalName,
                lastMessage: '',
                lastTime: new Date().toISOString(),
                unread: 0,
                isOnline: false, // Default to offline, will be updated by webrtc/lobby service
                type: 'contact',
                avatarText: contactData.avatarText || finalName.charAt(0).toUpperCase(),
                avatarUrl: contactData.avatarUrl || null,
                isAI: contactData.isAI || false,
                isSpecial: contactData.isSpecial || false,
                isImported: contactData.isImported || false,
                aiConfig: contactData.aiConfig || defaultAiConfig,
                aboutDetails: contactData.aboutDetails || null,
                chapters: contactData.chapters || [],
                selectedChapterId: contactData.selectedChapterId || null
            };
            // Ensure proper AI config structure
            if (newContact.isAI) {
                if (!newContact.aiConfig) newContact.aiConfig = defaultAiConfig;
                if (!newContact.aiConfig.tts) newContact.aiConfig.tts = defaultAiConfig.tts;
                if (newContact.aiConfig.tts.tts_mode === undefined) newContact.aiConfig.tts.tts_mode = 'Preset';
                if (newContact.aiConfig.tts.version === undefined) newContact.aiConfig.tts.version = 'v4';
            }
            contacts.value[contactData.id] = newContact;
            await dbService.setItem('contacts', newContact);
            eventBus.emit('showNotification', { message: `联系人 "${finalName}" 已添加`, type: 'success'});
            log(`Added new contact: ${finalName} (${contactData.id})`, 'INFO');
        }
        return true;
    }

    // MODIFICATION: updateContactStatus now correctly updates the ref
    async function updateContactStatus(contactId, isOnline) {
        const contact = contacts.value[contactId];
        if (contact && contact.isOnline !== isOnline) {
            contact.isOnline = isOnline; // Directly modify the reactive ref
            await dbService.setItem('contacts', contact);
            log(`Contact status updated: ${contact.name} is now ${isOnline ? 'online' : 'offline'}`, 'DEBUG');
        }
    }

    function updateAiServiceStatus(isHealthy) {
        isAiServiceHealthy.value = isHealthy;
        aiServiceStatusMessage.value = isHealthy ? "AI 服务可用" : "AI 服务不可用";
        Object.values(contacts.value).forEach(contact => {
            if (contact.isAI) contact.isOnline = isHealthy;
        });
        log(`AI service status updated to: ${isHealthy}.`, 'INFO');
    }

    async function fetchOnlineUsers() {
        try {
            const response = await fetch(AppSettings.server.lobbyApiEndpoint);
            if (!response.ok) throw new Error(`Server responded with ${response.status}`);
            const userIds = await response.json();
            const newOnlineUserIds = Array.isArray(userIds) ? userIds.filter(id => id !== userId.value) : [];

            // Update local onlineUserIds ref
            onlineUserIds.value = newOnlineUserIds;

            // MODIFICATION: Iterate through all contacts and update their isOnline status based on new lobby data
            for (const contactId in contacts.value) {
                const contact = contacts.value[contactId];
                if (!contact.isAI && !contact.isSpecial) { // Only update regular users based on lobby
                    const isNowOnline = newOnlineUserIds.includes(contactId);
                    if (contact.isOnline !== isNowOnline) {
                        contact.isOnline = isNowOnline;
                        // Persist this change, but don't spam DB for every contact on every refresh
                        // dbService.setItem('contacts', contact); // Consider batching or throttling this
                    }
                }
            }
            log(`在线用户列表已更新: ${onlineUserIds.value.length} users online.`, 'INFO');
        } catch (error) {
            log(`获取在线用户列表失败: ${error}`, 'ERROR');
            onlineUserIds.value = [];
        }
    }

    async function removeContact(contactId) {
        if (!contacts.value[contactId]) return false;
        const settingsStore = useSettingsStore();
        if (settingsStore.currentSpecialContacts.some(c => c.id === contactId) && !contacts.value[contactId].isImported) {
            eventBus.emit('showNotification', { message: '无法删除当前主题的内置角色。', type: 'warning' });
            return false;
        }
        await useGroupStore().removeMemberFromAllGroups(contactId);
        webrtcService.closeConnection(contactId);
        delete contacts.value[contactId]; // Directly delete from reactive map
        await dbService.removeItem('contacts', contactId);
        const chatStore = useChatStore();
        await chatStore.deleteChatHistory(contactId);
        if (chatStore.currentChatId === contactId) chatStore.openChat(null);
        eventBus.emit('showNotification', { message: '联系人已删除', type: 'success' });
        return true;
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
        for (const id of contactIdsToRemove) await removeContact(id); // Use removeContact to ensure full cleanup
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

    async function saveTtsSettings(contactId, ttsConfig) {
        const contact = contacts.value[contactId];
        if (contact?.isAI) {
            if (!contact.aiConfig) contact.aiConfig = {};
            contact.aiConfig.tts = ttsConfig;
            await dbService.setItem('contacts', contact);
            log(`TTS settings saved for contact ${contactId}`, 'INFO');
            eventBus.emit('showNotification', { message: 'TTS 设置已保存', type: 'success' });
        }
    }

    return {
        userId, userName, contacts, isAiServiceHealthy, aiServiceStatusMessage, onlineUserIds, getContactCombinedStatus,
        init, fetchOnlineUsers, addContact, removeContact, updateAiServiceStatus, updateContactStatus, clearUnread,
        incrementUnread, updateContactLastMessage, removeAllContacts, setSelectedChapterForAI, saveTtsSettings
    };
});