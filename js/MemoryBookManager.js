/**
 * @file 记忆书管理器 (MemoryBookManager.js)
 * @description 管理记忆书（Memory Book）相关功能，包括定义核心要素集、触发 AI 提炼、存储和检索生成的记忆。
 *              注意：所有数据修改方法现已修正，会正确调用 DBManager 将变更持久化到 IndexedDB。
 * @module MemoryBookManager
 * @exports {object} MemoryBookManager - 导出的单例对象，用于管理所有记忆书功能。
 * @dependency DBManager, UserManager, ChatManager, AiApiHandler, NotificationUIManager, Utils, EventEmitter
 */
const MemoryBookManager = {
    // 用于 IndexedDB 的存储对象名称
    _DB_STORE_NAME: 'memoryBooks',
    // 记忆书要素集的内存缓存，结构为 {id, name, elements, books}
    _elementSets: [],

    /**
     * 初始化管理器，从数据库加载所有记忆书要素集。
     * @function init
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadElementSets();
        Utils.log("MemoryBookManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * 从 IndexedDB 加载所有记忆书要素集定义到内存中。
     * @function loadElementSets
     * @returns {Promise<void>}
     */
    loadElementSets: async function() {
        try {
            this._elementSets = await DBManager.getAllItems(this._DB_STORE_NAME);
            Utils.log(`已成功从数据库加载 ${this._elementSets.length} 个记忆书。`, Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`加载记忆书失败: ${error}`, Utils.logLevels.ERROR);
            this._elementSets = [];
        }
    },

    /**
     * 返回当前已加载的记忆书要素集的副本。
     * @function getElementSets
     * @returns {Array<object>} 一个包含所有记忆书要素集对象的数组。
     */
    getElementSets: function() {
        return [...this._elementSets];
    },

    /**
     * 添加一个新的记忆书要素集到数据库和内存。
     * @function addElementSet
     * @param {string} name - 新要素集的名称。
     * @param {Array<string>} elements - 核心要素的字符串数组。
     * @returns {Promise<boolean>} 如果成功添加则返回 true。
     */
    addElementSet: async function(name, elements) {
        if (!name || !Array.isArray(elements) || elements.length === 0) {
            NotificationUIManager.showNotification('记忆书名称和至少一个要素是必需的。', 'error');
            return false;
        }
        const newSet = {
            id: `mem_set_${Utils.generateId(12)}`,
            name: name,
            elements: elements,
            books: {} // 结构: { chatId: { content: '...', enabled: false } }
        };
        try {
            // NOTE: 将新数据持久化到数据库
            await DBManager.setItem(this._DB_STORE_NAME, newSet);
            // 更新内存缓存
            this._elementSets.push(newSet);
            // 通知 UI 更新
            EventEmitter.emit('memorySetsUpdated');
            NotificationUIManager.showNotification(`记忆书 "${name}" 已创建。`, 'success');
            Utils.log(`已创建并保存新的记忆书: ${newSet.id}`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`创建记忆书失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('创建记忆书失败。', 'error');
            return false;
        }
    },

    /**
     * 从数据库和内存中删除一个记忆书要素集。
     * @function deleteElementSet
     * @param {string} setId - 要删除的要素集的 ID。
     * @returns {Promise<void>}
     */
    deleteElementSet: async function(setId) {
        try {
            // NOTE: 从数据库中移除
            await DBManager.removeItem(this._DB_STORE_NAME, setId);
            // 更新内存缓存
            this._elementSets = this._elementSets.filter(s => s.id !== setId);
            // 通知 UI 更新
            EventEmitter.emit('memorySetsUpdated');
            NotificationUIManager.showNotification('记忆书已删除。', 'success');
            Utils.log(`已删除记忆书: ${setId}`, Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`删除记忆书 ${setId} 失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('删除记忆书失败。', 'error');
        }
    },

    /**
     * 触发为指定聊天和要素集生成记忆书，并保存结果。
     * @function generateMemoryBook
     * @param {string} setId - 用于提炼的要素集的 ID。
     * @param {string} chatId - 要处理的聊天的 ID。
     * @returns {Promise<void>}
     */
    generateMemoryBook: async function(setId, chatId) {
        const set = this._elementSets.find(s => s.id === setId);
        const chatHistory = ChatManager.chats[chatId];

        if (!set) {
            NotificationUIManager.showNotification('未找到指定的记忆书。', 'error');
            return;
        }
        if (!chatHistory || chatHistory.length === 0) {
            NotificationUIManager.showNotification('当前聊天没有内容可供记录。', 'info');
            return;
        }

        NotificationUIManager.showNotification(`正在为 "${set.name}" 生成记忆书...`, 'info');
        EventEmitter.emit('memoryBookGenerationStarted', { setId, chatId });

        try {
            // 处理流程如下：
            // 1. 格式化聊天记录，将有效文本消息拼接成对话脚本。
            const conversationTranscript = chatHistory
                .filter(msg => msg.type === 'text' && !msg.isRetracted && !msg.isThinking)
                .map(msg => {
                    const senderName = msg.sender === UserManager.userId ? '我' : (UserManager.contacts[msg.sender]?.name || '对方');
                    return `${senderName}: ${msg.content}`;
                }).join('\n');

            // 2. 调用 AI 接口，根据要素集提炼内容。
            const extractedContent = await AiApiHandler.extractMemoryElements(set.elements, conversationTranscript);

            // 3. 更新内存中的对象。
            if (!set.books) set.books = {};
            // NOTE: 保留已有的 'enabled' 状态，若不存在则默认为 false。
            set.books[chatId] = {
                content: extractedContent.trim(),
                enabled: set.books[chatId]?.enabled || false
            };

            // 4. 将整个更新后的要素集对象持久化到数据库。
            await DBManager.setItem(this._DB_STORE_NAME, set);

            // 5. 通知用户和 UI 操作已完成。
            NotificationUIManager.showNotification(`记忆书已为 "${set.name}" 生成！`, 'success');
            Utils.log(`已为记忆书 ${setId} 生成并保存记忆书 (Chat: ${chatId})`, Utils.logLevels.INFO);
            EventEmitter.emit('memoryBookUpdated', { setId, chatId, content: set.books[chatId].content });

        } catch (error) {
            Utils.log(`生成记忆书失败 (set: ${setId}, chat: ${chatId}): ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`生成记忆书时出错: ${error.message}`, 'error');
            EventEmitter.emit('memoryBookGenerationFailed', { setId, chatId });
        }
    },

    /**
     * 保存用户编辑后的记忆书内容。
     * @function saveMemoryBookContent
     * @param {string} setId - 要素集的 ID。
     * @param {string} chatId - 聊天的 ID。
     * @param {string} newContent - 要保存的新内容。
     * @returns {Promise<void>}
     */
    saveMemoryBookContent: async function(setId, chatId, newContent) {
        const set = this._elementSets.find(s => s.id === setId);
        if (set && set.books && set.books[chatId]) {
            // 更新内存对象
            set.books[chatId].content = newContent;

            // NOTE: 将整个更新后的要素集对象持久化到数据库
            await DBManager.setItem(this._DB_STORE_NAME, set);

            NotificationUIManager.showNotification('记忆书已修改并保存。', 'success');
            Utils.log(`已手动保存记忆书内容 (Set: ${setId}, Chat: ${chatId})`, Utils.logLevels.INFO);
        } else {
            Utils.log(`尝试保存不存在的记忆书内容 (Set: ${setId}, Chat: ${chatId})`, Utils.logLevels.WARN);
        }
    },

    /**
     * 检索指定聊天中所有已启用的记忆书内容。
     * @function getEnabledMemoryBookContentForChat
     * @param {string} chatId - 聊天的 ID。
     * @returns {string} - 一个格式化后的字符串，包含所有已启用记忆书的内容。
     */
    getEnabledMemoryBookContentForChat: function(chatId) {
        let combinedContent = "";
        this._elementSets.forEach(set => {
            if (set.books && set.books[chatId] && set.books[chatId].enabled && set.books[chatId].content) {
                combinedContent += `--- ${set.name} ---\n${set.books[chatId].content}\n\n`;
            }
        });
        return combinedContent.trim();
    },

    /**
     * 更新一个已存在的记忆书要素集。
     * @function updateElementSet
     * @param {string} setId - 要更新的要素集的 ID。
     * @param {string} newName - 集合的新名称。
     * @param {Array<string>} newElements - 新的核心要素数组。
     * @returns {Promise<boolean>} - 如果成功更新则返回 true。
     */
    updateElementSet: async function(setId, newName, newElements) {
        if (!setId || !newName || !Array.isArray(newElements) || newElements.length === 0) {
            NotificationUIManager.showNotification('记忆书ID、名称和至少一个要素是必需的。', 'error');
            return false;
        }

        const setIndex = this._elementSets.findIndex(s => s.id === setId);
        if (setIndex === -1) {
            NotificationUIManager.showNotification('未找到要更新的记忆书。', 'error');
            return false;
        }

        const setToUpdate = this._elementSets[setIndex];

        // 更新属性
        setToUpdate.name = newName;
        setToUpdate.elements = newElements;

        try {
            // 处理流程如下：
            // 1. 将更新后的对象保存到数据库。
            await DBManager.setItem(this._DB_STORE_NAME, setToUpdate);
            // 2. 更新内存缓存。
            this._elementSets[setIndex] = setToUpdate;
            // 3. 通知 UI 更新。
            EventEmitter.emit('memorySetsUpdated');
            NotificationUIManager.showNotification(`记忆书 "${newName}" 已更新。`, 'success');
            Utils.log(`已更新并保存记忆书: ${setId}`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`更新记忆书 ${setId} 失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('更新记忆书失败。', 'error');
            // NOTE: 如果更新失败，从数据库重新加载数据以回滚内存中的更改。
            await this.loadElementSets();
            EventEmitter.emit('memorySetsUpdated');
            return false;
        }
    },

    /**
     * 设置特定聊天中某个记忆书的启用状态。
     * @function setMemoryBookEnabled
     * @param {string} setId - 要素集的 ID。
     * @param {string} chatId - 聊天的 ID。
     * @param {boolean} isEnabled - 新的启用状态。
     * @returns {Promise<void>}
     */
    setMemoryBookEnabled: async function(setId, chatId, isEnabled) {
        // 追踪被修改的要素集，以便后续统一保存
        let changedSets = [];

        // 处理流程如下：
        // 1. 遍历所有要素集，处理其在指定聊天中的启用状态。
        this._elementSets.forEach(set => {
            if (!set.books) set.books = {};
            if (!set.books[chatId]) {
                // 如果记忆书条目不存在，则初始化以存储 'enabled' 状态
                set.books[chatId] = { content: '', enabled: false };
            }

            if (set.id === setId) {
                // 这是当前被操作的记忆书
                if (set.books[chatId].enabled !== isEnabled) {
                    set.books[chatId].enabled = isEnabled;
                    changedSets.push(set);
                }
            } else if (isEnabled) {
                // 如果正在启用一个记忆书，则禁用此聊天中的所有其他记忆书。
                // NOTE: 此处逻辑确保了单选效果。
                if (set.books[chatId].enabled) {
                    set.books[chatId].enabled = false;
                    changedSets.push(set);
                }
            }
        });

        // 2. 如果有任何状态变更，则持久化到数据库。
        if (changedSets.length > 0) {
            try {
                // 3. 将所有被修改的要素集保存到数据库。
                await Promise.all(changedSets.map(set => DBManager.setItem(this._DB_STORE_NAME, set)));
                Utils.log(`记忆书启用状态已更新 (Chat: ${chatId}, Enabled Set: ${isEnabled ? setId : 'None'})`, Utils.logLevels.INFO);
                // 4. 通知UI完全重绘，以反映所有相关状态的变化。
                EventEmitter.emit('memorySetsUpdated');
            } catch (error) {
                Utils.log(`更新记忆书启用状态时出错: ${error}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification('更新记忆书状态失败。', 'error');
                // NOTE: 若出错，则从数据库重新加载以回滚内存状态。
                await this.loadElementSets();
                EventEmitter.emit('memorySetsUpdated');
            }
        }
    },
};