import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

type OmniGender = 'Male' | 'Female' | 'Unknown';

interface Voice {
    ShortName: string;
    FriendlyName: string;
    Locale: string;
    Gender: OmniGender;
    Type?: 'preset' | 'clone';
}

export interface VoiceCloneProfile {
    id: string;
    name: string;
    audioPath: string;
    refText: string;
    createdAt: string;
}

interface OmniPreset {
    id: string;
    friendlyName: string;
    locale: string;
    gender: Exclude<OmniGender, 'Unknown'>;
    age: string;
    pitch: string;
    accent: string;
}

interface OmniVoiceResponse {
    voices?: Array<{
        id?: string;
        type?: string;
        description?: string;
    }>;
}

export interface TTSAudioPayload {
    audioBase64: string;
    mimeType: string;
}

const OMNI_PRESETS: Record<string, OmniPreset> = {
    alloy: { id: 'alloy', friendlyName: 'Alloy', locale: 'en-US', gender: 'Female', age: 'young adult', pitch: 'moderate pitch', accent: 'american accent' },
    ash: { id: 'ash', friendlyName: 'Ash', locale: 'en-US', gender: 'Male', age: 'young adult', pitch: 'low pitch', accent: 'american accent' },
    ballad: { id: 'ballad', friendlyName: 'Ballad', locale: 'en-GB', gender: 'Male', age: 'middle-aged', pitch: 'low pitch', accent: 'british accent' },
    cedar: { id: 'cedar', friendlyName: 'Cedar', locale: 'en-US', gender: 'Male', age: 'middle-aged', pitch: 'low pitch', accent: 'american accent' },
    coral: { id: 'coral', friendlyName: 'Coral', locale: 'en-AU', gender: 'Female', age: 'young adult', pitch: 'high pitch', accent: 'australian accent' },
    echo: { id: 'echo', friendlyName: 'Echo', locale: 'en-CA', gender: 'Male', age: 'middle-aged', pitch: 'moderate pitch', accent: 'canadian accent' },
    fable: { id: 'fable', friendlyName: 'Fable', locale: 'en-GB', gender: 'Female', age: 'middle-aged', pitch: 'moderate pitch', accent: 'british accent' },
    marin: { id: 'marin', friendlyName: 'Marin', locale: 'en-CA', gender: 'Female', age: 'middle-aged', pitch: 'moderate pitch', accent: 'canadian accent' },
    nova: { id: 'nova', friendlyName: 'Nova', locale: 'en-US', gender: 'Female', age: 'young adult', pitch: 'high pitch', accent: 'american accent' },
    onyx: { id: 'onyx', friendlyName: 'Onyx', locale: 'en-GB', gender: 'Male', age: 'middle-aged', pitch: 'very low pitch', accent: 'british accent' },
    sage: { id: 'sage', friendlyName: 'Sage', locale: 'en-GB', gender: 'Female', age: 'elderly', pitch: 'low pitch', accent: 'british accent' },
    shimmer: { id: 'shimmer', friendlyName: 'Shimmer', locale: 'en-US', gender: 'Female', age: 'young adult', pitch: 'very high pitch', accent: 'american accent' },
    verse: { id: 'verse', friendlyName: 'Verse', locale: 'en-GB', gender: 'Male', age: 'young adult', pitch: 'moderate pitch', accent: 'british accent' }
};

const EDGE_VOICE_FALLBACKS: Record<string, string> = {
    'en-US-AndrewNeural': 'ash',
    'en-US-AriaNeural': 'nova'
};

const DEFAULT_VOICE_ID = 'alloy';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8880';
const REQUEST_TIMEOUT_MS = 600_000;
const SERVER_READY_TIMEOUT_MS = 180_000;
const DEFAULT_NUM_STEP = 16;

function formatFriendlyName(preset: OmniPreset): string {
    return `${preset.friendlyName} (${preset.gender}, ${preset.locale})`;
}

function presetToVoice(preset: OmniPreset): Voice {
    return {
        ShortName: preset.id,
        FriendlyName: formatFriendlyName(preset),
        Locale: preset.locale,
        Gender: preset.gender,
        Type: 'preset'
    };
}

function createLocalVoiceList(): Voice[] {
    return Object.values(OMNI_PRESETS)
        .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName))
        .map(presetToVoice);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseNumericSetting(value: string, unit: string): number {
    const normalized = value.trim().replace(unit, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function rateToSpeed(rate: string): number {
    const percentage = parseNumericSetting(rate, '%');
    const speed = 1 + (percentage / 100);
    return Math.round(clamp(speed, 0.25, 4.0) * 100) / 100;
}

function pitchToDescriptor(pitch: string): string {
    const hz = parseNumericSetting(pitch, 'Hz');

    if (hz <= -12) return 'very low pitch';
    if (hz <= -4) return 'low pitch';
    if (hz >= 12) return 'very high pitch';
    if (hz >= 4) return 'high pitch';
    return 'moderate pitch';
}

function localeToFallbackVoice(locale: string): string {
    switch (locale.toLowerCase()) {
        case 'en-gb':
            return 'fable';
        case 'en-au':
            return 'coral';
        case 'en-ca':
            return 'marin';
        case 'en-in':
            return 'alloy';
        case 'en-us':
        default:
            return DEFAULT_VOICE_ID;
    }
}

function normalizeVoiceId(voice: string): string {
    const trimmed = voice.trim();
    if (!trimmed) return DEFAULT_VOICE_ID;

    if (trimmed in OMNI_PRESETS) {
        return trimmed;
    }

    const explicitFallback = EDGE_VOICE_FALLBACKS[trimmed];
    if (explicitFallback) {
        return explicitFallback;
    }

    const legacyMatch = trimmed.match(/^([a-z]{2}-[A-Z]{2})-[A-Za-z]+Neural$/);
    if (legacyMatch) {
        return localeToFallbackVoice(legacyMatch[1]);
    }

    return DEFAULT_VOICE_ID;
}

function slugifyProfileName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || `voice-${Date.now()}`;
}

function buildInstructions(voiceId: string, pitch: string): string | undefined {
    const preset = OMNI_PRESETS[voiceId];
    if (!preset) return undefined;

    const parts = [
        preset.gender.toLowerCase(),
        preset.age,
        pitchToDescriptor(pitch),
        preset.accent
    ];

    return parts.join(', ');
}

function buildOmniVoiceSelector(voiceId: string, pitch: string): string {
    const instructions = buildInstructions(voiceId, pitch);
    return instructions ? `design:${instructions}` : 'auto';
}

function getMimeType(contentType: string | null): string {
    const normalized = contentType?.toLowerCase() || '';

    if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'audio/mpeg';
    if (normalized.includes('pcm')) return 'audio/pcm';
    if (normalized.includes('wav')) return 'audio/wav';

    return 'audio/wav';
}

function getNumStep(): number {
    const parsed = Number.parseInt(process.env.OMNIVOICE_TTS_NUM_STEP || '', 10);
    return Number.isFinite(parsed) ? clamp(parsed, 1, 64) : DEFAULT_NUM_STEP;
}

function parseAudioDataUrl(audioDataUrl: string): Buffer {
    const match = audioDataUrl.match(/^data:audio\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (!match) {
        throw new Error('Audio data was not a valid audio data URL.');
    }
    return Buffer.from(match[1], 'base64');
}

function bufferToBlobPart(buffer: Buffer): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(buffer.byteLength);
    copy.set(buffer);
    return copy;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

export class TTSService {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly localVoices: Voice[];
    private readonly cloneDir: string;
    private readonly cloneIndexPath: string;
    private readonly activeControllers = new Set<AbortController>();

    constructor() {
        this.baseUrl = (process.env.OMNIVOICE_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');
        this.apiKey = process.env.OMNIVOICE_API_KEY?.trim() || '';
        this.localVoices = createLocalVoiceList();
        this.cloneDir = path.join(app.getPath('userData'), 'omnivoice-clones');
        this.cloneIndexPath = path.join(this.cloneDir, 'profiles.json');
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }

        return headers;
    }

    private buildAuthHeaders(): Record<string, string> {
        return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    }

    private ensureCloneDir(): void {
        fs.mkdirSync(this.cloneDir, { recursive: true });
    }

    private readCloneProfiles(): VoiceCloneProfile[] {
        this.ensureCloneDir();

        try {
            const raw = fs.readFileSync(this.cloneIndexPath, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private writeCloneProfiles(profiles: VoiceCloneProfile[]): void {
        this.ensureCloneDir();
        fs.writeFileSync(this.cloneIndexPath, JSON.stringify(profiles, null, 2), 'utf8');
    }

    private async waitForReady(timeoutMs: number = SERVER_READY_TIMEOUT_MS): Promise<void> {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            try {
                const response = await fetch(`${this.baseUrl}/health`, {
                    method: 'GET',
                    headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
                    signal: AbortSignal.timeout(2_000)
                });

                if (response.ok) {
                    return;
                }
            } catch {
                // Server not ready yet.
            }

            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }

        throw new Error('OmniVoice is still starting. Make sure the model is installed and the local service can boot.');
    }

    private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        this.activeControllers.add(controller);

        try {
            return await fetch(input, {
                ...init,
                signal: controller.signal
            });
        } catch (error) {
            if (isAbortError(error)) {
                throw new Error(
                    controller.signal.reason === 'cancelled'
                        ? 'OmniVoice request cancelled.'
                        : `OmniVoice request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`
                );
            }
            throw error;
        } finally {
            clearTimeout(timeout);
            this.activeControllers.delete(controller);
        }
    }

    cancelActiveRequests(): void {
        for (const controller of this.activeControllers) {
            try {
                controller.abort('cancelled');
            } catch {
                controller.abort();
            }
        }
        this.activeControllers.clear();
    }

    private async speakClone(text: string, profile: VoiceCloneProfile, rate: string): Promise<TTSAudioPayload> {
        const audioBuffer = fs.readFileSync(profile.audioPath);
        const formData = new FormData();

        formData.append('text', text);
        formData.append('speed', String(rateToSpeed(rate)));
        formData.append('num_step', String(getNumStep()));
        if (profile.refText.trim()) {
            formData.append('ref_text', profile.refText.trim());
        }
        formData.append('ref_audio', new Blob([bufferToBlobPart(audioBuffer)]), path.basename(profile.audioPath));

        const startedAt = Date.now();
        const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/audio/speech/clone`, {
            method: 'POST',
            headers: this.buildAuthHeaders(),
            body: formData
        });

        if (!response.ok) {
            const detail = (await response.text()).trim();
            const detailSuffix = detail ? ` ${detail}` : '';
            throw new Error(`OmniVoice clone request failed (${response.status} ${response.statusText}).${detailSuffix}`);
        }

        const clonedAudioBuffer = Buffer.from(await response.arrayBuffer());
        const mimeType = getMimeType(response.headers.get('content-type'));
        console.log(`[TTS] OmniVoice clone synthesized ${text.length} chars with ${profile.id} in ${Date.now() - startedAt}ms (${clonedAudioBuffer.length} bytes).`);
        return {
            audioBase64: clonedAudioBuffer.toString('base64'),
            mimeType
        };
    }

    async transcribeAudioData(audioDataUrl: string): Promise<string> {
        await this.waitForReady();

        const audioBuffer = parseAudioDataUrl(audioDataUrl);
        const formData = new FormData();
        formData.append('file', new Blob([bufferToBlobPart(audioBuffer)], { type: 'audio/wav' }), 'clone-reference.wav');

        const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/audio/transcriptions`, {
            method: 'POST',
            headers: this.buildAuthHeaders(),
            body: formData
        });

        if (!response.ok) {
            const detail = (await response.text()).trim();
            const detailSuffix = detail ? ` ${detail}` : '';
            throw new Error(`OmniVoice transcription failed (${response.status} ${response.statusText}).${detailSuffix}`);
        }

        const payload = await response.json() as { text?: string };
        return (payload.text || '').trim();
    }

    async speak(text: string, voice: string, rate: string = '+0%', pitch: string = '+0Hz'): Promise<TTSAudioPayload> {
        const trimmedText = text.trim();
        if (!trimmedText) {
            throw new Error('No text provided for TTS.');
        }

        await this.waitForReady();

        if (voice.startsWith('clone:')) {
            const profileId = voice.slice('clone:'.length);
            const profile = this.readCloneProfiles().find((item) => item.id === profileId);
            if (!profile) {
                throw new Error(`Voice clone profile not found: ${profileId}`);
            }
            return this.speakClone(trimmedText, profile, rate);
        }

        const voiceId = normalizeVoiceId(voice);
        const omniVoice = buildOmniVoiceSelector(voiceId, pitch);
        const startedAt = Date.now();
        const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/audio/speech`, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify({
                model: 'omnivoice',
                input: trimmedText,
                voice: omniVoice,
                response_format: 'wav',
                speed: rateToSpeed(rate),
                num_step: getNumStep()
            })
        });

        if (!response.ok) {
            const detail = (await response.text()).trim();
            const detailSuffix = detail ? ` ${detail}` : '';
            throw new Error(`OmniVoice request failed (${response.status} ${response.statusText}).${detailSuffix}`);
        }

        const audioBuffer = Buffer.from(await response.arrayBuffer());
        const mimeType = getMimeType(response.headers.get('content-type'));
        console.log(`[TTS] OmniVoice synthesized ${trimmedText.length} chars in ${Date.now() - startedAt}ms (${audioBuffer.length} bytes).`);
        return {
            audioBase64: audioBuffer.toString('base64'),
            mimeType
        };
    }

    async listVoices(): Promise<Voice[]> {
        const cloneVoices = this.readCloneProfiles().map((profile): Voice => ({
            ShortName: `clone:${profile.id}`,
            FriendlyName: `Clone: ${profile.name}`,
            Locale: 'clone',
            Gender: 'Unknown',
            Type: 'clone'
        }));

        try {
            await this.waitForReady(15_000);

            const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/voices`, {
                method: 'GET',
                headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
            });

            if (!response.ok) {
                return [...cloneVoices, ...this.localVoices];
            }

            const payload = await response.json() as OmniVoiceResponse;
            const remoteVoiceIds = new Set(
                Array.isArray(payload.voices)
                    ? payload.voices
                        .map((voice) => voice.id?.trim().toLowerCase() || '')
                        .filter((voiceId) => voiceId in OMNI_PRESETS)
                    : []
            );

            if (remoteVoiceIds.size === 0) {
                return [...cloneVoices, ...this.localVoices];
            }

            return [
                ...cloneVoices,
                ...this.localVoices.filter((voiceOption) => remoteVoiceIds.has(voiceOption.ShortName.toLowerCase()))
            ];
        } catch (error) {
            console.warn('[TTS] Falling back to bundled OmniVoice presets:', error);
            return [...cloneVoices, ...this.localVoices];
        }
    }

    async createCloneProfile(name: string, audioPath: string, refText: string = ''): Promise<VoiceCloneProfile> {
        this.ensureCloneDir();

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Clone profile name is required.');
        }

        if (!fs.existsSync(audioPath)) {
            throw new Error(`Reference audio file not found: ${audioPath}`);
        }

        const ext = path.extname(audioPath).toLowerCase() || '.wav';
        const idBase = slugifyProfileName(trimmedName);
        const profiles = this.readCloneProfiles();
        let id = idBase;
        let counter = 2;
        while (profiles.some((profile) => profile.id === id)) {
            id = `${idBase}-${counter}`;
            counter += 1;
        }

        const destinationPath = path.join(this.cloneDir, `${id}${ext}`);
        fs.copyFileSync(audioPath, destinationPath);

        const profile: VoiceCloneProfile = {
            id,
            name: trimmedName,
            audioPath: destinationPath,
            refText,
            createdAt: new Date().toISOString()
        };

        this.writeCloneProfiles([...profiles, profile]);
        return profile;
    }

    async createCloneProfileFromAudioData(name: string, audioDataUrl: string, extension: string = 'wav', refText: string = ''): Promise<VoiceCloneProfile> {
        this.ensureCloneDir();

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Clone profile name is required.');
        }

        const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'wav';
        const idBase = slugifyProfileName(trimmedName);
        const profiles = this.readCloneProfiles();
        let id = idBase;
        let counter = 2;
        while (profiles.some((profile) => profile.id === id)) {
            id = `${idBase}-${counter}`;
            counter += 1;
        }

        const destinationPath = path.join(this.cloneDir, `${id}.${safeExtension}`);
        fs.writeFileSync(destinationPath, parseAudioDataUrl(audioDataUrl));

        const profile: VoiceCloneProfile = {
            id,
            name: trimmedName,
            audioPath: destinationPath,
            refText,
            createdAt: new Date().toISOString()
        };

        this.writeCloneProfiles([...profiles, profile]);
        return profile;
    }

    async listCloneProfiles(): Promise<VoiceCloneProfile[]> {
        return this.readCloneProfiles();
    }

    async deleteCloneProfile(profileId: string): Promise<boolean> {
        const profiles = this.readCloneProfiles();
        const profile = profiles.find((item) => item.id === profileId);
        const remaining = profiles.filter((item) => item.id !== profileId);

        if (profile && fs.existsSync(profile.audioPath)) {
            fs.rmSync(profile.audioPath, { force: true });
        }

        this.writeCloneProfiles(remaining);
        return Boolean(profile);
    }

    async cleanupTempFiles(): Promise<void> {
        this.cancelActiveRequests();
        // No-op. OmniVoice responses are returned directly from the local HTTP server.
    }
}
