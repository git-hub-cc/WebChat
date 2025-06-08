// NEW FILE: TtsUIManager.js
// Responsibilities:
// - Populating and handling the TTS configuration form for AI contacts (within the Details Panel).
// - Saving TTS settings.
// (This module will be used by DetailsPanelUIManager)
const TtsUIManager = {
    TTS_CONFIG_FIELDS: [ // Moved from UIManager
        { key: 'enabled', label: 'Enable TTS', type: 'checkbox', default: false },
        { key: 'model_name', label: 'Model Name', type: 'text', default: 'GPT-SoVITS' },
        { key: 'speaker_name', label: 'Speaker Name', type: 'text', default: 'default_speaker' },
        { key: 'prompt_text_lang', label: 'Prompt Lang', type: 'select', default: '中文', options: ["中文", "英语", "日语"] },
        { key: 'emotion', label: 'Emotion', type: 'text', default: '开心_happy' },
        { key: 'text_lang', label: 'Text Lang', type: 'select', default: '中文', options: ["中文", "英语", "日语"] },
        { key: 'text_split_method', label: 'Split Method', type: 'select', default: '按标点符号切', options: ["四句一切", "凑50字一切", "按中文句号。切", "按英文句号.切", "按标点符号切"] },
        { key: 'seed', label: 'Seed', type: 'number', default: -1, step:1 },
        { key: 'media_type', label: 'Media Type', type: 'select', default: 'wav', options: ["wav", "mp3", "ogg"], isAdvanced: true },
        { key: 'fragment_interval', label: 'Fragment Int.', type: 'number', default: 0.3, step:0.01, min:0, isAdvanced: true },
        { key: 'speed_facter', label: 'Speed Factor', type: 'number', default: 1.0, step:0.1, min:0.1, max:3.0, isAdvanced: true },
        { key: 'parallel_infer', label: 'Parallel Infer', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'batch_threshold', label: 'Batch Threshold', type: 'number', default: 0.75, step:0.01, min:0, max:1, isAdvanced: true },
        { key: 'split_bucket', label: 'Split Bucket', type: 'checkbox', default: true, isAdvanced: true },
        { key: 'batch_size', label: 'Batch Size', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true },
        { key: 'top_k', label: 'Top K', type: 'number', default: 10, step:1, min:1, max:100, isAdvanced: true },
        { key: 'top_p', label: 'Top P', type: 'number', default: 0.01, step:0.01, min:0, max:1, isAdvanced: true },
        { key: 'temperature', label: 'Temperature', type: 'number', default: 1.0, step:0.01, min:0.01, max:1, isAdvanced: true },
        { key: 'repetition_penalty', label: 'Rep. Penalty', type: 'number', default: 1.35, step:0.01, min:0, max:2, isAdvanced: true },
    ],
    _boundSaveTtsListener: null, // Store listener to remove it later if needed

    populateAiTtsConfigurationForm: function(contact, formContainerId = 'ttsConfigFormContainer') {
        const formContainer = document.getElementById(formContainerId);
        if (!formContainer) {
            Utils.log(`TTS Form container '${formContainerId}' not found.`, Utils.logLevels.ERROR);
            return;
        }

        formContainer.innerHTML = ''; // Clear previous form content
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
            advancedHeader.className = 'collapsible-header tts-advanced-header'; // Ensure classes for styling
            advancedHeader.innerHTML = `<h5>Advanced</h5><span class="collapsible-icon">▶</span>`;

            const advancedFieldsContainer = document.createElement('div');
            advancedFieldsContainer.className = 'collapsible-content tts-advanced-fields-container';
            advancedFieldsContainer.style.display = 'none'; // Collapsed by default

            let advancedHeaderClickHandler = advancedHeader.getAttribute('data-click-handler-bound');
            if(advancedHeaderClickHandler !== 'true') {
                advancedHeader.addEventListener('click', function() { // `this` will be advancedHeader
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
            NotificationManager.showNotification("Error: Contact not found or not an AI contact.", "error");
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
                NotificationManager.showNotification("TTS settings saved successfully.", "success");
            } catch (error) {
                Utils.log(`Failed to save TTS settings for ${contactId}: ${error}`, Utils.logLevels.ERROR);
                NotificationManager.showNotification("Failed to save TTS settings.", "error");
            }
        } else {
            NotificationManager.showNotification("No changes to TTS settings were made.", "info");
        }
    }
};