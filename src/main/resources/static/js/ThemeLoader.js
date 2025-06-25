/**
 * @file ThemeLoader.js
 * @description 主题加载器。这是一个在应用初始化早期执行的关键脚本，
 *              负责根据用户的本地存储偏好和系统设置（浅色/深色模式）来决定并应用正确的主题。
 *              它会加载相应的主题 CSS 文件和与主题相关的数据 JSON 文件（如特殊联系人定义）。
 *              现在支持无刷新切换主题和动态加载数据。
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
        "原神-浅色": { name: "原神", css: "css/原神-浅色.css", dataJs: "data/原神.json", defaultSpecialContacts: true  },
        "原神-深色": { name: "原神", css: "css/原神-深色.css", dataJs: "data/原神.json" },
        "词汇001-深色": { name: "词汇001", css: "css/词汇-深色.css", dataJs: "data/词汇001.json" },
        "词汇001-浅色": { name: "词汇001", css: "css/词汇-浅色.css", dataJs: "data/词汇001.json" },
        "迷宫饭-浅色": { name: "迷宫饭", css: "css/迷宫饭-浅色.css", dataJs: "data/迷宫饭.json" },
        "迷宫饭-深色": { name: "迷宫饭", css: "css/迷宫饭-深色.css", dataJs: "data/迷宫饭.json" },
        "斗破苍穹-浅色": { name: "斗破苍穹", css: "css/斗破苍穹-浅色.css", dataJs: "data/斗破苍穹.json" },
        "斗破苍穹-深色": { name: "斗破苍穹", css: "css/斗破苍穹-深色.css", dataJs: "data/斗破苍穹.json" },
        "崩坏3-浅色": { name: "崩坏3", css: "css/崩坏3-浅色.css", dataJs: "data/崩坏3.json" },
        "崩坏3-深色": { name: "崩坏3", css: "css/崩坏3-深色.css", dataJs: "data/崩坏3.json" },
        "蜡笔小新-浅色": { name: "蜡笔小新", css: "css/蜡笔小新-浅色.css", dataJs: "data/蜡笔小新.json"},
        "蜡笔小新-深色": { name: "蜡笔小新", css: "css/蜡笔小新-深色.css", dataJs: "data/蜡笔小新.json" },
        // "鸣潮-浅色": { name: "鸣潮", css: "css/鸣潮-浅色.css", dataJs: "data/鸣潮.json" },
        // "鸣潮-深色": { name: "鸣潮", css: "css/鸣潮-深色.css", dataJs: "data/鸣潮.json" },
        // "星穹铁道-浅色": { name: "星穹铁道", css: "css/星穹铁道-浅色.css", dataJs: "data/星穹铁道.json" },
        // "星穹铁道-深色": { name: "星穹铁道", css: "css/星穹铁道-深色.css", dataJs: "data/星穹铁道.json" },
        // "仙逆-浅色": { name: "仙逆", css: "css/仙逆-浅色.css", dataJs: "data/仙逆.json" },
        // "仙逆-深色": { name: "仙逆", css: "css/仙逆-深色.css", dataJs: "data/仙逆.json" },
        // "咒术回战-深色": { name: "咒术回战", css: "css/咒术回战-深色.css", dataJs: "data/咒术回战.json" },
        // "咒术回战-浅色": { name: "咒术回战", css: "css/咒术回战-浅色.css", dataJs: "data/咒术回战.json" },
        // "遮天-浅色": { name: "遮天", css: "css/遮天-浅色.css", dataJs: "data/遮天.json" },
        // "遮天-深色": { name: "遮天", css: "css/遮天-深色.css", dataJs: "data/遮天.json" },
        // "完美世界-浅色": { name: "完美世界", css: "css/完美世界-浅色.css", dataJs: "data/完美世界.json" },
        // "完美世界-深色": { name: "完美世界", css: "css/完美世界-深色.css", dataJs: "data/完美世界.json" },
        // "吞噬星空-浅色": { name: "吞噬星空", css: "css/吞噬星空-浅色.css", dataJs: "data/吞噬星空.json" },
        // "吞噬星空-深色": { name: "吞噬星空", css: "css/吞噬星空-深色.css", dataJs: "data/吞噬星空.json" }
    },
    COLOR_SCHEME_KEY: 'selectedColorScheme', // localStorage 中存储配色方案偏好的键
    DEFAULT_COLOR_SCHEME: 'light', // 默认配色方案
    _currentEffectiveColorScheme: 'light', // 当前生效的配色方案 (light/dark)
    _currentThemeKey: null, // 当前应用的主题键名
    _systemColorSchemeListener: null, // 系统配色方案变化监听器
    _currentSpecialContactsDefinitions: [], // 存储当前主题的特殊联系人定义

    /**
     * @private 异步加载并解析 data JSON 文件内容。
     * @param {string|null} dataJsonUrl - data JSON 文件的 URL。
     * @returns {Promise<Array<object>>} - 解析后的特殊联系人定义数组。
     */
    async _parseDataJson(dataJsonUrl) {
        if (!dataJsonUrl) return []; // 如果URL为空，则返回空数组
        try {
            const response = await fetch(dataJsonUrl); // 获取JSON文件
            if (!response.ok) { // 检查响应状态
                (Utils?.log || console.log)(`ThemeLoader: 获取 data JSON 失败 ${dataJsonUrl}: ${response.statusText}`, Utils?.logLevels?.WARN || 2);
                return [];
            }
            const definitions = await response.json(); // 解析JSON
            if (Array.isArray(definitions)) { // 确保是数组
                return definitions;
            } else {
                (Utils?.log || console.log)(`ThemeLoader: 从 ${dataJsonUrl} 解析的内容不是数组。`, Utils?.logLevels?.WARN || 2);
                return [];
            }
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
        const themeConfig = this.themes[themeKey]; // 获取主题配置
        if (!themeConfig) { // 如果配置不存在
            console.error(`ThemeLoader: 未找到键为 "${themeKey}" 的主题。`);
            return;
        }

        const themeStylesheet = document.getElementById('theme-stylesheet'); // 获取主题样式表元素
        if (themeStylesheet && themeConfig.css) { // 如果元素和CSS路径都存在
            themeStylesheet.setAttribute('href', themeConfig.css); // 设置新的CSS路径
        } else if (!themeStylesheet) {
            console.error("ThemeLoader: 严重错误 - 未找到 'theme-stylesheet' 元素。");
        } else if (!themeConfig.css) { // 如果主题未定义CSS
            (Utils?.log || console.log)(`ThemeLoader: 主题 "${themeKey}" 未定义 CSS。`, Utils?.logLevels?.WARN || 2);
            themeStylesheet.setAttribute('href', ''); // 清空href
        }

        // 加载并解析与主题相关的特殊联系人数据
        this._currentSpecialContactsDefinitions = await this._parseDataJson(themeConfig.dataJs);
        this._currentThemeKey = themeKey; // 更新当前主题键
        localStorage.setItem('selectedTheme', themeKey); // 保存到localStorage
    },

    /**
     * 初始化主题加载器。此函数应在应用初始化早期（AppInitializer.init 中）被 await 调用。
     * @returns {Promise<void>}
     */
    async init() {
        // 获取用户偏好的配色方案，或使用默认值
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme); // 计算生效的配色方案

        let savedThemeKey = localStorage.getItem('selectedTheme'); // 获取上次保存的主题
        let themeToLoadKey; // 最终要加载的主题键

        // 判断使用哪个主题
        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            // 如果保存的主题有效且与当前配色方案兼容，则使用它
            themeToLoadKey = savedThemeKey;
        } else { // 否则，需要查找一个合适的主题
            let newThemeKey;
            if (savedThemeKey && this.themes[savedThemeKey]) { // 如果保存的主题存在但可能不兼容
                const baseName = this._getBaseThemeName(savedThemeKey); // 获取基础名称
                const suffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色'; // 配色方案后缀
                const counterpartKey = `${baseName}-${suffix}`; // 尝试找到对应配色方案的版本
                if (this.themes[counterpartKey] && this._isThemeCompatible(counterpartKey, this._currentEffectiveColorScheme)) {
                    newThemeKey = counterpartKey;
                }
            }
            if (!newThemeKey) { // 如果仍未找到，则使用备用逻辑查找
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }
            themeToLoadKey = newThemeKey;
        }
        await this._loadThemeCore(themeToLoadKey); // 加载主题核心
        this._setupSystemColorSchemeListener(preferredColorScheme); // 设置系统配色方案监听器
        (Utils?.log || console.log)("ThemeLoader: 初始化完成。", Utils?.logLevels?.INFO || 1);
    },

    /**
     * 应用一个新主题（无刷新）。
     * @param {string} themeKey - 要应用的主题的键名。
     * @returns {Promise<void>}
     */
    async applyTheme(themeKey) {
        if (!this.themes[themeKey]) { // 如果主题键无效，则回退
            (Utils?.log || console.log)(`ThemeLoader: 尝试应用无效的主题键: ${themeKey}。正在回退。`, Utils?.logLevels?.ERROR || 3);
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }

        await this._loadThemeCore(themeKey); // 加载主题核心

        // 触发主题变更事件
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('themeChanged', {
                newThemeKey: themeKey,
                newDefinitions: [...this._currentSpecialContactsDefinitions] // 发送定义副本
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
        const newEffectiveColorScheme = this._getEffectiveColorScheme(newSchemeKeyFromUser); // 计算新的生效方案
        const currentStoredScheme = localStorage.getItem(this.COLOR_SCHEME_KEY); // 获取当前存储的偏好

        // 如果生效方案或用户偏好发生变化
        if (newEffectiveColorScheme !== this._currentEffectiveColorScheme || newSchemeKeyFromUser !== currentStoredScheme) {
            this._currentEffectiveColorScheme = newEffectiveColorScheme; // 更新生效方案
            localStorage.setItem(this.COLOR_SCHEME_KEY, newSchemeKeyFromUser); // 保存用户偏好
            (Utils?.log || console.log)(`ThemeLoader: 配色方案偏好已更新为 '${newSchemeKeyFromUser}'。生效方案: '${this._currentEffectiveColorScheme}'`, Utils?.logLevels?.INFO || 1);

            let themeToApplyKey;
            const currentBaseName = this._getBaseThemeName(this._currentThemeKey); // 获取当前主题的基础名称
            const targetSuffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色'; // 目标后缀
            const candidateThemeKey = `${currentBaseName}-${targetSuffix}`; // 尝试构建对应方案的主题键

            if (this.themes[candidateThemeKey] && this._isThemeCompatible(candidateThemeKey, this._currentEffectiveColorScheme)) {
                themeToApplyKey = candidateThemeKey; // 如果存在且兼容，则使用
            } else {
                themeToApplyKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme); // 否则查找备用
            }

            await this.applyTheme(themeToApplyKey); // 应用新主题
            this._setupSystemColorSchemeListener(newSchemeKeyFromUser); // 更新系统监听器
        }
    },

    /**
     * 获取当前主题的特殊联系人定义数组的副本。
     * @returns {Array<object>}
     */
    getCurrentSpecialContactsDefinitions() {
        return [...this._currentSpecialContactsDefinitions]; // 返回副本以防外部修改
    },

    /**
     * @private 从完整的主题键名中提取基础名称。
     * @param {string} themeKey - 完整的主题键名。
     * @returns {string} - 主题的基础名称。
     */
    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown"; // 默认基础名
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, ""); // 移除后缀
    },

    /**
     * @private 检查指定主题是否与给定的配色方案兼容。
     * @param {string} themeKey - 要检查的主题键名。
     * @param {string} colorScheme - 配色方案 ('light' 或 'dark')。
     * @returns {boolean} - 是否兼容。
     */
    _isThemeCompatible: function(themeKey, colorScheme) {
        if (!this.themes[themeKey]) return false; // 主题不存在则不兼容
        if (colorScheme === 'light') return themeKey.endsWith('-浅色'); // 浅色方案匹配浅色主题
        if (colorScheme === 'dark') return themeKey.endsWith('-深色'); // 深色方案匹配深色主题
        return false; // 其他情况不兼容
    },

    /**
     * @private 根据用户的偏好确定实际生效的配色方案。
     * @param {string} preferredScheme - 用户的偏好设置 ('auto', 'light', 'dark')。
     * @returns {string} - 'light' 或 'dark'。
     */
    _getEffectiveColorScheme: function(preferredScheme) {
        if (preferredScheme === 'light') return 'light';
        if (preferredScheme === 'dark') return 'dark';
        // 如果是 'auto'，则根据系统设置判断
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark'; // 系统为深色
        }
        return 'light'; // 默认为浅色
    },

    /**
     * @private 为给定的配色方案查找一个备用主题。
     * @param {string} colorScheme - 'light' 或 'dark'。
     * @returns {string} - 找到的备用主题的键名。
     */
    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
        // 查找第一个匹配后缀的主题
        for (const key in this.themes) {
            if (key.endsWith(suffix)) return key;
        }
        // 如果找不到，则返回 themes 对象中的第一个主题作为最终备选
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            (Utils?.log || console.log)(`ThemeLoader: 未找到方案 '${colorScheme}' 的主题，回退到第一个可用的主题: ${firstKey}`, Utils?.logLevels?.WARN || 2);
            return firstKey;
        }
        // 理论上不应发生，除非 themes 对象为空
        console.error("ThemeLoader: 严重错误 - ThemeLoader.themes 中未定义任何主题。");
        return '原神-浅色'; // 绝对备选
    },

    /**
     * @private 如果用户偏好为 'auto'，则设置一个监听器来响应系统配色方案的变化。
     * @param {string} preferredScheme - 用户的偏好设置。
     */
    _setupSystemColorSchemeListener: function(preferredScheme) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        // 移除旧的监听器（如果存在）
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        if (preferredScheme === 'auto') { // 只有当用户选择 'auto' 时才监听系统变化
            this._systemColorSchemeListener = async (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light'; // 获取新的系统配色方案
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) { // 如果发生变化
                    (Utils?.log || console.log)(`ThemeLoader: 系统配色方案变更为: ${newSystemEffectiveColorScheme}。更新应用主题。`, Utils?.logLevels?.INFO || 1);
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme; // 更新内部状态

                    // 查找并应用新主题
                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApplyKey = `${currentBaseName}-${newSuffix}`;

                    if (!this.themes[newThemeToApplyKey] || !this._isThemeCompatible(newThemeToApplyKey, newSystemEffectiveColorScheme)) {
                        newThemeToApplyKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    await this.applyTheme(newThemeToApplyKey);
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener); // 添加监听器
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