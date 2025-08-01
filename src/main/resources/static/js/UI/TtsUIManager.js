/**
 * @file TtsUIManager.js
 * @description 文本转语音 (TTS) UI 管理器，负责填充和处理 AI 联系人详情面板中的 TTS 配置表单。
 *              它将 TTS 相关的 UI 逻辑从 DetailsPanelUIManager 中分离出来。
 *              新增支持动态获取 TTS 模型、说话人和情感的模式。
 *              修复了TTS模型/说话人端点不响应用户配置变更的问题。
 *              新增“版本”下拉框，用于在动态模式下指定获取模型时使用的 API 版本。
 *              TTS模型名称动态获取时，使用可搜索下拉框。
 * @module TtsUIManager
 * @exports {object} TtsUIManager - 对外暴露的单例对象，包含管理 TTS 配置 UI 的方法。
 * @property {function} populateAiTtsConfigurationForm - 根据联系人配置动态生成 TTS 设置表单。
 * @property {function} handleSaveAiTtsSettings - 处理保存 TTS 设置的逻辑。
 * @dependencies Utils, UserManager, NotificationUIManager, AppSettings, AiApiHandler, DetailsPanelUIManager
 * @dependents DetailsPanelUIManager (在更新详情面板时调用)
 */
const TtsUIManager = {
    // 定义 TTS 配置表单的所有字段及其属性
    TTS_CONFIG_FIELDS: [
        { // TTS 模式选择
            key: 'tts_mode', label: 'TTS 模式', type: 'select', default: 'Dynamic',
            options: [{value: 'Preset', text: '预设值'},{value: 'Dynamic', text: '动态获取'}],
            isAdvanced: false // 是否为高级选项
        },
        { // API 版本选择
            key: 'version', label: '版本', type: 'select', default: 'v4',
            options: [ // 可选版本
                {value: 'v2', text: 'v2'}, {value: 'v3', text: 'v3'},
                {value: 'v4', text: 'v4'}, {value: 'v2Pro', text: 'v2Pro'},
                {value: 'v2ProPlus', text: 'v2ProPlus'}
            ],
            isAdvanced: false
        },
        { key: 'enabled', label: '启用 TTS', type: 'checkbox', default: false, isAdvanced: false },
        { key: 'model_name', label: '模型名称', type: 'text', default: 'GPT-SoVITS', isPotentiallyDynamic: true, isAdvanced: false }, // 在动态模式下会变成可搜索select
        { key: 'prompt_text_lang', label: '参考音频语言', type: 'select', default: '中文', options: ["中文", "英语", "日语"], isPotentiallyDynamic: true, isAdvanced: false }, // 在动态模式下会变成select
        { key: 'emotion', label: '情感', type: 'text', default: '开心_happy', isPotentiallyDynamic: true, isAdvanced: false }, // 在动态模式下会变成select
        { key: 'text_lang', label: '文本语言', type: 'select', default: '中文', options: ["中文", "英语", "日语", "粤语", "韩语", "中英混合", "日英混合", "粤英混合", "韩英混合", "多语种混合", "多语种混合（粤语）"], isAdvanced: false },
        { key: 'text_split_method', label: '切分方法', type: 'select', default: '按标点符号切', options: ["四句一切", "凑50字一切", "按中文句号。切", "按英文句号.切", "按标点符号切"], isAdvanced: false },
        { key: 'seed', label: '种子', type: 'number', default: -1, step:1, isAdvanced: false },
        // 高级选项
        { key: 'media_type', label: '媒体类型', type: 'select', default: 'wav', options: ["wav", "mp3", "ogg"], isAdvanced: true },
        { key: 'fragment_interval', label: '分段间隔', type: 'number', default: 0.3, step:0.01, min:0, isAdvanced: true },
        { key: 'speed_facter', label: '语速', type: 'number', default: 1.0, step:0.1, min:0.1, max:3.0, isAdvanced: true },
        { key: 'parallel_infer', label: '并行推理', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'batch_threshold', label: '批处理阈值', type: 'number', default: 0.75, step:0.01, min:0, max:1, isAdvanced: true },
        { key: 'split_bucket', label: '分桶', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'batch_size', label: '批处理大小', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true },
        { key: 'top_k', label: 'Top K', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true },
        { key: 'top_p', label: 'Top P', type: 'number', default: 0.01, step:0.01, min:0, max:1, isAdvanced: true }, // API 文档通常为浮点数，例如0.9
        { key: 'temperature', label: '温度', type: 'number', default: 1.0, step:0.01, min:0.01, max:1, isAdvanced: true },
        { key: 'repetition_penalty', label: '重复惩罚', type: 'number', default: 1.35, step:0.01, min:0, max:2, isAdvanced: true },
    ],
    _boundSaveTtsListener: null, // 用于保存绑定的保存按钮事件监听器
    _dynamicDataCache: {}, // 用于缓存动态获取的模型/说话人/情感数据
    _searchableSelectGlobalListenerAttached: false, // 标记是否已附加全局点击监听器（用于可搜索下拉框）

    /**
     * 根据联系人的配置动态生成并填充 AI TTS 配置表单。
     * @param {object} contact - AI 联系人对象。
     * @param {string} [formContainerId='ttsConfigFormContainer'] - 表单容器的 DOM ID。
     */
    populateAiTtsConfigurationForm: function(contact, formContainerId = 'ttsConfigFormContainer') {
        const formContainer = document.getElementById(formContainerId);
        if (!formContainer) {
            Utils.log(`未找到 TTS 表单容器 '${formContainerId}'。`, Utils.logLevels.ERROR);
            return;
        }

        formContainer.innerHTML = ''; // 清空旧表单
        // 深拷贝TTS设置，避免直接修改原始配置
        const ttsSettings = (contact.aiConfig && contact.aiConfig.tts) ? JSON.parse(JSON.stringify(contact.aiConfig.tts)) : {};
        const currentTtsMode = ttsSettings.tts_mode || 'Preset'; // 当前TTS模式
        const currentVersion = ttsSettings.version || 'v4'; // 当前API版本

        // 创建基础和高级选项的容器
        const basicFieldsContainer = document.createElement('div');
        const advancedFieldsContainer = document.createElement('div');
        advancedFieldsContainer.className = 'collapsible-content tts-advanced-fields-container';
        // MODIFIED: 移除 style.display 设置，因为折叠现在由CSS grid控制
        // advancedFieldsContainer.style.display = 'none'; // 高级选项默认折叠

        // 遍历字段定义，创建表单元素
        this.TTS_CONFIG_FIELDS.forEach(field => {
            const parentEl = field.isAdvanced ? advancedFieldsContainer : basicFieldsContainer;
            this._createFieldElement(field, parentEl, ttsSettings, currentTtsMode, currentVersion, contact.id, formContainer);
        });

        formContainer.appendChild(basicFieldsContainer); // 添加基础选项

        // 如果有高级选项，则创建可折叠区域
        if (advancedFieldsContainer.childElementCount > 0) {
            const advancedSectionDiv = document.createElement('div');
            // MODIFIED: 添加 collapsible-container 类
            advancedSectionDiv.className = 'tts-config-section advanced-tts-section collapsible-container';

            const advancedHeader = document.createElement('div');
            // MODIFIED: 添加 collapsible-header 类和图标span
            advancedHeader.className = 'collapsible-header';
            advancedHeader.innerHTML = `高级选项 <span class="collapse-icon">▶</span>`;
            advancedHeader.style.cursor = 'pointer';

            advancedSectionDiv.appendChild(advancedHeader);
            advancedSectionDiv.appendChild(advancedFieldsContainer);
            formContainer.appendChild(advancedSectionDiv);

            // 使用 DetailsPanelUIManager 的辅助函数使其可折叠
            if (typeof DetailsPanelUIManager !== 'undefined' && typeof DetailsPanelUIManager._makeElementCollapsible === 'function') {
                // MODIFIED: 修正函数调用，只传递一个参数
                DetailsPanelUIManager._makeElementCollapsible(advancedHeader);
            } else {
                Utils.log("TtsUIManager: DetailsPanelUIManager 或其 _makeElementCollapsible 方法未找到。高级TTS选项可能无法折叠。", Utils.logLevels.WARN);
            }
        }
        // 如果是动态模式且选择了版本，则触发加载动态数据
        if (currentTtsMode === 'Dynamic' && currentVersion) {
            this._handleVersionChange(currentVersion, contact.id, formContainer, ttsSettings.model_name, ttsSettings.prompt_text_lang, ttsSettings.emotion);
        }
    },

    /**
     * @private
     * 创建单个表单字段的 DOM 元素。
     * @param {object} fieldDef - 字段定义对象。
     * @param {HTMLElement} parentEl - 该字段应附加到的父元素。
     * @param {object} currentTtsSettings - 当前联系人的 TTS 设置。
     * @param {string} currentTtsMode - 当前选中的 TTS 模式 ('Preset' 或 'Dynamic')。
     * @param {string} currentVersion - 当前选中的版本。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器，用于重新渲染。
     */
    _createFieldElement: function(fieldDef, parentEl, currentTtsSettings, currentTtsMode, currentVersion, contactId, formContainer) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tts-config-item'; // 表单项容器
        const label = document.createElement('label'); // 标签
        label.htmlFor = `ttsInput_${contactId}_${fieldDef.key}`;
        label.textContent = fieldDef.label + ':';
        itemDiv.appendChild(label);

        let input; // 输入元素
        // 获取保存的值或默认值
        const savedValue = currentTtsSettings[fieldDef.key] !== undefined ? currentTtsSettings[fieldDef.key] : fieldDef.default;

        if (fieldDef.key === 'tts_mode') { // TTS模式选择框
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options, currentTtsMode, '');
            input.addEventListener('change', (e) => { // 模式改变时，重新渲染表单
                const contactToUpdate = UserManager.contacts[contactId];
                if (contactToUpdate && contactToUpdate.aiConfig && contactToUpdate.aiConfig.tts) {
                    contactToUpdate.aiConfig.tts.tts_mode = e.target.value;
                }
                this.populateAiTtsConfigurationForm(UserManager.contacts[contactId], formContainer.id);
            });
        } else if (fieldDef.key === 'version') { // API版本选择框
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options, currentVersion, '');
            input.addEventListener('change', (e) => { // 版本改变时
                const newVersion = e.target.value;
                const contactToUpdate = UserManager.contacts[contactId];
                if (contactToUpdate && contactToUpdate.aiConfig && contactToUpdate.aiConfig.tts) {
                    contactToUpdate.aiConfig.tts.version = newVersion; // 更新版本
                    // 清空依赖于版本的动态字段
                    contactToUpdate.aiConfig.tts.model_name = undefined;
                    contactToUpdate.aiConfig.tts.prompt_text_lang = undefined;
                    contactToUpdate.aiConfig.tts.emotion = undefined;
                }
                if (currentTtsMode === 'Dynamic') { // 如果是动态模式，则加载新版本的数据
                    this._handleVersionChange(newVersion, contactId, formContainer, undefined, undefined, undefined);
                }
            });
        } else if (fieldDef.key === 'model_name' && currentTtsMode === 'Dynamic') {
            // 在动态模式下，模型名称使用可搜索下拉框
            input = this._createSearchableSelect(
                `ttsInput_${contactId}_${fieldDef.key}`,
                [], // 选项由 _handleVersionChange 动态填充
                savedValue,
                `加载${fieldDef.label}...`, // 占位符
                (selectedValue) => { // 选中模型后的回调
                    this._handleModelChange(selectedValue, currentVersion, contactId, formContainer, currentTtsSettings.prompt_text_lang, currentTtsSettings.emotion);
                }
            );
        } else if (fieldDef.isPotentiallyDynamic && currentTtsMode === 'Dynamic') {
            // 其他动态字段（参考音频语言、情感）在动态模式下也是下拉框
            input = document.createElement('select');
            input.disabled = true; // 初始禁用，等待模型选择后填充
            this._populateSelectWithOptions(input, [], savedValue, `加载${fieldDef.label}...`);

            if (fieldDef.key === 'prompt_text_lang') { // 参考音频语言改变时
                input.addEventListener('change', (e) => this._handleLanguageChange(e.target.value, currentTtsSettings.model_name, currentVersion, contactId, formContainer, currentTtsSettings.emotion));
            }
            // 情感选择框由 _handleLanguageChange 填充，此处无需额外事件
        } else if (fieldDef.type === 'checkbox') { // 复选框
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = savedValue;
        } else if (fieldDef.type === 'select' && !fieldDef.isPotentiallyDynamic) { // 普通下拉框
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options.map(opt => (typeof opt === 'string' ? {value: opt, text: opt} : opt)), savedValue, '');
        } else { // 其他类型的输入框 (text, number)
            input = document.createElement('input');
            input.type = fieldDef.type;
            input.value = savedValue;
            if (fieldDef.step !== undefined) input.step = fieldDef.step;
            if (fieldDef.min !== undefined) input.min = fieldDef.min;
            if (fieldDef.max !== undefined) input.max = fieldDef.max;
            if (fieldDef.type === 'text' && fieldDef.default !== undefined) input.placeholder = String(fieldDef.default);
        }

        // 为非可搜索下拉框的元素设置通用属性
        if (!(fieldDef.key === 'model_name' && currentTtsMode === 'Dynamic')) {
            input.id = `ttsInput_${contactId}_${fieldDef.key}`;
            input.dataset.ttsParam = fieldDef.key; // 存储参数键名
        }
        itemDiv.appendChild(input);
        parentEl.appendChild(itemDiv);
    },

    /**
     * @private
     * 创建一个自定义的可搜索下拉选择组件。
     * @param {string} idBase - 该组件内元素的ID基础部分。
     * @param {Array<object>} optionsArray - 初始选项数组，格式为 {value, text}。
     * @param {string|null} selectedValue - 初始选中的值。
     * @param {string} placeholderText - 输入框的占位文本。
     * @param {function} onSelectionChange - 当选项被选中时调用的回调函数，参数为选中的值。
     * @returns {HTMLElement} - 可搜索下拉选择组件的主容器div。
     */
    _createSearchableSelect: function(idBase, optionsArray, selectedValue, placeholderText, onSelectionChange) {
        const template = document.getElementById('searchable-select-template').content.cloneNode(true);
        const container = template.querySelector('.searchable-select-tts');
        const input = container.querySelector('.searchable-select-input-tts');
        const optionsContainer = container.querySelector('.searchable-select-options-container-tts');

        container.id = idBase;
        container.dataset.ttsParam = idBase.substring(idBase.lastIndexOf('_') + 1);
        input.placeholder = placeholderText;

        let currentFullOptions = [...optionsArray];

        const populateOptions = (filterText = '') => {
            optionsContainer.innerHTML = '';
            const filteredOptions = currentFullOptions.filter(opt =>
                opt.text.toLowerCase().includes(filterText.toLowerCase())
            );

            if (filteredOptions.length === 0 && filterText) {
                const noResultOpt = document.createElement('div');
                noResultOpt.className = 'searchable-select-option-tts no-results';
                noResultOpt.textContent = '无匹配项';
                optionsContainer.appendChild(noResultOpt);
            } else if (currentFullOptions.length === 0 && !filterText) {
                const loadingOpt = document.createElement('div');
                loadingOpt.className = 'searchable-select-option-tts no-results';
                loadingOpt.textContent = placeholderText || '加载中...';
                optionsContainer.appendChild(loadingOpt);
            }

            filteredOptions.forEach(opt => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'searchable-select-option-tts';
                optionDiv.textContent = opt.text;
                optionDiv.dataset.value = opt.value;
                optionDiv.addEventListener('click', () => {
                    input.value = opt.text;
                    container.dataset.selectedValue = opt.value;
                    optionsContainer.style.display = 'none';
                    if (typeof onSelectionChange === 'function') {
                        onSelectionChange(opt.value);
                    }
                });
                optionsContainer.appendChild(optionDiv);
            });
            optionsContainer.style.display = (filteredOptions.length > 0 || (filterText && filteredOptions.length === 0) || (currentFullOptions.length === 0 && !filterText) ) ? 'block' : 'none';
        };

        container.updateOptions = (newOptions, newSelectedValue) => {
            currentFullOptions = [...newOptions];
            const selectedOpt = currentFullOptions.find(opt => opt.value === newSelectedValue);
            if (selectedOpt) {
                input.value = selectedOpt.text;
                container.dataset.selectedValue = selectedOpt.value;
            } else if (newOptions.length > 0 && !newSelectedValue) {
                if (!input.value && placeholderText) input.placeholder = placeholderText;
            } else if (newOptions.length === 0) {
                input.value = '';
                input.placeholder = placeholderText || '无可用选项';
                delete container.dataset.selectedValue;
            }
            populateOptions(input.value === (selectedOpt ? selectedOpt.text : '') ? '' : input.value);
        };

        const initialSelectedOption = optionsArray.find(opt => opt.value === selectedValue);
        if (initialSelectedOption) {
            input.value = initialSelectedOption.text;
            container.dataset.selectedValue = initialSelectedOption.value;
        } else if (selectedValue && placeholderText.startsWith('加载')) {
            input.value = selectedValue;
            container.dataset.selectedValue = selectedValue;
        }

        input.addEventListener('input', () => {
            populateOptions(input.value);
            const currentOptionByText = currentFullOptions.find(opt => opt.text === input.value);
            if (!currentOptionByText) {
                delete container.dataset.selectedValue;
            } else {
                container.dataset.selectedValue = currentOptionByText.value;
            }
        });

        input.addEventListener('focus', () => {
            populateOptions(input.value);
        });

        input.addEventListener('click', (event) => {
            event.stopPropagation();
            populateOptions(input.value);
        });

        if (!TtsUIManager._searchableSelectGlobalListenerAttached) {
            document.addEventListener('click', (e) => {
                document.querySelectorAll('.searchable-select-tts').forEach(sSelect => {
                    if (!sSelect.contains(e.target)) {
                        const optsContainer = sSelect.querySelector('.searchable-select-options-container-tts');
                        if (optsContainer) optsContainer.style.display = 'none';
                    }
                });
            });
            TtsUIManager._searchableSelectGlobalListenerAttached = true;
        }

        container.updateOptions(optionsArray, selectedValue);
        return container;
    },

    /**
     * @private
     * 填充下拉选择框的选项。
     * @param {HTMLSelectElement} selectElement - 要填充的 select 元素。
     * @param {Array<object>} optionsArray - 选项数组, e.g. [{value: 'val1', text: 'Text 1'}].
     * @param {string|null} selectedValue - 应预选的值。
     * @param {string} placeholderText - 当 optionsArray 为空或需要占位符时显示的文本。
     */
    _populateSelectWithOptions: function(selectElement, optionsArray, selectedValue, placeholderText) {
        selectElement.innerHTML = ''; // 清空旧选项
        if (!optionsArray || optionsArray.length === 0) { // 如果无选项
            if (placeholderText) { // 显示占位符
                const placeholderOption = document.createElement('option');
                placeholderOption.value = "";
                placeholderOption.textContent = placeholderText;
                placeholderOption.disabled = true; // 禁用占位符
                placeholderOption.selected = !selectedValue; // 如果没有预选值，则选中占位符
                selectElement.appendChild(placeholderOption);
            }
            return;
        }

        // 添加选项
        optionsArray.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (selectedValue && option.value === selectedValue) { // 如果是预选值
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
    },

    /**
     * @private
     * 处理动态模式下版本选择框的更改事件。
     * @param {string} selectedVersion - 新选中的版本。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器。
     * @param {string|undefined} [initialModel] - 尝试预选的模型。
     * @param {string|undefined} [initialLang] - 尝试预选的语言。
     * @param {string|undefined} [initialEmotion] - 尝试预选的情感。
     */
    _handleVersionChange: async function(selectedVersion, contactId, formContainer, initialModel, initialLang, initialEmotion) {
        const modelSearchableSelectContainer = formContainer.querySelector(`#ttsInput_${contactId}_model_name`);
        const langSelect = formContainer.querySelector(`#ttsInput_${contactId}_prompt_text_lang`);
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);

        // 重置模型、语言、情感下拉框为加载状态
        if (modelSearchableSelectContainer && typeof modelSearchableSelectContainer.updateOptions === 'function') {
            modelSearchableSelectContainer.updateOptions([], null);
            modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').placeholder = '加载模型...';
            modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').disabled = true;
        }
        [langSelect, emotionSelect].forEach(sel => {
            if (sel) {
                sel.innerHTML = ''; sel.disabled = true;
                let placeholder = '加载中...';
                if (sel === langSelect) placeholder = '选择模型后加载...';
                else if (sel === emotionSelect) placeholder = '选择语言后加载...';
                this._populateSelectWithOptions(sel, [], null, placeholder);
            }
        });

        if (selectedVersion && modelSearchableSelectContainer) { // 如果选择了版本且模型选择框存在
            try {
                const models = await this._fetchTtsModels(selectedVersion); // 获取模型列表
                if (typeof modelSearchableSelectContainer.updateOptions === 'function') {
                    // 更新模型选择框选项
                    modelSearchableSelectContainer.updateOptions(models.map(m => ({value: m, text: m})), initialModel);
                    modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').disabled = false; // 启用输入
                    modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').placeholder = '搜索/选择模型...';

                    // 如果有预选模型或已选模型，则触发模型更改处理
                    const currentSelectedModel = modelSearchableSelectContainer.dataset.selectedValue || (initialModel && models.includes(initialModel) ? initialModel : null);
                    if (currentSelectedModel) {
                        this._handleModelChange(currentSelectedModel, selectedVersion, contactId, formContainer, initialLang, initialEmotion);
                    } else if (models.length > 0) { // 如果无预选但有模型可选，则清空依赖的下拉框
                        if(langSelect) this._populateSelectWithOptions(langSelect, [], null, '选择模型后加载...');
                        if(emotionSelect) this._populateSelectWithOptions(emotionSelect, [], null, '选择语言后加载...');
                    }
                }
            } catch (err) { // 加载模型失败
                Utils.log(`加载TTS模型失败 (版本: ${selectedVersion}): ${err.message}`, Utils.logLevels.ERROR);
                if (modelSearchableSelectContainer && typeof modelSearchableSelectContainer.updateOptions === 'function') {
                    modelSearchableSelectContainer.updateOptions([], null);
                    modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').placeholder = '加载模型失败';
                }
            }
        }
    },

    /**
     * @private
     * 处理动态模式下模型选择框的更改事件。
     * @param {string} selectedModel - 新选中的模型名称。
     * @param {string} version - 当前选中的API版本。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器。
     * @param {string|undefined} [initialLang] - 尝试预选的语言。
     * @param {string|undefined} [initialEmotion] - 尝试预选的情感。
     */
    _handleModelChange: async function(selectedModel, version, contactId, formContainer, initialLang, initialEmotion) {
        const langSelect = formContainer.querySelector(`#ttsInput_${contactId}_prompt_text_lang`);
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);

        // 重置语言和情感下拉框为加载状态
        if (langSelect) { langSelect.innerHTML = ''; langSelect.disabled = true; this._populateSelectWithOptions(langSelect, [], null, '加载语言...'); }
        if (emotionSelect) { emotionSelect.innerHTML = ''; emotionSelect.disabled = true; this._populateSelectWithOptions(emotionSelect, [], null, '选择语言后加载...'); }

        // 如果选择了模型且缓存中存在该模型的数据
        if (selectedModel && this._dynamicDataCache[version] && this._dynamicDataCache[version][selectedModel]) {
            const modelData = this._dynamicDataCache[version][selectedModel]; // 获取模型数据（包含语言和情感）
            const languages = Object.keys(modelData); // 获取支持的语言

            if (langSelect) { // 更新语言选择框
                this._populateSelectWithOptions(langSelect, languages.map(lang => ({value: lang, text: lang})), initialLang, '选择语言');
                langSelect.disabled = false; // 启用

                // 如果有预选语言或已选语言，则触发语言更改处理
                const currentSelectedLang = langSelect.value || (initialLang && languages.includes(initialLang) ? initialLang : null);
                if (currentSelectedLang) {
                    this._handleLanguageChange(currentSelectedLang, selectedModel, version, contactId, formContainer, initialEmotion);
                } else if (languages.length > 0) { // 如果无预选但有语言可选
                    if(emotionSelect) this._populateSelectWithOptions(emotionSelect, [], null, '选择语言后加载...');
                }
            }
        } else if (selectedModel) { // 如果选择了模型但缓存中无数据（理论上不应发生）
            Utils.log(`在 _handleModelChange 中未找到模型 ${selectedModel} (版本 ${version}) 的缓存数据。`, Utils.logLevels.WARN);
        }
    },

    /**
     * @private
     * 处理动态模式下语言选择框的更改事件。
     * @param {string} selectedLanguage - 新选中的语言。
     * @param {string} selectedModel - 当前选中的模型名称。
     * @param {string} version - 当前选中的API版本。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器。
     * @param {string|undefined} [initialEmotion] - 尝试预选的情感。
     */
    _handleLanguageChange: function(selectedLanguage, selectedModel, version, contactId, formContainer, initialEmotion) {
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);
        // 重置情感下拉框为加载状态
        if (emotionSelect) { emotionSelect.innerHTML = ''; emotionSelect.disabled = true; this._populateSelectWithOptions(emotionSelect, [], null, '加载情感...'); }

        // 如果选择了模型和语言，且缓存中存在对应数据
        if (selectedModel && selectedLanguage &&
            this._dynamicDataCache[version] &&
            this._dynamicDataCache[version][selectedModel] &&
            this._dynamicDataCache[version][selectedModel][selectedLanguage]) {
            const emotions = this._dynamicDataCache[version][selectedModel][selectedLanguage]; // 获取情感列表

            if (emotionSelect) { // 更新情感选择框
                this._populateSelectWithOptions(emotionSelect, emotions.map(em => ({value: em, text: em})), initialEmotion, '选择情感');
                emotionSelect.disabled = false; // 启用
            }
        } else if (selectedModel && selectedLanguage && emotionSelect) { // 如果缓存中无数据
            Utils.log(`在 _handleLanguageChange 中未找到模型 ${selectedModel} / 语言 ${selectedLanguage} (版本 ${version}) 的缓存数据。`, Utils.logLevels.WARN);
        }
    },

    /**
     * @private
     * 从TTS API获取指定版本的模型列表。
     * @param {string} version - API版本。
     * @returns {Promise<Array<string>>} - 模型名称数组。
     * @throws {Error} 如果API请求失败或响应格式无效。
     */
    _fetchTtsModels: async function(version) {
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig(); // 获取生效的AI配置
        if (!effectiveConfig.ttsApiEndpoint) { // 检查TTS端点是否配置
            throw new Error('TTS API 端点未配置。');
        }
        // 构建获取模型的URL
        const modelsUrl = effectiveConfig.ttsApiEndpoint.endsWith('/') ?
            effectiveConfig.ttsApiEndpoint + 'models' :
            effectiveConfig.ttsApiEndpoint + '/models';
        Utils.log(`正在从 ${modelsUrl} (版本: ${version}) 获取 TTS 模型...`, Utils.logLevels.DEBUG);

        const response = await fetch(modelsUrl, { // 发送请求
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer guest' }, // API可能需要的头
            body: JSON.stringify({ version: version }) // 请求体包含版本
        });
        if (!response.ok) { // 检查响应状态
            const errorText = await response.text().catch(() => "无法读取错误响应");
            throw new Error(`获取 TTS 模型失败 (版本: ${version}): ${response.status} ${errorText.substring(0,100)}`);
        }
        const data = await response.json(); // 解析JSON响应
        // 校验响应格式
        if (!data || typeof data.models !== 'object') {
            throw new Error(`TTS 模型 API (版本: ${version}) 响应格式无效，期望 'models' 字段为对象。`);
        }

        if (!this._dynamicDataCache) this._dynamicDataCache = {}; // 初始化缓存（如果需要）
        this._dynamicDataCache[version] = data.models; // 缓存模型数据
        Utils.log(`成功获取并缓存了版本 ${version} 的 ${Object.keys(data.models).length} 个 TTS 模型。`, Utils.logLevels.DEBUG);
        return Object.keys(data.models); // 返回模型名称数组
    },

    /**
     * @private
     * 从缓存中获取指定版本和模型的说话人/语言/情感数据。
     * 此函数假设数据已由 _fetchTtsModels 缓存。
     * @param {string} version - API版本。
     * @param {string} modelName - 模型名称。
     * @returns {Promise<object>} - 模型数据对象。
     */
    _fetchTtsSpeakers: async function(version, modelName) {
        // 直接从缓存返回数据
        if (this._dynamicDataCache[version] && this._dynamicDataCache[version][modelName]) {
            Utils.log(`直接从缓存返回模型 ${modelName} (版本 ${version}) 的数据。`, Utils.logLevels.DEBUG);
            return this._dynamicDataCache[version][modelName];
        }
        // 理论上不应执行到这里，因为数据应已缓存
        Utils.log(`警告: _fetchTtsSpeakers 被调用，但模型 ${modelName} (版本 ${version}) 的数据应已在 _fetchTtsModels 中缓存。`, Utils.logLevels.WARN);
        return {}; // 返回空对象
    },

    /**
     * 处理保存 AI TTS 设置的逻辑。
     * @param {string} contactId - 要保存设置的联系人 ID。
     */
    handleSaveAiTtsSettings: async function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !contact.isAI || !contact.aiConfig) { // 检查联系人是否存在且为AI
            NotificationUIManager.showNotification("错误: 未找到联系人或非 AI 联系人。", "error");
            return;
        }

        if (!contact.aiConfig.tts) contact.aiConfig.tts = {}; // 确保TTS配置对象存在
        let changesMade = false; // 标记是否有更改
        const newTtsSettings = { ...contact.aiConfig.tts }; // 创建TTS设置的副本以进行修改

        // 遍历所有TTS配置字段
        this.TTS_CONFIG_FIELDS.forEach(field => {
            const inputElementOrContainer = document.getElementById(`ttsInput_${contactId}_${field.key}`);
            if (inputElementOrContainer) {
                let newValue;
                // 处理可搜索下拉框
                if (inputElementOrContainer.classList.contains('searchable-select-tts')) {
                    newValue = inputElementOrContainer.dataset.selectedValue || // 获取选中的实际值
                        (inputElementOrContainer.querySelector('.searchable-select-input-tts') ?
                            inputElementOrContainer.querySelector('.searchable-select-input-tts').value : // 回退到显示的文本
                            field.default); // 再回退到默认值
                    // 如果值是占位符文本，则使用旧值或默认值
                    if(newValue === `加载${field.label}...` || newValue === '选择模型' || newValue === '选择语言' || newValue === '选择情感') {
                        newValue = currentTtsSettings[field.key] !== undefined ? currentTtsSettings[field.key] : field.default;
                    }
                } else if (inputElementOrContainer.type === 'checkbox') { // 复选框
                    newValue = inputElementOrContainer.checked;
                } else if (inputElementOrContainer.type === 'number') { // 数字输入框
                    newValue = parseFloat(inputElementOrContainer.value);
                    if (isNaN(newValue)) newValue = field.default; // 无效则使用默认值
                } else { // 其他输入框 (text, select)
                    newValue = inputElementOrContainer.value;
                }

                if (newTtsSettings[field.key] !== newValue) { // 检查是否有更改
                    changesMade = true;
                }
                newTtsSettings[field.key] = newValue; // 更新设置值
            }
        });

        if (changesMade) { // 如果有更改
            contact.aiConfig.tts = newTtsSettings; // 更新联系人配置
            try {
                // 保存到localStorage和数据库
                localStorage.setItem(`ttsConfig_${contactId}`, JSON.stringify(newTtsSettings));
                await UserManager.saveContact(contactId);
                NotificationUIManager.showNotification("TTS 设置已成功保存。", "success");
            } catch (error) {
                Utils.log(`为 ${contactId} 保存 TTS 设置失败: ${error}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification("保存 TTS 设置失败。", "error");
            }
        } else { // 无更改
            NotificationUIManager.showNotification("未对 TTS 设置进行任何更改。", "info");
        }
    }
};