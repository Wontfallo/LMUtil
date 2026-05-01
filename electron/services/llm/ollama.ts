import { LLMProvider, Message, ChatConfig, StreamChunk, ModelInfo } from './types.ts';

function extractBase64Image(dataUrl: string): string | null {
    const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/i);
    if (match?.[1]) return match[1];

    if (/^[A-Za-z0-9+/=\s]+$/.test(dataUrl) && dataUrl.length > 100) {
        return dataUrl.replace(/\s/g, '');
    }

    return null;
}

function toOllamaMessages(messages: Message[]) {
    return messages.map(message => {
        if (!Array.isArray(message.content)) return message;

        const textParts = message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text || '')
            .filter(Boolean);

        const images = message.content
            .filter((part: any) => part.type === 'image_url')
            .map((part: any) => extractBase64Image(part.image_url?.url || ''))
            .filter(Boolean);

        return {
            role: message.role,
            content: textParts.join('\n') || 'Describe this image.',
            ...(images.length > 0 ? { images } : {})
        };
    });
}

export class OllamaProvider implements LLMProvider {
    private baseUrl = 'http://localhost:11434';

    async isConnected(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async listModels(): Promise<ModelInfo[]> {
        // Check if Ollama service is running (started by services.ts at app launch)
        const connected = await this.isConnected();
        if (!connected) {
            console.log('[Ollama] Not connected - service may not be running');
            return [];
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            const data = await response.json();

            // Get capabilities for each model
            const models = await Promise.all(
                (data.models || []).map(async (m: any) => {
                    const capabilities = await this.getModelCapabilities(m.name);
                    return {
                        id: m.name,
                        name: m.name,
                        provider: 'ollama' as const,
                        hasVision: capabilities.hasVision,
                        hasTools: capabilities.hasTools,
                        maxContext: capabilities.maxContext
                    };
                })
            );

            return models;
        } catch (error) {
            console.error('[Ollama] listModels error:', error);
            return [];
        }
    }

    private async getModelCapabilities(modelName: string): Promise<{ hasVision: boolean; hasTools: boolean; maxContext?: number }> {
        try {
            const response = await fetch(`${this.baseUrl}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName })
            });
            const data = await response.json();

            const hasVision = this.detectVisionCapability(modelName, data);
            const hasTools = this.detectToolsCapability(modelName, data);

            let maxContext: number | undefined;
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

    private detectVisionCapability(modelName: string, apiData: any): boolean {
        if (apiData?.projector_info || apiData?.details?.families?.includes('clip')) {
            return true;
        }
        const visionPatterns = [
            'llava', 'bakllava', 'llama3.2-vision', 'vision',
            'cogvlm', 'internvl', 'qwen-vl', 'qwen2-vl', 'moondream'
        ];
        const lowerName = modelName.toLowerCase();
        return visionPatterns.some(p => lowerName.includes(p));
    }

    private detectToolsCapability(modelName: string, apiData: any): boolean {
        if (apiData?.template) {
            const template = apiData.template.toLowerCase();
            if (template.includes('tool') || template.includes('function') ||
                template.includes('<|python_tag|>') || template.includes('ipython')) {
                return true;
            }
        }
        const toolPatterns = [
            'qwen', 'mistral', 'llama-3.1', 'llama-3.2', 'llama3.1', 'llama3.2',
            'functionary', 'hermes', 'nexus', 'firefunction', 'gorilla'
        ];
        const lowerName = modelName.toLowerCase();
        return toolPatterns.some(p => lowerName.includes(p));
    }

    private async unloadOtherRunningModels(modelId: string): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/api/ps`);
            if (!response.ok) return;

            const data = await response.json();
            const runningModels = data.models || [];

            for (const running of runningModels) {
                const name = running.name || running.model || '';
                if (name && name !== modelId) {
                    console.log('[Ollama] Unloading previous running model before switching:', name);
                    await this.unloadModel(name);
                }
            }
        } catch (error) {
            console.warn('[Ollama] Could not inspect/unload previous running models:', error);
        }
    }

    async *chat(messages: Message[], config: ChatConfig, signal?: AbortSignal): AsyncIterable<StreamChunk> {
        try {
            await this.unloadOtherRunningModels(config.model);

            const ollamaMessages = toOllamaMessages(messages);

            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.model,
                    messages: ollamaMessages,
                    stream: true,
                    options: {
                        temperature: config.temperature,
                        num_predict: config.max_tokens,
                        alert: true, // Legacy (optional)
                        top_k: config.topKSampling,
                        top_p: config.topPSampling,
                        repeat_penalty: config.repeatPenalty,
                        num_ctx: config.contextLength,
                    }
                }),
                signal
            });

            if (!response.body) throw new Error('No response body');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);
                        yield {
                            content: data.message?.content || '',
                            done: data.done
                        };
                    } catch (e) {
                        console.error('Error parsing Ollama chunk:', e);
                    }
                }
            }
        } catch (error: any) {
            yield { done: true, error: error.message };
        }
    }

    async unloadModel(modelId: string): Promise<void> {
        try {
            console.log('[Ollama] Unloading model:', modelId);
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: modelId,
                    prompt: '',
                    keep_alive: 0
                })
            });
            console.log('[Ollama] Unload response status:', response.status);
            if (!response.ok) {
                const text = await response.text();
                console.error('[Ollama] Unload failed:', text);
                throw new Error(`Ollama unload failed: ${text}`);
            }
            console.log('[Ollama] Model unloaded:', modelId);
        } catch (error) {
            console.error('[Ollama] Unload error:', error);
        }
    }

    async stopRunning(): Promise<void> {
        try {
            console.log('[Ollama] Checking for running models to stop...');
            const response = await fetch(`${this.baseUrl}/api/ps`);
            if (!response.ok) return;

            const data = await response.json();
            const runningModels = data.models || [];

            if (runningModels.length === 0) {
                console.log('[Ollama] No models running.');
                return;
            }

            console.log('[Ollama] Unloading models from VRAM:', runningModels.map((m: any) => m.name));

            await Promise.all(runningModels.map(async (m: any) => {
                await this.unloadModel(m.name);
            }));

            console.log('[Ollama] All models unloaded from VRAM.');
        } catch (error) {
            console.error('[Ollama] Failed to stop running models:', error);
        }
    }
}
