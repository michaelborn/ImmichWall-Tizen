import assert from 'node:assert/strict';
import test from 'node:test';
import Input from '../../frontend/input.js';

test('maps Samsung media Play, Pause, and Play/Pause key codes to stable actions', () => {
    assert.equal(Input.actionFor({ keyCode: 415 }), 'play');
    assert.equal(Input.actionFor({ keyCode: 19 }), 'pause');
    assert.equal(Input.actionFor({ keyCode: 10252 }), 'toggle-pause');
    assert.equal(Input.actionFor({ key: 'MediaPlay' }), 'play');
    assert.equal(Input.actionFor({ key: 'MediaPause' }), 'pause');
    assert.equal(Input.actionFor({ key: 'MediaPlayPause' }), 'toggle-pause');
});

test('maps arrows, OK, Back, and shared keyboard shortcuts', () => {
    assert.equal(Input.actionFor({ keyCode: 37 }), 'previous');
    assert.equal(Input.actionFor({ keyCode: 39 }), 'next');
    assert.equal(Input.actionFor({ keyCode: 13 }), 'next');
    assert.equal(Input.actionFor({ keyCode: 10009 }), 'back');
    assert.equal(Input.actionFor({ key: 'Escape' }), 'back');
    assert.equal(Input.actionFor({ key: ' ' }), 'toggle-pause');
    assert.equal(Input.actionFor({ key: 's' }), 'open-settings');
    assert.equal(Input.actionFor({ key: 'i' }), 'details');
    assert.equal(Input.actionFor({ key: 'f' }), 'fullscreen');
    assert.equal(Input.actionFor({ key: 'x', keyCode: 88 }), '');
});

test('Up/Down opens settings only on the TV so desktop arrows stay free', () => {
    assert.equal(Input.actionFor({ keyCode: 38 }, true), 'open-settings');
    assert.equal(Input.actionFor({ keyCode: 40 }, true), 'open-settings');
    assert.equal(Input.actionFor({ keyCode: 38 }, false), '');
    assert.equal(Input.actionFor({ keyCode: 40 }, false), '');
});
