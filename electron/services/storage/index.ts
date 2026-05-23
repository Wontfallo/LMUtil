import { ipcMain } from 'electron';
import { conversationService, messageService, MessageNode } from './conversations';
import { settingsService } from './settings';
import { getDb } from './database';

export function registerStorageHandlers() {
    console.log('[Storage] Registering IPC handlers');

    // Conversations
    ipcMain.handle('db:get-conversations', async () => {
        console.log('[Storage] Getting all conversations');
        return conversationService.getAll();
    });

    ipcMain.handle('db:create-conversation', async (_, id: string, title: string) => {
        console.log('[Storage] Creating conversation:', id, title);
        try {
            const result = conversationService.create(id, title);
            console.log('[Storage] Conversation created successfully');
            return result;
        } catch (error) {
            console.error('[Storage] Failed to create conversation:', error);
            throw error;
        }
    });

    ipcMain.handle('db:branch-conversation', async (_, sourceConversationId: string, targetMessageId: string, newConversationId: string, title?: string) => {
        console.log('[Storage] Branching conversation:', sourceConversationId, 'from message:', targetMessageId);
        return conversationService.createBranchFromMessage(sourceConversationId, targetMessageId, newConversationId, title);
    });

    ipcMain.handle('db:delete-conversation', async (_, id: string) => {
        console.log('[Storage] Deleting conversation:', id);
        return conversationService.delete(id);
    });

    ipcMain.handle('db:update-conversation-title', async (_, id: string, title: string) => {
        return conversationService.updateTitle(id, title);
    });

    // Messages
    ipcMain.handle('db:get-messages', async (_, conversationId: string) => {
        console.log('[Storage] Getting messages for:', conversationId);
        return messageService.getByConversation(conversationId);
    });

    ipcMain.handle('db:save-message', async (_, message: Omit<MessageNode, 'created_at'>) => {
        console.log('[Storage] Saving message:', message.id);
        return messageService.create(message);
    });

    ipcMain.handle('db:delete-message-branch', async (_, messageId: string) => {
        return messageService.deleteBranch(messageId);
    });

    ipcMain.handle('db:update-message-content', async (_, messageId: string, content: string | any[], truncateAfter = false) => {
        return messageService.updateContent(messageId, content, truncateAfter);
    });

    // Settings
    ipcMain.handle('db:get-settings', async () => {
        console.log('[Storage] Getting all settings');
        return settingsService.getAll();
    });

    ipcMain.handle('db:set-setting', async (_, key: string, value: string) => {
        console.log('[Storage] Setting:', key);
        return settingsService.set(key, value);
    });

    // Per-chat settings
    ipcMain.handle('db:get-conversation', async (_, id: string) => {
        console.log('[Storage] Getting conversation:', id);
        return conversationService.getById(id);
    });

    ipcMain.handle('db:update-conversation-settings', async (_, id: string, settings: any) => {
        console.log('[Storage] Updating conversation settings:', id);
        return conversationService.updateSettings(id, settings);
    });

    // Prompt History (for Prompt Studio)
    ipcMain.handle('db:get-prompt-history', async () => {
        console.log('[Storage] Getting prompt history');
        const db = getDb();
        return db.prepare('SELECT * FROM prompt_history ORDER BY id DESC').all();
    });

    ipcMain.handle('db:add-prompt-history', async (_, item: any) => {
        console.log('[Storage] Adding prompt history item');
        const db = getDb();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO prompt_history (id, timestamp, input, output, negative_prompt, model, creativity, target_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(item.id, item.timestamp, item.input, item.output, item.negativePrompt || '', item.model, item.creativity, item.targetModel);
        return { success: true };
    });

    ipcMain.handle('db:delete-prompt-history', async (_, id: number) => {
        console.log('[Storage] Deleting prompt history item:', id);
        const db = getDb();
        db.prepare('DELETE FROM prompt_history WHERE id = ?').run(id);
        return { success: true };
    });

    ipcMain.handle('db:clear-prompt-history', async () => {
        console.log('[Storage] Clearing all prompt history');
        const db = getDb();
        db.prepare('DELETE FROM prompt_history').run();
        return { success: true };
    });

    // Prompt Library (for custom prompt templates)
    ipcMain.handle('db:get-prompt-library', async () => {
        console.log('[Storage] Getting prompt library');
        const db = getDb();
        return db.prepare('SELECT * FROM prompt_library ORDER BY updated_at DESC').all();
    });

    ipcMain.handle('db:add-prompt-library', async (_, item: any) => {
        console.log('[Storage] Adding prompt library item:', item.name);
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO prompt_library (id, name, description, system_prompt, images, target_type, requires_vision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = new Date().toISOString();
        stmt.run(
            item.id,
            item.name,
            item.description || '',
            item.systemPrompt,
            JSON.stringify(item.images || []),
            item.targetType || 'any',
            item.requiresVision ? 1 : 0,
            now,
            now
        );
        return { success: true };
    });

    ipcMain.handle('db:update-prompt-library', async (_, item: any) => {
        console.log('[Storage] Updating prompt library item:', item.id);
        const db = getDb();
        const stmt = db.prepare(`
            UPDATE prompt_library 
            SET name = ?, description = ?, system_prompt = ?, images = ?, target_type = ?, requires_vision = ?, updated_at = ?
            WHERE id = ?
        `);
        stmt.run(
            item.name,
            item.description || '',
            item.systemPrompt,
            JSON.stringify(item.images || []),
            item.targetType || 'any',
            item.requiresVision ? 1 : 0,
            new Date().toISOString(),
            item.id
        );
        return { success: true };
    });

    ipcMain.handle('db:delete-prompt-library', async (_, id: string) => {
        console.log('[Storage] Deleting prompt library item:', id);
        const db = getDb();
        db.prepare('DELETE FROM prompt_library WHERE id = ?').run(id);
        return { success: true };
    });

    console.log('[Storage] All IPC handlers registered');
}
