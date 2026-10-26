import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { startTestApp } from '../helpers/test-app.mjs';
import { close } from '../helpers/servers.mjs';

let fixture;

async function json(path, options) {
    const response = await fetch(fixture.baseUrl + path, options);
    return { response, body: await response.json() };
}

async function resetMock() {
    Object.assign(fixture.mock.mockState, {
        searchMode: 'ok',
        thumbnailMode: 'ok',
        pingMode: 'ok',
        searchDelayMs: 0,
        thumbnailDelayMs: 0,
        requestLog: [],
        searchBodies: [],
    });
}

describe('desktop server routes', () => {
    before(async () => {
        fixture = await startTestApp({ immichTimeoutMs: 300, random: () => 0 });
    });

    after(async () => {
        await fixture.close();
    });

    beforeEach(async () => {
        await resetMock();
    });

    it('reports only safe configuration fields and never returns the API key', async () => {
        const { response, body } = await json('/api/config');
        assert.equal(response.status, 200);
        assert.equal(body.configured, true);
        assert.equal(body.serverUrl, fixture.upstreamUrl);
        assert.equal(Object.hasOwn(body, 'apiKey'), false);
        assert.match(response.headers.get('cache-control'), /no-store/);
    });

    it('proxies ping and about and returns the Immich version', async () => {
        const { response, body } = await json('/api/status');
        assert.equal(response.status, 200);
        assert.deepEqual(body, { connected: true, version: 'v-test.0' });
        assert.ok(fixture.mock.mockState.requestLog.every((request) => request.hasApiKey));
    });

    it('filters empty albums and normalizes album fields', async () => {
        const { response, body } = await json('/api/albums');
        assert.equal(response.status, 200);
        assert.equal(body.length, 2);
        assert.deepEqual(body[0], {
            id: fixture.mock.albumIds.regular,
            name: 'Weekend at the Lake',
            assetCount: 8,
            thumbnailAssetId: fixture.mock.assets[0].id,
        });
    });

    it('searches all photos and returns normalized asset metadata', async () => {
        const { response, body } = await json('/api/photos/random?source=all');
        assert.equal(response.status, 200);
        assert.equal(body.id, fixture.mock.assets[0].id);
        assert.equal(body.fileName, 'test-photo-0001.jpg');
        assert.equal(body.width, 1920);
        assert.equal(fixture.mock.mockState.searchBodies[0].type, 'IMAGE');
        assert.equal(fixture.mock.mockState.searchBodies[0].page, 1);
        assert.equal(fixture.mock.mockState.searchBodies[0].size, 100);
    });

    it('filters favorites upstream', async () => {
        const { response, body } = await json('/api/photos/random?source=favorites');
        assert.equal(response.status, 200);
        assert.equal(body.favorite, true);
        assert.equal(fixture.mock.mockState.searchBodies[0].isFavorite, true);
    });

    it('filters to a selected album upstream', async () => {
        const albumId = fixture.mock.albumIds.regular;
        const { response, body } = await json(`/api/photos/random?source=album&albumId=${albumId}`);
        assert.equal(response.status, 200);
        assert.ok(fixture.mock.assets.slice(0, 8).some((asset) => asset.id === body.id));
        assert.deepEqual(fixture.mock.mockState.searchBodies[0].albumIds, [albumId]);
    });

    it('avoids immediately returning the excluded asset when alternatives exist', async () => {
        const excluded = fixture.mock.assets[0].id;
        const { response, body } = await json(`/api/photos/random?source=all&exclude=${excluded}`);
        assert.equal(response.status, 200);
        assert.notEqual(body.id, excluded);
    });

    it('still returns the only candidate when it matches the exclusion', async () => {
        fixture.mock.mockState.searchMode = 'single';
        const onlyAsset = fixture.mock.assets[0].id;
        const { response, body } = await json(`/api/photos/random?source=all&exclude=${onlyAsset}`);
        assert.equal(response.status, 200);
        assert.equal(body.id, onlyAsset);
    });

    it('can request a later page for a large library', async (t) => {
        await t.after(fixture.close);
        fixture = await startTestApp({ immichTimeoutMs: 300, random: () => 0.999 });
        const { response, body } = await json('/api/photos/random?source=all');
        assert.equal(response.status, 200);
        assert.ok(body.id);
        assert.equal(fixture.mock.mockState.searchBodies.length, 2);
        assert.equal(fixture.mock.mockState.searchBodies[1].page, 3);
    });

    it('returns a useful 404 for a source with no images', async () => {
        const albumId = fixture.mock.albumIds.empty;
        const { response, body } = await json(`/api/photos/random?source=album&albumId=${albumId}`);
        assert.equal(response.status, 404);
        assert.match(body.error, /No photos found/);
    });

    it('rejects invalid source and album query values', async () => {
        const invalidSource = await json('/api/photos/random?source=videos');
        assert.equal(invalidSource.response.status, 400);
        assert.match(invalidSource.body.error, /Unknown photo source/);

        const invalidAlbum = await json('/api/photos/random?source=album&albumId=not-an-id');
        assert.equal(invalidAlbum.response.status, 400);
        assert.match(invalidAlbum.body.error, /valid album/);
    });

    it('proxies thumbnail bytes and preserves the upstream media type', async () => {
        const assetId = fixture.mock.assets[0].id;
        const response = await fetch(`${fixture.baseUrl}/api/photos/${assetId}/thumbnail`);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.ok(bytes.length > 40);
        assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    });

    it('does not proxy malformed or unknown thumbnail IDs', async () => {
        const before = fixture.mock.mockState.requestLog.length;
        const malformed = await fetch(`${fixture.baseUrl}/api/photos/not-a-uuid/thumbnail`);
        assert.equal(malformed.status, 404);
        assert.equal(fixture.mock.mockState.requestLog.length, before);

        const unknown = await json('/api/photos/00000000-0000-4000-8000-999999999999/thumbnail');
        assert.equal(unknown.response.status, 404);
    });

    it('returns safe errors for authentication, server, malformed JSON, and reset failures', async () => {
        fixture.mock.mockState.searchMode = 'auth';
        let result = await json('/api/photos/random?source=all');
        assert.equal(result.response.status, 401);
        assert.match(result.body.error, /rejected the API key/);
        assert.doesNotMatch(JSON.stringify(result.body), /test-api-key/);

        fixture.mock.mockState.searchMode = 'error';
        result = await json('/api/photos/random?source=all');
        assert.equal(result.response.status, 500);
        assert.match(result.body.error, /HTTP 500/);

        fixture.mock.mockState.searchMode = 'invalid-json';
        result = await json('/api/photos/random?source=all');
        assert.equal(result.response.status, 502);
        assert.match(result.body.error, /unreadable response/);

        fixture.mock.mockState.searchMode = 'reset';
        result = await json('/api/photos/random?source=all');
        assert.equal(result.response.status, 502);
        assert.match(result.body.error, /Could not connect/);
    });

    it('times out a stalled Immich request', async () => {
        fixture.mock.mockState.pingMode = 'slow';
        const { response, body } = await json('/api/status');
        assert.equal(response.status, 502);
        assert.match(body.error, /timed out/);
    });

    it('serves static assets with safe headers and handles HEAD', async () => {
        const page = await fetch(fixture.baseUrl + '/');
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /text\/html/);
        assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

        const css = await fetch(fixture.baseUrl + '/styles.css');
        assert.equal(css.status, 200);
        assert.match(css.headers.get('content-type'), /text\/css/);

        const head = await fetch(fixture.baseUrl + '/styles.css', { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(await head.text(), '');
    });

    it('blocks path traversal and unsupported HTTP methods', async () => {
        const traversal = await fetch(fixture.baseUrl + '/..%2F..%2F.env');
        assert.equal(traversal.status, 403);

        const method = await fetch(fixture.baseUrl + '/api/config', { method: 'POST' });
        assert.equal(method.status, 405);

        const missing = await fetch(fixture.baseUrl + '/unknown-route');
        assert.equal(missing.status, 404);
    });

    it('reports an unconfigured server without crashing', async (t) => {
        const unconfigured = await startTestApp({ configured: false });
        t.after(unconfigured.close);
        const config = await fetch(unconfigured.baseUrl + '/api/config').then((response) => response.json());
        assert.equal(config.configured, false);
        const status = await fetch(unconfigured.baseUrl + '/api/status');
        assert.equal(status.status, 503);
    });

    it('handles concurrent upstream requests without leaking request state', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () => json('/api/photos/random?source=all')));
        assert.ok(results.every((result) => result.response.status === 200));
        assert.ok(fixture.mock.mockState.searchBodies.every((body) => body.type === 'IMAGE'));
        assert.ok(fixture.mock.mockState.requestLog.every((request) => request.hasApiKey));
    });
});
