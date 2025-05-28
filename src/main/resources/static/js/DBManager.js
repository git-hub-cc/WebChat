const DBManager = {
    db: null,
    dbName: 'p2pChatDB',
    dbVersion: 1,

    // 初始化数据库
    init: function() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                Utils.log('数据库打开失败', Utils.logLevels.ERROR);
                reject('数据库打开失败');
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                Utils.log('数据库打开成功', Utils.logLevels.INFO);
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建用户存储
                if (!db.objectStoreNames.contains('user')) {
                    db.createObjectStore('user', { keyPath: 'id' });
                }

                // 创建联系人存储
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'id' });
                }

                // 创建聊天记录存储
                if (!db.objectStoreNames.contains('chats')) {
                    db.createObjectStore('chats', { keyPath: 'id' });
                }

                // 创建群组存储
                if (!db.objectStoreNames.contains('groups')) {
                    db.createObjectStore('groups', { keyPath: 'id' });
                }
            };
        });
    },

    // 存储数据
    setItem: function(storeName, item) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('数据库未初始化');
                return;
            }

            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);

            request.onsuccess = () => resolve();
            request.onerror = () => reject('存储数据失败');
        });
    },

    // 获取数据
    getItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('数据库未初始化');
                return;
            }

            const transaction = this.db.transaction([storeName]);
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject('获取数据失败');
        });
    },

    // 获取存储中的所有数据
    getAllItems: function(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('数据库未初始化');
                return;
            }

            const transaction = this.db.transaction([storeName]);
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject('获取数据失败');
        });
    },

    // 删除数据
    removeItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('数据库未初始化');
                return;
            }

            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject('删除数据失败');
        });
    },

    // 清空存储
    clearStore: function(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject('数据库未初始化');
                return;
            }

            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject('清空数据失败');
        });
    }
};