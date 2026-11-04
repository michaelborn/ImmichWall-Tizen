(function (root) {
    'use strict';

    var DEFAULT_SETTINGS = Object.freeze({
        source: 'all',
        albumId: '',
        interval: 300,
        fit: 'cover'
    });
    var ALLOWED_INTERVALS = Object.freeze([10, 30, 60, 300, 600, 1800, 3600]);
    var SETTINGS_KEY = 'immich-wall-settings';
    var MAX_HISTORY = 20;

    function loadSettings(storage) {
        var settings;
        try {
            var stored = JSON.parse(storage.getItem(SETTINGS_KEY) || '{}');
            settings = Object.assign({}, DEFAULT_SETTINGS, stored);
        } catch (error) {
            settings = Object.assign({}, DEFAULT_SETTINGS);
        }
        if (ALLOWED_INTERVALS.indexOf(settings.interval) === -1) settings.interval = DEFAULT_SETTINGS.interval;
        return settings;
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
        var limit = maxHistory == null ? MAX_HISTORY : maxHistory;
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
        var cap = maximum == null ? 300000 : maximum;
        return Math.min(currentDelay * 2, cap);
    }

    var api = {
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        ALLOWED_INTERVALS: ALLOWED_INTERVALS,
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
