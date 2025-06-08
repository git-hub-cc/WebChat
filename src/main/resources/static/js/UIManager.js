const UIManager = {
    isDetailsPanelVisible: false,
// Properties for Open Source Info Modal
    openSourceInfoModal: null,
    closeOpenSourceInfoModalBtn: null,
    permanentlyCloseOpenSourceInfoModalBtn: null,
    openSourceModalTimerSpan: null,
    openSourceModalAutoCloseTimer: null,
    openSourceModalCountdownInterval: null,

    // AI Configuration input elements
    apiEndpointInput: null,
    apiKeyInput: null,
    apiModelInput: null,
    apiMaxTokensInput: null,
    ttsApiEndpointInput: null, // Already existed, now grouped with AI settings

    // Store bound event listener for details panel TTS config collapsible
    _boundTtsConfigCollapseListener: null,
    _boundSaveTtsListener: null, // For saving TTS settings from details panel

    // TTS Configuration fields definition
    TTS_CONFIG_FIELDS: [
        { key: 'enabled', label: 'Enable TTS', type: 'checkbox', default: false },
        { key: 'model_name', label: 'Model Name', type: 'text', default: 'GPT-SoVITS' },
        { key: 'speaker_name', label: 'Speaker Name', type: 'text', default: 'default_speaker' },
        { key: 'prompt_text_lang', label: 'Prompt Lang', type: 'select', default: '中文', options: ["中文"] },
        { key: 'emotion', label: 'Emotion', type: 'text', default: '默认' },
        { key: 'text_lang', label: 'Text Lang', type: 'select', default: '中文', options: ["中文", "英语", "日语"] },
        { key: 'text_split_method', label: 'Split Method', type: 'select', default: '按标点符号切', options: ["不切", "按标点符号切", "按标点符号和空格切", "按空格切"] },
        { key: 'seed', label: 'Seed', type: 'number', default: -1, step:1 },

        // Advanced parameters
        { key: 'top_k', label: 'Top K', type: 'number', default: 10, step:1, isAdvanced: true },
        { key: 'top_p', label: 'Top P', type: 'number', default: 1.0, step:0.1, min:0, max:1, isAdvanced: true },
        { key: 'temperature', label: 'Temperature', type: 'number', default: 1.0, step:0.1, min:0, max:2, isAdvanced: true },
        { key: 'batch_size', label: 'Batch Size', type: 'number', default: 10, step:1, isAdvanced: true },
        { key: 'batch_threshold', label: 'Batch Threshold', type: 'number', default: 0.75, step:0.01, min:0, max:1, isAdvanced: true },
        { key: 'split_bucket', label: 'Split Bucket', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'speed_facter', label: 'Speed Factor', type: 'number', default: 1.0, step:0.1, min:0.1, max:3.0, isAdvanced: true },
        { key: 'fragment_interval', label: 'Fragment Int.', type: 'number', default: 0.3, step:0.01, min:0, isAdvanced: true },
        { key: 'media_type', label: 'Media Type', type: 'select', default: 'wav', options: ["wav", "mp3", "ogg"], isAdvanced: true },
        { key: 'parallel_infer', label: 'Parallel Infer', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'repetition_penalty', label: 'Rep. Penalty', type: 'number', default: 1.35, step:0.01, min:1, isAdvanced: true }
    ],

    // Fallback default values for AI settings if Config.server is not properly initialized
    FALLBACK_AI_DEFAULTS: {
        apiEndpoint: '',
        api_key: '',
        model: 'default-model',
        max_tokens: 2048,
        ttsApiEndpoint: ''
    },


    initOpenSourceModal: function () { // Renamed to reflect broader settings initialization
        this.openSourceInfoModal = document.getElementById('openSourceInfoModal');
        this.closeOpenSourceInfoModalBtn = document.getElementById('closeOpenSourceInfoModalBtn');
        this.permanentlyCloseOpenSourceInfoModalBtn = document.getElementById('permanentlyCloseOpenSourceInfoModalBtn');
        this.openSourceModalTimerSpan = document.getElementById('openSourceModalTimer');
        this._bindOpenSourceInfoModalEvents();

        // AI & API Config collapsible section
        const collapsibleHeader = document.querySelector('#mainMenuModal .settings-section .collapsible-header');
        if (collapsibleHeader) {
            collapsibleHeader.addEventListener('click', function() {
                this.classList.toggle('active');
                const content = this.nextElementSibling;
                const icon = this.querySelector('.collapsible-icon');
                if (content.style.display === "block") {
                    content.style.display = "none";
                    if(icon) icon.textContent = '▼';
                } else {
                    content.style.display = "block";
                    if(icon) icon.textContent = '▲';
                }
            });
        }

        // Get AI and TTS config input elements
        this.apiEndpointInput = document.getElementById('apiEndpointInput');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiModelInput = document.getElementById('apiModelInput');
        this.apiMaxTokensInput = document.getElementById('apiMaxTokensInput');
        this.ttsApiEndpointInput = document.getElementById('ttsApiEndpointInput');

        // Load AI and TTS settings
        this.loadAISettings();

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
    },

    loadAISettings: function() {
        // Defensively ensure window.Config and window.Config.server are objects
        if (typeof window.Config !== 'object' || window.Config === null) {
            Utils.log(`CRITICAL: window.Config is not a valid object during AI settings load. This indicates a problem with Config.js loading or execution. Initializing window.Config = {}.`, Utils.logLevels.ERROR);
            window.Config = {};
        }
        if (typeof window.Config.server !== 'object' || window.Config.server === null) {
            Utils.log(`Warning: window.Config.server was not a valid object during AI settings load. Initializing window.Config.server = {}.`, Utils.logLevels.WARN);
            window.Config.server = {};
        }

        const settingsToLoad = [
            { storageKey: 'apiEndpoint', input: this.apiEndpointInput, configKey: 'apiEndpoint', defaultValue: Config.server.apiEndpoint },
            { storageKey: 'api_key', input: this.apiKeyInput, configKey: 'api_key', defaultValue: Config.server.api_key },
            { storageKey: 'model', input: this.apiModelInput, configKey: 'model', defaultValue: Config.server.model },
            { storageKey: 'max_tokens', input: this.apiMaxTokensInput, configKey: 'max_tokens', defaultValue: Config.server.max_tokens, isNumber: true },
            { storageKey: 'ttsApiEndpoint', input: this.ttsApiEndpointInput, configKey: 'ttsApiEndpoint', defaultValue: Config.server.ttsApiEndpoint }
        ];

        settingsToLoad.forEach(setting => {
            const savedValue = localStorage.getItem(`aiSetting_${setting.storageKey}`);
            let valueToSet = savedValue !== null ? savedValue :
                (setting.defaultValue !== undefined ? setting.defaultValue :
                    this.FALLBACK_AI_DEFAULTS[setting.configKey]);

            if (setting.isNumber) {
                if (valueToSet !== null && valueToSet !== undefined) {
                    const numVal = parseInt(valueToSet, 10);
                    valueToSet = isNaN(numVal) ? this.FALLBACK_AI_DEFAULTS[setting.configKey] : numVal;
                } else {
                    valueToSet = this.FALLBACK_AI_DEFAULTS[setting.configKey];
                }
            }

            if (valueToSet === null || valueToSet === undefined) {
                valueToSet = this.FALLBACK_AI_DEFAULTS[setting.configKey] !== undefined ? this.FALLBACK_AI_DEFAULTS[setting.configKey] : "";
            }

            if (setting.input) {
                setting.input.value = valueToSet;
            }
            // Update the live Config object
            // window.Config.server is guaranteed to be an object here
            window.Config.server[setting.configKey] = valueToSet;
            // Utils.log(`AI Setting loaded & applied: ${setting.configKey} = ${valueToSet}`, Utils.logLevels.DEBUG);
        });
    },

    saveAISetting: function(storageKey, value) {
        // Validate URL for endpoint settings
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try {
                new URL(value);
            } catch (_) {
                this.showNotification(`Invalid URL for ${storageKey.replace(/_/g, ' ')}. Setting not saved.`, 'error');
                const settingMap = {
                    apiEndpoint: { input: this.apiEndpointInput, configKey: 'apiEndpoint' },
                    ttsApiEndpoint: { input: this.ttsApiEndpointInput, configKey: 'ttsApiEndpoint' }
                };
                const currentSetting = settingMap[storageKey];
                if (currentSetting && currentSetting.input) {
                    const originalValue = localStorage.getItem(`aiSetting_${storageKey}`) ||
                        (window.Config && window.Config.server && window.Config.server[currentSetting.configKey] !== undefined ? window.Config.server[currentSetting.configKey] :
                            this.FALLBACK_AI_DEFAULTS[currentSetting.configKey]);
                    currentSetting.input.value = originalValue !== undefined ? originalValue : "";
                }
                return;
            }
        }

        if (storageKey === 'max_tokens') {
            const numValue = parseInt(value, 10);
            if (isNaN(numValue) || numValue <= 0) {
                this.showNotification('Max Tokens must be a positive number. Setting not saved.', 'error');
                if (this.apiMaxTokensInput) {
                    const fallbackMaxTokens = localStorage.getItem('aiSetting_max_tokens') ||
                        ((window.Config && window.Config.server && typeof window.Config.server.max_tokens === 'number')
                            ? window.Config.server.max_tokens
                            : this.FALLBACK_AI_DEFAULTS.max_tokens);
                    this.apiMaxTokensInput.value = fallbackMaxTokens;
                }
                return;
            }
            value = numValue;
        }

        localStorage.setItem(`aiSetting_${storageKey}`, value);
        let configWasUpdated = false;

        // Use a fresh reference to the global Config object at the time of saving
        const globalConfig = window.Config;

        if (typeof globalConfig !== 'object' || globalConfig === null) {
            Utils.log(`CRITICAL: window.Config is not a valid object at time of saveAISetting for ${storageKey}. Cannot update in-memory config.`, Utils.logLevels.ERROR);
        } else if (typeof globalConfig.server !== 'object' || globalConfig.server === null) {
            Utils.log(`CRITICAL: window.Config.server is not a valid object at time of saveAISetting for ${storageKey}. Initializing it.`, Utils.logLevels.ERROR);
            globalConfig.server = {}; // Initialize if missing, though loadAISettings should handle this.
            const previousValue = undefined; // No previous value if server object was just created
            globalConfig.server[storageKey] = value;
            if (globalConfig.server[storageKey] === value) {
                configWasUpdated = true;
                Utils.log(`Config.server created and ${storageKey} set to: ${value}`, Utils.logLevels.INFO);
            } else {
                Utils.log(`CRITICAL: Config.server created, but FAILED to set ${storageKey} to ${value}. Current: ${globalConfig.server[storageKey]}`, Utils.logLevels.ERROR);
            }
        } else {
            const previousValue = globalConfig.server[storageKey];
            globalConfig.server[storageKey] = value; // Update the property on the existing globalConfig.server

            if (globalConfig.server[storageKey] === value) {
                configWasUpdated = true;
                // More detailed log for successful update
                Utils.log(`UIManager.saveAISetting: Config.server.${storageKey} updated. Old: '${previousValue}', New: '${value}'. Object ID of Config.server: (enable deeper debugging if needed)`, Utils.logLevels.INFO);
            } else {
                Utils.log(`CRITICAL: UIManager.saveAISetting: Config.server.${storageKey} FAILED to update in memory. Attempted: '${value}', Current: '${globalConfig.server[storageKey]}', Old: '${previousValue}'.`, Utils.logLevels.ERROR);
            }
        }

        const friendlyName = storageKey.charAt(0).toUpperCase() + storageKey.slice(1).replace(/_/g, ' ');
        if (configWasUpdated) {
            this.showNotification(`${friendlyName} setting saved and applied.`, 'success');
        } else {
            this.showNotification(`${friendlyName} setting saved to storage, but FAILED to apply to live config. Please refresh.`, 'error');
        }
    },

    _bindOpenSourceInfoModalEvents: function () {
        if (this.closeOpenSourceInfoModalBtn) {
            this.closeOpenSourceInfoModalBtn.addEventListener('click', () => this.hideOpenSourceInfoModal());
        }
        if (this.permanentlyCloseOpenSourceInfoModalBtn) {
            this.permanentlyCloseOpenSourceInfoModalBtn.addEventListener('click', () => {
                localStorage.setItem('hideOpenSourceModalPermanently', 'true');
                this.hideOpenSourceInfoModal();
            });
        }
    },

    showOpenSourceInfoModal: function () {
        if (localStorage.getItem('hideOpenSourceModalPermanently') === 'true') {
            return; // Don't show if permanently hidden
        }

        if (this.openSourceInfoModal && this.openSourceModalTimerSpan) {
            this.openSourceInfoModal.style.display = 'flex';
            let countdown = 15;
            this.openSourceModalTimerSpan.textContent = countdown;

            // Clear any existing timers
            if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
            if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);

            this.openSourceModalCountdownInterval = setInterval(() => {
                countdown--;
                this.openSourceModalTimerSpan.textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(this.openSourceModalCountdownInterval);
                }
            }, 1000);

            this.openSourceModalAutoCloseTimer = setTimeout(() => {
                this.hideOpenSourceInfoModal();
            }, 15000);
        } else {
            Utils.log("Open Source Info Modal elements not found or not initialized.", Utils.logLevels.WARN);
        }
    },

    hideOpenSourceInfoModal: function () {
        if (this.openSourceInfoModal) {
            this.openSourceInfoModal.style.display = 'none';
        }
        // Clear timers when modal is hidden, regardless of how
        if (this.openSourceModalAutoCloseTimer) clearTimeout(this.openSourceModalAutoCloseTimer);
        if (this.openSourceModalCountdownInterval) clearInterval(this.openSourceModalCountdownInterval);
        this.openSourceModalAutoCloseTimer = null;
        this.openSourceModalCountdownInterval = null;
    },

    updateResponsiveUI: function () {
        const appContainer = document.querySelector('.app-container');
        if (window.innerWidth <= 768) {
            appContainer.classList.add('mobile-view');
            if (!appContainer.classList.contains('chat-view-active')) {
                this.showChatListArea();
            }
        } else {
            appContainer.classList.remove('mobile-view', 'chat-view-active');
            document.getElementById('sidebarNav').style.display = 'flex';
            document.getElementById('chatArea').style.display = 'flex';
        }
    },

    showChatListArea: function () {
        const appContainer = document.querySelector('.app-container');
        if (appContainer.classList.contains('mobile-view')) {
            appContainer.classList.remove('chat-view-active');
            document.getElementById('sidebarNav').style.display = 'flex';
            document.getElementById('chatArea').style.display = 'none';
        }
        this.toggleDetailsPanel(false);
    },

    showChatArea: function () {
        const appContainer = document.querySelector('.app-container');
        const chatAreaEl = document.getElementById('chatArea');

        if (appContainer && appContainer.classList.contains('mobile-view')) {
            appContainer.classList.add('chat-view-active');
            const sidebarNav = document.getElementById('sidebarNav');
            if (sidebarNav) sidebarNav.style.display = 'none';

            if (chatAreaEl) {
                chatAreaEl.style.display = 'flex';
            } else {
                Utils.log("UIManager.showChatArea: Critical error - chatArea element NOT FOUND!", Utils.logLevels.ERROR);
                return;
            }
        } else if (chatAreaEl) {
            chatAreaEl.style.display = 'flex';
        } else {
            Utils.log("UIManager.showChatArea: Critical error - chatArea element NOT FOUND! (desktop mode)", Utils.logLevels.ERROR);
            return;
        }

        const noChatSelectedScreen = document.getElementById('noChatSelectedScreen');
        if (noChatSelectedScreen) {
            noChatSelectedScreen.style.display = 'none';
        }

        const chatBox = document.getElementById('chatBox');
        if (chatBox) {
            chatBox.style.display = 'flex';
        } else {
            Utils.log("UIManager.showChatArea: chatBox element NOT FOUND!", Utils.logLevels.ERROR);
        }
    },

    showNoChatSelected: function () {
        document.getElementById('currentChatTitleMain').textContent = 'Select a chat';
        document.getElementById('currentChatStatusMain').textContent = '';
        const avatarEl = document.getElementById('currentChatAvatarMain');
        avatarEl.innerHTML = ''; // Clear previous content (text or image)
        avatarEl.className = 'chat-avatar-main'; // Reset class

        const chatHeaderMainEl = document.querySelector('.chat-header-main');
        if (chatHeaderMainEl) { // Remove character-specific classes from header
            chatHeaderMainEl.className = 'chat-header-main';
        }


        const chatBox = document.getElementById('chatBox');
        if (chatBox) {
            chatBox.innerHTML = '';
            chatBox.style.display = 'none'; // Corrected: 'none' not 'hidden'
        } else Utils.log("UIManager.showNoChatSelected: chatBox element NOT FOUND!", Utils.logLevels.ERROR);


        document.getElementById('noChatSelectedScreen').style.display = 'flex';

        this.enableChatInterface(false);
        this.toggleDetailsPanel(false);
        const appContainer = document.querySelector('.app-container');
        if (appContainer && appContainer.classList.contains('mobile-view')) {
            this.showChatListArea();
        }
    },

    updateChatHeader: function (title, status, avatarText, isGroup = false, isOwner = false) {
        document.getElementById('currentChatTitleMain').textContent = Utils.escapeHtml(title);
        document.getElementById('currentChatStatusMain').textContent = Utils.escapeHtml(status);
        const avatarEl = document.getElementById('currentChatAvatarMain');
        const chatHeaderMainEl = document.querySelector('.chat-header-main');

        // Reset character-specific classes from header first
        if (chatHeaderMainEl) {
            chatHeaderMainEl.className = 'chat-header-main';
        }

        avatarEl.className = 'chat-avatar-main'; // Reset classes
        if (isGroup) avatarEl.classList.add('group');

        const currentContact = UserManager.contacts[ChatManager.currentChatId];
        let avatarContentHtml = Utils.escapeHtml(avatarText) || Utils.escapeHtml(title).charAt(0).toUpperCase();

        if (currentContact) {
            if (currentContact.isSpecial) {
                avatarEl.classList.add('special-avatar', currentContact.id); // Add character ID class to avatar
                if (chatHeaderMainEl) {
                    chatHeaderMainEl.classList.add(`current-chat-${currentContact.id}`); // Add character ID class to header
                }
            }
            if (currentContact.avatarUrl) { // Check for custom avatar URL
                avatarContentHtml = `<img src="${currentContact.avatarUrl}" alt="${Utils.escapeHtml(title.charAt(0))}" class="avatar-image">`;
            }
        } else if (isGroup) {
            avatarContentHtml = Utils.escapeHtml(avatarText); // Ensure group avatar text is used
        }

        avatarEl.innerHTML = avatarContentHtml;

        document.getElementById('chatDetailsBtnMain').style.display = ChatManager.currentChatId ? 'block' : 'none';
    },

    updateChatHeaderStatus: function (statusText) {
        const statusEl = document.getElementById('currentChatStatusMain');
        if (statusEl) statusEl.textContent = Utils.escapeHtml(statusText);
    },

    enableChatInterface: function (enabled) {
        const elementsToToggle = [
            'messageInput', 'sendButtonMain', 'attachBtnMain',
            'voiceButtonMain', 'chatDetailsBtnMain'
        ];
        elementsToToggle.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });

        if (enabled && ChatManager.currentChatId) {
            const currentContact = UserManager.contacts[ChatManager.currentChatId];
            if (currentContact && currentContact.isSpecial) {
                this.setCallButtonsState(false); // Special contacts (like AI) generally don't support P2P calls
            } else {
                this.setCallButtonsState(ConnectionManager.isConnectedTo(ChatManager.currentChatId), ChatManager.currentChatId);
            }
        } else {
            this.setCallButtonsState(false);
        }

        if (enabled) {
            setTimeout(() => {
                const messageInput = document.getElementById('messageInput');
                if (messageInput) messageInput.focus();
            }, 100);
        }
    },

    setCallButtonsState(enabled, peerId = null) {
        const videoCallBtn = document.getElementById('videoCallButtonMain');
        const audioCallBtn = document.getElementById('audioCallButtonMain');
        const screenShareBtn = document.getElementById('screenShareButtonMain');

        const currentChat = ChatManager.currentChatId;
        const isGroupChat = currentChat?.startsWith('group_');
        const currentContact = UserManager.contacts[currentChat];
        const isSpecialChat = currentContact && currentContact.isSpecial; // Check if current chat is with any special contact

        const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

        const finalEnabledState = enabled && !isGroupChat && !isSpecialChat;

        if (videoCallBtn) videoCallBtn.disabled = !finalEnabledState;
        if (audioCallBtn) audioCallBtn.disabled = !finalEnabledState;
        if (screenShareBtn) screenShareBtn.disabled = !finalEnabledState || !canShareScreen;

        if (finalEnabledState && peerId) {
            videoCallBtn.onclick = () => VideoCallManager.initiateCall(peerId);
            audioCallBtn.onclick = () => VideoCallManager.initiateAudioCall(peerId);
            if (canShareScreen) screenShareBtn.onclick = () => VideoCallManager.initiateScreenShare(peerId);
        } else {
            if (videoCallBtn) videoCallBtn.onclick = null;
            if (audioCallBtn) audioCallBtn.onclick = null;
            if (screenShareBtn) screenShareBtn.onclick = null;
        }
    },

    updateConnectionStatusIndicator: function (message, type = 'info') {
        const statusTextEl = document.getElementById('connectionStatusText');
        const statusContainerEl = document.getElementById('connectionStatusGlobal');

        if (statusTextEl) statusTextEl.textContent = message;
        if (statusContainerEl) {
            statusContainerEl.className = 'status-indicator global'; // Reset classes
            if (type !== 'info') {
                statusContainerEl.classList.add(`status-${type}`); // Add specific type class
            }
        }
    },

    updateNetworkInfoDisplay: function (networkType, webSocketStatus) {
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');

        if (!networkInfoEl || !qualityIndicator || !qualityText) return;

        let html = '';
        let overallQuality = 'N/A';
        let qualityClass = '';

        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4 ? '✓' : '✗'} | IPv6: ${networkType.ipv6 ? '✓' : '✗'} <br>`;
            html += `UDP: ${networkType.udp ? '✓' : '✗'} | TCP: ${networkType.tcp ? '✓' : '✗'} | Relay: ${networkType.relay ? '✓' : '?'} <br>`;
        } else {
            html += 'WebRTC Network detection: ' + (networkType?.error || 'Failed or not supported') + '.<br>';
        }

        html += `Signaling Server: ${webSocketStatus ? '<span style="color: green;">Connected</span>' : '<span style="color: var(--danger-color, red);">Disconnected</span>'}`;
        networkInfoEl.innerHTML = html;

        // Determine overall quality based on network and WebSocket status
        if (!webSocketStatus) {
            overallQuality = 'Signaling Offline';
            qualityClass = 'quality-poor';
        } else if (networkType && networkType.error === null) {
            if (networkType.udp) {
                overallQuality = 'Good';
                qualityClass = 'quality-good';
            } else if (networkType.tcp) {
                overallQuality = 'Limited (TCP Fallback)';
                qualityClass = 'quality-medium';
            } else if (networkType.relay) {
                overallQuality = 'Relay Only';
                qualityClass = 'quality-medium';
            } else {
                overallQuality = 'Poor (WebRTC P2P Failed)';
                qualityClass = 'quality-poor';
            }
        } else {
            overallQuality = 'WebRTC Check Failed';
            qualityClass = 'quality-poor';
        }

        qualityIndicator.className = `quality-indicator ${qualityClass}`; // Reset and set class
        qualityText.textContent = overallQuality;
    },

    checkWebRTCSupport: function () {
        if (typeof RTCPeerConnection === 'undefined') {
            this.updateConnectionStatusIndicator('Browser does not support WebRTC.', 'error');
            this.updateNetworkInfoDisplay(null, ConnectionManager.isWebSocketConnected); // Pass current WS status
            return false;
        }
        return true;
    },

    showNotification: function (message, type = 'info') { // type: 'info', 'success', 'warning', 'error'
        const container = document.querySelector('.notification-container') || this._createNotificationContainer();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        const iconMap = {info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌'};

        notification.innerHTML = `
        <span class="notification-icon">${iconMap[type]}</span>
        <span class="notification-message">${Utils.escapeHtml(message)}</span>
        <button class="notification-close" title="Close">×</button>
    `;
        container.appendChild(notification);

        const removeNotification = () => {
            notification.classList.add('notification-hide');
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
                if (container.children.length === 0 && container.parentNode) container.remove(); // Remove container if empty
            }, 300); // Match CSS transition
        };

        notification.querySelector('.notification-close').onclick = removeNotification;
        setTimeout(removeNotification, type === 'error' ? 8000 : 5000); // Longer display for errors
    },
    _createNotificationContainer: function () {
        const container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
        return container;
    },

    toggleModal: function (modalId, show) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = show ? 'flex' : 'none';
            if (show && modalId === 'mainMenuModal') {
                AppInitializer.refreshNetworkStatusUI();
            }
        }
    },

    copyUserIdFromModal: function () {
        const userId = document.getElementById('modalUserIdValue').textContent;
        if (userId && userId !== "Generating...") {
            navigator.clipboard.writeText(userId)
                .then(() => this.showNotification('User ID copied!', 'success'))
                .catch(() => this.showNotification('Failed to copy ID.', 'error'));
        }
    },
    copySdpTextFromModal: function () {
        const sdpText = document.getElementById('modalSdpText').value;
        if (sdpText) {
            navigator.clipboard.writeText(sdpText)
                .then(() => this.showNotification('Connection Info copied!', 'success'))
                .catch(() => this.showNotification('Failed to copy info.', 'error'));
        } else {
            this.showNotification('No connection info to copy.', 'warning');
        }
    },


    handleAddNewContact: function () {
        const peerId = document.getElementById('newPeerIdInput').value.trim();
        const peerName = document.getElementById('newPeerNameInput').value.trim();
        if (!peerId) {
            UIManager.showNotification('Peer ID is required.', 'warning');
            return;
        }
        UserManager.addContact(peerId, peerName || `Peer ${peerId.substring(0, 4)}`);
        document.getElementById('newPeerIdInput').value = '';
        document.getElementById('newPeerNameInput').value = '';
        UIManager.toggleModal('newContactGroupModal', false);
    },

    handleCreateNewGroup: function () {
        const groupName = document.getElementById('newGroupNameInput').value.trim();
        if (!groupName) {
            UIManager.showNotification('Group Name is required.', 'warning');
            return;
        }
        GroupManager.createGroup(groupName);
        document.getElementById('newGroupNameInput').value = '';
        UIManager.toggleModal('newContactGroupModal', false);
    },

    setActiveTab: function (tabName) { // tabName: 'all', 'contacts', 'groups'
        document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => tab.classList.remove('active'));
        let targetTabId = '';
        if (tabName === 'all') targetTabId = 'tabAllChats';
        else if (tabName === 'contacts') targetTabId = 'tabContacts';
        else if (tabName === 'groups') targetTabId = 'tabGroups';

        const activeTabEl = document.getElementById(targetTabId);
        if (activeTabEl) activeTabEl.classList.add('active');
    },

    toggleDetailsPanel: function (show) {
        const detailsPanel = document.getElementById('detailsPanel');
        const appContainer = document.querySelector('.app-container');
        this.isDetailsPanelVisible = show;

        if (show) {
            if (!ChatManager.currentChatId) {
                this.isDetailsPanelVisible = false; // Ensure flag is correct
                return; // Don't show if no chat selected
            }
            detailsPanel.style.display = 'flex';
            appContainer.classList.add('show-details');
            this.updateDetailsPanel(ChatManager.currentChatId, ChatManager.currentChatId.startsWith('group_') ? 'group' : 'contact');
        } else {
            appContainer.classList.remove('show-details');
            // Delay hiding to allow for CSS transition if any (not strictly necessary for 'display:none')
            setTimeout(() => {
                if (!this.isDetailsPanelVisible) detailsPanel.style.display = 'none';
            }, 300); // Adjust time if CSS transitions are added to panel visibility
        }
    },

    updateDetailsPanel: function (chatId, type) {
        const detailsPanelEl = document.getElementById('detailsPanel'); // Get the panel itself
        const nameEl = document.getElementById('detailsName');
        const idEl = document.getElementById('detailsId');
        const avatarEl = document.getElementById('detailsAvatar');
        const statusEl = document.getElementById('detailsStatus');
        const contactActionsEl = document.getElementById('contactActionsDetails');
        const currentChatActionsEl = document.getElementById('currentChatActionsDetails');
        const clearCurrentChatBtnDetails = document.getElementById('clearCurrentChatBtnDetails');
        const groupMgmtEl = document.getElementById('detailsGroupManagement');
        const groupActionsEl = document.getElementById('groupActionsDetails');
        const deleteContactBtn = document.getElementById('deleteContactBtnDetails');
        const leaveGroupBtn = document.getElementById('leaveGroupBtnDetails');
        const dissolveGroupBtn = document.getElementById('dissolveGroupBtnDetails');

        // AI "About" section elements
        const aiContactAboutSectionEl = document.getElementById('aiContactAboutSection');
        const aiContactAboutNameEl = document.getElementById('aiContactAboutName');
        const aiContactBasicInfoListEl = document.getElementById('aiContactBasicInfoList');
        const aiContactAboutNameSubEl = document.getElementById('aiContactAboutNameSub');
        const aiContactAboutTextEl = document.getElementById('aiContactAboutText');

        // AI TTS Config Section elements
        const aiTtsConfigSectionEl = document.getElementById('aiTtsConfigSection');
        const aiTtsConfigHeaderEl = document.getElementById('aiTtsConfigHeader');
        const aiTtsConfigContentEl = document.getElementById('aiTtsConfigContent'); // The content area
        const saveAiTtsSettingsBtnDetails = document.getElementById('saveAiTtsSettingsBtnDetails');


        // Reset panel class list
        detailsPanelEl.className = 'details-panel';

        if (currentChatActionsEl) currentChatActionsEl.style.display = 'none';

        if (contactActionsEl) contactActionsEl.style.display = 'none';
        if (groupMgmtEl) groupMgmtEl.style.display = 'none';
        if (groupActionsEl) groupActionsEl.style.display = 'none';
        if (aiContactAboutSectionEl) aiContactAboutSectionEl.style.display = 'none';
        if (aiTtsConfigSectionEl) aiTtsConfigSectionEl.style.display = 'none';


        // Common actions for any selected chat
        if (chatId) {
            if (currentChatActionsEl && clearCurrentChatBtnDetails) {
                currentChatActionsEl.style.display = 'block';
                clearCurrentChatBtnDetails.onclick = () => MessageManager.clearChat();
            }
        }
        if (type === 'contact') {
            const contact = UserManager.contacts[chatId];
            if (!contact) return;

            // Add classes for CSS targeting
            detailsPanelEl.classList.add('contact-details-active');
            if (contact.isSpecial) {
                detailsPanelEl.classList.add(contact.id); // e.g., AI_早濑优香
            } else {
                detailsPanelEl.classList.add('human-contact-active');
            }


            nameEl.textContent = contact.name;
            idEl.textContent = `ID: ${contact.id}`;

            avatarEl.className = 'details-avatar'; // Reset
            let avatarContentHtml = Utils.escapeHtml(contact.avatarText || contact.name.charAt(0).toUpperCase());
            if (contact.isSpecial) avatarEl.classList.add('special-avatar', contact.id); // Add char ID
            if (contact.avatarUrl) {
                avatarContentHtml = `<img src="${contact.avatarUrl}" alt="${Utils.escapeHtml(contact.name.charAt(0))}" class="avatar-image">`;
            }
            avatarEl.innerHTML = avatarContentHtml;


            if (contact.isSpecial) {
                statusEl.textContent = (contact.isAI ? 'AI Assistant' : 'Special Contact') + ' - Always available';
                if (contactActionsEl) contactActionsEl.style.display = 'none'; // No "Delete Contact" for special contacts

                if (contact.isAI && contact.aboutDetails && aiContactAboutSectionEl) {
                    aiContactAboutSectionEl.style.display = 'block';
                    if (aiContactAboutNameEl) aiContactAboutNameEl.textContent = contact.aboutDetails.nameForAbout || contact.name;
                    if (aiContactAboutNameSubEl) aiContactAboutNameSubEl.textContent = contact.aboutDetails.nameForAbout || contact.name;

                    if (aiContactBasicInfoListEl) {
                        aiContactBasicInfoListEl.innerHTML = ''; // Clear previous
                        contact.aboutDetails.basicInfo.forEach(info => {
                            const li = document.createElement('li');
                            li.innerHTML = `<strong>${Utils.escapeHtml(info.label)}:</strong> ${Utils.escapeHtml(info.value)}`;
                            aiContactBasicInfoListEl.appendChild(li);
                        });
                    }
                    if (aiContactAboutTextEl) {
                        aiContactAboutTextEl.textContent = contact.aboutDetails.aboutText;
                    }
                }
                // AI TTS Configuration - always show for AI contacts
                if (contact.isAI && aiTtsConfigSectionEl) {
                    aiTtsConfigSectionEl.style.display = 'block';
                    this._populateAiTtsConfigurationForm(contact); // Populate the form

                    // Set up save button listener
                    if (saveAiTtsSettingsBtnDetails) {
                        if (this._boundSaveTtsListener) { // Remove old if exists
                            saveAiTtsSettingsBtnDetails.removeEventListener('click', this._boundSaveTtsListener);
                        }
                        this._boundSaveTtsListener = this._handleSaveAiTtsSettings.bind(this, contact.id);
                        saveAiTtsSettingsBtnDetails.addEventListener('click', this._boundSaveTtsListener);
                    }

                    // Collapsible listener for main TTS config section
                    if (aiTtsConfigHeaderEl) {
                        if(this._boundTtsConfigCollapseListener) { // If a listener was previously bound to this element
                            aiTtsConfigHeaderEl.removeEventListener('click', this._boundTtsConfigCollapseListener);
                        }
                        this._boundTtsConfigCollapseListener = function() { // Define new listener
                            this.classList.toggle('active');
                            const content = this.nextElementSibling; // aiTtsConfigContentEl
                            const icon = this.querySelector('.collapsible-icon');
                            if (content) {
                                if (content.style.display === "block") {
                                    content.style.display = "none";
                                    if(icon) icon.textContent = '▼';
                                } else {
                                    content.style.display = "block";
                                    if(icon) icon.textContent = '▲';
                                }
                            }
                        };
                        aiTtsConfigHeaderEl.addEventListener('click', this._boundTtsConfigCollapseListener);
                        // Ensure content is initially collapsed or open based on 'active' class
                        const icon = aiTtsConfigHeaderEl.querySelector('.collapsible-icon');
                        if (!aiTtsConfigHeaderEl.classList.contains('active') && aiTtsConfigContentEl) {
                            aiTtsConfigContentEl.style.display = 'none';
                            if(icon) icon.textContent = '▼';
                        } else if (aiTtsConfigContentEl) {
                            aiTtsConfigContentEl.style.display = 'block';
                            if(icon) icon.textContent = '▲';
                        }
                    }
                }


            } else { // Non-special (human) contact
                statusEl.textContent = ConnectionManager.isConnectedTo(chatId) ? 'Connected' : 'Offline';
                if (contactActionsEl) contactActionsEl.style.display = 'block'; // Show contact settings (like delete)
                if (deleteContactBtn) deleteContactBtn.onclick = () => ChatManager.deleteChat(chatId, 'contact');
                if (aiTtsConfigSectionEl) aiTtsConfigSectionEl.style.display = 'none'; // Hide AI TTS config for non-AI
            }

        } else if (type === 'group') {
            const group = GroupManager.groups[chatId];
            if (!group) return;

            detailsPanelEl.classList.add('group-chat-active');

            nameEl.textContent = group.name;
            idEl.textContent = `Group ID: ${group.id.substring(6)}`; // Show partial ID
            avatarEl.innerHTML = '👥'; // Groups use text avatar
            avatarEl.className = 'details-avatar group'; // Reset and add group class
            statusEl.textContent = `${group.members.length} member${group.members.length === 1 ? '' : 's'}`;

            if (groupMgmtEl) groupMgmtEl.style.display = 'block';
            if (groupActionsEl) groupActionsEl.style.display = 'block';


            const isOwner = group.owner === UserManager.userId;
            document.getElementById('addGroupMemberArea').style.display = isOwner ? 'block' : 'none';
            const leftMembersAreaEl = document.getElementById('leftMembersArea');
            if (leftMembersAreaEl) leftMembersAreaEl.style.display = isOwner && group.leftMembers && group.leftMembers.length > 0 ? 'block' : 'none';

            if (leaveGroupBtn) {
                if (isOwner) {
                    leaveGroupBtn.style.display = 'none'; // Owner uses dissolve, not leave
                } else {
                    leaveGroupBtn.style.display = 'block';
                    leaveGroupBtn.textContent = 'Leave Group';
                    leaveGroupBtn.onclick = () => ChatManager.deleteChat(chatId, 'group'); // deleteChat handles leave for non-owners
                    leaveGroupBtn.disabled = false;
                }
            }
            if (dissolveGroupBtn) {
                dissolveGroupBtn.style.display = isOwner ? 'block' : 'none';
                dissolveGroupBtn.onclick = () => ChatManager.deleteChat(chatId, 'group'); // deleteChat handles dissolve for owners
            }
            this.updateDetailsPanelMembers(chatId);
            if (aiContactAboutSectionEl) aiContactAboutSectionEl.style.display = 'none'; // Hide AI section for groups
            if (aiTtsConfigSectionEl) aiTtsConfigSectionEl.style.display = 'none'; // Hide AI TTS config for groups
        }
    },

    _populateAiTtsConfigurationForm: function(contact) {
        const formContainer = document.getElementById('ttsConfigFormContainer');
        if (!formContainer) return;

        formContainer.innerHTML = ''; // Clear previous form content
        const ttsSettings = (contact.aiConfig && contact.aiConfig.tts) ? contact.aiConfig.tts : {};

        const createFieldElement = (field, parentEl) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'tts-config-item';

            const label = document.createElement('label');
            label.htmlFor = `ttsInput_${field.key}`;
            label.textContent = field.label + ':';
            itemDiv.appendChild(label);

            let input;
            const currentValue = ttsSettings[field.key] !== undefined ? ttsSettings[field.key] : field.default;

            if (field.type === 'checkbox') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = currentValue;
            } else if (field.type === 'select') {
                input = document.createElement('select');
                (field.options || []).forEach(optValue => {
                    const option = document.createElement('option');
                    option.value = optValue;
                    option.textContent = optValue;
                    if (optValue === currentValue) option.selected = true;
                    input.appendChild(option);
                });
            } else { // text, number
                input = document.createElement('input');
                input.type = field.type;
                input.value = currentValue;
                if (field.step !== undefined) input.step = field.step;
                if (field.min !== undefined) input.min = field.min;
                if (field.max !== undefined) input.max = field.max;
                if (field.type === 'text' && field.default !== undefined) input.placeholder = String(field.default);
            }

            input.id = `ttsInput_${field.key}`;
            input.dataset.ttsParam = field.key; // Store key for easy retrieval
            itemDiv.appendChild(input);
            parentEl.appendChild(itemDiv);
        };

        const basicFields = this.TTS_CONFIG_FIELDS.filter(field => !field.isAdvanced);
        const advancedFields = this.TTS_CONFIG_FIELDS.filter(field => field.isAdvanced);

        // Render basic fields directly into formContainer
        basicFields.forEach(field => createFieldElement(field, formContainer));

        // If there are advanced fields, create a collapsible section for them
        if (advancedFields.length > 0) {
            const advancedSectionDiv = document.createElement('div');
            advancedSectionDiv.className = 'tts-config-section advanced-tts-section';

            const advancedHeader = document.createElement('div');
            advancedHeader.className = 'collapsible-header tts-advanced-header';
            advancedHeader.innerHTML = `<h5>Advanced</h5><span class="collapsible-icon">▼</span>`;

            const advancedFieldsContainer = document.createElement('div');
            advancedFieldsContainer.className = 'collapsible-content tts-advanced-fields-container';
            advancedFieldsContainer.style.display = 'none'; // Collapsed by default

            let advancedHeaderClickHandler = advancedHeader.getAttribute('data-click-handler-bound');
            if(advancedHeaderClickHandler !== 'true') {
                advancedHeader.addEventListener('click', function() {
                    this.classList.toggle('active');
                    const icon = this.querySelector('.collapsible-icon');
                    if (advancedFieldsContainer.style.display === "block") {
                        advancedFieldsContainer.style.display = "none";
                        if(icon) icon.textContent = '▼';
                    } else {
                        advancedFieldsContainer.style.display = "block";
                        if(icon) icon.textContent = '▲';
                    }
                });
                advancedHeader.setAttribute('data-click-handler-bound', 'true');
            }


            advancedFields.forEach(field => createFieldElement(field, advancedFieldsContainer));

            advancedSectionDiv.appendChild(advancedHeader);
            advancedSectionDiv.appendChild(advancedFieldsContainer);
            formContainer.appendChild(advancedSectionDiv);
        }
    },

    _handleSaveAiTtsSettings: async function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !contact.isAI || !contact.aiConfig) {
            this.showNotification("Error: Contact not found or not an AI contact.", "error");
            return;
        }

        if (!contact.aiConfig.tts) {
            contact.aiConfig.tts = {};
        }

        let changesMade = false;
        const newTtsSettings = {}; // Collect new settings here for localStorage

        this.TTS_CONFIG_FIELDS.forEach(field => {
            const inputElement = document.getElementById(`ttsInput_${field.key}`);
            if (inputElement) {
                let newValue;
                if (field.type === 'checkbox') {
                    newValue = inputElement.checked;
                } else if (field.type === 'number') {
                    newValue = parseFloat(inputElement.value);
                    if (isNaN(newValue)) newValue = field.default;
                } else {
                    newValue = inputElement.value;
                }

                if (contact.aiConfig.tts[field.key] !== newValue) {
                    changesMade = true;
                }
                contact.aiConfig.tts[field.key] = newValue; // Update in-memory contact object
                newTtsSettings[field.key] = newValue; // Add to settings for localStorage
            }
        });

        if (changesMade) {
            try {
                // Save to localStorage (contact-specific key)
                localStorage.setItem(`ttsConfig_${contactId}`, JSON.stringify(newTtsSettings));
                Utils.log(`TTS settings for ${contactId} saved to localStorage.`, Utils.logLevels.DEBUG);

                await UserManager.saveContact(contactId); // This saves the updated contact (with new TTS) to IndexedDB
                this.showNotification("TTS settings saved successfully.", "success");
            } catch (error) {
                Utils.log(`Failed to save TTS settings for ${contactId}: ${error}`, Utils.logLevels.ERROR);
                this.showNotification("Failed to save TTS settings.", "error");
            }
        } else {
            this.showNotification("No changes to TTS settings were made.", "info");
        }
    },


    updateDetailsPanelMembers: function (groupId) {
        const group = GroupManager.groups[groupId];
        if (!group) return;

        const memberListEl = document.getElementById('groupMemberListDetails');
        memberListEl.innerHTML = '';
        document.getElementById('groupMemberCount').textContent = group.members.length;

        group.members.forEach(memberId => {
            const member = UserManager.contacts[memberId] || {id: memberId, name: `User ${memberId.substring(0, 4)}`};
            const item = document.createElement('div');
            item.className = 'member-item-detail';
            let html = `<span>${Utils.escapeHtml(member.name)} ${memberId === UserManager.userId ? '(You)' : ''}</span>`;
            if (memberId === group.owner) html += '<span class="owner-badge">Owner</span>';
            else if (group.owner === UserManager.userId) { // Only owner can remove
                html += `<button class="remove-member-btn-detail" data-member-id="${memberId}" title="Remove member">✕</button>`;
            }
            item.innerHTML = html;
            memberListEl.appendChild(item);
        });

        memberListEl.querySelectorAll('.remove-member-btn-detail').forEach(btn => {
            btn.onclick = () => GroupManager.removeMemberFromGroup(groupId, btn.dataset.memberId);
        });

        // Populate contacts dropdown for adding new members
        const contactsDropdown = document.getElementById('contactsDropdownDetails');
        contactsDropdown.innerHTML = '<option value="">Select contact to add...</option>';
        Object.values(UserManager.contacts).forEach(contact => {
            // Exclude already members, left members, and special AI contacts
            if (!group.members.includes(contact.id) &&
                !(group.leftMembers?.find(lm => lm.id === contact.id)) &&
                !(contact.isSpecial && contact.isAI)) { // Don't add AI contacts to groups
                const option = document.createElement('option');
                option.value = contact.id;
                option.textContent = contact.name;
                contactsDropdown.appendChild(option);
            }
        });

        // Populate left members list
        const leftMemberListEl = document.getElementById('leftMemberListDetails');
        const leftMembersAreaEl = document.getElementById('leftMembersArea');
        leftMemberListEl.innerHTML = '';

        if (group.owner === UserManager.userId && group.leftMembers && group.leftMembers.length > 0) {
            group.leftMembers.forEach(leftMember => {
                const item = document.createElement('div');
                item.className = 'left-member-item-detail';
                item.innerHTML = `
                <span>${Utils.escapeHtml(leftMember.name)} (Left: ${Utils.formatDate(new Date(leftMember.leftTime))})</span>
                <button class="re-add-member-btn-detail" data-member-id="${leftMember.id}" data-member-name="${Utils.escapeHtml(leftMember.name)}" title="Re-add member">+</button>
            `;
                leftMemberListEl.appendChild(item);
            });
            leftMemberListEl.querySelectorAll('.re-add-member-btn-detail').forEach(btn => {
                btn.onclick = () => GroupManager.addMemberToGroup(groupId, btn.dataset.memberId, btn.dataset.memberName);
            });
            if (leftMembersAreaEl) leftMembersAreaEl.style.display = 'block';
        } else {
            if (leftMembersAreaEl) leftMembersAreaEl.style.display = 'none';
        }
    },

    handleAddMemberToGroupDetails: function () {
        const groupId = ChatManager.currentChatId;
        const memberSelect = document.getElementById('contactsDropdownDetails');
        const memberId = memberSelect.value;
        const memberName = memberSelect.selectedOptions[0]?.text;

        if (groupId && memberId) {
            GroupManager.addMemberToGroup(groupId, memberId, memberName).then(success => {
                if (success) memberSelect.value = ""; // Reset dropdown on success
            });
        } else {
            UIManager.showNotification("Please select a contact to add.", "warning");
        }
    },

    filterChatList: function (query) {
        // The actual filtering logic is inside ChatManager.renderChatList
        // This function just triggers a re-render
        ChatManager.renderChatList(ChatManager.currentFilter);
    },

    showFullImage: function (src, altText = "Image") {
        const modal = document.createElement('div');
        modal.className = 'modal-like image-viewer'; // Use a class for styling if needed
        modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '1001'; // Ensure it's above other modals potentially

        const img = document.createElement('img');
        img.src = src;
        img.alt = altText;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain'; // Important for image aspect ratio
        img.style.borderRadius = 'var(--border-radius)';
        img.style.boxShadow = '0 0 30px rgba(0,0,0,0.5)';

        modal.appendChild(img);
        modal.onclick = () => modal.remove(); // Click anywhere on modal to close
        document.body.appendChild(modal);
    },

    updateChatListItemStatus: function (peerId, isConnected) {
        const itemEl = document.querySelector(`.chat-list-item[data-id="${peerId}"]`);
        if (itemEl && itemEl.dataset.type === 'contact') {
            // Do not update for special contacts, as their "online" status is fixed or conceptual
            if (UserManager.isSpecialContact(peerId)) return;

            const nameEl = itemEl.querySelector('.chat-list-name');
            if (nameEl) {
                let onlineDot = nameEl.querySelector('.online-dot');
                if (isConnected) {
                    if (!onlineDot) {
                        onlineDot = document.createElement('span');
                        onlineDot.className = 'online-dot';
                        onlineDot.title = "Connected";
                        nameEl.appendChild(onlineDot); // Append to name element
                    }
                    onlineDot.style.display = 'inline-block'; // Ensure visible
                } else {
                    if (onlineDot) onlineDot.style.display = 'none'; // Hide if not connected
                }
            }
            // Update header if this peer is the current chat
            if (ChatManager.currentChatId === peerId) {
                this.updateChatHeaderStatus(isConnected ? 'Connected' : 'Offline');
            }
        }
    },
    showReconnectPrompt: function (peerId, onReconnectSuccess) {
        const chatBox = document.getElementById('chatBox');
        let promptDiv = chatBox.querySelector(`.system-message.reconnect-prompt[data-peer-id="${peerId}"]`);
        const peerName = UserManager.contacts[peerId]?.name || `Peer ${peerId.substring(0, 4)}`;

        if (promptDiv) { // Prompt already exists, update it
            Utils.log(`Reconnect prompt for ${peerId} already visible. Updating text.`, Utils.logLevels.DEBUG);
            const textElement = promptDiv.querySelector('.reconnect-prompt-text');
            if (textElement) textElement.textContent = `Connection to ${peerName} lost.`;
            const recBtn = promptDiv.querySelector('.btn-reconnect-inline');
            if (recBtn) recBtn.disabled = false; // Re-enable button if it was disabled
            return;
        }

        promptDiv = document.createElement('div');
        promptDiv.className = 'system-message reconnect-prompt'; // Use system-message for consistent styling
        promptDiv.setAttribute('data-peer-id', peerId);
        promptDiv.innerHTML = `
        <span class="reconnect-prompt-text">Connection to ${peerName} lost.</span>
        <button class="btn-reconnect-inline">Reconnect</button>
        <button class="btn-cancel-reconnect-inline">Dismiss</button>
    `;
        chatBox.appendChild(promptDiv);
        chatBox.scrollTop = chatBox.scrollHeight; // Scroll to show prompt

        const reconnectButton = promptDiv.querySelector('.btn-reconnect-inline');
        const cancelButton = promptDiv.querySelector('.btn-cancel-reconnect-inline');
        const textElement = promptDiv.querySelector('.reconnect-prompt-text');
        let successHandler, failHandler;

        const cleanupPrompt = (removeImmediately = false) => {
            EventEmitter.off('connectionEstablished', successHandler);
            EventEmitter.off('connectionFailed', failHandler);
            if (promptDiv && promptDiv.parentNode) {
                if (removeImmediately) {
                    promptDiv.remove();
                } else {
                    setTimeout(() => { // Delay removal to let user see status message
                        if (promptDiv && promptDiv.parentNode) promptDiv.remove();
                    }, textElement.textContent.includes("Failed") ? 5000 : 3000); // Longer for failure message
                }
            }
        };

        successHandler = (connectedPeerId) => {
            if (connectedPeerId === peerId) {
                textElement.textContent = `Reconnected to ${peerName}.`;
                if (reconnectButton) reconnectButton.style.display = 'none'; // Hide reconnect button
                if (cancelButton) {
                    cancelButton.textContent = 'OK'; // Change dismiss to OK
                    cancelButton.onclick = () => cleanupPrompt(true); // OK now dismisses immediately
                }
                if (typeof onReconnectSuccess === 'function') onReconnectSuccess();
                cleanupPrompt(); // Schedule removal
            }
        };

        failHandler = (failedPeerId) => {
            if (failedPeerId === peerId) {
                textElement.textContent = `Failed to reconnect to ${peerName}. Try manual connection or refresh.`;
                if (reconnectButton) {
                    reconnectButton.style.display = 'initial'; // Ensure visible
                    reconnectButton.disabled = false; // Re-enable
                }
                if (cancelButton) cancelButton.textContent = 'Dismiss'; // Keep as dismiss
            }
        };

        EventEmitter.on('connectionEstablished', successHandler);
        EventEmitter.on('connectionFailed', failHandler);

        reconnectButton.onclick = () => {
            textElement.textContent = `Attempting to reconnect to ${peerName}...`;
            reconnectButton.disabled = true;
            ConnectionManager.createOffer(peerId, {isSilent: false}); // Not silent, as user initiated
        };
        cancelButton.onclick = () => {
            cleanupPrompt(true); // Immediate removal on dismiss
        };
    },

    showConfirmationModal: function (message, onConfirm, onCancel = null, options = {}) {
        const existingModal = document.getElementById('genericConfirmationModal');
        if (existingModal) {
            existingModal.remove(); // Remove if one already exists
        }

        const modalId = 'genericConfirmationModal';
        const modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal-like confirmation-modal'; // General modal class + specific
        modal.style.display = 'flex'; // Show it

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';
        const titleElement = document.createElement('h2');
        titleElement.textContent = options.title || 'Confirm Action';
        modalHeader.appendChild(titleElement);
        // Optionally add close button to header if needed:
        // const closeBtn = document.createElement('button'); closeBtn.className = 'icon-btn close-modal-btn'; closeBtn.innerHTML = '✕';
        // closeBtn.onclick = () => { if (onCancel) onCancel(); modal.remove(); }; modalHeader.appendChild(closeBtn);

        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = Utils.escapeHtml(message).replace(/\n/g, '<br>'); // Support newlines in message
        modalBody.appendChild(messageParagraph);

        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = options.confirmText || 'Confirm';
        confirmButton.className = `btn ${options.confirmClass || 'btn-danger'}`; // Default to danger for confirm
        confirmButton.onclick = () => {
            if (onConfirm) onConfirm();
            modal.remove();
        };

        const cancelButton = document.createElement('button');
        cancelButton.textContent = options.cancelText || 'Cancel';
        cancelButton.className = `btn ${options.cancelClass || 'btn-secondary'}`; // Default to secondary for cancel
        cancelButton.onclick = () => {
            if (onCancel) onCancel();
            modal.remove();
        };

        modalFooter.appendChild(cancelButton); // Typically cancel on left
        modalFooter.appendChild(confirmButton); // Confirm on right

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);

        document.body.appendChild(modal);
    },

    showCallingModal: function (peerName, onCancelCall, onStopMusicOnly, callType) {
        const modal = document.getElementById('callingModal');
        const titleEl = document.getElementById('callingModalTitle');
        const textEl = document.getElementById('callingModalText');
        const avatarEl = document.getElementById('callingModalAvatar');
        const cancelBtn = document.getElementById('callingModalCancelBtn');

        if (!modal || !titleEl || !textEl || !avatarEl || !cancelBtn) {
            Utils.log("Calling modal elements not found!", Utils.logLevels.ERROR);
            return;
        }

        titleEl.textContent = `${callType}...`;
        textEl.textContent = `Contacting ${Utils.escapeHtml(peerName)}...`;

        // Avatar logic for calling modal
        let avatarContentHtml = (Utils.escapeHtml(peerName).charAt(0) || 'P').toUpperCase();
        const peerContact = UserManager.contacts[VideoCallManager.currentPeerId]; // Assuming VideoCallManager.currentPeerId is set

        avatarEl.className = 'video-call-avatar'; // Reset class, specific styles will be applied by CSS based on peerContact.id
        if (peerContact && peerContact.isSpecial) {
            avatarEl.classList.add(peerContact.id); // Add character-specific class e.g. "AI_王林"
        }

        if (peerContact && peerContact.avatarUrl) {
            avatarContentHtml = `<img src="${peerContact.avatarUrl}" alt="${Utils.escapeHtml(peerName.charAt(0))}" class="avatar-image">`;
        }
        avatarEl.innerHTML = avatarContentHtml;


        cancelBtn.onclick = onCancelCall; // Set the cancel action

        modal.style.display = 'flex'; // Show the modal
    },

    hideCallingModal: function () {
        const modal = document.getElementById('callingModal');
        if (modal && modal.style.display !== 'none') {
            modal.style.display = 'none';
            const cancelBtn = document.getElementById('callingModalCancelBtn');
            if (cancelBtn) cancelBtn.onclick = null; // Clear the onclick handler
        }
    },

    updateCopyIdButtonState: function() {
        const userIdValueEl = document.getElementById('modalUserIdValue');
        const copyBtn = document.getElementById('modalCopyIdBtn');

        if (!userIdValueEl || !copyBtn) return;

        if (userIdValueEl.textContent === 'Generating...' || !UserManager.userId) {
            copyBtn.disabled = true;
            copyBtn.title = 'User ID not yet generated.';
            copyBtn.classList.remove('btn-action-themed');
            copyBtn.classList.add('btn-secondary'); // Ensure it's styled as secondary
        } else {
            copyBtn.disabled = false;
            copyBtn.title = 'Copy User ID';
            copyBtn.classList.add('btn-action-themed');
            copyBtn.classList.remove('btn-secondary');
        }
    },

    updateCheckNetworkButtonState: function() {
        const checkBtn = document.getElementById('checkNetworkBtnModal');
        if (!checkBtn) return;

        const isConnected = ConnectionManager.isWebSocketConnected;

        if (isConnected) {
            checkBtn.disabled = true;
            checkBtn.classList.remove('btn-action-themed');
            checkBtn.classList.add('btn-secondary'); // Ensure it's styled as secondary
        } else {
            checkBtn.disabled = false;
            checkBtn.classList.add('btn-action-themed');
            checkBtn.classList.remove('btn-secondary');
        }
    }
};