import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../scripts/server.mjs';
import { createMockImmich } from '../helpers/mock-immich.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mockHost = '127.0.0.1';
const mockPort = 41781;
const appHost = '127.0.0.1';
const appPort = 41780;
const mock = createMockImmich({ apiKey: 'playwright-test-key' });
const app = createApp({
    immichBaseUrl: `http://${mockHost}:${mockPort}`,
    immichApiKey: 'playwright-test-key',
    webRoot: resolve(root, 'desktop'),
});

await new Promise((resolveListen, reject) => {
    mock.once('error', reject);
    mock.listen(mockPort, mockHost, resolveListen);
});
await new Promise((resolveListen, reject) => {
    app.once('error', reject);
    app.listen(appPort, appHost, resolveListen);
});
console.log(`E2E Immich mock and app ready on ${mockPort} / ${appPort}.`);

async function shutdown() {
    app.closeAllConnections?.();
    mock.closeAllConnections?.();
    await Promise.all([
        new Promise((resolveClose) => app.close(resolveClose)),
        new Promise((resolveClose) => mock.close(resolveClose)),
    ]);
    process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
