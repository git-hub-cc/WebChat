import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dbService } from '@/services/dbService';
import { apiService } from '@/services/apiService';
import { eventBus } from '@/services/eventBus';
import { useChatStore } from './chatStore';
import { useUserStore } from './userStore';
import { log, generateId } from '@/utils';

/**
 * @file memoryStore.js
 * @description (Vue Refactor) Manages Memory Book functionalities, including definitions,
 *              generation, storage, and retrieval.
 */
export const useMemoryStore = defineStore('memory', () => {
    // --- STATE ---
    const elementSets = ref([]); // {id, name, elements, books: { [chatId]: { content, enabled } }}

    // --- ACTIONS ---

    /**
     * Initializes the store by loading memory sets from the database.
     */
    async function init() {
        elementSets.value = await dbService.getAllItems('memoryBooks');
        log('记忆书Store已初始化', 'INFO');
    }

    /**
     * Adds a new memory element set.
     */
    async function addElementSet(name, elements) {
        if (!name || !Array.isArray(elements) || elements.length === 0) {
            eventBus.emit('showNotification', { message: '名称和要素不能为空', type: 'error' });
            return false;
        }
        const newSet = {
            id: `mem_set_${generateId(12)}`,
            name,
            elements,
            books: {}
        };
        elementSets.value.push(newSet);
        await dbService.setItem('memoryBooks', newSet);
        eventBus.emit('showNotification', { message: `记忆书 "${name}" 已创建`, type: 'success' });
        return true;
    }

    /**
     * Deletes a memory element set.
     */
    async function deleteElementSet(setId) {
        const index = elementSets.value.findIndex(s => s.id === setId);
        if (index > -1) {
            const setName = elementSets.value[index].name;
            elementSets.value.splice(index, 1);
            await dbService.removeItem('memoryBooks', setId);
            eventBus.emit('showNotification', { message: `记忆书 "${setName}" 已删除`, type: 'success' });
        }
    }

    /**
     * Updates an existing memory element set.
     */
    async function updateElementSet(setId, newName, newElements) {
        const set = elementSets.value.find(s => s.id === setId);
        if (set) {
            set.name = newName;
            set.elements = newElements;
            await dbService.setItem('memoryBooks', set);
            eventBus.emit('showNotification', { message: `记忆书 "${newName}" 已更新`, type: 'success' });
            return true;
        }
        return false;
    }

    /**
     * Generates a memory book for a specific chat and element set by calling the AI.
     */
    async function generateMemoryBook(setId, chatId) {
        const set = elementSets.value.find(s => s.id === setId);
        const chatStore = useChatStore();
        const chatHistory = chatStore.chats[chatId];

        if (!set || !chatHistory?.length) {
            eventBus.emit('showNotification', { message: '没有内容可供记录', type: 'info' });
            return;
        }

        eventBus.emit('showNotification', { message: `正在为 "${set.name}" 生成记忆...`, type: 'info' });

        try {
            const userStore = useUserStore();
            const transcript = chatHistory
                .filter(msg => msg.type === 'text' && !msg.isRetracted && !msg.isThinking)
                .map(msg => {
                    const senderName = msg.sender === userStore.userId ? userStore.userName : (userStore.contacts[msg.sender]?.name || '对方');
                    return `${senderName}: ${msg.content}`;
                }).join('\n');

            const extractedContent = await apiService.extractMemoryElements(set.elements, transcript);

            if (!set.books) set.books = {};
            set.books[chatId] = {
                content: extractedContent.trim(),
                enabled: set.books[chatId]?.enabled || false
            };

            await dbService.setItem('memoryBooks', set);
            eventBus.emit('showNotification', { message: '记忆已生成！', type: 'success' });
        } catch (error) {
            log(`生成记忆书失败: ${error}`, 'ERROR');
            eventBus.emit('showNotification', { message: `生成记忆失败: ${error.message}`, type: 'error' });
        }
    }

    /**
     * Saves user-edited content for a memory book.
     */
    async function saveMemoryBookContent(setId, chatId, newContent) {
        const set = elementSets.value.find(s => s.id === setId);
        if (set?.books?.[chatId]) {
            if (set.books[chatId].content !== newContent) {
                set.books[chatId].content = newContent;
                await dbService.setItem('memoryBooks', set);
                eventBus.emit('showNotification', { message: '记忆已保存', type: 'success' });
            }
        }
    }

    /**
     * Sets the enabled state of a memory book for a specific chat,
     * ensuring only one book can be enabled at a time for that chat.
     */
    async function setMemoryBookEnabled(setId, chatId, isEnabled) {
        const promises = [];
        elementSets.value.forEach(set => {
            if (!set.books) set.books = {};
            if (!set.books[chatId]) {
                set.books[chatId] = { content: '', enabled: false };
            }

            let changed = false;
            if (set.id === setId) {
                if (set.books[chatId].enabled !== isEnabled) {
                    set.books[chatId].enabled = isEnabled;
                    changed = true;
                }
            } else if (isEnabled && set.books[chatId].enabled) {
                set.books[chatId].enabled = false;
                changed = true;
            }

            if (changed) {
                promises.push(dbService.setItem('memoryBooks', set));
            }
        });
        await Promise.all(promises);
        log(`记忆书启用状态已更新 (Chat: ${chatId})`, 'INFO');
    }

    /**
     * Gets the concatenated content of all enabled memory books for a chat.
     */
    function getEnabledMemoryForChat(chatId) {
        let combinedContent = "";
        elementSets.value.forEach(set => {
            if (set.books?.[chatId]?.enabled && set.books[chatId].content) {
                combinedContent += `--- ${set.name} ---\n${set.books[chatId].content}\n\n`;
            }
        });
        return combinedContent.trim();
    }

    return {
        elementSets,
        init,
        addElementSet,
        deleteElementSet,
        updateElementSet,
        generateMemoryBook,
        saveMemoryBookContent,
        setMemoryBookEnabled,
        getEnabledMemoryForChat,
    };
});