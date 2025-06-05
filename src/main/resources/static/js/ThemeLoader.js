const ThemeLoader = {
    themes: {
        "default": { name: "Default (Modern)", css: null, dataJs: null, defaultSpecialContacts: true },
        "蜡笔小新": { name: "蜡笔小新", css: "css/蜡笔小新.css", dataJs: "data/蜡笔小新.js" },
        "仙逆": { name: "仙逆", css: "css/仙逆.css", dataJs: "data/仙逆.js" },
        "仙逆-生死意境": { name: "仙逆-生死意境", css: "css/仙逆-生死意境.css", dataJs: "data/仙逆-生死意境.js" },
        "咒术回战": { name: "咒术回战", css: "css/咒术回战.css", dataJs: "data/咒术回战.js" }
    },
    init: function() {
        const savedThemeKey = localStorage.getItem('selectedTheme') || 'default';
        const theme = this.themes[savedThemeKey] || this.themes['default'];

        // Load theme CSS
        const themeStylesheet = document.getElementById('theme-stylesheet');
        if (theme.css) {
            themeStylesheet.setAttribute('href', theme.css);
        } else {
            themeStylesheet.setAttribute('href', ''); // No theme CSS for default
        }

        // Load theme data JS synchronously by writing a script tag
        // This is crucial for SPECIAL_CONTACTS_DEFINITIONS to be available before UserManager initializes
        if (theme.dataJs) {
            document.write(`<script src="${theme.dataJs}"><\/script>`);
        } else if (theme.defaultSpecialContacts) {
            // For default theme, or if dataJs is missing, define an empty array
            // so UserManager doesn't break if the variable isn't defined.
            // SPECIAL_CONTACTS_DEFINITIONS will be defined by theme dataJs files if they exist.
            // If not, this ensures the variable is present.
            if (typeof SPECIAL_CONTACTS_DEFINITIONS === 'undefined') {
                document.write(`<script>var SPECIAL_CONTACTS_DEFINITIONS = [];<\/script>`);
            }
        }
        // Populate selector later, after DOM is fully loaded, in AppInitializer
    },
    populateSelector: function() {
        const selector = document.getElementById('themeSelector');
        if (!selector) return;
        const currentThemeKey = localStorage.getItem('selectedTheme') || 'default';
        for (const key in this.themes) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = this.themes[key].name;
            if (key === currentThemeKey) {
                option.selected = true;
            }
            selector.appendChild(option);
        }
        selector.addEventListener('change', (event) => {
            this.applyTheme(event.target.value);
        });
    },
    applyTheme: function(themeKey) {
        localStorage.setItem('selectedTheme', themeKey);
        // Reload the page for changes (especially data JS and potentially CSS to take full effect cleanly)
        window.location.reload();
    }
};