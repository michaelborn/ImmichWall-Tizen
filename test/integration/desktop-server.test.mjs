import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../scripts/desktop-server.mjs';
import { close } from '../helpers/servers.mjs';

test('production server entry point loads injected configuration and listens on an ephemeral port', async (t) => {
    const server = await startServer({
        host: '127.0.0.1',
        port: 0,
        environment: {
            IMMICH_SERVER_URL: 'http://immich.invalid///',
            IMMICH_API_KEY: 'entrypoint-test-key',
        },
        envFilePath: resolve('/tmp', 'immich-wall-missing-env-file'),
    });
    t.after(() => close(server));

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/config`);
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.serverUrl, 'http://immich.invalid');
    assert.equal(config.configured, true);
    assert.equal(Object.hasOwn(config, 'apiKey'), false);
});
