/**
 * @file 主题加载器
 * @description 负责在应用初始化早期，根据用户本地存储偏好和系统设置来决定并应用正确的主题。
 *              它会动态加载主题 CSS 文件、主题数据（如特殊联系人定义），并支持无刷新切换。
 *              同时，它还管理浅色和深色模式下自定义背景图片的加载、缓存和应用。
 * @module ThemeLoader
 * @exports {object} ThemeLoader - 主要通过其 `applyTheme` 方法和几个 getter 与其他模块交互。
 * @dependency Utils, EventEmitter, DBManager
 */
const ThemeLoader = {
    // ==========================================================================
    // 常量与配置
    // ==========================================================================
    // 定义所有可用的主题及其 CSS 和数据文件路径
    themes: {
        "原神-浅色": { name: "原神", css: "css/动漫/原神-浅色.css", dataJs: "data/动漫/原神.json", defaultSpecialContacts: true  },
        "原神-深色": { name: "原神", css: "css/动漫/原神-深色.css", dataJs: "data/动漫/原神.json" },
        "迷宫饭-浅色": { name: "迷宫饭", css: "css/动漫/迷宫饭-浅色.css", dataJs: "data/动漫/迷宫饭.json" },
        "迷宫饭-深色": { name: "迷宫饭", css: "css/动漫/迷宫饭-深色.css", dataJs: "data/动漫/迷宫饭.json" },
        "斗破苍穹-浅色": { name: "斗破苍穹", css: "css/动漫/斗破苍穹-浅色.css", dataJs: "data/动漫/斗破苍穹.json" },
        "斗破苍穹-深色": { name: "斗破苍穹", css: "css/动漫/斗破苍穹-深色.css", dataJs: "data/动漫/斗破苍穹.json" },
        "崩坏3-浅色": { name: "崩坏3", css: "css/动漫/崩坏3-浅色.css", dataJs: "data/动漫/崩坏3.json" },
        "崩坏3-深色": { name: "崩坏3", css: "css/动漫/崩坏3-深色.css", dataJs: "data/动漫/崩坏3.json" },
        "蜡笔小新-浅色": { name: "蜡笔小新", css: "css/动漫/蜡笔小新-浅色.css", dataJs: "data/动漫/蜡笔小新.json"},
        "蜡笔小新-深色": { name: "蜡笔小新", css: "css/动漫/蜡笔小新-深色.css", dataJs: "data/动漫/蜡笔小新.json" },
        "英语-深色": { name: "英语", css: "css/教育/英语-深色.css", dataJs: "data/教育/英语.json" },
        "英语-浅色": { name: "英语", css: "css/教育/英语-浅色.css", dataJs: "data/教育/英语.json" },
        "计算机科学-深色": { name: "计算机科学", css: "css/教育/计算机科学-深色.css", dataJs: "data/教育/计算机科学.json" },
        "计算机科学-浅色": { name: "计算机科学", css: "css/教育/计算机科学-浅色.css", dataJs: "data/教育/计算机科学.json" },
        "MCP-深色": { name: "MCP", css: "css/系统/MCP-深色.css", dataJs: "data/系统/MCP.json" },
        "MCP-浅色": { name: "MCP", css: "css/系统/MCP-浅色.css", dataJs: "data/系统/MCP.json" },
        // NOTE: 以下为注释掉的主题，未来可启用
        // "鸣潮-浅色": { name: "鸣潮", css: "css/动漫/鸣潮-浅色.css", dataJs: "data/动漫/鸣潮.json" },
        // "鸣潮-深色": { name: "鸣潮", css: "css/动漫/鸣潮-深色.css", dataJs: "data/动漫/鸣潮.json" },
    },
    // localStorage 中存储用户配色方案偏好('auto', 'light', 'dark')的键名
    COLOR_SCHEME_KEY: 'selectedColorScheme',
    // 当用户未指定时，默认的配色方案
    DEFAULT_COLOR_SCHEME: 'light',

    // ==========================================================================
    // 内部状态变量
    // ==========================================================================
    _currentEffectiveColorScheme: 'light', // 当前实际生效的配色方案 ('light' 或 'dark')
    _currentThemeKey: null, // 当前已应用的主题的键名 (例如："原神-浅色")
    _systemColorSchemeListener: null, // 系统配色方案变化的媒体查询监听器引用
    _currentSpecialContactsDefinitions: [], // 存储当前主题加载的特殊联系人定义数组
    _currentInjectedBackgroundUrl: null, // 存储当前注入背景图的 Object URL，用于后续释放内存

    /**
     * 初始化主题加载器
     * @description 此函数应在应用启动的早期被调用，它会完成主题和背景的首次加载。
     * @function init
     * @returns {Promise<void>}
     */
    async init() {
        // --- 流程如下 ---
        // 1. 确定并设置初始的有效配色方案（light/dark）
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme);

        // 2. 根据存储的偏好和当前配色方案，决定要加载的主题
        let savedThemeKey = localStorage.getItem('selectedTheme');
        let themeToLoadKey;

        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            // 如果存在已保存的主题，且该主题与当前配色方案兼容，则直接使用
            themeToLoadKey = savedThemeKey;
        } else {
            // 否则，需要寻找一个合适的新主题
            let newThemeKey;
            if (savedThemeKey && this.themes[savedThemeKey]) {
                // 尝试找到当前主题的“反色”版本
                const baseName = this._getBaseThemeName(savedThemeKey);
                const suffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
                const counterpartKey = `${baseName}-${suffix}`;
                if (this.themes[counterpartKey]) {
                    newThemeKey = counterpartKey;
                }
            }
            // 如果找不到对应版本，或从未保存过主题，则查找一个默认的备用主题
            if (!newThemeKey) {
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }
            themeToLoadKey = newThemeKey;
        }

        // 3. 加载主题的 CSS 和数据
        await this._loadThemeCore(themeToLoadKey);

        // 4. 设置系统颜色方案变化的监听器 (如果用户选择'auto')
        this._setupSystemColorSchemeListener(preferredColorScheme);

        // 5. 加载并应用缓存的自定义背景图片
        await this._updateCustomBackground();

        (Utils?.log || console.log)("ThemeLoader: 初始化完成。", Utils?.logLevels?.INFO || 1);
    },

    /**
     * 应用一个新主题 (无刷新切换)
     * @description 动态切换主题的 CSS 和数据，并发出 'themeChanged' 事件。
     * @function applyTheme
     * @param {string} themeKey - 要应用的主题的键名。
     * @returns {Promise<void>}
     */
    async applyTheme(themeKey) {
        // 1. 验证主题键的有效性，无效则回退到备用主题
        if (!this.themes[themeKey]) {
            (Utils?.log || console.log)(`ThemeLoader: 尝试应用无效的主题键: ${themeKey}。正在回退。`, Utils?.logLevels?.ERROR || 3);
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }

        // 2. 加载新主题的核心资源 (CSS 和数据)
        await this._loadThemeCore(themeKey);

        // 3. 发出事件，通知其他模块主题已变更
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('themeChanged', {
                newThemeKey: themeKey,
                newDefinitions: [...this._currentSpecialContactsDefinitions] // 传递新数据的副本
            });
            (Utils?.log || console.log)(`ThemeLoader: 已为 ${themeKey} 触发 themeChanged 事件。`, Utils?.logLevels?.INFO || 1);
        } else {
            console.warn("ThemeLoader: EventEmitter 未定义，无法触发 themeChanged 事件。");
        }
    },

    /**
     * 设置并缓存自定义背景图片
     * @description 为指定的配色方案设置背景图，存入 IndexedDB，并立即应用（如果适用）。
     * @function setBackgroundImage
     * @param {Blob} imageBlob - 用户选择的图片 Blob 对象。
     * @param {'light'|'dark'} colorSchemeType - 该背景图适用的配色方案。
     * @returns {Promise<void>}
     */
    async setBackgroundImage(imageBlob, colorSchemeType) {
        // 1. 参数校验
        if (!(imageBlob instanceof Blob)) {
            (Utils?.log || console.log)("ThemeLoader.setBackgroundImage: 提供的不是 Blob 对象。", Utils?.logLevels?.ERROR || 3);
            return;
        }
        if (colorSchemeType !== 'light' && colorSchemeType !== 'dark') {
            (Utils?.log || console.log)(`ThemeLoader.setBackgroundImage: 无效的 colorSchemeType: ${colorSchemeType}`, Utils?.logLevels?.ERROR || 3);
            return;
        }

        try {
            // 2. 将图片 Blob 存入 IndexedDB
            const dbKey = `background_image_${colorSchemeType}`;
            await DBManager.setItem('appStateCache', { id: dbKey, imageBlob: imageBlob });

            // 3. 如果设置的背景与当前生效的配色方案匹配，则立即更新背景
            if (colorSchemeType === this.getCurrentEffectiveColorScheme()) {
                await this._updateCustomBackground();
            }

            (Utils?.log || console.log)(`ThemeLoader: 新的 ${colorSchemeType} 模式背景图片已应用并缓存。`, Utils?.logLevels?.INFO || 1);
        } catch (error) {
            (Utils?.log || console.log)(`ThemeLoader: 设置或缓存背景图片时出错: ${error}`, Utils?.logLevels?.ERROR || 3);
            if (typeof NotificationUIManager !== 'undefined') {
                NotificationUIManager.showNotification('设置背景图片失败。', 'error');
            }
        }
    },

    /**
     * 移除自定义背景图片
     * @description 从 IndexedDB 中删除指定配色方案的背景图，并移除页面样式。
     * @function removeBackgroundImage
     * @param {'light'|'dark'} colorSchemeType - 要移除背景图的配色方案。
     * @returns {Promise<void>}
     */
    async removeBackgroundImage(colorSchemeType) {
        if (colorSchemeType !== 'light' && colorSchemeType !== 'dark') {
            (Utils?.log || console.log)(`ThemeLoader.removeBackgroundImage: 无效的 colorSchemeType: ${colorSchemeType}`, Utils?.logLevels?.ERROR || 3);
            return;
        }
        try {
            // 1. 从 IndexedDB 移除数据
            const dbKey = `background_image_${colorSchemeType}`;
            await DBManager.removeItem('appStateCache', dbKey);

            // 2. 如果移除的背景与当前生效的配色方案匹配，则立即更新（即移除）背景
            if (colorSchemeType === this.getCurrentEffectiveColorScheme()) {
                await this._updateCustomBackground();
            }

            (Utils?.log || console.log)(`ThemeLoader: ${colorSchemeType} 模式的背景图片已移除并从缓存中清除。`, Utils?.logLevels?.INFO || 1);
        } catch (error) {
            (Utils?.log || console.log)(`ThemeLoader: 移除背景图片时出错: ${error}`, Utils?.logLevels?.ERROR || 3);
            if (typeof NotificationUIManager !== 'undefined') {
                NotificationUIManager.showNotification('移除背景图片失败。', 'error');
            }
        }
    },

    /**
     * 更新用户的配色方案偏好
     * @description 当用户在设置中更改配色方案（如从'light'切换到'auto'）时调用此方法。
     * @function updateColorSchemePreference
     * @param {string} newSchemeKeyFromUser - 用户选择的新配色方案键 ('auto', 'light', 'dark')。
     * @returns {Promise<void>}
     */
    async updateColorSchemePreference(newSchemeKeyFromUser) {
        const newEffectiveColorScheme = this._getEffectiveColorScheme(newSchemeKeyFromUser);
        const currentStoredScheme = localStorage.getItem(this.COLOR_SCHEME_KEY);

        // 1. 检查新旧配置是否有变化，无变化则不执行任何操作
        if (newEffectiveColorScheme !== this._currentEffectiveColorScheme || newSchemeKeyFromUser !== currentStoredScheme) {
            // 2. 更新内部状态和 localStorage
            this._currentEffectiveColorScheme = newEffectiveColorScheme;
            localStorage.setItem(this.COLOR_SCHEME_KEY, newSchemeKeyFromUser);
            (Utils?.log || console.log)(`ThemeLoader: 配色方案偏好已更新为 '${newSchemeKeyFromUser}'。生效方案: '${this._currentEffectiveColorScheme}'`, Utils?.logLevels?.INFO || 1);

            // 3. 寻找与新配色方案兼容的主题
            let themeToApplyKey;
            const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
            const targetSuffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
            const candidateThemeKey = `${currentBaseName}-${targetSuffix}`;

            if (this.themes[candidateThemeKey]) {
                themeToApplyKey = candidateThemeKey; // 优先使用当前主题的对应版本
            } else {
                themeToApplyKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme); // 否则查找备用
            }

            // 4. 应用新主题，更新背景图，并重设系统监听器
            await this.applyTheme(themeToApplyKey);
            await this._updateCustomBackground();
            this._setupSystemColorSchemeListener(newSchemeKeyFromUser);
        }
    },

    /**
     * 获取当前主题的特殊联系人定义
     * @description 返回当前已加载主题所包含的特殊联系人数据数组的副本。
     * @function getCurrentSpecialContactsDefinitions
     * @returns {Array<object>} - 特殊联系人定义的数组。
     */
    getCurrentSpecialContactsDefinitions() {
        // 返回副本以防止外部直接修改内部状态
        return [...this._currentSpecialContactsDefinitions];
    },

    /**
     * 获取当前生效的配色方案
     * @function getCurrentEffectiveColorScheme
     * @returns {string} - 返回 'light' 或 'dark'。
     */
    getCurrentEffectiveColorScheme: function() {
        return this._currentEffectiveColorScheme;
    },

    /**
     * 获取当前应用的主题键名
     * @function getCurrentThemeKey
     * @returns {string|null} - 返回当前主题的键名，例如 "原神-深色"。
     */
    getCurrentThemeKey: function() {
        return this._currentThemeKey;
    },

    // --------------------------------------------------------------------------
    // 内部辅助函数 (Private)
    // --------------------------------------------------------------------------

    /**
     * 实际加载主题 CSS 和数据的核心逻辑 (内部函数)
     * @function _loadThemeCore
     * @param {string} themeKey - 要加载的主题键名。
     * @returns {Promise<void>}
     * @private
     */
    async _loadThemeCore(themeKey) {
        const themeConfig = this.themes[themeKey];
        if (!themeConfig) {
            console.error(`ThemeLoader: 未找到键为 "${themeKey}" 的主题。`);
            return;
        }

        // 1. 动态更新页面中的主题 CSS 文件链接
        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (themeStylesheet && themeConfig.css) {
            themeStylesheet.setAttribute('href', themeConfig.css);
        } else if (!themeStylesheet) {
            console.error("ThemeLoader: 严重错误 - 未找到 'theme-stylesheet' 元素。");
        } else {
            themeStylesheet.setAttribute('href', ''); // 如果主题没有CSS，则清空链接
        }

        // 2. 异步加载并解析与主题关联的数据文件
        this._currentSpecialContactsDefinitions = await this._parseDataJson(themeConfig.dataJs);

        // 3. 更新内部状态并持久化到 localStorage
        this._currentThemeKey = themeKey;
        localStorage.setItem('selectedTheme', themeKey);
    },

    /**
     * 异步加载并解析数据 JSON 文件 (内部函数)
     * @description 会处理 `chaptersFilePath` 字段，以动态加载 AI 联系人的词汇篇章数据。
     * @function _parseDataJson
     * @param {string|null} dataJsonUrl - 数据 JSON 文件的 URL。
     * @returns {Promise<Array<object>>} - 解析后的特殊联系人定义数组。
     * @private
     */
    _parseDataJson: async function(dataJsonUrl) {
        if (!dataJsonUrl) return [];
        try {
            // 1. 获取主数据文件
            const response = await fetch(dataJsonUrl);
            if (!response.ok) {
                (Utils?.log || console.log)(`ThemeLoader: 获取 data JSON 失败 ${dataJsonUrl}: ${response.statusText}`, Utils?.logLevels?.WARN || 2);
                return [];
            }
            const definitions = await response.json();

            if (!Array.isArray(definitions)) {
                (Utils?.log || console.log)(`ThemeLoader: 从 ${dataJsonUrl} 解析的内容不是数组。`, Utils?.logLevels?.WARN || 2);
                return [];
            }

            // 2. 遍历每个联系人定义，处理其词汇篇章
            for (const def of definitions) {
                if (def.isAI && def.chaptersFilePath) {
                    // 2.1 如果是 AI 联系人且定义了篇章文件路径，则异步获取篇章数据
                    try {
                        const chaptersResponse = await fetch(def.chaptersFilePath);
                        if (chaptersResponse.ok) {
                            def.chapters = await chaptersResponse.json();
                        } else {
                            def.chapters = [];
                        }
                    } catch (chapError) {
                        def.chapters = [];
                    }
                    delete def.chaptersFilePath; // 移除路径属性，因为它已被处理
                }

                // 2.2 确保每个定义都有 chapters 数组，并对每个篇章进行校验和标准化
                if (!def.chapters || !Array.isArray(def.chapters)) {
                    def.chapters = [];
                }
                def.chapters = def.chapters.map(chapter => ({
                    id: chapter.id || `chapter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    name: chapter.name || "未命名篇章",
                    promptModifier: chapter.promptModifier || ""
                }));
            }
            return definitions;

        } catch (error) {
            (Utils?.log || console.log)(`ThemeLoader: 加载或解析 data JSON ${dataJsonUrl} 时出错: ${error}`, Utils?.logLevels?.ERROR || 3);
            return [];
        }
    },

    /**
     * 将背景图样式注入到页面中 (内部函数)
     * @function _injectBackgroundStyle
     * @param {string} imageUrl - 要应用的图片的 URL (通常是 Object URL)。
     * @private
     */
    _injectBackgroundStyle(imageUrl) {
        // 1. 释放之前可能存在的 Object URL，防止内存泄漏
        if (this._currentInjectedBackgroundUrl) {
            URL.revokeObjectURL(this._currentInjectedBackgroundUrl);
        }
        this._currentInjectedBackgroundUrl = imageUrl; // 存储新的 URL

        // 2. 查找或创建用于注入背景样式的 <style> 标签
        const styleId = 'custom-background-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
        }

        // 3. 注入 CSS 规则
        styleTag.textContent = `
            body {
                background-image: url(${imageUrl}) !important;
                backdrop-filter: blur(10px) !important;
                background-repeat: no-repeat !important;
                background-size: cover !important;
                background-attachment: fixed !important;
                background-position-x: center !important;
            }
        `;
    },

    /**
     * 移除自定义背景图样式 (内部函数)
     * @function _removeBackgroundStyle
     * @private
     */
    _removeBackgroundStyle() {
        if (this._currentInjectedBackgroundUrl) {
            URL.revokeObjectURL(this._currentInjectedBackgroundUrl);
            this._currentInjectedBackgroundUrl = null;
        }
        const styleTag = document.getElementById('custom-background-style');
        if (styleTag) {
            styleTag.remove();
        }
    },

    /**
     * 根据当前配色方案更新自定义背景 (内部函数)
     * @description 从 IndexedDB 加载并应用对应配色方案的背景图。
     * @function _updateCustomBackground
     * @private
     */
    async _updateCustomBackground() {
        const scheme = this.getCurrentEffectiveColorScheme();
        const dbKey = `background_image_${scheme}`;
        try {
            // 1. 从 IndexedDB 读取背景图数据
            const backgroundItem = await DBManager.getItem('appStateCache', dbKey);
            if (backgroundItem && backgroundItem.imageBlob instanceof Blob) {
                // 2. 如果找到数据，创建 Object URL 并注入样式
                const imageUrl = URL.createObjectURL(backgroundItem.imageBlob);
                this._injectBackgroundStyle(imageUrl);
            } else {
                // 3. 如果未找到，则移除任何现有的自定义背景
                this._removeBackgroundStyle();
            }
        } catch (error) {
            this._removeBackgroundStyle();
        }
    },

    /**
     * 从完整主题键名中提取基础名称 (内部函数)
     * @function _getBaseThemeName
     * @param {string} themeKey - 完整的主题键名 (如 "原神-浅色")。
     * @returns {string} - 主题的基础名称 (如 "原神")。
     * @private
     */
    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown";
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, "");
    },

    /**
     * 检查主题是否与配色方案兼容 (内部函数)
     * @function _isThemeCompatible
     * @param {string} themeKey - 要检查的主题键名。
     * @param {string} colorScheme - 配色方案 ('light' 或 'dark')。
     * @returns {boolean} - 是否兼容。
     * @private
     */
    _isThemeCompatible: function(themeKey, colorScheme) {
        if (!this.themes[themeKey]) return false;
        if (colorScheme === 'light') return themeKey.endsWith('-浅色');
        if (colorScheme === 'dark') return themeKey.endsWith('-深色');
        return false;
    },

    /**
     * 根据用户偏好确定实际生效的配色方案 (内部函数)
     * @function _getEffectiveColorScheme
     * @param {string} preferredScheme - 用户的偏好设置 ('auto', 'light', 'dark')。
     * @returns {string} - 'light' 或 'dark'。
     * @private
     */
    _getEffectiveColorScheme: function(preferredScheme) {
        if (preferredScheme === 'light') return 'light';
        if (preferredScheme === 'dark') return 'dark';
        // 对于 'auto'，检测系统设置
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light'; // 默认回退到浅色模式
    },

    /**
     * 为给定的配色方案查找一个备用主题 (内部函数)
     * @function _findFallbackThemeKeyForScheme
     * @param {string} colorScheme - 'light' 或 'dark'。
     * @returns {string} - 找到的备用主题的键名。
     * @private
     */
    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
        // 1. 遍历所有主题，寻找第一个匹配后缀的主题
        for (const key in this.themes) {
            if (key.endsWith(suffix)) return key;
        }
        // 2. 如果找不到，回退到列表中的第一个主题
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            return firstKey;
        }
        // 3. 极端情况，如果一个主题都没有，返回一个硬编码的最终备用项
        console.error("ThemeLoader: 严重错误 - ThemeLoader.themes 中未定义任何主题。");
        return '原神-浅色';
    },

    /**
     * 设置系统配色方案变化监听器 (内部函数)
     * @description 如果用户偏好为 'auto'，则监听系统变化并自动切换主题。
     * @function _setupSystemColorSchemeListener
     * @param {string} preferredScheme - 用户的偏好设置。
     * @private
     */
    _setupSystemColorSchemeListener: function(preferredScheme) {
        if (typeof window === 'undefined' || !window.matchMedia) return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        // 1. 移除旧的监听器以防重复
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        // 2. 如果用户设置为 'auto'，则添加新的监听器
        if (preferredScheme === 'auto') {
            this._systemColorSchemeListener = async (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light';
                // 3. 当系统方案变化且与当前应用方案不同时，触发更新
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme;

                    // 4. 寻找并应用新方案下的兼容主题
                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApplyKey = `${currentBaseName}-${newSuffix}`;

                    if (!this.themes[newThemeToApplyKey]) {
                        newThemeToApplyKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    await this.applyTheme(newThemeToApplyKey);
                    await this._updateCustomBackground();
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener);
        }
    },
};