(function (root) {
    'use strict';

    function createDesktopConnection() {
        function api(path, options) {
            return fetch(path, Object.assign({ cache: 'no-store' }, options || {})).then(function (response) {
                var contentType = response.headers.get('content-type') || '';
                if (contentType.indexOf('application/json') === -1) {
                    if (!response.ok) throw new Error('Local server returned HTTP ' + response.status + '.');
                    return response.blob();
                }
                return response.json().then(function (body) {
                    if (!response.ok) throw new Error(body.error || ('Request failed with HTTP ' + response.status + '.'));
                    return body;
                });
            });
        }

        return {
            kind: 'desktop',
            init() {
                return api('/api/config');
            },
            connect(details) {
                return api('/api/connect', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(details),
                });
            },
            disconnect() {
                return api('/api/disconnect', { method: 'POST' });
            },
            status() {
                return api('/api/status');
            },
            albums() {
                return api('/api/albums');
            },
            randomPhoto({ source, albumId, excludeId }) {
                var params = new URLSearchParams({ source: source });
                if (source === 'album' && albumId) params.set('albumId', albumId);
                if (excludeId) params.set('exclude', excludeId);
                return api('/api/photos/random?' + params.toString());
            },
            thumbnail(assetId) {
                return api('/api/photos/' + encodeURIComponent(assetId) + '/thumbnail');
            },
            remove() {
                return Promise.resolve();
            },
        };
    }

    function createTvConnection(secureStore) {
        var LEGACY_SERVER = 'https://immich.theborns.xyz';

        function request(url, method, apiKey, body, responseType) {
            return new Promise(function (resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.open(method, url, true);
                xhr.timeout = 20000;
                if (apiKey) xhr.setRequestHeader('x-api-key', apiKey);
                if (body) xhr.setRequestHeader('Content-Type', 'application/json');
                if (responseType) xhr.responseType = responseType;
                xhr.onload = function () {
                    if (xhr.status < 200 || xhr.status >= 300) {
                        var failure = new Error('Immich returned HTTP ' + xhr.status);
                        failure.status = xhr.status;
                        reject(failure);
                        return;
                    }
                    try {
                        resolve(responseType ? xhr.response : JSON.parse(xhr.responseText));
                    } catch (error) {
                        reject(new Error('Immich returned an unreadable response.'));
                    }
                };
                xhr.onerror = function () { reject(new Error('Network request failed. Check Immich, CORS, and network access.')); };
                xhr.ontimeout = function () { reject(new Error('Immich request timed out.')); };
                xhr.send(body ? JSON.stringify(body) : null);
            });
        }

        var connection = { serverUrl: '', apiKey: '' };

        function isConfigured() {
            return Boolean(connection.serverUrl && connection.apiKey);
        }

        function search(body) {
            if (!isConfigured()) return Promise.reject(new Error('This TV has no saved Immich connection.'));
            return request(connection.serverUrl + '/api/search/metadata', 'POST', connection.apiKey, Object.assign({ type: 'IMAGE' }, body));
        }

        function normalizeAlbums(list) {
            return (Array.isArray(list) ? list : [])
                .filter(function (album) { return Number(album.assetCount || 0) > 0; })
                .map(function (album) {
                    return {
                        id: album.id,
                        name: album.albumName || 'Untitled album',
                        assetCount: Number(album.assetCount || 0),
                    };
                });
        }

        return {
            kind: 'tv',
            init() {
                return secureStore.load().then(function (saved) {
                    if (saved) {
                        connection = {
                            serverUrl: saved.serverUrl || LEGACY_SERVER,
                            apiKey: saved.apiKey,
                        };
                        return { configured: true, serverUrl: connection.serverUrl };
                    }
                    return { configured: false, serverUrl: '' };
                });
            },
            probe(nextConnection) {
                return request(nextConnection.serverUrl + '/api/search/metadata', 'POST', nextConnection.apiKey, {
                    type: 'IMAGE', page: 1, size: 1,
                }).then(function (result) {
                    if (!result.assets || !Array.isArray(result.assets.items)) {
                        throw new Error('Immich returned an unexpected photo-search response.');
                    }
                    return result;
                });
            },
            save(nextConnection) {
                connection = {
                    serverUrl: nextConnection.serverUrl,
                    apiKey: nextConnection.apiKey,
                };
                return secureStore.save(connection);
            },
            disconnect() {
                connection = { serverUrl: '', apiKey: '' };
                return secureStore.remove();
            },
            status() {
                return search({ page: 1, size: 1 }).then(function () { return { connected: true }; });
            },
            albums() {
                if (!isConfigured()) return Promise.reject(new Error('This TV has no saved Immich connection.'));
                return request(connection.serverUrl + '/api/albums', 'GET', connection.apiKey).then(normalizeAlbums);
            },
            randomPhoto({ source, albumId, excludeId }) {
                var body = { page: 1, size: 100 };
                if (source === 'favorites') body.isFavorite = true;
                if (source === 'album') body.albumIds = [albumId];
                return search(body).then(function (result) {
                    var assets = result.assets && result.assets.items ? result.assets.items : [];
                    if (!assets.length) throw new Error('No photos found for this source.');
                    var candidates = assets;
                    if (assets.length > 1 && excludeId) {
                        var withoutExcluded = assets.filter(function (asset) { return asset.id !== excludeId; });
                        if (withoutExcluded.length) candidates = withoutExcluded;
                    }
                    var asset = candidates[Math.floor(Math.random() * candidates.length)];
                    return {
                        id: asset.id,
                        fileName: asset.originalFileName || 'Immich photo',
                        date: asset.fileCreatedAt || asset.createdAt || null,
                    };
                });
            },
            thumbnail(assetId) {
                if (!isConfigured()) return Promise.reject(new Error('This TV has no saved Immich connection.'));
                return request(connection.serverUrl + '/api/assets/' + encodeURIComponent(assetId) +
                    '/thumbnail?size=preview&format=jpg', 'GET', connection.apiKey, null, 'blob');
            },
            remove() {
                connection = { serverUrl: '', apiKey: '' };
                return secureStore.remove();
            },
        };
    }

    function isTizenDevice() {
        if (root.tizen && root.tizen.keymanager) return true;
        try {
            return /(?:SMART-TV|SMARTTV|Tizen)/i.test(root.navigator.userAgent);
        } catch (error) {
            return false;
        }
    }

    function createLocalStore() {
        var KEY = 'immich-wall-tv-connection';

        function load() {
            try {
                var value = JSON.parse(root.localStorage.getItem(KEY) || 'null');
                if (value && typeof value.serverUrl === 'string' && typeof value.apiKey === 'string' && value.apiKey) {
                    return Promise.resolve(value);
                }
            } catch (error) { }
            return Promise.resolve(null);
        }

        function save(connection) {
            root.localStorage.setItem(KEY, JSON.stringify(connection));
            return Promise.resolve();
        }

        function remove() {
            root.localStorage.removeItem(KEY);
            return Promise.resolve();
        }

        return { load: load, save: save, remove: remove, alias: KEY };
    }

    function create() {
        var hasKeyManager = Boolean(root.tizen && root.tizen.keymanager);
        var secureStore = hasKeyManager ? root.TizenSecureStore : createLocalStore();
        if (isTizenDevice()) return createTvConnection(secureStore);
        return createDesktopConnection();
    }

    var api = { create: create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.ImmichWallConnection = api;
}(typeof window === 'undefined' ? globalThis : window));
