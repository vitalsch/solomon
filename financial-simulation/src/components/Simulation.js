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
    listTaxProfiles,
    createTaxProfile,
    listStressProfiles,
    createStressProfile,
    updateStressProfile,
    deleteStressProfileApi,
    setAuthToken,
    getAuthToken,
    importTaxProfiles,
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

// Standard-Steuerprofil als Fallback und zum initialen Befüllen der Datenbank
const DEFAULT_TAX_PROFILE = {
    name: 'Standard CH',
    description: 'Initialprofil aus den Frontend-Defaults',
    municipal_tax_factor: 1.15,
    cantonal_tax_factor: 0.98,
    church_tax_factor: 0.14,
    personal_tax_per_person: 24,
    income_brackets: [
        { cap: 6900, rate: 0 },
        { cap: 4900, rate: 0.02 },
        { cap: 4800, rate: 0.03 },
        { cap: 7900, rate: 0.04 },
        { cap: 9600, rate: 0.05 },
        { cap: 11000, rate: 0.06 },
        { cap: 12900, rate: 0.07 },
        { cap: 17400, rate: 0.08 },
        { cap: 33600, rate: 0.09 },
        { cap: 33200, rate: 0.1 },
        { cap: 52700, rate: 0.11 },
        { cap: 68400, rate: 0.12 },
        { cap: null, rate: 0.13 },
    ],
    wealth_brackets: [
        { cap: 80000, rate: 0 },
        { cap: 238000, rate: 0.0005 },
        { cap: 399000, rate: 0.001 },
        { cap: 636000, rate: 0.0015 },
        { cap: 956000, rate: 0.002 },
        { cap: 953000, rate: 0.0025 },
        { cap: null, rate: 0.003 },
    ],
    federal_table: [
        { income: 18500, base: 25.41, per100: 0.77 },
        { income: 19000, base: 29.26, per100: 0.77 },
        { income: 20000, base: 36.96, per100: 0.77 },
        { income: 21000, base: 44.66, per100: 0.77 },
        { income: 22000, base: 52.36, per100: 0.77 },
        { income: 23000, base: 60.06, per100: 0.77 },
        { income: 24000, base: 67.76, per100: 0.77 },
        { income: 25000, base: 75.46, per100: 0.77 },
        { income: 26000, base: 83.16, per100: 0.77 },
        { income: 27000, base: 90.86, per100: 0.77 },
        { income: 28000, base: 98.56, per100: 0.77 },
        { income: 29000, base: 106.26, per100: 0.77 },
        { income: 30000, base: 113.96, per100: 7.0 },
        { income: 33000, base: 137.06, per100: 33.0 },
        { income: 33200, base: 138.6, per100: 35.0 },
        { income: 33300, base: 139.48, per100: 0.88 },
        { income: 34000, base: 145.64, per100: 43.0 },
        { income: 35000, base: 154.44, per100: 53.0 },
        { income: 36000, base: 163.24, per100: 63.0 },
        { income: 37000, base: 172.04, per100: 73.0 },
        { income: 38000, base: 180.84, per100: 83.0 },
        { income: 39000, base: 189.64, per100: 93.0 },
        { income: 40000, base: 198.44, per100: 103.0 },
        { income: 41000, base: 207.24, per100: 113.0 },
        { income: 42000, base: 216.04, per100: 123.0 },
        { income: 43500, base: 229.2, per100: 138.0 },
        { income: 43600, base: 231.84, per100: 2.64 },
        { income: 44000, base: 242.4, per100: 143.0 },
        { income: 45000, base: 268.8, per100: 153.0 },
        { income: 46000, base: 295.2, per100: 163.0 },
        { income: 47000, base: 321.6, per100: 173.0 },
        { income: 48000, base: 348.0, per100: 183.0 },
        { income: 49000, base: 374.4, per100: 193.0 },
        { income: 50000, base: 400.8, per100: 203.0 },
        { income: 51000, base: 427.2, per100: 213.0 },
        { income: 53400, base: 490.56, per100: 237.0 },
        { income: 53500, base: 493.2, per100: 239.0 },
        { income: 54000, base: 506.4, per100: 249.0 },
        { income: 55000, base: 532.8, per100: 269.0 },
        { income: 56000, base: 559.2, per100: 289.0 },
        { income: 57000, base: 585.6, per100: 309.0 },
        { income: 58000, base: 612.0, per100: 329.0 },
        { income: 58100, base: 614.97, per100: 2.97 },
        { income: 59000, base: 641.7, per100: 349.0 },
        { income: 60000, base: 671.4, per100: 369.0 },
        { income: 61300, base: 710.01, per100: 395.0 },
        { income: 61400, base: 712.98, per100: 398.0 },
        { income: 65000, base: 819.9, per100: 506.0 },
        { income: 70000, base: 968.4, per100: 656.0 },
        { income: 75000, base: 1116.9, per100: 806.0 },
        { income: 76100, base: 1149.55, per100: 839.0 },
        { income: 76200, base: 1155.49, per100: 5.94 },
        { income: 77500, base: 1232.71, per100: 881.0 },
        { income: 79100, base: 1327.75, per100: 929.0 },
        { income: 79200, base: 1333.69, per100: 933.0 },
        { income: 82000, base: 1500.0, per100: 1045.0 },
        { income: 82100, base: 1506.6, per100: 6.6 },
        { income: 85000, base: 1698.0, per100: 1165.0 },
        { income: 90000, base: 2028.0, per100: 1365.0 },
        { income: 94900, base: 2351.4, per100: 1561.0 },
        { income: 95000, base: 2358.0, per100: 1566.0 },
        { income: 100000, base: 2688.0, per100: 1816.0 },
        { income: 105000, base: 3018.0, per100: 2066.0 },
        { income: 108600, base: 3255.6, per100: 2246.0 },
        { income: 108700, base: 3262.2, per100: 2252.0 },
        { income: 108800, base: 3268.8, per100: 2258.0 },
        { income: 108900, base: 3277.6, per100: 8.8 },
        { income: 110000, base: 3374.4, per100: 2330.0 },
        { income: 115000, base: 3814.4, per100: 2630.0 },
        { income: 120500, base: 4298.4, per100: 2960.0 },
        { income: 120600, base: 4307.2, per100: 2967.0 },
        { income: 125000, base: 4694.4, per100: 3275.0 },
        { income: 130000, base: 5134.4, per100: 3625.0 },
        { income: 130500, base: 5178.4, per100: 3660.0 },
        { income: 130600, base: 5187.2, per100: 3668.0 },
        { income: 135000, base: 5574.4, per100: 4020.0 },
        { income: 138300, base: 5864.8, per100: 4284.0 },
        { income: 138400, base: 5873.6, per100: 4293.0 },
        { income: 141500, base: 6146.4, per100: 4572.0 },
        { income: 141600, base: 6157.4, per100: 11.0 },
        { income: 144200, base: 6443.4, per100: 4815.0 },
        { income: 144300, base: 6454.4, per100: 4825.0 },
        { income: 148200, base: 6883.4, per100: 5215.0 },
        { income: 148300, base: 6894.4, per100: 5226.0 },
        { income: 150300, base: 7114.4, per100: 5446.0 },
        { income: 150400, base: 7125.4, per100: 5458.0 },
        { income: 151000, base: 7191.4, per100: 5530.0 },
        { income: 152300, base: 7334.4, per100: 5686.0 },
        { income: 152400, base: 7345.4, per100: 5699.0 },
        { income: 155000, base: 7631.4, per100: 6037.0 },
        { income: 160000, base: 8181.4, per100: 6687.0 },
        { income: 170000, base: 9281.4, per100: 7987.0 },
        { income: 184900, base: 10920.4, per100: 9924.0 },
        { income: 185000, base: 10933.6, per100: 13.2 },
        { income: 186000, base: 11065.6, per100: 10067.0 },
        { income: 190000, base: 11593.6, per100: 10587.0 },
        { income: 200000, base: 12913.6, per100: 11887.0 },
        { income: 250000, base: 19513.6, per100: 18387.0 },
        { income: 300000, base: 26113.6, per100: 24887.0 },
        { income: 350000, base: 32713.6, per100: 31387.0 },
        { income: 400000, base: 39313.6, per100: 37887.0 },
        { income: 500000, base: 52513.6, per100: 50887.0 },
        { income: 650000, base: 72313.6, per100: 70387.0 },
        { income: 700000, base: 78913.6, per100: 76887.0 },
        { income: 793300, base: 91229.2, per100: 89016.0 },
        { income: 793400, base: 91241.0, per100: 11.5 },
        { income: 800000, base: 92000.0, per100: 89887.0 },
        { income: 940800, base: 108192.0, per100: 108191.0 },
        { income: 940900, base: 108203.5, per100: 108203.5 },
        { income: 950000, base: 109250.0, per100: 108203.5 },
    ],
};

const formatTaxProfileLabel = (profile) => {
    if (!profile) return '';
    const parts = [];
    if (profile.location) parts.push(profile.location);
    if (profile.church) parts.push(profile.church);
    if (profile.marital_status) parts.push(profile.marital_status);
    return `${profile.name}${parts.length ? ` — ${parts.join(' / ')}` : ''}`;
};

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
    const [municipalTaxRate, setMunicipalTaxRate] = useState('');
    const [cantonalTaxRate, setCantonalTaxRate] = useState('');
    const [churchTaxRate, setChurchTaxRate] = useState('');
    const [personalTaxPerPerson, setPersonalTaxPerPerson] = useState('24');
    const [taxAccountId, setTaxAccountId] = useState('');
    const [taxProfiles, setTaxProfiles] = useState([]);
    const [selectedTaxProfileId, setSelectedTaxProfileId] = useState('');
    const [taxProfilesLoading, setTaxProfilesLoading] = useState(false);
    const [taxImportError, setTaxImportError] = useState('');
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
        shocks: [
            { id: 'shock-1', assetType: 'portfolio', delta: '-20', start: '', end: '' },
        ],
    });
    const [showTaxTable, setShowTaxTable] = useState(true);
    const [showNewProfileEditor, setShowNewProfileEditor] = useState(false);
    const [stressProfiles, setStressProfiles] = useState([]);
    const [profileName, setProfileName] = useState('');
    const [profileDescription, setProfileDescription] = useState('');
    const [profileResults, setProfileResults] = useState({});
    const [openProfileId, setOpenProfileId] = useState('');
    const [profileLoadingId, setProfileLoadingId] = useState('');
    const [editingProfileId, setEditingProfileId] = useState('');
    const [editingProfileName, setEditingProfileName] = useState('');
    const [editingProfileDescription, setEditingProfileDescription] = useState('');
    const [editingProfileOverrides, setEditingProfileOverrides] = useState({ shocks: [] });
    const [selectedTaxYear, setSelectedTaxYear] = useState(null);
    const [stressResult, setStressResult] = useState(null);
    const [stressLoading, setStressLoading] = useState(false);
    const taxTableRef = useRef(null);
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
    const activeTaxProfile = useMemo(() => {
        const normalized = normalizeId(selectedTaxProfileId);
        if (normalized) {
            return taxProfiles.find((profile) => normalizeId(profile.id) === normalized) || null;
        }
        return taxProfiles[0] || null;
    }, [selectedTaxProfileId, taxProfiles]);
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
            const fallbackTaxProfile = activeTaxProfile || DEFAULT_TAX_PROFILE;
            setInflationRate(
                scenarioDetails.inflation_rate === null || scenarioDetails.inflation_rate === undefined
                    ? ''
                    : scenarioDetails.inflation_rate
            );
            setScenarioDescription(scenarioDetails.description || '');
            const fallbackMunicipal = fallbackTaxProfile?.municipal_tax_factor;
            const fallbackCantonal = fallbackTaxProfile?.cantonal_tax_factor;
            const fallbackChurch = fallbackTaxProfile?.church_tax_factor;
            const fallbackPersonal =
                fallbackTaxProfile?.personal_tax_per_person ?? DEFAULT_TAX_PROFILE.personal_tax_per_person ?? 24;
            setMunicipalTaxRate(
                scenarioDetails.municipal_tax_factor === null || scenarioDetails.municipal_tax_factor === undefined
                    ? fallbackMunicipal !== null && fallbackMunicipal !== undefined
                        ? fallbackMunicipal * 100
                        : ''
                    : scenarioDetails.municipal_tax_factor * 100
            );
            setCantonalTaxRate(
                scenarioDetails.cantonal_tax_factor === null || scenarioDetails.cantonal_tax_factor === undefined
                    ? fallbackCantonal !== null && fallbackCantonal !== undefined
                        ? fallbackCantonal * 100
                        : ''
                    : scenarioDetails.cantonal_tax_factor * 100
            );
            setChurchTaxRate(
                scenarioDetails.church_tax_factor === null || scenarioDetails.church_tax_factor === undefined
                    ? fallbackChurch !== null && fallbackChurch !== undefined
                        ? fallbackChurch * 100
                        : ''
                    : scenarioDetails.church_tax_factor * 100
            );
            setPersonalTaxPerPerson(
                scenarioDetails.personal_tax_per_person === null || scenarioDetails.personal_tax_per_person === undefined
                    ? fallbackPersonal
                    : scenarioDetails.personal_tax_per_person
            );
            setTaxAccountId(scenarioDetails.tax_account_id || '');
        }
    }, [scenarioDetails, activeTaxProfile]);

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

    const fetchTaxProfilesRemote = useCallback(async () => {
        if (!selectedUserId) {
            setTaxProfiles([]);
            setSelectedTaxProfileId('');
            return;
        }
        setTaxProfilesLoading(true);
        setTaxImportError('');
        try {
            let profiles = await listTaxProfiles();
            if (!profiles || !profiles.length) {
                const created = await createTaxProfile({
                    ...DEFAULT_TAX_PROFILE,
                    description: DEFAULT_TAX_PROFILE.description,
                });
                profiles = created ? [created] : [];
            }
            setTaxProfiles(profiles);
            setSelectedTaxProfileId((prev) => {
                if (prev && profiles.some((profile) => normalizeId(profile.id) === normalizeId(prev))) {
                    return prev;
                }
                return normalizeId(profiles[0]?.id || '');
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setTaxProfilesLoading(false);
        }
    }, [selectedUserId]);

    useEffect(() => {
        fetchTaxProfilesRemote();
    }, [fetchTaxProfilesRemote]);

    const fetchStressProfilesRemote = useCallback(async () => {
        try {
            const profiles = await listStressProfiles();
            setStressProfiles(profiles || []);
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
                municipal_tax_factor: municipalTaxRate === '' ? null : parseFloat(municipalTaxRate) / 100,
                cantonal_tax_factor: cantonalTaxRate === '' ? null : parseFloat(cantonalTaxRate) / 100,
                church_tax_factor: churchTaxRate === '' ? null : parseFloat(churchTaxRate) / 100,
                personal_tax_per_person: personalTaxPerPerson === '' ? null : parseFloat(personalTaxPerPerson),
                tax_account_id: taxAccountId || null,
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

    const applyTaxProfileToFields = useCallback(() => {
        const profile = activeTaxProfile || DEFAULT_TAX_PROFILE;
        if (profile.municipal_tax_factor !== undefined && profile.municipal_tax_factor !== null) {
            setMunicipalTaxRate(profile.municipal_tax_factor * 100);
        }
        if (profile.cantonal_tax_factor !== undefined && profile.cantonal_tax_factor !== null) {
            setCantonalTaxRate(profile.cantonal_tax_factor * 100);
        }
        if (profile.church_tax_factor !== undefined && profile.church_tax_factor !== null) {
            setChurchTaxRate(profile.church_tax_factor * 100);
        }
        if (profile.personal_tax_per_person !== undefined && profile.personal_tax_per_person !== null) {
            setPersonalTaxPerPerson(profile.personal_tax_per_person);
        }
    }, [activeTaxProfile]);

    const handleImportTaxProfiles = useCallback(
        async (file) => {
            if (!file) return;
            setTaxImportError('');
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const profiles = Array.isArray(parsed) ? parsed : parsed.profiles || [];
                if (!Array.isArray(profiles) || !profiles.length) {
                    setTaxImportError('Keine Profile in der Datei gefunden.');
                    return;
                }
                await importTaxProfiles(profiles);
                await fetchTaxProfilesRemote();
            } catch (err) {
                setTaxImportError(err.message || 'Import fehlgeschlagen. Bitte gültiges JSON hochladen.');
            }
        },
        [fetchTaxProfilesRemote]
    );

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

    // Auto-simulate when a scenario becomes active (incl. after login)
    useEffect(() => {
        if (!currentScenarioId) return;
        const key = cacheKey(selectedUserId, currentScenarioId);
        if (simulationCache[key]) return;
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
        const percentToFactor = (value, fallback) => {
            const num = Number(value);
            if (Number.isFinite(num)) return num / 100;
            if (Number.isFinite(fallback)) return fallback;
            return 0;
        };

        const taxProfile = activeTaxProfile || DEFAULT_TAX_PROFILE;
        const municipalTaxFactor = percentToFactor(
            municipalTaxRate,
            scenarioDetails?.municipal_tax_factor ??
                taxProfile?.municipal_tax_factor ??
                DEFAULT_TAX_PROFILE.municipal_tax_factor ??
                0
        );
        const cantonalTaxFactor = percentToFactor(
            cantonalTaxRate,
            scenarioDetails?.cantonal_tax_factor ??
                taxProfile?.cantonal_tax_factor ??
                DEFAULT_TAX_PROFILE.cantonal_tax_factor ??
                0
        );
        const churchTaxFactor = percentToFactor(
            churchTaxRate,
            scenarioDetails?.church_tax_factor ??
                taxProfile?.church_tax_factor ??
                DEFAULT_TAX_PROFILE.church_tax_factor ??
                0
        );
        // Personalsteuer pauschal pro Person (CHF)
        const personalTaxVal = Number.isFinite(Number(personalTaxPerPerson))
            ? Number(personalTaxPerPerson)
            : Number.isFinite(scenarioDetails?.personal_tax_per_person)
            ? scenarioDetails.personal_tax_per_person
            : taxProfile?.personal_tax_per_person ?? DEFAULT_TAX_PROFILE.personal_tax_per_person ?? 24;
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
        const sanitizeFederal = (rows, fallback) => {
            const base = Array.isArray(rows) && rows.length ? rows : fallback;
            return (base || []).map(({ income, base: rowBase, per100 }) => ({
                income: Number(income) || 0,
                base: Number(rowBase) || 0,
                per100: Number(per100) || 0,
            }));
        };

        const incomeBrackets = sanitizeBrackets(taxProfile?.income_brackets, DEFAULT_TAX_PROFILE.income_brackets);
        const wealthBrackets = sanitizeBrackets(taxProfile?.wealth_brackets, DEFAULT_TAX_PROFILE.wealth_brackets);
        const federalTable = sanitizeFederal(taxProfile?.federal_table, DEFAULT_TAX_PROFILE.federal_table);

        const calcFederalTax = (income) => {
            const taxable = Math.max(0, income || 0);
            const sorted = [...federalTable].sort((a, b) => a.income - b.income);
            if (taxable <= sorted[0].income) {
                const entry = sorted[0];
                return entry.base + ((taxable - entry.income) / 100) * entry.per100;
            }
            for (let i = 0; i < sorted.length - 1; i++) {
                const curr = sorted[i];
                const next = sorted[i + 1];
                if (taxable >= curr.income && taxable < next.income) {
                    return curr.base + ((taxable - curr.income) / 100) * curr.per100;
                }
            }
            // above last bracket: 11.5% marginal
            const last = sorted[sorted.length - 1];
            return last.base + (taxable - last.income) * 0.115;
        };

        return Array.from(results.values())
            .sort((a, b) => a.year - b.year)
            .map((row) => {
                const wealth = wealthPerYear.get(row.year) ?? null;
                const incomeTax = calcProgressive(row.net, incomeBrackets);
                const wealthTax = wealth !== null ? calcProgressive(wealth, wealthBrackets) : null;
                const baseTax = incomeTax + (wealthTax || 0); // einfache Staatssteuer
                const personalTax = personalTaxVal * householdSize;
                const totalTaxWithRate =
                    baseTax * municipalTaxFactor +
                    baseTax * cantonalTaxFactor +
                    baseTax * churchTaxFactor +
                    personalTax;
                const federalTax = calcFederalTax(row.net);
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
                    taxRateLabel: `${(municipalTaxFactor * 100).toFixed(2)}% / ${(cantonalTaxFactor * 100).toFixed(2)}% / ${(churchTaxFactor * 100).toFixed(2)}%`,
                };
            });
    }, [
        activeTaxProfile,
        allTransactions,
        categorizeTransaction,
        currentSimulation,
        selectedUser,
        municipalTaxRate,
        cantonalTaxRate,
        churchTaxRate,
        personalTaxPerPerson,
        scenarioDetails,
    ]);

    const taxableIncomeMap = useMemo(() => {
        const map = new Map();
        taxableIncomeByYear.forEach((row) => {
            map.set(row.year, row);
        });
        return map;
    }, [taxableIncomeByYear]);

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
            const taxRow = taxableIncomeMap.get(entry.year);
            const taxTotal = taxRow ? -Math.abs(taxRow.totalAll ?? taxRow.taxTotal ?? 0) : entry.taxes || 0;
            const net = entry.income + entry.expenses + taxTotal;
            return {
                year: entry.year,
                income: entry.income || 0,
                expenses: entry.expenses || 0,
                taxes: taxTotal,
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
                        municipalTaxRate !== '' ? municipalTaxRate : (scenarioDetails?.municipal_tax_factor || 0) * 100
                    ),
                    formatPercentValue(
                        cantonalTaxRate !== '' ? cantonalTaxRate : (scenarioDetails?.cantonal_tax_factor || 0) * 100
                    ),
                    formatPercentValue(
                        churchTaxRate !== '' ? churchTaxRate : (scenarioDetails?.church_tax_factor || 0) * 100
                    ),
                    Number.isFinite(Number(personalTaxPerPerson)) ? formatCurrency(personalTaxPerPerson) : '–',
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
        taxableIncomeMap,
        municipalTaxRate,
        cantonalTaxRate,
        churchTaxRate,
        personalTaxPerPerson,
        scenarioDetails?.municipal_tax_factor,
        scenarioDetails?.cantonal_tax_factor,
        scenarioDetails?.church_tax_factor,
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
            });
            setStressProfiles((prev) => [...prev, created]);
            setProfileName('');
            setProfileDescription('');
        } catch (err) {
            setError(err.message);
        }
    }, [profileName, profileDescription, stressOverrides]);

    const handleDeleteProfile = useCallback(async (profileId) => {
        try {
            await deleteStressProfileApi(profileId);
            setStressProfiles((prev) => prev.filter((p) => p.id !== profileId));
        } catch (err) {
            setError(err.message);
        }
    }, []);

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
            } catch (err) {
                setError(err.message);
            } finally {
                setProfileLoadingId('');
            }
        },
        [buildStressPayload, currentScenarioId, summarizeSimulation]
    );

    const handleEditProfile = useCallback((profile) => {
        setEditingProfileId(profile.id);
        setEditingProfileName(profile.name || '');
        setEditingProfileDescription(profile.description || '');
        setEditingProfileOverrides(profile.overrides || { shocks: [] });
        setOpenProfileId(profile.id);
    }, []);

    const handleToggleProfile = useCallback(
        async (profile) => {
            const isOpen = openProfileId === profile.id;
            setOpenProfileId(isOpen ? '' : profile.id);
            if (isOpen) return;
            await recomputeProfileResult(profile);
        },
        [openProfileId, recomputeProfileResult]
    );

    const handleSaveProfileEdits = useCallback(async () => {
        if (!editingProfileId) return;
        let updatedProfileRef = null;
        try {
            const updated = await updateStressProfile(editingProfileId, {
                name: editingProfileName.trim() || undefined,
                description: editingProfileDescription.trim(),
                overrides: editingProfileOverrides,
            });
            setStressProfiles((prev) => prev.map((p) => (p.id === editingProfileId ? updated : p)));
            updatedProfileRef = updated;
        } catch (err) {
            setError(err.message);
        }
        setEditingProfileId('');
        setEditingProfileName('');
        setEditingProfileDescription('');
        setEditingProfileOverrides({ shocks: [] });
        if (updatedProfileRef) {
            await recomputeProfileResult(updatedProfileRef);
        }
    }, [
        editingProfileDescription,
        editingProfileId,
        editingProfileName,
        editingProfileOverrides,
        recomputeProfileResult,
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
                                                    <span>Steuerprofil</span>
                                                    <select
                                                        onChange={(e) => setSelectedTaxProfileId(e.target.value)}
                                                        value={selectedTaxProfileId}
                                                    >
                                                        {taxProfiles.map((profile) => (
                                                            <option key={profile.id} value={profile.id}>
                                                                {formatTaxProfileLabel(profile)}
                                                            </option>
                                                        ))}
                                                        {!taxProfiles.length && <option value="">Standard</option>}
                                                    </select>
                                                    {taxProfilesLoading && <span className="muted">Lade Profile …</span>}
                                                    <div className="import-tax-profile">
                                                        <input
                                                            type="file"
                                                            accept="application/json"
                                                            onChange={(e) => handleImportTaxProfiles(e.target.files?.[0])}
                                                        />
                                                        <small className="muted">JSON mit Profilen hochladen (Array oder {`{ profiles: [...] }`}).</small>
                                                        {taxImportError && <div className="error">{taxImportError}</div>}
                                                    </div>
                                                    {activeTaxProfile && (
                                                        <div className="muted small">
                                                            {activeTaxProfile.location && <div>Ort: {activeTaxProfile.location}</div>}
                                                            {activeTaxProfile.church && <div>Kirche: {activeTaxProfile.church}</div>}
                                                            {activeTaxProfile.marital_status && <div>Zivilstand: {activeTaxProfile.marital_status}</div>}
                                                        </div>
                                                    )}
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
                                            <label className="stacked">
                                                <span>Gemeindesteuerfuss (%)</span>
                                                <input
                                                    type="number"
                                                    value={municipalTaxRate}
                                                    onChange={(e) => setMunicipalTaxRate(e.target.value)}
                                                    step="0.01"
                                                />
                                            </label>
                                            <label className="stacked">
                                                <span>Staatssteuerfuss (%)</span>
                                                <input
                                                    type="number"
                                                    value={cantonalTaxRate}
                                                    onChange={(e) => setCantonalTaxRate(e.target.value)}
                                                    step="0.01"
                                                />
                                            </label>
                                            <label className="stacked">
                                                <span>Kirchensteuerfuss (%)</span>
                                                <input
                                                    type="number"
                                                    value={churchTaxRate}
                                                    onChange={(e) => setChurchTaxRate(e.target.value)}
                                                    step="0.01"
                                                />
                                            </label>
                                            <label className="stacked">
                                                <span>Personalsteuer pro Person (CHF)</span>
                                                <input
                                                    type="number"
                                                    value={personalTaxPerPerson}
                                                    onChange={(e) => setPersonalTaxPerPerson(e.target.value)}
                                                    step="0.01"
                                                />
                                            </label>
                                        </div>
                                        <div className="scenario-actions">
                                            <button
                                                className="secondary"
                                                onClick={applyTaxProfileToFields}
                                                disabled={!activeTaxProfile && !taxProfiles.length}
                                            >
                                                Profilwerte übernehmen
                                            </button>
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
                                                                    data: yearlyCashFlow.map((entry) => {
                                                                        const taxRow = taxableIncomeMap.get(entry.year);
                                                                        const taxTotal = taxRow?.totalAll ?? taxRow?.taxTotal ?? entry.taxes ?? 0;
                                                                        const taxPayment = taxRow ? -Math.abs(taxTotal) : (entry.taxes || 0);
                                                                        return entry.income + entry.expenses + taxPayment;
                                                                    }),
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
                                            const taxRow = taxableIncomeMap.get(yearRow.year);
                                            const taxTotal = taxRow?.totalAll ?? taxRow?.taxTotal ?? 0;
                                            const taxPayment = taxRow ? -Math.abs(taxTotal) : (yearRow.taxes || 0);
                                            const yearNet = usesBackendTaxes
                                                ? yearRow.income + yearRow.expenses
                                                : yearRow.income + yearRow.expenses + taxPayment;
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
                                                        <td>
                                                            <button
                                                                className="link-button"
                                                                onClick={() => {
                                                                    setSelectedTaxYear((prev) =>
                                                                        prev === yearRow.year ? null : yearRow.year
                                                                    );
                                                                }}
                                                            >
                                                                {formatCurrency(taxPayment)}
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
                                                            </td>
                                                        </tr>
                                                    )}
                                                                    {isExpanded &&
                                                                        yearRow.months.map((row) => {
                                                                            const isDecember = (row.dateObj.getMonth?.() ?? 0) === 11;
                                                                            const monthTax = usesBackendTaxes ? 0 : isDecember ? taxPayment : 0;
                                                                            const canToggleTax = monthTax !== 0;
                                                                            const monthNet =
                                                                                usesBackendTaxes || monthTax === 0
                                                                                    ? row.income + row.expenses
                                                                                    : row.income + row.expenses + monthTax;
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
                                                                                    {row.showTax && monthTax !== 0 && (
                                                                                        <tr className="cashflow-subrow">
                                                                                            <td></td>
                                                                                            <td colSpan={4}>
                                                                                                <ul className="cashflow-items">
                                                                                                    <li>
                                                                                                        <span>Steuern (berechnet)</span>
                                                                                                        <span className="muted">Jahressteuer</span>
                                                                                                        <span className="amount">
                                                                                                            {formatCurrency(monthTax)}
                                                                                                        </span>
                                                                                                    </li>
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
                                    <p className="eyebrow">Steuern</p>
                                    <h3>Steuertabelle</h3>
                                </div>
                                <div className="panel-actions">
                                    <button
                                        className="secondary"
                                        onClick={() => setShowTaxTable((v) => !v)}
                                    >
                                        {showTaxTable ? 'Einklappen' : 'Ausklappen'}
                                    </button>
                                    <button
                                        className="secondary"
                                        onClick={() => {
                                            taxTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            setShowTaxTable(true);
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
                        <div className="profile-list-block">
                            <div className="profile-list">
                                {(stressProfiles || []).map((p) => (
                                    <div className="profile-item" key={p.id}>
                                        <div className="profile-header" onClick={() => handleToggleProfile(p)}>
                                            <div>
                                                <strong>{p.name}</strong>
                                                {p.description ? <div className="muted small">{p.description}</div> : null}
                                            </div>
                                            <div className="profile-actions">
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
                                            </div>
                                        </div>
                                        {openProfileId === p.id && (
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
                                                                            <option value="mortgage_interest">Zins (Hypothek)</option>
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
                                                                    setEditingProfileOverrides({ shocks: [] });
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
                                ))}
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
                                            <option value="mortgage_interest">Zins (Hypothek)</option>
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
                                <button className="secondary" onClick={handleSaveProfile} disabled={!profileName.trim()}>
                                    Speichern
                                </button>
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
