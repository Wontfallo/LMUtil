import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useChatStore } from '../store/chatStore.ts';
import { useAppStore } from '../store/appStore.ts';
import { MessageSquare, Plus, Trash2, Pencil, Check, X, Wand2, Search, Calendar, Image as ImageIcon } from 'lucide-react';
import PromptLibrary from './PromptLibrary';

// Helper to format relative time
const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

const Sidebar: React.FC = () => {
    const { conversations, currentConversationId, loadConversations, createNewConversation, setCurrentConversation, deleteConversation, renameConversation } = useChatStore();
    const { currentView, setCurrentView } = useAppStore();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [showDateFilter, setShowDateFilter] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // Resize state
    const [sidebarWidth, setSidebarWidth] = useState(320);
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLElement>(null);

    useEffect(() => {
        loadConversations();
    }, []);

    // Filtered conversations based on search and date
    const filteredConversations = useMemo(() => {
        return conversations.filter(conv => {
            // Text search
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                if (!conv.title.toLowerCase().includes(query)) {
                    return false;
                }
            }

            // Date filters
            if (dateFrom) {
                const convDate = new Date(conv.updated_at);
                const fromDate = new Date(dateFrom);
                if (convDate < fromDate) return false;
            }
            if (dateTo) {
                const convDate = new Date(conv.updated_at);
                const toDate = new Date(dateTo);
                toDate.setHours(23, 59, 59, 999); // Include the whole day
                if (convDate > toDate) return false;
            }

            return true;
        });
    }, [conversations, searchQuery, dateFrom, dateTo]);

    // Resize handling
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            e.preventDefault();
            // For left sidebar, width is simply the mouse X position
            const newWidth = Math.min(600, Math.max(200, e.clientX));
            setSidebarWidth(newWidth);
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

    const startEditing = (e: React.MouseEvent, conv: any) => {
        e.stopPropagation();
        setEditingId(conv.id);
        setEditTitle(conv.title);
    };

    const saveTitle = async (e?: React.FormEvent) => {
        e?.stopPropagation(); // Prevent navigation
        if (editingId && editTitle.trim()) {
            await renameConversation(editingId, editTitle);
            setEditingId(null);
        }
    };

    const cancelEditing = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            saveTitle();
        } else if (e.key === 'Escape') {
            setEditingId(null);
        }
    };

    const clearFilters = () => {
        setSearchQuery('');
        setDateFrom('');
        setDateTo('');
        setShowDateFilter(false);
    };

    const hasActiveFilters = searchQuery || dateFrom || dateTo;

    return (
        <aside
            ref={sidebarRef}
            className={`sidebar ${isResizing ? 'resizing' : ''}`}
            style={{ width: sidebarWidth }}
        >
            {/* View Switcher */}
            <div className="view-switcher">
                <button
                    className={`view-btn ${currentView === 'chat' ? 'active' : ''}`}
                    onClick={() => setCurrentView('chat')}
                >
                    <MessageSquare size={16} />
                    <span>Chat</span>
                </button>
                <button
                    className={`view-btn prompt ${currentView === 'promptGenerator' ? 'active' : ''}`}
                    onClick={() => setCurrentView('promptGenerator')}
                >
                    <Wand2 size={16} />
                    <span>Prompt Studio</span>
                </button>
                <button
                    className={`view-btn craft ${currentView === 'craftStudio' ? 'active' : ''}`}
                    onClick={() => setCurrentView('craftStudio')}
                >
                    <ImageIcon size={16} />
                    <span>Craft Studio</span>
                </button>
            </div>

            {/* Only show chat-related UI when in chat view */}
            {currentView === 'chat' && (
                <>
                    <div className="sidebar-header">
                        <button className="new-chat-btn" onClick={() => createNewConversation()}>
                            <Plus size={18} />
                            New Chat
                        </button>
                    </div>

                    {/* Search and Filter */}
                    <div className="chat-search-container">
                        <div className="search-input-wrapper">
                            <Search size={14} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Search chats..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="chat-search-input"
                            />
                            <button
                                className={`date-filter-btn ${showDateFilter ? 'active' : ''}`}
                                onClick={() => setShowDateFilter(!showDateFilter)}
                                title="Date filters"
                            >
                                <Calendar size={14} />
                            </button>
                        </div>

                        {showDateFilter && (
                            <div className="date-filter-panel">
                                <div className="date-filter-row">
                                    <label>From:</label>
                                    <input
                                        type="date"
                                        value={dateFrom}
                                        onChange={(e) => setDateFrom(e.target.value)}
                                        className="date-input"
                                    />
                                </div>
                                <div className="date-filter-row">
                                    <label>To:</label>
                                    <input
                                        type="date"
                                        value={dateTo}
                                        onChange={(e) => setDateTo(e.target.value)}
                                        className="date-input"
                                    />
                                </div>
                            </div>
                        )}

                        {hasActiveFilters && (
                            <button className="clear-filters-btn" onClick={clearFilters}>
                                Clear filters ({filteredConversations.length} of {conversations.length})
                            </button>
                        )}
                    </div>

                    <div className="conversation-list">
                        {filteredConversations.map((conv) => (
                            <div
                                key={conv.id}
                                className={`conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
                                onClick={() => setCurrentConversation(conv.id)}
                            >
                                <MessageSquare size={16} />

                                {editingId === conv.id ? (
                                    <div className="edit-title-container" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="text"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            autoFocus
                                            className="edit-title-input"
                                        />
                                        <div className="edit-actions">
                                            <button className="icon-btn save" onClick={() => saveTitle()}><Check size={14} /></button>
                                            <button className="icon-btn cancel" onClick={cancelEditing}><X size={14} /></button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="conv-info">
                                            <span className="conv-title">{conv.title}</span>
                                            <span className="conv-timestamp">{formatRelativeTime(conv.updated_at)}</span>
                                        </div>
                                        <div className="item-actions">
                                            <button className="icon-btn edit" onClick={(e) => startEditing(e, conv)}>
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                className="icon-btn delete"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteConversation(conv.id);
                                                }}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                        {filteredConversations.length === 0 && conversations.length > 0 && (
                            <div className="no-results">No chats match your filters</div>
                        )}
                    </div>
                </>
            )}

            {/* Prompt Studio sidebar content */}
            {currentView === 'promptGenerator' && (
                <PromptLibrary />
            )}

            {/* Craft Studio sidebar content */}
            {currentView === 'craftStudio' && (
                <div className="prompt-sidebar-content">
                    <div className="craft-sidebar-info">
                        <ImageIcon size={32} className="craft-icon" />
                        <h3>Craft Studio</h3>
                        <p>Prepare and resize images for AI workflows with precision cropping and padding.</p>
                    </div>
                </div>
            )}

            {/* Resize Handle - on right edge */}
            <div
                className="sidebar-resize-handle"
                onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
            />
        </aside>
    );
};

export default Sidebar;
