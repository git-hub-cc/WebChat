/**
 * @file ThemeLoader.js
 * @description 主题加载器。这是一个在应用初始化早期执行的关键脚本，
 *              负责根据用户的本地存储偏好和系统设置（浅色/深色模式）来决定并应用正确的主题。
 *              它会加载相应的主题 CSS 文件和与主题相关的数据 JS 文件（如特殊联系人定义）。
 * @module ThemeLoader
 * @exports {object} ThemeLoader - 主要通过其 `applyTheme` 方法和几个 getter 与其他模块交互。
 * @property {function} applyTheme - 应用一个新主题，通常通过重新加载页面实现。
 * @property {function} getCurrentEffectiveColorScheme - 获取当前生效的配色方案 ('light' 或 'dark')。
 * @property {function} getCurrentThemeKey - 获取当前应用的主题键名。
 * @dependencies 无，设计为独立运行。
 * @dependents AppInitializer (确保其早期执行), SettingsUIManager (用于主题切换), UserManager (依赖其加载的数据)
 */
const ThemeLoader = {
    // 定义所有可用的主题
    themes: {
        "原神-浅色": { name: "原神（内置tts）", css: "css/原神-浅色.css", dataJs: "data/原神.js", defaultSpecialContacts: true  },
        "原神-深色": { name: "原神(内置tts)", css: "css/原神-深色.css", dataJs: "data/原神.js" },
        "蜡笔小新-浅色": { name: "蜡笔小新", css: "css/蜡笔小新-浅色.css", dataJs: "data/蜡笔小新.js"},
        "蜡笔小新-深色": { name: "蜡笔小新", css: "css/蜡笔小新-深色.css", dataJs: "data/蜡笔小新.js" },
        "仙逆-浅色": { name: "仙逆", css: "css/仙逆-浅色.css", dataJs: "data/仙逆.js" },
        "仙逆-深色": { name: "仙逆", css: "css/仙逆-深色.css", dataJs: "data/仙逆.js" },
        "咒术回战-深色": { name: "咒术回战", css: "css/咒术回战-深色.css", dataJs: "data/咒术回战.js" },
        "咒术回战-浅色": { name: "咒术回战", css: "css/咒术回战-浅色.css", dataJs: "data/咒术回战.js" },
        "遮天-浅色": { name: "遮天", css: "css/遮天-浅色.css", dataJs: "data/遮天.js" },
        "遮天-深色": { name: "遮天", css: "css/遮天-深色.css", dataJs: "data/遮天.js" },
        "完美世界-浅色": { name: "完美世界", css: "css/完美世界-浅色.css", dataJs: "data/完美世界.js" },
        "完美世界-深色": { name: "完美世界", css: "css/完美世界-深色.css", dataJs: "data/完美世界.js" },
        "吞噬星空-浅色": { name: "吞噬星空", css: "css/吞噬星空-浅色.css", dataJs: "data/吞噬星空.js" },
        "吞噬星空-深色": { name: "吞噬星空", css: "css/吞噬星空-深色.css", dataJs: "data/吞噬星空.js" },
        "斗破苍穹-浅色": { name: "斗破苍穹", css: "css/斗破苍穹-浅色.css", dataJs: "data/斗破苍穹.js" },
        "斗破苍穹-深色": { name: "斗破苍穹", css: "css/斗破苍穹-深色.css", dataJs: "data/斗破苍穹.js" },
        "迷宫饭-浅色": { name: "迷宫饭", css: "css/迷宫饭-浅色.css", dataJs: "data/迷宫饭.js" },
        "迷宫饭-深色": { name: "迷宫饭", css: "css/迷宫饭-深色.css", dataJs: "data/迷宫饭.js" },
        "telegram-浅色": { name: "telegram", css: "css/telegram-浅色.css", dataJs: null },
        "telegram-深色": { name: "telegram", css: "css/telegram-深色.css", dataJs: null },
    },
    COLOR_SCHEME_KEY: 'selectedColorScheme', // localStorage 中存储配色方案偏好的键
    DEFAULT_COLOR_SCHEME: 'light',           // 默认的配色方案
    _currentEffectiveColorScheme: 'light',   // 当前实际生效的配色方案 ('light' 或 'dark')
    _currentThemeKey: null,                  // 当前应用的主题键名
    _systemColorSchemeListener: null,        // 用于监听系统颜色方案变化的监听器

    /**
     * 初始化主题加载器。此函数在页面加载的极早期运行。
     */
    init: function() {
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme);

        let savedThemeKey = localStorage.getItem('selectedTheme');
        let themeToLoad;

        // 决定要加载哪个主题
        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            // 如果保存的主题有效且与当前配色方案兼容，则使用它
            themeToLoad = this.themes[savedThemeKey];
            this._currentThemeKey = savedThemeKey;
        } else {
            // 否则，需要寻找一个合适的主题
            let newThemeKey;
            if (savedThemeKey && this.themes[savedThemeKey]) {
                // 如果保存的主题存在但不兼容，尝试找到其对应配色方案的版本
                const baseName = this._getBaseThemeName(savedThemeKey);
                const suffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
                const counterpartKey = `${baseName}-${suffix}`;
                if (this.themes[counterpartKey] && this._isThemeCompatible(counterpartKey, this._currentEffectiveColorScheme)) {
                    newThemeKey = counterpartKey;
                }
            }

            if (!newThemeKey) {
                // 如果没有找到对应版本，或者根本没有保存的主题，则寻找一个备用主题
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }
            this._currentThemeKey = newThemeKey;
            themeToLoad = this.themes[newThemeKey];
            localStorage.setItem('selectedTheme', newThemeKey); // 更新存储
        }

        // 应用主题 CSS
        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (themeStylesheet) {
            if (themeToLoad && themeToLoad.css) {
                themeStylesheet.setAttribute('href', themeToLoad.css);
            } else {
                themeStylesheet.setAttribute('href', ''); // 回退到无主题
                console.warn("主题对象或 theme.css 在键值下缺失:", this._currentThemeKey);
            }
        } else {
            console.error("严重错误: 未找到主题样式表元素 'theme-stylesheet'。");
        }

        // 加载主题特定的数据 JS 文件 (例如 SPECIAL_CONTACTS_DEFINITIONS)
        if (themeToLoad && themeToLoad.dataJs) {
            // 使用 document.write 是因为此脚本在 DOM 解析完成前执行，是同步加载所必需的
            document.write(`<script src="${themeToLoad.dataJs}"><\/script>`);
        } else {
            // 如果没有数据文件，确保全局变量存在以避免错误
            if (typeof SPECIAL_CONTACTS_DEFINITIONS === 'undefined') {
                document.write(`<script>var SPECIAL_CONTACTS_DEFINITIONS = [];<\/script>`);
            }
        }

        // 如果用户的偏好是 'auto'，则设置监听器以响应系统颜色方案的变化
        this._setupSystemColorSchemeListener(preferredColorScheme);
    },

    /**
     * @private
     * 从完整的主题键名中提取基础名称（例如，从 "原神-浅色" 提取 "原神"）。
     * @param {string} themeKey - 完整的主题键名。
     * @returns {string} - 主题的基础名称。
     */
    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown";
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, "");
    },

    /**
     * @private
     * 检查指定主题是否与给定的配色方案兼容。
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
     * @private
     * 根据用户的偏好（'auto', 'light', 'dark'）确定实际生效的配色方案。
     * @param {string} preferredScheme - 用户的偏好设置。
     * @returns {string} - 'light' 或 'dark'。
     */
    _getEffectiveColorScheme: function(preferredScheme) {
        if (preferredScheme === 'light') return 'light';
        if (preferredScheme === 'dark') return 'dark';
        // 对于 'auto'，检查系统的偏好
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light'; // 'auto' 的默认回退值
    },

    /**
     * @private
     * 为给定的配色方案查找一个备用主题。
     * @param {string} colorScheme - 'light' 或 'dark'。
     * @returns {string} - 找到的备用主题的键名。
     */
    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
        for (const key in this.themes) {
            if (key.endsWith(suffix)) return key;
        }
        // 如果没有找到任何兼容的主题，回退到列表中的第一个
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            console.warn(`未找到方案 '${colorScheme}' 的主题，回退到第一个可用的主题: ${firstKey}`);
            return firstKey;
        }
        // 绝对的最终回退
        console.error("严重错误: ThemeLoader.themes 中未定义任何主题。正在使用硬编码的默认值。");
        return '原神-浅色';
    },

    /**
     * @private
     * 如果用户偏好为 'auto'，则设置一个监听器来响应系统配色方案的变化。
     * @param {string} preferredScheme - 用户的偏好设置。
     */
    _setupSystemColorSchemeListener: function(preferredScheme) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        // 移除旧的监听器以防重复
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        if (preferredScheme === 'auto') {
            this._systemColorSchemeListener = (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light';
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme;
                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApplyKey = `${currentBaseName}-${newSuffix}`;

                    // 检查新的对应主题是否存在，如果不存在则寻找备用
                    if (!this.themes[newThemeToApplyKey] || !this._isThemeCompatible(newThemeToApplyKey, newSystemEffectiveColorScheme)) {
                        newThemeToApplyKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    this.applyTheme(newThemeToApplyKey); // 应用新主题
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener);
        }
    },

    /**
     * 应用一个新主题。
     * @param {string} themeKey - 要应用的主题的键名。
     */
    applyTheme: function(themeKey) {
        if (!this.themes[themeKey]) {
            console.error(`尝试应用无效的主题键: ${themeKey}。正在回退。`);
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }
        localStorage.setItem('selectedTheme', themeKey);
        // 重新加载页面是应用新 CSS 和新 data.js 的最简单可靠的方法
        window.location.reload();
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

// 立即执行初始化，以确保在其他脚本运行前主题已设置
ThemeLoader.init();