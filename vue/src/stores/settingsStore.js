import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { log } from '@/utils';
import { THEME_LIST } from '@/config/ThemeList';
import { LLMProviders } from '@/config/LLMProviders';
import AppSettings from '@/config/AppSettings';

export const useSettingsStore = defineStore('settings', () => {
    const themes = ref(THEME_LIST);
    const colorScheme = ref(localStorage.getItem('colorScheme') || 'auto');
    const currentThemeKey = ref(localStorage.getItem('currentThemeKey') || '原神-浅色');
    const apiSettings = ref({});
    const customBackgrounds = ref({ light: null, dark: null });
    const isThemeTransitioning = ref(false);

    const effectiveColorScheme = computed(() => {
        if (colorScheme.value === 'light' || colorScheme.value === 'dark') {
            return colorScheme.value;
        }
        if (typeof window.matchMedia !== 'function') return 'light';
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    const currentTheme = computed(() => themes.value[currentThemeKey.value]);
    const currentSpecialContacts = computed(() => currentTheme.value?.specialContacts || []);

    async function init() {
        // ... (apiSettings init remains the same)
        const storedApiSettings = await dbService.getItem('settings', 'apiSettings');
        if (storedApiSettings) {
            apiSettings.value = { ...apiSettings.value, ...storedApiSettings };
        } else {
            const defaultProvider = LLMProviders[apiSettings.value.llmProvider] || LLMProviders.webchat;
            apiSettings.value.apiEndpoint = defaultProvider.defaultEndpoint;
            apiSettings.value.model = defaultProvider.defaultModel;
        }

        // --- [LOGGING ENHANCED] Load custom backgrounds on init ---
        log('settingsStore.init: 开始加载自定义背景...', 'DEBUG');
        try {
            const bgLight = await dbService.getItem('appStateCache', 'background_image_light');
            const bgDark = await dbService.getItem('appStateCache', 'background_image_dark');

            if (bgLight?.imageBlob instanceof Blob) {
                log(`settingsStore.init: 从DB加载了浅色模式背景 Blob (大小: ${bgLight.imageBlob.size} bytes)。`, 'INFO');
                if (customBackgrounds.value.light) URL.revokeObjectURL(customBackgrounds.value.light);
                customBackgrounds.value.light = URL.createObjectURL(bgLight.imageBlob);
                log(`settingsStore.init: 为浅色模式创建了新的 Object URL: ${customBackgrounds.value.light.substring(0, 50)}...`, 'DEBUG');
            } else {
                log('settingsStore.init: 未在DB中找到浅色模式背景。', 'DEBUG');
            }

            if (bgDark?.imageBlob instanceof Blob) {
                log(`settingsStore.init: 从DB加载了深色模式背景 Blob (大小: ${bgDark.imageBlob.size} bytes)。`, 'INFO');
                if (customBackgrounds.value.dark) URL.revokeObjectURL(customBackgrounds.value.dark);
                customBackgrounds.value.dark = URL.createObjectURL(bgDark.imageBlob);
                log(`settingsStore.init: 为深色模式创建了新的 Object URL: ${customBackgrounds.value.dark.substring(0, 50)}...`, 'DEBUG');
            } else {
                log('settingsStore.init: 未在DB中找到深色模式背景。', 'DEBUG');
            }
        } catch(e) {
            log(`加载自定义背景时出错: ${e.message}`, 'ERROR');
        }
        log('settingsStore.init: 自定义背景加载完成。', 'DEBUG');

        await _syncThemeWithColorScheme();

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
            if (colorScheme.value === 'auto') {
                await _syncThemeWithColorScheme();
            }
        });

        log('设置Store已初始化', 'INFO');
    }

    async function _syncThemeWithColorScheme() {
        const themeMode = currentThemeKey.value.includes('-深色') ? 'dark' : 'light';
        if (themeMode !== effectiveColorScheme.value) {
            const baseName = currentThemeKey.value.replace(/-浅色|-深色/, '');
            const newSuffix = effectiveColorScheme.value === 'dark' ? '-深色' : '-浅色';
            const newThemeKey = baseName + newSuffix;
            if (themes.value[newThemeKey]) {
                await applyTheme(newThemeKey);
            }
        }
        eventBus.emit('colorSchemeChanged', effectiveColorScheme.value);
    }

    async function applyTheme(themeKey, event = null) {
        if (!themes.value[themeKey]) {
            log(`Attempted to apply non-existent theme: ${themeKey}`, 'WARN');
            return;
        }

        const updateLogic = async () => {
            currentThemeKey.value = themeKey;
            localStorage.setItem('currentThemeKey', themeKey);
            const themeConfig = themes.value[themeKey];
            if (themeConfig.dataJs && !themeConfig.specialContacts) {
                try {
                    const response = await fetch(themeConfig.dataJs);
                    themes.value[themeKey] = { ...themeConfig, specialContacts: await response.json() };
                } catch(e) {
                    log(`Failed to load theme data: ${themeConfig.dataJs}`, 'ERROR');
                }
            }
            eventBus.emit('themeChanged');
        };

        if (document.startViewTransition && event) {
            isThemeTransitioning.value = true;
            document.documentElement.style.setProperty('--clip-x', `${event.clientX}px`);
            document.documentElement.style.setProperty('--clip-y', `${event.clientY}px`);
            const transition = document.startViewTransition(updateLogic);
            try { await transition.finished; } finally { isThemeTransitioning.value = false; }
        } else {
            await updateLogic();
        }
    }

    async function setColorScheme(scheme, event = null) {
        colorScheme.value = scheme;
        localStorage.setItem('colorScheme', scheme);
        await _syncThemeWithColorScheme();
    }

    async function saveApiSetting(key, value) {
        if (apiSettings.value[key] !== value) {
            apiSettings.value[key] = value;
            await dbService.setItem('settings', { id: 'apiSettings', ...apiSettings.value });
            log(`API Setting saved: ${key} = ${value}`, 'INFO');
            eventBus.emit('apiSettingsChanged'); // 触发事件
        }
    }

    async function handleLlmProviderChange(providerKey) {
        const providerConfig = LLMProviders[providerKey];
        if (!providerConfig) return;

        // 批量更新和保存设置
        apiSettings.value.llmProvider = providerKey;
        apiSettings.value.apiEndpoint = providerConfig.defaultEndpoint;
        apiSettings.value.model = providerConfig.defaultModel;

        await dbService.setItem('settings', { id: 'apiSettings', ...apiSettings.value });
        log(`LLM Provider changed to ${providerKey}. Settings updated.`, 'INFO');
        eventBus.emit('apiSettingsChanged');
    }

    async function setCustomBackground(blob, mode) {
        log(`settingsStore.setCustomBackground: 正在为 ${mode} 模式设置新背景...`, 'DEBUG');
        const oldUrl = customBackgrounds.value[mode];
        if (oldUrl) {
            URL.revokeObjectURL(oldUrl);
            log(`settingsStore.setCustomBackground: 已释放旧的 Object URL for ${mode} mode.`, 'DEBUG');
        }

        customBackgrounds.value[mode] = URL.createObjectURL(blob);
        log(`settingsStore.setCustomBackground: 已创建新的 Object URL for ${mode} mode: ${customBackgrounds.value[mode].substring(0,50)}...`, 'DEBUG');
        await dbService.setItem('appStateCache', { id: `background_image_${mode}`, imageBlob: blob });
        log(`自定义背景已为 ${mode} 模式设置并缓存到数据库。`, 'INFO');
    }

    async function removeCustomBackground(mode) {
        log(`settingsStore.removeCustomBackground: 正在移除 ${mode} 模式的背景...`, 'DEBUG');
        const oldUrl = customBackgrounds.value[mode];
        if (oldUrl) {
            URL.revokeObjectURL(oldUrl);
            log(`settingsStore.removeCustomBackground: 已释放 Object URL for ${mode} mode.`, 'DEBUG');
        }
        customBackgrounds.value[mode] = null;
        await dbService.removeItem('appStateCache', `background_image_${mode}`);
        log(`自定义背景已为 ${mode} 模式移除并从数据库清除。`, 'INFO');
    }

    // --- [NEW] Watcher for debugging ---
    watch(customBackgrounds, (newVal) => {
        log(`settingsStore.customBackgrounds 状态已更新: light=${newVal.light?.substring(0,50) || null}, dark=${newVal.dark?.substring(0,50) || null}`, 'DEBUG');
    }, { deep: true });

    return {
        themes, colorScheme, currentThemeKey, apiSettings, customBackgrounds, isThemeTransitioning,
        effectiveColorScheme, currentTheme, currentSpecialContacts,
        init, applyTheme, setColorScheme, saveApiSetting, handleLlmProviderChange,
        setCustomBackground, removeCustomBackground
    };
});