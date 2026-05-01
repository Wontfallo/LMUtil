import { create } from 'zustand';
import { useChatSettingsStore } from './chatSettingsStore';

// AppStore now handles ONLY global settings (not per-chat)
// Per-chat settings (userName, aiName, systemPrompt, model params) are in chatSettingsStore

interface AppState {
    // Global settings
    theme: 'light' | 'dark' | 'system';
    provider: 'ollama' | 'lmstudio';
    model: string;
    models: any[]; // Cache of available models
    settingsLoaded: boolean;
    currentView: 'chat' | 'promptGenerator' | 'craftStudio';

    // Actions
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    setProvider: (provider: 'ollama' | 'lmstudio') => void;
    setModel: (model: string) => void;
    setModels: (models: any[]) => void;
    setCurrentView: (view: 'chat' | 'promptGenerator' | 'craftStudio') => void;
    loadSettings: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
    theme: 'dark',
    provider: 'ollama',
    model: '',
    models: [],
    settingsLoaded: false,
    currentView: 'chat',

    setTheme: (theme) => {
        set({ theme });
        window.ipcRenderer.setSetting('theme', theme);
    },

    setProvider: async (provider) => {
        set({ provider });
        await window.ipcRenderer.setProvider(provider);
        window.ipcRenderer.setSetting('provider', provider);
    },

    setModel: (model) => {
        const selectedModelInfo = get().models.find((item: any) => item.id === model);
        set({ model });
        useChatSettingsStore.getState().clampContextToModel(selectedModelInfo);
        window.ipcRenderer.setSetting('model', model);
    },

    setModels: (models) => set({ models }),

    setCurrentView: (view) => set({ currentView: view }),

    loadSettings: async () => {
        const rawSettings = await window.ipcRenderer.getSettings();

        // Convert array format to object
        let settings: Record<string, string> = {};
        if (Array.isArray(rawSettings)) {
            rawSettings.forEach((s: any) => {
                settings[s.key] = s.value;
            });
        } else if (rawSettings && typeof rawSettings === 'object') {
            settings = rawSettings;
        }

        if (Object.keys(settings).length > 0) {
            set({
                theme: (settings.theme as any) || 'dark',
                provider: (settings.provider as any) || 'ollama',
                model: settings.model || '',
                settingsLoaded: true,
            });

            if (settings.provider) {
                await window.ipcRenderer.setProvider(settings.provider as any);
            }
        } else {
            set({ settingsLoaded: true });
        }
    },
}));

