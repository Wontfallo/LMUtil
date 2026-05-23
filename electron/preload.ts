import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
    on(...args: Parameters<typeof ipcRenderer.on>) {
        const [channel, listener] = args
        return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
    },
    off(...args: Parameters<typeof ipcRenderer.off>) {
        const [channel, ...rest] = args
        return ipcRenderer.off(channel, ...rest)
    },
    send(...args: Parameters<typeof ipcRenderer.send>) {
        const [channel, ...rest] = args
        return ipcRenderer.send(channel, ...rest)
    },
    invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
        const [channel, ...rest] = args
        return ipcRenderer.invoke(channel, ...rest)
    },

    // LLM Methods
    listModels: () => ipcRenderer.invoke('llm:list-models'),
    setProvider: (provider: 'ollama' | 'lmstudio') => ipcRenderer.invoke('llm:set-provider', provider),
    chat: (messages: any[], config: any) => ipcRenderer.send('llm:chat', messages, config),
    onChatChunk: (callback: (chunk: any) => void) => {
        const listener = (_: any, chunk: any) => callback(chunk)
        ipcRenderer.on('llm:chat-chunk', listener)
        return () => ipcRenderer.off('llm:chat-chunk', listener)
    },
    onLoadProgress: (callback: (progress: { model: string; progress: number; status: string }) => void) => {
        const listener = (_: any, progress: any) => callback(progress)
        ipcRenderer.on('llm:load-progress', listener)
        return () => ipcRenderer.off('llm:load-progress', listener)
    },
    unloadModel: (modelId: string) => ipcRenderer.invoke('llm:unload-model', modelId),
    downloadLMStudioModel: (model: string, quantization?: string) => ipcRenderer.invoke('llm:download-lmstudio-model', model, quantization),
    getLMStudioDownloadStatus: (jobId: string) => ipcRenderer.invoke('llm:get-lmstudio-download-status', jobId),
    cleanupLLM: () => ipcRenderer.invoke('llm:cleanup'),
    abortChat: () => ipcRenderer.invoke('llm:abort'),

    // Service Status Methods
    getServiceStatus: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => ipcRenderer.invoke('services:get-status', serviceId),
    isServiceReady: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => ipcRenderer.invoke('services:is-ready', serviceId),
    getAllServiceStatus: () => ipcRenderer.invoke('services:get-all-status'),
    startService: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => ipcRenderer.invoke('services:start-service', serviceId),
    stopService: (serviceId: 'ollama' | 'lmstudio' | 'omnivoice') => ipcRenderer.invoke('services:stop-service', serviceId),
    stopAllServices: () => ipcRenderer.invoke('services:stop-all'),

    // Database Methods
    getConversations: () => ipcRenderer.invoke('db:get-conversations'),
    createConversation: (id: string, title: string) => ipcRenderer.invoke('db:create-conversation', id, title),
    branchConversation: (sourceConversationId: string, targetMessageId: string, newConversationId: string, title?: string) => ipcRenderer.invoke('db:branch-conversation', sourceConversationId, targetMessageId, newConversationId, title),
    deleteConversation: (id: string) => ipcRenderer.invoke('db:delete-conversation', id),
    updateConversationTitle: (id: string, title: string) => ipcRenderer.invoke('db:update-conversation-title', id, title),
    getMessages: (conversationId: string) => ipcRenderer.invoke('db:get-messages', conversationId),
    saveMessage: (message: any) => ipcRenderer.invoke('db:save-message', message),
    deleteMessageBranch: (messageId: string) => ipcRenderer.invoke('db:delete-message-branch', messageId),
    updateMessageContent: (messageId: string, content: string | any[], truncateAfter?: boolean) => ipcRenderer.invoke('db:update-message-content', messageId, content, truncateAfter),
    getSettings: () => ipcRenderer.invoke('db:get-settings'),
    setSetting: (key: string, value: string) => ipcRenderer.invoke('db:set-setting', key, value),
    getConversation: (id: string) => ipcRenderer.invoke('db:get-conversation', id),
    updateConversationSettings: (id: string, settings: any) => ipcRenderer.invoke('db:update-conversation-settings', id, settings),

    // Prompt History Methods
    getPromptHistory: () => ipcRenderer.invoke('db:get-prompt-history'),
    addPromptHistory: (item: any) => ipcRenderer.invoke('db:add-prompt-history', item),
    deletePromptHistory: (id: number) => ipcRenderer.invoke('db:delete-prompt-history', id),
    clearPromptHistory: () => ipcRenderer.invoke('db:clear-prompt-history'),

    // Prompt Library Methods
    getPromptLibrary: () => ipcRenderer.invoke('db:get-prompt-library'),
    addPromptLibrary: (item: any) => ipcRenderer.invoke('db:add-prompt-library', item),
    updatePromptLibrary: (item: any) => ipcRenderer.invoke('db:update-prompt-library', item),
    deletePromptLibrary: (id: string) => ipcRenderer.invoke('db:delete-prompt-library', id),

    // TTS Methods
    listVoices: () => ipcRenderer.invoke('tts:list-voices'),
    listCloneProfiles: () => ipcRenderer.invoke('tts:list-clone-profiles'),
    createCloneProfile: (name: string, audioPath: string, refText?: string) => ipcRenderer.invoke('tts:create-clone-profile', name, audioPath, refText),
    createCloneProfileFromAudioData: (name: string, audioDataUrl: string, extension?: string, refText?: string) => ipcRenderer.invoke('tts:create-clone-profile-from-audio-data', name, audioDataUrl, extension, refText),
    transcribeAudioData: (audioDataUrl: string) => ipcRenderer.invoke('tts:transcribe-audio-data', audioDataUrl),
    deleteCloneProfile: (profileId: string) => ipcRenderer.invoke('tts:delete-clone-profile', profileId),
    speak: (text: string, voice: string, rate?: string, pitch?: string) => ipcRenderer.invoke('tts:speak', text, voice, rate, pitch),
    cancelTTS: () => ipcRenderer.invoke('tts:cancel'),
    cleanupTTS: () => ipcRenderer.invoke('tts:cleanup'),

    // Diagnostics Methods
    getDiagnosticsState: () => ipcRenderer.invoke('diagnostics:get-state'),
    setDiagnosticsEnabled: (enabled: boolean) => ipcRenderer.invoke('diagnostics:set-enabled', enabled),
    clearDiagnostics: () => ipcRenderer.invoke('diagnostics:clear'),
    onDiagnosticsEntry: (callback: (entry: any) => void) => {
        const listener = (_: any, entry: any) => callback(entry)
        ipcRenderer.on('diagnostics:entry', listener)
        return () => ipcRenderer.off('diagnostics:entry', listener)
    },

    // File System Methods
    saveAvatar: (base64Data: string, type: 'user' | 'ai') => ipcRenderer.invoke('fs:save-avatar', base64Data, type),
    openDialog: (options: any) => ipcRenderer.invoke('fs:open-dialog', options),
    saveDialog: (options: any) => ipcRenderer.invoke('fs:save-dialog', options),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
    readFileAsBase64: (filePath: string) => ipcRenderer.invoke('fs:read-file-as-base64', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
    parseCharacterCard: (filePath: string) => ipcRenderer.invoke('fs:parse-character-card', filePath),
    confirmDialog: (options: { title: string; message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) => ipcRenderer.invoke('fs:confirm-dialog', options),
})
