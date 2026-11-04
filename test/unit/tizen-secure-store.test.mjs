import assert from 'node:assert/strict';
import test from 'node:test';
import SecureStore from '../../frontend/secure-store.js';

test('stores and loads the connection through Tizen KeyManager, and removes it on unpair', async () => {
    let stored = null;
    globalThis.tizen = {
        keymanager: {
            getData(alias) {
                assert.equal(alias.name, SecureStore.alias);
                if (stored === null) {
                    const error = new Error('missing');
                    error.name = 'NotFoundError';
                    throw error;
                }
                return stored;
            },
            saveData(alias, raw, password, success) {
                assert.equal(alias, SecureStore.alias);
                assert.equal(password, null);
                stored = raw;
                success();
            },
            removeData(alias) {
                assert.equal(alias.name, SecureStore.alias);
                if (stored === null) {
                    const error = new Error('missing');
                    error.name = 'NotFoundError';
                    throw error;
                }
                stored = null;
            },
        },
    };

    try {
        assert.equal(await SecureStore.load(), null);
        const connection = { serverUrl: 'https://photos.example.test', apiKey: 'read-only-key' };
        await SecureStore.save(connection);
        assert.deepEqual(await SecureStore.load(), connection);
        await SecureStore.remove();
        assert.equal(await SecureStore.load(), null);
    } finally {
        delete globalThis.tizen;
    }
});

test('fails clearly when Tizen KeyManager is unavailable', async () => {
    delete globalThis.tizen;
    await assert.rejects(SecureStore.save({ serverUrl: 'https://photos.example.test', apiKey: 'key' }), /Secure credential storage/);
});
