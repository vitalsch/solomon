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
    const { skipAuth = false, ...fetchOptions } = options;
    const token = skipAuth ? null : getAuthToken();
    const headers = {
        ...defaultHeaders,
        ...(!skipAuth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(fetchOptions.headers || {}),
    };

    const response = await fetch(`${API_BASE}${path}`, {
        ...fetchOptions,
        headers,
    });

    if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(errorText || 'API request failed');
        error.status = response.status;
        throw error;
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

const adminRequest = (path, adminAuthHeader, options = {}) => {
    if (!adminAuthHeader) {
        const err = new Error('Missing admin credentials');
        err.status = 401;
        throw err;
    }
    return request(path, {
        ...options,
        skipAuth: true,
        headers: {
            ...(options.headers || {}),
            Authorization: adminAuthHeader,
        },
    });
};

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

// Tax metadata ------------------------------------------------------------
export const listTaxCantons = () => request('/tax/cantons');
export const listStateTaxRates = () => request('/tax/state-rates');
export const listMunicipalTaxEntries = (canton) => {
    const query = canton ? `?canton=${encodeURIComponent(canton)}` : '';
    return request(`/tax/municipalities${query}`);
};
export const listStateTaxTariffsPublic = (scope, canton) => {
    const params = [];
    if (scope) params.push(`scope=${encodeURIComponent(scope)}`);
    if (canton) params.push(`canton=${encodeURIComponent(canton)}`);
    const query = params.length ? `?${params.join('&')}` : '';
    return request(`/tax/state-tariffs${query}`);
};
export const listFederalTaxTablesPublic = () => request('/tax/federal-tariffs');

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
export const simulateScenarioStress = (scenarioId, overrides = {}) =>
    request(`/scenarios/${scenarioId}/simulate/stress`, {
        method: 'POST',
        body: JSON.stringify(overrides),
    });

// Tax Profiles -----------------------------------------------------------
export const listTaxProfiles = () => request('/tax-profiles');
export const createTaxProfile = (payload) =>
    request('/tax-profiles', { method: 'POST', body: JSON.stringify(payload) });
export const updateTaxProfile = (profileId, payload) =>
    request(`/tax-profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const deleteTaxProfile = (profileId) =>
    request(`/tax-profiles/${profileId}`, { method: 'DELETE' });
export const importTaxProfiles = (profiles) =>
    request('/tax-profiles/import', {
        method: 'POST',
        body: JSON.stringify({ profiles }),
    });

// Stress Profiles ---------------------------------------------------------
export const listStressProfiles = () => request('/stress-profiles');
export const createStressProfile = (payload) =>
    request('/stress-profiles', { method: 'POST', body: JSON.stringify(payload) });
export const updateStressProfile = (profileId, payload) =>
    request(`/stress-profiles/${profileId}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const deleteStressProfileApi = (profileId) =>
    request(`/stress-profiles/${profileId}`, { method: 'DELETE' });

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

// Admin: Municipal Tax Tables --------------------------------------------
export const listMunicipalTaxRatesAdmin = (adminAuthHeader, canton = 'ZH') =>
    adminRequest(`/admin/tax-tables?canton=${encodeURIComponent(canton)}`, adminAuthHeader);

export const createMunicipalTaxRateAdmin = (adminAuthHeader, payload) =>
    adminRequest('/admin/tax-tables', adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const updateMunicipalTaxRateAdmin = (adminAuthHeader, entryId, payload) =>
    adminRequest(`/admin/tax-tables/${entryId}`, adminAuthHeader, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });

export const deleteMunicipalTaxRateAdmin = (adminAuthHeader, entryId) =>
    adminRequest(`/admin/tax-tables/${entryId}`, adminAuthHeader, {
        method: 'DELETE',
    });

export const listStateTaxRatesAdmin = (adminAuthHeader) => adminRequest('/admin/state-tax-rates', adminAuthHeader);

export const createStateTaxRateAdmin = (adminAuthHeader, payload) =>
    adminRequest('/admin/state-tax-rates', adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const updateStateTaxRateAdmin = (adminAuthHeader, entryId, payload) =>
    adminRequest(`/admin/state-tax-rates/${entryId}`, adminAuthHeader, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });

export const deleteStateTaxRateAdmin = (adminAuthHeader, entryId) =>
    adminRequest(`/admin/state-tax-rates/${entryId}`, adminAuthHeader, {
        method: 'DELETE',
    });

export const listStateTaxTariffsAdmin = (adminAuthHeader, scope) => {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    return adminRequest(`/admin/state-tariffs${query}`, adminAuthHeader);
};

export const createStateTaxTariffAdmin = (adminAuthHeader, payload) =>
    adminRequest('/admin/state-tariffs', adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const updateStateTaxTariffAdmin = (adminAuthHeader, tariffId, payload) =>
    adminRequest(`/admin/state-tariffs/${tariffId}`, adminAuthHeader, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });

export const deleteStateTaxTariffAdmin = (adminAuthHeader, tariffId) =>
    adminRequest(`/admin/state-tariffs/${tariffId}`, adminAuthHeader, {
        method: 'DELETE',
    });

export const importStateTaxTariffRowsAdmin = (adminAuthHeader, tariffId, rows) =>
    adminRequest(`/admin/state-tariffs/${tariffId}/rows/import`, adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify({ rows }),
    });

export const listFederalTaxTablesAdmin = (adminAuthHeader) =>
    adminRequest('/admin/federal-tax-tables', adminAuthHeader);

export const createFederalTaxTableAdmin = (adminAuthHeader, payload) =>
    adminRequest('/admin/federal-tax-tables', adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const updateFederalTaxTableAdmin = (adminAuthHeader, tableId, payload) =>
    adminRequest(`/admin/federal-tax-tables/${tableId}`, adminAuthHeader, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });

export const deleteFederalTaxTableAdmin = (adminAuthHeader, tableId) =>
    adminRequest(`/admin/federal-tax-tables/${tableId}`, adminAuthHeader, {
        method: 'DELETE',
    });

export const importFederalTaxTableRowsAdmin = (adminAuthHeader, tableId, rows) =>
    adminRequest(`/admin/federal-tax-tables/${tableId}/rows/import`, adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify({ rows }),
    });

export const listPersonalTaxesAdmin = (adminAuthHeader) => adminRequest('/admin/personal-taxes', adminAuthHeader);

export const createPersonalTaxAdmin = (adminAuthHeader, payload) =>
    adminRequest('/admin/personal-taxes', adminAuthHeader, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

export const updatePersonalTaxAdmin = (adminAuthHeader, entryId, payload) =>
    adminRequest(`/admin/personal-taxes/${entryId}`, adminAuthHeader, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });

export const deletePersonalTaxAdmin = (adminAuthHeader, entryId) =>
    adminRequest(`/admin/personal-taxes/${entryId}`, adminAuthHeader, {
        method: 'DELETE',
    });

// Vault (client-side encryption metadata) ----------------------------------
export const getVault = () => request('/vault');
export const saveVault = (payload) =>
    request('/vault', {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
