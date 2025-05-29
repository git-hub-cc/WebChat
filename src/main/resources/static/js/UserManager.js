const UserManager = {
    userId: null,
    userName: 'Me', // Default, can be changed by user settings later
    contacts: {}, // { id: {id, name, lastMessage, lastTime, unread} }

    init: async function() {
        try {
            await DBManager.init();
            const userData = await DBManager.getItem('user', 'currentUser');
            if (userData && userData.userId) {
                this.userId = userData.userId;
                this.userName = userData.userName || `User ${this.userId.substring(0,4)}`;
            } else {
                this.userId = Utils.generateId(8); // Generate a slightly longer default ID
                this.userName = `User ${this.userId.substring(0,4)}`;
                await DBManager.setItem('user', { id: 'currentUser', userId: this.userId, userName: this.userName });
            }
            document.getElementById('modalUserIdValue').textContent = this.userId;
            Utils.log(`User initialized: ${this.userId} (${this.userName})`, Utils.logLevels.INFO);
            await this.loadContacts();
        } catch (error) {
            Utils.log(`User initialization failed: ${error}`, Utils.logLevels.ERROR);
            // Fallback: generate temporary ID if DB fails hard
            this.userId = Utils.generateId(8);
            this.userName = `User ${this.userId.substring(0,4)}`;
            document.getElementById('modalUserIdValue').textContent = this.userId;
            // Potentially load from localStorage if DB completely fails
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
            // Initial rendering of contact list handled by ChatManager or UIManager
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

    renderContactListForSidebar: function() { // New function for specific tab
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
            // Optionally, update name if provided and different
            if (name && this.contacts[id].name !== name) {
                this.contacts[id].name = name;
                await this.saveContact(id);
                ChatManager.renderChatList(ChatManager.currentFilter);
            }
            return true; // Or false if you don't want to allow "re-adding"
        }

        const newContact = {
            id: id,
            name: name || `Peer ${id.substring(0, 4)}`,
            lastMessage: '',
            lastTime: new Date().toISOString(), // Set initial time for sorting
            unread: 0
        };
        this.contacts[id] = newContact;
        await this.saveContact(id);
        ChatManager.renderChatList(ChatManager.currentFilter); // Re-render whatever list is active
        UIManager.showNotification(`Contact "${newContact.name}" added.`, 'success');
        return true;
    },

    removeContact: async function(id) {
        if (this.contacts[id]) {
            // Confirm before deleting a contact, as it also clears chat history with them.
            // For this example, we'll assume ChatManager.deleteChat handles confirmation.
            // This function just handles the contact list part.
            delete this.contacts[id];
            await DBManager.removeItem('contacts', id);
            // ChatManager.renderChatList will be called by the caller (e.g., ChatManager.deleteChat)
            // UIManager.showNotification(`Contact "${this.contacts[id]?.name || id}" removed.`, 'info'); // Name won't exist after delete
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
            ChatManager.renderChatList(ChatManager.currentFilter); // Update the list
        } else {
            // If contact doesn't exist, maybe auto-add them (e.g. first message from unknown peer)
            // For now, we assume contact exists. Could be an offer acceptance from non-contact.
            // This might happen if a message arrives before OFFER/ANSWER fully processed the contact add.
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
        if (!confirm("Are you sure you want to delete ALL contacts? This will also clear their chat histories.")) {
            return;
        }
        const contactIds = Object.keys(this.contacts);
        this.contacts = {};
        try {
            await DBManager.clearStore('contacts');
            // Also clear associated chats
            for (const contactId of contactIds) {
                await ChatManager.clearChat(contactId); // Clear messages from DB
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
        }
    },

    formatMessagePreview: function(message) { // For contact chats
        let preview = '';
        // For 1-on-1, we don't need sender name if it's from the peer.
        // If it's MY message being added to preview:
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
            case 'system': // System messages usually don't update contact's last message preview like this
                return this.contacts[message.sender]?.lastMessage || ''; // Keep existing preview
            default:
                preview = (isMyMessage ? "You: " : "") + "[New Message]";
        }
        return preview.length > 35 ? preview.substring(0, 32) + "..." : preview;
    }
};