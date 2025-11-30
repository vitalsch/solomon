import React, { useState } from 'react';

const Account = ({
    account,
    transactions = [],
    accountNameMap = {},
    updateAccount,
    deleteAccount,
    onEditTransaction,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(account.name);
    const [annualGrowthRate, setAnnualGrowthRate] = useState(account.annual_growth_rate * 100);
    const [initialBalance, setInitialBalance] = useState(account.initial_balance);
    const [assetType, setAssetType] = useState(account.asset_type || 'generic');
    const formatMonthInput = (year, month) => {
        if (!year || !month) return '';
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    };
    const [startMonthInput, setStartMonthInput] = useState(formatMonthInput(account.start_year, account.start_month));
    const [endMonthInput, setEndMonthInput] = useState(formatMonthInput(account.end_year, account.end_month));

    const parseMonthValue = (value) => {
        if (!value) return null;
        const [yearStr, monthStr] = value.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
        return { year, month };
    };

    const handleUpdateAccount = () => {
        const payload = {
            name,
            annual_growth_rate: parseFloat(annualGrowthRate) / 100,
            initial_balance: parseFloat(initialBalance),
            asset_type: assetType,
        };
        const startParts = parseMonthValue(startMonthInput);
        const endParts = parseMonthValue(endMonthInput);
        if (startParts) {
            payload.start_year = startParts.year;
            payload.start_month = startParts.month;
        }
        if (endParts) {
            payload.end_year = endParts.year;
            payload.end_month = endParts.month;
        }
        updateAccount(account.id, payload);
        setIsEditing(false);
    };

    const typeLabelMap = {
        generic: 'Allgemein',
        bank_account: 'Konto',
        real_estate: 'Immobilie',
        mortgage: 'Hypothek',
        portfolio: 'Portfolio',
    };

    return (
        <div className={`account-card ${isEditing ? 'editing' : ''}`}>
            {isEditing ? (
                <div className="account-form">
                    <label>
                        <span>Name</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <label>
                        <span>Wachstum % p.a.</span>
                        <input
                            type="number"
                            value={annualGrowthRate}
                            onChange={(e) => setAnnualGrowthRate(e.target.value)}
                            placeholder="Annual Growth Rate (%)"
                        />
                    </label>
                    <label>
                        <span>Startguthaben</span>
                        <input
                            type="number"
                            value={initialBalance}
                            onChange={(e) => setInitialBalance(e.target.value)}
                            placeholder="Initial Balance"
                        />
                    </label>
                    <label>
                        <span>Typ</span>
                        <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
                            <option value="generic">Allgemein</option>
                            <option value="bank_account">Konto</option>
                            <option value="real_estate">Immobilie</option>
                            <option value="mortgage">Hypothek</option>
                            <option value="portfolio">Portfolio</option>
                        </select>
                    </label>
                    <label>
                        <span>Start (optional)</span>
                        <input
                            type="month"
                            value={startMonthInput}
                            onChange={(e) => setStartMonthInput(e.target.value)}
                        />
                    </label>
                    <label>
                        <span>Ende (optional)</span>
                        <input
                            type="month"
                            value={endMonthInput}
                            onChange={(e) => setEndMonthInput(e.target.value)}
                        />
                    </label>
                    <div className="account-actions">
                        <button onClick={handleUpdateAccount}>Speichern</button>
                        <button className="secondary" onClick={() => setIsEditing(false)}>
                            Abbrechen
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="account-summary">
                        <div className="account-header">
                            <h3 className="truncate">{account.name}</h3>
                            <div className="account-badges">
                                <span className="badge muted">{typeLabelMap[account.asset_type] || 'Asset'}</span>
                                <span className="account-growth">
                                    {(account.annual_growth_rate * 100).toFixed(2)}%
                                </span>
                            </div>
                        </div>
                        <div className="account-balance highlight">
                            {account.initial_balance.toLocaleString('de-CH', {
                                style: 'currency',
                                currency: 'CHF',
                            })}
                        </div>
                        <div className="account-meta-grid">
                            <div>
                                <span className="label">pro Jahr</span>
                                <strong>{(account.annual_growth_rate * 100).toFixed(2)}%</strong>
                            </div>
                            <div>
                                <span className="label">Transaktionen</span>
                                <strong>{transactions.length}</strong>
                            </div>
                        </div>
                        <div className="account-actions">
                            <button onClick={() => setIsEditing(true)}>Bearbeiten</button>
                            <button className="secondary danger" onClick={() => deleteAccount(account.id)}>
                                Löschen
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default Account;
