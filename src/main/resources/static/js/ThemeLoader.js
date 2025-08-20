
/**
 * @file ThemeLoader.js
 * @description 主题加载器。这是一个在应用初始化早期执行的关键脚本，
 *              负责根据用户的本地存储偏好和系统设置（浅色/深色模式）来决定并应用正确的主题。
 *              它会加载相应的主题 CSS 文件和与主题相关的数据 JSON 文件（如特殊联系人定义，包括关卡篇章）。
 *              现在支持无刷新切换主题和动态加载数据。
 *              更新：AI 联系人的关卡篇章数据现在可以从其定义中的 `chaptersFilePath` 指定的单独 JSON 文件加载。
 *              新增：支持从缓存加载和应用自定义背景图片。
 *              MODIFIED: 支持为浅色和深色模式分别设置、缓存和应用自定义背景图片。
 *              OPTIMIZED: applyTheme 现在会立即切换CSS，并在后台异步加载数据，以提高UI响应速度。
 *              OPTIMIZED: _parseDataJson现在使用Promise.all并行加载所有关卡篇章文件，以加快主题切换速度。
 *              OPTIMIZED: 切换主题时使用 View Transitions API 实现圆形扩散过渡动画，提升切换体验。
 * @module ThemeLoader
 * @exports {object} ThemeLoader - 主要通过其 `applyTheme` 方法和几个 getter 与其他模块交互。
 * @property {function} init - 初始化主题加载器，加载初始主题和数据，并应用缓存的背景图。
 * @property {function} applyTheme - 应用一个新主题，动态切换CSS并加载新数据，然后触发事件。
 * @property {function} setBackgroundImage - 设置并缓存一个新的背景图片。
 * @property {function} removeBackgroundImage - 移除并清除缓存的背景图片。
 * @property {function} updateColorSchemePreference - 当用户在设置中更改配色方案时调用。
 * @property {function} getCurrentEffectiveColorScheme - 获取当前生效的配色方案 ('light' 或 'dark')。
 * @property {function} getCurrentThemeKey - 获取当前应用的主题键名。
 * @property {function} getCurrentSpecialContactsDefinitions - 获取当前主题的特殊联系人定义。
 * @dependencies Utils, EventEmitter, DBManager, ThemeList
 * @dependents AppInitializer (确保其早期执行), SettingsUIManager (用于主题切换和背景设置), UserManager (依赖其加载的数据)
 */
const ThemeLoader = {
// 从 ThemeList.js 导入主题定义
    themes: THEME_LIST,

    COLOR_SCHEME_KEY: 'selectedColorScheme', // localStorage 中存储配色方案偏好的键
    DEFAULT_COLOR_SCHEME: 'light', // 默认配色方案
    _currentEffectiveColorScheme: 'light', // 当前生效的配色方案 (light/dark)
    _currentThemeKey: null, // 当前应用的主题键名
    _systemColorSchemeListener: null, // 系统配色方案变化监听器
    _currentSpecialContactsDefinitions: [], // 存储当前主题的特殊联系人定义
    _currentInjectedBackgroundUrl: null, // MODIFIED: 存储当前注入背景的 Object URL，以便释放

    /**
     * @private
     * @description 将背景图样式注入到页面中。
     * @param {string} imageUrl - 要应用的图片的 URL (通常是 Object URL)。
     */
    _injectBackgroundStyle(imageUrl) {
        if (this._currentInjectedBackgroundUrl) {
            URL.revokeObjectURL(this._currentInjectedBackgroundUrl); // 释放旧的 URL
        }
        this._currentInjectedBackgroundUrl = imageUrl; // 存储新的 URL

        const styleId = 'custom-background-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
        }

// 注入 CSS 规则
        styleTag.textContent = `
body {
    background-image: url(${imageUrl});
    backdrop-filter: blur(10px);
    background-repeat: no-repeat;
    background-size: cover;
    background-attachment: fixed;
    background-position-x: center;
}
    `;
    },

    /**
     * @private
     * @description 移除自定义背景图样式。
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
     * @private
     * @description 根据当前生效的配色方案，从 IndexedDB 加载并应用对应的背景图。
     */
    async _updateCustomBackground() {
        const scheme = this.getCurrentEffectiveColorScheme();
        const dbKey = `background_image_${scheme}`;
        try {
            const backgroundItem = await DBManager.getItem('appStateCache', dbKey);
            if (backgroundItem && backgroundItem.imageBlob instanceof Blob) {
                const imageUrl = URL.createObjectURL(backgroundItem.imageBlob);
                this._injectBackgroundStyle(imageUrl);
                (Utils?.log || console.log)(`ThemeLoader: 已为 ${scheme} 模式应用自定义背景。`, Utils?.logLevels?.INFO || 1);
            } else {
                this._removeBackgroundStyle(); // 如果没有找到对应模式的背景，则移除
            }
        } catch (error) {
            (Utils?.log || console.log)(`ThemeLoader: 从缓存加载 ${scheme} 背景图片失败: ${error}`, Utils?.logLevels?.ERROR || 3);
            this._removeBackgroundStyle();
        }
    },


    /**
     * @private 异步加载并解析 data JSON 文件内容。
     *          OPTIMIZED: 现在使用 Promise.all 并行处理所有 `chaptersFilePath` 的加载。
     * @param {string|null} dataJsonUrl - data JSON 文件的 URL。
     * @returns {Promise<Array<object>>} - 解析后的特殊联系人定义数组。
     */
    _parseDataJson: async function(dataJsonUrl) {
        if (!dataJsonUrl) return [];
        try {
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

// --- OPTIMIZATION START: Parallelize chapter file fetching ---
            const processingPromises = definitions.map(async (def) => {
                const processedDef = { ...def }; // Work on a copy

                if (processedDef.isAI && processedDef.chaptersFilePath) {
                    try {
                        const chaptersResponse = await fetch(processedDef.chaptersFilePath);
                        if (chaptersResponse.ok) {
                            processedDef.chapters = await chaptersResponse.json();
                            if (!Array.isArray(processedDef.chapters)) {
                                (Utils?.log || console.log)(`ThemeLoader: 从 ${processedDef.chaptersFilePath} 解析的关卡篇章不是数组。`, Utils?.logLevels?.WARN || 2);
                                processedDef.chapters = [];
                            }
                        } else {
                            (Utils?.log || console.log)(`ThemeLoader: 获取关卡篇章文件 ${processedDef.chaptersFilePath} 失败: ${chaptersResponse.statusText}`, Utils?.logLevels?.WARN || 2);
                            processedDef.chapters = [];
                        }
                    } catch (chapError) {
                        (Utils?.log || console.log)(`ThemeLoader: 加载或解析关卡篇章文件 ${processedDef.chaptersFilePath} 时出错: ${chapError}`, Utils?.logLevels?.ERROR || 3);
                        processedDef.chapters = [];
                    }
                    delete processedDef.chaptersFilePath; // Clean up the path property
                }

// Ensure every definition has a chapters array, even if empty
                if (!processedDef.chapters || !Array.isArray(processedDef.chapters)) {
                    processedDef.chapters = [];
                }
// Validate and standardize each chapter
                processedDef.chapters = processedDef.chapters.map(chapter => ({
                    id: chapter.id || `chapter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    name: chapter.name || "未命名篇章",
                    promptModifier: chapter.promptModifier || ""
                }));

                return processedDef;
            });

            const fullyProcessedDefinitions = await Promise.all(processingPromises);
            return fullyProcessedDefinitions;
// --- OPTIMIZATION END ---

        } catch (error) {
            (Utils?.log || console.log)(`ThemeLoader: 加载或解析 data JSON ${dataJsonUrl} 时出错: ${error}`, Utils?.logLevels?.ERROR || 3);
            return [];
        }
    },

    /**
     * @private 实际加载主题 CSS 和数据的核心逻辑。
     * @param {string} themeKey - 要加载的主题键名。
     * @returns {Promise<void>}
     */
    async _loadThemeCore(themeKey) {
        const themeConfig = this.themes[themeKey];
        if (!themeConfig) {
            console.error(`ThemeLoader: 未找到键为 "${themeKey}" 的主题。`);
            return;
        }

        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (themeStylesheet && themeConfig.css) {
            themeStylesheet.setAttribute('href', themeConfig.css);
        } else if (!themeStylesheet) {
            console.error("ThemeLoader: 严重错误 - 未找到 'theme-stylesheet' 元素。");
        } else if (!themeConfig.css) {
            (Utils?.log || console.log)(`ThemeLoader: 主题 "${themeKey}" 未定义 CSS。`, Utils?.logLevels?.WARN || 2);
            themeStylesheet.setAttribute('href', '');
        }

        this._currentSpecialContactsDefinitions = await this._parseDataJson(themeConfig.dataJs);
        this._currentThemeKey = themeKey;
        localStorage.setItem('selectedTheme', themeKey);
    },

    /**
     * 初始化主题加载器。此函数应在应用初始化早期（AppInitializer.init 中）被 await 调用。
     * @returns {Promise<void>}
     */
    async init() {
// --- 主题和配色方案初始化 ---
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme);

        let savedThemeKey = localStorage.getItem('selectedTheme');
        let themeToLoadKey;

        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            themeToLoadKey = savedThemeKey;
        } else {
            let newThemeKey;
            if (savedThemeKey && this.themes[savedThemeKey]) {
                const baseName = this._getBaseThemeName(savedThemeKey);
                const suffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
                const counterpartKey = `${baseName}-${suffix}`;
                if (this.themes[counterpartKey] && this._isThemeCompatible(counterpartKey, this._currentEffectiveColorScheme)) {
                    newThemeKey = counterpartKey;
                }
            }
            if (!newThemeKey) {
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }
            themeToLoadKey = newThemeKey;
        }
        await this._loadThemeCore(themeToLoadKey);
        this._setupSystemColorSchemeListener(preferredColorScheme);

// --- MODIFIED: 背景图片初始化 ---
        await this._updateCustomBackground();

        (Utils?.log || console.log)("ThemeLoader: 初始化完成。", Utils?.logLevels?.INFO || 1);
    },

    /**
     * OPTIMIZED: 应用一个新主题（无刷新），并使用 View Transitions API 实现圆形扩散动画。
     * @param {string} themeKey - 要应用的主题的键名。
     * @param {Event} [event] - 触发此操作的点击事件，用于获取动画起始坐标。
     * @returns {Promise<void>}
     */
    async applyTheme(themeKey, event) {
        if (!this.themes[themeKey]) {
            (Utils?.log || console.log)(`ThemeLoader: 尝试应用无效的主题键: ${themeKey}。正在回退。`, Utils?.logLevels?.ERROR || 3);
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }

        const updateDom = async () => {
            await this._loadThemeCore(themeKey);
            const newDefinitions = this.getCurrentSpecialContactsDefinitions();

            if (typeof EventEmitter !== 'undefined') {
                EventEmitter.emit('themeChanged', {
                    newThemeKey: themeKey,
                    newDefinitions: [...newDefinitions]
                });
                (Utils?.log || console.log)(`ThemeLoader: 已为 ${themeKey} 触发 themeChanged 事件。`, Utils?.logLevels?.INFO || 1);
            }
        };

// 检查浏览器是否支持 View Transitions API
        if (!document.startViewTransition) {
            await updateDom();
            return;
        }

// 获取点击坐标，如果无事件则默认为屏幕中心
        const x = event ? event.clientX : window.innerWidth / 2;
        const y = event ? event.clientY : window.innerHeight / 2;
        const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

        document.documentElement.style.setProperty('--x', x + 'px');
        document.documentElement.style.setProperty('--y', y + 'px');
        document.documentElement.style.setProperty('--r', endRadius + 'px');

// 执行过渡
        const transition = document.startViewTransition(updateDom);
    },

    /**
     * MODIFIED: 设置并缓存一个新的背景图片（区分浅色/深色）。
     * @param {Blob} imageBlob - 用户选择的图片 Blob 对象。
     * @param {'light'|'dark'} colorSchemeType - 该背景图适用的配色方案。
     * @returns {Promise<void>}
     */
    async setBackgroundImage(imageBlob, colorSchemeType) {
        if (!(imageBlob instanceof Blob)) {
            (Utils?.log || console.log)("ThemeLoader.setBackgroundImage: 提供的不是 Blob 对象。", Utils?.logLevels?.ERROR || 3);
            return;
        }
        if (colorSchemeType !== 'light' && colorSchemeType !== 'dark') {
            (Utils?.log || console.log)(`ThemeLoader.setBackgroundImage: 无效的 colorSchemeType: ${colorSchemeType}`, Utils?.logLevels?.ERROR || 3);
            return;
        }

        try {
            const dbKey = `background_image_${colorSchemeType}`;
            await DBManager.setItem('appStateCache', { id: dbKey, imageBlob: imageBlob });

// 如果设置的背景与当前模式匹配，则立即更新
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
     * MODIFIED: 移除背景图片并从缓存中清除（区分浅色/深色）。
     * @param {'light'|'dark'} colorSchemeType - 要移除背景图的配色方案。
     * @returns {Promise<void>}
     */
    async removeBackgroundImage(colorSchemeType) {
        if (colorSchemeType !== 'light' && colorSchemeType !== 'dark') {
            (Utils?.log || console.log)(`ThemeLoader.removeBackgroundImage: 无效的 colorSchemeType: ${colorSchemeType}`, Utils?.logLevels?.ERROR || 3);
            return;
        }
        try {
            const dbKey = `background_image_${colorSchemeType}`;
            await DBManager.removeItem('appStateCache', dbKey);

// 如果移除的背景与当前模式匹配，则立即更新（移除）
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
     * @description 当用户在设置中更改配色方案时调用。
     *              此方法会更新内部的有效配色方案，应用兼容的主题，并更新背景图。
     * @param {string} newSchemeKeyFromUser - 用户选择的配色方案键 ('auto', 'light', 'dark')。
     * @param {Event} [event] - 触发此操作的点击事件。
     * @returns {Promise<void>}
     */
    async updateColorSchemePreference(newSchemeKeyFromUser, event) {
        const newEffectiveColorScheme = this._getEffectiveColorScheme(newSchemeKeyFromUser);
        const currentStoredScheme = localStorage.getItem(this.COLOR_SCHEME_KEY);

        if (newEffectiveColorScheme !== this._currentEffectiveColorScheme || newSchemeKeyFromUser !== currentStoredScheme) {
            this._currentEffectiveColorScheme = newEffectiveColorScheme;
            localStorage.setItem(this.COLOR_SCHEME_KEY, newSchemeKeyFromUser);
            (Utils?.log || console.log)(`ThemeLoader: 配色方案偏好已更新为 '${newSchemeKeyFromUser}'。生效方案: '${this._currentEffectiveColorScheme}'`, Utils?.logLevels?.INFO || 1);

            let themeToApplyKey;
            const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
            const targetSuffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
            const candidateThemeKey = `${currentBaseName}-${targetSuffix}`;

            if (this.themes[candidateThemeKey] && this._isThemeCompatible(candidateThemeKey, this._currentEffectiveColorScheme)) {
                themeToApplyKey = candidateThemeKey;
            } else {
                themeToApplyKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }

            await this.applyTheme(themeToApplyKey, event);
            await this._updateCustomBackground(); // MODIFIED: 更新背景
            this._setupSystemColorSchemeListener(newSchemeKeyFromUser);
        }
    },

    /**
     * 获取当前主题的特殊联系人定义数组的副本。
     * @returns {Array<object>}
     */
    getCurrentSpecialContactsDefinitions() {
        return [...this._currentSpecialContactsDefinitions];
    },

    /**
     * @private 从完整的主题键名中提取基础名称。
     * @param {string} themeKey - 完整的主题键名。
     * @returns {string} - 主题的基础名称。
     */
    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown";
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, "");
    },

    /**
     * @private 检查指定主题是否与给定的配色方案兼容。
     * @param {string} themeKey - 要检查的主题键名。
     * @param {string} colorScheme - 配色方案 ('light' 或 'dark')。
     * @returns {boolean} - 是否兼容。
     */
    _isThemeCompatible: function(themeKey, colorScheme) {
        if (!this.themes[themeKey]) return false;
        if (colorScheme === 'light') return themeKey.endsWith('-浅色');
        if (colorScheme === 'dark') return themeKey.endsWith('-深色');
        return false;
    },

    /**
     * @private 根据用户的偏好确定实际生效的配色方案。
     * @param {string} preferredScheme - 用户的偏好设置 ('auto', 'light', 'dark')。
     * @returns {string} - 'light' 或 'dark'。
     */
    _getEffectiveColorScheme: function(preferredScheme) {
        if (preferredScheme === 'light') return 'light';
        if (preferredScheme === 'dark') return 'dark';
// Check if window and matchMedia are available (they should be in a browser context)
        if (typeof window !== 'undefined' && window.matchMedia) {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return 'dark';
            }
        } else {
            // Fallback for non-browser environments or very old browsers
            (Utils?.log || console.log)("ThemeLoader: window.matchMedia not available. Defaulting color scheme.", Utils?.logLevels?.WARN || 2);
        }
        return 'light'; // Default to light if 'auto' and system is light or detection fails
    },


    /**
     * @private 为给定的配色方案查找一个备用主题。
     * @param {string} colorScheme - 'light' 或 'dark'。
     * @returns {string} - 找到的备用主题的键名。
     */
    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '浅色' : '深色';
        for (const key in this.themes) {
            if (key.endsWith(suffix)) return key;
        }
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            (Utils?.log || console.log)(`ThemeLoader: 未找到方案 '${colorScheme}' 的主题，回退到第一个可用的主题: ${firstKey}`, Utils?.logLevels?.WARN || 2);
            return firstKey;
        }
        console.error("ThemeLoader: 严重错误 - ThemeLoader.themes 中未定义任何主题。");
// Provide a hardcoded ultimate fallback if absolutely no themes are defined,
// though this state indicates a severe configuration issue.
        return '原神-浅色';
    },

    /**
     * @private 如果用户偏好为 'auto'，则设置一个监听器来响应系统配色方案的变化。
     * @param {string} preferredScheme - 用户的偏好设置。
     */
    _setupSystemColorSchemeListener: function(preferredScheme) {
        if (typeof window === 'undefined' || !window.matchMedia) {
            (Utils?.log || console.log)("ThemeLoader: window.matchMedia not available. Skipping system color scheme listener.", Utils?.logLevels?.WARN || 2);
            return;
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        if (preferredScheme === 'auto') {
            this._systemColorSchemeListener = async (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light';
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    (Utils?.log || console.log)(`ThemeLoader: 系统配色方案变更为: ${newSystemEffectiveColorScheme}。更新应用主题。`, Utils?.logLevels?.INFO || 1);
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme;

                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApplyKey = `${currentBaseName}-${newSuffix}`;

                    if (!this.themes[newThemeToApplyKey] || !this._isThemeCompatible(newThemeToApplyKey, newSystemEffectiveColorScheme)) {
                        newThemeToApplyKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    await this.applyTheme(newThemeToApplyKey); // No event object, so it will animate from center
                    await this._updateCustomBackground(); // MODIFIED: 更新背景
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener);
        }
    },

    /**
     * 获取当前生效的配色方案。
     * @returns {string} - 'light' 或 'dark'。
     */
    getCurrentEffectiveColorScheme: function() {
        return this._currentEffectiveColorScheme;
    },

    /**
     * 获取当前应用的主题的键名。
     * @returns {string|null} - 当前主题的键名。
     */
    getCurrentThemeKey: function() {
        return this._currentThemeKey;
    }
};