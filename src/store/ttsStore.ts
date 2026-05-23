import { create } from 'zustand';
import { useChatSettingsStore } from './chatSettingsStore';

interface Voice {
    ShortName: string;
    FriendlyName: string;
    Locale: string;
    Gender: string;
    Type?: 'preset' | 'clone';
}

interface QueuedAudio {
    url: string;
    revokeAfterPlayback: boolean;
}

interface TTSState {
    isEnabled: boolean;
    voices: Voice[];
    selectedVoice: string;
    rate: string;
    pitch: string;

    // Playback state
    audioPlayer: HTMLAudioElement | null;
    isPlaying: boolean;
    isPaused: boolean;
    currentMessageId: string | null;
    audioQueue: QueuedAudio[];
    isProcessingQueue: boolean;
    generationSession: number;
    pendingSynthesisCount: number;
    isSynthesisInFlight: boolean;
    ttsWarning: string | null;

    setEnabled: (enabled: boolean) => void;
    setVoice: (voice: string) => void;
    setRate: (rate: string) => void;
    setPitch: (pitch: string) => void;
    loadVoices: () => Promise<void>;

    play: (text: string, messageId: string, isAiMessage?: boolean) => Promise<void>;

    // Low-latency streaming methods
    addToQueue: (text: string, messageId: string, isAiMessage?: boolean, options?: QueuedTTSOptions) => Promise<void>;
    clearQueue: () => void;
    clearWarning: () => void;

    pause: () => void;
    resume: () => void;
    stop: () => void;
}

export const useTTSStore = create<TTSState>((set, get) => ({
    isEnabled: true,
    voices: [],
    selectedVoice: 'alloy',
    rate: '+0%',
    pitch: '+0Hz',

    // Playback state
    audioPlayer: null,
    isPlaying: false,
    isPaused: false,
    currentMessageId: null,
    audioQueue: [],
    isProcessingQueue: false,
    generationSession: 0,
    pendingSynthesisCount: 0,
    isSynthesisInFlight: false,
    ttsWarning: null,

    setEnabled: (enabled) => set({ isEnabled: enabled }),
    setVoice: (voice) => set({ selectedVoice: voice }),
    setRate: (rate) => set({ rate: rate }),
    setPitch: (pitch) => set({ pitch: pitch }),

    loadVoices: async () => {
        try {
            const result = await window.ipcRenderer.listVoices();
            const voices = Array.isArray(result) ? result : [];
            set({ voices });
            if (voices.length > 0 && !get().selectedVoice) {
                set({ selectedVoice: voices[0].ShortName });
            }
        } catch (err) {
            console.error('[TTSStore] Failed to load voices:', err);
            set({ voices: [] });
        }
    },

    play: async (text, messageId, isAiMessage = true) => {
        get().stop(); // Clear any existing queue
        await get().addToQueue(text, messageId, isAiMessage);
    },

    addToQueue: async (text, messageId, isAiMessage = true, options) => {
        const { isEnabled, generationSession } = get();
        if (!isEnabled || !text.trim()) return;

        await enqueueAudioGeneration({
            text: text.trim(),
            messageId,
            isAiMessage,
            session: generationSession,
            options
        });
    },

    clearQueue: () => {
        set({ audioQueue: [], isProcessingQueue: false, pendingSynthesisCount: 0, isSynthesisInFlight: false, ttsWarning: null });
        synthesisQueue = [];
        synthesisInFlight = false;
        clearSynthesisPressureTimer();
    },

    clearWarning: () => set({ ttsWarning: null }),

    pause: () => {
        const { audioPlayer } = get();
        if (audioPlayer) {
            audioPlayer.pause();
            set({ isPaused: true }); // Keep isPlaying true to denote we aren't "stopped"
        }
    },

    resume: () => {
        const { audioPlayer } = get();
        if (audioPlayer) {
            audioPlayer.play();
            set({ isPaused: false });
        } else if (get().audioQueue.length > 0) {
            processQueue();
        }
    },

    stop: () => {
        const { audioPlayer, audioQueue } = get();
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            audioPlayer.src = '';
        }
        audioQueue.forEach(revokeQueuedAudio);
        set({
            audioPlayer: null,
            isPlaying: false,
            isPaused: false,
            currentMessageId: null,
            audioQueue: [],
            isProcessingQueue: false,
            generationSession: get().generationSession + 1,
            pendingSynthesisCount: 0,
            isSynthesisInFlight: false,
            ttsWarning: null
        });
        synthesisQueue = [];
        synthesisInFlight = false;
        clearSynthesisPressureTimer();
        window.ipcRenderer.cancelTTS();
        window.ipcRenderer.cleanupTTS();
    }
}));

interface PendingSynthesisRequest {
    text: string;
    messageId: string;
    isAiMessage: boolean;
    session: number;
    options?: QueuedTTSOptions;
}

interface QueuedTTSOptions {
    voice?: string;
    rate?: string;
    pitch?: string;
}

function base64ToBlobUrl(audioBase64: string, mimeType: string): string {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
}

function revokeQueuedAudio(item: QueuedAudio | null | undefined) {
    if (item?.revokeAfterPlayback) {
        URL.revokeObjectURL(item.url);
    }
}

let synthesisQueue: PendingSynthesisRequest[] = [];
let synthesisInFlight = false;
let synthesisPressureTimer: number | null = null;
const TTS_STATUS_NOTICE_MS = 20_000;

function clearSynthesisPressureTimer() {
    if (synthesisPressureTimer !== null) {
        window.clearTimeout(synthesisPressureTimer);
        synthesisPressureTimer = null;
    }
}

function armSynthesisPressureTimer(request: PendingSynthesisRequest) {
    clearSynthesisPressureTimer();
    synthesisPressureTimer = window.setTimeout(() => {
        const state = useTTSStore.getState();
        if (request.session !== state.generationSession || !state.isSynthesisInFlight) {
            return;
        }

        useTTSStore.setState({
            ttsWarning: 'Voice generation is taking longer than expected. OmniVoice may still be starting, busy, or waiting for GPU memory. Open Runtime Diagnostics in Settings for live backend details, or use Oh Shit to reset voice/model processes.'
        });
    }, TTS_STATUS_NOTICE_MS);
}

const enqueueAudioGeneration = async (request: PendingSynthesisRequest) => {
    synthesisQueue.push(request);
    useTTSStore.setState({
        pendingSynthesisCount: synthesisQueue.length + (synthesisInFlight ? 1 : 0)
    });
    await processSynthesisQueue();
};

const processSynthesisQueue = async () => {
    if (synthesisInFlight) return;

    synthesisInFlight = true;

    try {
        while (synthesisQueue.length > 0) {
            const request = synthesisQueue.shift()!;
            const store = useTTSStore.getState();

            if (request.session !== store.generationSession) {
                continue;
            }

            useTTSStore.setState({
                pendingSynthesisCount: synthesisQueue.length + 1,
                isSynthesisInFlight: true,
                ttsWarning: null
            });

            const selectedVoice = store.selectedVoice;

            // Get per-chat voice settings
            const chatSettings = useChatSettingsStore.getState().current;
            const aiVoice = chatSettings.aiVoice;
            const userVoice = chatSettings.userVoice;

            const normalizeRate = (rate: string | undefined): string => {
                if (!rate) return '+0%';
                if (!rate.startsWith('+') && !rate.startsWith('-')) {
                    return '+' + rate;
                }
                return rate;
            };

            const normalizePitch = (pitch: string | undefined): string => {
                if (!pitch) return '+0Hz';
                if (!pitch.startsWith('+') && !pitch.startsWith('-')) {
                    return '+' + pitch;
                }
                return pitch;
            };

            const aiRate = normalizeRate(chatSettings.aiRate);
            const aiPitch = normalizePitch(chatSettings.aiPitch);
            const userRate = normalizeRate(chatSettings.userRate);
            const userPitch = normalizePitch(chatSettings.userPitch);

            const voiceToUse = request.options?.voice || (request.isAiMessage ? (aiVoice || selectedVoice) : (userVoice || selectedVoice));
            const rateToUse = request.options?.rate || (request.isAiMessage ? aiRate : userRate);
            const pitchToUse = request.options?.pitch || (request.isAiMessage ? aiPitch : userPitch);

            console.log(`[TTS] Generating ordered chunk: "${request.text.substring(0, 40)}..." Voice: ${voiceToUse}`);

            try {
                armSynthesisPressureTimer(request);
                const payload = await window.ipcRenderer.speak(request.text, voiceToUse, rateToUse, pitchToUse);
                clearSynthesisPressureTimer();
                const latestState = useTTSStore.getState();

                if (request.session !== latestState.generationSession) {
                    continue;
                }

                const audioUrl = base64ToBlobUrl(payload.audioBase64, payload.mimeType);

                useTTSStore.setState(state => ({
                    audioQueue: [...state.audioQueue, { url: audioUrl, revokeAfterPlayback: true }],
                    currentMessageId: request.messageId
                }));

                console.log(`[TTS] Audio chunk queued. Queue length: ${useTTSStore.getState().audioQueue.length}`);

                if (!useTTSStore.getState().isProcessingQueue) {
                    processQueue();
                }
            } catch (error) {
                clearSynthesisPressureTimer();
                console.error('[TTS] Queue generation error:', error);
                const latestState = useTTSStore.getState();
                if (request.session === latestState.generationSession) {
                    useTTSStore.setState({
                        ttsWarning: `Voice generation failed: ${error instanceof Error ? error.message : String(error)}. Open Runtime Diagnostics in Settings for details.`
                    });
                }
            } finally {
                const latestState = useTTSStore.getState();
                if (request.session === latestState.generationSession) {
                    useTTSStore.setState({
                        pendingSynthesisCount: synthesisQueue.length,
                        isSynthesisInFlight: synthesisQueue.length > 0
                    });
                }
            }
        }
    } finally {
        synthesisInFlight = false;
        clearSynthesisPressureTimer();
        useTTSStore.setState({
            pendingSynthesisCount: 0,
            isSynthesisInFlight: false
        });
    }
};

// Helper to process the queue sequentially
const processQueue = async () => {
    const store = useTTSStore.getState();
    const { audioQueue, isPaused } = store;

    if (audioQueue.length === 0 || isPaused) {
        useTTSStore.setState({ isProcessingQueue: false, isPlaying: false });
        return;
    }

    useTTSStore.setState({ isProcessingQueue: true, isPlaying: true });

    const nextAudio = audioQueue[0];
    const audio = new Audio(nextAudio.url);
    audio.preload = 'auto';

    useTTSStore.setState({ audioPlayer: audio }); // Store ref for pause/stop

    audio.onended = () => {
        revokeQueuedAudio(nextAudio);
        // Remove played item
        useTTSStore.setState(state => ({
            audioQueue: state.audioQueue.slice(1)
        }));
        // Process next
        processQueue();
    };

    audio.onerror = () => {
        console.error('[TTS] Audio element decode error:', audio.error);
        revokeQueuedAudio(nextAudio);
        useTTSStore.setState(state => ({
            audioQueue: state.audioQueue.slice(1)
        }));
        processQueue();
    };

    try {
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                audio.oncanplaythrough = null;
                audio.onloadeddata = null;
            };

            audio.oncanplaythrough = () => {
                cleanup();
                resolve();
            };

            audio.onloadeddata = () => {
                cleanup();
                resolve();
            };

            setTimeout(() => {
                cleanup();
                resolve();
            }, 1500);
        });

        await audio.play();
        useTTSStore.setState({ isPaused: false });
    } catch (e) {
        console.error('[TTS] Playback error:', e);
        revokeQueuedAudio(nextAudio);
        // Skip this chunk if it fails
        useTTSStore.setState(state => ({
            audioQueue: state.audioQueue.slice(1)
        }));
        processQueue();
    }
};
