/**
 * @file 文本转语音 (TTS) UI 管理器
 * @description 负责在 AI 联系人详情面板中，动态生成、填充和处理 TTS (Text-to-Speech) 配置表单。
 *              该模块将 TTS 相关的 UI 逻辑从 DetailsPanelUIManager 中解耦，并支持两种配置模式：
 *              1. 预设模式 (Preset): 用户手动输入所有 TTS 参数。
 *              2. 动态获取模式 (Dynamic): 动态从 TTS API 获取可用的模型、说话人(参考音频语言)和情感列表，
 *                 并以级联下拉框的形式呈现，提升了用户体验和配置的准确性。
 * @module TtsUIManager
 * @exports {object} TtsUIManager - 对外暴露的单例对象，包含管理 TTS 配置 UI 的方法。
 * @property {function} populateAiTtsConfigurationForm - 根据联系人配置动态生成 TTS 设置表单。
 * @property {function} handleSaveAiTtsSettings - 处理保存 TTS 设置的逻辑。
 * @dependency Utils, UserManager, NotificationUIManager, AppSettings, AiApiHandler, DetailsPanelUIManager
 */
const TtsUIManager = {
    // TTS 配置表单所有字段的中心化定义
    TTS_CONFIG_FIELDS: [
        { key: 'tts_mode', label: 'TTS 模式', type: 'select', default: 'Dynamic', options: [{value: 'Preset', text: '预设值'},{value: 'Dynamic', text: '动态获取'}], isAdvanced: false }, // TTS 配置模式选择
        { key: 'version', label: '版本', type: 'select', default: 'v4', options: [{value: 'v2', text: 'v2'}, {value: 'v3', text: 'v3'}, {value: 'v4', text: 'v4'}, {value: 'v2Pro', text: 'v2Pro'}, {value: 'v2ProPlus', text: 'v2ProPlus'}], isAdvanced: false }, // API 版本选择，用于动态模式
        { key: 'enabled', label: '启用 TTS', type: 'checkbox', default: false, isAdvanced: false }, // 是否启用 TTS 功能
        { key: 'model_name', label: '模型名称', type: 'text', default: 'GPT-SoVITS', isPotentiallyDynamic: true, isAdvanced: false }, // isPotentiallyDynamic: true 表示在动态模式下 UI 会改变
        { key: 'prompt_text_lang', label: '参考音频语言', type: 'select', default: '中文', options: ["中文", "英语", "日语"], isPotentiallyDynamic: true, isAdvanced: false }, // 在动态模式下，代表“说话人”
        { key: 'emotion', label: '情感', type: 'text', default: '开心_happy', isPotentiallyDynamic: true, isAdvanced: false }, // 情感或参考音频
        { key: 'text_lang', label: '文本语言', type: 'select', default: '中文', options: ["中文", "英语", "日语", "粤语", "韩语", "中英混合", "日英混合", "粤英混合", "韩英混合", "多语种混合", "多语种混合（粤语）"], isAdvanced: false }, // 要合成的文本的语言
        { key: 'text_split_method', label: '切分方法', type: 'select', default: '按标点符号切', options: ["四句一切", "凑50字一切", "按中文句号。切", "按英文句号.切", "按标点符号切"], isAdvanced: false }, // 长文本的切分策略
        { key: 'seed', label: '种子', type: 'number', default: -1, step:1, isAdvanced: false }, // 随机种子，-1表示随机
        // --- 高级选项 ---
        { key: 'media_type', label: '媒体类型', type: 'select', default: 'wav', options: ["wav", "mp3", "ogg"], isAdvanced: true }, // 音频格式
        { key: 'fragment_interval', label: '分段间隔(秒)', type: 'number', default: 0.3, step:0.01, min:0, isAdvanced: true }, // 流式传输时，音频片段间的间隔
        { key: 'speed_facter', label: '语速', type: 'number', default: 1.0, step:0.1, min:0.1, max:3.0, isAdvanced: true }, // 合成语速
        { key: 'parallel_infer', label: '并行推理', type: 'checkbox', default: true, isAdvanced: true }, // 是否启用并行推理
        { key: 'batch_threshold', label: '批处理阈值', type: 'number', default: 0.75, step:0.01, min:0, max:1, isAdvanced: true }, // 文本长度相似度阈值
        { key: 'split_bucket', label: '分桶', type: 'checkbox', default: true, isAdvanced: true }, // 是否启用分桶策略以提高效率
        { key: 'batch_size', label: '批处理大小', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true }, // 每批处理的文本数量
        { key: 'top_k', label: 'Top K', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true }, // Top-K 采样参数
        { key: 'top_p', label: 'Top P', type: 'number', default: 0.01, step:0.01, min:0, max:1, isAdvanced: true }, // Top-P (nucleus) 采样参数
        { key: 'temperature', label: '温度', type: 'number', default: 1.0, step:0.01, min:0.01, max:1, isAdvanced: true }, // 控制生成结果的随机性
        { key: 'repetition_penalty', label: '重复惩罚', type: 'number', default: 1.35, step:0.01, min:0, max:2, isAdvanced: true }, // 对重复词语的惩罚因子
    ],
    _boundSaveTtsListener: null, // 用于存储绑定了 this 的保存按钮事件监听器，以便正确移除
    _dynamicDataCache: {}, // 用于缓存从 API 动态获取的模型/说话人/情感数据，避免重复请求
    _searchableSelectGlobalListenerAttached: false, // 标记是否已为可搜索下拉框附加了全局点击监听器

    /**
     * 根据联系人的配置动态生成并填充 AI TTS 配置表单。
     * @function populateAiTtsConfigurationForm
     * @param {object} contact - AI 联系人对象。
     * @param {string} [formContainerId='ttsConfigFormContainer'] - 表单容器的 DOM ID。
     */
    populateAiTtsConfigurationForm: function(contact, formContainerId = 'ttsConfigFormContainer') {
        const formContainer = document.getElementById(formContainerId);
        if (!formContainer) {
            Utils.log(`未找到 TTS 表单容器 '${formContainerId}'。`, Utils.logLevels.ERROR);
            return;
        }

        // 流程：
        // 1. 清空旧表单并获取当前 TTS 设置
        formContainer.innerHTML = '';
        const ttsSettings = (contact.aiConfig && contact.aiConfig.tts) ? JSON.parse(JSON.stringify(contact.aiConfig.tts)) : {}; // 深拷贝以避免副作用
        const currentTtsMode = ttsSettings.tts_mode || 'Preset';
        const currentVersion = ttsSettings.version || 'v4';

        // 2. 创建基础和高级选项的容器
        const basicFieldsContainer = document.createElement('div');
        const advancedFieldsContainer = document.createElement('div');
        advancedFieldsContainer.className = 'collapsible-content tts-advanced-fields-container';

        // 3. 遍历字段定义，创建并分类表单元素
        this.TTS_CONFIG_FIELDS.forEach(field => {
            const parentEl = field.isAdvanced ? advancedFieldsContainer : basicFieldsContainer;
            this._createFieldElement(field, parentEl, ttsSettings, currentTtsMode, currentVersion, contact.id, formContainer);
        });

        formContainer.appendChild(basicFieldsContainer);

        // 4. 如果有高级选项，则创建可折叠的“高级选项”区域
        if (advancedFieldsContainer.childElementCount > 0) {
            const advancedSectionDiv = document.createElement('div');
            advancedSectionDiv.className = 'tts-config-section advanced-tts-section collapsible-container';

            const advancedHeader = document.createElement('div');
            advancedHeader.className = 'collapsible-header';
            advancedHeader.innerHTML = `高级选项 <span class="collapse-icon">▶</span>`;
            advancedHeader.style.cursor = 'pointer';

            advancedSectionDiv.appendChild(advancedHeader);
            advancedSectionDiv.appendChild(advancedFieldsContainer);
            formContainer.appendChild(advancedSectionDiv);

            // 借助 DetailsPanelUIManager 的辅助函数实现折叠功能
            if (typeof DetailsPanelUIManager !== 'undefined' && typeof DetailsPanelUIManager._makeElementCollapsible === 'function') {
                DetailsPanelUIManager._makeElementCollapsible(advancedHeader);
            } else {
                Utils.log("TtsUIManager: DetailsPanelUIManager 或其 _makeElementCollapsible 方法未找到。高级TTS选项可能无法折叠。", Utils.logLevels.WARN);
            }
        }

        // 5. 如果是动态模式，则触发级联加载的起始点
        if (currentTtsMode === 'Dynamic' && currentVersion) {
            this._handleVersionChange(currentVersion, contact.id, formContainer, ttsSettings.model_name, ttsSettings.prompt_text_lang, ttsSettings.emotion);
        }
    },

    /**
     * (内部) 创建单个表单字段的 DOM 元素。
     * @private
     * @function _createFieldElement
     * @param {object} fieldDef - 字段定义对象，来自 TTS_CONFIG_FIELDS。
     * @param {HTMLElement} parentEl - 该字段应附加到的父元素。
     * @param {object} currentTtsSettings - 当前联系人的 TTS 设置。
     * @param {string} currentTtsMode - 当前选中的 TTS 模式 ('Preset' 或 'Dynamic')。
     * @param {string} currentVersion - 当前选中的 API 版本。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器，用于在模式切换时重新渲染。
     */
    _createFieldElement: function(fieldDef, parentEl, currentTtsSettings, currentTtsMode, currentVersion, contactId, formContainer) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tts-config-item';
        const label = document.createElement('label');
        label.htmlFor = `ttsInput_${contactId}_${fieldDef.key}`;
        label.textContent = fieldDef.label + ':';
        itemDiv.appendChild(label);

        let input;
        const savedValue = currentTtsSettings[fieldDef.key] !== undefined ? currentTtsSettings[fieldDef.key] : fieldDef.default;

        // 根据字段定义和当前模式，决定创建何种类型的输入控件
        if (fieldDef.key === 'tts_mode') {
            // TTS 模式选择框，改变时会重绘整个表单
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options, currentTtsMode, '');
            input.addEventListener('change', (e) => {
                const contactToUpdate = UserManager.contacts[contactId];
                if (contactToUpdate && contactToUpdate.aiConfig && contactToUpdate.aiConfig.tts) {
                    contactToUpdate.aiConfig.tts.tts_mode = e.target.value;
                }
                this.populateAiTtsConfigurationForm(UserManager.contacts[contactId], formContainer.id);
            });
        } else if (fieldDef.key === 'version') {
            // API 版本选择框，改变时会触发动态数据的重新加载
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options, currentVersion, '');
            input.addEventListener('change', (e) => {
                const newVersion = e.target.value;
                const contactToUpdate = UserManager.contacts[contactId];
                if (contactToUpdate && contactToUpdate.aiConfig && contactToUpdate.aiConfig.tts) {
                    contactToUpdate.aiConfig.tts.version = newVersion;
                    // 版本改变后，清空依赖于它的动态字段的值
                    contactToUpdate.aiConfig.tts.model_name = undefined;
                    contactToUpdate.ai_config.tts.prompt_text_lang = undefined;
                    contactToUpdate.ai_config.tts.emotion = undefined;
                }
                if (currentTtsMode === 'Dynamic') {
                    this._handleVersionChange(newVersion, contactId, formContainer, undefined, undefined, undefined);
                }
            });
        } else if (fieldDef.key === 'model_name' && currentTtsMode === 'Dynamic') {
            // 动态模式下的模型名称，使用自定义的可搜索下拉框
            input = this._createSearchableSelect(
                `ttsInput_${contactId}_${fieldDef.key}`,
                [], // 选项将由 _handleVersionChange 动态填充
                savedValue,
                `加载${fieldDef.label}...`,
                (selectedValue) => { // 选中模型后的回调，触发下一级（语言）的加载
                    this._handleModelChange(selectedValue, currentVersion, contactId, formContainer, currentTtsSettings.prompt_text_lang, currentTtsSettings.emotion);
                }
            );
        } else if (fieldDef.isPotentiallyDynamic && currentTtsMode === 'Dynamic') {
            // 动态模式下的其他动态字段（如语言、情感），使用普通下拉框
            input = document.createElement('select');
            input.disabled = true; // 初始禁用，等待上级选择后填充并启用
            this._populateSelectWithOptions(input, [], savedValue, `加载${fieldDef.label}...`);

            if (fieldDef.key === 'prompt_text_lang') { // 语言选择框改变时，触发情感加载
                input.addEventListener('change', (e) => this._handleLanguageChange(e.target.value, currentTtsSettings.model_name, currentVersion, contactId, formContainer, currentTtsSettings.emotion));
            }
        } else if (fieldDef.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = savedValue;
        } else if (fieldDef.type === 'select' && !fieldDef.isPotentiallyDynamic) {
            // 预设模式下的普通下拉框
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options.map(opt => (typeof opt === 'string' ? {value: opt, text: opt} : opt)), savedValue, '');
        } else {
            // 其他标准输入框（文本、数字）
            input = document.createElement('input');
            input.type = fieldDef.type;
            input.value = savedValue;
            if (fieldDef.step !== undefined) input.step = fieldDef.step;
            if (fieldDef.min !== undefined) input.min = fieldDef.min;
            if (fieldDef.max !== undefined) input.max = fieldDef.max;
            if (fieldDef.type === 'text' && fieldDef.default !== undefined) input.placeholder = String(fieldDef.default);
        }

        // 为所有非自定义组件的输入元素设置 ID 和 data 属性
        if (!(fieldDef.key === 'model_name' && currentTtsMode === 'Dynamic')) {
            input.id = `ttsInput_${contactId}_${fieldDef.key}`;
            input.dataset.ttsParam = fieldDef.key;
        }
        itemDiv.appendChild(input);
        parentEl.appendChild(itemDiv);
    },

    /**
     * (内部) 创建一个自定义的可搜索下拉选择组件。
     * @private
     * @function _createSearchableSelect
     * @param {string} idBase - 该组件内元素的 ID 基础部分。
     * @param {Array<object>} optionsArray - 初始选项数组，格式为 {value, text}。
     * @param {string|null} selectedValue - 初始选中的值。
     * @param {string} placeholderText - 输入框的占位文本。
     * @param {function} onSelectionChange - 当选项被选中时调用的回调函数。
     * @returns {HTMLElement} 可搜索下拉选择组件的主容器 div。
     */
    _createSearchableSelect: function(idBase, optionsArray, selectedValue, placeholderText, onSelectionChange) {
        const container = document.createElement('div');
        container.className = 'searchable-select-tts';
        container.id = idBase;
        container.dataset.ttsParam = idBase.substring(idBase.lastIndexOf('_') + 1);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'searchable-select-input-tts';
        input.placeholder = placeholderText;
        input.autocomplete = 'off';

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'searchable-select-options-container-tts';
        optionsContainer.style.display = 'none';

        container.appendChild(input);
        container.appendChild(optionsContainer);

        let currentFullOptions = [...optionsArray];

        // 内部函数：根据过滤文本填充选项列表
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
                    input.value = opt.text; // 更新输入框的显示文本
                    container.dataset.selectedValue = opt.value; // 在容器上存储实际选中的值
                    optionsContainer.style.display = 'none';
                    if (typeof onSelectionChange === 'function') {
                        onSelectionChange(opt.value);
                    }
                });
                optionsContainer.appendChild(optionDiv);
            });
            optionsContainer.style.display = (filteredOptions.length > 0 || (filterText && filteredOptions.length === 0) || (currentFullOptions.length === 0 && !filterText) ) ? 'block' : 'none';
        };

        // 暴露一个方法，用于从外部更新选项列表
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

        // 初始化显示
        const initialSelectedOption = optionsArray.find(opt => opt.value === selectedValue);
        if (initialSelectedOption) {
            input.value = initialSelectedOption.text;
            container.dataset.selectedValue = initialSelectedOption.value;
        } else if (selectedValue && placeholderText.startsWith('加载')) {
            input.value = selectedValue; // 如果选项仍在加载，先显示已保存的值
            container.dataset.selectedValue = selectedValue;
        }

        // 事件绑定
        input.addEventListener('input', () => {
            populateOptions(input.value);
            const currentOptionByText = currentFullOptions.find(opt => opt.text === input.value);
            if (!currentOptionByText) { // 如果输入内容不匹配任何选项，清除选中值
                delete container.dataset.selectedValue;
            } else {
                container.dataset.selectedValue = currentOptionByText.value;
            }
        });
        input.addEventListener('focus', () => populateOptions(input.value));
        input.addEventListener('click', (event) => {
            event.stopPropagation();
            populateOptions(input.value);
        });

        // 全局点击监听器，用于关闭下拉列表（只附加一次）
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

        container.updateOptions(optionsArray, selectedValue); // 初始填充
        return container;
    },


    /**
     * (内部) 辅助函数，用于填充标准 <select> 元素的选项。
     * @private
     * @function _populateSelectWithOptions
     * @param {HTMLSelectElement} selectElement - 要填充的 select 元素。
     * @param {Array<object>} optionsArray - 选项数组, 格式: [{value: 'val1', text: 'Text 1'}]。
     * @param {string|null} selectedValue - 应被预选的值。
     * @param {string} placeholderText - 当选项为空时显示的占位文本。
     */
    _populateSelectWithOptions: function(selectElement, optionsArray, selectedValue, placeholderText) {
        selectElement.innerHTML = '';
        if (!optionsArray || optionsArray.length === 0) {
            if (placeholderText) {
                const placeholderOption = document.createElement('option');
                placeholderOption.value = "";
                placeholderOption.textContent = placeholderText;
                placeholderOption.disabled = true;
                placeholderOption.selected = !selectedValue;
                selectElement.appendChild(placeholderOption);
            }
            return;
        }

        optionsArray.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (selectedValue && option.value === selectedValue) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
    },

    /**
     * (内部) 处理动态模式下 API 版本选择的更改事件，是级联加载的起点。
     * @private
     * @function _handleVersionChange
     * @param {string} selectedVersion - 新选中的版本。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器。
     * @param {string|undefined} [initialModel] - 尝试预选的模型。
     * @param {string|undefined} [initialLang] - 尝试预选的语言。
     * @param {string|undefined} [initialEmotion] - 尝试预选的情感。
     */
    _handleVersionChange: async function(selectedVersion, contactId, formContainer, initialModel, initialLang, initialEmotion) {
        // 获取下游的 UI 元素
        const modelSearchableSelectContainer = formContainer.querySelector(`#ttsInput_${contactId}_model_name`);
        const langSelect = formContainer.querySelector(`#ttsInput_${contactId}_prompt_text_lang`);
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);

        // 1. 重置所有下游选择器为加载状态
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

        // 2. 获取并填充模型列表
        if (selectedVersion && modelSearchableSelectContainer) {
            try {
                const models = await this._fetchTtsModels(selectedVersion);
                if (typeof modelSearchableSelectContainer.updateOptions === 'function') {
                    // 更新模型选择框
                    modelSearchableSelectContainer.updateOptions(models.map(m => ({value: m, text: m})), initialModel);
                    modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').disabled = false;
                    modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').placeholder = '搜索/选择模型...';

                    // 3. 如果有预选模型，则触发下一级加载
                    const currentSelectedModel = modelSearchableSelectContainer.dataset.selectedValue || (initialModel && models.includes(initialModel) ? initialModel : null);
                    if (currentSelectedModel) {
                        this._handleModelChange(currentSelectedModel, selectedVersion, contactId, formContainer, initialLang, initialEmotion);
                    } else if (models.length > 0) {
                        if(langSelect) this._populateSelectWithOptions(langSelect, [], null, '选择模型后加载...');
                        if(emotionSelect) this._populateSelectWithOptions(emotionSelect, [], null, '选择语言后加载...');
                    }
                }
            } catch (err) {
                Utils.log(`加载TTS模型失败 (版本: ${selectedVersion}): ${err.message}`, Utils.logLevels.ERROR);
                if (modelSearchableSelectContainer && typeof modelSearchableSelectContainer.updateOptions === 'function') {
                    modelSearchableSelectContainer.updateOptions([], null);
                    modelSearchableSelectContainer.querySelector('.searchable-select-input-tts').placeholder = '加载模型失败';
                }
            }
        }
    },

    /**
     * (内部) 处理动态模式下模型选择的更改事件。
     * @private
     * @function _handleModelChange
     * @param {string} selectedModel - 新选中的模型名称。
     * @param {string} version - 当前选中的 API 版本。
     * @param {string} contactId - 联系人 ID。
     * @param {HTMLElement} formContainer - 表单容器。
     * @param {string|undefined} [initialLang] - 尝试预选的语言。
     * @param {string|undefined} [initialEmotion] - 尝试预选的情感。
     */
    _handleModelChange: async function(selectedModel, version, contactId, formContainer, initialLang, initialEmotion) {
        const langSelect = formContainer.querySelector(`#ttsInput_${contactId}_prompt_text_lang`);
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);

        // 1. 重置语言和情感选择器为加载状态
        if (langSelect) { langSelect.innerHTML = ''; langSelect.disabled = true; this._populateSelectWithOptions(langSelect, [], null, '加载语言...'); }
        if (emotionSelect) { emotionSelect.innerHTML = ''; emotionSelect.disabled = true; this._populateSelectWithOptions(emotionSelect, [], null, '选择语言后加载...'); }

        // 2. 从缓存中获取该模型支持的语言列表并填充
        if (selectedModel && this._dynamicDataCache[version] && this._dynamicDataCache[version][selectedModel]) {
            const modelData = this._dynamicDataCache[version][selectedModel];
            const languages = Object.keys(modelData);

            if (langSelect) {
                this._populateSelectWithOptions(langSelect, languages.map(lang => ({value: lang, text: lang})), initialLang, '选择语言');
                langSelect.disabled = false;

                // 3. 如果有预选语言，则触发下一级加载
                const currentSelectedLang = langSelect.value || (initialLang && languages.includes(initialLang) ? initialLang : null);
                if (currentSelectedLang) {
                    this._handleLanguageChange(currentSelectedLang, selectedModel, version, contactId, formContainer, initialEmotion);
                } else if (languages.length > 0) {
                    if(emotionSelect) this._populateSelectWithOptions(emotionSelect, [], null, '选择语言后加载...');
                }
            }
        } else if (selectedModel) {
            Utils.log(`在 _handleModelChange 中未找到模型 ${selectedModel} (版本 ${version}) 的缓存数据。`, Utils.logLevels.WARN);
        }
    },

    /**
     * (内部) 处理动态模式下语言选择的更改事件。
     * @private
     * @function _handleLanguageChange
     * @param {string} selectedLanguage - 新选中的语言。
     * @param {string} selectedModel - 当前选中的模型。
     * @param {string} version - 当前 API 版本。
     * @param {string} contactId - 联系人 ID。
     * @param {HTMLElement} formContainer - 表单容器。
     * @param {string|undefined} [initialEmotion] - 尝试预选的情感。
     */
    _handleLanguageChange: function(selectedLanguage, selectedModel, version, contactId, formContainer, initialEmotion) {
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);
        if (emotionSelect) { emotionSelect.innerHTML = ''; emotionSelect.disabled = true; this._populateSelectWithOptions(emotionSelect, [], null, '加载情感...'); }

        // 从缓存中获取该模型和语言下的情感列表并填充
        if (selectedModel && selectedLanguage &&
            this._dynamicDataCache[version] &&
            this._dynamicDataCache[version][selectedModel] &&
            this._dynamicDataCache[version][selectedModel][selectedLanguage]) {
            const emotions = this._dynamicDataCache[version][selectedModel][selectedLanguage];

            if (emotionSelect) {
                this._populateSelectWithOptions(emotionSelect, emotions.map(em => ({value: em, text: em})), initialEmotion, '选择情感');
                emotionSelect.disabled = false;
            }
        } else if (selectedModel && selectedLanguage && emotionSelect) {
            Utils.log(`在 _handleLanguageChange 中未找到模型 ${selectedModel} / 语言 ${selectedLanguage} (版本 ${version}) 的缓存数据。`, Utils.logLevels.WARN);
        }
    },

    /**
     * (内部) 从 TTS API 获取指定版本的模型列表，并缓存完整数据。
     * @private
     * @function _fetchTtsModels
     * @param {string} version - API 版本。
     * @returns {Promise<Array<string>>} 模型名称的数组。
     * @throws {Error} 如果 API 请求失败或响应格式无效。
     */
    _fetchTtsModels: async function(version) {
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig();
        if (!effectiveConfig.ttsApiEndpoint) {
            throw new Error('TTS API 端点未配置。');
        }
        const modelsUrl = effectiveConfig.ttsApiEndpoint.endsWith('/') ?
            effectiveConfig.ttsApiEndpoint + 'models' :
            effectiveConfig.ttsApiEndpoint + '/models';
        Utils.log(`正在从 ${modelsUrl} (版本: ${version}) 获取 TTS 模型...`, Utils.logLevels.DEBUG);

        const response = await fetch(modelsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer guest' },
            body: JSON.stringify({ version: version })
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "无法读取错误响应");
            throw new Error(`获取 TTS 模型失败 (版本: ${version}): ${response.status} ${errorText.substring(0,100)}`);
        }
        const data = await response.json();
        if (!data || typeof data.models !== 'object') {
            throw new Error(`TTS 模型 API (版本: ${version}) 响应格式无效，期望 'models' 字段为对象。`);
        }

        if (!this._dynamicDataCache) this._dynamicDataCache = {};
        this._dynamicDataCache[version] = data.models; // 缓存完整的模型-语言-情感数据结构
        Utils.log(`成功获取并缓存了版本 ${version} 的 ${Object.keys(data.models).length} 个 TTS 模型。`, Utils.logLevels.DEBUG);
        return Object.keys(data.models); // 只返回模型名称列表
    },

    /**
     * (内部) 从缓存中获取指定版本和模型的说话人/语言/情感数据。
     * @private
     * @function _fetchTtsSpeakers
     * @param {string} version - API 版本。
     * @param {string} modelName - 模型名称。
     * @returns {Promise<object>} 模型数据对象。
     */
    _fetchTtsSpeakers: async function(version, modelName) {
        // NOTE: 此函数当前设计为直接从缓存返回数据，因为 _fetchTtsModels 已经缓存了所有数据。
        if (this._dynamicDataCache[version] && this._dynamicDataCache[version][modelName]) {
            Utils.log(`直接从缓存返回模型 ${modelName} (版本 ${version}) 的数据。`, Utils.logLevels.DEBUG);
            return this._dynamicDataCache[version][modelName];
        }
        Utils.log(`警告: _fetchTtsSpeakers 被调用，但模型 ${modelName} (版本 ${version}) 的数据应已在 _fetchTtsModels 中缓存。`, Utils.logLevels.WARN);
        return {};
    },

    /**
     * 处理保存 AI TTS 设置的逻辑。
     * @function handleSaveAiTtsSettings
     * @param {string} contactId - 要保存设置的联系人 ID。
     */
    handleSaveAiTtsSettings: async function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !contact.isAI || !contact.aiConfig) {
            NotificationUIManager.showNotification("错误: 未找到联系人或非 AI 联系人。", "error");
            return;
        }

        // 流程：
        // 1. 从表单中读取所有字段的值
        if (!contact.aiConfig.tts) contact.aiConfig.tts = {};
        let changesMade = false;
        const newTtsSettings = { ...contact.aiConfig.tts }; // 创建副本以进行比较和修改

        this.TTS_CONFIG_FIELDS.forEach(field => {
            const inputElementOrContainer = document.getElementById(`ttsInput_${contactId}_${field.key}`);
            if (inputElementOrContainer) {
                let newValue;
                if (inputElementOrContainer.classList.contains('searchable-select-tts')) {
                    // 对于自定义可搜索下拉框，信任 data-selectedValue 存储的精确值
                    const selectedKey = inputElementOrContainer.dataset.selectedValue;
                    if (selectedKey !== undefined && selectedKey !== null && selectedKey !== '') {
                        newValue = selectedKey;
                    } else {
                        // 如果没有明确的选择，保留旧值，避免保存不完整的输入
                        newValue = newTtsSettings[field.key];
                        const inputText = inputElementOrContainer.querySelector('.searchable-select-input-tts')?.value;
                        if (inputText && inputText.trim() !== "" && inputText !== (UserManager.contacts[contactId]?.aiConfig?.tts?.[field.key] || '')) {
                            NotificationUIManager.showNotification(`未选择有效的“${field.label}”，该设置未更改。`, 'warning');
                        }
                    }
                } else if (inputElementOrContainer.type === 'checkbox') {
                    newValue = inputElementOrContainer.checked;
                } else if (inputElementOrContainer.type === 'number') {
                    newValue = parseFloat(inputElementOrContainer.value);
                    if (isNaN(newValue)) newValue = field.default;
                } else {
                    newValue = inputElementOrContainer.value;
                }

                if (newTtsSettings[field.key] !== newValue) {
                    changesMade = true;
                }
                newTtsSettings[field.key] = newValue;
            }
        });

        // 2. 如果有更改，则保存设置
        if (changesMade) {
            contact.aiConfig.tts = newTtsSettings;
            try {
                // 持久化到 localStorage 和 IndexedDB
                localStorage.setItem(`ttsConfig_${contactId}`, JSON.stringify(newTtsSettings));
                await UserManager.saveContact(contactId);
                NotificationUIManager.showNotification("TTS 设置已成功保存。", "success");
            } catch (error) {
                Utils.log(`为 ${contactId} 保存 TTS 设置失败: ${error}`, Utils.logLevels.ERROR);
                NotificationUIManager.showNotification("保存 TTS 设置失败。", "error");
            }
        } else {
            NotificationUIManager.showNotification("未对 TTS 设置进行任何更改。", "info");
        }
    }
};