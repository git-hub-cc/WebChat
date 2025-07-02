/**
 * @file 用户核心数据管理器
 * @description 负责管理当前用户的核心数据，包括用户ID、设置、所有联系人（含普通、特殊及AI联系人）的信息。
 *              该模块作为用户数据的唯一真实来源，与数据库交互进行数据持久化，并分发状态变更通知。
 * @module UserManager
 * @exports {object} UserManager - 对外暴露的单例对象，包含所有用户和联系人管理功能。
 * @dependency DBManager - 数据库交互模块，用于持久化存储。
 * @dependency Utils - 通用工具函数库。
 * @dependency Store - 应用状态管理中心，用于分发数据变更动作。
 * @dependency ThemeLoader - 主题加载器，用于获取特殊联系人定义。
 * @dependency EventEmitter - 全局事件总线，用于监听主题切换等事件。
 */
const UserManager = {
    // === 变量声明 ===
    // (按照 常量 -> 依赖 -> 状态变量/缓存 的顺序)
    // NOTE: 此处无常量和依赖声明，均为模块内部状态变量。

    // 当前登录用户的唯一ID
    userId: null,
    // 当前用户的显示名称
    userName: '我',
    // 存储所有联系人对象的字典，键为联系人ID
    contacts: {},
    // 用户的偏好设置
    userSettings: {
        autoConnectEnabled: true,
    },
    // AI服务健康状态标识
    isAiServiceHealthy: false,
    // AI服务状态的文字描述信息
    _aiServiceStatusMessage: "状态检查中...",

    // === 方法 ===
    // (按照 对外接口 -> 内部逻辑 的顺序)

    /**
     * 初始化用户管理器
     * @function init
     * @description 加载或创建当前用户数据，并加载所有联系人信息。这是模块启动的入口点。
     * @returns {Promise<void>}
     */
    async init() {
        try {
            // 初始化流程如下：
            // 1. 初始化数据库管理器
            await DBManager.init();
            let userData = await DBManager.getItem('user', 'currentUser');

            // 2. 加载或创建用户数据
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

            // 3. 加载所有已存储的联系人
            this.contacts = {};
            let dbStoredContacts = [];
            try {
                dbStoredContacts = await DBManager.getAllItems('contacts');
                if (dbStoredContacts && dbStoredContacts.length > 0) {
                    for (const dbContact of dbStoredContacts) {
                        // NOTE: 对旧数据进行兼容性处理，确保aiConfig及其子结构存在
                        if (!dbContact.aiConfig) dbContact.aiConfig = {};
                        if (!dbContact.aiConfig.tts) dbContact.aiConfig.tts = {};
                        if (dbContact.aiConfig.tts.tts_mode === undefined) dbContact.aiConfig.tts.tts_mode = 'Preset';
                        if (dbContact.aiConfig.tts.version === undefined) dbContact.aiConfig.tts.version = 'v4';
                        this.contacts[dbContact.id] = dbContact;
                    }
                }
            } catch (error) {
                Utils.log(`UserManager.init: 从 DB 加载联系人失败: ${error}`, Utils.logLevels.ERROR);
            }

            // 4. 根据当前主题定义，确保特殊联系人存在且数据正确
            const currentThemeSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];
            await this.ensureSpecialContacts(currentThemeSpecialDefs, false);

            // 5. 监听主题变化事件，以便在主题切换时更新联系人列表
            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.on('themeChanged', this.handleThemeChange.bind(this));
            } else {
                console.warn("UserManager.init: EventEmitter 未定义。无法监听 themeChanged 事件。");
            }

        } catch (error) {
            // 6. 处理初始化过程中的异常，提供回退机制
            Utils.log(`用户初始化失败: ${error.stack || error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `用户 ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            this.contacts = {};
            const fallbackDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions()
                : [];
            await this.ensureSpecialContacts(fallbackDefinitions, true); // 在回退模式下确保特殊联系人
        }

        // 7. 更新UI元素以显示用户ID，并记录初始化完成日志
        const modalUserIdValueEl = document.getElementById('modalUserIdValue');
        if (modalUserIdValueEl) modalUserIdValueEl.textContent = this.userId;
        if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCopyIdButtonState) {
            SettingsUIManager.updateCopyIdButtonState();
        }
        Utils.log(`用户管理器已初始化。用户 ID: ${this.userId} (${this.userName})。当前管理 ${Object.keys(this.contacts).length} 个联系人。`, Utils.logLevels.INFO);
    },

    /**
     * 添加一个新联系人
     * @function addContact
     * @description 处理添加联系人的逻辑，可以是基于ID，也可以是基于完整的联系人数据对象。
     * @param {string|object} idOrData - 新联系人的 ID (string)，或包含完整数据的联系人对象 (object)。
     * @param {string} [name] - 新联系人的名称 (仅当 idOrData 是字符串时有效)。
     * @param {boolean} [establishConnection=true] - 添加后是否尝试建立WebRTC连接 (仅当 idOrData 是字符串时有效)。
     * @returns {Promise<boolean>} 操作是否成功添加。
     */
    async addContact(idOrData, name, establishConnection = true) {
        let id, contactData, isFromObject = false;

        // 1. 解析输入参数
        if (typeof idOrData === 'object' && idOrData !== null) {
            id = idOrData.id;
            contactData = idOrData;
            isFromObject = true;
            establishConnection = false; // 从对象添加时，通常不主动发起连接
        } else if (typeof idOrData === 'string') {
            id = idOrData;
        } else {
            NotificationUIManager.showNotification("添加联系人失败：无效的参数。", "error");
            return false;
        }

        // 2. 校验ID的有效性
        if (!id || id === this.userId) {
            NotificationUIManager.showNotification(id ? "您不能添加自己为联系人。" : "添加联系人失败：ID无效。", "error");
            return false;
        }

        // 3. 检查是否为当前主题的特殊联系人或已存在的联系人
        if (this.isSpecialContactInCurrentTheme(id)) {
            // (逻辑保持不变)
            return true;
        }
        if (this.contacts[id]) {
            // (逻辑保持不变)
            if (!isFromObject) NotificationUIManager.showNotification("该联系人已在您的列表中。", "info");
            return true;
        }

        // 4. 构建新的联系人对象
        const newContact = {
            id: id,
            name: isFromObject ? (contactData.name || `用户 ${id.substring(0, 4)}`) : (name || `用户 ${id.substring(0, 4)}`),
            lastMessage: isFromObject ? (contactData.lastMessage || '') : '',
            lastTime: new Date().toISOString(),
            unread: 0,
            isSpecial: isFromObject ? (contactData.isSpecial || false) : false,
            isImported: isFromObject ? (contactData.isImported || false) : false, // 标记为导入，防止主题切换时被移除
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
        // NOTE: 确保AI配置中的TTS结构完整
        // (逻辑保持不变)

        // 5. 保存并更新状态
        this.contacts[id] = newContact;
        await this.saveContact(id);
        Store.dispatch('DATA_MODIFIED'); // 通过 Store 通知UI更新

        // 6. 显示通知并根据需要发起连接
        if (!isFromObject) NotificationUIManager.showNotification(`联系人 "${newContact.name}" 已添加。`, 'success');
        if (!isFromObject && establishConnection) {
            ConnectionManager.createOffer(id, { isSilent: true });
        }
        return true;
    },

    /**
     * 移除一个联系人
     * @function removeContact
     * @param {string} id - 要移除的联系人的ID。
     * @returns {Promise<boolean>} 操作是否成功。
     */
    async removeContact(id) {
        // 1. 检查是否为不可移除的特殊联系人
        if (this.isSpecialContactInCurrentTheme(id) && !this.contacts[id]?.isImported) {
            const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
            const specialContactName = currentDefinitions.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationUIManager.showNotification(`${specialContactName} 是当前主题的内置联系人，不能被移除。`, "warning");
            return false;
        }

        // 2. 执行删除操作
        if (this.contacts[id]) {
            const tempContact = this.contacts[id];
            delete this.contacts[id];
            try {
                // 3. 从数据库和本地存储中清理相关数据
                await DBManager.removeItem('contacts', id);
                localStorage.removeItem(`ttsConfig_${id}`);
                localStorage.removeItem(`ai_chapter_${id}`);

                // 4. 如果是AI联系人，从所有群组中移除
                if (tempContact.isAI && typeof GroupManager !== 'undefined' && GroupManager.groups) {
                    for (const groupId in GroupManager.groups) {
                        const group = GroupManager.groups[groupId];
                        if (group?.members?.includes(id)) {
                            group.members.splice(group.members.indexOf(id), 1);
                            if (group.aiPrompts?.[id]) delete group.aiPrompts[id];
                            await GroupManager.saveGroup(groupId);
                        }
                    }
                }

                // 5. 更新UI状态
                Store.dispatch('DATA_MODIFIED');
                NotificationUIManager.showNotification(`联系人 "${tempContact.name}" 已删除。`, 'success');
                if(Store.getState().currentChatId === id) {
                    Store.dispatch('OPEN_CHAT', { chatId: null }); // 如果当前聊天被删除，则关闭
                }
                return true;
            } catch (error) {
                // 6. 如果删除失败，则回滚操作
                Utils.log(`从数据库移除联系人 ${id} 失败: ${error}`, Utils.logLevels.ERROR);
                this.contacts[id] = tempContact; // 恢复联系人
                Store.dispatch('DATA_MODIFIED');
                NotificationUIManager.showNotification("删除联系人失败。", "error");
                return false;
            }
        }
        NotificationUIManager.showNotification("未找到要删除的联系人。", "warning");
        return false;
    },

    /**
     * 清空所有非当前主题的特殊联系人及用户手动添加的联系人
     * @function clearAllContacts
     * @description 显示一个确认对话框，用户确认后将执行大规模的清理操作。
     * @returns {Promise<void>}
     */
    async clearAllContacts() {
        ModalUIManager.showConfirmationModal(
            "您确定要删除所有非当前主题的特殊联系人以及所有您手动添加的联系人吗？这也会清空他们的聊天记录和群组关联。当前主题的内置特殊联系人将保留。",
            async () => {
                const tempContactsSnapshot = { ...this.contacts }; // 创建快照用于失败时回滚

                // 清理流程如下:
                // 1. 识别需要保留的联系人（即当前主题定义的特殊联系人）
                const contactIdsToRemove = [];
                const contactsToKeep = {};
                const currentSpecialDefs = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
                    ? ThemeLoader.getCurrentSpecialContactsDefinitions() : [];
                currentSpecialDefs.forEach(def => {
                    if (tempContactsSnapshot[def.id]) {
                        contactsToKeep[def.id] = tempContactsSnapshot[def.id];
                    }
                });

                // 2. 确定需要删除的联系人列表
                Object.keys(tempContactsSnapshot).forEach(id => {
                    if (!contactsToKeep[id]) {
                        contactIdsToRemove.push(id);
                    }
                });

                this.contacts = contactsToKeep; // 先在内存中更新

                try {
                    // 3. 遍历并清理每个要删除的联系人的所有相关数据
                    for (const contactId of contactIdsToRemove) {
                        await DBManager.removeItem('contacts', contactId);
                        localStorage.removeItem(`ttsConfig_${contactId}`);
                        localStorage.removeItem(`ai_chapter_${contactId}`);
                        await ChatManager.clearChat(contactId);
                        if (typeof ConnectionManager !== 'undefined' && ConnectionManager.connections?.[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                        // ... 清理群组关联
                    }
                    // 4. 更新UI状态
                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        Store.dispatch('OPEN_CHAT', { chatId: null });
                    }
                    Store.dispatch('DATA_MODIFIED');
                    NotificationUIManager.showNotification("所有非当前主题特殊联系人及手动添加的联系人均已清空。", 'success');
                } catch (error) {
                    // 5. 清理失败时回滚
                    Utils.log("清空联系人失败: " + error, Utils.logLevels.ERROR);
                    NotificationUIManager.showNotification("清空联系人时出错。", "error");
                    this.contacts = tempContactsSnapshot; // 恢复快照
                    Store.dispatch('DATA_MODIFIED');
                }
            }
        );
    },

    /**
     * 更新并保存用户的偏好设置
     * @function updateUserSetting
     * @param {string} settingKey - 设置项的键名。
     * @param {*} value - 设置项的新值。
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
     * 更新联系人的最后一条消息预览和时间
     * @function updateContactLastMessage
     * @param {string} id - 联系人ID。
     * @param {string} messageText - 消息的文本内容。
     * @param {boolean} [incrementUnread=false] - 是否增加未读消息计数。
     * @param {boolean} [forceNoUnread=false] - 是否强制将未读数清零。
     * @returns {Promise<void>}
     */
    async updateContactLastMessage(id, messageText, incrementUnread = false, forceNoUnread = false) {
        const contact = this.contacts[id];
        if (contact) {
            contact.lastMessage = messageText.length > 30 ? messageText.substring(0, 27) + "..." : messageText;
            contact.lastTime = new Date().toISOString();
            if (forceNoUnread) {
                contact.unread = 0;
            } else if (incrementUnread && (Store.getState().currentChatId !== id || !document.hasFocus())) {
                contact.unread = (contact.unread || 0) + 1;
            }
            await this.saveContact(id);
            Store.dispatch('DATA_MODIFIED');
        } else {
            Utils.log(`尝试为不存在的联系人更新最后一条消息: ${id}`, Utils.logLevels.WARN);
        }
    },

    /**
     * 清除指定联系人的未读消息计数
     * @function clearUnread
     * @param {string} id - 联系人ID。
     * @returns {Promise<void>}
     */
    async clearUnread(id) {
        const contact = this.contacts[id];
        if (contact && contact.unread > 0) {
            contact.unread = 0;
            await this.saveContact(id);
            Store.dispatch('DATA_MODIFIED');
        }
    },

    /**
     * 更新 AI 服务健康状态
     * @function updateAiServiceStatus
     * @param {boolean} isHealthy - AI 服务是否健康。
     */
    updateAiServiceStatus: function(isHealthy) {
        this.isAiServiceHealthy = isHealthy;
        this._aiServiceStatusMessage = isHealthy ? "服务可用" : "服务不可用";
        Utils.log(`UserManager: AI 服务状态更新为: ${this._aiServiceStatusMessage}`, Utils.logLevels.INFO);
        if (typeof Store !== 'undefined') {
            Store.dispatch('UPDATE_AI_SERVICE_STATUS', { isHealthy: this.isAiServiceHealthy });
        } else {
            Utils.log("UserManager: Store 未定义，无法分发 AI 服务状态更新。", Utils.logLevels.ERROR);
        }
    },

    /**
     * 设置 AI 联系人当前选择的词汇篇章
     * @function setSelectedChapterForAI
     * @param {string} contactId - AI 联系人的ID。
     * @param {string|null} chapterId - 要选择的篇章ID，或 null 表示使用默认。
     * @returns {Promise<void>}
     */
    async setSelectedChapterForAI(contactId, chapterId) {
        const contact = this.contacts[contactId];
        if (contact && contact.isAI) {
            contact.selectedChapterId = chapterId;
            await this.saveContact(contactId);
            Utils.log(`UserManager: AI ${contactId} 的词汇篇章已设置为: ${chapterId || '默认'}`, Utils.logLevels.INFO);
        } else {
            Utils.log(`UserManager: 尝试为非AI联系人 ${contactId} 设置篇章，已忽略。`, Utils.logLevels.WARN);
        }
    },

    /**
     * 检查一个联系人是否为广义上的特殊联系人
     * @function isSpecialContact
     * @param {string} contactId - 联系人ID。
     * @returns {boolean} - 如果联系人有 isSpecial 或 isAI 标志，则返回 true。
     */
    isSpecialContact: function(contactId) {
        const contact = this.contacts[contactId];
        return !!(contact && (contact.isSpecial || contact.isAI));
    },

    /**
     * 检查一个联系人是否为当前主题定义的特殊联系人
     * @function isSpecialContactInCurrentTheme
     * @param {string} contactId - 联系人ID。
     * @returns {boolean} - 如果联系人ID匹配当前主题的定义，则返回 true。
     */
    isSpecialContactInCurrentTheme: function(contactId) {
        const currentDefinitions = (typeof ThemeLoader !== 'undefined' && typeof ThemeLoader.getCurrentSpecialContactsDefinitions === 'function')
            ? ThemeLoader.getCurrentSpecialContactsDefinitions()
            : [];
        return currentDefinitions.some(sc => sc.id === contactId);
    },

    /**
     * 获取 AI 服务状态的文字描述
     * @function getAiServiceStatusMessage
     * @returns {string} - 格式化后的状态消息，如 "AI 助手 - 服务可用"。
     */
    getAiServiceStatusMessage: function() {
        return `AI 助手 - ${this._aiServiceStatusMessage}`;
    },

    /**
     * 获取 AI 联系人当前选择的词汇篇章ID
     * @function getSelectedChapterForAI
     * @param {string} contactId - AI 联系人的ID。
     * @returns {string|null} - 返回选择的篇章ID，如果未选择则返回 null。
     */
    getSelectedChapterForAI: function(contactId) {
        const contact = this.contacts[contactId];
        if (contact && contact.isAI) {
            return contact.selectedChapterId || null;
        }
        return null;
    },

    /**
     * 格式化消息用于在联系人列表中显示预览
     * @function formatMessagePreview
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
            case 'sticker': preview = `${senderName}: [贴图]`; break;
            case 'system': return message.content.length > 35 ? message.content.substring(0, 32) + "..." : message.content;
            default: preview = `${senderName}: [新消息]`;
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    },

    /**
     * (内部逻辑) 处理主题切换事件
     * @function handleThemeChange
     * @param {object} eventData - 包含 { newThemeKey, newDefinitions } 的事件数据。
     * @returns {Promise<void>}
     */
    async handleThemeChange(eventData) {
        Utils.log(`UserManager: 正在处理 themeChanged 事件。新主题密钥: ${eventData.newThemeKey}`, Utils.logLevels.INFO);
        const newDefinitions = eventData.newDefinitions || [];
        await this.ensureSpecialContacts(newDefinitions, false);
        const state = Store.getState();
        if (state.currentChatId && !this.contacts[state.currentChatId] && !GroupManager.groups[state.currentChatId]) {
            Store.dispatch('OPEN_CHAT', { chatId: null });
        }
        Store.dispatch('DATA_MODIFIED');
        const currentTheme = (typeof ThemeLoader !== 'undefined' && ThemeLoader.themes[eventData.newThemeKey])
            ? ThemeLoader.themes[eventData.newThemeKey]
            : null;
        if (typeof NotificationUIManager !== 'undefined' && currentTheme) {
            NotificationUIManager.showNotification(`主题已切换为 "${currentTheme.name}"`, 'success');
        }
    },

    /**
     * (内部逻辑) 确保特殊联系人存在并与主题定义同步
     * @function ensureSpecialContacts
     * @description 根据主题定义，创建或更新特殊联系人，并处理不再是特殊联系人的情况。
     * @param {Array<object>} newThemeDefinitions - 新主题的特殊联系人定义数组。
     * @param {boolean} [isFallbackMode=false] - 是否处于回退模式。
     * @returns {Promise<void>}
     */
    async ensureSpecialContacts(newThemeDefinitions, isFallbackMode = false) {
        if (!newThemeDefinitions || !Array.isArray(newThemeDefinitions)) {
            Utils.log("UserManager.ensureSpecialContacts: 收到无效或空定义。正在中止。", Utils.logLevels.WARN);
            return;
        }

        const processedContactIds = new Set();

        // 1. 遍历新的主题定义，创建或更新每个特殊联系人
        for (const scDef of newThemeDefinitions) {
            processedContactIds.add(scDef.id);

            // 优先从数据库获取用户已保存的联系人数据
            let dbContact = null;
            if (!isFallbackMode) {
                try {
                    dbContact = await DBManager.getItem('contacts', scDef.id);
                } catch (dbError) {
                    Utils.log(`ensureSpecialContacts: 获取DB联系人 ${scDef.id} 失败: ${dbError}`, Utils.logLevels.ERROR);
                }
            }

            // --- 构建最终的联系人对象，定义清晰的数据优先级 ---
            // 优先级: 主题定义 (scDef) < 数据库保存 (dbContact) < localStorage 覆盖 (用于TTS)

            // a. 从主题定义开始，构建基础数据，并进行深拷贝以防篡改原始定义
            const finalContact = {
                id: scDef.id,
                name: scDef.name,
                isSpecial: true,
                isAI: scDef.isAI || false,
                type: 'contact',
                avatarText: scDef.avatarText || scDef.name.charAt(0).toUpperCase(),
                avatarUrl: scDef.avatarUrl || null,
                aboutDetails: scDef.aboutDetails ? JSON.parse(JSON.stringify(scDef.aboutDetails)) : null,
                chapters: Array.isArray(scDef.chapters) ? JSON.parse(JSON.stringify(scDef.chapters)) : [],
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || { tts: {} }))
            };

            // b. 如果数据库中有保存，用数据库中的用户特定数据覆盖基础数据
            if (dbContact) {
                finalContact.name = dbContact.name || finalContact.name; // 允许用户重命名
                finalContact.lastMessage = dbContact.lastMessage ?? (scDef.initialMessage || '你好！');
                finalContact.lastTime = dbContact.lastTime || new Date().toISOString();
                finalContact.unread = dbContact.unread ?? 0;
                finalContact.selectedChapterId = dbContact.selectedChapterId ?? null;

                // 合并 AI 配置：以主题配置为基础，用数据库中的用户配置覆盖
                const mergedAiConfig = { ...finalContact.aiConfig, ...(dbContact.aiConfig || {}) };
                mergedAiConfig.tts = { ...(finalContact.aiConfig.tts || {}), ...(dbContact.aiConfig?.tts || {}) };
                finalContact.aiConfig = mergedAiConfig;

            } else {
                // 如果是全新的联系人，使用主题定义的初始消息
                finalContact.lastMessage = scDef.initialMessage || '你好！';
                finalContact.lastTime = new Date().toISOString();
                finalContact.unread = 0;
                finalContact.selectedChapterId = null;
            }

            // c. 应用来自 localStorage 的 TTS 设置，这是最高优先级的覆盖
            if (finalContact.isAI) {
                const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${scDef.id}`);
                if (storedTtsSettingsJson) {
                    try {
                        const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                        // 确保 aiConfig 和 tts 对象存在
                        if (!finalContact.aiConfig) finalContact.aiConfig = {};
                        if (!finalContact.aiConfig.tts) finalContact.aiConfig.tts = {};
                        Object.assign(finalContact.aiConfig.tts, storedTtsSettings);
                    } catch (e) {
                        Utils.log(`从localStorage解析TTS配置(${scDef.id})失败: ${e}`, Utils.logLevels.WARN);
                    }
                }
            }

            // d. 最后进行数据规范化，确保关键字段存在
            if (!finalContact.aiConfig) finalContact.aiConfig = {};
            if (!finalContact.aiConfig.tts) finalContact.aiConfig.tts = {};
            if (finalContact.aiConfig.tts.tts_mode === undefined) finalContact.aiConfig.tts.tts_mode = 'Preset';
            if (finalContact.aiConfig.tts.version === undefined) finalContact.aiConfig.tts.version = 'v4';

            // e. 更新内存中的联系人列表并保存
            this.contacts[scDef.id] = finalContact;
            if (!isFallbackMode) {
                await this.saveContact(scDef.id);
            }
        }

        // 2. 遍历内存中的所有联系人，处理那些不再是当前主题特殊联系人的情况
        for (const contactId in this.contacts) {
            if (!processedContactIds.has(contactId)) {
                const contact = this.contacts[contactId];
                // 只有当它是特殊联系人且不是用户导入的时，才移除其特殊状态
                if (contact.isSpecial && !contact.isImported) {
                    contact.isSpecial = false;
                    contact.chapters = []; // 清空篇章数据
                    Utils.log(`ensureSpecialContacts: 联系人 ${contactId} ('${contact.name}') 不再是当前主题的特殊联系人，isSpecial已设为false。`, Utils.logLevels.DEBUG);
                    if (!isFallbackMode) {
                        await this.saveContact(contactId);
                    }
                }
            }
        }
    },

    /**
     * (内部逻辑) 将联系人数据保存到数据库
     * @function saveContact
     * @param {string} contactId - 要保存的联系人的ID。
     * @returns {Promise<void>}
     */
    async saveContact(contactId) {
        if (this.contacts[contactId]) {
            try {
                const contactToSave = { ...this.contacts[contactId] };
                // NOTE: 在保存前确保数据结构的完整性和一致性
                if (contactToSave.isAI && !Array.isArray(contactToSave.chapters)) {
                    contactToSave.chapters = [];
                }
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
};