import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, X, Minus, Trash2, Pause, Play } from 'lucide-react';

export interface DiagnosticsEntry {
    id: number;
    timestamp: string;
    source: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
}

interface DiagnosticsTerminalProps {
    onClose: () => void;
}

type Filter = 'all' | 'llm' | 'tts' | 'services';

const matchesFilter = (entry: DiagnosticsEntry, filter: Filter): boolean => {
    if (filter === 'all') return true;
    return entry.source.toLowerCase().startsWith(filter);
};

const DiagnosticsTerminal: React.FC<DiagnosticsTerminalProps> = ({ onClose }) => {
    const [enabled, setEnabled] = useState(false);
    const [paused, setPaused] = useState(false);
    const [minimized, setMinimized] = useState(false);
    const [entries, setEntries] = useState<DiagnosticsEntry[]>([]);
    const [filter, setFilter] = useState<Filter>('all');
    const [position, setPosition] = useState({ x: window.innerWidth - 580, y: 80 });
    const [size, setSize] = useState({ width: 540, height: 360 });
    const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
    const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
    const logRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            const state = await window.ipcRenderer.getDiagnosticsState();
            if (!mounted) return;
            setEnabled(Boolean(state?.enabled));
            setEntries(Array.isArray(state?.entries) ? state.entries : []);
        };
        init();

        const unsubscribe = window.ipcRenderer.onDiagnosticsEntry((entry: DiagnosticsEntry) => {
            if (!mounted) return;
            setEntries(prev => {
                if (prev.length > 0 && entry.id <= prev[prev.length - 1].id) return prev;
                const merged = [...prev, entry];
                if (merged.length > 800) return merged.slice(merged.length - 800);
                return merged;
            });
        });

        return () => {
            mounted = false;
            if (unsubscribe) unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (paused || minimized) return;
        const node = logRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [entries, paused, minimized]);

    const filtered = useMemo(() => entries.filter(entry => matchesFilter(entry, filter)), [entries, filter]);

    const toggleEnabled = async (next: boolean) => {
        setEnabled(next);
        await window.ipcRenderer.setDiagnosticsEnabled(next);
        await window.ipcRenderer.setSetting('diagnosticsEnabled', String(next));
    };

    const handleClear = async () => {
        await window.ipcRenderer.clearDiagnostics();
        setEntries([]);
    };

    const startDrag = (event: React.MouseEvent) => {
        dragRef.current = {
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y
        };
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const x = Math.min(window.innerWidth - 200, Math.max(0, e.clientX - dragRef.current.offsetX));
            const y = Math.min(window.innerHeight - 60, Math.max(0, e.clientY - dragRef.current.offsetY));
            setPosition({ x, y });
        };
        const onUp = () => {
            dragRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const startResize = (event: React.MouseEvent) => {
        event.stopPropagation();
        resizeRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            startW: size.width,
            startH: size.height
        };
        const onMove = (e: MouseEvent) => {
            if (!resizeRef.current) return;
            const width = Math.max(360, resizeRef.current.startW + (e.clientX - resizeRef.current.startX));
            const height = Math.max(180, resizeRef.current.startH + (e.clientY - resizeRef.current.startY));
            setSize({ width, height });
        };
        const onUp = () => {
            resizeRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div
            className={`diagnostics-terminal ${minimized ? 'minimized' : ''}`}
            style={{
                left: position.x,
                top: position.y,
                width: minimized ? 260 : size.width,
                height: minimized ? 40 : size.height
            }}
        >
            <div className="diag-header" onMouseDown={startDrag}>
                <div className="diag-title">
                    <Terminal size={14} />
                    <span>Live Backend Terminal</span>
                    <span className={`diag-led ${enabled ? 'on' : 'off'}`} title={enabled ? 'Logging on' : 'Logging off'} />
                </div>
                <div className="diag-header-actions">
                    <button
                        className="diag-icon-btn"
                        onClick={(e) => { e.stopPropagation(); setMinimized(m => !m); }}
                        title={minimized ? 'Expand' : 'Minimize'}
                    >
                        <Minus size={14} />
                    </button>
                    <button
                        className="diag-icon-btn"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        title="Close terminal"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {!minimized && (
                <>
                    <div className="diag-toolbar">
                        <label className="diag-toggle">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => toggleEnabled(e.target.checked)}
                                title="Enable live logging"
                            />
                            <span>Logging</span>
                        </label>

                        <div className="diag-filter-group">
                            {(['all', 'llm', 'tts', 'services'] as Filter[]).map(value => (
                                <button
                                    key={value}
                                    className={`diag-filter-btn ${filter === value ? 'active' : ''}`}
                                    onClick={() => setFilter(value)}
                                >
                                    {value.toUpperCase()}
                                </button>
                            ))}
                        </div>

                        <div className="diag-spacer" />

                        <button
                            className="diag-icon-btn"
                            onClick={() => setPaused(p => !p)}
                            title={paused ? 'Resume autoscroll' : 'Pause autoscroll'}
                        >
                            {paused ? <Play size={14} /> : <Pause size={14} />}
                        </button>
                        <button className="diag-icon-btn" onClick={handleClear} title="Clear log">
                            <Trash2 size={14} />
                        </button>
                    </div>

                    <div className="diag-log" ref={logRef}>
                        {!enabled && (
                            <div className="diag-empty">
                                Logging is off. Toggle "Logging" above to start streaming TTS, LLM, and service events.
                            </div>
                        )}
                        {enabled && filtered.length === 0 && (
                            <div className="diag-empty">Waiting for activity...</div>
                        )}
                        {filtered.map(entry => (
                            <div key={entry.id} className={`diag-line level-${entry.level}`}>
                                <span className="diag-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                <span className="diag-source">[{entry.source}]</span>
                                <span className="diag-message">{entry.message}</span>
                            </div>
                        ))}
                    </div>

                    <div className="diag-resize-handle" onMouseDown={startResize} title="Resize" />
                </>
            )}
        </div>
    );
};

export default DiagnosticsTerminal;
