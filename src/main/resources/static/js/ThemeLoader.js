// MODIFIED: ThemeLoader.js
// - populateSelector logic (creating dropdowns) is fully moved to SettingsUIManager.
// - This file now focuses purely on determining which theme to load (CSS/DataJS).
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
    _currentEffectiveColorScheme: 'light', // Will be set in init
    _currentThemeKey: null, // Will be set in init
    _systemColorSchemeListener: null,

    init: function() { // This function runs very early (called directly in index.html or by AppInitializer very early)
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme);

        let savedThemeKey = localStorage.getItem('selectedTheme');
        let themeToLoad;

        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            themeToLoad = this.themes[savedThemeKey];
            this._currentThemeKey = savedThemeKey;
        } else {
            let newThemeKey;
            if (savedThemeKey && this.themes[savedThemeKey]) { // If saved theme existed but was incompatible
                const baseName = this._getBaseThemeName(savedThemeKey);
                const suffix = this._currentEffectiveColorScheme === 'light' ? '浅色' : '深色';
                const counterpartKey = `${baseName}-${suffix}`;
                if (this.themes[counterpartKey] && this._isThemeCompatible(counterpartKey, this._currentEffectiveColorScheme)) {
                    newThemeKey = counterpartKey;
                }
            }

            if (!newThemeKey) { // Or if savedThemeKey was null/invalid or no counterpart found
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }
            this._currentThemeKey = newThemeKey; // Update the internal current theme key
            themeToLoad = this.themes[newThemeKey];
            localStorage.setItem('selectedTheme', newThemeKey);
        }

        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (themeStylesheet) {
            if (themeToLoad && themeToLoad.css) {
                themeStylesheet.setAttribute('href', themeToLoad.css);
            } else {
                themeStylesheet.setAttribute('href', ''); // Fallback to no theme CSS
                console.warn("Theme object or theme.css is missing for key:", this._currentThemeKey);
            }
        } else {
            console.error("Critical: Theme stylesheet element 'theme-stylesheet' not found.");
        }

        // Load theme-specific data (SPECIAL_CONTACTS_DEFINITIONS)
        // This needs to happen before UserManager.init()
        if (themeToLoad && themeToLoad.dataJs) {
            // Using document.write is generally okay here because ThemeLoader.init() is called
            // very early in the page load, before the DOM is fully parsed.
            document.write(`<script src="${themeToLoad.dataJs}"><\/script>`);
        } else {
            // Ensure SPECIAL_CONTACTS_DEFINITIONS is defined globally if no dataJs is present
            if (typeof SPECIAL_CONTACTS_DEFINITIONS === 'undefined') {
                document.write(`<script>var SPECIAL_CONTACTS_DEFINITIONS = [];<\/script>`);
            }
        }
        this._setupSystemColorSchemeListener(preferredColorScheme); // Setup listener for 'auto'
    },

    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown";
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, "");
    },

    _isThemeCompatible: function(themeKey, colorScheme) { // colorScheme is 'light' or 'dark'
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
        return 'light'; // Default for 'auto' if system preference is not dark or not detectable
    },

    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
        for (const key in this.themes) {
            if (key.endsWith(suffix)) return key;
        }
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            console.warn(`No themes found for scheme '${colorScheme}', falling back to first available: ${firstKey}`);
            return firstKey;
        }
        console.error("CRITICAL: No themes defined in ThemeLoader.themes. Using hardcoded default.");
        return '原神-浅色'; // Absolute fallback
    },

    _setupSystemColorSchemeListener: function(preferredScheme) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        // Remove any existing listener before adding a new one
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        if (preferredScheme === 'auto') {
            this._systemColorSchemeListener = (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light';
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    // Update the effective scheme used by SettingsUIManager for filtering themes
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme;
                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApplyKey = `${currentBaseName}-${newSuffix}`;

                    // Check if the new counterpart theme exists
                    if (!this.themes[newThemeToApplyKey] || !this._isThemeCompatible(newThemeToApplyKey, newSystemEffectiveColorScheme)) {
                        newThemeToApplyKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    this.applyTheme(newThemeToApplyKey); // This will reload the page
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener);
        }
    },

    // populateSelector is REMOVED from here. SettingsUIManager will handle its own UI.
    // SettingsUIManager can access ThemeLoader.themes and ThemeLoader._currentEffectiveColorScheme
    // to build the dropdowns appropriately.

    applyTheme: function(themeKey) {
        if (!this.themes[themeKey]) {
            console.error(`Attempted to apply invalid theme key: ${themeKey}. Falling back.`);
            // Fallback to a theme compatible with the current effective color scheme
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }
        localStorage.setItem('selectedTheme', themeKey);
        // Reloading the page is a simple way to apply new CSS and new data.js (for SPECIAL_CONTACTS_DEFINITIONS)
        window.location.reload();
    },

    // Getter for SettingsUIManager to know the current state
    getCurrentEffectiveColorScheme: function() {
        return this._currentEffectiveColorScheme;
    },
    getCurrentThemeKey: function() {
        return this._currentThemeKey;
    }
};

ThemeLoader.init();