/**
 * @file UserManager.js
 * @description 核心用户管理器，负责处理当前用户的信息、设置、所有联系人（包括特殊 AI 联系人）的数据管理。
 *              它与数据库交互以持久化用户和联系人数据。AI联系人在主题切换后会被保留，其配置会根据当前主题定义或历史数据进行更新。
 *              在处理群组添加成员事件时，会确保根据收到的详情正确创建新联系人。
 *              新增：支持AI联系人选择不同的关卡篇章，并持久化用户的选择。
 *              MODIFIED: 增加了对 isImported 标志的支持，以确保导入的角色在主题切换时不会被移除。addContact 方法现在能更好地处理完整的联系人数据对象。
 *              OPTIMIZED: ensureSpecialContacts 现在使用 Promise.all 并行处理数据库写入，以提高性能。
 * @module UserManager
 * @exports {object} UserManager - 对外暴露的单例对象，包含所有用户和联系人管理功能。
 * @property {string|null} userId - 当前用户的唯一 ID。
 * @property {object} contacts - 存储所有联系人数据的对象，格式为 { contactId: contactObject }。
 * @property {function} init - 初始化模块，加载或创建用户数据，并加载联系人。
 * @property {function} addContact - 添加一个新联系人。
 * @property {function} removeContact - 移除一个联系人。
 * @property {function} clearAllContacts - 清空所有用户添加的联系人。
 * @property {function} updateUserSetting - 更新并保存用户的偏好设置。
 * @property {function} isSpecialContact - 检查一个联系人是否为广义上的特殊联系人（特殊标记或AI）。
 * @property {function} isSpecialContactInCurrentTheme - 检查一个联系人是否由当前主题定义为特殊。
 * @property {function} getSelectedChapterForAI - 获取AI联系人当前选择的关卡篇章ID。
 * @property {function} setSelectedChapterForAI - 设置AI联系人选择的关卡篇章ID，并持久化。
 * @dependencies DBManager, Utils, NotificationUIManager, ChatManager, ConnectionManager, ThemeLoader, ModalUIManager, SettingsUIManager, ChatAreaUIManager, EventEmitter, GroupManager
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互以获取用户信息或联系人数据。
 */
const UserManager = {
    userId: null,
    userName: '我',
    contacts: {},
    userSettings: {
        autoConnectEnabled: true,
    },
    isAiServiceHealthy: false,
    _aiServiceStatusMessage: "状态检查中...",

    /**
     * 初始化用户管理器。加载或创建当前用户数据，并加载所有联系人。
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

            let dbStoredContacts = [];
            try {
                dbStoredContacts = await DBManager.getAllItems('contacts');
                if (dbStoredContacts && dbStoredContacts.length > 0) {
                    for (const dbContact of dbStoredContacts) {
                        if (!dbContact.aiConfig) dbContact.aiConfig = {};
                        if (!dbContact.aiConfig.tts) dbContact.aiConfig.tts = {};
                        if (dbContact.aiConfig.tts.tts_mode === undefined) dbContact.aiConfig.tts.tts_mode = 'Preset';
                        if (dbContact.aiConfig.tts.version === undefined) dbContact.aiConfig.tts.version = 'v4';
                        // selectedChapterId will be loaded within ensureSpecialContacts or later merging
                        this.contacts[dbContact.id] = dbContact;
                    }
                }
            } catch (error) {
                Utils.log(`UserManager.init: 从 DB 加载联系人失败: ${error}`, Utils.logLevels.ERROR);
            }

            const currentThemeSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];

            await this.ensureSpecialContacts(currentThemeSpecialDefs, false);

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
        Utils.log(`用户管理器已初始化。用户 ID: ${this.userId} (${this.userName})。当前管理 ${Object.keys(this.contacts).length} 个联系人。`, Utils.logLevels.INFO);
    },

    /**
     * 处理主题变更事件，调用 ensureSpecialContacts 更新联系人列表。
     * 同时，如果当前打开的是群组聊天且详情面板可见，则刷新详情面板的成员列表。
     * @param {object} eventData - 包含 { newThemeKey, newDefinitions } 的事件数据。
     * @returns {Promise<void>}
     */
    async handleThemeChange(eventData) {
        Utils.log(`UserManager: 正在处理 themeChanged 事件。新主题密钥: ${eventData.newThemeKey}`, Utils.logLevels.INFO);
        const newDefinitions = eventData.newDefinitions || [];

        await this.ensureSpecialContacts(newDefinitions, false);

        if (typeof ChatManager !== 'undefined') {
            ChatManager.renderChatList(ChatManager.currentFilter);
            if (ChatManager.currentChatId && this.contacts[ChatManager.currentChatId]) {
                const contact = this.contacts[ChatManager.currentChatId];
                const type = contact.type || 'contact';
                ChatManager.openChat(ChatManager.currentChatId, type);
            }

            if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_') &&
                typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isPanelAreaVisible &&
                DetailsPanelUIManager.currentView === 'details') {
                Utils.log(`UserManager.handleThemeChange: 主题已更改，当前为群组 ${ChatManager.currentChatId} 且详情面板可见，正在刷新成员列表。`, Utils.logLevels.DEBUG);
                DetailsPanelUIManager.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        }

        const currentTheme = (typeof ThemeLoader !== 'undefined' && ThemeLoader.themes[eventData.newThemeKey])
            ? ThemeLoader.themes[eventData.newThemeKey]
            : null;
        if (typeof NotificationUIManager !== 'undefined' && currentTheme) {
            NotificationUIManager.showNotification(`主题已切换为 "${currentTheme.name}"`, 'success');
        }
    },

    /**
     * 检查一个联系人是否为广义上的特殊联系人（即其 isSpecial 标记为 true 或 isAI 标记为 true）。
     * @param {string} contactId - 要检查的联系人 ID。
     * @returns {boolean}
     */
    isSpecialContact: function(contactId) {
        const contact = this.contacts[contactId];
        return !!(contact && (contact.isSpecial || contact.isAI));
    },

    /**
     * 检查给定的 ID 是否为当前主题定义的特殊联系人。
     * @param {string} contactId - 要检查的联系人 ID。
     * @returns {boolean}
     */
    isSpecialContactInCurrentTheme: function(contactId) {
        const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
            ? ThemeLoader.getCurrentSpecialContactsDefinitions()
            : [];
        return currentDefinitions.some(sc => sc.id === contactId);
    },

    /**
     * OPTIMIZED: 确保特殊联系人存在并同步数据，使用 Promise.all 批量保存。
     * @param {Array<object>} newThemeDefinitions - 新主题的特殊联系人定义数组。
     * @param {boolean} [isFallbackMode=false] - 是否处于回退模式（不访问数据库）。
     * @returns {Promise<void>}
     */
    async ensureSpecialContacts(newThemeDefinitions, isFallbackMode = false) {
        if (!newThemeDefinitions || !Array.isArray(newThemeDefinitions)) {
            Utils.log("UserManager.ensureSpecialContacts: 收到无效或空定义。正在中止。", Utils.logLevels.WARN);
            return;
        }

        const processedContactIds = new Set();
        const savePromises = []; // OPTIMIZATION: 收集所有保存操作的Promise

        for (const scDef of newThemeDefinitions) {
            processedContactIds.add(scDef.id);
            let existingContact = this.contacts[scDef.id];
            let dbContact = null;
            if (!isFallbackMode) {
                try {
                    dbContact = await DBManager.getItem('contacts', scDef.id);
                } catch (dbError) {
                    Utils.log(`ensureSpecialContacts: 获取DB联系人 ${scDef.id} 失败: ${dbError}`, Utils.logLevels.ERROR);
                }
            }

            const baseDataFromDef = {
                id: scDef.id,
                name: scDef.name,
                isSpecial: true,
                avatarText: scDef.avatarText,
                avatarUrl: scDef.avatarUrl || null,
                type: 'contact',
                isAI: scDef.isAI || false,
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || { tts: {} })),
                aboutDetails: scDef.aboutDetails ? JSON.parse(JSON.stringify(scDef.aboutDetails)) : null,
                chapters: Array.isArray(scDef.chapters) ? JSON.parse(JSON.stringify(scDef.chapters)) : []
            };
            if (!baseDataFromDef.aiConfig.tts) baseDataFromDef.aiConfig.tts = {};
            if (baseDataFromDef.aiConfig.tts.tts_mode === undefined) baseDataFromDef.aiConfig.tts.tts_mode = 'Preset';
            if (baseDataFromDef.aiConfig.tts.version === undefined) baseDataFromDef.aiConfig.tts.version = 'v4';

            let contactChanged = false;

            if (existingContact) {
                // ... (原有合并逻辑) ...
                existingContact.isSpecial = true;
                existingContact.isAI = baseDataFromDef.isAI;
                existingContact.name = baseDataFromDef.name;
                existingContact.avatarText = baseDataFromDef.avatarText;
                existingContact.avatarUrl = baseDataFromDef.avatarUrl;
                existingContact.aboutDetails = baseDataFromDef.aboutDetails;
                existingContact.chapters = baseDataFromDef.chapters;

                const mergedAiConfig = { ...(baseDataFromDef.aiConfig || {tts: {}}) };
                if (existingContact.aiConfig) {
                    Object.assign(mergedAiConfig, existingContact.aiConfig);
                    if (existingContact.aiConfig.tts) Object.assign(mergedAiConfig.tts, existingContact.aiConfig.tts);
                }
                if (dbContact && dbContact.aiConfig && baseDataFromDef.isAI) {
                    Object.assign(mergedAiConfig, dbContact.aiConfig);
                    if (dbContact.aiConfig.tts) Object.assign(mergedAiConfig.tts, dbContact.aiConfig.tts);
                }
                existingContact.aiConfig = mergedAiConfig;

                existingContact.lastMessage = (dbContact && dbContact.lastMessage !== undefined) ? dbContact.lastMessage : (existingContact.lastMessage !== undefined ? existingContact.lastMessage : (scDef.initialMessage || '你好！'));
                existingContact.lastTime = (dbContact && dbContact.lastTime) ? dbContact.lastTime : (existingContact.lastTime || new Date().toISOString());
                existingContact.unread = (dbContact && dbContact.unread !== undefined) ? dbContact.unread : (existingContact.unread || 0);
                existingContact.selectedChapterId = (dbContact && dbContact.selectedChapterId) ? dbContact.selectedChapterId : (existingContact.selectedChapterId || null);

                contactChanged = true; // Assume change on merge
            } else {
                this.contacts[scDef.id] = { ...baseDataFromDef };
                existingContact = this.contacts[scDef.id];
                // ... (原有新建逻辑) ...
                if (dbContact) {
                    existingContact.name = dbContact.name || existingContact.name;
                    existingContact.lastMessage = dbContact.lastMessage !== undefined ? dbContact.lastMessage : (scDef.initialMessage || '你好！');
                    existingContact.lastTime = dbContact.lastTime || new Date().toISOString();
                    existingContact.unread = dbContact.unread !== undefined ? dbContact.unread : 0;
                    existingContact.avatarUrl = dbContact.avatarUrl !== undefined ? dbContact.avatarUrl : existingContact.avatarUrl;
                    existingContact.selectedChapterId = dbContact.selectedChapterId || null; // 加载已选篇章
                    if (dbContact.aiConfig && existingContact.isAI) {
                        Object.assign(existingContact.aiConfig, dbContact.aiConfig);
                        if(dbContact.aiConfig.tts) Object.assign(existingContact.aiConfig.tts, dbContact.aiConfig.tts);
                    }
                } else {
                    existingContact.lastMessage = scDef.initialMessage || '你好！';
                    existingContact.lastTime = new Date().toISOString();
                    existingContact.unread = 0;
                    existingContact.selectedChapterId = null; // 新建时默认为null
                }
                contactChanged = true;
            }

            if (existingContact.isAI) {
                // ... (TTS 配置加载逻辑) ...
            }
            if (contactChanged && !isFallbackMode) {
                savePromises.push(this.saveContact(scDef.id));
            }
        }

        for (const contactId in this.contacts) {
            if (!processedContactIds.has(contactId)) {
                const contact = this.contacts[contactId];
                if (contact.isSpecial && !contact.isImported) {
                    contact.isSpecial = false;
                    contact.chapters = [];
                    Utils.log(`ensureSpecialContacts: 联系人 ${contactId} ('${contact.name}') isSpecial设为false。AI状态: ${contact.isAI}`, Utils.logLevels.DEBUG);
                    if (!isFallbackMode) {
                        savePromises.push(this.saveContact(contactId));
                    }
                }
            }
        }

        // OPTIMIZATION: 并行执行所有保存操作
        if (savePromises.length > 0) {
            await Promise.all(savePromises);
            Utils.log(`ensureSpecialContacts: 已并行保存 ${savePromises.length} 个联系人更新。`, Utils.logLevels.INFO);
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
                NotificationUIManager.showNotification('保存设置失败。', 'error');
            }
        } else {
            Utils.log(`尝试更新未知设置: ${settingKey}`, Utils.logLevels.WARN);
        }
    },

    /**
     * @deprecated 联系人加载现在主要在 UserManager.init 中处理，以确保正确过滤。
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
                // 确保 chapters 存在
                if (contactToSave.isAI && !Array.isArray(contactToSave.chapters)) {
                    contactToSave.chapters = [];
                }
                // 确保 selectedChapterId 存在 (即使为null)
                if (contactToSave.isAI && contactToSave.selectedChapterId === undefined) {
                    contactToSave.selectedChapterId = null;
                }

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
     * 添加一个新联系人，或根据提供的数据创建联系人（用于从群消息或角色卡导入）。
     * @param {string|object} idOrData - 新联系人的 ID (string)，或包含联系人完整数据的对象 (object)。
     * @param {string} [name] - 新联系人的名称 (如果 idOrData 是 string)。
     * @param {boolean} [establishConnection=true] - 是否在添加后尝试建立连接 (仅当 idOrData 是 string 时有效)。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    async addContact(idOrData, name, establishConnection = true) {
        let id, contactData, isFromObject = false;

        if (typeof idOrData === 'object' && idOrData !== null) {
            id = idOrData.id;
            contactData = idOrData;
            isFromObject = true;
            establishConnection = false; // From object, assume connection is not needed or handled elsewhere
            Utils.log(`UserManager.addContact: 正在尝试根据对象详情添加联系人 ${id}`, Utils.logLevels.DEBUG);
        } else if (typeof idOrData === 'string') {
            id = idOrData;
        } else {
            NotificationUIManager.showNotification("添加联系人失败：无效的参数。", "error");
            return false;
        }

        if (!id) {
            NotificationUIManager.showNotification("添加联系人失败：ID无效。", "error");
            return false;
        }

        if (id === this.userId) {
            NotificationUIManager.showNotification("您不能添加自己为联系人。", "error");
            return false;
        }

        if (this.isSpecialContactInCurrentTheme(id)) {
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            if (!isFromObject) NotificationUIManager.showNotification(`${specialContactName} 是内置联系人，不能手动添加。`, "warning");

            if (!isFromObject && establishConnection && this.contacts[id] && !this.contacts[id].isAI && !ConnectionManager.isConnectedTo(id)) {
                // 【FIX】使用新的统一连接方法
                ConnectionManager.connectToPeer(id, { isSilent: true });
            }
            return true;
        }

        if (this.contacts[id]) {
            if (!isFromObject) NotificationUIManager.showNotification("该联系人已在您的列表中。", "info");
            let contactChanged = false;

            if (isFromObject && contactData) {
                if (contactData.name && this.contacts[id].name !== contactData.name) { this.contacts[id].name = contactData.name; contactChanged = true; }
                if (contactData.avatarText && this.contacts[id].avatarText !== contactData.avatarText) { this.contacts[id].avatarText = contactData.avatarText; contactChanged = true; }
                if (contactData.avatarUrl !== undefined && this.contacts[id].avatarUrl !== contactData.avatarUrl) { this.contacts[id].avatarUrl = contactData.avatarUrl; contactChanged = true; }
                if (contactData.isAI !== undefined && this.contacts[id].isAI !== contactData.isAI) { this.contacts[id].isAI = contactData.isAI; contactChanged = true; }
                if (contactData.isImported !== undefined && this.contacts[id].isImported !== contactData.isImported) { this.contacts[id].isImported = contactData.isImported; contactChanged = true; }
                if (contactData.isSpecial !== undefined && this.contacts[id].isSpecial !== contactData.isSpecial) { this.contacts[id].isSpecial = contactData.isSpecial; contactChanged = true; }

                if (contactData.aiConfig) {
                    if (!this.contacts[id].aiConfig) this.contacts[id].aiConfig = {};
                    Object.assign(this.contacts[id].aiConfig, contactData.aiConfig);
                    if (contactData.aiConfig.tts) {
                        if (!this.contacts[id].aiConfig.tts) this.contacts[id].aiConfig.tts = {};
                        Object.assign(this.contacts[id].aiConfig.tts, contactData.aiConfig.tts);
                    }
                    contactChanged = true;
                }
                if (contactData.isAI && contactData.chapters && Array.isArray(contactData.chapters)) {
                    if (JSON.stringify(this.contacts[id].chapters) !== JSON.stringify(contactData.chapters)) {
                        this.contacts[id].chapters = JSON.parse(JSON.stringify(contactData.chapters));
                        contactChanged = true;
                    }
                }
                if (contactData.isAI && contactData.selectedChapterId !== undefined && this.contacts[id].selectedChapterId !== contactData.selectedChapterId) {
                    this.contacts[id].selectedChapterId = contactData.selectedChapterId;
                    contactChanged = true;
                }


            } else if (name && this.contacts[id].name !== name) {
                this.contacts[id].name = name;
                contactChanged = true;
            }

            if (this.contacts[id].isSpecial && !this.isSpecialContactInCurrentTheme(id) && !this.contacts[id].isImported) {
                this.contacts[id].isSpecial = false;
                contactChanged = true;
            }
            if(contactChanged) await this.saveContact(id);
            if (typeof ChatManager !== 'undefined' && !isFromObject) ChatManager.renderChatList(ChatManager.currentFilter);

            if (!isFromObject && establishConnection && !this.contacts[id].isAI && !ConnectionManager.isConnectedTo(id)) {
                // 【FIX】使用新的统一连接方法
                ConnectionManager.connectToPeer(id, { isSilent: true });
            }
            return true;
        }

        const newContact = {
            id: id,
            name: isFromObject ? (contactData.name || `用户 ${id.substring(0, 4)}`) : (name || `用户 ${id.substring(0, 4)}`),
            lastMessage: isFromObject ? (contactData.lastMessage || '') : '',
            lastTime: new Date().toISOString(),
            unread: 0,
            isSpecial: isFromObject ? (contactData.isSpecial || false) : false,
            isImported: isFromObject ? (contactData.isImported || false) : false,
            avatarText: isFromObject
                ? (contactData.avatarText || (contactData.name ? contactData.name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase()))
                : (name ? name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase()),
            avatarUrl: isFromObject ? (contactData.avatarUrl || null) : null,
            type: 'contact',
            isAI: isFromObject ? (contactData.isAI || false) : false,
            aiConfig: isFromObject ? (contactData.aiConfig || { tts: { tts_mode: 'Preset', version: 'v4' } }) : { tts: { tts_mode: 'Preset', version: 'v4' } },
            aboutDetails: isFromObject ? (contactData.aboutDetails || null) : null,
            chapters: (isFromObject && contactData.isAI && Array.isArray(contactData.chapters)) ? JSON.parse(JSON.stringify(contactData.chapters)) : [],
            selectedChapterId: (isFromObject && contactData.isAI && contactData.selectedChapterId !== undefined) ? contactData.selectedChapterId : null
        };
        if (!newContact.aiConfig) newContact.aiConfig = {};
        if (!newContact.aiConfig.tts) newContact.aiConfig.tts = {};
        if (newContact.aiConfig.tts.tts_mode === undefined) newContact.aiConfig.tts.tts_mode = 'Preset';
        if (newContact.aiConfig.tts.version === undefined) newContact.aiConfig.tts.version = 'v4';

        this.contacts[id] = newContact;
        await this.saveContact(id);

        if (typeof ChatManager !== 'undefined' && !isFromObject) ChatManager.renderChatList(ChatManager.currentFilter);
        if (!isFromObject) NotificationUIManager.showNotification(`联系人 "${newContact.name}" 已添加。`, 'success');

        if (!isFromObject && typeof DetailsPanelUIManager !== 'undefined' &&
            DetailsPanelUIManager.currentView === 'details' &&
            ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
            const currentGroup = GroupManager.groups[ChatManager.currentChatId];
            if (currentGroup && currentGroup.owner === this.userId) {
                DetailsPanelUIManager.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        }

        if (!isFromObject && establishConnection) {
            // 【FIX】使用新的统一连接方法
            ConnectionManager.connectToPeer(id, { isSilent: true });
        }
        return true;
    },

    /**
     * 移除一个联系人。
     * 不允许移除当前主题定义的特殊联系人。
     * @param {string} id - 要移除的联系人 ID。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    async removeContact(id) {
        if (this.isSpecialContactInCurrentTheme(id) && !this.contacts[id]?.isImported) {
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationUIManager.showNotification(`${specialContactName} 是当前主题的内置联系人，不能被移除。`, "warning");
            return false;
        }
        if (this.contacts[id]) {
            const tempContact = this.contacts[id];
            delete this.contacts[id];
            try {
                await DBManager.removeItem('contacts', id);
                localStorage.removeItem(`ttsConfig_${id}`);
                // 移除AI联系人的已选篇章记录 (虽然 contact 对象已删除，但以防万一)
                localStorage.removeItem(`ai_chapter_${id}`);

                if (tempContact.isAI && typeof GroupManager !== 'undefined' && GroupManager.groups) {
                    for (const groupId in GroupManager.groups) {
                        const group = GroupManager.groups[groupId];
                        const memberIndex = group.members.indexOf(id);
                        if (memberIndex !== -1) {
                            group.members.splice(memberIndex, 1);
                            if (group.aiPrompts && group.aiPrompts[id]) {
                                delete group.aiPrompts[id];
                            }
                            await GroupManager.saveGroup(groupId);
                            if (ChatManager.currentChatId === groupId && typeof DetailsPanelUIManager !== 'undefined') {
                                DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                            }
                        }
                    }
                }
                if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                NotificationUIManager.showNotification(`联系人 "${tempContact.name}" 已删除。`, 'success');
                return true;
            } catch (error) {
                Utils.log(`从数据库移除联系人 ${id} 失败: ${error}`, Utils.logLevels.ERROR);
                this.contacts[id] = tempContact;
                if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                NotificationUIManager.showNotification("删除联系人失败。", "error");
                return false;
            }
        }
        NotificationUIManager.showNotification("未找到要删除的联系人。", "warning");
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
     * 清空所有非当前主题特殊联系人。
     * @returns {Promise<void>}
     */
    async clearAllContacts() {
        ModalUIManager.showConfirmationModal(
            "您确定要删除所有非当前主题的特殊联系人以及所有您手动添加的联系人吗？这也会清空他们的聊天记录和群组关联。当前主题的内置特殊联系人将保留。",
            async () => {
                const tempContactsSnapshot = { ...this.contacts };
                const contactIdsToRemove = [];
                const contactsToKeep = {};

                const currentSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                    ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];

                currentSpecialDefs.forEach(def => {
                    if (tempContactsSnapshot[def.id]) {
                        contactsToKeep[def.id] = tempContactsSnapshot[def.id];
                    }
                });

                Object.keys(tempContactsSnapshot).forEach(id => {
                    if (!contactsToKeep[id]) {
                        contactIdsToRemove.push(id);
                    }
                });

                this.contacts = contactsToKeep;

                try {
                    for (const contactId of contactIdsToRemove) {
                        const removedContactDetails = tempContactsSnapshot[contactId];
                        await DBManager.removeItem('contacts', contactId);
                        localStorage.removeItem(`ttsConfig_${contactId}`);
                        localStorage.removeItem(`ai_chapter_${contactId}`);

                        if (typeof ChatManager !== 'undefined') await ChatManager.clearChat(contactId);

                        // --- MODIFIED: START of BUG FIX ---
                        // Added a check for `ConnectionManager.connections` to prevent crash if it's undefined.
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.connections && ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                        // --- MODIFIED: END of BUG FIX ---

                        if (removedContactDetails && removedContactDetails.isAI && typeof GroupManager !== 'undefined' && GroupManager.groups) {
                            for (const groupId in GroupManager.groups) {
                                const group = GroupManager.groups[groupId];

                                if (!group || !Array.isArray(group.members)) {
                                    Utils.log(`[UserManager.clearAllContacts] Skipping malformed or incomplete group data for groupId: ${groupId}`, Utils.logLevels.WARN);
                                    continue;
                                }

                                const memberIndex = group.members.indexOf(contactId);
                                if (memberIndex !== -1) {
                                    group.members.splice(memberIndex, 1);
                                    if (group.aiPrompts && group.aiPrompts[contactId]) {
                                        delete group.aiPrompts[contactId];
                                    }
                                    await GroupManager.saveGroup(groupId);
                                    if (ChatManager.currentChatId === groupId && typeof DetailsPanelUIManager !== 'undefined') {
                                        DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                                    }
                                }
                            }
                        }
                    }

                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        ChatManager.currentChatId = null;
                        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                    }

                    if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter);
                    NotificationUIManager.showNotification("所有非当前主题特殊联系人及手动添加的联系人均已清空。", 'success');
                } catch (error) {
                    Utils.log("清空联系人失败: " + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification("清空联系人时出错。", "error");
                    this.contacts = tempContactsSnapshot;
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

        if (message.isRetracted) { return message.content; }

        if (this.isSpecialContact(message.sender) && senderContact) {
            senderName = senderContact.name;
        } else if (isMyMessage) {
            senderName = "您";
        } else if (senderContact) {
            senderName = senderContact.name;
        } else {
            senderName = "对方";
        }

        switch (message.type) {
            case 'text': preview = `${senderName}: ${message.content}`; break;
            case 'image': preview = `${senderName}: [图片]`; break;
            case 'file':
                if (message.fileType?.startsWith('image/')) preview = `${senderName}: [图片]`;
                else if (message.fileType?.startsWith('video/')) preview = `${senderName}: [视频]`;
                else if (message.fileType?.startsWith('audio/')) preview = `${senderName}: [音频文件]`;
                else preview = `${senderName}: [文件] ${message.fileName || ''}`;
                break;
            case 'audio': preview = `${senderName}: [语音消息]`; break;
            case 'system': return message.content.length > 35 ? message.content.substring(0, 32) + "..." : message.content;
            default: preview = `${senderName}: [新消息]`;
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
        } else {
            this._aiServiceStatusMessage = "服务不可用";
        }
        Utils.log(`UserManager: AI 服务状态更新为: ${this._aiServiceStatusMessage}`, Utils.logLevels.INFO);
        if(typeof EventEmitter !== 'undefined'){
            EventEmitter.emit('aiServiceStatusUpdated', this.isAiServiceHealthy);
        }
    },

    /**
     * @description 获取当前用于 AI 服务状态的显示消息。
     * @returns {string} AI 服务状态的显示文本。
     */
    getAiServiceStatusMessage: function() {
        return `AI 助手 - ${this._aiServiceStatusMessage}`;
    },

    /**
     * 获取指定AI联系人当前选择的关卡篇章ID。
     * @param {string} contactId - AI联系人的ID。
     * @returns {string|null} 当前选择的篇章ID，如果未选择或联系人非AI则返回null。
     */
    getSelectedChapterForAI: function(contactId) {
        const contact = this.contacts[contactId];
        if (contact && contact.isAI) {
            return contact.selectedChapterId || null;
        }
        return null;
    },

    /**
     * 设置AI联系人选择的关卡篇章ID，并持久化。
     * @param {string} contactId - AI联系人的ID。
     * @param {string|null} chapterId - 要设置的篇章ID，或null表示清除选择。
     * @returns {Promise<void>}
     */
    setSelectedChapterForAI: async function(contactId, chapterId) {
        const contact = this.contacts[contactId];
        if (contact && contact.isAI) {
            contact.selectedChapterId = chapterId;
            await this.saveContact(contactId); // 持久化到数据库
            Utils.log(`UserManager: AI ${contactId} 的关卡篇章已设置为: ${chapterId || '默认'}`, Utils.logLevels.INFO);
        } else {
            Utils.log(`UserManager: 尝试为非AI联系人 ${contactId} 设置篇章，已忽略。`, Utils.logLevels.WARN);
        }
    }
};