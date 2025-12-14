import React, { useMemo, useState } from 'react';
import AdminMunicipalTaxes from './AdminMunicipalTaxes';
import AdminStateTaxTariffs from './AdminStateTaxTariffs';
import AdminPersonalTaxes from './AdminPersonalTaxes';

const ADMIN_USERNAME = process.env.REACT_APP_ADMIN_USERNAME || 'admin';
const LOCAL_STORAGE_KEY = 'adminAuthHeader';

const readStoredAdminAuth = () => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return '';
    }
    try {
        return window.localStorage.getItem(LOCAL_STORAGE_KEY) || '';
    } catch (err) {
        console.warn('Unable to read admin credentials', err);
        return '';
    }
};

const tabs = [
    { key: 'municipal', label: 'Gemeindesteuerfüsse' },
    { key: 'state', label: 'Staatssteuer-Tarife' },
    { key: 'federal', label: 'Direkte Bundessteuer' },
    { key: 'personal', label: 'Personalsteuer' },
];

function AdminPortal() {
    const [adminAuth, setAdminAuth] = useState(() => readStoredAdminAuth());
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('municipal');

    const storeAuth = (value) => {
        if (typeof window === 'undefined' || !window.localStorage) {
            return;
        }
        try {
            if (value) {
                window.localStorage.setItem(LOCAL_STORAGE_KEY, value);
            } else {
                window.localStorage.removeItem(LOCAL_STORAGE_KEY);
            }
        } catch (err) {
            console.warn('Unable to persist admin credentials', err);
        }
    };

    const handleLogin = (event) => {
        event.preventDefault();
        if (!password) {
            setError('Bitte Admin-Passwort eingeben.');
            return;
        }
        const header = `Basic ${window.btoa(`${ADMIN_USERNAME}:${password}`)}`;
        storeAuth(header);
        setAdminAuth(header);
        setPassword('');
        setError('');
    };

    const clearSession = (message) => {
        setAdminAuth('');
        storeAuth('');
        if (message) {
            setError(message);
        }
    };

    const handleLogout = () => {
        clearSession('');
    };

    const handleUnauthorized = () => {
        clearSession('Admin-Sitzung ist abgelaufen. Bitte erneut anmelden.');
    };

    const currentTabLabel = useMemo(() => tabs.find((tab) => tab.key === activeTab)?.label, [activeTab]);

    if (!adminAuth) {
        return (
            <div className="admin-panel">
                <h2>Admin Steuerverwaltung</h2>
                <p>Dieser Bereich ist nur für Administratoren zugänglich.</p>
                <form className="admin-login" onSubmit={handleLogin}>
                    <label htmlFor="admin-password">Passwort</label>
                    <input
                        id="admin-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Admin-Passwort"
                    />
                    <button type="submit">Anmelden</button>
                </form>
                {error && <p className="admin-error">{error}</p>}
            </div>
        );
    }

    return (
        <div className="admin-panel">
            <div className="admin-panel__header">
                <div>
                    <h2>{currentTabLabel}</h2>
                    <p>Verwaltung der kantonalen Steuerdaten für Simulationen.</p>
                </div>
                <button type="button" className="secondary" onClick={handleLogout}>
                    Abmelden
                </button>
            </div>
            <div className="admin-tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        className={tab.key === activeTab ? 'active' : ''}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            {error && <p className="admin-error">{error}</p>}
            <div className="admin-tab-panel">
                {activeTab === 'municipal' && (
                    <AdminMunicipalTaxes adminAuth={adminAuth} onUnauthorized={handleUnauthorized} />
                )}
                {activeTab === 'state' && (
                    <AdminStateTaxTariffs adminAuth={adminAuth} onUnauthorized={handleUnauthorized} />
                )}
                {activeTab === 'federal' && (
                    <AdminStateTaxTariffs
                        adminAuth={adminAuth}
                        onUnauthorized={handleUnauthorized}
                        mode="federal"
                    />
                )}
                {activeTab === 'personal' && (
                    <AdminPersonalTaxes adminAuth={adminAuth} onUnauthorized={handleUnauthorized} />
                )}
            </div>
        </div>
    );
}

export default AdminPortal;
