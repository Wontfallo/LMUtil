import { ipcMain } from 'electron';
import { spawn, exec } from 'child_process';
import path from 'path';

// Track running backend processes
let ollamaProcess: any = null;
let lmStudioProcess: any = null;

/**
 * Check if Ollama is running by querying its API
 */
async function isOllamaRunning(): Promise<boolean> {
    try {
        const response = await fetch('http://localhost:11434/api/tags', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Check if LM Studio is running by querying its API
 */
async function isLMStudioRunning(): Promise<boolean> {
    try {
        const response = await fetch('http://localhost:1234/v1/models', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Start Ollama in the background
 */
async function startOllama(): Promise<{ success: boolean; message: string }> {
    if (await isOllamaRunning()) {
        return { success: true, message: 'Ollama is already running' };
    }

    try {
        console.log('[Backend] Starting Ollama...');

        // Use 'ollama serve' to start the server
        ollamaProcess = spawn('ollama', ['serve'], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });

        ollamaProcess.unref();

        // Wait a bit and check if it started
        await new Promise(resolve => setTimeout(resolve, 3000));

        if (await isOllamaRunning()) {
            console.log('[Backend] Ollama started successfully');
            return { success: true, message: 'Ollama started successfully' };
        } else {
            return { success: false, message: 'Ollama started but API not responding' };
        }
    } catch (error: any) {
        console.error('[Backend] Failed to start Ollama:', error);
        return { success: false, message: `Failed to start Ollama: ${error.message}` };
    }
}

/**
 * Start LM Studio in the background using the lms CLI
 */
async function startLMStudio(): Promise<{ success: boolean; message: string }> {
    if (await isLMStudioRunning()) {
        return { success: true, message: 'LM Studio is already running' };
    }

    try {
        console.log('[Backend] Starting LM Studio server...');

        // Use 'lms server start' to start the server headlessly
        lmStudioProcess = spawn('lms', ['server', 'start'], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });

        lmStudioProcess.unref();

        // Wait a bit and check if it started
        await new Promise(resolve => setTimeout(resolve, 3000));

        if (await isLMStudioRunning()) {
            console.log('[Backend] LM Studio started successfully');
            return { success: true, message: 'LM Studio started successfully' };
        } else {
            return { success: false, message: 'LM Studio started but API not responding. Make sure lms CLI is installed.' };
        }
    } catch (error: any) {
        console.error('[Backend] Failed to start LM Studio:', error);
        return { success: false, message: `Failed to start LM Studio: ${error.message}` };
    }
}

/**
 * Get the status of all backends
 */
async function getBackendStatus(): Promise<{
    ollama: { running: boolean };
    lmstudio: { running: boolean };
}> {
    const [ollamaRunning, lmstudioRunning] = await Promise.all([
        isOllamaRunning(),
        isLMStudioRunning()
    ]);

    return {
        ollama: { running: ollamaRunning },
        lmstudio: { running: lmstudioRunning }
    };
}

/**
 * Register IPC handlers for backend management
 */
export function registerBackendHandlers() {
    ipcMain.handle('backend:status', async () => {
        return getBackendStatus();
    });

    ipcMain.handle('backend:start-ollama', async () => {
        return startOllama();
    });

    ipcMain.handle('backend:start-lmstudio', async () => {
        return startLMStudio();
    });

    ipcMain.handle('backend:start-all', async () => {
        const [ollamaResult, lmstudioResult] = await Promise.all([
            startOllama(),
            startLMStudio()
        ]);

        return {
            ollama: ollamaResult,
            lmstudio: lmstudioResult
        };
    });

    console.log('[Backend] Backend startup handlers registered');
}
