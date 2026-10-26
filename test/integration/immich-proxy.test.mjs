import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startTestApp } from '../helpers/test-app.mjs';

describe('local Immich proxy integration', () => {
    let fixture;

    before(async () => {
        fixture = await startTestApp();
    });

    after(async () => {
        await fixture.close();
    });

    it('serves the desktop shell, searches through Immich, and returns thumbnail bytes', async () => {
        const page = await fetch(fixture.baseUrl + '/');
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Immich Wall/);

        const search = await fetch(fixture.baseUrl + '/api/photos/random?source=all');
        assert.equal(search.status, 200);
        const asset = await search.json();
        assert.match(asset.id, /^[\da-f-]{36}$/i);

        const thumbnail = await fetch(`${fixture.baseUrl}/api/photos/${asset.id}/thumbnail`);
        assert.equal(thumbnail.status, 200);
        assert.match(thumbnail.headers.get('content-type'), /^image\//);
        assert.ok((await thumbnail.arrayBuffer()).byteLength > 40);
    });

    it('keeps the mock API key in the server-to-server request only', async () => {
        const config = await fetch(fixture.baseUrl + '/api/config').then((response) => response.json());
        assert.equal(Object.hasOwn(config, 'apiKey'), false);
        const status = await fetch(fixture.baseUrl + '/api/status').then((response) => response.json());
        assert.equal(status.connected, true);
        assert.ok(fixture.mock.mockState.requestLog.length > 0);
        assert.ok(fixture.mock.mockState.requestLog.every((request) => request.hasApiKey));
        assert.doesNotMatch(JSON.stringify(config), /test-api-key/);
    });
});
