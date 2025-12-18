import React, { useEffect, useState } from 'react';
import Simulation from './components/Simulation';
import AdminPortal from './components/AdminPortal';
import WelcomePage from './components/WelcomePage';
import { getAuthToken, setAuthToken } from './api';
import './App.css';

function App() {
    const [view, setView] = useState('simulation');
    const [isAuthenticated, setIsAuthenticated] = useState(Boolean(getAuthToken()));
    const [sessionKey, setSessionKey] = useState(0);

    useEffect(() => {
        setIsAuthenticated(Boolean(getAuthToken()));
    }, []);

    const handleAuthSuccess = () => {
        setIsAuthenticated(true);
        setSessionKey((key) => key + 1);
    };

    const handleLogout = () => {
        setAuthToken(null);
        setIsAuthenticated(false);
        setView('simulation');
        setSessionKey((key) => key + 1);
    };

    if (!isAuthenticated) {
        return <WelcomePage onAuthenticated={handleAuthSuccess} />;
    }

    return (
        <div className="App">
            <div className="app-shell">
                <header className="app-header">
                    <div className="app-brand">
                        <span>Personal Financial Planner</span>
                    </div>
                    <div className="view-switcher">
                        <button
                            type="button"
                            className={view === 'simulation' ? 'active' : ''}
                            onClick={() => setView('simulation')}
                        >
                            Simulation
                        </button>
                        <button
                            type="button"
                            className={view === 'admin' ? 'active' : ''}
                            onClick={() => setView('admin')}
                        >
                            Admin
                        </button>
                    </div>
                    <button type="button" className="ghost" onClick={handleLogout}>
                        Logout
                    </button>
                </header>
                <main>
                    {view === 'simulation' ? (
                        <Simulation key={`simulation-${sessionKey}`} />
                    ) : (
                        <AdminPortal key={`admin-${sessionKey}`} />
                    )}
                </main>
            </div>
        </div>
    );
}

export default App;
