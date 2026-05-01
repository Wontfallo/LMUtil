import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
    usePromptGeneratorStore,
    CREATIVITY_MODES,
    getSystemPrompt,
    getTemperature,
    getInspirationPrompt,
    exportHistoryData,
    HistoryItem
} from '../store/promptGeneratorStore';
import { usePromptLibraryStore } from '../store/promptLibraryStore';
import {
    Sparkles,
    Copy,
    Trash2,
    FileJson,
    FileSpreadsheet,
    Lock,
    Unlock,
    RotateCcw,
    Wand2,
    Search,
    X,
    Video,
    Image,
    Loader2,
    Square,
    Check,
    BookOpen
} from 'lucide-react';

const PromptGenerator: React.FC = () => {
    const { model } = useAppStore();  // Use global model from Header
    const {
        targetModel,
        creativityMode,
        inputText,
        outputText,
        negativePrompt,
        negPromptLocked,
        isLoading,
        isInspiring,
        showHistory,
        historySearch,
        history,
        setTargetModel,
        setCreativityMode,
        setInputText,
        setOutputText,
        setNegativePrompt,
        setNegPromptLocked,
        setIsLoading,
        setIsInspiring,
        setShowHistory,
        setHistorySearch,
        addToHistory,
        clearHistory,
        deleteHistoryItem,
        loadFromHistory,
        loadHistory,
        getFilteredHistory,
    } = usePromptGeneratorStore();

    const outputRef = useRef<HTMLDivElement>(null);

    // History panel resize state
    const [historyWidth, setHistoryWidth] = useState(350);
    const [isResizing, setIsResizing] = useState(false);
    const [isCopied, setIsCopied] = useState(false);

    // Load history on mount
    useEffect(() => {
        loadHistory();
    }, []);

    // Resize handling for history panel
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            e.preventDefault();
            // Calculate from right edge of window
            const newWidth = window.innerWidth - e.clientX;
            setHistoryWidth(Math.min(600, Math.max(250, newWidth)));
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

    // Get active library template
    const activeLibraryPrompt = usePromptLibraryStore.getState().getActiveSystemPrompt();
    const activeLibraryImages = usePromptLibraryStore.getState().getActiveImages();
    const activeTemplateId = usePromptLibraryStore.getState().activeTemplateId;
    const activeTemplateName = activeTemplateId
        ? usePromptLibraryStore.getState().templates.find(t => t.id === activeTemplateId)?.name
        : null;

    const generatePrompt = async (isInspiration = false) => {
        if (!model || (!inputText.trim() && !isInspiration)) return;

        isInspiration ? setIsInspiring(true) : setIsLoading(true);
        if (!isInspiration) setOutputText('');

        try {
            const creativityConfig = CREATIVITY_MODES[creativityMode];

            let systemPrompt: string;
            let userPrompt: string;
            let images: string[] = [];

            if (isInspiration) {
                const inspiration = getInspirationPrompt(targetModel, inputText);
                systemPrompt = inspiration.system;
                userPrompt = inspiration.user;
            } else {
                // Check if using a library template
                const libraryPrompt = usePromptLibraryStore.getState().getActiveSystemPrompt();
                const libraryImages = usePromptLibraryStore.getState().getActiveImages();

                if (libraryPrompt) {
                    systemPrompt = libraryPrompt;
                    images = libraryImages;
                } else {
                    systemPrompt = getSystemPrompt(targetModel, creativityMode);
                }
                userPrompt = inputText;
            }

            // Build messages array
            const messages: any[] = [
                { role: 'system', content: systemPrompt }
            ];

            // If we have images from library, include them in the user message
            if (images.length > 0) {
                messages.push({
                    role: 'user',
                    content: userPrompt,
                    images: images
                });
            } else {
                messages.push({ role: 'user', content: userPrompt });
            }

            // Use streaming chat
            let result = '';
            let timeoutId: NodeJS.Timeout;

            const cleanup = window.ipcRenderer.onChatChunk((chunk: any) => {
                // Clear timeout on any activity
                if (timeoutId) clearTimeout(timeoutId);

                // Set new timeout for next chunk (stalled stream protection)
                timeoutId = setTimeout(() => {
                    cleanup();
                    const errorMsg = 'Generation timed out (stalled).';
                    isInspiration ? setInputText(errorMsg) : setOutputText(errorMsg);
                    isInspiration ? setIsInspiring(false) : setIsLoading(false);
                }, 30000); // 30s timeout between chunks

                if (chunk.content) {
                    result += chunk.content;
                    if (!isInspiration) {
                        setOutputText(result);
                    } else {
                        // Stream inspiration directly to input
                        setInputText(result);
                    }
                }
                if (chunk.done) {
                    cleanup();
                    clearTimeout(timeoutId);
                    if (isInspiration) {
                        setInputText(result.trim());
                        setIsInspiring(false);

                        // Save inspiration to history
                        addToHistory({
                            input: inputText,
                            output: result.trim(),
                            negativePrompt: negPromptLocked ? '' : negativePrompt,
                            model: model,
                            creativity: 'inspire',
                            targetModel: targetModel,
                        });
                    } else {
                        setOutputText(result.trim());
                        setIsLoading(false);

                        // Add to history
                        addToHistory({
                            input: inputText,
                            output: result.trim(),
                            negativePrompt: negPromptLocked ? '' : negativePrompt,
                            model: model,
                            creativity: creativityMode,
                            targetModel: targetModel,
                        });
                    }
                }
            });

            // Initial connection timeout (longer for model load)
            timeoutId = setTimeout(() => {
                cleanup();
                const errorMsg = 'Generation timed out. Model may be loading or unresponsive.';
                isInspiration ? setInputText(errorMsg) : setOutputText(errorMsg);
                isInspiration ? setIsInspiring(false) : setIsLoading(false);
            }, 60000); // 60s initial timeout

            window.ipcRenderer.chat(messages, {
                model,
                temperature: isInspiration ? 0.8 : getTemperature(creativityMode),
                maxTokens: 500,
            });

        } catch (error) {
            console.error('Generation failed:', error);
            const errorMsg = `Failed to generate. Error: ${error}`;
            isInspiration ? setInputText(errorMsg) : setOutputText(errorMsg);
            isInspiration ? setIsInspiring(false) : setIsLoading(false);
        }
    };

    const handleStop = async () => {
        try {
            await window.ipcRenderer.abortChat();
            setIsLoading(false);
            setIsInspiring(false);
            const msg = 'Generation stopped by user.';
            isInspiring ? setInputText(msg) : setOutputText(msg);
        } catch (error) {
            console.error('Failed to stop generation:', error);
        }
    };

    const copyToClipboard = () => {
        if (outputRef.current) {
            navigator.clipboard.writeText(outputRef.current.innerText);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }
    };

    const handleClearHistory = () => {
        if (confirm('Clear all prompt history?')) {
            clearHistory();
        }
    };

    const filteredHistory = getFilteredHistory();

    return (
        <div className="prompt-generator with-right-panel" style={{ flexDirection: 'row' }}>
            {/* Main Content Column (Header + Body) */}
            <div className="prompt-main-layout" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Header */}
                <header className="prompt-header">
                    <div className="prompt-header-left">
                        <Wand2 size={24} className="prompt-header-icon" />
                        <h1>Prompt Studio</h1>
                    </div>
                </header>

                <div className="prompt-body">
                    {/* Main Content */}
                    <div className="prompt-main">
                        {/* Config Bar */}
                        <div className="prompt-config-bar">
                            <div className="config-row">
                                {/* Target Model */}
                                <div className="config-group">
                                    <label>Target Format</label>
                                    <div className="target-toggle">
                                        <button
                                            className={`target-btn ${targetModel === 'wan2.2' ? 'active' : ''}`}
                                            onClick={() => setTargetModel('wan2.2')}
                                        >
                                            <Video size={14} />
                                            Wan 2.2
                                        </button>
                                        <button
                                            className={`target-btn ${targetModel === 'qwen' ? 'active' : ''}`}
                                            onClick={() => setTargetModel('qwen')}
                                        >
                                            <Image size={14} />
                                            Qwen
                                        </button>
                                    </div>
                                </div>

                                {/* Creativity Mode */}
                                <div className="config-group">
                                    <label>Creativity</label>
                                    <div className="creativity-toggle">
                                        <button
                                            className={`creativity-btn ${creativityMode === 'precise' ? 'active precise' : ''}`}
                                            onClick={() => setCreativityMode('precise')}
                                        >
                                            Precise
                                        </button>
                                        <button
                                            className={`creativity-btn ${creativityMode === 'creative' ? 'active creative' : ''}`}
                                            onClick={() => setCreativityMode('creative')}
                                        >
                                            Creative
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Work Area */}
                        <div className="prompt-work-area">
                            {/* Input Panel */}
                            <div className="prompt-panel input-panel">
                                <div className="panel-header">
                                    <h3>Input</h3>
                                    {isInspiring ? (
                                        <button
                                            className="inspire-btn stop"
                                            onClick={handleStop}
                                            style={{ borderColor: '#ef4444', color: '#ef4444' }}
                                        >
                                            <Square size={14} fill="currentColor" />
                                            Stop
                                        </button>
                                    ) : (
                                        <button
                                            className="inspire-btn"
                                            onClick={() => generatePrompt(true)}
                                            disabled={isLoading || !model}
                                            title="Add comma separated keywords or leave blank to get inspired by 3 prompt ideas"
                                        >
                                            <Sparkles size={14} />
                                            Inspire Me
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    className="prompt-textarea"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="Describe your video or image scene..."
                                    disabled={isLoading}
                                />
                            </div>

                            {/* Output Panel */}
                            <div className="prompt-panel output-panel">
                                <div className="panel-header">
                                    <h3>Output</h3>
                                    <button
                                        className="copy-btn"
                                        onClick={copyToClipboard}
                                        disabled={!outputText || isLoading}
                                        style={isCopied ? { color: '#4ade80', borderColor: '#4ade80' } : {}}
                                    >
                                        {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                        {isCopied ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <div
                                    ref={outputRef}
                                    className="prompt-output"
                                >
                                    {isLoading && !outputText ? (
                                        <div className="output-loading">
                                            <div className="loading-spinner-prompt"></div>
                                            <span className="loading-status">Loading model...</span>
                                        </div>
                                    ) : outputText ? (
                                        <>
                                            {outputText}
                                            {isLoading && <span className="streaming-cursor">▊</span>}
                                        </>
                                    ) : (
                                        <span className="output-placeholder">Generated prompt will appear here...</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Bottom Section */}
                        <div className="prompt-bottom">
                            {/* Negative Prompt */}
                            <div className="negative-prompt-section">
                                <div className="negative-header">
                                    <h4>Negative Prompt</h4>
                                    <button
                                        className="lock-btn"
                                        onClick={() => setNegPromptLocked(!negPromptLocked)}
                                    >
                                        {negPromptLocked ? <Lock size={14} /> : <Unlock size={14} />}
                                        {negPromptLocked ? 'Locked' : 'Unlocked'}
                                    </button>
                                </div>
                                <textarea
                                    className="negative-textarea"
                                    value={negativePrompt}
                                    onChange={(e) => setNegativePrompt(e.target.value)}
                                    placeholder="Elements to exclude..."
                                    disabled={negPromptLocked}
                                    rows={2}
                                />
                            </div>

                            {/* Generate Button */}
                            {isLoading ? (
                                <button
                                    className="generate-btn stop"
                                    onClick={handleStop}
                                    style={{ background: '#ef4444' }}
                                >
                                    <Square size={20} fill="currentColor" />
                                    Stop Generation
                                </button>
                            ) : (
                                <button
                                    className="generate-btn"
                                    onClick={() => generatePrompt(false)}
                                    disabled={!inputText.trim() || !model}
                                >
                                    <Wand2 size={20} />
                                    Generate {targetModel.toUpperCase()} Prompt
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* History Panel - Always visible */}
            <div
                className={`prompt-history ${isResizing ? 'resizing' : ''}`}
                style={{ width: historyWidth }}
            >
                {/* Resize Handle */}
                <div
                    className="history-resize-handle"
                    onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
                />
                <div className="history-header">
                    <h3>History</h3>
                    <div className="history-actions">
                        <button
                            className="history-action-btn"
                            onClick={() => exportHistoryData(history, 'json')}
                            title="Export JSON"
                        >
                            <FileJson size={16} />
                        </button>
                        <button
                            className="history-action-btn"
                            onClick={() => exportHistoryData(history, 'csv')}
                            title="Export CSV"
                        >
                            <FileSpreadsheet size={16} />
                        </button>
                        <button
                            className="history-action-btn delete"
                            onClick={handleClearHistory}
                            title="Clear History"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>

                <div className="history-search">
                    <Search size={14} />
                    <input
                        type="text"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Search history..."
                    />
                    {historySearch && (
                        <button onClick={() => setHistorySearch('')}>
                            <X size={14} />
                        </button>
                    )}
                </div>

                <div className="history-list">
                    {filteredHistory.length === 0 ? (
                        <div className="history-empty">
                            {historySearch ? 'No matching entries' : 'No history yet'}
                        </div>
                    ) : (
                        filteredHistory.map((item) => (
                            <div key={item.id} className="history-card">
                                <div className="history-card-header">
                                    <span className="history-timestamp">
                                        {new Date(item.timestamp).toLocaleString()}
                                    </span>
                                    <button
                                        className="history-delete-btn"
                                        onClick={() => deleteHistoryItem(item.id)}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                                <div className="history-input-preview">
                                    {item.input.length > 80 ? item.input.slice(0, 80) + '...' : item.input}
                                </div>
                                <div className="history-tags">
                                    <span className={`tag target ${item.targetModel.replace('.', '-')}`}>{item.targetModel}</span>
                                    <span className={`tag creativity ${item.creativity}`}>{item.creativity}</span>
                                    <span className="tag model" title={item.model}>
                                        {item.model.length > 15 ? item.model.slice(0, 15) + '...' : item.model}
                                    </span>
                                </div>
                                <button
                                    className="history-load-btn"
                                    onClick={() => loadFromHistory(item)}
                                >
                                    <RotateCcw size={12} />
                                    Load Prompt
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default PromptGenerator;

