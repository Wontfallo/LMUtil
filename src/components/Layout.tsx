import React from 'react';
import Sidebar from './Sidebar.tsx';
import Header from './Header.tsx';
import Settings from './Settings.tsx';
import DiagnosticsTerminal from './DiagnosticsTerminal.tsx';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    const [showSettings, setShowSettings] = React.useState(false);
    const [showTerminal, setShowTerminal] = React.useState(false);

    return (
        <div className="layout-container">
            <Sidebar />
            <div className="main-content">
                <Header
                    onOpenSettings={() => setShowSettings(true)}
                    onToggleTerminal={() => setShowTerminal(value => !value)}
                    terminalOpen={showTerminal}
                />
                <main className="content-area">
                    {children}
                </main>
            </div>
            {showSettings && (
                <Settings onClose={() => setShowSettings(false)} />
            )}
            {showTerminal && (
                <DiagnosticsTerminal onClose={() => setShowTerminal(false)} />
            )}
        </div>
    );
};

export default Layout;
