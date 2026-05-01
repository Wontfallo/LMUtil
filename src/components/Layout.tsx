import React from 'react';
import Sidebar from './Sidebar.tsx';
import Header from './Header.tsx';

interface LayoutProps {
    children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
    return (
        <div className="layout-container">
            <Sidebar />
            <div className="main-content">
                <Header />
                <main className="content-area">
                    {children}
                </main>
            </div>
        </div>
    );
};

export default Layout;
