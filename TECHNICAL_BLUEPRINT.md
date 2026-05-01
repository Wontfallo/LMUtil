<div style="background-color: #f0f0f0; padding: 10px;">


# 2A-TST-Desktop Technical Blueprint

> Complete technical documentation for the AI Chat Desktop Application.  
> **Last Updated:** 2026-04-26

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Architecture](#architecture)
5. [Database Schema](#database-schema)
6. [State Management (Zustand Stores)](#state-management-zustand-stores)
7. [IPC Communication](#ipc-communication)
8. [LLM Integration](#llm-integration)
9. [Text-to-Speech (TTS)](#text-to-speech-tts)
10. [Components](#components)
11. [Styling](#styling)
12. [Data Flow Examples](#data-flow-examples)
13. [Common Bugs & Solutions](#common-bugs--solutions)
14. [Lessons Learned](#lessons-learned)

---

## Overview

**2A-TST-Desktop** is an Electron-based desktop AI chat application with:

- **Multi-provider LLM support** (Ollama, LM Studio)
- **Local high-quality TTS** via OmniVoice/OmniVoice Server
- **Per-chat settings** (each conversation stores its own AI name, avatar, system prompt, model parameters, voices)
- **Prompt Studio** - A specialized prompt generator for Wan 2.2 video and Qwen image models
- **Vision support** - Image attachments for multimodal models
- **Resizable panels** - Both sidebar and right settings panel
- **Universal Model Management** - "Eject" functionality to clear VRAM across all providers
- **Native Context Menu** - Spellcheck and standard clipboard actions throughout the app
- **Character Card Import** - Import TavernAI V1/V2 PNG cards to auto-populate AI profile

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Electron 31 + Vite 5 |
| **Frontend** | React 18 + TypeScript 5 |
| **State Management** | Zustand 4 |
| **Database** | better-sqlite3 (SQLite) |
| **TTS** | Local OmniVoice Server in `.omnivoice` Python venv |
| **LLM Providers** | Ollama API, @lmstudio/sdk |
| **Styling** | Vanilla CSS with CSS Variables |
| **Icons** | lucide-react |
| **Markdown** | react-markdown + prism-react-renderer |
| **IDs** | uuid v13 |

### Package.json Scripts

```json
{
  "dev": "vite",           // Dev server with HMR
  "build": "tsc && vite build && electron-builder",
  "rebuild": "electron-rebuild -f -w better-sqlite3"
}
```

---

## Project Structure

```
2A-TST-Desktop/
├── electron/                    # Main process (Node.js)
│   ├── main.ts                  # Entry point, creates window
│   ├── preload.ts               # IPC bridge (contextBridge)
│   └── services/
│       ├── services.ts          # Centralized backend startup (Ollama/LM Studio/OmniVoice)
│       ├── omnivoice-launcher.py # Local OmniVoice compatibility launcher
│       ├── modelManager.ts      # VRAM management, backend switching
│       ├── llm/
│       │   ├── index.ts         # LLMService - provider orchestration
│       │   ├── ollama.ts        # OllamaProvider implementation
│       │   ├── lmstudio.ts      # LMStudioProvider implementation
│       │   └── types.ts         # Message, ChatConfig, LLMProvider interfaces
│       ├── storage/
│       │   ├── index.ts         # IPC handlers for DB operations
│       │   ├── database.ts      # SQLite init + migrations
│       │   ├── conversations.ts # CRUD for conversations/messages
│       │   ├── settings.ts      # Global key-value settings
│       │   └── fileSystem.ts    # File dialogs, avatar saving
│       └── tts/
│           ├── index.ts         # TTS IPC handlers
│           └── edgeTTS.ts       # TTSService using local OmniVoice HTTP API
│
├── src/                         # Renderer process (React)
│   ├── App.tsx                  # Root component
│   ├── index.css                # All styles (2600+ lines)
│   ├── components/
│   │   ├── Layout.tsx           # App shell (Sidebar + Main + Header)
│   │   ├── Header.tsx           # Provider/model selection
│   │   ├── Sidebar.tsx          # Conversation list + view switcher
│   │   ├── ChatInterface.tsx    # Chat view container
│   │   ├── ChatInput.tsx        # Message input + image upload
│   │   ├── MessageList.tsx      # Message display + TTS controls
│   │   ├── RightPanel.tsx       # Per-chat settings editor
│   │   ├── Settings.tsx         # Global settings modal
│   │   └── PromptGenerator.tsx  # Prompt Studio view
│   └── store/
│       ├── appStore.ts          # Global settings (theme, provider, model)
│       ├── chatStore.ts         # Conversations, messages, sendMessage
│       ├── chatSettingsStore.ts # Per-chat settings (SINGLE SOURCE OF TRUTH)
│       ├── ttsStore.ts          # TTS playback state
│       └── promptGeneratorStore.ts # Prompt Studio state + history
│
├── index.html                   # Vite entry
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RENDERER PROCESS (React)                     │
├──────────────┬──────────────┬──────────────┬───────────────────────┤
│   appStore   │  chatStore   │chatSettings  │ ttsStore/promptStore  │
│  (global)    │ (messages)   │   Store      │    (TTS/prompts)      │
│              │              │ (per-chat)   │                       │
└──────┬───────┴──────┬───────┴──────┬───────┴───────────┬───────────┘
       │              │              │                   │
       └──────────────┼──────────────┼───────────────────┘
                      │              │
                      ▼              ▼
              window.ipcRenderer (preload.ts)
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          MAIN PROCESS (Electron)                     │
├──────────────┬──────────────┬──────────────┬───────────────────────┤
│  LLMService  │StorageService│  TTSService  │   FileSystem          │
│ (Ollama/LMS) │ (SQLite)     │ (OmniVoice)  │ (dialogs, files,      │
│              │              │              │  PNG card parser)     │
└──────────────┴──────────────┴──────────────┴───────────────────────┘
```

### Key Architectural Decisions

1. **Per-chat settings are stored in the `conversations` table**, NOT in a separate settings table
2. **`chatSettingsStore` is the SINGLE SOURCE OF TRUTH** for per-chat settings on the frontend
3. **`appStore` only holds global settings** (theme, provider, currently selected model)
4. **IPC is synchronous-style** using `invoke()` for most operations, `send()/on()` for streaming

---

## Database Schema

**Location:** `{userData}/database.sqlite`

### Tables

#### `conversations`

```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Per-chat settings (all nullable, use defaults if NULL)
    system_prompt TEXT,
    user_name TEXT,
    ai_name TEXT,
    user_avatar TEXT,           -- Base64 data URL
    ai_avatar TEXT,             -- Base64 data URL
    ai_avatar_position INTEGER DEFAULT 30,   -- Y% for crop
    user_avatar_position INTEGER DEFAULT 30,
    user_persona TEXT,          -- Description of user for AI
    last_model TEXT,            -- Model used in this chat
    last_provider TEXT,         -- Provider (ollama/lmstudio) for last_model
    
    -- Model parameters
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 2048,
    context_length INTEGER DEFAULT 4096,
    top_k INTEGER DEFAULT 40,
    top_p REAL DEFAULT 0.95,
    repeat_penalty REAL DEFAULT 1.1,
    
    -- Voice settings
    ai_voice TEXT,              -- OmniVoice preset/design/clone voice ID
    user_voice TEXT,
    ai_region TEXT DEFAULT 'all',
    user_region TEXT DEFAULT 'all',
    auto_play INTEGER DEFAULT 0,       -- 0=false, 1=true
    user_auto_play INTEGER DEFAULT 0,
    ai_rate TEXT DEFAULT '+0%',        -- TTS rate adjustment
    ai_pitch TEXT DEFAULT '+0Hz',      -- TTS pitch adjustment
    user_rate TEXT DEFAULT '+0%',
    user_pitch TEXT DEFAULT '+0Hz',
    tts_chunk_target INTEGER DEFAULT 450
);
```

#### `messages`

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE,  -- For branching (unused)
    role TEXT CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT,               -- String or JSON array for multimodal
    model TEXT,                 -- Model that generated this message
    images TEXT,                -- JSON array of image data (future)
    tool_calls TEXT,            -- JSON for tool calling (future)
    tool_result TEXT,           -- JSON for tool results (future)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `settings`

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Used for: theme, provider, model (global settings only)
```

#### `documents` (Future RAG)

```sql
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    filename TEXT,
    content TEXT,
    chunk_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `prompt_history` (Prompt Studio)

```sql
CREATE TABLE prompt_history (
    id INTEGER PRIMARY KEY,         -- Timestamp-based ID from Date.now()
    timestamp TEXT NOT NULL,        -- ISO timestamp
    input TEXT NOT NULL,            -- User's input text
    output TEXT NOT NULL,           -- Generated prompt
    negative_prompt TEXT,           -- Optional negative prompt
    model TEXT,                     -- LLM model used
    creativity TEXT,                -- 'precise' | 'creative' | 'inspire'
    target_model TEXT               -- 'wan2.2' | 'qwen'
);
```

---

## State Management (Zustand Stores)

### 1. `appStore.ts` - Global Settings

**Purpose:** Application-wide settings that apply to ALL chats.

```typescript
interface AppState {
    theme: 'light' | 'dark' | 'system';
    provider: 'ollama' | 'lmstudio';
    model: string;                    // Currently selected model ID
    models: ModelInfo[];              // Cached list of available models (shared globally)
    settingsLoaded: boolean;          // Flag for initialization
    currentView: 'chat' | 'promptGenerator';
    
    setTheme, setProvider, setModel, setModels, setCurrentView, loadSettings
}
```

**Persisted to:** `settings` table (key-value pairs)

---

### 2. `chatStore.ts` - Conversations & Messages

**Purpose:** Manages conversation list, message history, and LLM communication.

```typescript
interface ChatState {
    conversations: Conversation[];
    currentConversationId: string | null;
    messages: Message[];
    isStreaming: boolean;
    telemetry: { startTime, firstTokenTime, tokenCount, endTime } | null;
    
    // Actions
    loadConversations(): Promise<void>;
    loadMessages(conversationId: string): Promise<void>;
    createNewConversation(): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    renameConversation(id: string, title: string): Promise<void>;
    sendMessage(content: string, model: string, images?: string[]): Promise<void>;
    generateTitle(conversationId, userMsg, aiMsg, model): Promise<void>;
    retryMessage(messageId: string, model: string): Promise<void>;
    continueResponse(model: string): Promise<void>;
}
```

**Key Implementation Details:**

- `sendMessage()` creates user message, streams LLM response, saves assistant message
- Uses `useChatSettingsStore.getState().current` for systemPrompt and LLM parameters
- Calls IPC `llm:chat` for streaming, listens to `llm:chat-chunk`
- Auto-generates title after first exchange using separate LLM call

---

### 3. `chatSettingsStore.ts` - Per-Chat Settings (CRITICAL)

**Purpose:** THE SINGLE SOURCE OF TRUTH for all per-conversation settings.

```typescript
export const DEFAULT_CHAT_SETTINGS = {
    // AI Profile
    aiName: 'AI',
    aiAvatar: '',
    aiAvatarPosition: 30,
    
    // User Persona
    userName: 'User',
    userAvatar: '',
    userAvatarPosition: 30,
    userPersona: '',
    
    // System Prompt
    systemPrompt: 'You are a helpful AI assistant.',
    
    // Model Settings
    temperature: 0.7,
    maxTokens: 2048,
    contextLength: 4096,
    topK: 40,
    topP: 0.95,
    repeatPenalty: 1.1,
    
    // Voice Settings
    aiVoice: '',
    aiRegion: 'all',
    userVoice: '',
    userRegion: 'all',
    autoPlay: false,
    userAutoPlay: false,
    aiRate: '+0%',
    aiPitch: '+0Hz',
    userRate: '+0%',
    userPitch: '+0Hz',
    ttsChunkTarget: 450,
};

interface ChatSettingsState {
    currentConversationId: string | null;
    current: ChatSettings;      // Live editing state
    original: ChatSettings;     // Last saved state (for dirty detection)
    unsavedSections: Set<SettingSection>;
    isLoading: boolean;
    
    loadSettings(conversationId: string): Promise<void>;
    updateSetting(key, value): void;           // Marks section dirty
    saveSection(section: SettingSection): Promise<void>;
    resetSection(section): void;               // Revert to original
    resetToDefaults(section): void;            // Revert to DEFAULT_CHAT_SETTINGS
    isSectionChanged(section): boolean;
    isSettingChanged(key): boolean;
    isNonDefault(key): boolean;                // For color coding
}
```

**Section Groupings:**

```typescript
export const SETTING_SECTIONS = {
    aiProfile: ['aiName', 'aiAvatar', 'aiAvatarPosition'],
    userPersona: ['userName', 'userAvatar', 'userAvatarPosition', 'userPersona', 'userVoice', 'userRegion', 'userAutoPlay', 'userRate', 'userPitch'],
    systemPrompt: ['systemPrompt'],
    modelSettings: ['temperature', 'maxTokens', 'contextLength', 'topK', 'topP', 'repeatPenalty'],
    voiceSettings: ['aiVoice', 'aiRegion', 'autoPlay', 'aiRate', 'aiPitch', 'ttsChunkTarget'],
};
```

**Persisted to:** `conversations` table columns

---

### 4. `ttsStore.ts` - TTS Playback

```typescript
interface TTSState {
    isEnabled: boolean;
    voices: Voice[];              // OmniVoice presets/design voices
    selectedVoice: string;        // Default fallback voice
    rate: string;                 // e.g., "+0%"
    pitch: string;                // e.g., "+0Hz"
    
    // Playback state
    audioPlayer: HTMLAudioElement | null;
    isPlaying: boolean;
    isPaused: boolean;
    currentMessageId: string | null;
    audioQueue: QueuedAudio[];
    isProcessingQueue: boolean;
    
    loadVoices(): Promise<void>;
    play(text, messageId, isAiMessage?): Promise<void>;
    addToQueue(text, messageId, isAiMessage?, options?): Promise<void>;
    clearQueue(): void;
    pause(): void;
    resume(): void;
    stop(): void;
}
```

**Important:** Auto-play snapshots `autoPlay`, voice, rate, and pitch at send time and passes those values into `addToQueue()`. This prevents switching chats or editing the right panel mid-response from changing whether the in-flight assistant response speaks.

**Streaming behavior:** `chatStore.ts` registers the stream listener before starting generation, buffers streamed LLM output into speakable sentence/clause chunks, strips markdown/list/code/link formatting, treats ellipses as a safe chunk boundary, and calls `ttsStore.addToQueue()` while the response is still arriving. OmniVoice is fast enough to handle larger requests, so streaming batches use a saved Voice Settings target size (`ttsChunkTarget`, default 450 chars, slider range 160-900) instead of one tiny request per sentence. Generated audio chunks are queued and played sequentially so TTS can trail the LLM by only a few chunks instead of waiting for the full response.

---

### 5. `promptGeneratorStore.ts` - Prompt Studio

```typescript
interface PromptGeneratorState {
    targetModel: 'wan2.2' | 'qwen';
    creativityMode: 'precise' | 'creative';
    inputText: string;
    outputText: string;
    negativePrompt: string;
    negPromptLocked: boolean;
    isLoading: boolean;
    isInspiring: boolean;
    showHistory: boolean;
    historySearch: string;
    history: HistoryItem[];
    
    // CRUD for history (persisted to localStorage)
}
```

---

## IPC Communication

### Preload Bridge (`preload.ts`)

All IPC methods are exposed via `window.ipcRenderer`:

```typescript
// LLM Methods
listModels(): Promise<ModelInfo[]>
setProvider(provider: 'ollama' | 'lmstudio'): Promise<boolean>
chat(messages: any[], config: any): void  // Uses send(), not invoke()
onChatChunk(callback): () => void          // Returns unsubscribe function
unloadModel(modelId: string): Promise<void>
abortChat(): Promise<boolean>
cleanupLLM(): Promise<void>

// Database Methods
getConversations(): Promise<Conversation[]>
createConversation(id: string, title: string): Promise<void>
deleteConversation(id: string): Promise<void>
updateConversationTitle(id: string, title: string): Promise<void>
getMessages(conversationId: string): Promise<MessageNode[]>
saveMessage(message: any): Promise<void>
deleteMessageBranch(messageId: string): Promise<void>
getSettings(): Promise<Record<string, string>>
setSetting(key: string, value: string): Promise<void>
getConversation(id: string): Promise<Conversation>  // Full row with settings
updateConversationSettings(id: string, settings: any): Promise<void>

// Prompt History Methods (Prompt Studio)
getPromptHistory(): Promise<PromptHistoryItem[]>
addPromptHistory(item: any): Promise<void>
deletePromptHistory(id: number): Promise<void>
clearPromptHistory(): Promise<void>

// TTS Methods
listVoices(): Promise<Voice[]>
listCloneProfiles(): Promise<VoiceCloneProfile[]>
createCloneProfile(name, audioPath, refText?): Promise<VoiceCloneProfile>
createCloneProfileFromAudioData(name, audioDataUrl, extension?, refText?): Promise<VoiceCloneProfile>
deleteCloneProfile(profileId): Promise<boolean>
speak(text, voice, rate?, pitch?): Promise<{ audioBase64: string; mimeType: string }>
cleanupTTS(): Promise<void>

// File System Methods
saveAvatar(base64Data, type: 'user' | 'ai'): Promise<string>
openDialog(options): Promise<string[]>
saveDialog(options): Promise<string>
readFile(filePath): Promise<string>
readFileAsBase64(filePath): Promise<string>
writeFile(filePath, content): Promise<void>
parseCharacterCard(filePath): Promise<any> // Returns raw JSON data (V1/V2)
```

---

## LLM Integration

### Provider Interface

```typescript
interface LLMProvider {
    listModels(): Promise<ModelInfo[]>;
    chat(messages: Message[], config: ChatConfig, signal?: AbortSignal): AsyncIterable<StreamChunk>;
    unloadModel(modelId: string): Promise<void>;
    stopRunning(): Promise<void>; // Universal cleanup
}
```

### Ollama Provider

- **Base URL:** `http://localhost:11434`
- **Endpoints:**
  - `GET /api/tags` - List models
  - `POST /api/show` - Get model info (for capability detection)
  - `POST /api/chat` - Streaming chat
  - `POST /api/generate` with `keep_alive: 0` - Unload model

**Capability Detection:**

- Vision: Checks `projector_info` or model name patterns (llava, vision, etc.)
- Tools: Checks template for tool/function tokens or name patterns (qwen, mistral, etc.)

**Auto-Start Server:**

When `listModels()` is called and the Ollama server is not running:

1. Detects server is down via `isConnected()` (pings `/api/tags`)
2. Locates `ollama.exe` in standard install paths or falls back to PATH
3. Spawns `ollama serve` as a detached background process
4. Waits up to 15 seconds for server to become available
5. Once available, proceeds with model listing

### LM Studio Provider

Uses the official `@lmstudio/sdk` npm package for native integration.

**Key Methods:**

```typescript
// Get model handle with context length
const model = await client.llm.model(modelKey, {
    config: { contextLength: 8192 }
});

// Streaming inference with all parameters
const prediction = model.respond(messages, {
    temperature: 0.7,
    maxTokens: 2048,
    topKSampling: 40,
    topPSampling: 0.95,
    repeatPenalty: 1.1,
});

for await (const fragment of prediction) {
    // fragment contains token text
}
```

**Model Listing:**

- Uses `client.system.listDownloadedModels()` for rich metadata
- Returns `maxContextLength`, `vision`, `trainedForToolUse` per model
- Filters to `type === 'llm'` (excludes embeddings)

**Capability Detection:**

- Vision: Uses SDK's `vision` boolean field
- Tools: Uses SDK's `trainedForToolUse` boolean field
- Falls back to pattern detection if SDK data unavailable

**Auto-Start Server:**

When `listModels()` is called and the LM Studio server is not running:

1. Detects server is down via `isConnected()` (pings `/v1/models`)
2. Locates `lms.exe` CLI at `%USERPROFILE%\.lmstudio\bin\`
3. Spawns `lms server start` as a detached background process
4. Waits up to 30 seconds for server to become available
5. Once available, proceeds with model listing

### ChatConfig

```typescript
interface ChatConfig {
    model: string;
    temperature?: number;
    max_tokens?: number;
    contextLength?: number;
    topKSampling?: number;
    topPSampling?: number;
    repeatPenalty?: number;
}
```

---

## Text-to-Speech (TTS)

### OmniVoice Service

TTS is handled by a local OmniVoice HTTP server, started by the Electron main process through `electron/services/services.ts`. The server runs from the project-local `.omnivoice` Python virtual environment, so OmniVoice, PyTorch, TorchAudio, ASR helpers, and any Windows compatibility shims stay isolated from global Python installs.

**Important:** OmniVoice should use CUDA by default on this workstation. The local venv is expected to contain CUDA PyTorch packages such as `torch==2.8.0+cu128` and `torchaudio==2.8.0+cu128`. CPU mode is only a fallback/debug path because it is too slow for the desired near-real-time chat playback.

**Known-good Windows environment:** The app venv should match the standalone Gradio demo that works from `H:\OmniVoice\.venv`. In practice that means `.omnivoice` uses an editable install of the local `H:\OmniVoice` checkout (`omnivoice==0.1.2`, `transformers==5.3.0`) instead of drifting to newer PyPI behavior. `torchcodec` is intentionally **not** installed in this venv; installing it caused the clone/ASR path to choose a broken Windows FFmpeg DLL loader even though the standalone demo works without TorchCodec.

**VRAM guardrails:** LM Studio context length is capped to `32768` by default when loading through the app, even if a model advertises a much larger maximum context. Override with `LMSTUDIO_MAX_CONTEXT_LENGTH` only when there is enough VRAM. OmniVoice CUDA startup checks free VRAM and refuses to start if less than `7000 MB` is available; override with `OMNIVOICE_MIN_FREE_VRAM_MB` if needed.

The app launches OmniVoice with:

```text
.\.omnivoice\Scripts\python.exe electron/services/omnivoice-launcher.py --host 127.0.0.1 --port 8880 --device cuda --timeout 600
```

`OMNIVOICE_DEVICE` can override the default device, but the normal app path should keep it as `cuda`.

`omnivoice-launcher.py` wraps the installed `omnivoice_server` package and applies compatibility fixes needed by the local Windows desktop integration:

- model startup accepts NumPy arrays returned by `model.generate()`
- WAV/PCM response helpers accept NumPy arrays as well as Torch tensors
- clone reference WAVs are decoded in-process and passed to OmniVoice as `(tensor, sample_rate)` instead of a file path; this keeps the app on the same no-TorchCodec path as the working Gradio demo
- the rest of the app still talks to the normal OmniVoice HTTP API

```typescript
class TTSService {
    listVoices(): Promise<Voice[]>;
    listCloneProfiles(): Promise<VoiceCloneProfile[]>;
    createCloneProfile(name, audioPath, refText?): Promise<VoiceCloneProfile>;
    createCloneProfileFromAudioData(name, audioDataUrl, extension?, refText?): Promise<VoiceCloneProfile>;
    deleteCloneProfile(profileId): Promise<boolean>;
    speak(text, voice, rate, pitch): Promise<{ audioBase64: string; mimeType: string }>;
    cleanupTempFiles(): Promise<void>;
}
```

**Voice Format:**

```typescript
interface Voice {
    ShortName: string;      // e.g., "alloy", "nova", "onyx"
    FriendlyName: string;   // e.g., "Nova (Female, en-US)"
    Locale: string;         // e.g., "en-US"
    Gender: string;         // "Male" or "Female"
    Type?: "preset" | "clone";
}
```

**Request Format:**

The installed OmniVoice server accepts `voice` values of `auto`, `design:<attributes>`, or `clone:<profile_id>`. It does not currently accept the newer README-style `instructions` body field, so the app maps local presets into design strings:

```json
{
  "model": "omnivoice",
  "input": "Hello world",
  "voice": "design:female, young adult, high pitch, american accent",
  "response_format": "wav",
  "speed": 1.0
}
```

`rate` is converted to OmniVoice `speed` in the `0.25` to `4.0` range. `pitch` is folded into the design prompt as one of `very low pitch`, `low pitch`, `moderate pitch`, `high pitch`, or `very high pitch`.

**Local Presets:**

The renderer still exposes OpenAI-style preset IDs for a simple voice dropdown:

```text
alloy, ash, ballad, cedar, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse
```

Each preset maps to a deterministic design prompt. Legacy Edge voice IDs are also mapped to close OmniVoice presets so old saved conversation settings do not hard-fail.

**Voice Cloning:**

- Clone profiles are created in the **Voice Clone Studio**, opened from either AI Voice Settings or User Persona voice controls
- The studio uses the renderer Web Audio API to decode local audio, draw a waveform, seek/scrub with a visible playhead, and trim a reusable 1-30 second reference clip
- Users can play from the current cursor, play only the selected cut, stop playback, and save multiple clone cuts from the same long audio file without re-uploading
- Reference transcripts can be pasted directly or uploaded from text/subtitle-like files (`.txt`, `.md`, `.srt`, `.vtt`, `.csv`, `.json`)
- Trimmed clips are encoded as WAV data URLs in the renderer and sent to Electron through `tts:create-clone-profile-from-audio-data`
- Profiles are stored under Electron `userData/omnivoice-clones` with metadata in `profiles.json`
- Cloned voices appear in the normal AI/User voice dropdowns as `Clone: <name>` with IDs like `clone:<profileId>`
- When a clone voice is selected, `TTSService.speak()` routes synthesis through OmniVoice `/v1/audio/speech/clone` with multipart form data (`text`, `ref_audio`, optional `ref_text`, `speed`, `num_step`)
- The launcher intentionally bypasses TorchCodec for clone references because the known-good standalone demo does not need it, and the app venv failed when TorchCodec was present
- Blank clone transcripts are never replaced with fake or placeholder text. If the user leaves the transcript blank, the Voice Clone Studio first calls the local `/v1/audio/transcriptions` route, fills the transcript box with ASR output, and requires the user to review/edit before saving the clone.
- The local transcription route decodes the trimmed WAV to an in-memory waveform before falling back to OmniVoice ASR, so ASR receives `(waveform, sample_rate)` instead of a file path and avoids TorchCodec file decoding on Windows.
- Presets/design voices continue to use `/v1/audio/speech`

**Voice Clone Studio UI Notes:**

- The studio is rendered through a React portal into `document.body`; do not nest it inside the right settings panel or it will inherit panel constraints and collapse on 4K layouts
- Studio controls intentionally use larger type, buttons, sliders, and waveform height than the compact settings panel
- The waveform selection marks the trim range; the yellow playhead marks current playback/cursor position

### Auto-Play Feature

- `autoPlay` in chatSettingsStore triggers low-latency queued playback while the LLM response streams
- `userAutoPlay` does same for user messages (read-back)
- Both are per-chat settings stored in conversations table
- Auto-play state is snapshotted when the message is sent, so old chats with `autoPlay` off should not speak even if another chat has it on
- Markdown/list syntax, inline code, links, and headings are stripped before TTS so visible chat formatting does not get read aloud
- Ellipses (`...`) are handled as chunk boundaries so long expressive responses do not sit in the buffer too long
- Streaming TTS uses larger natural batches, with a per-chat `TTS Chunk Target` slider saved in Voice Settings (`160-900`, default `450`)
- `ttsStore` maintains an ordered synthesis queue and an ordered playback queue so generated audio cannot play out of sequence even when synthesis times vary

---

## Components

### Layout.tsx

Simple shell: `Sidebar | (Header + Main Content) | RightPanel`

### Header.tsx

- Provider dropdown (Ollama/LM Studio)
- Model dropdown (fetched from current provider)
- Eject model button

### Sidebar.tsx

- **View switcher tabs:** Chat / Prompt Studio
- **Conversation list** with:
  - New Chat button
  - Rename (inline edit)
  - Delete
- **Resizable** via drag handle on right edge
- Default width: 320px, range: 200-600px

### ChatInterface.tsx

Container for MessageList + ChatInput

### MessageList.tsx

- Renders messages with avatars from `chatSettings.userAvatar`/`aiAvatar`
- TTS controls (play/pause/stop) per message
- Auto-TTS queues speakable chunks during streaming if `autoPlay` enabled
- Model prompt dialog when switching chats with different models
- Auto-scroll on new messages

### ChatInput.tsx

- Textarea with auto-resize
- Image attachment (preview thumbnails)
- File attachment (placeholder)
- Send/Stop button
- Telemetry footer (TTFT, stream chunks, chunks/s, total time)

### RightPanel.tsx

Per-chat settings editor with collapsible sections:

1. **AI Profile** - Avatar (with drag positioning), name
2. **Model Settings** - Temperature, maxTokens, etc. (sliders)
3. **Voice Settings** - AI voice dropdown, region filter, auto-play toggle, TTS chunk target, Voice Clone Studio entry
4. **System Prompt** - Textarea
5. **User Persona** - Avatar, name, persona description, user voice, user region, user auto-play, Voice Clone Studio entry

Each section has Save/Reset buttons. Color coding:

- **Purple** = default value
- **Cyan** = modified from default

**Character Card Import:**

- Integrated into the AI Avatar upload flow.
- Uses IPC to safely parse PNG metadata (tEXt/ccv3 chunks) in the main process.
- Auto-populates Name, System Prompt, and Avatar upon user confirmation.

### Settings.tsx

**Global settings only** (per-chat moved to RightPanel):

- Provider selection
- Default model
- TTS enable/voice/rate/pitch

### PromptGenerator.tsx

Specialized prompt crafting for AI image/video models:

- **Inspire Me Mode**: Generates 3 short, punchy sentence ideas based on user input (via "Inspire Me" button).
- **Strict Output Control**: Enforces lack of preambles ("Here is...") via system prompt engineering.
- **Visual Feedback**: Streaming output directly to input box, loading spinners, "Stop" button during generation.
- Target model: Wan 2.2 (video) or Qwen (image)
- Creativity mode: Precise (temp 0.3), Creative (temp 0.7), or Inspire (via "Inspire Me" button)
- **Enhanced UI**:
  - Color-coded history tags (Cyan for Wan, Blue for Qwen, Purple for Creative, etc.)
  - Tooltips for guidance
  - Copy-to-clipboard feedback
- History panel with search, export (JSON/CSV)

---

## Styling

**File:** `src/index.css` (~2600 lines)

### CSS Variables

```css
:root {
    --bg-main: #09090b;
    --bg-card: #18181b;
    --bg-sidebar: #141417;
    --bg-hover: rgba(255, 255, 255, 0.05);
    --accent: #7c3aed;        /* Purple */
    --accent-hover: #8b5cf6;
    --text-primary: #ffffff;
    --text-secondary: #a1a1aa;
    --border: rgba(255, 255, 255, 0.08);
    --sidebar-width: 320px;
    --header-height: 70px;
}
```

### Key Style Patterns

- **Glassmorphism:** `backdrop-filter: blur(20px)` on panels
- **Gradients:** Linear gradients on sidebar/panels
- **Resizable panels:** Position absolute handles, cursor: ew-resize
- **Collapsible sections:** `.collapsible-section.open` for state
- **Color coding:** `.setting-row.modified label { color: #06b6d4; }` (cyan)
- **Message styling:** `.message-wrapper.user` vs `.message-wrapper.assistant`

---

## Data Flow Examples

### Sending a Message

```
1. User types in ChatInput → handleSend()
2. chatStore.sendMessage(content, model, images)
3. Create user message locally + save to DB
4. Get systemPrompt + LLM config from chatSettingsStore.current
5. Build message history with system prompt prepended
6. window.ipcRenderer.chat(history, config)
7. Main process: LLMService dispatches to OllamaProvider/LMStudioProvider
8. Provider yields StreamChunks
9. Main process: event.reply('llm:chat-chunk', chunk)
10. Renderer: onChatChunk callback appends to streaming message
11. On done: Save assistant message to DB + generate title if first exchange
12. If autoPlay: `chatStore` extracts speakable sentence/clause chunks and calls `ttsStore.addToQueue(chunk, messageId, true)`
13. On done: any remaining buffered text is queued for TTS

### Stopping Generation (Universal)

```

1. User clicks "Stop" button
2. Frontend calls `chatStore.stopEverything()`
3. `ttsStore.stop()` clears playback queues and calls `tts:cancel` so active OmniVoice HTTP synthesis requests abort
4. Frontend calls `window.ipcRenderer.abortChat()`
5. Main process: LLMService calls `abortController.abort()`
6. Provider: fetch/SDK request is aborted
7. Stream loop breaks, 'done: true' sent to frontend
8. Frontend: resets loading state, shows partial message

```

### Universal Model Cleanup (Eject)

```

1. User clicks "Eject" (CPU icon) in Header
2. Header stops active TTS playback/synthesis
3. Header calls window.ipcRenderer.cleanupLLM()
4. Main process unloads Ollama and LM Studio loaded models
5. Header calls window.ipcRenderer.stopService('omnivoice')
6. Main process kills the app-spawned OmniVoice Python process tree
7. Result: VRAM is cleared for both the selected LLM backend and OmniVoice TTS
   - Ollama: lists running models (/api/ps) and sends unload request for each
   - LM Studio: calls SDK unloadModel()
   - OmniVoice: no unload endpoint; VRAM is freed by stopping the Python service

```

### Same-Provider Model Switching

```
1. User selects a different model in the Header dropdown
2. Header stops active TTS playback/synthesis
3. Header calls cleanupLLM() to unload currently loaded LM Studio/Ollama models
4. appStore records the newly selected model
5. On the next chat request, each provider defensively unloads any other loaded/running model before loading the requested one
```

This prevents LM Studio or Ollama from keeping the previous model in VRAM while the new model loads. The rule is intentionally conservative because OmniVoice also needs GPU headroom.

### Emergency Eject

```

1. TTS detects a long GPU wait and shows the "Oh Shit" button
2. User clicks it
3. chatStore.emergencyEjectModels() calls stopEverything()
4. LLM generation is aborted, TTS playback is stopped, and active TTS synthesis is cancelled
5. cleanupLLM() unloads Ollama/LM Studio
6. stopService('omnivoice') stops the app-owned OmniVoice process tree
7. The next TTS request lazily restarts OmniVoice through startServiceById('omnivoice')

```
```

### App Quit Cleanup

```
1. User quits the app or closes the last window
2. main.ts intercepts before-quit and pauses shutdown once
3. unloadAllModels() unloads Ollama and LM Studio models while their APIs are still reachable
4. stopAllServices() kills app-spawned backend process trees, including OmniVoice Python
5. Electron resumes quit after cleanup completes or a short timeout expires
```

**Important:** OmniVoice does not expose a model-unload endpoint in the current server path, so the app frees OmniVoice VRAM by stopping the Python service process it launched. LM Studio and Ollama are unloaded through their normal APIs before service processes are stopped.

### Switching Conversations

```
1. User clicks conversation in Sidebar
2. chatStore.setCurrentConversation(id)
3. MessageList useEffect detects currentConversationId change
4. chatStore.loadMessages(id)
5. chatSettingsStore.loadSettings(id)
   - Fetches full conversation row via getConversation(id)
   - Parses DB columns → ChatSettings object
   - Sets current and original to same value
6. MessageList renders with chatSettings.userName/aiName/avatars
7. If conversation has different last_model, show switch prompt
```

### Saving Per-Chat Settings

```
1. User edits in RightPanel (e.g., temperature slider)
2. chatSettingsStore.updateSetting('temperature', 0.9)
   - Updates current.temperature
   - Adds 'modelSettings' to unsavedSections
   - Section header shows red asterisk
3. User clicks Save on section
4. chatSettingsStore.saveSection('modelSettings')
   - Maps JS keys to DB columns (temperature → temperature)
   - Converts booleans to 0/1 for SQLite
   - Calls updateConversationSettings(id, { temperature: 0.9, ... })
   - Updates original to match current
   - Removes section from unsavedSections
```

---

## Common Bugs & Solutions

### Bug: Per-chat settings not applied to LLM

**Cause:** `chatStore.sendMessage()` was reading settings from `appStore` instead of `chatSettingsStore`.

**Fix:** Import `useChatSettingsStore` and use `.getState().current.*` for systemPrompt and all LLM config.

---

### Bug: Boolean settings show wrong color (cyan when default)

**Cause:** SQLite stores booleans as 0/1 integers. Using `??` operator: `0 ?? false` returns `0`, and `0 !== false` is `true`.

**Fix:** Use `Boolean(conversation.auto_play)` to properly convert 0→false, 1→true.

---

### Bug: TTS uses wrong voice for chat

**Cause:** `ttsStore` had its own `aiVoice`/`userVoice` fields separate from per-chat settings.

**Fix:** Remove voice fields from ttsStore. In `play()`, read voices from `chatSettingsStore.getState().current.*`.

---

### Bug: Settings display doesn't match edits

**Cause:** RightPanel wrote to `chatSettingsStore`, but MessageList read from a different store (`settingsStore`).

**Fix:** Delete redundant `settingsStore`. All consumers use `chatSettingsStore.current.*`.

---

## Future Considerations

1. **RAG/Documents** - `documents` table exists but unused
2. **Message branching** - `parent_id` in messages supports tree structure
3. **Tool calling** - `tool_calls`/`tool_result` columns ready
4. **Theme switching** - `theme` setting exists but UI may not fully implement

---

## Quick Reference

| Task | Location |
|------|----------|
| Add new per-chat setting | `chatSettingsStore.ts` → DEFAULT_CHAT_SETTINGS, SETTING_SECTIONS, loadSettings, saveSection keyToColumn |
| Add new DB column for settings | `database.ts` → conversationColumns array, `conversations.ts` → Conversation interface |
| Add new IPC method | `preload.ts` + handler in appropriate service under `electron/services/` |
| Change default panel width | `Sidebar.tsx`/`RightPanel.tsx` useState + `index.css` |
| Add new LLM provider | Implement `LLMProvider` interface, add to `LLMService.providers` |

---

## Lessons Learned

### Native Context Menus in Electron

- **Issue**: Attempting to conditionally show the context menu based on `params.selectionText` or `params.isEditable` caused it to be completely inaccessible on "old" (static) text.
- **Solution**: Always allow the menu to pop up (`menu.popup()`). Add items like 'Copy' or 'Select All' unconditionally (or with loose checks), and let the OS/Electron handle the enabled/disabled state of the specific items.
- **Bonus**: Adding "Inspect Element" is invaluable for debugging production builds.

### LLM Unload vs. Stop

- **Distinction**:
  - **Stop**: Aborting the HTTP request/stream. The model *remains loaded* in VRAM for faster subsequent requests.
  - **Unload**: Explicitly commanding the server to free VRAM.
- **Implementation**: These must be two distinct actions in the UI. A universal "Eject" button is clearer than trying to tie unload logic to the Stop button.
- **Ollama Quirk**: The `/api/generate` endpoint requires an empty `prompt: ""` even when sending `keep_alive: 0` to unload. Without it, the request may fail or hang.

### Production Build Issues

#### 1. White Screen "Flash Bang"

- **Symptom**: Application opens to a blinding white screen before loading (or if loading fails), clashing with the dark theme.
- **Cause**: Electron's default `BrowserWindow` background is white. If the React app loads slowly or fails, this raw window background is visible.
- **Solution**: Set `backgroundColor` in `main.ts` to match the app's theme color:

  ```typescript
  new BrowserWindow({
    backgroundColor: '#0c0c0e', // Matches index.css --bg-main
    // ...
  })
  ```

#### 2. Black Screen (Content Load Failure)

- **Symptom**: Application window opens (dark background) but remains empty/black. DevTools shows `ERR_FILE_NOT_FOUND` for assets.
- **Cause**: Vite defaults to absolute paths (e.g., `/assets/script.js`). In Electron production builds (served via `file://` protocol), these resolve to the root of the drive (e.g., `C:/assets/script.js`) instead of relative to `index.html`.
- **Solution**: Set `base: './'` in `vite.config.ts`. This forces relative paths (e.g., `./assets/script.js`), ensuring assets act correctly regardless of installation path or ASAR packaging.

#### 3. "Zombie" File Locks (EBUSY)

- **Symptom**: Build fails with `EBUSY: resource busy or locked` on `dist` folder, even after killing processes.
- **Cause**: `electron-builder` or OS processes may hold stubborn locks on unpacked resources, especially if a previous build crashed or the app was running.
- **Solution**:
  - **Immediate**: Rename the output directory (e.g., `release_v2`) in `package.json` to bypass the locked folder.
  - **Prevention**: Ensure `build.files` configuration in `package.json` explicitly includes build artifacts (`dist`, `dist-electron`) to prevent builder confusion.

### Security & File Access (Character Cards)

- **Issue**: Attempting to read local PNG files via `fetch('file://...')` or `FileReader` in the Renderer process failed due to Electron's security restrictions (CORS/local resource warnings) or partial file access limitations.
- **Solution**: Moved the parsing logic to the **Main Process** (`electron/services/storage/fileSystem.ts`).
- **Mechanism**:
  1. Frontend calls `window.ipcRenderer.parseCharacterCard(path)`.
  2. Main process uses Node's native `fs` and `Buffer` to reliably read and parse PNG chunks.
  3. Returns sanitized JSON data to the frontend.
- **Benefit**: Bypasses all browser-side security sandboxing for local files and ensures robust binary parsing.

---

### localStorage to SQLite Migration (Prompt Studio History)

- **Issue**: Prompt Studio history was stored in `localStorage`, which is isolated per origin. This meant:
  - Development (`http://localhost:5173`) and Production (`file://...`) had separate histories
  - Data didn't persist across builds or app reinstalls
  
- **Solution**: Migrated to SQLite database with automatic one-time migration:
  1. Added `prompt_history` table to `database.ts`
  2. Created IPC handlers: `get-prompt-history`, `add-prompt-history`, `delete-prompt-history`, `clear-prompt-history`
  3. Updated `promptGeneratorStore.ts` to use IPC instead of `localStorage`
  4. Added migration logic in `loadHistory()` that detects empty DB + existing localStorage data and imports automatically

- **Key Implementation Details**:
  - Use `INSERT OR REPLACE` instead of `INSERT` to handle duplicate IDs during migration retries
  - Clear localStorage after successful migration to prevent re-migration
  - Use proper ESM `import { getDb }` at top of file instead of `require('./database')` inside handlers (runtime require fails in bundled Electron)

---

### Backend Service Management (Centralized services.ts)

- **Issue**: When the app started and backend services were not running, the model list or TTS playback could fail until the user manually launched external processes. Users expected the app to automatically bring up local services without blocking the UI.

- **Solution**: Implemented a centralized service manager (`electron/services/services.ts`) that:
  1. Starts Ollama, LM Studio, and OmniVoice at app launch in parallel
  2. Runs them silently in the background (no terminal windows)
  3. Tracks service status (`starting`, `ready`, `failed`, `not_installed`)
  4. Provides IPC handlers for the frontend to poll service readiness
  5. Cleans up spawned service processes on app quit

- **Architecture** (`services.ts`):

  ```typescript
  // Service status tracking
  type ServiceId = 'ollama' | 'lmstudio' | 'omnivoice';
  type ServiceState = 'starting' | 'ready' | 'failed' | 'not_installed';

  const serviceStatus: Record<ServiceId, ServiceState> = {
    ollama: 'starting',
    lmstudio: 'starting',
    omnivoice: 'starting'
  };

  // Explicit path discovery (Windows)
  function findOllamaCLI(): string | null {
    // Checks: LOCALAPPDATA\Programs\Ollama, PATH, etc.
  }
  
  function findLMStudioCLI(): string | null {
    // Checks: USERPROFILE\.lmstudio\bin\lms.exe
  }

  function getOmniVoiceCommands(): ServiceCommand[] {
    // Prefer .omnivoice\Scripts\python.exe + omnivoice-launcher.py
    // Defaults to --device cuda; OMNIVOICE_DEVICE can override
    // Falls back to omnivoice-server / py -m omnivoice_server / python -m omnivoice_server
  }

  // Start service with polling for readiness
  async function tryStartCommand(service, commandDef) {
    const child = spawn(commandDef.command, commandDef.args, { 
      stdio: ['ignore', 'pipe', 'pipe'], 
      windowsHide: true 
    });
    // Poll healthUrl until ready
  }

  // Called from main.ts on app.whenReady()
  export function startAllServices() { ... }
  
  // IPC handlers for frontend polling
  export function registerServiceHandlers() {
    ipcMain.handle('services:get-status', ...)
    ipcMain.handle('services:is-ready', ...)
    ipcMain.handle('services:get-all-status', ...)
  }
  ```

- **Frontend Integration** (`Header.tsx`):
  - Uses a simple retry loop to call `listModels()` until it gets results
  - Shows loading spinner while fetching
  - No complex service status polling - just retry until models appear
  
  ```typescript
  // Simple retry loop - keeps calling listModels until it gets results
  for (let attempt = 1; attempt <= 30 && active; attempt++) {
    const list = await window.ipcRenderer.listModels();
    if (list && list.length > 0) {
      setModels(list);
      return; // Success
    }
    await new Promise(r => setTimeout(r, 1000)); // Wait 1s, retry
  }
  ```

- **Key Implementation Details**:
  - Use `spawn()` with `{ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }` so service failures are visible in logs without opening terminal windows
  - Windows requires explicit path discovery - don't rely on PATH or `fix-path` npm package
  - Ollama CLI: `ollama serve` - at `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`
  - LM Studio CLI: `lms server start` - at `%USERPROFILE%\.lmstudio\bin\lms.exe`
  - OmniVoice: prefer the repo-local `.omnivoice\Scripts\python.exe` and `electron/services/omnivoice-launcher.py`
  - OmniVoice default device is `cuda`; use `OMNIVOICE_DEVICE=cpu` only as an explicit fallback/debug override
  - OmniVoice health check: `GET http://127.0.0.1:8880/health`
  - OmniVoice startup timeout is longer than the LLM backends because first-run model loading can take longer
  - Frontend uses simple retry loop - no complex service status polling in UI

- **Model Manager** (`modelManager.ts`):
  - Handles safe backend switching to prevent GPU VRAM conflicts
  - Unloads models from one provider before switching to another
  - Called by `LLMService.setProvider()` to ensure clean transitions

---

### Model Switching with Provider Memory (last_provider)

- **Issue**: When clicking "Reload last model" to restore a previous conversation's model, only the model name was saved. If the model was from a different provider (e.g., Ollama model saved, currently on LMStudio), clicking reload would fail because it didn't switch providers.

- **Solution**: Added `last_provider` field to the database alongside `last_model`:
  1. `database.ts` - Added `last_provider TEXT` column to conversations table
  2. `conversations.ts` - Added `last_provider?: 'ollama' | 'lmstudio'` to Conversation interface
  3. `chatStore.ts` - Updated `sendMessage()` to save both `last_model` and `last_provider`
  4. `MessageList.tsx` - Updated reload button to call `setProvider()` before `setModel()`

- **Data Flow**:

  ```
  1. User sends message with Ollama model
  2. chatStore.sendMessage() saves { last_model: "llama3", last_provider: "ollama" }
  3. User switches to LMStudio, uses different model
  4. User returns to old conversation
  5. MessageList shows "Reload last model" button
  6. On click: setProvider("ollama") → setModel("llama3")
  7. Models dropdown refreshes with Ollama models, correct model selected
  ```

---

### UI Improvements - Reload Last Model Button

- **Issue**: The model prompt was an intrusive popup dialog that interrupted the user's workflow.

- **Solution**: Replaced with a subtle "Reload last model" pill button:
  - Appears at the bottom of the message list (sticky)
  - Shows model name on hover via `title` attribute
  - Small × dismiss button
  - Uses CSS class `.reload-model-bar` with gradient background

- **Trigger Logic**: Button only appears when:
  1. User navigates to a DIFFERENT conversation (tracked via `lastCheckedConvRef`)
  2. That conversation has a saved `last_model` that differs from current model
  3. Does NOT appear when user changes models within the same conversation

---

*This document should serve as the complete reference for any developer working on this codebase.*

---

### Prompt Library Implementation

- **Goal**: Create a system for saving, managing, and reusing custom prompt templates, including support for image attachments for vision models (Qwen, Wan 2.2).

- **Database Changes** (`database.ts`):
  - New `prompt_library` table:
    - `id` (UUID)
    - `name`, `description` (TEXT)
    - `system_prompt` (TEXT)
    - `images` (TEXT - JSON array of base64 strings)
    - `target_type` ('wan2.2', 'qwen', 'any')
    - `requires_vision` (BOOLEAN)
    - `created_at`, `updated_at` (TEXT)

- **Architecture**:
  - **Backend**: IPC handlers in `storage/index.ts` map to `better-sqlite3` operations.
    - `db:get-prompt-library`, `db:add-prompt-library`, `db:update-prompt-library`, `db:delete-prompt-library`.
  - **State Management**: `promptLibraryStore.ts` (Zustand) handles the frontend state, including loading templates, managing the search filter, and handling the complex creation/editing flow with image uploads.
  - **UI**:
    - `PromptLibrary.tsx`: A responsive sidebar panel component integrated into the global `Sidebar.tsx`.
    - Automatically displays when user switches to 'Prompt Studio' view.
    - Features: Search, Create/Edit Form, Image Drag & Drop (via file dialog), Active Template Selection.
  - **Integration**:
    - `PromptGenerator.tsx` checks `usePromptLibraryStore.activeTemplateId`.
    - If active, `generatePrompt()` overrides the default system prompt with the one from the library.
    - Handles attaching the stored base64 images to the LLM request if the model supports vision.

- **Key Technical Details**:
  - **Image Storage**: Images are stored directly in the SQLite database as base64 strings within a JSON array. While not suitable for massive datasets, this is efficient for small prompt attachments (mockups, reference images) in a local desktop app context.
  - **Sidebar Location**: The Prompt Library was explicitly moved to the left global sidebar to replace the chat history when in Prompt Studio mode, providing a cleaner layout than a 3-column design.
  - **CSS Styling**: Custom styles in `index.css` under `.prompt-library` ensure the component blends with the application's sidebar theme (transparent backgrounds, hover effects, consistent typography).
Your text here
</div>Copied!   