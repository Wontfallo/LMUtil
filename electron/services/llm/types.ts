// Content can be a string or array of content parts for multimodal
export type MessageContent = string | ContentPart[];

export interface ContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string; // base64 data URL or http URL
    };
}

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: MessageContent;
}

export interface ChatConfig {
    model: string;
    temperature?: number;
    max_tokens?: number;
    // LM Studio advanced settings
    contextLength?: number;
    topKSampling?: number;
    topPSampling?: number;
    repeatPenalty?: number;
    minPSampling?: number;
    contextOverflowPolicy?: 'stopAtLimit' | 'truncateMiddle' | 'rollingWindow';
}

export interface StreamChunk {
    content?: string;
    done: boolean;
    error?: string;
    aborted?: boolean;
}

export interface ModelInfo {
    id: string;
    name: string;
    provider: 'ollama' | 'lmstudio';
    // Capability flags
    hasVision?: boolean;
    hasTools?: boolean;
    maxContext?: number;
    architecture?: string;
    quantization?: string;
    paramsString?: string;
    loadedContextLength?: number;
    loadedInstanceCount?: number;
}

export interface ModelDownloadStatus {
    job_id?: string;
    status: 'downloading' | 'paused' | 'completed' | 'failed' | 'already_downloaded';
    requested_model?: string;
    requested_quantization?: string;
    total_size_bytes?: number;
    downloaded_bytes?: number;
    bytes_per_second?: number;
    estimated_completion?: string;
    started_at?: string;
    completed_at?: string;
    error?: string;
}

export interface LLMProvider {
    listModels(): Promise<ModelInfo[]>;
    chat(messages: Message[], config: ChatConfig, signal?: AbortSignal): AsyncIterable<StreamChunk>;
    unloadModel(modelId: string): Promise<void>;
    stopRunning(): Promise<void>;
}
