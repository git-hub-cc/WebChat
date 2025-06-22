/**
 * @file SettingsUIManager.js
 * @description 设置 UI 管理器，负责处理主菜单/设置模态框内的所有 UI 元素和交互逻辑。
 *              AI 配置现在优先从 localStorage 加载。主题切换现在无刷新。
 *              修复了切换配色方案后，主题选择器点击事件处理不当的问题。
 *              新增“清除缓存”按钮，用于清除 localStorage 和 IndexedDB 数据。
 *              用户切换主题或配色方案后，自动隐藏菜单。
 * @module SettingsUIManager
 * @exports {object} SettingsUIManager - 对外暴露的单例对象，包含所有设置 UI 管理方法。
 * @property {function} init - 初始化模块，获取 DOM 元素、加载设置并绑定事件。
 * @property {function} loadAISettings - 从 localStorage 加载 AI 相关设置并填充到输入框。
 * @property {function} saveAISetting - 保存单个 AI 设置到 localStorage 并触发事件。
 * @property {function} initThemeSelectors - 初始化主题和配色方案的自定义下拉选择器。
 * @property {function} updateNetworkInfoDisplay - 更新模态框中的网络状态信息。
 * @dependencies UserManager, ConnectionManager, ChatManager, ThemeLoader, NotificationUIManager, Utils, AppInitializer, ModalUIManager, EventEmitter, Config, DBManager
 * @dependents AppInitializer (进行初始化)
 */
const SettingsUIManager = {
    // 主题和配色方案选择器元素
    colorSchemeSelectedValueEl: null,
    colorSchemeOptionsContainerEl: null,
    themeSelectedValueEl: null,
    themeOptionsContainerEl: null,

    // AI 设置输入元素
    apiEndpointInput: null,
    apiKeyInput: null,
    apiModelInput: null,
    apiMaxTokensInput: null,
    ttsApiEndpointInput: null,

    // 其他设置元素
    autoConnectToggle: null,
    modalCopyIdBtn: null,
    checkNetworkBtnModal: null,
    modalUserIdValue: null,
    modalClearCacheBtn: null,

    // 存储绑定的事件处理函数，以便正确移除
    _boundHandleThemeSelectorClick: null,
    _boundHandleColorSchemeSelectorClick: null,


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
    },

    /**
     * 绑定设置模态框内的所有 UI 事件监听器。
     */
    bindEvents: function() {
        // AI 设置输入框失去焦点时保存
        if (this.apiEndpointInput) this.apiEndpointInput.addEventListener('blur', () => this.saveAISetting('apiEndpoint', this.apiEndpointInput.value));
        if (this.apiKeyInput) this.apiKeyInput.addEventListener('blur', () => this.saveAISetting('api_key', this.apiKeyInput.value));
        if (this.apiModelInput) this.apiModelInput.addEventListener('blur', () => this.saveAISetting('model', this.apiModelInput.value));
        if (this.apiMaxTokensInput) this.apiMaxTokensInput.addEventListener('blur', () => {
            const val = parseInt(this.apiMaxTokensInput.value, 10);
            // 获取服务器配置或默认值
            const serverConfig = (typeof window.Config !== 'undefined' && window.Config && window.Config.server) ? window.Config.server : {};
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
            this.saveAISetting('max_tokens', isNaN(val) ? configMaxTokens : val); // 如果无效则使用配置/默认值
        });
        if (this.ttsApiEndpointInput) this.ttsApiEndpointInput.addEventListener('blur', () => this.saveAISetting('ttsApiEndpoint', this.ttsApiEndpointInput.value));

        // --- 网络状态 ---
        if (this.checkNetworkBtnModal) this.checkNetworkBtnModal.addEventListener('click', async () => {
            if (this.checkNetworkBtnModal.disabled) { // 如果已连接，则不执行
                NotificationUIManager.showNotification('当前已连接到信令服务器。', 'info');
                return;
            }
            NotificationUIManager.showNotification('正在重新检查网络并尝试连接...', 'info');
            await AppInitializer.refreshNetworkStatusUI(); // 刷新网络状态UI
            if (!ConnectionManager.isWebSocketConnected) { // 如果未连接，则尝试连接
                ConnectionManager.connectWebSocket().catch(err => {
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
                ModalUIManager.showConfirmationModal( // 显示确认对话框
                    '您确定要清除所有本地缓存吗？这将删除所有 localStorage 数据和 IndexedDB 数据库中的所有内容。操作完成后，页面将自动刷新。',
                    async () => { // 确认回调
                        try {
                            localStorage.clear(); // 清除 localStorage
                            Utils.log('LocalStorage 已清除。', Utils.logLevels.INFO);
                            await DBManager.clearAllData(); // 清除 IndexedDB
                            NotificationUIManager.showNotification('所有缓存已成功清除。页面即将刷新...', 'success');
                            setTimeout(() => { // 延迟刷新，给用户看通知
                                window.location.reload();
                            }, 2000);
                        } catch (error) {
                            Utils.log(`清除缓存失败: ${error}`, Utils.logLevels.ERROR);
                            NotificationUIManager.showNotification('清除缓存时发生错误。请查看控制台。', 'error');
                        }
                    },
                    null, // 取消回调
                    { title: '警告：清除缓存', confirmText: '确定清除', cancelText: '取消' } // 对话框选项
                );
            });
        }

        // --- 可折叠部分 (统一逻辑) ---
        const collapsibleHeaders = document.querySelectorAll('#mainMenuModal .settings-section .collapsible-header');
        collapsibleHeaders.forEach(header => {
            // 确保每个header都有一个 .collapse-icon
            let icon = header.querySelector('.collapse-icon');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'collapse-icon';
                // 尝试智能插入图标
                const textNode = Array.from(header.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
                if (textNode && textNode.nextSibling) {
                    header.insertBefore(icon, textNode.nextSibling);
                } else {
                    header.appendChild(icon);
                }
            }

            const content = header.nextElementSibling;
            // 设置初始图标和active类
            if (content && content.classList.contains('collapsible-content')) {
                if (content.style.display === 'none' || getComputedStyle(content).display === 'none') {
                    icon.textContent = '▶';
                    header.classList.remove('active');
                } else {
                    icon.textContent = '▼';
                    header.classList.add('active');
                }
            }

            header.addEventListener('click', function() {
                this.classList.toggle('active'); // 切换active类
                const currentContent = this.nextElementSibling; // 获取紧邻的内容元素
                const currentIcon = this.querySelector('.collapse-icon'); // 获取图标
                if (currentContent && currentContent.classList.contains('collapsible-content')) {
                    if (currentContent.style.display === 'block' || currentContent.style.display === '') {
                        currentContent.style.display = 'none'; // 折叠
                        if (currentIcon) currentIcon.textContent = '▶';
                    } else {
                        currentContent.style.display = 'block'; // 展开
                        if (currentIcon) currentIcon.textContent = '▼';
                    }
                }
            });
        });


        // --- 全局点击监听器，用于关闭自定义下拉菜单 ---
        document.addEventListener('click', (e) => {
            const themeCustomSelect = document.getElementById('themeCustomSelectContainer');
            if (this.themeOptionsContainerEl && themeCustomSelect && !themeCustomSelect.contains(e.target)) {
                this.themeOptionsContainerEl.style.display = 'none'; // 如果点击外部，则关闭主题下拉
            }
            const colorSchemeCustomSelect = document.getElementById('colorSchemeCustomSelectContainer');
            if (this.colorSchemeOptionsContainerEl && colorSchemeCustomSelect && !colorSchemeCustomSelect.contains(e.target)) {
                this.colorSchemeOptionsContainerEl.style.display = 'none'; // 关闭配色方案下拉
            }
        });
    },

    /**
     * @private
     * 处理主题选择器触发元素的点击事件，用于展开/折叠选项。
     * @param {Event} event - 点击事件对象。
     */
    _handleThemeSelectorClick: function(event) {
        event.stopPropagation(); // 阻止事件冒泡到全局点击监听器
        const currentDisplayState = this.themeOptionsContainerEl.style.display;
        // 关闭其他所有自定义下拉框
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.themeOptionsContainerEl) opt.style.display = 'none';
        });
        // 切换当前下拉框的显示状态
        this.themeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },

    /**
     * @private
     * 处理配色方案选择器触发元素的点击事件，用于展开/折叠选项。
     * @param {Event} event - 点击事件对象。
     */
    _handleColorSchemeSelectorClick: function(event) {
        event.stopPropagation();
        const currentDisplayState = this.colorSchemeOptionsContainerEl.style.display;
        document.querySelectorAll('.custom-select .options').forEach(opt => {
            if (opt !== this.colorSchemeOptionsContainerEl) opt.style.display = 'none';
        });
        this.colorSchemeOptionsContainerEl.style.display = currentDisplayState === 'block' ? 'none' : 'block';
    },


    /**
     * 初始化主题和配色方案的自定义下拉选择器。
     */
    initThemeSelectors: function() {
        this._populateColorSchemeSelector(); // 填充配色方案选项
        this._populateThemeSelectorWithOptions(); // 填充主题选项
    },

    /**
     * @private 填充配色方案选择器的选项。
     *          修改为调用 ThemeLoader.applyTheme() 无刷新切换。
     *          切换后自动隐藏菜单。
     */
    _populateColorSchemeSelector: function() {
        if (!this.colorSchemeSelectedValueEl || !this.colorSchemeOptionsContainerEl || typeof ThemeLoader === 'undefined') return;

        const schemes = { 'auto': '自动 (浏览器)', 'light': '浅色模式', 'dark': '深色模式' }; // 可选配色方案
        // 获取当前偏好或默认值
        const currentPreferredScheme = localStorage.getItem(ThemeLoader.COLOR_SCHEME_KEY) || ThemeLoader.DEFAULT_COLOR_SCHEME;

        this.colorSchemeSelectedValueEl.textContent = schemes[currentPreferredScheme]; // 更新显示文本
        this.colorSchemeOptionsContainerEl.innerHTML = ''; // 清空旧选项

        // 创建并添加选项
        for (const key in schemes) {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = schemes[key];
            optionDiv.dataset.schemeKey = key; // 存储键值

            optionDiv.addEventListener('click', async () => {
                const selectedSchemeKey = optionDiv.dataset.schemeKey;

                // 调用 ThemeLoader 处理配色方案更新和主题应用
                await ThemeLoader.updateColorSchemePreference(selectedSchemeKey);

                this.colorSchemeSelectedValueEl.textContent = schemes[selectedSchemeKey]; // 更新显示文本
                this._populateThemeSelectorWithOptions(); // 配色方案更改后，重新填充主题选项

                this.colorSchemeOptionsContainerEl.style.display = 'none'; // 关闭下拉框
                // 切换配色方案后隐藏主菜单模态框
                if (typeof ModalUIManager !== 'undefined') {
                    ModalUIManager.toggleModal('mainMenuModal', false);
                }
            });
            this.colorSchemeOptionsContainerEl.appendChild(optionDiv);
        }

        // 绑定选择器头部点击事件 (展开/折叠选项)
        // 移除旧的监听器（如果存在），然后绑定新的，以防止重复绑定
        if (this._boundHandleColorSchemeSelectorClick) {
            this.colorSchemeSelectedValueEl.removeEventListener('click', this._boundHandleColorSchemeSelectorClick);
        }
        this._boundHandleColorSchemeSelectorClick = this._handleColorSchemeSelectorClick.bind(this);
        this.colorSchemeSelectedValueEl.addEventListener('click', this._boundHandleColorSchemeSelectorClick);
    },

    /**
     * @private 根据当前生效的配色方案，填充主题选择器的选项。
     *          修改为调用 ThemeLoader.applyTheme() 无刷新切换。
     *          切换后自动隐藏菜单。
     */
    _populateThemeSelectorWithOptions: function() {
        if (!this.themeSelectedValueEl || !this.themeOptionsContainerEl || typeof ThemeLoader === 'undefined') return;

        this.themeOptionsContainerEl.innerHTML = ''; // 清空旧选项
        const currentEffectiveColorScheme = ThemeLoader.getCurrentEffectiveColorScheme(); // 获取当前生效的配色方案
        const filteredThemes = {}; // 存储兼容的主题

        // 筛选出与当前配色方案兼容的主题
        for (const key in ThemeLoader.themes) {
            if (ThemeLoader._isThemeCompatible(key, currentEffectiveColorScheme)) {
                filteredThemes[key] = ThemeLoader.themes[key];
            }
        }

        let themeKeyForDisplay = ThemeLoader.getCurrentThemeKey(); // 获取当前主题键
        // 如果当前主题不兼容新配色方案，或未设置，则查找备用主题
        if (!themeKeyForDisplay || !filteredThemes[themeKeyForDisplay]) {
            themeKeyForDisplay = ThemeLoader._findFallbackThemeKeyForScheme(currentEffectiveColorScheme);
        }

        const themeForDisplayObject = ThemeLoader.themes[themeKeyForDisplay]; // 获取主题对象
        // 更新显示文本和数据属性
        this.themeSelectedValueEl.textContent = themeForDisplayObject?.name ?? '选择主题';
        this.themeSelectedValueEl.dataset.currentThemeKey = themeKeyForDisplay || '';


        if (Object.keys(filteredThemes).length === 0) { // 如果没有兼容主题
            this.themeSelectedValueEl.textContent = "无可用主题";
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('option');
            optionDiv.textContent = `没有可用的 ${currentEffectiveColorScheme === 'light' ? '浅色' : '深色'} 主题`;
            optionDiv.style.pointerEvents = "none"; // 不可点击
            optionDiv.style.opacity = "0.7";
            this.themeOptionsContainerEl.appendChild(optionDiv);
        } else { // 填充兼容的主题选项
            for (const key in filteredThemes) {
                const theme = filteredThemes[key];
                const optionDiv = document.createElement('div');
                optionDiv.classList.add('option');
                optionDiv.textContent = theme.name;
                optionDiv.dataset.themeKey = key;
                optionDiv.addEventListener('click', async () => {
                    const selectedKey = optionDiv.dataset.themeKey;
                    if (selectedKey !== ThemeLoader.getCurrentThemeKey()) { // 如果选择的主题与当前不同
                        await ThemeLoader.applyTheme(selectedKey); // 应用新主题
                        this.themeSelectedValueEl.textContent = ThemeLoader.themes[selectedKey]?.name; // 更新显示文本
                        this.themeSelectedValueEl.dataset.currentThemeKey = selectedKey;
                    }
                    this.themeOptionsContainerEl.style.display = 'none'; // 关闭下拉框
                    if (typeof ModalUIManager !== 'undefined') { // 关闭主菜单
                        ModalUIManager.toggleModal('mainMenuModal', false);
                    }
                });
                this.themeOptionsContainerEl.appendChild(optionDiv);
            }
        }

        // 绑定选择器头部点击事件
        if (this._boundHandleThemeSelectorClick) {
            this.themeSelectedValueEl.removeEventListener('click', this._boundHandleThemeSelectorClick);
        }
        this._boundHandleThemeSelectorClick = this._handleThemeSelectorClick.bind(this);
        this.themeSelectedValueEl.addEventListener('click', this._boundHandleThemeSelectorClick);
    },

    /**
     * 从 localStorage 加载 AI 相关设置，如果不存在则使用 Config.js 的默认值，并填充到输入框。
     * 此函数不再修改 window.Config.server。
     */
    loadAISettings: function() {
        const serverConfig = (typeof window.Config !== 'undefined' && window.Config && typeof window.Config.server === 'object' && window.Config.server !== null)
            ? window.Config.server
            : {}; // 默认服务器配置

        // 定义要加载的设置项及其属性
        const settingsToLoad = [
            { storageKey: 'apiEndpoint', input: this.apiEndpointInput, configKey: 'apiEndpoint', ultimateDefault: serverConfig.apiEndpoint },
            { storageKey: 'api_key', input: this.apiKeyInput, configKey: 'api_key', ultimateDefault: serverConfig.api_key },
            { storageKey: 'model', input: this.apiModelInput, configKey: 'model', ultimateDefault: serverConfig.model },
            { storageKey: 'max_tokens', input: this.apiMaxTokensInput, configKey: 'max_tokens', isNumber: true, ultimateDefault: serverConfig.max_tokens },
            { storageKey: 'ttsApiEndpoint', input: this.ttsApiEndpointInput, configKey: 'ttsApiEndpoint', ultimateDefault: serverConfig.ttsApiEndpoint }
        ];

        settingsToLoad.forEach(setting => {
            const savedValue = localStorage.getItem(`aiSetting_${setting.storageKey}`); // 从 localStorage 获取
            let valueToSet;

            if (savedValue !== null) { // 优先使用 localStorage 的值
                valueToSet = savedValue;
            } else { // 否则使用服务器配置
                valueToSet = serverConfig[setting.configKey];
            }

            if (setting.isNumber) { // 如果是数字类型
                let numVal = parseInt(String(valueToSet), 10);
                if (isNaN(numVal)) { // 如果无效，则使用配置或最终默认值
                    numVal = serverConfig[setting.configKey] !== undefined && !isNaN(parseInt(String(serverConfig[setting.configKey]), 10))
                        ? parseInt(String(serverConfig[setting.configKey]), 10)
                        : setting.ultimateDefault;
                }
                valueToSet = numVal;
            } else { // 字符串类型
                if (valueToSet === undefined) { // 如果未定义，则使用配置或空字符串
                    valueToSet = serverConfig[setting.configKey] ?? "";
                }
            }

            if (setting.input) { // 填充到输入框
                setting.input.value = String(valueToSet);
            }
        });
    },

    /**
     * 保存单个 AI 设置到 localStorage，并触发 'aiConfigChanged' 事件。
     * 不再修改 window.Config.server。
     * @param {string} storageKey - 在 localStorage 中使用的键名 (例如 'apiEndpoint', 'api_key')。
     * @param {string|number} value - 要保存的值。
     */
    saveAISetting: function(storageKey, value) {
        const serverConfig = (typeof window.Config !== 'undefined' && window.Config && typeof window.Config.server === 'object' && window.Config.server !== null)
            ? window.Config.server
            : {};

        // URL 校验
        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try { new URL(value); } // 尝试创建URL对象以校验
            catch (_) { // 如果无效
                NotificationUIManager.showNotification(`${storageKey.replace(/_/g, ' ')} 的 URL 无效。未保存。`, 'error');
                const inputEl = storageKey === 'apiEndpoint' ? this.apiEndpointInput : this.ttsApiEndpointInput;
                const storedVal = localStorage.getItem(`aiSetting_${storageKey}`);
                const configVal = serverConfig[storageKey] ?? "";
                if (inputEl) inputEl.value = storedVal ?? configVal; // 恢复旧值
                return;
            }
        }
        // 数字校验 (max_tokens)
        if (storageKey === 'max_tokens') {
            const numValue = parseInt(String(value), 10);
            const configMaxTokens = serverConfig.max_tokens !== undefined ? serverConfig.max_tokens : 2048;
            if (isNaN(numValue) || numValue <= 0) { // 必须为正数
                NotificationUIManager.showNotification('最大令牌数必须为正数。未保存。', 'error');
                const storedVal = localStorage.getItem('aiSetting_max_tokens');
                if (this.apiMaxTokensInput) this.apiMaxTokensInput.value = storedVal ?? configMaxTokens; // 恢复旧值
                return;
            }
            value = numValue; // 保存数字类型
        }

        localStorage.setItem(`aiSetting_${storageKey}`, String(value)); // 保存到 localStorage

        const friendlyName = storageKey.charAt(0).toUpperCase() + storageKey.slice(1).replace(/_/g, ' ');
        NotificationUIManager.showNotification(`${friendlyName} 设置已保存。`, 'success');

        // 触发配置变更事件
        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('aiConfigChanged');
        } else {
            Utils.log("SettingsUIManager: EventEmitter 未定义，无法触发 aiConfigChanged 事件。", Utils.logLevels.WARN);
        }
    },

    /**
     * 从模态框中复制用户 ID 到剪贴板。
     */
    copyUserIdFromModal: function () {
        const userId = this.modalUserIdValue?.textContent;
        if (userId && userId !== "生成中...") { // 确保ID已生成
            navigator.clipboard.writeText(userId)
                .then(() => NotificationUIManager.showNotification('用户 ID 已复制！', 'success'))
                .catch(() => NotificationUIManager.showNotification('复制 ID 失败。', 'error'));
        }
    },

    /**
     * 从模态框中复制 SDP 连接信息到剪贴板。
     */
    copySdpTextFromModal: function () {
        const sdpTextEl = document.getElementById('modalSdpText');
        if (sdpTextEl && sdpTextEl.value) { // 确保有内容可复制
            navigator.clipboard.writeText(sdpTextEl.value)
                .then(() => NotificationUIManager.showNotification('连接信息已复制！', 'success'))
                .catch(() => NotificationUIManager.showNotification('复制信息失败。', 'error'));
        } else {
            NotificationUIManager.showNotification('没有可复制的连接信息。', 'warning');
        }
    },

    /**
     * 更新“复制 ID”按钮的启用/禁用状态。
     */
    updateCopyIdButtonState: function() {
        if (!this.modalUserIdValue || !this.modalCopyIdBtn) return;
        const userIdReady = this.modalUserIdValue.textContent !== '生成中...' && UserManager.userId; // ID是否已准备好
        this.modalCopyIdBtn.disabled = !userIdReady; // 设置禁用状态
        this.modalCopyIdBtn.title = userIdReady ? '复制用户 ID' : '用户 ID 尚未生成。';
        // 切换按钮样式
        this.modalCopyIdBtn.classList.toggle('btn-action-themed', userIdReady);
        this.modalCopyIdBtn.classList.toggle('btn-secondary', !userIdReady);
    },

    /**
     * 更新“重新检查网络”按钮的启用/禁用状态。
     */
    updateCheckNetworkButtonState: function() {
        if (!this.checkNetworkBtnModal) return;
        const isConnected = ConnectionManager.isWebSocketConnected; // 是否已连接到WebSocket
        this.checkNetworkBtnModal.disabled = isConnected; // 如果已连接则禁用
        // 切换按钮样式
        this.checkNetworkBtnModal.classList.toggle('btn-action-themed', !isConnected);
        this.checkNetworkBtnModal.classList.toggle('btn-secondary', isConnected);
    },

    /**
     * 更新主菜单/设置模态框中所有依赖于应用状态的控件。
     */
    updateMainMenuControlsState: function() {
        if (this.autoConnectToggle && UserManager.userSettings) { // 更新自动连接开关状态
            this.autoConnectToggle.checked = UserManager.userSettings.autoConnectEnabled;
        }
        this.updateCopyIdButtonState(); // 更新复制ID按钮状态
        this.updateCheckNetworkButtonState(); // 更新检查网络按钮状态
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
        if (!networkInfoEl || !qualityIndicator || !qualityText) return; // 防御性检查

        let html = ''; // 用于构建网络信息HTML
        let overallQuality; // 总体质量文本
        let qualityClass; // 质量指示器CSS类

        // 构建WebRTC检测信息
        if (networkType && networkType.error === null) {
            html += `IPv4: ${networkType.ipv4?'✓':'✗'} | IPv6: ${networkType.ipv6?'✓':'✗'} <br>`;
            html += `UDP: ${networkType.udp?'✓':'✗'} | TCP: ${networkType.tcp?'✓':'✗'} | 中继: ${networkType.relay?'✓':'?'} <br>`;
        } else {
            html += 'WebRTC 网络检测: ' + (networkType?.error || '失败/不支持') + '.<br>';
        }
        // 添加信令服务器状态
        html += `信令服务器: ${webSocketStatus ? '<span style="color: green;">已连接</span>' : '<span style="color: var(--danger-color, red);">已断开</span>'}`;
        networkInfoEl.innerHTML = html;

        // 判断总体连接质量
        if (!webSocketStatus) { // 如果信令服务器离线
            overallQuality = '信令离线';
            qualityClass = 'quality-poor';
        } else if (networkType && networkType.error === null) { // 如果WebRTC检测成功
            if (networkType.udp) { overallQuality = '良好'; qualityClass = 'quality-good'; }
            else if (networkType.tcp) { overallQuality = '受限 (TCP 回退)'; qualityClass = 'quality-medium'; }
            else if (networkType.relay) { overallQuality = '仅中继'; qualityClass = 'quality-medium'; }
            else { overallQuality = '差 (WebRTC 失败)'; qualityClass = 'quality-poor'; }
        } else { // WebRTC检测失败
            overallQuality = 'WebRTC 检查失败';
            qualityClass = 'quality-poor';
        }
        // 更新质量指示器UI
        qualityIndicator.className = `quality-indicator ${qualityClass}`;
        qualityText.textContent = overallQuality;
    },
};