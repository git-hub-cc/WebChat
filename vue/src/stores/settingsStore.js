import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { dbService } from '@/services/dbService';
import { eventBus } from '@/services/eventBus';
import { log } from '@/utils';
import { THEME_LIST } from '@/config/ThemeList';
import AppSettings from '@/config/AppSettings';

export const useSettingsStore = defineStore('settings', () => {
    // --- STATE ---
    const themes = ref(THEME_LIST);
    const colorScheme = ref(localStorage.getItem('colorScheme') || 'auto');
    const currentThemeKey = ref(localStorage.getItem('currentThemeKey') || '原神-浅色');
    const apiSettings = ref({});
    const customBackgrounds = ref({ light: null, dark: null });
    const isThemeTransitioning = ref(false);

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
    async function init() {
        const storedApiSettings = await dbService.getItem('settings', 'apiSettings');
        apiSettings.value = storedApiSettings || {
            apiEndpoint: AppSettings.server.apiEndpoint,
            model: AppSettings.server.model,
            apiKey: AppSettings.server.api_key,
            maxTokens: AppSettings.server.max_tokens,
            ttsApiEndpoint: AppSettings.server.ttsApiEndpoint,
            llmProvider: 'webchat'
        };

        try {
            const bgLight = await dbService.getItem('appStateCache', 'background_image_light');
            const bgDark = await dbService.getItem('appStateCache', 'background_image_dark');
            if (bgLight?.imageBlob) customBackgrounds.value.light = URL.createObjectURL(bgLight.imageBlob);
            if (bgDark?.imageBlob) customBackgrounds.value.dark = URL.createObjectURL(bgDark.imageBlob);
        } catch(e) {
            log(`Error loading custom backgrounds: ${e.message}`, 'ERROR');
        }

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
            // Preload special contacts if not already loaded
            if (themeConfig.dataJs && !themeConfig.specialContacts) {
                try {
                    const response = await fetch(themeConfig.dataJs);
                    // This is a dynamic property, Vue needs a hint to make it reactive
                    themes.value[themeKey] = { ...themeConfig, specialContacts: await response.json() };
                } catch(e) {
                    log(`Failed to load theme data: ${themeConfig.dataJs}`, 'ERROR');
                }
            }
            // Emit event for other stores (like userStore) to react
            eventBus.emit('themeChanged');
        };

        if (document.startViewTransition && event) {
            isThemeTransitioning.value = true;
            document.documentElement.style.setProperty('--clip-x', `${event.clientX}px`);
            document.documentElement.style.setProperty('--clip-y', `${event.clientY}px`);
            const transition = document.startViewTransition(updateLogic);
            try {
                await transition.finished;
            } finally {
                isThemeTransitioning.value = false;
            }
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
        apiSettings.value[key] = value;
        await dbService.setItem('settings', { id: 'apiSettings', ...apiSettings.value });
        eventBus.emit('showNotification', { message: 'API 设置已保存', type: 'success' });
    }

    async function setCustomBackground(blob, mode) {
        const oldUrl = customBackgrounds.value[mode];
        if (oldUrl) URL.revokeObjectURL(oldUrl);

        customBackgrounds.value[mode] = URL.createObjectURL(blob);
        await dbService.setItem('appStateCache', { id: `background_image_${mode}`, imageBlob: blob });
    }

    async function removeCustomBackground(mode) {
        const oldUrl = customBackgrounds.value[mode];
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        customBackgrounds.value[mode] = null;
        await dbService.removeItem('appStateCache', `background_image_${mode}`);
    }

    return {
        themes,
        colorScheme,
        currentThemeKey,
        apiSettings,
        customBackgrounds,
        isThemeTransitioning,
        effectiveColorScheme,
        currentTheme,
        currentSpecialContacts,
        init,
        applyTheme,
        setColorScheme,
        saveApiSetting,
        setCustomBackground,
        removeCustomBackground
    };
});