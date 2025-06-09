// DBManager.js 无需更改 (已定义良好且少于 500 行) -- 已翻译
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
                Utils.log('数据库打开错误: ' + event.target.errorCode, Utils.logLevels.ERROR);
                reject('数据库打开错误: ' + event.target.errorCode);
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                Utils.log('数据库已成功打开。', Utils.logLevels.INFO);
                resolve(this.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                Utils.log('需要升级数据库。旧版本: ' + event.oldVersion + ', 新版本: ' + event.newVersion, Utils.logLevels.INFO);
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
                Utils.log('数据库架构已升级/创建。', Utils.logLevels.INFO);
            };
        });
    },

    _getStore: function(storeName, mode = 'readonly') {
        if (!this.db) throw new Error('数据库未初始化。');
        return this.db.transaction(storeName, mode).objectStore(storeName);
    },

    setItem: function(storeName, item) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').put(item);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    Utils.log(`在 ${storeName} 中设置项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
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
                    Utils.log(`从 ${storeName} 获取项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
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
                    Utils.log(`从 ${storeName} 获取所有项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
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
                    Utils.log(`从 ${storeName} 移除项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
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
                    Utils.log(`清空存储区 ${storeName} 时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    }
};