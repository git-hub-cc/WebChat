const ThemeLoader = {
    themes: {
        "蜡笔小新-浅色": { name: "蜡笔小新", css: "css/蜡笔小新-浅色.css", dataJs: "data/蜡笔小新.js", defaultSpecialContacts: true },
        "蜡笔小新-深色": { name: "蜡笔小新", css: "css/蜡笔小新-深色.css", dataJs: "data/蜡笔小新.js" },
        "telegram-浅色": { name: "telegram", css: "css/telegram-浅色.css", dataJs: null },
        "telegram-深色": { name: "telegram", css: "css/telegram-深色.css", dataJs: null },
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
    },
    COLOR_SCHEME_KEY: 'selectedColorScheme',
    DEFAULT_COLOR_SCHEME: 'auto', // 'auto', 'light', 'dark'

    _currentEffectiveColorScheme: 'light',
    _currentThemeKey: '蜡笔小新-浅色',
    _systemColorSchemeListener: null,

    init: function() {
        const preferredColorScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;
        this._currentEffectiveColorScheme = this._getEffectiveColorScheme(preferredColorScheme);

        let savedThemeKey = localStorage.getItem('selectedTheme');
        let themeToLoad;

        if (savedThemeKey && this.themes[savedThemeKey] && this._isThemeCompatible(savedThemeKey, this._currentEffectiveColorScheme)) {
            themeToLoad = this.themes[savedThemeKey];
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

            if (!newThemeKey) { // Or if savedThemeKey was null/invalid
                newThemeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
            }

            savedThemeKey = newThemeKey;
            themeToLoad = this.themes[savedThemeKey];
            localStorage.setItem('selectedTheme', savedThemeKey);
        }

        this._currentThemeKey = savedThemeKey;
        const theme = themeToLoad;

        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (themeStylesheet) {
            if (theme && theme.css) {
                themeStylesheet.setAttribute('href', theme.css);
            } else {
                themeStylesheet.setAttribute('href', '');
                console.warn("Theme object or theme.css is missing for key:", savedThemeKey);
            }
        } else {
            console.warn("Theme stylesheet element 'theme-stylesheet' not found.");
        }

        if (theme && theme.dataJs) {
            document.write(`<script src="${theme.dataJs}"><\/script>`);
        } else {
            if (typeof SPECIAL_CONTACTS_DEFINITIONS === 'undefined') {
                document.write(`<script>var SPECIAL_CONTACTS_DEFINITIONS = [];<\/script>`);
            }
        }
        this._setupSystemColorSchemeListener(preferredColorScheme);
    },

    _getBaseThemeName: function(themeKey) {
        if (!themeKey) return "unknown"; // Return a placeholder for safety
        return themeKey.replace(/-浅色$/, "").replace(/-深色$/, "");
    },

    _isThemeCompatible: function(themeKey, colorScheme) { // colorScheme is 'light' or 'dark'
        if (!this.themes[themeKey]) return false;
        // The themeKey itself contains the scheme information (e.g., "theme-浅色" or "theme-深色")
        if (colorScheme === 'light') {
            return themeKey.endsWith('-浅色');
        } else if (colorScheme === 'dark') {
            return themeKey.endsWith('-深色');
        }
        return false; // Should not happen if colorScheme is always 'light' or 'dark'
    },

    _getEffectiveColorScheme: function(preferredScheme) {
        if (preferredScheme === 'light') return 'light';
        if (preferredScheme === 'dark') return 'dark';
        // For 'auto', determine from system
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    },

    _findFallbackThemeKeyForScheme: function(colorScheme) {
        const suffix = colorScheme === 'light' ? '-浅色' : '-深色';
        for (const key in this.themes) {
            // Use the key itself for checking the suffix
            if (key.endsWith(suffix)) {
                return key;
            }
        }
        // Fallback if no theme matches the desired scheme, pick first available of any scheme
        const firstKey = Object.keys(this.themes)[0];
        if (firstKey) {
            console.warn(`No themes for scheme '${colorScheme}', falling back to first available theme: ${firstKey}`);
            return firstKey;
        }
        console.error("CRITICAL: No themes defined. Using hardcoded default.");
        return '蜡笔小新-浅色';
    },

    _setupSystemColorSchemeListener: function(preferredScheme) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (this._systemColorSchemeListener) {
            mediaQuery.removeEventListener('change', this._systemColorSchemeListener);
            this._systemColorSchemeListener = null;
        }

        if (preferredScheme === 'auto') {
            this._systemColorSchemeListener = (e) => {
                const newSystemEffectiveColorScheme = e.matches ? 'dark' : 'light';
                if (newSystemEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    this._currentEffectiveColorScheme = newSystemEffectiveColorScheme;
                    const baseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newSystemEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeKey = `${baseName}-${newSuffix}`;

                    if (!this.themes[newThemeKey] || !this._isThemeCompatible(newThemeKey, newSystemEffectiveColorScheme)) {
                        newThemeKey = this._findFallbackThemeKeyForScheme(newSystemEffectiveColorScheme);
                    }
                    this.applyTheme(newThemeKey);
                }
            };
            mediaQuery.addEventListener('change', this._systemColorSchemeListener);
        }
    },

    populateSelector: function() {
        this._populateColorSchemeSelector();
        this._populateThemeSelectorWithOptions();

        // Global click listener to close dropdowns
        document.addEventListener('click', (e) => {
            const themeCustomSelect = document.getElementById('themeCustomSelectContainer');
            const themeOptions = document.getElementById('themeOptionsContainer');
            if (themeCustomSelect && !themeCustomSelect.contains(e.target) && themeOptions) {
                themeOptions.style.display = 'none';
            }

            const colorSchemeCustomSelect = document.getElementById('colorSchemeCustomSelectContainer');
            const colorSchemeOptions = document.getElementById('colorSchemeOptionsContainer');
            if (colorSchemeCustomSelect && !colorSchemeCustomSelect.contains(e.target) && colorSchemeOptions) {
                colorSchemeOptions.style.display = 'none';
            }
        });
    },

    _populateColorSchemeSelector: function() {
        const container = document.getElementById('colorSchemeCustomSelectContainer');
        const selectedDisplay = document.getElementById('colorSchemeSelectedValue');
        const optionsContainer = document.getElementById('colorSchemeOptionsContainer');

        if (!container || !selectedDisplay || !optionsContainer) {
            console.warn("Custom color scheme selector elements not found.");
            return;
        }

        const schemes = {
            'auto': 'Auto (System)',
            'light': 'Light Mode',
            'dark': 'Dark Mode'
        };
        const currentPreferredScheme = localStorage.getItem(this.COLOR_SCHEME_KEY) || this.DEFAULT_COLOR_SCHEME;

        selectedDisplay.textContent = schemes[currentPreferredScheme];
        optionsContainer.innerHTML = '';

        for (const key in schemes) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = schemes[key];
            optionDiv.dataset.schemeKey = key;

            optionDiv.addEventListener('click', () => {
                const selectedSchemeKey = optionDiv.dataset.schemeKey;
                localStorage.setItem(this.COLOR_SCHEME_KEY, selectedSchemeKey);

                const newEffectiveColorScheme = this._getEffectiveColorScheme(selectedSchemeKey);
                this._setupSystemColorSchemeListener(selectedSchemeKey);

                if (newEffectiveColorScheme !== this._currentEffectiveColorScheme) {
                    this._currentEffectiveColorScheme = newEffectiveColorScheme;
                    const currentBaseName = this._getBaseThemeName(this._currentThemeKey);
                    const newSuffix = newEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApply = `${currentBaseName}-${newSuffix}`;

                    if (!this.themes[newThemeToApply] || !this._isThemeCompatible(newThemeToApply, newEffectiveColorScheme)) {
                        newThemeToApply = this._findFallbackThemeKeyForScheme(newEffectiveColorScheme);
                    }
                    this.applyTheme(newThemeToApply);
                } else {
                    selectedDisplay.textContent = schemes[selectedSchemeKey];
                    optionsContainer.style.display = 'none';
                    this._populateThemeSelectorWithOptions();
                }
            });
            optionsContainer.appendChild(optionDiv);
        }

        selectedDisplay.addEventListener('click', (event) => {
            event.stopPropagation();
            const currentDisplayState = optionsContainer.style.display;
            // Close other dropdowns if any are open
            document.querySelectorAll('.custom-select .options').forEach(opt => {
                if (opt !== optionsContainer) opt.style.display = 'none';
            });
            optionsContainer.style.display = currentDisplayState === 'block' ? 'none' : 'block';
        });
    },

    _populateThemeSelectorWithOptions: function() {
        const customSelectContainer = document.getElementById('themeCustomSelectContainer');
        const selectedDisplay = document.getElementById('themeSelectedValue');
        const optionsContainer = document.getElementById('themeOptionsContainer');

        if (!customSelectContainer || !selectedDisplay || !optionsContainer) {
            console.warn("Custom theme selector elements not found. Cannot populate.");
            return;
        }

        optionsContainer.innerHTML = '';

        const filteredThemes = {};
        for (const key in this.themes) {
            if (this._isThemeCompatible(key, this._currentEffectiveColorScheme)) {
                filteredThemes[key] = this.themes[key];
            }
        }

        let themeKeyForDisplay = this._currentThemeKey;
        // Ensure the current theme key is actually compatible and present in filtered list
        if (!filteredThemes[themeKeyForDisplay]) {
            themeKeyForDisplay = Object.keys(filteredThemes)[0] || this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }

        selectedDisplay.textContent = this.themes[themeKeyForDisplay]?.name || 'Select Theme';
        selectedDisplay.dataset.currentThemeKey = themeKeyForDisplay;

        if (Object.keys(filteredThemes).length === 0) {
            selectedDisplay.textContent = "No themes";
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = `No ${this._currentEffectiveColorScheme} themes available`;
            optionDiv.style.pointerEvents = "none";
            optionDiv.style.opacity = "0.7";
            optionsContainer.appendChild(optionDiv);
        } else {
            for (const key in filteredThemes) {
                const theme = filteredThemes[key];
                const optionDiv = document.createElement('div');
                optionDiv.classList.add('option');
                optionDiv.textContent = theme.name;
                optionDiv.dataset.themeKey = key;

                optionDiv.addEventListener('click', () => {
                    const selectedKey = optionDiv.dataset.themeKey;
                    if (selectedKey !== (localStorage.getItem('selectedTheme') || this._currentThemeKey)) {
                        this.applyTheme(selectedKey);
                    } else {
                        optionsContainer.style.display = 'none';
                    }
                });
                optionsContainer.appendChild(optionDiv);
            }
        }

        selectedDisplay.addEventListener('click', (event) => {
            event.stopPropagation();
            const currentDisplayState = optionsContainer.style.display;
            // Close other dropdowns if any are open
            document.querySelectorAll('.custom-select .options').forEach(opt => {
                if (opt !== optionsContainer) opt.style.display = 'none';
            });
            optionsContainer.style.display = currentDisplayState === 'block' ? 'none' : 'block';
        });
    },

    applyTheme: function(themeKey) {
        if (!this.themes[themeKey]) {
            console.error(`Attempted to apply invalid theme: ${themeKey}. Falling back.`);
            themeKey = this._findFallbackThemeKeyForScheme(this._currentEffectiveColorScheme);
        }
        localStorage.setItem('selectedTheme', themeKey);
        window.location.reload();
    }
};