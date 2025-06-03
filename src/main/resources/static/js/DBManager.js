
const DBManager = {
    db: null,
    dbName: 'p2pModernChatDB', // New DB name for the refactored version
    dbVersion: 2, // Increment version if schema changes

    init: function() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                Utils.log('Database open error: ' + event.target.errorCode, Utils.logLevels.ERROR);
                reject('Database open error: ' + event.target.errorCode);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                Utils.log('Database opened successfully.', Utils.logLevels.INFO);
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                Utils.log('Database upgrade needed. Old version: ' + event.oldVersion + ', New version: ' + event.newVersion, Utils.logLevels.INFO);

                // User Store (stores current user's ID, settings etc.)
                if (!db.objectStoreNames.contains('user')) {
                    db.createObjectStore('user', { keyPath: 'id' }); // 'id' could be 'currentUser', 'settings'
                }

                // Contacts Store
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'id' });
                    // Example: { id: "peerId123", name: "Alice", lastMessage: "Hi", lastTime: ISOString, unread: 0 }
                }

                // Chats Store (message history per chat)
                if (!db.objectStoreNames.contains('chats')) {
                    db.createObjectStore('chats', { keyPath: 'id' }); // 'id' is chatId (peerId or groupId)
                    // Example: { id: "peerId123", messages: [{type:"text", content:"Hello", sender:"...", timestamp:"..."}] }
                }

                // Groups Store
                if (!db.objectStoreNames.contains('groups')) {
                    db.createObjectStore('groups', { keyPath: 'id' });
                    // Example: { id: "groupABC", name: "Work Chat", owner: "myUserId", members: ["myUserId", "peerId123"], ... }
                }

                // Could add more stores for files, settings, etc.
                Utils.log('Database schema upgraded/created.', Utils.logLevels.INFO);
            };
        });
    },

    _getStore: function(storeName, mode = 'readonly') {
        if (!this.db) {
            Utils.log('Database not initialized.', Utils.logLevels.ERROR);
            throw new Error('Database not initialized.');
        }
        const transaction = this.db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    },

    setItem: function(storeName, item) {
        return new Promise((resolve, reject) => {
            try {
                const store = this._getStore(storeName, 'readwrite');
                const request = store.put(item);
                request.onsuccess = () => resolve(request.result); // Resolve with the key of the stored item
                request.onerror = (event) => {
                    Utils.log(`Error setting item in ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    getItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const store = this._getStore(storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result); // Result will be undefined if key not found
                request.onerror = (event) => {
                    Utils.log(`Error getting item from ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    getAllItems: function(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const store = this._getStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    Utils.log(`Error getting all items from ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    removeItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const store = this._getStore(storeName, 'readwrite');
                const request = store.delete(key);
                request.onsuccess = () => resolve();
                request.onerror = (event) => {
                    Utils.log(`Error removing item from ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    },

    clearStore: function(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const store = this._getStore(storeName, 'readwrite');
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = (event) => {
                    Utils.log(`Error clearing store ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
    }
};