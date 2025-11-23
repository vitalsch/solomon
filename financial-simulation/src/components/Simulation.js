import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import Account from './Account';
import TransactionForm from './TransactionForm';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    registerUser,
    loginUser,
    getCurrentUser,
    listScenarios,
    createScenario,
    getScenario,
    listAssets,
    createAsset,
    updateAsset,
    deleteAsset,
    listTransactions,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    deleteScenario,
    simulateScenario,
    setAuthToken,
    getAuthToken,
} from '../api';
import '../TransactionsList.css';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const normalizeId = (value) => (value === null || value === undefined ? '' : String(value));
const cacheKey = (userId, scenarioId) => `${normalizeId(userId)}::${normalizeId(scenarioId)}`;

const Simulation = () => {
    const [users, setUsers] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [newUserName, setNewUserName] = useState('');
    const [newUsername, setNewUsername] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserEmail, setNewUserEmail] = useState('');
    const [scenarios, setScenarios] = useState([]);
    const [currentScenarioId, setCurrentScenarioId] = useState('');
    const [scenarioDetails, setScenarioDetails] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [accountTransactions, setAccountTransactions] = useState({});
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountGrowthRate, setNewAccountGrowthRate] = useState('');
    const [newAccountInitialBalance, setNewAccountInitialBalance] = useState('');
    const [newAccountType, setNewAccountType] = useState('generic');
    const [newScenarioName, setNewScenarioName] = useState('');
    const [cloneScenarioId, setCloneScenarioId] = useState('');
    const [newScenarioStart, setNewScenarioStart] = useState('2024-05');
    const [newScenarioEnd, setNewScenarioEnd] = useState('2044-09');
    const [selectedScenarios, setSelectedScenarios] = useState([]);
    const [simulationCache, setSimulationCache] = useState({});
    const [cashFlows, setCashFlows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [transactionModalTransaction, setTransactionModalTransaction] = useState(null);
    const [transactionModalAssetId, setTransactionModalAssetId] = useState('');
    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [chartRange, setChartRange] = useState({ start: 0, end: null });
    const [expandedYears, setExpandedYears] = useState([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const formatCurrency = (value) =>
        (value ?? 0).toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });

    const currentScenario = useMemo(
        () => scenarios.find((scenario) => normalizeId(scenario.id) === normalizeId(currentScenarioId)),
        [scenarios, currentScenarioId]
    );
    const selectedUser = useMemo(
        () => users.find((user) => normalizeId(user.id) === normalizeId(selectedUserId)),
        [users, selectedUserId]
    );
    const currentSimulation = useMemo(
        () => simulationCache[cacheKey(selectedUserId, currentScenarioId)] || null,
        [simulationCache, selectedUserId, currentScenarioId]
    );
    const formatScenarioRange = useCallback((scenario) => {
        if (!scenario) return null;
        const { start_year, start_month, end_year, end_month } = scenario;
        if (!start_year || !start_month || !end_year || !end_month) return null;
        return `${start_month}/${start_year} - ${end_month}/${end_year}`;
    }, []);

    const groupedTransactions = useMemo(() => {
        const grouping = { ...accountTransactions };
        accounts.forEach((account) => {
            if (!grouping[account.id]) {
                grouping[account.id] = [];
            }
        });
        return grouping;
    }, [accounts, accountTransactions]);

    const allTransactions = useMemo(() => {
        const flattened = Object.values(groupedTransactions || {}).flat();
        return flattened.sort((a, b) => {
            const aKey = (a.start_year || 0) * 100 + (a.start_month || 0);
            const bKey = (b.start_year || 0) * 100 + (b.start_month || 0);
            return bKey - aKey;
        });
    }, [groupedTransactions]);

    const cashFlowData = useMemo(() => {
        if (!cashFlows || !cashFlows.length) return [];
        return cashFlows.map((entry) => ({
            ...entry,
            dateObj: (() => {
                const d = new Date(entry.date);
                return new Date(d.getFullYear(), d.getMonth() + 1, 0); // end of month
            })(),
            dateLabel: (() => {
                const d = new Date(entry.date);
                const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                return end.toLocaleDateString('de-CH');
            })(),
            year: new Date(entry.date).getFullYear(),
        }));
    }, [cashFlows]);

    const yearlyCashFlow = useMemo(() => {
        const map = new Map();
        cashFlowData.forEach((entry) => {
            const year = entry.year;
            if (!map.has(year)) {
                map.set(year, { year, income: 0, expenses: 0, months: [] });
            }
            const agg = map.get(year);
            agg.income += entry.income;
            agg.expenses += entry.expenses;
            agg.months.push(entry);
        });
        const yearlyArray = Array.from(map.values()).sort((a, b) => a.year - b.year);
        yearlyArray.forEach((yearEntry) => {
            yearEntry.net = yearEntry.income + yearEntry.expenses;
            yearEntry.months.sort((a, b) => a.dateObj - b.dateObj);
        });
        return yearlyArray;
    }, [cashFlowData]);

    const accountNameMap = useMemo(() => {
        const map = {};
        accounts.forEach((acc) => {
            map[acc.id] = acc.name;
        });
        return map;
    }, [accounts]);

    const openTransactionModal = useCallback(
        (account, transaction = null) => {
            const assetId = transaction?.asset_id || account?.id || accounts[0]?.id || '';
            setTransactionModalAssetId(assetId);
            setTransactionModalTransaction(transaction);
            setIsTransactionModalOpen(true);
        },
        [accounts]
    );

    const openAssetModal = useCallback(() => {
        setIsAssetModalOpen(true);
    }, []);

    const closeAssetModal = useCallback(() => {
        setIsAssetModalOpen(false);
    }, []);

    const closeTransactionModal = useCallback(() => {
        setTransactionModalTransaction(null);
        setTransactionModalAssetId('');
        setIsTransactionModalOpen(false);
    }, []);

    const fetchScenarioDetails = useCallback(
        async (scenarioId) => {
            setLoading(true);
            setError(null);
            try {
                const key = normalizeId(scenarioId);
                const [scenario, assets, transactions] = await Promise.all([
                    getScenario(key),
                    listAssets(key),
                    listTransactions(key),
                ]);
                setScenarioDetails(scenario);
                setAccounts(assets);
                const grouped = assets.reduce((acc, asset) => {
                    acc[asset.id] = [];
                    return acc;
                }, {});
                transactions.forEach((transaction) => {
                    const assetId = transaction.asset_id;
                    if (!grouped[assetId]) {
                        grouped[assetId] = [];
                    }
                    grouped[assetId].push(transaction);
                });
                setAccountTransactions(grouped);
                closeTransactionModal();
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        [closeTransactionModal]
    );

    useEffect(() => {
        if (currentScenarioId) {
            fetchScenarioDetails(currentScenarioId);
        }
    }, [currentScenarioId, fetchScenarioDetails]);

    useEffect(() => {
        const validIds = new Set(scenarios.map((s) => normalizeId(s.id)));
        const userKey = normalizeId(selectedUserId);
        setSelectedScenarios((prev) => prev.filter((id) => validIds.has(normalizeId(id))));
        setSimulationCache((prev) => {
            const next = {};
            Object.entries(prev || {}).forEach(([key, value]) => {
                const [userPart, scenarioPart] = key.split('::');
                if (normalizeId(userPart) === userKey && validIds.has(normalizeId(scenarioPart))) {
                    next[key] = value;
                }
            });
            return next;
        });
    }, [scenarios, selectedUserId]);

    useEffect(() => {
        const cached = simulationCache[cacheKey(selectedUserId, currentScenarioId)];
        if (cached?.cash_flows) {
            setCashFlows(cached.cash_flows);
        }
    }, [currentScenarioId, simulationCache, selectedUserId]);

    const loadScenariosForUser = useCallback(
        async (userIdentifier) => {
            if (!userIdentifier) {
                setScenarios([]);
                setCurrentScenarioId('');
                setScenarioDetails(null);
                setAccounts([]);
                setAccountTransactions({});
                setSimulationCache({});
                setSelectedScenarios([]);
                setCashFlows([]);
                setChartRange({ start: 0, end: null });
                closeTransactionModal();
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const userScenarios = await listScenarios();
                setScenarios(userScenarios);
                const firstScenario = normalizeId(userScenarios[0]?.id || '');
                setCurrentScenarioId(firstScenario);
                setSelectedScenarios(firstScenario ? [firstScenario] : []);
                setSimulationCache({});
                setCashFlows([]);
                setChartRange({ start: 0, end: null });
                if (!firstScenario) {
                    setScenarioDetails(null);
                    setAccounts([]);
                    setAccountTransactions({});
                    closeTransactionModal();
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        [closeTransactionModal]
    );

    const loadCurrentUser = useCallback(async () => {
        const token = getAuthToken();
        if (!token) {
            setUsers([]);
            setSelectedUserId('');
            await loadScenariosForUser('');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const user = await getCurrentUser();
            setUsers([user]);
            setSelectedUserId(user.id);
            await loadScenariosForUser(user.id);
        } catch (err) {
            setError(err.message || 'Bitte neu einloggen oder registrieren.');
            setUsers([]);
            setSelectedUserId('');
            await loadScenariosForUser('');
        } finally {
            setLoading(false);
        }
    }, [loadScenariosForUser]);

    useEffect(() => {
        loadCurrentUser();
    }, [loadCurrentUser]);

    const handleUserSelect = useCallback(
        async (userIdentifier) => {
            if (!userIdentifier) {
                setSelectedUserId('');
                await loadScenariosForUser('');
                return;
            }
            setSelectedUserId(userIdentifier);
            await loadScenariosForUser(userIdentifier);
        },
        [loadScenariosForUser]
    );

    const handleRegister = async () => {
        if (!newUsername || !newUserPassword) {
            setError('Bitte Benutzername und Passwort angeben.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { user, token } = await registerUser({
                username: newUsername,
                password: newUserPassword,
                name: newUserName,
                email: newUserEmail,
            });
            setAuthToken(token);
            setUsers([user]);
            setSelectedUserId(user.id);
            setNewUsername('');
            setNewUserPassword('');
            setNewUserName('');
            setNewUserEmail('');
            await loadScenariosForUser(user.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async () => {
        if (!newUsername || !newUserPassword) {
            setError('Bitte Benutzername und Passwort angeben.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { user, token } = await loginUser({ username: newUsername, password: newUserPassword });
            setAuthToken(token);
            setUsers([user]);
            setSelectedUserId(user.id);
            setNewUserPassword('');
            await loadScenariosForUser(user.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddAccount = async () => {
        if (!currentScenarioId || !newAccountName) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const payload = {
                name: newAccountName,
                annual_growth_rate: parseFloat(newAccountGrowthRate || 0) / 100,
                initial_balance: parseFloat(newAccountInitialBalance || 0),
                asset_type: newAccountType,
            };
            const account = await createAsset(currentScenarioId, payload);
            setAccounts((prev) => [...prev, account]);
            setAccountTransactions((prev) => ({ ...prev, [account.id]: [] }));
            setNewAccountName('');
            setNewAccountGrowthRate('');
            setNewAccountInitialBalance('');
            setNewAccountType('generic');
            closeAssetModal();
            if (currentScenarioId) {
                await handleSimulate();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateAccount = async (accountId, payload) => {
        setLoading(true);
        setError(null);
        try {
            const updated = await updateAsset(accountId, payload);
            setAccounts((prev) => prev.map((account) => (account.id === accountId ? updated : account)));
            if (currentScenarioId) {
                await handleSimulate();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAccount = async (accountId) => {
        setLoading(true);
        setError(null);
        try {
            await deleteAsset(accountId);
            setAccounts((prev) => prev.filter((account) => account.id !== accountId));
            setAccountTransactions((prev) => {
                const updated = { ...prev };
                delete updated[accountId];
                return updated;
            });
            if (currentScenarioId) {
                await handleSimulate();
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddTransaction = async (payload) => {
        if (!currentScenarioId) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const transaction = await createTransaction(currentScenarioId, payload);
            setAccountTransactions((prev) => {
                const updated = { ...prev };
                const addTx = (tx) => {
                    const assetId = tx.asset_id;
                    updated[assetId] = [...(updated[assetId] || []), tx];
                };
                addTx(transaction);
                if (transaction.linked_transaction) {
                    addTx(transaction.linked_transaction);
                }
                return updated;
            });
            if (currentScenarioId) {
                await handleSimulate();
            }
            closeTransactionModal();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateTransaction = async (transactionId, payload) => {
        setLoading(true);
        setError(null);
        try {
            await updateTransaction(transactionId, payload);
            if (currentScenarioId) {
                await fetchScenarioDetails(currentScenarioId);
            }
            if (currentScenarioId) {
                await handleSimulate();
            }
            closeTransactionModal();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteTransaction = async (transactionId, assetId) => {
        setLoading(true);
        setError(null);
        try {
            await deleteTransaction(transactionId);
            if (currentScenarioId) {
                await fetchScenarioDetails(currentScenarioId);
            } else {
                setAccountTransactions((prev) => ({
                    ...prev,
                    [assetId]: prev[assetId].filter((transaction) => transaction.id !== transactionId),
                }));
            }
            if (currentScenarioId) {
                await handleSimulate();
            }
            closeTransactionModal();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveTransaction = (transactionId, payload) => {
        if (transactionId) {
            return handleUpdateTransaction(transactionId, payload);
        }
        return handleAddTransaction(payload);
    };

    const copyScenarioData = async (sourceScenarioId, targetScenarioId) => {
        const [sourceAssets, sourceTransactions] = await Promise.all([
            listAssets(sourceScenarioId),
            listTransactions(sourceScenarioId),
        ]);

        const assetIdMap = {};
        for (const asset of sourceAssets) {
            const newAsset = await createAsset(targetScenarioId, {
                name: asset.name,
                annual_growth_rate: asset.annual_growth_rate,
                initial_balance: asset.initial_balance,
                asset_type: asset.asset_type,
            });
            assetIdMap[asset.id] = newAsset.id;
        }

        for (const transaction of sourceTransactions) {
            if (transaction.double_entry && transaction.entry === 'credit') {
                continue; // credit side will be created with the debit insert
            }
            const mappedAssetId = assetIdMap[transaction.asset_id];
            if (!mappedAssetId) continue;
            const mappedCounterAssetId = transaction.counter_asset_id
                ? assetIdMap[transaction.counter_asset_id]
                : undefined;
            const mappedMortgageAssetId = transaction.mortgage_asset_id
                ? assetIdMap[transaction.mortgage_asset_id]
                : undefined;
            await createTransaction(targetScenarioId, {
                asset_id: mappedAssetId,
                name: transaction.name,
                amount: transaction.amount,
                type: transaction.type,
                start_year: transaction.start_year,
                start_month: transaction.start_month,
                end_year: transaction.end_year,
                end_month: transaction.end_month,
                frequency: transaction.frequency,
                annual_growth_rate: transaction.annual_growth_rate,
                counter_asset_id: mappedCounterAssetId,
                mortgage_asset_id: mappedMortgageAssetId,
                annual_interest_rate: transaction.annual_interest_rate,
                double_entry: transaction.double_entry,
            });
        }
    };

    const handleAddScenario = async () => {
        if (!selectedUserId || !newScenarioName) {
            setError('Bitte zuerst Benutzer und Szenario Namen angeben.');
            return;
        }
        const [startYear, startMonth] = newScenarioStart.split('-').map(Number);
        const [endYear, endMonth] = newScenarioEnd.split('-').map(Number);
        setLoading(true);
        setError(null);
        try {
            const scenario = await createScenario({
                name: newScenarioName,
                start_year: startYear,
                start_month: startMonth,
                end_year: endYear,
                end_month: endMonth,
            });

            if (cloneScenarioId) {
                await copyScenarioData(cloneScenarioId, scenario.id);
            }

            setScenarios((prev) => [...prev, scenario]);
            setCurrentScenarioId(normalizeId(scenario.id));
            setNewScenarioName('');
            setCloneScenarioId('');
            await handleSimulate();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteScenario = async (scenarioId) => {
        if (!scenarioId) {
            setError('Kein Szenario ausgewählt.');
            return;
        }
        if (!window.confirm('Szenario wirklich löschen? Alle Assets/Transaktionen werden entfernt.')) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const scenarioKey = normalizeId(scenarioId);
            await deleteScenario(scenarioKey);
            const remaining = scenarios.filter((scenario) => normalizeId(scenario.id) !== scenarioKey);
            setScenarios(remaining);
            if (normalizeId(currentScenarioId) === scenarioKey) {
                const fallback = normalizeId(remaining[0]?.id || '');
                setCurrentScenarioId(fallback);
                if (!fallback) {
                    setScenarioDetails(null);
                    setAccounts([]);
                    setAccountTransactions({});
                    closeTransactionModal();
                }
            }
            setSelectedScenarios((prev) => prev.filter((id) => normalizeId(id) !== scenarioKey));
            setSimulationCache((prev) => {
                const next = { ...prev };
                delete next[cacheKey(selectedUserId, scenarioKey)];
                return next;
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadPdf = useCallback(() => {
        const doc = new jsPDF();
        const marginX = 14;
        let cursorY = 18;
        const today = new Date().toLocaleString('de-CH');

        const title = 'Financial Simulation Report';
        doc.setFontSize(16);
        doc.text(title, marginX, cursorY);
        doc.setFontSize(10);
        doc.text(`Stand: ${today}`, marginX, (cursorY += 8));
        cursorY += 6;

        const addBlockTitle = (text) => {
            doc.setFontSize(12);
            doc.text(text, marginX, cursorY);
            cursorY += 4;
        };

        addBlockTitle('Benutzer');
        autoTable(doc, {
            startY: cursorY,
            head: [['Name', 'E-Mail']],
            body: [[selectedUser?.name || '–', selectedUser?.email || '–']],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [17, 24, 39], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            theme: 'striped',
            margin: { left: marginX, right: marginX },
        });
        cursorY = doc.lastAutoTable.finalY + 10;

        addBlockTitle('Szenario');
        autoTable(doc, {
            startY: cursorY,
            head: [['Name', 'Zeitraum', 'Assets', 'Transaktionen']],
            body: [
                [
                    currentScenario?.name || '–',
                    formatScenarioRange(currentScenario) || '–',
                    accounts.length,
                    allTransactions.length,
                ],
            ],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [30, 64, 175], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            theme: 'striped',
            margin: { left: marginX, right: marginX },
        });
        cursorY = doc.lastAutoTable.finalY + 10;

        addBlockTitle('Assets');
        autoTable(doc, {
            startY: cursorY,
            head: [['Name', 'Typ', 'Wachstum p.a.', 'Startsaldo']],
            body: accounts.map((acc) => [
                acc.name,
                acc.asset_type || '–',
                `${((acc.annual_growth_rate || 0) * 100).toFixed(2)} %`,
                formatCurrency(acc.initial_balance || 0),
            ]),
            styles: { fontSize: 9 },
            headStyles: { fillColor: [16, 185, 129], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            theme: 'striped',
            margin: { left: marginX, right: marginX },
        });
        cursorY = doc.lastAutoTable.finalY + 10;

        const txRows = allTransactions.slice(0, 30).map((tx) => [
            tx.name,
            accountNameMap[tx.asset_id] || tx.asset_id,
            tx.type,
            formatCurrency(tx.amount || 0),
            `${tx.start_month || 1}/${tx.start_year || ''}`,
            tx.end_year ? `${tx.end_month || 1}/${tx.end_year}` : '–',
        ]);

        addBlockTitle('Transaktionen (Top 30)');
        autoTable(doc, {
            startY: cursorY,
            head: [['Name', 'Account', 'Typ', 'Betrag', 'Start', 'Ende']],
            body: txRows.length ? txRows : [['–', '–', '–', '–', '–', '–']],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [59, 130, 246], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            theme: 'striped',
            margin: { left: marginX, right: marginX },
        });
        cursorY = doc.lastAutoTable.finalY + 10;

        addBlockTitle('Simulation');
        const totals = currentSimulation?.total_wealth || [];
        const firstValue = totals[0]?.value ?? null;
        const lastValue = totals[totals.length - 1]?.value ?? null;
        autoTable(doc, {
            startY: cursorY,
            head: [['Startwert', 'Endwert', 'Δ Absolut']],
            body: [
                [
                    firstValue !== null ? formatCurrency(firstValue) : '–',
                    lastValue !== null ? formatCurrency(lastValue) : '–',
                    firstValue !== null && lastValue !== null
                        ? formatCurrency(lastValue - firstValue)
                        : '–',
                ],
            ],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [75, 85, 99], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            theme: 'striped',
            margin: { left: marginX, right: marginX },
        });

        cursorY = doc.lastAutoTable.finalY + 10;
        addBlockTitle('Cashflow Entwicklung');

        const cfRows = yearlyCashFlow.map((entry) => [
            entry.year,
            formatCurrency(entry.income || 0),
            formatCurrency(entry.expenses || 0),
            formatCurrency(entry.net || 0),
        ]);
        autoTable(doc, {
            startY: cursorY,
            head: [['Jahr', 'Einnahmen', 'Ausgaben', 'Netto']],
            body: cfRows.length ? cfRows : [['–', '–', '–', '–']],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [99, 102, 241], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            theme: 'striped',
            margin: { left: marginX, right: marginX },
        });
        cursorY = doc.lastAutoTable.finalY + 8;

        if (yearlyCashFlow.length) {
            const chartWidth = doc.internal.pageSize.getWidth() - marginX * 2;
            const chartHeight = 50;
            const chartTop = cursorY;
            const chartBottom = chartTop + chartHeight;
            const minNet = Math.min(...yearlyCashFlow.map((y) => y.net));
            const maxNet = Math.max(...yearlyCashFlow.map((y) => y.net));
            const range = Math.max(1, maxNet - minNet || 1);
            const toX = (idx) =>
                marginX +
                (yearlyCashFlow.length === 1 ? chartWidth / 2 : (chartWidth * idx) / (yearlyCashFlow.length - 1));
            const toY = (val) => chartBottom - ((val - minNet) / range) * chartHeight;

            // axes
            doc.setDrawColor(120);
            doc.line(marginX, chartBottom, marginX + chartWidth, chartBottom);
            doc.line(marginX, chartTop, marginX, chartBottom);

            // line
            doc.setDrawColor(59, 130, 246);
            yearlyCashFlow.forEach((entry, idx) => {
                const x = toX(idx);
                const y = toY(entry.net);
                if (idx > 0) {
                    const prev = yearlyCashFlow[idx - 1];
                    doc.line(toX(idx - 1), toY(prev.net), x, y);
                }
                doc.circle(x, y, 1.5, 'F');
            });

            // labels
            doc.setFontSize(8);
            doc.setTextColor(55);
            const firstYear = yearlyCashFlow[0].year;
            const lastYear = yearlyCashFlow[yearlyCashFlow.length - 1].year;
            doc.text(String(firstYear), marginX, chartBottom + 6);
            doc.text(String(lastYear), marginX + chartWidth, chartBottom + 6, { align: 'right' });
            doc.text(formatCurrency(maxNet), marginX + chartWidth, chartTop - 2, { align: 'right' });
            doc.text(formatCurrency(minNet), marginX + chartWidth, chartBottom + 4, { align: 'right' });
            cursorY = chartBottom + 12;
        }

        doc.save(`financial-simulation-${new Date().toISOString().slice(0, 10)}.pdf`);
    }, [
        accounts,
        accountNameMap,
        allTransactions,
        currentScenario,
        currentSimulation,
        selectedUser,
        formatScenarioRange,
        yearlyCashFlow,
    ]);

    const handleSimulate = async () => {
        if (!currentScenarioId) {
            setError('Bitte zuerst ein Szenario auswählen.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const scenarioKey = normalizeId(currentScenarioId);
            const result = await simulateScenario(scenarioKey);
            setSimulationCache((prev) => ({ ...prev, [cacheKey(selectedUserId, scenarioKey)]: result }));
            setCashFlows(result.cash_flows || []);
            if (!selectedScenarios.includes(scenarioKey)) {
                setSelectedScenarios((prev) => [...prev, scenarioKey]);
            }
            const labels = result.total_wealth.map((point) => point.date);
            setChartRange({ start: 0, end: labels.length ? labels.length - 1 : null });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectScenario = async (e) => {
        const { value, checked } = e.target;
        const scenarioKey = normalizeId(value);
        const existsForUser = scenarios.some((s) => normalizeId(s.id) === scenarioKey);
        if (!existsForUser) {
            return;
        }
        if (checked) {
            setSelectedScenarios((prev) => [...prev, scenarioKey]);
            const cacheId = cacheKey(selectedUserId, scenarioKey);
            if (!simulationCache[cacheId]) {
                try {
                    const result = await simulateScenario(scenarioKey);
                    setSimulationCache((prev) => ({ ...prev, [cacheId]: result }));
                    if (scenarioKey === normalizeId(currentScenarioId)) {
                        setCashFlows(result.cash_flows || []);
                    }
                } catch (err) {
                    setError(err.message);
                }
            }
        } else {
            setSelectedScenarios((prev) => prev.filter((scenarioId) => normalizeId(scenarioId) !== scenarioKey));
        }
    };

    const colorFromIndex = (idx) => {
        const palette = [
            '#2563eb',
            '#10b981',
            '#f59e0b',
            '#ef4444',
            '#8b5cf6',
            '#ec4899',
            '#14b8a6',
            '#f97316',
        ];
        return palette[idx % palette.length];
    };

    const assetChartData = useMemo(() => {
        const data = simulationCache[cacheKey(selectedUserId, currentScenarioId)];
        if (!data) {
            return { labels: [], datasets: [], fullLabels: [] };
        }

        const fullLabels = data.total_wealth.map((point) => new Date(point.date).toISOString().slice(0, 10));
        const totalLen = fullLabels.length;
        const endIdx =
            chartRange.end === null || chartRange.end >= totalLen
                ? Math.max(totalLen - 1, 0)
                : Math.max(Math.min(chartRange.end, totalLen - 1), 0);
        const startIdx = Math.min(Math.max(chartRange.start, 0), endIdx);
        const labels = fullLabels.slice(startIdx, endIdx + 1);

        const accountNames = Object.keys(data.account_balances);
        const areaDatasets = accountNames.map((name, idx) => {
            const history = data.account_balances[name] || [];
            const values = history.map((entry) => entry.value).slice(startIdx, endIdx + 1);
            const color = colorFromIndex(idx);
            return {
                label: name,
                data: values,
                borderColor: color,
                backgroundColor: `${color}33`, // add alpha
                fill: true,
                stack: 'assets',
            };
        });

        const totalLine = {
            label: `${scenarios.find((s) => normalizeId(s.id) === normalizeId(currentScenarioId))?.name || 'Current'} · Total`,
            data: data.total_wealth.map((point) => point.value).slice(startIdx, endIdx + 1),
            borderColor: '#111827',
            backgroundColor: '#111827',
            borderWidth: 3,
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            stack: 'totals',
        };

        const comparisonDatasets = selectedScenarios
            .filter((id) => normalizeId(id) !== normalizeId(currentScenarioId))
            .map((scenarioId, idx) => {
                const compareData = simulationCache[cacheKey(selectedUserId, scenarioId)];
                if (!compareData) return null;
                const valueByDate = compareData.total_wealth.reduce((acc, point) => {
                    // use ISO day-precision key to avoid locale/timezone shifts
                    acc[new Date(point.date).toISOString().slice(0, 10)] = point.value;
                    return acc;
                }, {});
                const values = labels.map((label) => {
                    const key = (() => {
                        const d = new Date(label);
                        return isNaN(d.getTime()) ? label : d.toISOString().slice(0, 10);
                    })();
                    return key in valueByDate ? valueByDate[key] : null;
                });
                const color = colorFromIndex(idx + accountNames.length + 1);
                return {
                    label: `${scenarios.find((s) => normalizeId(s.id) === normalizeId(scenarioId))?.name || scenarioId} · Total`,
                    data: values,
                    borderColor: color,
                    backgroundColor: color,
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0,
                    borderDash: [6, 4],
                    stack: 'compare',
                };
            })
            .filter(Boolean);

        return { labels, datasets: [...areaDatasets, totalLine, ...comparisonDatasets], fullLabels };
    }, [currentScenarioId, selectedScenarios, simulationCache, scenarios, chartRange, selectedUserId]);

    const annualLabel = useCallback((tx) => {
        if (tx.type === 'mortgage_interest') {
            return 'jährlich: variabel';
        }
        if (tx.type === 'one_time') {
            return null;
        }
        const freq = tx.frequency || 1;
        const yearlyFactor = Math.max(1, Math.round(12 / freq));
        const annualAmount = (tx.amount || 0) * yearlyFactor;
        return `jährlich: ${annualAmount.toLocaleString('de-CH', {
            style: 'currency',
            currency: 'CHF',
        })}`;
    }, []);

    const modalAsset = accounts.find((acc) => acc.id === transactionModalAssetId);

    return (
        <>
            <div className="simulation">
                <h1>Financial Simulation</h1>
                <div className={`simulation-layout ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
                    <button
                        className="sidebar-toggle"
                        onClick={() => setIsSidebarOpen((prev) => !prev)}
                        aria-expanded={isSidebarOpen}
                        aria-controls="user-sidebar"
                    >
                        {isSidebarOpen ? '×' : '☰'} Benutzer
                    </button>
                    <aside id="user-sidebar" className="user-sidebar">
                        <h3>User Management</h3>
                        <div className="new-user">
                            <input
                                type="text"
                                placeholder="Benutzername"
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                            />
                            <input
                                type="password"
                                placeholder="Passwort"
                                value={newUserPassword}
                                onChange={(e) => setNewUserPassword(e.target.value)}
                            />
                            <input
                                type="text"
                                placeholder="Anzeigename (optional)"
                                value={newUserName}
                                onChange={(e) => setNewUserName(e.target.value)}
                            />
                            <input
                                type="email"
                                placeholder="E-Mail (optional)"
                                value={newUserEmail}
                                onChange={(e) => setNewUserEmail(e.target.value)}
                            />
                            <div className="user-buttons">
                                <button onClick={handleRegister}>Registrieren</button>
                                <button onClick={handleLogin}>Login</button>
                                <button onClick={loadCurrentUser}>Aktualisieren</button>
                            </div>
                            {selectedUserId && (
                                <p className="active-user">
                                    Eingeloggt als: <code>{selectedUser?.name || selectedUser?.username || selectedUserId}</code>
                                </p>
                            )}
                        </div>
                    </aside>

                    <div className="simulation-main">
                        {error && <p className="error">{error}</p>}
                        {loading && <p>Loading...</p>}

                        <div className="scenario-section">
                            <div className="section-heading">
                                <div>
                                    <p className="eyebrow">Szenarien</p>
                                    <h3>Planen & vergleichen</h3>
                                    <p className="muted">
                                        Lege neue Varianten an oder aktiviere ein Szenario, das du simulieren und
                                        weiterbearbeiten möchtest.
                                    </p>
                                </div>
                                <div className="scenario-chip">
                                    <span>Aktiv</span>
                                    <strong>{currentScenario?.name || 'Kein Szenario'}</strong>
                                </div>
                            </div>

                            <div className="scenario-grid">
                                <div className="scenario-card">
                                    <div className="scenario-card-header">
                                        <div>
                                            <p className="eyebrow">Neu</p>
                                            <h4>Szenario anlegen</h4>
                                        </div>
                                        <span className="muted small">Optional bestehendes Szenario klonen.</span>
                                    </div>
                                    <div className="scenario-form-grid">
                                        <label className="stacked">
                                            <span>Name</span>
                                            <input
                                                type="text"
                                                placeholder="Szenario-Name"
                                                value={newScenarioName}
                                                onChange={(e) => setNewScenarioName(e.target.value)}
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Start</span>
                                            <input
                                                type="month"
                                                value={newScenarioStart}
                                                onChange={(e) => setNewScenarioStart(e.target.value)}
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Ende</span>
                                            <input
                                                type="month"
                                                value={newScenarioEnd}
                                                onChange={(e) => setNewScenarioEnd(e.target.value)}
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Vorlage</span>
                                            <select value={cloneScenarioId} onChange={(e) => setCloneScenarioId(e.target.value)}>
                                                <option value="">Neu beginnen</option>
                                                {scenarios.map((scenario) => (
                                                    <option key={`clone-${scenario.id}`} value={scenario.id}>
                                                        Klonen: {scenario.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                    <div className="scenario-actions">
                                        <div className="muted small">Speichert unter dem aktuell ausgewählten Benutzer.</div>
                                        <button onClick={handleAddScenario} disabled={!selectedUserId}>
                                            Szenario erstellen
                                        </button>
                                    </div>
                                </div>

                                <div className="scenario-card scenario-current-card">
                                    <div className="scenario-card-header">
                                        <div>
                                            <p className="eyebrow">Aktiv</p>
                                            <h4>Szenario verwalten</h4>
                                        </div>
                                        {scenarioDetails && (
                                            <div className="scenario-pill">{formatScenarioRange(scenarioDetails)}</div>
                                        )}
                                    </div>
                                    <label className="stacked">
                                        <span>Szenario wählen</span>
                                        <select onChange={(e) => setCurrentScenarioId(e.target.value)} value={currentScenarioId}>
                                            <option value="">Bitte auswählen</option>
                                            {scenarios.map((scenario) => (
                                                <option key={scenario.id} value={scenario.id}>
                                                    {scenario.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <div className="scenario-actions">
                                        <button onClick={handleSimulate} disabled={!currentScenarioId}>
                                            Szenario simulieren
                                        </button>
                                        <button
                                            className="secondary"
                                            onClick={handleDownloadPdf}
                                            disabled={!selectedUserId}
                                        >
                                            PDF herunterladen
                                        </button>
                                        <button
                                            className="secondary danger"
                                            onClick={() => handleDeleteScenario(currentScenarioId)}
                                            disabled={!currentScenarioId}
                                        >
                                            Löschen
                                        </button>
                                    </div>

                                    <div className="scenario-detail-grid">
                                        <div className="scenario-detail">
                                            <span className="label">Zeitraum</span>
                                            <strong>{formatScenarioRange(scenarioDetails) || '–'}</strong>
                                        </div>
                                        <div className="scenario-detail">
                                            <span className="label">Assets</span>
                                            <strong>{accounts.length}</strong>
                                        </div>
                                        <div className="scenario-detail">
                                            <span className="label">Transaktionen</span>
                                            <strong>{allTransactions.length}</strong>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="accounts-panel">
                            <div className="accounts-header">
                                <h3>Accounts</h3>
                                <button onClick={openAssetModal} disabled={!currentScenarioId}>
                                    Neues Asset
                                </button>
                            </div>
                            <div className="accounts-grid">
                                {accounts.map((account) => (
                                    <Account
                                        key={account.id}
                                        account={account}
                                        transactions={groupedTransactions[account.id] || []}
                                        accountNameMap={accountNameMap}
                                        updateAccount={handleUpdateAccount}
                                        deleteAccount={handleDeleteAccount}
                                        onEditTransaction={(transaction) => openTransactionModal(account, transaction)}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="transactions-panel">
                            <div className="transactions-header">
                                <h3>Transaktionen</h3>
                                <button
                                    onClick={() => openTransactionModal(null, null)}
                                    disabled={!currentScenarioId || accounts.length === 0}
                                >
                                    Neue Transaktion
                                </button>
                            </div>
                            {allTransactions.length === 0 ? (
                                <p className="placeholder">Keine Transaktionen.</p>
                            ) : (
                                <ul className="transaction-list">
                                    {allTransactions.map((tx) => {
                                        const assetName = accountNameMap[tx.asset_id] || 'Unbekannt';
                                        const counterName = tx.counter_asset_id
                                            ? accountNameMap[tx.counter_asset_id]
                                            : null;
                                        return (
                                            <li
                                                key={tx.id}
                                                className="transaction-row"
                                                onClick={() => openTransactionModal(accounts.find((a) => a.id === tx.asset_id) || null, tx)}
                                            >
                                                <div>
                                                    <div className="tx-title">{tx.name}</div>
                                                    <div className="tx-subtitle">
                                                        {tx.type === 'regular'
                                                            ? 'Regular'
                                                            : tx.type === 'mortgage_interest'
                                                            ? 'Mortgage Interest'
                                                            : 'One-time'}{' '}
                                                        · {tx.start_month}/{tx.start_year}
                                                    </div>
                                                    {annualLabel(tx) && (
                                                        <div className="txn-annual">{annualLabel(tx)}</div>
                                                    )}
                                                    <div className="transaction-meta">
                                                        <span className="badge">{assetName}</span>
                                                        {counterName && <span className="badge secondary">↔ {counterName}</span>}
                                                        {tx.entry && <span className="badge muted">{tx.entry}</span>}
                                                    </div>
                                                </div>
                                                <div className="transaction-actions">
                                                    {tx.type === 'mortgage_interest' ? (
                                                        <span className="amount muted">
                                                            Auto · {((
                                                                tx.annual_interest_rate ??
                                                                tx.annual_growth_rate ??
                                                                0
                                                            ) * 100).toFixed(2)}
                                                            %
                                                        </span>
                                                    ) : (
                                                        <span className="amount">
                                                            {tx.amount.toLocaleString('de-CH', {
                                                                style: 'currency',
                                                                currency: 'CHF',
                                                            })}
                                                        </span>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        <div className="scenario-comparison">
                            <div className="section-heading">
                                <div>
                                    <p className="eyebrow">Vergleich</p>
                                    <h3>Szenarien im Chart</h3>
                                    <p className="muted">
                                        Wähle die Szenarien aus, die in den Diagrammen gemeinsam angezeigt werden sollen.
                                    </p>
                                </div>
                                <div className="scenario-chip subtle">
                                    <span>Ausgewählt</span>
                                    <strong>{selectedScenarios.length}</strong>
                                </div>
                            </div>
                            {scenarios.length === 0 ? (
                                <p className="placeholder">Keine Szenarien vorhanden.</p>
                            ) : (
                                <div className="scenario-comparison-grid">
                                    {scenarios.map((scenario) => {
                                        const scenarioKey = normalizeId(scenario.id);
                                        const checked = selectedScenarios.includes(scenarioKey);
                                        const rangeLabel = formatScenarioRange(scenario);
                                        return (
                                            <label
                                                key={scenario.id}
                                                className={`scenario-compare-card ${checked ? 'active' : ''}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    value={scenario.id}
                                                    checked={checked}
                                                    onChange={handleSelectScenario}
                                                />
                                                <div>
                                                    <div className="scenario-compare-header">
                                                        <span className="scenario-name">{scenario.name}</span>
                                                        {scenarioKey === normalizeId(currentScenarioId) && (
                                                            <span className="badge muted">aktiv</span>
                                                        )}
                                                    </div>
                                                    <div className="scenario-compare-meta">
                                                        {rangeLabel || 'Zeitraum noch nicht gesetzt'}
                                                    </div>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="total-wealth">
                            <h2>Asset Balances & Totals</h2>
                            <div className="range-controls dual-range">
                                <label>Zeitraum</label>
                                <div className="range-slider">
                                    <input
                                        type="range"
                                        min={0}
                                        max={Math.max(assetChartData.fullLabels.length - 1, 0)}
                                        value={Math.min(chartRange.start, Math.max(assetChartData.fullLabels.length - 1, 0))}
                                        onChange={(e) => {
                                            const total = Math.max(assetChartData.fullLabels.length - 1, 0);
                                            const newStart = Math.max(0, Math.min(Number(e.target.value), total));
                                            setChartRange((prev) => {
                                                const currentEnd = prev.end === null ? total : Math.max(0, Math.min(prev.end, total));
                                                return {
                                                    start: Math.min(newStart, currentEnd),
                                                    end: currentEnd < newStart ? newStart : currentEnd,
                                                };
                                            });
                                        }}
                                    />
                                    <input
                                        type="range"
                                        min={0}
                                        max={Math.max(assetChartData.fullLabels.length - 1, 0)}
                                        value={
                                            chartRange.end === null
                                                ? Math.max(assetChartData.fullLabels.length - 1, 0)
                                                : Math.min(chartRange.end, Math.max(assetChartData.fullLabels.length - 1, 0))
                                        }
                                        onChange={(e) => {
                                            const total = Math.max(assetChartData.fullLabels.length - 1, 0);
                                            const newEnd = Math.max(0, Math.min(Number(e.target.value), total));
                                            setChartRange((prev) => ({
                                                start: Math.min(prev.start, newEnd),
                                                end: Math.max(newEnd, prev.start),
                                            }));
                                        }}
                                    />
                                </div>
                                <div className="range-labels">
                                    <span>{assetChartData.fullLabels[Math.min(chartRange.start, Math.max(assetChartData.fullLabels.length - 1, 0))] || '—'}</span>
                                    <span>
                                        {assetChartData.fullLabels[
                                            chartRange.end === null
                                                ? Math.max(assetChartData.fullLabels.length - 1, 0)
                                                : Math.min(chartRange.end, Math.max(assetChartData.fullLabels.length - 1, 0))
                                        ] || '—'}
                                    </span>
                                </div>
                            </div>
                            <Line
                                data={assetChartData}
                                options={{
                                    responsive: true,
                                    plugins: {
                                        legend: {
                                            position: 'top',
                                        },
                                        title: {
                                            display: true,
                                            text: 'Gestapelte Assets + Total-Linien',
                                        },
                                    },
                                    scales: {
                                        x: {
                                            stacked: true,
                                        },
                                        y: {
                                            stacked: true,
                                            ticks: {
                                                callback: (value) =>
                                                    value.toLocaleString('de-CH', {
                                                        style: 'currency',
                                                        currency: 'CHF',
                                                    }),
                                            },
                                        },
                                    },
                                }}
                            />
                        </div>

                        {yearlyCashFlow.length > 0 && (
                            <div className="cashflow-table">
                                <h3>Cashflow Zusammenfassung</h3>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Jahr (Ende)</th>
                                            <th>Einnahmen</th>
                                            <th>Ausgaben</th>
                                            <th>Netto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {yearlyCashFlow.map((yearRow) => {
                                            const isExpanded = expandedYears.includes(yearRow.year);
                                            return (
                                                <React.Fragment key={`year-${yearRow.year}`}>
                                                    {isExpanded &&
                                                        yearRow.months.map((row) => (
                                                            <React.Fragment key={row.date}>
                                                                <tr className="monthly-row">
                                                                    <td>{row.dateLabel}</td>
                                                                    <td>
                                                                        <button
                                                                            className="link-button"
                                                                            onClick={() =>
                                                                                setCashFlows((prev) =>
                                                                                    prev.map((cf) =>
                                                                                        cf.date === row.date
                                                                                            ? { ...cf, showIncome: !cf.showIncome }
                                                                                            : cf
                                                                                    )
                                                                                )
                                                                            }
                                                                        >
                                                                            {row.income.toLocaleString('de-CH', {
                                                                                style: 'currency',
                                                                                currency: 'CHF',
                                                                            })}
                                                                        </button>
                                                                    </td>
                                                                    <td>
                                                                        <button
                                                                            className="link-button"
                                                                            onClick={() =>
                                                                                setCashFlows((prev) =>
                                                                                    prev.map((cf) =>
                                                                                        cf.date === row.date
                                                                                            ? { ...cf, showExpense: !cf.showExpense }
                                                                                            : cf
                                                                                    )
                                                                                )
                                                                            }
                                                                        >
                                                                            {row.expenses.toLocaleString('de-CH', {
                                                                                style: 'currency',
                                                                                currency: 'CHF',
                                                                            })}
                                                                        </button>
                                                                    </td>
                                                                    <td>
                                                                        {(row.income + row.expenses).toLocaleString('de-CH', {
                                                                            style: 'currency',
                                                                            currency: 'CHF',
                                                                        })}
                                                                    </td>
                                                                </tr>
                                                                {row.showIncome && row.income_details?.length > 0 && (
                                                                    <tr className="cashflow-subrow">
                                                                        <td></td>
                                                                        <td colSpan={4}>
                                                                            <ul className="cashflow-items">
                                                                                {row.income_details.map((item, idx) => (
                                                                                    <li key={`inc-${row.date}-${idx}`}>
                                                                                        <span>{item.name}</span>
                                                                                        <span className="muted">{item.account}</span>
                                                                                        <span className="amount">
                                                                                            {item.amount.toLocaleString('de-CH', {
                                                                                                style: 'currency',
                                                                                                currency: 'CHF',
                                                                                            })}
                                                                                        </span>
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                                {row.showExpense && row.expense_details?.length > 0 && (
                                                                    <tr className="cashflow-subrow">
                                                                        <td></td>
                                                                        <td colSpan={4}>
                                                                            <ul className="cashflow-items">
                                                                                {row.expense_details.map((item, idx) => (
                                                                                    <li key={`exp-${row.date}-${idx}`}>
                                                                                        <span>{item.name}</span>
                                                                                        <span className="muted">{item.account}</span>
                                                                                        <span className="amount">
                                                                                            {item.amount.toLocaleString('de-CH', {
                                                                                                style: 'currency',
                                                                                                currency: 'CHF',
                                                                                            })}
                                                                                        </span>
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        ))}
                                                    <tr>
                                                        <td>
                                                            <button
                                                                className="link-button"
                                                                onClick={() =>
                                                                    setExpandedYears((prev) =>
                                                                        prev.includes(yearRow.year)
                                                                            ? prev.filter((y) => y !== yearRow.year)
                                                                            : [...prev, yearRow.year]
                                                                    )
                                                                }
                                                            >
                                                                {new Date(yearRow.year, 11, 31).toLocaleDateString('de-CH')}
                                                            </button>
                                                        </td>
                                                        <td>
                                                            {yearRow.income.toLocaleString('de-CH', {
                                                                style: 'currency',
                                                                currency: 'CHF',
                                                            })}
                                                        </td>
                                                        <td>
                                                            {yearRow.expenses.toLocaleString('de-CH', {
                                                                style: 'currency',
                                                                currency: 'CHF',
                                                            })}
                                                        </td>
                                                        <td>
                                                            {(yearRow.income + yearRow.expenses).toLocaleString('de-CH', {
                                                                style: 'currency',
                                                                currency: 'CHF',
                                                            })}
                                                        </td>
                                                    </tr>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isTransactionModalOpen && (
                <div className="modal-overlay" onClick={closeTransactionModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">{transactionModalTransaction ? 'Transaktion bearbeiten' : 'Neue Transaktion'}</p>
                                <h3>
                                    {modalAsset ? modalAsset.name : 'Transaktion'}
                                </h3>
                            </div>
                            <div className="modal-header-actions">
                                <button className="secondary" onClick={closeTransactionModal}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <TransactionForm
                            accounts={accounts}
                            transaction={transactionModalTransaction}
                            selectedAssetId={transactionModalAssetId || accounts[0]?.id}
                            onSave={handleSaveTransaction}
                            onDelete={handleDeleteTransaction}
                            disableAssetSelect={Boolean(transactionModalTransaction?.double_entry)}
                        />
                    </div>
                </div>
            )}
            {isAssetModalOpen && (
                <div className="modal-overlay" onClick={closeAssetModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Asset hinzufügen</p>
                                <h3>Neues Asset</h3>
                            </div>
                            <div className="modal-header-actions">
                                <button className="secondary" onClick={closeAssetModal}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <div className="account-creation modal-grid">
                            <label className="stacked">
                                <span>Name</span>
                                <input
                                    type="text"
                                    placeholder="Account Name"
                                    value={newAccountName}
                                    onChange={(e) => setNewAccountName(e.target.value)}
                                />
                            </label>
                            <label className="stacked">
                                <span>Annual Growth Rate (%)</span>
                                <input
                                    type="number"
                                    placeholder="z.B. 3"
                                    value={newAccountGrowthRate}
                                    onChange={(e) => setNewAccountGrowthRate(e.target.value)}
                                />
                            </label>
                            <label className="stacked">
                                <span>Initial Balance</span>
                                <input
                                    type="number"
                                    placeholder="Startguthaben"
                                    value={newAccountInitialBalance}
                                    onChange={(e) => setNewAccountInitialBalance(e.target.value)}
                                />
                            </label>
                            <label className="stacked">
                                <span>Typ</span>
                                <select
                                    value={newAccountType}
                                    onChange={(e) => setNewAccountType(e.target.value)}
                                >
                                    <option value="generic">Allgemein</option>
                                    <option value="bank_account">Konto</option>
                                    <option value="real_estate">Immobilie</option>
                                    <option value="mortgage">Hypothek</option>
                                </select>
                            </label>
                        </div>
                        <div className="modal-actions">
                            <button onClick={handleAddAccount} disabled={!currentScenarioId}>
                                Asset erstellen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Simulation;
