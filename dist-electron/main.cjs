"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const require$$0 = require("child_process");
const path$1 = require("path");
const os = require("os");
const fs$1 = require("fs");
const fs$2 = require("node:fs/promises");
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
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path$1);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
function extractBase64Image(dataUrl) {
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/i);
  if (match == null ? void 0 : match[1]) return match[1];
  if (/^[A-Za-z0-9+/=\s]+$/.test(dataUrl) && dataUrl.length > 100) {
    return dataUrl.replace(/\s/g, "");
  }
  return null;
}
function toOllamaMessages(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const textParts = message.content.filter((part) => part.type === "text").map((part) => part.text || "").filter(Boolean);
    const images = message.content.filter((part) => part.type === "image_url").map((part) => {
      var _a;
      return extractBase64Image(((_a = part.image_url) == null ? void 0 : _a.url) || "");
    }).filter(Boolean);
    return {
      role: message.role,
      content: textParts.join("\n") || "Describe this image.",
      ...images.length > 0 ? { images } : {}
    };
  });
}
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
  async unloadOtherRunningModels(modelId) {
    try {
      const response = await fetch(`${this.baseUrl}/api/ps`);
      if (!response.ok) return;
      const data = await response.json();
      const runningModels = data.models || [];
      for (const running of runningModels) {
        const name = running.name || running.model || "";
        if (name && name !== modelId) {
          console.log("[Ollama] Unloading previous running model before switching:", name);
          await this.unloadModel(name);
        }
      }
    } catch (error) {
      console.warn("[Ollama] Could not inspect/unload previous running models:", error);
    }
  }
  async *chat(messages, config, signal) {
    var _a;
    try {
      await this.unloadOtherRunningModels(config.model);
      const ollamaMessages = toOllamaMessages(messages);
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: ollamaMessages,
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
let mainWindow = null;
function setMainWindowForLMStudio(window) {
  mainWindow = window;
}
async function getClient() {
  if (clientCreationFailed) {
    clientCreationFailed = false;
    clientInstance = null;
  }
  if (!clientInstance) {
    try {
      console.log("[LM Studio SDK] Creating new client instance...");
      const { LMStudioClient } = await Promise.resolve().then(() => require("./index-K9cYHCaJ.js"));
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
function emitLoadProgress(model, progress, status) {
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  mainWindow == null ? void 0 : mainWindow.webContents.send("llm:load-progress", {
    model,
    progress: normalizedProgress,
    status
  });
}
function getSafeContextLength(requestedContextLength) {
  const requested = requestedContextLength || 4096;
  const configuredCap = Number.parseInt(process.env.LMSTUDIO_MAX_CONTEXT_LENGTH || "", 10);
  const cap = Number.isFinite(configuredCap) && configuredCap > 0 ? configuredCap : 32768;
  const safeContext = Math.max(1024, Math.min(requested, cap));
  if (safeContext !== requested) {
    console.warn(`[LM Studio] Requested context ${requested} exceeds VRAM-safe cap ${cap}; using ${safeContext}. Set LMSTUDIO_MAX_CONTEXT_LENGTH to override.`);
  }
  return safeContext;
}
function getRestHeaders(accept = "application/json") {
  var _a, _b;
  const headers = {
    "Content-Type": "application/json",
    Accept: accept
  };
  const token = ((_a = process.env.LM_API_TOKEN) == null ? void 0 : _a.trim()) || ((_b = process.env.LMSTUDIO_API_KEY) == null ? void 0 : _b.trim());
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
function parseSseDataEvents(buffer) {
  var _a;
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() || "";
  const events = [];
  for (const part of parts) {
    const lines = part.split("\n");
    const eventName = ((_a = lines.find((line) => line.startsWith("event:"))) == null ? void 0 : _a.slice("event:".length).trim()) || "";
    const dataText = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trimStart()).join("\n");
    if (!eventName || !dataText) {
      continue;
    }
    try {
      events.push({ event: eventName, data: JSON.parse(dataText) });
    } catch {
      console.warn("[LM Studio REST] Failed to parse SSE data:", dataText.slice(0, 200));
    }
  }
  return { events, remainder };
}
async function readRestError(response) {
  var _a;
  const raw = (await response.text().catch(() => "")).trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw);
    const detail = ((_a = parsed.error) == null ? void 0 : _a.message) || parsed.message || parsed.detail || parsed.error;
    if (typeof detail === "string") return detail;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}
function inferQuantizationFromFilename(fileName) {
  const stem = fileName.replace(/\.gguf$/i, "");
  const patterns = [
    /(?:^|[-_.])(I?Q\d(?:_[A-Z0-9]+)+)(?:$|[-_.])/i,
    /(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)*)(?:$|[-_.])/i
  ];
  for (const pattern of patterns) {
    const match = stem.match(pattern);
    if (match == null ? void 0 : match[1]) {
      return match[1].toUpperCase();
    }
  }
  return void 0;
}
function normalizeLMStudioDownloadRequest(input, explicitQuantization) {
  const trimmed = input.trim();
  const quantization = (explicitQuantization == null ? void 0 : explicitQuantization.trim()) || void 0;
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "huggingface.co") {
      return { model: trimmed, quantization };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return { model: trimmed, quantization };
    }
    const owner = parts[0];
    const repo = parts[1];
    const markerIndex = parts.findIndex((part) => part === "resolve" || part === "blob" || part === "tree");
    if (markerIndex === -1) {
      return { model: `https://huggingface.co/${owner}/${repo}`, quantization };
    }
    const fileName = decodeURIComponent(parts[parts.length - 1] || "");
    const inferredQuantization = fileName.toLowerCase().endsWith(".gguf") ? inferQuantizationFromFilename(fileName) : void 0;
    return {
      model: `https://huggingface.co/${owner}/${repo}`,
      quantization: quantization || inferredQuantization
    };
  } catch {
    return { model: trimmed, quantization };
  }
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
      console.log("[LM Studio REST] Listing models via native v1 API...");
      const response = await fetch(`${this.baseUrl}/api/v1/models`, {
        headers: getRestHeaders(),
        signal: AbortSignal.timeout(15e3)
      });
      if (response.ok) {
        const data = await response.json();
        const restModels = Array.isArray(data.models) ? data.models : [];
        const llmModels = restModels.filter((model) => model.type === "llm");
        console.log("[LM Studio REST] Got", llmModels.length, "LLM models");
        return llmModels.map((model) => {
          var _a2, _b, _c, _d, _e, _f;
          return {
            id: model.key,
            name: model.display_name || model.key,
            provider: "lmstudio",
            hasVision: ((_a2 = model.capabilities) == null ? void 0 : _a2.vision) === true,
            hasTools: ((_b = model.capabilities) == null ? void 0 : _b.trained_for_tool_use) === true,
            maxContext: model.max_context_length || 4096,
            architecture: model.architecture,
            quantization: (_c = model.quantization) == null ? void 0 : _c.name,
            paramsString: model.params_string,
            loadedContextLength: (_f = (_e = (_d = model.loaded_instances) == null ? void 0 : _d[0]) == null ? void 0 : _e.config) == null ? void 0 : _f.context_length,
            loadedInstanceCount: Array.isArray(model.loaded_instances) ? model.loaded_instances.length : 0
          };
        });
      }
      console.warn("[LM Studio REST] Native model list returned non-OK status:", response.status);
    } catch (restError) {
      console.warn("[LM Studio REST] Native model list failed:", (restError == null ? void 0 : restError.message) || restError);
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
  async downloadModel(model, quantization) {
    const { model: modelId, quantization: requestedQuantization } = normalizeLMStudioDownloadRequest(model, quantization);
    if (!modelId) {
      throw new Error("Enter a model catalog ID or Hugging Face URL.");
    }
    if (/\.gguf(?:\?.*)?$/i.test(modelId) && !modelId.startsWith("http")) {
      throw new Error("That looks like only a GGUF filename. Paste the Hugging Face repo URL or full GGUF file URL.");
    }
    const body = { model: modelId };
    if (requestedQuantization) {
      body.quantization = requestedQuantization;
    }
    console.log("[LM Studio REST] Starting model download:", body);
    const response = await fetch(`${this.baseUrl}/api/v1/models/download`, {
      method: "POST",
      headers: getRestHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15e3)
    });
    if (!response.ok) {
      const detail = await readRestError(response);
      throw new Error(`LM Studio download failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
    }
    const payload = await response.json();
    return {
      ...payload,
      requested_model: modelId,
      requested_quantization: requestedQuantization
    };
  }
  async getDownloadStatus(jobId) {
    const cleanJobId = jobId.trim();
    if (!cleanJobId) {
      throw new Error("Missing LM Studio download job id.");
    }
    const response = await fetch(`${this.baseUrl}/api/v1/models/download/status/${encodeURIComponent(cleanJobId)}`, {
      headers: getRestHeaders(),
      signal: AbortSignal.timeout(3e4)
    });
    if (!response.ok) {
      const detail = await readRestError(response);
      throw new Error(`LM Studio download status failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
    }
    return response.json();
  }
  async isModelLoaded(client, modelId) {
    try {
      const loadedModels = await client.llm.listLoaded();
      return loadedModels.some((loaded) => {
        const identifier = loaded.identifier || loaded.modelKey || loaded.path || "";
        return identifier === modelId || identifier.includes(modelId) || modelId.includes(identifier);
      });
    } catch (error) {
      console.warn("[LM Studio SDK] Could not inspect loaded models:", (error == null ? void 0 : error.message) || error);
      return false;
    }
  }
  getLoadedModelIdentifier(model) {
    return model.identifier || model.modelKey || model.path || "";
  }
  modelMatches(identifier, modelId) {
    return identifier === modelId || identifier.includes(modelId) || modelId.includes(identifier);
  }
  async unloadOtherLoadedModels(client, modelId) {
    try {
      const loadedModels = await client.llm.listLoaded();
      const toUnload = loadedModels.filter((loaded) => {
        const identifier = this.getLoadedModelIdentifier(loaded);
        return identifier && !this.modelMatches(identifier, modelId);
      });
      for (const loaded of toUnload) {
        const identifier = this.getLoadedModelIdentifier(loaded);
        console.log("[LM Studio] Unloading previously loaded model before switching:", identifier);
        await client.llm.unload(identifier);
      }
    } catch (error) {
      console.warn("[LM Studio] Could not unload previous loaded models:", (error == null ? void 0 : error.message) || error);
    }
  }
  async warmupModelWithRestProgress(modelId, config, signal) {
    var _a;
    emitLoadProgress(modelId, 0, "starting");
    const contextLength = getSafeContextLength(config.contextLength);
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    signal == null ? void 0 : signal.addEventListener("abort", relayAbort, { once: true });
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/chat`, {
        method: "POST",
        headers: getRestHeaders("text/event-stream"),
        body: JSON.stringify({
          model: modelId,
          input: "Say OK.",
          stream: true,
          store: false,
          context_length: contextLength,
          temperature: 0,
          max_output_tokens: 1
        }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(`REST warmup failed (${response.status} ${response.statusText}) ${detail}`.trim());
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        if (signal == null ? void 0 : signal.aborted) {
          controller.abort();
          return;
        }
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseDataEvents(buffer);
        buffer = parsed.remainder;
        for (const sse of parsed.events) {
          if (sse.event === "model_load.start") {
            emitLoadProgress(modelId, 0, "starting");
          } else if (sse.event === "model_load.progress") {
            emitLoadProgress(modelId, Number(sse.data.progress || 0) * 100, "loading");
          } else if (sse.event === "model_load.end") {
            emitLoadProgress(modelId, 100, "ready");
          } else if (sse.event === "error") {
            throw new Error(((_a = sse.data.error) == null ? void 0 : _a.message) || "LM Studio REST warmup stream failed.");
          }
        }
      }
      emitLoadProgress(modelId, 100, "ready");
    } catch (error) {
      if ((signal == null ? void 0 : signal.aborted) || (error == null ? void 0 : error.name) === "AbortError") {
        return;
      }
      console.warn("[LM Studio REST] Model warmup/progress unavailable, continuing with SDK:", (error == null ? void 0 : error.message) || error);
    } finally {
      signal == null ? void 0 : signal.removeEventListener("abort", relayAbort);
    }
  }
  /**
   * Chat using the official LM Studio SDK.
   * Uses client.llm.model() which reuses existing loaded models.
   */
  async *chat(messages, config, signal) {
    var _a, _b;
    try {
      const client = await getClient();
      await this.unloadOtherLoadedModels(client, config.model);
      const alreadyLoaded = await this.isModelLoaded(client, config.model);
      if (!alreadyLoaded) {
        await this.warmupModelWithRestProgress(config.model, config, signal);
      } else {
        emitLoadProgress(config.model, 100, "ready");
      }
      const contextLength = getSafeContextLength(config.contextLength);
      console.log("[LM Studio SDK] Getting model:", config.model, "with context:", contextLength);
      const model = await client.llm.model(config.model, {
        config: {
          contextLength
        }
      });
      const sdkMessages = await Promise.all(messages.map(async (m) => {
        var _a2, _b2, _c, _d;
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
              const base64Match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (base64Match) {
                base64Data = base64Match[2];
              } else if (url && url.length > 20) {
                base64Data = url;
              }
              if (base64Data) {
                console.log("[LM Studio SDK] Processing image, base64 length:", base64Data.length);
                try {
                  const extension = ((_b2 = base64Match == null ? void 0 : base64Match[1]) == null ? void 0 : _b2.includes("jpeg")) || ((_c = base64Match == null ? void 0 : base64Match[1]) == null ? void 0 : _c.includes("jpg")) ? "jpg" : ((_d = base64Match == null ? void 0 : base64Match[1]) == null ? void 0 : _d.includes("webp")) ? "webp" : "png";
                  const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
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
    const { LMStudioClient } = await Promise.resolve().then(() => require("./index-K9cYHCaJ.js"));
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
    electron.ipcMain.handle("llm:download-lmstudio-model", async (_, model, quantization) => {
      return this.providers.lmstudio.downloadModel(model, quantization);
    });
    electron.ipcMain.handle("llm:get-lmstudio-download-status", async (_, jobId) => {
      return this.providers.lmstudio.getDownloadStatus(jobId);
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
    addColumnIfNotExists("conversations", "thinking_mode", 'TEXT DEFAULT "no_think"');
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
      'ai_region TEXT DEFAULT "all"',
      'user_region TEXT DEFAULT "all"',
      "last_model TEXT",
      "last_provider TEXT",
      "temperature REAL DEFAULT 0.7",
      "max_tokens INTEGER DEFAULT 2048",
      "context_length INTEGER DEFAULT 4096",
      "top_k INTEGER DEFAULT 40",
      "top_p REAL DEFAULT 0.95",
      "repeat_penalty REAL DEFAULT 1.1",
      'thinking_mode TEXT DEFAULT "no_think"',
      "ai_avatar_position INTEGER DEFAULT 30",
      "user_avatar_position INTEGER DEFAULT 30",
      "user_persona TEXT",
      "auto_play INTEGER DEFAULT 0",
      "user_auto_play INTEGER DEFAULT 0",
      'ai_rate TEXT DEFAULT "+0%"',
      'ai_pitch TEXT DEFAULT "+0Hz"',
      "tts_chunk_target INTEGER DEFAULT 450",
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
  serializeContent(content) {
    return Array.isArray(content) ? JSON.stringify(content) : content;
  },
  create(message) {
    const db2 = getDb();
    console.log("[DB] Saving message:", message.id, "model:", message.model);
    const safeMessage = {
      images: null,
      tool_calls: null,
      tool_result: null,
      model: null,
      ...message,
      content: messageService.serializeContent(message.content)
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
    const target = db2.prepare("SELECT conversation_id, rowid FROM messages WHERE id = ?").get(messageId);
    if (!target) return { changes: 0 };
    const remove = db2.transaction(() => {
      const result = db2.prepare(`
                DELETE FROM messages
                WHERE conversation_id = @conversation_id
                  AND rowid >= @rowid
            `).run(target);
      db2.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(target.conversation_id);
      return result;
    });
    return remove();
  },
  updateContent(messageId, content, truncateAfter = false) {
    const db2 = getDb();
    const target = db2.prepare("SELECT conversation_id, rowid FROM messages WHERE id = ?").get(messageId);
    if (!target) return { changes: 0 };
    const update = db2.transaction(() => {
      if (truncateAfter) {
        db2.prepare(`
                    DELETE FROM messages
                    WHERE conversation_id = @conversation_id
                      AND rowid > @rowid
                `).run(target);
      }
      const result = db2.prepare("UPDATE messages SET content = @content WHERE id = @id").run({
        id: messageId,
        content: messageService.serializeContent(content)
      });
      db2.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(target.conversation_id);
      return result;
    });
    return update();
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
  electron.ipcMain.handle("db:update-message-content", async (_, messageId, content, truncateAfter = false) => {
    return messageService.updateContent(messageId, content, truncateAfter);
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
const OMNI_PRESETS = {
  alloy: { id: "alloy", friendlyName: "Alloy", locale: "en-US", gender: "Female", age: "young adult", pitch: "moderate pitch", accent: "american accent" },
  ash: { id: "ash", friendlyName: "Ash", locale: "en-US", gender: "Male", age: "young adult", pitch: "low pitch", accent: "american accent" },
  ballad: { id: "ballad", friendlyName: "Ballad", locale: "en-GB", gender: "Male", age: "middle-aged", pitch: "low pitch", accent: "british accent" },
  cedar: { id: "cedar", friendlyName: "Cedar", locale: "en-US", gender: "Male", age: "middle-aged", pitch: "low pitch", accent: "american accent" },
  coral: { id: "coral", friendlyName: "Coral", locale: "en-AU", gender: "Female", age: "young adult", pitch: "high pitch", accent: "australian accent" },
  echo: { id: "echo", friendlyName: "Echo", locale: "en-CA", gender: "Male", age: "middle-aged", pitch: "moderate pitch", accent: "canadian accent" },
  fable: { id: "fable", friendlyName: "Fable", locale: "en-GB", gender: "Female", age: "middle-aged", pitch: "moderate pitch", accent: "british accent" },
  marin: { id: "marin", friendlyName: "Marin", locale: "en-CA", gender: "Female", age: "middle-aged", pitch: "moderate pitch", accent: "canadian accent" },
  nova: { id: "nova", friendlyName: "Nova", locale: "en-US", gender: "Female", age: "young adult", pitch: "high pitch", accent: "american accent" },
  onyx: { id: "onyx", friendlyName: "Onyx", locale: "en-GB", gender: "Male", age: "middle-aged", pitch: "very low pitch", accent: "british accent" },
  sage: { id: "sage", friendlyName: "Sage", locale: "en-GB", gender: "Female", age: "elderly", pitch: "low pitch", accent: "british accent" },
  shimmer: { id: "shimmer", friendlyName: "Shimmer", locale: "en-US", gender: "Female", age: "young adult", pitch: "very high pitch", accent: "american accent" },
  verse: { id: "verse", friendlyName: "Verse", locale: "en-GB", gender: "Male", age: "young adult", pitch: "moderate pitch", accent: "british accent" }
};
const EDGE_VOICE_FALLBACKS = {
  "en-US-AndrewNeural": "ash",
  "en-US-AriaNeural": "nova"
};
const DEFAULT_VOICE_ID = "alloy";
const DEFAULT_SERVER_URL = "http://127.0.0.1:8880";
const REQUEST_TIMEOUT_MS = 6e5;
const SERVER_READY_TIMEOUT_MS = 18e4;
const DEFAULT_NUM_STEP = 16;
function formatFriendlyName(preset) {
  return `${preset.friendlyName} (${preset.gender}, ${preset.locale})`;
}
function presetToVoice(preset) {
  return {
    ShortName: preset.id,
    FriendlyName: formatFriendlyName(preset),
    Locale: preset.locale,
    Gender: preset.gender,
    Type: "preset"
  };
}
function createLocalVoiceList() {
  return Object.values(OMNI_PRESETS).sort((a, b) => a.friendlyName.localeCompare(b.friendlyName)).map(presetToVoice);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function parseNumericSetting(value, unit) {
  const normalized = value.trim().replace(unit, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function rateToSpeed(rate) {
  const percentage = parseNumericSetting(rate, "%");
  const speed = 1 + percentage / 100;
  return Math.round(clamp(speed, 0.25, 4) * 100) / 100;
}
function pitchToDescriptor(pitch) {
  const hz = parseNumericSetting(pitch, "Hz");
  if (hz <= -12) return "very low pitch";
  if (hz <= -4) return "low pitch";
  if (hz >= 12) return "very high pitch";
  if (hz >= 4) return "high pitch";
  return "moderate pitch";
}
function localeToFallbackVoice(locale) {
  switch (locale.toLowerCase()) {
    case "en-gb":
      return "fable";
    case "en-au":
      return "coral";
    case "en-ca":
      return "marin";
    case "en-in":
      return "alloy";
    case "en-us":
    default:
      return DEFAULT_VOICE_ID;
  }
}
function normalizeVoiceId(voice) {
  const trimmed = voice.trim();
  if (!trimmed) return DEFAULT_VOICE_ID;
  if (trimmed in OMNI_PRESETS) {
    return trimmed;
  }
  const explicitFallback = EDGE_VOICE_FALLBACKS[trimmed];
  if (explicitFallback) {
    return explicitFallback;
  }
  const legacyMatch = trimmed.match(/^([a-z]{2}-[A-Z]{2})-[A-Za-z]+Neural$/);
  if (legacyMatch) {
    return localeToFallbackVoice(legacyMatch[1]);
  }
  return DEFAULT_VOICE_ID;
}
function slugifyProfileName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `voice-${Date.now()}`;
}
function buildInstructions(voiceId, pitch) {
  const preset = OMNI_PRESETS[voiceId];
  if (!preset) return void 0;
  const parts = [
    preset.gender.toLowerCase(),
    preset.age,
    pitchToDescriptor(pitch),
    preset.accent
  ];
  return parts.join(", ");
}
function buildOmniVoiceSelector(voiceId, pitch) {
  const instructions = buildInstructions(voiceId, pitch);
  return instructions ? `design:${instructions}` : "auto";
}
function getMimeType(contentType) {
  const normalized = (contentType == null ? void 0 : contentType.toLowerCase()) || "";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "audio/mpeg";
  if (normalized.includes("pcm")) return "audio/pcm";
  if (normalized.includes("wav")) return "audio/wav";
  return "audio/wav";
}
function getNumStep() {
  const parsed = Number.parseInt(process.env.OMNIVOICE_TTS_NUM_STEP || "", 10);
  return Number.isFinite(parsed) ? clamp(parsed, 1, 64) : DEFAULT_NUM_STEP;
}
function parseAudioDataUrl(audioDataUrl) {
  const match = audioDataUrl.match(/^data:audio\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) {
    throw new Error("Audio data was not a valid audio data URL.");
  }
  return Buffer.from(match[1], "base64");
}
function bufferToBlobPart(buffer) {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
class TTSService {
  constructor() {
    __publicField(this, "baseUrl");
    __publicField(this, "apiKey");
    __publicField(this, "localVoices");
    __publicField(this, "cloneDir");
    __publicField(this, "cloneIndexPath");
    __publicField(this, "activeControllers", /* @__PURE__ */ new Set());
    var _a;
    this.baseUrl = (process.env.OMNIVOICE_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, "");
    this.apiKey = ((_a = process.env.OMNIVOICE_API_KEY) == null ? void 0 : _a.trim()) || "";
    this.localVoices = createLocalVoiceList();
    this.cloneDir = path.join(electron.app.getPath("userData"), "omnivoice-clones");
    this.cloneIndexPath = path.join(this.cloneDir, "profiles.json");
  }
  buildHeaders() {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
  buildAuthHeaders() {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
  ensureCloneDir() {
    fs.mkdirSync(this.cloneDir, { recursive: true });
  }
  readCloneProfiles() {
    this.ensureCloneDir();
    try {
      const raw = fs.readFileSync(this.cloneIndexPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  writeCloneProfiles(profiles) {
    this.ensureCloneDir();
    fs.writeFileSync(this.cloneIndexPath, JSON.stringify(profiles, null, 2), "utf8");
  }
  async waitForReady(timeoutMs = SERVER_READY_TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`${this.baseUrl}/health`, {
          method: "GET",
          headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
          signal: AbortSignal.timeout(2e3)
        });
        if (response.ok) {
          return;
        }
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
    throw new Error("OmniVoice is still starting. Make sure the model is installed and the local service can boot.");
  }
  async fetchWithTimeout(input, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.activeControllers.add(controller);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(
          controller.signal.reason === "cancelled" ? "OmniVoice request cancelled." : `OmniVoice request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1e3)} seconds.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.activeControllers.delete(controller);
    }
  }
  cancelActiveRequests() {
    for (const controller of this.activeControllers) {
      try {
        controller.abort("cancelled");
      } catch {
        controller.abort();
      }
    }
    this.activeControllers.clear();
  }
  async speakClone(text, profile, rate) {
    const audioBuffer = fs.readFileSync(profile.audioPath);
    const formData = new FormData();
    formData.append("text", text);
    formData.append("speed", String(rateToSpeed(rate)));
    formData.append("num_step", String(getNumStep()));
    if (profile.refText.trim()) {
      formData.append("ref_text", profile.refText.trim());
    }
    formData.append("ref_audio", new Blob([bufferToBlobPart(audioBuffer)]), path.basename(profile.audioPath));
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/audio/speech/clone`, {
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: formData
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      const detailSuffix = detail ? ` ${detail}` : "";
      throw new Error(`OmniVoice clone request failed (${response.status} ${response.statusText}).${detailSuffix}`);
    }
    const clonedAudioBuffer = Buffer.from(await response.arrayBuffer());
    const mimeType = getMimeType(response.headers.get("content-type"));
    console.log(`[TTS] OmniVoice clone synthesized ${text.length} chars with ${profile.id} in ${Date.now() - startedAt}ms (${clonedAudioBuffer.length} bytes).`);
    return {
      audioBase64: clonedAudioBuffer.toString("base64"),
      mimeType
    };
  }
  async transcribeAudioData(audioDataUrl) {
    await this.waitForReady();
    const audioBuffer = parseAudioDataUrl(audioDataUrl);
    const formData = new FormData();
    formData.append("file", new Blob([bufferToBlobPart(audioBuffer)], { type: "audio/wav" }), "clone-reference.wav");
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: this.buildAuthHeaders(),
      body: formData
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      const detailSuffix = detail ? ` ${detail}` : "";
      throw new Error(`OmniVoice transcription failed (${response.status} ${response.statusText}).${detailSuffix}`);
    }
    const payload = await response.json();
    return (payload.text || "").trim();
  }
  async speak(text, voice, rate = "+0%", pitch = "+0Hz") {
    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error("No text provided for TTS.");
    }
    await this.waitForReady();
    if (voice.startsWith("clone:")) {
      const profileId = voice.slice("clone:".length);
      const profile = this.readCloneProfiles().find((item) => item.id === profileId);
      if (!profile) {
        throw new Error(`Voice clone profile not found: ${profileId}`);
      }
      return this.speakClone(trimmedText, profile, rate);
    }
    const voiceId = normalizeVoiceId(voice);
    const omniVoice = buildOmniVoiceSelector(voiceId, pitch);
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: "omnivoice",
        input: trimmedText,
        voice: omniVoice,
        response_format: "wav",
        speed: rateToSpeed(rate),
        num_step: getNumStep()
      })
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      const detailSuffix = detail ? ` ${detail}` : "";
      throw new Error(`OmniVoice request failed (${response.status} ${response.statusText}).${detailSuffix}`);
    }
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const mimeType = getMimeType(response.headers.get("content-type"));
    console.log(`[TTS] OmniVoice synthesized ${trimmedText.length} chars in ${Date.now() - startedAt}ms (${audioBuffer.length} bytes).`);
    return {
      audioBase64: audioBuffer.toString("base64"),
      mimeType
    };
  }
  async listVoices() {
    const cloneVoices = this.readCloneProfiles().map((profile) => ({
      ShortName: `clone:${profile.id}`,
      FriendlyName: `Clone: ${profile.name}`,
      Locale: "clone",
      Gender: "Unknown",
      Type: "clone"
    }));
    try {
      await this.waitForReady(15e3);
      const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/voices`, {
        method: "GET",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
      });
      if (!response.ok) {
        return [...cloneVoices, ...this.localVoices];
      }
      const payload = await response.json();
      const remoteVoiceIds = new Set(
        Array.isArray(payload.voices) ? payload.voices.map((voice) => {
          var _a;
          return ((_a = voice.id) == null ? void 0 : _a.trim().toLowerCase()) || "";
        }).filter((voiceId) => voiceId in OMNI_PRESETS) : []
      );
      if (remoteVoiceIds.size === 0) {
        return [...cloneVoices, ...this.localVoices];
      }
      return [
        ...cloneVoices,
        ...this.localVoices.filter((voiceOption) => remoteVoiceIds.has(voiceOption.ShortName.toLowerCase()))
      ];
    } catch (error) {
      console.warn("[TTS] Falling back to bundled OmniVoice presets:", error);
      return [...cloneVoices, ...this.localVoices];
    }
  }
  async createCloneProfile(name, audioPath, refText = "") {
    this.ensureCloneDir();
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Clone profile name is required.");
    }
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Reference audio file not found: ${audioPath}`);
    }
    const ext = path.extname(audioPath).toLowerCase() || ".wav";
    const idBase = slugifyProfileName(trimmedName);
    const profiles = this.readCloneProfiles();
    let id = idBase;
    let counter = 2;
    while (profiles.some((profile2) => profile2.id === id)) {
      id = `${idBase}-${counter}`;
      counter += 1;
    }
    const destinationPath = path.join(this.cloneDir, `${id}${ext}`);
    fs.copyFileSync(audioPath, destinationPath);
    const profile = {
      id,
      name: trimmedName,
      audioPath: destinationPath,
      refText,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeCloneProfiles([...profiles, profile]);
    return profile;
  }
  async createCloneProfileFromAudioData(name, audioDataUrl, extension = "wav", refText = "") {
    this.ensureCloneDir();
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Clone profile name is required.");
    }
    const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "wav";
    const idBase = slugifyProfileName(trimmedName);
    const profiles = this.readCloneProfiles();
    let id = idBase;
    let counter = 2;
    while (profiles.some((profile2) => profile2.id === id)) {
      id = `${idBase}-${counter}`;
      counter += 1;
    }
    const destinationPath = path.join(this.cloneDir, `${id}.${safeExtension}`);
    fs.writeFileSync(destinationPath, parseAudioDataUrl(audioDataUrl));
    const profile = {
      id,
      name: trimmedName,
      audioPath: destinationPath,
      refText,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeCloneProfiles([...profiles, profile]);
    return profile;
  }
  async listCloneProfiles() {
    return this.readCloneProfiles();
  }
  async deleteCloneProfile(profileId) {
    const profiles = this.readCloneProfiles();
    const profile = profiles.find((item) => item.id === profileId);
    const remaining = profiles.filter((item) => item.id !== profileId);
    if (profile && fs.existsSync(profile.audioPath)) {
      fs.rmSync(profile.audioPath, { force: true });
    }
    this.writeCloneProfiles(remaining);
    return Boolean(profile);
  }
  async cleanupTempFiles() {
    this.cancelActiveRequests();
  }
}
const processes = {};
const serviceStatus = {
  ollama: "starting",
  lmstudio: "starting",
  omnivoice: "starting"
};
const SERVICES = [
  {
    id: "ollama",
    checkUrl: "http://localhost:11434",
    startupTimeoutMs: 2e4
  },
  {
    id: "lmstudio",
    checkUrl: "http://localhost:1234/v1/models",
    startupTimeoutMs: 2e4
  },
  {
    id: "omnivoice",
    checkUrl: `${(process.env.OMNIVOICE_SERVER_URL || "http://127.0.0.1:8880").replace(/\/+$/, "")}/health`,
    startupTimeoutMs: 18e4
  }
];
function parseVramLine(line) {
  const [usedRaw, totalRaw] = line.split(",").map((part) => Number.parseInt(part.trim(), 10));
  if (!Number.isFinite(usedRaw) || !Number.isFinite(totalRaw)) {
    return null;
  }
  return { used: usedRaw, total: totalRaw };
}
async function getFreeVramMb() {
  return new Promise((resolve) => {
    require$$0.execFile(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const parsed = parseVramLine(stdout.trim().split(/\r?\n/)[0] || "");
        resolve(parsed ? parsed.total - parsed.used : null);
      }
    );
  });
}
async function hasEnoughVramForOmniVoice() {
  if ((process.env.OMNIVOICE_DEVICE || "cuda").toLowerCase() !== "cuda") {
    return true;
  }
  const minFreeMb = Number.parseInt(process.env.OMNIVOICE_MIN_FREE_VRAM_MB || "", 10) || 7e3;
  const freeMb = await getFreeVramMb();
  if (freeMb === null) {
    return true;
  }
  if (freeMb < minFreeMb) {
    console.warn(`[Services] Not starting omnivoice: only ${freeMb}MB VRAM free, need at least ${minFreeMb}MB.`);
    return false;
  }
  return true;
}
function findOllamaCLI() {
  const homeDir = os__namespace.homedir();
  const possiblePaths = [
    path__namespace.join(homeDir, "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    path__namespace.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    "C:\\Program Files\\Ollama\\ollama.exe",
    "C:\\Program Files (x86)\\Ollama\\ollama.exe"
  ];
  for (const candidate of possiblePaths) {
    if (candidate && fs__namespace.existsSync(candidate)) {
      console.log("[Services] Found Ollama CLI at:", candidate);
      return candidate;
    }
  }
  console.log("[Services] Ollama CLI not found. Checked:", possiblePaths.filter(Boolean));
  return null;
}
function findLMStudioCLI() {
  const homeDir = os__namespace.homedir();
  const possiblePaths = [
    path__namespace.join(homeDir, ".lmstudio", "bin", "lms.exe"),
    path__namespace.join(homeDir, ".cache", "lm-studio", "bin", "lms.exe"),
    path__namespace.join(homeDir, "AppData", "Local", "LM-Studio", "lms.exe"),
    path__namespace.join(process.env.LOCALAPPDATA || "", "LM-Studio", "lms.exe")
  ];
  for (const candidate of possiblePaths) {
    if (candidate && fs__namespace.existsSync(candidate)) {
      console.log("[Services] Found LM Studio CLI at:", candidate);
      return candidate;
    }
  }
  console.log("[Services] LM Studio CLI not found. Checked:", possiblePaths.filter(Boolean));
  return null;
}
function getOmniVoiceCommands() {
  var _a, _b, _c, _d;
  const localOmniVoiceExe = path__namespace.join(process.cwd(), ".omnivoice", "Scripts", "omnivoice-server.exe");
  const localOmniVoicePython = path__namespace.join(process.cwd(), ".omnivoice", "Scripts", "python.exe");
  const omniVoiceLauncher = electron.app.isPackaged ? path__namespace.join(process.resourcesPath, "omnivoice-launcher.py") : path__namespace.join(process.cwd(), "electron", "services", "omnivoice-launcher.py");
  const baseArgs = [
    "--host",
    "127.0.0.1",
    "--port",
    process.env.OMNIVOICE_PORT || "8880",
    "--device",
    process.env.OMNIVOICE_DEVICE || "cuda",
    "--timeout",
    process.env.OMNIVOICE_REQUEST_TIMEOUT_S || "600",
    "--max-concurrent",
    process.env.OMNIVOICE_MAX_CONCURRENT || "1"
  ];
  if ((_a = process.env.OMNIVOICE_API_KEY) == null ? void 0 : _a.trim()) {
    baseArgs.push("--api-key", process.env.OMNIVOICE_API_KEY.trim());
  }
  if ((_b = process.env.OMNIVOICE_MODEL_ID) == null ? void 0 : _b.trim()) {
    baseArgs.push("--model-id", process.env.OMNIVOICE_MODEL_ID.trim());
  }
  if ((_c = process.env.OMNIVOICE_NUM_STEP) == null ? void 0 : _c.trim()) {
    baseArgs.push("--num-step", process.env.OMNIVOICE_NUM_STEP.trim());
  }
  const explicitExecutable = (_d = process.env.OMNIVOICE_EXECUTABLE) == null ? void 0 : _d.trim();
  const commands = [];
  if (explicitExecutable) {
    commands.push({ command: explicitExecutable, args: [...baseArgs] });
  }
  if (fs__namespace.existsSync(localOmniVoicePython) && fs__namespace.existsSync(omniVoiceLauncher)) {
    commands.push({ command: localOmniVoicePython, args: [omniVoiceLauncher, ...baseArgs] });
  }
  if (fs__namespace.existsSync(localOmniVoicePython)) {
    commands.push({ command: localOmniVoicePython, args: ["-m", "omnivoice_server", ...baseArgs] });
  }
  if (fs__namespace.existsSync(localOmniVoiceExe)) {
    commands.push({ command: localOmniVoiceExe, args: [...baseArgs] });
  }
  commands.push(
    { command: "omnivoice-server", args: [...baseArgs] },
    { command: "py", args: ["-m", "omnivoice_server", ...baseArgs] },
    { command: "python", args: ["-m", "omnivoice_server", ...baseArgs] }
  );
  return commands;
}
function getStartCommands(serviceId) {
  if (serviceId === "ollama") {
    const execPath = findOllamaCLI();
    return execPath ? [{ command: execPath, args: ["serve"] }] : [];
  }
  if (serviceId === "lmstudio") {
    const execPath = findLMStudioCLI();
    return execPath ? [{ command: execPath, args: ["server", "start"] }] : [];
  }
  return getOmniVoiceCommands();
}
const waitForServer = async (url, timeoutMs = 15e3, intervalMs = 1e3) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2e3) });
      if (response.ok) {
        return true;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
};
async function tryStartCommand(service, commandDef) {
  var _a, _b;
  console.log(`[Services] Starting ${service.id}: "${commandDef.command}" ${commandDef.args.join(" ")}`);
  try {
    const child = require$$0.spawn(commandDef.command, commandDef.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...commandDef.env
      }
    });
    processes[service.id] = child;
    let spawnFailed = false;
    child.once("error", (err) => {
      spawnFailed = true;
      console.error(`[Services] ${service.id} spawn error for "${commandDef.command}":`, err.message);
    });
    child.once("exit", (code) => {
      console.log(`[Services] ${service.id} process exited with code:`, code);
      if (processes[service.id] === child) {
        delete processes[service.id];
        serviceStatus[service.id] = "failed";
      }
    });
    (_a = child.stdout) == null ? void 0 : _a.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.log(`[Services:${service.id}:stdout] ${message}`);
      }
    });
    (_b = child.stderr) == null ? void 0 : _b.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.error(`[Services:${service.id}:stderr] ${message}`);
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (spawnFailed) {
      if (processes[service.id] === child) {
        delete processes[service.id];
      }
      return false;
    }
    const ready = await waitForServer(service.checkUrl, service.startupTimeoutMs ?? 2e4);
    if (ready) {
      console.log(`[Services] ${service.id} is now ready!`);
      return true;
    }
    console.log(`[Services] ${service.id} did not become ready after "${commandDef.command}"`);
    if (processes[service.id] === child) {
      delete processes[service.id];
    }
    try {
      child.kill();
    } catch {
    }
    return false;
  } catch (error) {
    console.error(`[Services] Failed to start ${service.id} with "${commandDef.command}":`, error == null ? void 0 : error.message);
    return false;
  }
}
const startService = async (service) => {
  try {
    const res = await fetch(service.checkUrl, { signal: AbortSignal.timeout(2e3) });
    if (res.ok) {
      console.log(`[Services] ${service.id} is already running.`);
      serviceStatus[service.id] = "ready";
      return;
    }
  } catch {
  }
  const commands = getStartCommands(service.id);
  if (commands.length === 0) {
    console.log(`[Services] Cannot start ${service.id}: executable not found.`);
    serviceStatus[service.id] = "not_installed";
    return;
  }
  if (service.id === "omnivoice" && !await hasEnoughVramForOmniVoice()) {
    serviceStatus[service.id] = "failed";
    return;
  }
  serviceStatus[service.id] = "starting";
  for (const command of commands) {
    const ready = await tryStartCommand(service, command);
    if (ready) {
      serviceStatus[service.id] = "ready";
      return;
    }
  }
  serviceStatus[service.id] = service.id === "omnivoice" ? "not_installed" : "failed";
};
const isServiceActuallyReady = async (serviceId) => {
  const service = SERVICES.find((item) => item.id === serviceId);
  if (!service) {
    return false;
  }
  try {
    const response = await fetch(service.checkUrl, { signal: AbortSignal.timeout(2e3) });
    const ready = response.ok;
    serviceStatus[serviceId] = ready ? "ready" : "failed";
    return ready;
  } catch {
    serviceStatus[serviceId] = "failed";
    return false;
  }
};
const registerServiceHandlers = () => {
  electron.ipcMain.handle("services:get-status", (_, serviceId) => {
    return serviceStatus[serviceId] || "unknown";
  });
  electron.ipcMain.handle("services:is-ready", async (_, serviceId) => {
    return isServiceActuallyReady(serviceId);
  });
  electron.ipcMain.handle("services:get-all-status", () => {
    return { ...serviceStatus };
  });
  electron.ipcMain.handle("services:stop-all", async () => {
    await stopAllServices();
    return true;
  });
  electron.ipcMain.handle("services:stop-service", async (_, serviceId) => {
    await stopServiceProcess(serviceId);
    return true;
  });
  electron.ipcMain.handle("services:start-service", async (_, serviceId) => {
    return startServiceById(serviceId);
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
const startServiceById = async (serviceId) => {
  const service = SERVICES.find((item) => item.id === serviceId);
  if (!service) {
    return false;
  }
  await startService(service);
  return serviceStatus[serviceId] === "ready";
};
const killProcessTree = (child) => {
  return new Promise((resolve) => {
    if (!child.pid) {
      resolve();
      return;
    }
    if (process.platform === "win32") {
      require$$0.execFile("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], () => resolve());
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch {
    }
    resolve();
  });
};
const stopServiceProcess = async (serviceId) => {
  const child = processes[serviceId];
  if (!child) {
    return;
  }
  console.log(`[Services] Killing ${serviceId} process...`);
  await killProcessTree(child);
  delete processes[serviceId];
  serviceStatus[serviceId] = "failed";
};
const stopAllServices = async () => {
  console.log("[Services] Stopping all service processes...");
  const stops = Object.entries(processes).map(async ([id, child]) => {
    if (child) {
      await stopServiceProcess(id);
    }
  });
  await Promise.all(stops);
};
electron.app.on("will-quit", async () => {
  await stopAllServices();
});
function registerTTSHandlers() {
  const ttsService = new TTSService();
  electron.ipcMain.handle("tts:list-voices", async () => {
    return ttsService.listVoices();
  });
  electron.ipcMain.handle("tts:list-clone-profiles", async () => {
    return ttsService.listCloneProfiles();
  });
  electron.ipcMain.handle("tts:create-clone-profile", async (_, name, audioPath, refText) => {
    return ttsService.createCloneProfile(name, audioPath, refText);
  });
  electron.ipcMain.handle("tts:create-clone-profile-from-audio-data", async (_, name, audioDataUrl, extension, refText) => {
    return ttsService.createCloneProfileFromAudioData(name, audioDataUrl, extension, refText);
  });
  electron.ipcMain.handle("tts:transcribe-audio-data", async (_, audioDataUrl) => {
    return ttsService.transcribeAudioData(audioDataUrl);
  });
  electron.ipcMain.handle("tts:delete-clone-profile", async (_, profileId) => {
    return ttsService.deleteCloneProfile(profileId);
  });
  electron.ipcMain.handle("tts:speak", async (_, text, voice, rate, pitch) => {
    if (!await isServiceActuallyReady("omnivoice")) {
      const started = await startServiceById("omnivoice");
      if (!started) {
        throw new Error("OmniVoice is not running and could not be started. Check VRAM headroom or service logs.");
      }
    }
    return ttsService.speak(text, voice, rate, pitch);
  });
  electron.ipcMain.handle("tts:cleanup", async () => {
    ttsService.cleanupTempFiles();
  });
  electron.ipcMain.handle("tts:cancel", async () => {
    ttsService.cancelActiveRequests();
    return true;
  });
}
function registerFileSystemHandlers() {
  electron.ipcMain.handle("fs:parse-character-card", async (_, filePath) => {
    try {
      const buffer = await fs$2.readFile(filePath);
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
      await fs$2.mkdir(avatarDir, { recursive: true });
      const fileName = `${type}-avatar.png`;
      const filePath = path.join(avatarDir, fileName);
      const buffer = Buffer.from(base64Data.split(",")[1], "base64");
      await fs$2.writeFile(filePath, buffer);
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
      const content = await fs$2.readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      console.error("fs:read-file error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:read-file-as-base64", async (_, filePath) => {
    try {
      const buffer = await fs$2.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mimeTypes = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "flac": "audio/flac",
        "m4a": "audio/mp4",
        "ogg": "audio/ogg",
        "aac": "audio/aac"
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
      await fs$2.writeFile(filePath, content, "utf-8");
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
electron.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win = null;
let splash = null;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
let quitCleanupComplete = false;
const withTimeout = async (promise, timeoutMs, label) => {
  let timeout = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          console.warn(`[Main] ${label} timed out after ${timeoutMs}ms; continuing shutdown.`);
          resolve(null);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
const cleanupBeforeQuit = async () => {
  console.log("[Main] App quitting: unloading GPU models and stopping local services...");
  await withTimeout(unloadAllModels(), 15e3, "LLM model unload");
  await withTimeout(stopAllServices(), 8e3, "service shutdown");
  console.log("[Main] Quit cleanup finished.");
};
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
    // backgroundColor: '#0c0c0e', // Removed for debugging
    show: true,
    // Show immediately to see any startup errors
    icon: electron.app.isPackaged ? path.join(process.resourcesPath, "icon-splash.png") : path.join(__dirname, "../icon-splash.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  setMainWindowForLMStudio(win);
  win.webContents.on("did-finish-load", () => {
    console.log("[Main] Window loaded");
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    if (splash && !splash.isDestroyed()) {
      splash.close();
      splash = null;
    }
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
electron.app.on("before-quit", (event) => {
  if (quitCleanupComplete) {
    return;
  }
  event.preventDefault();
  quitCleanupComplete = true;
  cleanupBeforeQuit().catch((error) => {
    console.error("[Main] Quit cleanup failed:", error);
  }).finally(() => {
    electron.app.quit();
  });
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
