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
            await this.loadContacts();
            await this.ensureSpecialContacts();

        } catch (error) {
            Utils.log(`User initialization failed: ${error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `User ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            await this.ensureSpecialContacts();
        }
        document.getElementById('modalUserIdValue').textContent = this.userId;
        Utils.log(`User initialized: ${this.userId} (${this.userName})`, Utils.logLevels.INFO);
        Utils.log(`User settings loaded: autoConnectEnabled = ${this.userSettings.autoConnectEnabled}`, Utils.logLevels.DEBUG);
    },

    isSpecialContact: function(contactId) {
        return SPECIAL_CONTACTS_DEFINITIONS.some(sc => sc.id === contactId);
    },

    ensureSpecialContacts: async function() {
        for (const scDef of SPECIAL_CONTACTS_DEFINITIONS) {
            const contactData = {
                id: scDef.id,
                name: scDef.name,
                lastMessage: scDef.initialMessage,
                lastTime: new Date().toISOString(),
                unread: 0,
                isSpecial: true,
                avatarText: scDef.avatarText,
                avatarUrl: scDef.avatarUrl || null, // Add avatarUrl
                type: 'contact', // Ensure type is set
                isAI: scDef.isAI || false, // Flag if it's an AI
                aiConfig: scDef.aiConfig || null, // Store AI config
                aboutDetails: scDef.aboutDetails || null // Store about details
            };

            if (!this.contacts[scDef.id]) {
                Utils.log(`Adding special contact: ${scDef.name}`, Utils.logLevels.INFO);
                this.contacts[scDef.id] = contactData;
            } else {
                this.contacts[scDef.id] = {
                    ...this.contacts[scDef.id], // Keep existing dynamic fields
                    id: scDef.id,
                    name: scDef.name,
                    isSpecial: true,
                    avatarText: scDef.avatarText,
                    avatarUrl: scDef.avatarUrl || this.contacts[scDef.id].avatarUrl || null,
                    type: 'contact',
                    isAI: scDef.isAI || false,
                    aiConfig: scDef.aiConfig || this.contacts[scDef.id].aiConfig || null,
                    aboutDetails: scDef.aboutDetails || this.contacts[scDef.id].aboutDetails || null
                };
                if (!this.contacts[scDef.id].lastMessage) {
                    this.contacts[scDef.id].lastMessage = contactData.initialMessage;
                    this.contacts[scDef.id].lastTime = contactData.lastTime;
                }
                // Ensure aiConfig and aboutDetails are updated if not present or if scDef provides new ones
                if (!this.contacts[scDef.id].aiConfig && contactData.aiConfig) {
                    this.contacts[scDef.id].aiConfig = contactData.aiConfig;
                }
                if (!this.contacts[scDef.id].aboutDetails && contactData.aboutDetails) {
                    this.contacts[scDef.id].aboutDetails = contactData.aboutDetails;
                }
            }
            try {
                await this.saveContact(scDef.id);
            } catch (dbError) {
                Utils.log(`DB error ensuring special contact ${scDef.name}: ${dbError}`, Utils.logLevels.ERROR);
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
                    if (!this.isSpecialContact(contact.id) || (!this.contacts[contact.id])) {
                        this.contacts[contact.id] = contact;
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
                // Ensure aiConfig and aboutDetails are saved
                const contactToSave = { ...this.contacts[contactId] };
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
            isSpecial: false, // Regular contacts are not special
            avatarText: name ? name.charAt(0).toUpperCase() : id.charAt(0).toUpperCase(),
            avatarUrl: null, // Regular contacts don't have custom URLs by default
            type: 'contact',
            isAI: false,
            aiConfig: null,
            aboutDetails: null // Regular contacts don't have this by default
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

                const tempContacts = { ...this.contacts }; // Full backup
                const specialContactsToKeep = {};
                SPECIAL_CONTACTS_DEFINITIONS.forEach(scDef => {
                    if (tempContacts[scDef.id]) {
                        specialContactsToKeep[scDef.id] = tempContacts[scDef.id];
                    }
                });
                this.contacts = specialContactsToKeep; // Keep only special contacts in memory

                try {
                    for (const contactId of contactIdsToRemove) {
                        await DBManager.removeItem('contacts', contactId);
                        await ChatManager.clearChat(contactId); // Clear associated chat history
                        if (ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                    }

                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_') && contactIdsToRemove.includes(ChatManager.currentChatId)) {
                        ChatManager.currentChatId = null;
                        UIManager.showNoChatSelected();
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter); // Re-render the list
                    UIManager.showNotification("All user-added contacts and their chats cleared.", 'success');
                } catch (error) {
                    Utils.log("Failed to clear contacts: " + error, Utils.logLevels.ERROR);
                    UIManager.showNotification("Failed to clear contacts from database.", 'error');
                    this.contacts = tempContacts; // Rollback in-memory state
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