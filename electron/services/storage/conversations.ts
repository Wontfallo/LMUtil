import { getDb } from './database';
import { randomUUID } from 'node:crypto';

export interface Conversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    // Per-chat settings
    system_prompt?: string;
    user_name?: string;
    ai_name?: string;
    user_avatar?: string;
    ai_avatar?: string;
    ai_voice?: string;
    user_voice?: string;
    ai_region?: string;
    user_region?: string;
    ai_rate?: string;
    ai_pitch?: string;
    tts_chunk_target?: number;
    user_rate?: string;
    user_pitch?: string;
    last_model?: string;
    last_provider?: 'ollama' | 'lmstudio';
    temperature?: number;
    max_tokens?: number;
    context_length?: number;
    top_k?: number;
    top_p?: number;
    repeat_penalty?: number;
    thinking_mode?: 'auto' | 'no_think' | 'think';
    ai_avatar_position?: number;
    user_avatar_position?: number;
    user_persona?: string;
    auto_play?: number;
    user_auto_play?: number;
}

export interface MessageNode {
    id: string;
    conversation_id: string;
    parent_id: string | null;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    model?: string;
    images?: string;
    tool_calls?: string;
    tool_result?: string;
    created_at: string;
}

export const conversationService = {
    create(id: string, title: string) {
        const db = getDb();
        console.log('[DB] Creating conversation:', id, title);
        return db.prepare('INSERT INTO conversations (id, title) VALUES (?, ?)').run(id, title);
    },

    getAll(): Conversation[] {
        const db = getDb();
        return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as Conversation[];
    },

    delete(id: string) {
        const db = getDb();
        return db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    },

    updateTitle(id: string, title: string) {
        const db = getDb();
        return db.prepare('UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, id);
    },

    updateSettings(id: string, settings: Partial<Omit<Conversation, 'id' | 'created_at' | 'updated_at'>>) {
        const db = getDb();
        const fields = Object.keys(settings).map(k => `${k} = @${k}`).join(', ');
        if (!fields) {
            console.log('[Conversations] updateSettings: no fields to update');
            return;
        }
        const sql = `UPDATE conversations SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`;
        console.log('[Conversations] updateSettings SQL:', sql, 'params:', { ...settings, id });
        const result = db.prepare(sql).run({ ...settings, id });
        console.log('[Conversations] updateSettings result:', result);
        return result;
    },

    getById(id: string): Conversation | undefined {
        const db = getDb();
        const result = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined;
        console.log('[Conversations] getById:', id);
        console.log('[Conversations] getById result - ai_name:', result?.ai_name, 'ai_avatar:', result?.ai_avatar ? 'exists' : 'none', 'system_prompt:', result?.system_prompt ? 'exists' : 'none');
        return result;
    },

    createBranchFromMessage(sourceConversationId: string, targetMessageId: string, newConversationId: string, title?: string) {
        const db = getDb();
        const source = db.prepare('SELECT * FROM conversations WHERE id = ?').get(sourceConversationId) as Record<string, any> | undefined;
        const target = db.prepare('SELECT rowid, conversation_id FROM messages WHERE id = ?').get(targetMessageId) as { rowid: number; conversation_id: string } | undefined;

        if (!source) {
            throw new Error('Source conversation not found.');
        }
        if (!target || target.conversation_id !== sourceConversationId) {
            throw new Error('Branch point message not found in this conversation.');
        }

        const branchTitle = title || `${source.title || 'Conversation'} (branch)`;
        const settingsColumns = Object.keys(source).filter(column =>
            !['id', 'title', 'created_at', 'updated_at'].includes(column)
        );

        const createBranch = db.transaction(() => {
            const conversationColumns = ['id', 'title', ...settingsColumns];
            const placeholders = conversationColumns.map(column => `@${column}`).join(', ');
            const conversationParams = conversationColumns.reduce((params, column) => {
                params[column] = source[column] === undefined ? null : source[column];
                return params;
            }, {} as Record<string, any>);
            conversationParams.id = newConversationId;
            conversationParams.title = branchTitle;

            db.prepare(`
                INSERT INTO conversations (${conversationColumns.join(', ')})
                VALUES (${placeholders})
            `).run(conversationParams);

            const sourceMessages = db.prepare(`
                SELECT rowid, *
                FROM messages
                WHERE conversation_id = @conversation_id
                  AND rowid <= @rowid
                ORDER BY rowid ASC
            `).all({
                conversation_id: sourceConversationId,
                rowid: target.rowid,
            }) as Array<Record<string, any>>;

            const idMap = new Map<string, string>();
            for (const message of sourceMessages) {
                idMap.set(message.id, randomUUID());
            }

            const insertMessage = db.prepare(`
                INSERT INTO messages (
                    id,
                    conversation_id,
                    parent_id,
                    role,
                    content,
                    model,
                    images,
                    tool_calls,
                    tool_result,
                    created_at
                )
                VALUES (
                    @id,
                    @conversation_id,
                    @parent_id,
                    @role,
                    @content,
                    @model,
                    @images,
                    @tool_calls,
                    @tool_result,
                    @created_at
                )
            `);

            for (const message of sourceMessages) {
                insertMessage.run({
                    id: idMap.get(message.id),
                    conversation_id: newConversationId,
                    parent_id: message.parent_id ? idMap.get(message.parent_id) || null : null,
                    role: message.role,
                    content: message.content,
                    model: message.model || null,
                    images: message.images || null,
                    tool_calls: message.tool_calls || null,
                    tool_result: message.tool_result || null,
                    created_at: message.created_at,
                });
            }

            db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newConversationId);

            return {
                id: newConversationId,
                title: branchTitle,
                messageCount: sourceMessages.length,
            };
        });

        return createBranch();
    }
};

export const messageService = {
    serializeContent(content: string | any[]) {
        return Array.isArray(content) ? JSON.stringify(content) : content;
    },

    create(message: Omit<MessageNode, 'created_at'> & { content: string | any[] }) {
        const db = getDb();
        console.log('[DB] Saving message:', message.id, 'model:', message.model);

        const safeMessage = {
            images: null,
            tool_calls: null,
            tool_result: null,
            model: null,
            ...message,
            content: messageService.serializeContent(message.content)
        };
        return db.prepare(`
      INSERT INTO messages (id, conversation_id, parent_id, role, content, model, images, tool_calls, tool_result)
      VALUES (@id, @conversation_id, @parent_id, @role, @content, @model, @images, @tool_calls, @tool_result)
    `).run(safeMessage);
    },

    getByConversation(conversationId: string): MessageNode[] {
        const db = getDb();
        const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as MessageNode[];

        // Deserialize JSON content if it's a stringified array
        return messages.map(msg => {
            if (typeof msg.content === 'string' && msg.content.startsWith('[')) {
                try {
                    msg.content = JSON.parse(msg.content);
                } catch (e) {
                    // Not valid JSON array, keep as string
                }
            }
            return msg;
        });
    },

    deleteBranch(messageId: string) {
        const db = getDb();
        const target = db.prepare('SELECT conversation_id, rowid FROM messages WHERE id = ?').get(messageId) as { conversation_id: string; rowid: number } | undefined;
        if (!target) return { changes: 0 };

        const remove = db.transaction(() => {
            const result = db.prepare(`
                DELETE FROM messages
                WHERE conversation_id = @conversation_id
                  AND rowid >= @rowid
            `).run(target);
            db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target.conversation_id);
            return result;
        });

        return remove();
    },

    updateContent(messageId: string, content: string | any[], truncateAfter = false) {
        const db = getDb();
        const target = db.prepare('SELECT conversation_id, rowid FROM messages WHERE id = ?').get(messageId) as { conversation_id: string; rowid: number } | undefined;
        if (!target) return { changes: 0 };

        const update = db.transaction(() => {
            if (truncateAfter) {
                db.prepare(`
                    DELETE FROM messages
                    WHERE conversation_id = @conversation_id
                      AND rowid > @rowid
                `).run(target);
            }

            const result = db.prepare('UPDATE messages SET content = @content WHERE id = @id').run({
                id: messageId,
                content: messageService.serializeContent(content)
            });
            db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target.conversation_id);
            return result;
        });

        return update();
    }
};
