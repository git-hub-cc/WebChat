import { log } from '@/utils';

const DB_NAME = 'WebChatVueDB';
const DB_VERSION = 2;
const STORES = ['user', 'contacts', 'chats', 'groups', 'settings', 'appStateCache', 'stickers', 'memoryBooks', 'fileCache', 'ttsCache'];

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
                log('数据库架构升级完成。', 'INFO');
            };
        });
    }
    return dbPromise;
}

async function performDbOperation(storeName, mode, operation) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
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
    });
}

export const dbService = {
    getItem: (storeName, key) => performDbOperation(storeName, 'readonly', store => store.get(key)),

    getAllItems: (storeName) => performDbOperation(storeName, 'readonly', store => store.getAll()),

    /**
     * Stores an item. Handles Vue's reactivity proxies by deep cloning.
     * @param {string} storeName - The name of the object store.
     * @param {object} item - The item to store.
     */
    setItem: (storeName, item) => {
        // --- START OF FIX ---
        // For stores containing Blobs, we must bypass JSON stringification as it doesn't work for Blobs.
        // The responsibility is shifted to the caller to provide a plain, non-reactive object.
        if (storeName === 'fileCache' || storeName === 'ttsCache' || storeName === 'stickers') {
            return performDbOperation(storeName, 'readwrite', store => store.put(item));
        } else {
            // For all other metadata stores, this is a safe and effective way to remove Vue's reactivity proxies.
            const plainItem = JSON.parse(JSON.stringify(item));
            return performDbOperation(storeName, 'readwrite', store => store.put(plainItem));
        }
        // --- END OF FIX ---
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