import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PairingService } from '../../services/pairingService.mjs';
import { startTestApp } from '../helpers/test-app.mjs';

let fixture;

describe('TV pairing API and phone page', () => {
    before(async () => {
        let sessionNumber = 0;
        let pinNumber = 0;
        let tokenNumber = 0;
        const pairingService = new PairingService({
            makeSessionId: () => `test-session-${++sessionNumber}`,
            makePin: () => String(pinNumber++).padStart(5, '0'),
            makeToken: () => `test-handoff-${String(++tokenNumber).padStart(32, '0')}`,
        });
        fixture = await startTestApp({ pairingService });
    });

    after(async () => fixture.close());

    it('serves the phone pairing page with no-store caching', async () => {
        const response = await fetch(fixture.baseUrl + '/pair');
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /Connect your TV/);
        assert.match(response.headers.get('cache-control'), /no-store/);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    });

    it('creates a TV session and transfers credentials only to its polling TV', async () => {
        const createdResponse = await fetch(fixture.baseUrl + '/api/pairing/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        const created = await createdResponse.json();
        assert.equal(createdResponse.status, 201);
        assert.match(created.pin, /^\d{5}$/);
        assert.ok(created.sessionId);

        const verifiedResponse = await fetch(fixture.baseUrl + '/api/pairing/verify-pin', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'pairing-test-phone' },
            body: JSON.stringify({ pin: created.pin }),
        });
        assert.equal(verifiedResponse.status, 200);
        const stillWaiting = await fetch(fixture.baseUrl + `/api/pairing/sessions/${created.sessionId}`).then((response) => response.json());
        assert.equal(stillWaiting.state, 'waiting');

        const badVerify = await fetch(fixture.baseUrl + '/api/pairing/verify-pin', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'pairing-test-phone' },
            body: JSON.stringify({ pin: '99999' }),
        });
        assert.equal(badVerify.status, 401);

        const phoneResponse = await fetch(fixture.baseUrl + '/api/pairing/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'pairing-test-phone' },
            body: JSON.stringify({ pin: created.pin, serverUrl: fixture.upstreamUrl, apiKey: 'phone-submitted-key' }),
        });
        const handoff = await phoneResponse.json();
        assert.equal(phoneResponse.status, 200);
        assert.ok(handoff.handoffToken);
        assert.doesNotMatch(JSON.stringify(handoff), /phone-submitted-key/);

        const tvStatus = await fetch(fixture.baseUrl + `/api/pairing/sessions/${created.sessionId}`).then((response) => response.json());
        assert.equal(tvStatus.state, 'claimed');
        assert.equal(tvStatus.apiKey, 'phone-submitted-key');

        const updateResponse = await fetch(fixture.baseUrl + '/api/pairing/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ handoffToken: handoff.handoffToken, serverUrl: fixture.upstreamUrl, apiKey: 'corrected-key' }),
        });
        assert.equal(updateResponse.status, 200);
        const corrected = await fetch(fixture.baseUrl + `/api/pairing/sessions/${created.sessionId}`).then((response) => response.json());
        assert.equal(corrected.apiKey, 'corrected-key');

        const tvError = await fetch(fixture.baseUrl + '/api/pairing/session-error', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: created.sessionId, revision: corrected.revision, message: 'Immich rejected the API key' }),
        });
        assert.equal(tvError.status, 200);
        const errorStatus = await fetch(fixture.baseUrl + '/api/pairing/handoff-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ handoffToken: handoff.handoffToken }),
        }).then((response) => response.json());
        assert.equal(errorStatus.state, 'error');
        assert.equal(errorStatus.message, 'Immich rejected the API key');

        const staleError = await fetch(fixture.baseUrl + '/api/pairing/session-error', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: created.sessionId, revision: 999, message: 'stale' }),
        }).then((response) => response.json());
        assert.deepEqual(staleError, { reported: false });

        const staleAck = await fetch(fixture.baseUrl + '/api/pairing/acknowledge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: created.sessionId, revision: tvStatus.revision }),
        });
        assert.equal(staleAck.status, 409);

        const finalAck = await fetch(fixture.baseUrl + '/api/pairing/acknowledge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: created.sessionId, revision: corrected.revision }),
        });
        assert.equal(finalAck.status, 200);
        const completed = await fetch(fixture.baseUrl + `/api/pairing/sessions/${created.sessionId}`).then((response) => response.json());
        assert.deepEqual(completed, { state: 'acknowledged' });

        const acknowledgedStatus = await fetch(fixture.baseUrl + '/api/pairing/handoff-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ handoffToken: handoff.handoffToken }),
        }).then((response) => response.json());
        assert.equal(acknowledgedStatus.state, 'acknowledged');
    });

    it('locks out a browser after five failed PIN submissions and returns Retry-After', async () => {
        const created = await fetch(fixture.baseUrl + '/api/pairing/sessions', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        }).then((response) => response.json());
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = await fetch(fixture.baseUrl + '/api/pairing/claim', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'user-agent': 'locked-browser' },
                body: JSON.stringify({ pin: '99999', serverUrl: fixture.upstreamUrl, apiKey: 'unused-key' }),
            });
            assert.equal(response.status, attempt === 4 ? 429 : 401);
        }
        const blocked = await fetch(fixture.baseUrl + '/api/pairing/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'locked-browser' },
            body: JSON.stringify({ pin: created.pin, serverUrl: fixture.upstreamUrl, apiKey: 'unused-key' }),
        });
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.headers.get('retry-after')) > 0);

        const differentBrowser = await fetch(fixture.baseUrl + '/api/pairing/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'different-browser' },
            body: JSON.stringify({ pin: created.pin, serverUrl: fixture.upstreamUrl, apiKey: 'valid-key' }),
        });
        assert.equal(differentBrowser.status, 200);
    });
});
