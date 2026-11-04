import { fileURLToPath } from 'node:url';
import { createApp } from '../../scripts/server.mjs';
import { createMockImmich } from './mock-immich.mjs';
import { close, listen } from './servers.mjs';

const webRoot = fileURLToPath(new URL('../../frontend/', import.meta.url));
const pairRoot = fileURLToPath(new URL('../../pair/', import.meta.url));

export async function startTestApp({
    apiKey = 'test-api-key',
    configured = true,
    immichTimeoutMs = 1000,
    random = () => 0,
    pairingService,
} = {}) {
    const mock = createMockImmich({ apiKey });
    const upstreamUrl = await listen(mock);
    const app = createApp({
        immichBaseUrl: configured ? upstreamUrl : '',
        immichApiKey: configured ? apiKey : '',
        webRoot,
        pairRoot,
        immichTimeoutMs,
        random,
        ...(pairingService ? { pairingService } : {}),
    });
    const baseUrl = await listen(app);
    return {
        app,
        baseUrl,
        mock,
        upstreamUrl,
        async close() {
            await close(app);
            await close(mock);
        },
    };
}
