import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import AIAssistant from './AIAssistant';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    registerUser,
    loginUser,
    getCurrentUser,
    listScenarios,
    createScenario,
    getScenario,
    updateScenario,
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
    simulateScenarioStress,
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
    const [showScenarios, setShowScenarios] = useState(false);
    const [showAccounts, setShowAccounts] = useState(true);
    const [showTransactions, setShowTransactions] = useState(true);
    const [showCashflow, setShowCashflow] = useState(true);
    const [showTotals, setShowTotals] = useState(true);
    const [accounts, setAccounts] = useState([]);
    const [accountTransactions, setAccountTransactions] = useState({});
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountGrowthRate, setNewAccountGrowthRate] = useState('');
    const [newAccountInitialBalance, setNewAccountInitialBalance] = useState('');
    const [newAccountType, setNewAccountType] = useState('generic');
    const [newAccountStart, setNewAccountStart] = useState('');
    const [newAccountEnd, setNewAccountEnd] = useState('');
    const [newScenarioName, setNewScenarioName] = useState('');
    const [cloneScenarioId, setCloneScenarioId] = useState('');
    const [newScenarioStart, setNewScenarioStart] = useState('2024-05');
    const [newScenarioEnd, setNewScenarioEnd] = useState('2044-09');
    const [inflationRate, setInflationRate] = useState('');
    const [incomeTaxRate, setIncomeTaxRate] = useState('');
    const [wealthTaxRate, setWealthTaxRate] = useState('');
    const [newScenarioDescription, setNewScenarioDescription] = useState('');
    const [scenarioDescription, setScenarioDescription] = useState('');
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
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [scenarioCount, setScenarioCount] = useState(0);
    const scenarioSectionRef = useRef(null);
    const scenarioMenuRef = useRef(null);
    const [isScenarioMenuOpen, setIsScenarioMenuOpen] = useState(false);
    const [isRangeModalOpen, setIsRangeModalOpen] = useState(false);
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [stressOverrides, setStressOverrides] = useState({
        mortgageRateDelta: '2',
        mortgageStart: '',
        mortgageEnd: '',
        assetGrowthDelta: '-20',
        portfolioStart: '',
        portfolioEnd: '',
        incomeDelta: '0',
        incomeStart: '',
        incomeEnd: '',
        expenseDelta: '5',
        expenseStart: '',
        expenseEnd: '',
        incomeTaxOverride: '',
    });
    const [stressResult, setStressResult] = useState(null);
    const [stressLoading, setStressLoading] = useState(false);
    const formatCurrency = (value) => {
        const num = Number(value);
        const safe = Number.isFinite(num) ? num : 0;
        return safe.toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
    };

    // Ensure we start logged out (no preselected user) until someone logs in
    useEffect(() => {
        setAuthToken(null);
        setUsers([]);
        setSelectedUserId('');
        setScenarios([]);
        setCurrentScenarioId('');
        setScenarioDetails(null);
    }, []);

    const currentScenario = useMemo(
        () => scenarios.find((scenario) => normalizeId(scenario.id) === normalizeId(currentScenarioId)),
        [scenarios, currentScenarioId]
    );
    const selectedUser = useMemo(
        () => users.find((user) => normalizeId(user.id) === normalizeId(selectedUserId)),
        [users, selectedUserId]
    );
    const formatScenarioRange = useCallback((scenario) => {
        if (!scenario) return null;
        const { start_year, start_month, end_year, end_month } = scenario;
        if (!start_year || !start_month || !end_year || !end_month) return null;
        return `${start_month}/${start_year} - ${end_month}/${end_year}`;
    }, []);
    const currentSimulation = useMemo(
        () => simulationCache[cacheKey(selectedUserId, currentScenarioId)] || null,
        [simulationCache, selectedUserId, currentScenarioId]
    );
    const scenarioRangeLabel = useMemo(() => formatScenarioRange(currentScenario), [currentScenario, formatScenarioRange]);
    const openScenarioSection = useCallback(() => {
        setShowScenarios(true);
        requestAnimationFrame(() => {
            if (scenarioSectionRef.current) {
                scenarioSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
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

    const categorizeTransaction = useCallback((tx) => {
        const rawAmount = Number.isFinite(tx.amount) ? tx.amount : Number(tx.amount) || 0;
        if (tx.type === 'mortgage_interest') return 'expense';
        if (tx.entry === 'credit') return 'expense';
        if (tx.entry === 'debit') return 'income';
        return rawAmount < 0 ? 'expense' : 'income';
    }, []);

    const { allTransactions, incomeTransactions, expenseTransactions } = useMemo(() => {
        const flattened = Object.values(groupedTransactions || {}).flat();
        const withCategory = flattened.map((tx) => {
            const category = categorizeTransaction(tx);
            const sortKey = (tx.start_year || 0) * 100 + (tx.start_month || 0);
            return { ...tx, category, sortKey };
        });
        const sortFn = (a, b) => {
            const categoryOrder = a.category === 'expense' ? 0 : 1;
            const otherOrder = b.category === 'expense' ? 0 : 1;
            if (categoryOrder !== otherOrder) {
                return categoryOrder - otherOrder;
            }
            if (b.sortKey !== a.sortKey) {
                return b.sortKey - a.sortKey;
            }
            return (a.name || '').localeCompare(b.name || '');
        };
        const sorted = [...withCategory].sort(sortFn);
        const income = sorted.filter((tx) => tx.category === 'income');
        const expenses = sorted.filter((tx) => tx.category === 'expense');
        return { allTransactions: sorted, incomeTransactions: income, expenseTransactions: expenses };
    }, [groupedTransactions, categorizeTransaction]);

    const cashFlowData = useMemo(() => {
        if (!cashFlows || !cashFlows.length) return [];
        return cashFlows.map((entry) => ({
            ...entry,
            taxes: entry.taxes || 0,
            tax_details: entry.tax_details || [],
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
                map.set(year, { year, income: 0, expenses: 0, taxes: 0, growth: 0, net: 0, months: [] });
            }
            const agg = map.get(year);
            agg.income += entry.income;
            agg.expenses += entry.expenses;
            agg.taxes += entry.taxes || 0;
            agg.growth += entry.growth || 0;
            agg.net += entry.net || entry.income + entry.expenses + (entry.taxes || 0);
            agg.months.push(entry);
        });
        const yearlyArray = Array.from(map.values()).sort((a, b) => a.year - b.year);
        yearlyArray.forEach((yearEntry) => {
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
        if (scenarioDetails) {
            setInflationRate(
                scenarioDetails.inflation_rate === null || scenarioDetails.inflation_rate === undefined
                    ? ''
                    : scenarioDetails.inflation_rate
            );
            setIncomeTaxRate(
                scenarioDetails.income_tax_rate === null || scenarioDetails.income_tax_rate === undefined
                    ? ''
                    : scenarioDetails.income_tax_rate
            );
            setWealthTaxRate(
                scenarioDetails.wealth_tax_rate === null || scenarioDetails.wealth_tax_rate === undefined
                    ? ''
                    : scenarioDetails.wealth_tax_rate
            );
            setScenarioDescription(scenarioDetails.description || '');
        }
    }, [scenarioDetails]);

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
            const labels = cached.total_wealth?.map((point) => point.date) || [];
            setChartRange({ start: 0, end: labels.length ? labels.length - 1 : null });
        } else {
            setCashFlows([]);
            setChartRange({ start: 0, end: null });
        }
    }, [currentScenarioId, simulationCache, selectedUserId]);

    const loadScenariosForUser = useCallback(
        async (userIdentifier) => {
            if (!userIdentifier) {
                setScenarios([]);
                setScenarioCount(0);
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
                setScenarioCount(userScenarios.length);
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

    const parseMonthValue = (value) => {
        if (!value) return null;
        const [yearStr, monthStr] = value.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
        return { year, month };
    };

    const toMonthInput = (year, month) => {
        if (!year || !month) return '';
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
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
            const startParts = parseMonthValue(newAccountStart);
            const endParts = parseMonthValue(newAccountEnd);
            if (startParts) {
                payload.start_year = startParts.year;
                payload.start_month = startParts.month;
            }
            if (endParts) {
                payload.end_year = endParts.year;
                payload.end_month = endParts.month;
            }
            const account = await createAsset(currentScenarioId, payload);
            setAccounts((prev) => [...prev, account]);
            setAccountTransactions((prev) => ({ ...prev, [account.id]: [] }));
            setNewAccountName('');
            setNewAccountGrowthRate('');
            setNewAccountInitialBalance('');
            setNewAccountType('generic');
            setNewAccountStart('');
            setNewAccountEnd('');
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
            if (!transaction || !transaction.asset_id) {
                // Fallback: Daten neu laden, statt zu crashen
                await fetchScenarioDetails(currentScenarioId);
                await handleSimulate();
                closeTransactionModal();
                return;
            }
            setAccountTransactions((prev) => {
                const updated = { ...prev };
                const addTx = (tx) => {
                    if (!tx || !tx.asset_id) return;
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
                description: newScenarioDescription || undefined,
                start_year: startYear,
                start_month: startMonth,
                end_year: endYear,
                end_month: endMonth,
                inflation_rate: inflationRate === '' ? undefined : parseFloat(inflationRate),
                income_tax_rate: incomeTaxRate === '' ? undefined : parseFloat(incomeTaxRate),
                wealth_tax_rate: wealthTaxRate === '' ? undefined : parseFloat(wealthTaxRate),
            });

            if (cloneScenarioId) {
                await copyScenarioData(cloneScenarioId, scenario.id);
            }

            setScenarios((prev) => [...prev, scenario]);
            setCurrentScenarioId(normalizeId(scenario.id));
            setNewScenarioName('');
            setNewScenarioDescription('');
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

    const handleUpdateScenarioSettings = async () => {
        if (!currentScenarioId) {
            setError('Kein Szenario ausgewählt.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const updated = await updateScenario(currentScenarioId, {
                description: scenarioDescription || null,
                inflation_rate: inflationRate === '' ? null : parseFloat(inflationRate),
                income_tax_rate: incomeTaxRate === '' ? null : parseFloat(incomeTaxRate),
                wealth_tax_rate: wealthTaxRate === '' ? null : parseFloat(wealthTaxRate),
            });
            setScenarioDetails(updated);
            setSimulationCache((prev) => {
                const next = { ...prev };
                delete next[cacheKey(selectedUserId, normalizeId(currentScenarioId))];
                return next;
            });
            await handleSimulate(updated.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const parsePercentInput = useCallback((value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num / 100 : null;
    }, []);

    const parseMonthInput = useCallback((value) => {
        if (!value) return null;
        const [yearStr, monthStr] = value.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr);
        if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
        return { year, month };
    }, []);

    const buildStressPayload = useCallback(() => {
        const mortgagePct = parsePercentInput(stressOverrides.mortgageRateDelta);
        const incomePct = parsePercentInput(stressOverrides.incomeDelta);
        const expensePct = parsePercentInput(stressOverrides.expenseDelta);
        const assetGrowthDeltaPct = parsePercentInput(stressOverrides.assetGrowthDelta);
        const incomeTaxOverride = parsePercentInput(stressOverrides.incomeTaxOverride);
        const portfolioStart = parseMonthInput(stressOverrides.portfolioStart);
        const portfolioEnd = parseMonthInput(stressOverrides.portfolioEnd);
        const mortgageStart = parseMonthInput(stressOverrides.mortgageStart);
        const mortgageEnd = parseMonthInput(stressOverrides.mortgageEnd);
        const incomeStart = parseMonthInput(stressOverrides.incomeStart);
        const incomeEnd = parseMonthInput(stressOverrides.incomeEnd);
        const expenseStart = parseMonthInput(stressOverrides.expenseStart);
        const expenseEnd = parseMonthInput(stressOverrides.expenseEnd);

        const payload = {
            mortgage_rate_change_pct: mortgagePct === null ? undefined : mortgagePct,
            income_change_pct: incomePct === null ? undefined : incomePct,
            expense_change_pct: expensePct === null ? undefined : expensePct,
            portfolio_growth_pct: assetGrowthDeltaPct === null ? undefined : assetGrowthDeltaPct,
            income_tax_override: incomeTaxOverride === null ? undefined : incomeTaxOverride,
            portfolio_start_year: portfolioStart?.year,
            portfolio_start_month: portfolioStart?.month,
            portfolio_end_year: portfolioEnd?.year,
            portfolio_end_month: portfolioEnd?.month,
            mortgage_start_year: mortgageStart?.year,
            mortgage_start_month: mortgageStart?.month,
            mortgage_end_year: mortgageEnd?.year,
            mortgage_end_month: mortgageEnd?.month,
            income_start_year: incomeStart?.year,
            income_start_month: incomeStart?.month,
            income_end_year: incomeEnd?.year,
            income_end_month: incomeEnd?.month,
            expense_start_year: expenseStart?.year,
            expense_start_month: expenseStart?.month,
            expense_end_year: expenseEnd?.year,
            expense_end_month: expenseEnd?.month,
        };
        return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null));
    }, [parseMonthInput, parsePercentInput, stressOverrides]);

    const summarizeSimulation = useCallback((simulation) => {
        if (!simulation) return null;
        const totals = simulation.total_wealth || [];
        const startValue = totals[0]?.value ?? null;
        const endValue = totals[totals.length - 1]?.value ?? null;
        const cashFlowsSummary = (simulation.cash_flows || []).reduce(
            (acc, entry) => {
                acc.income += entry.income || 0;
                acc.expenses += entry.expenses || 0;
                acc.taxes += entry.taxes || 0;
                acc.net += entry.net || entry.income + entry.expenses + (entry.taxes || 0);
                return acc;
            },
            { income: 0, expenses: 0, taxes: 0, net: 0 }
        );
        return {
            startValue,
            endValue,
            delta: startValue !== null && endValue !== null ? endValue - startValue : null,
            ...cashFlowsSummary,
        };
    }, []);

    const handleSimulate = useCallback(async (scenarioIdOverride) => {
        const scenarioKey = normalizeId(scenarioIdOverride || currentScenarioId);
        if (!scenarioKey) {
            setError('Bitte zuerst ein Szenario auswählen.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
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
    }, [currentScenarioId, selectedScenarios, selectedUserId]);

    const handleStressSimulate = useCallback(async () => {
        const scenarioKey = normalizeId(currentScenarioId);
        if (!scenarioKey) {
            setError('Bitte zuerst ein Szenario auswählen.');
            return;
        }
        setStressLoading(true);
        setError(null);
        try {
            const payload = buildStressPayload();
            const result = await simulateScenarioStress(scenarioKey, payload);
            setStressResult(result);
        } catch (err) {
            setError(err.message);
        } finally {
            setStressLoading(false);
        }
    }, [buildStressPayload, currentScenarioId]);

    const handleDownloadPdf = useCallback(async () => {
        // Always refresh simulation before exporting to ensure current data
        await handleSimulate();
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const marginX = 14;
        let cursorY = 16;
        const today = new Date().toLocaleString('de-CH');

        const totals = currentSimulation?.total_wealth || [];
        const firstValue = totals[0]?.value ?? null;
        const lastValue = totals[totals.length - 1]?.value ?? null;
        const cashflowTotals = yearlyCashFlow.reduce(
            (acc, entry) => {
                acc.income += entry.income || 0;
                acc.expenses += entry.expenses || 0;
                acc.taxes += entry.taxes || 0;
                acc.net += entry.net || entry.income + entry.expenses + (entry.taxes || 0);
                return acc;
            },
            { income: 0, expenses: 0, taxes: 0, net: 0 }
        );

        const addSectionTitle = (text) => {
            if (cursorY > 270) {
                doc.addPage();
                cursorY = marginX;
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.text(text, marginX, cursorY);
            cursorY += 4;
        };

        const addTable = (head, body) => {
            const tableBody = body.length ? body : [new Array(head.length).fill('–')];
            autoTable(doc, {
                startY: cursorY,
                head: [head],
                body: tableBody,
                styles: { fontSize: 9, cellPadding: 2, textColor: 25 },
                headStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
                bodyStyles: { textColor: 25 },
                alternateRowStyles: { fillColor: [248, 248, 248] },
                theme: 'grid',
                margin: { left: marginX, right: marginX },
            });
            cursorY = doc.lastAutoTable.finalY + 8;
        };

        const formatPercent = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num)) return '–';
            return `${(num * 100).toFixed(2)} %`;
        };

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Finanzsimulation – Bericht', marginX, cursorY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`Erstellt: ${today}`, marginX, (cursorY += 8));
        cursorY += 6;

        addSectionTitle('Überblick');
        addTable(
            ['Benutzer', 'E-Mail', 'Szenario', 'Zeitraum', 'Assets', 'Transaktionen'],
            [
                [
                    selectedUser?.name || '–',
                    selectedUser?.email || '–',
                    currentScenario?.name || '–',
                    formatScenarioRange(currentScenario) || '–',
                    accounts.length,
                    allTransactions.length,
                ],
            ]
        );

        addSectionTitle('Szenario-Details');
        addTable(
            ['Beschreibung', 'Inflation p.a.', 'Einkommensteuer', 'Vermögenssteuer'],
            [
                [
                    currentScenario?.description || '–',
                    formatPercent(inflationRate),
                    formatPercent(incomeTaxRate),
                    formatPercent(wealthTaxRate),
                ],
            ]
        );

        addSectionTitle('Assets');
        addTable(
            ['Name', 'Typ', 'Start', 'Ende', 'Wachstum p.a.', 'Startsaldo'],
            accounts.map((acc) => [
                acc.name,
                acc.asset_type || '–',
                acc.start_month && acc.start_year ? `${acc.start_month}/${acc.start_year}` : '–',
                acc.end_month && acc.end_year ? `${acc.end_month}/${acc.end_year}` : '–',
                `${((acc.annual_growth_rate || 0) * 100).toFixed(2)} %`,
                formatCurrency(acc.initial_balance || 0),
            ])
        );

        addSectionTitle('Transaktionen (alle)');
        addTable(
            ['Name', 'Kategorie', 'Typ', 'Asset', 'Gegenkonto', 'Betrag', 'Start', 'Ende', 'Frequenz', 'Steuerbar'],
            allTransactions.map((tx) => [
                tx.name,
                tx.category === 'expense' ? 'Ausgabe' : 'Einnahme',
                tx.type === 'mortgage_interest' ? 'Hypothekenzins' : tx.type === 'regular' ? 'Regelmäßig' : 'Einmalig',
                accountNameMap[tx.asset_id] || tx.asset_id || '–',
                tx.counter_asset_id ? accountNameMap[tx.counter_asset_id] || tx.counter_asset_id : '–',
                formatCurrency(tx.amount || 0),
                tx.start_month && tx.start_year ? `${tx.start_month}/${tx.start_year}` : '–',
                tx.end_month && tx.end_year ? `${tx.end_month}/${tx.end_year}` : '–',
                tx.frequency || tx.frequency === 0 ? tx.frequency : '–',
                tx.taxable ? formatCurrency(tx.taxable_amount || tx.amount || 0) : '–',
            ])
        );

        addSectionTitle('Simulation Kennzahlen');
        addTable(
            ['Startwert', 'Endwert', 'Veränderung', 'Summe Einnahmen', 'Summe Ausgaben', 'Summe Steuern', 'Netto'],
            [
                [
                    firstValue !== null ? formatCurrency(firstValue) : '–',
                    lastValue !== null ? formatCurrency(lastValue) : '–',
                    firstValue !== null && lastValue !== null ? formatCurrency(lastValue - firstValue) : '–',
                    formatCurrency(cashflowTotals.income),
                    formatCurrency(cashflowTotals.expenses),
                    formatCurrency(cashflowTotals.taxes),
                    formatCurrency(cashflowTotals.net),
                ],
            ]
        );

        addSectionTitle('Cashflow nach Jahr');
        addTable(
            ['Jahr', 'Einnahmen', 'Ausgaben', 'Steuern', 'Netto'],
            yearlyCashFlow.map((entry) => [
                entry.year,
                formatCurrency(entry.income || 0),
                formatCurrency(entry.expenses || 0),
                formatCurrency(entry.taxes || 0),
                formatCurrency(entry.net || entry.income + entry.expenses + (entry.taxes || 0)),
            ])
        );

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
        inflationRate,
        incomeTaxRate,
        wealthTaxRate,
        handleSimulate,
    ]);

    const refreshScenarioList = useCallback(async () => {
        try {
            const userScenarios = await listScenarios();
            setScenarios(userScenarios);
            const currentKey = normalizeId(currentScenarioId);
            const exists = userScenarios.some((s) => normalizeId(s.id) === currentKey);
            const prevCount = scenarioCount;
            const nextCount = userScenarios.length;
            setScenarioCount(nextCount);

            // If a new scenario was added (count increased), select the newest (last) scenario
            if (nextCount > prevCount && nextCount > 0) {
                const newestId = normalizeId(userScenarios[userScenarios.length - 1].id);
                setCurrentScenarioId(newestId);
                setSelectedScenarios(newestId ? [newestId] : []);
                return newestId;
            }

            if (!exists) {
                const nextId = normalizeId(userScenarios[0]?.id || '');
                setCurrentScenarioId(nextId);
                setSelectedScenarios(nextId ? [nextId] : []);
                return nextId;
            }
            return currentKey;
        } catch (err) {
            setError(err.message);
            return normalizeId(currentScenarioId);
        }
    }, [currentScenarioId, scenarioCount]);

    const refreshAfterAssistant = useCallback(async () => {
        const scenarioIdToUse = await refreshScenarioList();
        if (!scenarioIdToUse) return;
        await fetchScenarioDetails(scenarioIdToUse);
        await handleSimulate(scenarioIdToUse);
    }, [fetchScenarioDetails, handleSimulate, refreshScenarioList]);

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

    const baseSummary = useMemo(() => summarizeSimulation(currentSimulation), [currentSimulation, summarizeSimulation]);
    const stressSummary = useMemo(() => summarizeSimulation(stressResult), [stressResult, summarizeSimulation]);

    const renderTransactionItem = (tx) => {
        const assetName = accountNameMap[tx.asset_id] || 'Unbekannt';
        const counterName = tx.counter_asset_id ? accountNameMap[tx.counter_asset_id] : null;
        const taxRate = scenarioDetails?.income_tax_rate || 0;
        const grossAmount = Number.isFinite(tx.amount) ? tx.amount : Number(tx.amount) || 0;
        const taxableAmount = tx.taxable
            ? (Number.isFinite(tx.taxable_amount)
                  ? tx.taxable_amount
                  : Number(tx.taxable_amount) || grossAmount)
            : 0;
        const taxEffect = tx.taxable ? taxableAmount * taxRate : 0;
        const netAmount = tx.type === 'mortgage_interest' ? 0 : grossAmount - taxEffect;
        const isExpense = tx.category === 'expense';

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
                        {tx.end_month && tx.end_year ? ` - ${tx.end_month}/${tx.end_year}` : ''}
                    </div>
                    {annualLabel(tx) && <div className="txn-annual">{annualLabel(tx)}</div>}
                    <div className="transaction-meta">
                        <span className={`badge ${isExpense ? 'expense' : 'income'}`}>
                            {isExpense ? 'Ausgabe' : 'Einnahme'}
                        </span>
                        <span className="badge">{assetName}</span>
                        {counterName && <span className="badge secondary">↔ {counterName}</span>}
                        {tx.entry && <span className="badge muted">{tx.entry}</span>}
                        {tx.taxable && <span className="badge muted">steuerbar</span>}
                    </div>
                </div>
                <div className="transaction-actions">
                    {tx.type === 'mortgage_interest' ? (
                        <span className="amount muted">
                            Auto · {(((tx.annual_interest_rate ?? tx.annual_growth_rate ?? 0) * 100) || 0).toFixed(2)}%
                        </span>
                    ) : (
                        <div className="amount tax-breakdown">
                            <div>Brutto {formatCurrency(grossAmount)}</div>
                            {tx.taxable && (
                                <div className="muted small">
                                    Steuer ({(taxRate * 100).toFixed(2)}% auf {formatCurrency(taxableAmount)}): -
                                    {formatCurrency(taxEffect)}
                                </div>
                            )}
                            <div>Netto {formatCurrency(netAmount)}</div>
                        </div>
                    )}
                </div>
            </li>
        );
    };

    const modalAsset = accounts.find((acc) => acc.id === transactionModalAssetId);

    const openScenariosFromHero = () => {
        setShowScenarios(true);
        requestAnimationFrame(() => {
            if (scenarioSectionRef.current) {
                scenarioSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    };

    const openRangeModal = () => {
        if (!currentScenarioId || !scenarioDetails) {
            setError('Bitte zuerst ein Szenario auswählen.');
            return;
        }
        setRangeStart(toMonthInput(scenarioDetails.start_year, scenarioDetails.start_month));
        setRangeEnd(toMonthInput(scenarioDetails.end_year, scenarioDetails.end_month));
        setIsRangeModalOpen(true);
    };

    const handleSaveRange = async () => {
        if (!currentScenarioId) {
            setError('Bitte zuerst ein Szenario auswählen.');
            return;
        }
        const startParts = parseMonthValue(rangeStart);
        const endParts = parseMonthValue(rangeEnd);
        if (!startParts || !endParts) {
            setError('Bitte Start und Ende (Monat/Jahr) angeben.');
            return;
        }
        const previousEndYear = scenarioDetails?.end_year;
        const previousEndMonth = scenarioDetails?.end_month;
        setLoading(true);
        setError(null);
        try {
            const updated = await updateScenario(currentScenarioId, {
                start_year: startParts.year,
                start_month: startParts.month,
                end_year: endParts.year,
                end_month: endParts.month,
            });
            setScenarioDetails(updated);
            setScenarios((prev) => prev.map((s) => (normalizeId(s.id) === normalizeId(updated.id) ? updated : s)));
            setIsRangeModalOpen(false);
            setSimulationCache((prev) => {
                const next = { ...prev };
                delete next[cacheKey(selectedUserId, normalizeId(currentScenarioId))];
                return next;
            });
            if (previousEndYear && previousEndMonth) {
                const updatedAccounts = await Promise.all(
                    accounts.map(async (account) => {
                        const matchPrev =
                            account.end_year === previousEndYear && account.end_month === previousEndMonth;
                        if (matchPrev) {
                            const refreshed = await updateAsset(account.id, {
                                end_year: endParts.year,
                                end_month: endParts.month,
                            });
                            return refreshed;
                        }
                        return account;
                    })
                );
                setAccounts(updatedAccounts);
            }
            await handleSimulate(updated.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectScenarioFromMenu = async (scenarioId) => {
        const key = normalizeId(scenarioId);
        setCurrentScenarioId(key);
        setSelectedScenarios([key]);
        setIsScenarioMenuOpen(false);
        await handleSimulate(key);
    };

    useEffect(() => {
        const onClickOutside = (e) => {
            if (scenarioMenuRef.current && !scenarioMenuRef.current.contains(e.target)) {
                setIsScenarioMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    useEffect(() => {
        if (!showScenarios) return undefined;
        const handleClick = (e) => {
            if (scenarioSectionRef.current && !scenarioSectionRef.current.contains(e.target)) {
                setShowScenarios(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showScenarios]);

    return (
        <>
            <div className="simulation">
                <div className="market-hero">
                    <button
                        className="user-burger"
                        onClick={() => setIsSidebarOpen((prev) => !prev)}
                        aria-expanded={isSidebarOpen}
                        aria-controls="user-sidebar"
                        title="Benutzer verwalten"
                    >
                        ☰
                    </button>
                    <div className="hero-main">
                        <div>
                            <p className="eyebrow">Financials Overview</p>
                            <h1>Portfolio Simulation</h1>
                            <div className="hero-meta">
                                <div className="scenario-pill-menu" ref={scenarioMenuRef}>
                                    <button
                                        type="button"
                                        className="pill clickable"
                                        onClick={() => setIsScenarioMenuOpen((prev) => !prev)}
                                    >
                                        Szenario: {currentScenario?.name || 'Kein Szenario'}
                                    </button>
                                    {isScenarioMenuOpen && (
                                        <div className="scenario-dropdown">
                                            {scenarios.map((scenario) => (
                                                <button
                                                    key={`menu-${scenario.id}`}
                                                    type="button"
                                                    className="scenario-dropdown-item"
                                                    onClick={() => handleSelectScenarioFromMenu(scenario.id)}
                                                >
                                                    <div className="scenario-dropdown-title">{scenario.name}</div>
                                                    <div className="scenario-dropdown-sub">
                                                        {formatScenarioRange(scenario) || 'Zeitraum offen'}
                                                    </div>
                                                </button>
                                            ))}
                                            <div className="scenario-dropdown-divider" />
                                            <button
                                                type="button"
                                                className="scenario-dropdown-item manage"
                                                onClick={() => {
                                                    setIsScenarioMenuOpen(false);
                                                    openScenariosFromHero();
                                                }}
                                            >
                                                Szenarien verwalten
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button type="button" className="pill clickable" onClick={openRangeModal}>
                                    {scenarioRangeLabel || 'Zeitraum offen'}
                                </button>
                                <span className="pill muted">{scenarios.length} Szenarien</span>
                            </div>
                            <div className="hero-meta">
                                <span className="pill muted">Assets: {accounts.length}</span>
                                <span className="pill muted">Transaktionen: {allTransactions.length}</span>
                            </div>
                            <div className="hero-subline">
                                {currentScenario?.description || 'Beschreibung hinzufügen, um das Szenario schneller wiederzuerkennen.'}
                            </div>
                        </div>
                        <div className="hero-actions">
                            <button onClick={openScenarioSection}>Szenario verwalten</button>
                            <button className="secondary" onClick={() => handleSimulate()} disabled={!currentScenarioId}>
                                Simulation starten
                            </button>
                            <button className="secondary" onClick={handleDownloadPdf} disabled={!selectedUserId || !currentScenarioId}>
                                PDF herunterladen
                            </button>
                        </div>
                    </div>
                </div>

                <div className="simulation-layout">
                    <div className="simulation-main">
                        {error && <p className="error">{error}</p>}
                        {loading && <p>Loading...</p>}

                        {showScenarios && (
                            <div className="panel" ref={scenarioSectionRef}>
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Szenarien</p>
                                        <h3>Planen & vergleichen</h3>
                                    </div>
                                    <div className="panel-actions">
                                        <div className="scenario-chip">
                                            <span>Aktiv</span>
                                            <strong>{currentScenario?.name || 'Kein Szenario'}</strong>
                                        </div>
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
                                            <span>Inflation p.a.</span>
                                            <input
                                                type="number"
                                                placeholder="z.B. 0.02 für 2%"
                                                value={inflationRate}
                                                onChange={(e) => setInflationRate(e.target.value)}
                                                step="0.0001"
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Beschreibung</span>
                                            <textarea
                                                rows={3}
                                                placeholder="Kurzbeschreibung des Szenarios"
                                                value={newScenarioDescription}
                                                onChange={(e) => setNewScenarioDescription(e.target.value)}
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Einkommensteuersatz</span>
                                            <input
                                                type="number"
                                                placeholder="z.B. 0.25"
                                                    value={incomeTaxRate}
                                                    onChange={(e) => setIncomeTaxRate(e.target.value)}
                                                    step="0.0001"
                                                />
                                            </label>
                                            <label className="stacked">
                                                <span>Vermögenssteuersatz</span>
                                                <input
                                                    type="number"
                                                    placeholder="z.B. 0.005"
                                                    value={wealthTaxRate}
                                                    onChange={(e) => setWealthTaxRate(e.target.value)}
                                                    step="0.0001"
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
                                                <span className="label">Beschreibung</span>
                                                <strong>{scenarioDetails?.description || '–'}</strong>
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
                                        <div className="scenario-settings">
                                            <p className="eyebrow">Einstellungen</p>
                                            <div className="scenario-form-grid">
                                                <label className="stacked">
                                                    <span>Inflation p.a.</span>
                                                    <input
                                                        type="number"
                                                        value={inflationRate}
                                                        onChange={(e) => setInflationRate(e.target.value)}
                                                        step="0.0001"
                                                    />
                                                </label>
                                                <label className="stacked">
                                                    <span>Beschreibung</span>
                                                    <textarea
                                                        rows={3}
                                                        value={scenarioDescription}
                                                        onChange={(e) => setScenarioDescription(e.target.value)}
                                                    />
                                                </label>
                                                <label className="stacked">
                                                    <span>Einkommensteuer</span>
                                                    <input
                                                        type="number"
                                                        value={incomeTaxRate}
                                                        onChange={(e) => setIncomeTaxRate(e.target.value)}
                                                        step="0.0001"
                                                    />
                                                </label>
                                                <label className="stacked">
                                                    <span>Vermögenssteuer</span>
                                                    <input
                                                        type="number"
                                                        value={wealthTaxRate}
                                                        onChange={(e) => setWealthTaxRate(e.target.value)}
                                                        step="0.0001"
                                                    />
                                                </label>
                                            </div>
                                            <button onClick={handleUpdateScenarioSettings} disabled={!currentScenarioId}>
                                                Einstellungen speichern
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="eyebrow">Accounts</p>
                                    <h3>Vermögen & Schulden</h3>
                                </div>
                                <div className="panel-actions">
                                    <button className="secondary" onClick={() => setShowAccounts((v) => !v)}>
                                        {showAccounts ? 'Einklappen' : 'Ausklappen'}
                                    </button>
                                    <button onClick={openAssetModal} disabled={!currentScenarioId}>
                                        Neues Asset
                                    </button>
                                </div>
                            </div>
                            {showAccounts && (
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
                            )}
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="eyebrow">Transaktionen</p>
                                    <h3>Cashflows</h3>
                                </div>
                                <div className="panel-actions">
                                    <button className="secondary" onClick={() => setShowTransactions((v) => !v)}>
                                        {showTransactions ? 'Einklappen' : 'Ausklappen'}
                                    </button>
                                    <button
                                        onClick={() => openTransactionModal(null, null)}
                                        disabled={!currentScenarioId || accounts.length === 0}
                                    >
                                        Neue Transaktion
                                    </button>
                                </div>
                            </div>
                            {showTransactions && (
                                <div className="panel-body">
                                    {allTransactions.length === 0 ? (
                                        <p className="placeholder">Keine Transaktionen.</p>
                                    ) : (
                                        <div className="transaction-groups">
                                            <div className="transaction-group income-group">
                                                <div className="transaction-group-header">
                                                    <h4>Einnahmen</h4>
                                                    <span className="pill muted">{incomeTransactions.length}</span>
                                                </div>
                                                {incomeTransactions.length === 0 ? (
                                                    <p className="placeholder">Keine Einnahmen erfasst.</p>
                                                ) : (
                                                    <ul className="transaction-list">
                                                        {incomeTransactions.map((tx) => renderTransactionItem(tx))}
                                                    </ul>
                                                )}
                                            </div>
                                            <div className="transaction-group expense-group">
                                                <div className="transaction-group-header">
                                                    <h4>Ausgaben</h4>
                                                    <span className="pill muted">{expenseTransactions.length}</span>
                                                </div>
                                                {expenseTransactions.length === 0 ? (
                                                    <p className="placeholder">Keine Ausgaben erfasst.</p>
                                                ) : (
                                                    <ul className="transaction-list">
                                                        {expenseTransactions.map((tx) => renderTransactionItem(tx))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="eyebrow">Cashflow</p>
                                    <h3>Zusammenfassung</h3>
                                </div>
                                <div className="panel-actions">
                                    <button className="secondary" onClick={() => setShowCashflow((v) => !v)}>
                                        {showCashflow ? 'Einklappen' : 'Ausklappen'}
                                    </button>
                                </div>
                            </div>
                            {showCashflow && (
                                <>
                                    {yearlyCashFlow.length === 0 ? (
                                        <div className="panel-body">
                                            <p className="placeholder">Noch keine Cashflows berechnet.</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="panel-body">
                                                <div className="chart-wrapper">
                                                    <Line
                                                        data={{
                                                            labels: yearlyCashFlow.map((entry) => entry.year),
                                                            datasets: [
                                                                {
                                                                    label: 'Netto',
                                                                    data: yearlyCashFlow.map(
                                                                        (entry) =>
                                                                            entry.net ||
                                                                            entry.income + entry.expenses + (entry.taxes || 0)
                                                                    ),
                                                                    borderColor: '#22d3ee',
                                                                    backgroundColor: 'rgba(34, 211, 238, 0.2)',
                                                                    tension: 0.25,
                                                                    fill: true,
                                                                },
                                                            ],
                                                        }}
                                                        options={{
                                                            responsive: true,
                                                            maintainAspectRatio: false,
                                                            plugins: {
                                                                legend: { display: false },
                                                                tooltip: {
                                                                    callbacks: {
                                                                        label: (ctx) =>
                                                                            `Netto: ${ctx.parsed.y.toLocaleString('de-CH', {
                                                                                style: 'currency',
                                                                                currency: 'CHF',
                                                                            })}`,
                                                                    },
                                                                },
                                                            },
                                                            scales: {
                                                                x: { stacked: true },
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
                                            </div>

                                            <div className="panel-body table-wrapper">
                                                <table className="table cashflow-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Jahr (Ende)</th>
                                                            <th>Einnahmen</th>
                                                            <th>Ausgaben</th>
                                                            <th>Steuern</th>
                                                            <th>Netto</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {yearlyCashFlow.map((yearRow) => {
                                                            const isExpanded = expandedYears.includes(yearRow.year);
                                                            const yearNet =
                                                                yearRow.net ||
                                                                yearRow.income + yearRow.expenses + (yearRow.taxes || 0);
                                                            return (
                                                                <React.Fragment key={`year-${yearRow.year}`}>
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
                                                                        <td>{formatCurrency(yearRow.income)}</td>
                                                                        <td>{formatCurrency(yearRow.expenses)}</td>
                                                                        <td>{formatCurrency(yearRow.taxes || 0)}</td>
                                                                        <td>{formatCurrency(yearNet)}</td>
                                                                    </tr>
                                                                    {isExpanded &&
                                                                        yearRow.months.map((row) => {
                                                                            const monthNet =
                                                                                row.net ||
                                                                                row.income + row.expenses + (row.taxes || 0);
                                                                            return (
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
                                                                                                {formatCurrency(row.income)}
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
                                                                                                {formatCurrency(row.expenses)}
                                                                                            </button>
                                                                                        </td>
                                                                                        <td>
                                                                                            <button
                                                                                                className="link-button"
                                                                                                onClick={() =>
                                                                                                    setCashFlows((prev) =>
                                                                                                        prev.map((cf) =>
                                                                                                            cf.date === row.date
                                                                                                                ? { ...cf, showTax: !cf.showTax }
                                                                                                                : cf
                                                                                                        )
                                                                                                    )
                                                                                                }
                                                                                            >
                                                                                                {formatCurrency(row.taxes || 0)}
                                                                                            </button>
                                                                                        </td>
                                                                                        <td>{formatCurrency(monthNet)}</td>
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
                                                                                                                {formatCurrency(item.amount)}
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
                                                                                                                {formatCurrency(item.amount)}
                                                                                                            </span>
                                                                                                        </li>
                                                                                                    ))}
                                                                                                </ul>
                                                                                            </td>
                                                                                        </tr>
                                                                                    )}
                                                                                    {row.showTax && row.tax_details?.length > 0 && (
                                                                                        <tr className="cashflow-subrow">
                                                                                            <td></td>
                                                                                            <td colSpan={4}>
                                                                                                <ul className="cashflow-items">
                                                                                                    {row.tax_details.map((item, idx) => (
                                                                                                        <li key={`tax-${row.date}-${idx}`}>
                                                                                                            <span>{item.name}</span>
                                                                                                            <span className="muted">{item.account}</span>
                                                                                                            <span className="amount">
                                                                                                                {formatCurrency(item.amount)}
                                                                                                            </span>
                                                                                                        </li>
                                                                                                    ))}
                                                                                                </ul>
                                                                                            </td>
                                                                                        </tr>
                                                                                    )}
                                                                                </React.Fragment>
                                                                            );
                                                                        })}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="eyebrow">Assets</p>
                                    <h3>Asset Balances & Totals</h3>
                                </div>
                                <div className="panel-actions">
                                    <button className="secondary" onClick={() => setShowTotals((v) => !v)}>
                                        {showTotals ? 'Einklappen' : 'Ausklappen'}
                                    </button>
                                </div>
                            </div>
                            {showTotals && (
                                <div className="panel-body">
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
                                            <span>{assetChartData.fullLabels[Math.min(chartRange.start, Math.max(assetChartData.fullLabels.length - 1, 0))] || '–'}</span>
                                            <span>
                                                {assetChartData.fullLabels[
                                                    chartRange.end === null
                                                        ? Math.max(assetChartData.fullLabels.length - 1, 0)
                                                        : Math.min(chartRange.end, Math.max(assetChartData.fullLabels.length - 1, 0))
                                                ] || '–'}
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
                            )}
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-header">
                        <div>
                            <p className="eyebrow">Risiko</p>
                            <h3>Stress & Sensitivität</h3>
                        </div>
                        <div className="panel-actions">
                            <span className="pill muted">{stressResult ? 'Stress simuliert' : 'Basis'}</span>
                        </div>
                    </div>
                    <div className="panel-body">
                        <div className="risk-grid">
                            <label className="stacked">
                                <span>Zins-Schock Hypotheken (%)</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={stressOverrides.mortgageRateDelta}
                                    onChange={(e) =>
                                        setStressOverrides((prev) => ({
                                            ...prev,
                                            mortgageRateDelta: e.target.value,
                                        }))
                                    }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Zins-Schock Start</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.mortgageStart}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                mortgageStart: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Zins-Schock Ende</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.mortgageEnd}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                mortgageEnd: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                            <label className="stacked">
                                <span>Wachstum Assets Δ (%)</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={stressOverrides.assetGrowthDelta}
                                    onChange={(e) =>
                                        setStressOverrides((prev) => ({
                                            ...prev,
                                            assetGrowthDelta: e.target.value,
                                        }))
                                    }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Portfolio Δ Start</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.portfolioStart}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                portfolioStart: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Portfolio Δ Ende</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.portfolioEnd}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                portfolioEnd: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                            <label className="stacked">
                                <span>Einnahmen Δ (%)</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={stressOverrides.incomeDelta}
                                    onChange={(e) =>
                                        setStressOverrides((prev) => ({
                                            ...prev,
                                            incomeDelta: e.target.value,
                                        }))
                                    }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Einnahmen Δ Start</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.incomeStart}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                incomeStart: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Einnahmen Δ Ende</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.incomeEnd}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                incomeEnd: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                            <label className="stacked">
                                <span>Ausgaben Δ (%)</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={stressOverrides.expenseDelta}
                                    onChange={(e) =>
                                        setStressOverrides((prev) => ({
                                            ...prev,
                                            expenseDelta: e.target.value,
                                        }))
                                    }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Ausgaben Δ Start</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.expenseStart}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                expenseStart: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                                <label className="stacked">
                                    <span>Ausgaben Δ Ende</span>
                                    <input
                                        type="month"
                                        value={stressOverrides.expenseEnd}
                                        onChange={(e) =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                expenseEnd: e.target.value,
                                            }))
                                        }
                                    />
                                </label>
                            <label className="stacked">
                                <span>Einkommensteuer Override (%)</span>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={stressOverrides.incomeTaxOverride}
                                    onChange={(e) =>
                                        setStressOverrides((prev) => ({
                                            ...prev,
                                            incomeTaxOverride: e.target.value,
                                        }))
                                    }
                                />
                            </label>
                        </div>
                        <div className="risk-actions">
                            <div className="muted small">
                                Angaben in % (z.B. 2 = +2%, -20 = -20%). Wachstums-Δ wirkt als Faktor auf die Asset-Wachstumsrate.
                            </div>
                            <button className="secondary" onClick={handleStressSimulate} disabled={!currentScenarioId || stressLoading}>
                                {stressLoading ? 'Berechne...' : 'Stress simulieren'}
                            </button>
                        </div>
                        <div className="risk-summary">
                            <div className="summary-card">
                                <span className="label">Endwert Basis</span>
                                <strong>
                                    {baseSummary?.endValue !== null && baseSummary?.endValue !== undefined
                                        ? formatCurrency(baseSummary.endValue)
                                        : '–'}
                                </strong>
                            </div>
                            <div className="summary-card">
                                <span className="label">Endwert Stress</span>
                                <strong>
                                    {stressSummary?.endValue !== null && stressSummary?.endValue !== undefined
                                        ? formatCurrency(stressSummary.endValue)
                                        : '–'}
                                </strong>
                            </div>
                            <div className="summary-card">
                                <span className="label">Delta Vermögen</span>
                                <strong>
                                    {baseSummary?.endValue !== null &&
                                    baseSummary?.endValue !== undefined &&
                                    stressSummary?.endValue !== null &&
                                    stressSummary?.endValue !== undefined
                                        ? formatCurrency(stressSummary.endValue - baseSummary.endValue)
                                        : '–'}
                                </strong>
                            </div>
                            <div className="summary-card">
                                <span className="label">Netto Cashflow (Stress)</span>
                                <strong>{stressSummary ? formatCurrency(stressSummary.net) : '–'}</strong>
                                {baseSummary && stressSummary && (
                                    <div className="muted small">Delta vs Basis {formatCurrency(stressSummary.net - baseSummary.net)}</div>
                                )}
                            </div>
                        </div>
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
                                <span>Start (optional)</span>
                                <input
                                    type="month"
                                    value={newAccountStart}
                                    onChange={(e) => setNewAccountStart(e.target.value)}
                                />
                            </label>
                            <label className="stacked">
                                <span>Ende (optional)</span>
                                <input
                                    type="month"
                                    value={newAccountEnd}
                                    onChange={(e) => setNewAccountEnd(e.target.value)}
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
                                    <option value="portfolio">Portfolio</option>
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
            <div id="user-sidebar" className={`user-drawer ${isSidebarOpen ? 'open' : ''}`}>
                <div className="user-drawer-header">
                    <h3>User Management</h3>
                    <button className="secondary" onClick={() => setIsSidebarOpen(false)}>
                        Schließen
                    </button>
                </div>
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
            </div>
            {isRangeModalOpen && (
                <div className="modal-overlay" onClick={() => setIsRangeModalOpen(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Zeitraum anpassen</p>
                                <h3>{currentScenario?.name || 'Szenario'}</h3>
                            </div>
                            <div className="modal-header-actions">
                                <button className="secondary" onClick={() => setIsRangeModalOpen(false)}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <div className="modal-grid">
                            <label className="stacked">
                                <span>Start</span>
                                <input
                                    type="month"
                                    value={rangeStart}
                                    onChange={(e) => setRangeStart(e.target.value)}
                                />
                            </label>
                            <label className="stacked">
                                <span>Ende</span>
                                <input
                                    type="month"
                                    value={rangeEnd}
                                    onChange={(e) => setRangeEnd(e.target.value)}
                                />
                            </label>
                        </div>
                        <div className="modal-actions">
                            <button onClick={handleSaveRange} disabled={!rangeStart || !rangeEnd}>
                                Zeitraum speichern
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <AIAssistant
                currentScenarioId={currentScenarioId}
                accounts={accounts}
                scenarios={scenarios}
                onDataChanged={refreshAfterAssistant}
            />
        </>
    );
};

export default Simulation;
