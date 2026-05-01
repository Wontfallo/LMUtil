import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../store/chatStore.ts';
import { useAppStore } from '../store/appStore.ts';
import { useTTSStore } from '../store/ttsStore.ts';
import { Send, Square, Image as ImageIcon, Paperclip, X, Siren } from 'lucide-react';

interface ImageAttachment {
    id: string;
    name: string;
    dataUrl: string;
    thumbnail: string;
}

const ChatInput: React.FC = () => {
    const [input, setInput] = useState('');
    const [images, setImages] = useState<ImageAttachment[]>([]);
    const { sendMessage, isStreaming, stopEverything } = useChatStore();
    const { model, models } = useAppStore();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const selectedModel = models.find((item: any) => item.id === model);
    const attachedImagesNeedVisionModel = images.length > 0 && selectedModel?.hasVision === false;

    const handleSend = () => {
        if ((!input.trim() && images.length === 0) || isStreaming) return;
        // Pass images along with message
        sendMessage(input, model, images.map(img => img.dataUrl));
        setInput('');
        setImages([]);
    };

    const handleStop = async () => {
        await stopEverything();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [input]);

    const handleImageSelect = (files: FileList | null) => {
        if (!files) return;

        Array.from(files).forEach((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                setImages(prev => [...prev, {
                    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    name: file.name,
                    dataUrl,
                    thumbnail: dataUrl
                }]);
            };
            reader.readAsDataURL(file);
        });
    };

    const removeImage = (id: string) => {
        setImages(prev => prev.filter(img => img.id !== id));
    };

    return (
        <div className="input-container">
            {/* Image Previews */}
            {images.length > 0 && (
                <div className="image-previews">
                    {images.map(img => (
                        <div key={img.id} className="image-preview">
                            <img src={img.thumbnail} alt={img.name} />
                            <button className="remove-image" onClick={() => removeImage(img.id)}>
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="input-wrapper">
                <textarea
                    ref={textareaRef}
                    className="chat-textarea"
                    placeholder="Type a message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                />
                <div className="input-actions">
                    <button
                        className="action-btn"
                        onClick={() => {
                            const fileInput = document.createElement('input');
                            fileInput.type = 'file';
                            fileInput.accept = 'image/*';
                            fileInput.multiple = true;
                            fileInput.onchange = (e) => handleImageSelect((e.target as HTMLInputElement).files);
                            fileInput.click();
                        }}
                        title="Upload image"
                    >
                        <ImageIcon size={18} />
                    </button>
                    <button
                        className="action-btn"
                        onClick={() => {
                            const fileInput = document.createElement('input');
                            fileInput.type = 'file';
                            fileInput.multiple = true;
                            fileInput.onchange = (e) => {
                                const files = (e.target as HTMLInputElement).files;
                                if (files && files.length > 0) {
                                    alert(`Selected ${files.length} file(s). File attachment not yet implemented.`);
                                }
                            };
                            fileInput.click();
                        }}
                        title="Attach file"
                    >
                        <Paperclip size={18} />
                    </button>
                    {isStreaming ? (
                        <button className="stop-btn" onClick={handleStop} title="Stop generating">
                            <Square size={16} fill="currentColor" /> Stop
                        </button>
                    ) : (
                        <button
                            className={`send-btn ${(input.trim() || images.length > 0) ? 'active' : ''}`}
                            onClick={handleSend}
                            disabled={!input.trim() && images.length === 0}
                        >
                            <Send size={18} />
                        </button>
                    )}
                </div>
            </div>
            {attachedImagesNeedVisionModel && (
                <div className="input-footer warning">
                    Selected model is not marked as vision-capable. Use a vision model for image understanding.
                </div>
            )}
            <TelemetryFooter />
        </div>
    );
};

// Telemetry footer component
const TelemetryFooter = () => {
    const { telemetry, isStreaming, loadProgress, emergencyEjectModels } = useChatStore();
    const { ttsWarning, pendingSynthesisCount, isSynthesisInFlight, clearWarning } = useTTSStore();
    const [elapsed, setElapsed] = useState(0);
    const [isEjecting, setIsEjecting] = useState(false);

    // Update elapsed time every 100ms while waiting for first token
    useEffect(() => {
        if (!isStreaming || !telemetry?.startTime || telemetry?.firstTokenTime) {
            return;
        }

        const interval = setInterval(() => {
            setElapsed((Date.now() - telemetry.startTime!) / 1000);
        }, 100);

        return () => clearInterval(interval);
    }, [isStreaming, telemetry?.startTime, telemetry?.firstTokenTime]);

    if (ttsWarning) {
        const handleEmergencyEject = async () => {
            setIsEjecting(true);
            try {
                await emergencyEjectModels();
            } finally {
                setIsEjecting(false);
            }
        };

        return (
            <div className="input-footer tts-pressure">
                <span className="tts-pressure-message">
                    <Siren size={14} />
                    {ttsWarning}
                    {(pendingSynthesisCount > 0 || isSynthesisInFlight) && ` (${pendingSynthesisCount || 1} voice chunk${(pendingSynthesisCount || 1) === 1 ? '' : 's'} waiting)`}
                </span>
                <button className="ohshit-btn" onClick={handleEmergencyEject} disabled={isEjecting}>
                    {isEjecting ? 'Ejecting...' : 'Oh Shit: Eject Model'}
                </button>
                <button className="dismiss-tts-warning" onClick={clearWarning} title="Dismiss TTS warning">
                    <X size={14} />
                </button>
            </div>
        );
    }

    // Show loading indicator with progress percentage
    if (isStreaming && telemetry && !telemetry.firstTokenTime) {
        // Show progress percentage if available
        if (loadProgress && loadProgress.status !== 'ready') {
            return (
                <div className="input-footer loading">
                    <span className="loading-spinner">⏳</span>
                    <span>Loading model... {loadProgress.progress}%</span>
                </div>
            );
        }
        // Fallback to elapsed time
        return (
            <div className="input-footer loading">
                <span className="loading-spinner">⏳</span>
                <span>Loading model... {elapsed.toFixed(1)}s</span>
            </div>
        );
    }

    if (!telemetry || !telemetry.endTime) {
        return (
            <div className="input-footer">
                AI Chat can make mistakes. Consider checking important information.
            </div>
        );
    }

    const ttft = telemetry.firstTokenTime && telemetry.startTime
        ? ((telemetry.firstTokenTime - telemetry.startTime) / 1000).toFixed(2)
        : '—';
    const totalTime = ((telemetry.endTime - telemetry.startTime!) / 1000).toFixed(1);
    const chunksSec = telemetry.tokenCount > 0
        ? (telemetry.tokenCount / ((telemetry.endTime - telemetry.startTime!) / 1000)).toFixed(1)
        : '—';

    return (
        <div className="input-footer telemetry">
            <span>TTFT: {ttft}s</span>
            <span>•</span>
            <span>{telemetry.tokenCount} stream chunks</span>
            <span>•</span>
            <span>{chunksSec} chunks/s</span>
            <span>•</span>
            <span>{totalTime}s total</span>
        </div>
    );
};

export default ChatInput;

