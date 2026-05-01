// Using require() for native module compatibility in Electron
import path from 'node:path';
import { app } from 'electron';

// better-sqlite3 is a native module - use require for compatibility
const Database = require('better-sqlite3');

const dbPath = path.join(app.getPath('userData'), 'database.sqlite');

let db: any = null;

export function initDatabase() {
  try {
    console.log('[Database] Initializing at:', dbPath);
    db = new Database(dbPath);

    // Conversations table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Messages table (tree structure)
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

    // Settings table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `).run();

    // Migrations for conversations table - add per-chat settings columns
    const addColumnIfNotExists = (table: string, column: string, type: string) => {
      try {
        db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get();
      } catch {
        console.log(`[DB] Adding column ${column} to ${table}`);
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
      }
    };

    // Per-chat settings columns
    addColumnIfNotExists('conversations', 'last_model', 'TEXT');
    addColumnIfNotExists('conversations', 'last_provider', 'TEXT');
    addColumnIfNotExists('conversations', 'system_prompt', 'TEXT');
    addColumnIfNotExists('conversations', 'user_name', 'TEXT');
    addColumnIfNotExists('conversations', 'ai_name', 'TEXT');
    addColumnIfNotExists('conversations', 'user_avatar', 'TEXT');
    addColumnIfNotExists('conversations', 'ai_avatar', 'TEXT');
    addColumnIfNotExists('conversations', 'ai_voice', 'TEXT');
    addColumnIfNotExists('conversations', 'temperature', 'REAL');
    addColumnIfNotExists('conversations', 'max_tokens', 'INTEGER');
    addColumnIfNotExists('conversations', 'context_length', 'INTEGER');
    addColumnIfNotExists('conversations', 'top_k', 'INTEGER');
    addColumnIfNotExists('conversations', 'top_p', 'REAL');
    addColumnIfNotExists('conversations', 'repeat_penalty', 'REAL');
    addColumnIfNotExists('conversations', 'thinking_mode', 'TEXT DEFAULT "no_think"');

    // Documents table (for RAG - v2)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filename TEXT,
        content TEXT,
        chunk_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Prompt History table (for Prompt Studio)
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

    // Prompt Library table (for custom prompt templates)
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

    // === MIGRATIONS ===
    // Add model column to messages table
    try {
      db.prepare(`ALTER TABLE messages ADD COLUMN model TEXT`).run();
      console.log('[Database] Added model column to messages');
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) throw e;
    }

    // Add per-chat settings columns to conversations
    const conversationColumns = [
      'system_prompt TEXT',
      'user_name TEXT',
      'ai_name TEXT',
      'user_avatar TEXT',
      'ai_avatar TEXT',
      'ai_voice TEXT',
      'user_voice TEXT',
      'ai_region TEXT DEFAULT "all"',
      'user_region TEXT DEFAULT "all"',
      'last_model TEXT',
      'last_provider TEXT',
      'temperature REAL DEFAULT 0.7',
      'max_tokens INTEGER DEFAULT 2048',
      'context_length INTEGER DEFAULT 4096',
      'top_k INTEGER DEFAULT 40',
      'top_p REAL DEFAULT 0.95',
      'repeat_penalty REAL DEFAULT 1.1',
      'thinking_mode TEXT DEFAULT "no_think"',
      'ai_avatar_position INTEGER DEFAULT 30',
      'user_avatar_position INTEGER DEFAULT 30',
      'user_persona TEXT',
      'auto_play INTEGER DEFAULT 0',
      'user_auto_play INTEGER DEFAULT 0',
      'ai_rate TEXT DEFAULT "+0%"',
      'ai_pitch TEXT DEFAULT "+0Hz"',
      'tts_chunk_target INTEGER DEFAULT 450',
      'user_rate TEXT DEFAULT "+0%"',
      'user_pitch TEXT DEFAULT "+0Hz"'
    ];

    for (const col of conversationColumns) {
      try {
        db.prepare(`ALTER TABLE conversations ADD COLUMN ${col}`).run();
        console.log(`[Database] Added ${col.split(' ')[0]} to conversations`);
      } catch (e: any) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }

    console.log('[Database] Initialized successfully');
    return true;
  } catch (error) {
    console.error('[Database] CRITICAL: Initialization failed:', error);
    return false;
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export default { initDatabase, getDb };
