import { getDb } from './database';

export const settingsService = {
    set(key: string, value: string) {
        const db = getDb();
        return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    },

    get(key: string): string | null {
        const db = getDb();
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
        return row ? row.value : null;
    },

    getAll(): Record<string, string> {
        const db = getDb();
        const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[];
        return rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {} as Record<string, string>);
    }
};
