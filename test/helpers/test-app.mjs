import { fileURLToPath } from 'node:url';
import { createApp } from '../../scripts/server.mjs';
import { createMockImmich } from './mock-immich.mjs';
import { close, listen } from './servers.mjs';

const webRoot = fileURLToPath(new URL('../../desktop/', import.meta.url));

export async function startTestApp({
    apiKey = 'test-api-key',
    configured = true,
    immichTimeoutMs = 1000,
    random = () => 0,
} = {}) {
    const mock = createMockImmich({ apiKey });
    const upstreamUrl = await listen(mock);
    const app = createApp({
        immichBaseUrl: configured ? upstreamUrl : '',
        immichApiKey: configured ? apiKey : '',
        webRoot,
        immichTimeoutMs,
        random,
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
