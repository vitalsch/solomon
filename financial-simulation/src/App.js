import React, { useState } from 'react';
import Simulation from './components/Simulation';
import AdminPortal from './components/AdminPortal';
import './App.css';

function App() {
    const [view, setView] = useState('simulation');

    return (
        <div className="App">
            <div className="app-shell">
                <header className="app-header">
                    <div className="app-brand">
                        <span>Solomon Planner</span>
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
                </header>
                <main>{view === 'simulation' ? <Simulation /> : <AdminPortal />}</main>
            </div>
        </div>
    );
}

export default App;
