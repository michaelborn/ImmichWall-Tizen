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

test('page selection spreads picks across the whole library, not just the newest page', () => {
    assert.equal(Connection.choosePage(225, 100, () => 0), 1);
    assert.equal(Connection.choosePage(225, 100, () => 0.5), 2);
    assert.equal(Connection.choosePage(225, 100, () => 0.999), 3);
    assert.equal(Connection.choosePage(100, 100, () => 0.999), 1);
    assert.equal(Connection.choosePage(0, 100, () => 0.999), 1);

    const tally = new Map();
    for (let pick = 0; pick < 3000; pick += 1) {
        const page = Connection.choosePage(500, 100, Math.random);
        tally.set(page, (tally.get(page) ?? 0) + 1);
    }
    assert.deepEqual([...tally.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    for (const count of tally.values()) {
        assert.ok(count > 400 && count < 800, 'page distribution is roughly uniform: ' + JSON.stringify([...tally]));
    }
});

test('asset choice avoids the excluded asset unless it is the only candidate', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(Connection.chooseAsset(items, 'a', () => 0).id, 'b');
    assert.equal(Connection.chooseAsset(items, 'a', () => 0.99).id, 'c');
    assert.equal(Connection.chooseAsset(items, null, () => 0).id, 'a');
    assert.equal(Connection.chooseAsset([{ id: 'a' }], 'a', () => 0).id, 'a');
});
