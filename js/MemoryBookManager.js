/**
 * @file MemoryBookManager.js
 * @description Manages Memory Book functionalities, including defining key element sets,
 *              triggering AI extraction, and storing/retrieving generated memories.
 *              FIXED: All data modification methods now correctly call DBManager to persist changes to IndexedDB.
 * @module MemoryBookManager
 * @exports {object} MemoryBookManager
 * @dependencies DBManager, UserManager, ChatManager, AiApiHandler, NotificationUIManager, Utils, EventEmitter
 */
const MemoryBookManager = {
    _DB_STORE_NAME: 'memoryBooks', // Store for element sets and generated books
    _elementSets: [], // In-memory cache of {id, name, elements, books}

    /**
     * Initializes the manager by loading element sets from the database.
     * @returns {Promise<void>}
     */
    init: async function() {
        await this.loadElementSets();
        Utils.log("MemoryBookManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * Loads all element set definitions from IndexedDB into memory.
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
     * Returns a copy of the currently loaded element sets.
     * @returns {Array<object>}
     */
    getElementSets: function() {
        return [...this._elementSets];
    },

    /**
     * Adds a new element set to the database and memory.
     * @param {string} name - The name of the new set.
     * @param {Array<string>} elements - An array of key elements.
     * @returns {Promise<boolean>} - True if successful.
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
            books: {} // { chatId: { content: '...', enabled: false } }
        };
        try {
            // FIXED: Persist to database
            await DBManager.setItem(this._DB_STORE_NAME, newSet);
            // Update in-memory cache
            this._elementSets.push(newSet);
            // Notify UI
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
     * Deletes an element set from the database and memory.
     * @param {string} setId - The ID of the set to delete.
     * @returns {Promise<void>}
     */
    deleteElementSet: async function(setId) {
        try {
            // FIXED: Remove from database
            await DBManager.removeItem(this._DB_STORE_NAME, setId);
            // Update in-memory cache
            this._elementSets = this._elementSets.filter(s => s.id !== setId);
            // Notify UI
            EventEmitter.emit('memorySetsUpdated');
            NotificationUIManager.showNotification('记忆书已删除。', 'success');
            Utils.log(`已删除记忆书: ${setId}`, Utils.logLevels.INFO);
        } catch (error) {
            Utils.log(`删除记忆书 ${setId} 失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('删除记忆书失败。', 'error');
        }
    },

    /**
     * Triggers the generation of a memory book for a specific chat and element set,
     * then saves the result.
     * @param {string} setId - The ID of the element set to use for extraction.
     * @param {string} chatId - The ID of the chat to process.
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
            const conversationTranscript = chatHistory
                .filter(msg => msg.type === 'text' && !msg.isRetracted && !msg.isThinking)
                .map(msg => {
                    const senderName = msg.sender === UserManager.userId ? '我' : (UserManager.contacts[msg.sender]?.name || '对方');
                    return `${senderName}: ${msg.content}`;
                }).join('\n');

            const extractedContent = await AiApiHandler.extractMemoryElements(set.elements, conversationTranscript);

            // Update in-memory object
            if (!set.books) set.books = {};
            // Preserve the 'enabled' state if it exists, otherwise default to false
            set.books[chatId] = {
                content: extractedContent.trim(),
                enabled: set.books[chatId]?.enabled || false
            };

            // FIXED: Persist the entire updated set object to the database
            await DBManager.setItem(this._DB_STORE_NAME, set);

            NotificationUIManager.showNotification(`记忆书已为 "${set.name}" 生成！`, 'success');
            Utils.log(`已为记忆书 ${setId} 生成并保存记忆书 (Chat: ${chatId})`, Utils.logLevels.INFO);
            // Notify UI of the update
            EventEmitter.emit('memoryBookUpdated', { setId, chatId, content: set.books[chatId].content });

        } catch (error) {
            Utils.log(`生成记忆书失败 (set: ${setId}, chat: ${chatId}): ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification(`生成记忆书时出错: ${error.message}`, 'error');
            EventEmitter.emit('memoryBookGenerationFailed', { setId, chatId });
        }
    },

    /**
     * Saves user-edited content for a memory book.
     * @param {string} setId - The ID of the element set.
     * @param {string} chatId - The ID of the chat.
     * @param {string} newContent - The new content to save.
     * @returns {Promise<void>}
     */
    saveMemoryBookContent: async function(setId, chatId, newContent) {
        const set = this._elementSets.find(s => s.id === setId);
        if (set && set.books && set.books[chatId]) {
            // Update in-memory object
            set.books[chatId].content = newContent;

            // FIXED: Persist the entire updated set object to the database
            await DBManager.setItem(this._DB_STORE_NAME, set);

            NotificationUIManager.showNotification('记忆书已修改并保存。', 'success');
            Utils.log(`已手动保存记忆书内容 (Set: ${setId}, Chat: ${chatId})`, Utils.logLevels.INFO);
        } else {
            Utils.log(`尝试保存不存在的记忆书内容 (Set: ${setId}, Chat: ${chatId})`, Utils.logLevels.WARN);
        }
    },

    /**
     * Retrieves the content of all enabled memory books for a given chat.
     * @param {string} chatId - The ID of the chat.
     * @returns {string} - A formatted string containing the content of all enabled books.
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
     * Updates an existing element set.
     * @param {string} setId - The ID of the set to update.
     * @param {string} newName - The new name for the set.
     * @param {Array<string>} newElements - The new array of key elements.
     * @returns {Promise<boolean>} - True if successful.
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

        // Update properties
        setToUpdate.name = newName;
        setToUpdate.elements = newElements;

        try {
            await DBManager.setItem(this._DB_STORE_NAME, setToUpdate);
            this._elementSets[setIndex] = setToUpdate; // Update in-memory cache
            EventEmitter.emit('memorySetsUpdated');
            NotificationUIManager.showNotification(`记忆书 "${newName}" 已更新。`, 'success');
            Utils.log(`已更新并保存记忆书: ${setId}`, Utils.logLevels.INFO);
            return true;
        } catch (error) {
            Utils.log(`更新记忆书 ${setId} 失败: ${error}`, Utils.logLevels.ERROR);
            NotificationUIManager.showNotification('更新记忆书失败。', 'error');
            // Revert in-memory changes on failure
            await this.loadElementSets();
            EventEmitter.emit('memorySetsUpdated');
            return false;
        }
    },

    /**
     * Sets the enabled state of a memory book for a specific chat,
     * ensuring only one book can be enabled at a time for that chat.
     * @param {string} setId - The ID of the element set.
     * @param {string} chatId - The ID of the chat.
     * @param {boolean} isEnabled - The new enabled state.
     * @returns {Promise<void>}
     */
    setMemoryBookEnabled: async function(setId, chatId, isEnabled) {
        let changedSets = []; // Track which sets are modified to save them

        this._elementSets.forEach(set => {
            if (!set.books) set.books = {};
            if (!set.books[chatId]) {
                // Initialize book entry if it doesn't exist to store 'enabled' state
                set.books[chatId] = { content: '', enabled: false };
            }

            if (set.id === setId) {
                // This is the one being clicked
                if (set.books[chatId].enabled !== isEnabled) {
                    set.books[chatId].enabled = isEnabled;
                    changedSets.push(set);
                }
            } else if (isEnabled) {
                // If we are enabling a book, disable all others for this chat
                if (set.books[chatId].enabled) {
                    set.books[chatId].enabled = false;
                    changedSets.push(set);
                }
            }
        });

        if (changedSets.length > 0) {
            try {
                // Save all modified sets to the database
                await Promise.all(changedSets.map(set => DBManager.setItem(this._DB_STORE_NAME, set)));
                Utils.log(`记忆书启用状态已更新 (Chat: ${chatId}, Enabled Set: ${isEnabled ? setId : 'None'})`, Utils.logLevels.INFO);
                // We need to re-render the whole section to reflect the changes in other radio buttons/checkboxes
                EventEmitter.emit('memorySetsUpdated');
            } catch (error) {
                Utils.log(`更新记忆书启用状态时出错: ${error}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification('更新记忆书状态失败。', 'error');
                // On error, reload from DB to revert in-memory state
                await this.loadElementSets();
                EventEmitter.emit('memorySetsUpdated');
            }
        }
    },
};