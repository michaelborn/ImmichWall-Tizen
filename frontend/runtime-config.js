(function (root) {
    'use strict';
    var existing = root.ImmichWallRuntimeConfig || {};
    root.ImmichWallRuntimeConfig = {
        pairingBaseUrl: existing.pairingBaseUrl || '',
        defaultImmichServerUrl: existing.defaultImmichServerUrl || '',
    };
}(typeof window === 'undefined' ? globalThis : window));
