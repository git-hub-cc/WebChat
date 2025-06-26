/**
 * @file ThemeLoader.js
 * @description 主题加载器。这是一个在应用初始化早期执行的关键脚本，
 *              负责根据用户的本地存储偏好和系统设置（浅色/深色模式）来决定并应用正确的主题。
 *              它会加载相应的主题 CSS 文件和与主题相关的数据 JSON 文件（如特殊联系人定义，包括词汇篇章）。
 *              现在支持无刷新切换主题和动态加载数据。
 *              更新：AI 联系人的词汇篇章数据现在可以从其定义中的 `chaptersFilePath` 指定的单独 JSON 文件加载。
 * @module ThemeLoader
 * @exports {object} ThemeLoader - 主要通过其 `applyTheme` 方法和几个 getter 与其他模块交互。
 * @property {function} init - 初始化主题加载器，加载初始主题和数据。
 * @property {function} applyTheme - 应用一个新主题，动态切换CSS并加载新数据，然后触发事件。
 * @property {function} updateColorSchemePreference - 当用户在设置中更改配色方案时调用。
 * @property {function} getCurrentEffectiveColorScheme - 获取当前生效的配色方案 ('light' 或 'dark')。
 * @property {function} getCurrentThemeKey - 获取当前应用的主题键名。
 * @property {function} getCurrentSpecialContactsDefinitions - 获取当前主题的特殊联系人定义。
 * @dependencies Utils, EventEmitter (如果 Utils 或 EventEmitter 在此之前未加载，则需要确保它们可用或处理潜在的未定义情况)
 * @dependents AppInitializer (确保其早期执行), SettingsUIManager (用于主题切换), UserManager (依赖其加载的数据)
 */
const ThemeLoader = {
    // 定义所有可用的主题及其配置
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
        // "鸣潮-浅色": { name: "鸣潮", css: "css/动漫/鸣潮-浅色.css", dataJs: "data/动漫/鸣潮.json" },
        // "鸣潮-深色": { name: "鸣潮", css: "css/动漫/鸣潮-深色.css", dataJs: "data/动漫/鸣潮.json" },
        // "星穹铁道-浅色": { name: "星穹铁道", css: "css/动漫/星穹铁道-浅色.css", dataJs: "data/动漫/星穹铁道.json" },
        // "星穹铁道-深色": { name: "星穹铁道", css: "css/动漫/星穹铁道-深色.css", dataJs: "data/动漫/星穹铁道.json" },
        // "仙逆-浅色": { name: "仙逆", css: "css/动漫/仙逆-浅色.css", dataJs: "data/动漫/仙逆.json" },
        // "仙逆-深色": { name: "仙逆", css: "css/动漫/仙逆-深色.css", dataJs: "data/动漫/仙逆.json" },
        // "咒术回战-深色": { name: "咒术回战", css: "css/动漫/咒术回战-深色.css", dataJs: "data/动漫/咒术回战.json" },
        // "咒术回战-浅色": { name: "咒术回战", css: "css/动漫/咒术回战-浅色.css", dataJs: "data/动漫/咒术回战.json" },
        // "遮天-浅色": { name: "遮天", css: "css/动漫/遮天-浅色.css", dataJs: "data/动漫/遮天.json" },
        // "遮天-深色": { name: "遮天", css: "css/动漫/遮天-深色.css", dataJs: "data/动漫/遮天.json" },
        // "完美世界-浅色": { name: "完美世界", css: "css/动漫/完美世界-浅色.css", dataJs: "data/动漫/完美世界.json" },
        // "完美世界-深色": { name: "完美世界", css: "css/动漫/完美世界-深色.css", dataJs: "data/动漫/完美世界.json" },
        // "吞噬星空-浅色": { name: "吞噬星空", css: "css/动漫/吞噬星空-浅色.css", dataJs: "data/动漫/吞噬星空.json" },
        // "吞噬星空-深色": { name: "吞噬星空", css: "css/动漫/吞噬星空-深色.css", dataJs: "data/动漫/吞噬星空.json" }
    },
    COLOR_SCHEME_KEY: 'selectedColorScheme', // localStorage 中存储配色方案偏好的键
    DEFAULT_COLOR_SCHEME: 'light', // 默认配色方案
    _currentEffectiveColorScheme: 'light', // 当前生效的配色方案 (light/dark)
    _currentThemeKey: null, // 当前应用的主题键名
    _systemColorSchemeListener: null, // 系统配色方案变化监听器
    _currentSpecialContactsDefinitions: [], // 存储当前主题的特殊联系人定义

    /**
     * @private 异步加载并解析 data JSON 文件内容。
     *          现在会处理 `chaptersFilePath` 来动态加载词汇篇章数据。
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

            // 为每个定义处理词汇篇章
            for (const def of definitions) {
                if (def.isAI && def.chaptersFilePath) {
                    try {
                        const chaptersResponse = await fetch(def.chaptersFilePath);
                        if (chaptersResponse.ok) {
                            def.chapters = await chaptersResponse.json();
                            if (!Array.isArray(def.chapters)) {
                                (Utils?.log || console.log)(`ThemeLoader: 从 ${def.chaptersFilePath} 解析的词汇篇章不是数组。`, Utils?.logLevels?.WARN || 2);
                                def.chapters = [];
                            }
                        } else {
                            (Utils?.log || console.log)(`ThemeLoader: 获取词汇篇章文件 ${def.chaptersFilePath} 失败: ${chaptersResponse.statusText}`, Utils?.logLevels?.WARN || 2);
                            def.chapters = [];
                        }
                    } catch (chapError) {
                        (Utils?.log || console.log)(`ThemeLoader: 加载或解析词汇篇章文件 ${def.chaptersFilePath} 时出错: ${chapError}`, Utils?.logLevels?.ERROR || 3);
                        def.chapters = [];
                    }
                    delete def.chaptersFilePath; // 移除路径属性，因为它已被处理
                }

                // 确保每个定义都有 chapters 数组，即使是空的
                if (!def.chapters || !Array.isArray(def.chapters)) {
                    def.chapters = [];
                }
                // 对每个 chapter 进行校验和标准化
                def.chapters = def.chapters.map(chapter => ({
                    id: chapter.id || `chapter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, // 提供回退ID
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
        (Utils?.log || console.log)("ThemeLoader: 初始化完成。", Utils?.logLevels?.INFO || 1);
    },

    /**
     * 应用一个新主题（无刷新）。
     * @param {string} themeKey - 要应用的主题的键名。
     * @returns {Promise<void>}
     */
    async applyTheme(themeKey) {
        if (!this.themes[themeKey]) {
            (Utils?.log || console.log)(`ThemeLoader: 尝试应用无效的主题键: ${themeKey}。正在回退。`, Utils?.logLevels?.ERROR || 3);
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }

        await this._loadThemeCore(themeKey);

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('themeChanged', {
                newThemeKey: themeKey,
                newDefinitions: [...this._currentSpecialContactsDefinitions]
            });
            (Utils?.log || console.log)(`ThemeLoader: 已为 ${themeKey} 触发 themeChanged 事件。`, Utils?.logLevels?.INFO || 1);
        } else {
            console.warn("ThemeLoader: EventEmitter 未定义，无法触发 themeChanged 事件。");
        }
    },

    /**
     * @description 当用户在设置中更改配色方案时调用。
     *              此方法会更新内部的有效配色方案，并应用一个兼容的主题。
     * @param {string} newSchemeKeyFromUser - 用户选择的配色方案键 ('auto', 'light', 'dark')。
     * @returns {Promise<void>}
     */
    async updateColorSchemePreference(newSchemeKeyFromUser) {
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

            await this.applyTheme(themeToApplyKey);
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
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
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
                    await this.applyTheme(newThemeToApplyKey);
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