import React, { useEffect } from 'react'
import Layout from './components/Layout.tsx'
import { useAppStore } from './store/appStore.ts'
import { useChatStore } from './store/chatStore.ts'
import { useTTSStore } from './store/ttsStore.ts'
import ChatInterface from './components/ChatInterface.tsx'
import PromptGenerator from './components/PromptGenerator.tsx'
import CraftStudio from './components/CraftStudio.tsx'

const App: React.FC = () => {
    const { loadSettings, currentView } = useAppStore();
    const { loadConversations, setLoadProgress } = useChatStore();
    const { loadVoices } = useTTSStore();

    useEffect(() => {
        // Initialize app
        const init = async () => {
            await loadSettings(); // Load global app settings (provider, model, etc.)
            await loadConversations();
            await loadVoices();
        };
        init();
    }, []);

    // Listen for model loading progress events
    useEffect(() => {
        const cleanup = window.ipcRenderer.onLoadProgress((progress) => {
            console.log('[App] Model load progress:', progress);
            setLoadProgress(progress);
            
            // Clear progress when ready
            if (progress.status === 'ready') {
                setTimeout(() => setLoadProgress(null), 500);
            }
        });
        
        return cleanup;
    }, [setLoadProgress]);

    return (
        <Layout>
            {currentView === 'chat' ? (
                <ChatInterface />
            ) : currentView === 'promptGenerator' ? (
                <PromptGenerator />
            ) : (
                <CraftStudio />
            )}
        </Layout>
    )
}

export default App
