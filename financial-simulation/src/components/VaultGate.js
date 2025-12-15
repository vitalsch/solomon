import React, { useEffect, useState } from 'react';
import { getVault, saveVault } from '../api';
import {
    createVaultRecord,
    createTrustedDeviceKey,
    deriveKekFromPassphrase,
    deriveRecoveryWrapper,
    generateRecoveryKey,
    loadTrustedDeviceKey,
    unwrapDek,
    unwrapWithDeviceKey,
    wrapWithDeviceKey,
} from '../vault';

const LOCAL_DEVICE_KEY = 'vaultDeviceWrapped';

const VaultGate = ({ user, onUnlocked, onLocked }) => {
    const [loading, setLoading] = useState(false);
    const [vaultMeta, setVaultMeta] = useState(null);
    const [error, setError] = useState('');
    const [stage, setStage] = useState('loading'); // loading | setup | unlock | unlocked
    const [passphrase, setPassphrase] = useState('');
    const [confirmPassphrase, setConfirmPassphrase] = useState('');
    const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
    const [rememberDevice, setRememberDevice] = useState(true);
    const [recoveryKeyDisplay, setRecoveryKeyDisplay] = useState('');
    const [deviceStatus, setDeviceStatus] = useState('');

    const [localDeviceWrapped, setLocalDeviceWrapped] = useState(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(LOCAL_DEVICE_KEY) || 'null');
            return stored;
        } catch (err) {
            return null;
        }
    });

    const reset = () => {
        setPassphrase('');
        setConfirmPassphrase('');
        setRecoveryKeyInput('');
        setError('');
        setRecoveryKeyDisplay('');
        setStage('unlock');
    };

    useEffect(() => {
        if (!user) return;
        let active = true;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const vault = await getVault();
                if (!active) return;
                setVaultMeta(vault);
                const hasWrapped = Boolean(vault?.wrapped_dek);
                setStage(hasWrapped ? 'unlock' : 'setup');
            } catch (err) {
                if (!active) return;
                setError(err.message || 'Vault konnte nicht geladen werden.');
                setStage('setup');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, [user]);

    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(LOCAL_DEVICE_KEY) || 'null');
            if (stored && user && stored.userId && stored.userId !== user.id) {
                setLocalDeviceWrapped(null);
                return;
            }
            setLocalDeviceWrapped(stored);
        } catch (err) {
            setLocalDeviceWrapped(null);
        }
    }, [user]);

    useEffect(() => {
        if (!vaultMeta || stage !== 'unlock' || !localDeviceWrapped) return;
        (async () => {
            try {
                setDeviceStatus('Versuche Gerät...');
                const deviceKey = await loadTrustedDeviceKey(localDeviceWrapped.deviceId);
                if (!deviceKey) {
                    setDeviceStatus('Kein Geräteschlüssel gefunden.');
                    return;
                }
                const dek = await unwrapWithDeviceKey(localDeviceWrapped, deviceKey);
                setStage('unlocked');
                setDeviceStatus('Mit vertrautem Gerät entsperrt.');
                onUnlocked?.({ dek, vault: vaultMeta, via: 'device' });
                setError('');
            } catch (err) {
                setDeviceStatus('Geräte-Entsperren fehlgeschlagen.');
                console.warn(err);
            }
        })();
    }, [localDeviceWrapped, onUnlocked, stage, vaultMeta]);

    const storeDeviceWrap = async (dek) => {
        const deviceId = crypto.randomUUID();
        const deviceKey = await loadTrustedDeviceKey(deviceId).catch(() => null);
        const usableKey = deviceKey || (await createTrustedDeviceKey(deviceId));
        const wrapped = await wrapWithDeviceKey(dek, usableKey);
        const stored = { ...wrapped, deviceId, userId: user?.id || null, createdAt: new Date().toISOString() };
        localStorage.setItem(LOCAL_DEVICE_KEY, JSON.stringify(stored));
        setLocalDeviceWrapped(stored);
        setDeviceStatus('Gerät gespeichert.');
    };

    const handleSetup = async (evt) => {
        evt?.preventDefault();
        if (!passphrase || passphrase.length < 12) {
            setError('Passphrase mindestens 12 Zeichen.');
            return;
        }
        if (passphrase !== confirmPassphrase) {
            setError('Passphrases stimmen nicht überein.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const record = await createVaultRecord({ passphrase, rememberDevice });
            const payload = {
                version: 'v1',
                wrapped_dek: record.wrappedDek,
                recovery_wrapped_dek: record.recoveryWrappedDek,
            };
            const saved = await saveVault(payload);
            if (record.deviceWrappedDek) {
                localStorage.setItem(
                    LOCAL_DEVICE_KEY,
                    JSON.stringify({ ...record.deviceWrappedDek, createdAt: new Date().toISOString() })
                );
            }
            setVaultMeta(saved);
            setStage('unlocked');
            setRecoveryKeyDisplay(record.recoveryKey);
            onUnlocked?.({ dek: record.dek, recoveryKey: record.recoveryKey, vault: saved, via: 'setup' });
        } catch (err) {
            setError(err.message || 'Einrichtung fehlgeschlagen');
        } finally {
            setLoading(false);
        }
    };

    const handleUnlock = async (evt) => {
        evt?.preventDefault();
        if (!vaultMeta?.wrapped_dek) return;
        setLoading(true);
        setError('');
        try {
            const kek = await deriveKekFromPassphrase(
                passphrase,
                vaultMeta.wrapped_dek.salt,
                vaultMeta.wrapped_dek.iterations
            );
            const dek = await unwrapDek(vaultMeta.wrapped_dek, kek);
            setStage('unlocked');
            if (rememberDevice && !localDeviceWrapped) {
                try {
                    await storeDeviceWrap(dek);
                } catch (deviceErr) {
                    console.warn('Device store failed', deviceErr);
                }
            }
            onUnlocked?.({ dek, vault: vaultMeta, via: 'passphrase' });
        } catch (err) {
            setError('Passphrase falsch oder Vault beschädigt.');
        } finally {
            setLoading(false);
        }
    };

    const handleRecoveryUnlock = async (evt) => {
        evt?.preventDefault();
        if (!vaultMeta?.recovery_wrapped_dek) {
            setError('Kein Recovery-Key hinterlegt.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const recoveryWrapper = await deriveRecoveryWrapper(
                recoveryKeyInput,
                vaultMeta.recovery_wrapped_dek.salt,
                vaultMeta.recovery_wrapped_dek.iterations
            );
            const dek = await unwrapDek(vaultMeta.recovery_wrapped_dek, recoveryWrapper);
            setStage('unlocked');
            onUnlocked?.({ dek, vault: vaultMeta, via: 'recovery' });
        } catch (err) {
            setError('Recovery Key ungültig.');
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateRecovery = (evt) => {
        evt?.preventDefault();
        const key = generateRecoveryKey();
        setRecoveryKeyInput(key);
        setRecoveryKeyDisplay(key);
    };

    if (!user || stage === 'unlocked') {
        return null;
    }

    return (
        <div className="vault-overlay">
            <div className="vault-card">
                <div className="vault-header">
                    <div>
                        <div className="vault-title">Vault</div>
                        <div className="vault-subtitle">
                            {stage === 'setup'
                                ? 'Erstelle deine Vault-Passphrase'
                                : 'Vault entsperren (Klartext bleibt nur im Browser)'}
                        </div>
                    </div>
                    {onLocked && (
                        <button type="button" className="link-btn" onClick={onLocked}>
                            Abmelden
                        </button>
                    )}
                </div>

                {loading && <div className="vault-status">Lade...</div>}
                {error && <div className="vault-error">{error}</div>}
                {deviceStatus && <div className="vault-status subtle">{deviceStatus}</div>}

                {stage === 'setup' && (
                    <form className="vault-form" onSubmit={handleSetup}>
                        <label>
                            Passphrase (mind. 12 Zeichen)
                            <input
                                type="password"
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                autoComplete="new-password"
                            />
                        </label>
                        <label>
                            Passphrase bestätigen
                            <input
                                type="password"
                                value={confirmPassphrase}
                                onChange={(e) => setConfirmPassphrase(e.target.value)}
                                autoComplete="new-password"
                            />
                        </label>
                        <label className="vault-checkbox">
                            <input
                                type="checkbox"
                                checked={rememberDevice}
                                onChange={(e) => setRememberDevice(e.target.checked)}
                            />
                            Dieses Gerät merken (speichert Wrapped-DEK lokal mit non-extractable Key)
                        </label>
                        <button type="submit" disabled={loading}>
                            Vault anlegen
                        </button>
                        {recoveryKeyDisplay && (
                            <div className="vault-recovery">
                                <div>Recovery Key – sicher ablegen (PDF/Print/Password-Manager):</div>
                                <code className="vault-recovery-key">{recoveryKeyDisplay}</code>
                            </div>
                        )}
                    </form>
                )}

                {stage === 'unlock' && (
                    <div className="vault-forms">
                        <form className="vault-form" onSubmit={handleUnlock}>
                            <label>
                                Passphrase
                                <input
                                    type="password"
                                    value={passphrase}
                                    onChange={(e) => setPassphrase(e.target.value)}
                                    autoComplete="current-password"
                                />
                            </label>
                            <label className="vault-checkbox">
                                <input
                                    type="checkbox"
                                    checked={rememberDevice}
                                    onChange={(e) => setRememberDevice(e.target.checked)}
                                />
                                Dieses Gerät merken
                            </label>
                            <button type="submit" disabled={loading}>
                                Entsperren
                            </button>
                        </form>
                        <form className="vault-form" onSubmit={handleRecoveryUnlock}>
                            <label>
                                Recovery Key
                                <input
                                    type="text"
                                    value={recoveryKeyInput}
                                    onChange={(e) => setRecoveryKeyInput(e.target.value)}
                                />
                            </label>
                            <div className="vault-actions">
                                <button type="button" className="link-btn" onClick={handleGenerateRecovery}>
                                    Recovery Key generieren
                                </button>
                                <button type="submit" disabled={loading}>
                                    Mit Recovery entsperren
                                </button>
                            </div>
                        </form>
                        <div className="vault-footer">
                            <button type="button" className="link-btn" onClick={reset}>
                                Andere Methode versuchen
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VaultGate;
