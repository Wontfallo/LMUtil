import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '../store/chatStore';
import { useTTSStore } from '../store/ttsStore';
import { useAppStore } from '../store/appStore';
import { useChatSettingsStore, SETTING_SECTIONS, SettingSection, DEFAULT_CHAT_SETTINGS, SAFE_DEFAULT_CONTEXT_LENGTH } from '../store/chatSettingsStore';
import {
    Bot,
    ChevronDown,
    ChevronRight,
    Sliders,
    MessageSquare,
    Volume2,
    User,
    Upload,
    Save,
    RotateCcw,
    Check,
    Wand2,
    X,
    Trash2,
    Play,
    Square,
    Scissors
} from 'lucide-react';

interface VoiceCloneProfile {
    id: string;
    name: string;
    audioPath: string;
    refText?: string;
    createdAt: string;
}

interface VoiceCloneDrawerProps {
    isOpen: boolean;
    cloneName: string;
    cloneRefText: string;
    cloneProfiles: VoiceCloneProfile[];
    selectedAudioName: string;
    selectedAudioBuffer: AudioBuffer | null;
    trimStart: number;
    trimDuration: number;
    playbackTime: number;
    isAudioPlaying: boolean;
    isCreatingClone: boolean;
    cloneStatus: string;
    onClose: () => void;
    onCloneNameChange: (value: string) => void;
    onCloneRefTextChange: (value: string) => void;
    onChooseAudio: () => void;
    onChooseTranscript: () => void;
    onTrimStartChange: (value: number) => void;
    onTrimDurationChange: (value: number) => void;
    onSeekAudio: (value: number) => void;
    onPlayFromCursor: () => void;
    onPlayTrim: () => void;
    onStopPlayback: () => void;
    onCreateCloneProfile: () => Promise<void>;
    onDeleteCloneProfile: (profileId: string) => Promise<void>;
}

const MAX_CLONE_REFERENCE_SECONDS = 30;

const formatSeconds = (seconds: number) => `${seconds.toFixed(1)}s`;

const encodeWavDataUrl = (buffer: AudioBuffer, startSeconds: number, durationSeconds: number): string => {
    const sampleRate = buffer.sampleRate;
    const startFrame = Math.max(0, Math.floor(startSeconds * sampleRate));
    const frameCount = Math.max(1, Math.min(buffer.length - startFrame, Math.floor(durationSeconds * sampleRate)));
    const channels = Math.min(2, buffer.numberOfChannels);
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const wavBuffer = new ArrayBuffer(44 + frameCount * blockAlign);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + frameCount * blockAlign, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, frameCount * blockAlign, true);

    let offset = 44;
    for (let i = 0; i < frameCount; i += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
            const sample = buffer.getChannelData(channel)[startFrame + i] || 0;
            const clamped = Math.max(-1, Math.min(1, sample));
            view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
            offset += bytesPerSample;
        }
    }

    const bytes = new Uint8Array(wavBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }

    return `data:audio/wav;base64,${btoa(binary)}`;
};

const WaveformCanvas: React.FC<{
    audioBuffer: AudioBuffer | null;
    trimStart: number;
    trimDuration: number;
    playbackTime: number;
    onSeek: (seconds: number) => void;
}> = ({ audioBuffer, trimStart, trimDuration, playbackTime, onSeek }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, width, height);

        if (!audioBuffer) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.font = '12px sans-serif';
            ctx.fillText('Choose audio to see the waveform', 18, height / 2 + 4);
            return;
        }

        const data = audioBuffer.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / width));
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.95)';
        ctx.beginPath();

        for (let x = 0; x < width; x += 1) {
            let min = 1;
            let max = -1;
            const offset = x * step;
            for (let i = 0; i < step; i += 1) {
                const sample = data[offset + i] || 0;
                min = Math.min(min, sample);
                max = Math.max(max, sample);
            }
            ctx.moveTo(x, (1 + min) * height / 2);
            ctx.lineTo(x, (1 + max) * height / 2);
        }
        ctx.stroke();

        const selectionX = (trimStart / audioBuffer.duration) * width;
        const selectionWidth = (trimDuration / audioBuffer.duration) * width;
        ctx.fillStyle = 'rgba(34, 211, 238, 0.18)';
        ctx.fillRect(selectionX, 0, selectionWidth, height);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.strokeRect(selectionX, 1, Math.max(2, selectionWidth), height - 2);

        const playheadX = (playbackTime / audioBuffer.duration) * width;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(playheadX, 10, 6, 0, Math.PI * 2);
        ctx.fill();
    }, [audioBuffer, trimStart, trimDuration, playbackTime]);

    const handleSeek = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !audioBuffer) return;
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        onSeek(ratio * audioBuffer.duration);
    };

    return (
        <canvas
            className="voice-clone-waveform"
            ref={canvasRef}
            width={520}
            height={190}
            onMouseDown={handleSeek}
            title="Click the waveform to move the playback cursor"
        />
    );
};

const VoiceCloneDrawer: React.FC<VoiceCloneDrawerProps> = ({
    isOpen,
    cloneName,
    cloneRefText,
    cloneProfiles,
    selectedAudioName,
    selectedAudioBuffer,
    trimStart,
    trimDuration,
    playbackTime,
    isAudioPlaying,
    isCreatingClone,
    cloneStatus,
    onClose,
    onCloneNameChange,
    onCloneRefTextChange,
    onChooseAudio,
    onChooseTranscript,
    onTrimStartChange,
    onTrimDurationChange,
    onSeekAudio,
    onPlayFromCursor,
    onPlayTrim,
    onStopPlayback,
    onCreateCloneProfile,
    onDeleteCloneProfile,
}) => {
    const duration = selectedAudioBuffer?.duration ?? 0;
    const maxTrimStart = Math.max(0, duration - trimDuration);
    const maxTrimDuration = Math.min(MAX_CLONE_REFERENCE_SECONDS, duration || MAX_CLONE_REFERENCE_SECONDS);

    if (!isOpen) return null;

    return createPortal(
        <div className="voice-clone-backdrop" onMouseDown={onClose}>
            <aside className="voice-clone-drawer" onMouseDown={(e) => e.stopPropagation()}>
                <div className="voice-clone-header">
                    <div>
                        <h2>Voice Clone Studio</h2>
                        <p>Pick any audio, trim the best 1-30 seconds, then save it as a reusable OmniVoice clone.</p>
                    </div>
                    <button className="icon-btn" onClick={onClose} title="Close voice clone studio">
                        <X size={18} />
                    </button>
                </div>

                <div className="voice-clone-grid">
                    <section className="voice-clone-card">
                        <h3>Reference Audio</h3>
                        <button className="section-btn reset-btn voice-clone-wide-btn" onClick={onChooseAudio}>
                            <Upload size={14} />
                            Choose audio
                        </button>
                        <div className="voice-clone-file">
                            {selectedAudioName || 'No audio selected yet'}
                            {duration > 0 && <span>{formatSeconds(duration)} loaded</span>}
                        </div>

                        <WaveformCanvas
                            audioBuffer={selectedAudioBuffer}
                            trimStart={trimStart}
                            trimDuration={trimDuration}
                            playbackTime={playbackTime}
                            onSeek={onSeekAudio}
                        />

                        <div className="voice-clone-transport">
                            <button className="section-btn reset-btn" onClick={onPlayFromCursor} disabled={!selectedAudioBuffer}>
                                <Play size={16} />
                                {isAudioPlaying ? 'Restart from cursor' : 'Play from cursor'}
                            </button>
                            <button className="section-btn reset-btn" onClick={onPlayTrim} disabled={!selectedAudioBuffer}>
                                <Scissors size={16} />
                                Play selected cut
                            </button>
                            <button className="section-btn reset-btn" onClick={onStopPlayback} disabled={!selectedAudioBuffer || !isAudioPlaying}>
                                <Square size={16} />
                                Stop
                            </button>
                        </div>
                        <div className="voice-clone-playhead">
                            Cursor: {formatSeconds(playbackTime)} / {formatSeconds(duration)}
                        </div>

                        <div className="voice-clone-slider">
                            <label>Start: {formatSeconds(trimStart)}</label>
                            <input
                                type="range"
                                min="0"
                                max={maxTrimStart}
                                step="0.1"
                                value={Math.min(trimStart, maxTrimStart)}
                                disabled={!selectedAudioBuffer}
                                onChange={(e) => onTrimStartChange(parseFloat(e.target.value))}
                            />
                        </div>
                        <div className="voice-clone-slider">
                            <label>Length: {formatSeconds(trimDuration)} (max 30s)</label>
                            <input
                                type="range"
                                min="1"
                                max={maxTrimDuration || MAX_CLONE_REFERENCE_SECONDS}
                                step="0.1"
                                value={Math.min(trimDuration, maxTrimDuration || trimDuration)}
                                disabled={!selectedAudioBuffer}
                                onChange={(e) => onTrimDurationChange(parseFloat(e.target.value))}
                            />
                        </div>
                    </section>

                    <section className="voice-clone-card">
                        <h3>Save Clone</h3>
                        <label className="voice-clone-label">Clone name</label>
                        <input
                            className="setting-input"
                            type="text"
                            value={cloneName}
                            onChange={(e) => onCloneNameChange(e.target.value)}
                            placeholder="e.g. Warm narrator"
                        />
                        <div className="voice-clone-label-row">
                            <label className="voice-clone-label">Reference transcript</label>
                            <button className="section-btn reset-btn voice-clone-small-btn" onClick={onChooseTranscript}>
                                <Upload size={14} />
                                Upload transcript
                            </button>
                        </div>
                        <textarea
                            className="system-prompt-textarea"
                            value={cloneRefText}
                            onChange={(e) => onCloneRefTextChange(e.target.value)}
                            placeholder="Paste the words spoken in the clip, or leave blank and click save to transcribe first"
                            rows={4}
                        />
                        <button
                            className="section-btn save-btn voice-clone-wide-btn"
                            onClick={onCreateCloneProfile}
                            disabled={!cloneName.trim() || !selectedAudioBuffer || isCreatingClone}
                        >
                            <Scissors size={14} />
                            {isCreatingClone ? 'Working...' : cloneRefText.trim() ? 'Trim and save clone' : 'Transcribe selected cut'}
                        </button>
                        {cloneStatus && <div className="voice-clone-status">{cloneStatus}</div>}
                    </section>
                </div>

                <section className="voice-clone-card voice-clone-existing">
                    <h3>Saved Clones</h3>
                    {cloneProfiles.length === 0 ? (
                        <p className="voice-clone-empty">No saved clones yet. Your new clone will appear here and in both voice pickers.</p>
                    ) : (
                        <div className="voice-clone-list">
                            {cloneProfiles.map((profile) => (
                                <div className="voice-clone-list-item" key={profile.id}>
                                    <div>
                                        <strong>{profile.name}</strong>
                                        <span>{profile.refText?.trim() || 'No transcript saved'}</span>
                                    </div>
                                    <button className="icon-btn danger" onClick={() => onDeleteCloneProfile(profile.id)} title={`Delete ${profile.name}`}>
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </aside>
        </div>,
        document.body
    );
};

const RightPanel: React.FC = () => {
    const { currentConversationId } = useChatStore();
    const { voices, loadVoices } = useTTSStore();
    const { model, models } = useAppStore();
    const selectedModelInfo = useMemo(() => models.find(m => m.id === model), [models, model]);
    const {
        current,
        original,
        isLoading,
        loadSettings,
        updateSetting,
        saveSection,
        resetSection,
        applyModelDefaults,
        clampContextToModel,
        isSectionChanged,
        isSettingChanged,
        isNonDefault,
    } = useChatSettingsStore();

    // Panel resize state
    const [panelWidth, setPanelWidth] = useState(380);
    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Collapsible sections - default some open
    const [openSections, setOpenSections] = useState<SettingSection[]>(['modelSettings', 'voiceSettings']);

    // Avatar drag state
    const [isDraggingAi, setIsDraggingAi] = useState(false);
    const [isDraggingUser, setIsDraggingUser] = useState(false);

    // Voice filter state - separate for AI and User
    // AI filters
    const [aiSex, setAiSex] = useState<'all' | 'Male' | 'Female'>('all');
    const [aiEnglishOnly, setAiEnglishOnly] = useState(true);
    // User filters
    const [userSex, setUserSex] = useState<'all' | 'Male' | 'Female'>('all');
    const [userEnglishOnly, setUserEnglishOnly] = useState(true);
    const [modelDefaultsApplied, setModelDefaultsApplied] = useState(false);
    const [isCloneDrawerOpen, setIsCloneDrawerOpen] = useState(false);
    const [cloneProfiles, setCloneProfiles] = useState<VoiceCloneProfile[]>([]);
    const [cloneName, setCloneName] = useState('');
    const [cloneRefText, setCloneRefText] = useState('');
    const [selectedCloneAudioName, setSelectedCloneAudioName] = useState('');
    const [selectedCloneAudioBuffer, setSelectedCloneAudioBuffer] = useState<AudioBuffer | null>(null);
    const [cloneTrimStart, setCloneTrimStart] = useState(0);
    const [cloneTrimDuration, setCloneTrimDuration] = useState(MAX_CLONE_REFERENCE_SECONDS);
    const [clonePlaybackTime, setClonePlaybackTime] = useState(0);
    const [isCloneAudioPlaying, setIsCloneAudioPlaying] = useState(false);
    const [isCreatingClone, setIsCreatingClone] = useState(false);
    const [cloneStatus, setCloneStatus] = useState('');
    const clonePlaybackRef = useRef<{
        context: AudioContext | null;
        source: AudioBufferSourceNode | null;
        rafId: number | null;
        startedAt: number;
        offset: number;
        stopAt: number | null;
    }>({
        context: null,
        source: null,
        rafId: null,
        startedAt: 0,
        offset: 0,
        stopAt: null,
    });

    // English-speaking regions
    const englishRegions = ['US', 'GB', 'AU', 'CA', 'IE', 'NZ'] as const;

    // Load settings when conversation changes
    useEffect(() => {
        if (currentConversationId) {
            loadSettings(currentConversationId);
        }
    }, [currentConversationId]);

    useEffect(() => {
        clampContextToModel(selectedModelInfo);
    }, [selectedModelInfo?.id, selectedModelInfo?.maxContext]);

    const loadCloneProfiles = async () => {
        try {
            const profiles = await window.ipcRenderer.listCloneProfiles();
            setCloneProfiles(Array.isArray(profiles) ? profiles : []);
        } catch (error) {
            console.error('[TTS] Failed to load clone profiles:', error);
        }
    };

    useEffect(() => {
        loadCloneProfiles();
    }, []);

    const stopClonePlayback = () => {
        const playback = clonePlaybackRef.current;
        if (playback.rafId !== null) {
            cancelAnimationFrame(playback.rafId);
            playback.rafId = null;
        }
        if (playback.source) {
            try {
                playback.source.onended = null;
                playback.source.stop();
            } catch {
                // Already stopped.
            }
            playback.source.disconnect();
            playback.source = null;
        }
        if (playback.context) {
            playback.context.close().catch(() => undefined);
            playback.context = null;
        }
        playback.stopAt = null;
        setIsCloneAudioPlaying(false);
    };

    useEffect(() => {
        return () => stopClonePlayback();
    }, []);

    // Filter voices for AI
    const filteredVoices = useMemo(() => {
        return voices.filter(voice => {
            if (voice.Type === 'clone') return true;
            // English only filter
            if (aiEnglishOnly && !voice.Locale.startsWith('en-')) return false;
            // Sex filter
            if (aiSex !== 'all' && voice.Gender !== aiSex) return false;
            // Region filter (only for English voices)
            if (current.aiRegion !== 'all' && !voice.Locale.includes(`-${current.aiRegion}`)) return false;
            return true;
        });
    }, [voices, aiSex, aiEnglishOnly, current.aiRegion]);

    // Filter voices for User (separate filters)
    const userFilteredVoices = useMemo(() => {
        return voices.filter(voice => {
            if (voice.Type === 'clone') return true;
            // English only filter
            if (userEnglishOnly && !voice.Locale.startsWith('en-')) return false;
            // Sex filter
            if (userSex !== 'all' && voice.Gender !== userSex) return false;
            // Region filter
            if (current.userRegion !== 'all' && !voice.Locale.includes(`-${current.userRegion}`)) return false;
            return true;
        });
    }, [voices, userSex, userEnglishOnly, current.userRegion]);

    const toggleSection = (section: SettingSection) => {
        setOpenSections(prev =>
            prev.includes(section)
                ? prev.filter(s => s !== section)
                : [...prev, section]
        );
    };

    // Resize handling
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing || !panelRef.current) return;
            const containerRect = panelRef.current.parentElement?.getBoundingClientRect();
            if (!containerRect) return;
            const newWidth = containerRect.right - e.clientX;
            setPanelWidth(Math.min(600, Math.max(200, newWidth)));
        };

        const handleMouseUp = () => setIsResizing(false);

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    // Avatar drag handling for AI
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingAi) return;
            const newPos = current.aiAvatarPosition - e.movementY * 0.5;
            updateSetting('aiAvatarPosition', Math.min(100, Math.max(0, newPos)));
        };
        const handleMouseUp = () => setIsDraggingAi(false);

        if (isDraggingAi) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingAi, current.aiAvatarPosition]);

    // Avatar drag handling for User
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingUser) return;
            const newPos = current.userAvatarPosition - e.movementY * 0.5;
            updateSetting('userAvatarPosition', Math.min(100, Math.max(0, newPos)));
        };
        const handleMouseUp = () => setIsDraggingUser(false);

        if (isDraggingUser) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingUser, current.userAvatarPosition]);

    const handleAvatarUpload = async (type: 'ai' | 'user') => {
        try {
            const result = await window.ipcRenderer.openDialog({
                properties: ['openFile'],
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
            });
            if (result && result.length > 0) {
                const filePath = result[0];

                // For AI avatar, try to parse as character card first
                if (type === 'ai') {
                    try {
                        const charData = await window.ipcRenderer.parseCharacterCard(filePath);

                        if (charData) {
                            // Reconstruct the system prompt from the raw JSON data
                            const v2 = charData as any;
                            const data = v2.data || v2;
                            const name = data.name || charData.name || 'Unknown';

                            const parts = [];
                            if (data.name) parts.push(`Name: ${data.name}`);
                            if (data.description) parts.push(`Description: ${data.description}`);
                            if (data.personality) parts.push(`Personality: ${data.personality}`);
                            if (data.scenario) parts.push(`Scenario: ${data.scenario}`);
                            if (data.mes_example) parts.push(`Example Dialogue:\n${data.mes_example}`);

                            let sysPrompt = parts.join('\n\n');
                            if (data.system_prompt) {
                                sysPrompt = `${data.system_prompt}\n\n${sysPrompt}`;
                            }

                            const confirmed = await window.ipcRenderer.confirmDialog({
                                title: 'Character Card Detected',
                                message: `Import "${name}"?`,
                                detail: 'This will update the Name, System Prompt, and Avatar.',
                                confirmLabel: 'Import',
                                cancelLabel: 'Cancel'
                            });

                            if (confirmed) {
                                const dataUrl = await window.ipcRenderer.readFileAsBase64(filePath);
                                updateSetting('aiName', name);
                                updateSetting('systemPrompt', sysPrompt);
                                updateSetting('aiAvatar', dataUrl);

                                // Explicitly focus the System Prompt textarea to restore input context
                                // This works around the renderer losing focus state after dialogs
                                setTimeout(() => {
                                    const sysPromptInput = document.querySelector('.system-prompt-textarea') as HTMLTextAreaElement;
                                    if (sysPromptInput) {
                                        sysPromptInput.focus();
                                        // Optional: move cursor to end to ensure "active" state
                                        const len = sysPromptInput.value.length;
                                        sysPromptInput.setSelectionRange(len, len);
                                    }
                                }, 100);
                                return;
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to parse character card via IPC:', e);
                    }
                }

                const dataUrl = await window.ipcRenderer.readFileAsBase64(filePath);
                updateSetting(type === 'ai' ? 'aiAvatar' : 'userAvatar', dataUrl);
            }
        } catch (error) {
            console.error('Failed to upload avatar:', error);
        }
    };

    // Get accent color based on whether setting differs from global default
    // Purple = default value, Cyan = non-default (customized)
    const getAccentClass = (key: string) => {
        return isNonDefault(key as any) ? 'modified' : '';
    };

    const modelContextSliderMax = Math.min(selectedModelInfo?.maxContext || SAFE_DEFAULT_CONTEXT_LENGTH, SAFE_DEFAULT_CONTEXT_LENGTH);
    const modelDefaultContext = selectedModelInfo?.loadedContextLength
        || Math.min(selectedModelInfo?.maxContext || DEFAULT_CHAT_SETTINGS.contextLength, SAFE_DEFAULT_CONTEXT_LENGTH);

    const handleApplyModelDefaults = async () => {
        applyModelDefaults(selectedModelInfo);
        await saveSection('modelSettings');
        setModelDefaultsApplied(true);
        window.setTimeout(() => setModelDefaultsApplied(false), 1800);
    };

    const handleChooseCloneAudio = async () => {
        try {
            const result = await window.ipcRenderer.openDialog({
                properties: ['openFile'],
                filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac'] }]
            });

            if (!result || result.length === 0) return;

            const filePath = result[0];
            const audioDataUrl = await window.ipcRenderer.readFileAsBase64(filePath);
            const response = await fetch(audioDataUrl);
            const arrayBuffer = await response.arrayBuffer();
            const audioContext = new AudioContext();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            await audioContext.close();

            const duration = audioBuffer.duration;
            const initialDuration = Math.min(MAX_CLONE_REFERENCE_SECONDS, Math.max(1, duration));
            setSelectedCloneAudioName(filePath.split(/[\\/]/).pop() || filePath);
            setSelectedCloneAudioBuffer(audioBuffer);
            setCloneTrimStart(0);
            setCloneTrimDuration(initialDuration);
            setClonePlaybackTime(0);
            setCloneStatus(`Loaded ${formatSeconds(duration)}. Pick the best ${formatSeconds(initialDuration)} reference window.`);
        } catch (error) {
            console.error('[TTS] Failed to load clone reference audio:', error);
            setCloneStatus(`Could not load that audio: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleSeekCloneAudio = (seconds: number) => {
        if (!selectedCloneAudioBuffer) return;
        const nextTime = Math.max(0, Math.min(selectedCloneAudioBuffer.duration, seconds));
        setClonePlaybackTime(nextTime);
        if (isCloneAudioPlaying) {
            playCloneAudio(nextTime);
        }
    };

    const playCloneAudio = (startSeconds: number, durationSeconds?: number) => {
        if (!selectedCloneAudioBuffer) return;

        stopClonePlayback();

        const safeStart = Math.max(0, Math.min(Math.max(0, selectedCloneAudioBuffer.duration - 0.01), startSeconds));
        const remaining = Math.max(0.01, selectedCloneAudioBuffer.duration - safeStart);
        const playDuration = Math.min(durationSeconds ?? remaining, remaining);
        const context = new AudioContext();
        const source = context.createBufferSource();
        source.buffer = selectedCloneAudioBuffer;
        source.connect(context.destination);

        const playback = clonePlaybackRef.current;
        playback.context = context;
        playback.source = source;
        playback.startedAt = context.currentTime;
        playback.offset = safeStart;
        playback.stopAt = safeStart + playDuration;

        const tick = () => {
            const active = clonePlaybackRef.current;
            if (!active.context) return;
            const elapsed = active.context.currentTime - active.startedAt;
            const nextTime = Math.min(active.offset + elapsed, active.stopAt ?? selectedCloneAudioBuffer.duration);
            setClonePlaybackTime(nextTime);
            if (active.stopAt !== null && nextTime >= active.stopAt) {
                stopClonePlayback();
                return;
            }
            active.rafId = requestAnimationFrame(tick);
        };

        source.onended = () => {
            stopClonePlayback();
        };

        setClonePlaybackTime(safeStart);
        setIsCloneAudioPlaying(true);
        source.start(0, safeStart, playDuration);
        playback.rafId = requestAnimationFrame(tick);
    };

    const handlePlayCloneFromCursor = () => {
        playCloneAudio(clonePlaybackTime);
    };

    const handlePlayCloneTrim = () => {
        playCloneAudio(cloneTrimStart, cloneTrimDuration);
    };

    const handleChooseCloneTranscript = async () => {
        try {
            const result = await window.ipcRenderer.openDialog({
                properties: ['openFile'],
                filters: [
                    { name: 'Transcript text', extensions: ['txt', 'md', 'srt', 'vtt', 'csv', 'json'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result || result.length === 0) return;

            const content = await window.ipcRenderer.readFile(result[0]);
            setCloneRefText(content.trim());
            setCloneStatus('Transcript loaded. You can edit it before saving the clone.');
        } catch (error) {
            console.error('[TTS] Failed to load clone transcript:', error);
            setCloneStatus(`Could not load transcript: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const handleCreateCloneProfile = async () => {
        if (!cloneName.trim() || isCreatingClone) return;
        if (!selectedCloneAudioBuffer) {
            setCloneStatus('Choose reference audio first.');
            return;
        }

        try {
            setIsCreatingClone(true);
            const trimmedAudioDataUrl = encodeWavDataUrl(selectedCloneAudioBuffer, cloneTrimStart, cloneTrimDuration);

            if (!cloneRefText.trim()) {
                setCloneStatus('Transcribing selected cut. Review the transcript, fix anything wrong, then click save again.');
                const transcript = await window.ipcRenderer.transcribeAudioData(trimmedAudioDataUrl);
                setCloneRefText(transcript);
                setCloneStatus(
                    transcript
                        ? 'Transcript generated. Please review/edit it, then click save again to create the clone.'
                        : 'Transcription returned empty text. Please type or upload the matching transcript before saving.'
                );
                return;
            }

            setCloneStatus('Trimming and saving clone...');
            const profile = await window.ipcRenderer.createCloneProfileFromAudioData(cloneName.trim(), trimmedAudioDataUrl, 'wav', cloneRefText);
            setCloneStatus(`Saved "${profile.name}". It is now available in the voice pickers.`);
            setCloneName('');
            setCloneRefText('');
            await loadCloneProfiles();
            await loadVoices();
        } catch (error) {
            console.error('[TTS] Failed to create clone profile:', error);
            setCloneStatus(`Failed to create voice clone: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsCreatingClone(false);
        }
    };

    const handleDeleteCloneProfile = async (profileId: string) => {
        try {
            await window.ipcRenderer.deleteCloneProfile(profileId);
            setCloneStatus('Deleted clone profile.');
            await loadCloneProfiles();
            await loadVoices();
        } catch (error) {
            console.error('[TTS] Failed to delete clone profile:', error);
            setCloneStatus(`Failed to delete clone: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Section header with unsaved indicator
    const SectionHeader = ({ section, title, icon: Icon }: { section: SettingSection; title: string; icon: any }) => (
        <button
            className="section-header"
            onClick={() => toggleSection(section)}
        >
            <span className="section-title">
                <Icon size={16} />
                {title}
                {isSectionChanged(section) && <span className="unsaved-indicator">*</span>}
            </span>
            {openSections.includes(section) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
    );

    // Section footer with save/reset buttons
    const SectionFooter = ({ section }: { section: SettingSection }) => (
        isSectionChanged(section) ? (
            <div className="section-footer">
                <button
                    className="section-btn reset-btn"
                    onClick={() => resetSection(section)}
                    title="Reset to saved values"
                >
                    <RotateCcw size={14} />
                    Reset
                </button>
                <button
                    className="section-btn save-btn"
                    onClick={() => saveSection(section)}
                    title="Save changes"
                >
                    <Save size={14} />
                    Save
                </button>
            </div>
        ) : null
    );

    if (!currentConversationId) {
        return (
            <div className="right-panel empty">
                <p>Select a conversation to view settings</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="right-panel loading">
                <div className="loading-spinner"></div>
            </div>
        );
    }

    return (
        <div
            ref={panelRef}
            className={`right-panel ${isResizing ? 'resizing' : ''}`}
            style={{ width: panelWidth }}
        >
            {/* Resize Handle */}
            <div
                className="resize-handle"
                onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
            />

            {/* AI Profile Header */}
            <div className="ai-profile-header">
                <div
                    className={`ai-avatar-large ${current.aiAvatar ? 'has-image' : ''} ${isDraggingAi ? 'dragging' : ''}`}
                    onMouseDown={(e) => { if (current.aiAvatar) { e.preventDefault(); setIsDraggingAi(true); } }}
                >
                    {current.aiAvatar ? (
                        <>
                            <img
                                src={current.aiAvatar}
                                alt="AI Avatar"
                                style={{ objectPosition: `center ${current.aiAvatarPosition}%` }}
                                draggable={false}
                            />
                            <button
                                className="avatar-change-btn"
                                onClick={(e) => { e.stopPropagation(); handleAvatarUpload('ai'); }}
                            >
                                <Upload size={14} />
                            </button>
                        </>
                    ) : (
                        <div className="avatar-placeholder" onClick={() => handleAvatarUpload('ai')}>
                            <Bot size={48} />
                            <span className="upload-hint">Click image or drop Character Card</span>
                        </div>
                    )}
                </div>

                <input
                    type="text"
                    className={`ai-name-input ${getAccentClass('aiName')}`}
                    value={current.aiName}
                    onChange={(e) => updateSetting('aiName', e.target.value)}
                    placeholder="AI Name"
                />

                <SectionFooter section="aiProfile" />
            </div>

            {/* Settings Sections */}
            <div className="panel-sections">
                {/* System Prompt Section */}
                <div className={`collapsible-section ${openSections.includes('systemPrompt') ? 'open' : ''}`}>
                    <SectionHeader section="systemPrompt" title="System Prompt" icon={MessageSquare} />
                    {openSections.includes('systemPrompt') && (
                        <div className="section-content">
                            <textarea
                                className={`system-prompt-textarea ${getAccentClass('systemPrompt')}`}
                                value={current.systemPrompt}
                                onChange={(e) => updateSetting('systemPrompt', e.target.value)}
                                placeholder="Enter system prompt..."
                                rows={4}
                            />
                            <SectionFooter section="systemPrompt" />
                        </div>
                    )}
                </div>

                {/* Model Settings Section */}
                <div className={`collapsible-section ${openSections.includes('modelSettings') ? 'open' : ''}`}>
                    <SectionHeader section="modelSettings" title="Model Settings" icon={Sliders} />
                    {openSections.includes('modelSettings') && (
                        <div className="section-content">
                            {selectedModelInfo && (
                                <div className="setting-row">
                                    <label>Selected Model</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', opacity: 0.75 }}>
                                        <span>{selectedModelInfo.name}</span>
                                        <span>
                                            {[selectedModelInfo.paramsString, selectedModelInfo.quantization, selectedModelInfo.architecture]
                                                .filter(Boolean)
                                                .join(' | ') || 'Metadata unavailable'}
                                        </span>
                                        <span>
                                            Max context: {selectedModelInfo.maxContext || 'unknown'}
                                            {selectedModelInfo.loadedContextLength ? ` | Loaded: ${selectedModelInfo.loadedContextLength}` : ''}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div className="model-defaults-action">
                                <button
                                    className="section-btn reset-btn"
                                    onClick={handleApplyModelDefaults}
                                    title={`Use model-aware defaults. Context will become ${modelDefaultContext}.`}
                                >
                                    <Wand2 size={14} />
                                    Apply model defaults
                                </button>
                                {modelDefaultsApplied && (
                                    <span className="model-defaults-applied">
                                        <Check size={13} />
                                        Applied and saved
                                    </span>
                                )}
                            </div>
                            <div className={`setting-row ${getAccentClass('temperature')}`}>
                                <label>Temperature: {current.temperature.toFixed(1)}</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={current.temperature}
                                    onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
                                />
                            </div>
                            <div className={`setting-row ${getAccentClass('maxTokens')}`}>
                                <label>Max Tokens: {current.maxTokens}</label>
                                <input
                                    type="range"
                                    min="256"
                                    max="8192"
                                    step="256"
                                    value={current.maxTokens}
                                    onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
                                />
                            </div>
                            <div className={`setting-row ${getAccentClass('contextLength')}`}>
                                <label>
                                    Context Length: {current.contextLength}
                                    {selectedModelInfo?.maxContext && (
                                        <span style={{ marginLeft: 8, opacity: 0.6, fontSize: '0.85em', fontWeight: 'normal' }}>
                                            (Model max: {selectedModelInfo.maxContext}, app cap: {modelContextSliderMax})
                                        </span>
                                    )}
                                </label>
                                <input
                                    type="range"
                                    min="1024"
                                    max={modelContextSliderMax}
                                    step="1024"
                                    value={Math.min(current.contextLength, modelContextSliderMax)}
                                    onChange={(e) => updateSetting('contextLength', parseInt(e.target.value))}
                                />
                            </div>
                            <div className={`setting-row ${getAccentClass('topK')}`}>
                                <label>Top K: {current.topK}</label>
                                <input
                                    type="range"
                                    min="1"
                                    max="100"
                                    step="1"
                                    value={current.topK}
                                    onChange={(e) => updateSetting('topK', parseInt(e.target.value))}
                                />
                            </div>
                            <div className={`setting-row ${getAccentClass('topP')}`}>
                                <label>Top P: {current.topP.toFixed(2)}</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={current.topP}
                                    onChange={(e) => updateSetting('topP', parseFloat(e.target.value))}
                                />
                            </div>
                            <div className={`setting-row ${getAccentClass('repeatPenalty')}`}>
                                <label>Repeat Penalty: {current.repeatPenalty.toFixed(1)}</label>
                                <input
                                    type="range"
                                    min="1"
                                    max="2"
                                    step="0.1"
                                    value={current.repeatPenalty}
                                    onChange={(e) => updateSetting('repeatPenalty', parseFloat(e.target.value))}
                                />
                            </div>
                            <div className={`setting-row ${getAccentClass('thinkingMode')}`}>
                                <label>Thinking Mode</label>
                                <select
                                    className="filter-select"
                                    value={current.thinkingMode}
                                    onChange={(e) => updateSetting('thinkingMode', e.target.value as 'auto' | 'no_think' | 'think')}
                                >
                                    <option value="no_think">No Think</option>
                                    <option value="auto">Auto</option>
                                    <option value="think">Think</option>
                                </select>
                            </div>
                            <SectionFooter section="modelSettings" />
                        </div>
                    )}
                </div>

                {/* Voice Settings Section */}
                <div className={`collapsible-section ${openSections.includes('voiceSettings') ? 'open' : ''}`}>
                    <SectionHeader section="voiceSettings" title="Voice Settings" icon={Volume2} />
                    {openSections.includes('voiceSettings') && (
                        <div className="section-content">
                            {/* Sex toggle */}
                            <div className="setting-row">
                                <label>Sex</label>
                                <div className="toggle-buttons">
                                    <button
                                        className={aiSex === 'Male' ? 'active' : ''}
                                        onClick={() => setAiSex(aiSex === 'Male' ? 'all' : 'Male')}
                                    >M</button>
                                    <button
                                        className={aiSex === 'Female' ? 'active' : ''}
                                        onClick={() => setAiSex(aiSex === 'Female' ? 'all' : 'Female')}
                                    >F</button>
                                </div>
                            </div>
                            {/* English Only toggle */}
                            <div className="setting-row toggle">
                                <label>English Only</label>
                                <input
                                    type="checkbox"
                                    checked={aiEnglishOnly}
                                    onChange={(e) => setAiEnglishOnly(e.target.checked)}
                                />
                            </div>
                            {/* Region dropdown */}
                            <div className="setting-row">
                                <label>Region</label>
                                <select
                                    className="filter-select"
                                    value={current.aiRegion}
                                    onChange={(e) => updateSetting('aiRegion', e.target.value)}
                                >
                                    <option value="all">All</option>
                                    {englishRegions.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>


                            <div className={`setting-row ${getAccentClass('aiVoice')}`}>
                                <label>AI Voice</label>
                                <select
                                    className="voice-select"
                                    value={current.aiVoice}
                                    onChange={(e) => updateSetting('aiVoice', e.target.value)}
                                >
                                    <option value="">Default</option>
                                    {filteredVoices.map(v => (
                                        <option key={v.ShortName} value={v.ShortName}>
                                            {v.FriendlyName}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className={`setting-row ${getAccentClass('aiRate')}`}>
                                <label>Speed: {current.aiRate}</label>
                                <input
                                    type="range"
                                    min="-50"
                                    max="50"
                                    step="5"
                                    value={parseInt(current.aiRate || '0')}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateSetting('aiRate', `${val > 0 ? '+' : ''}${val}%`);
                                    }}
                                />
                            </div>

                            <div className={`setting-row ${getAccentClass('aiPitch')}`}>
                                <label>Pitch: {current.aiPitch}</label>
                                <input
                                    type="range"
                                    min="-20"
                                    max="20"
                                    step="1"
                                    value={parseInt(current.aiPitch || '0')}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateSetting('aiPitch', `${val > 0 ? '+' : ''}${val}Hz`);
                                    }}
                                />
                            </div>

                            <div className={`setting-row ${getAccentClass('ttsChunkTarget')}`}>
                                <label>TTS Chunk Target: {current.ttsChunkTarget} chars</label>
                                <input
                                    type="range"
                                    min="160"
                                    max="900"
                                    step="20"
                                    value={current.ttsChunkTarget}
                                    onChange={(e) => updateSetting('ttsChunkTarget', parseInt(e.target.value))}
                                />
                            </div>

                            <div className={`setting-row toggle ${getAccentClass('autoPlay')}`}>
                                <label>Auto-play AI responses</label>
                                <input
                                    type="checkbox"
                                    checked={current.autoPlay}
                                    onChange={(e) => updateSetting('autoPlay', e.target.checked)}
                                />
                            </div>

                            <div className="setting-row">
                                <label>Voice Clones</label>
                                <button className="section-btn reset-btn voice-clone-wide-btn" onClick={() => setIsCloneDrawerOpen(true)}>
                                    <Scissors size={14} />
                                    Open voice clone studio
                                </button>
                                <span className="voice-clone-inline-hint">
                                    {cloneProfiles.length} saved clone{cloneProfiles.length === 1 ? '' : 's'} available in this picker.
                                </span>
                            </div>

                            <SectionFooter section="voiceSettings" />
                        </div>
                    )}
                </div>

                {/* User Persona Section */}
                <div className={`collapsible-section ${openSections.includes('userPersona') ? 'open' : ''}`}>
                    <SectionHeader section="userPersona" title="User Persona" icon={User} />
                    {openSections.includes('userPersona') && (
                        <div className="section-content">
                            {/* User Avatar */}
                            <div className="user-avatar-row">
                                <div
                                    className={`user-avatar ${current.userAvatar ? 'has-image' : ''} ${isDraggingUser ? 'dragging' : ''}`}
                                    onMouseDown={(e) => { if (current.userAvatar) { e.preventDefault(); setIsDraggingUser(true); } }}
                                >
                                    {current.userAvatar ? (
                                        <img
                                            src={current.userAvatar}
                                            alt="User Avatar"
                                            style={{ objectPosition: `center ${current.userAvatarPosition}%` }}
                                            draggable={false}
                                        />
                                    ) : (
                                        <div className="avatar-placeholder small" onClick={() => handleAvatarUpload('user')}>
                                            <User size={24} />
                                        </div>
                                    )}
                                </div>
                                <button
                                    className="upload-btn"
                                    onClick={() => handleAvatarUpload('user')}
                                >
                                    <Upload size={14} />
                                    Upload
                                </button>
                            </div>

                            <div className={`setting-row ${getAccentClass('userName')}`}>
                                <label>Your Name</label>
                                <input
                                    type="text"
                                    className="setting-input"
                                    value={current.userName}
                                    onChange={(e) => updateSetting('userName', e.target.value)}
                                    placeholder="Your name"
                                />
                            </div>

                            <div className={`setting-row ${getAccentClass('userPersona')}`}>
                                <label>Persona Description</label>
                                <textarea
                                    className="persona-textarea"
                                    value={current.userPersona}
                                    onChange={(e) => updateSetting('userPersona', e.target.value)}
                                    placeholder="Describe yourself to the AI..."
                                    rows={3}
                                />
                            </div>

                            {/* User Voice Filters */}
                            <div className="setting-row">
                                <label>Sex</label>
                                <div className="toggle-buttons">
                                    <button
                                        className={userSex === 'Male' ? 'active' : ''}
                                        onClick={() => setUserSex(userSex === 'Male' ? 'all' : 'Male')}
                                    >M</button>
                                    <button
                                        className={userSex === 'Female' ? 'active' : ''}
                                        onClick={() => setUserSex(userSex === 'Female' ? 'all' : 'Female')}
                                    >F</button>
                                </div>
                            </div>
                            <div className="setting-row toggle">
                                <label>English Only</label>
                                <input
                                    type="checkbox"
                                    checked={userEnglishOnly}
                                    onChange={(e) => setUserEnglishOnly(e.target.checked)}
                                />
                            </div>
                            <div className="setting-row">
                                <label>Region</label>
                                <select
                                    className="filter-select"
                                    value={current.userRegion}
                                    onChange={(e) => updateSetting('userRegion', e.target.value)}
                                >
                                    <option value="all">All</option>
                                    {englishRegions.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>

                            <div className={`setting-row ${getAccentClass('userVoice')}`}>
                                <label>Your Voice</label>
                                <select
                                    className="voice-select"
                                    value={current.userVoice}
                                    onChange={(e) => updateSetting('userVoice', e.target.value)}
                                >
                                    <option value="">Default</option>
                                    {userFilteredVoices.map(v => (
                                        <option key={v.ShortName} value={v.ShortName}>
                                            {v.FriendlyName}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className={`setting-row ${getAccentClass('userRate')}`}>
                                <label>Speed: {current.userRate}</label>
                                <input
                                    type="range"
                                    min="-50"
                                    max="50"
                                    step="5"
                                    value={parseInt(current.userRate || '0')}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateSetting('userRate', `${val > 0 ? '+' : ''}${val}%`);
                                    }}
                                />
                            </div>

                            <div className={`setting-row ${getAccentClass('userPitch')}`}>
                                <label>Pitch: {current.userPitch}</label>
                                <input
                                    type="range"
                                    min="-20"
                                    max="20"
                                    step="1"
                                    value={parseInt(current.userPitch || '0')}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        updateSetting('userPitch', `${val > 0 ? '+' : ''}${val}Hz`);
                                    }}
                                />
                            </div>

                            <div className={`setting-row toggle ${getAccentClass('userAutoPlay')}`}>
                                <label>Auto-play your messages</label>
                                <input
                                    type="checkbox"
                                    checked={current.userAutoPlay}
                                    onChange={(e) => updateSetting('userAutoPlay', e.target.checked)}
                                />
                            </div>

                            <div className="setting-row">
                                <label>Voice Clones</label>
                                <button className="section-btn reset-btn voice-clone-wide-btn" onClick={() => setIsCloneDrawerOpen(true)}>
                                    <Scissors size={14} />
                                    Open voice clone studio
                                </button>
                                <span className="voice-clone-inline-hint">
                                    {cloneProfiles.length} saved clone{cloneProfiles.length === 1 ? '' : 's'} available in this picker.
                                </span>
                            </div>

                            <SectionFooter section="userPersona" />
                        </div>
                    )}
                </div>
            </div>

            <VoiceCloneDrawer
                isOpen={isCloneDrawerOpen}
                cloneName={cloneName}
                cloneRefText={cloneRefText}
                cloneProfiles={cloneProfiles}
                selectedAudioName={selectedCloneAudioName}
                selectedAudioBuffer={selectedCloneAudioBuffer}
                trimStart={cloneTrimStart}
                trimDuration={cloneTrimDuration}
                playbackTime={clonePlaybackTime}
                isAudioPlaying={isCloneAudioPlaying}
                isCreatingClone={isCreatingClone}
                cloneStatus={cloneStatus}
                onClose={() => setIsCloneDrawerOpen(false)}
                onCloneNameChange={setCloneName}
                onCloneRefTextChange={setCloneRefText}
                onChooseAudio={handleChooseCloneAudio}
                onChooseTranscript={handleChooseCloneTranscript}
                onTrimStartChange={(value) => {
                    const nextStart = Math.max(0, value);
                    setCloneTrimStart(nextStart);
                    setClonePlaybackTime(nextStart);
                }}
                onTrimDurationChange={(value) => {
                    const duration = selectedCloneAudioBuffer?.duration ?? MAX_CLONE_REFERENCE_SECONDS;
                    const nextDuration = Math.min(MAX_CLONE_REFERENCE_SECONDS, Math.max(1, value));
                    setCloneTrimDuration(nextDuration);
                    setCloneTrimStart((currentStart) => Math.min(currentStart, Math.max(0, duration - nextDuration)));
                }}
                onSeekAudio={handleSeekCloneAudio}
                onPlayFromCursor={handlePlayCloneFromCursor}
                onPlayTrim={handlePlayCloneTrim}
                onStopPlayback={stopClonePlayback}
                onCreateCloneProfile={handleCreateCloneProfile}
                onDeleteCloneProfile={handleDeleteCloneProfile}
            />
        </div >
    );
};

export default RightPanel;
