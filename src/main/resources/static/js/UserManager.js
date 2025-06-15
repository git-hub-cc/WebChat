/**
 * @file UserManager.js
 * @description 核心用户管理器，负责处理当前用户的信息、设置、所有联系人（包括特殊 AI 联系人）的数据管理。
 *              它与数据库交互以持久化用户和联系人数据，并确保主题定义的特殊联系人被正确加载和合并。
 *              现在依赖 ThemeLoader 动态提供特殊联系人定义。
 *              修复了切换主题或初始化时，可能加载非当前主题 AI 角色的问题。
 *              确保 TTS 配置中的 tts_mode 和 version 得到正确处理。
 * @module UserManager
 * @exports {object} UserManager - 对外暴露的单例对象，包含所有用户和联系人管理功能。
 * @property {string|null} userId - 当前用户的唯一 ID。
 * @property {object} contacts - 存储所有联系人数据的对象，格式为 { contactId: contactObject }。
 * @property {function} init - 初始化模块，加载或创建用户数据，并加载联系人。
 * @property {function} addContact - 添加一个新联系人。
 * @property {function} removeContact - 移除一个联系人。
 * @property {function} clearAllContacts - 清空所有用户添加的联系人。
 * @property {function} updateUserSetting - 更新并保存用户的偏好设置。
 * @dependencies DBManager, Utils, NotificationManager, ChatManager, ConnectionManager, ThemeLoader, ModalManager, SettingsUIManager, ChatAreaUIManager, EventEmitter
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互以获取用户信息或联系人数据。
 */
const UserManager = {
    userId: null,
    userName: '我',
    contacts: {}, // { contactId: contactObject }
    userSettings: {
        autoConnectEnabled: true,
    },
    isAiServiceHealthy: false,
    _aiServiceStatusMessage: "状态检查中...",

    /**
     * 初始化用户管理器。加载或创建当前用户数据，并加载所有联系人。
     * 现在确保只加载当前主题的 AI 角色和用户添加的常规联系人。
     * @returns {Promise<void>}
     */
    async init() {
        try {
            await DBManager.init();
            let userData = await DBManager.getItem('user', 'currentUser');
            if (userData && userData.userId) {
                this.userId = userData.userId;
                this.userName = userData.userName || `用户 ${this.userId.substring(0,4)}`;
                this.userSettings.autoConnectEnabled = typeof userData.autoConnectEnabled === 'boolean' ? userData.autoConnectEnabled : false;
            } else {
                this.userId = Utils.generateId(8);
                this.userName = `用户 ${this.userId.substring(0,4)}`;
                userData = {
                    id: 'currentUser',
                    userId: this.userId,
                    userName: this.userName,
                    autoConnectEnabled: this.userSettings.autoConnectEnabled
                };
                await DBManager.setItem('user', userData);
            }

            this.contacts = {};

            const currentThemeSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];

            await this.ensureSpecialContacts(currentThemeSpecialDefs, false);

            let dbStoredContacts = [];
            try {
                dbStoredContacts = await DBManager.getAllItems('contacts');
            } catch (error) {
                Utils.log(`UserManager.init: 从 DB 加载联系人失败: ${error}`, Utils.logLevels.ERROR);
            }

            if (dbStoredContacts && dbStoredContacts.length > 0) {
                for (const dbContact of dbStoredContacts) {
                    const isSpecialInCurrentTheme = currentThemeSpecialDefs.some(def => def.id === dbContact.id);

                    if (isSpecialInCurrentTheme) {
                        continue;
                    }

                    if (dbContact.isAI || dbContact.isSpecial) {
                        Utils.log(`UserManager.init: 跳过 DB 联系人 ${dbContact.id} ('${dbContact.name}')，因为它似乎是来自非当前主题的 AI/特殊联系人。`, Utils.logLevels.DEBUG);
                        continue;
                    }

                    dbContact.isSpecial = false;
                    dbContact.isAI = false;
                    if (!dbContact.aiConfig) dbContact.aiConfig = {};
                    if (!dbContact.aiConfig.tts) dbContact.aiConfig.tts = {};
                    if (dbContact.aiConfig.tts.tts_mode === undefined) dbContact.aiConfig.tts.tts_mode = 'Preset';
                    if (dbContact.aiConfig.tts.version === undefined) dbContact.aiConfig.tts.version = 'v4';
                    dbContact.aboutDetails = null;
                    this.contacts[dbContact.id] = dbContact;
                }
            }

            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.on('themeChanged', this.handleThemeChange.bind(this));
            } else {
                console.warn("UserManager.init: EventEmitter 未定义。无法监听 themeChanged 事件。");
            }

        } catch (error) {
            Utils.log(`用户初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `用户 ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            this.contacts = {};
            const fallbackDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];
            await this.ensureSpecialContacts(fallbackDefinitions, true);
        }

        const modalUserIdValueEl = document.getElementById('modalUserIdValue');
        if (modalUserIdValueEl) modalUserIdValueEl.textContent = this.userId;
        if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCopyIdButtonState) {
            SettingsUIManager.updateCopyIdButtonState();
        }
        Utils.log(`用户管理器已初始化。用户 ID: ${this.userId} (${this.userName})。已加载 ${Object.keys(this.contacts).length} 个联系人。`, Utils.logLevels.INFO);
    },

    /**
     * 处理主题变更事件，更新特殊联系人。
     * @param {object} eventData - 包含 { newThemeKey, newDefinitions } 的事件数据。
     * @returns {Promise<void>}
     */
    async handleThemeChange(eventData) {
        Utils.log(`UserManager: 正在处理 themeChanged 事件。新主题密钥: ${eventData.newThemeKey}`, Utils.logLevels.INFO);
        const newDefinitions = eventData.newDefinitions || [];
        const trulyRegularContacts = {};
        const currentContactIds = Object.keys(this.contacts);

        for (const contactId of currentContactIds) {
            const contact = this.contacts[contactId];
            if (!contact) continue;
            const isSpecialInNewTheme = newDefinitions.some(def => def.id === contact.id);
            if (!isSpecialInNewTheme) {
                if (contact.isSpecial || contact.isAI) {
                    contact.isSpecial = false;
                    contact.isAI = false;
                    contact.aiConfig = { tts: { tts_mode: 'Preset', version: 'v4' } };
                    contact.aboutDetails = null;
                }
                trulyRegularContacts[contact.id] = contact;
            }
        }
        this.contacts = trulyRegularContacts;
        await this.ensureSpecialContacts(newDefinitions, false);

        if (typeof ChatManager !== 'undefined') {
            ChatManager.renderChatList(ChatManager.currentFilter);
            if (ChatManager.currentChatId && this.contacts[ChatManager.currentChatId] && this.contacts[ChatManager.currentChatId].isSpecial) {
                ChatManager.openChat(ChatManager.currentChatId, 'contact');
            }
        }
        const currentTheme = (typeof ThemeLoader !== 'undefined' && ThemeLoader.themes[eventData.newThemeKey])
            ? ThemeLoader.themes[eventData.newThemeKey]
            : null;
        if (typeof NotificationManager !== 'undefined' && currentTheme) {
            NotificationManager.showNotification(`主题已切换为 "${currentTheme.name}"`, 'success');
        }
    },

    /**
     * 检查给定的 ID 是否为特殊联系人（基于当前加载的主题定义）。
     * @param {string} contactId - 要检查的联系人 ID。
     * @returns {boolean}
     */
    isSpecialContact: function(contactId) {
        const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
            ? ThemeLoader.getCurrentSpecialContactsDefinitions()
            : [];
        return currentDefinitions.some(sc => sc.id === contactId);
    },

    /**
     * 确保所有在提供的 `definitions` 中定义的特殊联系人都存在于 `this.contacts` 中，
     * 并合并来自数据库和 localStorage 的持久化数据。
     * @param {Array<object>} definitions - 特殊联系人定义数组。
     * @param {boolean} [isFallbackMode=false] - 是否处于回退模式（不访问数据库）。
     * @returns {Promise<void>}
     */
    async ensureSpecialContacts(definitions, isFallbackMode = false) {
        if (!definitions || !Array.isArray(definitions)) {
            Utils.log("UserManager.ensureSpecialContacts: 收到无效或空定义。正在中止。", Utils.logLevels.WARN);
            return;
        }

        for (const scDef of definitions) {
            let contactDataFromDef = {
                id: scDef.id,
                name: scDef.name,
                lastMessage: scDef.initialMessage || '你好！',
                lastTime: new Date().toISOString(),
                unread: 0,
                isSpecial: true,
                avatarText: scDef.avatarText,
                avatarUrl: scDef.avatarUrl || null,
                type: 'contact',
                isAI: scDef.isAI || false,
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || { tts: {} })), // 深拷贝
                aboutDetails: scDef.aboutDetails ? JSON.parse(JSON.stringify(scDef.aboutDetails)) : null
            };
            if (!contactDataFromDef.aiConfig.tts) contactDataFromDef.aiConfig.tts = {};
            if (contactDataFromDef.aiConfig.tts.tts_mode === undefined) contactDataFromDef.aiConfig.tts.tts_mode = 'Preset';
            if (contactDataFromDef.aiConfig.tts.version === undefined) contactDataFromDef.aiConfig.tts.version = 'v4';


            let finalContactData = { ...contactDataFromDef };
            let dbContact = null;

            if (!isFallbackMode) {
                try {
                    dbContact = await DBManager.getItem('contacts', scDef.id);
                } catch (dbError) {
                    Utils.log(`UserManager.ensureSpecialContacts: 从 DB 获取联系人 ${scDef.id} 时出错: ${dbError}`, Utils.logLevels.ERROR);
                }
            }

            if (dbContact) {
                finalContactData.name = dbContact.name || finalContactData.name;
                if (dbContact.lastTime && new Date(dbContact.lastTime) > new Date(finalContactData.lastTime)) {
                    finalContactData.lastMessage = dbContact.lastMessage || finalContactData.lastMessage;
                    finalContactData.lastTime = dbContact.lastTime;
                }
                finalContactData.unread = dbContact.unread !== undefined ? dbContact.unread : 0;
                finalContactData.avatarUrl = dbContact.avatarUrl !== undefined ? dbContact.avatarUrl : finalContactData.avatarUrl;

                if (dbContact.aiConfig && finalContactData.isAI) {
                    const { tts: dbTtsConfig, ...otherDbAiConfig } = dbContact.aiConfig;
                    const themeDefTtsMode = contactDataFromDef.aiConfig.tts?.tts_mode;
                    const dbTtsMode = dbTtsConfig?.tts_mode;
                    const themeDefVersion = contactDataFromDef.aiConfig.tts?.version;
                    const dbVersion = dbTtsConfig?.version;

                    finalContactData.aiConfig = {
                        ...contactDataFromDef.aiConfig,
                        ...otherDbAiConfig,
                        tts: {
                            ...(contactDataFromDef.aiConfig.tts || {}),
                            ...(dbTtsConfig || {}),
                            tts_mode: themeDefTtsMode || dbTtsMode || 'Preset',
                            version: themeDefVersion || dbVersion || 'v4'
                        }
                    };
                } else if (!finalContactData.isAI) {
                    finalContactData.aiConfig = { tts: { tts_mode: 'Preset', version: 'v4' } };
                }
                finalContactData.aboutDetails = dbContact.aboutDetails || finalContactData.aboutDetails;
            }

            if (!finalContactData.aiConfig) finalContactData.aiConfig = {};
            if (!finalContactData.aiConfig.tts) finalContactData.aiConfig.tts = {};
            if (finalContactData.aiConfig.tts.tts_mode === undefined) finalContactData.aiConfig.tts.tts_mode = 'Preset';
            if (finalContactData.aiConfig.tts.version === undefined) finalContactData.aiConfig.tts.version = 'v4';


            if (finalContactData.isAI) {
                const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${scDef.id}`);
                if (storedTtsSettingsJson) {
                    try {
                        const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                        const localStorageTtsMode = storedTtsSettings.tts_mode;
                        const localStorageVersion = storedTtsSettings.version;
                        finalContactData.aiConfig.tts = {
                            ...(finalContactData.aiConfig.tts || {}),
                            ...storedTtsSettings,
                            tts_mode: localStorageTtsMode || finalContactData.aiConfig.tts.tts_mode || 'Preset',
                            version: localStorageVersion || finalContactData.aiConfig.tts.version || 'v4'
                        };
                    } catch (e) {
                        Utils.log(`从 localStorage 解析 ${scDef.id} 的 TTS 设置时出错: ${e}`, Utils.logLevels.WARN);
                    }
                }
            }
            if (finalContactData.aiConfig && finalContactData.aiConfig.tts && finalContactData.aiConfig.tts.version === undefined) {
                finalContactData.aiConfig.tts.version = 'v4';
            }

            this.contacts[scDef.id] = finalContactData;
            if (!isFallbackMode) {
                await this.saveContact(scDef.id);
            }
        }
    },

    /**
     * 更新并保存用户的偏好设置。
     * @param {string} settingKey - 要更新的设置键名。
     * @param {*} value - 新的设置值。
     * @returns {Promise<void>}
     */
    async updateUserSetting(settingKey, value) {
        if (this.userSettings.hasOwnProperty(settingKey)) {
            this.userSettings[settingKey] = value;
            Utils.log(`用户设置已更新: ${settingKey} = ${value}`, Utils.logLevels.INFO);
            try {
                const userData = await DBManager.getItem('user', 'currentUser') ||
                    { id: 'currentUser', userId: this.userId, userName: this.userName };
                const updatedUserData = { ...userData, ...this.userSettings };
                await DBManager.setItem('user', updatedUserData);
            } catch (error) {
                Utils.log(`保存设置 ${settingKey} 失败: ${error}`, Utils.logLevels.ERROR);
                NotificationManager.showNotification('保存设置失败。', 'error');
            }
        } else {
            Utils.log(`尝试更新未知设置: ${settingKey}`, Utils.logLevels.WARN);
        }
    },

    /**
     * @deprecated 联系人加载现在主要在 UserManager.init 中处理，以确保正确过滤。
     * 此方法将来可能会被移除，或者其行为会发生重大变化。
     */
    async loadContacts() {
        Utils.log("UserManager.loadContacts: 此方法不推荐在 init 中直接使用。联系人加载逻辑现已集成到 UserManager.init() 中。", Utils.logLevels.WARN);
    },

    /**
     * 将指定的联系人数据保存到数据库。
     * @param {string} contactId - 要保存的联系人 ID。
     * @returns {Promise<void>}
     */
    async saveContact(contactId) {
        if (this.contacts[contactId]) {
            try {
                const contactToSave = { ...this.contacts[contactId] };
                if (!contactToSave.aiConfig) contactToSave.aiConfig = {};
                if (!contactToSave.aiConfig.tts) contactToSave.aiConfig.tts = {};
                if (contactToSave.aiConfig.tts.tts_mode === undefined) contactToSave.aiConfig.tts.tts_mode = 'Preset';
                if (contactToSave.aiConfig.tts.version === undefined) contactToSave.aiConfig.tts.version = 'v4';
                await DBManager.setItem('contacts', contactToSave);
            } catch (error) {
                Utils.log(`保存联系人 ${contactId} 失败: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    /**
     * 触发侧边栏重新渲染，只显示联系人列表。
     */
    renderContactListForSidebar: function() {
        if (typeof ChatManager !== 'undefined' && typeof SidebarUIManager !== 'undefined') {
            ChatManager.currentFilter = 'contacts';
            SidebarUIManager.setActiveTab('contacts');
            ChatManager.renderChatList('contacts');
        }
    },

    /**
     * 添加一个新联系人。
     * @param {string} id - 新联系人的 ID。
     * @param {string} name - 新联系人的名称。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    async addContact(id, name) {
        if (id === this.userId) {
            NotificationManager.showNotification("您不能添加自己为联系人。", "error");
            return false;
        }
        if (this.isSpecialContact(id)) {
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationManager.showNotification(`${specialContactName} 是内置联系人，不能手动添加。`, "warning");
            if (this.contacts[id] && !ConnectionManager.isConnectedTo(id)) {
                ConnectionManager.createOffer(id, { isSilent: true });
            }
            return true;
        }
        if (this.contacts[id]) {
            NotificationManager.showNotification("该联系人已存在。", "warning");
            if (name && this.contacts[id].name !== name) {
                this.contacts[id].name = name;
                await this.saveContact(id);
                if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
            }
            const existingConn = ConnectionManager.connections[id];
            if (!ConnectionManager.isConnectedTo(id) &&
                (!existingConn || (existingConn.peerConnection && existingConn.peerConnection.signalingState === 'stable' && existingConn.peerConnection.connectionState !== 'connecting'))) {
                ConnectionManager.createOffer(id, { isSilent: true });
            }
            return true;
        }

        const newContact = {
            id: id, name: name || `用户 ${id.substring(0, 4)}`, lastMessage: '',
            lastTime: new Date().toISOString(), unread: 0, isSpecial: false,
            avatarText: name ? name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase(),
            avatarUrl: null, type: 'contact', isAI: false,
            aiConfig: { tts: { tts_mode: 'Preset', version: 'v4' } },
            aboutDetails: null
        };
        this.contacts[id] = newContact;
        await this.saveContact(id);
        if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`联系人 "${newContact.name}" 已添加。`, 'success');

        ConnectionManager.createOffer(id, { isSilent: true });
        Utils.log(`尝试与新联系人建立初始连接: ${id}`, Utils.logLevels.INFO);
        return true;
    },

    /**
     * 移除一个联系人。
     * @param {string} id - 要移除的联系人 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    async removeContact(id) {
        if (this.isSpecialContact(id)) {
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationManager.showNotification(`${specialContactName} 是内置联系人，不能被移除。`, "warning");
            return false;
        }
        if (this.contacts[id]) {
            const tempContact = this.contacts[id];
            delete this.contacts[id];
            try {
                await DBManager.removeItem('contacts', id);
                localStorage.removeItem(`ttsConfig_${id}`);
                if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                return true;
            } catch (error) {
                Utils.log(`从数据库移除联系人 ${id} 失败: ${error}`, Utils.logLevels.ERROR);
                this.contacts[id] = tempContact;
                if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                return false;
            }
        }
        return false;
    },

    /**
     * 更新联系人的最后一条消息预览和未读计数。
     * @param {string} id - 目标联系人的 ID。
     * @param {string} messageText - 消息预览文本。
     * @param {boolean} [incrementUnread=false] - 是否增加未读计数。
     * @param {boolean} [forceNoUnread=false] - 是否强制将未读计数清零。
     * @returns {Promise<void>}
     */
    async updateContactLastMessage(id, messageText, incrementUnread = false, forceNoUnread = false) {
        const contact = this.contacts[id];
        if (contact) {
            contact.lastMessage = messageText.length > 30 ? messageText.substring(0, 27) + "..." : messageText;
            contact.lastTime = new Date().toISOString();
            if (forceNoUnread) {
                contact.unread = 0;
            } else if (incrementUnread && (ChatManager.currentChatId !== id || !document.hasFocus())) {
                contact.unread = (contact.unread || 0) + 1;
            }
            await this.saveContact(id);
            if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
        } else {
            Utils.log(`尝试为不存在的联系人更新最后一条消息: ${id}`, Utils.logLevels.WARN);
        }
    },

    /**
     * 清除指定联系人的未读消息计数。
     * @param {string} id - 目标联系人的 ID。
     * @returns {Promise<void>}
     */
    async clearUnread(id) {
        const contact = this.contacts[id];
        if (contact && contact.unread > 0) {
            contact.unread = 0;
            await this.saveContact(id);
            if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
        }
    },

    /**
     * 清空所有用户添加的联系人及其聊天记录。
     * AI 助手（如果它们不是通过当前主题定义的“不可移除”特殊联系人）也将被删除。
     * @returns {Promise<void>}
     */
    async clearAllContacts() {
        ModalManager.showConfirmationModal(
            "您确定要删除所有用户添加的联系人以及所有可移除的AI助手吗？这也会清空他们的聊天记录。核心内置的特殊联系人将保留。",
            async () => {
                const tempContacts = { ...this.contacts };
                const contactIdsToRemove = [];
                const contactsToKeepExplicitlyBasedOnCurrentTheme = {};

                const currentSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                    ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];

                currentSpecialDefs.forEach(def => {
                    if (tempContacts[def.id]) {
                        contactsToKeepExplicitlyBasedOnCurrentTheme[def.id] = tempContacts[def.id];
                    }
                });

                Object.keys(tempContacts).forEach(id => {
                    if (!contactsToKeepExplicitlyBasedOnCurrentTheme[id]) {
                        contactIdsToRemove.push(id);
                    }
                });

                this.contacts = contactsToKeepExplicitlyBasedOnCurrentTheme;

                try {
                    for (const contactId of contactIdsToRemove) {
                        await DBManager.removeItem('contacts', contactId);
                        localStorage.removeItem(`ttsConfig_${contactId}`);
                        if (typeof ChatManager !== 'undefined') await ChatManager.clearChat(contactId);
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                    }

                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        ChatManager.currentChatId = null;
                        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                    }
                    if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                    NotificationManager.showNotification("所有可移除的联系人、AI助手及其聊天记录已清空。", 'success');
                } catch (error) {
                    Utils.log("清空联系人失败: " + error, Utils.logLevels.ERROR);
                    NotificationManager.showNotification("从数据库清空联系人失败。", 'error');
                    this.contacts = tempContacts;
                    if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                }
            }
        );
    },

    /**
     * 格式化联系人消息的预览文本。
     * @param {object} message - 消息对象。
     * @returns {string} - 格式化后的预览文本。
     */
    formatMessagePreview: function(message) {
        let preview = '';
        const isMyMessage = message.sender === UserManager.userId || message.originalSender === UserManager.userId;
        let senderContact = this.contacts[message.sender];
        let senderName;

        if (message.isRetracted) {
            return message.content;
        }

        if (senderContact && senderContact.isSpecial) {
            senderName = senderContact.name;
        } else if (isMyMessage) {
            senderName = "您";
        } else if (senderContact) {
            senderName = senderContact.name;
        } else {
            senderName = "对方";
        }

        switch (message.type) {
            case 'text':
                preview = `${senderName}: ${message.content}`;
                break;
            case 'image':
                preview = `${senderName}: [图片]`;
                break;
            case 'file':
                if (message.fileType?.startsWith('image/')) preview = `${senderName}: [图片]`;
                else if (message.fileType?.startsWith('video/')) preview = `${senderName}: [视频]`;
                else if (message.fileType?.startsWith('audio/')) preview = `${senderName}: [音频文件]`;
                else preview = `${senderName}: [文件] ${message.fileName || ''}`;
                break;
            case 'audio':
                preview = `${senderName}: [语音消息]`;
                break;
            case 'system':
                return message.content.length > 35 ? message.content.substring(0, 32) + "..." : message.content;
            default:
                preview = `${senderName}: [新消息]`;
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    },

    /**
     * @description 更新全局 AI 服务健康状态和显示消息。
     * @param {boolean} isHealthy - AI 服务的最新健康状态。
     */
    updateAiServiceStatus: function(isHealthy) {
        this.isAiServiceHealthy = isHealthy;
        if (isHealthy) {
            this._aiServiceStatusMessage = "服务可用";
            NotificationManager.showNotification('当前AI服务成功连接。', 'info');
        } else {
            this._aiServiceStatusMessage = "服务不可用";
            NotificationManager.showNotification('当前AI服务不可用，前往AI 与 API 配置进行修改。', 'error');
        }
        Utils.log(`UserManager: AI 服务状态更新为: ${this._aiServiceStatusMessage}`, Utils.logLevels.INFO);
    },

    /**
     * @description 获取当前用于 AI 服务状态的显示消息。
     * @returns {string} AI 服务状态的显示文本。
     */
    getAiServiceStatusMessage: function() {
        return `AI 助手 - ${this._aiServiceStatusMessage}`;
    }
};