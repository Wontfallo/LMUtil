import { LLMProvider, Message, ChatConfig, StreamChunk, ModelInfo, ModelDownloadStatus } from './types.ts';
import { BrowserWindow } from 'electron';

// The LMStudioClient is lazily imported to avoid issues if SDK is not installed
let clientInstance: any = null;
let clientCreationFailed = false;

// Store reference to main window for progress events
let mainWindow: BrowserWindow | null = null;

export function setMainWindowForLMStudio(window: BrowserWindow | null) {
    mainWindow = window;
}

async function getClient(): Promise<any> {
    if (clientCreationFailed) {
        // Reset after some time to allow retry
        clientCreationFailed = false;
        clientInstance = null;
    }

    if (!clientInstance) {
        try {
            console.log('[LM Studio SDK] Creating new client instance...');
            const { LMStudioClient } = await import('@lmstudio/sdk');

            // Create client with explicit connection settings
            clientInstance = new LMStudioClient({
                baseUrl: 'ws://127.0.0.1:1234',
            });

            console.log('[LM Studio SDK] Client created successfully');
        } catch (error: any) {
            console.error('[LM Studio SDK] Failed to create client:', error?.message || error);
            clientCreationFailed = true;
            throw error;
        }
    }
    return clientInstance;
}

// Reset client instance (useful if connection fails)
function resetClient() {
    console.log('[LM Studio SDK] Resetting client instance');
    clientInstance = null;
    clientCreationFailed = false;
}

function emitLoadProgress(model: string, progress: number, status: 'starting' | 'loading' | 'ready') {
    const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    mainWindow?.webContents.send('llm:load-progress', {
        model,
        progress: normalizedProgress,
        status
    });
}

function getSafeContextLength(requestedContextLength?: number): number {
    const requested = requestedContextLength || 4096;
    const configuredCap = Number.parseInt(process.env.LMSTUDIO_MAX_CONTEXT_LENGTH || '', 10);
    const cap = Number.isFinite(configuredCap) && configuredCap > 0 ? configuredCap : 32768;
    const safeContext = Math.max(1024, Math.min(requested, cap));

    if (safeContext !== requested) {
        console.warn(`[LM Studio] Requested context ${requested} exceeds VRAM-safe cap ${cap}; using ${safeContext}. Set LMSTUDIO_MAX_CONTEXT_LENGTH to override.`);
    }

    return safeContext;
}

function getRestHeaders(accept = 'application/json'): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: accept
    };

    const token = process.env.LM_API_TOKEN?.trim() || process.env.LMSTUDIO_API_KEY?.trim();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

function parseSseDataEvents(buffer: string): { events: Array<{ event: string; data: any }>; remainder: string } {
    const normalized = buffer.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    const remainder = parts.pop() || '';
    const events: Array<{ event: string; data: any }> = [];

    for (const part of parts) {
        const lines = part.split('\n');
        const eventName = lines
            .find(line => line.startsWith('event:'))
            ?.slice('event:'.length)
            .trim() || '';
        const dataText = lines
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice('data:'.length).trimStart())
            .join('\n');

        if (!eventName || !dataText) {
            continue;
        }

        try {
            events.push({ event: eventName, data: JSON.parse(dataText) });
        } catch {
            console.warn('[LM Studio REST] Failed to parse SSE data:', dataText.slice(0, 200));
        }
    }

    return { events, remainder };
}

async function readRestError(response: Response): Promise<string> {
    const raw = (await response.text().catch(() => '')).trim();
    if (!raw) {
        return '';
    }

    try {
        const parsed = JSON.parse(raw);
        const detail = parsed.error?.message || parsed.message || parsed.detail || parsed.error;
        if (typeof detail === 'string') return detail;
        return JSON.stringify(parsed);
    } catch {
        return raw;
    }
}

function inferQuantizationFromFilename(fileName: string): string | undefined {
    const stem = fileName.replace(/\.gguf$/i, '');
    const patterns = [
        /(?:^|[-_.])(I?Q\d(?:_[A-Z0-9]+)+)(?:$|[-_.])/i,
        /(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)*)(?:$|[-_.])/i
    ];

    for (const pattern of patterns) {
        const match = stem.match(pattern);
        if (match?.[1]) {
            return match[1].toUpperCase();
        }
    }

    return undefined;
}

function normalizeLMStudioDownloadRequest(input: string, explicitQuantization?: string): { model: string; quantization?: string } {
    const trimmed = input.trim();
    const quantization = explicitQuantization?.trim() || undefined;

    try {
        const url = new URL(trimmed);
        if (url.hostname !== 'huggingface.co') {
            return { model: trimmed, quantization };
        }

        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
            return { model: trimmed, quantization };
        }

        const owner = parts[0];
        const repo = parts[1];
        const markerIndex = parts.findIndex(part => part === 'resolve' || part === 'blob' || part === 'tree');

        if (markerIndex === -1) {
            return { model: `https://huggingface.co/${owner}/${repo}`, quantization };
        }

        const fileName = decodeURIComponent(parts[parts.length - 1] || '');
        const inferredQuantization = fileName.toLowerCase().endsWith('.gguf')
            ? inferQuantizationFromFilename(fileName)
            : undefined;

        return {
            model: `https://huggingface.co/${owner}/${repo}`,
            quantization: quantization || inferredQuantization
        };
    } catch {
        return { model: trimmed, quantization };
    }
}

export class LMStudioProvider implements LLMProvider {
    private baseUrl = 'http://localhost:1234';

    async isConnected(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(): Promise<ModelInfo[]> {
        // Check if LM Studio service is running (started by services.ts at app launch)
        const connected = await this.isConnected();
        if (!connected) {
            console.log('[LM Studio] Not connected - service may not be running');
            return [];
        }

        try {
            console.log('[LM Studio REST] Listing models via native v1 API...');
            const response = await fetch(`${this.baseUrl}/api/v1/models`, {
                headers: getRestHeaders(),
                signal: AbortSignal.timeout(15_000)
            });

            if (response.ok) {
                const data = await response.json();
                const restModels = Array.isArray(data.models) ? data.models : [];
                const llmModels = restModels.filter((model: any) => model.type === 'llm');

                console.log('[LM Studio REST] Got', llmModels.length, 'LLM models');
                return llmModels.map((model: any) => ({
                    id: model.key,
                    name: model.display_name || model.key,
                    provider: 'lmstudio' as const,
                    hasVision: model.capabilities?.vision === true,
                    hasTools: model.capabilities?.trained_for_tool_use === true,
                    maxContext: model.max_context_length || 4096,
                    architecture: model.architecture,
                    quantization: model.quantization?.name,
                    paramsString: model.params_string,
                    loadedContextLength: model.loaded_instances?.[0]?.config?.context_length,
                    loadedInstanceCount: Array.isArray(model.loaded_instances) ? model.loaded_instances.length : 0
                }));
            }

            console.warn('[LM Studio REST] Native model list returned non-OK status:', response.status);
        } catch (restError: any) {
            console.warn('[LM Studio REST] Native model list failed:', restError?.message || restError);
        }

        try {
            // Try SDK first - it uses its own connection method (not REST API)
            const client = await getClient();
            console.log('[LM Studio SDK] Attempting to list downloaded models...');
            const downloadedModels = await client.system.listDownloadedModels();

            console.log('[LM Studio SDK] Got', downloadedModels.length, 'models');

            // Log all models for debugging
            downloadedModels.forEach((m: any, i: number) => {
                console.log(`[LM Studio SDK] Model ${i}:`, JSON.stringify({
                    modelKey: m.modelKey,
                    type: m.type,
                    vision: m.vision,
                    trainedForToolUse: m.trainedForToolUse,
                }));
            });

            // Filter to only LLM type models (not embeddings)
            // Some models may have undefined type, treat those as LLM
            const filteredModels = downloadedModels.filter((m: any) => {
                const isLLM = !m.type || m.type === 'llm';
                console.log(`[LM Studio SDK] Model ${m.modelKey} type=${m.type} isLLM=${isLLM}`);
                return isLLM;
            });

            console.log('[LM Studio SDK] After filter:', filteredModels.length, 'models');

            return filteredModels.map((m: any) => {
                return {
                    id: m.modelKey || m.path,
                    name: m.displayName || m.modelKey || m.path,
                    provider: 'lmstudio' as const,
                    hasVision: m.vision === true,
                    hasTools: m.trainedForToolUse === true,
                    maxContext: m.maxContextLength || 4096
                };
            });
        } catch (sdkError: any) {
            console.warn('[LM Studio] SDK failed:', sdkError?.message || sdkError);
            resetClient(); // Reset for next attempt

            // Fallback to REST API if SDK fails
            console.log('[LM Studio] Trying REST API fallback...');
            try {
                const response = await fetch(`${this.baseUrl}/v1/models`, {
                    signal: AbortSignal.timeout(3000)
                });
                if (!response.ok) {
                    console.log('[LM Studio] REST API returned non-OK status:', response.status);
                    return [];
                }
                const data = await response.json();
                console.log('[LM Studio] REST API returned', data.data?.length || 0, 'models');
                return (data.data || []).map((m: any) => ({
                    id: m.id,
                    name: m.id,
                    provider: 'lmstudio' as const,
                    hasVision: this.detectVisionCapability(m.id),
                    hasTools: this.detectToolsCapability(m.id),
                    maxContext: 4096 // Default fallback
                }));
            } catch (restError: any) {
                console.error('[LM Studio] Both SDK and REST API failed. REST error:', restError?.message);
                console.log('[LM Studio] Make sure LM Studio is running with the local server enabled.');
                return [];
            }
        }
    }

    private detectVisionCapability(modelName: string): boolean {
        const visionPatterns = [
            'llava', 'bakllava', 'vision', 'cogvlm', 'internvl',
            'qwen-vl', 'qwen2-vl', 'qvq', 'moondream', 'bunny', 'minicpm-v',
            'phi-3-vision', 'llama-3.2-vision', 'gemma-3', 'pixtral', 'deepseek-vl'
        ];
        const lowerName = modelName.toLowerCase();
        return visionPatterns.some(p => lowerName.includes(p));
    }

    private detectToolsCapability(modelName: string): boolean {
        const lowerName = modelName.toLowerCase();
        const toolPatterns = [
            'qwen', 'mistral', 'llama-3.1', 'llama-3.2', 'llama3.1', 'llama3.2', 'llama-3-',
            'functionary', 'hermes', 'nexus', 'firefunction', 'gorilla',
            'dolphin', 'openhermes', 'nous-hermes', 'instruct', 'gemma-2'
        ];
        return toolPatterns.some(p => lowerName.includes(p));
    }

    async downloadModel(model: string, quantization?: string): Promise<ModelDownloadStatus> {
        const { model: modelId, quantization: requestedQuantization } = normalizeLMStudioDownloadRequest(model, quantization);

        if (!modelId) {
            throw new Error('Enter a model catalog ID or Hugging Face URL.');
        }

        if (/\.gguf(?:\?.*)?$/i.test(modelId) && !modelId.startsWith('http')) {
            throw new Error('That looks like only a GGUF filename. Paste the Hugging Face repo URL or full GGUF file URL.');
        }

        const body: Record<string, string> = { model: modelId };
        if (requestedQuantization) {
            body.quantization = requestedQuantization;
        }

        console.log('[LM Studio REST] Starting model download:', body);
        const response = await fetch(`${this.baseUrl}/api/v1/models/download`, {
            method: 'POST',
            headers: getRestHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) {
            const detail = await readRestError(response);
            throw new Error(`LM Studio download failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ''}`);
        }

        const payload = await response.json() as ModelDownloadStatus;
        return {
            ...payload,
            requested_model: modelId,
            requested_quantization: requestedQuantization
        };
    }

    async getDownloadStatus(jobId: string): Promise<ModelDownloadStatus> {
        const cleanJobId = jobId.trim();
        if (!cleanJobId) {
            throw new Error('Missing LM Studio download job id.');
        }

        const response = await fetch(`${this.baseUrl}/api/v1/models/download/status/${encodeURIComponent(cleanJobId)}`, {
            headers: getRestHeaders(),
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok) {
            const detail = await readRestError(response);
            throw new Error(`LM Studio download status failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ''}`);
        }

        return response.json() as Promise<ModelDownloadStatus>;
    }

    private async isModelLoaded(client: any, modelId: string): Promise<boolean> {
        try {
            const loadedModels = await client.llm.listLoaded();
            return loadedModels.some((loaded: any) => {
                const identifier = loaded.identifier || loaded.modelKey || loaded.path || '';
                return identifier === modelId || identifier.includes(modelId) || modelId.includes(identifier);
            });
        } catch (error: any) {
            console.warn('[LM Studio SDK] Could not inspect loaded models:', error?.message || error);
            return false;
        }
    }

    private getLoadedModelIdentifier(model: any): string {
        return model.identifier || model.modelKey || model.path || '';
    }

    private modelMatches(identifier: string, modelId: string): boolean {
        return identifier === modelId || identifier.includes(modelId) || modelId.includes(identifier);
    }

    private async unloadOtherLoadedModels(client: any, modelId: string): Promise<void> {
        try {
            const loadedModels = await client.llm.listLoaded();
            const toUnload = loadedModels.filter((loaded: any) => {
                const identifier = this.getLoadedModelIdentifier(loaded);
                return identifier && !this.modelMatches(identifier, modelId);
            });

            for (const loaded of toUnload) {
                const identifier = this.getLoadedModelIdentifier(loaded);
                console.log('[LM Studio] Unloading previously loaded model before switching:', identifier);
                await client.llm.unload(identifier);
            }
        } catch (error: any) {
            console.warn('[LM Studio] Could not unload previous loaded models:', error?.message || error);
        }
    }

    private async warmupModelWithRestProgress(modelId: string, config: ChatConfig, signal?: AbortSignal): Promise<void> {
        emitLoadProgress(modelId, 0, 'starting');
        const contextLength = getSafeContextLength(config.contextLength);

        const controller = new AbortController();
        const relayAbort = () => controller.abort();
        signal?.addEventListener('abort', relayAbort, { once: true });

        try {
            const response = await fetch(`${this.baseUrl}/api/v1/chat`, {
                method: 'POST',
                headers: getRestHeaders('text/event-stream'),
                body: JSON.stringify({
                    model: modelId,
                    input: 'Say OK.',
                    stream: true,
                    store: false,
                    context_length: contextLength,
                    temperature: 0,
                    max_output_tokens: 1
                }),
                signal: controller.signal
            });

            if (!response.ok || !response.body) {
                const detail = await response.text().catch(() => '');
                throw new Error(`REST warmup failed (${response.status} ${response.statusText}) ${detail}`.trim());
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                if (signal?.aborted) {
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
                    if (sse.event === 'model_load.start') {
                        emitLoadProgress(modelId, 0, 'starting');
                    } else if (sse.event === 'model_load.progress') {
                        emitLoadProgress(modelId, Number(sse.data.progress || 0) * 100, 'loading');
                    } else if (sse.event === 'model_load.end') {
                        emitLoadProgress(modelId, 100, 'ready');
                    } else if (sse.event === 'error') {
                        throw new Error(sse.data.error?.message || 'LM Studio REST warmup stream failed.');
                    }
                }
            }

            emitLoadProgress(modelId, 100, 'ready');
        } catch (error: any) {
            if (signal?.aborted || error?.name === 'AbortError') {
                return;
            }
            console.warn('[LM Studio REST] Model warmup/progress unavailable, continuing with SDK:', error?.message || error);
        } finally {
            signal?.removeEventListener('abort', relayAbort);
        }
    }

    /**
     * Chat using the official LM Studio SDK.
     * Uses client.llm.model() which reuses existing loaded models.
     */
    async *chat(messages: Message[], config: ChatConfig, signal?: AbortSignal): AsyncIterable<StreamChunk> {
        try {
            const client = await getClient();

            await this.unloadOtherLoadedModels(client, config.model);

            const alreadyLoaded = await this.isModelLoaded(client, config.model);
            if (!alreadyLoaded) {
                await this.warmupModelWithRestProgress(config.model, config, signal);
            } else {
                emitLoadProgress(config.model, 100, 'ready');
            }

            // Get model handle - this reuses existing loaded models
            const contextLength = getSafeContextLength(config.contextLength);
            console.log('[LM Studio SDK] Getting model:', config.model, 'with context:', contextLength);
            
            const model = await client.llm.model(config.model, {
                config: {
                    contextLength,
                },
            });

            // Build SDK-compatible messages with vision support
            const sdkMessages = await Promise.all(messages.map(async m => {
                if (typeof m.content === 'string') {
                    return { role: m.role, content: m.content };
                }

                if (Array.isArray(m.content)) {
                    const textPart = m.content.find((p: any) => p.type === 'text');
                    const imageParts = m.content.filter((p: any) => p.type === 'image_url');

                    // If there are images, prepare them using the SDK
                    if (imageParts.length > 0) {
                        const preparedImages = [];
                        for (const img of imageParts) {
                            // Extract base64, supporting both data URI and raw base64
                            const url = img.image_url?.url || '';
                            let base64Data = '';
                            const base64Match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);

                            if (base64Match) {
                                base64Data = base64Match[2];
                            } else if (url && url.length > 20) {
                                // Fallback: assume it's raw base64 if it's long and has no prefix
                                // The user explicitly asked to "base64 encode this"
                                base64Data = url;
                            }

                            if (base64Data) {
                                console.log('[LM Studio SDK] Processing image, base64 length:', base64Data.length);
                                try {
                                    // VERIFIED SIGNATURE: prepareImageBase64(name: string, contentBase64: string)
                                    // Validated via tests/verify-lmstudio-image-4.js
                                    const extension = base64Match?.[1]?.includes('jpeg') || base64Match?.[1]?.includes('jpg')
                                        ? 'jpg'
                                        : base64Match?.[1]?.includes('webp')
                                            ? 'webp'
                                            : 'png';
                                    const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
                                    const prepared = await client.files.prepareImageBase64(fileName, base64Data);
                                    preparedImages.push(prepared);
                                    console.log('[LM Studio SDK] Image prepared successfully:', prepared.identifier);
                                } catch (e: any) {
                                    console.error('[LM Studio SDK] Failed to prepare image:', e?.message || e);
                                    if (e.issues) console.error(JSON.stringify(e.issues, null, 2));
                                }
                            } else {
                                console.warn('[LM Studio SDK] Image URL found but failed to extract base64 data:', url.substring(0, 50) + '...');
                            }
                        }

                        if (preparedImages.length > 0) {
                            return {
                                role: m.role,
                                content: textPart?.text || 'Describe this image',
                                images: preparedImages
                            };
                        }
                    }

                    return { role: m.role, content: textPart?.text || '' };
                }

                return { role: m.role, content: String(m.content || '') };
            }));

            console.log('[LM Studio SDK] Calling model.respond with', sdkMessages.length, 'messages');
            console.log('[LM Studio SDK] Inference params:', {
                temperature: config.temperature,
                maxTokens: config.max_tokens,
                topKSampling: config.topKSampling,
                topPSampling: config.topPSampling,
                repeatPenalty: config.repeatPenalty,
                signal: signal ? 'AbortSignal provided' : 'undefined'
            });

            // Call model.respond() for streaming inference
            const prediction = model.respond(sdkMessages, {
                temperature: config.temperature ?? 0.7,
                maxTokens: config.max_tokens ?? 2048,
                topKSampling: config.topKSampling,
                topPSampling: config.topPSampling,
                repeatPenalty: config.repeatPenalty,
                signal: signal,
            });

            // Iterate over the prediction stream
            for await (const fragment of prediction) {
                // Check for abort signal
                if (signal?.aborted) {
                    console.log('[LM Studio SDK] Aborted by signal');
                    yield { done: true, aborted: true };
                    return;
                }

                // Debug: Log what we're getting
                console.log('[LM Studio SDK] Fragment type:', typeof fragment, 'value:', JSON.stringify(fragment).substring(0, 100));

                // The SDK may yield different formats - handle both string and object
                let content = '';
                if (typeof fragment === 'string') {
                    content = fragment;
                } else if (fragment && typeof fragment === 'object') {
                    // Try common property names for content
                    content = fragment.content || fragment.text || fragment.delta?.content || fragment.message?.content || '';
                    if (!content && fragment.toString && fragment.toString() !== '[object Object]') {
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

        } catch (error: any) {
            console.error('[LM Studio SDK] Chat error:', error);
            yield { done: true, error: error.message };
        }
    }

    async unloadModel(modelId: string): Promise<void> {
        // Use LM Studio SDK for proper model unloading
        try {
            console.log('[LM Studio] Unloading model via SDK:', modelId || 'all loaded models');
            const client = await getClient();

            // Get all currently loaded models
            const loadedModels = await client.llm.listLoaded();
            console.log('[LM Studio] Found', loadedModels.length, 'loaded models');

            if (loadedModels.length === 0) {
                console.log('[LM Studio] No models currently loaded in VRAM');
                return;
            }

            // Unload each loaded model
            for (const model of loadedModels) {
                try {
                    const identifier = model.identifier || model.modelKey || model.path;
                    console.log('[LM Studio] Unloading:', identifier);
                    await client.llm.unload(identifier);
                    console.log('[LM Studio] Successfully unloaded:', identifier);
                } catch (unloadError: any) {
                    console.error('[LM Studio] Failed to unload model:', unloadError?.message || unloadError);
                }
            }
        } catch (error: any) {
            console.error('[LM Studio] Unload error:', error?.message || error);
            // If SDK fails, try to reset client for next attempt
            resetClient();
        }
    }

    async stopRunning(): Promise<void> {
        // Unload all loaded models
        return this.unloadModel('');
    }
}
