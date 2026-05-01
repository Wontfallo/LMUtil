// Model manager for VRAM cleanup

/**
 * Helper to force unload Ollama models from VRAM.
 * Ollama keeps models in VRAM for 5 mins by default; this forces it to 0.
 */
export const unloadOllama = async (): Promise<void> => {
    try {
        // Get running models
        const res = await fetch('http://localhost:11434/api/ps');
        if (!res.ok) return;

        const ps = await res.json();
        if (ps.models && ps.models.length > 0) {
            for (const model of ps.models) {
                const modelName = model.name;
                console.log(`[ModelManager] Unloading Ollama model: ${modelName}`);

                await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: modelName, prompt: '', keep_alive: 0 })
                });
            }
        } else {
            console.log('[ModelManager] No Ollama models loaded in VRAM.');
        }
    } catch (e) {
        console.error('[ModelManager] Failed to unload Ollama:', e);
    }
};

/**
 * Helper to unload LM Studio models.
 * Uses the LM Studio SDK to properly unload all loaded models.
 */
export const unloadLMStudio = async (): Promise<void> => {
    try {
        console.log('[ModelManager] Unloading LM Studio models via SDK...');
        const { LMStudioClient } = await import('@lmstudio/sdk');

        const client = new LMStudioClient({
            baseUrl: 'ws://127.0.0.1:1234',
        });

        // Get all loaded models
        const loadedModels = await client.llm.listLoaded();
        console.log('[ModelManager] Found', loadedModels.length, 'loaded LM Studio models');

        if (loadedModels.length === 0) {
            console.log('[ModelManager] No LM Studio models loaded in VRAM.');
            return;
        }

        // Unload each model
        for (const model of loadedModels) {
            try {
                const identifier = model.identifier || model.modelKey || model.path;
                console.log('[ModelManager] Unloading LM Studio model:', identifier);
                await client.llm.unload(identifier);
                console.log('[ModelManager] Successfully unloaded:', identifier);
            } catch (unloadError: any) {
                console.error('[ModelManager] Failed to unload model:', unloadError?.message || unloadError);
            }
        }

        console.log('[ModelManager] LM Studio models unloaded.');
    } catch (error: any) {
        console.log('[ModelManager] LM Studio SDK unload error (server might not be running):', error?.message);
    }
};

/**
 * Call this when the user toggles the backend in your UI.
 * Unloads models from the OTHER backend to free VRAM before switching.
 */
export const switchBackend = async (target: 'ollama' | 'lmstudio'): Promise<void> => {
    console.log(`[ModelManager] Switching to ${target}... cleaning up other backend.`);

    if (target === 'ollama') {
        // Clear VRAM from LM Studio before using Ollama
        await unloadLMStudio();
    } else if (target === 'lmstudio') {
        // Clear VRAM from Ollama before using LM Studio
        await unloadOllama();
    }

    console.log(`[ModelManager] Ready for ${target}.`);
};

/**
 * Unload ALL models from both backends.
 * Use this for the "Eject" button functionality.
 */
export const unloadAllModels = async (): Promise<void> => {
    console.log('[ModelManager] Unloading all models from all backends...');
    await Promise.all([
        unloadOllama(),
        unloadLMStudio()
    ]);
    console.log('[ModelManager] All models unloaded.');
};
