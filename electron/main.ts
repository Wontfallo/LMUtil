import { app, BrowserWindow, Menu, MenuItem } from 'electron';
import path from 'node:path';

// Import services
import { LLMService } from './services/llm';
import { initDatabase } from './services/storage/database';
import { registerStorageHandlers } from './services/storage';
import { registerTTSHandlers } from './services/tts';
import { registerFileSystemHandlers } from './services/storage/fileSystem';
import { startAllServices, registerServiceHandlers, stopAllServices } from './services/services';
import { setMainWindowForLMStudio } from './services/llm/lmstudio';
import { unloadAllModels } from './services/modelManager';

// __dirname is available in CJS output
declare const __dirname: string;

// Allow generated TTS audio to play without requiring a fresh user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');


// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.cjs
// │ │ └── preload.cjs
// │
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
    ? process.env.DIST
    : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
let quitCleanupComplete = false;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | null> => {
    let timeout: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<null>((resolve) => {
                timeout = setTimeout(() => {
                    console.warn(`[Main] ${label} timed out after ${timeoutMs}ms; continuing shutdown.`);
                    resolve(null);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
};

const cleanupBeforeQuit = async () => {
    console.log('[Main] App quitting: unloading GPU models and stopping local services...');

    await withTimeout(unloadAllModels(), 15_000, 'LLM model unload');
    await withTimeout(stopAllServices(), 8_000, 'service shutdown');

    console.log('[Main] Quit cleanup finished.');
};

function createSplashWindow(): BrowserWindow {
    const splashPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon-splash.png')
        : path.join(__dirname, '../icon-splash.png');

    console.log('[Main] Creating splash window with image:', splashPath);

    const splashWin = new BrowserWindow({
        width: 400,
        height: 400,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    // Load a simple HTML that displays the splash image
    splashWin.loadURL(`data:text/html,
        <html>
        <head>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    overflow: hidden;
                }
                img {
                    max-width: 100%;
                    max-height: 100%;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                }
            </style>
        </head>
        <body>
            <img src="file://${splashPath.replace(/\\/g, '/')}" alt="Loading..." />
        </body>
        </html>
    `);

    return splashWin;
}

function createWindow() {
    console.log('[Main] Creating window...');
    console.log('[Main] Preload path:', path.join(__dirname, 'preload.cjs'));

    win = new BrowserWindow({
        width: 1200,
        height: 800,
        // backgroundColor: '#0c0c0e', // Removed for debugging
        show: true, // Show immediately to see any startup errors
        icon: app.isPackaged
            ? path.join(process.resourcesPath, 'icon-splash.png')
            : path.join(__dirname, '../icon-splash.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true
        },
    });

    // Set window reference for LM Studio progress callbacks
    setMainWindowForLMStudio(win);

    win.webContents.on('did-finish-load', () => {
        console.log('[Main] Window loaded');
        win?.webContents.send('main-process-message', new Date().toLocaleString());

        // Close splash
        if (splash && !splash.isDestroyed()) {
            splash.close();
            splash = null;
        }
        // Window already shown
    });


    // Right-click context menu
    win.webContents.on('context-menu', (_, params) => {
        console.log('[Main] Context menu triggered. Editable:', params.isEditable, 'Has selection:', !!params.selectionText);
        const menu = new Menu();

        // Add Spellcheck Suggestions
        if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
            for (const suggestion of params.dictionarySuggestions) {
                menu.append(new MenuItem({
                    label: suggestion,
                    click: () => win?.webContents.replaceMisspelling(suggestion)
                }));
            }
            menu.append(new MenuItem({ type: 'separator' }));
        }

        // Standard Actions
        menu.append(new MenuItem({ role: 'cut' }));
        menu.append(new MenuItem({ role: 'copy' }));
        menu.append(new MenuItem({ role: 'paste' }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ role: 'selectAll' }));

        // Add Inspect Element for debugging/advanced usage
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
            label: 'Inspect Element',
            click: () => {
                win?.webContents.inspectElement(params.x, params.y);
            }
        }));

        // Always show the menu
        menu.popup({ window: win || undefined });
    });

    if (VITE_DEV_SERVER_URL) {
        console.log('[Main] Loading dev server:', VITE_DEV_SERVER_URL);
        win.loadURL(VITE_DEV_SERVER_URL);
        win.webContents.openDevTools();
    } else {
        // Production: explicit path to dist_renderer since we renamed the output dir
        // __dirname is .../resources/app.asar/dist-electron
        const indexHtml = path.join(__dirname, '../dist_renderer/index.html');
        console.log('[Main] Loading production build');
        win.loadFile(indexHtml);
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
        win = null;
    }
});

app.on('before-quit', (event) => {
    if (quitCleanupComplete) {
        return;
    }

    event.preventDefault();
    quitCleanupComplete = true;

    cleanupBeforeQuit()
        .catch((error) => {
            console.error('[Main] Quit cleanup failed:', error);
        })
        .finally(() => {
            app.quit();
        });
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.whenReady().then(() => {
    console.log('[Main] App ready, initializing services...');

    // Initialize database first
    const dbInitialized = initDatabase();
    if (!dbInitialized) {
        console.error('[Main] Database initialization failed!');
    }

    // Register IPC handlers
    registerStorageHandlers();
    registerTTSHandlers();
    registerFileSystemHandlers();

    const llmService = new LLMService();
    llmService.registerHandlers();

    // Register service status handlers
    registerServiceHandlers();

    console.log('[Main] All services registered');

    // Start backend services in background (non-blocking)
    // Services will poll until ready - UI will show loading state
    startAllServices();

    // Show splash screen first
    splash = createSplashWindow();

    // Then create main window (hidden until loaded)
    createWindow();
});
