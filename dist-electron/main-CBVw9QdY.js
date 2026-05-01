"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("node:path");
const require$$0$5 = require("node:crypto");
const require$$1$5 = require("node:fs");
const require$$0$3 = require("events");
const require$$1$1 = require("https");
const require$$1$2 = require("http");
const require$$0$4 = require("net");
const require$$4 = require("tls");
const require$$1 = require("crypto");
const require$$0$2 = require("stream");
const require$$7 = require("url");
const require$$0 = require("zlib");
const fs = require("fs");
const path$1 = require("path");
const os$1 = require("os");
const require$$0$1 = require("buffer");
const require$$2 = require("assert");
const require$$1$3 = require("tty");
const require$$1$4 = require("util");
const fs$1 = require("node:fs/promises");
const require$$0$6 = require("child_process");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path$1);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os$1);
class OllamaProvider {
  constructor() {
    __publicField(this, "baseUrl", "http://localhost:11434");
  }
  async isConnected() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(2e3)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  async listModels() {
    const connected = await this.isConnected();
    if (!connected) {
      console.log("[Ollama] Not connected - service may not be running");
      return [];
    }
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json();
      const models = await Promise.all(
        (data.models || []).map(async (m) => {
          const capabilities = await this.getModelCapabilities(m.name);
          return {
            id: m.name,
            name: m.name,
            provider: "ollama",
            hasVision: capabilities.hasVision,
            hasTools: capabilities.hasTools,
            maxContext: capabilities.maxContext
          };
        })
      );
      return models;
    } catch (error) {
      console.error("[Ollama] listModels error:", error);
      return [];
    }
  }
  async getModelCapabilities(modelName) {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName })
      });
      const data = await response.json();
      const hasVision = this.detectVisionCapability(modelName, data);
      const hasTools = this.detectToolsCapability(modelName, data);
      let maxContext;
      if (data.parameters) {
        const match = data.parameters.match(/num_ctx\s+(\d+)/);
        if (match) maxContext = parseInt(match[1]);
      }
      return { hasVision, hasTools, maxContext };
    } catch (error) {
      return {
        hasVision: this.detectVisionCapability(modelName, null),
        hasTools: this.detectToolsCapability(modelName, null)
      };
    }
  }
  detectVisionCapability(modelName, apiData) {
    var _a, _b;
    if ((apiData == null ? void 0 : apiData.projector_info) || ((_b = (_a = apiData == null ? void 0 : apiData.details) == null ? void 0 : _a.families) == null ? void 0 : _b.includes("clip"))) {
      return true;
    }
    const visionPatterns = [
      "llava",
      "bakllava",
      "llama3.2-vision",
      "vision",
      "cogvlm",
      "internvl",
      "qwen-vl",
      "qwen2-vl",
      "moondream"
    ];
    const lowerName = modelName.toLowerCase();
    return visionPatterns.some((p) => lowerName.includes(p));
  }
  detectToolsCapability(modelName, apiData) {
    if (apiData == null ? void 0 : apiData.template) {
      const template = apiData.template.toLowerCase();
      if (template.includes("tool") || template.includes("function") || template.includes("<|python_tag|>") || template.includes("ipython")) {
        return true;
      }
    }
    const toolPatterns = [
      "qwen",
      "mistral",
      "llama-3.1",
      "llama-3.2",
      "llama3.1",
      "llama3.2",
      "functionary",
      "hermes",
      "nexus",
      "firefunction",
      "gorilla"
    ];
    const lowerName = modelName.toLowerCase();
    return toolPatterns.some((p) => lowerName.includes(p));
  }
  async *chat(messages, config, signal) {
    var _a;
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          options: {
            temperature: config.temperature,
            num_predict: config.max_tokens,
            alert: true,
            // Legacy (optional)
            top_k: config.topKSampling,
            top_p: config.topPSampling,
            repeat_penalty: config.repeatPenalty,
            num_ctx: config.contextLength
          }
        }),
        signal
      });
      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            yield {
              content: ((_a = data.message) == null ? void 0 : _a.content) || "",
              done: data.done
            };
          } catch (e) {
            console.error("Error parsing Ollama chunk:", e);
          }
        }
      }
    } catch (error) {
      yield { done: true, error: error.message };
    }
  }
  async unloadModel(modelId) {
    try {
      console.log("[Ollama] Unloading model:", modelId);
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          prompt: "",
          keep_alive: 0
        })
      });
      console.log("[Ollama] Unload response status:", response.status);
      if (!response.ok) {
        const text = await response.text();
        console.error("[Ollama] Unload failed:", text);
        throw new Error(`Ollama unload failed: ${text}`);
      }
      console.log("[Ollama] Model unloaded:", modelId);
    } catch (error) {
      console.error("[Ollama] Unload error:", error);
    }
  }
  async stopRunning() {
    try {
      console.log("[Ollama] Checking for running models to stop...");
      const response = await fetch(`${this.baseUrl}/api/ps`);
      if (!response.ok) return;
      const data = await response.json();
      const runningModels = data.models || [];
      if (runningModels.length === 0) {
        console.log("[Ollama] No models running.");
        return;
      }
      console.log("[Ollama] Unloading models from VRAM:", runningModels.map((m) => m.name));
      await Promise.all(runningModels.map(async (m) => {
        await this.unloadModel(m.name);
      }));
      console.log("[Ollama] All models unloaded from VRAM.");
    } catch (error) {
      console.error("[Ollama] Failed to stop running models:", error);
    }
  }
}
let clientInstance = null;
let clientCreationFailed = false;
async function getClient() {
  if (clientCreationFailed) {
    clientCreationFailed = false;
    clientInstance = null;
  }
  if (!clientInstance) {
    try {
      console.log("[LM Studio SDK] Creating new client instance...");
      const { LMStudioClient } = await Promise.resolve().then(() => require("./index-Bn3-W9oL.js"));
      clientInstance = new LMStudioClient({
        baseUrl: "ws://127.0.0.1:1234"
      });
      console.log("[LM Studio SDK] Client created successfully");
    } catch (error) {
      console.error("[LM Studio SDK] Failed to create client:", (error == null ? void 0 : error.message) || error);
      clientCreationFailed = true;
      throw error;
    }
  }
  return clientInstance;
}
function resetClient() {
  console.log("[LM Studio SDK] Resetting client instance");
  clientInstance = null;
  clientCreationFailed = false;
}
class LMStudioProvider {
  constructor() {
    __publicField(this, "baseUrl", "http://localhost:1234");
  }
  async isConnected() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        signal: AbortSignal.timeout(2e3)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  async listModels() {
    var _a;
    const connected = await this.isConnected();
    if (!connected) {
      console.log("[LM Studio] Not connected - service may not be running");
      return [];
    }
    try {
      const client = await getClient();
      console.log("[LM Studio SDK] Attempting to list downloaded models...");
      const downloadedModels = await client.system.listDownloadedModels();
      console.log("[LM Studio SDK] Got", downloadedModels.length, "models");
      downloadedModels.forEach((m, i) => {
        console.log(`[LM Studio SDK] Model ${i}:`, JSON.stringify({
          modelKey: m.modelKey,
          type: m.type,
          vision: m.vision,
          trainedForToolUse: m.trainedForToolUse
        }));
      });
      const filteredModels = downloadedModels.filter((m) => {
        const isLLM = !m.type || m.type === "llm";
        console.log(`[LM Studio SDK] Model ${m.modelKey} type=${m.type} isLLM=${isLLM}`);
        return isLLM;
      });
      console.log("[LM Studio SDK] After filter:", filteredModels.length, "models");
      return filteredModels.map((m) => {
        return {
          id: m.modelKey || m.path,
          name: m.displayName || m.modelKey || m.path,
          provider: "lmstudio",
          hasVision: m.vision === true,
          hasTools: m.trainedForToolUse === true,
          maxContext: m.maxContextLength || 4096
        };
      });
    } catch (sdkError) {
      console.warn("[LM Studio] SDK failed:", (sdkError == null ? void 0 : sdkError.message) || sdkError);
      resetClient();
      console.log("[LM Studio] Trying REST API fallback...");
      try {
        const response = await fetch(`${this.baseUrl}/v1/models`, {
          signal: AbortSignal.timeout(3e3)
        });
        if (!response.ok) {
          console.log("[LM Studio] REST API returned non-OK status:", response.status);
          return [];
        }
        const data = await response.json();
        console.log("[LM Studio] REST API returned", ((_a = data.data) == null ? void 0 : _a.length) || 0, "models");
        return (data.data || []).map((m) => ({
          id: m.id,
          name: m.id,
          provider: "lmstudio",
          hasVision: this.detectVisionCapability(m.id),
          hasTools: this.detectToolsCapability(m.id),
          maxContext: 4096
          // Default fallback
        }));
      } catch (restError) {
        console.error("[LM Studio] Both SDK and REST API failed. REST error:", restError == null ? void 0 : restError.message);
        console.log("[LM Studio] Make sure LM Studio is running with the local server enabled.");
        return [];
      }
    }
  }
  detectVisionCapability(modelName) {
    const visionPatterns = [
      "llava",
      "bakllava",
      "vision",
      "cogvlm",
      "internvl",
      "qwen-vl",
      "qwen2-vl",
      "qvq",
      "moondream",
      "bunny",
      "minicpm-v",
      "phi-3-vision",
      "llama-3.2-vision",
      "gemma-3",
      "pixtral",
      "deepseek-vl"
    ];
    const lowerName = modelName.toLowerCase();
    return visionPatterns.some((p) => lowerName.includes(p));
  }
  detectToolsCapability(modelName) {
    const lowerName = modelName.toLowerCase();
    const toolPatterns = [
      "qwen",
      "mistral",
      "llama-3.1",
      "llama-3.2",
      "llama3.1",
      "llama3.2",
      "llama-3-",
      "functionary",
      "hermes",
      "nexus",
      "firefunction",
      "gorilla",
      "dolphin",
      "openhermes",
      "nous-hermes",
      "instruct",
      "gemma-2"
    ];
    return toolPatterns.some((p) => lowerName.includes(p));
  }
  /**
   * Chat using the official LM Studio SDK.
   * Uses client.llm.model() to get a model handle with proper context length,
   * then model.respond() for streaming inference.
   */
  async *chat(messages, config, signal) {
    var _a, _b;
    try {
      const client = await getClient();
      console.log("[LM Studio SDK] Getting model handle:", config.model, "with context:", config.contextLength);
      const model = await client.llm.model(config.model, {
        config: {
          contextLength: config.contextLength || 4096
        }
      });
      const sdkMessages = await Promise.all(messages.map(async (m) => {
        var _a2;
        if (typeof m.content === "string") {
          return { role: m.role, content: m.content };
        }
        if (Array.isArray(m.content)) {
          const textPart = m.content.find((p) => p.type === "text");
          const imageParts = m.content.filter((p) => p.type === "image_url");
          if (imageParts.length > 0) {
            const preparedImages = [];
            for (const img of imageParts) {
              const url = ((_a2 = img.image_url) == null ? void 0 : _a2.url) || "";
              let base64Data = "";
              const base64Match = url.match(/^data:image\/\w+;base64,(.+)$/);
              if (base64Match) {
                base64Data = base64Match[1];
              } else if (url && url.length > 20) {
                base64Data = url;
              }
              if (base64Data) {
                console.log("[LM Studio SDK] Processing image, base64 length:", base64Data.length);
                try {
                  const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
                  const prepared = await client.files.prepareImageBase64(fileName, base64Data);
                  preparedImages.push(prepared);
                  console.log("[LM Studio SDK] Image prepared successfully:", prepared.identifier);
                } catch (e) {
                  console.error("[LM Studio SDK] Failed to prepare image:", (e == null ? void 0 : e.message) || e);
                  if (e.issues) console.error(JSON.stringify(e.issues, null, 2));
                }
              } else {
                console.warn("[LM Studio SDK] Image URL found but failed to extract base64 data:", url.substring(0, 50) + "...");
              }
            }
            if (preparedImages.length > 0) {
              return {
                role: m.role,
                content: (textPart == null ? void 0 : textPart.text) || "Describe this image",
                images: preparedImages
              };
            }
          }
          return { role: m.role, content: (textPart == null ? void 0 : textPart.text) || "" };
        }
        return { role: m.role, content: String(m.content || "") };
      }));
      console.log("[LM Studio SDK] Calling model.respond with", sdkMessages.length, "messages");
      console.log("[LM Studio SDK] Inference params:", {
        temperature: config.temperature,
        maxTokens: config.max_tokens,
        topKSampling: config.topKSampling,
        topPSampling: config.topPSampling,
        repeatPenalty: config.repeatPenalty,
        signal: signal ? "AbortSignal provided" : "undefined"
      });
      const prediction = model.respond(sdkMessages, {
        temperature: config.temperature ?? 0.7,
        maxTokens: config.max_tokens ?? 2048,
        topKSampling: config.topKSampling,
        topPSampling: config.topPSampling,
        repeatPenalty: config.repeatPenalty,
        signal
      });
      for await (const fragment of prediction) {
        if (signal == null ? void 0 : signal.aborted) {
          console.log("[LM Studio SDK] Aborted by signal");
          yield { done: true, aborted: true };
          return;
        }
        console.log("[LM Studio SDK] Fragment type:", typeof fragment, "value:", JSON.stringify(fragment).substring(0, 100));
        let content = "";
        if (typeof fragment === "string") {
          content = fragment;
        } else if (fragment && typeof fragment === "object") {
          content = fragment.content || fragment.text || ((_a = fragment.delta) == null ? void 0 : _a.content) || ((_b = fragment.message) == null ? void 0 : _b.content) || "";
          if (!content && fragment.toString && fragment.toString() !== "[object Object]") {
            content = fragment.toString();
          }
        }
        if (content) {
          yield {
            content,
            done: false
          };
        }
      }
      yield { done: true };
    } catch (error) {
      console.error("[LM Studio SDK] Chat error:", error);
      yield { done: true, error: error.message };
    }
  }
  async unloadModel(modelId) {
    try {
      console.log("[LM Studio] Unloading model via SDK:", modelId || "all loaded models");
      const client = await getClient();
      const loadedModels = await client.llm.listLoaded();
      console.log("[LM Studio] Found", loadedModels.length, "loaded models");
      if (loadedModels.length === 0) {
        console.log("[LM Studio] No models currently loaded in VRAM");
        return;
      }
      for (const model of loadedModels) {
        try {
          const identifier = model.identifier || model.modelKey || model.path;
          console.log("[LM Studio] Unloading:", identifier);
          await client.llm.unload(identifier);
          console.log("[LM Studio] Successfully unloaded:", identifier);
        } catch (unloadError) {
          console.error("[LM Studio] Failed to unload model:", (unloadError == null ? void 0 : unloadError.message) || unloadError);
        }
      }
    } catch (error) {
      console.error("[LM Studio] Unload error:", (error == null ? void 0 : error.message) || error);
      resetClient();
    }
  }
  async stopRunning() {
    return this.unloadModel("");
  }
}
const unloadOllama = async () => {
  try {
    const res = await fetch("http://localhost:11434/api/ps");
    if (!res.ok) return;
    const ps = await res.json();
    if (ps.models && ps.models.length > 0) {
      for (const model of ps.models) {
        const modelName = model.name;
        console.log(`[ModelManager] Unloading Ollama model: ${modelName}`);
        await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelName, prompt: "", keep_alive: 0 })
        });
      }
    } else {
      console.log("[ModelManager] No Ollama models loaded in VRAM.");
    }
  } catch (e) {
    console.error("[ModelManager] Failed to unload Ollama:", e);
  }
};
const unloadLMStudio = async () => {
  try {
    console.log("[ModelManager] Unloading LM Studio models via SDK...");
    const { LMStudioClient } = await Promise.resolve().then(() => require("./index-Bn3-W9oL.js"));
    const client = new LMStudioClient({
      baseUrl: "ws://127.0.0.1:1234"
    });
    const loadedModels = await client.llm.listLoaded();
    console.log("[ModelManager] Found", loadedModels.length, "loaded LM Studio models");
    if (loadedModels.length === 0) {
      console.log("[ModelManager] No LM Studio models loaded in VRAM.");
      return;
    }
    for (const model of loadedModels) {
      try {
        const identifier = model.identifier || model.modelKey || model.path;
        console.log("[ModelManager] Unloading LM Studio model:", identifier);
        await client.llm.unload(identifier);
        console.log("[ModelManager] Successfully unloaded:", identifier);
      } catch (unloadError) {
        console.error("[ModelManager] Failed to unload model:", (unloadError == null ? void 0 : unloadError.message) || unloadError);
      }
    }
    console.log("[ModelManager] LM Studio models unloaded.");
  } catch (error) {
    console.log("[ModelManager] LM Studio SDK unload error (server might not be running):", error == null ? void 0 : error.message);
  }
};
const switchBackend = async (target) => {
  console.log(`[ModelManager] Switching to ${target}... cleaning up other backend.`);
  if (target === "ollama") {
    await unloadLMStudio();
  } else if (target === "lmstudio") {
    await unloadOllama();
  }
  console.log(`[ModelManager] Ready for ${target}.`);
};
const unloadAllModels = async () => {
  console.log("[ModelManager] Unloading all models from all backends...");
  await Promise.all([
    unloadOllama(),
    unloadLMStudio()
  ]);
  console.log("[ModelManager] All models unloaded.");
};
class LLMService {
  constructor() {
    __publicField(this, "providers", {
      ollama: new OllamaProvider(),
      lmstudio: new LMStudioProvider()
    });
    __publicField(this, "currentProvider", "ollama");
    __publicField(this, "abortController", null);
  }
  setProvider(provider) {
    console.log("[LLMService] Setting provider to:", provider);
    this.currentProvider = provider;
  }
  registerHandlers() {
    electron.ipcMain.handle("llm:list-models", async () => {
      console.log("[LLMService] list-models called, current provider:", this.currentProvider);
      try {
        const models = await this.providers[this.currentProvider].listModels();
        console.log("[LLMService] list-models returned", models.length, "models");
        return models;
      } catch (error) {
        console.error("[LLMService] list-models error:", (error == null ? void 0 : error.message) || error);
        return [];
      }
    });
    electron.ipcMain.handle("llm:set-provider", async (_, provider) => {
      await switchBackend(provider);
      this.setProvider(provider);
      return true;
    });
    electron.ipcMain.on("llm:chat", async (event, messages, config) => {
      console.log(`[LLM] Starting chat with ${this.currentProvider} (model: ${config.model})`);
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      const provider = this.providers[this.currentProvider];
      try {
        let chunkCount = 0;
        for await (const chunk of provider.chat(messages, config, signal)) {
          if (signal.aborted) {
            console.log("[LLM] Chat aborted by user");
            event.reply("llm:chat-chunk", { done: true, aborted: true });
            break;
          }
          chunkCount++;
          event.reply("llm:chat-chunk", chunk);
        }
        console.log(`[LLM] Chat completed with ${chunkCount} chunks`);
      } catch (error) {
        if (error.name === "AbortError" || signal.aborted) {
          console.log("[LLM] Chat aborted");
          event.reply("llm:chat-chunk", { done: true, aborted: true });
        } else {
          console.error("[LLM] Chat error:", error);
          event.reply("llm:chat-chunk", { done: true, error: error.message });
        }
      } finally {
        this.abortController = null;
      }
    });
    electron.ipcMain.handle("llm:abort", async () => {
      if (this.abortController) {
        console.log("[LLM] Aborting current request");
        this.abortController.abort();
        return true;
      }
      return false;
    });
    electron.ipcMain.handle("llm:unload-model", async (_, modelId) => {
      return this.providers[this.currentProvider].unloadModel(modelId);
    });
    electron.ipcMain.handle("llm:cleanup", async () => {
      console.log("[LLM] Cleaning up (unloading all models from all backends)...");
      await unloadAllModels();
      return true;
    });
  }
}
const Database = require("better-sqlite3");
const dbPath = path.join(electron.app.getPath("userData"), "database.sqlite");
let db = null;
function initDatabase() {
  try {
    console.log("[Database] Initializing at:", dbPath);
    db = new Database(dbPath);
    db.prepare(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
        role TEXT CHECK(role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT,
        images TEXT,
        tool_calls TEXT,
        tool_result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();
    const addColumnIfNotExists = (table, column, type) => {
      try {
        db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get();
      } catch {
        console.log(`[DB] Adding column ${column} to ${table}`);
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
      }
    };
    addColumnIfNotExists("conversations", "last_model", "TEXT");
    addColumnIfNotExists("conversations", "last_provider", "TEXT");
    addColumnIfNotExists("conversations", "system_prompt", "TEXT");
    addColumnIfNotExists("conversations", "user_name", "TEXT");
    addColumnIfNotExists("conversations", "ai_name", "TEXT");
    addColumnIfNotExists("conversations", "user_avatar", "TEXT");
    addColumnIfNotExists("conversations", "ai_avatar", "TEXT");
    addColumnIfNotExists("conversations", "ai_voice", "TEXT");
    addColumnIfNotExists("conversations", "temperature", "REAL");
    addColumnIfNotExists("conversations", "max_tokens", "INTEGER");
    addColumnIfNotExists("conversations", "context_length", "INTEGER");
    addColumnIfNotExists("conversations", "top_k", "INTEGER");
    addColumnIfNotExists("conversations", "top_p", "REAL");
    addColumnIfNotExists("conversations", "repeat_penalty", "REAL");
    db.prepare(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT,
        content TEXT,
        chunk_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS prompt_history (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        negative_prompt TEXT,
        model TEXT,
        creativity TEXT CHECK(creativity IN ('precise', 'creative', 'inspire')),
        target_model TEXT CHECK(target_model IN ('wan2.2', 'qwen'))
      )
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS prompt_library (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        system_prompt TEXT NOT NULL,
        images TEXT,
        target_type TEXT DEFAULT 'any' CHECK(target_type IN ('wan2.2', 'qwen', 'any')),
        requires_vision INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    try {
      db.prepare(`ALTER TABLE messages ADD COLUMN model TEXT`).run();
      console.log("[Database] Added model column to messages");
    } catch (e) {
      if (!e.message.includes("duplicate column")) throw e;
    }
    const conversationColumns = [
      "system_prompt TEXT",
      "user_name TEXT",
      "ai_name TEXT",
      "user_avatar TEXT",
      "ai_avatar TEXT",
      "ai_voice TEXT",
      "user_voice TEXT",
      "last_model TEXT",
      "last_provider TEXT",
      "temperature REAL DEFAULT 0.7",
      "max_tokens INTEGER DEFAULT 2048",
      "context_length INTEGER DEFAULT 4096",
      "top_k INTEGER DEFAULT 40",
      "top_p REAL DEFAULT 0.95",
      "repeat_penalty REAL DEFAULT 1.1",
      "ai_avatar_position INTEGER DEFAULT 30",
      "user_avatar_position INTEGER DEFAULT 30",
      "user_persona TEXT",
      "auto_play INTEGER DEFAULT 0",
      "user_auto_play INTEGER DEFAULT 0",
      'ai_rate TEXT DEFAULT "+0%"',
      'ai_pitch TEXT DEFAULT "+0Hz"',
      'user_rate TEXT DEFAULT "+0%"',
      'user_pitch TEXT DEFAULT "+0Hz"'
    ];
    for (const col of conversationColumns) {
      try {
        db.prepare(`ALTER TABLE conversations ADD COLUMN ${col}`).run();
        console.log(`[Database] Added ${col.split(" ")[0]} to conversations`);
      } catch (e) {
        if (!e.message.includes("duplicate column")) throw e;
      }
    }
    console.log("[Database] Initialized successfully");
    return true;
  } catch (error) {
    console.error("[Database] CRITICAL: Initialization failed:", error);
    return false;
  }
}
function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}
const conversationService = {
  create(id, title) {
    const db2 = getDb();
    console.log("[DB] Creating conversation:", id, title);
    return db2.prepare("INSERT INTO conversations (id, title) VALUES (?, ?)").run(id, title);
  },
  getAll() {
    const db2 = getDb();
    return db2.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all();
  },
  delete(id) {
    const db2 = getDb();
    return db2.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  },
  updateTitle(id, title) {
    const db2 = getDb();
    return db2.prepare("UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(title, id);
  },
  updateSettings(id, settings) {
    const db2 = getDb();
    const fields = Object.keys(settings).map((k) => `${k} = @${k}`).join(", ");
    if (!fields) {
      console.log("[Conversations] updateSettings: no fields to update");
      return;
    }
    const sql = `UPDATE conversations SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`;
    console.log("[Conversations] updateSettings SQL:", sql, "params:", { ...settings, id });
    const result = db2.prepare(sql).run({ ...settings, id });
    console.log("[Conversations] updateSettings result:", result);
    return result;
  },
  getById(id) {
    const db2 = getDb();
    const result = db2.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    console.log("[Conversations] getById:", id);
    console.log("[Conversations] getById result - ai_name:", result == null ? void 0 : result.ai_name, "ai_avatar:", (result == null ? void 0 : result.ai_avatar) ? "exists" : "none", "system_prompt:", (result == null ? void 0 : result.system_prompt) ? "exists" : "none");
    return result;
  }
};
const messageService = {
  create(message) {
    const db2 = getDb();
    console.log("[DB] Saving message:", message.id, "model:", message.model);
    let contentToStore = message.content;
    if (Array.isArray(message.content)) {
      contentToStore = JSON.stringify(message.content);
    }
    const safeMessage = {
      images: null,
      tool_calls: null,
      tool_result: null,
      model: null,
      ...message,
      content: contentToStore
    };
    return db2.prepare(`
      INSERT INTO messages (id, conversation_id, parent_id, role, content, model, images, tool_calls, tool_result)
      VALUES (@id, @conversation_id, @parent_id, @role, @content, @model, @images, @tool_calls, @tool_result)
    `).run(safeMessage);
  },
  getByConversation(conversationId) {
    const db2 = getDb();
    const messages = db2.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId);
    return messages.map((msg) => {
      if (typeof msg.content === "string" && msg.content.startsWith("[")) {
        try {
          msg.content = JSON.parse(msg.content);
        } catch (e) {
        }
      }
      return msg;
    });
  },
  deleteBranch(messageId) {
    const db2 = getDb();
    return db2.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
  }
};
const settingsService = {
  set(key, value) {
    const db2 = getDb();
    return db2.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  },
  get(key) {
    const db2 = getDb();
    const row = db2.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : null;
  },
  getAll() {
    const db2 = getDb();
    const rows = db2.prepare("SELECT * FROM settings").all();
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }
};
function registerStorageHandlers() {
  console.log("[Storage] Registering IPC handlers");
  electron.ipcMain.handle("db:get-conversations", async () => {
    console.log("[Storage] Getting all conversations");
    return conversationService.getAll();
  });
  electron.ipcMain.handle("db:create-conversation", async (_, id, title) => {
    console.log("[Storage] Creating conversation:", id, title);
    try {
      const result = conversationService.create(id, title);
      console.log("[Storage] Conversation created successfully");
      return result;
    } catch (error) {
      console.error("[Storage] Failed to create conversation:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("db:delete-conversation", async (_, id) => {
    console.log("[Storage] Deleting conversation:", id);
    return conversationService.delete(id);
  });
  electron.ipcMain.handle("db:update-conversation-title", async (_, id, title) => {
    return conversationService.updateTitle(id, title);
  });
  electron.ipcMain.handle("db:get-messages", async (_, conversationId) => {
    console.log("[Storage] Getting messages for:", conversationId);
    return messageService.getByConversation(conversationId);
  });
  electron.ipcMain.handle("db:save-message", async (_, message) => {
    console.log("[Storage] Saving message:", message.id);
    return messageService.create(message);
  });
  electron.ipcMain.handle("db:delete-message-branch", async (_, messageId) => {
    return messageService.deleteBranch(messageId);
  });
  electron.ipcMain.handle("db:get-settings", async () => {
    console.log("[Storage] Getting all settings");
    return settingsService.getAll();
  });
  electron.ipcMain.handle("db:set-setting", async (_, key, value) => {
    console.log("[Storage] Setting:", key);
    return settingsService.set(key, value);
  });
  electron.ipcMain.handle("db:get-conversation", async (_, id) => {
    console.log("[Storage] Getting conversation:", id);
    return conversationService.getById(id);
  });
  electron.ipcMain.handle("db:update-conversation-settings", async (_, id, settings) => {
    console.log("[Storage] Updating conversation settings:", id);
    return conversationService.updateSettings(id, settings);
  });
  electron.ipcMain.handle("db:get-prompt-history", async () => {
    console.log("[Storage] Getting prompt history");
    const db2 = getDb();
    return db2.prepare("SELECT * FROM prompt_history ORDER BY id DESC").all();
  });
  electron.ipcMain.handle("db:add-prompt-history", async (_, item) => {
    console.log("[Storage] Adding prompt history item");
    const db2 = getDb();
    const stmt = db2.prepare(`
            INSERT OR REPLACE INTO prompt_history (id, timestamp, input, output, negative_prompt, model, creativity, target_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
    stmt.run(item.id, item.timestamp, item.input, item.output, item.negativePrompt || "", item.model, item.creativity, item.targetModel);
    return { success: true };
  });
  electron.ipcMain.handle("db:delete-prompt-history", async (_, id) => {
    console.log("[Storage] Deleting prompt history item:", id);
    const db2 = getDb();
    db2.prepare("DELETE FROM prompt_history WHERE id = ?").run(id);
    return { success: true };
  });
  electron.ipcMain.handle("db:clear-prompt-history", async () => {
    console.log("[Storage] Clearing all prompt history");
    const db2 = getDb();
    db2.prepare("DELETE FROM prompt_history").run();
    return { success: true };
  });
  electron.ipcMain.handle("db:get-prompt-library", async () => {
    console.log("[Storage] Getting prompt library");
    const db2 = getDb();
    return db2.prepare("SELECT * FROM prompt_library ORDER BY updated_at DESC").all();
  });
  electron.ipcMain.handle("db:add-prompt-library", async (_, item) => {
    console.log("[Storage] Adding prompt library item:", item.name);
    const db2 = getDb();
    const stmt = db2.prepare(`
            INSERT INTO prompt_library (id, name, description, system_prompt, images, target_type, requires_vision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    stmt.run(
      item.id,
      item.name,
      item.description || "",
      item.systemPrompt,
      JSON.stringify(item.images || []),
      item.targetType || "any",
      item.requiresVision ? 1 : 0,
      now,
      now
    );
    return { success: true };
  });
  electron.ipcMain.handle("db:update-prompt-library", async (_, item) => {
    console.log("[Storage] Updating prompt library item:", item.id);
    const db2 = getDb();
    const stmt = db2.prepare(`
            UPDATE prompt_library 
            SET name = ?, description = ?, system_prompt = ?, images = ?, target_type = ?, requires_vision = ?, updated_at = ?
            WHERE id = ?
        `);
    stmt.run(
      item.name,
      item.description || "",
      item.systemPrompt,
      JSON.stringify(item.images || []),
      item.targetType || "any",
      item.requiresVision ? 1 : 0,
      (/* @__PURE__ */ new Date()).toISOString(),
      item.id
    );
    return { success: true };
  });
  electron.ipcMain.handle("db:delete-prompt-library", async (_, id) => {
    console.log("[Storage] Deleting prompt library item:", id);
    const db2 = getDb();
    db2.prepare("DELETE FROM prompt_library WHERE id = ?").run(id);
    return { success: true };
  });
  console.log("[Storage] All IPC handlers registered");
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs$1(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var edgeTts = {};
var bufferUtil$1 = { exports: {} };
const BINARY_TYPES$2 = ["nodebuffer", "arraybuffer", "fragments"];
const hasBlob$1 = typeof Blob !== "undefined";
if (hasBlob$1) BINARY_TYPES$2.push("blob");
var constants = {
  BINARY_TYPES: BINARY_TYPES$2,
  EMPTY_BUFFER: Buffer.alloc(0),
  GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
  hasBlob: hasBlob$1,
  kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
  kListener: Symbol("kListener"),
  kStatusCode: Symbol("status-code"),
  kWebSocket: Symbol("websocket"),
  NOOP: () => {
  }
};
var bufferutil = { exports: {} };
function commonjsRequire(path2) {
  throw new Error('Could not dynamically require "' + path2 + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var nodeGypBuild$1 = { exports: {} };
var nodeGypBuild;
var hasRequiredNodeGypBuild$1;
function requireNodeGypBuild$1() {
  if (hasRequiredNodeGypBuild$1) return nodeGypBuild;
  hasRequiredNodeGypBuild$1 = 1;
  var fs$12 = fs;
  var path2 = path$1;
  var os2 = os$1;
  var runtimeRequire = typeof __webpack_require__ === "function" ? __non_webpack_require__ : commonjsRequire;
  var vars = process.config && process.config.variables || {};
  var prebuildsOnly = !!process.env.PREBUILDS_ONLY;
  var abi = process.versions.modules;
  var runtime = isElectron() ? "electron" : isNwjs() ? "node-webkit" : "node";
  var arch = process.env.npm_config_arch || os2.arch();
  var platform = process.env.npm_config_platform || os2.platform();
  var libc = process.env.LIBC || (isAlpine(platform) ? "musl" : "glibc");
  var armv = process.env.ARM_VERSION || (arch === "arm64" ? "8" : vars.arm_version) || "";
  var uv = (process.versions.uv || "").split(".")[0];
  nodeGypBuild = load;
  function load(dir) {
    return runtimeRequire(load.resolve(dir));
  }
  load.resolve = load.path = function(dir) {
    dir = path2.resolve(dir || ".");
    try {
      var name = runtimeRequire(path2.join(dir, "package.json")).name.toUpperCase().replace(/-/g, "_");
      if (process.env[name + "_PREBUILD"]) dir = process.env[name + "_PREBUILD"];
    } catch (err) {
    }
    if (!prebuildsOnly) {
      var release = getFirst(path2.join(dir, "build/Release"), matchBuild);
      if (release) return release;
      var debug2 = getFirst(path2.join(dir, "build/Debug"), matchBuild);
      if (debug2) return debug2;
    }
    var prebuild = resolve(dir);
    if (prebuild) return prebuild;
    var nearby = resolve(path2.dirname(process.execPath));
    if (nearby) return nearby;
    var target = [
      "platform=" + platform,
      "arch=" + arch,
      "runtime=" + runtime,
      "abi=" + abi,
      "uv=" + uv,
      armv ? "armv=" + armv : "",
      "libc=" + libc,
      "node=" + process.versions.node,
      process.versions.electron ? "electron=" + process.versions.electron : "",
      typeof __webpack_require__ === "function" ? "webpack=true" : ""
      // eslint-disable-line
    ].filter(Boolean).join(" ");
    throw new Error("No native build was found for " + target + "\n    loaded from: " + dir + "\n");
    function resolve(dir2) {
      var tuples = readdirSync(path2.join(dir2, "prebuilds")).map(parseTuple);
      var tuple = tuples.filter(matchTuple(platform, arch)).sort(compareTuples)[0];
      if (!tuple) return;
      var prebuilds = path2.join(dir2, "prebuilds", tuple.name);
      var parsed = readdirSync(prebuilds).map(parseTags);
      var candidates = parsed.filter(matchTags(runtime, abi));
      var winner = candidates.sort(compareTags(runtime))[0];
      if (winner) return path2.join(prebuilds, winner.file);
    }
  };
  function readdirSync(dir) {
    try {
      return fs$12.readdirSync(dir);
    } catch (err) {
      return [];
    }
  }
  function getFirst(dir, filter) {
    var files = readdirSync(dir).filter(filter);
    return files[0] && path2.join(dir, files[0]);
  }
  function matchBuild(name) {
    return /\.node$/.test(name);
  }
  function parseTuple(name) {
    var arr = name.split("-");
    if (arr.length !== 2) return;
    var platform2 = arr[0];
    var architectures = arr[1].split("+");
    if (!platform2) return;
    if (!architectures.length) return;
    if (!architectures.every(Boolean)) return;
    return { name, platform: platform2, architectures };
  }
  function matchTuple(platform2, arch2) {
    return function(tuple) {
      if (tuple == null) return false;
      if (tuple.platform !== platform2) return false;
      return tuple.architectures.includes(arch2);
    };
  }
  function compareTuples(a, b) {
    return a.architectures.length - b.architectures.length;
  }
  function parseTags(file) {
    var arr = file.split(".");
    var extension2 = arr.pop();
    var tags = { file, specificity: 0 };
    if (extension2 !== "node") return;
    for (var i = 0; i < arr.length; i++) {
      var tag = arr[i];
      if (tag === "node" || tag === "electron" || tag === "node-webkit") {
        tags.runtime = tag;
      } else if (tag === "napi") {
        tags.napi = true;
      } else if (tag.slice(0, 3) === "abi") {
        tags.abi = tag.slice(3);
      } else if (tag.slice(0, 2) === "uv") {
        tags.uv = tag.slice(2);
      } else if (tag.slice(0, 4) === "armv") {
        tags.armv = tag.slice(4);
      } else if (tag === "glibc" || tag === "musl") {
        tags.libc = tag;
      } else {
        continue;
      }
      tags.specificity++;
    }
    return tags;
  }
  function matchTags(runtime2, abi2) {
    return function(tags) {
      if (tags == null) return false;
      if (tags.runtime && tags.runtime !== runtime2 && !runtimeAgnostic(tags)) return false;
      if (tags.abi && tags.abi !== abi2 && !tags.napi) return false;
      if (tags.uv && tags.uv !== uv) return false;
      if (tags.armv && tags.armv !== armv) return false;
      if (tags.libc && tags.libc !== libc) return false;
      return true;
    };
  }
  function runtimeAgnostic(tags) {
    return tags.runtime === "node" && tags.napi;
  }
  function compareTags(runtime2) {
    return function(a, b) {
      if (a.runtime !== b.runtime) {
        return a.runtime === runtime2 ? -1 : 1;
      } else if (a.abi !== b.abi) {
        return a.abi ? -1 : 1;
      } else if (a.specificity !== b.specificity) {
        return a.specificity > b.specificity ? -1 : 1;
      } else {
        return 0;
      }
    };
  }
  function isNwjs() {
    return !!(process.versions && process.versions.nw);
  }
  function isElectron() {
    if (process.versions && process.versions.electron) return true;
    if (process.env.ELECTRON_RUN_AS_NODE) return true;
    return typeof window !== "undefined" && window.process && window.process.type === "renderer";
  }
  function isAlpine(platform2) {
    return platform2 === "linux" && fs$12.existsSync("/etc/alpine-release");
  }
  load.parseTags = parseTags;
  load.matchTags = matchTags;
  load.compareTags = compareTags;
  load.parseTuple = parseTuple;
  load.matchTuple = matchTuple;
  load.compareTuples = compareTuples;
  return nodeGypBuild;
}
var hasRequiredNodeGypBuild;
function requireNodeGypBuild() {
  if (hasRequiredNodeGypBuild) return nodeGypBuild$1.exports;
  hasRequiredNodeGypBuild = 1;
  const runtimeRequire = typeof __webpack_require__ === "function" ? __non_webpack_require__ : commonjsRequire;
  if (typeof runtimeRequire.addon === "function") {
    nodeGypBuild$1.exports = runtimeRequire.addon.bind(runtimeRequire);
  } else {
    nodeGypBuild$1.exports = requireNodeGypBuild$1();
  }
  return nodeGypBuild$1.exports;
}
var fallback$1;
var hasRequiredFallback$1;
function requireFallback$1() {
  if (hasRequiredFallback$1) return fallback$1;
  hasRequiredFallback$1 = 1;
  const mask2 = (source, mask3, output, offset, length) => {
    for (var i = 0; i < length; i++) {
      output[offset + i] = source[i] ^ mask3[i & 3];
    }
  };
  const unmask2 = (buffer, mask3) => {
    const length = buffer.length;
    for (var i = 0; i < length; i++) {
      buffer[i] ^= mask3[i & 3];
    }
  };
  fallback$1 = { mask: mask2, unmask: unmask2 };
  return fallback$1;
}
var hasRequiredBufferutil;
function requireBufferutil() {
  if (hasRequiredBufferutil) return bufferutil.exports;
  hasRequiredBufferutil = 1;
  try {
    bufferutil.exports = requireNodeGypBuild()(__dirname);
  } catch (e) {
    bufferutil.exports = requireFallback$1();
  }
  return bufferutil.exports;
}
var unmask$1;
var mask;
const { EMPTY_BUFFER: EMPTY_BUFFER$3 } = constants;
const FastBuffer$2 = Buffer[Symbol.species];
function concat$1(list, totalLength) {
  if (list.length === 0) return EMPTY_BUFFER$3;
  if (list.length === 1) return list[0];
  const target = Buffer.allocUnsafe(totalLength);
  let offset = 0;
  for (let i = 0; i < list.length; i++) {
    const buf = list[i];
    target.set(buf, offset);
    offset += buf.length;
  }
  if (offset < totalLength) {
    return new FastBuffer$2(target.buffer, target.byteOffset, offset);
  }
  return target;
}
function _mask(source, mask2, output, offset, length) {
  for (let i = 0; i < length; i++) {
    output[offset + i] = source[i] ^ mask2[i & 3];
  }
}
function _unmask(buffer, mask2) {
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] ^= mask2[i & 3];
  }
}
function toArrayBuffer$1(buf) {
  if (buf.length === buf.buffer.byteLength) {
    return buf.buffer;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}
function toBuffer$3(data) {
  toBuffer$3.readOnly = true;
  if (Buffer.isBuffer(data)) return data;
  let buf;
  if (data instanceof ArrayBuffer) {
    buf = new FastBuffer$2(data);
  } else if (ArrayBuffer.isView(data)) {
    buf = new FastBuffer$2(data.buffer, data.byteOffset, data.byteLength);
  } else {
    buf = Buffer.from(data);
    toBuffer$3.readOnly = false;
  }
  return buf;
}
bufferUtil$1.exports = {
  concat: concat$1,
  mask: _mask,
  toArrayBuffer: toArrayBuffer$1,
  toBuffer: toBuffer$3,
  unmask: _unmask
};
if (!process.env.WS_NO_BUFFER_UTIL) {
  try {
    const bufferUtil2 = requireBufferutil();
    mask = bufferUtil$1.exports.mask = function(source, mask2, output, offset, length) {
      if (length < 48) _mask(source, mask2, output, offset, length);
      else bufferUtil2.mask(source, mask2, output, offset, length);
    };
    unmask$1 = bufferUtil$1.exports.unmask = function(buffer, mask2) {
      if (buffer.length < 32) _unmask(buffer, mask2);
      else bufferUtil2.unmask(buffer, mask2);
    };
  } catch (e) {
  }
}
var bufferUtilExports = bufferUtil$1.exports;
const kDone = Symbol("kDone");
const kRun = Symbol("kRun");
let Limiter$1 = class Limiter {
  /**
   * Creates a new `Limiter`.
   *
   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
   *     to run concurrently
   */
  constructor(concurrency) {
    this[kDone] = () => {
      this.pending--;
      this[kRun]();
    };
    this.concurrency = concurrency || Infinity;
    this.jobs = [];
    this.pending = 0;
  }
  /**
   * Adds a job to the queue.
   *
   * @param {Function} job The job to run
   * @public
   */
  add(job) {
    this.jobs.push(job);
    this[kRun]();
  }
  /**
   * Removes a job from the queue and runs it if possible.
   *
   * @private
   */
  [kRun]() {
    if (this.pending === this.concurrency) return;
    if (this.jobs.length) {
      const job = this.jobs.shift();
      this.pending++;
      job(this[kDone]);
    }
  }
};
var limiter = Limiter$1;
const zlib = require$$0;
const bufferUtil = bufferUtilExports;
const Limiter2 = limiter;
const { kStatusCode: kStatusCode$2 } = constants;
const FastBuffer$1 = Buffer[Symbol.species];
const TRAILER = Buffer.from([0, 0, 255, 255]);
const kPerMessageDeflate = Symbol("permessage-deflate");
const kTotalLength = Symbol("total-length");
const kCallback = Symbol("callback");
const kBuffers = Symbol("buffers");
const kError$1 = Symbol("error");
let zlibLimiter;
let PerMessageDeflate$4 = class PerMessageDeflate {
  /**
   * Creates a PerMessageDeflate instance.
   *
   * @param {Object} [options] Configuration options
   * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
   *     for, or request, a custom client window size
   * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
   *     acknowledge disabling of client context takeover
   * @param {Number} [options.concurrencyLimit=10] The number of concurrent
   *     calls to zlib
   * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
   *     use of a custom server window size
   * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
   *     disabling of server context takeover
   * @param {Number} [options.threshold=1024] Size (in bytes) below which
   *     messages should not be compressed if context takeover is disabled
   * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
   *     deflate
   * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
   *     inflate
   * @param {Boolean} [isServer=false] Create the instance in either server or
   *     client mode
   * @param {Number} [maxPayload=0] The maximum allowed message length
   */
  constructor(options, isServer, maxPayload) {
    this._maxPayload = maxPayload | 0;
    this._options = options || {};
    this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
    this._isServer = !!isServer;
    this._deflate = null;
    this._inflate = null;
    this.params = null;
    if (!zlibLimiter) {
      const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
      zlibLimiter = new Limiter2(concurrency);
    }
  }
  /**
   * @type {String}
   */
  static get extensionName() {
    return "permessage-deflate";
  }
  /**
   * Create an extension negotiation offer.
   *
   * @return {Object} Extension parameters
   * @public
   */
  offer() {
    const params = {};
    if (this._options.serverNoContextTakeover) {
      params.server_no_context_takeover = true;
    }
    if (this._options.clientNoContextTakeover) {
      params.client_no_context_takeover = true;
    }
    if (this._options.serverMaxWindowBits) {
      params.server_max_window_bits = this._options.serverMaxWindowBits;
    }
    if (this._options.clientMaxWindowBits) {
      params.client_max_window_bits = this._options.clientMaxWindowBits;
    } else if (this._options.clientMaxWindowBits == null) {
      params.client_max_window_bits = true;
    }
    return params;
  }
  /**
   * Accept an extension negotiation offer/response.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Object} Accepted configuration
   * @public
   */
  accept(configurations) {
    configurations = this.normalizeParams(configurations);
    this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
    return this.params;
  }
  /**
   * Releases all resources used by the extension.
   *
   * @public
   */
  cleanup() {
    if (this._inflate) {
      this._inflate.close();
      this._inflate = null;
    }
    if (this._deflate) {
      const callback = this._deflate[kCallback];
      this._deflate.close();
      this._deflate = null;
      if (callback) {
        callback(
          new Error(
            "The deflate stream was closed while data was being processed"
          )
        );
      }
    }
  }
  /**
   *  Accept an extension negotiation offer.
   *
   * @param {Array} offers The extension negotiation offers
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsServer(offers) {
    const opts = this._options;
    const accepted = offers.find((params) => {
      if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
        return false;
      }
      return true;
    });
    if (!accepted) {
      throw new Error("None of the extension offers can be accepted");
    }
    if (opts.serverNoContextTakeover) {
      accepted.server_no_context_takeover = true;
    }
    if (opts.clientNoContextTakeover) {
      accepted.client_no_context_takeover = true;
    }
    if (typeof opts.serverMaxWindowBits === "number") {
      accepted.server_max_window_bits = opts.serverMaxWindowBits;
    }
    if (typeof opts.clientMaxWindowBits === "number") {
      accepted.client_max_window_bits = opts.clientMaxWindowBits;
    } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
      delete accepted.client_max_window_bits;
    }
    return accepted;
  }
  /**
   * Accept the extension negotiation response.
   *
   * @param {Array} response The extension negotiation response
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsClient(response) {
    const params = response[0];
    if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
      throw new Error('Unexpected parameter "client_no_context_takeover"');
    }
    if (!params.client_max_window_bits) {
      if (typeof this._options.clientMaxWindowBits === "number") {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      }
    } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
      throw new Error(
        'Unexpected or invalid parameter "client_max_window_bits"'
      );
    }
    return params;
  }
  /**
   * Normalize parameters.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Array} The offers/response with normalized parameters
   * @private
   */
  normalizeParams(configurations) {
    configurations.forEach((params) => {
      Object.keys(params).forEach((key) => {
        let value = params[key];
        if (value.length > 1) {
          throw new Error(`Parameter "${key}" must have only a single value`);
        }
        value = value[0];
        if (key === "client_max_window_bits") {
          if (value !== true) {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
            value = num;
          } else if (!this._isServer) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else if (key === "server_max_window_bits") {
          const num = +value;
          if (!Number.isInteger(num) || num < 8 || num > 15) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
          value = num;
        } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
          if (value !== true) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else {
          throw new Error(`Unknown parameter "${key}"`);
        }
        params[key] = value;
      });
    });
    return configurations;
  }
  /**
   * Decompress data. Concurrency limited.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  decompress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._decompress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }
  /**
   * Compress data. Concurrency limited.
   *
   * @param {(Buffer|String)} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  compress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._compress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }
  /**
   * Decompress data.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _decompress(data, fin, callback) {
    const endpoint = this._isServer ? "client" : "server";
    if (!this._inflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
      this._inflate = zlib.createInflateRaw({
        ...this._options.zlibInflateOptions,
        windowBits
      });
      this._inflate[kPerMessageDeflate] = this;
      this._inflate[kTotalLength] = 0;
      this._inflate[kBuffers] = [];
      this._inflate.on("error", inflateOnError);
      this._inflate.on("data", inflateOnData);
    }
    this._inflate[kCallback] = callback;
    this._inflate.write(data);
    if (fin) this._inflate.write(TRAILER);
    this._inflate.flush(() => {
      const err = this._inflate[kError$1];
      if (err) {
        this._inflate.close();
        this._inflate = null;
        callback(err);
        return;
      }
      const data2 = bufferUtil.concat(
        this._inflate[kBuffers],
        this._inflate[kTotalLength]
      );
      if (this._inflate._readableState.endEmitted) {
        this._inflate.close();
        this._inflate = null;
      } else {
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];
        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
          this._inflate.reset();
        }
      }
      callback(null, data2);
    });
  }
  /**
   * Compress data.
   *
   * @param {(Buffer|String)} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _compress(data, fin, callback) {
    const endpoint = this._isServer ? "server" : "client";
    if (!this._deflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
      this._deflate = zlib.createDeflateRaw({
        ...this._options.zlibDeflateOptions,
        windowBits
      });
      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];
      this._deflate.on("data", deflateOnData);
    }
    this._deflate[kCallback] = callback;
    this._deflate.write(data);
    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
      if (!this._deflate) {
        return;
      }
      let data2 = bufferUtil.concat(
        this._deflate[kBuffers],
        this._deflate[kTotalLength]
      );
      if (fin) {
        data2 = new FastBuffer$1(data2.buffer, data2.byteOffset, data2.length - 4);
      }
      this._deflate[kCallback] = null;
      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];
      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
        this._deflate.reset();
      }
      callback(null, data2);
    });
  }
};
var permessageDeflate = PerMessageDeflate$4;
function deflateOnData(chunk) {
  this[kBuffers].push(chunk);
  this[kTotalLength] += chunk.length;
}
function inflateOnData(chunk) {
  this[kTotalLength] += chunk.length;
  if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
    this[kBuffers].push(chunk);
    return;
  }
  this[kError$1] = new RangeError("Max payload size exceeded");
  this[kError$1].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
  this[kError$1][kStatusCode$2] = 1009;
  this.removeListener("data", inflateOnData);
  this.reset();
}
function inflateOnError(err) {
  this[kPerMessageDeflate]._inflate = null;
  if (this[kError$1]) {
    this[kCallback](this[kError$1]);
    return;
  }
  err[kStatusCode$2] = 1007;
  this[kCallback](err);
}
var validation = { exports: {} };
var utf8Validate = { exports: {} };
var fallback;
var hasRequiredFallback;
function requireFallback() {
  if (hasRequiredFallback) return fallback;
  hasRequiredFallback = 1;
  function isValidUTF82(buf) {
    const len = buf.length;
    let i = 0;
    while (i < len) {
      if ((buf[i] & 128) === 0) {
        i++;
      } else if ((buf[i] & 224) === 192) {
        if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
          return false;
        }
        i += 2;
      } else if ((buf[i] & 240) === 224) {
        if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // overlong
        buf[i] === 237 && (buf[i + 1] & 224) === 160) {
          return false;
        }
        i += 3;
      } else if ((buf[i] & 248) === 240) {
        if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // overlong
        buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
          return false;
        }
        i += 4;
      } else {
        return false;
      }
    }
    return true;
  }
  fallback = isValidUTF82;
  return fallback;
}
var hasRequiredUtf8Validate;
function requireUtf8Validate() {
  if (hasRequiredUtf8Validate) return utf8Validate.exports;
  hasRequiredUtf8Validate = 1;
  try {
    utf8Validate.exports = requireNodeGypBuild()(__dirname);
  } catch (e) {
    utf8Validate.exports = requireFallback();
  }
  return utf8Validate.exports;
}
var isValidUTF8_1;
const { isUtf8 } = require$$0$1;
const { hasBlob } = constants;
const tokenChars$2 = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  // 0 - 15
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  // 16 - 31
  0,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  1,
  1,
  0,
  1,
  1,
  0,
  // 32 - 47
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  // 48 - 63
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  // 64 - 79
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  1,
  1,
  // 80 - 95
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  // 96 - 111
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  1,
  0,
  1,
  0
  // 112 - 127
];
function isValidStatusCode$2(code) {
  return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
}
function _isValidUTF8(buf) {
  const len = buf.length;
  let i = 0;
  while (i < len) {
    if ((buf[i] & 128) === 0) {
      i++;
    } else if ((buf[i] & 224) === 192) {
      if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
        return false;
      }
      i += 2;
    } else if ((buf[i] & 240) === 224) {
      if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
      buf[i] === 237 && (buf[i + 1] & 224) === 160) {
        return false;
      }
      i += 3;
    } else if ((buf[i] & 248) === 240) {
      if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
      buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
        return false;
      }
      i += 4;
    } else {
      return false;
    }
  }
  return true;
}
function isBlob$2(value) {
  return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
}
validation.exports = {
  isBlob: isBlob$2,
  isValidStatusCode: isValidStatusCode$2,
  isValidUTF8: _isValidUTF8,
  tokenChars: tokenChars$2
};
if (isUtf8) {
  isValidUTF8_1 = validation.exports.isValidUTF8 = function(buf) {
    return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
  };
} else if (!process.env.WS_NO_UTF_8_VALIDATE) {
  try {
    const isValidUTF82 = requireUtf8Validate();
    isValidUTF8_1 = validation.exports.isValidUTF8 = function(buf) {
      return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF82(buf);
    };
  } catch (e) {
  }
}
var validationExports = validation.exports;
const { Writable } = require$$0$2;
const PerMessageDeflate$3 = permessageDeflate;
const {
  BINARY_TYPES: BINARY_TYPES$1,
  EMPTY_BUFFER: EMPTY_BUFFER$2,
  kStatusCode: kStatusCode$1,
  kWebSocket: kWebSocket$3
} = constants;
const { concat, toArrayBuffer, unmask } = bufferUtilExports;
const { isValidStatusCode: isValidStatusCode$1, isValidUTF8 } = validationExports;
const FastBuffer = Buffer[Symbol.species];
const GET_INFO = 0;
const GET_PAYLOAD_LENGTH_16 = 1;
const GET_PAYLOAD_LENGTH_64 = 2;
const GET_MASK = 3;
const GET_DATA = 4;
const INFLATING = 5;
const DEFER_EVENT = 6;
let Receiver$1 = class Receiver extends Writable {
  /**
   * Creates a Receiver instance.
   *
   * @param {Object} [options] Options object
   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {String} [options.binaryType=nodebuffer] The type for binary data
   * @param {Object} [options.extensions] An object containing the negotiated
   *     extensions
   * @param {Boolean} [options.isServer=false] Specifies whether to operate in
   *     client or server mode
   * @param {Number} [options.maxPayload=0] The maximum allowed message length
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   */
  constructor(options = {}) {
    super();
    this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
    this._binaryType = options.binaryType || BINARY_TYPES$1[0];
    this._extensions = options.extensions || {};
    this._isServer = !!options.isServer;
    this._maxPayload = options.maxPayload | 0;
    this._skipUTF8Validation = !!options.skipUTF8Validation;
    this[kWebSocket$3] = void 0;
    this._bufferedBytes = 0;
    this._buffers = [];
    this._compressed = false;
    this._payloadLength = 0;
    this._mask = void 0;
    this._fragmented = 0;
    this._masked = false;
    this._fin = false;
    this._opcode = 0;
    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragments = [];
    this._errored = false;
    this._loop = false;
    this._state = GET_INFO;
  }
  /**
   * Implements `Writable.prototype._write()`.
   *
   * @param {Buffer} chunk The chunk of data to write
   * @param {String} encoding The character encoding of `chunk`
   * @param {Function} cb Callback
   * @private
   */
  _write(chunk, encoding, cb) {
    if (this._opcode === 8 && this._state == GET_INFO) return cb();
    this._bufferedBytes += chunk.length;
    this._buffers.push(chunk);
    this.startLoop(cb);
  }
  /**
   * Consumes `n` bytes from the buffered data.
   *
   * @param {Number} n The number of bytes to consume
   * @return {Buffer} The consumed bytes
   * @private
   */
  consume(n) {
    this._bufferedBytes -= n;
    if (n === this._buffers[0].length) return this._buffers.shift();
    if (n < this._buffers[0].length) {
      const buf = this._buffers[0];
      this._buffers[0] = new FastBuffer(
        buf.buffer,
        buf.byteOffset + n,
        buf.length - n
      );
      return new FastBuffer(buf.buffer, buf.byteOffset, n);
    }
    const dst = Buffer.allocUnsafe(n);
    do {
      const buf = this._buffers[0];
      const offset = dst.length - n;
      if (n >= buf.length) {
        dst.set(this._buffers.shift(), offset);
      } else {
        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
        this._buffers[0] = new FastBuffer(
          buf.buffer,
          buf.byteOffset + n,
          buf.length - n
        );
      }
      n -= buf.length;
    } while (n > 0);
    return dst;
  }
  /**
   * Starts the parsing loop.
   *
   * @param {Function} cb Callback
   * @private
   */
  startLoop(cb) {
    this._loop = true;
    do {
      switch (this._state) {
        case GET_INFO:
          this.getInfo(cb);
          break;
        case GET_PAYLOAD_LENGTH_16:
          this.getPayloadLength16(cb);
          break;
        case GET_PAYLOAD_LENGTH_64:
          this.getPayloadLength64(cb);
          break;
        case GET_MASK:
          this.getMask();
          break;
        case GET_DATA:
          this.getData(cb);
          break;
        case INFLATING:
        case DEFER_EVENT:
          this._loop = false;
          return;
      }
    } while (this._loop);
    if (!this._errored) cb();
  }
  /**
   * Reads the first two bytes of a frame.
   *
   * @param {Function} cb Callback
   * @private
   */
  getInfo(cb) {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }
    const buf = this.consume(2);
    if ((buf[0] & 48) !== 0) {
      const error = this.createError(
        RangeError,
        "RSV2 and RSV3 must be clear",
        true,
        1002,
        "WS_ERR_UNEXPECTED_RSV_2_3"
      );
      cb(error);
      return;
    }
    const compressed = (buf[0] & 64) === 64;
    if (compressed && !this._extensions[PerMessageDeflate$3.extensionName]) {
      const error = this.createError(
        RangeError,
        "RSV1 must be clear",
        true,
        1002,
        "WS_ERR_UNEXPECTED_RSV_1"
      );
      cb(error);
      return;
    }
    this._fin = (buf[0] & 128) === 128;
    this._opcode = buf[0] & 15;
    this._payloadLength = buf[1] & 127;
    if (this._opcode === 0) {
      if (compressed) {
        const error = this.createError(
          RangeError,
          "RSV1 must be clear",
          true,
          1002,
          "WS_ERR_UNEXPECTED_RSV_1"
        );
        cb(error);
        return;
      }
      if (!this._fragmented) {
        const error = this.createError(
          RangeError,
          "invalid opcode 0",
          true,
          1002,
          "WS_ERR_INVALID_OPCODE"
        );
        cb(error);
        return;
      }
      this._opcode = this._fragmented;
    } else if (this._opcode === 1 || this._opcode === 2) {
      if (this._fragmented) {
        const error = this.createError(
          RangeError,
          `invalid opcode ${this._opcode}`,
          true,
          1002,
          "WS_ERR_INVALID_OPCODE"
        );
        cb(error);
        return;
      }
      this._compressed = compressed;
    } else if (this._opcode > 7 && this._opcode < 11) {
      if (!this._fin) {
        const error = this.createError(
          RangeError,
          "FIN must be set",
          true,
          1002,
          "WS_ERR_EXPECTED_FIN"
        );
        cb(error);
        return;
      }
      if (compressed) {
        const error = this.createError(
          RangeError,
          "RSV1 must be clear",
          true,
          1002,
          "WS_ERR_UNEXPECTED_RSV_1"
        );
        cb(error);
        return;
      }
      if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
        const error = this.createError(
          RangeError,
          `invalid payload length ${this._payloadLength}`,
          true,
          1002,
          "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
        );
        cb(error);
        return;
      }
    } else {
      const error = this.createError(
        RangeError,
        `invalid opcode ${this._opcode}`,
        true,
        1002,
        "WS_ERR_INVALID_OPCODE"
      );
      cb(error);
      return;
    }
    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
    this._masked = (buf[1] & 128) === 128;
    if (this._isServer) {
      if (!this._masked) {
        const error = this.createError(
          RangeError,
          "MASK must be set",
          true,
          1002,
          "WS_ERR_EXPECTED_MASK"
        );
        cb(error);
        return;
      }
    } else if (this._masked) {
      const error = this.createError(
        RangeError,
        "MASK must be clear",
        true,
        1002,
        "WS_ERR_UNEXPECTED_MASK"
      );
      cb(error);
      return;
    }
    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
    else this.haveLength(cb);
  }
  /**
   * Gets extended payload length (7+16).
   *
   * @param {Function} cb Callback
   * @private
   */
  getPayloadLength16(cb) {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }
    this._payloadLength = this.consume(2).readUInt16BE(0);
    this.haveLength(cb);
  }
  /**
   * Gets extended payload length (7+64).
   *
   * @param {Function} cb Callback
   * @private
   */
  getPayloadLength64(cb) {
    if (this._bufferedBytes < 8) {
      this._loop = false;
      return;
    }
    const buf = this.consume(8);
    const num = buf.readUInt32BE(0);
    if (num > Math.pow(2, 53 - 32) - 1) {
      const error = this.createError(
        RangeError,
        "Unsupported WebSocket frame: payload length > 2^53 - 1",
        false,
        1009,
        "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
      );
      cb(error);
      return;
    }
    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
    this.haveLength(cb);
  }
  /**
   * Payload length has been read.
   *
   * @param {Function} cb Callback
   * @private
   */
  haveLength(cb) {
    if (this._payloadLength && this._opcode < 8) {
      this._totalPayloadLength += this._payloadLength;
      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
        const error = this.createError(
          RangeError,
          "Max payload size exceeded",
          false,
          1009,
          "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
        );
        cb(error);
        return;
      }
    }
    if (this._masked) this._state = GET_MASK;
    else this._state = GET_DATA;
  }
  /**
   * Reads mask bytes.
   *
   * @private
   */
  getMask() {
    if (this._bufferedBytes < 4) {
      this._loop = false;
      return;
    }
    this._mask = this.consume(4);
    this._state = GET_DATA;
  }
  /**
   * Reads data bytes.
   *
   * @param {Function} cb Callback
   * @private
   */
  getData(cb) {
    let data = EMPTY_BUFFER$2;
    if (this._payloadLength) {
      if (this._bufferedBytes < this._payloadLength) {
        this._loop = false;
        return;
      }
      data = this.consume(this._payloadLength);
      if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
        unmask(data, this._mask);
      }
    }
    if (this._opcode > 7) {
      this.controlMessage(data, cb);
      return;
    }
    if (this._compressed) {
      this._state = INFLATING;
      this.decompress(data, cb);
      return;
    }
    if (data.length) {
      this._messageLength = this._totalPayloadLength;
      this._fragments.push(data);
    }
    this.dataMessage(cb);
  }
  /**
   * Decompresses data.
   *
   * @param {Buffer} data Compressed data
   * @param {Function} cb Callback
   * @private
   */
  decompress(data, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate$3.extensionName];
    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
      if (err) return cb(err);
      if (buf.length) {
        this._messageLength += buf.length;
        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
          const error = this.createError(
            RangeError,
            "Max payload size exceeded",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
          );
          cb(error);
          return;
        }
        this._fragments.push(buf);
      }
      this.dataMessage(cb);
      if (this._state === GET_INFO) this.startLoop(cb);
    });
  }
  /**
   * Handles a data message.
   *
   * @param {Function} cb Callback
   * @private
   */
  dataMessage(cb) {
    if (!this._fin) {
      this._state = GET_INFO;
      return;
    }
    const messageLength = this._messageLength;
    const fragments = this._fragments;
    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragmented = 0;
    this._fragments = [];
    if (this._opcode === 2) {
      let data;
      if (this._binaryType === "nodebuffer") {
        data = concat(fragments, messageLength);
      } else if (this._binaryType === "arraybuffer") {
        data = toArrayBuffer(concat(fragments, messageLength));
      } else if (this._binaryType === "blob") {
        data = new Blob(fragments);
      } else {
        data = fragments;
      }
      if (this._allowSynchronousEvents) {
        this.emit("message", data, true);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit("message", data, true);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    } else {
      const buf = concat(fragments, messageLength);
      if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
        const error = this.createError(
          Error,
          "invalid UTF-8 sequence",
          true,
          1007,
          "WS_ERR_INVALID_UTF8"
        );
        cb(error);
        return;
      }
      if (this._state === INFLATING || this._allowSynchronousEvents) {
        this.emit("message", buf, false);
        this._state = GET_INFO;
      } else {
        this._state = DEFER_EVENT;
        setImmediate(() => {
          this.emit("message", buf, false);
          this._state = GET_INFO;
          this.startLoop(cb);
        });
      }
    }
  }
  /**
   * Handles a control message.
   *
   * @param {Buffer} data Data to handle
   * @return {(Error|RangeError|undefined)} A possible error
   * @private
   */
  controlMessage(data, cb) {
    if (this._opcode === 8) {
      if (data.length === 0) {
        this._loop = false;
        this.emit("conclude", 1005, EMPTY_BUFFER$2);
        this.end();
      } else {
        const code = data.readUInt16BE(0);
        if (!isValidStatusCode$1(code)) {
          const error = this.createError(
            RangeError,
            `invalid status code ${code}`,
            true,
            1002,
            "WS_ERR_INVALID_CLOSE_CODE"
          );
          cb(error);
          return;
        }
        const buf = new FastBuffer(
          data.buffer,
          data.byteOffset + 2,
          data.length - 2
        );
        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
          const error = this.createError(
            Error,
            "invalid UTF-8 sequence",
            true,
            1007,
            "WS_ERR_INVALID_UTF8"
          );
          cb(error);
          return;
        }
        this._loop = false;
        this.emit("conclude", code, buf);
        this.end();
      }
      this._state = GET_INFO;
      return;
    }
    if (this._allowSynchronousEvents) {
      this.emit(this._opcode === 9 ? "ping" : "pong", data);
      this._state = GET_INFO;
    } else {
      this._state = DEFER_EVENT;
      setImmediate(() => {
        this.emit(this._opcode === 9 ? "ping" : "pong", data);
        this._state = GET_INFO;
        this.startLoop(cb);
      });
    }
  }
  /**
   * Builds an error object.
   *
   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
   * @param {String} message The error message
   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
   *     `message`
   * @param {Number} statusCode The status code
   * @param {String} errorCode The exposed error code
   * @return {(Error|RangeError)} The error
   * @private
   */
  createError(ErrorCtor, message, prefix, statusCode, errorCode) {
    this._loop = false;
    this._errored = true;
    const err = new ErrorCtor(
      prefix ? `Invalid WebSocket frame: ${message}` : message
    );
    Error.captureStackTrace(err, this.createError);
    err.code = errorCode;
    err[kStatusCode$1] = statusCode;
    return err;
  }
};
var receiver = Receiver$1;
const { Duplex: Duplex$3 } = require$$0$2;
const { randomFillSync } = require$$1;
const PerMessageDeflate$2 = permessageDeflate;
const { EMPTY_BUFFER: EMPTY_BUFFER$1, kWebSocket: kWebSocket$2, NOOP: NOOP$1 } = constants;
const { isBlob: isBlob$1, isValidStatusCode } = validationExports;
const { mask: applyMask, toBuffer: toBuffer$2 } = bufferUtilExports;
const kByteLength = Symbol("kByteLength");
const maskBuffer = Buffer.alloc(4);
const RANDOM_POOL_SIZE = 8 * 1024;
let randomPool;
let randomPoolPointer = RANDOM_POOL_SIZE;
const DEFAULT = 0;
const DEFLATING = 1;
const GET_BLOB_DATA = 2;
let Sender$1 = class Sender {
  /**
   * Creates a Sender instance.
   *
   * @param {Duplex} socket The connection socket
   * @param {Object} [extensions] An object containing the negotiated extensions
   * @param {Function} [generateMask] The function used to generate the masking
   *     key
   */
  constructor(socket, extensions, generateMask) {
    this._extensions = extensions || {};
    if (generateMask) {
      this._generateMask = generateMask;
      this._maskBuffer = Buffer.alloc(4);
    }
    this._socket = socket;
    this._firstFragment = true;
    this._compress = false;
    this._bufferedBytes = 0;
    this._queue = [];
    this._state = DEFAULT;
    this.onerror = NOOP$1;
    this[kWebSocket$2] = void 0;
  }
  /**
   * Frames a piece of data according to the HyBi WebSocket protocol.
   *
   * @param {(Buffer|String)} data The data to frame
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @return {(Buffer|String)[]} The framed data
   * @public
   */
  static frame(data, options) {
    let mask2;
    let merge = false;
    let offset = 2;
    let skipMasking = false;
    if (options.mask) {
      mask2 = options.maskBuffer || maskBuffer;
      if (options.generateMask) {
        options.generateMask(mask2);
      } else {
        if (randomPoolPointer === RANDOM_POOL_SIZE) {
          if (randomPool === void 0) {
            randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
          }
          randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
          randomPoolPointer = 0;
        }
        mask2[0] = randomPool[randomPoolPointer++];
        mask2[1] = randomPool[randomPoolPointer++];
        mask2[2] = randomPool[randomPoolPointer++];
        mask2[3] = randomPool[randomPoolPointer++];
      }
      skipMasking = (mask2[0] | mask2[1] | mask2[2] | mask2[3]) === 0;
      offset = 6;
    }
    let dataLength;
    if (typeof data === "string") {
      if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
        dataLength = options[kByteLength];
      } else {
        data = Buffer.from(data);
        dataLength = data.length;
      }
    } else {
      dataLength = data.length;
      merge = options.mask && options.readOnly && !skipMasking;
    }
    let payloadLength = dataLength;
    if (dataLength >= 65536) {
      offset += 8;
      payloadLength = 127;
    } else if (dataLength > 125) {
      offset += 2;
      payloadLength = 126;
    }
    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
    target[0] = options.fin ? options.opcode | 128 : options.opcode;
    if (options.rsv1) target[0] |= 64;
    target[1] = payloadLength;
    if (payloadLength === 126) {
      target.writeUInt16BE(dataLength, 2);
    } else if (payloadLength === 127) {
      target[2] = target[3] = 0;
      target.writeUIntBE(dataLength, 4, 6);
    }
    if (!options.mask) return [target, data];
    target[1] |= 128;
    target[offset - 4] = mask2[0];
    target[offset - 3] = mask2[1];
    target[offset - 2] = mask2[2];
    target[offset - 1] = mask2[3];
    if (skipMasking) return [target, data];
    if (merge) {
      applyMask(data, mask2, target, offset, dataLength);
      return [target];
    }
    applyMask(data, mask2, data, 0, dataLength);
    return [target, data];
  }
  /**
   * Sends a close message to the other peer.
   *
   * @param {Number} [code] The status code component of the body
   * @param {(String|Buffer)} [data] The message component of the body
   * @param {Boolean} [mask=false] Specifies whether or not to mask the message
   * @param {Function} [cb] Callback
   * @public
   */
  close(code, data, mask2, cb) {
    let buf;
    if (code === void 0) {
      buf = EMPTY_BUFFER$1;
    } else if (typeof code !== "number" || !isValidStatusCode(code)) {
      throw new TypeError("First argument must be a valid error code number");
    } else if (data === void 0 || !data.length) {
      buf = Buffer.allocUnsafe(2);
      buf.writeUInt16BE(code, 0);
    } else {
      const length = Buffer.byteLength(data);
      if (length > 123) {
        throw new RangeError("The message must not be greater than 123 bytes");
      }
      buf = Buffer.allocUnsafe(2 + length);
      buf.writeUInt16BE(code, 0);
      if (typeof data === "string") {
        buf.write(data, 2);
      } else {
        buf.set(data, 2);
      }
    }
    const options = {
      [kByteLength]: buf.length,
      fin: true,
      generateMask: this._generateMask,
      mask: mask2,
      maskBuffer: this._maskBuffer,
      opcode: 8,
      readOnly: false,
      rsv1: false
    };
    if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, buf, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(buf, options), cb);
    }
  }
  /**
   * Sends a ping message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback
   * @public
   */
  ping(data, mask2, cb) {
    let byteLength;
    let readOnly;
    if (typeof data === "string") {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob$1(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer$2(data);
      byteLength = data.length;
      readOnly = toBuffer$2.readOnly;
    }
    if (byteLength > 125) {
      throw new RangeError("The data size must not be greater than 125 bytes");
    }
    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask: mask2,
      maskBuffer: this._maskBuffer,
      opcode: 9,
      readOnly,
      rsv1: false
    };
    if (isBlob$1(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, false, options, cb]);
      } else {
        this.getBlobData(data, false, options, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(data, options), cb);
    }
  }
  /**
   * Sends a pong message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback
   * @public
   */
  pong(data, mask2, cb) {
    let byteLength;
    let readOnly;
    if (typeof data === "string") {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob$1(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer$2(data);
      byteLength = data.length;
      readOnly = toBuffer$2.readOnly;
    }
    if (byteLength > 125) {
      throw new RangeError("The data size must not be greater than 125 bytes");
    }
    const options = {
      [kByteLength]: byteLength,
      fin: true,
      generateMask: this._generateMask,
      mask: mask2,
      maskBuffer: this._maskBuffer,
      opcode: 10,
      readOnly,
      rsv1: false
    };
    if (isBlob$1(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, false, options, cb]);
      } else {
        this.getBlobData(data, false, options, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, false, options, cb]);
    } else {
      this.sendFrame(Sender.frame(data, options), cb);
    }
  }
  /**
   * Sends a data message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Object} options Options object
   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
   *     or text
   * @param {Boolean} [options.compress=false] Specifies whether or not to
   *     compress `data`
   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Function} [cb] Callback
   * @public
   */
  send(data, options, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate$2.extensionName];
    let opcode = options.binary ? 2 : 1;
    let rsv1 = options.compress;
    let byteLength;
    let readOnly;
    if (typeof data === "string") {
      byteLength = Buffer.byteLength(data);
      readOnly = false;
    } else if (isBlob$1(data)) {
      byteLength = data.size;
      readOnly = false;
    } else {
      data = toBuffer$2(data);
      byteLength = data.length;
      readOnly = toBuffer$2.readOnly;
    }
    if (this._firstFragment) {
      this._firstFragment = false;
      if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
        rsv1 = byteLength >= perMessageDeflate._threshold;
      }
      this._compress = rsv1;
    } else {
      rsv1 = false;
      opcode = 0;
    }
    if (options.fin) this._firstFragment = true;
    const opts = {
      [kByteLength]: byteLength,
      fin: options.fin,
      generateMask: this._generateMask,
      mask: options.mask,
      maskBuffer: this._maskBuffer,
      opcode,
      readOnly,
      rsv1
    };
    if (isBlob$1(data)) {
      if (this._state !== DEFAULT) {
        this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
      } else {
        this.getBlobData(data, this._compress, opts, cb);
      }
    } else if (this._state !== DEFAULT) {
      this.enqueue([this.dispatch, data, this._compress, opts, cb]);
    } else {
      this.dispatch(data, this._compress, opts, cb);
    }
  }
  /**
   * Gets the contents of a blob as binary data.
   *
   * @param {Blob} blob The blob
   * @param {Boolean} [compress=false] Specifies whether or not to compress
   *     the data
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @param {Function} [cb] Callback
   * @private
   */
  getBlobData(blob, compress, options, cb) {
    this._bufferedBytes += options[kByteLength];
    this._state = GET_BLOB_DATA;
    blob.arrayBuffer().then((arrayBuffer) => {
      if (this._socket.destroyed) {
        const err = new Error(
          "The socket was closed while the blob was being read"
        );
        process.nextTick(callCallbacks, this, err, cb);
        return;
      }
      this._bufferedBytes -= options[kByteLength];
      const data = toBuffer$2(arrayBuffer);
      if (!compress) {
        this._state = DEFAULT;
        this.sendFrame(Sender.frame(data, options), cb);
        this.dequeue();
      } else {
        this.dispatch(data, compress, options, cb);
      }
    }).catch((err) => {
      process.nextTick(onError, this, err, cb);
    });
  }
  /**
   * Dispatches a message.
   *
   * @param {(Buffer|String)} data The message to send
   * @param {Boolean} [compress=false] Specifies whether or not to compress
   *     `data`
   * @param {Object} options Options object
   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
   *     FIN bit
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
   *     `data`
   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
   *     key
   * @param {Number} options.opcode The opcode
   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
   *     modified
   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
   *     RSV1 bit
   * @param {Function} [cb] Callback
   * @private
   */
  dispatch(data, compress, options, cb) {
    if (!compress) {
      this.sendFrame(Sender.frame(data, options), cb);
      return;
    }
    const perMessageDeflate = this._extensions[PerMessageDeflate$2.extensionName];
    this._bufferedBytes += options[kByteLength];
    this._state = DEFLATING;
    perMessageDeflate.compress(data, options.fin, (_, buf) => {
      if (this._socket.destroyed) {
        const err = new Error(
          "The socket was closed while data was being compressed"
        );
        callCallbacks(this, err, cb);
        return;
      }
      this._bufferedBytes -= options[kByteLength];
      this._state = DEFAULT;
      options.readOnly = false;
      this.sendFrame(Sender.frame(buf, options), cb);
      this.dequeue();
    });
  }
  /**
   * Executes queued send operations.
   *
   * @private
   */
  dequeue() {
    while (this._state === DEFAULT && this._queue.length) {
      const params = this._queue.shift();
      this._bufferedBytes -= params[3][kByteLength];
      Reflect.apply(params[0], this, params.slice(1));
    }
  }
  /**
   * Enqueues a send operation.
   *
   * @param {Array} params Send operation parameters.
   * @private
   */
  enqueue(params) {
    this._bufferedBytes += params[3][kByteLength];
    this._queue.push(params);
  }
  /**
   * Sends a frame.
   *
   * @param {(Buffer | String)[]} list The frame to send
   * @param {Function} [cb] Callback
   * @private
   */
  sendFrame(list, cb) {
    if (list.length === 2) {
      this._socket.cork();
      this._socket.write(list[0]);
      this._socket.write(list[1], cb);
      this._socket.uncork();
    } else {
      this._socket.write(list[0], cb);
    }
  }
};
var sender = Sender$1;
function callCallbacks(sender2, err, cb) {
  if (typeof cb === "function") cb(err);
  for (let i = 0; i < sender2._queue.length; i++) {
    const params = sender2._queue[i];
    const callback = params[params.length - 1];
    if (typeof callback === "function") callback(err);
  }
}
function onError(sender2, err, cb) {
  callCallbacks(sender2, err, cb);
  sender2.onerror(err);
}
const { kForOnEventAttribute: kForOnEventAttribute$1, kListener: kListener$1 } = constants;
const kCode = Symbol("kCode");
const kData = Symbol("kData");
const kError = Symbol("kError");
const kMessage = Symbol("kMessage");
const kReason = Symbol("kReason");
const kTarget = Symbol("kTarget");
const kType = Symbol("kType");
const kWasClean = Symbol("kWasClean");
let Event$1 = class Event {
  /**
   * Create a new `Event`.
   *
   * @param {String} type The name of the event
   * @throws {TypeError} If the `type` argument is not specified
   */
  constructor(type) {
    this[kTarget] = null;
    this[kType] = type;
  }
  /**
   * @type {*}
   */
  get target() {
    return this[kTarget];
  }
  /**
   * @type {String}
   */
  get type() {
    return this[kType];
  }
};
Object.defineProperty(Event$1.prototype, "target", { enumerable: true });
Object.defineProperty(Event$1.prototype, "type", { enumerable: true });
class CloseEvent extends Event$1 {
  /**
   * Create a new `CloseEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {Number} [options.code=0] The status code explaining why the
   *     connection was closed
   * @param {String} [options.reason=''] A human-readable string explaining why
   *     the connection was closed
   * @param {Boolean} [options.wasClean=false] Indicates whether or not the
   *     connection was cleanly closed
   */
  constructor(type, options = {}) {
    super(type);
    this[kCode] = options.code === void 0 ? 0 : options.code;
    this[kReason] = options.reason === void 0 ? "" : options.reason;
    this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
  }
  /**
   * @type {Number}
   */
  get code() {
    return this[kCode];
  }
  /**
   * @type {String}
   */
  get reason() {
    return this[kReason];
  }
  /**
   * @type {Boolean}
   */
  get wasClean() {
    return this[kWasClean];
  }
}
Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
class ErrorEvent extends Event$1 {
  /**
   * Create a new `ErrorEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {*} [options.error=null] The error that generated this event
   * @param {String} [options.message=''] The error message
   */
  constructor(type, options = {}) {
    super(type);
    this[kError] = options.error === void 0 ? null : options.error;
    this[kMessage] = options.message === void 0 ? "" : options.message;
  }
  /**
   * @type {*}
   */
  get error() {
    return this[kError];
  }
  /**
   * @type {String}
   */
  get message() {
    return this[kMessage];
  }
}
Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
class MessageEvent extends Event$1 {
  /**
   * Create a new `MessageEvent`.
   *
   * @param {String} type The name of the event
   * @param {Object} [options] A dictionary object that allows for setting
   *     attributes via object members of the same name
   * @param {*} [options.data=null] The message content
   */
  constructor(type, options = {}) {
    super(type);
    this[kData] = options.data === void 0 ? null : options.data;
  }
  /**
   * @type {*}
   */
  get data() {
    return this[kData];
  }
}
Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
const EventTarget = {
  /**
   * Register an event listener.
   *
   * @param {String} type A string representing the event type to listen for
   * @param {(Function|Object)} handler The listener to add
   * @param {Object} [options] An options object specifies characteristics about
   *     the event listener
   * @param {Boolean} [options.once=false] A `Boolean` indicating that the
   *     listener should be invoked at most once after being added. If `true`,
   *     the listener would be automatically removed when invoked.
   * @public
   */
  addEventListener(type, handler, options = {}) {
    for (const listener of this.listeners(type)) {
      if (!options[kForOnEventAttribute$1] && listener[kListener$1] === handler && !listener[kForOnEventAttribute$1]) {
        return;
      }
    }
    let wrapper;
    if (type === "message") {
      wrapper = function onMessage(data, isBinary) {
        const event = new MessageEvent("message", {
          data: isBinary ? data : data.toString()
        });
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === "close") {
      wrapper = function onClose(code, message) {
        const event = new CloseEvent("close", {
          code,
          reason: message.toString(),
          wasClean: this._closeFrameReceived && this._closeFrameSent
        });
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === "error") {
      wrapper = function onError2(error) {
        const event = new ErrorEvent("error", {
          error,
          message: error.message
        });
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else if (type === "open") {
      wrapper = function onOpen() {
        const event = new Event$1("open");
        event[kTarget] = this;
        callListener(handler, this, event);
      };
    } else {
      return;
    }
    wrapper[kForOnEventAttribute$1] = !!options[kForOnEventAttribute$1];
    wrapper[kListener$1] = handler;
    if (options.once) {
      this.once(type, wrapper);
    } else {
      this.on(type, wrapper);
    }
  },
  /**
   * Remove an event listener.
   *
   * @param {String} type A string representing the event type to remove
   * @param {(Function|Object)} handler The listener to remove
   * @public
   */
  removeEventListener(type, handler) {
    for (const listener of this.listeners(type)) {
      if (listener[kListener$1] === handler && !listener[kForOnEventAttribute$1]) {
        this.removeListener(type, listener);
        break;
      }
    }
  }
};
var eventTarget = {
  EventTarget
};
function callListener(listener, thisArg, event) {
  if (typeof listener === "object" && listener.handleEvent) {
    listener.handleEvent.call(listener, event);
  } else {
    listener.call(thisArg, event);
  }
}
const { tokenChars: tokenChars$1 } = validationExports;
function push(dest, name, elem) {
  if (dest[name] === void 0) dest[name] = [elem];
  else dest[name].push(elem);
}
function parse$2(header) {
  const offers = /* @__PURE__ */ Object.create(null);
  let params = /* @__PURE__ */ Object.create(null);
  let mustUnescape = false;
  let isEscaping = false;
  let inQuotes = false;
  let extensionName;
  let paramName;
  let start = -1;
  let code = -1;
  let end = -1;
  let i = 0;
  for (; i < header.length; i++) {
    code = header.charCodeAt(i);
    if (extensionName === void 0) {
      if (end === -1 && tokenChars$1[code] === 1) {
        if (start === -1) start = i;
      } else if (i !== 0 && (code === 32 || code === 9)) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 59 || code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        const name = header.slice(start, end);
        if (code === 44) {
          push(offers, name, params);
          params = /* @__PURE__ */ Object.create(null);
        } else {
          extensionName = name;
        }
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else if (paramName === void 0) {
      if (end === -1 && tokenChars$1[code] === 1) {
        if (start === -1) start = i;
      } else if (code === 32 || code === 9) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 59 || code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        push(params, header.slice(start, end), true);
        if (code === 44) {
          push(offers, extensionName, params);
          params = /* @__PURE__ */ Object.create(null);
          extensionName = void 0;
        }
        start = end = -1;
      } else if (code === 61 && start !== -1 && end === -1) {
        paramName = header.slice(start, i);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else {
      if (isEscaping) {
        if (tokenChars$1[code] !== 1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (start === -1) start = i;
        else if (!mustUnescape) mustUnescape = true;
        isEscaping = false;
      } else if (inQuotes) {
        if (tokenChars$1[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 34 && start !== -1) {
          inQuotes = false;
          end = i;
        } else if (code === 92) {
          isEscaping = true;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
        inQuotes = true;
      } else if (end === -1 && tokenChars$1[code] === 1) {
        if (start === -1) start = i;
      } else if (start !== -1 && (code === 32 || code === 9)) {
        if (end === -1) end = i;
      } else if (code === 59 || code === 44) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (end === -1) end = i;
        let value = header.slice(start, end);
        if (mustUnescape) {
          value = value.replace(/\\/g, "");
          mustUnescape = false;
        }
        push(params, paramName, value);
        if (code === 44) {
          push(offers, extensionName, params);
          params = /* @__PURE__ */ Object.create(null);
          extensionName = void 0;
        }
        paramName = void 0;
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
  }
  if (start === -1 || inQuotes || code === 32 || code === 9) {
    throw new SyntaxError("Unexpected end of input");
  }
  if (end === -1) end = i;
  const token = header.slice(start, end);
  if (extensionName === void 0) {
    push(offers, token, params);
  } else {
    if (paramName === void 0) {
      push(params, token, true);
    } else if (mustUnescape) {
      push(params, paramName, token.replace(/\\/g, ""));
    } else {
      push(params, paramName, token);
    }
    push(offers, extensionName, params);
  }
  return offers;
}
function format$1(extensions) {
  return Object.keys(extensions).map((extension2) => {
    let configurations = extensions[extension2];
    if (!Array.isArray(configurations)) configurations = [configurations];
    return configurations.map((params) => {
      return [extension2].concat(
        Object.keys(params).map((k) => {
          let values = params[k];
          if (!Array.isArray(values)) values = [values];
          return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
        })
      ).join("; ");
    }).join(", ");
  }).join(", ");
}
var extension$1 = { format: format$1, parse: parse$2 };
const EventEmitter$1 = require$$0$3;
const https$1 = require$$1$1;
const http$2 = require$$1$2;
const net$1 = require$$0$4;
const tls$1 = require$$4;
const { randomBytes, createHash: createHash$1 } = require$$1;
const { Duplex: Duplex$2, Readable } = require$$0$2;
const { URL: URL$1 } = require$$7;
const PerMessageDeflate$1 = permessageDeflate;
const Receiver2 = receiver;
const Sender2 = sender;
const { isBlob } = validationExports;
const {
  BINARY_TYPES,
  EMPTY_BUFFER,
  GUID: GUID$1,
  kForOnEventAttribute,
  kListener,
  kStatusCode,
  kWebSocket: kWebSocket$1,
  NOOP
} = constants;
const {
  EventTarget: { addEventListener, removeEventListener }
} = eventTarget;
const { format, parse: parse$1 } = extension$1;
const { toBuffer: toBuffer$1 } = bufferUtilExports;
const closeTimeout = 30 * 1e3;
const kAborted = Symbol("kAborted");
const protocolVersions = [8, 13];
const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
let WebSocket$2 = class WebSocket extends EventEmitter$1 {
  /**
   * Create a new `WebSocket`.
   *
   * @param {(String|URL)} address The URL to which to connect
   * @param {(String|String[])} [protocols] The subprotocols
   * @param {Object} [options] Connection options
   */
  constructor(address, protocols, options) {
    super();
    this._binaryType = BINARY_TYPES[0];
    this._closeCode = 1006;
    this._closeFrameReceived = false;
    this._closeFrameSent = false;
    this._closeMessage = EMPTY_BUFFER;
    this._closeTimer = null;
    this._errorEmitted = false;
    this._extensions = {};
    this._paused = false;
    this._protocol = "";
    this._readyState = WebSocket.CONNECTING;
    this._receiver = null;
    this._sender = null;
    this._socket = null;
    if (address !== null) {
      this._bufferedAmount = 0;
      this._isServer = false;
      this._redirects = 0;
      if (protocols === void 0) {
        protocols = [];
      } else if (!Array.isArray(protocols)) {
        if (typeof protocols === "object" && protocols !== null) {
          options = protocols;
          protocols = [];
        } else {
          protocols = [protocols];
        }
      }
      initAsClient(this, address, protocols, options);
    } else {
      this._autoPong = options.autoPong;
      this._isServer = true;
    }
  }
  /**
   * For historical reasons, the custom "nodebuffer" type is used by the default
   * instead of "blob".
   *
   * @type {String}
   */
  get binaryType() {
    return this._binaryType;
  }
  set binaryType(type) {
    if (!BINARY_TYPES.includes(type)) return;
    this._binaryType = type;
    if (this._receiver) this._receiver._binaryType = type;
  }
  /**
   * @type {Number}
   */
  get bufferedAmount() {
    if (!this._socket) return this._bufferedAmount;
    return this._socket._writableState.length + this._sender._bufferedBytes;
  }
  /**
   * @type {String}
   */
  get extensions() {
    return Object.keys(this._extensions).join();
  }
  /**
   * @type {Boolean}
   */
  get isPaused() {
    return this._paused;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onclose() {
    return null;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onerror() {
    return null;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onopen() {
    return null;
  }
  /**
   * @type {Function}
   */
  /* istanbul ignore next */
  get onmessage() {
    return null;
  }
  /**
   * @type {String}
   */
  get protocol() {
    return this._protocol;
  }
  /**
   * @type {Number}
   */
  get readyState() {
    return this._readyState;
  }
  /**
   * @type {String}
   */
  get url() {
    return this._url;
  }
  /**
   * Set up the socket and the internal resources.
   *
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Object} options Options object
   * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {Function} [options.generateMask] The function used to generate the
   *     masking key
   * @param {Number} [options.maxPayload=0] The maximum allowed message size
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @private
   */
  setSocket(socket, head, options) {
    const receiver2 = new Receiver2({
      allowSynchronousEvents: options.allowSynchronousEvents,
      binaryType: this.binaryType,
      extensions: this._extensions,
      isServer: this._isServer,
      maxPayload: options.maxPayload,
      skipUTF8Validation: options.skipUTF8Validation
    });
    const sender2 = new Sender2(socket, this._extensions, options.generateMask);
    this._receiver = receiver2;
    this._sender = sender2;
    this._socket = socket;
    receiver2[kWebSocket$1] = this;
    sender2[kWebSocket$1] = this;
    socket[kWebSocket$1] = this;
    receiver2.on("conclude", receiverOnConclude);
    receiver2.on("drain", receiverOnDrain);
    receiver2.on("error", receiverOnError);
    receiver2.on("message", receiverOnMessage);
    receiver2.on("ping", receiverOnPing);
    receiver2.on("pong", receiverOnPong);
    sender2.onerror = senderOnError;
    if (socket.setTimeout) socket.setTimeout(0);
    if (socket.setNoDelay) socket.setNoDelay();
    if (head.length > 0) socket.unshift(head);
    socket.on("close", socketOnClose);
    socket.on("data", socketOnData);
    socket.on("end", socketOnEnd);
    socket.on("error", socketOnError$1);
    this._readyState = WebSocket.OPEN;
    this.emit("open");
  }
  /**
   * Emit the `'close'` event.
   *
   * @private
   */
  emitClose() {
    if (!this._socket) {
      this._readyState = WebSocket.CLOSED;
      this.emit("close", this._closeCode, this._closeMessage);
      return;
    }
    if (this._extensions[PerMessageDeflate$1.extensionName]) {
      this._extensions[PerMessageDeflate$1.extensionName].cleanup();
    }
    this._receiver.removeAllListeners();
    this._readyState = WebSocket.CLOSED;
    this.emit("close", this._closeCode, this._closeMessage);
  }
  /**
   * Start a closing handshake.
   *
   *          +----------+   +-----------+   +----------+
   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
   *    |     +----------+   +-----------+   +----------+     |
   *          +----------+   +-----------+         |
   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
   *          +----------+   +-----------+   |
   *    |           |                        |   +---+        |
   *                +------------------------+-->|fin| - - - -
   *    |         +---+                      |   +---+
   *     - - - - -|fin|<---------------------+
   *              +---+
   *
   * @param {Number} [code] Status code explaining why the connection is closing
   * @param {(String|Buffer)} [data] The reason why the connection is
   *     closing
   * @public
   */
  close(code, data) {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake$1(this, this._req, msg);
      return;
    }
    if (this.readyState === WebSocket.CLOSING) {
      if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
        this._socket.end();
      }
      return;
    }
    this._readyState = WebSocket.CLOSING;
    this._sender.close(code, data, !this._isServer, (err) => {
      if (err) return;
      this._closeFrameSent = true;
      if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
        this._socket.end();
      }
    });
    setCloseTimer(this);
  }
  /**
   * Pause the socket.
   *
   * @public
   */
  pause() {
    if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
      return;
    }
    this._paused = true;
    this._socket.pause();
  }
  /**
   * Send a ping.
   *
   * @param {*} [data] The data to send
   * @param {Boolean} [mask] Indicates whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when the ping is sent
   * @public
   */
  ping(data, mask2, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }
    if (typeof data === "function") {
      cb = data;
      data = mask2 = void 0;
    } else if (typeof mask2 === "function") {
      cb = mask2;
      mask2 = void 0;
    }
    if (typeof data === "number") data = data.toString();
    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }
    if (mask2 === void 0) mask2 = !this._isServer;
    this._sender.ping(data || EMPTY_BUFFER, mask2, cb);
  }
  /**
   * Send a pong.
   *
   * @param {*} [data] The data to send
   * @param {Boolean} [mask] Indicates whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when the pong is sent
   * @public
   */
  pong(data, mask2, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }
    if (typeof data === "function") {
      cb = data;
      data = mask2 = void 0;
    } else if (typeof mask2 === "function") {
      cb = mask2;
      mask2 = void 0;
    }
    if (typeof data === "number") data = data.toString();
    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }
    if (mask2 === void 0) mask2 = !this._isServer;
    this._sender.pong(data || EMPTY_BUFFER, mask2, cb);
  }
  /**
   * Resume the socket.
   *
   * @public
   */
  resume() {
    if (this.readyState === WebSocket.CONNECTING || this.readyState === WebSocket.CLOSED) {
      return;
    }
    this._paused = false;
    if (!this._receiver._writableState.needDrain) this._socket.resume();
  }
  /**
   * Send a data message.
   *
   * @param {*} data The message to send
   * @param {Object} [options] Options object
   * @param {Boolean} [options.binary] Specifies whether `data` is binary or
   *     text
   * @param {Boolean} [options.compress] Specifies whether or not to compress
   *     `data`
   * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
   *     last one
   * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
   * @param {Function} [cb] Callback which is executed when data is written out
   * @public
   */
  send(data, options, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }
    if (typeof options === "function") {
      cb = options;
      options = {};
    }
    if (typeof data === "number") data = data.toString();
    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }
    const opts = {
      binary: typeof data !== "string",
      mask: !this._isServer,
      compress: true,
      fin: true,
      ...options
    };
    if (!this._extensions[PerMessageDeflate$1.extensionName]) {
      opts.compress = false;
    }
    this._sender.send(data || EMPTY_BUFFER, opts, cb);
  }
  /**
   * Forcibly close the connection.
   *
   * @public
   */
  terminate() {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake$1(this, this._req, msg);
      return;
    }
    if (this._socket) {
      this._readyState = WebSocket.CLOSING;
      this._socket.destroy();
    }
  }
};
Object.defineProperty(WebSocket$2, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING")
});
Object.defineProperty(WebSocket$2.prototype, "CONNECTING", {
  enumerable: true,
  value: readyStates.indexOf("CONNECTING")
});
Object.defineProperty(WebSocket$2, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN")
});
Object.defineProperty(WebSocket$2.prototype, "OPEN", {
  enumerable: true,
  value: readyStates.indexOf("OPEN")
});
Object.defineProperty(WebSocket$2, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING")
});
Object.defineProperty(WebSocket$2.prototype, "CLOSING", {
  enumerable: true,
  value: readyStates.indexOf("CLOSING")
});
Object.defineProperty(WebSocket$2, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED")
});
Object.defineProperty(WebSocket$2.prototype, "CLOSED", {
  enumerable: true,
  value: readyStates.indexOf("CLOSED")
});
[
  "binaryType",
  "bufferedAmount",
  "extensions",
  "isPaused",
  "protocol",
  "readyState",
  "url"
].forEach((property) => {
  Object.defineProperty(WebSocket$2.prototype, property, { enumerable: true });
});
["open", "error", "close", "message"].forEach((method) => {
  Object.defineProperty(WebSocket$2.prototype, `on${method}`, {
    enumerable: true,
    get() {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) return listener[kListener];
      }
      return null;
    },
    set(handler) {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) {
          this.removeListener(method, listener);
          break;
        }
      }
      if (typeof handler !== "function") return;
      this.addEventListener(method, handler, {
        [kForOnEventAttribute]: true
      });
    }
  });
});
WebSocket$2.prototype.addEventListener = addEventListener;
WebSocket$2.prototype.removeEventListener = removeEventListener;
var websocket = WebSocket$2;
function initAsClient(websocket2, address, protocols, options) {
  const opts = {
    allowSynchronousEvents: true,
    autoPong: true,
    protocolVersion: protocolVersions[1],
    maxPayload: 100 * 1024 * 1024,
    skipUTF8Validation: false,
    perMessageDeflate: true,
    followRedirects: false,
    maxRedirects: 10,
    ...options,
    socketPath: void 0,
    hostname: void 0,
    protocol: void 0,
    timeout: void 0,
    method: "GET",
    host: void 0,
    path: void 0,
    port: void 0
  };
  websocket2._autoPong = opts.autoPong;
  if (!protocolVersions.includes(opts.protocolVersion)) {
    throw new RangeError(
      `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
    );
  }
  let parsedUrl;
  if (address instanceof URL$1) {
    parsedUrl = address;
  } else {
    try {
      parsedUrl = new URL$1(address);
    } catch (e) {
      throw new SyntaxError(`Invalid URL: ${address}`);
    }
  }
  if (parsedUrl.protocol === "http:") {
    parsedUrl.protocol = "ws:";
  } else if (parsedUrl.protocol === "https:") {
    parsedUrl.protocol = "wss:";
  }
  websocket2._url = parsedUrl.href;
  const isSecure = parsedUrl.protocol === "wss:";
  const isIpcUrl = parsedUrl.protocol === "ws+unix:";
  let invalidUrlMessage;
  if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
    invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
  } else if (isIpcUrl && !parsedUrl.pathname) {
    invalidUrlMessage = "The URL's pathname is empty";
  } else if (parsedUrl.hash) {
    invalidUrlMessage = "The URL contains a fragment identifier";
  }
  if (invalidUrlMessage) {
    const err = new SyntaxError(invalidUrlMessage);
    if (websocket2._redirects === 0) {
      throw err;
    } else {
      emitErrorAndClose(websocket2, err);
      return;
    }
  }
  const defaultPort = isSecure ? 443 : 80;
  const key = randomBytes(16).toString("base64");
  const request = isSecure ? https$1.request : http$2.request;
  const protocolSet = /* @__PURE__ */ new Set();
  let perMessageDeflate;
  opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
  opts.defaultPort = opts.defaultPort || defaultPort;
  opts.port = parsedUrl.port || defaultPort;
  opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
  opts.headers = {
    ...opts.headers,
    "Sec-WebSocket-Version": opts.protocolVersion,
    "Sec-WebSocket-Key": key,
    Connection: "Upgrade",
    Upgrade: "websocket"
  };
  opts.path = parsedUrl.pathname + parsedUrl.search;
  opts.timeout = opts.handshakeTimeout;
  if (opts.perMessageDeflate) {
    perMessageDeflate = new PerMessageDeflate$1(
      opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
      false,
      opts.maxPayload
    );
    opts.headers["Sec-WebSocket-Extensions"] = format({
      [PerMessageDeflate$1.extensionName]: perMessageDeflate.offer()
    });
  }
  if (protocols.length) {
    for (const protocol of protocols) {
      if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
        throw new SyntaxError(
          "An invalid or duplicated subprotocol was specified"
        );
      }
      protocolSet.add(protocol);
    }
    opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
  }
  if (opts.origin) {
    if (opts.protocolVersion < 13) {
      opts.headers["Sec-WebSocket-Origin"] = opts.origin;
    } else {
      opts.headers.Origin = opts.origin;
    }
  }
  if (parsedUrl.username || parsedUrl.password) {
    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
  }
  if (isIpcUrl) {
    const parts = opts.path.split(":");
    opts.socketPath = parts[0];
    opts.path = parts[1];
  }
  let req2;
  if (opts.followRedirects) {
    if (websocket2._redirects === 0) {
      websocket2._originalIpc = isIpcUrl;
      websocket2._originalSecure = isSecure;
      websocket2._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
      const headers = options && options.headers;
      options = { ...options, headers: {} };
      if (headers) {
        for (const [key2, value] of Object.entries(headers)) {
          options.headers[key2.toLowerCase()] = value;
        }
      }
    } else if (websocket2.listenerCount("redirect") === 0) {
      const isSameHost = isIpcUrl ? websocket2._originalIpc ? opts.socketPath === websocket2._originalHostOrSocketPath : false : websocket2._originalIpc ? false : parsedUrl.host === websocket2._originalHostOrSocketPath;
      if (!isSameHost || websocket2._originalSecure && !isSecure) {
        delete opts.headers.authorization;
        delete opts.headers.cookie;
        if (!isSameHost) delete opts.headers.host;
        opts.auth = void 0;
      }
    }
    if (opts.auth && !options.headers.authorization) {
      options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
    }
    req2 = websocket2._req = request(opts);
    if (websocket2._redirects) {
      websocket2.emit("redirect", websocket2.url, req2);
    }
  } else {
    req2 = websocket2._req = request(opts);
  }
  if (opts.timeout) {
    req2.on("timeout", () => {
      abortHandshake$1(websocket2, req2, "Opening handshake has timed out");
    });
  }
  req2.on("error", (err) => {
    if (req2 === null || req2[kAborted]) return;
    req2 = websocket2._req = null;
    emitErrorAndClose(websocket2, err);
  });
  req2.on("response", (res) => {
    const location = res.headers.location;
    const statusCode = res.statusCode;
    if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
      if (++websocket2._redirects > opts.maxRedirects) {
        abortHandshake$1(websocket2, req2, "Maximum redirects exceeded");
        return;
      }
      req2.abort();
      let addr;
      try {
        addr = new URL$1(location, address);
      } catch (e) {
        const err = new SyntaxError(`Invalid URL: ${location}`);
        emitErrorAndClose(websocket2, err);
        return;
      }
      initAsClient(websocket2, addr, protocols, options);
    } else if (!websocket2.emit("unexpected-response", req2, res)) {
      abortHandshake$1(
        websocket2,
        req2,
        `Unexpected server response: ${res.statusCode}`
      );
    }
  });
  req2.on("upgrade", (res, socket, head) => {
    websocket2.emit("upgrade", res);
    if (websocket2.readyState !== WebSocket$2.CONNECTING) return;
    req2 = websocket2._req = null;
    const upgrade = res.headers.upgrade;
    if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
      abortHandshake$1(websocket2, socket, "Invalid Upgrade header");
      return;
    }
    const digest = createHash$1("sha1").update(key + GUID$1).digest("base64");
    if (res.headers["sec-websocket-accept"] !== digest) {
      abortHandshake$1(websocket2, socket, "Invalid Sec-WebSocket-Accept header");
      return;
    }
    const serverProt = res.headers["sec-websocket-protocol"];
    let protError;
    if (serverProt !== void 0) {
      if (!protocolSet.size) {
        protError = "Server sent a subprotocol but none was requested";
      } else if (!protocolSet.has(serverProt)) {
        protError = "Server sent an invalid subprotocol";
      }
    } else if (protocolSet.size) {
      protError = "Server sent no subprotocol";
    }
    if (protError) {
      abortHandshake$1(websocket2, socket, protError);
      return;
    }
    if (serverProt) websocket2._protocol = serverProt;
    const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
    if (secWebSocketExtensions !== void 0) {
      if (!perMessageDeflate) {
        const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      let extensions;
      try {
        extensions = parse$1(secWebSocketExtensions);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Extensions header";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      const extensionNames = Object.keys(extensions);
      if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate$1.extensionName) {
        const message = "Server indicated an extension that was not requested";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      try {
        perMessageDeflate.accept(extensions[PerMessageDeflate$1.extensionName]);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Extensions header";
        abortHandshake$1(websocket2, socket, message);
        return;
      }
      websocket2._extensions[PerMessageDeflate$1.extensionName] = perMessageDeflate;
    }
    websocket2.setSocket(socket, head, {
      allowSynchronousEvents: opts.allowSynchronousEvents,
      generateMask: opts.generateMask,
      maxPayload: opts.maxPayload,
      skipUTF8Validation: opts.skipUTF8Validation
    });
  });
  if (opts.finishRequest) {
    opts.finishRequest(req2, websocket2);
  } else {
    req2.end();
  }
}
function emitErrorAndClose(websocket2, err) {
  websocket2._readyState = WebSocket$2.CLOSING;
  websocket2._errorEmitted = true;
  websocket2.emit("error", err);
  websocket2.emitClose();
}
function netConnect(options) {
  options.path = options.socketPath;
  return net$1.connect(options);
}
function tlsConnect(options) {
  options.path = void 0;
  if (!options.servername && options.servername !== "") {
    options.servername = net$1.isIP(options.host) ? "" : options.host;
  }
  return tls$1.connect(options);
}
function abortHandshake$1(websocket2, stream2, message) {
  websocket2._readyState = WebSocket$2.CLOSING;
  const err = new Error(message);
  Error.captureStackTrace(err, abortHandshake$1);
  if (stream2.setHeader) {
    stream2[kAborted] = true;
    stream2.abort();
    if (stream2.socket && !stream2.socket.destroyed) {
      stream2.socket.destroy();
    }
    process.nextTick(emitErrorAndClose, websocket2, err);
  } else {
    stream2.destroy(err);
    stream2.once("error", websocket2.emit.bind(websocket2, "error"));
    stream2.once("close", websocket2.emitClose.bind(websocket2));
  }
}
function sendAfterClose(websocket2, data, cb) {
  if (data) {
    const length = isBlob(data) ? data.size : toBuffer$1(data).length;
    if (websocket2._socket) websocket2._sender._bufferedBytes += length;
    else websocket2._bufferedAmount += length;
  }
  if (cb) {
    const err = new Error(
      `WebSocket is not open: readyState ${websocket2.readyState} (${readyStates[websocket2.readyState]})`
    );
    process.nextTick(cb, err);
  }
}
function receiverOnConclude(code, reason) {
  const websocket2 = this[kWebSocket$1];
  websocket2._closeFrameReceived = true;
  websocket2._closeMessage = reason;
  websocket2._closeCode = code;
  if (websocket2._socket[kWebSocket$1] === void 0) return;
  websocket2._socket.removeListener("data", socketOnData);
  process.nextTick(resume$1, websocket2._socket);
  if (code === 1005) websocket2.close();
  else websocket2.close(code, reason);
}
function receiverOnDrain() {
  const websocket2 = this[kWebSocket$1];
  if (!websocket2.isPaused) websocket2._socket.resume();
}
function receiverOnError(err) {
  const websocket2 = this[kWebSocket$1];
  if (websocket2._socket[kWebSocket$1] !== void 0) {
    websocket2._socket.removeListener("data", socketOnData);
    process.nextTick(resume$1, websocket2._socket);
    websocket2.close(err[kStatusCode]);
  }
  if (!websocket2._errorEmitted) {
    websocket2._errorEmitted = true;
    websocket2.emit("error", err);
  }
}
function receiverOnFinish() {
  this[kWebSocket$1].emitClose();
}
function receiverOnMessage(data, isBinary) {
  this[kWebSocket$1].emit("message", data, isBinary);
}
function receiverOnPing(data) {
  const websocket2 = this[kWebSocket$1];
  if (websocket2._autoPong) websocket2.pong(data, !this._isServer, NOOP);
  websocket2.emit("ping", data);
}
function receiverOnPong(data) {
  this[kWebSocket$1].emit("pong", data);
}
function resume$1(stream2) {
  stream2.resume();
}
function senderOnError(err) {
  const websocket2 = this[kWebSocket$1];
  if (websocket2.readyState === WebSocket$2.CLOSED) return;
  if (websocket2.readyState === WebSocket$2.OPEN) {
    websocket2._readyState = WebSocket$2.CLOSING;
    setCloseTimer(websocket2);
  }
  this._socket.end();
  if (!websocket2._errorEmitted) {
    websocket2._errorEmitted = true;
    websocket2.emit("error", err);
  }
}
function setCloseTimer(websocket2) {
  websocket2._closeTimer = setTimeout(
    websocket2._socket.destroy.bind(websocket2._socket),
    closeTimeout
  );
}
function socketOnClose() {
  const websocket2 = this[kWebSocket$1];
  this.removeListener("close", socketOnClose);
  this.removeListener("data", socketOnData);
  this.removeListener("end", socketOnEnd);
  websocket2._readyState = WebSocket$2.CLOSING;
  let chunk;
  if (!this._readableState.endEmitted && !websocket2._closeFrameReceived && !websocket2._receiver._writableState.errorEmitted && (chunk = websocket2._socket.read()) !== null) {
    websocket2._receiver.write(chunk);
  }
  websocket2._receiver.end();
  this[kWebSocket$1] = void 0;
  clearTimeout(websocket2._closeTimer);
  if (websocket2._receiver._writableState.finished || websocket2._receiver._writableState.errorEmitted) {
    websocket2.emitClose();
  } else {
    websocket2._receiver.on("error", receiverOnFinish);
    websocket2._receiver.on("finish", receiverOnFinish);
  }
}
function socketOnData(chunk) {
  if (!this[kWebSocket$1]._receiver.write(chunk)) {
    this.pause();
  }
}
function socketOnEnd() {
  const websocket2 = this[kWebSocket$1];
  websocket2._readyState = WebSocket$2.CLOSING;
  websocket2._receiver.end();
  this.end();
}
function socketOnError$1() {
  const websocket2 = this[kWebSocket$1];
  this.removeListener("error", socketOnError$1);
  this.on("error", NOOP);
  if (websocket2) {
    websocket2._readyState = WebSocket$2.CLOSING;
    this.destroy();
  }
}
const { Duplex: Duplex$1 } = require$$0$2;
function emitClose$1(stream2) {
  stream2.emit("close");
}
function duplexOnEnd() {
  if (!this.destroyed && this._writableState.finished) {
    this.destroy();
  }
}
function duplexOnError(err) {
  this.removeListener("error", duplexOnError);
  this.destroy();
  if (this.listenerCount("error") === 0) {
    this.emit("error", err);
  }
}
function createWebSocketStream(ws2, options) {
  let terminateOnDestroy = true;
  const duplex = new Duplex$1({
    ...options,
    autoDestroy: false,
    emitClose: false,
    objectMode: false,
    writableObjectMode: false
  });
  ws2.on("message", function message(msg, isBinary) {
    const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
    if (!duplex.push(data)) ws2.pause();
  });
  ws2.once("error", function error(err) {
    if (duplex.destroyed) return;
    terminateOnDestroy = false;
    duplex.destroy(err);
  });
  ws2.once("close", function close() {
    if (duplex.destroyed) return;
    duplex.push(null);
  });
  duplex._destroy = function(err, callback) {
    if (ws2.readyState === ws2.CLOSED) {
      callback(err);
      process.nextTick(emitClose$1, duplex);
      return;
    }
    let called = false;
    ws2.once("error", function error(err2) {
      called = true;
      callback(err2);
    });
    ws2.once("close", function close() {
      if (!called) callback(err);
      process.nextTick(emitClose$1, duplex);
    });
    if (terminateOnDestroy) ws2.terminate();
  };
  duplex._final = function(callback) {
    if (ws2.readyState === ws2.CONNECTING) {
      ws2.once("open", function open() {
        duplex._final(callback);
      });
      return;
    }
    if (ws2._socket === null) return;
    if (ws2._socket._writableState.finished) {
      callback();
      if (duplex._readableState.endEmitted) duplex.destroy();
    } else {
      ws2._socket.once("finish", function finish() {
        callback();
      });
      ws2.close();
    }
  };
  duplex._read = function() {
    if (ws2.isPaused) ws2.resume();
  };
  duplex._write = function(chunk, encoding, callback) {
    if (ws2.readyState === ws2.CONNECTING) {
      ws2.once("open", function open() {
        duplex._write(chunk, encoding, callback);
      });
      return;
    }
    ws2.send(chunk, callback);
  };
  duplex.on("end", duplexOnEnd);
  duplex.on("error", duplexOnError);
  return duplex;
}
var stream = createWebSocketStream;
const { tokenChars } = validationExports;
function parse(header) {
  const protocols = /* @__PURE__ */ new Set();
  let start = -1;
  let end = -1;
  let i = 0;
  for (i; i < header.length; i++) {
    const code = header.charCodeAt(i);
    if (end === -1 && tokenChars[code] === 1) {
      if (start === -1) start = i;
    } else if (i !== 0 && (code === 32 || code === 9)) {
      if (end === -1 && start !== -1) end = i;
    } else if (code === 44) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
      if (end === -1) end = i;
      const protocol2 = header.slice(start, end);
      if (protocols.has(protocol2)) {
        throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
      }
      protocols.add(protocol2);
      start = end = -1;
    } else {
      throw new SyntaxError(`Unexpected character at index ${i}`);
    }
  }
  if (start === -1 || end !== -1) {
    throw new SyntaxError("Unexpected end of input");
  }
  const protocol = header.slice(start, i);
  if (protocols.has(protocol)) {
    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
  }
  protocols.add(protocol);
  return protocols;
}
var subprotocol$1 = { parse };
const EventEmitter = require$$0$3;
const http$1 = require$$1$2;
const { Duplex } = require$$0$2;
const { createHash } = require$$1;
const extension = extension$1;
const PerMessageDeflate2 = permessageDeflate;
const subprotocol = subprotocol$1;
const WebSocket$1 = websocket;
const { GUID, kWebSocket } = constants;
const keyRegex = /^[+/0-9A-Za-z]{22}==$/;
const RUNNING = 0;
const CLOSING = 1;
const CLOSED = 2;
class WebSocketServer extends EventEmitter {
  /**
   * Create a `WebSocketServer` instance.
   *
   * @param {Object} options Configuration options
   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
   *     multiple times in the same tick
   * @param {Boolean} [options.autoPong=true] Specifies whether or not to
   *     automatically send a pong in response to a ping
   * @param {Number} [options.backlog=511] The maximum length of the queue of
   *     pending connections
   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
   *     track clients
   * @param {Function} [options.handleProtocols] A hook to handle protocols
   * @param {String} [options.host] The hostname where to bind the server
   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
   *     size
   * @param {Boolean} [options.noServer=false] Enable no server mode
   * @param {String} [options.path] Accept only connections matching this path
   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
   *     permessage-deflate
   * @param {Number} [options.port] The port where to bind the server
   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
   *     server to use
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
   *     not to skip UTF-8 validation for text and close messages
   * @param {Function} [options.verifyClient] A hook to reject connections
   * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
   *     class to use. It must be the `WebSocket` class or class that extends it
   * @param {Function} [callback] A listener for the `listening` event
   */
  constructor(options, callback) {
    super();
    options = {
      allowSynchronousEvents: true,
      autoPong: true,
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: false,
      handleProtocols: null,
      clientTracking: true,
      verifyClient: null,
      noServer: false,
      backlog: null,
      // use default (511 as implemented in net.js)
      server: null,
      host: null,
      path: null,
      port: null,
      WebSocket: WebSocket$1,
      ...options
    };
    if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
      throw new TypeError(
        'One and only one of the "port", "server", or "noServer" options must be specified'
      );
    }
    if (options.port != null) {
      this._server = http$1.createServer((req2, res) => {
        const body = http$1.STATUS_CODES[426];
        res.writeHead(426, {
          "Content-Length": body.length,
          "Content-Type": "text/plain"
        });
        res.end(body);
      });
      this._server.listen(
        options.port,
        options.host,
        options.backlog,
        callback
      );
    } else if (options.server) {
      this._server = options.server;
    }
    if (this._server) {
      const emitConnection = this.emit.bind(this, "connection");
      this._removeListeners = addListeners(this._server, {
        listening: this.emit.bind(this, "listening"),
        error: this.emit.bind(this, "error"),
        upgrade: (req2, socket, head) => {
          this.handleUpgrade(req2, socket, head, emitConnection);
        }
      });
    }
    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
    if (options.clientTracking) {
      this.clients = /* @__PURE__ */ new Set();
      this._shouldEmitClose = false;
    }
    this.options = options;
    this._state = RUNNING;
  }
  /**
   * Returns the bound address, the address family name, and port of the server
   * as reported by the operating system if listening on an IP socket.
   * If the server is listening on a pipe or UNIX domain socket, the name is
   * returned as a string.
   *
   * @return {(Object|String|null)} The address of the server
   * @public
   */
  address() {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }
    if (!this._server) return null;
    return this._server.address();
  }
  /**
   * Stop the server from accepting new connections and emit the `'close'` event
   * when all existing connections are closed.
   *
   * @param {Function} [cb] A one-time listener for the `'close'` event
   * @public
   */
  close(cb) {
    if (this._state === CLOSED) {
      if (cb) {
        this.once("close", () => {
          cb(new Error("The server is not running"));
        });
      }
      process.nextTick(emitClose, this);
      return;
    }
    if (cb) this.once("close", cb);
    if (this._state === CLOSING) return;
    this._state = CLOSING;
    if (this.options.noServer || this.options.server) {
      if (this._server) {
        this._removeListeners();
        this._removeListeners = this._server = null;
      }
      if (this.clients) {
        if (!this.clients.size) {
          process.nextTick(emitClose, this);
        } else {
          this._shouldEmitClose = true;
        }
      } else {
        process.nextTick(emitClose, this);
      }
    } else {
      const server = this._server;
      this._removeListeners();
      this._removeListeners = this._server = null;
      server.close(() => {
        emitClose(this);
      });
    }
  }
  /**
   * See if a given request should be handled by this server instance.
   *
   * @param {http.IncomingMessage} req Request object to inspect
   * @return {Boolean} `true` if the request is valid, else `false`
   * @public
   */
  shouldHandle(req2) {
    if (this.options.path) {
      const index = req2.url.indexOf("?");
      const pathname = index !== -1 ? req2.url.slice(0, index) : req2.url;
      if (pathname !== this.options.path) return false;
    }
    return true;
  }
  /**
   * Handle a HTTP Upgrade request.
   *
   * @param {http.IncomingMessage} req The request object
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @public
   */
  handleUpgrade(req2, socket, head, cb) {
    socket.on("error", socketOnError);
    const key = req2.headers["sec-websocket-key"];
    const upgrade = req2.headers.upgrade;
    const version = +req2.headers["sec-websocket-version"];
    if (req2.method !== "GET") {
      const message = "Invalid HTTP method";
      abortHandshakeOrEmitwsClientError(this, req2, socket, 405, message);
      return;
    }
    if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
      const message = "Invalid Upgrade header";
      abortHandshakeOrEmitwsClientError(this, req2, socket, 400, message);
      return;
    }
    if (key === void 0 || !keyRegex.test(key)) {
      const message = "Missing or invalid Sec-WebSocket-Key header";
      abortHandshakeOrEmitwsClientError(this, req2, socket, 400, message);
      return;
    }
    if (version !== 13 && version !== 8) {
      const message = "Missing or invalid Sec-WebSocket-Version header";
      abortHandshakeOrEmitwsClientError(this, req2, socket, 400, message, {
        "Sec-WebSocket-Version": "13, 8"
      });
      return;
    }
    if (!this.shouldHandle(req2)) {
      abortHandshake(socket, 400);
      return;
    }
    const secWebSocketProtocol = req2.headers["sec-websocket-protocol"];
    let protocols = /* @__PURE__ */ new Set();
    if (secWebSocketProtocol !== void 0) {
      try {
        protocols = subprotocol.parse(secWebSocketProtocol);
      } catch (err) {
        const message = "Invalid Sec-WebSocket-Protocol header";
        abortHandshakeOrEmitwsClientError(this, req2, socket, 400, message);
        return;
      }
    }
    const secWebSocketExtensions = req2.headers["sec-websocket-extensions"];
    const extensions = {};
    if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
      const perMessageDeflate = new PerMessageDeflate2(
        this.options.perMessageDeflate,
        true,
        this.options.maxPayload
      );
      try {
        const offers = extension.parse(secWebSocketExtensions);
        if (offers[PerMessageDeflate2.extensionName]) {
          perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
          extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
      } catch (err) {
        const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
        abortHandshakeOrEmitwsClientError(this, req2, socket, 400, message);
        return;
      }
    }
    if (this.options.verifyClient) {
      const info = {
        origin: req2.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
        secure: !!(req2.socket.authorized || req2.socket.encrypted),
        req: req2
      };
      if (this.options.verifyClient.length === 2) {
        this.options.verifyClient(info, (verified, code, message, headers) => {
          if (!verified) {
            return abortHandshake(socket, code || 401, message, headers);
          }
          this.completeUpgrade(
            extensions,
            key,
            protocols,
            req2,
            socket,
            head,
            cb
          );
        });
        return;
      }
      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
    }
    this.completeUpgrade(extensions, key, protocols, req2, socket, head, cb);
  }
  /**
   * Upgrade the connection to WebSocket.
   *
   * @param {Object} extensions The accepted extensions
   * @param {String} key The value of the `Sec-WebSocket-Key` header
   * @param {Set} protocols The subprotocols
   * @param {http.IncomingMessage} req The request object
   * @param {Duplex} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @throws {Error} If called more than once with the same socket
   * @private
   */
  completeUpgrade(extensions, key, protocols, req2, socket, head, cb) {
    if (!socket.readable || !socket.writable) return socket.destroy();
    if (socket[kWebSocket]) {
      throw new Error(
        "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
      );
    }
    if (this._state > RUNNING) return abortHandshake(socket, 503);
    const digest = createHash("sha1").update(key + GUID).digest("base64");
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${digest}`
    ];
    const ws2 = new this.options.WebSocket(null, void 0, this.options);
    if (protocols.size) {
      const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req2) : protocols.values().next().value;
      if (protocol) {
        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
        ws2._protocol = protocol;
      }
    }
    if (extensions[PerMessageDeflate2.extensionName]) {
      const params = extensions[PerMessageDeflate2.extensionName].params;
      const value = extension.format({
        [PerMessageDeflate2.extensionName]: [params]
      });
      headers.push(`Sec-WebSocket-Extensions: ${value}`);
      ws2._extensions = extensions;
    }
    this.emit("headers", headers, req2);
    socket.write(headers.concat("\r\n").join("\r\n"));
    socket.removeListener("error", socketOnError);
    ws2.setSocket(socket, head, {
      allowSynchronousEvents: this.options.allowSynchronousEvents,
      maxPayload: this.options.maxPayload,
      skipUTF8Validation: this.options.skipUTF8Validation
    });
    if (this.clients) {
      this.clients.add(ws2);
      ws2.on("close", () => {
        this.clients.delete(ws2);
        if (this._shouldEmitClose && !this.clients.size) {
          process.nextTick(emitClose, this);
        }
      });
    }
    cb(ws2, req2);
  }
}
var websocketServer = WebSocketServer;
function addListeners(server, map) {
  for (const event of Object.keys(map)) server.on(event, map[event]);
  return function removeListeners() {
    for (const event of Object.keys(map)) {
      server.removeListener(event, map[event]);
    }
  };
}
function emitClose(server) {
  server._state = CLOSED;
  server.emit("close");
}
function socketOnError() {
  this.destroy();
}
function abortHandshake(socket, code, message, headers) {
  message = message || http$1.STATUS_CODES[code];
  headers = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(message),
    ...headers
  };
  socket.once("finish", socket.destroy);
  socket.end(
    `HTTP/1.1 ${code} ${http$1.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
  );
}
function abortHandshakeOrEmitwsClientError(server, req2, socket, code, message, headers) {
  if (server.listenerCount("wsClientError")) {
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
    server.emit("wsClientError", err, socket, req2);
  } else {
    abortHandshake(socket, code, message, headers);
  }
}
const WebSocket2 = websocket;
WebSocket2.createWebSocketStream = stream;
WebSocket2.Server = websocketServer;
WebSocket2.Receiver = receiver;
WebSocket2.Sender = sender;
WebSocket2.WebSocket = WebSocket2;
WebSocket2.WebSocketServer = WebSocket2.Server;
var ws = WebSocket2;
var dist$1 = {};
var src = { exports: {} };
var browser = { exports: {} };
var ms;
var hasRequiredMs;
function requireMs() {
  if (hasRequiredMs) return ms;
  hasRequiredMs = 1;
  var s = 1e3;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  ms = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse2(val);
    } else if (type === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
    );
  };
  function parse2(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
      str
    );
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return void 0;
    }
  }
  function fmtShort(ms2) {
    var msAbs = Math.abs(ms2);
    if (msAbs >= d) {
      return Math.round(ms2 / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms2 / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms2 / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms2 / s) + "s";
    }
    return ms2 + "ms";
  }
  function fmtLong(ms2) {
    var msAbs = Math.abs(ms2);
    if (msAbs >= d) {
      return plural(ms2, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms2, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms2, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms2, msAbs, s, "second");
    }
    return ms2 + " ms";
  }
  function plural(ms2, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms2 / n) + " " + name + (isPlural ? "s" : "");
  }
  return ms;
}
var common;
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  function setup(env2) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = requireMs();
    createDebug.destroy = destroy;
    Object.keys(env2).forEach((key) => {
      createDebug[key] = env2[key];
    });
    createDebug.names = [];
    createDebug.skips = [];
    createDebug.formatters = {};
    function selectColor(namespace) {
      let hash = 0;
      for (let i = 0; i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug2(...args) {
        if (!debug2.enabled) {
          return;
        }
        const self2 = debug2;
        const curr = Number(/* @__PURE__ */ new Date());
        const ms2 = curr - (prevTime || curr);
        self2.diff = ms2;
        self2.prev = prevTime;
        self2.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== "string") {
          args.unshift("%O");
        }
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format2) => {
          if (match === "%%") {
            return "%";
          }
          index++;
          const formatter = createDebug.formatters[format2];
          if (typeof formatter === "function") {
            const val = args[index];
            match = formatter.call(self2, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        createDebug.formatArgs.call(self2, args);
        const logFn = self2.log || createDebug.log;
        logFn.apply(self2, args);
      }
      debug2.namespace = namespace;
      debug2.useColors = createDebug.useColors();
      debug2.color = createDebug.selectColor(namespace);
      debug2.extend = extend;
      debug2.destroy = createDebug.destroy;
      Object.defineProperty(debug2, "enabled", {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) {
            return enableOverride;
          }
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: (v) => {
          enableOverride = v;
        }
      });
      if (typeof createDebug.init === "function") {
        createDebug.init(debug2);
      }
      return debug2;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
    function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const ns of split) {
        if (ns[0] === "-") {
          createDebug.skips.push(ns.slice(1));
        } else {
          createDebug.names.push(ns);
        }
      }
    }
    function matchesTemplate(search, template) {
      let searchIndex = 0;
      let templateIndex = 0;
      let starIndex = -1;
      let matchIndex = 0;
      while (searchIndex < search.length) {
        if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
          if (template[templateIndex] === "*") {
            starIndex = templateIndex;
            matchIndex = searchIndex;
            templateIndex++;
          } else {
            searchIndex++;
            templateIndex++;
          }
        } else if (starIndex !== -1) {
          templateIndex = starIndex + 1;
          matchIndex++;
          searchIndex = matchIndex;
        } else {
          return false;
        }
      }
      while (templateIndex < template.length && template[templateIndex] === "*") {
        templateIndex++;
      }
      return templateIndex === template.length;
    }
    function disable() {
      const namespaces = [
        ...createDebug.names,
        ...createDebug.skips.map((namespace) => "-" + namespace)
      ].join(",");
      createDebug.enable("");
      return namespaces;
    }
    function enabled(name) {
      for (const skip of createDebug.skips) {
        if (matchesTemplate(name, skip)) {
          return false;
        }
      }
      for (const ns of createDebug.names) {
        if (matchesTemplate(name, ns)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
    function destroy() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  common = setup;
  return common;
}
var hasRequiredBrowser;
function requireBrowser() {
  if (hasRequiredBrowser) return browser.exports;
  hasRequiredBrowser = 1;
  (function(module2, exports$1) {
    exports$1.formatArgs = formatArgs;
    exports$1.save = save;
    exports$1.load = load;
    exports$1.useColors = useColors;
    exports$1.storage = localstorage();
    exports$1.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports$1.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module2.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports$1.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports$1.storage.setItem("debug", namespaces);
        } else {
          exports$1.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports$1.storage.getItem("debug") || exports$1.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module2.exports = requireCommon()(exports$1);
    const { formatters } = module2.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  })(browser, browser.exports);
  return browser.exports;
}
var node = { exports: {} };
var hasFlag$1 = (flag, argv = process.argv) => {
  const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
  const position = argv.indexOf(prefix + flag);
  const terminatorPosition = argv.indexOf("--");
  return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
};
const os = os$1;
const tty = require$$1$3;
const hasFlag = hasFlag$1;
const { env } = process;
let forceColor;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
  forceColor = 0;
} else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
  forceColor = 1;
}
if ("FORCE_COLOR" in env) {
  if (env.FORCE_COLOR === "true") {
    forceColor = 1;
  } else if (env.FORCE_COLOR === "false") {
    forceColor = 0;
  } else {
    forceColor = env.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(env.FORCE_COLOR, 10), 3);
  }
}
function translateLevel(level) {
  if (level === 0) {
    return false;
  }
  return {
    level,
    hasBasic: true,
    has256: level >= 2,
    has16m: level >= 3
  };
}
function supportsColor(haveStream, streamIsTTY) {
  if (forceColor === 0) {
    return 0;
  }
  if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
    return 3;
  }
  if (hasFlag("color=256")) {
    return 2;
  }
  if (haveStream && !streamIsTTY && forceColor === void 0) {
    return 0;
  }
  const min = forceColor || 0;
  if (env.TERM === "dumb") {
    return min;
  }
  if (process.platform === "win32") {
    const osRelease = os.release().split(".");
    if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
      return Number(osRelease[2]) >= 14931 ? 3 : 2;
    }
    return 1;
  }
  if ("CI" in env) {
    if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
      return 1;
    }
    return min;
  }
  if ("TEAMCITY_VERSION" in env) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
  }
  if (env.COLORTERM === "truecolor") {
    return 3;
  }
  if ("TERM_PROGRAM" in env) {
    const version = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
    switch (env.TERM_PROGRAM) {
      case "iTerm.app":
        return version >= 3 ? 3 : 2;
      case "Apple_Terminal":
        return 2;
    }
  }
  if (/-256(color)?$/i.test(env.TERM)) {
    return 2;
  }
  if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
    return 1;
  }
  if ("COLORTERM" in env) {
    return 1;
  }
  return min;
}
function getSupportLevel(stream2) {
  const level = supportsColor(stream2, stream2 && stream2.isTTY);
  return translateLevel(level);
}
var supportsColor_1 = {
  supportsColor: getSupportLevel,
  stdout: translateLevel(supportsColor(true, tty.isatty(1))),
  stderr: translateLevel(supportsColor(true, tty.isatty(2)))
};
var hasRequiredNode;
function requireNode() {
  if (hasRequiredNode) return node.exports;
  hasRequiredNode = 1;
  (function(module2, exports$1) {
    const tty2 = require$$1$3;
    const util = require$$1$4;
    exports$1.init = init;
    exports$1.log = log;
    exports$1.formatArgs = formatArgs;
    exports$1.save = save;
    exports$1.load = load;
    exports$1.useColors = useColors;
    exports$1.destroy = util.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    );
    exports$1.colors = [6, 2, 3, 4, 5, 1];
    try {
      const supportsColor2 = supportsColor_1;
      if (supportsColor2 && (supportsColor2.stderr || supportsColor2).level >= 2) {
        exports$1.colors = [
          20,
          21,
          26,
          27,
          32,
          33,
          38,
          39,
          40,
          41,
          42,
          43,
          44,
          45,
          56,
          57,
          62,
          63,
          68,
          69,
          74,
          75,
          76,
          77,
          78,
          79,
          80,
          81,
          92,
          93,
          98,
          99,
          112,
          113,
          128,
          129,
          134,
          135,
          148,
          149,
          160,
          161,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          171,
          172,
          173,
          178,
          179,
          184,
          185,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          203,
          204,
          205,
          206,
          207,
          208,
          209,
          214,
          215,
          220,
          221
        ];
      }
    } catch (error) {
    }
    exports$1.inspectOpts = Object.keys(process.env).filter((key) => {
      return /^debug_/i.test(key);
    }).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
        return k.toUpperCase();
      });
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) {
        val = true;
      } else if (/^(no|off|false|disabled)$/i.test(val)) {
        val = false;
      } else if (val === "null") {
        val = null;
      } else {
        val = Number(val);
      }
      obj[prop] = val;
      return obj;
    }, {});
    function useColors() {
      return "colors" in exports$1.inspectOpts ? Boolean(exports$1.inspectOpts.colors) : tty2.isatty(process.stderr.fd);
    }
    function formatArgs(args) {
      const { namespace: name, useColors: useColors2 } = this;
      if (useColors2) {
        const c = this.color;
        const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name} \x1B[0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + module2.exports.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = getDate() + name + " " + args[0];
      }
    }
    function getDate() {
      if (exports$1.inspectOpts.hideDate) {
        return "";
      }
      return (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function log(...args) {
      return process.stderr.write(util.formatWithOptions(exports$1.inspectOpts, ...args) + "\n");
    }
    function save(namespaces) {
      if (namespaces) {
        process.env.DEBUG = namespaces;
      } else {
        delete process.env.DEBUG;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function init(debug2) {
      debug2.inspectOpts = {};
      const keys = Object.keys(exports$1.inspectOpts);
      for (let i = 0; i < keys.length; i++) {
        debug2.inspectOpts[keys[i]] = exports$1.inspectOpts[keys[i]];
      }
    }
    module2.exports = requireCommon()(exports$1);
    const { formatters } = module2.exports;
    formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
    };
    formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts);
    };
  })(node, node.exports);
  return node.exports;
}
if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) {
  src.exports = requireBrowser();
} else {
  src.exports = requireNode();
}
var srcExports = src.exports;
var dist = {};
var helpers = {};
var __createBinding$1 = commonjsGlobal && commonjsGlobal.__createBinding || (Object.create ? function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = { enumerable: true, get: function() {
      return m[k];
    } };
  }
  Object.defineProperty(o, k2, desc);
} : function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  o[k2] = m[k];
});
var __setModuleDefault$1 = commonjsGlobal && commonjsGlobal.__setModuleDefault || (Object.create ? function(o, v) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
} : function(o, v) {
  o["default"] = v;
});
var __importStar$1 = commonjsGlobal && commonjsGlobal.__importStar || function(mod) {
  if (mod && mod.__esModule) return mod;
  var result = {};
  if (mod != null) {
    for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding$1(result, mod, k);
  }
  __setModuleDefault$1(result, mod);
  return result;
};
Object.defineProperty(helpers, "__esModule", { value: true });
helpers.req = helpers.json = helpers.toBuffer = void 0;
const http = __importStar$1(require$$1$2);
const https = __importStar$1(require$$1$1);
async function toBuffer(stream2) {
  let length = 0;
  const chunks = [];
  for await (const chunk of stream2) {
    length += chunk.length;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}
helpers.toBuffer = toBuffer;
async function json(stream2) {
  const buf = await toBuffer(stream2);
  const str = buf.toString("utf8");
  try {
    return JSON.parse(str);
  } catch (_err) {
    const err = _err;
    err.message += ` (input: ${str})`;
    throw err;
  }
}
helpers.json = json;
function req(url, opts = {}) {
  const href = typeof url === "string" ? url : url.href;
  const req2 = (href.startsWith("https:") ? https : http).request(url, opts);
  const promise = new Promise((resolve, reject) => {
    req2.once("response", resolve).once("error", reject).end();
  });
  req2.then = promise.then.bind(promise);
  return req2;
}
helpers.req = req;
(function(exports$1) {
  var __createBinding2 = commonjsGlobal && commonjsGlobal.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === void 0) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === void 0) k2 = k;
    o[k2] = m[k];
  });
  var __setModuleDefault2 = commonjsGlobal && commonjsGlobal.__setModuleDefault || (Object.create ? function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
  } : function(o, v) {
    o["default"] = v;
  });
  var __importStar2 = commonjsGlobal && commonjsGlobal.__importStar || function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) {
      for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding2(result, mod, k);
    }
    __setModuleDefault2(result, mod);
    return result;
  };
  var __exportStar = commonjsGlobal && commonjsGlobal.__exportStar || function(m, exports$12) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$12, p)) __createBinding2(exports$12, m, p);
  };
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.Agent = void 0;
  const net2 = __importStar2(require$$0$4);
  const http2 = __importStar2(require$$1$2);
  const https_1 = require$$1$1;
  __exportStar(helpers, exports$1);
  const INTERNAL = Symbol("AgentBaseInternalState");
  class Agent extends http2.Agent {
    constructor(opts) {
      super(opts);
      this[INTERNAL] = {};
    }
    /**
     * Determine whether this is an `http` or `https` request.
     */
    isSecureEndpoint(options) {
      if (options) {
        if (typeof options.secureEndpoint === "boolean") {
          return options.secureEndpoint;
        }
        if (typeof options.protocol === "string") {
          return options.protocol === "https:";
        }
      }
      const { stack } = new Error();
      if (typeof stack !== "string")
        return false;
      return stack.split("\n").some((l) => l.indexOf("(https.js:") !== -1 || l.indexOf("node:https:") !== -1);
    }
    // In order to support async signatures in `connect()` and Node's native
    // connection pooling in `http.Agent`, the array of sockets for each origin
    // has to be updated synchronously. This is so the length of the array is
    // accurate when `addRequest()` is next called. We achieve this by creating a
    // fake socket and adding it to `sockets[origin]` and incrementing
    // `totalSocketCount`.
    incrementSockets(name) {
      if (this.maxSockets === Infinity && this.maxTotalSockets === Infinity) {
        return null;
      }
      if (!this.sockets[name]) {
        this.sockets[name] = [];
      }
      const fakeSocket = new net2.Socket({ writable: false });
      this.sockets[name].push(fakeSocket);
      this.totalSocketCount++;
      return fakeSocket;
    }
    decrementSockets(name, socket) {
      if (!this.sockets[name] || socket === null) {
        return;
      }
      const sockets = this.sockets[name];
      const index = sockets.indexOf(socket);
      if (index !== -1) {
        sockets.splice(index, 1);
        this.totalSocketCount--;
        if (sockets.length === 0) {
          delete this.sockets[name];
        }
      }
    }
    // In order to properly update the socket pool, we need to call `getName()` on
    // the core `https.Agent` if it is a secureEndpoint.
    getName(options) {
      const secureEndpoint = this.isSecureEndpoint(options);
      if (secureEndpoint) {
        return https_1.Agent.prototype.getName.call(this, options);
      }
      return super.getName(options);
    }
    createSocket(req2, options, cb) {
      const connectOpts = {
        ...options,
        secureEndpoint: this.isSecureEndpoint(options)
      };
      const name = this.getName(connectOpts);
      const fakeSocket = this.incrementSockets(name);
      Promise.resolve().then(() => this.connect(req2, connectOpts)).then((socket) => {
        this.decrementSockets(name, fakeSocket);
        if (socket instanceof http2.Agent) {
          try {
            return socket.addRequest(req2, connectOpts);
          } catch (err) {
            return cb(err);
          }
        }
        this[INTERNAL].currentSocket = socket;
        super.createSocket(req2, options, cb);
      }, (err) => {
        this.decrementSockets(name, fakeSocket);
        cb(err);
      });
    }
    createConnection() {
      const socket = this[INTERNAL].currentSocket;
      this[INTERNAL].currentSocket = void 0;
      if (!socket) {
        throw new Error("No socket was returned in the `connect()` function");
      }
      return socket;
    }
    get defaultPort() {
      return this[INTERNAL].defaultPort ?? (this.protocol === "https:" ? 443 : 80);
    }
    set defaultPort(v) {
      if (this[INTERNAL]) {
        this[INTERNAL].defaultPort = v;
      }
    }
    get protocol() {
      return this[INTERNAL].protocol ?? (this.isSecureEndpoint() ? "https:" : "http:");
    }
    set protocol(v) {
      if (this[INTERNAL]) {
        this[INTERNAL].protocol = v;
      }
    }
  }
  exports$1.Agent = Agent;
})(dist);
var parseProxyResponse$1 = {};
var __importDefault$1 = commonjsGlobal && commonjsGlobal.__importDefault || function(mod) {
  return mod && mod.__esModule ? mod : { "default": mod };
};
Object.defineProperty(parseProxyResponse$1, "__esModule", { value: true });
parseProxyResponse$1.parseProxyResponse = void 0;
const debug_1$1 = __importDefault$1(srcExports);
const debug$1 = (0, debug_1$1.default)("https-proxy-agent:parse-proxy-response");
function parseProxyResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffersLength = 0;
    const buffers = [];
    function read() {
      const b = socket.read();
      if (b)
        ondata(b);
      else
        socket.once("readable", read);
    }
    function cleanup() {
      socket.removeListener("end", onend);
      socket.removeListener("error", onerror);
      socket.removeListener("readable", read);
    }
    function onend() {
      cleanup();
      debug$1("onend");
      reject(new Error("Proxy connection ended before receiving CONNECT response"));
    }
    function onerror(err) {
      cleanup();
      debug$1("onerror %o", err);
      reject(err);
    }
    function ondata(b) {
      buffers.push(b);
      buffersLength += b.length;
      const buffered = Buffer.concat(buffers, buffersLength);
      const endOfHeaders = buffered.indexOf("\r\n\r\n");
      if (endOfHeaders === -1) {
        debug$1("have not received end of HTTP headers yet...");
        read();
        return;
      }
      const headerParts = buffered.slice(0, endOfHeaders).toString("ascii").split("\r\n");
      const firstLine = headerParts.shift();
      if (!firstLine) {
        socket.destroy();
        return reject(new Error("No header received from proxy CONNECT response"));
      }
      const firstLineParts = firstLine.split(" ");
      const statusCode = +firstLineParts[1];
      const statusText = firstLineParts.slice(2).join(" ");
      const headers = {};
      for (const header of headerParts) {
        if (!header)
          continue;
        const firstColon = header.indexOf(":");
        if (firstColon === -1) {
          socket.destroy();
          return reject(new Error(`Invalid header from proxy CONNECT response: "${header}"`));
        }
        const key = header.slice(0, firstColon).toLowerCase();
        const value = header.slice(firstColon + 1).trimStart();
        const current = headers[key];
        if (typeof current === "string") {
          headers[key] = [current, value];
        } else if (Array.isArray(current)) {
          current.push(value);
        } else {
          headers[key] = value;
        }
      }
      debug$1("got proxy server response: %o %o", firstLine, headers);
      cleanup();
      resolve({
        connect: {
          statusCode,
          statusText,
          headers
        },
        buffered
      });
    }
    socket.on("error", onerror);
    socket.on("end", onend);
    read();
  });
}
parseProxyResponse$1.parseProxyResponse = parseProxyResponse;
var __createBinding = commonjsGlobal && commonjsGlobal.__createBinding || (Object.create ? function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = { enumerable: true, get: function() {
      return m[k];
    } };
  }
  Object.defineProperty(o, k2, desc);
} : function(o, m, k, k2) {
  if (k2 === void 0) k2 = k;
  o[k2] = m[k];
});
var __setModuleDefault = commonjsGlobal && commonjsGlobal.__setModuleDefault || (Object.create ? function(o, v) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
} : function(o, v) {
  o["default"] = v;
});
var __importStar = commonjsGlobal && commonjsGlobal.__importStar || function(mod) {
  if (mod && mod.__esModule) return mod;
  var result = {};
  if (mod != null) {
    for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
  }
  __setModuleDefault(result, mod);
  return result;
};
var __importDefault = commonjsGlobal && commonjsGlobal.__importDefault || function(mod) {
  return mod && mod.__esModule ? mod : { "default": mod };
};
Object.defineProperty(dist$1, "__esModule", { value: true });
dist$1.HttpsProxyAgent = void 0;
const net = __importStar(require$$0$4);
const tls = __importStar(require$$4);
const assert_1 = __importDefault(require$$2);
const debug_1 = __importDefault(srcExports);
const agent_base_1 = dist;
const url_1 = require$$7;
const parse_proxy_response_1 = parseProxyResponse$1;
const debug = (0, debug_1.default)("https-proxy-agent");
const setServernameFromNonIpHost = (options) => {
  if (options.servername === void 0 && options.host && !net.isIP(options.host)) {
    return {
      ...options,
      servername: options.host
    };
  }
  return options;
};
class HttpsProxyAgent extends agent_base_1.Agent {
  constructor(proxy, opts) {
    super(opts);
    this.options = { path: void 0 };
    this.proxy = typeof proxy === "string" ? new url_1.URL(proxy) : proxy;
    this.proxyHeaders = (opts == null ? void 0 : opts.headers) ?? {};
    debug("Creating new HttpsProxyAgent instance: %o", this.proxy.href);
    const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, "");
    const port = this.proxy.port ? parseInt(this.proxy.port, 10) : this.proxy.protocol === "https:" ? 443 : 80;
    this.connectOpts = {
      // Attempt to negotiate http/1.1 for proxy servers that support http/2
      ALPNProtocols: ["http/1.1"],
      ...opts ? omit(opts, "headers") : null,
      host,
      port
    };
  }
  /**
   * Called when the node-core HTTP client library is creating a
   * new HTTP request.
   */
  async connect(req2, opts) {
    const { proxy } = this;
    if (!opts.host) {
      throw new TypeError('No "host" provided');
    }
    let socket;
    if (proxy.protocol === "https:") {
      debug("Creating `tls.Socket`: %o", this.connectOpts);
      socket = tls.connect(setServernameFromNonIpHost(this.connectOpts));
    } else {
      debug("Creating `net.Socket`: %o", this.connectOpts);
      socket = net.connect(this.connectOpts);
    }
    const headers = typeof this.proxyHeaders === "function" ? this.proxyHeaders() : { ...this.proxyHeaders };
    const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
    let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r
`;
    if (proxy.username || proxy.password) {
      const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
    }
    headers.Host = `${host}:${opts.port}`;
    if (!headers["Proxy-Connection"]) {
      headers["Proxy-Connection"] = this.keepAlive ? "Keep-Alive" : "close";
    }
    for (const name of Object.keys(headers)) {
      payload += `${name}: ${headers[name]}\r
`;
    }
    const proxyResponsePromise = (0, parse_proxy_response_1.parseProxyResponse)(socket);
    socket.write(`${payload}\r
`);
    const { connect, buffered } = await proxyResponsePromise;
    req2.emit("proxyConnect", connect);
    this.emit("proxyConnect", connect, req2);
    if (connect.statusCode === 200) {
      req2.once("socket", resume);
      if (opts.secureEndpoint) {
        debug("Upgrading socket connection to TLS");
        return tls.connect({
          ...omit(setServernameFromNonIpHost(opts), "host", "path", "port"),
          socket
        });
      }
      return socket;
    }
    socket.destroy();
    const fakeSocket = new net.Socket({ writable: false });
    fakeSocket.readable = true;
    req2.once("socket", (s) => {
      debug("Replaying proxy buffer for failed request");
      (0, assert_1.default)(s.listenerCount("data") > 0);
      s.push(buffered);
      s.push(null);
    });
    return fakeSocket;
  }
}
HttpsProxyAgent.protocols = ["http", "https"];
dist$1.HttpsProxyAgent = HttpsProxyAgent;
function resume(socket) {
  socket.resume();
}
function omit(obj, ...keys) {
  const ret = {};
  let key;
  for (key in obj) {
    if (!keys.includes(key)) {
      ret[key] = obj[key];
    }
  }
  return ret;
}
var drm = {};
(function(exports$1) {
  Object.defineProperty(exports$1, "__esModule", { value: true });
  exports$1.generateSecMsGecToken = exports$1.TRUSTED_CLIENT_TOKEN = exports$1.CHROMIUM_FULL_VERSION = void 0;
  const node_crypto_12 = require$$0$5;
  exports$1.CHROMIUM_FULL_VERSION = "130.0.2849.68";
  exports$1.TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
  function generateSecMsGecToken() {
    const ticks = BigInt(Math.floor(Date.now() / 1e3 + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
    const roundedTicks = ticks - ticks % 3000000000n;
    const strToHash = `${roundedTicks}${exports$1.TRUSTED_CLIENT_TOKEN}`;
    const hash = (0, node_crypto_12.createHash)("sha256");
    hash.update(strToHash, "ascii");
    return hash.digest("hex").toUpperCase();
  }
  exports$1.generateSecMsGecToken = generateSecMsGecToken;
})(drm);
Object.defineProperty(edgeTts, "__esModule", { value: true });
var EdgeTTS_1 = edgeTts.EdgeTTS = void 0;
const node_crypto_1 = require$$0$5;
const node_fs_1 = require$$1$5;
const ws_1 = ws;
const https_proxy_agent_1 = dist$1;
const drm_1 = drm;
class EdgeTTS {
  constructor({ voice = "zh-CN-XiaoyiNeural", lang = "zh-CN", outputFormat = "audio-24khz-48kbitrate-mono-mp3", saveSubtitles = false, proxy, rate = "default", pitch = "default", volume = "default", timeout = 1e4 } = {}) {
    this.voice = voice;
    this.lang = lang;
    this.outputFormat = outputFormat;
    this.saveSubtitles = saveSubtitles;
    this.proxy = proxy;
    this.rate = rate;
    this.pitch = pitch;
    this.volume = volume;
    this.timeout = timeout;
  }
  async _connectWebSocket() {
    const wsConnect = new ws_1.WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${drm_1.TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${(0, drm_1.generateSecMsGecToken)()}&Sec-MS-GEC-Version=1-${drm_1.CHROMIUM_FULL_VERSION}`, {
      host: "speech.platform.bing.com",
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
      },
      agent: this.proxy ? new https_proxy_agent_1.HttpsProxyAgent(this.proxy) : void 0
    });
    return new Promise((resolve, reject) => {
      wsConnect.on("open", () => {
        wsConnect.send(`Content-Type:application/json; charset=utf-8\r
Path:speech.config\r
\r

          {
            "context": {
              "synthesis": {
                "audio": {
                  "metadataoptions": {
                    "sentenceBoundaryEnabled": "false",
                    "wordBoundaryEnabled": "true"
                  },
                  "outputFormat": "${this.outputFormat}"
                }
              }
            }
          }
        `);
        resolve(wsConnect);
      });
      wsConnect.on("error", (err) => {
        reject(err);
      });
    });
  }
  _saveSubFile(subFile, text, audioPath) {
    let subPath = audioPath + ".json";
    let subChars = text.split("");
    let subCharIndex = 0;
    subFile.forEach((cue, index) => {
      var _a, _b;
      let fullPart = "";
      let stepIndex = 0;
      for (let sci = subCharIndex; sci < subChars.length; sci++) {
        if (subChars[sci] === cue.part[stepIndex]) {
          fullPart = fullPart + subChars[sci];
          stepIndex += 1;
        } else if (subChars[sci] === ((_b = (_a = subFile == null ? void 0 : subFile[index + 1]) == null ? void 0 : _a.part) == null ? void 0 : _b[0])) {
          subCharIndex = sci;
          break;
        } else {
          fullPart = fullPart + subChars[sci];
        }
      }
      cue.part = fullPart;
    });
    (0, node_fs_1.writeFileSync)(subPath, JSON.stringify(subFile, null, "  "), { encoding: "utf-8" });
  }
  async ttsPromise(text, audioPath) {
    const _wsConnect = await this._connectWebSocket();
    return new Promise((resolve, reject) => {
      let audioStream = (0, node_fs_1.createWriteStream)(audioPath);
      let subFile = [];
      let timeout = setTimeout(() => reject("Timed out"), this.timeout);
      _wsConnect.on("message", async (data, isBinary) => {
        if (isBinary) {
          let separator = "Path:audio\r\n";
          let index = data.indexOf(separator) + separator.length;
          let audioData = data.subarray(index);
          audioStream.write(audioData);
        } else {
          let message = data.toString();
          if (message.includes("Path:turn.end")) {
            audioStream.end();
            _wsConnect.close();
            if (this.saveSubtitles) {
              this._saveSubFile(subFile, text, audioPath);
            }
            clearTimeout(timeout);
            resolve();
          } else if (message.includes("Path:audio.metadata")) {
            let splitTexts = message.split("\r\n");
            try {
              let metadata = JSON.parse(splitTexts[splitTexts.length - 1]);
              metadata["Metadata"].forEach((element) => {
                subFile.push({
                  part: element["Data"]["text"]["Text"],
                  start: Math.floor(element["Data"]["Offset"] / 1e4),
                  end: Math.floor((element["Data"]["Offset"] + element["Data"]["Duration"]) / 1e4)
                });
              });
            } catch {
            }
          }
        }
      });
      let requestId = (0, node_crypto_1.randomBytes)(16).toString("hex");
      _wsConnect.send(`X-RequestId:${requestId}\r
Content-Type:application/ssml+xml\r
Path:ssml\r
\r

      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this.lang}">
        <voice name="${this.voice}">
          <prosody rate="${this.rate}" pitch="${this.pitch}" volume="${this.volume}">
            ${text}
          </prosody>
        </voice>
      </speak>`);
    });
  }
}
EdgeTTS_1 = edgeTts.EdgeTTS = EdgeTTS;
class TTSService {
  constructor() {
    __publicField(this, "tempDir");
    this.tempDir = electron.app.getPath("temp");
  }
  async listVoices() {
    const voices = [
      // English US
      { ShortName: "en-US-AriaNeural", FriendlyName: "Aria (US)", Locale: "en-US", Gender: "Female" },
      { ShortName: "en-US-GuyNeural", FriendlyName: "Guy (US)", Locale: "en-US", Gender: "Male" },
      { ShortName: "en-US-JennyNeural", FriendlyName: "Jenny (US)", Locale: "en-US", Gender: "Female" },
      { ShortName: "en-US-AndrewNeural", FriendlyName: "Andrew (US)", Locale: "en-US", Gender: "Male" },
      { ShortName: "en-US-MichelleNeural", FriendlyName: "Michelle (US)", Locale: "en-US", Gender: "Female" },
      { ShortName: "en-US-ChristopherNeural", FriendlyName: "Christopher (US)", Locale: "en-US", Gender: "Male" },
      { ShortName: "en-US-EmmaNeural", FriendlyName: "Emma (US)", Locale: "en-US", Gender: "Female" },
      { ShortName: "en-US-BrianNeural", FriendlyName: "Brian (US)", Locale: "en-US", Gender: "Male" },
      // English UK
      { ShortName: "en-GB-SoniaNeural", FriendlyName: "Sonia (UK)", Locale: "en-GB", Gender: "Female" },
      { ShortName: "en-GB-RyanNeural", FriendlyName: "Ryan (UK)", Locale: "en-GB", Gender: "Male" },
      { ShortName: "en-GB-LibbyNeural", FriendlyName: "Libby (UK)", Locale: "en-GB", Gender: "Female" },
      // English AU
      { ShortName: "en-AU-NatashaNeural", FriendlyName: "Natasha (AU)", Locale: "en-AU", Gender: "Female" },
      { ShortName: "en-AU-WilliamNeural", FriendlyName: "William (AU)", Locale: "en-AU", Gender: "Male" },
      // Spanish
      { ShortName: "es-ES-ElviraNeural", FriendlyName: "Elvira (Spain)", Locale: "es-ES", Gender: "Female" },
      { ShortName: "es-ES-AlvaroNeural", FriendlyName: "Alvaro (Spain)", Locale: "es-ES", Gender: "Male" },
      { ShortName: "es-MX-DaliaNeural", FriendlyName: "Dalia (Mexico)", Locale: "es-MX", Gender: "Female" },
      // French
      { ShortName: "fr-FR-DeniseNeural", FriendlyName: "Denise (France)", Locale: "fr-FR", Gender: "Female" },
      { ShortName: "fr-FR-HenriNeural", FriendlyName: "Henri (France)", Locale: "fr-FR", Gender: "Male" },
      // German
      { ShortName: "de-DE-KatjaNeural", FriendlyName: "Katja (Germany)", Locale: "de-DE", Gender: "Female" },
      { ShortName: "de-DE-ConradNeural", FriendlyName: "Conrad (Germany)", Locale: "de-DE", Gender: "Male" },
      // Japanese
      { ShortName: "ja-JP-NanamiNeural", FriendlyName: "Nanami (Japan)", Locale: "ja-JP", Gender: "Female" },
      { ShortName: "ja-JP-KeitaNeural", FriendlyName: "Keita (Japan)", Locale: "ja-JP", Gender: "Male" },
      // Chinese
      { ShortName: "zh-CN-XiaoxiaoNeural", FriendlyName: "Xiaoxiao (China)", Locale: "zh-CN", Gender: "Female" },
      { ShortName: "zh-CN-YunxiNeural", FriendlyName: "Yunxi (China)", Locale: "zh-CN", Gender: "Male" },
      // Korean
      { ShortName: "ko-KR-SunHiNeural", FriendlyName: "SunHi (Korea)", Locale: "ko-KR", Gender: "Female" },
      { ShortName: "ko-KR-InJoonNeural", FriendlyName: "InJoon (Korea)", Locale: "ko-KR", Gender: "Male" }
    ];
    console.log(`[TTS] Returning ${voices.length} voices`);
    return voices;
  }
  async speak(text, voice, rate = "+0%", pitch = "+0Hz") {
    console.log(`[TTS] Synthesizing: "${text.substring(0, 50)}..." (voice: ${voice}, rate: ${rate}, pitch: ${pitch})`);
    const tempFile = path.join(this.tempDir, `tts-${require$$0$5.randomUUID()}.mp3`);
    try {
      const ttsRate = rate === "+0%" || !rate ? "default" : rate;
      const ttsPitch = pitch === "+0Hz" || !pitch ? "default" : pitch.replace("Hz", "%");
      const tts = new EdgeTTS_1({
        voice,
        lang: voice.split("-").slice(0, 2).join("-"),
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        rate: ttsRate,
        pitch: ttsPitch,
        timeout: 3e4
      });
      console.log("[TTS] Calling ttsPromise...");
      await tts.ttsPromise(text, tempFile);
      console.log("[TTS] ttsPromise completed");
      const audioBuffer = await fs$1.readFile(tempFile);
      const base64 = audioBuffer.toString("base64");
      console.log(`[TTS] Generated ${audioBuffer.length} bytes of audio`);
      await fs$1.unlink(tempFile).catch(() => {
      });
      return `data:audio/mp3;base64,${base64}`;
    } catch (error) {
      console.error("[TTS] node-edge-tts error:", error.message || error);
      await fs$1.unlink(tempFile).catch(() => {
      });
      throw error;
    }
  }
  async cleanupTempFiles() {
    try {
      const files = await fs$1.readdir(this.tempDir);
      for (const file of files) {
        if (file.startsWith("tts-") && file.endsWith(".mp3")) {
          try {
            await fs$1.unlink(path.join(this.tempDir, file));
          } catch (e) {
            console.error("[TTS] Cleanup error:", e);
          }
        }
      }
    } catch (error) {
      console.error("[TTS] Cleanup process error:", error);
    }
  }
}
function registerTTSHandlers() {
  const ttsService = new TTSService();
  electron.ipcMain.handle("tts:list-voices", async () => {
    return ttsService.listVoices();
  });
  electron.ipcMain.handle("tts:speak", async (_, text, voice, rate, pitch) => {
    return ttsService.speak(text, voice, rate, pitch);
  });
  electron.ipcMain.handle("tts:cleanup", async () => {
    ttsService.cleanupTempFiles();
  });
}
function registerFileSystemHandlers() {
  electron.ipcMain.handle("fs:parse-character-card", async (_, filePath) => {
    try {
      const buffer = await fs$1.readFile(filePath);
      if (buffer.readUInt32BE(0) !== 2303741511 || buffer.readUInt32BE(4) !== 218765834) {
        return null;
      }
      let offset = 8;
      let charaData = null;
      while (offset < buffer.length) {
        if (offset + 8 > buffer.length) break;
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("utf-8", offset + 4, offset + 8);
        const chunkDataStart = offset + 8;
        const chunkDataEnd = chunkDataStart + length;
        if (type === "tEXt") {
          const chunkData = buffer.subarray(chunkDataStart, chunkDataEnd);
          const nullIndex = chunkData.indexOf(0);
          if (nullIndex !== -1) {
            const keyword = chunkData.toString("latin1", 0, nullIndex);
            const text = chunkData.toString("latin1", nullIndex + 1);
            if (keyword === "chara" || keyword === "ccv3") {
              try {
                const decoded = Buffer.from(text, "base64").toString("utf-8");
                charaData = JSON.parse(decoded);
              } catch (e) {
                console.error("[FileSystem] Failed to decode character data:", e);
              }
            }
          }
        }
        offset += length + 12;
      }
      return charaData;
    } catch (error) {
      console.error("[FileSystem] Parse character card error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("fs:save-avatar", async (_, base64Data, type) => {
    try {
      const userDataPath = electron.app.getPath("userData");
      const avatarDir = path.join(userDataPath, "avatars");
      await fs$1.mkdir(avatarDir, { recursive: true });
      const fileName = `${type}-avatar.png`;
      const filePath = path.join(avatarDir, fileName);
      const buffer = Buffer.from(base64Data.split(",")[1], "base64");
      await fs$1.writeFile(filePath, buffer);
      return filePath;
    } catch (error) {
      console.error("fs:save-avatar error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:open-dialog", async (event, options) => {
    const result = await electron.dialog.showOpenDialog(options);
    const win2 = electron.BrowserWindow.fromWebContents(event.sender);
    win2 == null ? void 0 : win2.focus();
    return result.filePaths;
  });
  electron.ipcMain.handle("fs:save-dialog", async (_, options) => {
    return electron.dialog.showSaveDialog(options);
  });
  electron.ipcMain.handle("fs:read-file", async (_, filePath) => {
    try {
      const content = await fs$1.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      console.error("fs:read-file error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:read-file-as-base64", async (_, filePath) => {
    try {
      const buffer = await fs$1.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mimeTypes = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp"
      };
      const mime = mimeTypes[ext] || "application/octet-stream";
      const base64 = buffer.toString("base64");
      return `data:${mime};base64,${base64}`;
    } catch (error) {
      console.error("fs:read-file-as-base64 error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:write-file", async (_, filePath, content) => {
    try {
      await fs$1.writeFile(filePath, content, "utf-8");
      return true;
    } catch (error) {
      console.error("fs:write-file error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:confirm-dialog", async (event, options) => {
    const win2 = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win2) return false;
    const { response } = await electron.dialog.showMessageBox(win2, {
      type: "question",
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: [options.cancelLabel || "Cancel", options.confirmLabel || "OK"],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    });
    win2.focus();
    return response === 1;
  });
}
const processes = {};
const serviceStatus = {
  ollama: "starting",
  lmstudio: "starting"
};
const SERVICES = [
  {
    id: "ollama",
    args: ["serve"],
    checkUrl: "http://localhost:11434"
  },
  {
    id: "lmstudio",
    args: ["server", "start"],
    checkUrl: "http://localhost:1234/v1/models"
  }
];
function findOllamaCLI() {
  const homeDir = os__namespace.homedir();
  const possiblePaths = [
    // Common Windows install locations
    path__namespace.join(homeDir, "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    path__namespace.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    "C:\\Program Files\\Ollama\\ollama.exe",
    "C:\\Program Files (x86)\\Ollama\\ollama.exe"
  ];
  for (const p of possiblePaths) {
    if (p && fs__namespace.existsSync(p)) {
      console.log("[Services] Found Ollama CLI at:", p);
      return p;
    }
  }
  console.log("[Services] Ollama CLI not found. Checked:", possiblePaths.filter((p) => p));
  return null;
}
function findLMStudioCLI() {
  const homeDir = os__namespace.homedir();
  const possiblePaths = [
    // Common Windows install locations
    path__namespace.join(homeDir, ".lmstudio", "bin", "lms.exe"),
    path__namespace.join(homeDir, ".cache", "lm-studio", "bin", "lms.exe"),
    path__namespace.join(homeDir, "AppData", "Local", "LM-Studio", "lms.exe"),
    path__namespace.join(process.env.LOCALAPPDATA || "", "LM-Studio", "lms.exe")
  ];
  for (const p of possiblePaths) {
    if (p && fs__namespace.existsSync(p)) {
      console.log("[Services] Found LM Studio CLI at:", p);
      return p;
    }
  }
  console.log("[Services] LM Studio CLI not found. Checked:", possiblePaths.filter((p) => p));
  return null;
}
function getExecutablePath(serviceId) {
  if (serviceId === "ollama") {
    return findOllamaCLI();
  } else if (serviceId === "lmstudio") {
    return findLMStudioCLI();
  }
  return null;
}
const waitForServer = async (url, timeoutMs = 15e3, intervalMs = 1e3) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2e3) });
      if (response.ok) {
        return true;
      }
    } catch (error) {
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
};
const startService = async (service) => {
  try {
    const res = await fetch(service.checkUrl, { signal: AbortSignal.timeout(2e3) });
    if (res.ok) {
      console.log(`[Services] ${service.id} is already running.`);
      serviceStatus[service.id] = "ready";
      return;
    }
  } catch (e) {
  }
  const execPath = getExecutablePath(service.id);
  if (!execPath) {
    console.log(`[Services] Cannot start ${service.id}: CLI not found (not installed?)`);
    serviceStatus[service.id] = "not_installed";
    return;
  }
  console.log(`[Services] Starting ${service.id}: "${execPath}" ${service.args.join(" ")}`);
  serviceStatus[service.id] = "starting";
  try {
    const child = require$$0$6.spawn(execPath, service.args, {
      windowsHide: true,
      stdio: "ignore"
    });
    processes[service.id] = child;
    child.on("error", (err) => {
      console.error(`[Services] ${service.id} spawn error:`, err.message);
      if (err.message.includes("ENOENT") || err.message.includes("not found")) {
        serviceStatus[service.id] = "not_installed";
      } else {
        serviceStatus[service.id] = "failed";
      }
    });
    child.on("exit", (code) => {
      console.log(`[Services] ${service.id} exited with code:`, code);
    });
    console.log(`[Services] Polling for ${service.id} readiness...`);
    const ready = await waitForServer(service.checkUrl, 2e4);
    if (ready) {
      console.log(`[Services] ${service.id} is now ready!`);
      serviceStatus[service.id] = "ready";
    } else {
      console.log(`[Services] ${service.id} did not become ready within timeout`);
      if (serviceStatus[service.id] === "starting") {
        serviceStatus[service.id] = "failed";
      }
    }
  } catch (error) {
    console.error(`[Services] Failed to start ${service.id}:`, error == null ? void 0 : error.message);
    serviceStatus[service.id] = "failed";
  }
};
const registerServiceHandlers = () => {
  electron.ipcMain.handle("services:get-status", (_, serviceId) => {
    return serviceStatus[serviceId] || "unknown";
  });
  electron.ipcMain.handle("services:is-ready", (_, serviceId) => {
    return serviceStatus[serviceId] === "ready";
  });
  electron.ipcMain.handle("services:get-all-status", () => {
    return { ...serviceStatus };
  });
};
const startAllServices = () => {
  console.log("[Services] Starting all backend services (non-blocking)...");
  SERVICES.forEach((service) => {
    startService(service).catch((err) => {
      console.error(`[Services] Error starting ${service.id}:`, err);
    });
  });
};
const stopAllServices = () => {
  console.log("[Services] Stopping all service processes...");
  Object.entries(processes).forEach(([id, p]) => {
    console.log(`[Services] Killing ${id} process...`);
    try {
      p.kill();
    } catch (e) {
    }
  });
};
electron.app.on("will-quit", () => {
  stopAllServices();
});
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win = null;
let splash = null;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createSplashWindow() {
  const splashPath = electron.app.isPackaged ? path.join(process.resourcesPath, "icon-splash.png") : path.join(__dirname, "../icon-splash.png");
  console.log("[Main] Creating splash window with image:", splashPath);
  const splashWin = new electron.BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  splashWin.loadURL(`data:text/html,
        <html>
        <head>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    overflow: hidden;
                }
                img {
                    max-width: 100%;
                    max-height: 100%;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                }
            </style>
        </head>
        <body>
            <img src="file://${splashPath.replace(/\\/g, "/")}" alt="Loading..." />
        </body>
        </html>
    `);
  return splashWin;
}
function createWindow() {
  console.log("[Main] Creating window...");
  console.log("[Main] Preload path:", path.join(__dirname, "preload.cjs"));
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0c0c0e",
    // Fix "flash bang" white screen
    show: false,
    // Don't show until ready
    icon: electron.app.isPackaged ? path.join(process.resourcesPath, "icon-splash.png") : path.join(__dirname, "../icon-splash.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    console.log("[Main] Window loaded");
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    if (splash && !splash.isDestroyed()) {
      splash.close();
      splash = null;
    }
    win == null ? void 0 : win.show();
  });
  win.webContents.on("context-menu", (_, params) => {
    console.log("[Main] Context menu triggered. Editable:", params.isEditable, "Has selection:", !!params.selectionText);
    const menu = new electron.Menu();
    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new electron.MenuItem({
          label: suggestion,
          click: () => win == null ? void 0 : win.webContents.replaceMisspelling(suggestion)
        }));
      }
      menu.append(new electron.MenuItem({ type: "separator" }));
    }
    menu.append(new electron.MenuItem({ role: "cut" }));
    menu.append(new electron.MenuItem({ role: "copy" }));
    menu.append(new electron.MenuItem({ role: "paste" }));
    menu.append(new electron.MenuItem({ type: "separator" }));
    menu.append(new electron.MenuItem({ role: "selectAll" }));
    menu.append(new electron.MenuItem({ type: "separator" }));
    menu.append(new electron.MenuItem({
      label: "Inspect Element",
      click: () => {
        win == null ? void 0 : win.webContents.inspectElement(params.x, params.y);
      }
    }));
    menu.popup({ window: win || void 0 });
  });
  if (VITE_DEV_SERVER_URL) {
    console.log("[Main] Loading dev server:", VITE_DEV_SERVER_URL);
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    const indexHtml = path.join(__dirname, "../dist_renderer/index.html");
    console.log("[Main] Loading production build");
    win.loadFile(indexHtml);
  }
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
    win = null;
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(() => {
  console.log("[Main] App ready, initializing services...");
  const dbInitialized = initDatabase();
  if (!dbInitialized) {
    console.error("[Main] Database initialization failed!");
  }
  registerStorageHandlers();
  registerTTSHandlers();
  registerFileSystemHandlers();
  const llmService = new LLMService();
  llmService.registerHandlers();
  registerServiceHandlers();
  console.log("[Main] All services registered");
  startAllServices();
  splash = createSplashWindow();
  createWindow();
});
exports.commonjsGlobal = commonjsGlobal;
exports.getDefaultExportFromCjs = getDefaultExportFromCjs$1;
exports.supportsColor_1 = supportsColor_1;
exports.ws = ws;
