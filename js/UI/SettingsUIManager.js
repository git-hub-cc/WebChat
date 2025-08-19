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
 * @module SettingsUIManager
 * @exports {object} SettingsUIManager - 对外暴露的单例对象，包含所有设置 UI 管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素、加载设置并绑定事件。
 * @property {function} loadAISettings - 从 localStorage 加载 AI 相关设置并填充到输入框。
 * @property {function} saveAISetting - 保存单个 AI 设置到 localStorage 并触发事件。
 * @property {function} initThemeSelectors - 初始化主题和配色方案的自定义下拉选择器。
 * @property {function} updateNetworkInfoDisplay - 更新模态框中的网络状态信息。
 * @dependencies UserManager, ConnectionManager, ChatManager, ThemeLoader, NotificationUIManager, Utils, AppInitializer, ModalUIManager, EventEmitter, AppSettings, DBManager, LLMProviders
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

// 其他设置元素
    autoConnectToggle: null,
    modalCopyIdBtn: null,
    checkNetworkBtnModal: null,
    modalUserIdValue: null,
    modalClearCacheBtn: null,

// 存储绑定的事件处理函数，以便正确移除
    _boundHandleThemeSelectorClick: null,
    _boundHandleColorSchemeSelectorClick: null,
    _boundHandleLlmProviderSelectorClick: null,
    _boundHandleModelSelectorClick: null, // MODIFIED: 新增


    /**
     * 初始化设置 UI 管理器，获取元素、加载设置并绑定事件。
     */
    init: function() {
// AI 和 TTS 配置输入元素
        this.llmProviderSelectedValueEl = document.getElementById('llmProviderSelectedValue');
        this.llmProviderOptionsContainerEl = document.getElementById('llmProviderOptionsContainer');
        this.apiEndpointInput = document.getElementById('apiEndpointInput');
        this.apiModelInputContainer = document.getElementById('apiModelInputContainer');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiMaxTokensInput = document.getElementById('apiMaxTokensInput');
        this.ttsApiEndpointInput = document.getElementById('ttsApiEndpointInput');


// MODIFIED: 背景图片设置元素（浅色和深色）
        this.setBackgroundBtnLight = document.getElementById('setBackgroundBtnLight');
        this.removeBackgroundBtnLight = document.getElementById('removeBackgroundBtnLight');
        this.bgImageInputLight = document.getElementById('bgImageInputLight');
        this.setBackgroundBtnDark = document.getElementById('setBackgroundBtnDark');
        this.removeBackgroundBtnDark = document.getElementById('removeBackgroundBtnDark');
        this.bgImageInputDark = document.getElementById('bgImageInputDark');


// 其他设置元素
        this.autoConnectToggle = document.getElementById('autoConnectToggle');
        this.modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        this.checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        this.modalUserIdValue = document.getElementById('modalUserIdValue');
        this.modalClearCacheBtn = document.getElementById('modalClearCacheBtn');

// 主题和配色方案选择器元素
        this.colorSchemeSelectedValueEl = document.getElementById('colorSchemeSelectedValue');
        this.colorSchemeOptionsContainerEl = document.getElementById('colorSchemeOptionsContainer');
        this.themeSelectedValueEl = document.getElementById('themeSelectedValue');
        this.themeOptionsContainerEl = document.getElementById('themeOptionsContainer');

        this.loadAISettings(); // 加载AI设置
        this.bindEvents(); // 绑定事件
        this.initThemeSelectors(); // 初始化主题选择器
        this._populateLlmProviderSelector(); // 初始化大模型提供商选择器
    },

    /**
     * 绑定设置模态框内的所有 UI 事件监听器。
     */
    bindEvents: function() {
// ... [bindEvents implementation remains largely the same, no changes needed here] ...
// AI 设置输入框失去焦点时保存
        if (this.apiEndpointInput) this.apiEndpointInput.addEventListener('blur', () => this.saveAISetting('apiEndpoint', this.apiEndpointInput.value));
        if (this.apiKeyInput) this.apiKeyInput.addEventListener('blur', () => this.saveAISetting('api_key', this.apiKeyInput.value));
        if (this.apiMaxTokensInput) this.apiMaxTokensInput.addEventListener('blur', () => {
            const val = parseInt(this.apiMaxTokensInput.value, 10);
            const serverConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
            this.saveAISetting('max_tokens', isNaN(val) ? configMaxTokens : val);
        });
        if (this.ttsApiEndpointInput) this.ttsApiEndpointInput.addEventListener('blur', () => this.saveAISetting('ttsApiEndpoint', this.ttsApiEndpointInput.value));

// 绑定模型输入/选择框的 blur 和 change 事件
        this.apiModelInputContainer.addEventListener('blur', (e) => {
// 只处理 input 元素的 blur
            if (e.target.tagName === 'INPUT') {
                this.saveAISetting('model', e.target.value);
            }
        }, true); // 使用捕获来获取内部元素的 blur 事件
        this.apiModelInputContainer.addEventListener('change', (e) => { // 适用于 select 元素
            this.saveAISetting('model', e.target.value);
        }, true);


// --- MODIFIED: 背景图片设置 (浅色和深色) ---
        if (this.setBackgroundBtnLight) this.setBackgroundBtnLight.addEventListener('click', () => this.bgImageInputLight.click());
        if (this.bgImageInputLight) this.bgImageInputLight.addEventListener('change', (e) => this.handleBackgroundChange(e, 'light'));
        if (this.removeBackgroundBtnLight) this.removeBackgroundBtnLight.addEventListener('click', () => this.handleRemoveBackground('light'));

        if (this.setBackgroundBtnDark) this.setBackgroundBtnDark.addEventListener('click', () => this.bgImageInputDark.click());
        if (this.bgImageInputDark) this.bgImageInputDark.addEventListener('change', (e) => this.handleBackgroundChange(e, 'dark'));
        if (this.removeBackgroundBtnDark) this.removeBackgroundBtnDark.addEventListener('click', () => this.handleRemoveBackground('dark'));


// --- 网络状态 ---
        if (this.checkNetworkBtnModal) this.checkNetworkBtnModal.addEventListener('click', async () => {
            if (this.checkNetworkBtnModal.disabled) {
                NotificationUIManager.showNotification('当前已连接到信令服务器。', 'info');
                return;
            }
            NotificationUIManager.showNotification('正在重新检查网络并尝试连接...', 'info');
            await AppInitializer.refreshNetworkStatusUI();
            if (!ConnectionManager.isWebSocketConnected) {
                WebSocketManager.connect().catch(err => {
                    NotificationUIManager.showNotification('重新建立信令连接失败。', 'error');
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

// 手动连接按钮
        // 以下按钮是实现手动/离线WebRTC连接的关键
        const modalCreateOfferBtn = document.getElementById('modalCreateOfferBtn');
        if(modalCreateOfferBtn) modalCreateOfferBtn.addEventListener('click', () => ConnectionManager.createOffer(null, {isManual: true}));
        const modalCreateAnswerBtn = document.getElementById('modalCreateAnswerBtn');
        if(modalCreateAnswerBtn) modalCreateAnswerBtn.addEventListener('click', () => ConnectionManager.createAnswer({isManual: true}));
        const modalHandleAnswerBtn = document.getElementById('modalHandleAnswerBtn');
        if(modalHandleAnswerBtn) modalHandleAnswerBtn.addEventListener('click', () => ConnectionManager.handleAnswer({isManual: true}));


// --- 操作区域 ---
        const modalClearContactsBtn = document.getElementById('modalClearContactsBtn');
        if (modalClearContactsBtn) modalClearContactsBtn.addEventListener('click', () => UserManager.clearAllContacts());
        const modalClearAllChatsBtn = document.getElementById('modalClearAllChatsBtn');
        if (modalClearAllChatsBtn) modalClearAllChatsBtn.addEventListener('click', () => ChatManager.clearAllChats());

// 清除缓存按钮事件
        if (this.modalClearCacheBtn) {
            this.modalClearCacheBtn.addEventListener('click', () => {
                ModalUIManager.showConfirmationModal(
                    '您确定要清除所有本地缓存吗？这将删除所有 localStorage 数据和 IndexedDB 数据库中的所有内容。操作完成后，页面将自动刷新。',
                    async () => {
                        try {
                            localStorage.clear();
                            Utils.log('LocalStorage 已清除。', Utils.logLevels.INFO);
                            await DBManager.clearAllData();
                            NotificationUIManager.showNotification('所有缓存已成功清除。页面即将刷新...', 'success');
                            setTimeout(() => {
                                window.location.reload();
                            }, 2000);
                        } catch (error) {
                            Utils.log(`清除缓存失败: ${error}`, Utils.logLevels.ERROR);
                            NotificationUIManager.showNotification('清除缓存时发生错误。请查看控制台。', 'error');
                        }
                    },
                    null,
                    { title: '警告：清除缓存', confirmText: '确定清除', cancelText: '取消' }
                );
            });
        }

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

// --- 全局点击监听器，用于关闭自定义下拉菜单 ---
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
// MODIFIED: 新增，处理模型选择器
            if (!isClickInside('modelCustomSelectContainer', e.target) && this.modelOptionsContainerEl) {
                this.modelOptionsContainerEl.style.display = 'none';
            }
        });
    },
    async handleBackgroundChange(event, colorSchemeType) {
        const file = event.target.files[0];
        if (!file) return;

// 验证文件类型，确保是图片
        if (!file.type.startsWith('image/')) {
            NotificationUIManager.showNotification('请选择一个图片文件。', 'error');
            return;
        }
// 验证文件大小，限制为 5MB
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

// MODIFIED: 新增，处理模型选择器的点击事件
    _handleModelSelectorClick: function(event) {
        event.stopPropagation();
        if (!this.modelOptionsContainerEl) return;
        const currentDisplayState = this.modelOptionsContainerEl.style.display;
// 关闭其他下拉框
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.modelOptionsContainerEl) opt.style.display = 'none';
        });
        this.modelOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },

    _populateLlmProviderSelector: function() {
        if (!this.llmProviderSelectedValueEl || !this.llmProviderOptionsContainerEl || typeof LLMProviders === 'undefined') return;

// **MODIFIED**: Use LLMProviders directly
        const providers = LLMProviders;
// BUG FIX: 将新用户的默认提供商从 'siliconflow' 改为 'webchat'，以确保 UI 与后端逻辑一致。
        const currentProviderKey = localStorage.getItem('aiSetting_llmProvider') || 'webchat';

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
// **MODIFIED**: Use LLMProviders directly
        const providerConfig = (typeof LLMProviders !== 'undefined') ? LLMProviders[providerKey] : null;
        if (!providerConfig) return;

// 切换提供商时，自动填充并保存新的默认值
        this.apiEndpointInput.value = providerConfig.defaultEndpoint;
        this.saveAISetting('apiEndpoint', providerConfig.defaultEndpoint);

// --- BUG FIX START ---
// BUG: 原本 _updateModelInput 在 saveAISetting('model', ...) 之前调用，
//      导致 UI 更新时读取的是旧的 localStorage 值。
// FIX: 调整顺序，先保存新的默认模型，再更新 UI。

// 1. 先保存新的默认模型到 localStorage
        this.saveAISetting('model', providerConfig.defaultModel);

// 2. 然后更新模型输入的 UI，此时它会从 localStorage 读取到正确的新值
        this._updateModelInput(providerConfig);
// --- BUG FIX END ---
    },
// ... [_updateModelInput and theme-related methods remain the same] ...
    _updateModelInput: function(providerConfig) {
        this.apiModelInputContainer.innerHTML = ''; // 清除之前的输入/选择框

// 如果没有预设模型列表（例如“自定义”提供商），则创建文本输入框
        if (!providerConfig.models || providerConfig.models.length === 0) {
            const modelElement = document.createElement('input');
            modelElement.type = 'text';
            modelElement.id = 'apiModelInput';
            modelElement.placeholder = '输入自定义模型名称';
// 加载用户可能已为该提供商保存的自定义模型
            const storedModel = localStorage.getItem('aiSetting_model');
            modelElement.value = storedModel || providerConfig.defaultModel;
            this.apiModelInputContainer.appendChild(modelElement);

// 重置自定义下拉框的元素引用，因为它们不存在
            this.modelSelectedValueEl = null;
            this.modelOptionsContainerEl = null;
            this._boundHandleModelSelectorClick = null;

        } else {
            // 否则，创建基于 div 的自定义下拉选择框
            const customSelectContainer = document.createElement('div');
            customSelectContainer.className = 'custom-select';
            customSelectContainer.id = 'modelCustomSelectContainer'; // 用于全局点击监听器

            this.modelSelectedValueEl = document.createElement('div');
            this.modelSelectedValueEl.className = 'selected';
            this.modelSelectedValueEl.id = 'modelSelectedValue';

            this.modelOptionsContainerEl = document.createElement('div');
            this.modelOptionsContainerEl.className = 'options';
            this.modelOptionsContainerEl.id = 'modelOptionsContainer';

            // 加载用户保存的模型，如果不存在则使用提供商的默认模型
            const storedModelKey = localStorage.getItem('aiSetting_model') || providerConfig.defaultModel;
            let selectedModelLabel = '选择模型'; // 如果找不到匹配项，则为回退标签

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

            // 绑定点击事件以切换选项
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
                    ModalUIManager.toggleModal('mainMenuModal', false, true);
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
                        ModalUIManager.toggleModal('mainMenuModal', false, true);
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

    /**
     * 从 localStorage 加载 AI 相关设置，如果不存在则使用 AppSettings.js 的默认值，并填充到输入框。
     * 此函数现在处理新的提供商逻辑，不再有“覆盖”概念。
     */
    loadAISettings: function() {
// BUG FIX: 将新用户的默认提供商从 'siliconflow' 改为 'webchat'。
        const providerKey = localStorage.getItem('aiSetting_llmProvider') || 'webchat';
// **MODIFIED**: Use LLMProviders directly
        const safeLLMProviders = (typeof LLMProviders !== 'undefined') ? LLMProviders : {};
// BUG FIX: 确保在 providerKey 对应的配置不存在时，也回退到 'webchat' 的配置。
        const providerConfig = safeLLMProviders[providerKey] || safeLLMProviders.webchat || {};

// 加载 API 端点: 优先使用 localStorage 的值，否则使用提供商的默认值
        this.apiEndpointInput.value = localStorage.getItem('aiSetting_apiEndpoint') || providerConfig.defaultEndpoint;

// 加载模型 (并设置输入/选择框 UI 和初始值)
        this._updateModelInput(providerConfig);

// 加载其他设置
        const otherSettings = [
            { key: 'api_key', input: this.apiKeyInput },
            { key: 'max_tokens', input: this.apiMaxTokensInput },
            { key: 'ttsApiEndpoint', input: this.ttsApiEndpointInput }
        ];

        otherSettings.forEach(setting => {
            if (setting.input) {
// 优先使用 localStorage 的值，否则使用 AppSettings.server 中的回退值
                setting.input.value = localStorage.getItem(`aiSetting_${setting.key}`) || AppSettings.server[setting.key] || '';
            }
        });
    },


    /**
     * 保存单个 AI 设置到 localStorage，并触发 'aiConfigChanged' 事件。
     * @param {string} storageKey - 在 localStorage 中使用的键名 (例如 'apiEndpoint', 'api_key')。
     * @param {string|number} value - 要保存的值。
     */
    saveAISetting: function(storageKey, value) {
        const serverConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};

// URL 校验
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try {
// 尝试将值解析为 URL，如果失败则说明格式无效
                new URL(value);
            }
            catch (_) {
                NotificationUIManager.showNotification(`${storageKey.replace(/_/g, ' ')} 的 URL 无效。未保存。`, 'error');
                const inputEl = storageKey === 'apiEndpoint' ? this.apiEndpointInput : this.ttsApiEndpointInput;
                if (inputEl) inputEl.value = localStorage.getItem(`aiSetting_${storageKey}`) || serverConfig[storageKey] || '';
                return;
            }
        }
// 数字校验 (max_tokens)
        if (storageKey === 'max_tokens') {
// 将输入值安全地转换为数字
            const numValue = parseInt(String(value), 10);
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
// 验证是否为有效的正整数
            if (isNaN(numValue) || numValue <= 0) {
                NotificationUIManager.showNotification('最大令牌数必须为正数。未保存。', 'error');
                if (this.apiMaxTokensInput) this.apiMaxTokensInput.value = localStorage.getItem('aiSetting_max_tokens') || configMaxTokens;
                return;
            }
            value = numValue;
        }

        localStorage.setItem(`aiSetting_${storageKey}`, String(value));

        const friendlyName = storageKey.charAt(0).toUpperCase() + storageKey.slice(1).replace(/_/g, ' ');
// NotificationUIManager.showNotification(`${friendlyName} 设置已保存。`, 'success');

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('aiConfigChanged');
        } else {
            Utils.log("SettingsUIManager: EventEmitter 未定义，无法触发 aiConfigChanged 事件。", Utils.logLevels.WARN);
        }
    },

// ... [rest of the methods remain the same] ...
    copyUserIdFromModal: function () {
        const userId = this.modalUserIdValue?.textContent;
// 确保用户 ID 已有效生成且不为空
        if (userId && userId !== "生成中...") {
            navigator.clipboard.writeText(userId)
                .then(() => NotificationUIManager.showNotification('用户 ID 已复制！', 'success'))
                .catch(() => NotificationUIManager.showNotification('复制 ID 失败。', 'error'));
        }
    },
    copySdpTextFromModal: function () {
        const sdpTextEl = document.getElementById('modalSdpText');
// 确保 SDP 文本框存在且有内容可复制
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