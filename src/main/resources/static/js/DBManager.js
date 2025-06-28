/**
 * @file DBManager.js
 * @description 数据库管理器，封装了对 IndexedDB 的所有操作，提供了一个简单的 Promise-based API 来进行数据持久化。
 *              新增: fileCache 对象存储用于缓存文件Blob数据。
 *              新增: appStateCache 对象存储用于缓存应用级别的状态，如背景图。
 * @module DBManager
 * @exports {object} DBManager - 对外暴露的单例对象，包含数据库操作方法。
 * @property {function} init - 初始化并打开数据库连接。
 * @property {function} setItem - 在指定的对象存储中设置（添加或更新）一个项目。
 * @property {function} getItem - 从指定的对象存储中获取一个项目。
 * @property {function} getAllItems - 获取指定对象存储中的所有项目。
 * @property {function} removeItem - 从指定的对象存储中移除一个项目。
 * @property {function} clearStore - 清空指定的对象存储。
 * @property {function} clearAllData - 清空数据库中所有对象存储的数据。
 * @dependencies Utils
 * @dependents AppInitializer (初始化), UserManager, ChatManager, GroupManager (进行数据读写), TtsApiHandler (TTS 缓存), ThemeLoader (背景图缓存)
 */
const DBManager = {
    db: null,
    dbName: 'ModernChatDB',
    dbVersion: 6, // MODIFIED: 数据库版本号 (为 stickers 增加版本)

    /**
     * 初始化并打开 IndexedDB 数据库。如果数据库不存在或版本较低，会触发 onupgradeneeded 来创建或升级表结构。
     * @returns {Promise<IDBDatabase>} 解析为数据库实例的 Promise。
     */
    init: function() {
        return new Promise((resolve, reject) => {
            // 如果数据库已初始化，直接返回实例
            if (this.db) {
                resolve(this.db);
                return;
            }
            const request = indexedDB.open(this.dbName, this.dbVersion); // 打开数据库
            request.onerror = (event) => { // 打开失败
                Utils.log('数据库打开错误: ' + event.target.errorCode, Utils.logLevels.ERROR);
                reject('数据库打开错误: ' + event.target.errorCode);
            };
            request.onsuccess = (event) => { // 打开成功
                this.db = event.target.result;
                Utils.log('数据库已成功打开。', Utils.logLevels.INFO);
                resolve(this.db);
            };
            // 首次创建或版本升级时调用
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                Utils.log('需要升级数据库。旧版本: ' + event.oldVersion + ', 新版本: ' + event.newVersion, Utils.logLevels.INFO);
                // 检查并创建需要的对象存储（表）
                if (!db.objectStoreNames.contains('user')) { // 用户信息表
                    db.createObjectStore('user', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('contacts')) { // 联系人表
                    db.createObjectStore('contacts', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('chats')) { // 聊天记录表
                    db.createObjectStore('chats', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('groups')) { // 群组信息表
                    db.createObjectStore('groups', { keyPath: 'id' });
                }
                // 添加 TTS 缓存表
                if (!db.objectStoreNames.contains('ttsCache')) {
                    db.createObjectStore('ttsCache', { keyPath: 'id' }); // 'id' 将存储哈希值
                    Utils.log('对象存储 ttsCache 已创建。', Utils.logLevels.INFO);
                }
                // 新增：文件缓存表
                if (!db.objectStoreNames.contains('fileCache')) {
                    db.createObjectStore('fileCache', { keyPath: 'id' }); // 'id' 将存储文件内容的哈希值
                    Utils.log('对象存储 fileCache 已创建。', Utils.logLevels.INFO);
                }
                // 新增：应用状态缓存表 (用于背景图等)
                if (!db.objectStoreNames.contains('appStateCache')) {
                    db.createObjectStore('appStateCache', { keyPath: 'id' }); // id: 'background_image'
                    Utils.log('对象存储 appStateCache 已创建。', Utils.logLevels.INFO);
                }
                // ADDED: 贴图缓存表
                if (!db.objectStoreNames.contains('stickers')) {
                    db.createObjectStore('stickers', { keyPath: 'id' }); // 'id' is the file hash
                    Utils.log('对象存储 stickers 已创建。', Utils.logLevels.INFO);
                }
                Utils.log('数据库架构已升级/创建。', Utils.logLevels.INFO);
            };
        });
    },

    /**
     * @private
     * 获取一个事务中的对象存储实例。
     * @param {string} storeName - 对象存储的名称。
     * @param {IDBTransactionMode} [mode='readonly'] - 事务模式 ('readonly' 或 'readwrite')。
     * @returns {IDBObjectStore}
     * @throws {Error} 如果数据库未初始化。
     */
    _getStore: function(storeName, mode = 'readonly') {
        if (!this.db) throw new Error('数据库未初始化。');
        return this.db.transaction(storeName, mode).objectStore(storeName);
    },

    /**
     * 在指定的对象存储中添加或更新一个项目。
     * @param {string} storeName - 对象存储的名称。
     * @param {object} item - 要存储的项目。Item 必须包含与其 keyPath 对应的属性。
     * @returns {Promise<IDBValidKey>} 解析为存储项目的键的 Promise。
     */
    setItem: function(storeName, item) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').put(item);
                request.onsuccess = () => resolve(request.result); // 成功时返回键
                request.onerror = (event) => { // 失败时记录错误并 reject
                    Utils.log(`在 ${storeName} 中设置项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    /**
     * 根据键从指定的对象存储中获取一个项目。
     * @param {string} storeName - 对象存储的名称。
     * @param {IDBValidKey} key - 要获取的项目的键。
     * @returns {Promise<object|undefined>} 解析为找到的项目或 undefined 的 Promise。
     */
    getItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName).get(key);
                request.onsuccess = () => resolve(request.result); // 成功时返回结果
                request.onerror = (event) => { // 失败时记录错误并 reject
                    Utils.log(`从 ${storeName} 获取项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    /**
     * 获取指定对象存储中的所有项目。
     * @param {string} storeName - 对象存储的名称。
     * @returns {Promise<Array<object>>} 解析为包含所有项目的数组的 Promise。
     */
    getAllItems: function(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName).getAll();
                request.onsuccess = () => resolve(request.result); // 成功时返回结果数组
                request.onerror = (event) => { // 失败时记录错误并 reject
                    Utils.log(`从 ${storeName} 获取所有项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    /**
     * 根据键从指定的对象存储中移除一个项目。
     * @param {string} storeName - 对象存储的名称。
     * @param {IDBValidKey} key - 要移除的项目的键。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
    removeItem: function(storeName, key) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').delete(key);
                request.onsuccess = () => resolve(); // 成功时 resolve
                request.onerror = (event) => { // 失败时记录错误并 reject
                    Utils.log(`从 ${storeName} 移除项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    /**
     * 清空指定的对象存储中的所有项目。
     * @param {string} storeName - 要清空的对象存储的名称。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
    clearStore: function(storeName) {
        return new Promise((resolve, reject) => {
            try {
                const request = this._getStore(storeName, 'readwrite').clear();
                request.onsuccess = () => resolve(); // 成功时 resolve
                request.onerror = (event) => { // 失败时记录错误并 reject
                    Utils.log(`清空存储区 ${storeName} 时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    /**
     * 清空数据库中的所有对象存储的数据。
     * @returns {Promise<void>} 当所有存储区都被清空后解析。
     */
    clearAllData: function() {
        return new Promise(async (resolve, reject) => {
            if (!this.db) { // 检查数据库是否已初始化
                Utils.log("数据库未初始化，无法清空数据。", Utils.logLevels.ERROR);
                reject(new Error("数据库未初始化。"));
                return;
            }
            try {
                const storeNames = Array.from(this.db.objectStoreNames); // 获取所有表名
                Utils.log(`准备清空以下存储区: ${storeNames.join(', ')}`, Utils.logLevels.INFO);
                const clearPromises = storeNames.map(storeName => this.clearStore(storeName)); // 创建清空每个表的 Promise
                await Promise.all(clearPromises); // 等待所有表清空完成
                Utils.log("所有数据库存储区已清空。", Utils.logLevels.INFO);
                resolve();
            } catch (error) {
                Utils.log(`清空所有数据库数据时出错: ${error}`, Utils.logLevels.ERROR);
                reject(error);
            }
        });
    }
};