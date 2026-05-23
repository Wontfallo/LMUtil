import { ipcMain } from 'electron';
import { TTSService } from './edgeTTS';
import { isServiceActuallyReady, startServiceById } from '../services';
import { emitDiagnostics } from '../diagnostics';

export function registerTTSHandlers() {
    const ttsService = new TTSService();

    ipcMain.handle('tts:list-voices', async () => {
        return ttsService.listVoices();
    });

    ipcMain.handle('tts:list-clone-profiles', async () => {
        return ttsService.listCloneProfiles();
    });

    ipcMain.handle('tts:create-clone-profile', async (_, name: string, audioPath: string, refText?: string) => {
        return ttsService.createCloneProfile(name, audioPath, refText);
    });

    ipcMain.handle('tts:create-clone-profile-from-audio-data', async (_, name: string, audioDataUrl: string, extension?: string, refText?: string) => {
        return ttsService.createCloneProfileFromAudioData(name, audioDataUrl, extension, refText);
    });

    ipcMain.handle('tts:transcribe-audio-data', async (_, audioDataUrl: string) => {
        return ttsService.transcribeAudioData(audioDataUrl);
    });

    ipcMain.handle('tts:delete-clone-profile', async (_, profileId: string) => {
        return ttsService.deleteCloneProfile(profileId);
    });

    ipcMain.handle('tts:speak', async (_, text: string, voice: string, rate?: string, pitch?: string) => {
        emitDiagnostics('tts/ipc', 'debug', `Renderer requested speak (${text.trim().length} chars, voice ${voice}).`);
        if (!(await isServiceActuallyReady('omnivoice'))) {
            emitDiagnostics('tts/ipc', 'warn', 'OmniVoice is not ready. Attempting startup.');
            const started = await startServiceById('omnivoice');
            if (!started) {
                emitDiagnostics('tts/ipc', 'error', 'OmniVoice startup failed.');
                throw new Error('OmniVoice is not running and could not be started. Check VRAM headroom or service logs.');
            }
            emitDiagnostics('tts/ipc', 'info', 'OmniVoice startup succeeded after retry.');
        }
        try {
            return await ttsService.speak(text, voice, rate, pitch);
        } catch (error) {
            emitDiagnostics('tts/ipc', 'error', `Speak failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    });

    ipcMain.handle('tts:cleanup', async () => {
        ttsService.cleanupTempFiles();
    });

    ipcMain.handle('tts:cancel', async () => {
        ttsService.cancelActiveRequests();
        return true;
    });
}
