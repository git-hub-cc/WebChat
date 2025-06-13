/**
 * @file UserManager.js
 * @description 核心用户管理器，负责处理当前用户的信息、设置、所有联系人（包括特殊 AI 联系人）的数据管理。
 *              它与数据库交互以持久化用户和联系人数据，并确保主题定义的特殊联系人被正确加载和合并。
 * @module UserManager
 * @exports {object} UserManager - 对外暴露的单例对象，包含所有用户和联系人管理功能。
 * @property {string|null} userId - 当前用户的唯一 ID。
 * @property {object} contacts - 存储所有联系人数据的对象，格式为 { contactId: contactObject }。
 * @property {function} init - 初始化模块，加载或创建用户数据，并加载联系人。
 * @property {function} addContact - 添加一个新联系人。
 * @property {function} removeContact - 移除一个联系人。
 * @property {function} clearAllContacts - 清空所有用户添加的联系人。
 * @property {function} updateUserSetting - 更新并保存用户的偏好设置。
 * @dependencies DBManager, Utils, NotificationManager, ChatManager, ConnectionManager, ThemeLoader, ModalManager, SettingsUIManager, ChatAreaUIManager
 * @dependents AppInitializer (进行初始化), 几乎所有其他管理器都会直接或间接与之交互以获取用户信息或联系人数据。
 */
const UserManager = {
    userId: null,
    userName: '我',
    contacts: {},
    userSettings: {
        autoConnectEnabled: true,
    },
    SPECIAL_CONTACTS_DEFINITIONS: SPECIAL_CONTACTS_DEFINITIONS, // 从主题加载的特殊联系人定义

    /**
     * 初始化用户管理器。加载或创建当前用户数据，并加载所有联系人（包括特殊联系人）。
     * @returns {Promise<void>}
     */
    init: async function() {
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
            await this.loadContacts(); // 首先加载普通联系人
            await this.ensureSpecialContacts(); // 然后确保特殊联系人存在，并与数据库和 localStorage 数据合并

        } catch (error) {
            Utils.log(`用户初始化失败: ${error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `用户 ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            // 在回退模式下，仍尝试确保特殊联系人存在
            const tempContactsCopy = {...this.contacts};
            this.contacts = {};
            await this.ensureSpecialContacts(true); // 传递回退模式标志
            this.contacts = {...this.contacts, ...tempContactsCopy}; // 合并回普通联系人
        }
        document.getElementById('modalUserIdValue').textContent = this.userId;
        if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCopyIdButtonState) {
            SettingsUIManager.updateCopyIdButtonState();
        }
        Utils.log(`用户已初始化: ${this.userId} (${this.userName})`, Utils.logLevels.INFO);
        Utils.log(`用户设置已加载: autoConnectEnabled = ${this.userSettings.autoConnectEnabled}`, Utils.logLevels.DEBUG);
    },

    /**
     * 检查给定的 ID 是否为特殊联系人。
     * @param {string} contactId - 要检查的联系人 ID。
     * @returns {boolean}
     */
    isSpecialContact: function(contactId) {
        return SPECIAL_CONTACTS_DEFINITIONS.some(sc => sc.id === contactId);
    },

    /**
     * 确保所有在 `SPECIAL_CONTACTS_DEFINITIONS` 中定义的特殊联系人都存在于 `this.contacts` 中，
     * 并合并来自数据库和 localStorage 的持久化数据。
     * @param {boolean} [isFallbackMode=false] - 是否处于回退模式，此模式下不访问数据库。
     * @returns {Promise<void>}
     */
    ensureSpecialContacts: async function(isFallbackMode = false) {
        for (const scDef of SPECIAL_CONTACTS_DEFINITIONS) {
            // 基础数据来自主题定义文件
            let contactDataFromDef = {
                id: scDef.id,
                name: scDef.name,
                lastMessage: scDef.initialMessage,
                lastTime: new Date().toISOString(),
                unread: 0,
                isSpecial: true,
                avatarText: scDef.avatarText,
                avatarUrl: scDef.avatarUrl || null,
                type: 'contact',
                isAI: scDef.isAI || false,
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || {})),
                aboutDetails: scDef.aboutDetails || null
            };
            if (contactDataFromDef.isAI && !contactDataFromDef.aiConfig.tts) {
                contactDataFromDef.aiConfig.tts = {};
            }

            let finalContactData = { ...contactDataFromDef };
            let dbContact = null;

            if (!isFallbackMode) {
                // 优先使用内存中的数据，其次是数据库
                dbContact = this.contacts[scDef.id] || await DBManager.getItem('contacts', scDef.id);
            }

            if (dbContact) {
                // 合并数据库中的通用字段
                finalContactData.name = dbContact.name || finalContactData.name;
                finalContactData.lastMessage = dbContact.lastMessage || finalContactData.lastMessage;
                finalContactData.lastTime = dbContact.lastTime || finalContactData.lastTime;
                finalContactData.unread = dbContact.unread || 0;
                finalContactData.avatarUrl = dbContact.avatarUrl || finalContactData.avatarUrl;
                finalContactData.aboutDetails = dbContact.aboutDetails || finalContactData.aboutDetails;

                // 合并 AI 配置，特别处理 TTS 部分
                if (dbContact.aiConfig) {
                    const { tts: dbTts, ...otherDbAiConfig } = dbContact.aiConfig;
                    finalContactData.aiConfig = {
                        ...finalContactData.aiConfig,
                        ...otherDbAiConfig,
                        tts: {
                            ...(finalContactData.aiConfig.tts || {}),
                            ...(dbTts || {})
                        }
                    };
                }
            }

            // 应用来自 localStorage 的 TTS 设置（最高优先级）
            if (finalContactData.isAI) {
                const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${scDef.id}`);
                if (storedTtsSettingsJson) {
                    try {
                        const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                        finalContactData.aiConfig.tts = {
                            ...(finalContactData.aiConfig.tts || {}),
                            ...storedTtsSettings
                        };
                        Utils.log(`已从 localStorage 加载并应用 ${scDef.id} 的 TTS 设置。最终启用状态: ${finalContactData.aiConfig.tts.enabled}`, Utils.logLevels.DEBUG);
                    } catch (e) {
                        Utils.log(`从 localStorage 解析 ${scDef.id} 的 TTS 设置时出错: ${e}`, Utils.logLevels.WARN);
                    }
                }
            }

            // 如果联系人已在内存中（例如，在应用运行时动态加载新主题），则保留其动态数据
            if (this.contacts[scDef.id] && this.contacts[scDef.id] !== finalContactData) {
                finalContactData.lastMessage = this.contacts[scDef.id].lastMessage || finalContactData.lastMessage;
                finalContactData.lastTime = this.contacts[scDef.id].lastTime || finalContactData.lastTime;
                finalContactData.unread = typeof this.contacts[scDef.id].unread === 'number' ? this.contacts[scDef.id].unread : finalContactData.unread;
            }

            this.contacts[scDef.id] = finalContactData;

            if (!isFallbackMode) {
                try {
                    await this.saveContact(scDef.id); // 将完全合并后的数据保存回数据库
                } catch (dbError) {
                    Utils.log(`合并后确保特殊联系人 ${scDef.name} 时数据库出错: ${dbError}`, Utils.logLevels.ERROR);
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
    updateUserSetting: async function(settingKey, value) {
        if (this.userSettings.hasOwnProperty(settingKey)) {
            this.userSettings[settingKey] = value;
            Utils.log(`用户设置已更新: ${settingKey} = ${value}`, Utils.logLevels.INFO);
            try {
                const userData = await DBManager.getItem('user', 'currentUser') ||
                    { id: 'currentUser', userId: this.userId, userName: this.userName };
                const updatedUserData = { ...userData, ...this.userSettings };
                updatedUserData[settingKey] = value;
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
     * 从数据库加载所有非特殊联系人。
     * @returns {Promise<void>}
     */
    loadContacts: async function() {
        try {
            const contactItems = await DBManager.getAllItems('contacts');
            if (contactItems && contactItems.length > 0) {
                contactItems.forEach(contact => {
                    if (!contact.id.startsWith("AI_") && !this.isSpecialContact(contact.id)) {
                        this.contacts[contact.id] = contact;
                        // 如果非特殊联系人也可能是 AI，应用其存储的 TTS 设置
                        if (contact.isAI && contact.aiConfig) {
                            const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${contact.id}`);
                            if (storedTtsSettingsJson) {
                                try {
                                    const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                                    if (!contact.aiConfig.tts) contact.aiConfig.tts = {};
                                    contact.aiConfig.tts = { ...contact.aiConfig.tts, ...storedTtsSettings };
                                    Utils.log(`从 localStorage 加载了非特殊联系人 ${contact.id} 的 TTS 设置。`, Utils.logLevels.DEBUG);
                                } catch (e) {
                                    Utils.log(`从 localStorage 解析 ${contact.id} 的 TTS 设置时出错: ${e}`, Utils.logLevels.WARN);
                                }
                            }
                        }
                    }
                });
            }
        } catch (error) {
            Utils.log(`加载联系人失败: ${error}`, Utils.logLevels.ERROR);
        }
    },

    /**
     * 将指定的联系人数据保存到数据库。
     * @param {string} contactId - 要保存的联系人 ID。
     * @returns {Promise<void>}
     */
    saveContact: async function(contactId) {
        if (this.contacts[contactId]) {
            try {
                const contactToSave = { ...this.contacts[contactId] };
                if (contactToSave.isAI && contactToSave.aiConfig && typeof contactToSave.aiConfig.tts === 'undefined') {
                    contactToSave.aiConfig.tts = {};
                }
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
        ChatManager.currentFilter = 'contacts';
        SidebarUIManager.setActiveTab('contacts');
        ChatManager.renderChatList('contacts');
    },

    /**
     * 添加一个新联系人。
     * @param {string} id - 新联系人的 ID。
     * @param {string} name - 新联系人的名称。
     * @returns {Promise<boolean>} - 操作是否成功。
     */
    addContact: async function(id, name) {
        if (id === this.userId) {
            NotificationManager.showNotification("您不能添加自己为联系人。", "error");
            return false;
        }
        if (this.isSpecialContact(id)) {
            const specialContactName = SPECIAL_CONTACTS_DEFINITIONS.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationManager.showNotification(`${specialContactName} 是内置联系人，不能手动添加。`, "warning");
            return true;
        }
        if (this.contacts[id]) {
            NotificationManager.showNotification("该联系人已存在。", "warning");
            if (name && this.contacts[id].name !== name) {
                this.contacts[id].name = name;
                await this.saveContact(id);
                ChatManager.renderChatList(ChatManager.currentFilter);
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
            avatarUrl: null, type: 'contact', isAI: false, aiConfig: {}, aboutDetails: null
        };
        this.contacts[id] = newContact;
        await this.saveContact(id);
        ChatManager.renderChatList(ChatManager.currentFilter);
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
    removeContact: async function(id) {
        if (this.isSpecialContact(id)) {
            const specialContactName = SPECIAL_CONTACTS_DEFINITIONS.find(sc => sc.id === id)?.name || "这个特殊联系人";
            NotificationManager.showNotification(`${specialContactName} 是内置联系人，不能被移除。`, "warning");
            return false;
        }
        if (this.contacts[id]) {
            const tempContact = this.contacts[id];
            delete this.contacts[id];
            try {
                await DBManager.removeItem('contacts', id);
                localStorage.removeItem(`ttsConfig_${id}`);
                ChatManager.renderChatList(ChatManager.currentFilter);
                return true;
            } catch (error) {
                Utils.log(`从数据库移除联系人 ${id} 失败: ${error}`, Utils.logLevels.ERROR);
                this.contacts[id] = tempContact; // 失败时恢复
                ChatManager.renderChatList(ChatManager.currentFilter);
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
    updateContactLastMessage: async function(id, messageText, incrementUnread = false, forceNoUnread = false) {
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
            ChatManager.renderChatList(ChatManager.currentFilter);
        } else {
            Utils.log(`尝试为不存在的联系人更新最后一条消息: ${id}`, Utils.logLevels.WARN);
        }
    },

    /**
     * 清除指定联系人的未读消息计数。
     * @param {string} id - 目标联系人的 ID。
     * @returns {Promise<void>}
     */
    clearUnread: async function(id) {
        const contact = this.contacts[id];
        if (contact && contact.unread > 0) {
            contact.unread = 0;
            await this.saveContact(id);
            ChatManager.renderChatList(ChatManager.currentFilter);
        }
    },

    /**
     * 清空所有用户添加的联系人及其聊天记录。
     * AI 助手也将被删除。
     * @returns {Promise<void>}
     */
    clearAllContacts: async function() {
        ModalManager.showConfirmationModal(
            "您确定要删除所有用户添加的联系人以及所有AI助手吗？这也会清空他们的聊天记录。其他内置的特殊联系人将保留。",
            async () => {
                const tempContacts = { ...this.contacts }; // Preserve current state for rollback and iteration

                // Determine which contacts to remove: user-added OR special AI contacts
                const contactIdsToRemove = Object.keys(tempContacts).filter(id => {
                    const contact = tempContacts[id];
                    return !this.isSpecialContact(id) || (contact && contact.isAI);
                });

                // Determine which special contacts to keep (non-AI special contacts)
                const specialContactsToKeep = {};
                SPECIAL_CONTACTS_DEFINITIONS.forEach(scDef => {
                    if (tempContacts[scDef.id] && !tempContacts[scDef.id].isAI) {
                        specialContactsToKeep[scDef.id] = tempContacts[scDef.id];
                    }
                });

                this.contacts = specialContactsToKeep; // Update in-memory contacts

                try {
                    for (const contactId of contactIdsToRemove) {
                        await DBManager.removeItem('contacts', contactId);
                        localStorage.removeItem(`ttsConfig_${contactId}`); // Remove TTS config for AI contacts
                        await ChatManager.clearChat(contactId);
                        if (ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                    }

                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        ChatManager.currentChatId = null;
                        ChatAreaUIManager.showNoChatSelected();
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    NotificationManager.showNotification("所有用户添加的联系人、AI助手及其聊天记录已清空。", 'success');
                } catch (error) {
                    Utils.log("清空联系人失败: " + error, Utils.logLevels.ERROR);
                    NotificationManager.showNotification("从数据库清空联系人失败。", 'error');
                    this.contacts = tempContacts; // Rollback in-memory contacts
                    ChatManager.renderChatList(ChatManager.currentFilter); // Re-render with rolled-back state
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
    }
};