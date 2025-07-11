
/**
 * @file CharacterCardManager.js
 * @description 管理角色卡的导入和导出功能。
 *              MODIFIED: 导出时将头像转换为Base64嵌入，实现角色卡独立。
 * @module CharacterCardManager
 * @exports {object} CharacterCardManager
 * @dependencies Utils, NotificationUIManager, ThemeLoader, UserManager, ChatManager, ModalUIManager
 */
const CharacterCardManager = {
    importBtn: null,
    exportBtn: null,
    importFileInput: null,

    /**
     * 初始化模块，获取DOM元素并绑定事件。
     */
    init: function() {
        this.importBtn = document.getElementById('importCharacterCardBtn');
        this.exportBtn = document.getElementById('exportThemeCharactersBtn');
        this.importFileInput = document.getElementById('characterCardInput');

        if (!this.importBtn || !this.exportBtn || !this.importFileInput) {
            Utils.log('CharacterCardManager: 未找到所有角色卡UI元素。', Utils.logLevels.WARN);
            return;
        }

        this.importBtn.addEventListener('click', () => this.importFileInput.click());
        this.exportBtn.addEventListener('click', this.handleExportClick.bind(this));
        this.importFileInput.addEventListener('change', this.handleFileSelect.bind(this));

        Utils.log("CharacterCardManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * @private
     * 将图片URL转换为Base64 Data URL。
     * @param {string} url - 图片的URL。
     * @returns {Promise<string|null>} - Base64 Data URL 或在失败时返回 null。
     */
    _imageToBase64: async function(url) {
        if (!url) return null;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`获取图片失败: ${response.statusText}`);
            }
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            Utils.log(`转换图片为Base64失败 (URL: ${url}): ${error}`, Utils.logLevels.ERROR);
            return null;
        }
    },

    /**
     * 处理导出按钮点击事件。
     * 兼容原生安卓环境和普通浏览器环境。
     */
    handleExportClick: async function() {
        const themeSpecialContacts = ThemeLoader.getCurrentSpecialContactsDefinitions();
        if (!themeSpecialContacts || themeSpecialContacts.length === 0) {
            NotificationUIManager.showNotification('当前主题没有可导出的特殊联系人。', 'info');
            return;
        }

        NotificationUIManager.showNotification('正在准备角色数据，请稍候...', 'info');

        const exportPromises = themeSpecialContacts.map(async (contact) => {
            const cleanContact = { ...contact };
            delete cleanContact.lastMessage;
            delete cleanContact.lastTime;
            delete cleanContact.unread;
            delete cleanContact.selectedChapterId;
            if (cleanContact.avatarUrl) {
                const dataUrl = await this._imageToBase64(cleanContact.avatarUrl);
                if (dataUrl) {
                    cleanContact.avatarDataUrl = dataUrl;
                }
                delete cleanContact.avatarUrl;
            }
            return cleanContact;
        });

        try {
            const charactersToExport = await Promise.all(exportPromises);
            const jsonData = JSON.stringify(charactersToExport, null, 2);
            const themeKey = ThemeLoader.getCurrentThemeKey();
            const themeName = themeKey ? themeKey.replace(/-[^-]*$/, '') : 'Characters';
            const fileName = `WebChat_Theme_${themeName}_Characters.json`;

            // --- 修改的核心部分 ---
            // 检查是否存在我们注入的安卓原生接口
            if (window.Android && typeof window.Android.saveFile === 'function') {
                // 如果在我们的安卓应用中，直接调用原生方法保存文件
                Utils.log("检测到安卓原生接口，调用 saveFile...", Utils.logLevels.INFO);
                window.Android.saveFile(jsonData, fileName);
                NotificationUIManager.showNotification('正在通过原生应用导出角色...', 'success');
            } else {
                // 如果不在安卓应用中（例如在PC浏览器），使用传统方法下载
                Utils.log("未检测到安卓原生接口，使用浏览器下载...", Utils.logLevels.INFO);
                const blob = new Blob([jsonData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                NotificationUIManager.showNotification('当前主题角色已开始导出。', 'success');
            }
            // --- 修改结束 ---

        } catch (error) {
            NotificationUIManager.showNotification('导出角色时发生错误，请检查控制台。', 'error');
            Utils.log(`导出角色卡失败: ${error}`, Utils.logLevels.ERROR);
        }
    },


    /**
     * 处理文件选择事件。
     * @param {Event} event - 文件输入框的change事件。
     */
    handleFileSelect: function(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (file.type !== 'application/json') {
            NotificationUIManager.showNotification('导入失败：请选择一个 .json 格式的角色卡文件。', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const characters = JSON.parse(e.target.result);
                if (!Array.isArray(characters)) {
                    throw new Error("JSON文件内容不是一个有效的数组。");
                }

                let successCount = 0;
                for (const charData of characters) {
                    if (this.validateCharacterData(charData)) {
                        await this.processImportedCharacter(charData);
                        successCount++;
                    } else {
                        Utils.log(`导入时跳过无效的角色数据: ${JSON.stringify(charData)}`, Utils.logLevels.WARN);
                    }
                }
                NotificationUIManager.showNotification(`成功导入 ${successCount} 个角色。`, 'success');
                if (successCount > 0) {
                    ChatManager.renderChatList(ChatManager.currentFilter);
                    ModalUIManager.toggleModal('newContactGroupModal', false);
                }
            } catch (error) {
                NotificationUIManager.showNotification(`导入失败：${error.message}`, 'error');
                Utils.log(`解析角色卡文件失败: ${error}`, Utils.logLevels.ERROR);
            } finally {
                // 重置文件输入，以便可以再次选择相同的文件
                event.target.value = '';
            }
        };
        reader.onerror = () => {
            NotificationUIManager.showNotification('读取文件时发生错误。', 'error');
            event.target.value = '';
        }
        reader.readAsText(file);
    },

    /**
     * 验证导入的角色数据是否包含必要字段。
     * @param {object} charData - 单个角色数据对象。
     * @returns {boolean} - 是否有效。
     */
    validateCharacterData: function(charData) {
        return charData && typeof charData.name === 'string' && typeof charData.isAI === 'boolean' && charData.aiConfig;
    },

    /**
     * 处理单个导入的角色数据，为其添加特殊标记并保存。
     * @param {object} charData - 单个角色数据对象。
     * @returns {Promise<void>}
     */
    processImportedCharacter: async function(charData) {
        // 创建一个全新的联系人对象，只从导入数据中提取必要字段
        const newContact = {
            id: `imported_${Utils.generateId(16)}`, // 生成唯一的、带前缀的ID
            name: `[导入] ${charData.name}`,
            isAI: true,
            isSpecial: true,
            isImported: true, // 关键标记
            type: 'contact',
            lastMessage: charData.initialMessage || "你好，很高兴认识你！",
            lastTime: new Date().toISOString(),
            unread: 0,
            avatarText: charData.avatarText || charData.name.charAt(0).toUpperCase(),
            // MODIFIED: 使用 avatarDataUrl 作为 avatarUrl
            avatarUrl: charData.avatarDataUrl || charData.avatarUrl || null,
            aboutDetails: charData.aboutDetails || null,
            aiConfig: charData.aiConfig,
            chapters: charData.chapters || [],
            selectedChapterId: null // 导入时重置已选篇章
        };

        // 确保 aiConfig 和 tts 结构完整
        if (!newContact.aiConfig.tts) {
            newContact.aiConfig.tts = {};
        }
        if (newContact.aiConfig.tts.tts_mode === undefined) newContact.aiConfig.tts.tts_mode = 'Preset';
        if (newContact.aiConfig.tts.version === undefined) newContact.aiConfig.tts.version = 'v4';

        await UserManager.addContact(newContact);
    }
};