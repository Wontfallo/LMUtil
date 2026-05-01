import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

export function registerFileSystemHandlers() {
    ipcMain.handle('fs:parse-character-card', async (_, filePath: string) => {
        try {
            const buffer = await fs.readFile(filePath);

            // Check PNG Signature
            if (buffer.readUInt32BE(0) !== 0x89504E47 || buffer.readUInt32BE(4) !== 0x0D0A1A0A) {
                return null;
            }

            let offset = 8;
            let charaData = null;

            while (offset < buffer.length) {
                if (offset + 8 > buffer.length) break;

                const length = buffer.readUInt32BE(offset);
                const type = buffer.toString('utf-8', offset + 4, offset + 8);
                const chunkDataStart = offset + 8;
                const chunkDataEnd = chunkDataStart + length;

                if (type === 'tEXt') {
                    const chunkData = buffer.subarray(chunkDataStart, chunkDataEnd);
                    const nullIndex = chunkData.indexOf(0);

                    if (nullIndex !== -1) {
                        const keyword = chunkData.toString('latin1', 0, nullIndex);
                        const text = chunkData.toString('latin1', nullIndex + 1);

                        if (keyword === 'chara' || keyword === 'ccv3') {
                            try {
                                const decoded = Buffer.from(text, 'base64').toString('utf-8');
                                charaData = JSON.parse(decoded);
                            } catch (e) {
                                console.error('[FileSystem] Failed to decode character data:', e);
                            }
                        }
                    }
                }

                offset += length + 12; // Length(4) + Type(4) + Data(length) + CRC(4)
            }

            return charaData;
        } catch (error) {
            console.error('[FileSystem] Parse character card error:', error);
            return null;
        }
    });

    ipcMain.handle('fs:save-avatar', async (_, base64Data: string, type: 'user' | 'ai') => {
        try {
            const userDataPath = app.getPath('userData');
            const avatarDir = path.join(userDataPath, 'avatars');

            // Ensure directory exists
            await fs.mkdir(avatarDir, { recursive: true });

            const fileName = `${type}-avatar.png`;
            const filePath = path.join(avatarDir, fileName);

            const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
            await fs.writeFile(filePath, buffer);

            return filePath;
        } catch (error) {
            console.error('fs:save-avatar error:', error);
            throw error;
        }
    });

    ipcMain.handle('fs:open-dialog', async (event, options: Electron.OpenDialogOptions) => {
        const result = await dialog.showOpenDialog(options);
        // Force focus back to the window after dialog closes
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.focus();
        return result.filePaths; // Return just the file paths array
    });

    ipcMain.handle('fs:save-dialog', async (_, options: Electron.SaveDialogOptions) => {
        return dialog.showSaveDialog(options);
    });

    ipcMain.handle('fs:read-file', async (_, filePath: string) => {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        } catch (error) {
            console.error('fs:read-file error:', error);
            throw error;
        }
    });

    ipcMain.handle('fs:read-file-as-base64', async (_, filePath: string) => {
        try {
            const buffer = await fs.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase().slice(1);
            const mimeTypes: Record<string, string> = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'wav': 'audio/wav',
                'mp3': 'audio/mpeg',
                'flac': 'audio/flac',
                'm4a': 'audio/mp4',
                'ogg': 'audio/ogg',
                'aac': 'audio/aac'
            };
            const mime = mimeTypes[ext] || 'application/octet-stream';
            const base64 = buffer.toString('base64');
            return `data:${mime};base64,${base64}`;
        } catch (error) {
            console.error('fs:read-file-as-base64 error:', error);
            throw error;
        }
    });

    ipcMain.handle('fs:write-file', async (_, filePath: string, content: string) => {
        try {
            await fs.writeFile(filePath, content, 'utf-8');
            return true;
        } catch (error) {
            console.error('fs:write-file error:', error);
            throw error;
        }
    });

    ipcMain.handle('fs:confirm-dialog', async (event, options: { title: string; message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;

        const { response } = await dialog.showMessageBox(win, {
            type: 'question',
            title: options.title,
            message: options.message,
            detail: options.detail,
            buttons: [options.cancelLabel || 'Cancel', options.confirmLabel || 'OK'],
            defaultId: 1,
            cancelId: 0,
            noLink: true,
        });

        // Ensure focus returns to window
        win.focus();
        return response === 1;
    });
}
