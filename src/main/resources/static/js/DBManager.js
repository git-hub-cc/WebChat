// NO CHANGE in DBManager.js (already well-defined and under 500 lines)
const DBManager = {
    db: null,
    dbName: 'p2pModernChatDB',
    dbVersion: 2,

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
                Utils.log('Database upgrade needed. Old: ' + event.oldVersion + ', New: ' + event.newVersion, Utils.logLevels.INFO);
                if (!db.objectStoreNames.contains('user')) {
                    db.createObjectStore('user', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('chats')) {
                    db.createObjectStore('chats', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('groups')) {
                    db.createObjectStore('groups', { keyPath: 'id' });
                }
                Utils.log('Database schema upgraded/created.', Utils.logLevels.INFO);
            };
        });
    },

    _getStore: function(storeName, mode = 'readonly') {
        if (!this.db) throw new Error('Database not initialized.');
        return this.db.transaction(storeName, mode).objectStore(storeName);
    },

    setItem: function(storeName, item) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').put(item);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    Utils.log(`Error setting item in ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    getItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    Utils.log(`Error getting item from ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    getAllItems: function(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName).getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    Utils.log(`Error getting all items from ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    removeItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').delete(key);
                request.onsuccess = () => resolve();
                request.onerror = (event) => {
                    Utils.log(`Error removing item from ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    clearStore: function(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').clear();
                request.onsuccess = () => resolve();
                request.onerror = (event) => {
                    Utils.log(`Error clearing store ${storeName}: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    }
};