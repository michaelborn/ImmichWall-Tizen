#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp, loadConfig } from './server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function startServer({
    host = process.env.HOST ?? '127.0.0.1',
    port = Number(process.env.PORT ?? 4173),
    environment = process.env,
    envFilePath = resolve(root, '.env'),
} = {}) {
    const config = await loadConfig({ envFilePath, environment });
    const server = createApp({
        ...config,
        webRoot: resolve(root, 'desktop'),
    });

    await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolveListen);
    });
    return server;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
    const host = process.env.HOST ?? '127.0.0.1';
    const port = Number(process.env.PORT ?? 4173);
    try {
        const server = await startServer({ host, port });
        console.log(`Immich Wall desktop POC: http://${host}:${port}`);
        console.log('Immich credentials remain server-side; configuration is available in the app status.');
        const shutdown = () => server.close(() => process.exit(0));
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    } catch (error) {
        console.error(`Could not start Immich Wall: ${error.message}`);
        process.exitCode = 1;
    }
}
