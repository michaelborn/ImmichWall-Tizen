import assert from 'node:assert/strict';
import test from 'node:test';
import State from '../../desktop/state.js';

test('loads defaults and overlays saved preferences', () => {
    const storage = { getItem: () => JSON.stringify({ interval: 10, fit: 'contain' }) };
    assert.deepEqual(State.loadSettings(storage), {
        source: 'all',
        albumId: '',
        interval: 10,
        fit: 'contain',
    });
});

test('corrupt preferences recover to defaults', () => {
    assert.deepEqual(State.loadSettings({ getItem: () => '{broken' }), State.DEFAULT_SETTINGS);
});

test('uses distinct source keys for selected albums', () => {
    assert.equal(State.sourceKey('all', ''), 'all');
    assert.equal(State.sourceKey('favorites', ''), 'favorites');
    assert.equal(State.sourceKey('album', 'album-a'), 'album:album-a');
});

test('formats valid dates and safely ignores missing or invalid dates', () => {
    assert.match(State.formatDate('2025-02-03T00:00:00.000Z', 'en-US'), /2025/);
    assert.equal(State.formatDate('not-a-date'), '');
    assert.equal(State.formatDate(null), '');
});

test('history append truncates forward entries after Previous', () => {
    const first = { id: 'first' };
    const second = { id: 'second' };
    const third = { id: 'third' };
    const result = State.appendHistory([first, second, third], 0, { id: 'replacement' });
    assert.deepEqual(result.history.map((entry) => entry.id), ['first', 'replacement']);
    assert.equal(result.index, 1);
    assert.deepEqual(result.removed, [second, third]);
});

test('history remains bounded and reports evicted entries for cleanup', () => {
    const history = [{ id: 'a' }, { id: 'b' }];
    const result = State.appendHistory(history, 1, { id: 'c' }, 2);
    assert.deepEqual(result.history.map((entry) => entry.id), ['b', 'c']);
    assert.equal(result.index, 1);
    assert.deepEqual(result.removed.map((entry) => entry.id), ['a']);
});

test('previousIndex stops at the beginning of history', () => {
    assert.equal(State.previousIndex(0), -1);
    assert.equal(State.previousIndex(1), 0);
});

test('retry delay doubles and respects its cap', () => {
    assert.equal(State.nextRetryDelay(30000), 60000);
    assert.equal(State.nextRetryDelay(250000), 300000);
    assert.equal(State.nextRetryDelay(300000), 300000);
});
