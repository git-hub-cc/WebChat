import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { log } from '@/utils';
import { THEME_LIST } from '@/config/ThemeList';
import { LLMProviders } from '@/config/LLMProviders';
import AppSettings from '@/config/AppSettings';

export const useSettingsStore = defineStore('settings', () => {
    // --- STATE ---
    const themes = ref(THEME_LIST);
    const colorScheme = ref(localStorage.getItem('colorScheme') || 'auto');
    const currentThemeKey = ref(localStorage.getItem('currentThemeKey') || '原神-浅色');
    const apiSettings = ref({});
    const customBackgrounds = ref({ light: null, dark: null });
    const isThemeTransitioning = ref(false);
    // --- MODIFICATION START: Removed sttMode and callMode state ---
    const isAiNoiseSuppressionEnabled = ref(JSON.parse(localStorage.getItem('isAiNoiseSuppressionEnabled') || 'false'));
    // --- MODIFICATION END ---

    // --- GETTERS ---
    const effectiveColorScheme = computed(() => {
        if (colorScheme.value === 'light' || colorScheme.value === 'dark') {
            return colorScheme.value;
        }
        if (typeof window.matchMedia !== 'function') return 'light';
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });

    const currentTheme = computed(() => themes.value[currentThemeKey.value]);
    const currentSpecialContacts = computed(() => currentTheme.value?.specialContacts || []);

    // --- ACTIONS ---

    /**
     * @private
     * Reliably loads the data file for a given theme key and updates the store.
     * This is the single source of truth for loading theme data.
     * @param {string} themeKey - The key of the theme to load data for.
     */
    async function _loadThemeData(themeKey) {
        const themeConfig = themes.value[themeKey];
        if (themeConfig && themeConfig.dataJs && !themeConfig.specialContacts) {
            try {
                log(`Fetching theme data for ${themeKey} from ${themeConfig.dataJs}`, 'DEBUG');
                const response = await fetch(`${themeConfig.dataJs}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                themes.value[themeKey] = { ...themeConfig, specialContacts: data };
                log(`Successfully loaded and set special contacts for ${themeKey}. Count: ${data.length}`, 'INFO');
            } catch(e) {
                log(`Failed to load theme data for ${themeKey}: ${e.message}`, 'ERROR');
                if (themes.value[themeKey]) {
                    themes.value[themeKey].specialContacts = [];
                }
            }
        } else if (themeConfig && !themeConfig.dataJs) {
            log(`Theme ${themeKey} has no dataJs file specified.`, 'DEBUG');
            if (themes.value[themeKey]) {
                themes.value[themeKey].specialContacts = [];
            }
        }
    }

    /**
     * Initializes the settings store.
     */
    async function init() {
        const storedApiSettings = await dbService.getItem('settings', 'apiSettings');
        const defaultProviderKey = storedApiSettings?.llmProvider || 'webchat';
        const defaultProvider = LLMProviders[defaultProviderKey] || LLMProviders.webchat;

        apiSettings.value = {
            llmProvider: defaultProviderKey,
            apiEndpoint: storedApiSettings?.apiEndpoint || defaultProvider.defaultEndpoint,
            model: storedApiSettings?.model || defaultProvider.defaultModel,
            apiKey: storedApiSettings?.apiKey || AppSettings.server.api_key,
            maxTokens: storedApiSettings?.maxTokens || AppSettings.server.max_tokens,
            ttsApiEndpoint: storedApiSettings?.ttsApiEndpoint || AppSettings.server.ttsApiEndpoint,
        };

        try {
            const [bgLight, bgDark] = await Promise.all([
                dbService.getItem('appStateCache', 'background_image_light'),
                dbService.getItem('appStateCache', 'background_image_dark')
            ]);
            if (bgLight?.imageBlob) customBackgrounds.value.light = URL.createObjectURL(bgLight.imageBlob);
            if (bgDark?.imageBlob) customBackgrounds.value.dark = URL.createObjectURL(bgDark.imageBlob);
        } catch(e) {
            log(`加载自定义背景时出错: ${e.message}`, 'ERROR');
        }

        await _syncThemeWithColorScheme(true);

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
            if (colorScheme.value === 'auto') {
                await _syncThemeWithColorScheme(true);
            }
        });

        log('设置Store已初始化', 'INFO');
    }

    /**
     * @private
     * Syncs the current theme with the effective color scheme.
     * @param {boolean} forceLoadData - If true, ensures data for the theme is loaded.
     */
    async function _syncThemeWithColorScheme(forceLoadData = false) {
        const themeMode = currentThemeKey.value.includes('-深色') ? 'dark' : 'light';
        if (themeMode !== effectiveColorScheme.value) {
            const baseName = currentThemeKey.value.replace(/-浅色|-深色/, '');
            const newSuffix = effectiveColorScheme.value === 'dark' ? '-深色' : '-浅色';
            const newThemeKey = baseName + newSuffix;
            if (themes.value[newThemeKey]) {
                await applyTheme(newThemeKey);
            }
        } else if (forceLoadData) {
            await _loadThemeData(currentThemeKey.value);
        }
        eventBus.emit('colorSchemeChanged', effectiveColorScheme.value);
    }

    /**
     * Applies a new theme.
     */
    async function applyTheme(themeKey, event = null) {
        if (!themes.value[themeKey] || currentThemeKey.value === themeKey) {
            if(currentThemeKey.value !== themeKey) log(`Attempted to apply non-existent theme: ${themeKey}`, 'WARN');
            return;
        }

        // --- [动画] START: 触发主题切换遮罩 ---
        isThemeTransitioning.value = true;
        await new Promise(resolve => setTimeout(resolve, 100)); // 短暂延迟确保遮罩渲染
        // --- [动画] END ---

        const updateLogic = async () => {
            currentThemeKey.value = themeKey;
            localStorage.setItem('currentThemeKey', themeKey);
            await _loadThemeData(themeKey);
            eventBus.emit('themeChanged');
        };

        await updateLogic();

        // --- [动画] START: 隐藏主题切换遮罩 ---
        await new Promise(resolve => setTimeout(resolve, 300)); // 等待新主题CSS加载和应用
        isThemeTransitioning.value = false;
        // --- [动画] END ---
    }

    /**
     * [NEW] Public action to ensure theme data is loaded before use.
     * @param {string} themeKey - The key of the theme to check/load.
     */
    async function ensureThemeDataIsLoaded(themeKey) {
        if (!themeKey) themeKey = currentThemeKey.value;
        await _loadThemeData(themeKey);
    }

    async function setColorScheme(scheme, event = null) {
        colorScheme.value = scheme;
        localStorage.setItem('colorScheme', scheme);
        await _syncThemeWithColorScheme(true);
    }

    // --- MODIFICATION START: Removed setSttMode and setCallMode actions ---
    function setAiNoiseSuppression(isEnabled) {
        if (typeof isEnabled === 'boolean') {
            isAiNoiseSuppressionEnabled.value = isEnabled;
            localStorage.setItem('isAiNoiseSuppressionEnabled', JSON.stringify(isEnabled));
            log(`AI Noise Suppression set to: ${isEnabled}`, 'INFO');
        }
    }
    // --- MODIFICATION END ---

    async function saveApiSetting(key, value) {
        if (apiSettings.value[key] !== value) {
            apiSettings.value[key] = value;
            await dbService.setItem('settings', { id: 'apiSettings', ...apiSettings.value });
            log(`API Setting saved: ${key}`, 'INFO');
            eventBus.emit('apiSettingsChanged');
        }
    }

    async function handleLlmProviderChange(providerKey) {
        const providerConfig = LLMProviders[providerKey];
        if (!providerConfig) return;
        apiSettings.value.llmProvider = providerKey;
        apiSettings.value.apiEndpoint = providerConfig.defaultEndpoint;
        apiSettings.value.model = providerConfig.defaultModel;
        await dbService.setItem('settings', { id: 'apiSettings', ...apiSettings.value });
        log(`LLM Provider changed to ${providerKey}.`, 'INFO');
        eventBus.emit('apiSettingsChanged');
    }

    async function setCustomBackground(blob, mode) {
        const oldUrl = customBackgrounds.value[mode];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        customBackgrounds.value[mode] = URL.createObjectURL(blob);
        await dbService.setItem('appStateCache', { id: `background_image_${mode}`, imageBlob: blob });
        log(`自定义背景已为 ${mode} 模式设置并缓存。`, 'INFO');
    }

    async function removeCustomBackground(mode) {
        const oldUrl = customBackgrounds.value[mode];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        customBackgrounds.value[mode] = null;
        await dbService.removeItem('appStateCache', `background_image_${mode}`);
        log(`自定义背景已为 ${mode} 模式移除。`, 'INFO');
    }

    return {
        themes, colorScheme, currentThemeKey, apiSettings, customBackgrounds,
        isThemeTransitioning,
        isAiNoiseSuppressionEnabled,
        setAiNoiseSuppression,
        effectiveColorScheme, currentTheme, currentSpecialContacts,
        init, applyTheme, setColorScheme, saveApiSetting, handleLlmProviderChange,
        setCustomBackground, removeCustomBackground,
        ensureThemeDataIsLoaded, _loadThemeData
    };
});