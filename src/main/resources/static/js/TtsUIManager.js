// 新文件: TtsUIManager.js (已翻译)
// 职责:
// - 填充和处理 AI 联系人的 TTS 配置表单（在详情面板内）。
// - 保存 TTS 设置。
// (此模块将由 DetailsPanelUIManager 使用)
const TtsUIManager = {
    TTS_CONFIG_FIELDS: [ // 从 UIManager 移来
        { key: 'enabled', label: '启用 TTS', type: 'checkbox', default: false },
        { key: 'model_name', label: '模型名称', type: 'text', default: 'GPT-SoVITS' },
        { key: 'speaker_name', label: '说话人', type: 'text', default: 'default_speaker' },
        { key: 'prompt_text_lang', label: '参考音频语言', type: 'select', default: '中文', options: ["中文", "英语", "日语"] },
        { key: 'emotion', label: '情感', type: 'text', default: '开心_happy' },
        { key: 'text_lang', label: '文本语言', type: 'select', default: '中文', options: ["中文", "英语", "日语"] },
        { key: 'text_split_method', label: '切分方法', type: 'select', default: '按标点符号切', options: ["四句一切", "凑50字一切", "按中文句号。切", "按英文句号.切", "按标点符号切"] },
        { key: 'seed', label: '种子', type: 'number', default: -1, step:1 },
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
    _boundSaveTtsListener: null, // 存储监听器以便稍后需要时移除

    populateAiTtsConfigurationForm: function(contact, formContainerId = 'ttsConfigFormContainer') {
        const formContainer = document.getElementById(formContainerId);
        if (!formContainer) {
            Utils.log(`未找到 TTS 表单容器 '${formContainerId}'。`, Utils.logLevels.ERROR);
            return;
        }

        formContainer.innerHTML = ''; // 清除之前的表单内容
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
            input.dataset.ttsParam = field.key;
            itemDiv.appendChild(input);
            parentEl.appendChild(itemDiv);
        };

        const basicFields = this.TTS_CONFIG_FIELDS.filter(field => !field.isAdvanced);
        const advancedFields = this.TTS_CONFIG_FIELDS.filter(field => field.isAdvanced);

        basicFields.forEach(field => createFieldElement(field, formContainer));

        if (advancedFields.length > 0) {
            const advancedSectionDiv = document.createElement('div');
            advancedSectionDiv.className = 'tts-config-section advanced-tts-section';

            const advancedHeader = document.createElement('div');
            advancedHeader.className = 'collapsible-header tts-advanced-header'; // 确保用于样式的类名
            advancedHeader.innerHTML = `<h5>高级选项</h5><span class="collapsible-icon">▶</span>`;

            const advancedFieldsContainer = document.createElement('div');
            advancedFieldsContainer.className = 'collapsible-content tts-advanced-fields-container';
            advancedFieldsContainer.style.display = 'none'; // 默认折叠

            let advancedHeaderClickHandler = advancedHeader.getAttribute('data-click-handler-bound');
            if(advancedHeaderClickHandler !== 'true') {
                advancedHeader.addEventListener('click', function() { // 此处的 `this` 将是 advancedHeader
                    this.classList.toggle('active');
                    const icon = this.querySelector('.collapsible-icon');
                    if (advancedFieldsContainer.style.display === "block") {
                        advancedFieldsContainer.style.display = "none";
                        if(icon) icon.textContent = '▶';
                    } else {
                        advancedFieldsContainer.style.display = "block";
                        if(icon) icon.textContent = '▼';
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

    handleSaveAiTtsSettings: async function(contactId) {
        const contact = UserManager.contacts[contactId];
        if (!contact || !contact.isAI || !contact.aiConfig) {
            NotificationManager.showNotification("错误: 未找到联系人或非 AI 联系人。", "error");
            return;
        }

        if (!contact.aiConfig.tts) contact.aiConfig.tts = {};
        let changesMade = false;
        const newTtsSettings = {};

        this.TTS_CONFIG_FIELDS.forEach(field => {
            const inputElement = document.getElementById(`ttsInput_${field.key}`);
            if (inputElement) {
                let newValue;
                if (field.type === 'checkbox') newValue = inputElement.checked;
                else if (field.type === 'number') {
                    newValue = parseFloat(inputElement.value);
                    if (isNaN(newValue)) newValue = field.default;
                } else newValue = inputElement.value;

                if (contact.aiConfig.tts[field.key] !== newValue) changesMade = true;
                contact.aiConfig.tts[field.key] = newValue;
                newTtsSettings[field.key] = newValue;
            }
        });

        if (changesMade) {
            try {
                localStorage.setItem(`ttsConfig_${contactId}`, JSON.stringify(newTtsSettings));
                await UserManager.saveContact(contactId);
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