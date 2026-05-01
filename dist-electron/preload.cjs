"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...rest] = args;
    return electron.ipcRenderer.off(channel, ...rest);
  },
  send(...args) {
    const [channel, ...rest] = args;
    return electron.ipcRenderer.send(channel, ...rest);
  },
  invoke(...args) {
    const [channel, ...rest] = args;
    return electron.ipcRenderer.invoke(channel, ...rest);
  },
  // LLM Methods
  listModels: () => electron.ipcRenderer.invoke("llm:list-models"),
  setProvider: (provider) => electron.ipcRenderer.invoke("llm:set-provider", provider),
  chat: (messages, config) => electron.ipcRenderer.send("llm:chat", messages, config),
  onChatChunk: (callback) => {
    const listener = (_, chunk) => callback(chunk);
    electron.ipcRenderer.on("llm:chat-chunk", listener);
    return () => electron.ipcRenderer.off("llm:chat-chunk", listener);
  },
  onLoadProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    electron.ipcRenderer.on("llm:load-progress", listener);
    return () => electron.ipcRenderer.off("llm:load-progress", listener);
  },
  unloadModel: (modelId) => electron.ipcRenderer.invoke("llm:unload-model", modelId),
  downloadLMStudioModel: (model, quantization) => electron.ipcRenderer.invoke("llm:download-lmstudio-model", model, quantization),
  getLMStudioDownloadStatus: (jobId) => electron.ipcRenderer.invoke("llm:get-lmstudio-download-status", jobId),
  cleanupLLM: () => electron.ipcRenderer.invoke("llm:cleanup"),
  abortChat: () => electron.ipcRenderer.invoke("llm:abort"),
  // Service Status Methods
  getServiceStatus: (serviceId) => electron.ipcRenderer.invoke("services:get-status", serviceId),
  isServiceReady: (serviceId) => electron.ipcRenderer.invoke("services:is-ready", serviceId),
  getAllServiceStatus: () => electron.ipcRenderer.invoke("services:get-all-status"),
  startService: (serviceId) => electron.ipcRenderer.invoke("services:start-service", serviceId),
  stopService: (serviceId) => electron.ipcRenderer.invoke("services:stop-service", serviceId),
  stopAllServices: () => electron.ipcRenderer.invoke("services:stop-all"),
  // Database Methods
  getConversations: () => electron.ipcRenderer.invoke("db:get-conversations"),
  createConversation: (id, title) => electron.ipcRenderer.invoke("db:create-conversation", id, title),
  deleteConversation: (id) => electron.ipcRenderer.invoke("db:delete-conversation", id),
  updateConversationTitle: (id, title) => electron.ipcRenderer.invoke("db:update-conversation-title", id, title),
  getMessages: (conversationId) => electron.ipcRenderer.invoke("db:get-messages", conversationId),
  saveMessage: (message) => electron.ipcRenderer.invoke("db:save-message", message),
  deleteMessageBranch: (messageId) => electron.ipcRenderer.invoke("db:delete-message-branch", messageId),
  updateMessageContent: (messageId, content, truncateAfter) => electron.ipcRenderer.invoke("db:update-message-content", messageId, content, truncateAfter),
  getSettings: () => electron.ipcRenderer.invoke("db:get-settings"),
  setSetting: (key, value) => electron.ipcRenderer.invoke("db:set-setting", key, value),
  getConversation: (id) => electron.ipcRenderer.invoke("db:get-conversation", id),
  updateConversationSettings: (id, settings) => electron.ipcRenderer.invoke("db:update-conversation-settings", id, settings),
  // Prompt History Methods
  getPromptHistory: () => electron.ipcRenderer.invoke("db:get-prompt-history"),
  addPromptHistory: (item) => electron.ipcRenderer.invoke("db:add-prompt-history", item),
  deletePromptHistory: (id) => electron.ipcRenderer.invoke("db:delete-prompt-history", id),
  clearPromptHistory: () => electron.ipcRenderer.invoke("db:clear-prompt-history"),
  // Prompt Library Methods
  getPromptLibrary: () => electron.ipcRenderer.invoke("db:get-prompt-library"),
  addPromptLibrary: (item) => electron.ipcRenderer.invoke("db:add-prompt-library", item),
  updatePromptLibrary: (item) => electron.ipcRenderer.invoke("db:update-prompt-library", item),
  deletePromptLibrary: (id) => electron.ipcRenderer.invoke("db:delete-prompt-library", id),
  // TTS Methods
  listVoices: () => electron.ipcRenderer.invoke("tts:list-voices"),
  listCloneProfiles: () => electron.ipcRenderer.invoke("tts:list-clone-profiles"),
  createCloneProfile: (name, audioPath, refText) => electron.ipcRenderer.invoke("tts:create-clone-profile", name, audioPath, refText),
  createCloneProfileFromAudioData: (name, audioDataUrl, extension, refText) => electron.ipcRenderer.invoke("tts:create-clone-profile-from-audio-data", name, audioDataUrl, extension, refText),
  transcribeAudioData: (audioDataUrl) => electron.ipcRenderer.invoke("tts:transcribe-audio-data", audioDataUrl),
  deleteCloneProfile: (profileId) => electron.ipcRenderer.invoke("tts:delete-clone-profile", profileId),
  speak: (text, voice, rate, pitch) => electron.ipcRenderer.invoke("tts:speak", text, voice, rate, pitch),
  cancelTTS: () => electron.ipcRenderer.invoke("tts:cancel"),
  cleanupTTS: () => electron.ipcRenderer.invoke("tts:cleanup"),
  // File System Methods
  saveAvatar: (base64Data, type) => electron.ipcRenderer.invoke("fs:save-avatar", base64Data, type),
  openDialog: (options) => electron.ipcRenderer.invoke("fs:open-dialog", options),
  saveDialog: (options) => electron.ipcRenderer.invoke("fs:save-dialog", options),
  readFile: (filePath) => electron.ipcRenderer.invoke("fs:read-file", filePath),
  readFileAsBase64: (filePath) => electron.ipcRenderer.invoke("fs:read-file-as-base64", filePath),
  writeFile: (filePath, content) => electron.ipcRenderer.invoke("fs:write-file", filePath, content),
  parseCharacterCard: (filePath) => electron.ipcRenderer.invoke("fs:parse-character-card", filePath),
  confirmDialog: (options) => electron.ipcRenderer.invoke("fs:confirm-dialog", options)
});
