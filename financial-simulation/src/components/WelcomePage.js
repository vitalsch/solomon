import React, { useState } from 'react';
import { loginUser, registerUser, requestPasswordReset, confirmPasswordReset } from '../api';
import '../App.css';

const WelcomePage = ({ onAuthenticated }) => {
    const [view, setView] = useState('auth');
    const [mode, setMode] = useState('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [resetPhone, setResetPhone] = useState('');
    const [resetToken, setResetToken] = useState('');
    const [resetNewPassword, setResetNewPassword] = useState('');
    const [resetMessage, setResetMessage] = useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        if (!username || !password || (mode === 'register' && !phone)) {
            setError('Bitte Benutzername, Passwort und Telefonnummer ausfüllen.');
            return;
        }
        setLoading(true);
        try {
            const payload =
                mode === 'register'
                    ? { username, password, name: name || undefined, phone }
                    : { username, password };
            const action = mode === 'register' ? registerUser : loginUser;
            const response = await action(payload);
            if (response?.token) {
                const targetView = username === 'admin' ? 'admin' : 'simulation';
                onAuthenticated?.(targetView);
            }
        } catch (err) {
            setError(err.message || 'Bitte erneut versuchen.');
        } finally {
            setLoading(false);
        }
    };

    const handleResetRequest = async () => {
        if (!resetPhone) {
            setResetMessage('Bitte Telefonnummer für das Zurücksetzen angeben.');
            return;
        }
        setVerifying(true);
        setResetMessage('');
        try {
            await requestPasswordReset(resetPhone);
            setResetMessage('Reset-Code erstellt (sieh im Backend-Log nach).');
        } catch (err) {
            setResetMessage(err.message || 'Reset-Code konnte nicht gesendet werden.');
        } finally {
            setVerifying(false);
        }
    };

    const handleResetConfirm = async () => {
        if (!resetToken || !resetNewPassword) {
            setResetMessage('Bitte Reset-Code und neues Passwort eingeben.');
            return;
        }
        setVerifying(true);
        setResetMessage('');
        try {
            const result = await confirmPasswordReset(resetToken, resetNewPassword);
            if (result?.token) {
                onAuthenticated?.('simulation');
            } else {
                setResetMessage('Zurücksetzen erfolgreich. Jetzt einloggen.');
            }
        } catch (err) {
            setResetMessage(err.message || 'Zurücksetzen fehlgeschlagen.');
        } finally {
            setVerifying(false);
        }
    };

    const openResetView = () => {
        setView('reset');
        setResetMessage('');
        setVerifying(false);
    };

    const backToAuth = () => {
        setView('auth');
        setMode('login');
        setResetMessage('');
        setVerifying(false);
    };

    const copy =
        mode === 'login'
            ? 'Melde dich an, um deine Simulationen fortzusetzen.'
            : 'Registriere dich, um deine Finanzpläne zentral zu verwalten.';

    if (view === 'reset') {
        return (
            <div className="welcome-shell">
                <div className="welcome-card">
                    <p className="eyebrow">Passwort zurücksetzen</p>
                    <div className="welcome-form">
                        <label className="stacked">
                            <span>Telefonnummer</span>
                            <input
                                type="tel"
                                value={resetPhone}
                                onChange={(e) => setResetPhone(e.target.value)}
                                placeholder="+4179..."
                            />
                        </label>
                        <button type="button" className="secondary" onClick={handleResetRequest} disabled={verifying}>
                            Reset-Code senden
                        </button>
                        <label className="stacked">
                            <span>Reset-Code</span>
                            <input
                                type="text"
                                value={resetToken}
                                onChange={(e) => setResetToken(e.target.value)}
                                placeholder="6-stelliger Code"
                            />
                        </label>
                        <label className="stacked">
                            <span>Neues Passwort</span>
                            <input
                                type="password"
                                value={resetNewPassword}
                                onChange={(e) => setResetNewPassword(e.target.value)}
                                placeholder="Neues Passwort"
                            />
                        </label>
                        <button type="button" onClick={handleResetConfirm} disabled={verifying}>
                            Passwort setzen
                        </button>
                        {resetMessage && <p className="form-info">{resetMessage}</p>}
                        <button type="button" className="secondary" onClick={backToAuth}>
                            Zurück zum Login
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="welcome-shell">
            <div className="welcome-hero">
                <div className="welcome-badge">Financial Simulation</div>
                <h1>Willkommen zurück</h1>
                <p className="welcome-subline">
                    Plane Cashflows, Assets und Steuern in einem schlanken Dashboard. Einfach anmelden oder neu
                    registrieren und direkt starten.
                </p>
                <div className="welcome-highlights">
                    <span>Live Simulation</span>
                    <span>Steuerprofile</span>
                    <span>Stress-Tests</span>
                </div>
            </div>

            <div className="welcome-card">
                <div className="welcome-toggle">
                    <button
                        type="button"
                        className={mode === 'login' ? 'active' : ''}
                        onClick={() => {
                            setMode('login');
                            setError('');
                        }}
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        className={mode === 'register' ? 'active' : ''}
                        onClick={() => {
                            setMode('register');
                            setError('');
                        }}
                    >
                        Registrieren
                    </button>
                </div>

                <p className="welcome-copy">{copy}</p>

                <form className="welcome-form" onSubmit={handleSubmit}>
                    <label className="stacked">
                        <span>Benutzername</span>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="z.B. finance_pro"
                        />
                    </label>
                    {mode === 'register' && (
                        <>
                            <label className="stacked">
                                <span>Anzeige-Name (optional)</span>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Dein Name"
                                />
                            </label>
                            <label className="stacked">
                                <span>Telefonnummer</span>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="+41791234567"
                                />
                            </label>
                        </>
                    )}
                    <label className="stacked">
                        <span>Passwort</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="********"
                        />
                    </label>
                    {error && <p className="form-error">{error}</p>}
                    <button type="submit" disabled={loading}>
                        {loading ? 'Wird geladen...' : mode === 'login' ? 'Einloggen' : 'Account erstellen'}
                    </button>
                    {mode === 'login' && (
                        <button
                            type="button"
                            className="secondary"
                            style={{ background: 'none', border: 'none', color: '#2563eb' }}
                            onClick={openResetView}
                        >
                            Passwort vergessen?
                        </button>
                    )}
                </form>

                <p className="welcome-footnote">
                    Moderne, minimalistische Oberfläche. Deine Daten werden erst nach dem Login geladen.
                </p>
            </div>
        </div>
    );
};

export default WelcomePage;
