import React from 'react';
import MessageList from './MessageList.tsx';
import ChatInput from './ChatInput.tsx';
import RightPanel from './RightPanel.tsx';
import { useChatStore } from '../store/chatStore.ts';
import { MessageSquare } from 'lucide-react';



const ChatInterface: React.FC = () => {
    const { currentConversationId } = useChatStore();

    return (
        <div className="chat-interface with-right-panel">
            <div className="chat-main">
                {/* Chat Banner (Matches Prompt Studio style but purple) */}
                <header className="chat-banner">
                    <div className="chat-banner-left">
                        <MessageSquare size={24} className="chat-banner-icon" />
                        <h1>AI Chat</h1>
                    </div>
                </header>

                {!currentConversationId ? (
                    <div className="empty-state">
                        <div className="hero-content">
                            <h1>Welcome to AI Chat</h1>
                            <p>Start a new conversation to begin.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <MessageList />
                        <ChatInput />
                    </>
                )}
            </div>
            <RightPanel />
        </div>
    );
};

export default ChatInterface;

