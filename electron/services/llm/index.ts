import { ipcMain } from 'electron';
import { OllamaProvider } from './ollama';
import { LMStudioProvider } from './lmstudio';
import { LLMProvider, Message, ChatConfig } from './types';
import { switchBackend, unloadAllModels } from '../modelManager';

export class LLMService {
    private providers: Record<string, LLMProvider> = {
        ollama: new OllamaProvider(),
        lmstudio: new LMStudioProvider()
    };

    private currentProvider: 'ollama' | 'lmstudio' = 'ollama';
    private abortController: AbortController | null = null;

    setProvider(provider: 'ollama' | 'lmstudio') {
        console.log('[LLMService] Setting provider to:', provider);
        this.currentProvider = provider;
    }

    registerHandlers() {
        ipcMain.handle('llm:list-models', async () => {
            console.log('[LLMService] list-models called, current provider:', this.currentProvider);
            try {
                const models = await this.providers[this.currentProvider].listModels();
                console.log('[LLMService] list-models returned', models.length, 'models');
                return models;
            } catch (error: any) {
                console.error('[LLMService] list-models error:', error?.message || error);
                return [];
            }
        });

        ipcMain.handle('llm:set-provider', async (_, provider: 'ollama' | 'lmstudio') => {
            // Unload models from the other backend before switching
            await switchBackend(provider);
            this.setProvider(provider);
            return true;
        });

        ipcMain.on('llm:chat', async (event, messages: Message[], config: ChatConfig) => {
            console.log(`[LLM] Starting chat with ${this.currentProvider} (model: ${config.model})`);

            // Create new abort controller for this request
            this.abortController = new AbortController();
            const signal = this.abortController.signal;

            const provider = this.providers[this.currentProvider];
            try {
                let chunkCount = 0;
                for await (const chunk of provider.chat(messages, config, signal)) {
                    if (signal.aborted) {
                        console.log('[LLM] Chat aborted by user');
                        event.reply('llm:chat-chunk', { done: true, aborted: true });
                        break;
                    }
                    chunkCount++;
                    event.reply('llm:chat-chunk', chunk);
                }
                console.log(`[LLM] Chat completed with ${chunkCount} chunks`);
            } catch (error: any) {
                if (error.name === 'AbortError' || signal.aborted) {
                    console.log('[LLM] Chat aborted');
                    event.reply('llm:chat-chunk', { done: true, aborted: true });
                } else {
                    console.error('[LLM] Chat error:', error);
                    event.reply('llm:chat-chunk', { done: true, error: error.message });
                }
            } finally {
                this.abortController = null;
            }
        });

        ipcMain.handle('llm:abort', async () => {
            if (this.abortController) {
                console.log('[LLM] Aborting current request');
                this.abortController.abort();
                return true;
            }
            return false;
        });

        ipcMain.handle('llm:unload-model', async (_, modelId: string) => {
            return this.providers[this.currentProvider].unloadModel(modelId);
        });

        ipcMain.handle('llm:download-lmstudio-model', async (_, model: string, quantization?: string) => {
            return (this.providers.lmstudio as LMStudioProvider).downloadModel(model, quantization);
        });

        ipcMain.handle('llm:get-lmstudio-download-status', async (_, jobId: string) => {
            return (this.providers.lmstudio as LMStudioProvider).getDownloadStatus(jobId);
        });

        ipcMain.handle('llm:cleanup', async () => {
            console.log('[LLM] Cleaning up (unloading all models from all backends)...');
            await unloadAllModels();
            return true;
        });
    }
}
