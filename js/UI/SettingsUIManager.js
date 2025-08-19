/**
 * @file SettingsUIManager.js
 * @description 设置 UI 管理器，负责处理主菜单/设置模态框内的所有 UI 元素和交互逻辑。
 *              【重构】手动连接功能已完全适配 simple-peer 的信令交换模式。
 *              【修复】修复了切换LLM提供商时，未先保存新默认模型再更新UI导致的bug。
 * @module SettingsUIManager
 * @exports {object} SettingsUIManager - 对外暴露的单例对象，包含所有设置 UI 管理方法。
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
    modelSelectedValueEl: null,
    modelOptionsContainerEl: null,
    apiEndpointInput: null,
    apiModelInputContainer: null,
    apiKeyInput: null,
    apiMaxTokensInput: null,
    ttsApiEndpointInput: null,

    // 背景图片设置元素
    setBackgroundBtnLight: null,
    removeBackgroundBtnLight: null,
    bgImageInputLight: null,
    setBackgroundBtnDark: null,
    removeBackgroundBtnDark: null,
    bgImageInputDark: null,

    // 其他设置元素
    modalCopyIdBtn: null,
    checkNetworkBtnModal: null,
    modalUserIdValue: null,
    modalClearCacheBtn: null,

    // 存储绑定的事件处理函数
    _boundHandleThemeSelectorClick: null,
    _boundHandleColorSchemeSelectorClick: null,
    _boundHandleLlmProviderSelectorClick: null,
    _boundHandleModelSelectorClick: null,


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


        // 背景图片设置元素（浅色和深色）
        this.setBackgroundBtnLight = document.getElementById('setBackgroundBtnLight');
        this.removeBackgroundBtnLight = document.getElementById('removeBackgroundBtnLight');
        this.bgImageInputLight = document.getElementById('bgImageInputLight');
        this.setBackgroundBtnDark = document.getElementById('setBackgroundBtnDark');
        this.removeBackgroundBtnDark = document.getElementById('removeBackgroundBtnDark');
        this.bgImageInputDark = document.getElementById('bgImageInputDark');


        // 其他设置元素
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


        // 背景图片设置 (浅色和深色)
        if (this.setBackgroundBtnLight) this.setBackgroundBtnLight.addEventListener('click', () => this.bgImageInputLight.click());
        if (this.bgImageInputLight) this.bgImageInputLight.addEventListener('change', (e) => this.handleBackgroundChange(e, 'light'));
        if (this.removeBackgroundBtnLight) this.removeBackgroundBtnLight.addEventListener('click', () => this.handleRemoveBackground('light'));

        if (this.setBackgroundBtnDark) this.setBackgroundBtnDark.addEventListener('click', () => this.bgImageInputDark.click());
        if (this.bgImageInputDark) this.bgImageInputDark.addEventListener('change', (e) => this.handleBackgroundChange(e, 'dark'));
        if (this.removeBackgroundBtnDark) this.removeBackgroundBtnDark.addEventListener('click', () => this.handleRemoveBackground('dark'));


        // 网络状态
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

        // 用户 ID 和信令信息复制
        if (this.modalCopyIdBtn) this.modalCopyIdBtn.addEventListener('click', () => {
            if (this.modalCopyIdBtn.disabled) return;
            this.copyUserIdFromModal();
        });

        const modalCopySdpBtn = document.getElementById('modalCopySdpBtn');
        if(modalCopySdpBtn) modalCopySdpBtn.addEventListener('click', () => this.copySdpTextFromModal());

        // --- [MODIFIED] 手动连接按钮适配 simple-peer ---
        const modalCreateOfferBtn = document.getElementById('modalCreateOfferBtn');
        if(modalCreateOfferBtn) modalCreateOfferBtn.addEventListener('click', () => {
            const sdpTextEl = document.getElementById('modalSdpText');
            sdpTextEl.value = '正在生成提议...';
            // 调用 ConnectionManager 创建一个手动的、发起方的 peer 连接
            const peer = ConnectionManager.connectToPeer(null, { initiator: true, isManual: true });
            if (peer) {
                // simple-peer 会立即或稍后触发 'signal' 事件
                peer.once('signal', signalData => {
                    ConnectionManager.updateSdpTextInModal(ConnectionManager.MANUAL_PLACEHOLDER_PEER_ID, signalData);
                    NotificationUIManager.showNotification("提议已生成。请复制并发送给对方。", "info");
                });
            } else {
                sdpTextEl.value = '创建提议失败。';
            }
        });

        const modalCreateAnswerBtn = document.getElementById('modalCreateAnswerBtn');
        if(modalCreateAnswerBtn) modalCreateAnswerBtn.addEventListener('click', () => {
            const sdpTextEl = document.getElementById('modalSdpText');
            if (!sdpTextEl || !sdpTextEl.value) {
                NotificationUIManager.showNotification("请先粘贴对方的提议信息。", "warning");
                return;
            }
            try {
                const offerData = JSON.parse(sdpTextEl.value);
                if (!offerData.signal || !offerData.userId) throw new Error("无效的提议格式。");

                sdpTextEl.value = '正在生成应答...';
                // 创建一个非发起方的 peer
                const peer = ConnectionManager.connectToPeer(offerData.userId, { initiator: false, isManual: true });
                if (peer) {
                    // 当它生成自己的 signal (answer) 时...
                    peer.once('signal', signalData => {
                        ConnectionManager.updateSdpTextInModal(ConnectionManager.MANUAL_PLACEHOLDER_PEER_ID, signalData);
                        NotificationUIManager.showNotification("应答已生成。请复制并发送给对方。", "info");
                    });
                    // 将收到的 offer 喂给它
                    peer.signal(offerData.signal);
                } else {
                    sdpTextEl.value = '创建应答失败。';
                }
            } catch (e) {
                NotificationUIManager.showNotification(`处理提议失败: ${e.message}`, "error");
            }
        });

        const modalHandleAnswerBtn = document.getElementById('modalHandleAnswerBtn');
        if(modalHandleAnswerBtn) modalHandleAnswerBtn.addEventListener('click', () => {
            const sdpTextEl = document.getElementById('modalSdpText');
            if (!sdpTextEl || !sdpTextEl.value) {
                NotificationUIManager.showNotification("请先粘贴对方的应答信息。", "warning");
                return;
            }
            try {
                const answerData = JSON.parse(sdpTextEl.value);
                if (!answerData.signal || !answerData.userId) throw new Error("无效的应答格式。");

                // 获取我们之前创建的发起方 peer 实例
                const peer = WebRTCManager.getPeer(ConnectionManager.MANUAL_PLACEHOLDER_PEER_ID);
                if (peer) {
                    // 将 answer 喂给它，连接将建立
                    peer.signal(answerData.signal);
                    sdpTextEl.value = '';
                    NotificationUIManager.showNotification("正在处理应答...", "info");
                    ModalUIManager.toggleModal('mainMenuModal', false);
                } else {
                    NotificationUIManager.showNotification("未找到待处理的提议，请先创建提议。", "error");
                }
            } catch (e) {
                NotificationUIManager.showNotification(`处理应答失败: ${e.message}`, "error");
            }
        });


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
            if (this.modelOptionsContainerEl && !isClickInside('modelCustomSelectContainer', e.target)) {
                this.modelOptionsContainerEl.style.display = 'none';
            }
        });
    },

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
        const providerConfig = (typeof LLMProviders !== 'undefined') ? LLMProviders[providerKey] : null;
        if (!providerConfig) return;

        this.apiEndpointInput.value = providerConfig.defaultEndpoint;
        this.saveAISetting('apiEndpoint', providerConfig.defaultEndpoint);

        // --- BUG FIX ---
        this.saveAISetting('model', providerConfig.defaultModel);
        this._updateModelInput(providerConfig);
        // --- END BUG FIX ---
    },
    _updateModelInput: function(providerConfig) {
        this.apiModelInputContainer.innerHTML = ''; // 清除之前的输入/选择框

        if (!providerConfig.models || providerConfig.models.length === 0) {
            const modelElement = document.createElement('input');
            modelElement.type = 'text';
            modelElement.id = 'apiModelInput';
            modelElement.placeholder = '输入自定义模型名称';
            const storedModel = localStorage.getItem('aiSetting_model');
            modelElement.value = storedModel || providerConfig.defaultModel;
            this.apiModelInputContainer.appendChild(modelElement);

            this.modelSelectedValueEl = null;
            this.modelOptionsContainerEl = null;
            this._boundHandleModelSelectorClick = null;

        } else {
            const customSelectContainer = document.createElement('div');
            customSelectContainer.className = 'custom-select';
            customSelectContainer.id = 'modelCustomSelectContainer'; // 用于全局点击监听器

            this.modelSelectedValueEl = document.createElement('div');
            this.modelSelectedValueEl.className = 'selected';
            this.modelSelectedValueEl.id = 'modelSelectedValue';

            this.modelOptionsContainerEl = document.createElement('div');
            this.modelOptionsContainerEl.className = 'options';
            this.modelOptionsContainerEl.id = 'modelOptionsContainer';

            const storedModelKey = localStorage.getItem('aiSetting_model') || providerConfig.defaultModel;
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

    loadAISettings: function() {
        const providerKey = localStorage.getItem('aiSetting_llmProvider') || 'webchat';
        const safeLLMProviders = (typeof LLMProviders !== 'undefined') ? LLMProviders : {};
        const providerConfig = safeLLMProviders[providerKey] || safeLLMProviders.webchat || {};

        this.apiEndpointInput.value = localStorage.getItem('aiSetting_apiEndpoint') || providerConfig.defaultEndpoint;
        this._updateModelInput(providerConfig);

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
        const serverConfig = AppSettings.server || {};

        if ((storageKey === 'apiEndpoint' || storageKey === 'ttsApiEndpoint') && value) {
            try { new URL(value); }
            catch (_) {
                NotificationUIManager.showNotification(`${storageKey} 的 URL 无效。未保存。`, 'error');
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

        if (typeof EventEmitter !== 'undefined') {
            EventEmitter.emit('aiConfigChanged');
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
        this.updateCopyIdButtonState();
        this.updateCheckNetworkButtonState();
    },
    updateNetworkInfoDisplay: function (networkType, webSocketStatus) {
        const networkInfoEl = document.getElementById('modalNetworkInfo');
        const qualityIndicator = document.getElementById('modalQualityIndicator');
        const qualityText = document.getElementById('modalQualityText');
        if (!networkInfoEl || !qualityIndicator || !qualityText) return;

        let html = '';
        let overallQuality, qualityClass;

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