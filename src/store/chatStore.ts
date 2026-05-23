import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from './appStore.ts';
import { useChatSettingsStore } from './chatSettingsStore.ts';
import { useTTSStore } from './ttsStore.ts';

export interface Message {
    id: string;
    conversation_id: string;
    parent_id: string | null;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | any[]; // string for text, array for multimodal (text + images)
    model?: string;
    created_at?: string;
}

export interface Conversation {
    id: string;
    title: string;
    updated_at: string;
}

const SENTENCE_BOUNDARY_REGEX = /[.!?]+["')\]]*(?:\s|$)/g;
const CLAUSE_BOUNDARY_REGEX = /[,;:][\s\n]+|\.{3,}(?:\s|$)|\n+/g;
const DEFAULT_TTS_CHUNK_TARGET_LENGTH = 450;
const MIN_TTS_CHUNK_TARGET_LENGTH = 160;
const MAX_TTS_CHUNK_TARGET_LENGTH = 900;

interface TTSPlaybackSnapshot {
    enabled: boolean;
    voice: string;
    rate: string;
    pitch: string;
    chunkTarget: number;
}

function normalizeSpeakableText(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^[\s>]*#{1,6}\s+/gm, '')
        .replace(/^[\s>*-]*(?:[-*+]|\d+[.)])\s+/gm, '')
        .replace(/[*_~#]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isSpeakableText(text: string): boolean {
    return /[\p{L}\p{N}]/u.test(text);
}

function isQwenLikeModel(model: string): boolean {
    return /qwen/i.test(model);
}

function getMessageContentPreview(content: string | any[], maxLength = 42): string {
    const text = Array.isArray(content)
        ? content.find((part: any) => part?.type === 'text')?.text || ''
        : content;

    const singleLine = String(text || '').replace(/\s+/g, ' ').trim();
    if (!singleLine) return '';
    return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength).trim()}...` : singleLine;
}

function applyThinkingMode(history: any[], model: string, mode: 'auto' | 'no_think' | 'think'): any[] {
    if (mode === 'auto') return history;

    const nextHistory = history.map(message => ({ ...message }));
    const systemMessage = nextHistory.find(message => message.role === 'system');
    const directInstruction = mode === 'no_think'
        ? 'Answer directly. Do not reveal or include hidden reasoning, chain-of-thought, or thinking traces.'
        : 'Use deliberate reasoning before answering when the model supports it.';

    if (systemMessage && typeof systemMessage.content === 'string' && !systemMessage.content.includes(directInstruction)) {
        systemMessage.content = `${systemMessage.content.trim()}\n\n${directInstruction}`;
    }

    if (!isQwenLikeModel(model)) return nextHistory;

    const controlToken = mode === 'no_think' ? '/no_think' : '/think';
    const lastUserIndex = nextHistory.map(message => message.role).lastIndexOf('user');
    if (lastUserIndex < 0) return nextHistory;

    const lastUser = nextHistory[lastUserIndex];
    if (typeof lastUser.content === 'string') {
        if (!lastUser.content.includes(controlToken)) {
            lastUser.content = `${lastUser.content.trim()}\n\n${controlToken}`;
        }
        return nextHistory;
    }

    if (Array.isArray(lastUser.content)) {
        lastUser.content = lastUser.content.map((part: any) => {
            if (part?.type !== 'text') return part;
            const text = part.text || '';
            return text.includes(controlToken) ? part : { ...part, text: `${text.trim()}\n\n${controlToken}` };
        });
    }

    return nextHistory;
}

function removeThinkingTraces(text: string, hideOpenBlock = true): string {
    let cleaned = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');

    if (hideOpenBlock) {
        cleaned = cleaned.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
    }

    const hasPlainThinkingStart = /^\s*(?:here(?:'|’)s\s+(?:a\s+)?(?:thinking|reasoning)\s+process|thinking\s+process|reasoning\s+process|thought\s+process|internal\s+reasoning|chain[-\s]*of[-\s]*thought)\s*:/i.test(cleaned);
    if (hasPlainThinkingStart) {
        const lines = cleaned.split(/\r?\n/);
        const finalLineIndex = lines.findLastIndex(line =>
            /^\s*(?:\d+[.)]\s*)?(?:final\s+(?:output\s+generation|answer|response)|answer|response)\s*:/i.test(line)
        );

        if (finalLineIndex >= 0) {
            const tail = lines.slice(finalLineIndex + 1).join('\n').trim();
            if (tail) return tail;

            const finalLine = lines[finalLineIndex];
            const quoted = finalLine.match(/["“]([^"”]+)["”]/);
            if (quoted?.[1]) return quoted[1].trim();

            return finalLine.replace(/^\s*(?:\d+[.)]\s*)?(?:final\s+(?:output\s+generation|answer|response)|answer|response)\s*:\s*/i, '').trim();
        }

        if (hideOpenBlock) return '';
    }

    return cleaned
        .replace(/<\/think>/gi, '')
        .replace(/^\s*(?:here(?:'|’)s\s+(?:a\s+)?(?:thinking|reasoning)\s+process|thinking\s+process|reasoning\s+process|thought\s+process|internal\s+reasoning|chain[-\s]*of[-\s]*thought)\s*:[\s\S]*?(?=\n\s*(?:final\s+(?:answer|response)|answer|response)\s*:)/i, '')
        .replace(/^\s*(?:thinking|thoughts?|reasoning)\s*:\s*[\s\S]*?(?=\n\s*(?:answer|response)\s*:)/i, '')
        .replace(/^\s*(?:answer|response)\s*:\s*/i, '')
        .trimStart();
}

function normalizeRate(rate: string | undefined): string {
    if (!rate) return '+0%';
    return rate.startsWith('+') || rate.startsWith('-') ? rate : `+${rate}`;
}

function normalizePitch(pitch: string | undefined): string {
    if (!pitch) return '+0Hz';
    return pitch.startsWith('+') || pitch.startsWith('-') ? pitch : `+${pitch}`;
}

function getTTSChunkSizing(targetLength: number) {
    const target = Math.min(MAX_TTS_CHUNK_TARGET_LENGTH, Math.max(MIN_TTS_CHUNK_TARGET_LENGTH, targetLength || DEFAULT_TTS_CHUNK_TARGET_LENGTH));
    return {
        minLength: Math.max(90, Math.round(target * 0.65)),
        targetLength: target,
        maxLength: Math.round(target * 1.25),
    };
}

function findFallbackSplitIndex(text: string, minLength: number, maxLength: number): number {
    let fallbackSplitIndex = -1;
    CLAUSE_BOUNDARY_REGEX.lastIndex = 0;
    let clauseMatch: RegExpExecArray | null;

    while ((clauseMatch = CLAUSE_BOUNDARY_REGEX.exec(text)) !== null) {
        const candidateIndex = clauseMatch.index + clauseMatch[0].length;
        if (candidateIndex >= minLength && candidateIndex <= maxLength) {
            fallbackSplitIndex = candidateIndex;
        }
        if (candidateIndex > maxLength) {
            break;
        }
    }

    if (fallbackSplitIndex === -1) {
        const lastWhitespace = text.lastIndexOf(' ', maxLength);
        if (lastWhitespace >= minLength) {
            fallbackSplitIndex = lastWhitespace + 1;
        }
    }

    return fallbackSplitIndex;
}

function extractSpeakableSegments(buffer: string, targetLength = DEFAULT_TTS_CHUNK_TARGET_LENGTH): { segments: string[]; consumedLength: number } {
    const { minLength, targetLength: effectiveTargetLength, maxLength } = getTTSChunkSizing(targetLength);
    const segments: string[] = [];
    let consumedLength = 0;
    let batchStart = 0;
    let scanIndex = 0;
    let sentencesInBatch = 0;

    while (scanIndex < buffer.length) {
        SENTENCE_BOUNDARY_REGEX.lastIndex = scanIndex;
        const sentenceMatch = SENTENCE_BOUNDARY_REGEX.exec(buffer);

        if (!sentenceMatch) {
            break;
        }

        const sentenceEndIndex = sentenceMatch.index + sentenceMatch[0].length;
        const candidateRaw = buffer.slice(batchStart, sentenceEndIndex);
        const candidate = normalizeSpeakableText(candidateRaw);
        sentencesInBatch += 1;

        const shouldEmit =
            candidate.length >= effectiveTargetLength ||
            (candidate.length >= minLength && sentencesInBatch >= 2) ||
            candidateRaw.length >= maxLength;

        if (shouldEmit) {
            let splitIndex = sentenceEndIndex;

            if (candidateRaw.length > maxLength) {
                const fallbackSplitIndex = findFallbackSplitIndex(candidateRaw, minLength, maxLength);
                if (fallbackSplitIndex !== -1) {
                    splitIndex = batchStart + fallbackSplitIndex;
                }
            }

            const segment = normalizeSpeakableText(buffer.slice(batchStart, splitIndex));
            if (isSpeakableText(segment)) {
                segments.push(segment);
            }
            consumedLength = splitIndex;
            batchStart = splitIndex;
            scanIndex = splitIndex;
            sentencesInBatch = 0;
        } else {
            scanIndex = sentenceEndIndex;
        }
    }

    const remainingText = buffer.slice(batchStart);
    if (remainingText.length >= maxLength) {
        const fallbackSplitIndex = findFallbackSplitIndex(remainingText, minLength, maxLength);

        if (fallbackSplitIndex !== -1) {
            const segment = normalizeSpeakableText(remainingText.slice(0, fallbackSplitIndex));
            if (isSpeakableText(segment)) {
                segments.push(segment);
            }
            consumedLength = batchStart + fallbackSplitIndex;
        }
    }

    return { segments, consumedLength };
}

interface ChatState {
    conversations: Conversation[];
    currentConversationId: string | null;
    messages: Message[];
    isStreaming: boolean;
    // Model loading progress
    loadProgress: {
        model: string;
        progress: number;
        status: 'starting' | 'loading' | 'ready';
    } | null;
    // Telemetry
    telemetry: {
        startTime: number | null;
        firstTokenTime: number | null;
        tokenCount: number;
        endTime: number | null;
    } | null;

    setConversations: (convs: Conversation[]) => void;
    setCurrentConversation: (id: string | null) => void;
    setMessages: (msgs: Message[]) => void;
    setStreaming: (streaming: boolean) => void;
    setLoadProgress: (progress: { model: string; progress: number; status: 'starting' | 'loading' | 'ready' } | null) => void;

    loadConversations: () => Promise<void>;
    loadMessages: (conversationId: string) => Promise<void>;
    createNewConversation: () => Promise<string>;
    sendMessage: (content: string, model: string, images?: string[]) => Promise<void>;
    deleteConversation: (id: string) => Promise<void>;
    renameConversation: (id: string, title: string) => Promise<void>;
    branchConversation: (messageId: string) => Promise<string | null>;
    generateTitle: (conversationId: string, userMsg: string, aiMsg: string, model: string) => Promise<void>;
    editMessage: (messageId: string, content: string | any[], truncateAfter?: boolean) => Promise<void>;
    deleteMessage: (messageId: string) => Promise<void>;
    retryMessage: (messageId: string, model: string) => Promise<void>;
    continueResponse: (model: string) => Promise<void>;
    stopEverything: () => Promise<void>;
    emergencyEjectModels: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
    conversations: [],
    currentConversationId: null,
    messages: [],
    isStreaming: false,
    loadProgress: null,
    telemetry: null,

    setConversations: (conversations) => set({ conversations }),
    setCurrentConversation: (id) => set({ currentConversationId: id }),
    setMessages: (messages) => set({ messages }),
    setStreaming: (isStreaming) => set({ isStreaming }),
    setLoadProgress: (progress) => set({ loadProgress: progress }),

    stopEverything: async () => {
        useTTSStore.getState().stop();
        set({ isStreaming: false, loadProgress: null });
        try {
            await window.ipcRenderer.abortChat();
        } catch (error) {
            console.error('[ChatStore] Failed to abort chat:', error);
        }
    },

    emergencyEjectModels: async () => {
        useTTSStore.getState().clearWarning();
        await get().stopEverything();
        try {
            await window.ipcRenderer.cleanupLLM();
            await window.ipcRenderer.stopService('omnivoice');
        } catch (error) {
            console.error('[ChatStore] Failed to eject models:', error);
        }
    },

    loadConversations: async () => {
        const convs = await window.ipcRenderer.getConversations();
        set({ conversations: convs });
    },

    loadMessages: async (conversationId) => {
        console.log('[ChatStore] loadMessages called for:', conversationId);
        try {
            const msgs = await window.ipcRenderer.getMessages(conversationId);
            console.log('[ChatStore] Got messages:', msgs?.length);
            set({ messages: msgs || [] });
        } catch (err) {
            console.error('[ChatStore] loadMessages error:', err);
            set({ messages: [] });
        }
    },

    createNewConversation: async () => {
        try {
            console.log('Creating new conversation...');
            const id = uuidv4();
            await window.ipcRenderer.createConversation(id, 'New Conversation');
            console.log('Conversation created in DB, reloading list...');
            await get().loadConversations();
            set({ currentConversationId: id, messages: [] });
            await useChatSettingsStore.getState().loadSettings(id);

            const { model, models } = useAppStore.getState();
            const selectedModelInfo = models.find((item: any) => item.id === model);
            useChatSettingsStore.getState().applyModelDefaults(selectedModelInfo);
            await useChatSettingsStore.getState().saveSection('modelSettings');

            return id;
        } catch (error) {
            console.error('Failed to create conversation:', error);
            throw error;
        }
    },

    renameConversation: async (id, title) => {
        await window.ipcRenderer.updateConversationTitle(id, title);
        await get().loadConversations();
    },

    deleteConversation: async (id) => {
        await window.ipcRenderer.deleteConversation(id);
        await get().loadConversations();
        if (get().currentConversationId === id) {
            set({ currentConversationId: null, messages: [] });
        }
    },

    branchConversation: async (messageId) => {
        const { messages, currentConversationId, isStreaming } = get();
        if (!currentConversationId || isStreaming) return null;

        const branchPoint = messages.find(message => message.id === messageId);
        if (!branchPoint) return null;

        const sourceConversation = await window.ipcRenderer.getConversation(currentConversationId);
        const sourceTitle = sourceConversation?.title || 'Conversation';
        const preview = getMessageContentPreview(branchPoint.content);
        const branchTitle = preview
            ? `${sourceTitle} - branch: ${preview}`
            : `${sourceTitle} - branch`;
        const newConversationId = uuidv4();

        await window.ipcRenderer.branchConversation(
            currentConversationId,
            messageId,
            newConversationId,
            branchTitle
        );

        await get().loadConversations();
        const branchMessages = await window.ipcRenderer.getMessages(newConversationId);
        set({
            currentConversationId: newConversationId,
            messages: branchMessages || [],
        });
        await useChatSettingsStore.getState().loadSettings(newConversationId);

        return newConversationId;
    },

    sendMessage: async (content, model, images) => {
        // Don't destructure at top level to avoid stale state
        const state = get();
        if (state.isStreaming) return;

        let convId = state.currentConversationId;

        // If no conversation selected, create one
        if (!convId) {
            convId = await get().createNewConversation();
            // Note: createNewConversation updates store, but our local 'state' var is now stale regarding messages
        }

        // Always re-fetch messages to ensure we have the latest list (especially if new chat was just created)
        const currentMessages = get().messages;

        // Build user message content (text only or multimodal with images)
        let userContent: any = content;
        if (images && images.length > 0) {
            // Multimodal format: array of content parts
            userContent = [
                { type: 'text', text: content }
            ];
            // Add image URLs
            for (const imgDataUrl of images) {
                userContent.push({
                    type: 'image_url',
                    image_url: { url: imgDataUrl }
                });
            }
        }

        const userMessage: Message = {
            id: uuidv4(),
            conversation_id: convId,
            // Link to the last message if it exists
            parent_id: currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : null,
            role: 'user',
            content: userContent,
            model // Track which model is being used
        };

        // Save user message with model
        await window.ipcRenderer.saveMessage(userMessage);

        // Update conversation with last used model AND provider
        console.log('[ChatStore] Saving last_model to conversation:', convId);
        console.log('[ChatStore] Model value being saved:', model, 'Type:', typeof model, 'Length:', model?.length);
        if (model && model.length > 0) {
            const provider = useAppStore.getState().provider;
            await window.ipcRenderer.updateConversationSettings(convId, {
                last_model: model,
                last_provider: provider
            });
            console.log('[ChatStore] Successfully saved last_model and last_provider:', model, provider);
        } else {
            console.warn('[ChatStore] WARNING: model is empty, not saving last_model');
        }

        // Update store with new user message
        const updatedMessages = [...currentMessages, userMessage];
        set({ messages: updatedMessages });

        // Get per-chat settings from chatSettingsStore (used for auto-play and LLM config)
        const chatSettings = useChatSettingsStore.getState().current;
        const ttsState = useTTSStore.getState();
        const assistantTTSSnapshot: TTSPlaybackSnapshot = {
            enabled: chatSettings.autoPlay,
            voice: chatSettings.aiVoice || ttsState.selectedVoice,
            rate: normalizeRate(chatSettings.aiRate),
            pitch: normalizePitch(chatSettings.aiPitch),
            chunkTarget: chatSettings.ttsChunkTarget,
        };

        // Auto-play user message if userAutoPlay is enabled
        if (chatSettings.userAutoPlay) {
            const textContent = typeof content === 'string' ? content : content;
            useTTSStore.getState().addToQueue(textContent, userMessage.id, false, {
                voice: chatSettings.userVoice || ttsState.selectedVoice,
                rate: normalizeRate(chatSettings.userRate),
                pitch: normalizePitch(chatSettings.userPitch),
            });
        }

        // Prepare assistant message
        const assistantMessageId = uuidv4();
        const assistantMessage: Message = {
            id: assistantMessageId,
            conversation_id: convId,
            parent_id: userMessage.id,
            role: 'assistant',
            content: ''
        };

        set({
            isStreaming: true,
            messages: [...updatedMessages, assistantMessage],
            loadProgress: useAppStore.getState().provider === 'lmstudio'
                ? { model, progress: 0, status: 'starting' }
                : null,
            telemetry: { startTime: Date.now(), firstTokenTime: null, tokenCount: 0, endTime: null }
        });

        // Build history for LLM
        const systemPrompt = chatSettings.systemPrompt || 'You are a helpful AI assistant.';

        let history: any[] = updatedMessages.map(m => ({ role: m.role, content: m.content }));

        // Prepend System Prompt
        if (history.length === 0 || history[0].role !== 'system') {
            history.unshift({ role: 'system', content: systemPrompt });
        }

        history = applyThinkingMode(history, model, chatSettings.thinkingMode);

        console.log('[ChatStore] Sending history to LLM:', history);

        // Get LLM settings from per-chat chatSettingsStore (NOT appStore)
        const config = {
            model,
            temperature: chatSettings.temperature,
            max_tokens: chatSettings.maxTokens,
            contextLength: chatSettings.contextLength,
            topKSampling: chatSettings.topK,
            topPSampling: chatSettings.topP,
            repeatPenalty: chatSettings.repeatPenalty
        };

        console.log('[ChatStore] Chat config:', config);

        let rawContent = '';
        let fullContent = '';
        let lastTTSCheckpoint = 0; // Track how much text has been sent to TTS
        let cleanup: (() => void) | null = null;
        const shouldHideThinking = chatSettings.thinkingMode === 'no_think';

        cleanup = window.ipcRenderer.onChatChunk((chunk: any) => {
            if (chunk.error) {
                console.error('Chat error:', chunk.error);
                set({ isStreaming: false });
                cleanup?.();
                return;
            }

            if (chunk.done) {
                fullContent = shouldHideThinking ? removeThinkingTraces(rawContent) : rawContent;
                const endTime = Date.now();
                const tel = get().telemetry;
                set({
                    isStreaming: false,
                    telemetry: tel ? { ...tel, endTime } : null
                });

                // Speak any remaining text in the buffer
                if (assistantTTSSnapshot.enabled) {
                    const remainingText = normalizeSpeakableText(fullContent.slice(lastTTSCheckpoint));
                    if (isSpeakableText(remainingText)) {
                        useTTSStore.getState().addToQueue(remainingText, assistantMessageId, true, assistantTTSSnapshot);
                    }
                }

                // Save full message to DB with model
                window.ipcRenderer.saveMessage({
                    ...assistantMessage,
                    content: fullContent,
                    model
                });

                // Auto-generate title if this is the first exchange
                const msgsNow = get().messages;
                const contentMsgs = msgsNow.filter(m => m.role === 'user' || m.role === 'assistant');

                cleanup?.();

                if (contentMsgs.length <= 2) {
                    get().generateTitle(convId!, content, fullContent, model);
                }

                set(state => ({
                    messages: state.messages.map(m =>
                        m.id === assistantMessageId ? { ...m, content: fullContent } : m
                    )
                }));

                return;
            }

            if (chunk.content) {
                // Track telemetry
                const tel = get().telemetry;
                if (tel) {
                    const now = Date.now();
                    const firstTokenTime = tel.firstTokenTime || now;
                    set({
                        telemetry: {
                            ...tel,
                            firstTokenTime,
                            tokenCount: tel.tokenCount + 1
                        }
                    });
                }

                rawContent += chunk.content || '';
                fullContent = shouldHideThinking ? removeThinkingTraces(rawContent) : rawContent;

                if (assistantTTSSnapshot.enabled) {
                    const unsentBuffer = fullContent.slice(lastTTSCheckpoint);
                    const { segments, consumedLength } = extractSpeakableSegments(unsentBuffer, assistantTTSSnapshot.chunkTarget);

                    for (const segment of segments) {
                        useTTSStore.getState().addToQueue(segment, assistantMessageId, true, assistantTTSSnapshot);
                    }

                    if (consumedLength > 0) {
                        lastTTSCheckpoint += consumedLength;
                    }
                }

                set(state => ({
                    messages: state.messages.map(m =>
                        m.id === assistantMessageId ? { ...m, content: fullContent } : m
                    )
                }));
            }
        });

        // Clear TTS queue before generation starts to prevent overlap.
        if (assistantTTSSnapshot.enabled) {
            useTTSStore.getState().stop();
        }

        // Start LLM chat only after the stream listener is attached.
        window.ipcRenderer.chat(history, config);
    },

    generateTitle: async (conversationId: string, userMsg: string, aiMsg: string, model: string) => {
        console.log('Auto-generating title...');
        const prompt = `Summarize this conversation in 3 to 5 words for a catchy title. Output ONLY the title text, no quotes, no "Title:", no markdown.\n\nUser: ${userMsg} \nAI: ${aiMsg} `;

        let title = '';

        let cleanup: (() => void) | null = null;

        cleanup = window.ipcRenderer.onChatChunk(async (chunk: any) => {
            if (chunk.content) {
                title += chunk.content;
            }
            if (chunk.done) {
                cleanup?.();
                // Clean up the title: remove quotes, markdown, and limit length
                let cleanTitle = title.trim()
                    .replace(/^["'`]+|["'`]+$/g, '')  // Remove leading/trailing quotes
                    .replace(/^#+\s*/g, '')           // Remove markdown headers
                    .replace(/\*+/g, '')              // Remove asterisks
                    .replace(/Title:\s*/i, '')        // Remove "Title:" prefix
                    .split('\n')[0]                   // Take only first line
                    .trim();

                // Limit to first 6 words max
                const words = cleanTitle.split(/\s+/).slice(0, 6);
                cleanTitle = words.join(' ');

                if (cleanTitle) {
                    console.log('[AutoTitle] Generated:', cleanTitle);
                    await get().renameConversation(conversationId, cleanTitle);
                }
            }
        });

        // We reuse the chat IPC after the main stream listener has been detached.
        window.ipcRenderer.chat([{ role: 'user', content: prompt }], { model });
    },

    editMessage: async (messageId, content, truncateAfter = false) => {
        const { messages, currentConversationId } = get();
        if (!currentConversationId || get().isStreaming) return;

        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        await window.ipcRenderer.updateMessageContent(messageId, content, truncateAfter);

        const updatedMessages = messages.map(m =>
            m.id === messageId ? { ...m, content } : m
        );

        set({
            messages: truncateAfter
                ? updatedMessages.slice(0, msgIndex + 1)
                : updatedMessages
        });

        await get().loadConversations();
    },

    deleteMessage: async (messageId) => {
        const { messages, currentConversationId } = get();
        if (!currentConversationId || get().isStreaming) return;

        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        await window.ipcRenderer.deleteMessageBranch(messageId);
        set({ messages: messages.slice(0, msgIndex) });
        await get().loadConversations();
    },

    retryMessage: async (messageId, model) => {
        const { messages, currentConversationId } = get();
        if (!currentConversationId || get().isStreaming) return;

        // Find the message index
        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        const targetMsg = messages[msgIndex];

        // If it's an AI message, we want to regenerate it
        // Find the preceding user message
        let userMsgContent = '';
        if (targetMsg.role === 'assistant') {
            for (let i = msgIndex - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    const msgContent = messages[i].content;
                    userMsgContent = Array.isArray(msgContent)
                        ? msgContent.find((p: any) => p.type === 'text')?.text || ''
                        : msgContent;
                    break;
                }
            }
        } else {
            const msgContent = targetMsg.content;
            userMsgContent = Array.isArray(msgContent)
                ? msgContent.find((p: any) => p.type === 'text')?.text || ''
                : msgContent;
        }

        // Delete AI message and any messages after it from DB
        const messagesToDelete = messages.slice(msgIndex).filter(m => m.role === 'assistant');
        for (const m of messagesToDelete) {
            await window.ipcRenderer.deleteMessageBranch(m.id);
        }

        // Truncate local messages to just before the AI response
        const truncatedMessages = messages.slice(0, msgIndex);
        set({ messages: truncatedMessages });

        // Re-send with the same user content
        if (userMsgContent) {
            // Directly call sendMessage with the same content
            await get().sendMessage(userMsgContent, model);
        }
    },

    continueResponse: async (model) => {
        const { messages, currentConversationId } = get();
        if (!currentConversationId || get().isStreaming || messages.length === 0) return;

        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        // Send a continuation prompt
        await get().sendMessage('Please continue.', model);
    }
}));

