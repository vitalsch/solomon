import React, { useState } from 'react';
import {
    loginUser,
    registerUser,
    requestEmailVerification,
    confirmEmailVerification,
    requestPasswordReset,
    confirmPasswordReset,
} from '../api';
import '../App.css';

const WelcomePage = ({ onAuthenticated }) => {
    const [mode, setMode] = useState('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [verificationEmail, setVerificationEmail] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetToken, setResetToken] = useState('');
    const [resetNewPassword, setResetNewPassword] = useState('');
    const [resetMessage, setResetMessage] = useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setInfo('');
        if (!username || !password || (mode === 'register' && !email)) {
            setError('Bitte Benutzername, Passwort und E-Mail ausfüllen.');
            return;
        }
        setLoading(true);
        try {
            const payload =
                mode === 'register'
                    ? { username, password, name: name || undefined, email }
                    : { username, password };
            const action = mode === 'register' ? registerUser : loginUser;
            const response = await action(payload);
            if (mode === 'register') {
                setInfo('Verifizierungscode wurde per E-Mail gesendet. Bitte Code eingeben und bestätigen.');
                setVerificationEmail(email);
            } else if (response?.token) {
                onAuthenticated?.();
            }
        } catch (err) {
            setError(err.message || 'Bitte erneut versuchen.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerificationSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setInfo('');
        if (!verificationEmail || !verificationCode) {
            setError('Bitte E-Mail und Verifizierungscode angeben.');
            return;
        }
        setVerifying(true);
        try {
            const result = await confirmEmailVerification(verificationEmail, verificationCode);
            if (result?.token) {
                onAuthenticated?.();
            }
        } catch (err) {
            setError(err.message || 'Verifizierung fehlgeschlagen.');
        } finally {
            setVerifying(false);
        }
    };

    const handleResendVerification = async () => {
        if (!verificationEmail) {
            setError('Bitte zuerst eine E-Mail angeben.');
            return;
        }
        setVerifying(true);
        setError('');
        setInfo('');
        try {
            await requestEmailVerification(verificationEmail);
            setInfo('Neuer Verifizierungscode gesendet.');
        } catch (err) {
            setError(err.message || 'Code konnte nicht gesendet werden.');
        } finally {
            setVerifying(false);
        }
    };

    const handleResetRequest = async () => {
        if (!resetEmail) {
            setResetMessage('Bitte E-Mail für das Zurücksetzen angeben.');
            return;
        }
        setVerifying(true);
        setResetMessage('');
        try {
            await requestPasswordReset(resetEmail);
            setResetMessage('Reset-Code wurde gesendet (siehe E-Mail).');
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
                onAuthenticated?.();
            } else {
                setResetMessage('Zurücksetzen erfolgreich. Jetzt einloggen.');
            }
        } catch (err) {
            setResetMessage(err.message || 'Zurücksetzen fehlgeschlagen.');
        } finally {
            setVerifying(false);
        }
    };

    const copy =
        mode === 'login'
            ? 'Melde dich an, um deine Simulationen fortzusetzen.'
            : 'Registriere dich, um deine Finanzpläne zentral zu verwalten.';

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
                            setInfo('');
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
                            setInfo('');
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
                                <span>E-Mail (Pflicht)</span>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="name@email.com"
                                    required
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
                    {info && <p className="form-info">{info}</p>}
                    <button type="submit" disabled={loading}>
                        {loading ? 'Wird geladen...' : mode === 'login' ? 'Einloggen' : 'Account erstellen'}
                    </button>
                </form>

                <div className="welcome-inline">
                    <div>
                        <p className="eyebrow">E-Mail verifizieren</p>
                        <form className="welcome-form" onSubmit={handleVerificationSubmit}>
                            <label className="stacked">
                                <span>E-Mail</span>
                                <input
                                    type="email"
                                    value={verificationEmail}
                                    onChange={(e) => setVerificationEmail(e.target.value)}
                                    placeholder="deine@email.com"
                                />
                            </label>
                            <label className="stacked">
                                <span>Verifizierungscode</span>
                                <input
                                    type="text"
                                    value={verificationCode}
                                    onChange={(e) => setVerificationCode(e.target.value)}
                                    placeholder="6-stelliger Code"
                                />
                            </label>
                            <div className="inline-actions">
                                <button type="button" className="secondary" onClick={handleResendVerification}>
                                    Code senden
                                </button>
                                <button type="submit" disabled={verifying}>
                                    Bestätigen
                                </button>
                            </div>
                        </form>
                    </div>
                    <div>
                        <p className="eyebrow">Passwort vergessen</p>
                        <div className="welcome-form">
                            <label className="stacked">
                                <span>E-Mail</span>
                                <input
                                    type="email"
                                    value={resetEmail}
                                    onChange={(e) => setResetEmail(e.target.value)}
                                    placeholder="deine@email.com"
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
                        </div>
                    </div>
                </div>

                <p className="welcome-footnote">
                    Moderne, minimalistische Oberfläche. Deine Daten werden erst nach dem Login geladen.
                </p>
            </div>
        </div>
    );
};

export default WelcomePage;
