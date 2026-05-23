/// <reference types="vite/client" />

interface Window {
    ipcRenderer: {
        on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
        off: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
        send: (channel: string, ...args: any[]) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;

        // LLM Methods
        listModels: () => Promise<any[]>;
        setProvider: (provider: 'ollama' | 'lmstudio') => Promise<boolean>;
        chat: (messages: any[], config: any) => void;
        onChatChunk: (callback: (chunk: any) => void) => () => void;
        onLoadProgress: (callback: (progress: { model: string; progress: number; status: 'starting' | 'loading' | 'ready' }) => void) => () => void;
        unloadModel: (modelId: string) => Promise<void>;
        downloadLMStudioModel: (model: string, quantization?: string) => Promise<any>;
        getLMStudioDownloadStatus: (jobId: string) => Promise<any>;
        cleanupLLM: () => Promise<void>;
        abortChat: () => Promise<boolean>;

        // Service Status Methods
        getServiceStatus: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => Promise<string>;
        isServiceReady: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => Promise<boolean>;
        getAllServiceStatus: () => Promise<Record<string, string>>;
        startService: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => Promise<boolean>;
        stopService: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => Promise<boolean>;
        stopAllServices: () => Promise<boolean>;

        // Database Methods
        getConversations: () => Promise<any[]>;
        createConversation: (id: string, title: string) => Promise<any>;
        branchConversation: (sourceConversationId: string, targetMessageId: string, newConversationId: string, title?: string) => Promise<any>;
        deleteConversation: (id: string) => Promise<any>;
        updateConversationTitle: (id: string, title: string) => Promise<any>;
        getConversation: (id: string) => Promise<any>;
        updateConversationSettings: (id: string, settings: any) => Promise<any>;
        getMessages: (conversationId: string) => Promise<any[]>;
        saveMessage: (message: any) => Promise<any>;
        deleteMessageBranch: (messageId: string) => Promise<any>;
        updateMessageContent: (messageId: string, content: string | any[], truncateAfter?: boolean) => Promise<any>;
        getSettings: () => Promise<any>;
        setSetting: (key: string, value: string) => Promise<any>;

        // Prompt History Methods
        getPromptHistory: () => Promise<any[]>;
        addPromptHistory: (item: any) => Promise<any>;
        deletePromptHistory: (id: number) => Promise<any>;
        clearPromptHistory: () => Promise<any>;

        // Prompt Library Methods
        getPromptLibrary: () => Promise<any[]>;
        addPromptLibrary: (item: any) => Promise<any>;
        updatePromptLibrary: (item: any) => Promise<any>;
        deletePromptLibrary: (id: string) => Promise<any>;

        // TTS Methods
        listVoices: () => Promise<any[]>;
        listCloneProfiles: () => Promise<any[]>;
        createCloneProfile: (name: string, audioPath: string, refText?: string) => Promise<any>;
        createCloneProfileFromAudioData: (name: string, audioDataUrl: string, extension?: string, refText?: string) => Promise<any>;
        transcribeAudioData: (audioDataUrl: string) => Promise<string>;
        deleteCloneProfile: (profileId: string) => Promise<boolean>;
        speak: (text: string, voice: string, rate?: string, pitch?: string) => Promise<{ audioBase64: string; mimeType: string }>;
        cancelTTS: () => Promise<boolean>;
        cleanupTTS: () => Promise<void>;

        // Diagnostics Methods
        getDiagnosticsState: () => Promise<{ enabled: boolean; entries: Array<{ id: number; timestamp: string; source: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }> }>;
        setDiagnosticsEnabled: (enabled: boolean) => Promise<boolean>;
        clearDiagnostics: () => Promise<boolean>;
        onDiagnosticsEntry: (callback: (entry: { id: number; timestamp: string; source: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }) => void) => () => void;

        // File System Methods
        saveAvatar: (base64Data: string, type: 'user' | 'ai') => Promise<string>;
        openDialog: (options: any) => Promise<any>;
        saveDialog: (options: any) => Promise<any>;
        readFile: (filePath: string) => Promise<string>;
        readFileAsBase64: (filePath: string) => Promise<string>;
        writeFile: (filePath: string, content: string) => Promise<boolean>;
        parseCharacterCard: (filePath: string) => Promise<any>;
        confirmDialog: (options: { title: string; message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
    };
}
