// MODIFIED: ThemeLoader.js (已翻译为中文)
// - populateSelector 逻辑（创建下拉菜单）已完全移至 SettingsUIManager。
// - 此文件现在纯粹专注于确定要加载哪个主题（CSS/DataJS）。
const ThemeLoader = {
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
    COLOR_SCHEME_KEY: 'selectedColorScheme',
    DEFAULT_COLOR_SCHEME: 'light',
    _currentEffectiveColorScheme: 'light', // 将在 init 中设置
    _currentThemeKey: null, // 将在 init 中设置
    _systemColorSchemeListener: null,

    init: function() { // 此函数在页面加载的极早期运行（在 index.html 中直接调用或由 AppInitializer 极早期调用）
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme);

        let savedThemeKey = localStorage.getItem('selectedTheme');
        let themeToLoad;

        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            themeToLoad = this.themes[savedThemeKey];
            this._currentThemeKey = savedThemeKey;
        } else {
            let newThemeKey;
            if (savedThemeKey && this.themes[savedThemeKey]) { // 如果保存的主题存在但不兼容
                const baseName = this._getBaseThemeName(savedThemeKey);
                const suffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
                const counterpartKey = `${baseName}-${suffix}`;
                if (this.themes[counterpartKey] && this._isThemeCompatible(counterpartKey, this._currentEffectiveColorScheme)) {
                    newThemeKey = counterpartKey;
                }
            }

            if (!newThemeKey) { // 或者如果 savedThemeKey 为 null/无效或未找到对应版本
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }
            this._currentThemeKey = newThemeKey; // 更新内部当前主题键
            themeToLoad = this.themes[newThemeKey];
            localStorage.setItem('selectedTheme', newThemeKey);
        }

        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (themeStylesheet) {
            if (themeToLoad && themeToLoad.css) {
                themeStylesheet.setAttribute('href', themeToLoad.css);
            } else {
                themeStylesheet.setAttribute('href', ''); // 回退到无主题 CSS
                console.warn("主题对象或 theme.css 在键值下缺失:", this._currentThemeKey);
            }
        } else {
            console.error("严重错误: 未找到主题样式表元素 'theme-stylesheet'。");
        }

        // 加载主题特定数据 (SPECIAL_CONTACTS_DEFINITIONS)
        // 这需要在 UserManager.init() 之前发生
        if (themeToLoad && themeToLoad.dataJs) {
            // 在这里使用 document.write 通常是可以的，因为 ThemeLoader.init()
            // 在页面加载的非常早期，DOM 完全解析之前被调用。
            document.write(`<script src="${themeToLoad.dataJs}"><\/script>`);
        } else {
            // 如果没有 dataJs，确保 SPECIAL_CONTACTS_DEFINITIONS 被全局定义
            if (typeof SPECIAL_CONTACTS_DEFINITIONS === 'undefined') {
                document.write(`<script>var SPECIAL_CONTACTS_DEFINITIONS = [];<\/script>`);
            }
        }
        this._setupSystemColorSchemeListener(preferredColorScheme); // 为 'auto' 设置监听器
    },

    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown";
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, "");
    },

    _isThemeCompatible: function(themeKey, colorScheme) { // colorScheme 是 'light' 或 'dark'
        if (!this.themes[themeKey]) return false;
        if (colorScheme === 'light') return themeKey.endsWith('-浅色');
        if (colorScheme === 'dark') return themeKey.endsWith('-深色');
        return false;
    },

    _getEffectiveColorScheme: function(preferredScheme) {
        if (preferredScheme === 'light') return 'light';
        if (preferredScheme === 'dark') return 'dark';
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light'; // 如果系统偏好不是深色或无法检测，则为 'auto' 的默认值
    },

    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
        for (const key in this.themes) {
            if (key.endsWith(suffix)) return key;
        }
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            console.warn(`未找到方案 '${colorScheme}' 的主题，回退到第一个可用的主题: ${firstKey}`);
            return firstKey;
        }
        console.error("严重错误: ThemeLoader.themes 中未定义任何主题。正在使用硬编码的默认值。");
        return '原神-浅色'; // 绝对回退
    },

    _setupSystemColorSchemeListener: function(preferredScheme) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        // 在添加新监听器之前移除任何现有的监听器
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        if (preferredScheme === 'auto') {
            this._systemColorSchemeListener = (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light';
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    // 更新 SettingsUIManager 用于筛选主题的有效方案
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme;
                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApplyKey = `${currentBaseName}-${newSuffix}`;

                    // 检查新的对应主题是否存在
                    if (!this.themes[newThemeToApplyKey] || !this._isThemeCompatible(newThemeToApplyKey, newSystemEffectiveColorScheme)) {
                        newThemeToApplyKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    this.applyTheme(newThemeToApplyKey); // 这会重新加载页面
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener);
        }
    },

    // populateSelector 已从此文件中移除。SettingsUIManager 将处理其自己的 UI。
    // SettingsUIManager 可以访问 ThemeLoader.themes 和 ThemeLoader._currentEffectiveColorScheme
    // 来适当地构建下拉菜单。

    applyTheme: function(themeKey) {
        if (!this.themes[themeKey]) {
            console.error(`尝试应用无效的主题键: ${themeKey}。正在回退。`);
            // 回退到与当前有效配色方案兼容的主题
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }
        localStorage.setItem('selectedTheme', themeKey);
        // 重新加载页面是应用新 CSS 和新 data.js (用于 SPECIAL_CONTACTS_DEFINITIONS) 的一种简单方法
        window.location.reload();
    },

    // Getter，供 SettingsUIManager 了解当前状态
    getCurrentEffectiveColorScheme: function() {
        return this._currentEffectiveColorScheme;
    },
    getCurrentThemeKey: function() {
        return this._currentThemeKey;
    }
};

ThemeLoader.init();