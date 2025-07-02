/**
 * @file 数据库管理器 (DBManager.js)
 * @description 封装对 IndexedDB 的所有操作，提供一个基于 Promise 的简洁 API 进行数据持久化。
 *              此模块包含对用户、联系人、聊天记录、群组等核心数据的存取，并新增了对文件（Blob）、TTS 音频和应用状态（如背景图）的缓存支持。
 * @module DBManager
 * @exports {object} DBManager - 对外暴露的单例对象，包含所有数据库操作方法。
 * @dependency Utils - 引入工具模块，主要用于日志记录。
 */
const DBManager = {
    // 数据库实例，初始化成功后持有该对象
    db: null,
    // 数据库名称
    dbName: 'ModernChatDB',
    // 数据库版本号。当需要新增或修改表结构（ObjectStore）时，必须递增此版本号。
    // 版本 7 -> 新增 'memoryBooks' 对象存储
    dbVersion: 7,

    /**
     * 初始化并打开 IndexedDB 数据库。
     * 如果数据库尚不存在或版本较低，此方法会触发 onupgradeneeded 事件来创建或升级表（ObjectStore）结构。
     * @function init
     * @returns {Promise<IDBDatabase>} 操作成功时，返回数据库实例的 Promise。
     * @throws {string} 数据库打开失败时，Promise 会被拒绝并返回错误信息。
     * @example
     * DBManager.init().then(db => {
     *   console.log('数据库已准备就绪');
     * }).catch(error => {
     *   console.error('数据库初始化失败:', error);
     * });
     */
    init: function() {
        return new Promise((resolve, reject) => {
            // 1. 检查数据库是否已经初始化，避免重复连接
            if (this.db) {
                resolve(this.db);
                return;
            }

            // 2. 发起连接数据库的请求
            const request = indexedDB.open(this.dbName, this.dbVersion);

            // 3. 处理错误事件
            request.onerror = (event) => {
                Utils.log('数据库打开错误: ' + event.target.errorCode, Utils.logLevels.ERROR);
                reject('数据库打开错误: ' + event.target.errorCode);
            };

            // 4. 处理成功事件
            request.onsuccess = (event) => {
                this.db = event.target.result;
                Utils.log('数据库已成功打开。', Utils.logLevels.INFO);
                resolve(this.db);
            };

            // 5. 处理数据库升级或首次创建事件
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                Utils.log(`需要升级数据库。旧版本: ${event.oldVersion}, 新版本: ${event.newVersion}`, Utils.logLevels.INFO);

                // 根据版本迭代，检查并创建所需的对象存储（表）
                if (!db.objectStoreNames.contains('user')) {
                    // 用户信息表，存储当前用户信息
                    db.createObjectStore('user', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('contacts')) {
                    // 联系人表，存储好友和AI联系人信息
                    db.createObjectStore('contacts', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('chats')) {
                    // 聊天记录表，存储所有对话的消息
                    db.createObjectStore('chats', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('groups')) {
                    // 群组信息表
                    db.createObjectStore('groups', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('ttsCache')) {
                    // TTS（文本转语音）音频缓存表，key 为文本内容的哈希值
                    db.createObjectStore('ttsCache', { keyPath: 'id' });
                    Utils.log('对象存储 ttsCache 已创建。', Utils.logLevels.INFO);
                }
                if (!db.objectStoreNames.contains('fileCache')) {
                    // 文件缓存表，用于存储图片、视频等 Blob 数据，key 为文件内容的哈希值
                    db.createObjectStore('fileCache', { keyPath: 'id' });
                    Utils.log('对象存储 fileCache 已创建。', Utils.logLevels.INFO);
                }
                if (!db.objectStoreNames.contains('appStateCache')) {
                    // 应用状态缓存表，例如用于存储自定义背景图
                    db.createObjectStore('appStateCache', { keyPath: 'id' }); // id: 'background_image'
                    Utils.log('对象存储 appStateCache 已创建。', Utils.logLevels.INFO);
                }
                if (!db.objectStoreNames.contains('stickers')) {
                    // 贴图缓存表，key 为文件哈希值
                    db.createObjectStore('stickers', { keyPath: 'id' });
                    Utils.log('对象存储 stickers 已创建。', Utils.logLevels.INFO);
                }
                if (!db.objectStoreNames.contains('memoryBooks')) {
                    // 记忆书缓存表
                    db.createObjectStore('memoryBooks', { keyPath: 'id' });
                    Utils.log('对象存储 memoryBooks 已创建。', Utils.logLevels.INFO);
                }
                Utils.log('数据库架构已升级/创建。', Utils.logLevels.INFO);
            };
        });
    },

    /**
     * 在指定对象存储中添加或更新一个项目。
     * @function setItem
     * @param {string} storeName - 对象存储的名称（表名）。
     * @param {object} item - 要存储的项目，必须包含与表 keyPath 对应的属性。
     * @returns {Promise<IDBValidKey>} 操作成功时，返回被存储项的键。
     */
    setItem: function(storeName, item) {
        return new Promise((resolve, reject) => {
            try {
                // 使用 'put' 方法，如果键已存在则更新，否则添加
                const request = this._getStore(storeName, 'readwrite').put(item);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    Utils.log(`在 ${storeName} 中设置项目时出错: ${event.target.error}`, Utils.logLevels.ERROR);
                    reject(event.target.error);
                };
            } catch (e) { reject(e); }
        });
    },

    /**
     * 根据键名从指定的对象存储中获取一个项目。
     * @function getItem
     * @param {string} storeName - 对象存储的名称（表名）。
     * @param {IDBValidKey} key - 要获取的项目的键。
     * @returns {Promise<object|undefined>} 操作成功时，返回找到的项目；如果未找到，则返回 undefined。
     */
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

    /**
     * 获取指定对象存储中的所有项目。
     * @function getAllItems
     * @param {string} storeName - 对象存储的名称（表名）。
     * @returns {Promise<Array<object>>} 操作成功时，返回包含所有项目的数组。
     */
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

    /**
     * 根据键名从指定的对象存储中移除一个项目。
     * @function removeItem
     * @param {string} storeName - 对象存储的名称（表名）。
     * @param {IDBValidKey} key - 要移除的项目的键。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
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

    /**
     * 清空指定的对象存储中的所有项目。
     * @function clearStore
     * @param {string} storeName - 要清空的对象存储的名称（表名）。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
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
    },

    /**
     * 清空数据库中所有对象存储的数据。
     * @function clearAllData
     * @returns {Promise<void>} 当所有存储区都被清空后解析的 Promise。
     */
    clearAllData: function() {
        return new Promise(async (resolve, reject) => {
            if (!this.db) {
                const err = new Error("数据库未初始化。");
                Utils.log("数据库未初始化，无法清空数据。", Utils.logLevels.ERROR);
                reject(err);
                return;
            }
            try {
                // 1. 获取所有对象存储（表）的名称
                const storeNames = Array.from(this.db.objectStoreNames);
                Utils.log(`准备清空以下存储区: ${storeNames.join(', ')}`, Utils.logLevels.INFO);

                // 2. 为每个表创建一个清空操作的 Promise
                const clearPromises = storeNames.map(storeName => this.clearStore(storeName));

                // 3. 等待所有清空操作完成
                await Promise.all(clearPromises);

                Utils.log("所有数据库存储区已清空。", Utils.logLevels.INFO);
                resolve();
            } catch (error) {
                Utils.log(`清空所有数据库数据时出错: ${error}`, Utils.logLevels.ERROR);
                reject(error);
            }
        });
    },

    /**
     * (内部方法) 获取一个事务中的对象存储实例。
     * @private
     * @function _getStore
     * @param {string} storeName - 对象存储的名称。
     * @param {IDBTransactionMode} [mode='readonly'] - 事务模式 ('readonly' 或 'readwrite')。
     * @returns {IDBObjectStore} 返回对象存储的实例。
     * @throws {Error} 如果数据库未初始化，则抛出错误。
     */
    _getStore: function(storeName, mode = 'readonly') {
        if (!this.db) throw new Error('数据库未初始化。');
        const transaction = this.db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    },
};