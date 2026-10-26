(function (root) {
    'use strict';

    var DEFAULT_SETTINGS = Object.freeze({
        source: 'all',
        albumId: '',
        interval: 5,
        fit: 'cover'
    });
    var SETTINGS_KEY = 'immich-wall-desktop-settings';
    var MAX_HISTORY = 20;

    function loadSettings(storage) {
        try {
            var stored = JSON.parse(storage.getItem(SETTINGS_KEY) || '{}');
            return Object.assign({}, DEFAULT_SETTINGS, stored);
        } catch (error) {
            return Object.assign({}, DEFAULT_SETTINGS);
        }
    }

    function sourceKey(source, albumId) {
        return source === 'album' ? 'album:' + albumId : source;
    }

    function formatDate(value, locale) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
    }

    function appendHistory(history, historyIndex, entry, maxHistory) {
        var limit = maxHistory ?? MAX_HISTORY;
        var next = history.slice(0, historyIndex + 1);
        var removed = history.slice(historyIndex + 1);
        next.push(entry);
        while (next.length > limit) removed.push(next.shift());
        return { history: next, index: next.length - 1, removed: removed };
    }

    function previousIndex(index) {
        return index > 0 ? index - 1 : -1;
    }

    function nextRetryDelay(currentDelay, maximum) {
        return Math.min(currentDelay * 2, maximum ?? 300000);
    }

    var api = {
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        SETTINGS_KEY: SETTINGS_KEY,
        MAX_HISTORY: MAX_HISTORY,
        loadSettings: loadSettings,
        sourceKey: sourceKey,
        formatDate: formatDate,
        appendHistory: appendHistory,
        previousIndex: previousIndex,
        nextRetryDelay: nextRetryDelay
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ImmichWallState = api;
}(typeof window === 'undefined' ? globalThis : window));
