(function (root) {
    'use strict';

    var runtimeConfig = root.ImmichWallRuntimeConfig || {};
    var configuredPairingBase = String(runtimeConfig.pairingBaseUrl || '').replace(/\/+$/, '');
    var PAIRING_SERVER = configuredPairingBase ||
        (root.location && /^https?:$/.test(root.location.protocol) ? root.location.origin : '');

    function request(path, method, body) {
        if (!PAIRING_SERVER) {
            return Promise.reject(new Error('Pairing URL is not configured. Set PAIRING_BASE_URL in .env and rebuild the TV package.'));
        }
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, PAIRING_SERVER + '/api/pairing/' + path, true);
            xhr.timeout = 15000;
            if (body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function () {
                var result;
                try {
                    result = JSON.parse(xhr.responseText);
                } catch (error) {
                    reject(new Error('The pairing service returned an invalid response.'));
                    return;
                }
                if (xhr.status < 200 || xhr.status >= 300) {
                    var failure = new Error(result.error || 'Pairing request failed.');
                    failure.status = xhr.status;
                    reject(failure);
                    return;
                }
                resolve(result);
            };
            xhr.onerror = function () { reject(new Error('Cannot reach the pairing service. Check the TV network.')); };
            xhr.ontimeout = function () { reject(new Error('The pairing service request timed out.')); };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    }

    root.ImmichTvPairing = { request: request };
}(typeof window === 'undefined' ? globalThis : window));
