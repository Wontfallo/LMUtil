import { BrowserWindow, ipcMain } from 'electron';

export type DiagnosticsLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticsEntry {
    id: number;
    timestamp: string;
    source: string;
    level: DiagnosticsLevel;
    message: string;
}

const MAX_ENTRIES = 600;
const entries: DiagnosticsEntry[] = [];
let nextId = 1;
let enabled = false;

function appendEntry(source: string, level: DiagnosticsLevel, message: string): DiagnosticsEntry {
    const entry: DiagnosticsEntry = {
        id: nextId++,
        timestamp: new Date().toISOString(),
        source,
        level,
        message
    };

    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
    }

    return entry;
}

function broadcastEntry(entry: DiagnosticsEntry): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send('diagnostics:entry', entry);
    }
}

export function emitDiagnostics(source: string, level: DiagnosticsLevel, message: string): void {
    if (!enabled) {
        return;
    }

    const entry = appendEntry(source, level, message);
    broadcastEntry(entry);
}

export function setDiagnosticsEnabled(nextEnabled: boolean): boolean {
    enabled = Boolean(nextEnabled);
    return enabled;
}

export function isDiagnosticsEnabled(): boolean {
    return enabled;
}

export function getDiagnosticsEntries(): DiagnosticsEntry[] {
    return [...entries];
}

export function clearDiagnosticsEntries(): void {
    entries.length = 0;
}

export function registerDiagnosticsHandlers(): void {
    ipcMain.handle('diagnostics:get-state', () => ({
        enabled,
        entries: getDiagnosticsEntries()
    }));

    ipcMain.handle('diagnostics:set-enabled', async (_, value: boolean) => {
        enabled = Boolean(value);
        return enabled;
    });

    ipcMain.handle('diagnostics:clear', () => {
        clearDiagnosticsEntries();
        return true;
    });
}
