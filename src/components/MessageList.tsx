import React, { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chatStore.ts';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Sparkles, Volume2, Play, Pause, Square, Copy, Check, Download, RefreshCw, ArrowRight, Pencil, Trash2, Save, X } from 'lucide-react';
import { useTTSStore } from '../store/ttsStore.ts';
import { useAppStore } from '../store/appStore.ts';

const CopyButton = ({ content }: { content: string }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button className="code-action-btn" onClick={handleCopy} title="Copy Code">
            {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
        </button>
    );
};

const DownloadButton = ({ content, language }: { content: string, language: string }) => {
    const handleDownload = () => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snippet.${language}`; // e.g. snippet.python or snippet.js
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <button className="code-action-btn" onClick={handleDownload} title="Download Code">
            <Download size={14} />
        </button>
    );
};

import { useChatSettingsStore } from '../store/chatSettingsStore.ts';

// Format message timestamp
const formatMessageTime = (dateStr?: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
        return timeStr;
    }

    // If not today, include the date
    const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const dateFormatted = date.toLocaleDateString([], dateOptions);
    return `${dateFormatted} ${timeStr}`;
};

const getMessageText = (content: string | any[]): string => {
    if (!Array.isArray(content)) return content;
    return content.find((part: any) => part.type === 'text')?.text || '';
};

const setMessageText = (content: string | any[], text: string): string | any[] => {
    if (!Array.isArray(content)) return text;

    let replaced = false;
    const nextContent = content.map((part: any) => {
        if (part.type !== 'text') return part;
        replaced = true;
        return { ...part, text };
    });

    return replaced ? nextContent : [{ type: 'text', text }, ...nextContent];
};

const MessageList: React.FC = () => {
    const { messages, currentConversationId, loadMessages, editMessage, deleteMessage, retryMessage, continueResponse, isStreaming } = useChatStore();
    const { model, models } = useAppStore();
    const { play, pause, resume, stop, isPlaying, isPaused, currentMessageId } = useTTSStore();
    const { current: chatSettings, loadSettings } = useChatSettingsStore();
    const { setModel, setProvider } = useAppStore();

    // Track last checked conversation to avoid re-prompting
    const lastCheckedConvRef = useRef<string | null>(null);

    // Load messages and conversation settings when conversation changes
    useEffect(() => {
        if (currentConversationId) {
            console.log('[MessageList] Loading messages for:', currentConversationId);
            loadMessages(currentConversationId);

            // Load per-chat settings from chatSettingsStore
            loadSettings(currentConversationId);

            // Only check for previous model when ENTERING a different conversation
            // (not when model/models change within the same conversation)
            if (lastCheckedConvRef.current !== currentConversationId) {
                lastCheckedConvRef.current = currentConversationId;

                const checkModel = async () => {
                    try {
                        const conv = await window.ipcRenderer.getConversation(currentConversationId);
                        console.log('[MessageList] Conversation:', conv?.id, 'last_model:', conv?.last_model, 'last_provider:', conv?.last_provider, 'current:', model);

                        // Only prompt if chat has a saved model that's different from current
                        if (conv?.last_model && conv.last_model !== model) {
                            console.log('[MessageList] Showing model prompt (different model)');
                            setModelPrompt({
                                show: true,
                                lastModel: conv.last_model,
                                lastProvider: conv.last_provider || null
                            });
                        }
                    } catch (err) {
                        console.error('[MessageList] Failed to check conversation:', err);
                    }
                };
                checkModel();
            }
        }
    }, [currentConversationId, loadMessages, loadSettings]); // Removed model and models from deps

    // Auto-scroll to bottom when messages change or during streaming
    const listRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // State for model prompt dialog
    const [modelPrompt, setModelPrompt] = useState<{
        show: boolean;
        lastModel: string | null;
        lastProvider: 'ollama' | 'lmstudio' | null
    }>({ show: false, lastModel: null, lastProvider: null });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftContent, setDraftContent] = useState('');

    const startEditing = (msg: any) => {
        setEditingId(msg.id);
        setDraftContent(getMessageText(msg.content));
    };

    const cancelEditing = () => {
        setEditingId(null);
        setDraftContent('');
    };

    const saveEditing = async (msg: any, index: number) => {
        const truncateAfter = index < messages.length - 1;
        if (truncateAfter) {
            const confirmed = await window.ipcRenderer.confirmDialog({
                title: 'Edit message',
                message: 'Edit this message and remove later replies?',
                detail: 'Later replies were generated from the old message text, so they will be deleted from this point onward.',
                confirmLabel: 'Edit and delete later replies',
                cancelLabel: 'Cancel'
            });
            if (!confirmed) return;
        }

        await editMessage(msg.id, setMessageText(msg.content, draftContent), truncateAfter);
        cancelEditing();
    };

    const handleDelete = async (msg: any, index: number) => {
        const truncateAfter = index < messages.length - 1;
        const confirmed = await window.ipcRenderer.confirmDialog({
            title: 'Delete message',
            message: truncateAfter ? 'Delete this message and all later replies?' : 'Delete this message?',
            detail: truncateAfter
                ? 'This keeps the chat history consistent from this point onward.'
                : 'This cannot be undone.',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel'
        });
        if (!confirmed) return;

        if (editingId === msg.id) cancelEditing();
        await deleteMessage(msg.id);
    };

    useEffect(() => {
        const timeout = setTimeout(() => {
            if (listRef.current) {
                listRef.current.scrollTop = listRef.current.scrollHeight;
            }
        }, 50);
        return () => clearTimeout(timeout);
    }, [messages, isStreaming]);




    return (
        <div className="message-list" ref={listRef}>
            {messages.map((msg, index) => (
                <div key={msg.id} className={`message-wrapper ${msg.role}`}>
                    <div className="message-container">
                        <div className="avatar-area">
                            {msg.role === 'user' ? (
                                chatSettings.userAvatar ? (
                                    <img
                                        src={chatSettings.userAvatar}
                                        alt="User"
                                        className="avatar user-avatar-img"
                                        style={{ objectPosition: `center ${chatSettings.userAvatarPosition}%` }}
                                    />
                                ) : (
                                    <div className="avatar user-avatar"><User size={20} /></div>
                                )
                            ) : (
                                chatSettings.aiAvatar ? (
                                    <img
                                        src={chatSettings.aiAvatar}
                                        alt="AI"
                                        className="avatar ai-avatar-img"
                                        style={{ objectPosition: `center ${chatSettings.aiAvatarPosition}%` }}
                                    />
                                ) : (
                                    <div className="avatar ai-avatar"><Sparkles size={20} /></div>
                                )
                            )}
                        </div>

                        <div className="message-content">
                            <div className="message-header">
                                <span className="sender-name">{msg.role === 'user' ? chatSettings.userName : chatSettings.aiName}</span>
                                {msg.created_at && <span className="message-timestamp">{formatMessageTime(msg.created_at)}</span>}
                                {/* TTS controls for both user and assistant messages */}
                                <div className="tts-controls">
                                    {currentMessageId === msg.id && (isPlaying || isPaused) ? (
                                        <>
                                            {isPlaying ? (
                                                <button className="tts-btn pause" onClick={() => pause()} title="Pause">
                                                    <Pause size={14} />
                                                </button>
                                            ) : (
                                                <button className="tts-btn play" onClick={() => resume()} title="Resume">
                                                    <Play size={14} />
                                                </button>
                                            )}
                                            <button className="tts-btn stop" onClick={() => stop()} title="Stop">
                                                <Square size={14} fill="currentColor" />
                                            </button>
                                        </>
                                    ) : (
                                        <button className="tts-btn play" onClick={() => {
                                            const textContent = Array.isArray(msg.content)
                                                ? msg.content.find((p: any) => p.type === 'text')?.text || ''
                                                : msg.content;
                                            // Pass isAiMessage=false for user messages
                                            play(textContent, msg.id, msg.role === 'assistant');
                                        }} title="Read Aloud">
                                            <Volume2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {editingId === msg.id ? (
                                <div className="message-edit-panel">
                                    <textarea
                                        className="message-edit-textarea"
                                        value={draftContent}
                                        onChange={(event) => setDraftContent(event.target.value)}
                                        autoFocus
                                        rows={Math.min(12, Math.max(4, draftContent.split('\n').length + 1))}
                                    />
                                    <div className="message-edit-actions">
                                        <button
                                            className="msg-action-btn edit"
                                            onClick={() => saveEditing(msg, index)}
                                            title="Save edit"
                                        >
                                            <Save size={12} /> Save
                                        </button>
                                        <button
                                            className="msg-action-btn"
                                            onClick={cancelEditing}
                                            title="Cancel edit"
                                        >
                                            <X size={12} /> Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                            <div className="markdown-body">
                                {/* Render images if content is multimodal array */}
                                {Array.isArray(msg.content) && (
                                    <div className="message-images">
                                        {msg.content
                                            .filter((part: any) => part.type === 'image_url')
                                            .map((part: any, idx: number) => (
                                                <img
                                                    key={idx}
                                                    src={part.image_url?.url}
                                                    alt={`Attached image ${idx + 1}`}
                                                    className="message-image"
                                                />
                                            ))
                                        }
                                    </div>
                                )}
                                {/* Render text content */}
                                <ReactMarkdown
                                    components={{
                                        code({ node, inline, className, children, ...props }: any) {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const codeContent = String(children).replace(/\n$/, '');

                                            // Helper component for tool buttons
                                            if (!inline && match) {
                                                return (
                                                    <div className="code-block-wrapper">
                                                        <div className="code-block-header">
                                                            <span className="code-lang">{match[1]}</span>
                                                            <div className="code-actions">
                                                                <CopyButton content={codeContent} />
                                                                <DownloadButton content={codeContent} language={match[1]} />
                                                            </div>
                                                        </div>
                                                        <SyntaxHighlighter
                                                            style={atomDark}
                                                            language={match[1]}
                                                            PreTag="div"
                                                            customStyle={{ margin: 0, borderRadius: '0 0 8px 8px' }}
                                                            {...props}
                                                        >
                                                            {codeContent}
                                                        </SyntaxHighlighter>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <code className={className} {...props}>
                                                    {children}
                                                </code>
                                            );
                                        },
                                    }}
                                >
                                    {/* Extract text from array content or use string directly */}
                                    {Array.isArray(msg.content)
                                        ? msg.content.find((part: any) => part.type === 'text')?.text || ''
                                        : msg.content
                                    }
                                </ReactMarkdown>
                            </div>
                            )}
                            {/* Message Actions */}
                            {!isStreaming && editingId !== msg.id && (
                                <div className="message-actions">
                                    <button
                                        className="msg-action-btn edit"
                                        onClick={() => startEditing(msg)}
                                        title="Edit message"
                                    >
                                        <Pencil size={12} /> Edit
                                    </button>
                                    <button
                                        className="msg-action-btn delete"
                                        onClick={() => handleDelete(msg, index)}
                                        title="Delete message"
                                    >
                                        <Trash2 size={12} /> Delete
                                    </button>
                                    {msg.role === 'assistant' && (
                                        <>
                                    <button
                                        className="msg-action-btn retry"
                                        onClick={() => retryMessage(msg.id, model)}
                                        title="Regenerate response"
                                    >
                                        <RefreshCw size={12} /> Retry
                                    </button>
                                    {messages.indexOf(msg) === messages.length - 1 && (
                                        <button
                                            className="msg-action-btn"
                                            onClick={() => continueResponse(model)}
                                            title="Continue this response"
                                        >
                                            <ArrowRight size={12} /> Continue
                                        </button>
                                    )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))
            }
            <div ref={bottomRef} />

            {/* Subtle "Reload last model" button - appears when entering old chat with different model */}
            {modelPrompt.show && modelPrompt.lastModel && (
                <div className="reload-model-bar">
                    <button
                        className="reload-model-btn"
                        onClick={async () => {
                            const modelToLoad = modelPrompt.lastModel!;
                            let providerToLoad = modelPrompt.lastProvider;

                            // Infer provider from model format if not saved (old conversations)
                            // Ollama models have :tag format (e.g., "model:8b"), LM Studio models don't
                            if (!providerToLoad) {
                                providerToLoad = modelToLoad.includes(':') ? 'ollama' : 'lmstudio';
                                console.log('[MessageList] Inferred provider from model format:', providerToLoad);
                            }

                            console.log('[MessageList] Reload button clicked - model:', modelToLoad, 'provider:', providerToLoad);
                            setModelPrompt({ show: false, lastModel: null, lastProvider: null });

                            // Switch provider and wait for models
                            console.log('[MessageList] Switching provider to:', providerToLoad);
                            setProvider(providerToLoad);

                            // Wait for the provider switch and models to load
                            await new Promise(resolve => setTimeout(resolve, 500));

                            // Keep trying to set the model as models load
                            for (let i = 0; i < 30; i++) {
                                await window.ipcRenderer.setProvider(providerToLoad);
                                const models = await window.ipcRenderer.listModels();
                                console.log('[MessageList] Got', models.length, 'models, looking for:', modelToLoad);

                                if (models.some((m: any) => m.id === modelToLoad)) {
                                    console.log('[MessageList] Found model, setting it');
                                    setModel(modelToLoad);
                                    return;
                                }
                                await new Promise(r => setTimeout(r, 1000));
                            }
                            console.log('[MessageList] Model not found after retries');
                        }}
                        title={`Load: ${modelPrompt.lastModel}${modelPrompt.lastProvider ? ` (${modelPrompt.lastProvider})` : ''}`}
                    >
                        <RefreshCw size={14} />
                        Reload last model
                    </button>
                    <button
                        className="dismiss-reload-btn"
                        onClick={() => setModelPrompt({ show: false, lastModel: null, lastProvider: null })}
                        title="Dismiss"
                    >
                        ×
                    </button>
                </div>
            )}
        </div >
    );
};

export default MessageList;
