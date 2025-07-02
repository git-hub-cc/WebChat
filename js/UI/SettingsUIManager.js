/**
 * @file 设置 UI 管理器
 * @description 负责处理主菜单/设置模态框内的所有 UI 元素和交互逻辑。主要功能包括：
 *              1. AI 相关配置的加载与保存（优先从 localStorage 读取）。
 *              2. 主题与配色方案的无刷新切换。
 *              3. 支持为浅色和深色模式分别设置和移除自定义背景图片。
 *              4. 管理标签页式菜单的切换。
 *              5. 支持多种大语言模型(LLM)提供商的选择与配置。
 * @module SettingsUIManager
 * @exports {object} SettingsUIManager - 对外暴露的单例对象，包含所有设置 UI 管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素、加载设置并绑定事件。
 * @property {function} loadAISettings - 从 localStorage 加载 AI 相关设置并填充到输入框。
 * @property {function} saveAISetting - 保存单个 AI 设置到 localStorage 并触发事件。
 * @property {function} initThemeSelectors - 初始化主题和配色方案的自定义下拉选择器。
 * @property {function} updateNetworkInfoDisplay - 更新模态框中的网络状态信息。
 * @dependency UserManager, ConnectionManager, ChatManager, ThemeLoader, NotificationUIManager, Utils, AppInitializer, ModalUIManager, EventEmitter, AppSettings, DBManager, LLMProviders, ActionCreators
 */
const SettingsUIManager = {
    // 主题和配色方案选择器相关的 DOM 元素
    colorSchemeSelectedValueEl: null,
    colorSchemeOptionsContainerEl: null,
    themeSelectedValueEl: null,
    themeOptionsContainerEl: null,

    // AI 设置相关的 DOM 元素
    llmProviderSelectedValueEl: null,
    llmProviderOptionsContainerEl: null,
    modelSelectedValueEl: null,
    modelOptionsContainerEl: null,
    apiEndpointInput: null,
    apiModelInputContainer: null,
    apiKeyInput: null,
    apiMaxTokensInput: null,
    ttsApiEndpointInput: null,

    // 浅色模式背景图片设置相关的 DOM 元素
    setBackgroundBtnLight: null,
    removeBackgroundBtnLight: null,
    bgImageInputLight: null,
    // 深色模式背景图片设置相关的 DOM 元素
    setBackgroundBtnDark: null,
    removeBackgroundBtnDark: null,
    bgImageInputDark: null,

    // 其他设置相关的 DOM 元素（事件监听器已移至 ModalUIManager）
    autoConnectToggle: null,
    modalCopyIdBtn: null,
    checkNetworkBtnModal: null,
    modalUserIdValue: null,
    modalClearCacheBtn: null,

    // 存储已绑定的事件处理函数，确保能够正确移除监听器
    _boundHandleThemeSelectorClick: null,
    _boundHandleColorSchemeSelectorClick: null,
    _boundHandleLlmProviderSelectorClick: null,
    _boundHandleModelSelectorClick: null,


    /**
     * 初始化设置 UI 管理器。
     * @description 获取所有必要的 DOM 元素引用，加载已有设置，并为相关元素绑定事件监听器。
     * @function init
     */
    init: function() {
        // 获取 AI 设置相关元素
        this.llmProviderSelectedValueEl = document.getElementById('llmProviderSelectedValue');
        this.llmProviderOptionsContainerEl = document.getElementById('llmProviderOptionsContainer');
        this.apiEndpointInput = document.getElementById('apiEndpointInput');
        this.apiModelInputContainer = document.getElementById('apiModelInputContainer');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiMaxTokensInput = document.getElementById('apiMaxTokensInput');
        this.ttsApiEndpointInput = document.getElementById('ttsApiEndpointInput');

        // 获取背景图片设置相关元素
        this.setBackgroundBtnLight = document.getElementById('setBackgroundBtnLight');
        this.removeBackgroundBtnLight = document.getElementById('removeBackgroundBtnLight');
        this.bgImageInputLight = document.getElementById('bgImageInputLight');
        this.setBackgroundBtnDark = document.getElementById('setBackgroundBtnDark');
        this.removeBackgroundBtnDark = document.getElementById('removeBackgroundBtnDark');
        this.bgImageInputDark = document.getElementById('bgImageInputDark');

        // 获取其他设置相关元素
        this.autoConnectToggle = document.getElementById('autoConnectToggle');
        this.modalUserIdValue = document.getElementById('modalUserIdValue');
        // NOTE: 以下元素的引用仅用于状态更新，其点击事件已移至 ModalUIManager
        this.modalCopyIdBtn = document.getElementById('modalCopyIdBtn');
        this.checkNetworkBtnModal = document.getElementById('checkNetworkBtnModal');
        this.modalClearCacheBtn = document.getElementById('modalClearCacheBtn');

        // 获取主题与配色方案选择器相关元素
        this.colorSchemeSelectedValueEl = document.getElementById('colorSchemeSelectedValue');
        this.colorSchemeOptionsContainerEl = document.getElementById('colorSchemeOptionsContainer');
        this.themeSelectedValueEl = document.getElementById('themeSelectedValue');
        this.themeOptionsContainerEl = document.getElementById('themeOptionsContainer');

        // 初始化流程
        this.loadAISettings();
        this.bindEvents();
        this.initThemeSelectors();
        this._populateLlmProviderSelector();
    },

    /**
     * 绑定设置模态框内的所有 UI 事件监听器。
     * @description 为各个输入框和按钮添加事件监听。此函数已重构，不再直接 dispatch action，
     *              并且与非设置字段的操作按钮（如清空缓存）相关的事件已移至 ModalUIManager。
     * @function bindEvents
     */
    bindEvents: function() {
        // --- AI & API 设置字段的 'blur' 事件，用于在用户输入完成后自动保存 ---
        if (this.apiEndpointInput) this.apiEndpointInput.addEventListener('blur', () => this.saveAISetting('apiEndpoint', this.apiEndpointInput.value));
        if (this.apiKeyInput) this.apiKeyInput.addEventListener('blur', () => this.saveAISetting('api_key', this.apiKeyInput.value));
        if (this.apiMaxTokensInput) this.apiMaxTokensInput.addEventListener('blur', () => {
            const val = parseInt(this.apiMaxTokensInput.value, 10);
            const serverConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
            this.saveAISetting('max_tokens', isNaN(val) ? configMaxTokens : val);
        });
        if (this.ttsApiEndpointInput) this.ttsApiEndpointInput.addEventListener('blur', () => this.saveAISetting('ttsApiEndpoint', this.ttsApiEndpointInput.value));

        // --- 模型名称输入的事件委托 ---
        // NOTE: 由于模型输入可以是原生 input 或自定义 select，这里使用事件委托来兼容两种情况。
        if (this.apiModelInputContainer) {
            // 使用事件捕获阶段的 blur 事件
            this.apiModelInputContainer.addEventListener('blur', (e) => {
                if (e.target.tagName === 'INPUT') {
                    this.saveAISetting('model', e.target.value);
                }
            }, true);
            // 使用事件捕获阶段的 change 事件（主要用于 select）
            this.apiModelInputContainer.addEventListener('change', (e) => {
                this.saveAISetting('model', e.target.value);
            }, true);
        }

        // --- 外观设置字段的点击事件 ---
        if (this.setBackgroundBtnLight) this.setBackgroundBtnLight.addEventListener('click', () => this.bgImageInputLight.click());
        if (this.bgImageInputLight) this.bgImageInputLight.addEventListener('change', (e) => this.handleBackgroundChange(e, 'light'));
        if (this.removeBackgroundBtnLight) this.removeBackgroundBtnLight.addEventListener('click', () => this.handleRemoveBackground('light'));

        if (this.setBackgroundBtnDark) this.setBackgroundBtnDark.addEventListener('click', () => this.bgImageInputDark.click());
        if (this.bgImageInputDark) this.bgImageInputDark.addEventListener('change', (e) => this.handleBackgroundChange(e, 'dark'));
        if (this.removeBackgroundBtnDark) this.removeBackgroundBtnDark.addEventListener('click', () => this.handleRemoveBackground('dark'));


        // --- 设置菜单内的标签页切换逻辑 ---
        const menuTabs = document.querySelectorAll('#mainMenuModal .menu-tab-item');
        const menuTabContents = document.querySelectorAll('#mainMenuModal .menu-tab-content');

        menuTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTabId = tab.dataset.tab;
                // 1. 移除所有标签的激活状态
                menuTabs.forEach(t => t.classList.remove('active'));
                menuTabContents.forEach(c => c.classList.remove('active'));
                // 2. 激活当前点击的标签及其对应的内容面板
                tab.classList.add('active');
                const targetContent = document.getElementById(`menu-tab-content-${targetTabId}`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });

        // --- 自定义下拉菜单的全局点击关闭逻辑 ---
        // NOTE: 当点击页面上任何不属于自定义下拉菜单的区域时，关闭所有打开的下拉菜单。
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

    /**
     * 处理背景图片文件选择后的逻辑。
     * @function handleBackgroundChange
     * @param {Event} event - 文件输入框的 change 事件对象。
     * @param {string} colorSchemeType - 'light' 或 'dark'，指明是为哪个配色模式设置背景。
     * @returns {Promise<void>}
     */
    async handleBackgroundChange(event, colorSchemeType) {
        const file = event.target.files[0];
        if (!file) return;

        // 文件校验
        if (!file.type.startsWith('image/')) {
            NotificationUIManager.showNotification('请选择一个图片文件。', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB 大小限制
            NotificationUIManager.showNotification('图片文件过大，请选择小于 5MB 的图片。', 'warning');
            return;
        }

        // 调用 ThemeLoader 设置背景
        if (typeof ThemeLoader !== 'undefined' && ThemeLoader.setBackgroundImage) {
            await ThemeLoader.setBackgroundImage(file, colorSchemeType);
            const schemeName = colorSchemeType === 'light' ? '浅色' : '深色';
            NotificationUIManager.showNotification(`${schemeName}模式背景图片已设置。`, 'success');
        } else {
            Utils.log("SettingsUIManager: ThemeLoader 或其 setBackgroundImage 方法未定义。", Utils.logLevels.ERROR);
        }
        event.target.value = ''; // 清空 input 的值，确保下次选择同名文件仍能触发 change 事件
    },

    /**
     * 处理移除背景图片的逻辑。
     * @function handleRemoveBackground
     * @param {string} colorSchemeType - 'light' 或 'dark'，指明是为哪个配色模式移除背景。
     * @returns {Promise<void>}
     */
    async handleRemoveBackground(colorSchemeType) {
        if (typeof ThemeLoader !== 'undefined' && ThemeLoader.removeBackgroundImage) {
            await ThemeLoader.removeBackgroundImage(colorSchemeType);
            const schemeName = colorSchemeType === 'light' ? '浅色' : '深色';
            NotificationUIManager.showNotification(`${schemeName}模式背景图片已移除。`, 'success');
        } else {
            Utils.log("SettingsUIManager: ThemeLoader 或其 removeBackgroundImage 方法未定义。", Utils.logLevels.ERROR);
        }
    },

    /**
     * (内部) 处理 LLM 提供商下拉菜单的点击事件，切换选项列表的显示状态。
     * @private
     * @function _handleLlmProviderSelectorClick
     * @param {Event} event - 点击事件对象。
     */
    _handleLlmProviderSelectorClick: function(event) {
        event.stopPropagation(); // 阻止事件冒泡到全局关闭监听器
        const currentDisplayState = this.llmProviderOptionsContainerEl.style.display;
        // 先关闭所有其他自定义下拉菜单
        document.querySelectorAll('.custom-select .options').forEach(opt => opt.style.display = 'none');
        // 切换当前菜单的显示状态
        this.llmProviderOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },

    /**
     * (内部) 处理模型名称下拉菜单的点击事件，切换选项列表的显示状态。
     * @private
     * @function _handleModelSelectorClick
     * @param {Event} event - 点击事件对象。
     */
    _handleModelSelectorClick: function(event) {
        event.stopPropagation();
        if (!this.modelOptionsContainerEl) return; // 如果不存在选项容器（例如，对于自定义输入框），则不执行任何操作
        const currentDisplayState = this.modelOptionsContainerEl.style.display;
        // 关闭其他下拉菜单
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.modelOptionsContainerEl) opt.style.display = 'none';
        });
        // 切换当前菜单的显示状态
        this.modelOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },

    /**
     * (内部) 填充 LLM 提供商的自定义下拉选择器。
     * @private
     * @function _populateLlmProviderSelector
     */
    _populateLlmProviderSelector: function() {
        if (!this.llmProviderSelectedValueEl || !this.llmProviderOptionsContainerEl || typeof LLMProviders === 'undefined') return;

        const providers = LLMProviders; // 从全局获取提供商配置
        const currentProviderKey = localStorage.getItem('aiSetting_llmProvider') || 'ppmc'; // 默认'ppmc'

        // 更新选择框的显示文本
        this.llmProviderSelectedValueEl.textContent = providers[currentProviderKey]?.label || '选择提供商';
        this.llmProviderOptionsContainerEl.innerHTML = ''; // 清空旧选项

        // 遍历所有提供商，创建选项
        for (const key in providers) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = providers[key].label;
            optionDiv.dataset.providerKey = key;
            optionDiv.addEventListener('click', () => {
                // 当点击一个选项时：
                // 1. 保存选择到 localStorage
                const selectedProviderKey = optionDiv.dataset.providerKey;
                localStorage.setItem('aiSetting_llmProvider', selectedProviderKey);
                // 2. 更新显示文本
                this.llmProviderSelectedValueEl.textContent = providers[selectedProviderKey].label;
                // 3. 关闭选项列表
                this.llmProviderOptionsContainerEl.style.display = 'none';
                // 4. 处理提供商变更后的逻辑（如更新端点和模型列表）
                this._handleLlmProviderChange(selectedProviderKey);
            });
            this.llmProviderOptionsContainerEl.appendChild(optionDiv);
        }

        // 绑定或重新绑定下拉菜单的点击事件
        if (this._boundHandleLlmProviderSelectorClick) {
            this.llmProviderSelectedValueEl.removeEventListener('click', this._boundHandleLlmProviderSelectorClick);
        }
        this._boundHandleLlmProviderSelectorClick = this._handleLlmProviderSelectorClick.bind(this);
        this.llmProviderSelectedValueEl.addEventListener('click', this._boundHandleLlmProviderSelectorClick);
    },

    /**
     * (内部) 处理 LLM 提供商变更的逻辑。
     * @private
     * @function _handleLlmProviderChange
     * @param {string} providerKey - 新选择的提供商键名。
     */
    _handleLlmProviderChange: function(providerKey) {
        const providerConfig = (typeof LLMProviders !== 'undefined') ? LLMProviders[providerKey] : null;
        if (!providerConfig) return;

        // 1. 自动填充并保存默认的 API 端点
        this.apiEndpointInput.value = providerConfig.defaultEndpoint;
        this.saveAISetting('apiEndpoint', providerConfig.defaultEndpoint);

        // 2. 检查当前保存的模型是否适用于新提供商
        const storedModel = localStorage.getItem('aiSetting_model');
        const isStoredModelValidForNewProvider = providerConfig.models && providerConfig.models.some(m => m.key === storedModel);

        let effectiveModelKey = storedModel;
        if (!isStoredModelValidForNewProvider) {
            // 如果不适用，则使用新提供商的默认模型
            effectiveModelKey = providerConfig.defaultModel;
            this.saveAISetting('model', effectiveModelKey);
        }

        // 3. 更新模型输入的 UI（可能是下拉框或输入框）
        this._updateModelInput(providerConfig, effectiveModelKey);
    },

    /**
     * (内部) 根据提供商配置更新模型输入 UI。
     * @private
     * @function _updateModelInput
     * @param {object} providerConfig - 当前提供商的配置对象。
     * @param {string} effectiveModelKey - 当前应生效的模型键名。
     */
    _updateModelInput: function(providerConfig, effectiveModelKey) {
        this.apiModelInputContainer.innerHTML = ''; // 清空容器

        // 如果提供商没有预设模型列表，则显示一个普通的文本输入框
        if (!providerConfig.models || providerConfig.models.length === 0) {
            const modelElement = document.createElement('input');
            modelElement.type = 'text';
            modelElement.id = 'apiModelInput';
            modelElement.placeholder = '输入自定义模型名称';
            modelElement.value = effectiveModelKey || providerConfig.defaultModel;
            this.apiModelInputContainer.appendChild(modelElement);
            // 重置自定义下拉框相关的引用
            this.modelSelectedValueEl = null;
            this.modelOptionsContainerEl = null;
            this._boundHandleModelSelectorClick = null;
        } else {
            // 如果有预设模型列表，则创建一个自定义下拉选择器
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
            let selectedModelLabel = '选择模型'; // 默认显示文本

            // 填充选项
            providerConfig.models.forEach(model => {
                const optionDiv = document.createElement('div');
                optionDiv.classList.add('option');
                optionDiv.textContent = model.label;
                optionDiv.dataset.modelKey = model.key;

                if (model.key === storedModelKey) {
                    selectedModelLabel = model.label; // 如果是当前模型，更新显示文本
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

            // 绑定或重新绑定点击事件
            if (this._boundHandleModelSelectorClick) {
                this.modelSelectedValueEl.removeEventListener('click', this._boundHandleModelSelectorClick);
            }
            this._boundHandleModelSelectorClick = this._handleModelSelectorClick.bind(this);
            this.modelSelectedValueEl.addEventListener('click', this._boundHandleModelSelectorClick);
        }
    },

    /**
     * (内部) 处理主题下拉菜单的点击事件，切换选项列表的显示状态。
     * @private
     * @function _handleThemeSelectorClick
     * @param {Event} event - 点击事件对象。
     */
    _handleThemeSelectorClick: function(event) {
        event.stopPropagation();
        const currentDisplayState = this.themeOptionsContainerEl.style.display;
        // 关闭其他下拉菜单
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.themeOptionsContainerEl) opt.style.display = 'none';
        });
        // 切换当前菜单的显示状态
        this.themeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },

    /**
     * (内部) 处理配色方案下拉菜单的点击事件，切换选项列表的显示状态。
     * @private
     * @function _handleColorSchemeSelectorClick
     * @param {Event} event - 点击事件对象。
     */
    _handleColorSchemeSelectorClick: function(event) {
        event.stopPropagation();
        const currentDisplayState = this.colorSchemeOptionsContainerEl.style.display;
        // 关闭其他下拉菜单
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.colorSchemeOptionsContainerEl) opt.style.display = 'none';
        });
        // 切换当前菜单的显示状态
        this.colorSchemeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },

    /**
     * 初始化主题和配色方案的自定义下拉选择器。
     * @function initThemeSelectors
     */
    initThemeSelectors: function() {
        this._populateColorSchemeSelector();
        this._populateThemeSelectorWithOptions();
    },

    /**
     * (内部) 填充配色方案的自定义下拉选择器。
     * @private
     * @function _populateColorSchemeSelector
     */
    _populateColorSchemeSelector: function() {
        if (!this.colorSchemeSelectedValueEl || !this.colorSchemeOptionsContainerEl || typeof ThemeLoader === 'undefined') return;

        const schemes = { 'auto': '自动 (浏览器)', 'light': '浅色模式', 'dark': '深色模式' };
        const currentPreferredScheme = localStorage.getItem(ThemeLoader.COLOR_SCHEME_KEY) || ThemeLoader.DEFAULT_COLOR_SCHEME;

        // 更新显示文本
        this.colorSchemeSelectedValueEl.textContent = schemes[currentPreferredScheme];
        this.colorSchemeOptionsContainerEl.innerHTML = ''; // 清空旧选项

        for (const key in schemes) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = schemes[key];
            optionDiv.dataset.schemeKey = key;
            optionDiv.addEventListener('click', async () => {
                // 当点击选项时：
                // 1. 更新配色方案偏好
                const selectedSchemeKey = optionDiv.dataset.schemeKey;
                await ThemeLoader.updateColorSchemePreference(selectedSchemeKey);
                // 2. 更新显示文本
                this.colorSchemeSelectedValueEl.textContent = schemes[selectedSchemeKey];
                // 3. 重新填充主题选择器，因为它依赖于当前的配色方案
                this._populateThemeSelectorWithOptions();
                // 4. 关闭选项列表
                this.colorSchemeOptionsContainerEl.style.display = 'none';
                // 5. 隐藏设置菜单
                if (typeof ModalUIManager !== 'undefined') {
                    ModalUIManager.toggleModal('mainMenuModal', false);
                }
            });
            this.colorSchemeOptionsContainerEl.appendChild(optionDiv);
        }

        // 绑定或重新绑定点击事件
        if (this._boundHandleColorSchemeSelectorClick) {
            this.colorSchemeSelectedValueEl.removeEventListener('click', this._boundHandleColorSchemeSelectorClick);
        }
        this._boundHandleColorSchemeSelectorClick = this._handleColorSchemeSelectorClick.bind(this);
        this.colorSchemeSelectedValueEl.addEventListener('click', this._boundHandleColorSchemeSelectorClick);
    },

    /**
     * (内部) 根据当前生效的配色方案填充主题选择器的选项。
     * @private
     * @function _populateThemeSelectorWithOptions
     */
    _populateThemeSelectorWithOptions: function() {
        if (!this.themeSelectedValueEl || !this.themeOptionsContainerEl || typeof ThemeLoader === 'undefined') return;
        this.themeOptionsContainerEl.innerHTML = '';

        // 1. 获取当前实际生效的配色方案（'light' 或 'dark'）
        const currentEffectiveColorScheme = ThemeLoader.getCurrentEffectiveColorScheme();

        // 2. 筛选出与当前配色方案兼容的主题
        const filteredThemes = {};
        for (const key in ThemeLoader.themes) {
            if (ThemeLoader._isThemeCompatible(key, currentEffectiveColorScheme)) {
                filteredThemes[key] = ThemeLoader.themes[key];
            }
        }

        // 3. 确定当前应该显示的主题
        let themeKeyForDisplay = ThemeLoader.getCurrentThemeKey();
        if (!themeKeyForDisplay || !filteredThemes[themeKeyForDisplay]) {
            // 如果当前主题不兼容，则查找一个备用主题
            themeKeyForDisplay = ThemeLoader._findFallbackThemeKeyForScheme(currentEffectiveColorScheme);
        }
        const themeForDisplayObject = ThemeLoader.themes[themeKeyForDisplay];
        this.themeSelectedValueEl.textContent = themeForDisplayObject?.name ?? '选择主题';
        this.themeSelectedValueEl.dataset.currentThemeKey = themeKeyForDisplay || '';

        // 4. 根据筛选结果填充选项列表
        if (Object.keys(filteredThemes).length === 0) {
            // 如果没有可用的主题
            this.themeSelectedValueEl.textContent = "无可用主题";
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = `没有可用的 ${currentEffectiveColorScheme === 'light' ? '浅色' : '深色'} 主题`;
            optionDiv.style.pointerEvents = "none";
            optionDiv.style.opacity = "0.7";
            this.themeOptionsContainerEl.appendChild(optionDiv);
        } else {
            // 填充所有兼容的主题
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

        // 绑定或重新绑定点击事件
        if (this._boundHandleThemeSelectorClick) {
            this.themeSelectedValueEl.removeEventListener('click', this._boundHandleThemeSelectorClick);
        }
        this._boundHandleThemeSelectorClick = this._handleThemeSelectorClick.bind(this);
        this.themeSelectedValueEl.addEventListener('click', this._boundHandleThemeSelectorClick);
    },

    /**
     * 从 localStorage 加载所有 AI 相关设置并填充到 UI 中。
     * @function loadAISettings
     */
    loadAISettings: function() {
        // 加载提供商和模型
        const providerKey = localStorage.getItem('aiSetting_llmProvider') || 'ppmc';
        const safeLLMProviders = (typeof LLMProviders !== 'undefined') ? LLMProviders : {};
        const providerConfig = safeLLMProviders[providerKey] || safeLLMProviders.ppmc || {};

        this.apiEndpointInput.value = localStorage.getItem('aiSetting_apiEndpoint') || providerConfig.defaultEndpoint;

        const storedModel = localStorage.getItem('aiSetting_model');
        const isStoredModelValid = providerConfig.models && providerConfig.models.some(m => m.key === storedModel);
        const effectiveModelKey = isStoredModelValid ? storedModel : providerConfig.defaultModel;
        this._updateModelInput(providerConfig, effectiveModelKey);

        // 加载其他 AI 设置
        const otherSettings = [
            { key: 'api_key', input: this.apiKeyInput },
            { key: 'max_tokens', input: this.apiMaxTokensInput },
            { key: 'ttsApiEndpoint', input: this.ttsApiEndpointInput }
        ];
        otherSettings.forEach(setting => {
            if (setting.input) {
                // 优先从 localStorage 获取，其次是服务器配置，最后是空字符串
                setting.input.value = localStorage.getItem(`aiSetting_${setting.key}`) || AppSettings.server[setting.key] || '';
            }
        });
    },

    /**
     * 保存单个 AI 设置到 localStorage，并进行必要的验证。
     * @function saveAISetting
     * @param {string} storageKey - 在 localStorage 中存储的键名（不含前缀）。
     * @param {string|number} value - 要保存的值。
     */
    saveAISetting: function(storageKey, value) {
        const serverConfig = (typeof AppSettings !== 'undefined' && AppSettings && AppSettings.server) ? AppSettings.server : {};

        // 1. 对 URL 类型的设置进行验证
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try {
                new URL(value);
            }
            catch (_) {
                NotificationUIManager.showNotification(`${storageKey.replace(/_/g, ' ')} 的 URL 无效。未保存。`, 'error');
                // 恢复为之前保存的值
                const inputEl = storageKey === 'apiEndpoint' ? this.apiEndpointInput : this.ttsApiEndpointInput;
                if (inputEl) inputEl.value = localStorage.getItem(`aiSetting_${storageKey}`) || serverConfig[storageKey] || '';
                return;
            }
        }

        // 2. 对 max_tokens 进行验证
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

        // 3. 保存到 localStorage
        localStorage.setItem(`aiSetting_${storageKey}`, String(value));

        // 4. 触发全局事件，通知其他模块 AI 配置已变更
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('aiConfigChanged');
        } else {
            Utils.log("SettingsUIManager: EventEmitter 未定义，无法触发 aiConfigChanged 事件。", Utils.logLevels.WARN);
        }
    },

    /**
     * 从模态框中复制用户 ID 到剪贴板。
     * @function copyUserIdFromModal
     * @example
     * SettingsUIManager.copyUserIdFromModal();
     */
    copyUserIdFromModal: function () {
        const userId = this.modalUserIdValue?.textContent;
        if (userId && userId !== "生成中...") {
            navigator.clipboard.writeText(userId)
                .then(() => NotificationUIManager.showNotification('用户 ID 已复制！', 'success'))
                .catch(() => NotificationUIManager.showNotification('复制 ID 失败。', 'error'));
        }
    },

    /**
     * 从模态框中复制 SDP 连接信息到剪贴板。
     * @function copySdpTextFromModal
     */
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

    /**
     * 根据用户 ID 是否已生成来更新“复制 ID”按钮的状态。
     * @function updateCopyIdButtonState
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
     * 根据 WebSocket 连接状态更新“手动连接”按钮的状态。
     * @function updateCheckNetworkButtonState
     */
    updateCheckNetworkButtonState: function() {
        if (!this.checkNetworkBtnModal) return;
        const isConnected = ConnectionManager.isWebSocketConnected;
        this.checkNetworkBtnModal.disabled = isConnected;
        this.checkNetworkBtnModal.classList.toggle('btn-action-themed', !isConnected);
        this.checkNetworkBtnModal.classList.toggle('btn-secondary', isConnected);
    },

    /**
     * 更新主菜单中所有依赖于动态状态的控件。
     * @function updateMainMenuControlsState
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
     * @function updateNetworkInfoDisplay
     * @param {object} networkType - WebRTC 网络检测结果。
     * @param {boolean} webSocketStatus - WebSocket 的连接状态。
     */
    updateNetworkInfoDisplay: function (networkType, webSocketStatus) {
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');
        if (!networkInfoEl || !qualityIndicator || !qualityText) return;

        let html = '';
        let overallQuality;
        let qualityClass;

        // 更新 WebRTC 网络连通性信息
        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4?'✓':'✗'} | IPv6: ${networkType.ipv6?'✓':'✗'} <br>`;
            html += `UDP: ${networkType.udp?'✓':'✗'} | TCP: ${networkType.tcp?'✓':'✗'} | 中继: ${networkType.relay?'✓':'?'} <br>`;
        } else {
            html += 'WebRTC 网络检测: ' + (networkType?.error || '失败/不支持') + '.<br>';
        }
        // 更新信令服务器连接状态
        html += `信令服务器: ${webSocketStatus ? '<span style="color: green;">已连接</span>' : '<span style="color: var(--danger-color, red);">已断开</span>'}`;
        networkInfoEl.innerHTML = html;

        // 根据网络状态判断综合质量
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
        // 更新质量指示器 UI
        qualityIndicator.className = `quality-indicator ${qualityClass}`;
        qualityText.textContent = overallQuality;
    },
};