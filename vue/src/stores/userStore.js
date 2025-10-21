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

    // [修改] `allOnlineUsers` 成为全网在线用户的唯一真实来源
    // 格式: [{ userId: string, originServer: string, isLocal: boolean }, ...]
    const allOnlineUsers = ref([]);

    const typingContacts = ref({});

    // [新增] 存储当前服务器的URL，用于判断用户是否为本地用户
    const selfServerUrl = ref('');


    // --- GETTERS ---
    // ✅ MODIFICATION START: Updated getter to incorporate connectionType
    const getContactCombinedStatus = computed(() => (contactId) => {
        const contact = contacts.value[contactId];
        const connDetails = contact?.connectionDetails || {};
        const { isConnected, connectionType } = connDetails;

        const isGloballyOnline = allOnlineUsers.value.some(u => u.userId === contactId);

        // Handle special cases first
        if (typingContacts.value[contactId]) {
            return { ...connDetails, isOnlineDisplay: true, isGloballyOnline: true, isAi: false, statusText: '正在输入...', statusClass: 'online' };
        }
        if (contact?.isAI) {
            return { ...connDetails, isOnlineDisplay: isAiServiceHealthy.value, isGloballyOnline: isAiServiceHealthy.value, isAi: true, statusText: aiServiceStatusMessage.value, statusClass: isAiServiceHealthy.value ? 'online' : 'offline' };
        }
        if (contact?.isSpecial) {
            return { ...connDetails, isOnlineDisplay: true, isGloballyOnline: true, isAi: false, statusText: '特殊联系人', statusClass: 'online' };
        }

        // Core logic for regular contacts
        if (isConnected) {
            let statusText = '在线';
            if (connectionType === 'p2p' || connectionType === 'p2p-lan') {
                statusText += ' (直连)';
            } else if (connectionType === 'relay') {
                statusText += ' (服务器中继)';
            } else {
                statusText += ' (已连接)';
            }
            return { ...connDetails, isOnlineDisplay: true, isGloballyOnline: true, isAi: false, statusText, statusClass: 'online' };
        }

        if (isGloballyOnline) {
            return { ...connDetails, isOnlineDisplay: true, isGloballyOnline: true, isAi: false, statusText: '在线 (未连接)', statusClass: 'warning' };
        }

        return { ...connDetails, isOnlineDisplay: false, isGloballyOnline: false, isAi: false, statusText: '离线', statusClass: 'offline' };
    });
    // ✅ MODIFICATION END


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

        try {
            const endpointUrl = new URL(AppSettings.server.allOnlineUsersApiEndpoint);
            const pathSegments = endpointUrl.pathname.split('/').filter(Boolean);
            const basePath = '/' + pathSegments.slice(0, -3).join('/');
            selfServerUrl.value = endpointUrl.origin + (basePath === '/' ? '' : basePath);
            log(`自身服务器URL被识别为: ${selfServerUrl.value}`, 'INFO');
        } catch (e) {
            log(`无法从 allOnlineUsersApiEndpoint 解析自身服务器URL: ${e}`, 'ERROR');
        }

        const dbContacts = await dbService.getAllItems('contacts');
        const contactsMap = {};
        dbContacts.forEach(c => {
            if (c.isAI) {
                c.aiConfig = c.aiConfig || {};
                c.aiConfig.tts = { ...DEFAULT_TTS_CONFIG, ...(c.aiConfig.tts || {}) };
            }
            // ✅ MODIFICATION START: Initialize connectionDetails
            contactsMap[c.id] = { type: 'contact', ...c, connectionDetails: { isConnected: false, connectionType: null } };
            // ✅ MODIFICATION END
        });
        contacts.value = contactsMap;
        await ensureSpecialContacts();
        eventBus.on('themeChanged', ensureSpecialContacts);
        eventBus.on('apiSettingsChanged', () => apiService.checkAiServiceHealth().then(updateAiServiceStatus));
        eventBus.on('webrtc:connected', (peerId) => {
            useChatStore().resendFailedMessages(peerId);
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

            // 如果定义中包含 chaptersFilePath，则异步获取章节数据
            if (def.chaptersFilePath) {
                try {
                    const response = await fetch(def.chaptersFilePath);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    baseData.chapters = await response.json();
                    log(`成功加载角色 "${def.name}" 的章节。`, 'INFO');
                } catch (error) {
                    log(`加载角色 "${def.name}" 的章节失败 (${def.chaptersFilePath}): ${error.message}`, 'ERROR');
                    baseData.chapters = []; // 出错时赋予空数组，避免UI出错
                }
            }

            newContactsState[def.id] = {
                ...baseData,
                lastMessage: existingContact?.lastMessage || def.initialMessage || '你好！',
                lastTime: existingContact?.lastTime || new Date(0).toISOString(),
                unread: existingContact?.unread || 0,
                selectedChapterId: existingContact?.selectedChapterId ?? null,
                // ✅ MODIFICATION START: Persist connectionDetails
                connectionDetails: existingContact?.connectionDetails || { isConnected: false, connectionType: null },
                // ✅ MODIFICATION END
                aiConfig: {
                    ...(def.aiConfig || {}),
                    ...(existingContact?.aiConfig || {}),
                    tts: { ...DEFAULT_TTS_CONFIG, ...(def.aiConfig?.tts || {}), ...(existingContact?.aiConfig?.tts || {}) }
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
            for (const idToRemove of idsToRemoveFromDb) {
                dbWritePromises.push(dbService.removeItem('contacts', idToRemove));
                // --- 🚀 BUG FIX START: Do not delete chat history on theme change ---
                // By removing the line below, chat history for special contacts will be preserved
                // even when they are removed from the contact list due to a theme switch.
                // dbWritePromises.push(chatStore.deleteChatHistory(idToRemove));
                // --- 🚀 BUG FIX END ---
            }
        }
        contacts.value = newContactsState;
        await Promise.all(dbWritePromises);
    }

    async function addContact(contactData) {
        if (!contactData || !contactData.id || contactData.id === userId.value) {
            eventBus.emit('showNotification', { message: '无效的联系人ID', type: 'warning'});
            return false;
        }
        const settingsStore = useSettingsStore();
        if (settingsStore.currentSpecialContacts.some(sc => sc.id === contactData.id) && !contactData.isImported) {
            eventBus.emit('showNotification', { message: '这是内置的特殊联系人，不能手动添加或修改。', type: 'warning'});
            return false;
        }
        const existingContact = contacts.value[contactData.id];
        const finalName = contactData.name?.trim() || existingContact?.name || `用户 ${contactData.id.substring(0, 4)}`;

        const postAction = () => {
            // 添加或更新联系人后，立即触发一次主动连接检查
            webrtcService.proactivelyConnectToOnlineContacts();
        };

        if (existingContact) {
            if (existingContact.name !== finalName) {
                existingContact.name = finalName;
                await dbService.setItem('contacts', existingContact);
                postAction();
            } else {
                eventBus.emit('showNotification', { message: `${finalName} 已存在，且信息无更改。`, type: 'info'});
            }
        } else {
            const newContact = {
                id: contactData.id, name: finalName, lastMessage: '', lastTime: new Date().toISOString(),
                unread: 0, type: 'contact', avatarText: finalName.charAt(0).toUpperCase(),
                // ✅ MODIFICATION START: Initialize connectionDetails for new contacts
                connectionDetails: { isConnected: false, connectionType: null }
                // ✅ MODIFICATION END
            };
            contacts.value[contactData.id] = newContact;
            await dbService.setItem('contacts', newContact);
            postAction();
        }
        return true;
    }

    function updateAiServiceStatus(isHealthy) {
        isAiServiceHealthy.value = isHealthy;
        aiServiceStatusMessage.value = isHealthy ? "AI 服务可用" : "AI 服务不可用";
    }

    async function fetchAllOnlineUsers() {
        try {
            const response = await fetch(AppSettings.server.allOnlineUsersApiEndpoint);
            if (!response.ok) throw new Error(`服务器响应 ${response.status}`);
            const users = await response.json();

            const newAllOnlineUsers = (Array.isArray(users) ? users : [])
                .filter(u => u.userId !== userId.value)
                .map(u => ({ ...u, isLocal: u.originServer === selfServerUrl.value }));

            // 只有在列表发生变化时才更新，以防止不必要的重渲染
            if (JSON.stringify(allOnlineUsers.value.map(u => u.userId).sort()) !== JSON.stringify(newAllOnlineUsers.map(u => u.userId).sort())) {
                allOnlineUsers.value = newAllOnlineUsers;
                log(`全网用户列表已更新: ${allOnlineUsers.value.length} users online.`, 'INFO');
                // 触发一次主动连接检查
                webrtcService.proactivelyConnectToOnlineContacts();
            }

            return true;
        } catch (error) {
            log(`获取全网用户列表失败: ${error}`, 'ERROR');
            allOnlineUsers.value = [];
            return false;
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
        delete contacts.value[contactId];
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

    async function setSelectedChapterForAI(contactId, chapterId) {
        const contact = contacts.value[contactId];
        if (contact?.isAI) {
            contact.selectedChapterId = chapterId;
            await dbService.setItem('contacts', contact);
        }
    }

    async function saveTtsSettings(contactId, ttsConfigFromUi) {
        const contact = contacts.value[contactId];
        if (contact?.isAI) {
            if (!contact.aiConfig) contact.aiConfig = {};
            contact.aiConfig.tts = { ...DEFAULT_TTS_CONFIG, ...(contact.aiConfig.tts || {}), ...ttsConfigFromUi, };
            await dbService.setItem('contacts', contact);
            eventBus.emit('showNotification', { message: 'TTS 设置已保存', type: 'success' });
        }
    }

    // ✅ MODIFICATION START: New centralized action for updating connection details
    function updateContactConnectionDetails(contactId, { isConnected, connectionType }) {
        const contact = contacts.value[contactId];
        if (contact) {
            if (!contact.connectionDetails) {
                contact.connectionDetails = {};
            }
            if (isConnected !== undefined) {
                contact.connectionDetails.isConnected = isConnected;
            }
            if (connectionType !== undefined) {
                contact.connectionDetails.connectionType = connectionType;
            }
            log(`Connection details updated for ${contactId}: isConnected=${contact.connectionDetails.isConnected}, type=${contact.connectionDetails.connectionType}`, 'DEBUG');
        }
    }
    // ✅ MODIFICATION END


    return {
        userId, userName, contacts, isAiServiceHealthy, aiServiceStatusMessage,
        allOnlineUsers,
        getContactCombinedStatus, typingContacts,
        init,
        fetchAllOnlineUsers,
        addContact, removeContact, updateAiServiceStatus,
        updateContactConnectionDetails, // Expose the new action
        clearUnread,
        incrementUnread, updateContactLastMessage, removeAllContacts, setSelectedChapterForAI, saveTtsSettings,
        ensureSpecialContacts
    };
});