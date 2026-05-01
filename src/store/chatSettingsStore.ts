import { create } from 'zustand';

// Default settings for new chats
export const DEFAULT_CHAT_SETTINGS = {
    // AI Profile
    aiName: 'AI',
    aiAvatar: '',
    aiAvatarPosition: 30, // Y position percentage (0-100)

    // User Persona
    userName: 'User',
    userAvatar: '',
    userAvatarPosition: 30,
    userPersona: '',

    // System Prompt
    systemPrompt: 'You are a helpful AI assistant.',

    // Model Settings
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 4096,
    topK: 40,
    topP: 0.95,
    repeatPenalty: 1.1,
    thinkingMode: 'no_think' as 'auto' | 'no_think' | 'think',

    // Voice Settings
    aiVoice: '',
    aiRegion: 'all',
    aiRate: '+0%',
    aiPitch: '+0Hz',
    ttsChunkTarget: 450,
    userVoice: '',
    userRegion: 'all',
    userRate: '+0%',
    userPitch: '+0Hz',
    autoPlay: false,
    userAutoPlay: false, // Auto-play user message readback
};

export type ChatSettings = typeof DEFAULT_CHAT_SETTINGS;
export type ChatSettingKey = keyof ChatSettings;

interface ModelDefaultsSource {
    maxContext?: number;
    loadedContextLength?: number;
}

export const SAFE_DEFAULT_CONTEXT_LENGTH = 32768;

export const SETTING_SECTIONS = {
    aiProfile: ['aiName', 'aiAvatar', 'aiAvatarPosition'] as ChatSettingKey[],
    userPersona: ['userName', 'userAvatar', 'userAvatarPosition', 'userPersona', 'userVoice', 'userRegion', 'userRate', 'userPitch', 'userAutoPlay'] as ChatSettingKey[],
    systemPrompt: ['systemPrompt'] as ChatSettingKey[],
    modelSettings: ['temperature', 'maxTokens', 'contextLength', 'topK', 'topP', 'repeatPenalty', 'thinkingMode'] as ChatSettingKey[],
    voiceSettings: ['aiVoice', 'aiRegion', 'aiRate', 'aiPitch', 'ttsChunkTarget', 'autoPlay'] as ChatSettingKey[],
} as const;

export type SettingSection = keyof typeof SETTING_SECTIONS;

interface ChatSettingsState {
    // Current conversation ID
    currentConversationId: string | null;

    // Current working values (may have unsaved changes)
    current: ChatSettings;

    // Original values from DB (for comparison)
    original: ChatSettings;

    // Track which sections have unsaved changes
    unsavedSections: Set<SettingSection>;

    // Loading state
    isLoading: boolean;

    // Actions
    loadSettings: (conversationId: string) => Promise<void>;
    updateSetting: <K extends ChatSettingKey>(key: K, value: ChatSettings[K]) => void;
    saveSection: (section: SettingSection) => Promise<void>;
    resetSection: (section: SettingSection) => void;
    resetToDefaults: (section: SettingSection) => void;
    resetAll: () => void;
    applyModelDefaults: (modelInfo?: ModelDefaultsSource | null) => void;
    clampContextToModel: (modelInfo?: ModelDefaultsSource | null) => void;
    isSectionChanged: (section: SettingSection) => boolean;
    isSettingChanged: (key: ChatSettingKey) => boolean;
    isNonDefault: (key: ChatSettingKey) => boolean; // Compare against global defaults for color
}

function getPreferredContextLength(modelInfo?: ModelDefaultsSource | null): number {
    const modelMax = modelInfo?.maxContext;
    const loadedContext = modelInfo?.loadedContextLength;

    if (loadedContext && loadedContext > 0) {
        return loadedContext;
    }

    if (modelMax && modelMax > 0) {
        return Math.min(modelMax, SAFE_DEFAULT_CONTEXT_LENGTH);
    }

    return DEFAULT_CHAT_SETTINGS.contextLength;
}

function markChangedSections(current: ChatSettings, original: ChatSettings): Set<SettingSection> {
    const changed = new Set<SettingSection>();

    for (const [section, keys] of Object.entries(SETTING_SECTIONS)) {
        if ((keys as ChatSettingKey[]).some(key => current[key] !== original[key])) {
            changed.add(section as SettingSection);
        }
    }

    return changed;
}

export const useChatSettingsStore = create<ChatSettingsState>((set, get) => ({
    currentConversationId: null,
    current: { ...DEFAULT_CHAT_SETTINGS },
    original: { ...DEFAULT_CHAT_SETTINGS },
    unsavedSections: new Set(),
    isLoading: false,

    loadSettings: async (conversationId: string) => {
        // Reset to defaults immediately to prevent stale settings race condition
        set({
            isLoading: true,
            currentConversationId: conversationId,
            current: { ...DEFAULT_CHAT_SETTINGS },
            original: { ...DEFAULT_CHAT_SETTINGS },
            unsavedSections: new Set()
        });

        try {
            // Get conversation with settings from DB
            const conversation = await window.ipcRenderer.getConversation(conversationId);

            if (get().currentConversationId !== conversationId) {
                return;
            }

            if (conversation) {
                const loadedSettings: ChatSettings = {
                    aiName: conversation.ai_name || DEFAULT_CHAT_SETTINGS.aiName,
                    aiAvatar: conversation.ai_avatar || DEFAULT_CHAT_SETTINGS.aiAvatar,
                    aiAvatarPosition: conversation.ai_avatar_position ?? DEFAULT_CHAT_SETTINGS.aiAvatarPosition,
                    userName: conversation.user_name || DEFAULT_CHAT_SETTINGS.userName,
                    userAvatar: conversation.user_avatar || DEFAULT_CHAT_SETTINGS.userAvatar,
                    userAvatarPosition: conversation.user_avatar_position ?? DEFAULT_CHAT_SETTINGS.userAvatarPosition,
                    userPersona: conversation.user_persona || DEFAULT_CHAT_SETTINGS.userPersona,
                    systemPrompt: conversation.system_prompt || DEFAULT_CHAT_SETTINGS.systemPrompt,
                    temperature: conversation.temperature ?? DEFAULT_CHAT_SETTINGS.temperature,
                    maxTokens: conversation.max_tokens ?? DEFAULT_CHAT_SETTINGS.maxTokens,
                    contextLength: conversation.context_length ?? DEFAULT_CHAT_SETTINGS.contextLength,
                    topK: conversation.top_k ?? DEFAULT_CHAT_SETTINGS.topK,
                    topP: conversation.top_p ?? DEFAULT_CHAT_SETTINGS.topP,
                    repeatPenalty: conversation.repeat_penalty ?? DEFAULT_CHAT_SETTINGS.repeatPenalty,
                    thinkingMode: conversation.thinking_mode || DEFAULT_CHAT_SETTINGS.thinkingMode,
                    aiVoice: conversation.ai_voice || DEFAULT_CHAT_SETTINGS.aiVoice,
                    aiRegion: conversation.ai_region || DEFAULT_CHAT_SETTINGS.aiRegion,
                    aiRate: conversation.ai_rate || DEFAULT_CHAT_SETTINGS.aiRate,
                    aiPitch: conversation.ai_pitch || DEFAULT_CHAT_SETTINGS.aiPitch,
                    ttsChunkTarget: conversation.tts_chunk_target ?? DEFAULT_CHAT_SETTINGS.ttsChunkTarget,
                    userVoice: conversation.user_voice || DEFAULT_CHAT_SETTINGS.userVoice,
                    userRegion: conversation.user_region || DEFAULT_CHAT_SETTINGS.userRegion,
                    userRate: conversation.user_rate || DEFAULT_CHAT_SETTINGS.userRate,
                    userPitch: conversation.user_pitch || DEFAULT_CHAT_SETTINGS.userPitch,
                    // Convert SQLite 0/1 to proper booleans
                    autoPlay: Boolean(conversation.auto_play),
                    userAutoPlay: Boolean(conversation.user_auto_play),
                };

                set({
                    current: { ...loadedSettings },
                    original: { ...loadedSettings },
                    unsavedSections: new Set(),
                    isLoading: false,
                });
            } else {
                // New conversation - use defaults
                set({
                    current: { ...DEFAULT_CHAT_SETTINGS },
                    original: { ...DEFAULT_CHAT_SETTINGS },
                    unsavedSections: new Set(),
                    isLoading: false,
                });
            }
        } catch (error) {
            console.error('[ChatSettings] Failed to load settings:', error);
            set({ isLoading: false });
        }
    },

    updateSetting: (key, value) => {
        const { current, original } = get();
        const newCurrent = { ...current, [key]: value };

        // Find which section this key belongs to
        let affectedSection: SettingSection | null = null;
        for (const [section, keys] of Object.entries(SETTING_SECTIONS)) {
            if ((keys as readonly string[]).includes(key)) {
                affectedSection = section as SettingSection;
                break;
            }
        }

        // Check if this section now has changes
        const newUnsavedSections = new Set(get().unsavedSections);
        if (affectedSection) {
            const sectionKeys = SETTING_SECTIONS[affectedSection];
            const hasChanges = sectionKeys.some(k => newCurrent[k] !== original[k]);

            if (hasChanges) {
                newUnsavedSections.add(affectedSection);
            } else {
                newUnsavedSections.delete(affectedSection);
            }
        }

        set({ current: newCurrent, unsavedSections: newUnsavedSections });
    },

    saveSection: async (section) => {
        const { currentConversationId, current } = get();
        if (!currentConversationId) {
            console.log(`[ChatSettings] No conversation ID, cannot save ${section}`);
            return;
        }

        const sectionKeys = SETTING_SECTIONS[section];
        const settingsToSave: Record<string, any> = {};

        // Map our keys to DB column names
        const keyToColumn: Record<string, string> = {
            aiName: 'ai_name',
            aiAvatar: 'ai_avatar',
            aiAvatarPosition: 'ai_avatar_position',
            userName: 'user_name',
            userAvatar: 'user_avatar',
            userAvatarPosition: 'user_avatar_position',
            userPersona: 'user_persona',
            systemPrompt: 'system_prompt',
            temperature: 'temperature',
            maxTokens: 'max_tokens',
            contextLength: 'context_length',
            topK: 'top_k',
            topP: 'top_p',
            repeatPenalty: 'repeat_penalty',
            thinkingMode: 'thinking_mode',
            aiVoice: 'ai_voice',
            aiRegion: 'ai_region',
            aiRate: 'ai_rate',
            aiPitch: 'ai_pitch',
            ttsChunkTarget: 'tts_chunk_target',
            userVoice: 'user_voice',
            userRegion: 'user_region',
            userRate: 'user_rate',
            userPitch: 'user_pitch',
            autoPlay: 'auto_play',
            userAutoPlay: 'user_auto_play',
        };

        for (const key of sectionKeys) {
            const column = keyToColumn[key];
            if (column) {
                // Convert boolean to integer for SQLite
                let value = current[key];
                if (typeof value === 'boolean') {
                    value = value ? 1 : 0;
                }
                settingsToSave[column] = value;
            }
        }

        console.log(`[ChatSettings] Saving ${section}:`, settingsToSave);

        try {
            await window.ipcRenderer.updateConversationSettings(currentConversationId, settingsToSave);

            // Update original to match current for saved keys
            const newOriginal = { ...get().original };
            for (const key of sectionKeys) {
                (newOriginal as any)[key] = current[key];
            }

            // Remove section from unsaved
            const newUnsavedSections = new Set(get().unsavedSections);
            newUnsavedSections.delete(section);

            console.log(`[ChatSettings] Saved ${section}, unsaved sections now:`, Array.from(newUnsavedSections));

            set({ original: newOriginal, unsavedSections: newUnsavedSections });
        } catch (error) {
            console.error(`[ChatSettings] Failed to save ${section}:`, error);
        }
    },

    resetSection: (section) => {
        const { original, current } = get();
        const sectionKeys = SETTING_SECTIONS[section];

        const newCurrent = { ...current };
        for (const key of sectionKeys) {
            (newCurrent as any)[key] = original[key];
        }

        const newUnsavedSections = new Set(get().unsavedSections);
        newUnsavedSections.delete(section);

        set({ current: newCurrent, unsavedSections: newUnsavedSections });
    },

    resetToDefaults: (section) => {
        const { current, original } = get();
        const sectionKeys = SETTING_SECTIONS[section];

        // Reset to global defaults
        const newCurrent = { ...current };
        for (const key of sectionKeys) {
            (newCurrent as any)[key] = DEFAULT_CHAT_SETTINGS[key];
        }

        // Mark section as changed if it differs from saved original
        const newUnsavedSections = new Set(get().unsavedSections);
        const hasChanges = sectionKeys.some(k => newCurrent[k] !== original[k]);
        if (hasChanges) {
            newUnsavedSections.add(section);
        } else {
            newUnsavedSections.delete(section);
        }

        set({ current: newCurrent, unsavedSections: newUnsavedSections });
    },

    resetAll: () => {
        set({
            current: { ...get().original },
            unsavedSections: new Set(),
        });
    },

    applyModelDefaults: (modelInfo) => {
        const { current, original } = get();
        const contextLength = getPreferredContextLength(modelInfo);
        const nextCurrent: ChatSettings = {
            ...current,
            temperature: DEFAULT_CHAT_SETTINGS.temperature,
            maxTokens: Math.min(DEFAULT_CHAT_SETTINGS.maxTokens, contextLength),
            contextLength,
            topK: DEFAULT_CHAT_SETTINGS.topK,
            topP: DEFAULT_CHAT_SETTINGS.topP,
            repeatPenalty: DEFAULT_CHAT_SETTINGS.repeatPenalty,
            thinkingMode: DEFAULT_CHAT_SETTINGS.thinkingMode,
        };

        set({
            current: nextCurrent,
            unsavedSections: markChangedSections(nextCurrent, original),
        });
    },

    clampContextToModel: (modelInfo) => {
        const maxContext = modelInfo?.maxContext;
        const safeMaxContext = Math.min(maxContext && maxContext > 0 ? maxContext : SAFE_DEFAULT_CONTEXT_LENGTH, SAFE_DEFAULT_CONTEXT_LENGTH);

        const { current, original } = get();
        if (current.contextLength <= safeMaxContext) return;

        const nextCurrent = {
            ...current,
            contextLength: safeMaxContext,
            maxTokens: Math.min(current.maxTokens, safeMaxContext),
        };

        set({
            current: nextCurrent,
            unsavedSections: markChangedSections(nextCurrent, original),
        });
    },

    isSectionChanged: (section) => {
        return get().unsavedSections.has(section);
    },

    isSettingChanged: (key) => {
        const { current, original } = get();
        return current[key] !== original[key];
    },

    isNonDefault: (key) => {
        // Compare current value against GLOBAL defaults (for color indication)
        return get().current[key] !== DEFAULT_CHAT_SETTINGS[key];
    },
}));
