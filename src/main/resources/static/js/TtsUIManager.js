/**
 * @file TtsUIManager.js
 * @description 文本转语音 (TTS) UI 管理器，负责填充和处理 AI 联系人详情面板中的 TTS 配置表单。
 *              它将 TTS 相关的 UI 逻辑从 DetailsPanelUIManager 中分离出来。
 *              新增支持动态获取 TTS 模型、说话人和情感的模式。
 *              修复了TTS模型/说话人端点不响应用户配置变更的问题。
 * @module TtsUIManager
 * @exports {object} TtsUIManager - 对外暴露的单例对象，包含管理 TTS 配置 UI 的方法。
 * @property {function} populateAiTtsConfigurationForm - 根据联系人配置动态生成 TTS 设置表单。
 * @property {function} handleSaveAiTtsSettings - 处理保存 TTS 设置的逻辑。
 * @dependencies Utils, UserManager, NotificationManager, Config, AiApiHandler
 * @dependents DetailsPanelUIManager (在更新详情面板时调用)
 */
const TtsUIManager = {
    // 定义 TTS 配置表单的所有字段及其属性
    TTS_CONFIG_FIELDS: [
        {
            key: 'tts_mode', label: 'TTS 模式', type: 'select', default: 'Preset',
            options: [{value: 'Preset', text: '预设值'}, {value: 'Dynamic', text: '动态获取'}],
            isAdvanced: false
        },
        { key: 'enabled', label: '启用 TTS', type: 'checkbox', default: false, isAdvanced: false },
        { key: 'model_name', label: '模型名称', type: 'text', default: 'GPT-SoVITS', isPotentiallyDynamic: true, isAdvanced: false },
        { key: 'speaker_name', label: '说话人', type: 'text', default: 'default_speaker', isPotentiallyDynamic: true, isAdvanced: false },
        { key: 'emotion', label: '情感', type: 'text', default: '开心_happy', isPotentiallyDynamic: true, isAdvanced: false },
        { key: 'prompt_text_lang', label: '参考音频语言', type: 'select', default: '中文', options: ["中文", "英语", "日语"], isAdvanced: false },
        { key: 'text_lang', label: '文本语言', type: 'select', default: '中文', options: ["中文", "英语", "日语", "粤语", "韩语", "中英混合", "日英混合", "粤英混合", "韩英混合", "多语种混合", "多语种混合（粤语）"], isAdvanced: false },
        { key: 'text_split_method', label: '切分方法', type: 'select', default: '按标点符号切', options: ["四句一切", "凑50字一切", "按中文句号。切", "按英文句号.切", "按标点符号切"], isAdvanced: false },
        { key: 'seed', label: '种子', type: 'number', default: -1, step:1, isAdvanced: false },
        { key: 'media_type', label: '媒体类型', type: 'select', default: 'wav', options: ["wav", "mp3", "ogg"], isAdvanced: true },
        { key: 'fragment_interval', label: '分段间隔', type: 'number', default: 0.3, step:0.01, min:0, isAdvanced: true },
        { key: 'speed_facter', label: '语速', type: 'number', default: 1.0, step:0.1, min:0.1, max:3.0, isAdvanced: true },
        { key: 'parallel_infer', label: '并行推理', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'batch_threshold', label: '批处理阈值', type: 'number', default: 0.75, step:0.01, min:0, max:1, isAdvanced: true },
        { key: 'split_bucket', label: '分桶', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'batch_size', label: '批处理大小', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true },
        { key: 'top_k', label: 'Top K', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true },
        { key: 'top_p', label: 'Top P', type: 'number', default: 0.01, step:0.01, min:0, max:1, isAdvanced: true },
        { key: 'temperature', label: '温度', type: 'number', default: 1.0, step:0.01, min:0.01, max:1, isAdvanced: true },
        { key: 'repetition_penalty', label: '重复惩罚', type: 'number', default: 1.35, step:0.01, min:0, max:2, isAdvanced: true },
    ],
    _boundSaveTtsListener: null,
    _dynamicDataCache: {}, // 用于缓存API获取的数据，例如: { modelName: { speakers: {...} } }

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

        formContainer.innerHTML = ''; // 清空之前的表单
        const ttsSettings = (contact.aiConfig && contact.aiConfig.tts) ? JSON.parse(JSON.stringify(contact.aiConfig.tts)) : {};
        const currentTtsMode = ttsSettings.tts_mode || 'Preset';

        const basicFieldsContainer = document.createElement('div');
        const advancedFieldsContainer = document.createElement('div');
        advancedFieldsContainer.className = 'collapsible-content tts-advanced-fields-container';
        advancedFieldsContainer.style.display = 'none'; // 默认折叠

        this.TTS_CONFIG_FIELDS.forEach(field => {
            const parentEl = field.isAdvanced ? advancedFieldsContainer : basicFieldsContainer;
            this._createFieldElement(field, parentEl, ttsSettings, currentTtsMode, contact.id, formContainer);
        });

        formContainer.appendChild(basicFieldsContainer);

        if (advancedFieldsContainer.childElementCount > 0) {
            const advancedSectionDiv = document.createElement('div');
            advancedSectionDiv.className = 'tts-config-section advanced-tts-section';

            const advancedHeader = document.createElement('div');
            advancedHeader.className = 'collapsible-header tts-advanced-header';
            advancedHeader.innerHTML = `<h5>高级选项</h5><span class="collapse-icon">▶</span>`;
            advancedHeader.style.cursor = 'pointer';

            advancedHeader.onclick = function() { // 使用 onclick 以简化，避免重复绑定问题
                this.classList.toggle('active');
                const icon = this.querySelector('.collapse-icon');
                if (advancedFieldsContainer.style.display === "block" || advancedFieldsContainer.style.display === "") {
                    advancedFieldsContainer.style.display = "none";
                    if(icon) icon.textContent = '▶';
                } else {
                    advancedFieldsContainer.style.display = "block";
                    if(icon) icon.textContent = '▼';
                }
            };
            advancedSectionDiv.appendChild(advancedHeader);
            advancedSectionDiv.appendChild(advancedFieldsContainer);
            formContainer.appendChild(advancedSectionDiv);
        }
    },

    /**
     * @private
     * 创建单个表单字段的 DOM 元素。
     * @param {object} fieldDef - 字段定义对象。
     * @param {HTMLElement} parentEl - 该字段应附加到的父元素。
     * @param {object} currentTtsSettings - 当前联系人的 TTS 设置。
     * @param {string} currentTtsMode - 当前选中的 TTS 模式 ('Preset' 或 'Dynamic')。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器，用于重新渲染。
     */
    _createFieldElement: function(fieldDef, parentEl, currentTtsSettings, currentTtsMode, contactId, formContainer) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tts-config-item';

        const label = document.createElement('label');
        label.htmlFor = `ttsInput_${contactId}_${fieldDef.key}`;
        label.textContent = fieldDef.label + ':';
        itemDiv.appendChild(label);

        let input;
        const savedValue = currentTtsSettings[fieldDef.key] !== undefined ? currentTtsSettings[fieldDef.key] : fieldDef.default;

        if (fieldDef.key === 'tts_mode') {
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options, currentTtsMode, '');
            input.onchange = (e) => {
                // 模式改变时，更新内存中的contact.aiConfig.tts.tts_mode并重新渲染整个表单
                const contactToUpdate = UserManager.contacts[contactId];
                if (contactToUpdate && contactToUpdate.aiConfig && contactToUpdate.aiConfig.tts) {
                    contactToUpdate.aiConfig.tts.tts_mode = e.target.value;
                    // 不需要立即保存到localStorage或DB，保存按钮会处理
                }
                this.populateAiTtsConfigurationForm(UserManager.contacts[contactId], formContainer.id);
            };
        } else if (fieldDef.isPotentiallyDynamic && currentTtsMode === 'Dynamic') {
            input = document.createElement('select');
            input.disabled = true; // 初始禁用，等待数据
            this._populateSelectWithOptions(input, [], savedValue, `加载${fieldDef.label}...`);

            if (fieldDef.key === 'model_name') {
                this._fetchTtsModels().then(models => {
                    this._populateSelectWithOptions(input, models.map(m => ({value: m, text: m})), savedValue, `选择${fieldDef.label}`);
                    input.disabled = false;
                    if (input.value) { // 如果有选中值（来自保存的设置或默认选择第一个）
                        this._handleModelChange(input.value, contactId, formContainer);
                    }
                }).catch(err => {
                    Utils.log(`加载TTS模型失败: ${err.message}`, Utils.logLevels.ERROR);
                    this._populateSelectWithOptions(input, [], null, `加载模型失败`);
                });
                input.onchange = (e) => this._handleModelChange(e.target.value, contactId, formContainer);
            } else if (fieldDef.key === 'speaker_name') {
                // 依赖 model_name 的 onchange 来填充
                input.onchange = (e) => this._handleSpeakerChange(e.target.value, contactId, formContainer);
            } else if (fieldDef.key === 'emotion') {
                // 依赖 speaker_name 的 onchange 来填充
            }
        } else if (fieldDef.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = savedValue;
        } else if (fieldDef.type === 'select' && !fieldDef.isPotentiallyDynamic) { // 普通下拉框
            input = document.createElement('select');
            this._populateSelectWithOptions(input, fieldDef.options.map(opt => (typeof opt === 'string' ? {value: opt, text: opt} : opt)), savedValue, '');
        } else { // text, number (Preset mode or non-dynamic fields)
            input = document.createElement('input');
            input.type = fieldDef.type;
            input.value = savedValue;
            if (fieldDef.step !== undefined) input.step = fieldDef.step;
            if (fieldDef.min !== undefined) input.min = fieldDef.min;
            if (fieldDef.max !== undefined) input.max = fieldDef.max;
            if (fieldDef.type === 'text' && fieldDef.default !== undefined) input.placeholder = String(fieldDef.default);
        }

        input.id = `ttsInput_${contactId}_${fieldDef.key}`;
        input.dataset.ttsParam = fieldDef.key; // 用于保存时识别
        itemDiv.appendChild(input);
        parentEl.appendChild(itemDiv);
    },

    /**
     * @private
     * 填充下拉选择框的选项。
     * @param {HTMLSelectElement} selectElement - 要填充的 select 元素。
     * @param {Array<string|object>} optionsArray - 选项数组。可以是字符串数组，或 {value: string, text: string} 对象数组。
     * @param {string|null} selectedValue - 应预选的值。
     * @param {string} placeholderText - 当 optionsArray 为空或需要占位符时显示的文本。
     */
    _populateSelectWithOptions: function(selectElement, optionsArray, selectedValue, placeholderText) {
        selectElement.innerHTML = ''; // 清空现有选项
        if (!optionsArray || optionsArray.length === 0) {
            if (placeholderText) {
                const placeholderOption = document.createElement('option');
                placeholderOption.value = "";
                placeholderOption.textContent = placeholderText;
                placeholderOption.disabled = true;
                selectElement.appendChild(placeholderOption);
            }
            return;
        }

        optionsArray.forEach(opt => {
            const option = document.createElement('option');
            if (typeof opt === 'string') {
                option.value = opt;
                option.textContent = opt;
            } else { // {value: ..., text: ...}
                option.value = opt.value;
                option.textContent = opt.text;
            }
            if (selectedValue && option.value === selectedValue) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
        // 如果没有值被选中，并且有选项，尝试选中第一个，除非它是占位符
        if (!selectElement.value && selectElement.options.length > 0 && !selectElement.options[0].disabled) {
            if (optionsArray.some(opt => (typeof opt === 'string' ? opt : opt.value) === selectedValue)) {
                // selectedValue is in options, it should be selected
            } else if (selectElement.options[0]) {
                // selectElement.options[0].selected = true; // 自动选择第一个，如果需要
            }
        }
    },

    /**
     * @private
     * 处理动态模式下模型名称选择框的更改事件。
     * @param {string} selectedModel - 新选中的模型名称。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器。
     */
    _handleModelChange: async function(selectedModel, contactId, formContainer) {
        const speakerSelect = formContainer.querySelector(`#ttsInput_${contactId}_speaker_name`);
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);

        if (speakerSelect) {
            speakerSelect.innerHTML = '';
            speakerSelect.disabled = true;
            this._populateSelectWithOptions(speakerSelect, [], null, '加载说话人...');
        }
        if (emotionSelect) {
            emotionSelect.innerHTML = '';
            emotionSelect.disabled = true;
            this._populateSelectWithOptions(emotionSelect, [], null, '选择情感...');
        }

        if (selectedModel) {
            try {
                const speakersData = await this._fetchTtsSpeakers(selectedModel);
                this._dynamicDataCache[selectedModel] = speakersData; // 缓存数据
                const speakerNames = speakersData && speakersData.speakers ? Object.keys(speakersData.speakers) : [];
                if (speakerSelect) {
                    const contact = UserManager.contacts[contactId];
                    const savedSpeaker = contact?.aiConfig?.tts?.speaker_name;
                    this._populateSelectWithOptions(speakerSelect, speakerNames.map(s => ({value: s, text: s})), savedSpeaker, '选择说话人');
                    speakerSelect.disabled = false;
                    if (speakerSelect.value) { // 如果有选中值
                        this._handleSpeakerChange(speakerSelect.value, contactId, formContainer);
                    }
                }
            } catch (err) {
                Utils.log(`加载说话人列表失败 (模型: ${selectedModel}): ${err.message}`, Utils.logLevels.ERROR);
                if (speakerSelect) this._populateSelectWithOptions(speakerSelect, [], null, '加载说话人失败');
            }
        }
    },

    /**
     * @private
     * 处理动态模式下说话人选择框的更改事件。
     * @param {string} selectedSpeaker - 新选中的说话人名称。
     * @param {string} contactId - 当前联系人的 ID。
     * @param {HTMLElement} formContainer - 整个表单的容器。
     */
    _handleSpeakerChange: function(selectedSpeaker, contactId, formContainer) {
        const modelSelect = formContainer.querySelector(`#ttsInput_${contactId}_model_name`);
        const emotionSelect = formContainer.querySelector(`#ttsInput_${contactId}_emotion`);
        const selectedModel = modelSelect ? modelSelect.value : null;

        if (emotionSelect) {
            emotionSelect.innerHTML = '';
            emotionSelect.disabled = true;
            this._populateSelectWithOptions(emotionSelect, [], null, '选择情感...');
        }

        if (selectedModel && selectedSpeaker && this._dynamicDataCache[selectedModel] && this._dynamicDataCache[selectedModel].speakers && this._dynamicDataCache[selectedModel].speakers[selectedSpeaker]) {
            const contact = UserManager.contacts[contactId];
            const savedEmotion = contact?.aiConfig?.tts?.emotion;
            // 假设情感数据在 speakers[selectedSpeaker].中文 (或其他语言)
            // TODO: 使语言键可配置或从其他设置派生
            const langKeyForEmotions = contact?.aiConfig?.tts?.prompt_text_lang || '中文';
            const emotions = this._dynamicDataCache[selectedModel].speakers[selectedSpeaker][langKeyForEmotions] || [];
            if (emotionSelect) {
                this._populateSelectWithOptions(emotionSelect, emotions.map(em => ({value: em, text: em})), savedEmotion, '选择情感');
                emotionSelect.disabled = false;
            }
        } else if (selectedModel && selectedSpeaker && emotionSelect) { // 如果缓存未命中，可能是初始填充
            Utils.log(`缓存未命中或数据不完整 (模型: ${selectedModel}, 说话人: ${selectedSpeaker})。情感列表可能不准确。`, Utils.logLevels.WARN);
        }
    },

    /**
     * @private
     * 向指定的 API 端点发送 GET 请求。
     * @returns {Promise<any>} API 响应的 JSON 数据。
     * @throws {Error} 如果 API 请求失败或响应无效。
     */
    _fetchTtsModels: async function() {
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig();
        if (!effectiveConfig.ttsApiEndpoint) {
            throw new Error('TTS API 端点未配置。');
        }
        const modelsUrl = effectiveConfig.ttsApiEndpoint + '/models';
        Utils.log(`正在从 ${modelsUrl} 获取 TTS 模型...`, Utils.logLevels.DEBUG);

        const response = await fetch(modelsUrl);
        if (!response.ok) {
            const errorText = await response.text().catch(() => "无法读取错误响应");
            throw new Error(`获取 TTS 模型失败: ${response.status} ${errorText.substring(0,100)}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            throw new Error('TTS 模型 API 响应格式无效，期望得到数组。');
        }
        Utils.log(`成功获取 ${data.length} 个 TTS 模型。`, Utils.logLevels.DEBUG);
        return data;
    },

    /**
     * @private
     * 向指定的 API 端点发送 POST 请求以获取指定模型的说话人。
     * @param {string} modelName - 要获取说话人的模型名称。
     * @returns {Promise<any>} API 响应的 JSON 数据。
     * @throws {Error} 如果 API 请求失败或响应无效。
     */
    _fetchTtsSpeakers: async function(modelName) {
        const effectiveConfig = AiApiHandler._getEffectiveAiConfig();
        if (!effectiveConfig.ttsApiEndpoint) {
            throw new Error('TTS API 端点未配置。');
        }
        const speakersUrl = effectiveConfig.ttsApiEndpoint + '/spks';
        Utils.log(`正在为模型 "${modelName}" 从 ${speakersUrl} 获取 TTS 说话人...`, Utils.logLevels.DEBUG);

        const response = await fetch(speakersUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName })
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "无法读取错误响应");
            throw new Error(`获取模型 "${modelName}" 的 TTS 说话人失败: ${response.status} ${errorText.substring(0,100)}`);
        }
        const data = await response.json();
        // 简单验证数据结构
        if (typeof data !== 'object' || data === null || typeof data.speakers !== 'object') {
            throw new Error(`模型 "${modelName}" 的 TTS 说话人 API 响应格式无效。`);
        }
        Utils.log(`成功获取模型 "${modelName}" 的 TTS 说话人数据。`, Utils.logLevels.DEBUG);
        return data;
    },


    /**
     * 处理保存 AI TTS 设置的逻辑。从表单中读取值，更新联系人对象，并保存到 localStorage 和数据库。
     * @param {string} contactId - 要保存设置的联系人 ID。
     * @returns {Promise<void>}
     */
    handleSaveAiTtsSettings: async function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !contact.isAI || !contact.aiConfig) {
            NotificationManager.showNotification("错误: 未找到联系人或非 AI 联系人。", "error");
            return;
        }

        if (!contact.aiConfig.tts) contact.aiConfig.tts = {};
        let changesMade = false;
        const newTtsSettings = {}; // 用于存储到 localStorage 的对象

        // 首先获取当前选中的 tts_mode
        const ttsModeSelect = document.getElementById(`ttsInput_${contactId}_tts_mode`);
        const currentSelectedTtsMode = ttsModeSelect ? ttsModeSelect.value : (contact.aiConfig.tts.tts_mode || 'Preset');
        newTtsSettings.tts_mode = currentSelectedTtsMode;
        if (contact.aiConfig.tts.tts_mode !== currentSelectedTtsMode) changesMade = true;


        this.TTS_CONFIG_FIELDS.forEach(field => {
            if (field.key === 'tts_mode') return; // tts_mode 已处理

            const inputElement = document.getElementById(`ttsInput_${contactId}_${field.key}`);
            if (inputElement) {
                let newValue;
                // 确定是读取 select 还是 input
                const isDynamicFieldInDynamicMode = field.isPotentiallyDynamic && currentSelectedTtsMode === 'Dynamic';

                if (inputElement.tagName === 'SELECT' || (field.type === 'select' && !isDynamicFieldInDynamicMode) ) {
                    newValue = inputElement.value;
                } else if (field.type === 'checkbox') {
                    newValue = inputElement.checked;
                } else if (field.type === 'number') {
                    newValue = parseFloat(inputElement.value);
                    if (isNaN(newValue)) newValue = field.default;
                } else { // text input
                    newValue = inputElement.value;
                }

                if (contact.aiConfig.tts[field.key] !== newValue) changesMade = true;
                contact.aiConfig.tts[field.key] = newValue; // 更新内存中的对象
                newTtsSettings[field.key] = newValue;
            }
        });

        if (changesMade) {
            try {
                // 将新设置保存到 localStorage
                localStorage.setItem(`ttsConfig_${contactId}`, JSON.stringify(newTtsSettings));
                // 同时保存更新后的整个联系人对象到数据库 (UserManager 会处理内存中的 this.contacts[contactId])
                await UserManager.saveContact(contactId); // UserManager.saveContact 会保存 this.contacts[contactId]
                NotificationManager.showNotification("TTS 设置已成功保存。", "success");
            } catch (error) {
                Utils.log(`为 ${contactId} 保存 TTS 设置失败: ${error}`, Utils.logLevels.ERROR);
                NotificationManager.showNotification("保存 TTS 设置失败。", "error");
            }
        } else {
            NotificationManager.showNotification("未对 TTS 设置进行任何更改。", "info");
        }
    }
};