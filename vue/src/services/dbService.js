import { log } from '@/utils';

const DB_NAME = 'WebChatVueDB';
const DB_VERSION = 2; // Keep this version if it's already deployed, or increment if needed.
// ✅ MODIFICATION: Removed 'stickers' from the list of stores
const STORES = ['user', 'contacts', 'chats', 'groups', 'settings', 'appStateCache', 'memoryBooks', 'fileCache', 'ttsCache'];

let dbPromise = null;

function getDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                log(`数据库打开错误: ${event.target.errorCode}`, 'ERROR');
                reject(event.target.errorCode);
            };

            request.onsuccess = (event) => {
                log(`数据库已成功打开 (版本: ${DB_VERSION})。`, 'INFO');
                resolve(event.target.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                log(`升级数据库... 旧版本: ${event.oldVersion}, 新版本: ${event.newVersion}`, 'INFO');
                STORES.forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, { keyPath: 'id' });
                        log(`对象存储 ${storeName} 已创建。`, 'INFO');
                    }
                });
                // Logic to delete old stores can be added here if needed for future versions
                // For example:
                // if (event.oldVersion < 3 && db.objectStoreNames.contains('oldStoreName')) {
                //     db.deleteObjectStore('oldStoreName');
                // }
                log('数据库架构升级完成。', 'INFO');
            };
        });
    }
    return dbPromise;
}

async function performDbOperation(storeName, mode, operation) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            transaction.oncomplete = () => {};
            transaction.onerror = (event) => {
                log(`数据库事务错误 on ${storeName}: ${event.target.error}`, 'ERROR');
                reject(event.target.error);
            };

            const request = operation(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => {
                log(`数据库请求失败 on ${storeName}: ${event.target.error}`, 'ERROR');
                reject(event.target.error);
            };
        } catch (error) {
            log(`创建数据库事务时出错 on ${storeName}: ${error}`, 'ERROR');
            reject(error);
        }
    });
}

export const dbService = {
    getItem: (storeName, key) => performDbOperation(storeName, 'readonly', store => store.get(key)),

    getAllItems: (storeName) => performDbOperation(storeName, 'readonly', store => store.getAll()),

    /**
     * Stores an item. Handles Vue's reactivity proxies by deep cloning,
     * but bypasses cloning for stores known to contain Blob objects.
     * @param {string} storeName - The name of the object store.
     * @param {object} item - The item to store.
     */
    setItem: (storeName, item) => {
        // ✅ MODIFICATION: Removed 'stickers' from the blob stores list
        const blobStores = ['fileCache', 'ttsCache', 'appStateCache'];

        if (blobStores.includes(storeName)) {
            log(`dbService.setItem: Bypassing JSON.stringify for blob store '${storeName}'.`, 'DEBUG');
            return performDbOperation(storeName, 'readwrite', store => store.put(item));
        } else {
            const plainItem = JSON.parse(JSON.stringify(item));
            return performDbOperation(storeName, 'readwrite', store => store.put(plainItem));
        }
    },

    removeItem: (storeName, key) => performDbOperation(storeName, 'readwrite', store => store.delete(key)),

    clearStore: (storeName) => performDbOperation(storeName, 'readwrite', store => store.clear()),

    async clearAllData() {
        log('正在清除所有数据库...', 'WARN');
        const db = await getDb();
        const storeNames = Array.from(db.objectStoreNames);
        const clearPromises = storeNames.map(name => this.clearStore(name));
        await Promise.all(clearPromises);
        log('所有数据库已清除。', 'INFO');
    }
};