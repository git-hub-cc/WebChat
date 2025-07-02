/**
 * @file CharacterCardManager.js
 * @description 管理角色卡的导入和导出功能。
 *              修改说明：导出时会将角色头像转换为 Base64 格式并嵌入 JSON 文件，以实现角色卡的独立性和可移植性。
 * @module CharacterCardManager
 * @exports {object} CharacterCardManager - 对外暴露的单例对象，包含角色卡管理功能。
 * @dependency Utils, NotificationUIManager, ThemeLoader, UserManager, ChatManager, ModalUIManager
 */
const CharacterCardManager = {
    // 导入按钮的 DOM 元素引用
    importBtn: null,
    // 导出按钮的 DOM 元素引用
    exportBtn: null,
    // 用于选择文件的隐藏 input 元素引用
    importFileInput: null,

    /**
     * 初始化模块，获取 DOM 元素引用并绑定事件监听器。
     * @function init
     */
    init: function() {
        this.importBtn = document.getElementById('importCharacterCardBtn');
        this.exportBtn = document.getElementById('exportThemeCharactersBtn');
        this.importFileInput = document.getElementById('characterCardInput');

        if (!this.importBtn || !this.exportBtn || !this.importFileInput) {
            Utils.log('CharacterCardManager: 未找到所有角色卡UI元素。', Utils.logLevels.WARN);
            return;
        }

        // 绑定事件
        this.importBtn.addEventListener('click', () => this.importFileInput.click());
        this.exportBtn.addEventListener('click', this.handleExportClick.bind(this));
        this.importFileInput.addEventListener('change', this.handleFileSelect.bind(this));

        Utils.log("CharacterCardManager 初始化完成。", Utils.logLevels.INFO);
    },

    /**
     * 处理导出按钮的点击事件，导出当前主题下的所有特殊联系人。
     * @function handleExportClick
     */
    handleExportClick: async function() {
        // 1. 获取当前主题定义的特殊联系人
        const themeSpecialContacts = ThemeLoader.getCurrentSpecialContactsDefinitions();
        if (!themeSpecialContacts || themeSpecialContacts.length === 0) {
            NotificationUIManager.showNotification('当前主题没有可导出的特殊联系人。', 'info');
            return;
        }

        NotificationUIManager.showNotification('正在准备角色数据，请稍候...', 'info');

        // 2. 并行处理所有角色数据的准备工作，特别是头像的 Base64 转换
        const exportPromises = themeSpecialContacts.map(async (contact) => {
            const cleanContact = { ...contact };
            // 移除运行时的状态信息，保持角色卡纯净
            delete cleanContact.lastMessage;
            delete cleanContact.lastTime;
            delete cleanContact.unread;
            delete cleanContact.selectedChapterId;

            // MODIFIED: 将头像 URL 转换为 Base64 Data URL
            if (cleanContact.avatarUrl) {
                const dataUrl = await this._imageToBase64(cleanContact.avatarUrl);
                if (dataUrl) {
                    cleanContact.avatarDataUrl = dataUrl; // 使用新字段存储 Base64 数据
                }
                delete cleanContact.avatarUrl; // 移除旧的 URL 字段
            }

            return cleanContact;
        });

        try {
            // 3. 等待所有角色数据处理完成
            const charactersToExport = await Promise.all(exportPromises);

            // 4. 将角色数据数组序列化为 JSON 字符串
            const jsonData = JSON.stringify(charactersToExport, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            // 5. 创建下载链接并触发下载
            const a = document.createElement('a');
            const themeKey = ThemeLoader.getCurrentThemeKey();
            const themeName = themeKey ? themeKey.replace(/-[^-]*$/, '') : 'Characters';
            a.href = url;
            a.download = `PPMC_Theme_${themeName}_Characters.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            NotificationUIManager.showNotification('当前主题角色已开始导出。', 'success');
        } catch (error) {
            NotificationUIManager.showNotification('导出角色时发生错误，请检查控制台。', 'error');
            Utils.log(`导出角色卡失败: ${error}`, Utils.logLevels.ERROR);
        }
    },


    /**
     * 处理用户选择文件后的事件。
     * @function handleFileSelect
     * @param {Event} event - 文件输入框的 change 事件对象。
     */
    handleFileSelect: function(event) {
        const file = event.target.files[0];
        if (!file) return;

        // 1. 校验文件类型是否为 JSON
        if (file.type !== 'application/json') {
            NotificationUIManager.showNotification('导入失败：请选择一个 .json 格式的角色卡文件。', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // 2. 解析 JSON 文件内容
                const characters = JSON.parse(e.target.result);
                if (!Array.isArray(characters)) {
                    throw new Error("JSON文件内容不是一个有效的数组。");
                }

                // 3. 遍历并处理每个角色数据
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

                // 4. 如果成功导入了角色，则刷新UI
                if (successCount > 0) {
                    Store.dispatch('DATA_MODIFIED'); // <-- 正确的调用
                    ModalUIManager.toggleModal('newContactGroupModal', false);
                }
            } catch (error) {
                NotificationUIManager.showNotification(`导入失败：${error.message}`, 'error');
                Utils.log(`解析角色卡文件失败: ${error}`, Utils.logLevels.ERROR);
            } finally {
                // NOTE: 重置文件输入框的值，以便用户可以再次选择同一个文件
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
     * 验证导入的角色数据对象是否包含必要的字段。
     * @function validateCharacterData
     * @param {object} charData - 单个角色数据对象。
     * @returns {boolean} - 数据是否有效。
     */
    validateCharacterData: function(charData) {
        return charData && typeof charData.name === 'string' && typeof charData.isAI === 'boolean' && charData.aiConfig;
    },

    /**
     * 处理并保存单个导入的角色数据。
     * @function processImportedCharacter
     * @param {object} charData - 经过验证的单个角色数据对象。
     * @returns {Promise<void>}
     */
    processImportedCharacter: async function(charData) {
        // 1. 创建一个全新的联系人对象，只从导入数据中提取必要字段，并添加导入标记
        const newContact = {
            id: `imported_${Utils.generateId(16)}`, // 生成唯一的、带前缀的ID，避免冲突
            name: `[导入] ${charData.name}`, // 在名称前添加前缀以区分
            isAI: true,
            isSpecial: true,
            isImported: true, // 关键标记，表示这是导入的角色
            type: 'contact',
            lastMessage: charData.initialMessage || "你好，很高兴认识你！",
            lastTime: new Date().toISOString(),
            unread: 0,
            avatarText: charData.avatarText || charData.name.charAt(0).toUpperCase(),
            // MODIFIED: 优先使用 Base64 数据作为头像，兼容旧的 URL 格式
            avatarUrl: charData.avatarDataUrl || charData.avatarUrl || null,
            aboutDetails: charData.aboutDetails || null,
            aiConfig: charData.aiConfig,
            chapters: charData.chapters || [],
            selectedChapterId: null // 导入时重置已选篇章状态
        };

        // 2. 确保 aiConfig 和 tts 结构完整，提供默认值以避免运行时错误
        if (!newContact.aiConfig.tts) {
            newContact.aiConfig.tts = {};
        }
        if (newContact.aiConfig.tts.tts_mode === undefined) newContact.aiConfig.tts.tts_mode = 'Preset';
        if (newContact.aiConfig.tts.version === undefined) newContact.aiConfig.tts.version = 'v4';

        // 3. 调用 UserManager 将新联系人添加到系统中
        await UserManager.addContact(newContact);
    },

    /**
     * @private
     * 将图片URL转换为Base64编码的Data URL。
     * @function _imageToBase64
     * @param {string} url - 图片的URL地址。
     * @returns {Promise<string|null>} - 返回 Base64 格式的 Data URL，如果转换失败则返回 null。
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
};