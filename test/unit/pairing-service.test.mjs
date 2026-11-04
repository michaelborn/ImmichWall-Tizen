import assert from 'node:assert/strict';
import test from 'node:test';
import { PairingError, PairingService } from '../../services/pairingService.mjs';

function fixture() {
    let now = 1_000_000;
    let sessionNumber = 0;
    let tokenNumber = 0;
    let pinNumber = 0;
    const service = new PairingService({
        now: () => now,
        makeSessionId: () => `session-${++sessionNumber}`,
        makeToken: () => `handoff-token-${String(++tokenNumber).padStart(32, '0')}`,
        makePin: () => String(pinNumber++).padStart(5, '0'),
    });
    return { service, advance: (milliseconds) => { now += milliseconds; } };
}

test('pairing claims one PIN, supports phone corrections, and erases credentials after TV acknowledgement', () => {
    const { service } = fixture();
    const tv = service.createSession();
    assert.equal(tv.pin, '00000');
    assert.deepEqual(service.getTvSession(tv.sessionId), { state: 'waiting', expiresAt: tv.expiresAt });

    assert.deepEqual(service.verifyPin({ pin: tv.pin }, 'browser-a'), { verified: true });
    assert.equal(service.getTvSession(tv.sessionId).state, 'waiting', 'verifying does not consume the PIN or require credentials');

    const claim = service.claim({
        pin: tv.pin,
        serverUrl: 'https://photos.example.test/',
        apiKey: 'first-read-only-key',
    }, 'browser-a');
    assert.equal(Object.hasOwn(claim, 'apiKey'), false);
    assert.equal(service.getTvSession(tv.sessionId).apiKey, 'first-read-only-key');
    assert.throws(() => service.claim({ pin: tv.pin, serverUrl: 'https://photos.example.test', apiKey: 'another-key' }, 'browser-b'), (error) => error.status === 401);

    service.updateConnection({
        handoffToken: claim.handoffToken,
        serverUrl: 'https://photos.example.test:444',
        apiKey: 'corrected-read-only-key',
    });
    const updated = service.getTvSession(tv.sessionId);
    assert.equal(updated.revision, 2);
    assert.equal(updated.serverUrl, 'https://photos.example.test:444');
    assert.equal(updated.apiKey, 'corrected-read-only-key');
    assert.throws(() => service.acknowledge(tv.sessionId, 1), (error) => error instanceof PairingError && error.status === 409);

    assert.deepEqual(service.acknowledge(tv.sessionId, 2), { acknowledged: true });
    assert.equal(service.sessions.get(tv.sessionId).apiKey, '');
    assert.equal(service.sessions.get(tv.sessionId).serverUrl, '');
    assert.deepEqual(service.getTvSession(tv.sessionId), { state: 'acknowledged' });
    assert.deepEqual(service.getHandoffStatus(claim.handoffToken), { state: 'acknowledged', expiresAt: claim.expiresAt });
    assert.throws(() => service.updateConnection({
        handoffToken: claim.handoffToken,
        serverUrl: 'https://photos.example.test',
        apiKey: 'late-key',
    }), (error) => error.status === 410);
});

test('five wrong PIN attempts block one browser key without consuming another TV PIN', () => {
    const { service } = fixture();
    const firstTv = service.createSession();
    const secondTv = service.createSession();

    for (let attempt = 0; attempt < 4; attempt += 1) {
        assert.throws(() => service.claim({ pin: '99999' }, 'browser-a'), (error) => error.status === 401);
    }
    assert.throws(() => service.claim({ pin: '99999' }, 'browser-a'), (error) => error.status === 429);
    assert.throws(() => service.claim({ pin: secondTv.pin }, 'browser-a'), (error) => error.status === 429);

    const otherBrowser = service.claim({
        pin: secondTv.pin,
        serverUrl: 'https://photos.example.test',
        apiKey: 'other-key',
    }, 'browser-b');
    assert.ok(otherBrowser.handoffToken);
    assert.equal(service.getTvSession(firstTv.sessionId).state, 'waiting');
});

test('verify-pin shares the lockout state with claim and never consumes a valid PIN', () => {
    const { service } = fixture();
    const tv = service.createSession();
    for (let attempt = 0; attempt < 4; attempt += 1) {
        assert.throws(() => service.verifyPin({ pin: '99999' }, 'browser-a'), (error) => error.status === 401);
    }
    assert.throws(() => service.verifyPin({ pin: '99999' }, 'browser-a'), (error) => error.status === 429);
    assert.throws(() => service.verifyPin({ pin: tv.pin }, 'browser-a'), (error) => error.status === 429);
    assert.equal(service.getTvSession(tv.sessionId).state, 'waiting');
});

test('TV-reported validation errors reach the phone and clear on updates and acknowledgement', () => {
    const { service } = fixture();
    const tv = service.createSession();
    const claim = service.claim({ pin: tv.pin, serverUrl: 'https://photos.example.test', apiKey: 'bad-key' }, 'browser-a');

    const stale = service.reportTvError({ sessionId: tv.sessionId, revision: 99, message: 'stale report' });
    assert.deepEqual(stale, { reported: false });
    assert.deepEqual(service.getHandoffStatus(claim.handoffToken), { state: 'waiting', expiresAt: claim.expiresAt });

    assert.deepEqual(service.reportTvError({ sessionId: tv.sessionId, revision: 1, message: 'Immich returned HTTP 401' }), { reported: true });
    assert.deepEqual(service.getHandoffStatus(claim.handoffToken), {
        state: 'error',
        message: 'Immich returned HTTP 401',
        expiresAt: claim.expiresAt,
    });

    service.updateConnection({
        handoffToken: claim.handoffToken,
        serverUrl: 'https://photos.example.test',
        apiKey: 'fixed-key',
    });
    assert.deepEqual(service.getHandoffStatus(claim.handoffToken).state, 'waiting');

    service.reportTvError({ sessionId: tv.sessionId, revision: 2, message: 'still failing' });
    assert.throws(() => service.reportTvError({ sessionId: tv.sessionId, revision: 2, message: '   ' }), (error) => error.status === 400);
    assert.deepEqual(service.getHandoffStatus(claim.handoffToken).state, 'error');
    assert.deepEqual(service.acknowledge(tv.sessionId, 2), { acknowledged: true });
    assert.deepEqual(service.getHandoffStatus(claim.handoffToken).state, 'acknowledged');
});

test('PINs expire after five minutes and handoffs expire after one hour', () => {
    const { service, advance } = fixture();
    const expiredPin = service.createSession();
    advance(5 * 60 * 1000);
    assert.deepEqual(service.getTvSession(expiredPin.sessionId), { state: 'expired' });

    const tv = service.createSession();
    const claim = service.claim({
        pin: tv.pin,
        serverUrl: 'https://photos.example.test',
        apiKey: 'temporary-key',
    }, 'browser-a');
    advance(60 * 60 * 1000);
    assert.deepEqual(service.getTvSession(tv.sessionId), { state: 'expired' });
    assert.throws(() => service.getHandoffStatus(claim.handoffToken), (error) => error.status === 401);
});
