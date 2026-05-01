"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path$4 = require("node:path");
const require$$0 = require("child_process");
const edgeTtsUniversal = require("edge-tts-universal");
const fs$1 = require("node:fs/promises");
const process$2 = require("node:process");
const require$$0$2 = require("path");
const require$$0$1 = require("fs");
const require$$0$3 = require("os");
const require$$0$5 = require("assert");
const require$$0$4 = require("events");
const require$$0$7 = require("buffer");
const require$$0$6 = require("stream");
const require$$2 = require("util");
const node_os = require("node:os");
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
    } catch (error2) {
      console.error("[Ollama] listModels error:", error2);
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
    } catch (error2) {
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
            num_predict: config.max_tokens
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
    } catch (error2) {
      yield { done: true, error: error2.message };
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
    } catch (error2) {
      console.error("[Ollama] Unload error:", error2);
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
    } catch (error2) {
      console.error("[Ollama] Failed to stop running models:", error2);
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
      const { LMStudioClient } = await Promise.resolve().then(() => require("./index-B1KmMSUC.js"));
      clientInstance = new LMStudioClient({
        baseUrl: "ws://127.0.0.1:1234"
      });
      console.log("[LM Studio SDK] Client created successfully");
    } catch (error2) {
      console.error("[LM Studio SDK] Failed to create client:", (error2 == null ? void 0 : error2.message) || error2);
      clientCreationFailed = true;
      throw error2;
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
      const sdkMessages = messages.map((m) => {
        var _a2;
        return {
          role: m.role,
          content: typeof m.content === "string" ? m.content : (
            // Handle multimodal content (extract text part)
            Array.isArray(m.content) ? ((_a2 = m.content.find((p) => p.type === "text")) == null ? void 0 : _a2.text) || "" : String(m.content)
          )
        };
      });
      console.log("[LM Studio SDK] Calling model.respond with", sdkMessages.length, "messages");
      console.log("[LM Studio SDK] Inference params:", {
        temperature: config.temperature,
        maxTokens: config.max_tokens,
        topKSampling: config.topKSampling,
        topPSampling: config.topPSampling,
        repeatPenalty: config.repeatPenalty
      });
      const prediction = model.respond(sdkMessages, {
        temperature: config.temperature ?? 0.7,
        maxTokens: config.max_tokens ?? 2048,
        topKSampling: config.topKSampling,
        topPSampling: config.topPSampling,
        repeatPenalty: config.repeatPenalty
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
    } catch (error2) {
      console.error("[LM Studio SDK] Chat error:", error2);
      yield { done: true, error: error2.message };
    }
  }
  async unloadModel(modelId) {
    try {
      console.log("[LM Studio] Unloading model via SDK");
      const client = await getClient();
      const model = await client.llm.model();
      if (model) {
        await model.unload();
        console.log("[LM Studio] Model unloaded successfully");
      } else {
        console.log("[LM Studio] No active model to unload");
      }
    } catch (error2) {
      console.error("[LM Studio] Unload error:", error2);
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
  return new Promise((resolve) => {
    console.log("[ModelManager] Unloading LM Studio models...");
    require$$0.exec("lms unload --all", { windowsHide: true }, (error2) => {
      if (error2) {
        console.log("[ModelManager] LM Studio unload warning (might be idle):", error2.message);
      } else {
        console.log("[ModelManager] LM Studio models unloaded.");
      }
      resolve();
    });
  });
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
      } catch (error2) {
        console.error("[LLMService] list-models error:", (error2 == null ? void 0 : error2.message) || error2);
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
      } catch (error2) {
        if (error2.name === "AbortError" || signal.aborted) {
          console.log("[LLM] Chat aborted");
          event.reply("llm:chat-chunk", { done: true, aborted: true });
        } else {
          console.error("[LLM] Chat error:", error2);
          event.reply("llm:chat-chunk", { done: true, error: error2.message });
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
const dbPath = path$4.join(electron.app.getPath("userData"), "database.sqlite");
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
  } catch (error2) {
    console.error("[Database] CRITICAL: Initialization failed:", error2);
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
    } catch (error2) {
      console.error("[Storage] Failed to create conversation:", error2);
      throw error2;
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
  console.log("[Storage] All IPC handlers registered");
}
class TTSService {
  async listVoices() {
    try {
      const voices = await edgeTtsUniversal.listVoices();
      return voices;
    } catch (error2) {
      console.error("Edge TTS listVoices error:", error2);
      return [];
    }
  }
  async speak(text, voice, rate = "+0%", pitch = "+0Hz") {
    console.log(`[TTS] Synthesizing: "${text.substring(0, 50)}..." (${voice})`);
    try {
      const tts = new edgeTtsUniversal.EdgeTTS(text, voice, {
        rate,
        pitch
      });
      const result = await tts.synthesize();
      const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
      const base64 = audioBuffer.toString("base64");
      return `data:audio/mp3;base64,${base64}`;
    } catch (error2) {
      console.error("[TTS] Edge TTS speak error:", error2);
      throw error2;
    }
  }
  async cleanupTempFiles() {
    try {
      const tempDir = electron.app.getPath("temp");
      const files = await fs$1.readdir(tempDir);
      for (const file of files) {
        if (file.startsWith("tts-") && file.endsWith(".mp3")) {
          try {
            await fs$1.unlink(path$4.join(tempDir, file));
          } catch (e) {
            console.error("Cleanup error:", e);
          }
        }
      }
    } catch (error2) {
      console.error("Cleanup process error:", error2);
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
    } catch (error2) {
      console.error("[FileSystem] Parse character card error:", error2);
      return null;
    }
  });
  electron.ipcMain.handle("fs:save-avatar", async (_, base64Data, type) => {
    try {
      const userDataPath = electron.app.getPath("userData");
      const avatarDir = path$4.join(userDataPath, "avatars");
      await fs$1.mkdir(avatarDir, { recursive: true });
      const fileName = `${type}-avatar.png`;
      const filePath = path$4.join(avatarDir, fileName);
      const buffer = Buffer.from(base64Data.split(",")[1], "base64");
      await fs$1.writeFile(filePath, buffer);
      return filePath;
    } catch (error2) {
      console.error("fs:save-avatar error:", error2);
      throw error2;
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
    } catch (error2) {
      console.error("fs:read-file error:", error2);
      throw error2;
    }
  });
  electron.ipcMain.handle("fs:read-file-as-base64", async (_, filePath) => {
    try {
      const buffer = await fs$1.readFile(filePath);
      const ext = path$4.extname(filePath).toLowerCase().slice(1);
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
    } catch (error2) {
      console.error("fs:read-file-as-base64 error:", error2);
      throw error2;
    }
  });
  electron.ipcMain.handle("fs:write-file", async (_, filePath, content) => {
    try {
      await fs$1.writeFile(filePath, content, "utf-8");
      return true;
    } catch (error2) {
      console.error("fs:write-file error:", error2);
      throw error2;
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
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var execa$2 = { exports: {} };
var crossSpawn$1 = { exports: {} };
var windows;
var hasRequiredWindows;
function requireWindows() {
  if (hasRequiredWindows) return windows;
  hasRequiredWindows = 1;
  windows = isexe2;
  isexe2.sync = sync2;
  var fs2 = require$$0$1;
  function checkPathExt(path2, options) {
    var pathext = options.pathExt !== void 0 ? options.pathExt : process.env.PATHEXT;
    if (!pathext) {
      return true;
    }
    pathext = pathext.split(";");
    if (pathext.indexOf("") !== -1) {
      return true;
    }
    for (var i = 0; i < pathext.length; i++) {
      var p = pathext[i].toLowerCase();
      if (p && path2.substr(-p.length).toLowerCase() === p) {
        return true;
      }
    }
    return false;
  }
  function checkStat(stat, path2, options) {
    if (!stat.isSymbolicLink() && !stat.isFile()) {
      return false;
    }
    return checkPathExt(path2, options);
  }
  function isexe2(path2, options, cb) {
    fs2.stat(path2, function(er, stat) {
      cb(er, er ? false : checkStat(stat, path2, options));
    });
  }
  function sync2(path2, options) {
    return checkStat(fs2.statSync(path2), path2, options);
  }
  return windows;
}
var mode;
var hasRequiredMode;
function requireMode() {
  if (hasRequiredMode) return mode;
  hasRequiredMode = 1;
  mode = isexe2;
  isexe2.sync = sync2;
  var fs2 = require$$0$1;
  function isexe2(path2, options, cb) {
    fs2.stat(path2, function(er, stat) {
      cb(er, er ? false : checkStat(stat, options));
    });
  }
  function sync2(path2, options) {
    return checkStat(fs2.statSync(path2), options);
  }
  function checkStat(stat, options) {
    return stat.isFile() && checkMode(stat, options);
  }
  function checkMode(stat, options) {
    var mod = stat.mode;
    var uid = stat.uid;
    var gid = stat.gid;
    var myUid = options.uid !== void 0 ? options.uid : process.getuid && process.getuid();
    var myGid = options.gid !== void 0 ? options.gid : process.getgid && process.getgid();
    var u = parseInt("100", 8);
    var g = parseInt("010", 8);
    var o = parseInt("001", 8);
    var ug = u | g;
    var ret = mod & o || mod & g && gid === myGid || mod & u && uid === myUid || mod & ug && myUid === 0;
    return ret;
  }
  return mode;
}
var core$1;
if (process.platform === "win32" || commonjsGlobal.TESTING_WINDOWS) {
  core$1 = requireWindows();
} else {
  core$1 = requireMode();
}
var isexe_1 = isexe$1;
isexe$1.sync = sync;
function isexe$1(path2, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = {};
  }
  if (!cb) {
    if (typeof Promise !== "function") {
      throw new TypeError("callback not provided");
    }
    return new Promise(function(resolve, reject) {
      isexe$1(path2, options || {}, function(er, is) {
        if (er) {
          reject(er);
        } else {
          resolve(is);
        }
      });
    });
  }
  core$1(path2, options || {}, function(er, is) {
    if (er) {
      if (er.code === "EACCES" || options && options.ignoreErrors) {
        er = null;
        is = false;
      }
    }
    cb(er, is);
  });
}
function sync(path2, options) {
  try {
    return core$1.sync(path2, options || {});
  } catch (er) {
    if (options && options.ignoreErrors || er.code === "EACCES") {
      return false;
    } else {
      throw er;
    }
  }
}
const isWindows = process.platform === "win32" || process.env.OSTYPE === "cygwin" || process.env.OSTYPE === "msys";
const path$3 = require$$0$2;
const COLON = isWindows ? ";" : ":";
const isexe = isexe_1;
const getNotFoundError = (cmd) => Object.assign(new Error(`not found: ${cmd}`), { code: "ENOENT" });
const getPathInfo = (cmd, opt) => {
  const colon = opt.colon || COLON;
  const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? [""] : [
    // windows always checks the cwd first
    ...isWindows ? [process.cwd()] : [],
    ...(opt.path || process.env.PATH || /* istanbul ignore next: very unusual */
    "").split(colon)
  ];
  const pathExtExe = isWindows ? opt.pathExt || process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" : "";
  const pathExt = isWindows ? pathExtExe.split(colon) : [""];
  if (isWindows) {
    if (cmd.indexOf(".") !== -1 && pathExt[0] !== "")
      pathExt.unshift("");
  }
  return {
    pathEnv,
    pathExt,
    pathExtExe
  };
};
const which$1 = (cmd, opt, cb) => {
  if (typeof opt === "function") {
    cb = opt;
    opt = {};
  }
  if (!opt)
    opt = {};
  const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
  const found = [];
  const step = (i) => new Promise((resolve, reject) => {
    if (i === pathEnv.length)
      return opt.all && found.length ? resolve(found) : reject(getNotFoundError(cmd));
    const ppRaw = pathEnv[i];
    const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
    const pCmd = path$3.join(pathPart, cmd);
    const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
    resolve(subStep(p, i, 0));
  });
  const subStep = (p, i, ii) => new Promise((resolve, reject) => {
    if (ii === pathExt.length)
      return resolve(step(i + 1));
    const ext = pathExt[ii];
    isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
      if (!er && is) {
        if (opt.all)
          found.push(p + ext);
        else
          return resolve(p + ext);
      }
      return resolve(subStep(p, i, ii + 1));
    });
  });
  return cb ? step(0).then((res) => cb(null, res), cb) : step(0);
};
const whichSync = (cmd, opt) => {
  opt = opt || {};
  const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
  const found = [];
  for (let i = 0; i < pathEnv.length; i++) {
    const ppRaw = pathEnv[i];
    const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
    const pCmd = path$3.join(pathPart, cmd);
    const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
    for (let j = 0; j < pathExt.length; j++) {
      const cur = p + pathExt[j];
      try {
        const is = isexe.sync(cur, { pathExt: pathExtExe });
        if (is) {
          if (opt.all)
            found.push(cur);
          else
            return cur;
        }
      } catch (ex) {
      }
    }
  }
  if (opt.all && found.length)
    return found;
  if (opt.nothrow)
    return null;
  throw getNotFoundError(cmd);
};
var which_1 = which$1;
which$1.sync = whichSync;
var pathKey$1 = { exports: {} };
const pathKey = (options = {}) => {
  const environment = options.env || process.env;
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    return "PATH";
  }
  return Object.keys(environment).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
};
pathKey$1.exports = pathKey;
pathKey$1.exports.default = pathKey;
var pathKeyExports = pathKey$1.exports;
const path$2 = require$$0$2;
const which = which_1;
const getPathKey = pathKeyExports;
function resolveCommandAttempt(parsed, withoutPathExt) {
  const env2 = parsed.options.env || process.env;
  const cwd = process.cwd();
  const hasCustomCwd = parsed.options.cwd != null;
  const shouldSwitchCwd = hasCustomCwd && process.chdir !== void 0 && !process.chdir.disabled;
  if (shouldSwitchCwd) {
    try {
      process.chdir(parsed.options.cwd);
    } catch (err) {
    }
  }
  let resolved;
  try {
    resolved = which.sync(parsed.command, {
      path: env2[getPathKey({ env: env2 })],
      pathExt: withoutPathExt ? path$2.delimiter : void 0
    });
  } catch (e) {
  } finally {
    if (shouldSwitchCwd) {
      process.chdir(cwd);
    }
  }
  if (resolved) {
    resolved = path$2.resolve(hasCustomCwd ? parsed.options.cwd : "", resolved);
  }
  return resolved;
}
function resolveCommand$1(parsed) {
  return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
}
var resolveCommand_1 = resolveCommand$1;
var _escape = {};
const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
function escapeCommand(arg) {
  arg = arg.replace(metaCharsRegExp, "^$1");
  return arg;
}
function escapeArgument(arg, doubleEscapeMetaChars) {
  arg = `${arg}`;
  arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
  arg = `"${arg}"`;
  arg = arg.replace(metaCharsRegExp, "^$1");
  if (doubleEscapeMetaChars) {
    arg = arg.replace(metaCharsRegExp, "^$1");
  }
  return arg;
}
_escape.command = escapeCommand;
_escape.argument = escapeArgument;
var shebangRegex$1 = /^#!(.*)/;
const shebangRegex = shebangRegex$1;
var shebangCommand$1 = (string = "") => {
  const match = string.match(shebangRegex);
  if (!match) {
    return null;
  }
  const [path2, argument] = match[0].replace(/#! ?/, "").split(" ");
  const binary = path2.split("/").pop();
  if (binary === "env") {
    return argument;
  }
  return argument ? `${binary} ${argument}` : binary;
};
const fs = require$$0$1;
const shebangCommand = shebangCommand$1;
function readShebang$1(command2) {
  const size = 150;
  const buffer = Buffer.alloc(size);
  let fd;
  try {
    fd = fs.openSync(command2, "r");
    fs.readSync(fd, buffer, 0, size, 0);
    fs.closeSync(fd);
  } catch (e) {
  }
  return shebangCommand(buffer.toString());
}
var readShebang_1 = readShebang$1;
const path$1 = require$$0$2;
const resolveCommand = resolveCommand_1;
const escape = _escape;
const readShebang = readShebang_1;
const isWin$2 = process.platform === "win32";
const isExecutableRegExp = /\.(?:com|exe)$/i;
const isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
function detectShebang(parsed) {
  parsed.file = resolveCommand(parsed);
  const shebang = parsed.file && readShebang(parsed.file);
  if (shebang) {
    parsed.args.unshift(parsed.file);
    parsed.command = shebang;
    return resolveCommand(parsed);
  }
  return parsed.file;
}
function parseNonShell(parsed) {
  if (!isWin$2) {
    return parsed;
  }
  const commandFile = detectShebang(parsed);
  const needsShell = !isExecutableRegExp.test(commandFile);
  if (parsed.options.forceShell || needsShell) {
    const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);
    parsed.command = path$1.normalize(parsed.command);
    parsed.command = escape.command(parsed.command);
    parsed.args = parsed.args.map((arg) => escape.argument(arg, needsDoubleEscapeMetaChars));
    const shellCommand = [parsed.command].concat(parsed.args).join(" ");
    parsed.args = ["/d", "/s", "/c", `"${shellCommand}"`];
    parsed.command = process.env.comspec || "cmd.exe";
    parsed.options.windowsVerbatimArguments = true;
  }
  return parsed;
}
function parse$1(command2, args2, options) {
  if (args2 && !Array.isArray(args2)) {
    options = args2;
    args2 = null;
  }
  args2 = args2 ? args2.slice(0) : [];
  options = Object.assign({}, options);
  const parsed = {
    command: command2,
    args: args2,
    options,
    file: void 0,
    original: {
      command: command2,
      args: args2
    }
  };
  return options.shell ? parsed : parseNonShell(parsed);
}
var parse_1 = parse$1;
const isWin$1 = process.platform === "win32";
function notFoundError(original, syscall) {
  return Object.assign(new Error(`${syscall} ${original.command} ENOENT`), {
    code: "ENOENT",
    errno: "ENOENT",
    syscall: `${syscall} ${original.command}`,
    path: original.command,
    spawnargs: original.args
  });
}
function hookChildProcess(cp2, parsed) {
  if (!isWin$1) {
    return;
  }
  const originalEmit = cp2.emit;
  cp2.emit = function(name, arg1) {
    if (name === "exit") {
      const err = verifyENOENT(arg1, parsed);
      if (err) {
        return originalEmit.call(cp2, "error", err);
      }
    }
    return originalEmit.apply(cp2, arguments);
  };
}
function verifyENOENT(status, parsed) {
  if (isWin$1 && status === 1 && !parsed.file) {
    return notFoundError(parsed.original, "spawn");
  }
  return null;
}
function verifyENOENTSync(status, parsed) {
  if (isWin$1 && status === 1 && !parsed.file) {
    return notFoundError(parsed.original, "spawnSync");
  }
  return null;
}
var enoent$1 = {
  hookChildProcess,
  verifyENOENT,
  verifyENOENTSync,
  notFoundError
};
const cp = require$$0;
const parse = parse_1;
const enoent = enoent$1;
function spawn(command2, args2, options) {
  const parsed = parse(command2, args2, options);
  const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);
  enoent.hookChildProcess(spawned, parsed);
  return spawned;
}
function spawnSync(command2, args2, options) {
  const parsed = parse(command2, args2, options);
  const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
  result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);
  return result;
}
crossSpawn$1.exports = spawn;
crossSpawn$1.exports.spawn = spawn;
crossSpawn$1.exports.sync = spawnSync;
crossSpawn$1.exports._parse = parse;
crossSpawn$1.exports._enoent = enoent;
var crossSpawnExports = crossSpawn$1.exports;
var stripFinalNewline$1 = (input) => {
  const LF = typeof input === "string" ? "\n" : "\n".charCodeAt();
  const CR = typeof input === "string" ? "\r" : "\r".charCodeAt();
  if (input[input.length - 1] === LF) {
    input = input.slice(0, input.length - 1);
  }
  if (input[input.length - 1] === CR) {
    input = input.slice(0, input.length - 1);
  }
  return input;
};
var npmRunPath$1 = { exports: {} };
npmRunPath$1.exports;
(function(module2) {
  const path2 = require$$0$2;
  const pathKey2 = pathKeyExports;
  const npmRunPath2 = (options) => {
    options = {
      cwd: process.cwd(),
      path: process.env[pathKey2()],
      execPath: process.execPath,
      ...options
    };
    let previous;
    let cwdPath = path2.resolve(options.cwd);
    const result = [];
    while (previous !== cwdPath) {
      result.push(path2.join(cwdPath, "node_modules/.bin"));
      previous = cwdPath;
      cwdPath = path2.resolve(cwdPath, "..");
    }
    const execPathDir = path2.resolve(options.cwd, options.execPath, "..");
    result.push(execPathDir);
    return result.concat(options.path).join(path2.delimiter);
  };
  module2.exports = npmRunPath2;
  module2.exports.default = npmRunPath2;
  module2.exports.env = (options) => {
    options = {
      env: process.env,
      ...options
    };
    const env2 = { ...options.env };
    const path22 = pathKey2({ env: env2 });
    options.path = env2[path22];
    env2[path22] = module2.exports(options);
    return env2;
  };
})(npmRunPath$1);
var npmRunPathExports = npmRunPath$1.exports;
var onetime$2 = { exports: {} };
var mimicFn$2 = { exports: {} };
const mimicFn$1 = (to, from) => {
  for (const prop of Reflect.ownKeys(from)) {
    Object.defineProperty(to, prop, Object.getOwnPropertyDescriptor(from, prop));
  }
  return to;
};
mimicFn$2.exports = mimicFn$1;
mimicFn$2.exports.default = mimicFn$1;
var mimicFnExports = mimicFn$2.exports;
const mimicFn = mimicFnExports;
const calledFunctions = /* @__PURE__ */ new WeakMap();
const onetime$1 = (function_, options = {}) => {
  if (typeof function_ !== "function") {
    throw new TypeError("Expected a function");
  }
  let returnValue;
  let callCount = 0;
  const functionName = function_.displayName || function_.name || "<anonymous>";
  const onetime2 = function(...arguments_) {
    calledFunctions.set(onetime2, ++callCount);
    if (callCount === 1) {
      returnValue = function_.apply(this, arguments_);
      function_ = null;
    } else if (options.throw === true) {
      throw new Error(`Function \`${functionName}\` can only be called once`);
    }
    return returnValue;
  };
  mimicFn(onetime2, function_);
  calledFunctions.set(onetime2, callCount);
  return onetime2;
};
onetime$2.exports = onetime$1;
onetime$2.exports.default = onetime$1;
onetime$2.exports.callCount = (function_) => {
  if (!calledFunctions.has(function_)) {
    throw new Error(`The given function \`${function_.name}\` is not wrapped by the \`onetime\` package`);
  }
  return calledFunctions.get(function_);
};
var onetimeExports = onetime$2.exports;
var main = {};
var signals$2 = {};
var core = {};
Object.defineProperty(core, "__esModule", { value: true });
core.SIGNALS = void 0;
const SIGNALS = [
  {
    name: "SIGHUP",
    number: 1,
    action: "terminate",
    description: "Terminal closed",
    standard: "posix"
  },
  {
    name: "SIGINT",
    number: 2,
    action: "terminate",
    description: "User interruption with CTRL-C",
    standard: "ansi"
  },
  {
    name: "SIGQUIT",
    number: 3,
    action: "core",
    description: "User interruption with CTRL-\\",
    standard: "posix"
  },
  {
    name: "SIGILL",
    number: 4,
    action: "core",
    description: "Invalid machine instruction",
    standard: "ansi"
  },
  {
    name: "SIGTRAP",
    number: 5,
    action: "core",
    description: "Debugger breakpoint",
    standard: "posix"
  },
  {
    name: "SIGABRT",
    number: 6,
    action: "core",
    description: "Aborted",
    standard: "ansi"
  },
  {
    name: "SIGIOT",
    number: 6,
    action: "core",
    description: "Aborted",
    standard: "bsd"
  },
  {
    name: "SIGBUS",
    number: 7,
    action: "core",
    description: "Bus error due to misaligned, non-existing address or paging error",
    standard: "bsd"
  },
  {
    name: "SIGEMT",
    number: 7,
    action: "terminate",
    description: "Command should be emulated but is not implemented",
    standard: "other"
  },
  {
    name: "SIGFPE",
    number: 8,
    action: "core",
    description: "Floating point arithmetic error",
    standard: "ansi"
  },
  {
    name: "SIGKILL",
    number: 9,
    action: "terminate",
    description: "Forced termination",
    standard: "posix",
    forced: true
  },
  {
    name: "SIGUSR1",
    number: 10,
    action: "terminate",
    description: "Application-specific signal",
    standard: "posix"
  },
  {
    name: "SIGSEGV",
    number: 11,
    action: "core",
    description: "Segmentation fault",
    standard: "ansi"
  },
  {
    name: "SIGUSR2",
    number: 12,
    action: "terminate",
    description: "Application-specific signal",
    standard: "posix"
  },
  {
    name: "SIGPIPE",
    number: 13,
    action: "terminate",
    description: "Broken pipe or socket",
    standard: "posix"
  },
  {
    name: "SIGALRM",
    number: 14,
    action: "terminate",
    description: "Timeout or timer",
    standard: "posix"
  },
  {
    name: "SIGTERM",
    number: 15,
    action: "terminate",
    description: "Termination",
    standard: "ansi"
  },
  {
    name: "SIGSTKFLT",
    number: 16,
    action: "terminate",
    description: "Stack is empty or overflowed",
    standard: "other"
  },
  {
    name: "SIGCHLD",
    number: 17,
    action: "ignore",
    description: "Child process terminated, paused or unpaused",
    standard: "posix"
  },
  {
    name: "SIGCLD",
    number: 17,
    action: "ignore",
    description: "Child process terminated, paused or unpaused",
    standard: "other"
  },
  {
    name: "SIGCONT",
    number: 18,
    action: "unpause",
    description: "Unpaused",
    standard: "posix",
    forced: true
  },
  {
    name: "SIGSTOP",
    number: 19,
    action: "pause",
    description: "Paused",
    standard: "posix",
    forced: true
  },
  {
    name: "SIGTSTP",
    number: 20,
    action: "pause",
    description: 'Paused using CTRL-Z or "suspend"',
    standard: "posix"
  },
  {
    name: "SIGTTIN",
    number: 21,
    action: "pause",
    description: "Background process cannot read terminal input",
    standard: "posix"
  },
  {
    name: "SIGBREAK",
    number: 21,
    action: "terminate",
    description: "User interruption with CTRL-BREAK",
    standard: "other"
  },
  {
    name: "SIGTTOU",
    number: 22,
    action: "pause",
    description: "Background process cannot write to terminal output",
    standard: "posix"
  },
  {
    name: "SIGURG",
    number: 23,
    action: "ignore",
    description: "Socket received out-of-band data",
    standard: "bsd"
  },
  {
    name: "SIGXCPU",
    number: 24,
    action: "core",
    description: "Process timed out",
    standard: "bsd"
  },
  {
    name: "SIGXFSZ",
    number: 25,
    action: "core",
    description: "File too big",
    standard: "bsd"
  },
  {
    name: "SIGVTALRM",
    number: 26,
    action: "terminate",
    description: "Timeout or timer",
    standard: "bsd"
  },
  {
    name: "SIGPROF",
    number: 27,
    action: "terminate",
    description: "Timeout or timer",
    standard: "bsd"
  },
  {
    name: "SIGWINCH",
    number: 28,
    action: "ignore",
    description: "Terminal window size changed",
    standard: "bsd"
  },
  {
    name: "SIGIO",
    number: 29,
    action: "terminate",
    description: "I/O is available",
    standard: "other"
  },
  {
    name: "SIGPOLL",
    number: 29,
    action: "terminate",
    description: "Watched event",
    standard: "other"
  },
  {
    name: "SIGINFO",
    number: 29,
    action: "ignore",
    description: "Request for process information",
    standard: "other"
  },
  {
    name: "SIGPWR",
    number: 30,
    action: "terminate",
    description: "Device running out of power",
    standard: "systemv"
  },
  {
    name: "SIGSYS",
    number: 31,
    action: "core",
    description: "Invalid system call",
    standard: "other"
  },
  {
    name: "SIGUNUSED",
    number: 31,
    action: "terminate",
    description: "Invalid system call",
    standard: "other"
  }
];
core.SIGNALS = SIGNALS;
var realtime = {};
Object.defineProperty(realtime, "__esModule", { value: true });
realtime.SIGRTMAX = realtime.getRealtimeSignals = void 0;
const getRealtimeSignals = function() {
  const length = SIGRTMAX - SIGRTMIN + 1;
  return Array.from({ length }, getRealtimeSignal);
};
realtime.getRealtimeSignals = getRealtimeSignals;
const getRealtimeSignal = function(value, index) {
  return {
    name: `SIGRT${index + 1}`,
    number: SIGRTMIN + index,
    action: "terminate",
    description: "Application-specific signal (realtime)",
    standard: "posix"
  };
};
const SIGRTMIN = 34;
const SIGRTMAX = 64;
realtime.SIGRTMAX = SIGRTMAX;
Object.defineProperty(signals$2, "__esModule", { value: true });
signals$2.getSignals = void 0;
var _os$1 = require$$0$3;
var _core = core;
var _realtime$1 = realtime;
const getSignals = function() {
  const realtimeSignals = (0, _realtime$1.getRealtimeSignals)();
  const signals = [..._core.SIGNALS, ...realtimeSignals].map(normalizeSignal);
  return signals;
};
signals$2.getSignals = getSignals;
const normalizeSignal = function({
  name,
  number: defaultNumber,
  description,
  action,
  forced = false,
  standard
}) {
  const {
    signals: { [name]: constantSignal }
  } = _os$1.constants;
  const supported = constantSignal !== void 0;
  const number = supported ? constantSignal : defaultNumber;
  return { name, number, description, supported, action, forced, standard };
};
Object.defineProperty(main, "__esModule", { value: true });
main.signalsByNumber = main.signalsByName = void 0;
var _os = require$$0$3;
var _signals = signals$2;
var _realtime = realtime;
const getSignalsByName = function() {
  const signals = (0, _signals.getSignals)();
  return signals.reduce(getSignalByName, {});
};
const getSignalByName = function(signalByNameMemo, { name, number, description, supported, action, forced, standard }) {
  return {
    ...signalByNameMemo,
    [name]: { name, number, description, supported, action, forced, standard }
  };
};
const signalsByName$1 = getSignalsByName();
main.signalsByName = signalsByName$1;
const getSignalsByNumber = function() {
  const signals = (0, _signals.getSignals)();
  const length = _realtime.SIGRTMAX + 1;
  const signalsA = Array.from({ length }, (value, number) => getSignalByNumber(number, signals));
  return Object.assign({}, ...signalsA);
};
const getSignalByNumber = function(number, signals) {
  const signal = findSignalByNumber(number, signals);
  if (signal === void 0) {
    return {};
  }
  const { name, description, supported, action, forced, standard } = signal;
  return {
    [number]: {
      name,
      number,
      description,
      supported,
      action,
      forced,
      standard
    }
  };
};
const findSignalByNumber = function(number, signals) {
  const signal = signals.find(({ name }) => _os.constants.signals[name] === number);
  if (signal !== void 0) {
    return signal;
  }
  return signals.find((signalA) => signalA.number === number);
};
const signalsByNumber = getSignalsByNumber();
main.signalsByNumber = signalsByNumber;
const { signalsByName } = main;
const getErrorPrefix = ({ timedOut, timeout, errorCode, signal, signalDescription, exitCode, isCanceled }) => {
  if (timedOut) {
    return `timed out after ${timeout} milliseconds`;
  }
  if (isCanceled) {
    return "was canceled";
  }
  if (errorCode !== void 0) {
    return `failed with ${errorCode}`;
  }
  if (signal !== void 0) {
    return `was killed with ${signal} (${signalDescription})`;
  }
  if (exitCode !== void 0) {
    return `failed with exit code ${exitCode}`;
  }
  return "failed";
};
const makeError$1 = ({
  stdout,
  stderr,
  all,
  error: error2,
  signal,
  exitCode,
  command: command2,
  escapedCommand,
  timedOut,
  isCanceled,
  killed,
  parsed: { options: { timeout } }
}) => {
  exitCode = exitCode === null ? void 0 : exitCode;
  signal = signal === null ? void 0 : signal;
  const signalDescription = signal === void 0 ? void 0 : signalsByName[signal].description;
  const errorCode = error2 && error2.code;
  const prefix = getErrorPrefix({ timedOut, timeout, errorCode, signal, signalDescription, exitCode, isCanceled });
  const execaMessage = `Command ${prefix}: ${command2}`;
  const isError = Object.prototype.toString.call(error2) === "[object Error]";
  const shortMessage = isError ? `${execaMessage}
${error2.message}` : execaMessage;
  const message = [shortMessage, stderr, stdout].filter(Boolean).join("\n");
  if (isError) {
    error2.originalMessage = error2.message;
    error2.message = message;
  } else {
    error2 = new Error(message);
  }
  error2.shortMessage = shortMessage;
  error2.command = command2;
  error2.escapedCommand = escapedCommand;
  error2.exitCode = exitCode;
  error2.signal = signal;
  error2.signalDescription = signalDescription;
  error2.stdout = stdout;
  error2.stderr = stderr;
  if (all !== void 0) {
    error2.all = all;
  }
  if ("bufferedData" in error2) {
    delete error2.bufferedData;
  }
  error2.failed = true;
  error2.timedOut = Boolean(timedOut);
  error2.isCanceled = isCanceled;
  error2.killed = killed && !timedOut;
  return error2;
};
var error = makeError$1;
var stdio = { exports: {} };
const aliases = ["stdin", "stdout", "stderr"];
const hasAlias = (options) => aliases.some((alias) => options[alias] !== void 0);
const normalizeStdio$1 = (options) => {
  if (!options) {
    return;
  }
  const { stdio: stdio2 } = options;
  if (stdio2 === void 0) {
    return aliases.map((alias) => options[alias]);
  }
  if (hasAlias(options)) {
    throw new Error(`It's not possible to provide \`stdio\` in combination with one of ${aliases.map((alias) => `\`${alias}\``).join(", ")}`);
  }
  if (typeof stdio2 === "string") {
    return stdio2;
  }
  if (!Array.isArray(stdio2)) {
    throw new TypeError(`Expected \`stdio\` to be of type \`string\` or \`Array\`, got \`${typeof stdio2}\``);
  }
  const length = Math.max(stdio2.length, aliases.length);
  return Array.from({ length }, (value, index) => stdio2[index]);
};
stdio.exports = normalizeStdio$1;
stdio.exports.node = (options) => {
  const stdio2 = normalizeStdio$1(options);
  if (stdio2 === "ipc") {
    return "ipc";
  }
  if (stdio2 === void 0 || typeof stdio2 === "string") {
    return [stdio2, stdio2, stdio2, "ipc"];
  }
  if (stdio2.includes("ipc")) {
    return stdio2;
  }
  return [...stdio2, "ipc"];
};
var stdioExports = stdio.exports;
var signalExit = { exports: {} };
var signals$1 = { exports: {} };
var hasRequiredSignals;
function requireSignals() {
  if (hasRequiredSignals) return signals$1.exports;
  hasRequiredSignals = 1;
  (function(module2) {
    module2.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module2.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module2.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  })(signals$1);
  return signals$1.exports;
}
var process$1 = commonjsGlobal.process;
const processOk = function(process2) {
  return process2 && typeof process2 === "object" && typeof process2.removeListener === "function" && typeof process2.emit === "function" && typeof process2.reallyExit === "function" && typeof process2.listeners === "function" && typeof process2.kill === "function" && typeof process2.pid === "number" && typeof process2.on === "function";
};
if (!processOk(process$1)) {
  signalExit.exports = function() {
    return function() {
    };
  };
} else {
  var assert = require$$0$5;
  var signals = requireSignals();
  var isWin = /^win/i.test(process$1.platform);
  var EE = require$$0$4;
  if (typeof EE !== "function") {
    EE = EE.EventEmitter;
  }
  var emitter;
  if (process$1.__signal_exit_emitter__) {
    emitter = process$1.__signal_exit_emitter__;
  } else {
    emitter = process$1.__signal_exit_emitter__ = new EE();
    emitter.count = 0;
    emitter.emitted = {};
  }
  if (!emitter.infinite) {
    emitter.setMaxListeners(Infinity);
    emitter.infinite = true;
  }
  signalExit.exports = function(cb, opts) {
    if (!processOk(commonjsGlobal.process)) {
      return function() {
      };
    }
    assert.equal(typeof cb, "function", "a callback must be provided for exit handler");
    if (loaded === false) {
      load();
    }
    var ev = "exit";
    if (opts && opts.alwaysLast) {
      ev = "afterexit";
    }
    var remove = function() {
      emitter.removeListener(ev, cb);
      if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
        unload();
      }
    };
    emitter.on(ev, cb);
    return remove;
  };
  var unload = function unload2() {
    if (!loaded || !processOk(commonjsGlobal.process)) {
      return;
    }
    loaded = false;
    signals.forEach(function(sig) {
      try {
        process$1.removeListener(sig, sigListeners[sig]);
      } catch (er) {
      }
    });
    process$1.emit = originalProcessEmit;
    process$1.reallyExit = originalProcessReallyExit;
    emitter.count -= 1;
  };
  signalExit.exports.unload = unload;
  var emit = function emit2(event, code, signal) {
    if (emitter.emitted[event]) {
      return;
    }
    emitter.emitted[event] = true;
    emitter.emit(event, code, signal);
  };
  var sigListeners = {};
  signals.forEach(function(sig) {
    sigListeners[sig] = function listener() {
      if (!processOk(commonjsGlobal.process)) {
        return;
      }
      var listeners = process$1.listeners(sig);
      if (listeners.length === emitter.count) {
        unload();
        emit("exit", null, sig);
        emit("afterexit", null, sig);
        if (isWin && sig === "SIGHUP") {
          sig = "SIGINT";
        }
        process$1.kill(process$1.pid, sig);
      }
    };
  });
  signalExit.exports.signals = function() {
    return signals;
  };
  var loaded = false;
  var load = function load2() {
    if (loaded || !processOk(commonjsGlobal.process)) {
      return;
    }
    loaded = true;
    emitter.count += 1;
    signals = signals.filter(function(sig) {
      try {
        process$1.on(sig, sigListeners[sig]);
        return true;
      } catch (er) {
        return false;
      }
    });
    process$1.emit = processEmit;
    process$1.reallyExit = processReallyExit;
  };
  signalExit.exports.load = load;
  var originalProcessReallyExit = process$1.reallyExit;
  var processReallyExit = function processReallyExit2(code) {
    if (!processOk(commonjsGlobal.process)) {
      return;
    }
    process$1.exitCode = code || /* istanbul ignore next */
    0;
    emit("exit", process$1.exitCode, null);
    emit("afterexit", process$1.exitCode, null);
    originalProcessReallyExit.call(process$1, process$1.exitCode);
  };
  var originalProcessEmit = process$1.emit;
  var processEmit = function processEmit2(ev, arg) {
    if (ev === "exit" && processOk(commonjsGlobal.process)) {
      if (arg !== void 0) {
        process$1.exitCode = arg;
      }
      var ret = originalProcessEmit.apply(this, arguments);
      emit("exit", process$1.exitCode, null);
      emit("afterexit", process$1.exitCode, null);
      return ret;
    } else {
      return originalProcessEmit.apply(this, arguments);
    }
  };
}
var signalExitExports = signalExit.exports;
const os = require$$0$3;
const onExit = signalExitExports;
const DEFAULT_FORCE_KILL_TIMEOUT = 1e3 * 5;
const spawnedKill$1 = (kill2, signal = "SIGTERM", options = {}) => {
  const killResult = kill2(signal);
  setKillTimeout(kill2, signal, options, killResult);
  return killResult;
};
const setKillTimeout = (kill2, signal, options, killResult) => {
  if (!shouldForceKill(signal, options, killResult)) {
    return;
  }
  const timeout = getForceKillAfterTimeout(options);
  const t = setTimeout(() => {
    kill2("SIGKILL");
  }, timeout);
  if (t.unref) {
    t.unref();
  }
};
const shouldForceKill = (signal, { forceKillAfterTimeout }, killResult) => {
  return isSigterm(signal) && forceKillAfterTimeout !== false && killResult;
};
const isSigterm = (signal) => {
  return signal === os.constants.signals.SIGTERM || typeof signal === "string" && signal.toUpperCase() === "SIGTERM";
};
const getForceKillAfterTimeout = ({ forceKillAfterTimeout = true }) => {
  if (forceKillAfterTimeout === true) {
    return DEFAULT_FORCE_KILL_TIMEOUT;
  }
  if (!Number.isFinite(forceKillAfterTimeout) || forceKillAfterTimeout < 0) {
    throw new TypeError(`Expected the \`forceKillAfterTimeout\` option to be a non-negative integer, got \`${forceKillAfterTimeout}\` (${typeof forceKillAfterTimeout})`);
  }
  return forceKillAfterTimeout;
};
const spawnedCancel$1 = (spawned, context) => {
  const killResult = spawned.kill();
  if (killResult) {
    context.isCanceled = true;
  }
};
const timeoutKill = (spawned, signal, reject) => {
  spawned.kill(signal);
  reject(Object.assign(new Error("Timed out"), { timedOut: true, signal }));
};
const setupTimeout$1 = (spawned, { timeout, killSignal = "SIGTERM" }, spawnedPromise) => {
  if (timeout === 0 || timeout === void 0) {
    return spawnedPromise;
  }
  let timeoutId;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      timeoutKill(spawned, killSignal, reject);
    }, timeout);
  });
  const safeSpawnedPromise = spawnedPromise.finally(() => {
    clearTimeout(timeoutId);
  });
  return Promise.race([timeoutPromise, safeSpawnedPromise]);
};
const validateTimeout$1 = ({ timeout }) => {
  if (timeout !== void 0 && (!Number.isFinite(timeout) || timeout < 0)) {
    throw new TypeError(`Expected the \`timeout\` option to be a non-negative integer, got \`${timeout}\` (${typeof timeout})`);
  }
};
const setExitHandler$1 = async (spawned, { cleanup, detached }, timedPromise) => {
  if (!cleanup || detached) {
    return timedPromise;
  }
  const removeExitHandler = onExit(() => {
    spawned.kill();
  });
  return timedPromise.finally(() => {
    removeExitHandler();
  });
};
var kill = {
  spawnedKill: spawnedKill$1,
  spawnedCancel: spawnedCancel$1,
  setupTimeout: setupTimeout$1,
  validateTimeout: validateTimeout$1,
  setExitHandler: setExitHandler$1
};
const isStream$1 = (stream2) => stream2 !== null && typeof stream2 === "object" && typeof stream2.pipe === "function";
isStream$1.writable = (stream2) => isStream$1(stream2) && stream2.writable !== false && typeof stream2._write === "function" && typeof stream2._writableState === "object";
isStream$1.readable = (stream2) => isStream$1(stream2) && stream2.readable !== false && typeof stream2._read === "function" && typeof stream2._readableState === "object";
isStream$1.duplex = (stream2) => isStream$1.writable(stream2) && isStream$1.readable(stream2);
isStream$1.transform = (stream2) => isStream$1.duplex(stream2) && typeof stream2._transform === "function";
var isStream_1 = isStream$1;
var getStream$2 = { exports: {} };
const { PassThrough: PassThroughStream } = require$$0$6;
var bufferStream$1 = (options) => {
  options = { ...options };
  const { array } = options;
  let { encoding } = options;
  const isBuffer = encoding === "buffer";
  let objectMode = false;
  if (array) {
    objectMode = !(encoding || isBuffer);
  } else {
    encoding = encoding || "utf8";
  }
  if (isBuffer) {
    encoding = null;
  }
  const stream2 = new PassThroughStream({ objectMode });
  if (encoding) {
    stream2.setEncoding(encoding);
  }
  let length = 0;
  const chunks = [];
  stream2.on("data", (chunk) => {
    chunks.push(chunk);
    if (objectMode) {
      length = chunks.length;
    } else {
      length += chunk.length;
    }
  });
  stream2.getBufferedValue = () => {
    if (array) {
      return chunks;
    }
    return isBuffer ? Buffer.concat(chunks, length) : chunks.join("");
  };
  stream2.getBufferedLength = () => length;
  return stream2;
};
const { constants: BufferConstants } = require$$0$7;
const stream$1 = require$$0$6;
const { promisify } = require$$2;
const bufferStream = bufferStream$1;
const streamPipelinePromisified = promisify(stream$1.pipeline);
class MaxBufferError extends Error {
  constructor() {
    super("maxBuffer exceeded");
    this.name = "MaxBufferError";
  }
}
async function getStream$1(inputStream, options) {
  if (!inputStream) {
    throw new Error("Expected a stream");
  }
  options = {
    maxBuffer: Infinity,
    ...options
  };
  const { maxBuffer } = options;
  const stream2 = bufferStream(options);
  await new Promise((resolve, reject) => {
    const rejectPromise = (error2) => {
      if (error2 && stream2.getBufferedLength() <= BufferConstants.MAX_LENGTH) {
        error2.bufferedData = stream2.getBufferedValue();
      }
      reject(error2);
    };
    (async () => {
      try {
        await streamPipelinePromisified(inputStream, stream2);
        resolve();
      } catch (error2) {
        rejectPromise(error2);
      }
    })();
    stream2.on("data", () => {
      if (stream2.getBufferedLength() > maxBuffer) {
        rejectPromise(new MaxBufferError());
      }
    });
  });
  return stream2.getBufferedValue();
}
getStream$2.exports = getStream$1;
getStream$2.exports.buffer = (stream2, options) => getStream$1(stream2, { ...options, encoding: "buffer" });
getStream$2.exports.array = (stream2, options) => getStream$1(stream2, { ...options, array: true });
getStream$2.exports.MaxBufferError = MaxBufferError;
var getStreamExports = getStream$2.exports;
const { PassThrough } = require$$0$6;
var mergeStream$1 = function() {
  var sources = [];
  var output = new PassThrough({ objectMode: true });
  output.setMaxListeners(0);
  output.add = add;
  output.isEmpty = isEmpty;
  output.on("unpipe", remove);
  Array.prototype.slice.call(arguments).forEach(add);
  return output;
  function add(source) {
    if (Array.isArray(source)) {
      source.forEach(add);
      return this;
    }
    sources.push(source);
    source.once("end", remove.bind(null, source));
    source.once("error", output.emit.bind(output, "error"));
    source.pipe(output, { end: false });
    return this;
  }
  function isEmpty() {
    return sources.length == 0;
  }
  function remove(source) {
    sources = sources.filter(function(it) {
      return it !== source;
    });
    if (!sources.length && output.readable) {
      output.end();
    }
  }
};
const isStream = isStream_1;
const getStream = getStreamExports;
const mergeStream = mergeStream$1;
const handleInput$1 = (spawned, input) => {
  if (input === void 0 || spawned.stdin === void 0) {
    return;
  }
  if (isStream(input)) {
    input.pipe(spawned.stdin);
  } else {
    spawned.stdin.end(input);
  }
};
const makeAllStream$1 = (spawned, { all }) => {
  if (!all || !spawned.stdout && !spawned.stderr) {
    return;
  }
  const mixed = mergeStream();
  if (spawned.stdout) {
    mixed.add(spawned.stdout);
  }
  if (spawned.stderr) {
    mixed.add(spawned.stderr);
  }
  return mixed;
};
const getBufferedData = async (stream2, streamPromise) => {
  if (!stream2) {
    return;
  }
  stream2.destroy();
  try {
    return await streamPromise;
  } catch (error2) {
    return error2.bufferedData;
  }
};
const getStreamPromise = (stream2, { encoding, buffer, maxBuffer }) => {
  if (!stream2 || !buffer) {
    return;
  }
  if (encoding) {
    return getStream(stream2, { encoding, maxBuffer });
  }
  return getStream.buffer(stream2, { maxBuffer });
};
const getSpawnedResult$1 = async ({ stdout, stderr, all }, { encoding, buffer, maxBuffer }, processDone) => {
  const stdoutPromise = getStreamPromise(stdout, { encoding, buffer, maxBuffer });
  const stderrPromise = getStreamPromise(stderr, { encoding, buffer, maxBuffer });
  const allPromise = getStreamPromise(all, { encoding, buffer, maxBuffer: maxBuffer * 2 });
  try {
    return await Promise.all([processDone, stdoutPromise, stderrPromise, allPromise]);
  } catch (error2) {
    return Promise.all([
      { error: error2, signal: error2.signal, timedOut: error2.timedOut },
      getBufferedData(stdout, stdoutPromise),
      getBufferedData(stderr, stderrPromise),
      getBufferedData(all, allPromise)
    ]);
  }
};
const validateInputSync$1 = ({ input }) => {
  if (isStream(input)) {
    throw new TypeError("The `input` option cannot be a stream in sync mode");
  }
};
var stream = {
  handleInput: handleInput$1,
  makeAllStream: makeAllStream$1,
  getSpawnedResult: getSpawnedResult$1,
  validateInputSync: validateInputSync$1
};
const nativePromisePrototype = (async () => {
})().constructor.prototype;
const descriptors = ["then", "catch", "finally"].map((property) => [
  property,
  Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)
]);
const mergePromise$1 = (spawned, promise2) => {
  for (const [property, descriptor] of descriptors) {
    const value = typeof promise2 === "function" ? (...args2) => Reflect.apply(descriptor.value, promise2(), args2) : descriptor.value.bind(promise2);
    Reflect.defineProperty(spawned, property, { ...descriptor, value });
  }
  return spawned;
};
const getSpawnedPromise$1 = (spawned) => {
  return new Promise((resolve, reject) => {
    spawned.on("exit", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
    spawned.on("error", (error2) => {
      reject(error2);
    });
    if (spawned.stdin) {
      spawned.stdin.on("error", (error2) => {
        reject(error2);
      });
    }
  });
};
var promise = {
  mergePromise: mergePromise$1,
  getSpawnedPromise: getSpawnedPromise$1
};
const normalizeArgs = (file, args2 = []) => {
  if (!Array.isArray(args2)) {
    return [file];
  }
  return [file, ...args2];
};
const NO_ESCAPE_REGEXP = /^[\w.-]+$/;
const DOUBLE_QUOTES_REGEXP = /"/g;
const escapeArg = (arg) => {
  if (typeof arg !== "string" || NO_ESCAPE_REGEXP.test(arg)) {
    return arg;
  }
  return `"${arg.replace(DOUBLE_QUOTES_REGEXP, '\\"')}"`;
};
const joinCommand$1 = (file, args2) => {
  return normalizeArgs(file, args2).join(" ");
};
const getEscapedCommand$1 = (file, args2) => {
  return normalizeArgs(file, args2).map((arg) => escapeArg(arg)).join(" ");
};
const SPACES_REGEXP = / +/g;
const parseCommand$1 = (command2) => {
  const tokens = [];
  for (const token of command2.trim().split(SPACES_REGEXP)) {
    const previousToken = tokens[tokens.length - 1];
    if (previousToken && previousToken.endsWith("\\")) {
      tokens[tokens.length - 1] = `${previousToken.slice(0, -1)} ${token}`;
    } else {
      tokens.push(token);
    }
  }
  return tokens;
};
var command = {
  joinCommand: joinCommand$1,
  getEscapedCommand: getEscapedCommand$1,
  parseCommand: parseCommand$1
};
const path = require$$0$2;
const childProcess = require$$0;
const crossSpawn = crossSpawnExports;
const stripFinalNewline = stripFinalNewline$1;
const npmRunPath = npmRunPathExports;
const onetime = onetimeExports;
const makeError = error;
const normalizeStdio = stdioExports;
const { spawnedKill, spawnedCancel, setupTimeout, validateTimeout, setExitHandler } = kill;
const { handleInput, getSpawnedResult, makeAllStream, validateInputSync } = stream;
const { mergePromise, getSpawnedPromise } = promise;
const { joinCommand, parseCommand, getEscapedCommand } = command;
const DEFAULT_MAX_BUFFER = 1e3 * 1e3 * 100;
const getEnv = ({ env: envOption, extendEnv, preferLocal, localDir, execPath }) => {
  const env2 = extendEnv ? { ...process.env, ...envOption } : envOption;
  if (preferLocal) {
    return npmRunPath.env({ env: env2, cwd: localDir, execPath });
  }
  return env2;
};
const handleArguments = (file, args2, options = {}) => {
  const parsed = crossSpawn._parse(file, args2, options);
  file = parsed.command;
  args2 = parsed.args;
  options = parsed.options;
  options = {
    maxBuffer: DEFAULT_MAX_BUFFER,
    buffer: true,
    stripFinalNewline: true,
    extendEnv: true,
    preferLocal: false,
    localDir: options.cwd || process.cwd(),
    execPath: process.execPath,
    encoding: "utf8",
    reject: true,
    cleanup: true,
    all: false,
    windowsHide: true,
    ...options
  };
  options.env = getEnv(options);
  options.stdio = normalizeStdio(options);
  if (process.platform === "win32" && path.basename(file, ".exe") === "cmd") {
    args2.unshift("/q");
  }
  return { file, args: args2, options, parsed };
};
const handleOutput = (options, value, error2) => {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    return error2 === void 0 ? void 0 : "";
  }
  if (options.stripFinalNewline) {
    return stripFinalNewline(value);
  }
  return value;
};
const execa$1 = (file, args2, options) => {
  const parsed = handleArguments(file, args2, options);
  const command2 = joinCommand(file, args2);
  const escapedCommand = getEscapedCommand(file, args2);
  validateTimeout(parsed.options);
  let spawned;
  try {
    spawned = childProcess.spawn(parsed.file, parsed.args, parsed.options);
  } catch (error2) {
    const dummySpawned = new childProcess.ChildProcess();
    const errorPromise = Promise.reject(makeError({
      error: error2,
      stdout: "",
      stderr: "",
      all: "",
      command: command2,
      escapedCommand,
      parsed,
      timedOut: false,
      isCanceled: false,
      killed: false
    }));
    return mergePromise(dummySpawned, errorPromise);
  }
  const spawnedPromise = getSpawnedPromise(spawned);
  const timedPromise = setupTimeout(spawned, parsed.options, spawnedPromise);
  const processDone = setExitHandler(spawned, parsed.options, timedPromise);
  const context = { isCanceled: false };
  spawned.kill = spawnedKill.bind(null, spawned.kill.bind(spawned));
  spawned.cancel = spawnedCancel.bind(null, spawned, context);
  const handlePromise = async () => {
    const [{ error: error2, exitCode, signal, timedOut }, stdoutResult, stderrResult, allResult] = await getSpawnedResult(spawned, parsed.options, processDone);
    const stdout = handleOutput(parsed.options, stdoutResult);
    const stderr = handleOutput(parsed.options, stderrResult);
    const all = handleOutput(parsed.options, allResult);
    if (error2 || exitCode !== 0 || signal !== null) {
      const returnedError = makeError({
        error: error2,
        exitCode,
        signal,
        stdout,
        stderr,
        all,
        command: command2,
        escapedCommand,
        parsed,
        timedOut,
        isCanceled: context.isCanceled,
        killed: spawned.killed
      });
      if (!parsed.options.reject) {
        return returnedError;
      }
      throw returnedError;
    }
    return {
      command: command2,
      escapedCommand,
      exitCode: 0,
      stdout,
      stderr,
      all,
      failed: false,
      timedOut: false,
      isCanceled: false,
      killed: false
    };
  };
  const handlePromiseOnce = onetime(handlePromise);
  handleInput(spawned, parsed.options.input);
  spawned.all = makeAllStream(spawned, parsed.options);
  return mergePromise(spawned, handlePromiseOnce);
};
execa$2.exports = execa$1;
execa$2.exports.sync = (file, args2, options) => {
  const parsed = handleArguments(file, args2, options);
  const command2 = joinCommand(file, args2);
  const escapedCommand = getEscapedCommand(file, args2);
  validateInputSync(parsed.options);
  let result;
  try {
    result = childProcess.spawnSync(parsed.file, parsed.args, parsed.options);
  } catch (error2) {
    throw makeError({
      error: error2,
      stdout: "",
      stderr: "",
      all: "",
      command: command2,
      escapedCommand,
      parsed,
      timedOut: false,
      isCanceled: false,
      killed: false
    });
  }
  const stdout = handleOutput(parsed.options, result.stdout, result.error);
  const stderr = handleOutput(parsed.options, result.stderr, result.error);
  if (result.error || result.status !== 0 || result.signal !== null) {
    const error2 = makeError({
      stdout,
      stderr,
      error: result.error,
      signal: result.signal,
      exitCode: result.status,
      command: command2,
      escapedCommand,
      parsed,
      timedOut: result.error && result.error.code === "ETIMEDOUT",
      isCanceled: false,
      killed: result.signal !== null
    });
    if (!parsed.options.reject) {
      return error2;
    }
    throw error2;
  }
  return {
    command: command2,
    escapedCommand,
    exitCode: 0,
    stdout,
    stderr,
    failed: false,
    timedOut: false,
    isCanceled: false,
    killed: false
  };
};
execa$2.exports.command = (command2, options) => {
  const [file, ...args2] = parseCommand(command2);
  return execa$1(file, args2, options);
};
execa$2.exports.commandSync = (command2, options) => {
  const [file, ...args2] = parseCommand(command2);
  return execa$1.sync(file, args2, options);
};
execa$2.exports.node = (scriptPath, args2, options = {}) => {
  if (args2 && !Array.isArray(args2) && typeof args2 === "object") {
    options = args2;
    args2 = [];
  }
  const stdio2 = normalizeStdio.node(options);
  const defaultExecArgv = process.execArgv.filter((arg) => !arg.startsWith("--inspect"));
  const {
    nodePath = process.execPath,
    nodeOptions = defaultExecArgv
  } = options;
  return execa$1(
    nodePath,
    [
      ...nodeOptions,
      scriptPath,
      ...Array.isArray(args2) ? args2 : []
    ],
    {
      ...options,
      stdin: void 0,
      stdout: void 0,
      stderr: void 0,
      stdio: stdio2,
      shell: false
    }
  );
};
var execaExports = execa$2.exports;
const execa = /* @__PURE__ */ getDefaultExportFromCjs(execaExports);
function ansiRegex$1({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? void 0 : "g");
}
const regex$1 = ansiRegex$1();
function stripAnsi$1(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex$1, "");
}
const detectDefaultShell = () => {
  const { env: env2 } = process$2;
  if (process$2.platform === "win32") {
    return env2.COMSPEC || "cmd.exe";
  }
  try {
    const { shell } = node_os.userInfo();
    if (shell) {
      return shell;
    }
  } catch {
  }
  if (process$2.platform === "darwin") {
    return env2.SHELL || "/bin/zsh";
  }
  return env2.SHELL || "/bin/sh";
};
const defaultShell = detectDefaultShell();
const args = [
  "-ilc",
  'echo -n "_SHELL_ENV_DELIMITER_"; env; echo -n "_SHELL_ENV_DELIMITER_"; exit'
];
const env = {
  // Disables Oh My Zsh auto-update thing that can block the process.
  DISABLE_AUTO_UPDATE: "true"
};
const parseEnv = (env2) => {
  env2 = env2.split("_SHELL_ENV_DELIMITER_")[1];
  const returnValue = {};
  for (const line of stripAnsi$1(env2).split("\n").filter((line2) => Boolean(line2))) {
    const [key, ...values] = line.split("=");
    returnValue[key] = values.join("=");
  }
  return returnValue;
};
function shellEnvSync(shell) {
  if (process$2.platform === "win32") {
    return process$2.env;
  }
  try {
    const { stdout } = execa.sync(shell || defaultShell, args, { env });
    return parseEnv(stdout);
  } catch (error2) {
    {
      return process$2.env;
    }
  }
}
function shellPathSync(options) {
  const { PATH } = shellEnvSync(options == null ? void 0 : options.shell);
  return PATH;
}
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? void 0 : "g");
}
const regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}
function fixPath() {
  if (process$2.platform === "win32") {
    return;
  }
  const shellPath = shellPathSync();
  process$2.env.PATH = (shellPath ? stripAnsi(shellPath) : void 0) || [
    "./node_modules/.bin",
    "/.nodebrew/current/bin",
    "/usr/local/bin",
    process$2.env.PATH
  ].join(":");
}
fixPath();
const processes = {};
const serviceStatus = {
  ollama: "starting",
  lmstudio: "starting"
};
const SERVICES = [
  {
    id: "ollama",
    cmd: "ollama",
    args: ["serve"],
    checkUrl: "http://localhost:11434"
  },
  {
    id: "lmstudio",
    cmd: "lms",
    args: ["server", "start"],
    checkUrl: "http://localhost:1234/v1/models"
  }
];
const waitForServer = async (url, timeoutMs = 15e3, intervalMs = 1e3) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2e3) });
      if (response.ok) {
        return true;
      }
    } catch (error2) {
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
  console.log(`[Services] Starting ${service.id}: ${service.cmd} ${service.args.join(" ")}`);
  serviceStatus[service.id] = "starting";
  try {
    const child = require$$0.spawn(service.cmd, service.args, {
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
      if (code !== 0 && serviceStatus[service.id] === "starting") {
        serviceStatus[service.id] = "failed";
      }
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
  } catch (error2) {
    console.error(`[Services] Failed to start ${service.id}:`, error2 == null ? void 0 : error2.message);
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
process.env.DIST = path$4.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path$4.join(process.env.DIST, "../public");
let win = null;
let splash = null;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createSplashWindow() {
  const splashPath = electron.app.isPackaged ? path$4.join(process.resourcesPath, "icon-splash.png") : path$4.join(__dirname, "../icon-splash.png");
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
  console.log("[Main] Preload path:", path$4.join(__dirname, "preload.cjs"));
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0c0c0e",
    // Fix "flash bang" white screen
    show: false,
    // Don't show until ready
    icon: electron.app.isPackaged ? path$4.join(process.resourcesPath, "icon-splash.png") : path$4.join(__dirname, "../icon-splash.png"),
    webPreferences: {
      preload: path$4.join(__dirname, "preload.cjs"),
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
    const indexHtml = path$4.join(__dirname, "../dist_renderer/index.html");
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
exports.getDefaultExportFromCjs = getDefaultExportFromCjs;
