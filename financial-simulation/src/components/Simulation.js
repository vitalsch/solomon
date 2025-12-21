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
    listStressProfiles,
    createStressProfile,
    updateStressProfile,
    deleteStressProfileApi,
    getAuthToken,
    listTaxCantons,
    listStateTaxRates,
    listMunicipalTaxEntries,
    listStateTaxTariffsPublic,
    listFederalTaxTablesPublic,
    changePassword,
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
const normalizeStressProfile = (profile = {}) => ({
    ...profile,
    is_public: Boolean(profile?.is_public),
});
const isProfileOwner = (profile, userId) => normalizeId(profile?.user_id) === normalizeId(userId);

const CONFESSION_FIELD_MAP = {
    ref: 'ref_rate',
    cath: 'cath_rate',
    christian_cath: 'christian_cath_rate',
};

const parseIsoLabel = (label) => {
    if (!label) return null;
    const [yearStr, monthStr] = label.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
        return null;
    }
    return { year, month };
};

const formatIsoLabel = (label) => {
    if (!label) return '';
    const safe = label.length === 10 ? `${label}T00:00:00` : label;
    const date = new Date(safe);
    if (Number.isNaN(date.getTime())) {
        return label;
    }
    return date.toLocaleDateString('de-CH', { month: '2-digit', year: 'numeric' });
};

const parseNumericInput = (value) => {
    if (typeof value === 'number') return value;
    if (!value) return NaN;
    const cleaned = String(value)
        .replace(/\s+/g, '')
        .replace(/CHF/gi, '')
        .replace(/['’]/g, '')
        .replace(/ /g, '')
        .trim();
    if (!cleaned) return NaN;
    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');
    let normalized = cleaned;
    if (hasComma && hasDot) {
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
        normalized = cleaned.replace(',', '.');
    }
    const num = Number(normalized);
    return Number.isFinite(num) ? num : NaN;
};

const normalizeSignatureString = (value) => String(value || '').trim().toLowerCase();
const normalizeSignatureNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(6) : '0';
};

const buildAssetSignature = (asset = {}) => {
    const { name = '', asset_type = '', annual_growth_rate = 0, initial_balance = 0 } = asset || {};
    return [
        normalizeSignatureString(name),
        normalizeSignatureString(asset_type),
        normalizeSignatureNumber(annual_growth_rate),
        normalizeSignatureNumber(initial_balance),
    ].join('|');
};

const buildTransactionSignature = (tx = {}) => {
    const {
        name = '',
        type = '',
        amount = 0,
        frequency = '',
        annual_growth_rate = '',
        annual_interest_rate = '',
        entry = '',
        taxable = '',
        taxable_amount = '',
    } = tx || {};
    return [
        normalizeSignatureString(name),
        normalizeSignatureString(type),
        normalizeSignatureNumber(amount),
        normalizeSignatureString(frequency),
        normalizeSignatureString(annual_growth_rate),
        normalizeSignatureString(annual_interest_rate),
        normalizeSignatureString(entry),
        taxable ? 't' : 'f',
        normalizeSignatureString(taxable_amount),
    ].join('|');
};

const Simulation = ({ onLogout }) => {
    const [users, setUsers] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [passwordMessage, setPasswordMessage] = useState('');
    const [scenarios, setScenarios] = useState([]);
    const [currentScenarioId, setCurrentScenarioId] = useState('');
    const [scenarioDetails, setScenarioDetails] = useState(null);
    const [activeSection, setActiveSection] = useState('scenarios');
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
    const [taxAccountId, setTaxAccountId] = useState('');
    const [libraryAssets, setLibraryAssets] = useState([]);
    const [libraryTransactions, setLibraryTransactions] = useState([]);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryError, setLibraryError] = useState('');
    const [transactionDropTargetAssetId, setTransactionDropTargetAssetId] = useState('');
    const [showLibraryInAccounts, setShowLibraryInAccounts] = useState(false);
    const [showLibraryInTransactions, setShowLibraryInTransactions] = useState(false);
    const [taxCantons, setTaxCantons] = useState([]);
    const [stateTaxRates, setStateTaxRates] = useState([]);
    const [taxMunicipalities, setTaxMunicipalities] = useState([]);
    const [stateIncomeTariffs, setStateIncomeTariffs] = useState([]);
    const [stateWealthTariffs, setStateWealthTariffs] = useState([]);
    const [federalTariffs, setFederalTariffs] = useState([]);
    const [selectedTaxCanton, setSelectedTaxCanton] = useState('');
    const [selectedMunicipalityId, setSelectedMunicipalityId] = useState('');
    const [selectedStateIncomeTariffId, setSelectedStateIncomeTariffId] = useState('');
    const [selectedStateWealthTariffId, setSelectedStateWealthTariffId] = useState('');
    const [selectedFederalTariffId, setSelectedFederalTariffId] = useState('');
    const [selectedMaritalStatus, setSelectedMaritalStatus] = useState('ledig');
    const [numChildren, setNumChildren] = useState('');
    const [selectedConfession, setSelectedConfession] = useState('none');
    const [selectedConfessionPartner, setSelectedConfessionPartner] = useState('none');
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
    const [scenarioNameEdit, setScenarioNameEdit] = useState('');
    const scenarioSectionRef = useRef(null);
    const scenarioListRequestRef = useRef(0);
    const scenarioDetailRequestRef = useRef(0);
    const scenarioMenuRef = useRef(null);
    const [isScenarioMenuOpen, setIsScenarioMenuOpen] = useState(false);
    const [isRangeModalOpen, setIsRangeModalOpen] = useState(false);
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [isRebaseModalOpen, setIsRebaseModalOpen] = useState(false);
    const [rebaseTarget, setRebaseTarget] = useState(null);
    const [rebaseValue, setRebaseValue] = useState('');
    const [rebaseLoading, setRebaseLoading] = useState(false);
    const [rebaseAssetId, setRebaseAssetId] = useState('');
    const [rebaseError, setRebaseError] = useState('');
    const [isChartActionModalOpen, setIsChartActionModalOpen] = useState(false);
    const [chartActionTarget, setChartActionTarget] = useState(null);
    const [cashflowRange, setCashflowRange] = useState({ start: 0, end: null });
    const [transactionDraft, setTransactionDraft] = useState(null);
    const [stressOverrides, setStressOverrides] = useState({
        shocks: [
            { id: 'shock-1', assetType: 'portfolio', delta: '-20', start: '', end: '' },
        ],
    });
    const [showNewProfileEditor, setShowNewProfileEditor] = useState(false);
    const [stressProfiles, setStressProfiles] = useState([]);
    const [profileName, setProfileName] = useState('');
    const [profileDescription, setProfileDescription] = useState('');
    const [profileIsPublic, setProfileIsPublic] = useState(false);
    const [profileResults, setProfileResults] = useState({});
    const [profileSimulations, setProfileSimulations] = useState({});

    const maybeEncryptRecord = useCallback(
        async (record) => {
            return { sanitized: record, encrypted: null };
        },
        []
    );

    const maybeDecryptRecord = useCallback(
        async (record) => {
            return record;
        },
        []
    );

    const decryptRecords = useCallback(
        async (records = []) => Promise.all((records || []).map((item) => maybeDecryptRecord(item))),
        [maybeDecryptRecord]
    );
    const [openProfileIds, setOpenProfileIds] = useState([]);
    const [selectedProfileIds, setSelectedProfileIds] = useState([]);
    const [profileLoadingId, setProfileLoadingId] = useState('');
    const [editingProfileId, setEditingProfileId] = useState('');
    const [editingProfileName, setEditingProfileName] = useState('');
    const [editingProfileDescription, setEditingProfileDescription] = useState('');
    const [editingProfileOverrides, setEditingProfileOverrides] = useState({ shocks: [] });
    const [editingProfileIsPublic, setEditingProfileIsPublic] = useState(false);
    const [selectedTaxYear, setSelectedTaxYear] = useState(null);
    const [stressResult, setStressResult] = useState(null);
    const [stressLoading, setStressLoading] = useState(false);
    const taxTableRef = useRef(null);
    const chartRef = useRef(null);
    const formatCurrency = (value) => {
        const num = Number(value);
        const safe = Number.isFinite(num) ? num : 0;
        return safe.toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
    };

    const currentScenario = useMemo(
        () => scenarios.find((scenario) => normalizeId(scenario.id) === normalizeId(currentScenarioId)),
        [scenarios, currentScenarioId]
    );
    const selectedUser = useMemo(
        () => users.find((user) => normalizeId(user.id) === normalizeId(selectedUserId)),
        [users, selectedUserId]
    );
    const activeTaxProfile = null;
    const activeStateIncomeTariff = useMemo(
        () =>
            stateIncomeTariffs.find((tariff) => normalizeId(tariff.id) === normalizeId(selectedStateIncomeTariffId)) ||
            null,
        [stateIncomeTariffs, selectedStateIncomeTariffId]
    );
    const activeStateWealthTariff = useMemo(
        () =>
            stateWealthTariffs.find((tariff) => normalizeId(tariff.id) === normalizeId(selectedStateWealthTariffId)) ||
            null,
        [stateWealthTariffs, selectedStateWealthTariffId]
    );
    const activeFederalTariff = useMemo(
        () =>
            federalTariffs.find((table) => normalizeId(table.id) === normalizeId(selectedFederalTariffId)) || null,
        [federalTariffs, selectedFederalTariffId]
    );
    const selectedMunicipality = useMemo(
        () =>
            taxMunicipalities.find((entry) => normalizeId(entry.id) === normalizeId(selectedMunicipalityId)) || null,
        [taxMunicipalities, selectedMunicipalityId]
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
        setActiveSection('scenarios');
        requestAnimationFrame(() => {
            if (scenarioSectionRef.current) {
                scenarioSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }, []);
    const showTaxTable = activeSection === 'taxes';

    const groupedTransactions = useMemo(() => {
        const grouping = { ...accountTransactions };
        accounts.forEach((account) => {
            if (!grouping[account.id]) {
                grouping[account.id] = [];
            }
        });
        return grouping;
    }, [accounts, accountTransactions]);

    const accountById = useMemo(() => {
        const map = {};
        accounts.forEach((acc) => {
            map[acc.id] = acc;
        });
        return map;
    }, [accounts]);

    const categorizeTransaction = useCallback(
        (tx) => {
            const rawAmount = Number.isFinite(tx.amount) ? tx.amount : Number(tx.amount);
            const normalizedAmount = Number.isFinite(rawAmount) ? rawAmount : 0;
            if (tx.type === 'mortgage_interest') {
                const linkedAsset = accountById[tx.mortgage_asset_id] || accountById[tx.asset_id];
                const assetBalance = linkedAsset ? Number(linkedAsset.initial_balance) : NaN;
                const assetSign = Number.isFinite(assetBalance) ? Math.sign(assetBalance) : null;
                if (assetSign === -1) return 'expense';
                if (assetSign === 0 || assetSign === 1) return 'income';
                if (normalizedAmount < 0) return 'expense';
                return 'income';
            }
            if (tx.entry === 'credit') return 'expense';
            if (tx.entry === 'debit') return 'income';
            return normalizedAmount < 0 ? 'expense' : 'income';
        },
        [accountById]
    );

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

    const findTransactionById = useCallback(
        (id) => {
            const key = normalizeId(id);
            for (const txList of Object.values(accountTransactions || {})) {
                const found = (txList || []).find((tx) => normalizeId(tx.id) === key);
                if (found) return found;
            }
            return null;
        },
        [accountTransactions]
    );

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

    const selectedRebaseAsset = useMemo(
        () => accounts.find((acc) => acc.id === rebaseAssetId) || null,
        [accounts, rebaseAssetId]
    );

    const rebaseDeltaPreview = useMemo(() => {
        if (!rebaseTarget) return null;
        const parsed = parseNumericInput(rebaseValue);
        if (!Number.isFinite(parsed)) return null;
        const base = Number(rebaseTarget.value) || 0;
        return parsed - base;
    }, [rebaseValue, rebaseTarget]);

    const openTransactionModal = useCallback(
        (account, transaction = null, defaults = null) => {
            const assetId = transaction?.asset_id || defaults?.asset_id || account?.id || accounts[0]?.id || '';
            setTransactionModalAssetId(assetId);
            setTransactionModalTransaction(transaction);
            setTransactionDraft(defaults || null);
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
        setTransactionDraft(null);
        setIsTransactionModalOpen(false);
    }, []);

    const closeRebaseModal = useCallback(() => {
        setIsRebaseModalOpen(false);
        setRebaseTarget(null);
        setRebaseValue('');
        setRebaseAssetId('');
        setRebaseError('');
        setRebaseLoading(false);
    }, []);

    const closeChartActionModal = useCallback(() => {
        setIsChartActionModalOpen(false);
        setChartActionTarget(null);
    }, []);

    const fetchScenarioDetails = useCallback(
        async (scenarioId) => {
            const requestId = ++scenarioDetailRequestRef.current;
            setLoading(true);
            setError(null);
            try {
                const key = normalizeId(scenarioId);
                const [scenario, assets, transactions] = await Promise.all([getScenario(key), listAssets(key), listTransactions(key)]);
                const [decScenario, decAssets, decTransactions] = await Promise.all([
                    maybeDecryptRecord(scenario),
                    decryptRecords(assets),
                    decryptRecords(transactions),
                ]);
                if (requestId !== scenarioDetailRequestRef.current) return;
                const finalScenario = decScenario || scenario;
                setScenarioDetails(finalScenario);
                // Keep scenario list in sync with decrypted details so headers/menus show plaintext.
                setScenarios((prev) =>
                    prev.map((s) => (normalizeId(s.id) === normalizeId(finalScenario.id) ? { ...s, ...finalScenario } : s))
                );
                const safeAssets = decAssets || assets;
                setAccounts(safeAssets);
                const grouped = safeAssets.reduce((acc, asset) => {
                    acc[asset.id] = [];
                    return acc;
                }, {});
                (decTransactions || transactions).forEach((transaction) => {
                    const assetId = transaction.asset_id;
                    if (!grouped[assetId]) {
                        grouped[assetId] = [];
                    }
                    grouped[assetId].push(transaction);
                });
                setAccountTransactions(grouped);
                closeTransactionModal();
                closeRebaseModal();
                closeChartActionModal();
            } catch (err) {
                if (requestId !== scenarioDetailRequestRef.current) return;
                setError(err.message);
            } finally {
                if (requestId === scenarioDetailRequestRef.current) {
                    setLoading(false);
                }
            }
        },
        [closeTransactionModal, closeRebaseModal, closeChartActionModal, decryptRecords, maybeDecryptRecord]
    );

    useEffect(() => {
        if (currentScenarioId) {
            fetchScenarioDetails(currentScenarioId);
        }
    }, [currentScenarioId, fetchScenarioDetails]);

    useEffect(() => {
        if (scenarioDetails) {
            setScenarioNameEdit(scenarioDetails.name || '');
            setInflationRate(
                scenarioDetails.inflation_rate === null || scenarioDetails.inflation_rate === undefined
                    ? ''
                    : scenarioDetails.inflation_rate
            );
            setScenarioDescription(scenarioDetails.description || '');
            setTaxAccountId(scenarioDetails.tax_account_id || '');
            setSelectedTaxCanton(scenarioDetails.tax_canton || '');
            setSelectedMunicipalityId(scenarioDetails.tax_municipality_id || '');
            setSelectedStateIncomeTariffId(scenarioDetails.tax_state_income_tariff_id || '');
            setSelectedStateWealthTariffId(scenarioDetails.tax_state_wealth_tariff_id || '');
            setSelectedFederalTariffId(scenarioDetails.tax_federal_tariff_id || '');
            setSelectedConfession(scenarioDetails.tax_confession || 'none');
            setSelectedConfessionPartner(scenarioDetails.tax_confession_partner || 'none');
            setSelectedMaritalStatus(scenarioDetails.tax_marital_status || 'ledig');
            setNumChildren(
                scenarioDetails.num_children === null || scenarioDetails.num_children === undefined
                    ? ''
                    : scenarioDetails.num_children
            );
        } else {
            setScenarioNameEdit('');
            setInflationRate('');
            setScenarioDescription('');
            setTaxAccountId('');
            setSelectedTaxCanton('');
            setSelectedMunicipalityId('');
            setSelectedStateIncomeTariffId('');
            setSelectedStateWealthTariffId('');
            setSelectedFederalTariffId('');
            setSelectedConfession('none');
            setSelectedConfessionPartner('none');
            setSelectedMaritalStatus('ledig');
            setNumChildren('');
        }
    }, [scenarioDetails]);

    useEffect(() => {
        if (accounts && accounts.length) {
            setTransactionDropTargetAssetId((prev) => {
                const exists = accounts.some((account) => normalizeId(account.id) === normalizeId(prev));
                return exists ? prev : normalizeId(accounts[0].id);
            });
        } else {
            setTransactionDropTargetAssetId('');
        }
    }, [accounts]);

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
            const requestId = ++scenarioListRequestRef.current;
            if (!userIdentifier) {
                if (requestId !== scenarioListRequestRef.current) return;
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
                setLoading(false);
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const userScenarios = await listScenarios();
                const decScenarios = await decryptRecords(userScenarios);
                if (requestId !== scenarioListRequestRef.current) return;
                setScenarios(decScenarios);
                setScenarioCount(decScenarios.length);
                const firstScenario = normalizeId(decScenarios[0]?.id || '');
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
                if (requestId !== scenarioListRequestRef.current) return;
                setError(err.message);
            } finally {
                if (requestId === scenarioListRequestRef.current) {
                    setLoading(false);
                }
            }
        },
        [closeTransactionModal, decryptRecords]
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

    useEffect(() => {
        if (!selectedUserId) {
            return;
        }
        loadScenariosForUser(selectedUserId);
    }, [selectedUserId, loadScenariosForUser]);

    useEffect(() => {
        if (!currentScenarioId) {
            return;
        }
        fetchScenarioDetails(currentScenarioId);
    }, [currentScenarioId, fetchScenarioDetails]);

    useEffect(() => {
        if (!selectedUserId) {
            setTaxCantons([]);
            setFederalTariffs([]);
            setStateTaxRates([]);
            return;
        }
        let cancelled = false;
        const loadStaticTaxData = async () => {
            try {
                const [cantons, federal, stateRates] = await Promise.all([
                    listTaxCantons(),
                    listFederalTaxTablesPublic(),
                    listStateTaxRates(),
                ]);
                if (!cancelled) {
                    setTaxCantons(cantons || []);
                    setFederalTariffs(federal || []);
                    setStateTaxRates(stateRates || []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err.message);
                    setTaxCantons([]);
                    setFederalTariffs([]);
                    setStateTaxRates([]);
                }
            }
        };
        loadStaticTaxData();
        return () => {
            cancelled = true;
        };
    }, [selectedUserId]);

    useEffect(() => {
        if (!selectedUserId) {
            setTaxMunicipalities([]);
            setStateIncomeTariffs([]);
            setStateWealthTariffs([]);
            return;
        }
        let cancelled = false;
        const loadDynamicTaxData = async () => {
            try {
                const cantonParam = selectedTaxCanton || undefined;
                const municipalPromise = selectedTaxCanton
                    ? listMunicipalTaxEntries(selectedTaxCanton)
                    : Promise.resolve([]);
                const [municipalData, incomeTariffsData, wealthTariffsData] = await Promise.all([
                    municipalPromise,
                    listStateTaxTariffsPublic('income', cantonParam),
                    listStateTaxTariffsPublic('wealth', cantonParam),
                ]);
                if (!cancelled) {
                    setTaxMunicipalities(selectedTaxCanton ? municipalData || [] : []);
                    setStateIncomeTariffs(incomeTariffsData || []);
                    setStateWealthTariffs(wealthTariffsData || []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err.message);
                    if (selectedTaxCanton) {
                        setTaxMunicipalities([]);
                    }
                    setStateIncomeTariffs([]);
                    setStateWealthTariffs([]);
                }
            }
        };
        loadDynamicTaxData();
        return () => {
            cancelled = true;
        };
    }, [selectedTaxCanton, selectedUserId]);

    useEffect(() => {
        if (!selectedTaxCanton) {
            setSelectedMunicipalityId('');
        }
    }, [selectedTaxCanton]);

    useEffect(() => {
        if (selectedMaritalStatus !== 'verheiratet') {
            setSelectedConfessionPartner('none');
        }
    }, [selectedMaritalStatus]);

    useEffect(() => {
        if (!selectedTaxCanton) return;
        if (!taxCantons.includes(selectedTaxCanton)) {
            setSelectedTaxCanton('');
        }
    }, [taxCantons, selectedTaxCanton]);

    useEffect(() => {
        if (!selectedMunicipalityId) return;
        if (!taxMunicipalities.length) return;
        const exists = taxMunicipalities.some(
            (entry) => normalizeId(entry.id) === normalizeId(selectedMunicipalityId)
        );
        if (!exists) {
            setSelectedMunicipalityId('');
        }
    }, [taxMunicipalities, selectedMunicipalityId]);

    useEffect(() => {
        if (!selectedStateIncomeTariffId) return;
        if (!stateIncomeTariffs.length) return;
        const exists = stateIncomeTariffs.some(
            (tariff) => normalizeId(tariff.id) === normalizeId(selectedStateIncomeTariffId)
        );
        if (!exists) {
            setSelectedStateIncomeTariffId('');
        }
    }, [stateIncomeTariffs, selectedStateIncomeTariffId]);

    useEffect(() => {
        if (!selectedStateWealthTariffId) return;
        if (!stateWealthTariffs.length) return;
        const exists = stateWealthTariffs.some(
            (tariff) => normalizeId(tariff.id) === normalizeId(selectedStateWealthTariffId)
        );
        if (!exists) {
            setSelectedStateWealthTariffId('');
        }
    }, [stateWealthTariffs, selectedStateWealthTariffId]);

    useEffect(() => {
        if (!selectedMunicipality) return;
        if (selectedMunicipality.canton && selectedMunicipality.canton !== selectedTaxCanton) {
            setSelectedTaxCanton(selectedMunicipality.canton);
        }
    }, [selectedMunicipality, selectedTaxCanton]);

    const loadUserLibrary = useCallback(async () => {
        if (!selectedUserId) {
            setLibraryAssets([]);
            setLibraryTransactions([]);
            return;
        }
        setLibraryLoading(true);
        setLibraryError('');
        try {
            const assetMap = new Map();
            const txMap = new Map();
            for (const scenario of scenarios) {
                const scenarioId = normalizeId(scenario.id);
                if (!scenarioId) continue;
                const [assetsRaw, txsRaw] = await Promise.all([listAssets(scenarioId), listTransactions(scenarioId)]);
                const assets = await decryptRecords(assetsRaw);
                const txs = await decryptRecords(txsRaw);
                const assetNameMap = {};
                (assets || []).forEach((asset) => {
                    if (!asset) return;
                    assetNameMap[normalizeId(asset.id)] = asset.name || '';
                    const signature = buildAssetSignature(asset);
                    const existing = assetMap.get(signature);
                    const sourceName = scenario.name || '';
                    if (existing) {
                        const sources = new Set(existing.sourceScenarios || []);
                        if (sourceName) sources.add(sourceName);
                        assetMap.set(signature, {
                            ...existing,
                            occurrences: (existing.occurrences || 1) + 1,
                            sourceScenarios: Array.from(sources),
                        });
                    } else {
                        assetMap.set(signature, {
                            ...asset,
                            occurrences: 1,
                            sourceScenarios: sourceName ? [sourceName] : [],
                        });
                    }
                });
                (txs || []).forEach((tx) => {
                    if (!tx) return;
                    if (tx.double_entry && tx.entry === 'credit') return;
                    const signature = buildTransactionSignature(tx);
                    const sourceScenario = scenario.name || '';
                    const sourceAssetName = assetNameMap[normalizeId(tx.asset_id)] || '';
                    const existing = txMap.get(signature);
                    if (existing) {
                        const scenariosSet = new Set(existing.sourceScenarios || []);
                        if (sourceScenario) scenariosSet.add(sourceScenario);
                        const assetNamesSet = new Set(existing.sourceAssetNames || []);
                        if (sourceAssetName) assetNamesSet.add(sourceAssetName);
                        txMap.set(signature, {
                            ...existing,
                            occurrences: (existing.occurrences || 1) + 1,
                            sourceScenarios: Array.from(scenariosSet),
                            sourceAssetNames: Array.from(assetNamesSet),
                        });
                        return;
                    }
                    txMap.set(signature, {
                        ...tx,
                        occurrences: 1,
                        sourceScenarios: sourceScenario ? [sourceScenario] : [],
                        sourceAssetNames: sourceAssetName ? [sourceAssetName] : [],
                    });
                });
            }
            setLibraryAssets(Array.from(assetMap.values()));
            setLibraryTransactions(Array.from(txMap.values()));
        } catch (err) {
            setLibraryError(err.message || 'Bibliothek konnte nicht geladen werden.');
        } finally {
            setLibraryLoading(false);
        }
    }, [decryptRecords, scenarios, selectedUserId]);

    useEffect(() => {
        loadUserLibrary();
    }, [loadUserLibrary]);

    const maybePropagateAssetUpdate = useCallback(
        async (previousSignature, payload) => {
            if (!previousSignature) return;
            const matches = [];
            for (const scenario of scenarios) {
                if (normalizeId(scenario.id) === normalizeId(currentScenarioId)) continue;
                const assetsRaw = await listAssets(scenario.id);
                const assets = await decryptRecords(assetsRaw);
                (assets || []).forEach((asset) => {
                    if (buildAssetSignature(asset) === previousSignature) {
                        matches.push({ assetId: asset.id });
                    }
                });
            }
            if (!matches.length) return;
            const confirmAll = window.confirm(
                `Änderung auch in ${matches.length} weiteren Szenario(n) anwenden?`
            );
            if (!confirmAll) return;
            for (const match of matches) {
                try {
                    const { sanitized, encrypted } = await maybeEncryptRecord(payload);
                    await updateAsset(match.assetId, { ...sanitized, encrypted });
                } catch (_) {
                    // ignore individual failures
                }
            }
            loadUserLibrary().catch(() => {});
        },
        [currentScenarioId, decryptRecords, loadUserLibrary, maybeEncryptRecord, scenarios]
    );

    const maybePropagateTransactionUpdate = useCallback(
        async (previousSignature, payload) => {
            if (!previousSignature) return;
            const matches = [];
            for (const scenario of scenarios) {
                if (normalizeId(scenario.id) === normalizeId(currentScenarioId)) continue;
                const txsRaw = await listTransactions(scenario.id);
                const txs = await decryptRecords(txsRaw);
                (txs || []).forEach((tx) => {
                    if (tx.double_entry && tx.entry === 'credit') return;
                    if (buildTransactionSignature(tx) === previousSignature) {
                        matches.push(tx);
                    }
                });
            }
            if (!matches.length) return;
            const confirmAll = window.confirm(
                `Änderung auch in ${matches.length} weiteren Szenario(n) anwenden?`
            );
            if (!confirmAll) return;
            for (const tx of matches) {
                try {
                    const basePayload = {
                        ...payload,
                        asset_id: tx.asset_id,
                        counter_asset_id: tx.counter_asset_id || null,
                        mortgage_asset_id:
                            payload.type === 'mortgage_interest'
                                ? tx.mortgage_asset_id || tx.asset_id
                                : tx.mortgage_asset_id || null,
                    };
                    const { sanitized, encrypted } = await maybeEncryptRecord(basePayload);
                    await updateTransaction(tx.id, { ...sanitized, encrypted });
                } catch (_) {
                    // ignore individual failures
                }
            }
            loadUserLibrary().catch(() => {});
        },
        [currentScenarioId, decryptRecords, loadUserLibrary, maybeEncryptRecord, scenarios]
    );

    const derivedTaxSettings = useMemo(() => {
        const normalizePercent = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };
        const scenarioMunicipalFactor =
            scenarioDetails && scenarioDetails.municipal_tax_factor !== null && scenarioDetails.municipal_tax_factor !== undefined
                ? Number(scenarioDetails.municipal_tax_factor)
                : null;
        const municipalPercent =
            normalizePercent(selectedMunicipality?.base_rate) ??
            (scenarioMunicipalFactor !== null ? scenarioMunicipalFactor * 100 : null);
        const municipalFactor =
            municipalPercent !== null && municipalPercent !== undefined ? municipalPercent / 100 : 0;

        const scenarioCantonalFactor =
            scenarioDetails && scenarioDetails.cantonal_tax_factor !== null && scenarioDetails.cantonal_tax_factor !== undefined
                ? Number(scenarioDetails.cantonal_tax_factor)
                : null;
        let cantonalFactor = Number.isFinite(scenarioCantonalFactor) ? scenarioCantonalFactor : null;
        if ((cantonalFactor === null || cantonalFactor === undefined) && selectedTaxCanton) {
            const match = stateTaxRates.find((entry) => entry.canton === selectedTaxCanton);
            if (match && match.rate !== undefined && match.rate !== null) {
                const rateNum = Number(match.rate);
                cantonalFactor = Number.isFinite(rateNum) ? rateNum / 100 : null;
            }
        }
        const cantonalPercent = Number.isFinite(cantonalFactor) ? cantonalFactor * 100 : null;
        cantonalFactor = Number.isFinite(cantonalFactor) ? cantonalFactor : 0;

        const isMarried = selectedMaritalStatus === 'verheiratet';
        const confessionPercent = (conf) => {
            if (conf === 'none') return 0;
            if (!conf) return null;
            if (!selectedMunicipality) return null;
            const field = CONFESSION_FIELD_MAP[conf];
            if (field) {
                return normalizePercent(selectedMunicipality[field]);
            }
            return null;
        };
        let churchPercent = null;
        if (isMarried) {
            const pctA = confessionPercent(selectedConfession);
            const pctB = confessionPercent(selectedConfessionPartner);
            if (pctA !== null || pctB !== null) {
                churchPercent = ((pctA || 0) + (pctB || 0)) / 2;
            }
        } else {
            const pct = confessionPercent(selectedConfession);
            if (pct !== null) {
                churchPercent = pct;
            } else if (selectedConfession === 'none') {
                churchPercent = 0;
            }
        }
        if (
            churchPercent === null &&
            scenarioDetails &&
            scenarioDetails.church_tax_factor !== null &&
            scenarioDetails.church_tax_factor !== undefined
        ) {
            churchPercent = scenarioDetails.church_tax_factor * 100;
        }
        const churchFactor =
            churchPercent !== null && churchPercent !== undefined ? churchPercent / 100 : 0;

        const scenarioPersonal =
            scenarioDetails &&
            scenarioDetails.personal_tax_per_person !== null &&
            scenarioDetails.personal_tax_per_person !== undefined
                ? Number(scenarioDetails.personal_tax_per_person)
                : null;
        const householdSize = isMarried ? 2 : 1;
        const personalTax = Number.isFinite(scenarioPersonal) ? scenarioPersonal * householdSize : null;

        return {
            municipalPercent,
            municipalFactor,
            cantonalPercent,
            cantonalFactor,
            churchPercent,
            churchFactor,
            personalTax,
        };
    }, [
        selectedMunicipality,
        scenarioDetails,
        selectedConfession,
        selectedConfessionPartner,
        selectedTaxCanton,
        selectedMaritalStatus,
        stateTaxRates,
    ]);

    const fetchStressProfilesRemote = useCallback(async () => {
        try {
            const profiles = await listStressProfiles();
            setStressProfiles((profiles || []).map((profile) => normalizeStressProfile(profile)));
        } catch (err) {
            setError(err.message);
        }
    }, []);

    useEffect(() => {
        if (selectedUserId) {
            fetchStressProfilesRemote();
        } else {
            setStressProfiles([]);
        }
    }, [selectedUserId, fetchStressProfilesRemote]);

    useEffect(() => {
        const existingIds = new Set((stressProfiles || []).map((p) => normalizeId(p.id)));
        setOpenProfileIds((prev) => prev.filter((id) => existingIds.has(normalizeId(id))));
        setSelectedProfileIds((prev) => prev.filter((id) => existingIds.has(normalizeId(id))));
        setProfileResults((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((key) => {
                if (!existingIds.has(normalizeId(key))) {
                    delete next[key];
                }
            });
            return next;
        });
        setProfileSimulations((prev) => {
            const next = { ...prev };
            Object.keys(next).forEach((key) => {
                if (!existingIds.has(normalizeId(key))) {
                    delete next[key];
                }
            });
            return next;
        });
    }, [stressProfiles]);

    const handleChangePassword = async () => {
        setError(null);
        setPasswordMessage('');
        if (!currentPassword || !newPassword || !confirmNewPassword) {
            setError('Bitte alle Felder ausfüllen.');
            return;
        }
        if (newPassword !== confirmNewPassword) {
            setError('Neue Passwörter stimmen nicht überein.');
            return;
        }
        setLoading(true);
        try {
            const result = await changePassword(currentPassword, newPassword);
            if (result?.user) {
                const mergedUser = { ...selectedUser, ...result.user };
                setUsers([mergedUser]);
                setSelectedUserId(mergedUser.id);
                await loadScenariosForUser(mergedUser.id);
                setPasswordMessage('Passwort aktualisiert.');
                setCurrentPassword('');
                setNewPassword('');
                setConfirmNewPassword('');
            }
        } catch (err) {
            // Backend liefert 400 für falsches aktuelles Passwort oder Validierungsfehler.
            let message = err.message || 'Passwort konnte nicht geändert werden.';
            try {
                const parsed = JSON.parse(err.message || '');
                if (parsed?.detail) {
                    message = parsed.detail;
                } else if (Array.isArray(parsed)) {
                    message = parsed.map((entry) => entry?.msg || '').filter(Boolean).join(' | ') || message;
                }
            } catch (_) {
                // ignore parse issues
            }
            setError(message);
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
            const basePayload = {
                name: newAccountName,
                annual_growth_rate: parseFloat(newAccountGrowthRate || 0) / 100,
                initial_balance: parseFloat(newAccountInitialBalance || 0),
                asset_type: newAccountType,
            };
            const startParts = parseMonthValue(newAccountStart);
            const endParts = parseMonthValue(newAccountEnd);
            if (startParts) {
                basePayload.start_year = startParts.year;
                basePayload.start_month = startParts.month;
            }
            if (endParts) {
                basePayload.end_year = endParts.year;
                basePayload.end_month = endParts.month;
            }
            const { sanitized, encrypted } = await maybeEncryptRecord(basePayload);
            const account = await createAsset(currentScenarioId, { ...sanitized, encrypted });
            const decrypted = await maybeDecryptRecord(account);
            setAccounts((prev) => [...prev, decrypted || account]);
            setAccountTransactions((prev) => ({ ...prev, [account.id]: [] }));
            loadUserLibrary().catch(() => {});
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
        const existing = accounts.find((account) => normalizeId(account.id) === normalizeId(accountId));
        const previousSignature = existing ? buildAssetSignature(existing) : null;
        setLoading(true);
        setError(null);
        try {
            const { sanitized, encrypted } = await maybeEncryptRecord(payload);
            const updated = await updateAsset(accountId, { ...sanitized, encrypted });
            const dec = await maybeDecryptRecord(updated);
            setAccounts((prev) => prev.map((account) => (account.id === accountId ? dec || updated : account)));
            loadUserLibrary().catch(() => {});
            if (previousSignature) {
                await maybePropagateAssetUpdate(previousSignature, payload);
            }
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
            loadUserLibrary().catch(() => {});
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
            const { sanitized, encrypted } = await maybeEncryptRecord(payload);
            const transaction = await createTransaction(currentScenarioId, { ...sanitized, encrypted });
            const decTx = await maybeDecryptRecord(transaction);
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
                addTx(decTx || transaction);
                if ((decTx || transaction).linked_transaction) {
                    addTx((decTx || transaction).linked_transaction);
                }
                return updated;
            });
            loadUserLibrary().catch(() => {});
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
        const previousTx = findTransactionById(transactionId);
        const previousSignature = previousTx ? buildTransactionSignature(previousTx) : null;
        setLoading(true);
        setError(null);
        try {
            const { sanitized, encrypted } = await maybeEncryptRecord(payload);
            await updateTransaction(transactionId, { ...sanitized, encrypted });
            if (currentScenarioId) {
                await fetchScenarioDetails(currentScenarioId);
            }
            if (currentScenarioId) {
                await handleSimulate();
            }
            loadUserLibrary().catch(() => {});
            if (previousSignature) {
                await maybePropagateTransactionUpdate(previousSignature, payload);
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
            loadUserLibrary().catch(() => {});
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

    const buildAssetPayloadFromTemplate = (asset = {}) => {
        const payload = {
            name: asset.name || '',
            asset_type: asset.asset_type || 'generic',
            annual_growth_rate: Number(asset.annual_growth_rate) || 0,
            initial_balance: Number(asset.initial_balance) || 0,
        };
        if (asset.start_year) payload.start_year = asset.start_year;
        if (asset.start_month) payload.start_month = asset.start_month;
        if (asset.end_year) payload.end_year = asset.end_year;
        if (asset.end_month) payload.end_month = asset.end_month;
        return payload;
    };

    const buildTransactionPayloadFromTemplate = (tx = {}) => {
        const payload = {
            name: tx.name || '',
            amount: tx.amount || 0,
            type: tx.type || 'regular',
            entry: tx.entry,
            start_year: tx.start_year,
            start_month: tx.start_month,
            end_year: tx.end_year,
            end_month: tx.end_month,
            frequency: tx.frequency,
            annual_growth_rate: tx.annual_growth_rate,
            annual_interest_rate: tx.annual_interest_rate,
            double_entry: false,
            taxable: tx.taxable,
            taxable_amount: tx.taxable_amount,
        };
        return payload;
    };

    const copyScenarioData = async (sourceScenarioId, targetScenarioId) => {
        const [sourceAssetsRaw, sourceTransactionsRaw] = await Promise.all([listAssets(sourceScenarioId), listTransactions(sourceScenarioId)]);
        const sourceAssets = await decryptRecords(sourceAssetsRaw);
        const sourceTransactions = await decryptRecords(sourceTransactionsRaw);

        const assetIdMap = {};
        for (const asset of sourceAssets) {
            const { sanitized, encrypted } = await maybeEncryptRecord({
                name: asset.name,
                annual_growth_rate: asset.annual_growth_rate,
                initial_balance: asset.initial_balance,
                asset_type: asset.asset_type,
                start_year: asset.start_year,
                start_month: asset.start_month,
                end_year: asset.end_year,
                end_month: asset.end_month,
            });
            const newAsset = await createAsset(targetScenarioId, { ...sanitized, encrypted });
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
            const { sanitized, encrypted } = await maybeEncryptRecord({
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
                taxable: transaction.taxable,
                taxable_amount: transaction.taxable_amount,
            });
            await createTransaction(targetScenarioId, { ...sanitized, encrypted });
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
            const basePayload = {
                name: newScenarioName,
                description: newScenarioDescription || undefined,
                start_year: startYear,
                start_month: startMonth,
                end_year: endYear,
                end_month: endMonth,
                inflation_rate: inflationRate === '' ? undefined : parseFloat(inflationRate),
            };
            const { sanitized, encrypted } = await maybeEncryptRecord(basePayload);
            const scenario = await createScenario({ ...sanitized, encrypted });
            const decScenario = await maybeDecryptRecord(scenario);

            if (cloneScenarioId) {
                await copyScenarioData(cloneScenarioId, scenario.id);
            }

            const toStore = decScenario || scenario;
            setScenarios((prev) => [...prev, toStore]);
            setCurrentScenarioId(normalizeId(toStore.id));
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
            loadUserLibrary().catch(() => {});
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

    const buildStressPayload = useCallback((overridesSource = stressOverrides) => {
        const buildList = (items, assetType) =>
            (items || [])
                .filter((shock) => (assetType ? shock.assetType === assetType : true))
                .map((shock) => {
                    const pct = parsePercentInput(shock.delta);
                    const start = parseMonthInput(shock.start);
                    const end = parseMonthInput(shock.end);
                    return {
                        pct: pct === null ? undefined : pct,
                        start_year: start?.year,
                        start_month: start?.month,
                        end_year: end?.year,
                        end_month: end?.month,
                    };
                })
                .filter((entry) => entry.pct !== undefined);

        const portfolioShocks = buildList(overridesSource.shocks, 'portfolio');
        const realEstateShocks = buildList(overridesSource.shocks, 'real_estate');
        const mortgageRateShocks = buildList(overridesSource.shocks, 'mortgage_interest');
        const incomeTaxShocks = buildList(overridesSource.shocks, 'income_tax');
        const inflationShocks = buildList(overridesSource.shocks, 'inflation');

        return {
            ...(portfolioShocks.length ? { portfolio_shocks: portfolioShocks } : {}),
            ...(realEstateShocks.length ? { real_estate_shocks: realEstateShocks } : {}),
            ...(mortgageRateShocks.length ? { mortgage_rate_shocks: mortgageRateShocks } : {}),
            ...(incomeTaxShocks.length ? { income_tax_shocks: incomeTaxShocks } : {}),
            ...(inflationShocks.length ? { inflation_shocks: inflationShocks } : {}),
        };
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

    const buildScenarioSettingsPayload = useCallback(
        () => ({
            description: scenarioDescription || null,
            inflation_rate: inflationRate === '' ? null : parseFloat(inflationRate),
            tax_account_id: taxAccountId || null,
            tax_canton: selectedTaxCanton || null,
            tax_municipality_id: selectedMunicipalityId || null,
            tax_state_income_tariff_id: selectedStateIncomeTariffId || null,
            tax_state_wealth_tariff_id: selectedStateWealthTariffId || null,
            tax_federal_tariff_id: selectedFederalTariffId || null,
            tax_confession: selectedConfession || null,
            tax_confession_partner:
                selectedMaritalStatus === 'verheiratet' ? selectedConfessionPartner || null : null,
            tax_marital_status: selectedMaritalStatus || null,
            num_children: selectedMaritalStatus === 'verheiratet' && numChildren !== '' ? Number(numChildren) : null,
        }),
        [
            scenarioDescription,
            inflationRate,
            taxAccountId,
            selectedTaxCanton,
            selectedMunicipalityId,
            selectedStateIncomeTariffId,
            selectedStateWealthTariffId,
            selectedFederalTariffId,
            selectedConfession,
            selectedConfessionPartner,
            selectedMaritalStatus,
            numChildren,
        ]
    );

    const taxSettingsDirty = useMemo(() => {
        if (!scenarioDetails) return false;
        const payload = buildScenarioSettingsPayload();
        const normalizeValue = (value) => {
            if (value === undefined || value === null || value === '') {
                return null;
            }
            if (typeof value === 'number') {
                return Number(value);
            }
            return String(value);
        };
        const scenarioMap = {
            description: scenarioDetails.description || null,
            inflation_rate:
                scenarioDetails.inflation_rate === null || scenarioDetails.inflation_rate === undefined
                    ? null
                    : Number(scenarioDetails.inflation_rate),
            tax_account_id: scenarioDetails.tax_account_id || null,
            tax_canton: scenarioDetails.tax_canton || null,
            tax_municipality_id: scenarioDetails.tax_municipality_id || null,
            tax_state_income_tariff_id: scenarioDetails.tax_state_income_tariff_id || null,
            tax_state_wealth_tariff_id: scenarioDetails.tax_state_wealth_tariff_id || null,
            tax_federal_tariff_id: scenarioDetails.tax_federal_tariff_id || null,
            tax_confession: scenarioDetails.tax_confession || null,
            tax_confession_partner: scenarioDetails.tax_confession_partner || null,
            tax_marital_status: scenarioDetails.tax_marital_status || null,
        };
        return Object.entries(payload).some(([key, value]) => normalizeValue(value) !== normalizeValue(scenarioMap[key]));
    }, [scenarioDetails, buildScenarioSettingsPayload]);

    const saveScenarioSettings = useCallback(async () => {
        if (!currentScenarioId) {
            throw new Error('Kein Szenario ausgewählt.');
        }
        if (!taxSettingsDirty) {
            return scenarioDetails;
        }
        const payload = buildScenarioSettingsPayload();
        const { sanitized, encrypted } = await maybeEncryptRecord(payload);
        const updated = await updateScenario(currentScenarioId, { ...sanitized, encrypted });
        setScenarioDetails(updated);
        setSimulationCache((prev) => {
            const next = { ...prev };
            delete next[cacheKey(selectedUserId, normalizeId(currentScenarioId))];
            return next;
        });
        return updated;
    }, [currentScenarioId, taxSettingsDirty, buildScenarioSettingsPayload, selectedUserId, scenarioDetails, setSimulationCache, maybeEncryptRecord]);

    const handleRenameScenario = useCallback(async () => {
        const name = scenarioNameEdit.trim();
        if (!currentScenarioId) {
            setError('Bitte zuerst ein Szenario auswählen.');
            return;
        }
        if (!name) {
            setError('Name darf nicht leer sein.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { sanitized, encrypted } = await maybeEncryptRecord({ name });
            const updated = await updateScenario(currentScenarioId, { ...sanitized, encrypted });
            setScenarioDetails((prev) => ({ ...(prev || {}), ...(updated || {}), name }));
            setScenarios((prev) =>
                prev.map((s) => (normalizeId(s.id) === normalizeId(currentScenarioId) ? { ...s, name } : s))
            );
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [currentScenarioId, scenarioNameEdit, maybeEncryptRecord, setError]);

    const runSimulation = useCallback(
        async (scenarioId) => {
            const scenarioKey = normalizeId(scenarioId);
            if (!scenarioKey) {
                throw new Error('Kein Szenario ausgewählt.');
            }
            setRebaseTarget(null);
            setIsRebaseModalOpen(false);
            setChartActionTarget(null);
            setIsChartActionModalOpen(false);
            const result = await simulateScenario(scenarioKey);
            setSimulationCache((prev) => ({ ...prev, [cacheKey(selectedUserId, scenarioKey)]: result }));
            setCashFlows(result.cash_flows || []);
            if (!selectedScenarios.includes(scenarioKey)) {
                setSelectedScenarios((prev) => [...prev, scenarioKey]);
            }
            const labels = result.total_wealth.map((point) => point.date);
            setChartRange({ start: 0, end: labels.length ? labels.length - 1 : null });
            const cashflowYears = Array.from(
                new Set((result.cash_flows || []).map((entry) => new Date(entry.date).getFullYear()))
            ).sort((a, b) => a - b);
            setCashflowRange({ start: 0, end: cashflowYears.length ? cashflowYears.length - 1 : null });
            return result;
        },
        [selectedUserId, selectedScenarios]
    );

    const handleSimulate = useCallback(
        async (scenarioIdOverride) => {
            const scenarioKey = normalizeId(scenarioIdOverride || currentScenarioId);
            if (!scenarioKey) {
                setError('Bitte zuerst ein Szenario auswählen.');
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const updatedScenario = taxSettingsDirty ? await saveScenarioSettings() : scenarioDetails;
                const targetScenarioId = normalizeId(scenarioIdOverride || updatedScenario?.id || scenarioKey);
                if (!targetScenarioId) {
                    throw new Error('Bitte zuerst ein Szenario auswählen.');
                }
                await runSimulation(targetScenarioId);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        [currentScenarioId, taxSettingsDirty, saveScenarioSettings, scenarioDetails, runSimulation]
    );

    const handleUpdateScenarioSettings = useCallback(async () => {
        if (!currentScenarioId) {
            setError('Kein Szenario ausgewählt.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const updated = await saveScenarioSettings();
            const targetScenarioId = normalizeId(updated?.id || currentScenarioId);
            await runSimulation(targetScenarioId);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [currentScenarioId, saveScenarioSettings, runSimulation]);

    const handleImportAssetFromLibrary = useCallback(
        async (assetTemplate) => {
            if (!currentScenarioId) {
                setError('Bitte zuerst ein Szenario auswählen.');
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const basePayload = buildAssetPayloadFromTemplate(assetTemplate);
                const { sanitized, encrypted } = await maybeEncryptRecord(basePayload);
                const asset = await createAsset(currentScenarioId, { ...sanitized, encrypted });
                const decrypted = await maybeDecryptRecord(asset);
                const finalAsset = decrypted || asset;
                setAccounts((prev) => [...prev, finalAsset]);
                setAccountTransactions((prev) => ({ ...prev, [finalAsset.id]: [] }));
                await handleSimulate();
                loadUserLibrary().catch(() => {});
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        [currentScenarioId, handleSimulate, loadUserLibrary, maybeDecryptRecord, maybeEncryptRecord]
    );

    const handleImportTransactionFromLibrary = useCallback(
        async (txTemplate) => {
            if (!currentScenarioId) {
                setError('Bitte zuerst ein Szenario auswählen.');
                return;
            }
            const targetAssetId =
                transactionDropTargetAssetId || (accounts.length ? normalizeId(accounts[0].id) : '');
            if (!targetAssetId) {
                setError('Bitte zuerst ein Ziel-Asset im aktuellen Szenario anlegen.');
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const basePayload = {
                    ...buildTransactionPayloadFromTemplate(txTemplate),
                    asset_id: targetAssetId,
                    counter_asset_id: null,
                    mortgage_asset_id:
                        txTemplate.type === 'mortgage_interest'
                            ? txTemplate.mortgage_asset_id || targetAssetId
                            : null,
                };
                const { sanitized, encrypted } = await maybeEncryptRecord(basePayload);
                const transaction = await createTransaction(currentScenarioId, { ...sanitized, encrypted });
                const decTx = await maybeDecryptRecord(transaction);
                const finalTx = decTx || transaction;
                setAccountTransactions((prev) => {
                    const updated = { ...prev };
                    const existing = updated[targetAssetId] || [];
                    updated[targetAssetId] = [...existing, finalTx];
                    return updated;
                });
                await handleSimulate();
                loadUserLibrary().catch(() => {});
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        [
            accounts,
            currentScenarioId,
            handleSimulate,
            loadUserLibrary,
            maybeDecryptRecord,
            maybeEncryptRecord,
            transactionDropTargetAssetId,
        ]
    );

    const handleLibraryDragStart = (item, kind) => (event) => {
        try {
            event.dataTransfer.setData('application/json', JSON.stringify({ kind, item }));
            event.dataTransfer.effectAllowed = 'copy';
        } catch (_) {
            // ignore drag errors
        }
    };

    const handleLibraryDrop = useCallback(
        (event, kind) => {
            event.preventDefault();
            let data = null;
            try {
                const raw = event.dataTransfer.getData('application/json');
                data = raw ? JSON.parse(raw) : null;
            } catch (_) {
                data = null;
            }
            const item = data?.item || data?.payload || data;
            if (!item) return;
            if (data?.kind !== kind) return;
            if (kind === 'asset') {
                handleImportAssetFromLibrary(item);
            } else if (kind === 'transaction') {
                handleImportTransactionFromLibrary(item);
            }
        },
        [handleImportAssetFromLibrary, handleImportTransactionFromLibrary]
    );

    const allowLibraryDrop = (event) => {
        event.preventDefault();
        if (event?.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    };

    const renderLibrarySidebar = (options = {}) => {
        const { showAssets = true, showTransactions = true, compactTransactions = false } = options;
        return (
            <aside className="library-sidebar">
                <div className="library-sidebar-header">
                    <div>
                        <p className="eyebrow">Bibliothek</p>
                        <h4>Wiederverwendbar</h4>
                    </div>
                    <button type="button" className="secondary small" onClick={() => loadUserLibrary()} disabled={libraryLoading}>
                        {libraryLoading ? 'Aktualisiere …' : 'Aktualisieren'}
                    </button>
                </div>
                {libraryError && <div className="error">{libraryError}</div>}
                {showAssets && (
                    <div className="library-section">
                        <p className="eyebrow">Assets & Liabilities</p>
                        {libraryLoading ? (
                            <p className="muted small">Lade Bibliothek …</p>
                        ) : libraryAssets.length === 0 ? (
                            <p className="placeholder">Noch keine Assets/Liabilities erfasst.</p>
                        ) : (
                            <div className="library-list">
                                {libraryAssets.map((asset) => (
                                    <div
                                        key={`library-asset-${buildAssetSignature(asset)}`}
                                        className="pill clickable library-pill"
                                        draggable
                                        onDragStart={handleLibraryDragStart(buildAssetPayloadFromTemplate(asset), 'asset')}
                                    >
                                        <div>
                                            <strong>{asset.name || 'Ohne Namen'}</strong>
                                            <div className="muted small">
                                                {(asset.asset_type || 'Asset').toUpperCase()} · {formatCurrency(asset.initial_balance || 0)}
                                            </div>
                                        </div>
                                        {(asset.sourceScenarios?.length || 0) > 0 && (
                                            <span className="muted small">
                                                aus {asset.sourceScenarios[0]}
                                                {(asset.occurrences || 1) > 1
                                                    ? ` (+${(asset.occurrences || 1) - 1} weitere)`
                                                    : ''}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="library-dropzone" onDragOver={allowLibraryDrop} onDrop={(e) => handleLibraryDrop(e, 'asset')}>
                            <strong>Asset/Liability hier ablegen</strong>
                            <div className="muted small">Erstellt eine Kopie im aktuellen Szenario.</div>
                        </div>
                    </div>
                )}
                {showTransactions && (
                    <div className="library-section">
                        <div className="library-section-header">
                            <p className="eyebrow">Einnahmen & Ausgaben</p>
                            <div className="stacked tight">
                                <span className="muted small">Ziel-Asset</span>
                                <select
                                    value={transactionDropTargetAssetId}
                                    onChange={(e) => setTransactionDropTargetAssetId(e.target.value)}
                                    disabled={!accounts.length}
                                >
                                    {!accounts.length && <option value="">Kein Asset vorhanden</option>}
                                    {accounts.map((asset) => (
                                        <option key={`drop-target-${asset.id}`} value={asset.id}>
                                            {asset.name || asset.id}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {libraryLoading ? (
                            <p className="muted small">Lade Bibliothek …</p>
                        ) : libraryTransactions.length === 0 ? (
                            <p className="placeholder">Noch keine Transaktionen erfasst.</p>
                        ) : (
                            <div className={`library-list ${compactTransactions ? 'compact' : ''}`}>
                                {libraryTransactions.map((tx) => {
                                    const category = categorizeTransaction(tx);
                                    const amountLabel = formatCurrency(tx.amount || 0);
                                    const sourceScenario =
                                        (tx.sourceScenarios && tx.sourceScenarios[0]) || tx.sourceScenario || '';
                                    const sourceAsset =
                                        (tx.sourceAssetNames && tx.sourceAssetNames[0]) || tx.sourceAssetName || '';
                                    return (
                                        <div
                                            key={`library-tx-${buildTransactionSignature(tx)}`}
                                            className="pill clickable library-pill"
                                            draggable
                                            onDragStart={handleLibraryDragStart(buildTransactionPayloadFromTemplate(tx), 'transaction')}
                                        >
                                            <div>
                                                <strong>{tx.name || 'Transaktion'}</strong>
                                                <div className="muted small">
                                                    {category === 'expense' ? 'Ausgabe' : 'Einnahme'} · {amountLabel}
                                                    {sourceAsset ? ` · ${sourceAsset}` : ''}
                                                </div>
                                            </div>
                                            {sourceScenario && <span className="muted small">aus {sourceScenario}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div
                            className="library-dropzone"
                            onDragOver={allowLibraryDrop}
                            onDrop={(e) => handleLibraryDrop(e, 'transaction')}
                        >
                            <strong>Transaktion hier ablegen</strong>
                            <div className="muted small">Wird als Kopie im gewählten Asset angelegt.</div>
                        </div>
                    </div>
                )}
            </aside>
        );
    };


    const autoSimAttemptRef = useRef({});

    // Auto-simulate once when a scenario becomes active (incl. after login).
    // If it fails (e.g., missing data), do not keep retrying until the user makes a new change.
    useEffect(() => {
        if (!currentScenarioId) return;
        const key = cacheKey(selectedUserId, currentScenarioId);
        if (simulationCache[key]) return;
        if (autoSimAttemptRef.current[key]) return;
        autoSimAttemptRef.current[key] = true;
        handleSimulate(currentScenarioId);
    }, [currentScenarioId, selectedUserId, simulationCache, handleSimulate]);

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

    const handleConfirmRebase = useCallback(async () => {
        if (!rebaseTarget) {
            setRebaseError('Keine Auswahl vorhanden.');
            return;
        }
        const parsedValue = parseNumericInput(rebaseValue);
        if (!Number.isFinite(parsedValue)) {
            setRebaseError('Bitte einen gültigen Betrag eingeben.');
            return;
        }
        const original = Number(rebaseTarget.value) || 0;
        const delta = parsedValue - original;
        if (Math.abs(delta) < 0.01) {
            closeRebaseModal();
            return;
        }
        const assetId = rebaseAssetId || rebaseTarget.asset?.id || accounts[0]?.id || '';
        if (!assetId) {
            setRebaseError('Bitte zuerst ein Asset auswählen.');
            return;
        }
        const dateParts = parseIsoLabel(rebaseTarget.date);
        if (!dateParts) {
            setRebaseError('Datum konnte nicht ermittelt werden.');
            return;
        }
        setRebaseLoading(true);
        setRebaseError('');
        try {
            await createTransaction(currentScenarioId, {
                asset_id: assetId,
                name: `Manuelle Anpassung ${formatIsoLabel(rebaseTarget.date)}`,
                amount: delta,
                type: 'one_time',
                start_year: dateParts.year,
                start_month: dateParts.month,
                end_year: dateParts.year,
                end_month: dateParts.month,
                frequency: null,
                annual_growth_rate: 0,
                correction: true,
            });
            await fetchScenarioDetails(currentScenarioId);
            await handleSimulate(currentScenarioId);
            closeRebaseModal();
        } catch (err) {
            setRebaseError(err.message);
        } finally {
            setRebaseLoading(false);
        }
    }, [
        accounts,
        closeRebaseModal,
        currentScenarioId,
        fetchScenarioDetails,
        handleSimulate,
        rebaseAssetId,
        rebaseTarget,
        rebaseValue,
    ]);

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

    const handleChartClick = useCallback(
        (event) => {
            if (!chartRef.current || !event?.nativeEvent) return;

            const { current } = chartRef;
            const pointElements = current.getElementsAtEventForMode(
                event.nativeEvent,
                'nearest',
                { intersect: true },
                true
            );
            if (!pointElements || pointElements.length === 0) {
                return;
            }

            const point = pointElements[0];
            const datasetIndex = point.datasetIndex;
            const dataIndex = point.index;
            const dataset = current.data.datasets?.[datasetIndex];
            if (!dataset) {
                return;
            }

            const datasetStack = dataset.stack || '';
            if (datasetStack === 'compare') {
                return;
            }

            const label = current.data.labels?.[dataIndex];
            const rawValue = dataset.data?.[dataIndex];
            const value = Number(rawValue);
            if (!label || !Number.isFinite(value)) {
                return;
            }

            const accountName = dataset.label;
            const assetMatch =
                datasetStack === 'assets' && accountName
                    ? accounts.find((acc) => acc.name === accountName) || null
                    : null;
            const fallbackAssetId = assetMatch?.id || accounts[0]?.id || '';
            if (!fallbackAssetId) {
                setError('Bitte zuerst ein Asset erstellen, um Werte zu bearbeiten.');
                return;
            }

            const dateParts = parseIsoLabel(label);
            setChartActionTarget({
                date: label,
                value,
                datasetIndex,
                dataIndex,
                accountName,
                asset: assetMatch,
                assetId: fallbackAssetId,
                stack: datasetStack,
                dateParts,
            });
            setIsChartActionModalOpen(true);
        },
        [accounts, setError]
    );

    const handleChartActionAdjust = useCallback(() => {
        if (!chartActionTarget) return;
        const fallbackAssetId = chartActionTarget.assetId || chartActionTarget.asset?.id || accounts[0]?.id || '';
        if (!fallbackAssetId) {
            setError('Bitte zuerst ein Asset erstellen, um Werte zu bearbeiten.');
            return;
        }
        setRebaseAssetId(fallbackAssetId);
        setRebaseTarget({
            date: chartActionTarget.date,
            value: chartActionTarget.value,
            datasetIndex: chartActionTarget.datasetIndex,
            dataIndex: chartActionTarget.dataIndex,
            accountName: chartActionTarget.accountName,
            asset: chartActionTarget.asset,
            stack: chartActionTarget.stack,
        });
        setRebaseValue(String(chartActionTarget.value));
        setRebaseError('');
        setRebaseLoading(false);
        setIsChartActionModalOpen(false);
        setChartActionTarget(null);
        setIsRebaseModalOpen(true);
    }, [accounts, chartActionTarget, setError]);

    const handleChartActionCreateTransaction = useCallback(() => {
        if (!chartActionTarget) return;
        const fallbackAssetId = chartActionTarget.assetId || chartActionTarget.asset?.id || accounts[0]?.id || '';
        if (!fallbackAssetId) {
            setError('Bitte zuerst ein Asset erstellen, um eine Transaktion zu erfassen.');
            return;
        }
        const defaults = {
            asset_id: fallbackAssetId,
            start_month: chartActionTarget.dateParts?.month || '',
            start_year: chartActionTarget.dateParts?.year || '',
            type: 'one_time',
            name: chartActionTarget.accountName ? `${chartActionTarget.accountName} Buchung` : '',
        };
        const accountMatch = chartActionTarget.asset || accounts.find((acc) => acc.id === fallbackAssetId) || null;
        setIsChartActionModalOpen(false);
        setChartActionTarget(null);
        openTransactionModal(accountMatch, null, defaults);
    }, [accounts, chartActionTarget, openTransactionModal, setError]);

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
                hidden: true, // zunächst nur Total anzeigen
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
                    // use a unique stack so comparison lines overlay instead of stacking
                    stack: `compare-${scenarioId}`,
                };
            })
            .filter(Boolean);

        return { labels, datasets: [...areaDatasets, totalLine, ...comparisonDatasets], fullLabels };
    }, [currentScenarioId, selectedScenarios, simulationCache, scenarios, chartRange, selectedUserId]);

    const assetEndTotals = useMemo(() => {
        if (!assetChartData?.labels?.length) return {};
        const endLabel = assetChartData.labels[assetChartData.labels.length - 1];
        const normalizeLabel = (label) => {
            const date = new Date(label);
            return Number.isNaN(date.getTime()) ? label : date.toISOString().slice(0, 10);
        };
        const endKey = normalizeLabel(endLabel);
        const scenarioIds = new Set([normalizeId(currentScenarioId), ...selectedScenarios].filter(Boolean));
        const totals = {};
        scenarioIds.forEach((id) => {
            const sim = simulationCache[cacheKey(selectedUserId, id)];
            if (!sim?.total_wealth) return;
            const valueByDate = sim.total_wealth.reduce((acc, point) => {
                acc[normalizeLabel(point.date)] = point.value;
                return acc;
            }, {});
            if (endKey in valueByDate) {
                totals[id] = valueByDate[endKey];
            }
        });
        return totals;
    }, [assetChartData, selectedScenarios, simulationCache, selectedUserId, currentScenarioId]);

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

    const stressCashFlowData = useMemo(() => {
        const flows = stressResult?.cash_flows || [];
        return flows.map((entry) => {
            const d = new Date(entry.date);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            return {
                ...entry,
                taxes: entry.taxes || 0,
                tax_details: entry.tax_details || [],
                dateObj: end,
                dateLabel: end.toLocaleDateString('de-CH'),
                year: d.getFullYear(),
            };
        });
    }, [stressResult]);

    const stressYearlyCashFlow = useMemo(() => {
        const map = new Map();
        stressCashFlowData.forEach((entry) => {
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
    }, [stressCashFlowData]);

    const comparisonTotalChart = useMemo(() => {
        const base = currentSimulation?.total_wealth || [];
        const stress = stressResult?.total_wealth || [];
        const selectedProfileRuns = selectedProfileIds
            .map((id) => {
                const normalized = normalizeId(id);
                const profile = stressProfiles.find((p) => normalizeId(p.id) === normalized);
                const simulation = profileSimulations[id] || profileSimulations[normalized];
                if (!simulation?.total_wealth?.length) return null;
                return { profile, simulation };
            })
            .filter(Boolean);
        const profileSeries = selectedProfileRuns.flatMap((run) => run.simulation.total_wealth || []);
        const allDates = [...new Set([...base, ...stress, ...profileSeries].map((p) => new Date(p.date).toISOString()))].sort();
        if (!allDates.length) return null;
        const labels = allDates.map((iso) => new Date(iso).toLocaleDateString('de-CH'));
        const align = (series) => {
            const map = new Map(series.map((p) => [new Date(p.date).toISOString(), p.value || 0]));
            return allDates.map((iso) => map.get(iso) ?? null);
        };
        const datasets = [
            {
                label: 'Basis',
                data: align(base),
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                tension: 0.25,
                spanGaps: true,
                fill: true,
            },
        ];
        if (stress.length) {
            datasets.push({
                label: 'Stress',
                data: align(stress),
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.25,
                spanGaps: true,
                fill: false,
            });
        }
        selectedProfileRuns.forEach((run, idx) => {
            const color = colorFromIndex(idx + 2);
            datasets.push({
                label: `${run.profile?.name || 'Profil'} (Stress)`,
                data: align(run.simulation.total_wealth || []),
                borderColor: color,
                backgroundColor: `${color}1a`,
                tension: 0.25,
                spanGaps: true,
                fill: false,
            });
        });
        return { labels, datasets };
    }, [currentSimulation, stressResult, selectedProfileIds, profileSimulations, stressProfiles]);

    const usesBackendTaxes = Boolean(currentSimulation?.taxes && currentSimulation.taxes.length);

    const taxableIncomeByYear = useMemo(() => {
        const backendTaxes = currentSimulation?.taxes;
        if (Array.isArray(backendTaxes) && backendTaxes.length) {
            return backendTaxes
                .map((row) => ({
                    ...row,
                    year: row.year,
                    net: row.net ?? 0,
                    wealth: row.wealth ?? null,
                    incomeTax: row.incomeTax ?? 0,
                    wealthTax: row.wealthTax ?? 0,
                    baseTax: row.baseTax ?? 0,
                    personalTax: row.personalTax ?? 0,
                    taxTotal: row.taxTotal ?? 0,
                    federalTax: row.federalTax ?? 0,
                    totalAll: row.totalAll ?? (row.taxTotal || 0) + (row.federalTax || 0),
                }))
                .sort((a, b) => a.year - b.year);
        }
        const municipalTaxFactor = Number.isFinite(derivedTaxSettings.municipalFactor)
            ? derivedTaxSettings.municipalFactor
            : 0;
        const cantonalTaxFactor = Number.isFinite(derivedTaxSettings.cantonalFactor)
            ? derivedTaxSettings.cantonalFactor
            : 0;
        const churchTaxFactor = Number.isFinite(derivedTaxSettings.churchFactor)
            ? derivedTaxSettings.churchFactor
            : 0;
        // Personalsteuer pauschal pro Person (CHF)
        const personalTaxVal = Number.isFinite(derivedTaxSettings.personalTax)
            ? derivedTaxSettings.personalTax
            : 0;
        const householdSize = selectedUser ? 1 : 1; // adjust if user has household size

        const calcProgressive = (amount, brackets) => {
            let remaining = Math.max(0, amount || 0);
            let tax = 0;
            for (const { cap, rate } of brackets) {
                if (remaining <= 0) break;
                const slice = cap === null ? remaining : Math.min(remaining, cap);
                tax += slice * rate;
                remaining -= slice;
            }
            return tax;
        };
        const calcTariffTableTax = (amount, rows, keyMap, lastPer100Cap) => {
            const taxable = Math.max(0, amount || 0);
            if (!Array.isArray(rows) || rows.length === 0) {
                return 0;
            }
            const thresholdKey = keyMap?.threshold || 'threshold';
            const baseKey = keyMap?.base || 'base';
            const perKey = keyMap?.per100 || 'per100';
            const entries = rows
                .map((row) => {
                    const threshold =
                        Number(
                            row?.[thresholdKey] ??
                                row?.threshold ??
                                row?.income ??
                                0
                        ) || 0;
                    const base =
                        Number(
                            row?.[baseKey] ??
                                row?.base_amount ??
                                row?.base ??
                                0
                        ) || 0;
                    const per =
                        Number(
                            row?.[perKey] ??
                                row?.per_100_amount ??
                                row?.per100 ??
                                0
                        ) || 0;
                    return { threshold, base, per100: per };
                })
                .filter((entry) => Number.isFinite(entry.threshold))
                .sort((a, b) => a.threshold - b.threshold);
            if (!entries.length) {
                return 0;
            }
            if (taxable <= entries[0].threshold) {
                const entry = entries[0];
                return Math.max(0, entry.base + ((taxable - entry.threshold) / 100) * entry.per100);
            }
            for (let i = 0; i < entries.length - 1; i += 1) {
                const curr = entries[i];
                const next = entries[i + 1];
                if (taxable >= curr.threshold && taxable < next.threshold) {
                    return curr.base + ((taxable - curr.threshold) / 100) * curr.per100;
                }
            }
            const last = entries[entries.length - 1];
            const cappedPer =
                typeof lastPer100Cap === 'number' ? Math.min(last.per100, lastPer100Cap) : last.per100;
            return Math.max(0, last.base + ((taxable - last.threshold) / 100) * cappedPer);
        };

        const addEntry = (map, year, incomeAdd, expenseAdd) => {
            const entry = map.get(year) || { year, income: 0, expense: 0, net: 0 };
            entry.income += incomeAdd;
            entry.expense += expenseAdd;
            entry.net = entry.income - entry.expense;
            map.set(year, entry);
        };

        const results = new Map();
        (allTransactions || []).forEach((tx) => {
            if (!tx.taxable) return;
            const category = categorizeTransaction(tx);
            const isExpense = category === 'expense';
            const rawAmount =
                tx.taxable_amount !== undefined && tx.taxable_amount !== null
                    ? Number(tx.taxable_amount)
                    : Number(tx.amount);
            const amount = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
            if (!amount) return;

            if (tx.type === 'regular') {
                const freq = Math.max(1, tx.frequency || 1);
                let y = tx.start_year || 0;
                let m = tx.start_month || 1;
                const endY = tx.end_year || y;
                const endM = tx.end_month || m;
                const limit = 1000;
                let counter = 0;
                while (y < endY || (y === endY && m <= endM)) {
                    addEntry(results, y, isExpense ? 0 : amount, isExpense ? amount : 0);
                    m += freq;
                    while (m > 12) {
                        m -= 12;
                        y += 1;
                    }
                    counter += 1;
                    if (counter > limit) break;
                }
            } else {
                const year = tx.start_year || 0;
                addEntry(results, year, isExpense ? 0 : amount, isExpense ? amount : 0);
            }
        });

        // Vermögen: Assets - Liabilities per Jahr aus currentSimulation totals
        const wealthPerYear = new Map();
        (currentSimulation?.total_wealth || []).forEach((point) => {
            if (!point?.date || point.value === undefined || point.value === null) return;
            const year = new Date(point.date).getFullYear();
            wealthPerYear.set(year, point.value);
        });

        const sanitizeBrackets = (brackets, fallback) => {
            const base = Array.isArray(brackets) && brackets.length ? brackets : fallback;
            return (base || []).map(({ cap, rate }) => ({
                cap: cap === null || cap === undefined ? null : Number(cap),
                rate: Number(rate) || 0,
            }));
        };
        const incomeBrackets = sanitizeBrackets(activeTaxProfile?.income_brackets, []);
        const wealthBrackets = sanitizeBrackets(activeTaxProfile?.wealth_brackets, []);
        const incomeTariffRows =
            Array.isArray(activeStateIncomeTariff?.rows) && activeStateIncomeTariff.rows.length
                ? activeStateIncomeTariff.rows
                : null;
        const wealthTariffRows =
            Array.isArray(activeStateWealthTariff?.rows) && activeStateWealthTariff.rows.length
                ? activeStateWealthTariff.rows
                : null;
        const hasCustomFederal = Array.isArray(activeFederalTariff?.rows) && activeFederalTariff.rows.length;
        const fallbackFederalRows =
            Array.isArray(activeTaxProfile?.federal_table) && activeTaxProfile.federal_table.length
                ? activeTaxProfile.federal_table
                : [];
        const federalRows = hasCustomFederal ? activeFederalTariff.rows : fallbackFederalRows;
        const federalKeyMap = hasCustomFederal
            ? { threshold: 'threshold', base: 'base_amount', per100: 'per_100_amount' }
            : { threshold: 'income', base: 'base', per100: 'per100' };
        const formatRate = (value) => {
            if (Number.isFinite(value)) return value.toFixed(2);
            return '0.00';
        };

        const childrenCount = Math.max(
            0,
            Number(
                numChildren === '' || numChildren === null || numChildren === undefined
                    ? scenarioDetails?.num_children ?? 0
                    : numChildren
            ) || 0
        );
        const childDeductionPerChild = Math.max(0, Number(activeFederalTariff?.child_deduction_per_child || 0));

        return Array.from(results.values())
            .sort((a, b) => a.year - b.year)
            .map((row) => {
                const wealth = wealthPerYear.get(row.year) ?? null;
                const incomeTax = incomeTariffRows
                    ? calcTariffTableTax(row.net, incomeTariffRows, {
                          threshold: 'threshold',
                          base: 'base_amount',
                          per100: 'per_100_amount',
                      })
                    : calcProgressive(row.net, incomeBrackets);
                const wealthTax =
                    wealth !== null
                        ? wealthTariffRows
                            ? calcTariffTableTax(wealth, wealthTariffRows, {
                                  threshold: 'threshold',
                                  base: 'base_amount',
                                  per100: 'per_100_amount',
                              })
                            : calcProgressive(wealth, wealthBrackets)
                        : null;
                const baseTax = incomeTax + (wealthTax || 0); // einfache Staatssteuer
                const personalTax = personalTaxVal * householdSize;
                const totalTaxWithRate =
                    baseTax * municipalTaxFactor +
                    baseTax * cantonalTaxFactor +
                    baseTax * churchTaxFactor +
                    personalTax;
                const childDeductionTotal = childDeductionPerChild * childrenCount;
                const federalTaxable = Math.max(0, (row.net || 0) - childDeductionTotal);
                const federalTax = calcTariffTableTax(federalTaxable, federalRows, federalKeyMap, 11.5);
                return {
                    ...row,
                    wealth,
                    incomeTax,
                    wealthTax,
                    baseTax,
                    personalTax,
                    taxTotal: totalTaxWithRate,
                    federalTax,
                    totalAll: totalTaxWithRate + federalTax,
                    taxRateLabel: `${formatRate(
                        derivedTaxSettings.municipalPercent ?? municipalTaxFactor * 100
                    )}% / ${formatRate(derivedTaxSettings.cantonalPercent ?? cantonalTaxFactor * 100)}% / ${formatRate(
                        derivedTaxSettings.churchPercent ?? churchTaxFactor * 100
                    )}%`,
                };
            });
    }, [
        activeTaxProfile,
        activeStateIncomeTariff,
        activeStateWealthTariff,
        activeFederalTariff,
        allTransactions,
        categorizeTransaction,
        currentSimulation,
        selectedUser,
        derivedTaxSettings,
    ]);

    const taxableIncomeMap = useMemo(() => {
        const map = new Map();
        taxableIncomeByYear.forEach((row) => {
            map.set(row.year, row);
        });
        return map;
    }, [taxableIncomeByYear]);

    const stressTaxableIncomeMap = useMemo(() => {
        const map = new Map();
        const rows = stressResult?.taxes;
        if (Array.isArray(rows)) {
            rows.forEach((row) => {
                map.set(row.year, {
                    ...row,
                    totalAll: row.totalAll ?? (row.taxTotal || 0) + (row.federalTax || 0),
                });
            });
        }
        return map;
    }, [stressResult]);

    const getTaxPaymentForYear = useCallback(
        (year, mapOverride) => {
            const mapToUse = mapOverride || taxableIncomeMap;
            const row = mapToUse.get(year);
            if (!row) return 0;
            const total = row.totalAll ?? row.taxTotal ?? 0;
            return -Math.abs(total || 0);
        },
        [taxableIncomeMap]
    );

    const buildCashflowPerYear = useCallback((simulation) => {
        const flows = simulation?.cash_flows || [];
        const map = new Map();
        flows.forEach((entry) => {
            const year = new Date(entry.date).getFullYear();
            if (!map.has(year)) {
                map.set(year, { year, income: 0, expenses: 0, taxes: 0, net: 0 });
            }
            const agg = map.get(year);
            const taxes = entry.taxes || 0;
            const income = entry.income || 0;
            const expenses = entry.expenses || 0;
            const net = entry.net ?? income + expenses + taxes;
            agg.income += income;
            agg.expenses += expenses;
            agg.taxes += taxes;
            agg.net += net;
        });
        return Array.from(map.values()).sort((a, b) => a.year - b.year);
    }, []);

    const buildTaxMapFromSimulation = useCallback((simulation) => {
        const map = new Map();
        (simulation?.taxes || []).forEach((row) => {
            map.set(row.year, { ...row, totalAll: row.totalAll ?? (row.taxTotal || 0) + (row.federalTax || 0) });
        });
        return map;
    }, []);

    const comparisonCashflowChart = useMemo(() => {
        const buildYearlyFromSimulation = (simulation) => {
            const flows = simulation?.cash_flows || [];
            const map = new Map();
            flows.forEach((entry) => {
                const year = new Date(entry.date).getFullYear();
                if (!map.has(year)) {
                    map.set(year, { year, income: 0, expenses: 0, taxes: 0, net: 0 });
                }
                const agg = map.get(year);
                const taxes = entry.taxes || 0;
                const income = entry.income || 0;
                const expenses = entry.expenses || 0;
                const net = entry.net ?? income + expenses + taxes;
                agg.income += income;
                agg.expenses += expenses;
                agg.taxes += taxes;
                agg.net += net;
            });
            return Array.from(map.values()).sort((a, b) => a.year - b.year);
        };

        const buildTaxMap = (simulation) => {
            const map = new Map();
            (simulation?.taxes || []).forEach((row) => {
                map.set(row.year, { ...row, totalAll: row.totalAll ?? (row.taxTotal || 0) + (row.federalTax || 0) });
            });
            return map;
        };

        const selectedProfileRuns = selectedProfileIds
            .map((id) => {
                const normalized = normalizeId(id);
                const profile = stressProfiles.find((p) => normalizeId(p.id) === normalized);
                const simulation = profileSimulations[id] || profileSimulations[normalized];
                if (!simulation) return null;
                return {
                    profile,
                    simulation,
                    yearly: buildYearlyFromSimulation(simulation),
                    taxMap: buildTaxMap(simulation),
                };
            })
            .filter(Boolean);

        const years = [
            ...new Set(
                [
                    ...yearlyCashFlow,
                    ...stressYearlyCashFlow,
                    ...selectedProfileRuns.flatMap((run) => run.yearly),
                ].map((e) => e.year)
            ),
        ].sort();
        if (!years.length) return null;
        const align = (arr, taxMap, hasBackendTaxes) => {
            const map = new Map(
                arr.map((e) => {
                    const taxPayment = getTaxPaymentForYear(e.year, taxMap);
                    const baseNet = e.income + e.expenses + (e.taxes || 0);
                    const net = hasBackendTaxes ? baseNet : baseNet + taxPayment;
                    return [e.year, net];
                })
            );
            return years.map((y) => map.get(y) ?? null);
        };
        const stressUsesBackendTaxes = Boolean(stressResult?.taxes && stressResult.taxes.length);
        const datasets = [
            {
                label: 'Netto Basis',
                data: align(yearlyCashFlow, taxableIncomeMap, usesBackendTaxes),
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14,165,233,0.15)',
                tension: 0.25,
                spanGaps: true,
                fill: true,
            },
        ];
        if (stressYearlyCashFlow.length) {
            datasets.push({
                label: 'Netto Stress',
                data: align(stressYearlyCashFlow, stressTaxableIncomeMap, stressUsesBackendTaxes),
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.12)',
                tension: 0.25,
                spanGaps: true,
                fill: false,
            });
        }
        selectedProfileRuns.forEach((run, idx) => {
            const usesBackend = Boolean(run.simulation?.taxes && run.simulation.taxes.length);
            const color = colorFromIndex(idx + 2);
            datasets.push({
                label: `${run.profile?.name || 'Profil'} (Netto)`,
                data: align(run.yearly, run.taxMap, usesBackend),
                borderColor: color,
                backgroundColor: `${color}1a`,
                tension: 0.25,
                spanGaps: true,
                fill: false,
            });
        });
        return { labels: years, datasets };
    }, [
        yearlyCashFlow,
        stressYearlyCashFlow,
        getTaxPaymentForYear,
        taxableIncomeMap,
        usesBackendTaxes,
        stressTaxableIncomeMap,
        stressResult?.taxes,
        selectedProfileIds,
        profileSimulations,
        stressProfiles,
    ]);

    const baseCashflowChart = useMemo(() => {
        if (!yearlyCashFlow.length) return null;
        const labels = yearlyCashFlow.map((entry) => entry.year);
        const total = Math.max(labels.length - 1, 0);
        const endIdx = cashflowRange.end === null ? total : Math.max(0, Math.min(cashflowRange.end, total));
        const startIdx = Math.min(Math.max(cashflowRange.start, 0), endIdx);
        const labelMap = new Map(yearlyCashFlow.map((entry) => [entry.year, entry]));
        const rangeLabels = labels.slice(startIdx, endIdx + 1);
        const datasetData = rangeLabels.map((year) => {
            const entry = labelMap.get(year);
            if (!entry) return null;
            const taxPayment = getTaxPaymentForYear(year);
            const baseNet = entry.income + entry.expenses + (entry.taxes || 0);
            return usesBackendTaxes ? baseNet : baseNet + taxPayment;
        });
        const totalNet = rangeLabels.reduce((totalSum, year, idx) => {
            const value = datasetData[idx];
            return totalSum + (Number.isFinite(value) ? value : 0);
        }, 0);
        return {
            chart: {
                labels: rangeLabels,
                datasets: [
                    {
                        label: 'Netto',
                        data: datasetData,
                        borderColor: '#22d3ee',
                        backgroundColor: 'rgba(34, 211, 238, 0.2)',
                        tension: 0.25,
                        fill: true,
                        pointRadius: 0,
                    },
                ],
            },
            totals: { [normalizeId(currentScenarioId)]: totalNet },
            labels,
            range: { start: startIdx, end: endIdx },
        };
    }, [yearlyCashFlow, getTaxPaymentForYear, usesBackendTaxes, cashflowRange, currentScenarioId]);

    const cashflowScenarioChart = useMemo(() => {
        const baseKey = normalizeId(currentScenarioId);
        const series = [];
        const years = new Set();

        const addScenarioSeries = (scenarioId, simulation, color, dashed = false, fill = false) => {
            if (!simulation) return;
            const yearly = buildCashflowPerYear(simulation);
            if (!yearly.length) return;
            const taxMap = buildTaxMapFromSimulation(simulation);
            const usesBackend = Boolean(simulation?.taxes && simulation.taxes.length);
            const dataMap = new Map(
                yearly.map((e) => {
                    const taxPayment = getTaxPaymentForYear(e.year, taxMap);
                    const baseNet = e.income + e.expenses + (e.taxes || 0);
                    const net = usesBackend ? baseNet : baseNet + taxPayment;
                    years.add(e.year);
                    return [e.year, net];
                })
            );
            series.push({
                scenarioId,
                dataMap,
                color,
                dashed,
                fill,
            });
        };

        addScenarioSeries(
            baseKey,
            currentSimulation,
            '#22d3ee',
            false,
            true
        );

        selectedScenarios
            .filter((id) => normalizeId(id) !== baseKey)
            .forEach((scenarioId, idx) => {
                const sim = simulationCache[cacheKey(selectedUserId, scenarioId)];
                const color = colorFromIndex(idx + 1);
                addScenarioSeries(normalizeId(scenarioId), sim, color, true, false);
            });

        if (!years.size || series.length === 0) return null;
        const labels = Array.from(years).sort((a, b) => a - b);
        const totalIdx = Math.max(labels.length - 1, 0);
        const endIdx = cashflowRange.end === null ? totalIdx : Math.max(0, Math.min(cashflowRange.end, totalIdx));
        const startIdx = Math.min(Math.max(cashflowRange.start, 0), endIdx);
        const rangeLabels = labels.slice(startIdx, endIdx + 1);

        const datasets = series.map((s, idx) => {
            const name = scenarios.find((sc) => normalizeId(sc.id) === normalizeId(s.scenarioId))?.name || s.scenarioId;
            const baseColor = idx === 0 ? '#22d3ee' : s.color;
            return {
                label: `${name} · Netto`,
                data: rangeLabels.map((year) => s.dataMap.get(year) ?? null),
                borderColor: baseColor,
                backgroundColor: s.fill ? 'rgba(34, 211, 238, 0.2)' : `${baseColor}33`,
                tension: 0.25,
                fill: s.fill,
                spanGaps: true,
                pointRadius: 0,
                borderWidth: s.fill ? 3 : 2,
                borderDash: s.dashed ? [6, 4] : undefined,
            };
        });

        const totals = series.reduce((acc, s) => {
            const sum = rangeLabels.reduce((total, year) => {
                const value = s.dataMap.get(year);
                return total + (Number.isFinite(value) ? value : 0);
            }, 0);
            acc[normalizeId(s.scenarioId)] = sum;
            return acc;
        }, {});

        return { chart: { labels: rangeLabels, datasets }, totals, labels, range: { start: startIdx, end: endIdx } };
    }, [
        buildCashflowPerYear,
        buildTaxMapFromSimulation,
        currentScenarioId,
        currentSimulation,
        getTaxPaymentForYear,
        selectedScenarios,
        simulationCache,
        scenarios,
        selectedUserId,
        cashflowRange,
    ]);

    const cashflowBundle = useMemo(
        () => cashflowScenarioChart || baseCashflowChart,
        [cashflowScenarioChart, baseCashflowChart]
    );

    const cashflowChartData = cashflowBundle?.chart || null;
    const cashflowTotals = cashflowBundle?.totals || {};
    const cashflowLabels = cashflowBundle?.labels || [];
    const cashflowRangeMeta = cashflowBundle?.range || { start: 0, end: 0 };

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
        const cashflowRows = yearlyCashFlow.map((entry) => {
            const taxPayment = getTaxPaymentForYear(entry.year);
            const taxes = (entry.taxes || 0) + taxPayment;
            const expensesExTax = usesBackendTaxes ? (entry.expenses || 0) - taxPayment : entry.expenses || 0;
            const baseNet = entry.income + entry.expenses + (entry.taxes || 0);
            const net = usesBackendTaxes ? baseNet : baseNet + taxPayment;
            return {
                year: entry.year,
                income: entry.income || 0,
                expenses: expensesExTax,
                taxes,
                net,
            };
        });

        const cashflowTotals = cashflowRows.reduce(
            (acc, entry) => {
                acc.income += entry.income || 0;
                acc.expenses += entry.expenses || 0;
                acc.taxes += entry.taxes || 0;
                acc.net += entry.net || entry.income + entry.expenses + (entry.taxes || 0);
                return acc;
            },
            { income: 0, expenses: 0, taxes: 0, net: 0 }
        );
        const baseSummaryLocal = summarizeSimulation(currentSimulation);

        // Precompute saved profile results (stress) relative to current base
        const profileRows = [];
        if (stressProfiles && stressProfiles.length && currentScenarioId) {
            for (const profile of stressProfiles) {
                try {
                    const payload = buildStressPayload(profile.overrides);
                    const result = await simulateScenarioStress(currentScenarioId, payload);
                    const summary = summarizeSimulation(result);
                    profileRows.push([
                        profile.name || 'Profil',
                        profile.description || '–',
                        baseSummaryLocal?.endValue !== null && baseSummaryLocal?.endValue !== undefined
                            ? formatCurrency(baseSummaryLocal.endValue)
                            : '–',
                        summary?.endValue !== null && summary?.endValue !== undefined ? formatCurrency(summary.endValue) : '–',
                        summary?.endValue !== null &&
                        summary?.endValue !== undefined &&
                        baseSummaryLocal?.endValue !== null &&
                        baseSummaryLocal?.endValue !== undefined
                            ? formatCurrency(summary.endValue - baseSummaryLocal.endValue)
                            : '–',
                        summary?.net !== null && summary?.net !== undefined ? formatCurrency(summary.net) : '–',
                        summary?.net !== null &&
                        summary?.net !== undefined &&
                        baseSummaryLocal?.net !== null &&
                        baseSummaryLocal?.net !== undefined
                            ? formatCurrency(summary.net - baseSummaryLocal.net)
                            : '–',
                    ]);
                } catch (err) {
                    profileRows.push([profile.name || 'Profil', profile.description || '–', 'Fehler', '–', '–', err.message || 'Fehler']);
                }
            }
        }

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
        const formatPercentValue = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num)) return '–';
            return `${num.toFixed(2)} %`;
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
            ['Benutzer', 'Telefon', 'Szenario', 'Zeitraum', 'Assets', 'Transaktionen'],
            [
                [
                    selectedUser?.name || '–',
                    selectedUser?.phone || '–',
                    currentScenario?.name || '–',
                    formatScenarioRange(currentScenario) || '–',
                    accounts.length,
                    allTransactions.length,
                ],
            ]
        );

        addSectionTitle('Szenario-Details');
        addTable(
            [
                'Beschreibung',
                'Inflation p.a.',
                'Gemeindesteuerfuss',
                'Staatssteuerfuss',
                'Kirchensteuerfuss',
                'Personalsteuer (CHF/Person)',
            ],
            [
                [
                    currentScenario?.description || '–',
                    formatPercent(inflationRate),
                    formatPercentValue(
                        derivedTaxSettings.municipalPercent ??
                            (Number.isFinite(scenarioDetails?.municipal_tax_factor)
                                ? scenarioDetails.municipal_tax_factor * 100
                                : null)
                    ),
                    formatPercentValue(
                        derivedTaxSettings.cantonalPercent ??
                            (Number.isFinite(scenarioDetails?.cantonal_tax_factor)
                                ? scenarioDetails.cantonal_tax_factor * 100
                                : null)
                    ),
                    formatPercentValue(
                        derivedTaxSettings.churchPercent ??
                            (Number.isFinite(scenarioDetails?.church_tax_factor)
                                ? scenarioDetails.church_tax_factor * 100
                                : null)
                    ),
                    Number.isFinite(derivedTaxSettings.personalTax)
                        ? formatCurrency(derivedTaxSettings.personalTax)
                        : '–',
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
                tx.type === 'mortgage_interest' ? 'Zins' : tx.type === 'regular' ? 'Regelmäßig' : 'Einmalig',
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
            cashflowRows.map((entry) => [
                entry.year,
                formatCurrency(entry.income || 0),
                formatCurrency(entry.expenses || 0),
                formatCurrency(entry.taxes || 0),
                formatCurrency(entry.net || entry.income + entry.expenses + (entry.taxes || 0)),
            ])
        );

        if (profileRows.length) {
            addSectionTitle('Gespeicherte Stress-Profile');
            addTable(
                ['Profil', 'Beschreibung', 'Endwert Basis', 'Endwert Stress', 'Δ Vermögen', 'Netto Stress', 'Δ Netto'],
                profileRows
            );
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
        inflationRate,
        derivedTaxSettings,
        usesBackendTaxes,
        getTaxPaymentForYear,
        scenarioDetails,
        handleSimulate,
        stressProfiles,
        buildStressPayload,
        summarizeSimulation,
        currentScenarioId,
    ]);

    const handleSaveProfile = useCallback(async () => {
        if (!profileName.trim()) return;
        try {
            const created = await createStressProfile({
                name: profileName.trim(),
                description: profileDescription.trim(),
                overrides: stressOverrides,
                is_public: profileIsPublic,
            });
            setStressProfiles((prev) => [...prev, normalizeStressProfile(created)]);
            setProfileName('');
            setProfileDescription('');
            setProfileIsPublic(false);
            setShowNewProfileEditor(false);
        } catch (err) {
            setError(err.message);
        }
    }, [profileIsPublic, profileDescription, profileName, stressOverrides]);

    const handleCancelNewProfile = useCallback(() => {
        setShowNewProfileEditor(false);
        setProfileName('');
        setProfileDescription('');
        setProfileIsPublic(false);
    }, [setProfileDescription, setProfileIsPublic, setProfileName, setShowNewProfileEditor]);

    const handleDeleteProfile = useCallback(async (profileId) => {
        const profile = stressProfiles.find((p) => normalizeId(p.id) === normalizeId(profileId));
        if (!profile || !isProfileOwner(profile, selectedUserId)) {
            setError('Nur eigene Profile können gelöscht werden.');
            return;
        }
        try {
            await deleteStressProfileApi(profileId);
            const normalized = normalizeId(profileId);
            setStressProfiles((prev) => prev.filter((p) => normalizeId(p.id) !== normalized));
            setOpenProfileIds((prev) => prev.filter((id) => normalizeId(id) !== normalized));
            setSelectedProfileIds((prev) => prev.filter((id) => normalizeId(id) !== normalized));
            setProfileResults((prev) => {
                const next = { ...prev };
                Object.keys(next).forEach((key) => {
                    if (normalizeId(key) === normalized) {
                        delete next[key];
                    }
                });
                return next;
            });
            setProfileSimulations((prev) => {
                const next = { ...prev };
                Object.keys(next).forEach((key) => {
                    if (normalizeId(key) === normalized) {
                        delete next[key];
                    }
                });
                return next;
            });
        } catch (err) {
            setError(err.message);
        }
    }, [selectedUserId, stressProfiles]);

    const recomputeProfileResult = useCallback(
        async (profile) => {
            if (!currentScenarioId) return;
            setProfileLoadingId(profile.id);
            try {
                const scenarioKey = normalizeId(currentScenarioId);
                const payload = buildStressPayload(profile.overrides);
                const result = await simulateScenarioStress(scenarioKey, payload);
                const summary = summarizeSimulation(result);
                setProfileResults((prev) => ({ ...prev, [profile.id]: summary }));
                setProfileSimulations((prev) => ({ ...prev, [profile.id]: result }));
            } catch (err) {
                setError(err.message);
            } finally {
                setProfileLoadingId('');
            }
        },
        [buildStressPayload, currentScenarioId, summarizeSimulation]
    );

    const handleEditProfile = useCallback((profile) => {
        if (!isProfileOwner(profile, selectedUserId)) {
            setError('Nur eigene Profile können bearbeitet werden.');
            return;
        }
        const profileKey = normalizeId(profile.id);
        setEditingProfileId(profile.id);
        setEditingProfileName(profile.name || '');
        setEditingProfileDescription(profile.description || '');
        setEditingProfileOverrides(profile.overrides || { shocks: [] });
        setEditingProfileIsPublic(Boolean(profile.is_public));
        setOpenProfileIds((prev) => (prev.some((id) => normalizeId(id) === profileKey) ? prev : [...prev, profileKey]));
        setSelectedProfileIds((prev) =>
            prev.some((id) => normalizeId(id) === profileKey) ? prev : [...prev, profileKey]
        );
    }, [selectedUserId]);

    const handleToggleProfile = useCallback(
        async (profile) => {
            const profileKey = normalizeId(profile.id);
            const isOpen = openProfileIds.some((id) => normalizeId(id) === profileKey);
            setOpenProfileIds((prev) =>
                isOpen ? prev.filter((id) => normalizeId(id) !== profileKey) : [...prev, profileKey]
            );
            setSelectedProfileIds((prev) => {
                if (isOpen) {
                    return prev.filter((id) => normalizeId(id) !== profileKey);
                }
                if (prev.some((id) => normalizeId(id) === profileKey)) {
                    return prev;
                }
                return [...prev, profileKey];
            });
            if (isOpen) return;
            await recomputeProfileResult(profile);
        },
        [openProfileIds, recomputeProfileResult]
    );

    const handleSaveProfileEdits = useCallback(async () => {
        if (!editingProfileId) return;
        const draftProfile = stressProfiles.find((p) => p.id === editingProfileId);
        if (!draftProfile || !isProfileOwner(draftProfile, selectedUserId)) {
            setError('Nur eigene Profile können bearbeitet werden.');
            setEditingProfileId('');
            setEditingProfileName('');
            setEditingProfileDescription('');
            setEditingProfileOverrides({ shocks: [] });
            setEditingProfileIsPublic(false);
            return;
        }
        let updatedProfileRef = null;
        try {
            const payload = {
                name: editingProfileName.trim() || undefined,
                description: editingProfileDescription.trim(),
                overrides: editingProfileOverrides,
                is_public: editingProfileIsPublic,
            };
            const updated = await updateStressProfile(editingProfileId, payload);
            setStressProfiles((prev) =>
                prev.map((p) => (p.id === editingProfileId ? normalizeStressProfile(updated) : p))
            );
            updatedProfileRef = updated;
        } catch (err) {
            setError(err.message);
        }
        setEditingProfileId('');
        setEditingProfileName('');
        setEditingProfileDescription('');
        setEditingProfileOverrides({ shocks: [] });
        setEditingProfileIsPublic(false);
        if (updatedProfileRef) {
            await recomputeProfileResult(updatedProfileRef);
        }
    }, [
        editingProfileDescription,
        editingProfileId,
        editingProfileIsPublic,
        editingProfileName,
        editingProfileOverrides,
        recomputeProfileResult,
        selectedUserId,
        stressProfiles,
    ]);

    const renderTransactionItem = (tx) => {
        const assetName = accountNameMap[tx.asset_id] || 'Unbekannt';
        const counterName = tx.counter_asset_id ? accountNameMap[tx.counter_asset_id] : null;
        const taxRate = 0;
        const grossAmount = Number.isFinite(tx.amount) ? tx.amount : Number(tx.amount) || 0;
        const taxableAmount = tx.taxable
            ? (Number.isFinite(tx.taxable_amount)
                  ? tx.taxable_amount
                  : Number(tx.taxable_amount) || grossAmount)
            : 0;
        const taxEffect = tx.taxable ? taxableAmount * taxRate : 0;
        const netAmount = grossAmount - taxEffect;
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
                            ? 'Interest'
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
        openScenarioSection();
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
            const { sanitized, encrypted } = await maybeEncryptRecord({
                start_year: startParts.year,
                start_month: startParts.month,
                end_year: endParts.year,
                end_month: endParts.month,
            });
            const updated = await updateScenario(currentScenarioId, { ...sanitized, encrypted });
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
                            const { sanitized: assetSanitized, encrypted: assetEncrypted } = await maybeEncryptRecord({
                                end_year: endParts.year,
                                end_month: endParts.month,
                            });
                            const refreshed = await updateAsset(account.id, {
                                ...assetSanitized,
                                encrypted: assetEncrypted,
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

    return (
        <>
            <div className="simulation">
                <div className="simulation-header">
                    <div className="market-hero simulation-hero">
                        <div className="simulation-header-row">
                            <div className="simulation-header-left">
                                <button
                                    className="user-burger"
                                    onClick={() => setIsSidebarOpen((prev) => !prev)}
                                    aria-expanded={isSidebarOpen}
                                    aria-controls="user-sidebar"
                                    title="Benutzer verwalten"
                                >
                                    ☰
                                </button>
                            </div>
                            <div className="simulation-header-actions">
                                <button onClick={openScenarioSection}>Szenario verwalten</button>
                                <button className="secondary" onClick={() => handleSimulate()} disabled={!currentScenarioId}>
                                    Simulation starten
                                </button>
                                <button className="secondary" onClick={handleDownloadPdf} disabled={!selectedUserId || !currentScenarioId}>
                                    PDF herunterladen
                                </button>
                                <button type="button" className="ghost" onClick={() => onLogout?.()}>
                                    Logout
                                </button>
                            </div>
                        </div>
                        <div className="simulation-header-expanded">
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
                            </div>
                        </div>
                    </div>
                </div>

                <div className="section-tabs">
                    {[
                        { key: 'scenarios', label: 'Szenarien' },
                        { key: 'accounts', label: `Accounts (${accounts.length})` },
                        { key: 'transactions', label: `Transaktionen (${allTransactions.length})` },
                        { key: 'cashflow', label: 'Cashflow' },
                        { key: 'totals', label: 'Assets' },
                        { key: 'risk', label: 'Risiko' },
                        { key: 'taxes', label: 'Steuern' },
                    ].map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            className={activeSection === tab.key ? 'active' : ''}
                            onClick={() => setActiveSection(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="simulation-layout">
                    <div className="simulation-main">
                        {error && (
                            <p className="error">
                                {(() => {
                                    if (typeof error === 'string') return error;
                                    if (Array.isArray(error)) {
                                        return error.map((e) => e?.msg || e?.detail || '').filter(Boolean).join(' | ');
                                    }
                                    return error?.detail || error?.message || JSON.stringify(error);
                                })()}
                            </p>
                        )}
                        {loading && <p>Loading...</p>}

                        {activeSection === 'scenarios' && (
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
                                            <span>Beschreibung</span>
                                            <textarea
                                                rows={3}
                                                placeholder="Kurzbeschreibung des Szenarios"
                                                value={newScenarioDescription}
                                                onChange={(e) => setNewScenarioDescription(e.target.value)}
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
                                        <div className="scenario-form-grid">
                                            <label className="stacked">
                                                <span>Neuer Name</span>
                                                <input
                                                    type="text"
                                                    placeholder="Szenario umbenennen"
                                                    value={scenarioNameEdit}
                                                    onChange={(e) => setScenarioNameEdit(e.target.value)}
                                                />
                                            </label>
                                            <div className="stacked">
                                                <span>&nbsp;</span>
                                                <button
                                                    type="button"
                                                    onClick={handleRenameScenario}
                                                    disabled={!currentScenarioId || !scenarioNameEdit.trim()}
                                                >
                                                    Umbenennen
                                                </button>
                                            </div>
                                        </div>

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
                                                    <span>Kanton</span>
                                                    <select
                                                        value={selectedTaxCanton}
                                                        onChange={(e) => setSelectedTaxCanton(e.target.value)}
                                                    >
                                                        <option value="">Bitte wählen</option>
                                                        {taxCantons.map((canton) => (
                                                            <option key={canton} value={canton}>
                                                                {canton}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {derivedTaxSettings.cantonalPercent !== null &&
                                                        derivedTaxSettings.cantonalPercent !== undefined && (
                                                            <small className="muted">
                                                                Staatssteuerfuss:{' '}
                                                                {Number(derivedTaxSettings.cantonalPercent || 0).toFixed(2)} %
                                                            </small>
                                                        )}
                                                </label>
                                                <label className="stacked">
                                                    <span>Gemeinde</span>
                                                    <select
                                                        value={selectedMunicipalityId}
                                                        onChange={(e) => setSelectedMunicipalityId(e.target.value)}
                                                        disabled={!selectedTaxCanton}
                                                    >
                                                        <option value="">Bitte wählen</option>
                                                        {taxMunicipalities.map((entry) => (
                                                            <option key={entry.id} value={entry.id}>
                                                                {entry.municipality}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {selectedMunicipality && (
                                                        <small className="muted">
                                                            Steuerfuss ohne Kirche:{' '}
                                                            {Number(selectedMunicipality.base_rate || 0).toFixed(2)} %
                                                        </small>
                                                    )}
                                                </label>
                                                <label className="stacked">
                                                    <span>Tarif Staatssteuer (Einkommen)</span>
                                                    <select
                                                        value={selectedStateIncomeTariffId}
                                                        onChange={(e) => setSelectedStateIncomeTariffId(e.target.value)}
                                                    >
                                                        <option value="">Bitte wählen</option>
                                                        {stateIncomeTariffs.map((tariff) => (
                                                            <option key={tariff.id} value={tariff.id}>
                                                                {tariff.name}
                                                                {tariff.canton ? ` (${tariff.canton})` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {activeStateIncomeTariff?.description && (
                                                        <small className="muted">{activeStateIncomeTariff.description}</small>
                                                    )}
                                                </label>
                                                <label className="stacked">
                                                    <span>Tarif Staatssteuer (Vermögen)</span>
                                                    <select
                                                        value={selectedStateWealthTariffId}
                                                        onChange={(e) => setSelectedStateWealthTariffId(e.target.value)}
                                                    >
                                                        <option value="">Bitte wählen</option>
                                                        {stateWealthTariffs.map((tariff) => (
                                                            <option key={tariff.id} value={tariff.id}>
                                                                {tariff.name}
                                                                {tariff.canton ? ` (${tariff.canton})` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {activeStateWealthTariff?.description && (
                                                        <small className="muted">{activeStateWealthTariff.description}</small>
                                                    )}
                                                </label>
                                                <label className="stacked">
                                                    <span>Tarif Bundessteuer</span>
                                                    <select
                                                        value={selectedFederalTariffId}
                                                        onChange={(e) => setSelectedFederalTariffId(e.target.value)}
                                                    >
                                                        <option value="">Standard</option>
                                                        {federalTariffs.map((table) => (
                                                            <option key={table.id} value={table.id}>
                                                                {table.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {activeFederalTariff?.description && (
                                                        <small className="muted">{activeFederalTariff.description}</small>
                                                    )}
                                                </label>
                                                <label className="stacked">
                                                    <span>Familienstand</span>
                                                    <select
                                                        value={selectedMaritalStatus}
                                                        onChange={(e) => setSelectedMaritalStatus(e.target.value)}
                                                    >
                                                        <option value="ledig">Ledig</option>
                                                        <option value="verheiratet">Verheiratet</option>
                                                        <option value="verwitwet">Verwitwet</option>
                                                    </select>
                                                </label>
                                                {selectedMaritalStatus === 'verheiratet' && (
                                                    <label className="stacked">
                                                        <span>Anzahl Kinder</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="1"
                                                            value={numChildren}
                                                            onChange={(e) => setNumChildren(e.target.value)}
                                                            placeholder="0"
                                                        />
                                                    </label>
                                                )}
                                                <div className="stacked">
                                                    <span>Konfession{selectedMaritalStatus === 'verheiratet' ? ' (Person 1)' : ''}</span>
                                                    <select
                                                        value={selectedConfession}
                                                        onChange={(e) => setSelectedConfession(e.target.value)}
                                                    >
                                                        <option value="none">Keine</option>
                                                        <option value="ref">Reformiert</option>
                                                        <option value="cath">Katholisch</option>
                                                        <option value="christian_cath">Christkatholisch</option>
                                                    </select>
                                                    {!selectedMunicipality && <small className="muted">Gemeinde auswählen, um Kirchentarife zu laden.</small>}
                                                </div>
                                                {selectedMaritalStatus === 'verheiratet' && (
                                                    <div className="stacked">
                                                        <span>Konfession (Person 2)</span>
                                                        <select
                                                            value={selectedConfessionPartner}
                                                            onChange={(e) => setSelectedConfessionPartner(e.target.value)}
                                                        >
                                                            <option value="none">Keine</option>
                                                            <option value="ref">Reformiert</option>
                                                            <option value="cath">Katholisch</option>
                                                            <option value="christian_cath">Christkatholisch</option>
                                                        </select>
                                                        {!selectedMunicipality && (
                                                            <small className="muted">
                                                                Gemeinde auswählen, um Kirchentarife zu laden.
                                                            </small>
                                                        )}
                                                    </div>
                                                )}
                                                <label className="stacked">
                                                    <span>Beschreibung</span>
                                                    <textarea
                                                        rows={3}
                                                        value={scenarioDescription}
                                                        onChange={(e) => setScenarioDescription(e.target.value)}
                                                    />
                                                </label>
                                                <label className="stacked">
                                                    <span>Steuerkonto (Belastung)</span>
                                                    <select
                                                        value={taxAccountId}
                                                        onChange={(e) => setTaxAccountId(e.target.value)}
                                                    >
                                                        <option value="">Bitte wählen</option>
                                                        {accounts.map((asset) => (
                                                            <option key={asset.id} value={asset.id}>
                                                                {asset.name || asset.id}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <small className="muted">
                                                        Wähle das Konto/Asset, von dem die berechneten Steuern abgebucht werden sollen.
                                                    </small>
                                                </label>
                                        </div>
                                        <button onClick={handleUpdateScenarioSettings} disabled={!currentScenarioId}>
                                            Einstellungen speichern
                                        </button>
                                    </div>
                                    </div>

                                    <div className="scenario-card scenario-library-card">
                                        <div className="scenario-card-header">
                                            <div>
                                                <p className="eyebrow">Bibliothek</p>
                                                <h4>Assets & Cashflows wiederverwenden</h4>
                                            </div>
                                            <div className="scenario-pill">
                                                <span>Quelle</span>
                                                <strong>Alle Szenarien</strong>
                                            </div>
                                        </div>
                                        <div className="scenario-actions">
                                            <div className="muted small">Per Drag & Drop ins aktive Szenario ziehen.</div>
                                            <button
                                                type="button"
                                                onClick={() => loadUserLibrary()}
                                                disabled={libraryLoading || !selectedUserId}
                                            >
                                                {libraryLoading ? 'Aktualisiere …' : 'Aktualisieren'}
                                            </button>
                                        </div>
                                        {libraryError && <div className="error">{libraryError}</div>}
                                        <div className="scenario-form-grid library-grid">
                                            <div className="stacked">
                                                <span className="eyebrow">Assets & Liabilities</span>
                                                {libraryLoading ? (
                                                    <p className="muted">Lade Bibliothek …</p>
                                                ) : libraryAssets.length === 0 ? (
                                                    <p className="placeholder">Noch keine Assets/Liabilities erfasst.</p>
                                                ) : (
                                                    <div className="library-list">
                                                        {libraryAssets.map((asset) => (
                                                            <div
                                                                key={`library-asset-${buildAssetSignature(asset)}`}
                                                                className="pill clickable library-pill"
                                                                draggable
                                                                onDragStart={handleLibraryDragStart(
                                                                    buildAssetPayloadFromTemplate(asset),
                                                                    'asset'
                                                                )}
                                                            >
                                                                <div>
                                                                    <strong>{asset.name || 'Ohne Namen'}</strong>
                                                                    <div className="muted small">
                                                                        {(asset.asset_type || 'Asset').toUpperCase()} ·{' '}
                                                                        {formatCurrency(asset.initial_balance || 0)}
                                                                    </div>
                                                                </div>
                                                                {asset.sourceScenario && (
                                                                    <span className="muted small">aus {asset.sourceScenario}</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                <div
                                                    className="library-dropzone"
                                                    onDragOver={allowLibraryDrop}
                                                    onDrop={(e) => handleLibraryDrop(e, 'asset')}
                                                    style={{
                                                        border: '1px dashed #d0d7de',
                                                        padding: '12px',
                                                        borderRadius: '8px',
                                                        background: '#f8fafc',
                                                    }}
                                                >
                                                    <strong>Asset/Liability hier ablegen</strong>
                                                    <div className="muted small">Erstellt eine Kopie im aktuellen Szenario.</div>
                                                </div>
                                            </div>
                                            <div className="stacked">
                                                <span className="eyebrow">Einnahmen & Ausgaben</span>
                                                {libraryLoading ? (
                                                    <p className="muted">Lade Bibliothek …</p>
                                                ) : libraryTransactions.length === 0 ? (
                                                    <p className="placeholder">Noch keine Transaktionen erfasst.</p>
                                                ) : (
                                                    <div className="library-list">
                                                        {libraryTransactions.map((tx) => {
                                                            const category = categorizeTransaction(tx);
                                                            const amountLabel = formatCurrency(tx.amount || 0);
                                                            const sourceScenario =
                                                                (tx.sourceScenarios && tx.sourceScenarios[0]) ||
                                                                tx.sourceScenario ||
                                                                '';
                                                            const sourceAsset =
                                                                (tx.sourceAssetNames && tx.sourceAssetNames[0]) ||
                                                                tx.sourceAssetName ||
                                                                '';
                                                            return (
                                                                <div
                                                                    key={`library-tx-${buildTransactionSignature(tx)}`}
                                                                    className="pill clickable library-pill"
                                                                    draggable
                                                                    onDragStart={handleLibraryDragStart(
                                                                        buildTransactionPayloadFromTemplate(tx),
                                                                        'transaction'
                                                                    )}
                                                                >
                                                                    <div>
                                                                        <strong>{tx.name || 'Transaktion'}</strong>
                                                                        <div className="muted small">
                                                                            {category === 'expense' ? 'Ausgabe' : 'Einnahme'} · {amountLabel}
                                                                            {sourceAsset ? ` · ${sourceAsset}` : ''}
                                                                        </div>
                                                                    </div>
                                                                    {(tx.occurrences || 1) > 1 || sourceScenario ? (
                                                                        <span className="muted small">
                                                                            {sourceScenario ? `aus ${sourceScenario}` : ''}
                                                                            {(tx.occurrences || 1) > 1
                                                                                ? `${sourceScenario ? ' ' : ''}(+${(tx.occurrences || 1) - 1} weitere)`
                                                                                : ''}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <div className="stacked">
                                                    <span className="muted small">Ziel-Asset für Drops</span>
                                                    <select
                                                        value={transactionDropTargetAssetId}
                                                        onChange={(e) => setTransactionDropTargetAssetId(e.target.value)}
                                                        disabled={!accounts.length}
                                                    >
                                                        {!accounts.length && <option value="">Kein Asset vorhanden</option>}
                                                        {accounts.map((asset) => (
                                                            <option key={`drop-target-${asset.id}`} value={asset.id}>
                                                                {asset.name || asset.id}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div
                                                    className="library-dropzone"
                                                    onDragOver={allowLibraryDrop}
                                                    onDrop={(e) => handleLibraryDrop(e, 'transaction')}
                                                    style={{
                                                        border: '1px dashed #d0d7de',
                                                        padding: '12px',
                                                        borderRadius: '8px',
                                                        background: '#f8fafc',
                                                    }}
                                                >
                                                    <strong>Transaktion hier ablegen</strong>
                                                    <div className="muted small">Wird als Kopie im gewählten Asset angelegt.</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeSection === 'accounts' && (
                            <div className="panel split-panel">
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Accounts</p>
                                        <h3>Vermögen & Schulden</h3>
                                    </div>
                                    <div className="panel-actions">
                                        <button
                                            className="secondary"
                                            type="button"
                                            onClick={() => setShowLibraryInAccounts((prev) => !prev)}
                                        >
                                            {showLibraryInAccounts ? 'Bibliothek ausblenden' : 'Bibliothek einblenden'}
                                        </button>
                                        <button onClick={openAssetModal} disabled={!currentScenarioId}>
                                            Neues Asset
                                        </button>
                                    </div>
                                </div>
                                <div className="split-layout">
                                    <div className="split-main">
                                        <div
                                            className="accounts-grid"
                                            onDragOver={allowLibraryDrop}
                                            onDrop={(e) => handleLibraryDrop(e, 'asset')}
                                        >
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
                                    {showLibraryInAccounts &&
                                        renderLibrarySidebar({ showAssets: true, showTransactions: false })}
                                </div>
                            </div>
                        )}

                        {activeSection === 'transactions' && (
                            <div className="panel split-panel">
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Transaktionen</p>
                                        <h3>Cashflows</h3>
                                    </div>
                                    <div className="panel-actions">
                                        <button
                                            className="secondary"
                                            type="button"
                                            onClick={() => setShowLibraryInTransactions((prev) => !prev)}
                                        >
                                            {showLibraryInTransactions ? 'Bibliothek ausblenden' : 'Bibliothek einblenden'}
                                        </button>
                                        <button
                                            onClick={() => openTransactionModal(null, null)}
                                            disabled={!currentScenarioId || accounts.length === 0}
                                        >
                                            Neue Transaktion
                                        </button>
                                    </div>
                                </div>
                                <div className="split-layout">
                                    <div className="split-main">
                                        <div
                                            className="panel-body"
                                            onDragOver={allowLibraryDrop}
                                            onDrop={(e) => handleLibraryDrop(e, 'transaction')}
                                        >
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
                                    </div>
                                    {showLibraryInTransactions &&
                                        renderLibrarySidebar({ showAssets: false, showTransactions: true, compactTransactions: true })}
                                </div>
                            </div>
                        )}

                        {activeSection === 'cashflow' && (
                            <div className="panel">
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Cashflow</p>
                                        <h3>Zusammenfassung</h3>
                                    </div>
                                </div>
                                <>
                                    {!cashflowChartData || !cashflowChartData.labels?.length ? (
                                        <div className="panel-body">
                                            <p className="placeholder">Noch keine Cashflows berechnet.</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="panel-body">
                                                {scenarios.length === 0 ? (
                                                    <p className="placeholder">Keine Szenarien vorhanden.</p>
                                                ) : (
                                                    <div className="scenario-comparison-grid">
                                                        {scenarios.map((scenario) => {
                                                            const scenarioKey = normalizeId(scenario.id);
                                                            const checked = selectedScenarios.includes(scenarioKey);
                                                            const rangeLabel = formatScenarioRange(scenario);
                                                            const scenarioTotal = cashflowTotals[scenarioKey];
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
                                                                        {checked && scenarioTotal !== undefined && (
                                                                            <div className="scenario-compare-meta">
                                                                                Summe Cashflow: {formatCurrency(scenarioTotal)}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {cashflowLabels.length > 0 && (
                                                    <div className="range-controls dual-range">
                                                        <label>Zeitraum</label>
                                                        <div className="range-slider">
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={Math.max(cashflowLabels.length - 1, 0)}
                                                                value={Math.min(
                                                                    cashflowRangeMeta.start,
                                                                    Math.max(cashflowLabels.length - 1, 0)
                                                                )}
                                                                onChange={(e) => {
                                                                    const total = Math.max(cashflowLabels.length - 1, 0);
                                                                    const newStart = Math.max(0, Math.min(Number(e.target.value), total));
                                                                    setCashflowRange((prev) => {
                                                                        const currentEnd =
                                                                            prev.end === null ? total : Math.max(0, Math.min(prev.end, total));
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
                                                                max={Math.max(cashflowLabels.length - 1, 0)}
                                                                value={
                                                                    cashflowRangeMeta.end === null
                                                                        ? Math.max(cashflowLabels.length - 1, 0)
                                                                        : Math.min(
                                                                              cashflowRangeMeta.end,
                                                                              Math.max(cashflowLabels.length - 1, 0)
                                                                          )
                                                                }
                                                                onChange={(e) => {
                                                                    const total = Math.max(cashflowLabels.length - 1, 0);
                                                                    const newEnd = Math.max(0, Math.min(Number(e.target.value), total));
                                                                    setCashflowRange((prev) => ({
                                                                        start: Math.min(prev.start, newEnd),
                                                                        end: Math.max(newEnd, prev.start),
                                                                    }));
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="range-labels">
                                                            <span>
                                                                {cashflowLabels[
                                                                    Math.min(
                                                                        cashflowRangeMeta.start,
                                                                        Math.max(cashflowLabels.length - 1, 0)
                                                                    )
                                                                ] || '–'}
                                                            </span>
                                                            <span>
                                                                {cashflowLabels[
                                                                    cashflowRangeMeta.end === null
                                                                        ? Math.max(cashflowLabels.length - 1, 0)
                                                                        : Math.min(
                                                                              cashflowRangeMeta.end,
                                                                              Math.max(cashflowLabels.length - 1, 0)
                                                                          )
                                                                ] || '–'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="panel-body">
                                                <div className="chart-wrapper">
                                                    <Line
                                                        data={cashflowChartData}
                                                        options={{
                                                            responsive: true,
                                                            maintainAspectRatio: false,
                                                            plugins: {
                                                                legend: { position: 'top' },
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
                                                                x: { stacked: false },
                                                                y: {
                                                                    stacked: false,
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
                                                const taxRow = taxableIncomeMap.get(yearRow.year);
                                                const taxPayment = getTaxPaymentForYear(yearRow.year);
                                                const taxTotal = (yearRow.taxes || 0) + taxPayment;
                                                const expensesExTax = usesBackendTaxes ? yearRow.expenses - taxPayment : yearRow.expenses;
                                                const baseNet = yearRow.income + yearRow.expenses + (yearRow.taxes || 0);
                                                const yearNet = usesBackendTaxes ? baseNet : baseNet + taxPayment;
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
                                                        <td>{formatCurrency(expensesExTax)}</td>
                                                        <td>
                                                            <button
                                                                className="link-button"
                                                                onClick={() => {
                                                                    setSelectedTaxYear((prev) =>
                                                                        prev === yearRow.year ? null : yearRow.year
                                                                   );
                                                                }}
                                                            >
                                                                {formatCurrency(taxTotal)}
                                                            </button>
                                                        </td>
                                                        <td>{formatCurrency(yearNet)}</td>
                                                    </tr>
                                                    {selectedTaxYear === yearRow.year && taxRow && (
                                                        <tr className="tax-detail-row">
                                                            <td></td>
                                                            <td colSpan={4}>
                                                                <div className="tax-detail-card inline">
                                                                    <div className="panel-header compact">
                                                                        <div>
                                                                            <p className="eyebrow">Steuer-Details</p>
                                                                            <h4>Jahr {yearRow.year}</h4>
                                                                        </div>
                                                                        <div className="panel-actions">
                                                                            <button
                                                                                className="secondary"
                                                                                onClick={() => setSelectedTaxYear(null)}
                                                                            >
                                                                                Schließen
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div className="tax-detail-grid">
                                                                        <div className="tax-row">
                                                                            <span>Steuerbares Einkommen</span>
                                                                            <strong>{formatCurrency(taxRow.net)}</strong>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Steuerbares Vermögen</span>
                                                                            <strong>
                                                                                {taxRow.wealth !== null && taxRow.wealth !== undefined
                                                                                    ? formatCurrency(taxRow.wealth)
                                                                                    : '–'}
                                                                            </strong>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Einkommensteuer</span>
                                                                            <span>{formatCurrency(taxRow.incomeTax)}</span>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Vermögenssteuer</span>
                                                                            <span>
                                                                                {taxRow.wealthTax !== null && taxRow.wealthTax !== undefined
                                                                                    ? formatCurrency(taxRow.wealthTax)
                                                                                    : '–'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Einfache Staatssteuer</span>
                                                                            <strong>{formatCurrency(taxRow.baseTax)}</strong>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Personalsteuer</span>
                                                                            <span>{formatCurrency(taxRow.personalTax || 0)}</span>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Staats- und Gemeindesteuern</span>
                                                                            <strong>{formatCurrency(taxRow.taxTotal)}</strong>
                                                                        </div>
                                                                        <div className="tax-row">
                                                                            <span>Direkte Bundessteuer</span>
                                                                            <span>{formatCurrency(taxRow.federalTax || 0)}</span>
                                                                        </div>
                                                                        <div className="tax-row total">
                                                                            <span>Total Steuern</span>
                                                                            <strong>
                                                                                {formatCurrency(
                                                                                    taxRow.totalAll ||
                                                                                        (taxRow.taxTotal || 0) + (taxRow.federalTax || 0)
                                                                                )}
                                                                            </strong>
                                </div>
                            </div>
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <div>
                                    <p className="eyebrow">Stresstest</p>
                                    <h3>Totals & Cashflows (Basis vs. Stress)</h3>
                                </div>
                            </div>
                            <div className="panel-body">
                                {comparisonTotalChart ? (
                                    <div className="chart-wrapper">
                                        <Line
                                            data={comparisonTotalChart}
                                            options={{
                                                responsive: true,
                                                maintainAspectRatio: false,
                                                plugins: { legend: { position: 'top' } },
                                                scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } },
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <p className="placeholder">Keine Vergleichsdaten vorhanden.</p>
                                )}
                            </div>
                            <div className="panel-body">
                                {comparisonCashflowChart ? (
                                    <div className="chart-wrapper">
                                        <Line
                                            data={comparisonCashflowChart}
                                            options={{
                                                responsive: true,
                                                maintainAspectRatio: false,
                                                plugins: { legend: { position: 'top' } },
                                                scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } },
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <p className="placeholder">Keine Cashflow-Vergleichsdaten vorhanden.</p>
                                )}
                            </div>
                        </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                                    {isExpanded &&
                                                                        yearRow.months.map((row) => {
                                                                            const isDecember = (row.dateObj.getMonth?.() ?? 0) === 11;
                                                                            const annualTaxForMonth = isDecember ? taxPayment : 0;
                                                                            const monthTax = (row.taxes || 0) + annualTaxForMonth;
                                                                            const expensesExTaxMonth =
                                                                                usesBackendTaxes && annualTaxForMonth !== 0
                                                                                    ? row.expenses - annualTaxForMonth
                                                                                    : row.expenses;
                                                                            const baseMonthNet = row.income + row.expenses + (row.taxes || 0);
                                                                            const monthNet = usesBackendTaxes ? baseMonthNet : baseMonthNet + annualTaxForMonth;
                                                                            const isTaxExpense = (item) =>
                                                                                typeof item?.name === 'string' && item.name.toLowerCase().includes('steuer');
                                                                            const expenseDetails =
                                                                                usesBackendTaxes && annualTaxForMonth !== 0
                                                                                    ? (row.expense_details || []).filter((item) => !isTaxExpense(item))
                                                                                    : row.expense_details || [];
                                                                            const taxDetailItems =
                                                                                usesBackendTaxes && annualTaxForMonth !== 0
                                                                                    ? (row.expense_details || []).filter((item) => isTaxExpense(item))
                                                                                    : row.tax_details || [];
                                                                            const canToggleTax = monthTax !== 0 || (taxDetailItems && taxDetailItems.length > 0);
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
                                                                                                {formatCurrency(expensesExTaxMonth)}
                                                                                            </button>
                                                                                        </td>
                                                                                        <td>
                                                                                            <button
                                                                                                className="link-button"
                                                                                                onClick={() => {
                                                                                                    if (!canToggleTax) return;
                                                                                                    setCashFlows((prev) =>
                                                                                                        prev.map((cf) =>
                                                                                                            cf.date === row.date
                                                                                                                ? { ...cf, showTax: !cf.showTax }
                                                                                                                : cf
                                                                                                        )
                                                                                                    );
                                                                                                }}
                                                                                            >
                                                                                                {formatCurrency(monthTax)}
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
                                                                                    {row.showExpense && expenseDetails.length > 0 && (
                                                                                        <tr className="cashflow-subrow">
                                                                                            <td></td>
                                                                                            <td colSpan={4}>
                                                                                                <ul className="cashflow-items">
                                                                                                    {expenseDetails.map((item, idx) => (
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
                                                                                    {row.showTax && (monthTax !== 0 || taxDetailItems.length > 0) && (
                                                                                        <tr className="cashflow-subrow">
                                                                                            <td></td>
                                                                                            <td colSpan={4}>
                                                                                                <ul className="cashflow-items">
                                                                                                    {taxDetailItems.length > 0 ? (
                                                                                                        taxDetailItems.map((item, idx) => (
                                                                                                            <li key={`tax-${row.date}-${idx}`}>
                                                                                                                <span>{item.name}</span>
                                                                                                                <span className="muted">{item.account}</span>
                                                                                                                <span className="amount">
                                                                                                                    {formatCurrency(item.amount)}
                                                                                                                </span>
                                                                                                            </li>
                                                                                                        ))
                                                                                                    ) : (
                                                                                                        <li>
                                                                                                            <span>Steuern (berechnet)</span>
                                                                                                            <span className="muted">Jahressteuer</span>
                                                                                                            <span className="amount">
                                                                                                                {formatCurrency(monthTax)}
                                                                                                            </span>
                                                                                                        </li>
                                                                                                    )}
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
                            </div>
                        )}

                        {activeSection === 'taxes' && (
                            <div className="panel">
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Steuern</p>
                                        <h3>Steuertabelle</h3>
                                    </div>
                                    <div className="panel-actions">
                                        <button
                                            className="secondary"
                                            onClick={() => {
                                                taxTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }}
                                        >
                                            Zur Tabelle
                                        </button>
                                    </div>
                                </div>
                                {showTaxTable && (
                                    <div className="panel-body table-wrapper" ref={taxTableRef}>
                                        {taxableIncomeByYear.length === 0 ? (
                                            <p className="placeholder">Keine Steuerdaten vorhanden. Bitte Simulation ausführen.</p>
                                        ) : (
                                            <table className="table">
                                                <thead>
                                                    <tr>
                                                        <th>Jahr</th>
                                                        <th>Einfache Steuer</th>
                                                        <th>Einkommensteuer</th>
                                                        <th>Vermögenssteuer</th>
                                                        <th>Personalsteuer</th>
                                                        <th>Direkte Bundessteuer</th>
                                                        <th>Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {taxableIncomeByYear.map((row) => (
                                                        <tr key={`tax-table-${row.year}`}>
                                                            <td>{row.year}</td>
                                                            <td>{formatCurrency(row.baseTax || 0)}</td>
                                                            <td>{formatCurrency(row.incomeTax || 0)}</td>
                                                            <td>
                                                                {row.wealthTax !== null && row.wealthTax !== undefined
                                                                    ? formatCurrency(row.wealthTax)
                                                                    : '–'}
                                                            </td>
                                                            <td>{formatCurrency(row.personalTax || 0)}</td>
                                                            <td>{formatCurrency(row.federalTax || 0)}</td>
                                                            <td>
                                                                {formatCurrency(
                                                                    (row.totalAll || (row.taxTotal || 0) + (row.federalTax || 0)) || 0
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeSection === 'totals' && (
                            <div className="panel">
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Assets</p>
                                        <h3>Asset Balances & Totals</h3>
                                    </div>
                                </div>
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
                                                                        {checked && assetEndTotals[scenarioKey] !== undefined && (
                                                                            <div className="scenario-compare-meta">
                                                                                Endwert: {formatCurrency(assetEndTotals[scenarioKey])}
                                                                            </div>
                                                                        )}
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
                                        ref={chartRef}
                                        data={assetChartData}
                                        onClick={handleChartClick}
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
                            </div>
                        )}
                    </div>
                </div>

                {activeSection === 'risk' && (
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
                            <div className="profile-list-block">
                                <div className="muted small" style={{ marginBottom: '0.5rem' }}>
                                    Profile anklicken, um sie parallel in den Stress-/Sensitivitäts-Charts zu zeigen (Mehrfachauswahl möglich).
                                </div>
                                <div className="profile-list">
                                    {(stressProfiles || []).map((p) => {
                                        const isSelected = selectedProfileIds.some(
                                            (id) => normalizeId(id) === normalizeId(p.id)
                                        );
                                        const isOwner = isProfileOwner(p, selectedUserId);
                                        const visibilityLabel = p.is_public ? 'Öffentlich' : 'Privat';
                                        return (
                                            <div className="profile-item" key={p.id}>
                                                <div className="profile-header" onClick={() => handleToggleProfile(p)}>
                                                    <div>
                                                        <strong>{p.name}</strong>
                                                        {p.description ? <div className="muted small">{p.description}</div> : null}
                                                        <div className="muted small">
                                                            {isSelected ? 'Im Chart aktiviert' : 'Zum Anzeigen in Charts anklicken'} ·{' '}
                                                            {isOwner ? 'Eigenes Profil' : 'Nur Leseberechtigung'}
                                                        </div>
                                                    </div>
                                                    <div className="profile-actions">
                                                        {isSelected ? <span className="pill success">Aktiv</span> : null}
                                                        <span className={`badge ${p.is_public ? 'success' : 'muted'}`}>
                                                            {visibilityLabel}
                                                        </span>
                                                        {isOwner && (
                                                            <>
                                                                <button
                                                                    className="secondary"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleEditProfile(p);
                                                                    }}
                                                                >
                                                                    Bearbeiten
                                                                </button>
                                                                <button
                                                                    className="secondary danger"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteProfile(p.id);
                                                                    }}
                                                                >
                                                                    Löschen
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                {openProfileIds.some((id) => normalizeId(id) === normalizeId(p.id)) && (
                                                    <div className="profile-body">
                                                        {profileLoadingId === p.id ? (
                                                            <div className="muted small">Berechne...</div>
                                                        ) : (
                                                            <div className="profile-summary">
                                                                <div>
                                                                    <span className="label">Endwert Basis</span>
                                                                    <strong>
                                                                        {baseSummary?.endValue !== null && baseSummary?.endValue !== undefined
                                                                            ? formatCurrency(baseSummary.endValue)
                                                                            : '–'}
                                                                    </strong>
                                                                </div>
                                                                <div>
                                                                    <span className="label">Endwert Stress</span>
                                                                    <strong>
                                                                        {profileResults[p.id]?.endValue !== undefined && profileResults[p.id]?.endValue !== null
                                                                            ? formatCurrency(profileResults[p.id].endValue)
                                                                            : '–'}
                                                                    </strong>
                                                                </div>
                                                                <div>
                                                                    <span className="label">Delta Vermögen</span>
                                                                    <strong>
                                                                        {profileResults[p.id]?.endValue !== undefined &&
                                                                        profileResults[p.id]?.endValue !== null &&
                                                                        baseSummary?.endValue !== undefined &&
                                                                        baseSummary?.endValue !== null
                                                                            ? formatCurrency(profileResults[p.id].endValue - baseSummary.endValue)
                                                                            : '–'}
                                                                    </strong>
                                                                </div>
                                                                <div>
                                                                    <span className="label">Netto Cashflow (Stress)</span>
                                                                    <strong>
                                                                        {profileResults[p.id]?.net !== undefined && profileResults[p.id]?.net !== null
                                                                            ? formatCurrency(profileResults[p.id].net)
                                                                            : '–'}
                                                                    </strong>
                                                                </div>
                                                                <div>
                                                                    <span className="label">Delta vs Basis</span>
                                                                    <strong>
                                                                        {profileResults[p.id]?.net !== undefined &&
                                                                        profileResults[p.id]?.net !== null &&
                                                                        baseSummary?.net !== undefined &&
                                                                        baseSummary?.net !== null
                                                                            ? formatCurrency(profileResults[p.id].net - baseSummary.net)
                                                                            : '–'}
                                                                    </strong>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {editingProfileId === p.id && (
                                                            <div className="profile-edit">
                                                                <div className="profile-form inline">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Profilname"
                                                                        value={editingProfileName}
                                                                        onChange={(e) => setEditingProfileName(e.target.value)}
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Beschreibung (optional)"
                                                                        value={editingProfileDescription}
                                                                        onChange={(e) => setEditingProfileDescription(e.target.value)}
                                                                    />
                                                                </div>
                                                                <div className="profile-visibility-toggle">
                                                                    <label style={{ display: 'flex', alignItems: 'center' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={editingProfileIsPublic}
                                                                            onChange={(e) =>
                                                                                setEditingProfileIsPublic(e.target.checked)
                                                                            }
                                                                        />
                                                                        <span style={{ marginLeft: '0.5rem' }}>
                                                                            Profil öffentlich teilen
                                                                        </span>
                                                                    </label>
                                                                    <div className="muted small">
                                                                        Öffentliche Profile sind für alle Nutzer sichtbar.
                                                                    </div>
                                                                </div>
                                                                <div className="risk-grid single">
                                                                    {(editingProfileOverrides.shocks || []).map((shock, idx) => (
                                                                        <div className="risk-row" key={shock.id}>
                                                                            <label className="stacked">
                                                                                <span>Risiko {idx + 1} Typ</span>
                                                                                <select
                                                                                    value={shock.assetType}
                                                                                    onChange={(e) =>
                                                                                        setEditingProfileOverrides((prev) => ({
                                                                                            ...prev,
                                                                                            shocks: prev.shocks.map((s) =>
                                                                                                s.id === shock.id ? { ...s, assetType: e.target.value } : s
                                                                                            ),
                                                                                        }))
                                                                                    }
                                                                                >
                                                                                    <option value="portfolio">Portfolio</option>
                                                                                    <option value="real_estate">Immobilie</option>
                                                                                    <option value="mortgage_interest">Zins</option>
                                                                                    <option value="income_tax">Einkommensteuer</option>
                                                                                    <option value="inflation">Inflation</option>
                                                                                </select>
                                                                            </label>
                                                                            <label className="stacked">
                                                                                <span>Δ (%)</span>
                                                                                <input
                                                                                    type="number"
                                                                                    step="0.1"
                                                                                    value={shock.delta}
                                                                                    onChange={(e) =>
                                                                                        setEditingProfileOverrides((prev) => ({
                                                                                            ...prev,
                                                                                            shocks: prev.shocks.map((s) =>
                                                                                                s.id === shock.id ? { ...s, delta: e.target.value } : s
                                                                                            ),
                                                                                        }))
                                                                                    }
                                                                                />
                                                                            </label>
                                                                            <label className="stacked">
                                                                                <span>Start</span>
                                                                                <input
                                                                                    type="month"
                                                                                    value={shock.start}
                                                                                    onChange={(e) =>
                                                                                        setEditingProfileOverrides((prev) => ({
                                                                                            ...prev,
                                                                                            shocks: prev.shocks.map((s) =>
                                                                                                s.id === shock.id ? { ...s, start: e.target.value } : s
                                                                                            ),
                                                                                        }))
                                                                                    }
                                                                                />
                                                                            </label>
                                                                            <label className="stacked">
                                                                                <span>Ende</span>
                                                                                <input
                                                                                    type="month"
                                                                                    value={shock.end}
                                                                                    onChange={(e) =>
                                                                                        setEditingProfileOverrides((prev) => ({
                                                                                            ...prev,
                                                                                            shocks: prev.shocks.map((s) =>
                                                                                                s.id === shock.id ? { ...s, end: e.target.value } : s
                                                                                            ),
                                                                                        }))
                                                                                    }
                                                                                />
                                                                            </label>
                                                                            <div className="risk-row-actions">
                                                                                <button
                                                                                    className="secondary danger"
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                        setEditingProfileOverrides((prev) => ({
                                                                                            ...prev,
                                                                                            shocks: (prev.shocks || []).filter((s) => s.id !== shock.id),
                                                                                        }))
                                                                                    }
                                                                                >
                                                                                    Löschen
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div className="risk-buttons">
                                                                    <button
                                                                        className="secondary"
                                                                        onClick={() =>
                                                                            setEditingProfileOverrides((prev) => ({
                                                                                ...prev,
                                                                                shocks: [
                                                                                    ...(prev.shocks || []),
                                                                                    {
                                                                                        id: `edit-${(prev.shocks || []).length + 1}-${Date.now()}`,
                                                                                        assetType: 'portfolio',
                                                                                        delta: '0',
                                                                                        start: '',
                                                                                        end: '',
                                                                                    },
                                                                                ],
                                                                            }))
                                                                        }
                                                                    >
                                                                        Neues Risiko
                                                                    </button>
                                                                    <button className="secondary" onClick={handleSaveProfileEdits}>
                                                                        Änderungen speichern
                                                                    </button>
                                                                    <button
                                                                        className="secondary danger"
                                                                        onClick={() => {
                                                                            setEditingProfileId('');
                                                                            setEditingProfileName('');
                                                                            setEditingProfileDescription('');
                                                                            setEditingProfileOverrides({ shocks: [] });
                                                                            setEditingProfileIsPublic(false);
                                                                        }}
                                                                    >
                                                                        Abbrechen
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {(!stressProfiles || stressProfiles.length === 0) && (
                                        <div className="muted small">Noch keine Profile gespeichert.</div>
                                    )}
                                </div>
                            </div>
                            {!showNewProfileEditor ? (
                                <div className="risk-new-toggle">
                                    <button className="secondary" onClick={() => setShowNewProfileEditor(true)}>
                                        Neues Profil erstellen
                                    </button>
                                </div>
                            ) : (
                            <>
                            <div className="risk-grid single">
                                {(stressOverrides.shocks || []).map((shock, idx) => (
                                    <div className="risk-row" key={shock.id}>
                                        <label className="stacked">
                                            <span>Risiko {idx + 1} Typ</span>
                                            <select
                                                value={shock.assetType}
                                                onChange={(e) =>
                                                    setStressOverrides((prev) => ({
                                                        ...prev,
                                                        shocks: prev.shocks.map((s) =>
                                                            s.id === shock.id ? { ...s, assetType: e.target.value } : s
                                                        ),
                                                    }))
                                                }
                                            >
                                                <option value="portfolio">Portfolio</option>
                                                <option value="real_estate">Immobilie</option>
                                                <option value="mortgage_interest">Zins</option>
                                                <option value="income_tax">Einkommensteuer</option>
                                                <option value="inflation">Inflation</option>
                                            </select>
                                        </label>
                                        <label className="stacked">
                                            <span>Δ (%)</span>
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={shock.delta}
                                                onChange={(e) =>
                                                    setStressOverrides((prev) => ({
                                                        ...prev,
                                                        shocks: prev.shocks.map((s) =>
                                                            s.id === shock.id ? { ...s, delta: e.target.value } : s
                                                        ),
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Start</span>
                                            <input
                                                type="month"
                                                value={shock.start}
                                                onChange={(e) =>
                                                    setStressOverrides((prev) => ({
                                                        ...prev,
                                                        shocks: prev.shocks.map((s) =>
                                                            s.id === shock.id ? { ...s, start: e.target.value } : s
                                                        ),
                                                    }))
                                                }
                                            />
                                        </label>
                                        <label className="stacked">
                                            <span>Ende</span>
                                            <input
                                                type="month"
                                                value={shock.end}
                                                onChange={(e) =>
                                                    setStressOverrides((prev) => ({
                                                        ...prev,
                                                        shocks: prev.shocks.map((s) =>
                                                            s.id === shock.id ? { ...s, end: e.target.value } : s
                                                        ),
                                                    }))
                                                }
                                            />
                                        </label>
                                        <div className="risk-row-actions">
                                            <button
                                                className="secondary danger"
                                                type="button"
                                                onClick={() =>
                                                    setStressOverrides((prev) => ({
                                                        ...prev,
                                                        shocks: (prev.shocks || []).filter((s) => s.id !== shock.id),
                                                    }))
                                                }
                                            >
                                                Löschen
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="risk-actions">
                                <div className="muted small">
                                    Angaben in % (z.B. 2 = +2 %-Punkte, -20 = -20 %-Punkte). Der Wert wird additiv zur aktuellen Wachstumsrate der gewählten Asset-Klasse angewendet.
                                </div>
                                <div className="risk-buttons">
                                    <button
                                        className="secondary"
                                        onClick={() =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                shocks: [
                                                    ...(prev.shocks || []),
                                                    {
                                                        id: `shock-${(prev.shocks || []).length + 1}-${Date.now()}`,
                                                        assetType: 'portfolio',
                                                        delta: '0',
                                                        start: '',
                                                        end: '',
                                                    },
                                                ],
                                            }))
                                        }
                                    >
                                        Neues Risiko
                                    </button>
                                    <button
                                        className="secondary danger"
                                        onClick={() =>
                                            setStressOverrides((prev) => ({
                                                ...prev,
                                                shocks: (prev.shocks || []).slice(0, -1),
                                            }))
                                        }
                                        disabled={!stressOverrides.shocks || stressOverrides.shocks.length === 0}
                                    >
                                        Letztes Risiko löschen
                                    </button>
                                    <button className="secondary" onClick={handleStressSimulate} disabled={!currentScenarioId || stressLoading}>
                                        {stressLoading ? 'Berechne...' : 'Stress simulieren'}
                                    </button>
                                </div>
                            </div>
                            <div className="risk-profiles">
                                <div className="profile-form">
                                    <input
                                        type="text"
                                        placeholder="Profilname"
                                        value={profileName}
                                        onChange={(e) => setProfileName(e.target.value)}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Beschreibung (optional)"
                                        value={profileDescription}
                                        onChange={(e) => setProfileDescription(e.target.value)}
                                    />
                                    <label style={{ display: 'flex', alignItems: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={profileIsPublic}
                                            onChange={(e) => setProfileIsPublic(e.target.checked)}
                                        />
                                        <span style={{ marginLeft: '0.5rem' }}>Profil öffentlich teilen</span>
                                    </label>
                                    <div className="muted small" style={{ marginBottom: '0.5rem' }}>
                                        Öffentliche Profile sind für alle Nutzer sichtbar, private nur für dich.
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <button className="secondary" onClick={handleSaveProfile} disabled={!profileName.trim()}>
                                            Speichern
                                        </button>
                                        <button className="secondary danger" onClick={handleCancelNewProfile}>
                                            Abbrechen
                                        </button>
                                    </div>
                                </div>
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
                            </>
                            )}
                            <div className="panel">
                                <div className="panel-header">
                                    <div>
                                        <p className="eyebrow">Vergleich</p>
                                        <h3>Basis vs. Stress</h3>
                                    </div>
                                </div>
                                <div className="panel-body">
                                    {comparisonTotalChart ? (
                                        <div className="chart-wrapper">
                                            <Line
                                                data={comparisonTotalChart}
                                                options={{
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    plugins: { legend: { position: 'top' } },
                                                    scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } },
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <p className="placeholder">Keine Vergleichsdaten vorhanden.</p>
                                    )}
                                </div>
                                <div className="panel-body">
                                    {comparisonCashflowChart ? (
                                        <div className="chart-wrapper">
                                            <Line
                                                data={comparisonCashflowChart}
                                                options={{
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    plugins: { legend: { position: 'top' } },
                                                    scales: { y: { ticks: { callback: (v) => formatCurrency(v) } } },
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <p className="placeholder">Keine Cashflow-Vergleichsdaten vorhanden.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
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
                            initialValues={transactionDraft}
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
                    <h4>Passwort ändern</h4>
                    <input
                        type="password"
                        placeholder="Aktuelles Passwort"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                    <input
                        type="password"
                        placeholder="Neues Passwort"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <input
                        type="password"
                        placeholder="Neues Passwort bestätigen"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                    />
                    <div className="user-buttons">
                        <button onClick={handleChangePassword} disabled={loading || !selectedUserId}>
                            Passwort speichern
                        </button>
                    </div>
                    {passwordMessage && <p className="muted">{passwordMessage}</p>}
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
            {isChartActionModalOpen && chartActionTarget && (
                <div className="modal-overlay" onClick={closeChartActionModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Assets</p>
                                <h3>Datenpunkt auswählen</h3>
                                <div className="muted small">
                                    {chartActionTarget.accountName || 'Total'} · {formatIsoLabel(chartActionTarget.date)}
                                </div>
                            </div>
                            <div className="modal-header-actions">
                                <button className="secondary" onClick={closeChartActionModal}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <div className="modal-grid">
                            <p style={{ gridColumn: '1 / -1' }}>
                                Was möchtest du mit diesem Wert tun?
                            </p>
                            <div className="button-row" style={{ display: 'flex', gap: '1rem' }}>
                                <button className="primary" onClick={handleChartActionAdjust}>
                                    Wert anpassen
                                </button>
                                <button className="secondary" onClick={handleChartActionCreateTransaction}>
                                    Transaktion erstellen
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {isRebaseModalOpen && rebaseTarget && (
                <div className="modal-overlay" onClick={closeRebaseModal}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <p className="eyebrow">Assets</p>
                                <h3>Wert aktualisieren</h3>
                                <div className="muted small">
                                    {rebaseTarget.accountName || 'Total'} · {formatIsoLabel(rebaseTarget.date)}
                                </div>
                            </div>
                            <div className="modal-header-actions">
                                <button className="secondary" onClick={closeRebaseModal}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <div className="modal-grid">
                            <label className="stacked">
                                <span>Asset für Anpassung</span>
                                <select value={rebaseAssetId} onChange={(e) => setRebaseAssetId(e.target.value)}>
                                    <option value="">Bitte wählen</option>
                                    {accounts.map((account) => (
                                        <option key={account.id} value={account.id}>
                                            {account.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="stacked">
                                <span>Datum</span>
                                <input type="text" value={formatIsoLabel(rebaseTarget.date)} disabled />
                            </label>
                            <label className="stacked">
                                <span>Aktueller Wert</span>
                                <input type="text" value={formatCurrency(rebaseTarget.value)} disabled />
                            </label>
                            <label className="stacked">
                                <span>Neuer Wert</span>
                                <input
                                    type="text"
                                    value={rebaseValue}
                                    onChange={(e) => setRebaseValue(e.target.value)}
                                    placeholder="z.B. 150000"
                                />
                            </label>
                        </div>
                        {Number.isFinite(rebaseDeltaPreview) && (
                            <div className="muted small" style={{ marginTop: '0.75rem' }}>
                                Delta: {formatCurrency(rebaseDeltaPreview)} · Verbucht auf{' '}
                                {selectedRebaseAsset?.name || 'gewähltes Asset'} ab {formatIsoLabel(rebaseTarget.date)}
                            </div>
                        )}
                        {rebaseError && (
                            <div className="muted small" style={{ color: '#dc2626', marginTop: '0.75rem' }}>
                                {rebaseError}
                            </div>
                        )}
                        <div className="modal-actions">
                            <button className="secondary" onClick={closeRebaseModal}>
                                Abbrechen
                            </button>
                            <button
                                className="primary"
                                onClick={handleConfirmRebase}
                                disabled={rebaseLoading || !selectedRebaseAsset}
                            >
                                {rebaseLoading ? 'Speichere...' : 'Wert übernehmen'}
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
