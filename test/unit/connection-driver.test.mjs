import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import Connection from '../../frontend/connection.js';
import SecureStore from '../../frontend/secure-store.js';

const ORIGINAL_TIZEN = globalThis.tizen;
const ORIGINAL_SECURE_STORE = globalThis.TizenSecureStore;
const ORIGINAL_NAVIGATOR = globalThis.navigator;
const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;

function fakeLocalStorage() {
    const store = new Map();
    return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => { store.set(key, value); },
        removeItem: (key) => { store.delete(key); },
    };
}

function fakeKeyManager() {
    let stored = null;
    return {
        getData(alias) {
            if (stored === null) {
                const error = new Error('missing');
                error.name = 'NotFoundError';
                throw error;
            }
            return stored;
        },
        saveData(alias, raw, password, success) { stored = raw; success(); },
        removeData(alias) {
            if (stored === null) {
                const error = new Error('missing');
                error.name = 'NotFoundError';
                throw error;
            }
            stored = null;
        },
    };
}

function userAgent(value) {
    Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: value },
        configurable: true,
        writable: true,
    });
}

beforeEach(() => {
    globalThis.TizenSecureStore = SecureStore;
    globalThis.localStorage = fakeLocalStorage();
});

afterEach(() => {
    globalThis.tizen = ORIGINAL_TIZEN;
    globalThis.TizenSecureStore = ORIGINAL_SECURE_STORE;
    userAgent(ORIGINAL_NAVIGATOR?.userAgent ?? '');
    globalThis.localStorage = ORIGINAL_LOCAL_STORAGE;
});

test('a TV user agent selects the direct driver even when KeyManager is missing', async () => {
    userAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebkit/537.36');
    assert.equal(globalThis.tizen, undefined);
    const driver = Connection.create();
    assert.equal(driver.kind, 'tv');

    await driver.save({ serverUrl: 'https://photos.test', apiKey: 'read-only-key' });
    const initial = await driver.init();
    assert.equal(initial.configured, true);
    assert.equal(initial.serverUrl, 'https://photos.test');
    assert.ok(globalThis.localStorage.getItem('immich-wall-tv-connection').includes('read-only-key'));

    await driver.disconnect();
    const afterRemove = await driver.init();
    assert.equal(afterRemove.configured, false);
});

test('a KeyManager-capable TV uses the secure store and persists a connection', async () => {
    userAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebkit/537.36 SMART-TV');
    globalThis.tizen = { keymanager: fakeKeyManager() };

    const driver = Connection.create();
    assert.equal(driver.kind, 'tv');
    await driver.save({ serverUrl: 'https://photos.test', apiKey: 'read-only-key' });
    assert.equal((await driver.init()).configured, true);
    assert.equal((await driver.init()).serverUrl, 'https://photos.test');
    await driver.remove();
    assert.equal((await driver.init()).configured, false);
});

test('a desktop user agent gets the proxied desktop driver with no local persistence', () => {
    userAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/120');
    const driver = Connection.create();
    assert.equal(driver.kind, 'desktop');
});
