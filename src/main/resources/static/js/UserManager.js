if (typeof SPECIAL_CONTACTS_DEFINITIONS === 'undefined'){
    SPECIAL_CONTACTS_DEFINITIONS = [];
}
const UserManager = {
    userId: null,
    userName: 'Me',
    contacts: {},
    userSettings: {
        autoConnectEnabled: true,
    },
    SPECIAL_CONTACTS_DEFINITIONS: SPECIAL_CONTACTS_DEFINITIONS, // Expose for other modules if needed

    init: async function() {
        try {
            await DBManager.init();
            let userData = await DBManager.getItem('user', 'currentUser');
            if (userData && userData.userId) {
                this.userId = userData.userId;
                this.userName = userData.userName || `User ${this.userId.substring(0,4)}`;
                this.userSettings.autoConnectEnabled = typeof userData.autoConnectEnabled === 'boolean' ? userData.autoConnectEnabled : false;
            } else {
                this.userId = Utils.generateId(8);
                this.userName = `User ${this.userId.substring(0,4)}`;
                userData = {
                    id: 'currentUser',
                    userId: this.userId,
                    userName: this.userName,
                    autoConnectEnabled: this.userSettings.autoConnectEnabled
                };
                await DBManager.setItem('user', userData);
            }
            await this.loadContacts(); // Load non-special contacts first
            await this.ensureSpecialContacts(); // Then ensure special contacts, merging with any existing DB data and localStorage TTS

        } catch (error) {
            Utils.log(`User initialization failed: ${error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `User ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            // Attempt to ensure special contacts even on some init errors, using defaults.
            const tempContactsCopy = {...this.contacts}; // Keep non-special if loaded.
            this.contacts = {}; // Clear to re-initialize special ones cleanly.
            await this.ensureSpecialContacts(true); // Pass a flag to indicate fallback mode
            this.contacts = {...this.contacts, ...tempContactsCopy}; // Merge back
        }
        document.getElementById('modalUserIdValue').textContent = this.userId;
        if (typeof UIManager !== 'undefined' && UIManager.updateCopyIdButtonState) {
            UIManager.updateCopyIdButtonState();
        }
        Utils.log(`User initialized: ${this.userId} (${this.userName})`, Utils.logLevels.INFO);
        Utils.log(`User settings loaded: autoConnectEnabled = ${this.userSettings.autoConnectEnabled}`, Utils.logLevels.DEBUG);
    },

    isSpecialContact: function(contactId) {
        return SPECIAL_CONTACTS_DEFINITIONS.some(sc => sc.id === contactId);
    },

    ensureSpecialContacts: async function(isFallbackMode = false) {
        for (const scDef of SPECIAL_CONTACTS_DEFINITIONS) {
            // Start with the definition as the base
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
                aiConfig: JSON.parse(JSON.stringify(scDef.aiConfig || {})), // Deep copy definition's AI config
                aboutDetails: scDef.aboutDetails || null
            };
            // Ensure tts object exists in definition's aiConfig copy
            if (contactDataFromDef.isAI && !contactDataFromDef.aiConfig.tts) {
                contactDataFromDef.aiConfig.tts = {};
            }

            let finalContactData = { ...contactDataFromDef };

            let dbContact = null;
            if (!isFallbackMode) {
                // Prefer existing in-memory version if ensureSpecialContacts is somehow re-run on already loaded contacts
                dbContact = this.contacts[scDef.id] || await DBManager.getItem('contacts', scDef.id);
            }

            if (dbContact) {
                // Merge general fields from DB
                finalContactData.name = dbContact.name || finalContactData.name;
                finalContactData.lastMessage = dbContact.lastMessage || finalContactData.lastMessage;
                finalContactData.lastTime = dbContact.lastTime || finalContactData.lastTime;
                finalContactData.unread = dbContact.unread || 0; // Keep 0 if undefined
                finalContactData.avatarUrl = dbContact.avatarUrl || finalContactData.avatarUrl; // Keep def if DB is null
                finalContactData.aboutDetails = dbContact.aboutDetails || finalContactData.aboutDetails;

                // Merge aiConfig from DB, but handle TTS separately
                if (dbContact.aiConfig) {
                    const { tts: dbTts, ...otherDbAiConfig } = dbContact.aiConfig;
                    finalContactData.aiConfig = {
                        ...finalContactData.aiConfig, // from definition
                        ...otherDbAiConfig,           // other AI config from DB
                        tts: {
                            ...(finalContactData.aiConfig.tts || {}), // TTS from definition
                            ...(dbTts || {})                          // TTS from DB
                        }
                    };
                }
            }

            // Ensure tts object exists before localStorage merge
            if (finalContactData.isAI && !finalContactData.aiConfig.tts) {
                finalContactData.aiConfig.tts = {};
            }

            // Apply localStorage TTS settings (highest priority for TTS)
            if (finalContactData.isAI) {
                const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${scDef.id}`);
                if (storedTtsSettingsJson) {
                    try {
                        const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                        finalContactData.aiConfig.tts = {
                            ...(finalContactData.aiConfig.tts || {}), // Current merged TTS (Def + DB)
                            ...storedTtsSettings                     // Override with localStorage
                        };
                        Utils.log(`Loaded and applied TTS settings for ${scDef.id} from localStorage. Resulting enabled: ${finalContactData.aiConfig.tts.enabled}`, Utils.logLevels.DEBUG);
                    } catch (e) {
                        Utils.log(`Error parsing TTS settings from localStorage for ${scDef.id}: ${e}`, Utils.logLevels.WARN);
                    }
                }
            }

            // Preserve existing lastMessage/Time/Unread if contact was already in memory
            // (this.contacts[scDef.id] would be the version before this full `ensure` logic, potentially just from `loadContacts` if it was a normal contact mistaken for special, or an older ensure pass)
            // This block is generally for dynamic data if this function were to re-ensure an already active contact.
            // For aiConfig, the logic above (Def -> DB -> LocalStorage) should be authoritative.
            if (this.contacts[scDef.id] && this.contacts[scDef.id] !== finalContactData) { // Check if it's not the same object already
                finalContactData.lastMessage = this.contacts[scDef.id].lastMessage || finalContactData.lastMessage;
                finalContactData.lastTime = this.contacts[scDef.id].lastTime || finalContactData.lastTime;
                finalContactData.unread = typeof this.contacts[scDef.id].unread === 'number' ? this.contacts[scDef.id].unread : finalContactData.unread;
            }

            this.contacts[scDef.id] = finalContactData; // Update in-memory store

            if (!isFallbackMode) {
                try {
                    await this.saveContact(scDef.id); // Save the fully merged contact back to DB
                } catch (dbError) {
                    Utils.log(`DB error ensuring special contact ${scDef.name} after merge: ${dbError}`, Utils.logLevels.ERROR);
                }
            }
        }
    },

    updateUserSetting: async function(settingKey, value) {
        if (this.userSettings.hasOwnProperty(settingKey)) {
            this.userSettings[settingKey] = value;
            Utils.log(`User setting updated: ${settingKey} = ${value}`, Utils.logLevels.INFO);

            try {
                const userData = await DBManager.getItem('user', 'currentUser') ||
                    { id: 'currentUser', userId: this.userId, userName: this.userName };
                const updatedUserData = { ...userData, ...this.userSettings };
                updatedUserData[settingKey] = value;

                await DBManager.setItem('user', updatedUserData);
            } catch (error) {
                Utils.log(`Failed to save setting ${settingKey}: ${error}`, Utils.logLevels.ERROR);
                UIManager.showNotification('Failed to save setting.', 'error');
            }
        } else {
            Utils.log(`Attempted to update unknown setting: ${settingKey}`, Utils.logLevels.WARN);
        }
    },

    loadContacts: async function() {
        try {
            const contactItems = await DBManager.getAllItems('contacts');
            if (contactItems && contactItems.length > 0) {
                contactItems.forEach(contact => {
                    // Only load non-special contacts here. Special contacts are handled by ensureSpecialContacts.
                    if (!contact.id.startsWith("AI_") &&!this.isSpecialContact(contact.id)) {
                        this.contacts[contact.id] = contact;
                        // If non-special contacts could be AI and have TTS, apply localStorage override here too
                        if (contact.isAI && contact.aiConfig) {
                            const storedTtsSettingsJson = localStorage.getItem(`ttsConfig_${contact.id}`);
                            if (storedTtsSettingsJson) {
                                try {
                                    const storedTtsSettings = JSON.parse(storedTtsSettingsJson);
                                    if (!contact.aiConfig.tts) contact.aiConfig.tts = {};
                                    contact.aiConfig.tts = { ...contact.aiConfig.tts, ...storedTtsSettings };
                                    Utils.log(`Loaded TTS settings for non-special contact ${contact.id} from localStorage.`, Utils.logLevels.DEBUG);
                                } catch (e) {
                                    Utils.log(`Error parsing TTS settings from localStorage for ${contact.id}: ${e}`, Utils.logLevels.WARN);
                                }
                            }
                        }
                    }
                });
            }
        } catch (error) {
            Utils.log(`Failed to load contacts: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveContact: async function(contactId) {
        if (this.contacts[contactId]) {
            try {
                const contactToSave = { ...this.contacts[contactId] };
                // Ensure aiConfig and aiConfig.tts are properly structured if they exist
                if (contactToSave.isAI && contactToSave.aiConfig && typeof contactToSave.aiConfig.tts === 'undefined') {
                    contactToSave.aiConfig.tts = {};
                }
                await DBManager.setItem('contacts', contactToSave);
            } catch (error) {
                Utils.log(`Failed to save contact ${contactId}: ${error}`, Utils.logLevels.ERROR);
            }
        }
    },

    renderContactListForSidebar: function() {
        ChatManager.currentFilter = 'contacts';
        UIManager.setActiveTab('contacts');
        ChatManager.renderChatList('contacts');
    },

    addContact: async function(id, name) {
        if (id === this.userId) {
            UIManager.showNotification("You cannot add yourself as a contact.", "error");
            return false;
        }
        if (this.isSpecialContact(id)) {
            const specialContactName = SPECIAL_CONTACTS_DEFINITIONS.find(sc => sc.id === id)?.name || "this special contact";
            UIManager.showNotification(`${specialContactName} is a built-in contact and cannot be added manually.`, "warning");
            return true;
        }
        if (this.contacts[id]) {
            UIManager.showNotification("This contact already exists.", "warning");
            if (name && this.contacts[id].name !== name) {
                this.contacts[id].name = name;
                await this.saveContact(id);
                ChatManager.renderChatList(ChatManager.currentFilter);
            }
            return true;
        }

        const newContact = {
            id: id,
            name: name || `Peer ${id.substring(0, 4)}`,
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
        UIManager.showNotification(`Contact "${newContact.name}" added.`, 'success');
        return true;
    },

    removeContact: async function(id) {
        if (this.isSpecialContact(id)) {
            const specialContactName = SPECIAL_CONTACTS_DEFINITIONS.find(sc => sc.id === id)?.name || "This special contact";
            UIManager.showNotification(`${specialContactName} is a built-in contact and cannot be removed.`, "warning");
            return false;
        }
        if (this.contacts[id]) {
            const tempContact = this.contacts[id];
            delete this.contacts[id];
            try {
                await DBManager.removeItem('contacts', id);
                // Also remove associated localStorage TTS settings if any
                localStorage.removeItem(`ttsConfig_${id}`);
                ChatManager.renderChatList(ChatManager.currentFilter);
                return true;
            } catch (error) {
                Utils.log(`Failed to remove contact ${id} from DB: ${error}`, Utils.logLevels.ERROR);
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
            Utils.log(`Attempted to update last message for non-existent contact: ${id}`, Utils.logLevels.WARN);
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
        UIManager.showConfirmationModal(
            "Are you sure you want to delete ALL user-added contacts? This will also clear their chat histories. Built-in special contacts will remain.",
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
                        localStorage.removeItem(`ttsConfig_${contactId}`); // Remove associated localStorage TTS
                        await ChatManager.clearChat(contactId);
                        if (ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                    }

                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        ChatManager.currentChatId = null;
                        UIManager.showNoChatSelected();
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    UIManager.showNotification("All user-added contacts and their chats cleared.", 'success');
                } catch (error) {
                    Utils.log("Failed to clear contacts: " + error, Utils.logLevels.ERROR);
                    UIManager.showNotification("Failed to clear contacts from database.", 'error');
                    this.contacts = tempContacts; // Rollback in-memory
                    // Note: DB and localStorage might be partially cleared. A more robust rollback would re-add them.
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
            senderName = "You";
        } else if (senderContact) {
            senderName = senderContact.name;
        } else {
            senderName = "Peer";
        }


        switch (message.type) {
            case 'text':
                preview = `${senderName}: ${message.content}`;
                break;
            case 'image':
                preview = `${senderName}: [Image]`;
                break;
            case 'file':
                if (message.fileType && message.fileType.startsWith('image/')) preview = `${senderName}: [Image]`;
                else if (message.fileType && message.fileType.startsWith('video/')) preview = `${senderName}: [Video]`;
                else if (message.fileType && message.fileType.startsWith('audio/')) preview = `${senderName}: [Audio File]`;
                else preview = `${senderName}: [File] ${message.fileName || ''}`;
                break;
            case 'audio':
                preview = `${senderName}: [Voice Message]`;
                break;
            case 'system':
                return message.content.length > 35 ? message.content.substring(0, 32) + "..." : message.content;
            default:
                preview = `${senderName}: [New Message]`;
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    }
};