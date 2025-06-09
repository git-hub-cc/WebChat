// MODIFIED: UserManager.js (已翻译为中文)
const UserManager = {
    userId: null,
    userName: '我',
    contacts: {},
    userSettings: {
        autoConnectEnabled: true,
    },
    SPECIAL_CONTACTS_DEFINITIONS: SPECIAL_CONTACTS_DEFINITIONS, // 如果需要，暴露给其他模块

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
            await this.loadContacts(); // 首先加载非特殊联系人
            await this.ensureSpecialContacts(); // 然后确保特殊联系人存在，并与任何现有的数据库数据和 localStorage TTS 设置合并

        } catch (error) {
            Utils.log(`用户初始化失败: ${error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `用户 ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            // 即使在某些初始化错误时，也尝试使用默认值确保特殊联系人存在。
            const tempContactsCopy = {...this.contacts}; // 保留已加载的非特殊联系人。
            this.contacts = {}; // 清空以便干净地重新初始化特殊联系人。
            await this.ensureSpecialContacts(true); // 传递一个标志表示回退模式
            this.contacts = {...this.contacts, ...tempContactsCopy}; // 合并回来
        }
        document.getElementById('modalUserIdValue').textContent = this.userId;
        if (typeof SettingsUIManager !== 'undefined' && SettingsUIManager.updateCopyIdButtonState) {
            SettingsUIManager.updateCopyIdButtonState();
        }
        Utils.log(`用户已初始化: ${this.userId} (${this.userName})`, Utils.logLevels.INFO);
        Utils.log(`用户设置已加载: autoConnectEnabled = ${this.userSettings.autoConnectEnabled}`, Utils.logLevels.DEBUG);
    },

    isSpecialContact: function(contactId) {
        return SPECIAL_CONTACTS_DEFINITIONS.some(sc => sc.id === contactId);
    },

    ensureSpecialContacts: async function(isFallbackMode = false) {
        for (const scDef of SPECIAL_CONTACTS_DEFINITIONS) {
            // 以定义作为基础
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
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || {})), // 深拷贝定义的 AI 配置
                aboutDetails: scDef.aboutDetails || null
            };
            // 确保定义的 aiConfig 副本中存在 tts 对象
            if (contactDataFromDef.isAI && !contactDataFromDef.aiConfig.tts) {
                contactDataFromDef.aiConfig.tts = {};
            }

            let finalContactData = { ...contactDataFromDef };

            let dbContact = null;
            if (!isFallbackMode) {
                // 如果 ensureSpecialContacts 在已加载联系人上被重新运行，优先使用内存中的版本
                dbContact = this.contacts[scDef.id] || await DBManager.getItem('contacts', scDef.id);
            }

            if (dbContact) {
                // 从数据库合并通用字段
                finalContactData.name = dbContact.name || finalContactData.name;
                finalContactData.lastMessage = dbContact.lastMessage || finalContactData.lastMessage;
                finalContactData.lastTime = dbContact.lastTime || finalContactData.lastTime;
                finalContactData.unread = dbContact.unread || 0; // 如果未定义则保持为 0
                finalContactData.avatarUrl = dbContact.avatarUrl || finalContactData.avatarUrl; // 如果数据库为 null 则保留定义
                finalContactData.aboutDetails = dbContact.aboutDetails || finalContactData.aboutDetails;

                // 从数据库合并 aiConfig，但单独处理 TTS
                if (dbContact.aiConfig) {
                    const { tts: dbTts, ...otherDbAiConfig } = dbContact.aiConfig;
                    finalContactData.aiConfig = {
                        ...finalContactData.aiConfig, // 来自定义
                        ...otherDbAiConfig,           // 来自数据库的其他 AI 配置
                        tts: {
                            ...(finalContactData.aiConfig.tts || {}), // 来自定义的 TTS
                            ...(dbTts || {})                          // 来自数据库的 TTS
                        }
                    };
                }
            }

            // 在 localStorage 合并之前确保 tts 对象存在
            if (finalContactData.isAI && !finalContactData.aiConfig.tts) {
                finalContactData.aiConfig.tts = {};
            }

            // 应用 localStorage TTS 设置（TTS 的最高优先级）
            if (finalContactData.isAI) {
                const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${scDef.id}`);
                if (storedTtsSettingsJson) {
                    try {
                        const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                        finalContactData.aiConfig.tts = {
                            ...(finalContactData.aiConfig.tts || {}), // 当前合并的 TTS (定义 + 数据库)
                            ...storedTtsSettings                     // 用 localStorage 覆盖
                        };
                        Utils.log(`已从 localStorage 加载并应用 ${scDef.id} 的 TTS 设置。最终启用状态: ${finalContactData.aiConfig.tts.enabled}`, Utils.logLevels.DEBUG);
                    } catch (e) {
                        Utils.log(`从 localStorage 解析 ${scDef.id} 的 TTS 设置时出错: ${e}`, Utils.logLevels.WARN);
                    }
                }
            }

            // 如果联系人已在内存中，则保留现有的 lastMessage/Time/Unread
            // （如果此函数重新确保一个已激活的联系人，这个块通常用于动态数据）。
            // 对于 aiConfig，上面的逻辑（定义 -> 数据库 -> LocalStorage）应该是权威的。
            if (this.contacts[scDef.id] && this.contacts[scDef.id] !== finalContactData) {
                finalContactData.lastMessage = this.contacts[scDef.id].lastMessage || finalContactData.lastMessage;
                finalContactData.lastTime = this.contacts[scDef.id].lastTime || finalContactData.lastTime;
                finalContactData.unread = typeof this.contacts[scDef.id].unread === 'number' ? this.contacts[scDef.id].unread : finalContactData.unread;
            }

            this.contacts[scDef.id] = finalContactData; // 更新内存存储

            if (!isFallbackMode) {
                try {
                    await this.saveContact(scDef.id); // 将完全合并的联系人保存回数据库
                } catch (dbError) {
                    Utils.log(`合并后确保特殊联系人 ${scDef.name} 时数据库出错: ${dbError}`, Utils.logLevels.ERROR);
                }
            }
        }
    },

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

    loadContacts: async function() {
        try {
            const contactItems = await DBManager.getAllItems('contacts');
            if (contactItems && contactItems.length > 0) {
                contactItems.forEach(contact => {
                    // 只加载非特殊联系人。特殊联系人由 ensureSpecialContacts 处理。
                    if (!contact.id.startsWith("AI_") && !this.isSpecialContact(contact.id)) {
                        this.contacts[contact.id] = contact;
                        // 如果非特殊联系人可能是 AI 并有 TTS，也在此处应用 localStorage 覆盖
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

    saveContact: async function(contactId) {
        if (this.contacts[contactId]) {
            try {
                const contactToSave = { ...this.contacts[contactId] };
                // 确保 aiConfig 和 aiConfig.tts 在存在时结构正确
                if (contactToSave.isAI && contactToSave.aiConfig && typeof contactToSave.aiConfig.tts === 'undefined') {
                    contactToSave.aiConfig.tts = {};
                }
                await DBManager.setItem('contacts', contactToSave);
            } catch (error) {
                Utils.log(`保存联系人 ${contactId} 失败: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    renderContactListForSidebar: function() {
        ChatManager.currentFilter = 'contacts';
        SidebarUIManager.setActiveTab('contacts');
        ChatManager.renderChatList('contacts');
    },

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
            id: id,
            name: name || `用户 ${id.substring(0, 4)}`,
            lastMessage: '',
            lastTime: new Date().toISOString(),
            unread: 0,
            isSpecial: false,
            avatarText: name ? name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase(),
            avatarUrl: null,
            type: 'contact',
            isAI: false,
            aiConfig: {},
            aboutDetails: null
        };
        this.contacts[id] = newContact;
        await this.saveContact(id);
        ChatManager.renderChatList(ChatManager.currentFilter);
        NotificationManager.showNotification(`联系人 "${newContact.name}" 已添加。`, 'success');

        ConnectionManager.createOffer(id, { isSilent: true });
        Utils.log(`尝试与新联系人建立初始连接: ${id}`, Utils.logLevels.INFO);

        return true;
    },

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
                this.contacts[id] = tempContact;
                ChatManager.renderChatList(ChatManager.currentFilter);
                return false;
            }
        }
        return false;
    },

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

    clearUnread: async function(id) {
        const contact = this.contacts[id];
        if (contact && contact.unread > 0) {
            contact.unread = 0;
            await this.saveContact(id);
            ChatManager.renderChatList(ChatManager.currentFilter);
        }
    },

    clearAllContacts: async function() {
        ModalManager.showConfirmationModal(
            "您确定要删除所有用户添加的联系人吗？这也会清空他们的聊天记录。内置的特殊联系人将保留。",
            async () => {
                const contactIdsToRemove = Object.keys(this.contacts).filter(id => !this.isSpecialContact(id));

                const tempContacts = { ...this.contacts };
                const specialContactsToKeep = {};
                SPECIAL_CONTACTS_DEFINITIONS.forEach(scDef => {
                    if (tempContacts[scDef.id]) {
                        specialContactsToKeep[scDef.id] = tempContacts[scDef.id];
                    }
                });
                this.contacts = specialContactsToKeep;

                try {
                    for (const contactId of contactIdsToRemove) {
                        await DBManager.removeItem('contacts', contactId);
                        localStorage.removeItem(`ttsConfig_${contactId}`);
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
                    NotificationManager.showNotification("所有用户添加的联系人及其聊天记录已清空。", 'success');
                } catch (error) {
                    Utils.log("清空联系人失败: " + error, Utils.logLevels.ERROR);
                    NotificationManager.showNotification("从数据库清空联系人失败。", 'error');
                    this.contacts = tempContacts;
                    ChatManager.renderChatList(ChatManager.currentFilter);
                }
            }
        );
    },

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
                if (message.fileType && message.fileType.startsWith('image/')) preview = `${senderName}: [图片]`;
                else if (message.fileType && message.fileType.startsWith('video/')) preview = `${senderName}: [视频]`;
                else if (message.fileType && message.fileType.startsWith('audio/')) preview = `${senderName}: [音频文件]`;
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