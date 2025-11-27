const TOKEN_KEY = 'authToken';

const stripTrailingSlash = (value) => (value?.endsWith('/') ? value.slice(0, -1) : value || '');
const getEnvApiBase = () => {
    // Support CRA (REACT_APP_) envs
    if (process.env.REACT_APP_API_BASE) {
        return process.env.REACT_APP_API_BASE;
    }
    // Optional Vite-style env (just in case)
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) {
        return import.meta.env.VITE_API_BASE;
    }
    return '';
};

const API_BASE = (() => {
    const envBase = stripTrailingSlash(getEnvApiBase());
    if (envBase) return envBase;
    if (typeof window !== 'undefined') {
        const { protocol, port } = window.location;
        const isFileProtocol = protocol === 'file:';
        const host = window.location.hostname;
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        const devPorts = new Set(['3000', '3001', '5173', '4173', '8080']);
        if (isLocalHost || isFileProtocol || devPorts.has(port || '')) {
            const targetHost = isLocalHost ? 'localhost' : host || 'localhost';
            return `${protocol || 'http:'}//${targetHost}:8000`;
        }
        return stripTrailingSlash('');
    }
    return 'http://localhost:8000';
})();

export const setAuthToken = (token) => {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }
};

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

const defaultHeaders = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'API request failed');
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

// Auth & User ---------------------------------------------------------------
export const registerUser = async (payload) => {
    const result = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (result?.token) {
        setAuthToken(result.token);
    }
    return result;
};

export const loginUser = async (payload) => {
    const result = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (result?.token) {
        setAuthToken(result.token);
    }
    return result;
};

export const getCurrentUser = () => request('/me');
export const deleteCurrentUser = () => request('/me', { method: 'DELETE' });

// Scenarios -----------------------------------------------------------------
export const listScenarios = () => request('/scenarios');
export const createScenario = (payload) =>
    request('/scenarios', { method: 'POST', body: JSON.stringify(payload) });
export const getScenario = (scenarioId) => request(`/scenarios/${scenarioId}`);
export const updateScenario = (scenarioId, payload) =>
    request(`/scenarios/${scenarioId}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const deleteScenario = (scenarioId) =>
    request(`/scenarios/${scenarioId}`, { method: 'DELETE' });

// Assets --------------------------------------------------------------------
export const listAssets = (scenarioId) => request(`/scenarios/${scenarioId}/assets`);
export const createAsset = (scenarioId, payload) =>
    request(`/scenarios/${scenarioId}/assets`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
export const updateAsset = (assetId, payload) =>
    request(`/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const deleteAsset = (assetId) =>
    request(`/assets/${assetId}`, { method: 'DELETE' });

// Transactions --------------------------------------------------------------
export const listTransactions = (scenarioId) =>
    request(`/scenarios/${scenarioId}/transactions`);
export const createTransaction = (scenarioId, payload) =>
    request(`/scenarios/${scenarioId}/transactions`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
export const updateTransaction = (transactionId, payload) =>
    request(`/transactions/${transactionId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
export const deleteTransaction = (transactionId) =>
    request(`/transactions/${transactionId}`, { method: 'DELETE' });

// Simulation ----------------------------------------------------------------
export const simulateScenario = (scenarioId) =>
    request(`/scenarios/${scenarioId}/simulate`, { method: 'POST' });

// AI Assistant (modular provider-ready) ------------------------------------
export const sendAssistantMessage = (messages, context = {}) =>
    request(`/assistant/chat`, {
        method: 'POST',
        body: JSON.stringify({ messages, context }),
    });

export const applyAssistantPlan = (plan) =>
    request(`/assistant/apply`, {
        method: 'POST',
        body: JSON.stringify({ plan }),
    });
