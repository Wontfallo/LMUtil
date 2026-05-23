import { spawn, ChildProcess, execFile } from 'child_process';
import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { emitDiagnostics } from './diagnostics';

type ServiceId = 'ollama' | 'lmstudio' | 'omnivoice';
type ServiceState = 'starting' | 'ready' | 'failed' | 'not_installed';

interface ServiceCommand {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

interface ServiceDef {
    id: ServiceId;
    checkUrl: string;
    startupTimeoutMs?: number;
}

const processes: Partial<Record<ServiceId, ChildProcess>> = {};
const inflightStarts: Partial<Record<ServiceId, Promise<void>>> = {};
let shuttingDown = false;

const serviceStatus: Record<ServiceId, ServiceState> = {
    ollama: 'starting',
    lmstudio: 'starting',
    omnivoice: 'starting',
};

const SERVICES: ServiceDef[] = [
    {
        id: 'ollama',
        checkUrl: 'http://localhost:11434',
        startupTimeoutMs: 20_000,
    },
    {
        id: 'lmstudio',
        checkUrl: 'http://localhost:1234/v1/models',
        startupTimeoutMs: 20_000,
    },
    {
        id: 'omnivoice',
        checkUrl: `${(process.env.OMNIVOICE_SERVER_URL || 'http://127.0.0.1:8880').replace(/\/+$/, '')}/health`,
        startupTimeoutMs: 180_000,
    },
];

function parseVramLine(line: string): { used: number; total: number } | null {
    const [usedRaw, totalRaw] = line.split(',').map(part => Number.parseInt(part.trim(), 10));
    if (!Number.isFinite(usedRaw) || !Number.isFinite(totalRaw)) {
        return null;
    }
    return { used: usedRaw, total: totalRaw };
}

async function getFreeVramMb(): Promise<number | null> {
    return new Promise((resolve) => {
        execFile(
            'nvidia-smi',
            ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
            { windowsHide: true },
            (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }

                const parsed = parseVramLine(stdout.trim().split(/\r?\n/)[0] || '');
                resolve(parsed ? parsed.total - parsed.used : null);
            }
        );
    });
}

async function hasEnoughVramForOmniVoice(): Promise<boolean> {
    if ((process.env.OMNIVOICE_DEVICE || 'cuda').toLowerCase() !== 'cuda') {
        return true;
    }

    const minFreeMb = Number.parseInt(process.env.OMNIVOICE_MIN_FREE_VRAM_MB || '', 10) || 2000;
    const freeMb = await getFreeVramMb();
    if (freeMb === null) {
        return true;
    }

    if (freeMb < minFreeMb) {
        console.warn(`[Services] Not starting omnivoice: only ${freeMb}MB VRAM free, need at least ${minFreeMb}MB.`);
        emitDiagnostics('services/omnivoice', 'warn', `Skipped start: ${freeMb}MB free VRAM, ${minFreeMb}MB required.`);
        return false;
    }

    return true;
}

function findOllamaCLI(): string | null {
    const homeDir = os.homedir();
    const possiblePaths = [
        path.join(homeDir, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
        'C:\\Program Files\\Ollama\\ollama.exe',
        'C:\\Program Files (x86)\\Ollama\\ollama.exe',
    ];

    for (const candidate of possiblePaths) {
        if (candidate && fs.existsSync(candidate)) {
            console.log('[Services] Found Ollama CLI at:', candidate);
            return candidate;
        }
    }

    console.log('[Services] Ollama CLI not found. Checked:', possiblePaths.filter(Boolean));
    return null;
}

function findLMStudioCLI(): string | null {
    const homeDir = os.homedir();
    const possiblePaths = [
        path.join(homeDir, '.lmstudio', 'bin', 'lms.exe'),
        path.join(homeDir, '.cache', 'lm-studio', 'bin', 'lms.exe'),
        path.join(homeDir, 'AppData', 'Local', 'LM-Studio', 'lms.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'LM-Studio', 'lms.exe'),
    ];

    for (const candidate of possiblePaths) {
        if (candidate && fs.existsSync(candidate)) {
            console.log('[Services] Found LM Studio CLI at:', candidate);
            return candidate;
        }
    }

    console.log('[Services] LM Studio CLI not found. Checked:', possiblePaths.filter(Boolean));
    return null;
}

function getOmniVoiceCommands(): ServiceCommand[] {
    const localOmniVoiceExe = path.join(process.cwd(), '.omnivoice', 'Scripts', 'omnivoice-server.exe');
    const localOmniVoicePython = path.join(process.cwd(), '.omnivoice', 'Scripts', 'python.exe');
    const omniVoiceLauncher = app.isPackaged
        ? path.join(process.resourcesPath, 'omnivoice-launcher.py')
        : path.join(process.cwd(), 'electron', 'services', 'omnivoice-launcher.py');
    const baseArgs = [
        '--host', '127.0.0.1',
        '--port', process.env.OMNIVOICE_PORT || '8880',
        '--device', process.env.OMNIVOICE_DEVICE || 'cuda',
        '--timeout', process.env.OMNIVOICE_REQUEST_TIMEOUT_S || '600',
        '--max-concurrent', process.env.OMNIVOICE_MAX_CONCURRENT || '1',
    ];

    if (process.env.OMNIVOICE_API_KEY?.trim()) {
        baseArgs.push('--api-key', process.env.OMNIVOICE_API_KEY.trim());
    }

    if (process.env.OMNIVOICE_MODEL_ID?.trim()) {
        baseArgs.push('--model-id', process.env.OMNIVOICE_MODEL_ID.trim());
    }

    if (process.env.OMNIVOICE_NUM_STEP?.trim()) {
        baseArgs.push('--num-step', process.env.OMNIVOICE_NUM_STEP.trim());
    }

    const explicitExecutable = process.env.OMNIVOICE_EXECUTABLE?.trim();
    const commands: ServiceCommand[] = [];

    if (explicitExecutable) {
        commands.push({ command: explicitExecutable, args: [...baseArgs] });
    }

    if (fs.existsSync(localOmniVoicePython) && fs.existsSync(omniVoiceLauncher)) {
        commands.push({ command: localOmniVoicePython, args: [omniVoiceLauncher, ...baseArgs] });
    }

    if (fs.existsSync(localOmniVoicePython)) {
        commands.push({ command: localOmniVoicePython, args: ['-m', 'omnivoice_server', ...baseArgs] });
    }

    if (fs.existsSync(localOmniVoiceExe)) {
        commands.push({ command: localOmniVoiceExe, args: [...baseArgs] });
    }

    commands.push(
        { command: 'omnivoice-server', args: [...baseArgs] },
        { command: 'py', args: ['-m', 'omnivoice_server', ...baseArgs] },
        { command: 'python', args: ['-m', 'omnivoice_server', ...baseArgs] }
    );

    return commands;
}

function getStartCommands(serviceId: ServiceId): ServiceCommand[] {
    if (serviceId === 'ollama') {
        const execPath = findOllamaCLI();
        return execPath ? [{ command: execPath, args: ['serve'] }] : [];
    }

    if (serviceId === 'lmstudio') {
        const execPath = findLMStudioCLI();
        return execPath ? [{ command: execPath, args: ['server', 'start'] }] : [];
    }

    return getOmniVoiceCommands();
}

const waitForServer = async (
    url: string,
    timeoutMs = 15_000,
    intervalMs = 1_000
): Promise<boolean> => {
    const startTime = Date.now();

    while (!shuttingDown && Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) {
                return true;
            }
        } catch {
            // Server not ready yet.
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
};

async function tryStartCommand(service: ServiceDef, commandDef: ServiceCommand): Promise<boolean> {
    if (shuttingDown) {
        return false;
    }

    console.log(`[Services] Starting ${service.id}: "${commandDef.command}" ${commandDef.args.join(' ')}`);
    emitDiagnostics(`services/${service.id}`, 'info', `Starting command: ${commandDef.command} ${commandDef.args.join(' ')}`);

    try {
        const child = spawn(commandDef.command, commandDef.args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ...commandDef.env,
            },
        });

        processes[service.id] = child;

        if (shuttingDown) {
            await killProcessTree(child);
            if (processes[service.id] === child) {
                delete processes[service.id];
            }
            return false;
        }

        let spawnFailed = false;

        child.once('error', (err) => {
            spawnFailed = true;
            console.error(`[Services] ${service.id} spawn error for "${commandDef.command}":`, err.message);
            emitDiagnostics(`services/${service.id}`, 'error', `Spawn error: ${err.message}`);
        });

        child.once('exit', (code) => {
            console.log(`[Services] ${service.id} process exited with code:`, code);
            emitDiagnostics(`services/${service.id}`, code === 0 ? 'info' : 'warn', `Process exited with code ${code}`);
            if (processes[service.id] === child) {
                delete processes[service.id];
                serviceStatus[service.id] = 'failed';
            }
        });

        child.stdout?.on('data', (chunk) => {
            const message = chunk.toString().trim();
            if (message) {
                console.log(`[Services:${service.id}:stdout] ${message}`);
                emitDiagnostics(`services/${service.id}`, 'debug', `[stdout] ${message}`);
            }
        });

        child.stderr?.on('data', (chunk) => {
            const message = chunk.toString().trim();
            if (message) {
                console.error(`[Services:${service.id}:stderr] ${message}`);
                emitDiagnostics(`services/${service.id}`, 'warn', `[stderr] ${message}`);
            }
        });

        await new Promise((resolve) => setTimeout(resolve, 750));

        if (spawnFailed) {
            if (processes[service.id] === child) {
                delete processes[service.id];
            }
            return false;
        }

        if (shuttingDown) {
            await killProcessTree(child);
            if (processes[service.id] === child) {
                delete processes[service.id];
            }
            return false;
        }

        const ready = await waitForServer(service.checkUrl, service.startupTimeoutMs ?? 20_000);
        if (ready) {
            console.log(`[Services] ${service.id} is now ready!`);
            emitDiagnostics(`services/${service.id}`, 'info', 'Health check passed. Service is ready.');
            return true;
        }

        console.log(`[Services] ${service.id} did not become ready after "${commandDef.command}"`);
        emitDiagnostics(`services/${service.id}`, 'warn', `Health check did not pass after command: ${commandDef.command}`);
        if (processes[service.id] === child) {
            delete processes[service.id];
        }
        try {
            child.kill();
        } catch {
            // Process already exited.
        }
        return false;
    } catch (error: any) {
        console.error(`[Services] Failed to start ${service.id} with "${commandDef.command}":`, error?.message);
        emitDiagnostics(`services/${service.id}`, 'error', `Failed to start: ${error?.message || String(error)}`);
        return false;
    }
}

const startService = async (service: ServiceDef): Promise<void> => {
    if (shuttingDown) {
        return;
    }

    const existing = inflightStarts[service.id];
    if (existing) {
        return existing;
    }

    const run = (async () => {
        try {
            const res = await fetch(service.checkUrl, { signal: AbortSignal.timeout(2_000) });
            if (res.ok) {
                console.log(`[Services] ${service.id} is already running.`);
                serviceStatus[service.id] = 'ready';
                return;
            }
        } catch {
            // Service not running yet.
        }

        const commands = getStartCommands(service.id);
        if (commands.length === 0) {
            console.log(`[Services] Cannot start ${service.id}: executable not found.`);
            emitDiagnostics(`services/${service.id}`, 'error', 'Cannot start: executable not found.');
            serviceStatus[service.id] = 'not_installed';
            return;
        }

        if (service.id === 'omnivoice' && !(await hasEnoughVramForOmniVoice())) {
            serviceStatus[service.id] = 'failed';
            return;
        }

        serviceStatus[service.id] = 'starting';

        for (const command of commands) {
            if (shuttingDown) {
                return;
            }

            const ready = await tryStartCommand(service, command);
            if (ready) {
                serviceStatus[service.id] = 'ready';
                emitDiagnostics(`services/${service.id}`, 'info', 'Service reported ready.');
                return;
            }
        }

        serviceStatus[service.id] = service.id === 'omnivoice' ? 'not_installed' : 'failed';
        emitDiagnostics(`services/${service.id}`, 'error', `All startup commands failed. Status: ${serviceStatus[service.id]}.`);
    })();

    inflightStarts[service.id] = run;
    try {
        await run;
    } finally {
        if (inflightStarts[service.id] === run) {
            delete inflightStarts[service.id];
        }
    }
};

export const getServiceStatus = (serviceId: ServiceId): string => {
    return serviceStatus[serviceId] || 'unknown';
};

export const isServiceReady = (serviceId: ServiceId): boolean => {
    return serviceStatus[serviceId] === 'ready';
};

export const isServiceActuallyReady = async (serviceId: ServiceId): Promise<boolean> => {
    const service = SERVICES.find(item => item.id === serviceId);
    if (!service) {
        return false;
    }

    try {
        const response = await fetch(service.checkUrl, { signal: AbortSignal.timeout(2_000) });
        const ready = response.ok;
        serviceStatus[serviceId] = ready ? 'ready' : 'failed';
        return ready;
    } catch {
        serviceStatus[serviceId] = 'failed';
        return false;
    }
};

export const registerServiceHandlers = () => {
    ipcMain.handle('services:get-status', (_, serviceId: ServiceId) => {
        return serviceStatus[serviceId] || 'unknown';
    });

    ipcMain.handle('services:is-ready', async (_, serviceId: ServiceId) => {
        return isServiceActuallyReady(serviceId);
    });

    ipcMain.handle('services:get-all-status', () => {
        return { ...serviceStatus };
    });

    ipcMain.handle('services:stop-all', async () => {
        await stopAllServices();
        return true;
    });

    ipcMain.handle('services:stop-service', async (_, serviceId: ServiceId) => {
        await stopServiceProcess(serviceId);
        return true;
    });

    ipcMain.handle('services:start-service', async (_, serviceId: ServiceId) => {
        return startServiceById(serviceId);
    });
};

export const startAllServices = () => {
    console.log('[Services] Starting all backend services (non-blocking)...');
    shuttingDown = false;

    SERVICES.forEach(service => {
        startService(service).catch(err => {
            console.error(`[Services] Error starting ${service.id}:`, err);
        });
    });
};

export const startServiceById = async (serviceId: ServiceId): Promise<boolean> => {
    if (shuttingDown) {
        return false;
    }

    const service = SERVICES.find(item => item.id === serviceId);
    if (!service) {
        return false;
    }

    await startService(service);
    return serviceStatus[serviceId] === 'ready';
};

const killProcessTree = (child: ChildProcess): Promise<void> => {
    return new Promise((resolve) => {
        if (!child.pid) {
            resolve();
            return;
        }

        if (process.platform === 'win32') {
            execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], () => resolve());
            return;
        }

        try {
            child.kill('SIGTERM');
        } catch {
            // Process already exited.
        }
        resolve();
    });
};

export const stopServiceProcess = async (serviceId: ServiceId): Promise<void> => {
    const child = processes[serviceId];
    if (!child) {
        return;
    }

    console.log(`[Services] Killing ${serviceId} process...`);
    await killProcessTree(child);
    delete processes[serviceId];
    serviceStatus[serviceId] = 'failed';
};

export const stopAllServices = async (): Promise<void> => {
    console.log('[Services] Stopping all service processes...');
    shuttingDown = true;

    const stops = Object.entries({ ...processes }).map(async ([id, child]) => {
        if (child) {
            await stopServiceProcess(id as ServiceId);
        }
    });
    await Promise.all(stops);
};

app.on('will-quit', async () => {
    await stopAllServices();
});
