import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createApp, loadConfig } from '../../scripts/server.mjs';
import { close, listen } from '../helpers/servers.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('read-only smoke test against the configured live Immich instance', {
    skip: process.env.LIVE_IMMICH !== '1' && 'Set LIVE_IMMICH=1 to opt in to local Immich smoke tests.',
}, async (t) => {
    const config = await loadConfig({ envFilePath: resolve(root, '.env') });
    assert.ok(config.immichBaseUrl, 'IMMICH_SERVER_URL is required');
    assert.ok(config.immichApiKey, 'IMMICH_API_KEY is required');

    const app = createApp({ ...config, webRoot: resolve(root, 'desktop') });
    const baseUrl = await listen(app);
    t.after(() => close(app));

    const statusResponse = await fetch(baseUrl + '/api/status');
    if (statusResponse.status === 502) {
        t.skip('The configured local Immich host is unreachable from this machine.');
        return;
    }
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.connected, true);
    assert.match(status.version, /^v/);

    const albumsResponse = await fetch(baseUrl + '/api/albums');
    assert.equal(albumsResponse.status, 200);
    const albums = await albumsResponse.json();
    assert.ok(Array.isArray(albums));

    for (const source of ['all', 'favorites']) {
        const response = await fetch(`${baseUrl}/api/photos/random?source=${source}`);
        assert.equal(response.status, 200, `${source} search should return an asset`);
        const asset = await response.json();
        const thumbnail = await fetch(`${baseUrl}/api/photos/${asset.id}/thumbnail`);
        assert.equal(thumbnail.status, 200);
        assert.match(thumbnail.headers.get('content-type'), /^image\//);
        await thumbnail.arrayBuffer();
    }

    if (albums.length) {
        const response = await fetch(`${baseUrl}/api/photos/random?source=album&albumId=${albums[0].id}`);
        assert.equal(response.status, 200);
    }
});
