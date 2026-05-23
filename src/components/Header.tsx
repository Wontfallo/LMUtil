import React from 'react';
import { useAppStore } from '../store/appStore.ts';
import { useChatStore } from '../store/chatStore.ts';
import { useTTSStore } from '../store/ttsStore.ts';
import { Cpu, Download, Loader2, RefreshCw, Sliders, Terminal, X } from 'lucide-react';

interface HeaderProps {
    onOpenSettings: () => void;
    onToggleTerminal: () => void;
    terminalOpen: boolean;
}

const getModelLookupTerms = (rawInput: string, normalizedModel?: string): string[] => {
    const terms = new Set<string>();
    const add = (value?: string) => {
        const clean = value?.trim().toLowerCase();
        if (clean) terms.add(clean);
    };

    add(rawInput);
    add(normalizedModel);

    for (const value of [rawInput, normalizedModel]) {
        if (!value) continue;
        try {
            const url = new URL(value.trim());
            const parts = url.pathname.split('/').filter(Boolean);
            if (url.hostname === 'huggingface.co' && parts.length >= 2) {
                add(`${parts[0]}/${parts[1]}`);
                add(parts[1]);
            }

            const fileName = parts[parts.length - 1];
            if (fileName?.toLowerCase().endsWith('.gguf')) {
                add(decodeURIComponent(fileName).replace(/\.gguf$/i, ''));
            }
        } catch {
            if (value.toLowerCase().endsWith('.gguf')) {
                add(value.replace(/\.gguf$/i, ''));
            }
        }
    }

    return Array.from(terms);
};

const normalizeForLookup = (value: string): string => value
    .toLowerCase()
    .replace(/\.gguf$/g, '')
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-+|-+$/g, '');

const findDownloadedModel = (list: any[], beforeIds: Set<string>, rawInput: string, normalizedModel?: string): any | null => {
    const terms = getModelLookupTerms(rawInput, normalizedModel).map(normalizeForLookup).filter(Boolean);
    const newModel = list.find((item: any) => !beforeIds.has(item.id));
    if (newModel) return newModel;

    return list.find((item: any) => {
        const haystack = [
            item.id,
            item.name,
            item.key,
            item.display_name
        ].filter(Boolean).map((value: string) => normalizeForLookup(value));

        return terms.some(term => haystack.some(value => value === term || value.includes(term) || term.includes(value)));
    }) || null;
};

const Header: React.FC<HeaderProps> = ({ onOpenSettings, onToggleTerminal, terminalOpen }) => {
    const { provider, model, models, setProvider, setModel, setModels, settingsLoaded, currentView } = useAppStore();
    const { currentConversationId, conversations } = useChatStore();
    const stopTTS = useTTSStore(state => state.stop);
    const [isLoading, setIsLoading] = React.useState(true);
    const [showDownload, setShowDownload] = React.useState(false);
    const [downloadModelId, setDownloadModelId] = React.useState('');
    const [downloadStatus, setDownloadStatus] = React.useState<{
        label: string;
        progress: number | null;
        active: boolean;
        error?: string;
        detail?: string;
    } | null>(null);

    const currentConv = conversations.find(c => c.id === currentConversationId);

    // Simple: Just keep trying to get models until we succeed
    React.useEffect(() => {
        if (!settingsLoaded) return;

        let active = true;
        setIsLoading(true);
        setModels([]);

        const fetchModels = async () => {
            // Just keep trying until we get models (max 30 seconds)
            for (let attempt = 1; attempt <= 30 && active; attempt++) {
                try {
                    console.log(`[Header] Attempt ${attempt}: Fetching models from ${provider}...`);

                    // Set provider first
                    await window.ipcRenderer.setProvider(provider as any);

                    // Try to get models
                    const list = await window.ipcRenderer.listModels();

                    if (list && list.length > 0) {
                        console.log(`[Header] Got ${list.length} models!`);
                        if (active) {
                            setModels(list);
                            setIsLoading(false);

                            // Auto-select model if needed
                            if (!model || !list.some((m: any) => m.id === model)) {
                                setModel(list[0].id);
                            }
                        }
                        return; // Success - exit loop
                    }

                    console.log(`[Header] Attempt ${attempt}: Got 0 models, retrying...`);
                } catch (err) {
                    console.log(`[Header] Attempt ${attempt} failed:`, err);
                }

                // Wait 1 second before next attempt
                await new Promise(r => setTimeout(r, 1000));
            }

            // Gave up
            if (active) {
                console.log('[Header] Gave up after 30 attempts');
                setIsLoading(false);
            }
        };

        fetchModels();

        return () => { active = false; };
    }, [provider, settingsLoaded]);

    const handleUnloadModel = async () => {
        if (!confirm('Eject all GPU models from VRAM? This unloads LM/Ollama models and stops OmniVoice TTS until the app restarts it.')) return;
        stopTTS();
        await window.ipcRenderer.cleanupLLM();
        await window.ipcRenderer.stopService('omnivoice');
    };

    const handleModelChange = async (nextModel: string) => {
        if (nextModel && nextModel !== model) {
            stopTTS();
            await window.ipcRenderer.cleanupLLM();
        }
        setModel(nextModel);
    };

    const refreshModels = React.useCallback(async (preferredModel?: string) => {
        setIsLoading(true);
        await window.ipcRenderer.setProvider(provider as any);
        const list = await window.ipcRenderer.listModels();
        setModels(list || []);
        setIsLoading(false);

        if (preferredModel) {
            const match = list.find((item: any) => item.id === preferredModel || item.name === preferredModel);
            if (match) {
                setModel(match.id);
            }
        }

        return list || [];
    }, [provider, setModel, setModels]);

    const handleRefreshModels = async () => {
        try {
            await refreshModels(model);
        } catch (error) {
            console.error('[Header] Failed to refresh models:', error);
            setIsLoading(false);
        }
    };

    const handleDownloadModel = async () => {
        if (provider !== 'lmstudio') return;

        const requestedModel = downloadModelId.trim();
        if (!requestedModel || downloadStatus?.active) return;

        setDownloadStatus({ label: 'Starting download', progress: null, active: true });

        try {
            const beforeModels = await window.ipcRenderer.listModels().catch(() => []);
            const beforeModelIds = new Set((beforeModels || []).map((item: any) => item.id));
            const initial = await window.ipcRenderer.downloadLMStudioModel(requestedModel);
            const normalizedRequest = initial.requested_model || requestedModel;

            if (initial.status === 'already_downloaded') {
                setDownloadStatus({ label: 'Already downloaded', progress: 100, active: false });
                const refreshedModels = await refreshModels();
                const matchedModel = findDownloadedModel(refreshedModels, beforeModelIds, requestedModel, normalizedRequest);
                if (matchedModel) {
                    setModel(matchedModel.id);
                }
                return;
            }

            if (!initial.job_id) {
                setDownloadStatus({ label: initial.status || 'Download started', progress: null, active: false });
                await refreshModels();
                return;
            }

            let latest = initial;
            let statusPollFailures = 0;
            while (latest.status === 'downloading' || latest.status === 'paused') {
                const progress = latest.total_size_bytes && latest.downloaded_bytes !== undefined
                    ? Math.round((latest.downloaded_bytes / latest.total_size_bytes) * 100)
                    : null;
                setDownloadStatus({
                    label: latest.status === 'paused' ? 'Paused' : 'Downloading',
                    progress,
                    active: true
                });

                await new Promise(resolve => setTimeout(resolve, 1500));
                try {
                    latest = await window.ipcRenderer.getLMStudioDownloadStatus(initial.job_id);
                    statusPollFailures = 0;
                } catch (statusError: any) {
                    statusPollFailures += 1;
                    setDownloadStatus({
                        label: `Waiting for LM Studio status${progress !== null ? ` (${progress}%)` : ''}`,
                        progress,
                        active: true,
                        detail: statusError?.message || String(statusError)
                    });

                    if (statusPollFailures >= 8) {
                        throw statusError;
                    }
                }
            }

            if (latest.status === 'completed') {
                setDownloadStatus({ label: 'Download complete', progress: 100, active: false });
                setIsLoading(true);

                let refreshedModels: any[] = [];
                let newModel: any = null;
                for (let attempt = 0; attempt < 12; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1500));
                    refreshedModels = await window.ipcRenderer.listModels();
                    newModel = findDownloadedModel(refreshedModels, beforeModelIds, requestedModel, normalizedRequest);

                    if (newModel || refreshedModels.length !== beforeModels.length || attempt === 11) {
                        break;
                    }
                }

                setModels(refreshedModels || []);
                setIsLoading(false);

                if (newModel) {
                    setModel(newModel.id);
                    setDownloadStatus({ label: `Download complete: ${newModel.name || newModel.id}`, progress: 100, active: false });
                } else {
                    setDownloadStatus({
                        label: 'Download complete, refresh finished',
                        progress: 100,
                        active: false,
                        detail: 'LM Studio reported completion, but the app could not identify the exact new model key. Use refresh or search the model dropdown.'
                    });
                }
            } else {
                setDownloadStatus({
                    label: 'Download failed',
                    progress: null,
                    active: false,
                    error: latest.error || latest.status,
                    detail: JSON.stringify(latest, null, 2)
                });
            }
        } catch (error: any) {
            setDownloadStatus({
                label: 'Download failed',
                progress: null,
                active: false,
                error: error?.message || String(error),
                detail: error?.stack || error?.message || String(error)
            });
        }
    };

    return (
        <header className="app-header">
            <div className="header-left">
                {currentView === 'chat' && (
                    <h2 className="current-title">{currentConv?.title || 'New Chat'}</h2>
                )}
            </div>

            <div className="header-right">
                <div className="controls-group">
                    <select
                        className="control-select"
                        value={provider}
                        onChange={(e) => setProvider(e.target.value as any)}
                    >
                        <option value="ollama">Ollama</option>
                        <option value="lmstudio">LMStudio</option>
                    </select>

                    <select
                        className="control-select model-select"
                        value={model}
                        onChange={(e) => { void handleModelChange(e.target.value); }}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <option value="">⏳ Loading models...</option>
                        ) : models.length === 0 ? (
                            <option value="">No models found</option>
                        ) : (
                            <>
                                <option value="">Select Model</option>
                                {models.map(m => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}{m.hasVision ? ' 👁️' : ''}{m.hasTools ? ' 🔧' : ''}
                                    </option>
                                ))}
                            </>
                        )}
                    </select>

                    {isLoading && <Loader2 className="spin-icon" size={16} />}

                    <button
                        className="control-btn"
                        onClick={() => { void handleRefreshModels(); }}
                        title="Refresh model list"
                        disabled={isLoading}
                    >
                        <RefreshCw size={16} />
                    </button>

                    {provider === 'lmstudio' && (
                        <button
                            className="control-btn"
                            onClick={() => setShowDownload(value => !value)}
                            title="Download LM Studio model"
                        >
                            {showDownload ? <X size={16} /> : <Download size={16} />}
                        </button>
                    )}

                    <button className="control-btn" onClick={handleUnloadModel} title="Eject Model from VRAM">
                        <Cpu size={16} />
                    </button>

                    <button
                        className={`control-btn ${terminalOpen ? 'active' : ''}`}
                        onClick={onToggleTerminal}
                        title={terminalOpen ? 'Hide Live Terminal' : 'Show Live Terminal'}
                    >
                        <Terminal size={16} />
                    </button>

                    <button
                        className="control-btn"
                        onClick={onOpenSettings}
                        title="Open Settings"
                    >
                        <Sliders size={16} />
                    </button>
                </div>

                {provider === 'lmstudio' && showDownload && (
                    <div className="lm-download-panel">
                        <input
                            className="lm-download-input"
                            value={downloadModelId}
                            onChange={(event) => setDownloadModelId(event.target.value)}
                            placeholder="Model ID, Hugging Face repo, or GGUF file URL"
                            disabled={downloadStatus?.active}
                        />
                        <button
                            className="control-btn lm-download-submit"
                            onClick={() => { void handleDownloadModel(); }}
                            disabled={downloadStatus?.active || !downloadModelId.trim()}
                            title="Start download"
                        >
                            {downloadStatus?.active ? <Loader2 className="spin-icon" size={14} /> : <Download size={14} />}
                        </button>
                        {downloadStatus && (
                            <div className={`lm-download-status ${downloadStatus.error ? 'error' : ''}`}>
                                <span className="lm-download-status-main" title={downloadStatus.detail || downloadStatus.error || downloadStatus.label}>
                                    {downloadStatus.error
                                        ? `${downloadStatus.label}: ${downloadStatus.error}`
                                        : downloadStatus.label}
                                </span>
                                {downloadStatus.progress !== null && <span>{downloadStatus.progress}%</span>}
                                {downloadStatus.detail && (
                                    <span className="lm-download-status-detail">{downloadStatus.detail}</span>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
};

export default Header;
