
const UserManager = {
    userId: null,
    userName: 'Me',
    contacts: {},
    userSettings: {
        autoConnectEnabled: true,
    },

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
            document.getElementById('modalUserIdValue').textContent = this.userId;
            Utils.log(`User initialized: ${this.userId} (${this.userName})`, Utils.logLevels.INFO);
            Utils.log(`User settings loaded: autoConnectEnabled = ${this.userSettings.autoConnectEnabled}`, Utils.logLevels.DEBUG);
            await this.loadContacts();
        } catch (error) {
            Utils.log(`User initialization failed: ${error}`, Utils.logLevels.ERROR);
            this.userId = Utils.generateId(8);
            this.userName = `User ${this.userId.substring(0,4)}`;
            this.userSettings.autoConnectEnabled = false;
            document.getElementById('modalUserIdValue').textContent = this.userId;
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
            this.contacts = {};
            if (contactItems && contactItems.length > 0) {
                contactItems.forEach(contact => {
                    this.contacts[contact.id] = contact;
                });
            }
        } catch (error) {
            Utils.log(`Failed to load contacts: ${error}`, Utils.logLevels.ERROR);
        }
    },

    saveContact: async function(contactId) {
        if (this.contacts[contactId]) {
            try {
                await DBManager.setItem('contacts', this.contacts[contactId]);
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
            unread: 0
        };
        this.contacts[id] = newContact;
        await this.saveContact(id);
        ChatManager.renderChatList(ChatManager.currentFilter);
        UIManager.showNotification(`Contact "${newContact.name}" added.`, 'success');
        return true;
    },

    removeContact: async function(id) {
        if (this.contacts[id]) {
            delete this.contacts[id];
            await DBManager.removeItem('contacts', id);
            return true;
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
            "Are you sure you want to delete ALL contacts? This will also clear their chat histories.",
            async () => { // onConfirm
                const contactIds = Object.keys(this.contacts);
                this.contacts = {};
                try {
                    await DBManager.clearStore('contacts');
                    for (const contactId of contactIds) {
                        await ChatManager.clearChat(contactId);
                        if (ConnectionManager.connections[contactId]) {
                            ConnectionManager.close(contactId);
                        }
                    }
                    if (ChatManager.currentChatId && !ChatManager.currentChatId.startsWith('group_')) {
                        ChatManager.currentChatId = null;
                        UIManager.showNoChatSelected();
                    }
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    UIManager.showNotification("All contacts and their chats cleared.", 'success');
                } catch (error) {
                    Utils.log("Failed to clear all contacts: " + error, Utils.logLevels.ERROR);
                    UIManager.showNotification("Failed to clear all contacts from database.", 'error');
                }
            }
        );
    },

    formatMessagePreview: function(message) {
        let preview = '';
        const isMyMessage = message.sender === UserManager.userId || message.originalSender === UserManager.userId;

        switch (message.type) {
            case 'text':
                preview = (isMyMessage ? "You: " : "") + message.content;
                break;
            case 'image':
                preview = (isMyMessage ? "You: " : "") + "[Image]";
                break;
            case 'file':
                if (message.fileType && message.fileType.startsWith('image/')) preview = (isMyMessage ? "You: " : "") + "[Image]";
                else if (message.fileType && message.fileType.startsWith('video/')) preview = (isMyMessage ? "You: " : "") + "[Video]";
                else if (message.fileType && message.fileType.startsWith('audio/')) preview = (isMyMessage ? "You: " : "") + "[Audio File]";
                else preview = (isMyMessage ? "You: " : "") + `[File] ${message.fileName || ''}`;
                break;
            case 'audio':
                preview = (isMyMessage ? "You: " : "") + "[Voice Message]";
                break;
            case 'system':
                return this.contacts[message.sender]?.lastMessage || '';
            default:
                preview = (isMyMessage ? "You: " : "") + "[New Message]";
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    }
};