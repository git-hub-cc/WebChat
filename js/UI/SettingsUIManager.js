/**
 * @file SettingsUIManager.js
 * @description 设置 UI 管理器，负责处理主菜单/设置模态框内的所有 UI 元素和交互逻辑。
 *              AI 配置现在优先从 localStorage 加载。主题切换现在无刷新。
 *              修复了切换配色方案后，主题选择器点击事件处理不当的问题。
 *              新增“清除缓存”按钮，用于清除 localStorage 和 IndexedDB 数据。
 *              用户切换主题或配色方案后，自动隐藏菜单。
 *              新增：支持设置和移除自定义背景图片。
 *              重构：将折叠式菜单改为标签页式，以提高导航清晰度。
 *              新增：支持多种大模型提供商选择，并自动填充配置，支持用户覆盖默认值。
 *              修改：移除了 AI & API 配置的“覆盖”复选框，用户的输入将始终生效。
 *              重构：将模型名称选择器从原生 select 改为自定义 div 组件。
 *              MODIFIED: 支持为浅色和深色模式分别设置和移除背景图片。
 *              FIXED: 修复了切换AI提供商后，模型选择UI与实际配置可能不一致的问题。
 *              REFACTORED (Phase 1): 事件监听器现在调用 ActionCreators.js 中的函数，而不是直接 dispatch action。
 *              BUGFIX: 移除了所有与菜单内功能按钮（如清空缓存、手动连接）相关的事件绑定，这些逻辑已移至更合适的 ModalUIManager.js。
 * @module SettingsUIManager
 * @exports {object} SettingsUIManager - 对外暴露的单例对象，包含所有设置 UI 管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素、加载设置并绑定事件。
 * @property {function} loadAISettings - 从 localStorage 加载 AI 相关设置并填充到输入框。
 * @property {function} saveAISetting - 保存单个 AI 设置到 localStorage 并触发事件。
 * @property {function} initThemeSelectors - 初始化主题和配色方案的自定义下拉选择器。
 * @property {function} updateNetworkInfoDisplay - 更新模态框中的网络状态信息。
 * @dependencies UserManager, ConnectionManager, ChatManager, ThemeLoader, NotificationUIManager, Utils, AppInitializer, ModalUIManager, EventEmitter, AppSettings, DBManager, LLMProviders, ActionCreators
 * @dependents AppInitializer (进行初始化)
 */
const SettingsUIManager = {
// 主题和配色方案选择器元素
    colorSchemeSelectedValueEl: null,
    colorSchemeOptionsContainerEl: null,
    themeSelectedValueEl: null,
    themeOptionsContainerEl: null,

// AI 设置输入元素
    llmProviderSelectedValueEl: null,
    llmProviderOptionsContainerEl: null,
    modelSelectedValueEl: null, // MODIFIED: 新增，用于模型选择器
    modelOptionsContainerEl: null, // MODIFIED: 新增，用于模型选择器
    apiEndpointInput: null,
    apiModelInputContainer: null,
    apiKeyInput: null,
    apiMaxTokensInput: null,
    ttsApiEndpointInput: null,

// MODIFIED: 背景图片设置元素，分为浅色和深色
    setBackgroundBtnLight: null,
    removeBackgroundBtnLight: null,
    bgImageInputLight: null,
    setBackgroundBtnDark: null,
    removeBackgroundBtnDark: null,
    bgImageInputDark: null,

// 其他设置元素 - 这些元素的事件监听器已移至 ModalUIManager
    autoConnectToggle: null,
    modalCopyIdBtn: null,
    checkNetworkBtnModal: null,
    modalUserIdValue: null,
    modalClearCacheBtn: null,

// 存储绑定的事件处理函数，以便正确移除
    _boundHandleThemeSelectorClick: null,
    _boundHandleColorSchemeSelectorClick: null,
    _boundHandleLlmProviderSelectorClick: null,
    _boundHandleModelSelectorClick: null,


    /**
     * 初始化设置 UI 管理器，获取元素、加载设置并绑定事件。
     */
    init: function() {
        this.llmProviderSelectedValueEl = document.getElementById('llmProviderSelectedValue');
        this.llmProviderOptionsContainerEl = document.getElementById('llmProviderOptionsContainer');
        this.apiEndpointInput = document.getElementById('apiEndpointInput');
        this.apiModelInputContainer = document.getElementById('apiModelInputContainer');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiMaxTokensInput = document.getElementById('apiMaxTokensInput');
        this.ttsApiEndpointInput = document.getElementById('ttsApiEndpointInput');
        this.setBackgroundBtnLight = document.getElementById('setBackgroundBtnLight');
        this.removeBackgroundBtnLight = document.getElementById('removeBackgroundBtnLight');
        this.bgImageInputLight = document.getElementById('bgImageInputLight');
        this.setBackgroundBtnDark = document.getElementById('setBackgroundBtnDark');
        this.removeBackgroundBtnDark = document.getElementById('removeBackgroundBtnDark');
        this.bgImageInputDark = document.getElementById('bgImageInputDark');
        this.autoConnectToggle = document.getElementById('autoConnectToggle');
        this.modalUserIdValue = document.getElementById('modalUserIdValue');
        // BUGFIX: 这些元素的引用仅用于状态更新，其点击事件已移至 ModalUIManager
        this.modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        this.checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        this.modalClearCacheBtn = document.getElementById('modalClearCacheBtn');
        this.colorSchemeSelectedValueEl = document.getElementById('colorSchemeSelectedValue');
        this.colorSchemeOptionsContainerEl = document.getElementById('colorSchemeOptionsContainer');
        this.themeSelectedValueEl = document.getElementById('themeSelectedValue');
        this.themeOptionsContainerEl = document.getElementById('themeOptionsContainer');

        this.loadAISettings();
        this.bindEvents();
        this.initThemeSelectors();
        this._populateLlmProviderSelector();
    },

    /**
     * REFACTORED (Phase 1): 绑定设置模态框内的所有 UI 事件监听器，调用 ActionCreators。
     * BUGFIX: 移除了所有与非设置字段的操作按钮（如清空、手动连接）相关的事件绑定，这些逻辑已移至 ModalUIManager。
     */
    bindEvents: function() {
        // --- AI & API 设置字段事件 ---
        if (this.apiEndpointInput) this.apiEndpointInput.addEventListener('blur', () => this.saveAISetting('apiEndpoint', this.apiEndpointInput.value));
        if (this.apiKeyInput) this.apiKeyInput.addEventListener('blur', () => this.saveAISetting('api_key', this.apiKeyInput.value));
        if (this.apiMaxTokensInput) this.apiMaxTokensInput.addEventListener('blur', () => {
            const val = parseInt(this.apiMaxTokensInput.value, 10);
            const serverConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
            this.saveAISetting('max_tokens', isNaN(val) ? configMaxTokens : val);
        });
        if (this.ttsApiEndpointInput) this.ttsApiEndpointInput.addEventListener('blur', () => this.saveAISetting('ttsApiEndpoint', this.ttsApiEndpointInput.value));

        if (this.apiModelInputContainer) {
            this.apiModelInputContainer.addEventListener('blur', (e) => {
                if (e.target.tagName === 'INPUT') {
                    this.saveAISetting('model', e.target.value);
                }
            }, true);
            this.apiModelInputContainer.addEventListener('change', (e) => {
                this.saveAISetting('model', e.target.value);
            }, true);
        }

        // --- 外观设置字段事件 ---
        if (this.setBackgroundBtnLight) this.setBackgroundBtnLight.addEventListener('click', () => this.bgImageInputLight.click());
        if (this.bgImageInputLight) this.bgImageInputLight.addEventListener('change', (e) => this.handleBackgroundChange(e, 'light'));
        if (this.removeBackgroundBtnLight) this.removeBackgroundBtnLight.addEventListener('click', () => this.handleRemoveBackground('light'));

        if (this.setBackgroundBtnDark) this.setBackgroundBtnDark.addEventListener('click', () => this.bgImageInputDark.click());
        if (this.bgImageInputDark) this.bgImageInputDark.addEventListener('change', (e) => this.handleBackgroundChange(e, 'dark'));
        if (this.removeBackgroundBtnDark) this.removeBackgroundBtnDark.addEventListener('click', () => this.handleRemoveBackground('dark'));


        // --- 标签页切换逻辑 ---
        const menuTabs = document.querySelectorAll('#mainMenuModal .menu-tab-item');
        const menuTabContents = document.querySelectorAll('#mainMenuModal .menu-tab-content');

        menuTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTabId = tab.dataset.tab;
                menuTabs.forEach(t => t.classList.remove('active'));
                menuTabContents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const targetContent = document.getElementById(`menu-tab-content-${targetTabId}`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });

        // --- 自定义下拉菜单的全局点击关闭逻辑 ---
        document.addEventListener('click', (e) => {
            const isClickInside = (containerId, target) => {
                const container = document.getElementById(containerId);
                return container && container.contains(target);
            };

            if (!isClickInside('themeCustomSelectContainer', e.target) && this.themeOptionsContainerEl) {
                this.themeOptionsContainerEl.style.display = 'none';
            }
            if (!isClickInside('colorSchemeCustomSelectContainer', e.target) && this.colorSchemeOptionsContainerEl) {
                this.colorSchemeOptionsContainerEl.style.display = 'none';
            }
            if (!isClickInside('llmProviderSelectContainer', e.target) && this.llmProviderOptionsContainerEl) {
                this.llmProviderOptionsContainerEl.style.display = 'none';
            }
            if (!isClickInside('modelCustomSelectContainer', e.target) && this.modelOptionsContainerEl) {
                this.modelOptionsContainerEl.style.display = 'none';
            }
        });
    },

    // ... (从这里到文件结尾的所有其他方法，均保持不变，它们不直接 dispatch action)
    async handleBackgroundChange(event, colorSchemeType) {
        const file = event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            NotificationUIManager.showNotification('请选择一个图片文件。', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            NotificationUIManager.showNotification('图片文件过大，请选择小于 5MB 的图片。', 'warning');
            return;
        }
        if (typeof ThemeLoader !== 'undefined' && ThemeLoader.setBackgroundImage) {
            await ThemeLoader.setBackgroundImage(file, colorSchemeType);
            const schemeName = colorSchemeType === 'light' ? '浅色' : '深色';
            NotificationUIManager.showNotification(`${schemeName}模式背景图片已设置。`, 'success');
        } else {
            Utils.log("SettingsUIManager: ThemeLoader 或其 setBackgroundImage 方法未定义。", Utils.logLevels.ERROR);
        }
        event.target.value = '';
    },
    async handleRemoveBackground(colorSchemeType) {
        if (typeof ThemeLoader !== 'undefined' && ThemeLoader.removeBackgroundImage) {
            await ThemeLoader.removeBackgroundImage(colorSchemeType);
            const schemeName = colorSchemeType === 'light' ? '浅色' : '深色';
            NotificationUIManager.showNotification(`${schemeName}模式背景图片已移除。`, 'success');
        } else {
            Utils.log("SettingsUIManager: ThemeLoader 或其 removeBackgroundImage 方法未定义。", Utils.logLevels.ERROR);
        }
    },
    _handleLlmProviderSelectorClick: function(event) {
        event.stopPropagation();
        const currentDisplayState = this.llmProviderOptionsContainerEl.style.display;
        document.querySelectorAll('.custom-select .options').forEach(opt => opt.style.display = 'none');
        this.llmProviderOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },
    _handleModelSelectorClick: function(event) {
        event.stopPropagation();
        if (!this.modelOptionsContainerEl) return;
        const currentDisplayState = this.modelOptionsContainerEl.style.display;
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.modelOptionsContainerEl) opt.style.display = 'none';
        });
        this.modelOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },
    _populateLlmProviderSelector: function() {
        if (!this.llmProviderSelectedValueEl || !this.llmProviderOptionsContainerEl || typeof LLMProviders === 'undefined') return;
        const providers = LLMProviders;
        const currentProviderKey = localStorage.getItem('aiSetting_llmProvider') || 'ppmc';
        this.llmProviderSelectedValueEl.textContent = providers[currentProviderKey]?.label || '选择提供商';
        this.llmProviderOptionsContainerEl.innerHTML = '';
        for (const key in providers) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = providers[key].label;
            optionDiv.dataset.providerKey = key;
            optionDiv.addEventListener('click', () => {
                const selectedProviderKey = optionDiv.dataset.providerKey;
                localStorage.setItem('aiSetting_llmProvider', selectedProviderKey);
                this.llmProviderSelectedValueEl.textContent = providers[selectedProviderKey].label;
                this.llmProviderOptionsContainerEl.style.display = 'none';
                this._handleLlmProviderChange(selectedProviderKey);
            });
            this.llmProviderOptionsContainerEl.appendChild(optionDiv);
        }
        if (this._boundHandleLlmProviderSelectorClick) {
            this.llmProviderSelectedValueEl.removeEventListener('click', this._boundHandleLlmProviderSelectorClick);
        }
        this._boundHandleLlmProviderSelectorClick = this._handleLlmProviderSelectorClick.bind(this);
        this.llmProviderSelectedValueEl.addEventListener('click', this._boundHandleLlmProviderSelectorClick);
    },
    _handleLlmProviderChange: function(providerKey) {
        const providerConfig = (typeof LLMProviders !== 'undefined') ? LLMProviders[providerKey] : null;
        if (!providerConfig) return;
        this.apiEndpointInput.value = providerConfig.defaultEndpoint;
        this.saveAISetting('apiEndpoint', providerConfig.defaultEndpoint);
        const storedModel = localStorage.getItem('aiSetting_model');
        const isStoredModelValidForNewProvider = providerConfig.models && providerConfig.models.some(m => m.key === storedModel);
        let effectiveModelKey = storedModel;
        if (!isStoredModelValidForNewProvider) {
            effectiveModelKey = providerConfig.defaultModel;
            this.saveAISetting('model', effectiveModelKey);
        }
        this._updateModelInput(providerConfig, effectiveModelKey);
    },
    _updateModelInput: function(providerConfig, effectiveModelKey) {
        this.apiModelInputContainer.innerHTML = '';
        if (!providerConfig.models || providerConfig.models.length === 0) {
            const modelElement = document.createElement('input');
            modelElement.type = 'text';
            modelElement.id = 'apiModelInput';
            modelElement.placeholder = '输入自定义模型名称';
            modelElement.value = effectiveModelKey || providerConfig.defaultModel;
            this.apiModelInputContainer.appendChild(modelElement);
            this.modelSelectedValueEl = null;
            this.modelOptionsContainerEl = null;
            this._boundHandleModelSelectorClick = null;
        } else {
            const customSelectContainer = document.createElement('div');
            customSelectContainer.className = 'custom-select';
            customSelectContainer.id = 'modelCustomSelectContainer';
            this.modelSelectedValueEl = document.createElement('div');
            this.modelSelectedValueEl.className = 'selected';
            this.modelSelectedValueEl.id = 'modelSelectedValue';
            this.modelOptionsContainerEl = document.createElement('div');
            this.modelOptionsContainerEl.className = 'options';
            this.modelOptionsContainerEl.id = 'modelOptionsContainer';
            const storedModelKey = effectiveModelKey;
            let selectedModelLabel = '选择模型';
            providerConfig.models.forEach(model => {
                const optionDiv = document.createElement('div');
                optionDiv.classList.add('option');
                optionDiv.textContent = model.label;
                optionDiv.dataset.modelKey = model.key;
                if (model.key === storedModelKey) {
                    selectedModelLabel = model.label;
                }
                optionDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const selectedKey = optionDiv.dataset.modelKey;
                    this.modelSelectedValueEl.textContent = optionDiv.textContent;
                    this.saveAISetting('model', selectedKey);
                    this.modelOptionsContainerEl.style.display = 'none';
                });
                this.modelOptionsContainerEl.appendChild(optionDiv);
            });
            this.modelSelectedValueEl.textContent = selectedModelLabel;
            customSelectContainer.appendChild(this.modelSelectedValueEl);
            customSelectContainer.appendChild(this.modelOptionsContainerEl);
            this.apiModelInputContainer.appendChild(customSelectContainer);
            if (this._boundHandleModelSelectorClick) {
                this.modelSelectedValueEl.removeEventListener('click', this._boundHandleModelSelectorClick);
            }
            this._boundHandleModelSelectorClick = this._handleModelSelectorClick.bind(this);
            this.modelSelectedValueEl.addEventListener('click', this._boundHandleModelSelectorClick);
        }
    },
    _handleThemeSelectorClick: function(event) {
        event.stopPropagation();
        const currentDisplayState = this.themeOptionsContainerEl.style.display;
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.themeOptionsContainerEl) opt.style.display = 'none';
        });
        this.themeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },
    _handleColorSchemeSelectorClick: function(event) {
        event.stopPropagation();
        const currentDisplayState = this.colorSchemeOptionsContainerEl.style.display;
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.colorSchemeOptionsContainerEl) opt.style.display = 'none';
        });
        this.colorSchemeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },
    initThemeSelectors: function() {
        this._populateColorSchemeSelector();
        this._populateThemeSelectorWithOptions();
    },
    _populateColorSchemeSelector: function() {
        if (!this.colorSchemeSelectedValueEl || !this.colorSchemeOptionsContainerEl || typeof ThemeLoader === 'undefined') return;
        const schemes = { 'auto': '自动 (浏览器)', 'light': '浅色模式', 'dark': '深色模式' };
        const currentPreferredScheme = localStorage.getItem(ThemeLoader.COLOR_SCHEME_KEY) || ThemeLoader.DEFAULT_COLOR_SCHEME;
        this.colorSchemeSelectedValueEl.textContent = schemes[currentPreferredScheme];
        this.colorSchemeOptionsContainerEl.innerHTML = '';
        for (const key in schemes) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = schemes[key];
            optionDiv.dataset.schemeKey = key;
            optionDiv.addEventListener('click', async () => {
                const selectedSchemeKey = optionDiv.dataset.schemeKey;
                await ThemeLoader.updateColorSchemePreference(selectedSchemeKey);
                this.colorSchemeSelectedValueEl.textContent = schemes[selectedSchemeKey];
                this._populateThemeSelectorWithOptions();
                this.colorSchemeOptionsContainerEl.style.display = 'none';
                if (typeof ModalUIManager !== 'undefined') {
                    ModalUIManager.toggleModal('mainMenuModal', false);
                }
            });
            this.colorSchemeOptionsContainerEl.appendChild(optionDiv);
        }
        if (this._boundHandleColorSchemeSelectorClick) {
            this.colorSchemeSelectedValueEl.removeEventListener('click', this._boundHandleColorSchemeSelectorClick);
        }
        this._boundHandleColorSchemeSelectorClick = this._handleColorSchemeSelectorClick.bind(this);
        this.colorSchemeSelectedValueEl.addEventListener('click', this._boundHandleColorSchemeSelectorClick);
    },
    _populateThemeSelectorWithOptions: function() {
        if (!this.themeSelectedValueEl || !this.themeOptionsContainerEl || typeof ThemeLoader === 'undefined') return;
        this.themeOptionsContainerEl.innerHTML = '';
        const currentEffectiveColorScheme = ThemeLoader.getCurrentEffectiveColorScheme();
        const filteredThemes = {};
        for (const key in ThemeLoader.themes) {
            if (ThemeLoader._isThemeCompatible(key, currentEffectiveColorScheme)) {
                filteredThemes[key] = ThemeLoader.themes[key];
            }
        }
        let themeKeyForDisplay = ThemeLoader.getCurrentThemeKey();
        if (!themeKeyForDisplay || !filteredThemes[themeKeyForDisplay]) {
            themeKeyForDisplay = ThemeLoader._findFallbackThemeKeyForScheme(currentEffectiveColorScheme);
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
                optionDiv.addEventListener('click', async () => {
                    const selectedKey = optionDiv.dataset.themeKey;
                    if (selectedKey !== ThemeLoader.getCurrentThemeKey()) {
                        await ThemeLoader.applyTheme(selectedKey);
                        this.themeSelectedValueEl.textContent = ThemeLoader.themes[selectedKey]?.name;
                        this.themeSelectedValueEl.dataset.currentThemeKey = selectedKey;
                    }
                    this.themeOptionsContainerEl.style.display = 'none';
                    if (typeof ModalUIManager !== 'undefined') {
                        ModalUIManager.toggleModal('mainMenuModal', false);
                    }
                });
                this.themeOptionsContainerEl.appendChild(optionDiv);
            }
        }
        if (this._boundHandleThemeSelectorClick) {
            this.themeSelectedValueEl.removeEventListener('click', this._boundHandleThemeSelectorClick);
        }
        this._boundHandleThemeSelectorClick = this._handleThemeSelectorClick.bind(this);
        this.themeSelectedValueEl.addEventListener('click', this._boundHandleThemeSelectorClick);
    },
    loadAISettings: function() {
        const providerKey = localStorage.getItem('aiSetting_llmProvider') || 'ppmc';
        const safeLLMProviders = (typeof LLMProviders !== 'undefined') ? LLMProviders : {};
        const providerConfig = safeLLMProviders[providerKey] || safeLLMProviders.ppmc || {};
        this.apiEndpointInput.value = localStorage.getItem('aiSetting_apiEndpoint') || providerConfig.defaultEndpoint;
        const storedModel = localStorage.getItem('aiSetting_model');
        const isStoredModelValid = providerConfig.models && providerConfig.models.some(m => m.key === storedModel);
        const effectiveModelKey = isStoredModelValid ? storedModel : providerConfig.defaultModel;
        this._updateModelInput(providerConfig, effectiveModelKey);
        const otherSettings = [
            { key: 'api_key', input: this.apiKeyInput },
            { key: 'max_tokens', input: this.apiMaxTokensInput },
            { key: 'ttsApiEndpoint', input: this.ttsApiEndpointInput }
        ];
        otherSettings.forEach(setting => {
            if (setting.input) {
                setting.input.value = localStorage.getItem(`aiSetting_${setting.key}`) || AppSettings.server[setting.key] || '';
            }
        });
    },
    saveAISetting: function(storageKey, value) {
        const serverConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try {
                new URL(value);
            }
            catch (_) {
                NotificationUIManager.showNotification(`${storageKey.replace(/_/g, ' ')} 的 URL 无效。未保存。`, 'error');
                const inputEl = storageKey === 'apiEndpoint' ? this.apiEndpointInput : this.ttsApiEndpointInput;
                if (inputEl) inputEl.value = localStorage.getItem(`aiSetting_${storageKey}`) || serverConfig[storageKey] || '';
                return;
            }
        }
        if (storageKey === 'max_tokens') {
            const numValue = parseInt(String(value), 10);
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
            if (isNaN(numValue) || numValue <= 0) {
                NotificationUIManager.showNotification('最大令牌数必须为正数。未保存。', 'error');
                if (this.apiMaxTokensInput) this.apiMaxTokensInput.value = localStorage.getItem('aiSetting_max_tokens') || configMaxTokens;
                return;
            }
            value = numValue;
        }
        localStorage.setItem(`aiSetting_${storageKey}`, String(value));
        const friendlyName = storageKey.charAt(0).toUpperCase() + storageKey.slice(1).replace(/_/g, ' ');
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('aiConfigChanged');
        } else {
            Utils.log("SettingsUIManager: EventEmitter 未定义，无法触发 aiConfigChanged 事件。", Utils.logLevels.WARN);
        }
    },
    copyUserIdFromModal: function () {
        const userId = this.modalUserIdValue?.textContent;
        if (userId && userId !== "生成中...") {
            navigator.clipboard.writeText(userId)
                .then(() => NotificationUIManager.showNotification('用户 ID 已复制！', 'success'))
                .catch(() => NotificationUIManager.showNotification('复制 ID 失败。', 'error'));
        }
    },
    copySdpTextFromModal: function () {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (sdpTextEl && sdpTextEl.value) {
            navigator.clipboard.writeText(sdpTextEl.value)
                .then(() => NotificationUIManager.showNotification('连接信息已复制！', 'success'))
                .catch(() => NotificationUIManager.showNotification('复制信息失败。', 'error'));
        } else {
            NotificationUIManager.showNotification('没有可复制的连接信息。', 'warning');
        }
    },
    updateCopyIdButtonState: function() {
        if (!this.modalUserIdValue || !this.modalCopyIdBtn) return;
        const userIdReady = this.modalUserIdValue.textContent !== '生成中...' && UserManager.userId;
        this.modalCopyIdBtn.disabled = !userIdReady;
        this.modalCopyIdBtn.title = userIdReady ? '复制用户 ID' : '用户 ID 尚未生成。';
        this.modalCopyIdBtn.classList.toggle('btn-action-themed', userIdReady);
        this.modalCopyIdBtn.classList.toggle('btn-secondary', !userIdReady);
    },
    updateCheckNetworkButtonState: function() {
        if (!this.checkNetworkBtnModal) return;
        const isConnected = ConnectionManager.isWebSocketConnected;
        this.checkNetworkBtnModal.disabled = isConnected;
        this.checkNetworkBtnModal.classList.toggle('btn-action-themed', !isConnected);
        this.checkNetworkBtnModal.classList.toggle('btn-secondary', isConnected);
    },
    updateMainMenuControlsState: function() {
        if (this.autoConnectToggle && UserManager.userSettings) {
            this.autoConnectToggle.checked = UserManager.userSettings.autoConnectEnabled;
        }
        this.updateCopyIdButtonState();
        this.updateCheckNetworkButtonState();
    },
    updateNetworkInfoDisplay: function (networkType, webSocketStatus) {
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');
        if (!networkInfoEl || !qualityIndicator || !qualityText) return;

        let html = '';
        let overallQuality;
        let qualityClass;

        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4?'✓':'✗'} | IPv6: ${networkType.ipv6?'✓':'✗'} <br>`;
            html += `UDP: ${networkType.udp?'✓':'✗'} | TCP: ${networkType.tcp?'✓':'✗'} | 中继: ${networkType.relay?'✓':'?'} <br>`;
        } else {
            html += 'WebRTC 网络检测: ' + (networkType?.error || '失败/不支持') + '.<br>';
        }
        html += `信令服务器: ${webSocketStatus ? '<span style="color: green;">已连接</span>' : '<span style="color: var(--danger-color, red);">已断开</span>'}`;
        networkInfoEl.innerHTML = html;

        if (!webSocketStatus) {
            overallQuality = '信令离线';
            qualityClass = 'quality-poor';
        } else if (networkType && networkType.error === null) {
            if (networkType.udp) { overallQuality = '良好'; qualityClass = 'quality-good'; }
            else if (networkType.tcp) { overallQuality = '受限 (TCP 回退)'; qualityClass = 'quality-medium'; }
            else if (networkType.relay) { overallQuality = '仅中继'; qualityClass = 'quality-medium'; }
            else { overallQuality = '差 (WebRTC 失败)'; qualityClass = 'quality-poor'; }
        } else {
            overallQuality = 'WebRTC 检查失败';
            qualityClass = 'quality-poor';
        }
        qualityIndicator.className = `quality-indicator ${qualityClass}`;
        qualityText.textContent = overallQuality;
    },
};