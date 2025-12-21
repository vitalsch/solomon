import React, { useEffect, useState } from 'react';
import Simulation from './components/Simulation';
import AdminPortal from './components/AdminPortal';
import WelcomePage from './components/WelcomePage';
import { getAuthToken, setAuthToken } from './api';
import './App.css';

function App() {
    const [view, setView] = useState('welcome');
    const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getAuthToken()));
    const [sessionKey, setSessionKey] = useState(0);

    useEffect(() => {
        setIsAuthenticated(Boolean(getAuthToken()));
    }, []);

    const handleAuthSuccess = (targetView = 'simulation') => {
        setIsAuthenticated(true);
        setView(targetView);
        setSessionKey((key) => key + 1);
    };

    const handleLogout = () => {
        setAuthToken(null);
        setIsAuthenticated(false);
        setView('welcome');
        setSessionKey((key) => key + 1);
    };

    if (!isAuthenticated || view === 'welcome') {
        return <WelcomePage onAuthenticated={handleAuthSuccess} />;
    }

    if (view === 'admin') {
        return (
            <div className="App">
                <div className="app-shell admin-shell">
                    <header className="app-header">
                        <div className="app-brand">
                            <span>Personal Financial Planner</span>
                        </div>
                        <button type="button" className="ghost" onClick={handleLogout}>
                            Logout
                        </button>
                    </header>
                    <main>
                        <AdminPortal key={`admin-${sessionKey}`} />
                    </main>
                </div>
            </div>
        );
    }

        return (
            <div className="App">
                <div className="experience-shell">
                    <div className="experience-frame">
                        <main className="experience-body">
                            <div className="experience-card">
                                <Simulation key={`simulation-${sessionKey}`} onLogout={handleLogout} />
                            </div>
                        </main>
                    </div>
                </div>
            </div>
    );
}

export default App;
