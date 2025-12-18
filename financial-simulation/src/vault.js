const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

const fromBase64Url = (value) => {
    if (!value) return new Uint8Array();
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const randomBytes = (length = 32) => {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
};

// IndexedDB helpers for storing non-extractable device keys -----------------
const DB_NAME = 'vault-device-keys';
const STORE_NAME = 'keys';

const openKeyDb = () =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
    });

const saveDeviceKey = async (keyId, key) => {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_NAME).put(key, keyId);
    });
};

const loadDeviceKey = async (keyId) => {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(keyId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
};

const deleteDeviceKey = async (keyId) => {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE_NAME).delete(keyId);
    });
};

// Cryptography primitives ---------------------------------------------------
export const generateDek = async () =>
    crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export const deriveKekFromPassphrase = async (passphrase, saltB64Url, iterations = 250000) => {
    const salt = fromBase64Url(saltB64Url);
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
        'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        true,
        ['wrapKey', 'unwrapKey']
    );
};

export const wrapDek = async (dek, kek) => {
    const iv = randomBytes(12);
    const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
    return { wrapped: toBase64Url(wrapped), iv: toBase64Url(iv) };
};

export const unwrapDek = async (wrappedDek, kek) => {
    const iv = fromBase64Url(wrappedDek.iv);
    const wrapped = fromBase64Url(wrappedDek.wrapped);
    return crypto.subtle.unwrapKey(
        'raw',
        wrapped,
        kek,
        { name: 'AES-GCM', iv },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
};

export const encryptJson = async (dek, payload, aad = '') => {
    const iv = randomBytes(12);
    const options = { name: 'AES-GCM', iv };
    if (aad) {
        options.additionalData = encoder.encode(String(aad));
    }
    const cipher = await crypto.subtle.encrypt(options, dek, encoder.encode(JSON.stringify(payload)));
    return { ciphertext: toBase64Url(cipher), iv: toBase64Url(iv), aad: aad || undefined };
};

export const decryptJson = async (dek, blob) => {
    const { ciphertext, iv, aad } = blob || {};
    const options = { name: 'AES-GCM', iv: fromBase64Url(iv) };
    if (aad) {
        options.additionalData = encoder.encode(String(aad));
    }
    const plain = await crypto.subtle.decrypt(options, dek, fromBase64Url(ciphertext));
    return JSON.parse(decoder.decode(plain));
};

export const generateRecoveryKey = () => toBase64Url(randomBytes(32));

export const deriveRecoveryWrapper = async (recoveryKey, saltB64Url, iterations = 200000) => {
    const salt = fromBase64Url(saltB64Url);
    const material = await crypto.subtle.importKey('raw', encoder.encode(recoveryKey), 'PBKDF2', false, [
        'deriveKey',
    ]);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        true,
        ['wrapKey', 'unwrapKey']
    );
};

export const createTrustedDeviceKey = async (deviceId) => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'wrapKey',
        'unwrapKey',
    ]);
    await saveDeviceKey(deviceId, key);
    return key;
};

export const loadTrustedDeviceKey = async (deviceId) => loadDeviceKey(deviceId);
export const deleteTrustedDeviceKey = async (deviceId) => deleteDeviceKey(deviceId);

export const wrapWithDeviceKey = async (dek, deviceKey) => {
    const iv = randomBytes(12);
    const wrapped = await crypto.subtle.wrapKey('raw', dek, deviceKey, { name: 'AES-GCM', iv });
    return { wrapped: toBase64Url(wrapped), iv: toBase64Url(iv) };
};

export const unwrapWithDeviceKey = async (wrappedDek, deviceKey) => {
    const iv = fromBase64Url(wrappedDek.iv);
    const wrapped = fromBase64Url(wrappedDek.wrapped);
    return crypto.subtle.unwrapKey(
        'raw',
        wrapped,
        deviceKey,
        { name: 'AES-GCM', iv },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
};

export const serializeWrappedDek = (wrappedDek, salt, iterations) => ({
    wrapped: wrappedDek.wrapped,
    iv: wrappedDek.iv,
    salt,
    iterations,
    kdf: 'PBKDF2-HMAC-SHA256',
    alg: 'AES-GCM',
});

export const createVaultRecord = async ({ passphrase, rememberDevice = true, recoveryKey: provided }) => {
    const dek = await generateDek();
    const salt = toBase64Url(randomBytes(16));
    const kek = await deriveKekFromPassphrase(passphrase, salt);
    const wrapped = await wrapDek(dek, kek);

    const recoveryKey = provided || generateRecoveryKey();
    const recoverySalt = toBase64Url(randomBytes(16));
    const recoveryWrapper = await deriveRecoveryWrapper(recoveryKey, recoverySalt);
    const recoveryWrapped = await wrapDek(dek, recoveryWrapper);

    const deviceId = crypto.randomUUID();
    let deviceWrapped = null;
    if (rememberDevice) {
        const deviceKey = await createTrustedDeviceKey(deviceId);
        deviceWrapped = await wrapWithDeviceKey(dek, deviceKey);
    }

    return {
        dek,
        recoveryKey,
        deviceId,
        wrappedDek: serializeWrappedDek(wrapped, salt, 250000),
        recoveryWrappedDek: serializeWrappedDek(recoveryWrapped, recoverySalt, 200000),
        deviceWrappedDek: deviceWrapped ? { ...deviceWrapped, deviceId } : null,
    };
};
