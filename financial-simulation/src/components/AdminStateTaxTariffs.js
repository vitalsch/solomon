import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createStateTaxTariffAdmin,
    deleteStateTaxTariffAdmin,
    listStateTaxTariffsAdmin,
    updateStateTaxTariffAdmin,
    listFederalTaxTablesAdmin,
    createFederalTaxTableAdmin,
    updateFederalTaxTableAdmin,
    deleteFederalTaxTableAdmin,
    importStateTaxTariffRowsAdmin,
    importFederalTaxTableRowsAdmin,
} from '../api';

const emptyTariffForm = {
    name: '',
    scope: 'income',
    canton: 'ZH',
    description: '',
};

const emptyRowDraft = {
    threshold: '',
    base_amount: '',
    per_100_amount: '',
    note: '',
};

const scopeLabel = (scope) => (scope === 'wealth' ? 'Vermögen' : 'Einkommen');
const JSON_IMPORT_HINT =
    'JSON-Array, z.B. [{"threshold":0,"base_amount":0,"per_100_amount":11.5,"note":"optional"}]';
const CHILD_HINT = 'CHF pro Kind; wird mit Anzahl Kinder multipliziert und von der Bundessteuer abgezogen.';

const formatCurrency = (value) => {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    return Number(value).toLocaleString('de-CH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};

const parseNumber = (value) => {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    const numeric = Number.parseFloat(value);
    return Number.isNaN(numeric) ? null : numeric;
};

const normalizeTariff = (tariff = {}) => ({
    ...tariff,
    rows: Array.isArray(tariff.rows) ? tariff.rows : [],
});

function AdminStateTaxTariffs({ adminAuth, onUnauthorized, mode = 'state' }) {
    const [tariffs, setTariffs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState(emptyTariffForm);
    const [rowDrafts, setRowDrafts] = useState({});
    const [importingId, setImportingId] = useState(null);
    const [editingValue, setEditingValue] = useState(null);
    const [editingTariffMeta, setEditingTariffMeta] = useState(null);
    const [rowSortConfigs, setRowSortConfigs] = useState({});
    const [childDeductionDrafts, setChildDeductionDrafts] = useState({});

    const isFederal = mode === 'federal';
    const emptyMessage = useMemo(
        () =>
            isFederal
                ? 'Noch keine Tabellen für die direkte Bundessteuer erfasst.'
                : 'Noch keine Staatssteuertarife erfasst.',
        [isFederal],
    );

    const loadTariffs = useCallback(async () => {
        if (!adminAuth) return;
        setLoading(true);
        try {
            const data = isFederal
                ? await listFederalTaxTablesAdmin(adminAuth)
                : await listStateTaxTariffsAdmin(adminAuth);
            const normalized = (data || []).map(normalizeTariff);
            setTariffs(normalized);
            if (isFederal) {
                const map = {};
                normalized.forEach((tariff) => {
                    map[tariff.id] = tariff.child_deduction_per_child ?? '';
                });
                setChildDeductionDrafts(map);
            } else {
                setChildDeductionDrafts({});
            }
            setRowDrafts({});
            setError('');
        } catch (err) {
            const message = err?.message || 'Fehler beim Laden der Staatssteuertarife.';
            setError(message);
            if (err?.status === 401 && typeof onUnauthorized === 'function') {
                onUnauthorized();
            }
            setTariffs([]);
        } finally {
            setLoading(false);
        }
    }, [adminAuth, onUnauthorized, isFederal]);

    useEffect(() => {
        if (adminAuth) {
            loadTariffs();
        } else {
            setTariffs([]);
        }
    }, [adminAuth, loadTariffs]);

    const handleTariffFormChange = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleCreateTariff = async (event) => {
        event.preventDefault();
        if (!form.name.trim()) {
            setError('Bitte einen Namen für den Tarif angeben.');
            return;
        }
        if (!isFederal && !form.canton.trim()) {
            setError('Bitte einen Kanton (z.B. ZH) angeben.');
            return;
        }
        try {
            setCreating(true);
            const created = isFederal
                ? await createFederalTaxTableAdmin(adminAuth, {
                      name: form.name.trim(),
                      description: form.description?.trim() || undefined,
                      rows: [],
                      child_deduction_per_child: childDeductionDrafts['__new'] || null,
                  })
                : await createStateTaxTariffAdmin(adminAuth, {
                      name: form.name.trim(),
                      scope: form.scope,
                      canton: form.canton.trim().toUpperCase(),
                      description: form.description?.trim() || undefined,
                      rows: [],
                  });
            setForm(emptyTariffForm);
            if (isFederal) {
                setChildDeductionDrafts((prev) => ({ ...prev, __new: '' }));
            }
            setError('');
            if (created) {
                setTariffs((prev) => [...prev, normalizeTariff(created)]);
            } else {
                await loadTariffs();
            }
        } catch (err) {
            setError(err?.message || 'Konnte Tarif nicht speichern.');
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteTariff = async (tariff) => {
        if (!window.confirm(`Tarif "${tariff.name}" wirklich löschen?`)) {
            return;
        }
        try {
            if (isFederal) {
                await deleteFederalTaxTableAdmin(adminAuth, tariff.id);
            } else {
                await deleteStateTaxTariffAdmin(adminAuth, tariff.id);
            }
            setTariffs((prev) => prev.filter((entry) => entry.id !== tariff.id));
        } catch (err) {
            setError(err?.message || 'Tarif konnte nicht gelöscht werden.');
        }
    };

    const handleRowDraftChange = (tariffId, event) => {
        const { name, value } = event.target;
        setRowDrafts((prev) => ({
            ...prev,
            [tariffId]: { ...(prev[tariffId] || emptyRowDraft), [name]: value },
        }));
    };

    const handleAddRow = async (tariff) => {
        const draft = rowDrafts[tariff.id] || emptyRowDraft;
        if (draft.threshold === '' || draft.base_amount === '' || draft.per_100_amount === '') {
            setError('Bitte Schwelle, Sockel und Zuschlag ausfüllen.');
            return;
        }
        const newRow = {
            threshold: parseNumber(draft.threshold) ?? 0,
            base_amount: parseNumber(draft.base_amount) ?? 0,
            per_100_amount: parseNumber(draft.per_100_amount) ?? 0,
            note: draft.note?.trim() || undefined,
        };
        try {
            const nextRows = [...(tariff.rows || []), newRow];
            if (isFederal) {
                await updateFederalTaxTableAdmin(adminAuth, tariff.id, { rows: nextRows });
            } else {
                await updateStateTaxTariffAdmin(adminAuth, tariff.id, { rows: nextRows });
            }
            setRowDrafts((prev) => ({ ...prev, [tariff.id]: { ...emptyRowDraft } }));
            setError('');
            setTariffs((prev) =>
                prev.map((entry) => (entry.id === tariff.id ? normalizeTariff({ ...entry, rows: nextRows }) : entry)),
            );
        } catch (err) {
            setError(err?.message || 'Zeile konnte nicht hinzugefügt werden.');
        }
    };

    const handleDeleteRow = async (tariff, index) => {
        if (!window.confirm('Diese Tabellenzeile wirklich entfernen?')) {
            return;
        }
        const updatedRows = (tariff.rows || []).filter((_, idx) => idx !== index);
        try {
            if (isFederal) {
                await updateFederalTaxTableAdmin(adminAuth, tariff.id, { rows: updatedRows });
            } else {
                await updateStateTaxTariffAdmin(adminAuth, tariff.id, { rows: updatedRows });
            }
            setTariffs((prev) =>
                prev.map((entry) => (entry.id === tariff.id ? normalizeTariff({ ...entry, rows: updatedRows }) : entry)),
            );
        } catch (err) {
            setError(err?.message || 'Zeile konnte nicht entfernt werden.');
        }
    };

    const startEditingValue = (tariffId, rowIndex, field, value) => {
        setEditingValue({ tariffId, rowIndex, field, value: value ?? '' });
    };

    const toggleRowSort = (tariffId, key) => {
        setRowSortConfigs((prev) => {
            const current = prev[tariffId] || { key: 'threshold', direction: 'asc' };
            if (current.key === key) {
                return {
                    ...prev,
                    [tariffId]: { key, direction: current.direction === 'asc' ? 'desc' : 'asc' },
                };
            }
            return { ...prev, [tariffId]: { key, direction: 'asc' } };
        });
    };

    const sortedRowsForTariff = (tariff) => {
        const cfg = rowSortConfigs[tariff.id] || { key: 'threshold', direction: 'asc' };
        const list = (tariff.rows || []).map((row, index) => ({ row, index }));
        list.sort((a, b) => {
            const va = a.row[cfg.key];
            const vb = b.row[cfg.key];
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (typeof va === 'number' && typeof vb === 'number') {
                return cfg.direction === 'asc' ? va - vb : vb - va;
            }
            return cfg.direction === 'asc'
                ? String(va).localeCompare(String(vb))
                : String(vb).localeCompare(String(va));
        });
        return list;
    };

    const handleEditingValueChange = (event) => {
        const { value } = event.target;
        setEditingValue((prev) => (prev ? { ...prev, value } : prev));
    };

    const cancelEditingValue = () => setEditingValue(null);

    const saveEditingValue = async () => {
        if (!editingValue) return;
        const { tariffId, rowIndex, field, value } = editingValue;
        const target = tariffs.find((tariff) => tariff.id === tariffId);
        if (!target) return;
        const rows = [...(target.rows || [])];
        if (!rows[rowIndex]) return;
        const updatedRow = { ...rows[rowIndex] };
        if (field === 'note') {
            updatedRow.note = value?.trim() || '';
        } else {
            const parsed = parseNumber(value);
            if (parsed === null) {
                setError('Bitte eine gültige Zahl eingeben.');
                return;
            }
            updatedRow[field] = parsed;
        }
        rows[rowIndex] = updatedRow;
        try {
            if (isFederal) {
                await updateFederalTaxTableAdmin(adminAuth, tariffId, { rows });
            } else {
                await updateStateTaxTariffAdmin(adminAuth, tariffId, { rows });
            }
            setEditingValue(null);
            setTariffs((prev) =>
                prev.map((entry) => (entry.id === tariffId ? normalizeTariff({ ...entry, rows }) : entry)),
            );
        } catch (err) {
            setError(err?.message || 'Wert konnte nicht gespeichert werden.');
        }
    };

    const handleRowCellKeyDown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveEditingValue();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditingValue();
        }
    };

    const handleImportRowsFromFile = (tariff, event) => {
        const file = event.target.files?.[0];
        if (!file) {
            if (event.target) {
                event.target.value = '';
            }
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const text = typeof reader.result === 'string' ? reader.result : '';
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) {
                    throw new Error('JSON muss ein Array von Zeilen sein.');
                }
                setImportingId(tariff.id);
                const updated = isFederal
                    ? await importFederalTaxTableRowsAdmin(adminAuth, tariff.id, parsed)
                    : await importStateTaxTariffRowsAdmin(adminAuth, tariff.id, parsed);
                setError('');
                if (updated) {
                    setTariffs((prev) =>
                        prev.map((entry) =>
                            entry.id === tariff.id ? normalizeTariff({ ...entry, ...updated }) : entry,
                        ),
                    );
                } else {
                    await loadTariffs();
                }
            } catch (err) {
                setError(err?.message || 'Import fehlgeschlagen (ungültiges JSON).');
            } finally {
                setImportingId(null);
            }
        };
        reader.onerror = () => {
            setImportingId(null);
            setError('Datei konnte nicht gelesen werden.');
        };
        reader.readAsText(file);
        if (event.target) {
            event.target.value = '';
        }
    };

    const startEditingTariffCanton = (tariff) => {
        setEditingTariffMeta({
            tariffId: tariff.id,
            value: tariff.canton || '',
        });
    };

    const handleTariffMetaChange = (event) => {
        const { value } = event.target;
        setEditingTariffMeta((prev) => (prev ? { ...prev, value } : prev));
    };

    const cancelEditingTariffMeta = () => setEditingTariffMeta(null);

    const saveTariffMeta = async () => {
        if (!editingTariffMeta) return;
        const { tariffId, value } = editingTariffMeta;
        const cantonValue = String(value || '').trim().toUpperCase();
        if (!cantonValue) {
            setError('Kanton darf nicht leer sein.');
            return;
        }
        try {
            const updated = await updateStateTaxTariffAdmin(adminAuth, tariffId, { canton: cantonValue });
            setEditingTariffMeta(null);
            if (updated) {
                setTariffs((prev) =>
                    prev.map((entry) =>
                        entry.id === tariffId ? normalizeTariff({ ...entry, ...updated, canton: cantonValue }) : entry,
                    ),
                );
            } else {
                await loadTariffs();
            }
        } catch (err) {
            setError(err?.message || 'Kanton konnte nicht gespeichert werden.');
        }
    };

    const renderRowCell = (tariff, row, rowIndex, field, { isNumeric = false, placeholder = '—' } = {}) => {
        const isEditing =
            editingValue &&
            editingValue.tariffId === tariff.id &&
            editingValue.rowIndex === rowIndex &&
            editingValue.field === field;
        if (isEditing) {
            return (
                <div className="inline-edit">
                    <input
                        type={isNumeric ? 'number' : 'text'}
                        step={isNumeric ? '1' : undefined}
                        value={editingValue.value}
                        onChange={handleEditingValueChange}
                        onKeyDown={handleRowCellKeyDown}
                        autoFocus
                    />
                    <button type="button" onClick={saveEditingValue}>
                        Speichern
                    </button>
                    <button type="button" className="secondary" onClick={cancelEditingValue}>
                        Abbrechen
                    </button>
                </div>
            );
        }
        const displayValue = isNumeric ? formatCurrency(row[field]) : row[field] || placeholder;
        return (
            <button
                type="button"
                className="cell-button"
                onClick={() => startEditingValue(tariff.id, rowIndex, field, row[field] ?? '')}
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
            {error && <p className="admin-error">{error}</p>}

            <form className="admin-form" onSubmit={handleCreateTariff}>
                <div className="admin-form__grid">
                    <input
                        name="name"
                        placeholder={mode === 'federal' ? 'Tabellenname' : 'Tarifname'}
                        value={form.name}
                        onChange={handleTariffFormChange}
                    />
                    {!isFederal && (
                        <input
                            name="canton"
                            placeholder="Kanton (z.B. ZH)"
                            value={form.canton}
                            onChange={handleTariffFormChange}
                        />
                    )}
                    {mode !== 'federal' && (
                        <select name="scope" value={form.scope} onChange={handleTariffFormChange}>
                            <option value="income">Einkommen</option>
                            <option value="wealth">Vermögen</option>
                        </select>
                    )}
                    <input
                        name="description"
                        placeholder="Beschreibung (optional)"
                        value={form.description}
                        onChange={handleTariffFormChange}
                    />
                    <button type="submit" disabled={creating}>
                        {creating ? 'Speichern...' : mode === 'federal' ? 'Tabelle anlegen' : 'Tarif anlegen'}
                    </button>
                </div>
            </form>

            {loading ? (
                <p>Lade Tarife...</p>
            ) : tariffs.length === 0 ? (
                <p className="admin-empty">{emptyMessage}</p>
            ) : (
                <div className="state-tariff-list">
                    {tariffs.map((tariff) => (
                        <div key={tariff.id} className="state-tariff-card">
                            <div className="state-tariff-header">
                                <div>
                                    <h3>
                                        {tariff.name}{' '}
                                        {isFederal ? (
                                            <span className="tag">Direkte Bundessteuer</span>
                                        ) : (
                                            <span className="tag">{scopeLabel(tariff.scope)}</span>
                                        )}
                                    </h3>
                                    {!isFederal && (
                                        <div className="canton-inline">
                                            {editingTariffMeta &&
                                            editingTariffMeta.tariffId === tariff.id ? (
                                                <div className="inline-edit">
                                                    <input
                                                        value={editingTariffMeta.value}
                                                        onChange={handleTariffMetaChange}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                saveTariffMeta();
                                                            } else if (event.key === 'Escape') {
                                                                event.preventDefault();
                                                                cancelEditingTariffMeta();
                                                            }
                                                        }}
                                                        autoFocus
                                                    />
                                                    <button type="button" onClick={saveTariffMeta}>
                                                        Speichern
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="secondary"
                                                        onClick={cancelEditingTariffMeta}
                                                    >
                                                        Abbrechen
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="cell-button"
                                                    onClick={() => startEditingTariffCanton(tariff)}
                                                >
                                                    {tariff.canton || 'Kanton setzen'}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {tariff.description && <p>{tariff.description}</p>}
                                </div>
                                <div className="state-tariff-actions">
                                    <div className="json-upload-group">
                                        <label className="json-upload">
                                            <input
                                                type="file"
                                                accept="application/json"
                                                onChange={(event) => handleImportRowsFromFile(tariff, event)}
                                            />
                                            <span>
                                                {importingId === tariff.id ? 'Importiere...' : 'JSON importieren'}
                                            </span>
                                        </label>
                                        <span className="json-hint" title={JSON_IMPORT_HINT}>
                                            ?
                                        </span>
                                    </div>
                                    {isFederal && (
                                        <div className="child-deduction">
                                            <label className="stacked">
                                                <span>Abzug pro Kind (CHF)</span>
                                                <input
                                                    type="number"
                                                    step="1"
                                                    value={childDeductionDrafts[tariff.id] ?? ''}
                                                    onChange={(e) =>
                                                        setChildDeductionDrafts((prev) => ({
                                                            ...prev,
                                                            [tariff.id]: e.target.value,
                                                        }))
                                                    }
                                                    placeholder="z.B. 6500"
                                                />
                                            </label>
                                            <button
                                                type="button"
                                                className="secondary"
                                                onClick={async () => {
                                                    const value = childDeductionDrafts[tariff.id];
                                                    try {
                                                        await updateFederalTaxTableAdmin(adminAuth, tariff.id, {
                                                            child_deduction_per_child:
                                                                value === '' || value === null ? null : Number(value),
                                                        });
                                                        setTariffs((prev) =>
                                                            prev.map((entry) =>
                                                                entry.id === tariff.id
                                                                    ? normalizeTariff({
                                                                          ...entry,
                                                                          child_deduction_per_child:
                                                                              value === '' || value === null
                                                                                  ? null
                                                                                  : Number(value),
                                                                      })
                                                                    : entry
                                                            )
                                                        );
                                                    } catch (err) {
                                                        setError(err?.message || 'Abzug konnte nicht gespeichert werden.');
                                                    }
                                                }}
                                            >
                                                Speichern
                                            </button>
                                            <span className="json-hint" title={CHILD_HINT}>
                                                ?
                                            </span>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        className="danger"
                                        onClick={() => handleDeleteTariff(tariff)}
                                    >
                                        {isFederal ? 'Tabelle löschen' : 'Tarif löschen'}
                                    </button>
                                </div>
                            </div>
                            <div className="admin-table-wrapper">
                                <table className="admin-table state-tariff-table">
                                    <thead>
                                            <tr>
                                            <th>
                                                <button
                                                    type="button"
                                                    className="cell-button"
                                                    onClick={() => toggleRowSort(tariff.id, 'threshold')}
                                                >
                                                    Schwelle (CHF)
                                                </button>
                                            </th>
                                            <th>
                                                <button
                                                    type="button"
                                                    className="cell-button"
                                                    onClick={() => toggleRowSort(tariff.id, 'base_amount')}
                                                >
                                                    Sockelbetrag (CHF)
                                                </button>
                                            </th>
                                            <th>
                                                <button
                                                    type="button"
                                                    className="cell-button"
                                                    onClick={() => toggleRowSort(tariff.id, 'per_100_amount')}
                                                >
                                                    je 100 CHF (CHF)
                                                </button>
                                            </th>
                                            <th>
                                                <button
                                                    type="button"
                                                    className="cell-button"
                                                    onClick={() => toggleRowSort(tariff.id, 'note')}
                                                >
                                                    Hinweis
                                                </button>
                                            </th>
                                            <th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(tariff.rows || []).length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="empty">
                                                    Keine Daten hinterlegt.
                                                </td>
                                            </tr>
                                        ) : (
                                            sortedRowsForTariff(tariff).map(({ row, index }) => (
                                                <tr key={`${tariff.id}-row-${index}`}>
                                                    <td>
                                                        {renderRowCell(tariff, row, index, 'threshold', { isNumeric: true })}
                                                    </td>
                                                    <td>
                                                        {renderRowCell(tariff, row, index, 'base_amount', { isNumeric: true })}
                                                    </td>
                                                    <td>
                                                        {renderRowCell(tariff, row, index, 'per_100_amount', {
                                                            isNumeric: true,
                                                        })}
                                                    </td>
                                                    <td>{renderRowCell(tariff, row, index, 'note', { placeholder: '—' })}</td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="danger"
                                                            onClick={() => handleDeleteRow(tariff, index)}
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
                            <div className="state-tariff-rowform">
                                <input
                                    name="threshold"
                                    placeholder="Schwelle (CHF)"
                                    type="number"
                                    step="100"
                                    value={(rowDrafts[tariff.id] || emptyRowDraft).threshold}
                                    onChange={(event) => handleRowDraftChange(tariff.id, event)}
                                />
                                <input
                                    name="base_amount"
                                    placeholder="Sockelbetrag"
                                    type="number"
                                    step="1"
                                    value={(rowDrafts[tariff.id] || emptyRowDraft).base_amount}
                                    onChange={(event) => handleRowDraftChange(tariff.id, event)}
                                />
                                <input
                                    name="per_100_amount"
                                    placeholder="je 100 CHF"
                                    type="number"
                                    step="1"
                                    value={(rowDrafts[tariff.id] || emptyRowDraft).per_100_amount}
                                    onChange={(event) => handleRowDraftChange(tariff.id, event)}
                                />
                                <input
                                    name="note"
                                    placeholder="Hinweis (optional)"
                                    value={(rowDrafts[tariff.id] || emptyRowDraft).note}
                                    onChange={(event) => handleRowDraftChange(tariff.id, event)}
                                />
                                <button type="button" onClick={() => handleAddRow(tariff)}>
                                    Zeile hinzufügen
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default AdminStateTaxTariffs;
