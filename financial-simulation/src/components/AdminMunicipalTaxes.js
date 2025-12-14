import React, { useCallback, useEffect, useState } from 'react';
import {
    createMunicipalTaxRateAdmin,
    deleteMunicipalTaxRateAdmin,
    listMunicipalTaxRatesAdmin,
    updateMunicipalTaxRateAdmin,
} from '../api';

const DEFAULT_CANTON = 'ZH';

const emptyForm = {
    municipality: '',
    canton: DEFAULT_CANTON,
    base_rate: '',
    ref_rate: '',
    cath_rate: '',
    christian_cath_rate: '',
};

const formatRate = (value) =>
    value === null || value === undefined || value === ''
        ? '—'
        : `${Number(value).toFixed(2)} %`;

const parseRate = (value) => {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
};

function AdminMunicipalTaxes({ adminAuth, onUnauthorized }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState(emptyForm);
    const [editingCell, setEditingCell] = useState(null);

    const loadRows = useCallback(async () => {
        if (!adminAuth) return;
        setLoading(true);
        try {
            const data = await listMunicipalTaxRatesAdmin(adminAuth, DEFAULT_CANTON);
            setRows(
                (data || []).map((entry) => ({
                    ...entry,
                    base_rate: entry.base_rate ?? 0,
                    ref_rate: entry.ref_rate ?? null,
                    cath_rate: entry.cath_rate ?? null,
                    christian_cath_rate: entry.christian_cath_rate ?? null,
                })),
            );
            setError('');
        } catch (err) {
            const message = err?.message || 'Fehler beim Laden der Steuerfüsse.';
            setError(message);
            if (err?.status === 401 && typeof onUnauthorized === 'function') {
                onUnauthorized();
            }
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [adminAuth, onUnauthorized]);

    useEffect(() => {
        if (adminAuth) {
            loadRows();
        } else {
            setRows([]);
        }
    }, [adminAuth, loadRows]);

    const handleInputChange = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleAddRow = async (event) => {
        event.preventDefault();
        if (!form.municipality.trim()) {
            setError('Bitte einen Gemeindenamen angeben.');
            return;
        }
        if (form.base_rate === '') {
            setError('Bitte den Steuerfuss ohne Kirche ausfüllen.');
            return;
        }
        try {
            setSaving(true);
            await createMunicipalTaxRateAdmin(adminAuth, {
                municipality: form.municipality.trim(),
                canton: form.canton || DEFAULT_CANTON,
                base_rate: parseRate(form.base_rate) ?? 0,
                ref_rate: parseRate(form.ref_rate),
                cath_rate: parseRate(form.cath_rate),
                christian_cath_rate: parseRate(form.christian_cath_rate),
            });
            setForm({ ...emptyForm });
            setError('');
            loadRows();
        } catch (err) {
            setError(err?.message || 'Konnte Gemeinde nicht speichern.');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteRow = async (entryId, municipality) => {
        if (!window.confirm(`Eintrag für ${municipality} wirklich löschen?`)) {
            return;
        }
        try {
            await deleteMunicipalTaxRateAdmin(adminAuth, entryId);
            loadRows();
        } catch (err) {
            setError(err?.message || 'Konnte Eintrag nicht löschen.');
        }
    };

    const numericFields = new Set(['base_rate', 'ref_rate', 'cath_rate', 'christian_cath_rate']);

    const startEditingCell = (rowId, field, value) => {
        setEditingCell({ rowId, field, value: value ?? '' });
    };

    const handleEditingChange = (event) => {
        const { value } = event.target;
        setEditingCell((prev) => (prev ? { ...prev, value } : prev));
    };

    const cancelEditing = () => setEditingCell(null);

    const saveEditingCell = async () => {
        if (!editingCell) return;
        const { rowId, field, value } = editingCell;
        const payload = {};
        if (numericFields.has(field)) {
            if (value === '' || value === null) {
                payload[field] = null;
            } else {
                const parsed = parseFloat(String(value).replace(',', '.'));
                if (Number.isNaN(parsed)) {
                    setError('Bitte eine gültige Zahl eingeben.');
                    return;
                }
                payload[field] = parsed;
            }
        } else {
            payload[field] = value;
        }
        try {
            await updateMunicipalTaxRateAdmin(adminAuth, rowId, payload);
            setEditingCell(null);
            setError('');
            await loadRows();
        } catch (err) {
            setError(err?.message || 'Wert konnte nicht gespeichert werden.');
        }
    };

    const handleCellKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveEditingCell();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing();
        }
    };

    const renderEditableCell = (row, field, formatter, placeholder = '—') => {
        const isEditing = editingCell && editingCell.rowId === row.id && editingCell.field === field;
        if (isEditing) {
            return (
                <div className="inline-edit">
                    <input
                        type={numericFields.has(field) ? 'number' : 'text'}
                        step={numericFields.has(field) ? '0.01' : undefined}
                        value={editingCell.value}
                        onChange={handleEditingChange}
                        onKeyDown={handleCellKeyDown}
                        autoFocus
                    />
                    <button type="button" onClick={saveEditingCell}>
                        Speichern
                    </button>
                    <button type="button" className="secondary" onClick={cancelEditing}>
                        Abbrechen
                    </button>
                </div>
            );
        }
        const displayValue = formatter ? formatter(row[field]) : row[field] || placeholder;
        return (
            <button
                type="button"
                className="cell-button"
                onClick={() => startEditingCell(row.id, field, row[field] ?? '')}
            >
                {displayValue}
            </button>
        );
    };

    if (!adminAuth) {
        return null;
    }

    return (
        <div className="admin-section">
            <div>
                <p>Alle Angaben in Prozent, zwei Dezimalstellen (z.B. 115.00 %).</p>
            </div>

            {error && <p className="admin-error">{error}</p>}

            <form className="admin-form" onSubmit={handleAddRow}>
                <div className="admin-form__grid">
                    <input
                        name="municipality"
                        placeholder="Gemeinde"
                        value={form.municipality}
                        onChange={handleInputChange}
                    />
                    <input
                        name="base_rate"
                        placeholder="Steuerfuss ohne Kirche"
                        type="number"
                        step="0.01"
                        value={form.base_rate}
                        onChange={handleInputChange}
                    />
                    <input
                        name="ref_rate"
                        placeholder="ref. Kirche"
                        type="number"
                        step="0.01"
                        value={form.ref_rate}
                        onChange={handleInputChange}
                    />
                    <input
                        name="cath_rate"
                        placeholder="kath. Kirche"
                        type="number"
                        step="0.01"
                        value={form.cath_rate}
                        onChange={handleInputChange}
                    />
                    <input
                        name="christian_cath_rate"
                        placeholder="christ.-kath. Kirche"
                        type="number"
                        step="0.01"
                        value={form.christian_cath_rate}
                        onChange={handleInputChange}
                    />
                    <button type="submit" disabled={saving || loading}>
                        {saving ? 'Speichern...' : 'Eintrag hinzufügen'}
                    </button>
                </div>
            </form>

            <div className="admin-table-wrapper">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>Gemeinde</th>
                            <th>Steuerfüsse ohne Kirche</th>
                            <th>ref. Kirche</th>
                            <th>kath. Kirche</th>
                            <th>christ.-kath. Kirche</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="empty">
                                    {loading ? 'Lade Daten...' : 'Keine Einträge vorhanden.'}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => (
                                <tr key={row.id}>
                                    <td>{renderEditableCell(row, 'municipality', null, 'Gemeinde')}</td>
                                    <td>{renderEditableCell(row, 'base_rate', formatRate)}</td>
                                    <td>{renderEditableCell(row, 'ref_rate', formatRate)}</td>
                                    <td>{renderEditableCell(row, 'cath_rate', formatRate)}</td>
                                    <td>{renderEditableCell(row, 'christian_cath_rate', formatRate)}</td>
                                    <td>
                                        <button
                                            type="button"
                                            className="danger"
                                            onClick={() => handleDeleteRow(row.id, row.municipality)}
                                        >
                                            Entfernen
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default AdminMunicipalTaxes;
