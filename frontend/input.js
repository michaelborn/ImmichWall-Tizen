(function (root) {
    'use strict';

    function actionFor(event, isTv) {
        var code = event.keyCode || event.which || 0;
        var key = event.key || '';

        if (code === 10252 || key === 'MediaPlayPause') return 'toggle-pause';
        if (code === 19 || key === 'MediaPause') return 'pause';
        if (code === 415 || key === 'MediaPlay') return 'play';
        if (code === 37 || key === 'ArrowLeft') return 'previous';
        if (code === 39 || key === 'ArrowRight' || code === 13 || key === 'Enter') return 'next';
        if (code === 38 || key === 'ArrowUp' || code === 40 || key === 'ArrowDown') return isTv ? 'open-settings' : '';
        if (code === 10009 || code === 461 || key === 'Back') return 'back';
        if (key === 'Escape') return 'back';
        if (code === 32 || key === ' ' || key === 'Spacebar') return 'toggle-pause';
        if (key.toLowerCase() === 's') return 'open-settings';
        if (key.toLowerCase() === 'i') return 'details';
        if (key.toLowerCase() === 'f') return 'fullscreen';
        return '';
    }

    function registerMediaKeys() {
        var manager = root.tizen && root.tizen.tvinputdevice;
        if (!manager) return;
        var supported = {};
        try {
            manager.getSupportedKeys().forEach(function (entry) { supported[entry.name] = true; });
        } catch (error) {
            return;
        }
        ['MediaPlayPause', 'MediaPlay', 'MediaPause'].forEach(function (name) {
            if (!supported[name]) return;
            try { manager.registerKey(name); } catch (error) { }
        });
    }

    var input = { actionFor: actionFor, registerMediaKeys: registerMediaKeys };
    if (typeof module !== 'undefined' && module.exports) module.exports = input;
    else root.ImmichWallInput = input;
}(typeof window === 'undefined' ? globalThis : window));
