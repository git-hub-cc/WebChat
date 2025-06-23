/**
 * @file UserManager.js
 * @description 核心用户管理器，负责处理当前用户的信息、设置、所有联系人（包括特殊 AI 联系人）的数据管理。
 *              它与数据库交互以持久化用户和联系人数据。AI联系人在主题切换后会被保留，其配置会根据当前主题定义或历史数据进行更新。
 *              在处理群组添加成员事件时，会确保根据收到的详情正确创建新联系人。
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
 * @dependencies DBManager, Utils, NotificationUIManager, ChatManager, ConnectionManager, ThemeLoader, ModalUIManager, SettingsUIManager, ChatAreaUIManager, EventEmitter, GroupManager
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互以获取用户信息或联系人数据。
 */
const UserManager = {
    userId: null, // 当前用户的唯一 ID
    userName: '我', // 当前用户的显示名称
    contacts: {}, // { contactId: contactObject } 存储所有联系人
    userSettings: { // 用户偏好设置
        autoConnectEnabled: true, // 是否启用自动连接
    },
    isAiServiceHealthy: false, // AI 服务是否健康
    _aiServiceStatusMessage: "状态检查中...", // AI 服务状态的显示文本

    /**
     * 初始化用户管理器。加载或创建当前用户数据，并加载所有联系人。
     * @returns {Promise<void>}
     */
    async init() {
        try {
            await DBManager.init(); // 确保数据库已初始化
            let userData = await DBManager.getItem('user', 'currentUser'); // 从数据库加载用户数据
            if (userData && userData.userId) { // 如果用户数据存在
                this.userId = userData.userId;
                this.userName = userData.userName || `用户 ${this.userId.substring(0,4)}`; // 使用保存的或生成默认名称
                this.userSettings.autoConnectEnabled = typeof userData.autoConnectEnabled === 'boolean' ? userData.autoConnectEnabled : false;
            } else { // 如果用户数据不存在，则创建新用户
                this.userId = Utils.generateId(8); // 生成随机ID
                this.userName = `用户 ${this.userId.substring(0,4)}`;
                userData = {
                    id: 'currentUser', // 数据库中的键
                    userId: this.userId,
                    userName: this.userName,
                    autoConnectEnabled: this.userSettings.autoConnectEnabled
                };
                await DBManager.setItem('user', userData); // 保存到数据库
            }

            this.contacts = {}; // 初始化联系人列表

            let dbStoredContacts = []; // 用于存储从数据库加载的联系人
            try {
                dbStoredContacts = await DBManager.getAllItems('contacts');
                if (dbStoredContacts && dbStoredContacts.length > 0) {
                    for (const dbContact of dbStoredContacts) {
                        // 确保每个联系人都有 aiConfig 和 tts 子对象，并设置默认值
                        if (!dbContact.aiConfig) dbContact.aiConfig = {};
                        if (!dbContact.aiConfig.tts) dbContact.aiConfig.tts = {};
                        if (dbContact.aiConfig.tts.tts_mode === undefined) dbContact.aiConfig.tts.tts_mode = 'Preset';
                        if (dbContact.aiConfig.tts.version === undefined) dbContact.aiConfig.tts.version = 'v4';
                        this.contacts[dbContact.id] = dbContact; // 添加到内存
                    }
                }
            } catch (error) {
                Utils.log(`UserManager.init: 从 DB 加载联系人失败: ${error}`, Utils.logLevels.ERROR);
            }

            // 获取当前主题的特殊联系人定义
            const currentThemeSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];

            // 确保特殊联系人存在并已正确配置
            await this.ensureSpecialContacts(currentThemeSpecialDefs, false);

            // 监听主题变更事件
            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.on('themeChanged', this.handleThemeChange.bind(this));
            } else {
                console.warn("UserManager.init: EventEmitter 未定义。无法监听 themeChanged 事件。");
            }

        } catch (error) { // 初始化失败时的回退处理
            Utils.log(`用户初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8); // 生成临时ID
            this.userName = `用户 ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false; // 禁用自动连接
            this.contacts = {}; // 清空联系人
            // 尝试使用回退的特殊联系人定义
            const fallbackDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];
            await this.ensureSpecialContacts(fallbackDefinitions, true); // true 表示回退模式
        }

        // 更新UI显示的用户ID
        const modalUserIdValueEl = document.getElementById('modalUserIdValue');
        if (modalUserIdValueEl) modalUserIdValueEl.textContent = this.userId;
        if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCopyIdButtonState) {
            SettingsUIManager.updateCopyIdButtonState(); // 更新复制ID按钮状态
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
        const newDefinitions = eventData.newDefinitions || []; // 获取新的特殊联系人定义

        await this.ensureSpecialContacts(newDefinitions, false); // 更新特殊联系人

        // 刷新聊天列表和当前聊天（如果需要）
        if (typeof ChatManager !== 'undefined') {
            ChatManager.renderChatList(ChatManager.currentFilter);
            if (ChatManager.currentChatId && this.contacts[ChatManager.currentChatId]) {
                const contact = this.contacts[ChatManager.currentChatId];
                const type = contact.type || 'contact'; // 默认为联系人类型
                ChatManager.openChat(ChatManager.currentChatId, type); // 重新打开当前聊天以更新UI
            }

            // 如果当前是群聊且详情面板可见，刷新群成员添加列表（因为AI联系人可能已变）
            if (ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_') &&
                typeof DetailsPanelUIManager !== 'undefined' && DetailsPanelUIManager.isPanelAreaVisible &&
                DetailsPanelUIManager.currentView === 'details') {
                Utils.log(`UserManager.handleThemeChange: 主题已更改，当前为群组 ${ChatManager.currentChatId} 且详情面板可见，正在刷新成员列表。`, Utils.logLevels.DEBUG);
                DetailsPanelUIManager.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        }

        // 显示主题切换通知
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
        // 获取当前主题的定义
        const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
            ? ThemeLoader.getCurrentSpecialContactsDefinitions()
            : [];
        // 检查ID是否存在于定义中
        return currentDefinitions.some(sc => sc.id === contactId);
    },

    /**
     * 确保所有在提供的 `definitions` 中定义的特殊联系人都存在于 `this.contacts` 中，
     * 并合并来自数据库和 localStorage 的持久化数据。
     * 同时，处理那些在 `this.contacts` 中存在但不在新定义中的旧特殊联系人。
     * @param {Array<object>} newThemeDefinitions - 新主题的特殊联系人定义数组。
     * @param {boolean} [isFallbackMode=false] - 是否处于回退模式（不访问数据库）。
     * @returns {Promise<void>}
     */
    async ensureSpecialContacts(newThemeDefinitions, isFallbackMode = false) {
        if (!newThemeDefinitions || !Array.isArray(newThemeDefinitions)) {
            Utils.log("UserManager.ensureSpecialContacts: 收到无效或空定义。正在中止。", Utils.logLevels.WARN);
            return;
        }

        const processedContactIds = new Set(); // 用于记录已处理的联系人ID

        // 遍历新主题的特殊联系人定义
        for (const scDef of newThemeDefinitions) {
            processedContactIds.add(scDef.id); // 标记为已处理
            let existingContact = this.contacts[scDef.id]; // 获取内存中已存在的联系人
            let dbContact = null; // 用于存储数据库中的联系人数据
            if (!isFallbackMode) { // 如果不是回退模式，则尝试从数据库加载
                try { dbContact = await DBManager.getItem('contacts', scDef.id); }
                catch (dbError) { Utils.log(`ensureSpecialContacts: 获取DB联系人 ${scDef.id} 失败: ${dbError}`, Utils.logLevels.ERROR); }
            }

            // 从主题定义构建基础数据
            const baseDataFromDef = {
                id: scDef.id, name: scDef.name,
                isSpecial: true, // 标记为特殊联系人
                avatarText: scDef.avatarText, avatarUrl: scDef.avatarUrl || null,
                type: 'contact', isAI: scDef.isAI || false, // 是否为AI
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || { tts: {} })), // AI配置，深拷贝
                aboutDetails: scDef.aboutDetails ? JSON.parse(JSON.stringify(scDef.aboutDetails)) : null, // "关于"信息
            };
            // 确保TTS配置存在且有默认值
            if (!baseDataFromDef.aiConfig.tts) baseDataFromDef.aiConfig.tts = {};
            if (baseDataFromDef.aiConfig.tts.tts_mode === undefined) baseDataFromDef.aiConfig.tts.tts_mode = 'Preset';
            if (baseDataFromDef.aiConfig.tts.version === undefined) baseDataFromDef.aiConfig.tts.version = 'v4';

            if (existingContact) { // 如果联系人已存在于内存
                // 更新其属性以匹配新主题定义
                existingContact.isSpecial = true;
                existingContact.isAI = baseDataFromDef.isAI;
                existingContact.name = baseDataFromDef.name;
                existingContact.avatarText = baseDataFromDef.avatarText;
                existingContact.avatarUrl = baseDataFromDef.avatarUrl;
                existingContact.aboutDetails = baseDataFromDef.aboutDetails;

                // 合并AI配置 (优先顺序：现有内存 > 数据库 > 主题定义)
                const mergedAiConfig = { ...(baseDataFromDef.aiConfig || {tts: {}}) };
                if (existingContact.aiConfig) {
                    Object.assign(mergedAiConfig, existingContact.aiConfig);
                    if (existingContact.aiConfig.tts) {
                        Object.assign(mergedAiConfig.tts, existingContact.aiConfig.tts);
                    }
                }
                if (dbContact && dbContact.aiConfig && baseDataFromDef.isAI) { // 如果数据库中有AI配置
                    Object.assign(mergedAiConfig, dbContact.aiConfig);
                    if (dbContact.aiConfig.tts) {
                        Object.assign(mergedAiConfig.tts, dbContact.aiConfig.tts);
                    }
                }
                existingContact.aiConfig = mergedAiConfig;

                // 更新最后消息和时间 (优先顺序：数据库 > 现有内存 > 主题定义)
                existingContact.lastMessage = (dbContact && dbContact.lastMessage !== undefined) ? dbContact.lastMessage : (existingContact.lastMessage !== undefined ? existingContact.lastMessage : (scDef.initialMessage || '你好！'));
                existingContact.lastTime = (dbContact && dbContact.lastTime) ? dbContact.lastTime : (existingContact.lastTime || new Date().toISOString());
                existingContact.unread = (dbContact && dbContact.unread !== undefined) ? dbContact.unread : (existingContact.unread || 0);

            } else { // 如果联系人不存在于内存，则创建新的
                this.contacts[scDef.id] = { ...baseDataFromDef };
                existingContact = this.contacts[scDef.id];

                if (dbContact) { // 如果数据库中有此联系人的数据，则合并
                    existingContact.name = dbContact.name || existingContact.name;
                    existingContact.lastMessage = dbContact.lastMessage !== undefined ? dbContact.lastMessage : (scDef.initialMessage || '你好！');
                    existingContact.lastTime = dbContact.lastTime || new Date().toISOString();
                    existingContact.unread = dbContact.unread !== undefined ? dbContact.unread : 0;
                    existingContact.avatarUrl = dbContact.avatarUrl !== undefined ? dbContact.avatarUrl : existingContact.avatarUrl;
                    if (dbContact.aiConfig && existingContact.isAI) { // 合并AI配置
                        Object.assign(existingContact.aiConfig, dbContact.aiConfig);
                        if(dbContact.aiConfig.tts) Object.assign(existingContact.aiConfig.tts, dbContact.aiConfig.tts);
                    }
                } else { // 否则使用主题定义的初始消息
                    existingContact.lastMessage = scDef.initialMessage || '你好！';
                    existingContact.lastTime = new Date().toISOString();
                    existingContact.unread = 0;
                }
            }

            // 从 localStorage 加载并合并特定于此联系人的 TTS 设置（如果存在）
            if (existingContact.isAI) {
                const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${scDef.id}`);
                if (storedTtsSettingsJson) {
                    try {
                        const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                        Object.assign(existingContact.aiConfig.tts, storedTtsSettings);
                    } catch (e) { Utils.log(`从localStorage解析TTS配置(${scDef.id})失败: ${e}`, Utils.logLevels.WARN); }
                }
            }
            // 再次确保TTS配置结构完整
            if (!existingContact.aiConfig) existingContact.aiConfig = {};
            if (!existingContact.aiConfig.tts) existingContact.aiConfig.tts = {};
            if (existingContact.aiConfig.tts.tts_mode === undefined) existingContact.aiConfig.tts.tts_mode = 'Preset';
            if (existingContact.aiConfig.tts.version === undefined) existingContact.aiConfig.tts.version = 'v4';

            // 如果不是回退模式，则保存到数据库
            if (!isFallbackMode) {
                await this.saveContact(scDef.id);
            }
        }

        // 处理那些在内存中存在但不在新主题定义中的旧特殊联系人
        for (const contactId in this.contacts) {
            if (!processedContactIds.has(contactId)) { // 如果未在新定义中处理过
                const contact = this.contacts[contactId];
                if (contact.isSpecial) { // 如果它之前是特殊联系人
                    contact.isSpecial = false; // 标记为非特殊
                    Utils.log(`ensureSpecialContacts: 联系人 ${contactId} ('${contact.name}') isSpecial设为false。AI状态: ${contact.isAI}`, Utils.logLevels.DEBUG);
                    if (!isFallbackMode) { // 保存更改
                        await this.saveContact(contactId);
                    }
                }
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
        if (this.userSettings.hasOwnProperty(settingKey)) { // 检查设置键是否存在
            this.userSettings[settingKey] = value; // 更新内存中的设置
            Utils.log(`用户设置已更新: ${settingKey} = ${value}`, Utils.logLevels.INFO);
            try {
                // 获取或创建用户数据对象
                const userData = await DBManager.getItem('user', 'currentUser') ||
                    { id: 'currentUser', userId: this.userId, userName: this.userName };
                const updatedUserData = { ...userData, ...this.userSettings }; // 合并设置
                await DBManager.setItem('user', updatedUserData); // 保存到数据库
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
        if (this.contacts[contactId]) { // 确保联系人存在于内存
            try {
                const contactToSave = { ...this.contacts[contactId] }; // 创建副本
                // 确保AI配置和TTS配置结构完整
                if (!contactToSave.aiConfig) contactToSave.aiConfig = {};
                if (!contactToSave.aiConfig.tts) contactToSave.aiConfig.tts = {};
                if (contactToSave.aiConfig.tts.tts_mode === undefined) contactToSave.aiConfig.tts.tts_mode = 'Preset';
                if (contactToSave.aiConfig.tts.version === undefined) contactToSave.aiConfig.tts.version = 'v4';
                await DBManager.setItem('contacts', contactToSave); // 保存到数据库
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
            ChatManager.currentFilter = 'contacts'; // 设置当前过滤器
            SidebarUIManager.setActiveTab('contacts'); // 更新侧边栏标签状态
            ChatManager.renderChatList('contacts'); // 调用ChatManager渲染列表
        }
    },

    /**
     * 添加一个新联系人，或根据提供的数据创建联系人（用于从群消息中添加）。
     * @param {string|object} idOrData - 新联系人的 ID (string)，或包含联系人完整数据的对象 (object)。
     * @param {string} [name] - 新联系人的名称 (如果 idOrData 是 string)。
     * @param {boolean} [establishConnection=true] - 是否在添加后尝试建立连接 (仅当 idOrData 是 string 时有效)。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    addContact: async function(idOrData, name, establishConnection = true) {
        let id, contactData, isFromGroupMessage = false;

        if (typeof idOrData === 'object' && idOrData !== null) {
            // 处理从群消息传递过来的联系人数据对象
            id = idOrData.id;
            contactData = idOrData;
            isFromGroupMessage = true;
            establishConnection = false; // 从群消息创建时不主动建连，由群逻辑处理
            Utils.log(`UserManager.addContact: 正在尝试根据群组消息详情添加联系人 ${id}`, Utils.logLevels.DEBUG);
        } else if (typeof idOrData === 'string') {
            // 处理手动或通过其他方式添加的联系人ID
            id = idOrData;
        } else {
            NotificationUIManager.showNotification("添加联系人失败：无效的参数。", "error");
            return false;
        }

        if (!id) {
            NotificationUIManager.showNotification("添加联系人失败：ID无效。", "error");
            return false;
        }

        if (id === this.userId) { // 不能添加自己
            NotificationUIManager.showNotification("您不能添加自己为联系人。", "error");
            return false;
        }

        // 检查是否为当前主题的特殊联系人
        if (this.isSpecialContactInCurrentTheme(id)) {
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            // 只有当不是从群消息创建时才显示通知 (避免重复)
            if (!isFromGroupMessage) NotificationUIManager.showNotification(`${specialContactName} 是内置联系人，不能手动添加。`, "warning");

            // 如果是特殊联系人且未连接，尝试连接 (仅当非群消息创建且需要建连时)
            if (!isFromGroupMessage && establishConnection && this.contacts[id] && !this.contacts[id].isAI && !ConnectionManager.isConnectedTo(id)) {
                ConnectionManager.createOffer(id, { isSilent: true });
            }
            return true;
        }

        if (this.contacts[id]) { // 如果联系人已存在
            // 只有当不是从群消息创建时才显示通知
            if (!isFromGroupMessage) NotificationUIManager.showNotification("该联系人已在您的列表中。", "info");
            let contactChanged = false;

            if (isFromGroupMessage && contactData) { // 如果是从群消息传递数据，则尝试更新现有联系人信息
                if (contactData.name && this.contacts[id].name !== contactData.name) { this.contacts[id].name = contactData.name; contactChanged = true; }
                if (contactData.avatarText && this.contacts[id].avatarText !== contactData.avatarText) { this.contacts[id].avatarText = contactData.avatarText; contactChanged = true; }
                if (contactData.avatarUrl !== undefined && this.contacts[id].avatarUrl !== contactData.avatarUrl) { this.contacts[id].avatarUrl = contactData.avatarUrl; contactChanged = true; }
                // AI 配置的合并需要更细致，这里仅作示例，可能需要深拷贝和逐字段比较
                if (contactData.isAI !== undefined && this.contacts[id].isAI !== contactData.isAI) { this.contacts[id].isAI = contactData.isAI; contactChanged = true; }
                if (contactData.aiConfig) { // 简单合并，确保 aiConfig 和 tts 结构
                    if (!this.contacts[id].aiConfig) this.contacts[id].aiConfig = {};
                    Object.assign(this.contacts[id].aiConfig, contactData.aiConfig);
                    if (contactData.aiConfig.tts) {
                        if (!this.contacts[id].aiConfig.tts) this.contacts[id].aiConfig.tts = {};
                        Object.assign(this.contacts[id].aiConfig.tts, contactData.aiConfig.tts);
                    }
                    contactChanged = true;
                }
            } else if (name && this.contacts[id].name !== name) { // 手动添加时，如果名称有变化则更新
                this.contacts[id].name = name;
                contactChanged = true;
            }

            if (this.contacts[id].isSpecial) { // 如果之前是特殊联系人，现在手动添加则变为普通
                this.contacts[id].isSpecial = false;
                contactChanged = true;
            }
            if(contactChanged) await this.saveContact(id);
            if (typeof ChatManager !== 'undefined' && !isFromGroupMessage) ChatManager.renderChatList(ChatManager.currentFilter);

            // 如果未连接，尝试连接 (仅当非群消息创建且需要建连时)
            if (!isFromGroupMessage && establishConnection && !this.contacts[id].isAI && !ConnectionManager.isConnectedTo(id)) {
                ConnectionManager.createOffer(id, { isSilent: true });
            }
            return true;
        }

        // 创建新联系人对象
        const newContact = {
            id: id,
            name: isFromGroupMessage ? (contactData.name || `用户 ${id.substring(0, 4)}`) : (name || `用户 ${id.substring(0, 4)}`),
            lastMessage: '',
            lastTime: new Date().toISOString(),
            unread: 0,
            isSpecial: false, // 新手动添加的非特殊
            avatarText: isFromGroupMessage
                ? (contactData.avatarText || (contactData.name ? contactData.name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase()))
                : (name ? name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase()),
            avatarUrl: isFromGroupMessage ? (contactData.avatarUrl || null) : null,
            type: 'contact',
            isAI: isFromGroupMessage ? (contactData.isAI || false) : false,
            aiConfig: isFromGroupMessage ? (contactData.aiConfig || { tts: { tts_mode: 'Preset', version: 'v4' } }) : { tts: { tts_mode: 'Preset', version: 'v4' } },
            aboutDetails: isFromGroupMessage ? (contactData.aboutDetails || null) : null
        };
        // 确保 aiConfig 和 tts 结构完整
        if (!newContact.aiConfig) newContact.aiConfig = {};
        if (!newContact.aiConfig.tts) newContact.aiConfig.tts = {};
        if (newContact.aiConfig.tts.tts_mode === undefined) newContact.aiConfig.tts.tts_mode = 'Preset';
        if (newContact.aiConfig.tts.version === undefined) newContact.aiConfig.tts.version = 'v4';

        this.contacts[id] = newContact;
        await this.saveContact(id);

        if (typeof ChatManager !== 'undefined' && !isFromGroupMessage) ChatManager.renderChatList(ChatManager.currentFilter);
        if (!isFromGroupMessage) NotificationUIManager.showNotification(`联系人 "${newContact.name}" 已添加。`, 'success');

        // 如果当前在群组详情页且是群主，则刷新成员添加列表 (仅当非群消息创建时)
        if (!isFromGroupMessage && typeof DetailsPanelUIManager !== 'undefined' &&
            DetailsPanelUIManager.currentView === 'details' &&
            ChatManager.currentChatId && ChatManager.currentChatId.startsWith('group_')) {
            const currentGroup = GroupManager.groups[ChatManager.currentChatId];
            if (currentGroup && currentGroup.owner === this.userId) {
                DetailsPanelUIManager.updateDetailsPanelMembers(ChatManager.currentChatId);
            }
        }

        if (!isFromGroupMessage && establishConnection) { // 如果需要建立连接
            ConnectionManager.createOffer(id, { isSilent: true });
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
        if (this.isSpecialContactInCurrentTheme(id)) { // 检查是否为当前主题特殊联系人
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationUIManager.showNotification(`${specialContactName} 是当前主题的内置联系人，不能被移除。`, "warning");
            return false;
        }
        if (this.contacts[id]) { // 如果联系人存在
            const tempContact = this.contacts[id]; // 备份联系人信息，以防操作失败
            delete this.contacts[id]; // 从内存中删除
            try {
                await DBManager.removeItem('contacts', id); // 从数据库删除
                localStorage.removeItem(`ttsConfig_${id}`); // 移除相关的TTS配置缓存
                // 如果被移除的是AI，则处理其在群组中的关联
                if (tempContact.isAI && typeof GroupManager !== 'undefined' && GroupManager.groups) {
                    for (const groupId in GroupManager.groups) {
                        const group = GroupManager.groups[groupId];
                        const memberIndex = group.members.indexOf(id);
                        if (memberIndex !== -1) { // 如果AI是群成员
                            group.members.splice(memberIndex, 1); // 从群成员中移除
                            if (group.aiPrompts && group.aiPrompts[id]) { // 移除群内特定提示词
                                delete group.aiPrompts[id];
                            }
                            await GroupManager.saveGroup(groupId); // 保存群组更改
                            // 如果当前打开的是此群组，则刷新详情面板
                            if (ChatManager.currentChatId === groupId && typeof DetailsPanelUIManager !== 'undefined') {
                                DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                            }
                        }
                    }
                }
                if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter); // 刷新列表
                NotificationUIManager.showNotification(`联系人 "${tempContact.name}" 已删除。`, 'success');
                return true;
            } catch (error) { // 数据库操作失败
                Utils.log(`从数据库移除联系人 ${id} 失败: ${error}`, Utils.logLevels.ERROR);
                this.contacts[id] = tempContact; // 恢复内存中的联系人
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
        if (contact) { // 如果联系人存在
            // 截断过长的预览文本
            contact.lastMessage = messageText.length > 30 ? messageText.substring(0, 27) + "..." : messageText;
            contact.lastTime = new Date().toISOString(); // 更新最后活动时间
            if (forceNoUnread) { // 如果强制清零未读
                contact.unread = 0;
            } else if (incrementUnread && (ChatManager.currentChatId !== id || !document.hasFocus())) {
                // 如果需要增加未读，且当前聊天不是此联系人或页面无焦点
                contact.unread = (contact.unread || 0) + 1;
            }
            await this.saveContact(id); // 保存更改
            if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter); // 刷新列表
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
        if (contact && contact.unread > 0) { // 如果有未读消息
            contact.unread = 0; // 清零
            await this.saveContact(id); // 保存
            if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter); // 刷新列表
        }
    },

    /**
     * 清空所有非当前主题特殊联系人。
     * @returns {Promise<void>}
     */
    async clearAllContacts() {
        ModalUIManager.showConfirmationModal( // 显示确认对话框
            "您确定要删除所有非当前主题的特殊联系人以及所有您手动添加的联系人吗？这也会清空他们的聊天记录和群组关联。当前主题的内置特殊联系人将保留。",
            async () => { // 确认回调
                const tempContactsSnapshot = { ...this.contacts }; // 创建联系人快照以备回滚
                const contactIdsToRemove = []; // 存储要移除的联系人ID
                const contactsToKeep = {}; // 存储要保留的联系人（当前主题特殊联系人）

                // 获取当前主题特殊联系人定义
                const currentSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                    ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];

                // 保留当前主题的特殊联系人
                currentSpecialDefs.forEach(def => {
                    if (tempContactsSnapshot[def.id]) {
                        contactsToKeep[def.id] = tempContactsSnapshot[def.id];
                    }
                });

                // 确定要移除的联系人ID
                Object.keys(tempContactsSnapshot).forEach(id => {
                    if (!contactsToKeep[id]) { // 如果不在保留列表中，则添加到移除列表
                        contactIdsToRemove.push(id);
                    }
                });

                this.contacts = contactsToKeep; // 更新内存中的联系人列表

                try {
                    // 遍历并处理要移除的联系人
                    for (const contactId of contactIdsToRemove) {
                        const removedContactDetails = tempContactsSnapshot[contactId]; // 获取被移除联系人的详情
                        await DBManager.removeItem('contacts', contactId); // 从数据库移除
                        localStorage.removeItem(`ttsConfig_${contactId}`); // 移除TTS配置缓存
                        if (typeof ChatManager !== 'undefined') await ChatManager.clearChat(contactId); // 清空聊天记录
                        // 如果有活动连接，则关闭
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                        // 如果是AI且在群组中，则处理群组关联
                        if (removedContactDetails && removedContactDetails.isAI && typeof GroupManager !== 'undefined' && GroupManager.groups) {
                            for (const groupId in GroupManager.groups) {
                                const group = GroupManager.groups[groupId];
                                const memberIndex = group.members.indexOf(contactId);
                                if (memberIndex !== -1) { // 如果是群成员
                                    group.members.splice(memberIndex, 1); // 移除
                                    if (group.aiPrompts && group.aiPrompts[contactId]) { // 移除特定提示词
                                        delete group.aiPrompts[contactId];
                                    }
                                    await GroupManager.saveGroup(groupId); // 保存群组更改
                                    // 如果当前打开的是此群组，则刷新详情面板
                                    if (ChatManager.currentChatId === groupId && typeof DetailsPanelUIManager !== 'undefined') {
                                        DetailsPanelUIManager.updateDetailsPanelMembers(groupId);
                                    }
                                }
                            }
                        }
                    }

                    // 如果当前聊天是被移除的联系人，则重置聊天区域
                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        ChatManager.currentChatId = null;
                        if (typeof ChatAreaUIManager !== 'undefined') ChatAreaUIManager.showNoChatSelected();
                    }

                    if (typeof ChatManager !== 'undefined') ChatManager.renderChatList(ChatManager.currentFilter); // 刷新列表
                    NotificationUIManager.showNotification("所有非当前主题特殊联系人及手动添加的联系人均已清空。", 'success');
                } catch (error) { // 操作失败
                    Utils.log("清空联系人失败: " + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification("清空联系人时出错。", 'error');
                    this.contacts = tempContactsSnapshot; // 恢复联系人快照
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
        const isMyMessage = message.sender === UserManager.userId || message.originalSender === UserManager.userId; // 是否为自己发送
        let senderContact = this.contacts[message.sender]; // 获取发送者联系人信息
        let senderName;

        if (message.isRetracted) { return message.content; } // 如果已撤回，直接返回撤回提示

        // 确定发送者显示名称
        if (this.isSpecialContact(message.sender) && senderContact) { // 如果是特殊联系人
            senderName = senderContact.name;
        } else if (isMyMessage) { // 如果是自己
            senderName = "您";
        } else if (senderContact) { // 其他联系人
            senderName = senderContact.name;
        } else { // 未知发送者
            senderName = "对方";
        }

        // 根据消息类型格式化预览
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
            case 'system': return message.content.length > 35 ? message.content.substring(0, 32) + "..." : message.content; // 系统消息直接显示内容（截断）
            default: preview = `${senderName}: [新消息]`;
        }
        // 截断过长的预览
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    },

    /**
     * @description 更新全局 AI 服务健康状态和显示消息。
     * @param {boolean} isHealthy - AI 服务的最新健康状态。
     */
    updateAiServiceStatus: function(isHealthy) {
        this.isAiServiceHealthy = isHealthy; // 更新健康状态
        if (isHealthy) {
            this._aiServiceStatusMessage = "服务可用";
        } else {
            this._aiServiceStatusMessage = "服务不可用";
        }
        Utils.log(`UserManager: AI 服务状态更新为: ${this._aiServiceStatusMessage}`, Utils.logLevels.INFO);
        // 触发事件，通知其他模块状态已更新
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
    }
};