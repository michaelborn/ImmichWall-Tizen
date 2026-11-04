(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TizenSecureStore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var ALIAS = 'immich-wall-connection';

    function keyManager() {
        if (!root.tizen || !root.tizen.keymanager) {
            throw new Error('Secure credential storage is not available on this TV.');
        }
        return root.tizen.keymanager;
    }

    function load() {
        try {
            var raw = keyManager().getData({ name: ALIAS });
            var value = JSON.parse(raw);
            if (!value || typeof value.serverUrl !== 'string' || typeof value.apiKey !== 'string' || !value.apiKey) {
                throw new Error('Saved Immich connection is invalid.');
            }
            return Promise.resolve(value);
        } catch (error) {
            if (error && (error.name === 'NotFoundError' || error.code === 'NotFoundError')) return Promise.resolve(null);
            return Promise.reject(error);
        }
    }

    function save(connection) {
        return new Promise(function (resolve, reject) {
            var manager;
            try {
                manager = keyManager();
                manager.saveData(ALIAS, JSON.stringify(connection), null, resolve, reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    function remove() {
        try {
            keyManager().removeData({ name: ALIAS });
            return Promise.resolve();
        } catch (error) {
            if (error && (error.name === 'NotFoundError' || error.code === 'NotFoundError')) return Promise.resolve();
            return Promise.reject(error);
        }
    }

    return { load: load, save: save, remove: remove, alias: ALIAS };
}));
