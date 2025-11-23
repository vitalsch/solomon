import React, { useState, useEffect } from 'react';

const TransactionForm = ({
    accounts = [],
    transaction,
    selectedAssetId,
    onSave,
    onDelete,
    disableAssetSelect = false,
}) => {
    const [assetId, setAssetId] = useState(selectedAssetId || '');
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');
    const [month, setMonth] = useState('');
    const [year, setYear] = useState('');
    const [type, setType] = useState('one_time'); // 'one_time', 'regular', 'mortgage_interest'
    const [frequency, setFrequency] = useState('');
    const [endMonth, setEndMonth] = useState('');
    const [endYear, setEndYear] = useState('');
    const [annualGrowthRate, setAnnualGrowthRate] = useState('');
    const [doubleEntry, setDoubleEntry] = useState(false);
    const [counterAssetId, setCounterAssetId] = useState('');
    const [mortgageAssetId, setMortgageAssetId] = useState('');
    const [interestRate, setInterestRate] = useState('');
    const [taxable, setTaxable] = useState(false);
    const [taxableAmount, setTaxableAmount] = useState('');

    useEffect(() => {
        // Prefill form when editing or when the default asset changes
        if (transaction) {
            setAssetId(transaction.asset_id || '');
            setName(transaction.name);
            setAmount(transaction.amount);
            setMonth(transaction.start_month);
            setYear(transaction.start_year);
            if (transaction.type === 'regular') {
                setType('regular');
                setEndMonth(transaction.end_month);
                setEndYear(transaction.end_year);
                setFrequency(transaction.frequency);
                setAnnualGrowthRate(transaction.annual_growth_rate);
                setInterestRate('');
                setMortgageAssetId('');
                setDoubleEntry(Boolean(transaction.double_entry));
            } else if (transaction.type === 'mortgage_interest') {
                setType('mortgage_interest');
                setFrequency(transaction.frequency);
                setMortgageAssetId(transaction.mortgage_asset_id || '');
                setInterestRate(
                    transaction.annual_interest_rate !== undefined
                        ? transaction.annual_interest_rate
                        : transaction.annual_growth_rate || ''
                );
                setEndMonth(transaction.end_month);
                setEndYear(transaction.end_year);
                setAnnualGrowthRate('');
                setDoubleEntry(false);
            } else {
                setType('one_time');
                setEndMonth('');
                setEndYear('');
                setFrequency('');
                setAnnualGrowthRate('');
                setInterestRate('');
                setMortgageAssetId('');
                setDoubleEntry(Boolean(transaction.double_entry));
            }
            setCounterAssetId(transaction.counter_asset_id || '');
            setTaxable(Boolean(transaction.taxable));
            setTaxableAmount(
                transaction.taxable_amount !== undefined && transaction.taxable_amount !== null
                    ? transaction.taxable_amount
                    : transaction.amount ?? ''
            );
        } else {
            setAssetId(selectedAssetId || accounts[0]?.id || '');
            setName('');
            setAmount('');
            setMonth('');
            setYear('');
            setType('one_time');
            setFrequency('');
            setEndMonth('');
            setEndYear('');
            setAnnualGrowthRate('');
            setCounterAssetId('');
            setDoubleEntry(false);
            setMortgageAssetId('');
            setInterestRate('');
            setTaxable(false);
            setTaxableAmount('');
        }
    }, [transaction, selectedAssetId, accounts]);

    const parseIntSafe = (value) => (value === '' || value === undefined ? undefined : parseInt(value, 10));
    const parseFloatSafe = (value) => (value === '' || value === undefined ? undefined : parseFloat(value));

    useEffect(() => {
        if (type === 'mortgage_interest') {
            setDoubleEntry(false);
            setCounterAssetId('');
        }
    }, [type]);

    const handleSaveTransaction = () => {
        if (!assetId) return;
        const payload = {
            asset_id: assetId,
            name,
            type,
            start_month: parseIntSafe(month),
            start_year: parseIntSafe(year),
            double_entry: doubleEntry,
        };

        if (type !== 'mortgage_interest') {
            const parsedAmount = parseFloatSafe(amount);
            payload.amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;
        } else {
            payload.amount = 0;
        }

        if (type === 'regular') {
            payload.end_month = parseIntSafe(endMonth);
            payload.end_year = parseIntSafe(endYear);
            payload.frequency = parseIntSafe(frequency);
            payload.annual_growth_rate = parseFloatSafe(annualGrowthRate);
        } else if (type === 'mortgage_interest') {
            payload.frequency = parseIntSafe(frequency);
            payload.mortgage_asset_id = mortgageAssetId;
            payload.annual_interest_rate = parseFloatSafe(interestRate);
            payload.end_month = parseIntSafe(endMonth) || payload.start_month;
            payload.end_year = parseIntSafe(endYear) || payload.start_year;
            payload.double_entry = false;
            delete payload.counter_asset_id;
        } else {
            delete payload.end_month;
            delete payload.end_year;
            delete payload.frequency;
            payload.annual_growth_rate = 0;
        }

        if (type !== 'mortgage_interest' && doubleEntry && counterAssetId) {
            payload.counter_asset_id = counterAssetId;
        } else if (doubleEntry && !counterAssetId) {
            // Require a counter asset for double-entry
            return;
        } else {
            delete payload.counter_asset_id;
        }

        payload.taxable = taxable;
        if (taxable) {
            const parsedTaxable = parseFloatSafe(taxableAmount === '' ? amount : taxableAmount);
            payload.taxable_amount = Number.isFinite(parsedTaxable)
                ? parsedTaxable
                : Number.isFinite(payload.amount)
                ? payload.amount
                : 0;
        } else {
            payload.taxable_amount = undefined;
        }

        onSave(transaction ? transaction.id : null, payload);
    };

    return (
        <div className="transaction-form">
            <div className="form-grid">
                <label>
                    <span>{type === 'mortgage_interest' ? 'Payer Asset' : 'Debit Asset'}</span>
                    <select
                        value={assetId}
                        onChange={(e) => setAssetId(e.target.value)}
                        disabled={disableAssetSelect && Boolean(transaction)}
                    >
                        {accounts.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                                {candidate.name}
                            </option>
                        ))}
                    </select>
                </label>
                <>
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={taxable}
                            onChange={(e) => {
                                const next = e.target.checked;
                                setTaxable(next);
                                if (next && (taxableAmount === '' || taxableAmount === undefined)) {
                                    setTaxableAmount(amount || 0);
                                }
                            }}
                        />
                        <span>Steuerbar</span>
                    </label>
                    {taxable && (
                        <label>
                            <span>Anrechenbarer Amount</span>
                            <input
                                type="number"
                                value={taxableAmount}
                                onChange={(e) => setTaxableAmount(e.target.value)}
                                step="0.01"
                            />
                        </label>
                    )}
                </>
                <label>
                    <span>Name</span>
                    <input
                        type="text"
                        placeholder="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </label>
                <label>
                    <span>Amount</span>
                    <input
                        type="number"
                        placeholder="Amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={type === 'mortgage_interest'}
                        step="0.01"
                    />
                </label>
                <label>
                    <span>Month</span>
                    <input
                        type="number"
                        placeholder="Month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                    />
                </label>
                <label>
                    <span>Year</span>
                    <input
                        type="number"
                        placeholder="Year"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                    />
                </label>
                <label>
                    <span>Type</span>
                    <select value={type} onChange={(e) => setType(e.target.value)}>
                        <option value="one_time">One-Time</option>
                        <option value="regular">Regular</option>
                        <option value="mortgage_interest">Mortgage Interest</option>
                    </select>
                </label>
                {type !== 'mortgage_interest' && (
                    <>
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={doubleEntry}
                                onChange={(e) => setDoubleEntry(e.target.checked)}
                            />
                            <span>Double entry (Debit/Credit)</span>
                        </label>
                        <label>
                            <span>Counter Asset (Credit)</span>
                            <select
                                value={counterAssetId}
                                onChange={(e) => setCounterAssetId(e.target.value)}
                                disabled={!doubleEntry}
                            >
                                <option value="">Select counter asset</option>
                                {accounts
                                    .filter((candidate) => candidate.id !== assetId)
                                    .map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>
                                            {candidate.name}
                                        </option>
                                    ))}
                            </select>
                        </label>
                    </>
                )}
                {type === 'mortgage_interest' && (
                    <>
                        <label>
                            <span>Mortgage Asset</span>
                            <select
                                value={mortgageAssetId}
                                onChange={(e) => setMortgageAssetId(e.target.value)}
                            >
                                <option value="">Select mortgage</option>
                                {accounts
                                    .filter((candidate) => candidate.asset_type === 'mortgage')
                                    .map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>
                                            {candidate.name}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        <label>
                            <span>Annual Interest Rate</span>
                            <input
                                type="number"
                                placeholder="e.g. 0.02 for 2%"
                                value={interestRate}
                                onChange={(e) => setInterestRate(e.target.value)}
                                step="0.0001"
                            />
                        </label>
                    </>
                )}
                {type === 'regular' && (
                    <>
                        <label>
                            <span>End Month</span>
                            <input
                                type="number"
                                placeholder="End Month"
                                value={endMonth}
                                onChange={(e) => setEndMonth(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>End Year</span>
                            <input
                                type="number"
                                placeholder="End Year"
                                value={endYear}
                                onChange={(e) => setEndYear(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>Frequency (months)</span>
                            <input
                                type="number"
                                placeholder="Frequency (months)"
                                value={frequency}
                                onChange={(e) => setFrequency(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>Annual Growth Rate</span>
                            <input
                                type="number"
                                placeholder="Annual Growth Rate"
                                value={annualGrowthRate}
                                onChange={(e) => setAnnualGrowthRate(e.target.value)}
                                step="0.01"
                            />
                        </label>
                    </>
                )}
                {type === 'mortgage_interest' && (
                    <>
                        <label>
                            <span>End Month</span>
                            <input
                                type="number"
                                placeholder="End Month"
                                value={endMonth}
                                onChange={(e) => setEndMonth(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>End Year</span>
                            <input
                                type="number"
                                placeholder="End Year"
                                value={endYear}
                                onChange={(e) => setEndYear(e.target.value)}
                            />
                        </label>
                        <label>
                            <span>Frequency (months)</span>
                            <input
                                type="number"
                                placeholder="Frequency (months)"
                                value={frequency}
                                onChange={(e) => setFrequency(e.target.value)}
                            />
                        </label>
                    </>
                )}
            </div>
            <div className="transaction-form-actions">
                {transaction && onDelete && (
                    <button className="secondary danger" onClick={() => onDelete(transaction.id, transaction.asset_id)}>
                        Delete
                    </button>
                )}
                <button onClick={handleSaveTransaction}>
                    {transaction ? 'Update Transaction' : 'Add Transaction'}
                </button>
            </div>
        </div>
    );
};

export default TransactionForm;
