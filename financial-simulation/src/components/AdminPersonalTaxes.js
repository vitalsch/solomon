import React, { useCallback, useEffect, useState } from 'react';
import {
    listPersonalTaxesAdmin,
    createPersonalTaxAdmin,
    updatePersonalTaxAdmin,
    deletePersonalTaxAdmin,
} from '../api';

const emptyForm = {
    canton: '',
    amount: '',
};

function AdminPersonalTaxes({ adminAuth, onUnauthorized }) {
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
            const data = await listPersonalTaxesAdmin(adminAuth);
            setRows(data || []);
            setError('');
        } catch (err) {
            setError(err?.message || 'Fehler beim Laden der Personalsteuer.');
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

    const handleCreate = async (event) => {
        event.preventDefault();
        if (!form.canton.trim()) {
            setError('Bitte einen Kanton angeben (z.B. ZH).');
            return;
        }
        if (form.amount === '') {
            setError('Bitte Personalsteuer in CHF angeben.');
            return;
        }
        const amountValue = Number.parseFloat(String(form.amount).replace(',', '.'));
        if (Number.isNaN(amountValue)) {
            setError('Bitte eine gültige Zahl eingeben.');
            return;
        }
        try {
            setSaving(true);
            await createPersonalTaxAdmin(adminAuth, {
                canton: form.canton.trim().toUpperCase(),
                amount: amountValue,
            });
            setForm(emptyForm);
            setError('');
            loadRows();
        } catch (err) {
            setError(err?.message || 'Konnte Personsteuer nicht speichern.');
        } finally {
            setSaving(false);
        }
    };

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
        if (field === 'amount') {
            if (value === '' || value === null) {
                payload.amount = null;
            } else {
                const num = Number.parseFloat(String(value).replace(',', '.'));
                if (Number.isNaN(num)) {
                    setError('Bitte eine gültige Zahl eingeben.');
                    return;
                }
                payload.amount = num;
            }
        } else if (field === 'canton') {
            payload.canton = String(value || '').trim().toUpperCase();
            if (!payload.canton) {
                setError('Kanton darf nicht leer sein.');
                return;
            }
        }
        try {
            await updatePersonalTaxAdmin(adminAuth, rowId, payload);
            setEditingCell(null);
            setError('');
            loadRows();
        } catch (err) {
            setError(err?.message || 'Konnte Eintrag nicht aktualisieren.');
        }
    };

    const handleEditingKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveEditingCell();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing();
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Eintrag für ${row.canton} löschen?`)) {
            return;
        }
        try {
            await deletePersonalTaxAdmin(adminAuth, row.id);
            loadRows();
        } catch (err) {
            setError(err?.message || 'Konnte Eintrag nicht löschen.');
        }
    };

    if (!adminAuth) {
        return null;
    }

    return (
        <div className="admin-section">
            {error && <p className="admin-error">{error}</p>}
            <form className="admin-form" onSubmit={handleCreate}>
                <div className="admin-form__grid">
                    <input
                        name="canton"
                        placeholder="Kanton (z.B. ZH)"
                        value={form.canton}
                        onChange={handleInputChange}
                    />
                    <input
                        name="amount"
                        placeholder="Personalsteuer in CHF"
                        type="number"
                        step="0.01"
                        value={form.amount}
                        onChange={handleInputChange}
                    />
                    <button type="submit" disabled={saving}>
                        {saving ? 'Speichern...' : 'Eintrag hinzufügen'}
                    </button>
                </div>
            </form>
            <div className="admin-table-wrapper">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>Kanton</th>
                            <th>Personalsteuer (CHF pro Person)</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={3} className="empty">
                                    {loading ? 'Lade Daten...' : 'Keine Einträge vorhanden.'}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => (
                                <tr key={row.id}>
                                    <td>
                                        {editingCell && editingCell.rowId === row.id && editingCell.field === 'canton' ? (
                                            <div className="inline-edit">
                                                <input
                                                    value={editingCell.value}
                                                    onChange={handleEditingChange}
                                                    onKeyDown={handleEditingKeyDown}
                                                    autoFocus
                                                />
                                                <button type="button" onClick={saveEditingCell}>
                                                    Speichern
                                                </button>
                                                <button type="button" className="secondary" onClick={cancelEditing}>
                                                    Abbrechen
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                className="cell-button"
                                                onClick={() => startEditingCell(row.id, 'canton', row.canton)}
                                            >
                                                {row.canton}
                                            </button>
                                        )}
                                    </td>
                                    <td>
                                        {editingCell && editingCell.rowId === row.id && editingCell.field === 'amount' ? (
                                            <div className="inline-edit">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={editingCell.value}
                                                    onChange={handleEditingChange}
                                                    onKeyDown={handleEditingKeyDown}
                                                    autoFocus
                                                />
                                                <button type="button" onClick={saveEditingCell}>
                                                    Speichern
                                                </button>
                                                <button type="button" className="secondary" onClick={cancelEditing}>
                                                    Abbrechen
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                className="cell-button"
                                                onClick={() => startEditingCell(row.id, 'amount', row.amount)}
                                            >
                                                {row.amount?.toFixed(2)}
                                            </button>
                                        )}
                                    </td>
                                    <td>
                                        <button type="button" className="danger" onClick={() => handleDelete(row)}>
                                            Löschen
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

export default AdminPersonalTaxes;
