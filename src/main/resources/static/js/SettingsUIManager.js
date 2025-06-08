// MODIFIED: SettingsUIManager.js
// Added theme selector population and event handling.
const SettingsUIManager = {
    // ... (previous properties from Part 1)
    colorSchemeSelectedValueEl: null,
    colorSchemeOptionsContainerEl: null,
    themeSelectedValueEl: null,
    themeOptionsContainerEl: null,

    // Fallback default values for AI settings if Config.server is not properly initialized
    FALLBACK_AI_DEFAULTS: {
        apiEndpoint: '', api_key: '', model: 'default-model', max_tokens: 2048, ttsApiEndpoint: ''
    },

    init: function() {
        // AI and TTS config input elements
        this.apiEndpointInput = document.getElementById('apiEndpointInput');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiModelInput = document.getElementById('apiModelInput');
        this.apiMaxTokensInput = document.getElementById('apiMaxTokensInput');
        this.ttsApiEndpointInput = document.getElementById('ttsApiEndpointInput');

        this.autoConnectToggle = document.getElementById('autoConnectToggle');
        this.modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        this.checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        this.modalUserIdValue = document.getElementById('modalUserIdValue');

        // Theme and Color Scheme selectors
        this.colorSchemeSelectedValueEl = document.getElementById('colorSchemeSelectedValue');
        this.colorSchemeOptionsContainerEl = document.getElementById('colorSchemeOptionsContainer');
        this.themeSelectedValueEl = document.getElementById('themeSelectedValue');
        this.themeOptionsContainerEl = document.getElementById('themeOptionsContainer');

        this.loadAISettings();
        this.bindEvents();
        this.initThemeSelectors(); // Populate theme selectors
    },

    bindEvents: function() {
        // ... (previous AI, Preferences, Network, User ID, Danger Zone event bindings from Part 1)
        // Add blur event listeners to save settings
        if (this.apiEndpointInput) this.apiEndpointInput.addEventListener('blur', () => this.saveAISetting('apiEndpoint', this.apiEndpointInput.value));
        if (this.apiKeyInput) this.apiKeyInput.addEventListener('blur', () => this.saveAISetting('api_key', this.apiKeyInput.value)); // storageKey uses underscore for api_key
        if (this.apiModelInput) this.apiModelInput.addEventListener('blur', () => this.saveAISetting('model', this.apiModelInput.value));
        if (this.apiMaxTokensInput) this.apiMaxTokensInput.addEventListener('blur', () => {
            const val = parseInt(this.apiMaxTokensInput.value, 10);
            let fallbackMaxTokens = (window.Config && window.Config.server && typeof window.Config.server.max_tokens === 'number')
                ? window.Config.server.max_tokens
                : this.FALLBACK_AI_DEFAULTS.max_tokens;
            this.saveAISetting('max_tokens', isNaN(val) ? fallbackMaxTokens : val);
        });
        if (this.ttsApiEndpointInput) this.ttsApiEndpointInput.addEventListener('blur', () => this.saveAISetting('ttsApiEndpoint', this.ttsApiEndpointInput.value));

        // Preferences
        if (this.autoConnectToggle) {
            this.autoConnectToggle.addEventListener('change', (event) => {
                if (UserManager.userSettings) {
                    UserManager.updateUserSetting('autoConnectEnabled', event.target.checked);
                    if (event.target.checked) {
                        NotificationManager.showNotification('Auto-connect enabled. Will attempt on next app start or successful signaling connection.', 'info');
                        if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) {
                            ConnectionManager.autoConnectToAllContacts();
                        }
                    } else {
                        NotificationManager.showNotification('Auto-connect disabled.', 'info');
                    }
                }
            });
        }
        // Network Status
        if (this.checkNetworkBtnModal) this.checkNetworkBtnModal.addEventListener('click', async () => {
            if (this.checkNetworkBtnModal.disabled) {
                NotificationManager.showNotification('Currently connected to signaling server.', 'info');
                return;
            }
            NotificationManager.showNotification('Re-checking network and attempting to connect...', 'info');
            await AppInitializer.refreshNetworkStatusUI();
            if (!ConnectionManager.isWebSocketConnected) {
                Utils.log("Re-check Network button: WebSocket not connected, attempting to connect.", Utils.logLevels.INFO);
                ConnectionManager.connectWebSocket().catch(err => {
                    NotificationManager.showNotification('Failed to re-establish signaling connection.', 'error');
                    Utils.log(`Manual Re-check Network: connectWebSocket failed: ${err.message || err}`, Utils.logLevels.ERROR);
                });
            }
        });

        // User ID
        if (this.modalCopyIdBtn) this.modalCopyIdBtn.addEventListener('click', () => {
            if (this.modalCopyIdBtn.disabled) return;
            this.copyUserIdFromModal();
        });
        // SDP Text Area Copy
        const modalCopySdpBtn = document.getElementById('modalCopySdpBtn');
        if(modalCopySdpBtn) modalCopySdpBtn.addEventListener('click', () => this.copySdpTextFromModal());


        // Danger Zone
        const modalResetAllConnectionsBtn = document.getElementById('modalResetAllConnectionsBtn');
        if (modalResetAllConnectionsBtn) modalResetAllConnectionsBtn.addEventListener('click', () => ConnectionManager.resetAllConnections());

        const modalClearContactsBtn = document.getElementById('modalClearContactsBtn');
        if (modalClearContactsBtn) modalClearContactsBtn.addEventListener('click', () => UserManager.clearAllContacts());

        const modalClearAllChatsBtn = document.getElementById('modalClearAllChatsBtn');
        if (modalClearAllChatsBtn) modalClearAllChatsBtn.addEventListener('click', () => ChatManager.clearAllChats());


        // Collapsible sections in Main Menu (AI & Advanced)
        const collapsibleHeaders = document.querySelectorAll('#mainMenuModal .settings-section .collapsible-header');
        collapsibleHeaders.forEach(header => {
            header.addEventListener('click', function() { // Use function() for `this`
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                const icon = this.querySelector('.collapse-icon');
                if (content && content.classList.contains('collapsible-content')) {
                    if (content.style.display === 'block' || content.style.display === '') {
                        content.style.display = 'none';
                        if (icon) icon.textContent = '▶';
                    } else {
                        content.style.display = 'block';
                        if (icon) icon.textContent = '▼';
                    }
                }
            });
            // Ensure initial icon state is correct based on display style
            const content = header.nextElementSibling;
            const icon = header.querySelector('.collapse-icon');
            if (content && content.classList.contains('collapsible-content') && icon) {
                if (content.style.display === 'none') icon.textContent = '▶'; else icon.textContent = '▼';
            }
        });

        // Global click listener to close custom dropdowns (for themes)
        document.addEventListener('click', (e) => {
            const themeCustomSelect = document.getElementById('themeCustomSelectContainer');
            if (this.themeOptionsContainerEl && themeCustomSelect && !themeCustomSelect.contains(e.target)) {
                this.themeOptionsContainerEl.style.display = 'none';
            }
            const colorSchemeCustomSelect = document.getElementById('colorSchemeCustomSelectContainer');
            if (this.colorSchemeOptionsContainerEl && colorSchemeCustomSelect && !colorSchemeCustomSelect.contains(e.target)) {
                this.colorSchemeOptionsContainerEl.style.display = 'none';
            }
        });
    },

    initThemeSelectors: function() {
        this._populateColorSchemeSelector();
        this._populateThemeSelectorWithOptions();
    },

    _populateColorSchemeSelector: function() {
        if (!this.colorSchemeSelectedValueEl || !this.colorSchemeOptionsContainerEl) {
            console.warn("Custom color scheme selector elements not found.");
            return;
        }
        const schemes = { 'auto': 'Auto (System)', 'light': 'Light Mode', 'dark': 'Dark Mode' };
        const currentPreferredScheme = localStorage.getItem(ThemeLoader.COLOR_SCHEME_KEY) || ThemeLoader.DEFAULT_COLOR_SCHEME;

        this.colorSchemeSelectedValueEl.textContent = schemes[currentPreferredScheme];
        this.colorSchemeOptionsContainerEl.innerHTML = '';

        for (const key in schemes) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = schemes[key];
            optionDiv.dataset.schemeKey = key;
            optionDiv.addEventListener('click', () => {
                const selectedSchemeKey = optionDiv.dataset.schemeKey;
                localStorage.setItem(ThemeLoader.COLOR_SCHEME_KEY, selectedSchemeKey);
                // ThemeLoader.applyTheme will handle the reload and re-evaluation
                // We just need to trigger it if the *effective* scheme changes and a different theme variant is needed.
                const newEffectiveColorScheme = ThemeLoader._getEffectiveColorScheme(selectedSchemeKey); // Use ThemeLoader's internal logic
                ThemeLoader._setupSystemColorSchemeListener(selectedSchemeKey); // Update listener

                if (newEffectiveColorScheme !== ThemeLoader.getCurrentEffectiveColorScheme()) {
                    // Effective scheme changed, find the counterpart theme and apply
                    const currentBaseName = ThemeLoader._getBaseThemeName(ThemeLoader.getCurrentThemeKey());
                    const newSuffix = newEffectiveColorScheme === 'light' ? '浅色' : '深色';
                    let newThemeToApply = `${currentBaseName}-${newSuffix}`;
                    if (!ThemeLoader.themes[newThemeToApply] || !ThemeLoader._isThemeCompatible(newThemeToApply, newEffectiveColorScheme)) {
                        newThemeToApply = ThemeLoader._findFallbackThemeKeyForScheme(newEffectiveColorScheme);
                    }
                    ThemeLoader.applyTheme(newThemeToApply); // This reloads the page
                } else {
                    // Effective scheme didn't change, just update display and re-populate theme options if needed
                    this.colorSchemeSelectedValueEl.textContent = schemes[selectedSchemeKey];
                    this.colorSchemeOptionsContainerEl.style.display = 'none';
                    this._populateThemeSelectorWithOptions(); // Re-filter themes for the current (but possibly newly confirmed) scheme
                }
            });
            this.colorSchemeOptionsContainerEl.appendChild(optionDiv);
        }

        this.colorSchemeSelectedValueEl.addEventListener('click', (event) => {
            event.stopPropagation();
            const currentDisplayState = this.colorSchemeOptionsContainerEl.style.display;
            document.querySelectorAll('.custom-select .options').forEach(opt => { if (opt !== this.colorSchemeOptionsContainerEl) opt.style.display = 'none';});
            this.colorSchemeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
        });
    },

    _populateThemeSelectorWithOptions: function() {
        if (!this.themeSelectedValueEl || !this.themeOptionsContainerEl) {
            console.warn("Custom theme selector elements not found.");
            return;
        }
        this.themeOptionsContainerEl.innerHTML = '';
        const currentEffectiveColorScheme = ThemeLoader.getCurrentEffectiveColorScheme();
        const filteredThemes = {};
        for (const key in ThemeLoader.themes) {
            if (ThemeLoader._isThemeCompatible(key, currentEffectiveColorScheme)) { // Use ThemeLoader's internal logic
                filteredThemes[key] = ThemeLoader.themes[key];
            }
        }

        let themeKeyForDisplay = ThemeLoader.getCurrentThemeKey();
        if (!filteredThemes[themeKeyForDisplay]) { // If current theme isn't compatible, find a fallback
            themeKeyForDisplay = Object.keys(filteredThemes)[0] || ThemeLoader._findFallbackThemeKeyForScheme(currentEffectiveColorScheme);
        }

        this.themeSelectedValueEl.textContent = ThemeLoader.themes[themeKeyForDisplay]?.name || 'Select Theme';
        this.themeSelectedValueEl.dataset.currentThemeKey = themeKeyForDisplay;

        if (Object.keys(filteredThemes).length === 0) {
            this.themeSelectedValueEl.textContent = "No themes";
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = `No ${currentEffectiveColorScheme} themes`;
            optionDiv.style.pointerEvents = "none"; optionDiv.style.opacity = "0.7";
            this.themeOptionsContainerEl.appendChild(optionDiv);
        } else {
            for (const key in filteredThemes) {
                const theme = filteredThemes[key];
                const optionDiv = document.createElement('div');
                optionDiv.classList.add('option');
                optionDiv.textContent = theme.name;
                optionDiv.dataset.themeKey = key;
                optionDiv.addEventListener('click', () => {
                    const selectedKey = optionDiv.dataset.themeKey;
                    // Only apply if different from current selection to avoid unnecessary reloads
                    if (selectedKey !== ThemeLoader.getCurrentThemeKey()) {
                        ThemeLoader.applyTheme(selectedKey); // This reloads the page
                    }
                    this.themeOptionsContainerEl.style.display = 'none';
                });
                this.themeOptionsContainerEl.appendChild(optionDiv);
            }
        }

        this.themeSelectedValueEl.addEventListener('click', (event) => {
            event.stopPropagation();
            const currentDisplayState = this.themeOptionsContainerEl.style.display;
            document.querySelectorAll('.custom-select .options').forEach(opt => { if (opt !== this.themeOptionsContainerEl) opt.style.display = 'none'; });
            this.themeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
        });
    },

    // ... (loadAISetting, saveAISetting, copyUserIdFromModal, updateCopyIdButtonState, updateCheckNetworkButtonState, updateMainMenuControlsState, updateNetworkInfoDisplay from Part 1)
    loadAISettings: function() { // from Part 1
        if (typeof window.Config !== 'object' || window.Config === null) window.Config = {};
        if (typeof window.Config.server !== 'object' || window.Config.server === null) window.Config.server = {};

        const settingsToLoad = [
            { storageKey: 'apiEndpoint', input: this.apiEndpointInput, configKey: 'apiEndpoint', defaultValue: Config.server.apiEndpoint },
            { storageKey: 'api_key', input: this.apiKeyInput, configKey: 'api_key', defaultValue: Config.server.api_key },
            { storageKey: 'model', input: this.apiModelInput, configKey: 'model', defaultValue: Config.server.model },
            { storageKey: 'max_tokens', input: this.apiMaxTokensInput, configKey: 'max_tokens', defaultValue: Config.server.max_tokens, isNumber: true },
            { storageKey: 'ttsApiEndpoint', input: this.ttsApiEndpointInput, configKey: 'ttsApiEndpoint', defaultValue: Config.server.ttsApiEndpoint }
        ];
        settingsToLoad.forEach(setting => {
            const savedValue = localStorage.getItem(`aiSetting_${setting.storageKey}`);
            let valueToSet = savedValue !== null ? savedValue : (setting.defaultValue !== undefined ? setting.defaultValue : this.FALLBACK_AI_DEFAULTS[setting.configKey]);
            if (setting.isNumber) {
                valueToSet = parseInt(valueToSet, 10);
                if (isNaN(valueToSet)) valueToSet = this.FALLBACK_AI_DEFAULTS[setting.configKey];
            }
            if (valueToSet === null || valueToSet === undefined) valueToSet = this.FALLBACK_AI_DEFAULTS[setting.configKey] ?? "";
            if (setting.input) setting.input.value = valueToSet;
            window.Config.server[setting.configKey] = valueToSet;
        });
    },
    saveAISetting: function(storageKey, value) { // from Part 1
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try { new URL(value); }
            catch (_) {
                NotificationManager.showNotification(`Invalid URL for ${storageKey.replace(/_/g, ' ')}. Not saved.`, 'error');
                const inputEl = storageKey === 'apiEndpoint' ? this.apiEndpointInput : this.ttsApiEndpointInput;
                const configKey = storageKey === 'apiEndpoint' ? 'apiEndpoint' : 'ttsApiEndpoint';
                if (inputEl) inputEl.value = localStorage.getItem(`aiSetting_${storageKey}`) || (window.Config?.server?.[configKey] ?? this.FALLBACK_AI_DEFAULTS[configKey] ?? "");
                return;
            }
        }
        if (storageKey === 'max_tokens') {
            const numValue = parseInt(value, 10);
            if (isNaN(numValue) || numValue <= 0) {
                NotificationManager.showNotification('Max Tokens must be positive. Not saved.', 'error');
                if (this.apiMaxTokensInput) this.apiMaxTokensInput.value = localStorage.getItem('aiSetting_max_tokens') || (window.Config?.server?.max_tokens ?? this.FALLBACK_AI_DEFAULTS.max_tokens);
                return;
            }
            value = numValue;
        }
        localStorage.setItem(`aiSetting_${storageKey}`, value);
        let configUpdated = false;
        if (window.Config && window.Config.server) { window.Config.server[storageKey] = value; configUpdated = true; }
        else { Utils.log(`CRITICAL: window.Config.server N/A when saving AI setting ${storageKey}.`, Utils.logLevels.ERROR); }
        const friendlyName = storageKey.charAt(0).toUpperCase() + storageKey.slice(1).replace(/_/g, ' ');
        if (configUpdated) NotificationManager.showNotification(`${friendlyName} setting saved & applied.`, 'success');
        else NotificationManager.showNotification(`${friendlyName} saved to storage, FAILED to apply live. Refresh.`, 'error');
    },
    copyUserIdFromModal: function () { // from Part 1
        const userId = this.modalUserIdValue?.textContent;
        if (userId && userId !== "Generating...") {
            navigator.clipboard.writeText(userId)
                .then(() => NotificationManager.showNotification('User ID copied!', 'success'))
                .catch(() => NotificationManager.showNotification('Failed to copy ID.', 'error'));
        }
    },
    copySdpTextFromModal: function () {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (sdpTextEl && sdpTextEl.value) {
            navigator.clipboard.writeText(sdpTextEl.value)
                .then(() => NotificationManager.showNotification('Connection Info copied!', 'success'))
                .catch(() => NotificationManager.showNotification('Failed to copy info.', 'error'));
        } else {
            NotificationManager.showNotification('No connection info to copy.', 'warning');
        }
    },
    updateCopyIdButtonState: function() { // from Part 1
        if (!this.modalUserIdValue || !this.modalCopyIdBtn) return;
        const userIdReady = this.modalUserIdValue.textContent !== 'Generating...' && UserManager.userId;
        this.modalCopyIdBtn.disabled = !userIdReady;
        this.modalCopyIdBtn.title = userIdReady ? 'Copy User ID' : 'User ID not yet generated.';
        this.modalCopyIdBtn.classList.toggle('btn-action-themed', userIdReady);
        this.modalCopyIdBtn.classList.toggle('btn-secondary', !userIdReady);
    },
    updateCheckNetworkButtonState: function() { // from Part 1
        if (!this.checkNetworkBtnModal) return;
        const isConnected = ConnectionManager.isWebSocketConnected;
        this.checkNetworkBtnModal.disabled = isConnected;
        this.checkNetworkBtnModal.classList.toggle('btn-action-themed', !isConnected);
        this.checkNetworkBtnModal.classList.toggle('btn-secondary', isConnected);
    },
    updateMainMenuControlsState: function() { // from Part 1
        if (this.autoConnectToggle && UserManager.userSettings) {
            this.autoConnectToggle.checked = UserManager.userSettings.autoConnectEnabled;
        }
        this.updateCopyIdButtonState();
        this.updateCheckNetworkButtonState();
    },
    updateNetworkInfoDisplay: function (networkType, webSocketStatus) { // from Part 1
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');
        if (!networkInfoEl || !qualityIndicator || !qualityText) return;
        let html = ''; let overallQuality = 'N/A'; let qualityClass = '';
        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4?'✓':'✗'} | IPv6: ${networkType.ipv6?'✓':'✗'} <br>`;
            html += `UDP: ${networkType.udp?'✓':'✗'} | TCP: ${networkType.tcp?'✓':'✗'} | Relay: ${networkType.relay?'✓':'?'} <br>`;
        } else html += 'WebRTC Network detection: ' + (networkType?.error || 'Failed/Unsupported') + '.<br>';
        html += `Signaling Server: ${webSocketStatus ? '<span style="color: green;">Connected</span>' : '<span style="color: var(--danger-color, red);">Disconnected</span>'}`;
        networkInfoEl.innerHTML = html;
        if (!webSocketStatus) { overallQuality = 'Signaling Offline'; qualityClass = 'quality-poor'; }
        else if (networkType && networkType.error === null) {
            if (networkType.udp) { overallQuality = 'Good'; qualityClass = 'quality-good'; }
            else if (networkType.tcp) { overallQuality = 'Limited (TCP Fallback)'; qualityClass = 'quality-medium'; }
            else if (networkType.relay) { overallQuality = 'Relay Only'; qualityClass = 'quality-medium'; }
            else { overallQuality = 'Poor (WebRTC P2P Failed)'; qualityClass = 'quality-poor'; }
        } else { overallQuality = 'WebRTC Check Failed'; qualityClass = 'quality-poor'; }
        qualityIndicator.className = `quality-indicator ${qualityClass}`;
        qualityText.textContent = overallQuality;
    },
};