/**
 * Resolve the API base URL.
 * - If REACT_APP_API_BASE is set, use it (without trailing slash).
 * - In the browser we default to the dev backend port 8000 (even when the dev server is
 *   reached via LAN IP/0.0.0.0), otherwise fall back to same-origin relative calls.
 */
const stripTrailingSlash = (value) => (value?.endsWith('/') ? value.slice(0, -1) : value || '');
const API_BASE = (() => {
    if (process.env.REACT_APP_API_BASE) {
        return stripTrailingSlash(process.env.REACT_APP_API_BASE);
    }
    if (typeof window !== 'undefined') {
        const { protocol, port } = window.location;
        const isFileProtocol = protocol === 'file:';
        const host = window.location.hostname;
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        const devPorts = new Set(['3000', '3001', '5173', '4173', '8080']);
        if (isLocalHost || isFileProtocol || devPorts.has(port || '')) {
            // Serve dev backend from the same host (support LAN access to a "0.0.0.0" dev server)
            const targetHost = isLocalHost ? 'localhost' : host || 'localhost';
            return `${protocol || 'http:'}//${targetHost}:8000`;
        }
        // Production / same-origin fallback
        return stripTrailingSlash('');
    }
    return 'http://localhost:8000';
})();

const defaultHeaders = {
    'Content-Type': 'application/json',
};

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            ...defaultHeaders,
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

export const listUsers = () => request('/users');
export const createUser = (payload) =>
    request('/users', { method: 'POST', body: JSON.stringify(payload) });

export const listScenarios = (userId) => request(`/users/${userId}/scenarios`);
export const createScenario = (payload) =>
    request('/scenarios', { method: 'POST', body: JSON.stringify(payload) });
export const getScenario = (scenarioId) => request(`/scenarios/${scenarioId}`);
export const updateScenario = (scenarioId, payload) =>
    request(`/scenarios/${scenarioId}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const deleteScenario = (scenarioId) =>
    request(`/scenarios/${scenarioId}`, { method: 'DELETE' });

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

export const simulateScenario = (scenarioId) =>
    request(`/scenarios/${scenarioId}/simulate`, { method: 'POST' });
