
/**
 * @file SettingsUIManager.js
 * @description 设置 UI 管理器，负责处理主菜单/设置模态框内的所有 UI 元素和交互逻辑。
 *              包括用户ID显示、主题和配色方案选择、AI/API 配置、用户偏好设置、网络状态显示和危险操作区。
 * @module SettingsUIManager
 * @exports {object} SettingsUIManager - 对外暴露的单例对象，包含所有设置 UI 管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素、加载设置并绑定事件。
 * @property {function} loadAISettings - 从 localStorage 加载 AI 相关设置并填充到输入框。
 * @property {function} saveAISetting - 保存单个 AI 设置到 localStorage 和全局 Config 对象。
 * @property {function} initThemeSelectors - 初始化主题和配色方案的自定义下拉选择器。
 * @property {function} updateNetworkInfoDisplay - 更新模态框中的网络状态信息。
 * @dependencies UserManager, ConnectionManager, ChatManager, ThemeLoader, NotificationManager, Utils, AppInitializer, ModalManager
 * @dependents AppInitializer (进行初始化)
 */
const SettingsUIManager = {
    // 主题和配色方案选择器元素
    colorSchemeSelectedValueEl: null,
    colorSchemeOptionsContainerEl: null,
    themeSelectedValueEl: null,
    themeOptionsContainerEl: null,

    // AI 设置的备用默认值，以防 Config.js 未正确初始化
    FALLBACK_AI_DEFAULTS: {
        apiEndpoint: '', api_key: '', model: 'default-model', max_tokens: 2048, ttsApiEndpoint: ''
    },

    /**
     * 初始化设置 UI 管理器，获取元素、加载设置并绑定事件。
     */
    init: function() {
        // AI 和 TTS 配置输入元素
        this.apiEndpointInput = document.getElementById('apiEndpointInput');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiModelInput = document.getElementById('apiModelInput');
        this.apiMaxTokensInput = document.getElementById('apiMaxTokensInput');
        this.ttsApiEndpointInput = document.getElementById('ttsApiEndpointInput');

        this.autoConnectToggle = document.getElementById('autoConnectToggle');
        this.modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        this.checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        this.modalUserIdValue = document.getElementById('modalUserIdValue');

        // 主题和配色方案选择器元素
        this.colorSchemeSelectedValueEl = document.getElementById('colorSchemeSelectedValue');
        this.colorSchemeOptionsContainerEl = document.getElementById('colorSchemeOptionsContainer');
        this.themeSelectedValueEl = document.getElementById('themeSelectedValue');
        this.themeOptionsContainerEl = document.getElementById('themeOptionsContainer');

        this.loadAISettings();
        this.bindEvents();
        this.initThemeSelectors(); // 初始化并填充主题选择器
    },

    /**
     * 绑定设置模态框内的所有 UI 事件监听器。
     */
    bindEvents: function() {
        // --- AI 配置输入框的 blur 事件，用于自动保存 ---
        if (this.apiEndpointInput) this.apiEndpointInput.addEventListener('blur', () => this.saveAISetting('apiEndpoint', this.apiEndpointInput.value));
        if (this.apiKeyInput) this.apiKeyInput.addEventListener('blur', () => this.saveAISetting('api_key', this.apiKeyInput.value));
        if (this.apiModelInput) this.apiModelInput.addEventListener('blur', () => this.saveAISetting('model', this.apiModelInput.value));
        if (this.apiMaxTokensInput) this.apiMaxTokensInput.addEventListener('blur', () => {
            const val = parseInt(this.apiMaxTokensInput.value, 10);
            let fallbackMaxTokens = (window.Config?.server?.max_tokens) ?? this.FALLBACK_AI_DEFAULTS.max_tokens;
            this.saveAISetting('max_tokens', isNaN(val) ? fallbackMaxTokens : val);
        });
        if (this.ttsApiEndpointInput) this.ttsApiEndpointInput.addEventListener('blur', () => this.saveAISetting('ttsApiEndpoint', this.ttsApiEndpointInput.value));

        // --- 偏好设置 ---
        if (this.autoConnectToggle) {
            this.autoConnectToggle.addEventListener('change', (event) => {
                if (UserManager.userSettings) {
                    UserManager.updateUserSetting('autoConnectEnabled', event.target.checked);
                    if (event.target.checked) {
                        NotificationManager.showNotification('自动连接已启用。将在下次应用启动或成功连接信令服务器时尝试连接。', 'info');
                        if (ConnectionManager.isWebSocketConnected && ConnectionManager.websocket?.readyState === WebSocket.OPEN) {
                            ConnectionManager.autoConnectToAllContacts();
                        }
                    } else {
                        NotificationManager.showNotification('自动连接已禁用。', 'info');
                    }
                }
            });
        }

        // --- 网络状态 ---
        if (this.checkNetworkBtnModal) this.checkNetworkBtnModal.addEventListener('click', async () => {
            if (this.checkNetworkBtnModal.disabled) {
                NotificationManager.showNotification('当前已连接到信令服务器。', 'info');
                return;
            }
            NotificationManager.showNotification('正在重新检查网络并尝试连接...', 'info');
            await AppInitializer.refreshNetworkStatusUI();
            if (!ConnectionManager.isWebSocketConnected) {
                ConnectionManager.connectWebSocket().catch(err => {
                    NotificationManager.showNotification('重新建立信令连接失败。', 'error');
                    Utils.log(`手动重新检查网络: connectWebSocket 失败: ${err.message || err}`, Utils.logLevels.ERROR);
                });
            }
        });

        // --- 用户 ID 和 SDP 复制 ---
        if (this.modalCopyIdBtn) this.modalCopyIdBtn.addEventListener('click', () => {
            if (this.modalCopyIdBtn.disabled) return;
            this.copyUserIdFromModal();
        });
        const modalCopySdpBtn = document.getElementById('modalCopySdpBtn');
        if(modalCopySdpBtn) modalCopySdpBtn.addEventListener('click', () => this.copySdpTextFromModal());

        // --- 危险操作区域 ---
        const modalResetAllConnectionsBtn = document.getElementById('modalResetAllConnectionsBtn');
        if (modalResetAllConnectionsBtn) modalResetAllConnectionsBtn.addEventListener('click', () => ConnectionManager.resetAllConnections());

        const modalClearContactsBtn = document.getElementById('modalClearContactsBtn');
        if (modalClearContactsBtn) modalClearContactsBtn.addEventListener('click', () => UserManager.clearAllContacts());

        const modalClearAllChatsBtn = document.getElementById('modalClearAllChatsBtn');
        if (modalClearAllChatsBtn) modalClearAllChatsBtn.addEventListener('click', () => ChatManager.clearAllChats());

        // --- 可折叠部分 ---
        const collapsibleHeaders = document.querySelectorAll('#mainMenuModal .settings-section .collapsible-header');
        collapsibleHeaders.forEach(header => {
            header.addEventListener('click', function() {
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
            const content = header.nextElementSibling;
            const icon = header.querySelector('.collapse-icon');
            if (content && content.classList.contains('collapsible-content') && icon) {
                if (content.style.display === 'none') icon.textContent = '▶'; else icon.textContent = '▼';
            }
        });

        // --- 全局点击监听器，用于关闭自定义下拉菜单 ---
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

    /**
     * 初始化主题和配色方案的自定义下拉选择器。
     */
    initThemeSelectors: function() {
        this._populateColorSchemeSelector();
        this._populateThemeSelectorWithOptions();
    },

    /**
     * @private
     * 填充配色方案选择器的选项。
     */
    _populateColorSchemeSelector: function() {
        if (!this.colorSchemeSelectedValueEl || !this.colorSchemeOptionsContainerEl) return;

        const schemes = { 'auto': '自动 (浏览器)', 'light': '浅色模式', 'dark': '深色模式' };
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
                const newEffectiveColorScheme = ThemeLoader._getEffectiveColorScheme(selectedSchemeKey);
                const currentActualEffectiveColorScheme = ThemeLoader.getCurrentEffectiveColorScheme();

                // 如果配色方案实际发生变化，需要重新加载页面以应用新主题
                if (selectedSchemeKey === 'auto' || newEffectiveColorScheme !== currentActualEffectiveColorScheme) {
                    let themeToApply;
                    const currentThemeBaseName = ThemeLoader._getBaseThemeName(ThemeLoader.getCurrentThemeKey());
                    const lightSuffix = ThemeLoader.LIGHT_THEME_SUFFIX || '浅色';
                    const darkSuffix = ThemeLoader.DARK_THEME_SUFFIX || '深色';
                    const targetSuffix = newEffectiveColorScheme === 'light' ? lightSuffix : darkSuffix;
                    let candidateTheme = `${currentThemeBaseName}-${targetSuffix}`;

                    if (ThemeLoader.themes[candidateTheme] && ThemeLoader._isThemeCompatible(candidateTheme, newEffectiveColorScheme)) {
                        themeToApply = candidateTheme;
                    } else {
                        themeToApply = ThemeLoader._findFallbackThemeKeyForScheme(newEffectiveColorScheme);
                    }
                    if (!ThemeLoader.themes[themeToApply]) {
                        console.error(`严重错误: 未找到方案 '${newEffectiveColorScheme}' 的有效主题。正在使用当前主题重新加载。`);
                        NotificationManager.showNotification('确定合适的主题时出错。正在尝试默认重新加载。', 'error');
                        themeToApply = ThemeLoader.getCurrentThemeKey();
                    }
                    ThemeLoader.applyTheme(themeToApply); // 这会重新加载页面
                } else {
                    // 如果配色方案未变，仅更新 UI
                    this.colorSchemeSelectedValueEl.textContent = schemes[selectedSchemeKey];
                    this.colorSchemeOptionsContainerEl.style.display = 'none';
                    this._populateThemeSelectorWithOptions();
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

    /**
     * @private
     * 根据当前生效的配色方案，填充主题选择器的选项。
     */
    _populateThemeSelectorWithOptions: function() {
        if (!this.themeSelectedValueEl || !this.themeOptionsContainerEl) return;

        this.themeOptionsContainerEl.innerHTML = '';
        const currentEffectiveColorScheme = ThemeLoader.getCurrentEffectiveColorScheme();
        const filteredThemes = {};

        // 筛选出与当前配色方案兼容的主题
        for (const key in ThemeLoader.themes) {
            if (ThemeLoader._isThemeCompatible(key, currentEffectiveColorScheme)) {
                filteredThemes[key] = ThemeLoader.themes[key];
            }
        }

        let themeKeyForDisplay = ThemeLoader.getCurrentThemeKey();
        if (!filteredThemes[themeKeyForDisplay]) {
            themeKeyForDisplay = Object.keys(filteredThemes)[0] || ThemeLoader._findFallbackThemeKeyForScheme(currentEffectiveColorScheme);
        }

        const themeForDisplayObject = ThemeLoader.themes[themeKeyForDisplay];
        this.themeSelectedValueEl.textContent = themeForDisplayObject?.name ?? '选择主题';
        this.themeSelectedValueEl.dataset.currentThemeKey = themeKeyForDisplay || '';

        if (Object.keys(filteredThemes).length === 0) {
            this.themeSelectedValueEl.textContent = "无可用主题";
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = `没有可用的 ${currentEffectiveColorScheme === 'light' ? '浅色' : '深色'} 主题`;
            optionDiv.style.pointerEvents = "none";
            optionDiv.style.opacity = "0.7";
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
                    if (selectedKey !== ThemeLoader.getCurrentThemeKey()) {
                        ThemeLoader.applyTheme(selectedKey);
                    }
                    this.themeOptionsContainerEl.style.display = 'none';
                });
                this.themeOptionsContainerEl.appendChild(optionDiv);
            }
        }

        this.themeSelectedValueEl.addEventListener('click', (event) => {
            event.stopPropagation();
            const currentDisplayState = this.themeOptionsContainerEl.style.display;
            document.querySelectorAll('.custom-select .options').forEach(opt => {
                if (opt !== this.themeOptionsContainerEl) opt.style.display = 'none';
            });
            this.themeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
        });
    },

    /**
     * 从 localStorage 加载 AI 相关设置，如果不存在则使用 Config.js 的默认值，并填充到输入框。
     */
    loadAISettings: function() {
        if (typeof window.Config !== 'object') window.Config = {};
        if (typeof window.Config.server !== 'object') window.Config.server = {};

        const settingsToLoad = [
            { storageKey: 'apiEndpoint', input: this.apiEndpointInput, configKey: 'apiEndpoint', defaultValue: Config.server.apiEndpoint },
            { storageKey: 'api_key', input: this.apiKeyInput, configKey: 'api_key', defaultValue: Config.server.api_key },
            { storageKey: 'model', input: this.apiModelInput, configKey: 'model', defaultValue: Config.server.model },
            { storageKey: 'max_tokens', input: this.apiMaxTokensInput, configKey: 'max_tokens', defaultValue: Config.server.max_tokens, isNumber: true },
            { storageKey: 'ttsApiEndpoint', input: this.ttsApiEndpointInput, configKey: 'ttsApiEndpoint', defaultValue: Config.server.ttsApiEndpoint }
        ];
        settingsToLoad.forEach(setting => {
            const savedValue = localStorage.getItem(`aiSetting_${setting.storageKey}`);
            let valueToSet = savedValue ?? setting.defaultValue ?? this.FALLBACK_AI_DEFAULTS[setting.configKey];
            if (setting.isNumber) {
                valueToSet = parseInt(valueToSet, 10);
                if (isNaN(valueToSet)) valueToSet = this.FALLBACK_AI_DEFAULTS[setting.configKey];
            }
            if (valueToSet === null || valueToSet === undefined) valueToSet = this.FALLBACK_AI_DEFAULTS[setting.configKey] ?? "";
            if (setting.input) setting.input.value = valueToSet;
            window.Config.server[setting.configKey] = valueToSet;
        });
    },

    /**
     * 保存单个 AI 设置到 localStorage 和全局 Config 对象，并进行验证。
     * @param {string} storageKey - 在 localStorage 中使用的键名。
     * @param {string|number} value - 要保存的值。
     */
    saveAISetting: function(storageKey, value) {
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try { new URL(value); }
            catch (_) {
                NotificationManager.showNotification(`${storageKey.replace(/_/g, ' ')} 的 URL 无效。未保存。`, 'error');
                const inputEl = storageKey === 'apiEndpoint' ? this.apiEndpointInput : this.ttsApiEndpointInput;
                const configKey = storageKey === 'apiEndpoint' ? 'apiEndpoint' : 'ttsApiEndpoint';
                if (inputEl) inputEl.value = localStorage.getItem(`aiSetting_${storageKey}`) || (window.Config?.server?.[configKey] ?? this.FALLBACK_AI_DEFAULTS[configKey] ?? "");
                return;
            }
        }
        if (storageKey === 'max_tokens') {
            const numValue = parseInt(value, 10);
            if (isNaN(numValue) || numValue <= 0) {
                NotificationManager.showNotification('最大令牌数必须为正数。未保存。', 'error');
                if (this.apiMaxTokensInput) this.apiMaxTokensInput.value = localStorage.getItem('aiSetting_max_tokens') || (window.Config?.server?.max_tokens ?? this.FALLBACK_AI_DEFAULTS.max_tokens);
                return;
            }
            value = numValue;
        }
        localStorage.setItem(`aiSetting_${storageKey}`, value);
        let configUpdated = false;
        if (window.Config?.server) { window.Config.server[storageKey] = value; configUpdated = true; }
        else { Utils.log(`严重错误: 保存 AI 设置 ${storageKey} 时 window.Config.server 不可用。`, Utils.logLevels.ERROR); }
        const friendlyName = storageKey.charAt(0).toUpperCase() + storageKey.slice(1).replace(/_/g, ' ');
        if (configUpdated) NotificationManager.showNotification(`${friendlyName} 设置已保存并应用。`, 'success');
        else NotificationManager.showNotification(`${friendlyName} 已保存到存储，但实时应用失败。请刷新。`, 'error');
    },

    /**
     * 从模态框中复制用户 ID 到剪贴板。
     */
    copyUserIdFromModal: function () {
        const userId = this.modalUserIdValue?.textContent;
        if (userId && userId !== "生成中...") {
            navigator.clipboard.writeText(userId)
                .then(() => NotificationManager.showNotification('用户 ID 已复制！', 'success'))
                .catch(() => NotificationManager.showNotification('复制 ID 失败。', 'error'));
        }
    },

    /**
     * 从模态框中复制 SDP 连接信息到剪贴板。
     */
    copySdpTextFromModal: function () {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (sdpTextEl && sdpTextEl.value) {
            navigator.clipboard.writeText(sdpTextEl.value)
                .then(() => NotificationManager.showNotification('连接信息已复制！', 'success'))
                .catch(() => NotificationManager.showNotification('复制信息失败。', 'error'));
        } else {
            NotificationManager.showNotification('没有可复制的连接信息。', 'warning');
        }
    },

    /**
     * 更新“复制 ID”按钮的启用/禁用状态。
     */
    updateCopyIdButtonState: function() {
        if (!this.modalUserIdValue || !this.modalCopyIdBtn) return;
        const userIdReady = this.modalUserIdValue.textContent !== '生成中...' && UserManager.userId;
        this.modalCopyIdBtn.disabled = !userIdReady;
        this.modalCopyIdBtn.title = userIdReady ? '复制用户 ID' : '用户 ID 尚未生成。';
        this.modalCopyIdBtn.classList.toggle('btn-action-themed', userIdReady);
        this.modalCopyIdBtn.classList.toggle('btn-secondary', !userIdReady);
    },

    /**
     * 更新“重新检查网络”按钮的启用/禁用状态。
     */
    updateCheckNetworkButtonState: function() {
        if (!this.checkNetworkBtnModal) return;
        const isConnected = ConnectionManager.isWebSocketConnected;
        this.checkNetworkBtnModal.disabled = isConnected;
        this.checkNetworkBtnModal.classList.toggle('btn-action-themed', !isConnected);
        this.checkNetworkBtnModal.classList.toggle('btn-secondary', isConnected);
    },

    /**
     * 更新主菜单/设置模态框中所有依赖于应用状态的控件。
     */
    updateMainMenuControlsState: function() {
        if (this.autoConnectToggle && UserManager.userSettings) {
            this.autoConnectToggle.checked = UserManager.userSettings.autoConnectEnabled;
        }
        this.updateCopyIdButtonState();
        this.updateCheckNetworkButtonState();
    },

    /**
     * 更新模态框中的网络状态信息显示。
     * @param {object} networkType - 从 Utils.checkNetworkType 返回的网络类型信息。
     * @param {boolean} webSocketStatus - WebSocket 的连接状态。
     */
    updateNetworkInfoDisplay: function (networkType, webSocketStatus) {
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');
        if (!networkInfoEl || !qualityIndicator || !qualityText) return;
        let html = ''; let overallQuality = '未知'; let qualityClass = '';
        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4?'✓':'✗'} | IPv6: ${networkType.ipv6?'✓':'✗'} <br>`;
            html += `UDP: ${networkType.udp?'✓':'✗'} | TCP: ${networkType.tcp?'✓':'✗'} | 中继: ${networkType.relay?'✓':'?'} <br>`;
        } else html += 'WebRTC 网络检测: ' + (networkType?.error || '失败/不支持') + '.<br>';
        html += `信令服务器: ${webSocketStatus ? '<span style="color: green;">已连接</span>' : '<span style="color: var(--danger-color, red);">已断开</span>'}`;
        networkInfoEl.innerHTML = html;
        if (!webSocketStatus) { overallQuality = '信令离线'; qualityClass = 'quality-poor'; }
        else if (networkType && networkType.error === null) {
            if (networkType.udp) { overallQuality = '良好'; qualityClass = 'quality-good'; }
            else if (networkType.tcp) { overallQuality = '受限 (TCP 回退)'; qualityClass = 'quality-medium'; }
            else if (networkType.relay) { overallQuality = '仅中继'; qualityClass = 'quality-medium'; }
            else { overallQuality = '差 (WebRTC P2P 失败)'; qualityClass = 'quality-poor'; }
        } else { overallQuality = 'WebRTC 检查失败'; qualityClass = 'quality-poor'; }
        qualityIndicator.className = `quality-indicator ${qualityClass}`;
        qualityText.textContent = overallQuality;
    },
};