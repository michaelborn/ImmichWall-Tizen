import { loadImmichConfig, parseEnv } from '../config/immich.js';
import { createHttpServer } from '../server/app.mjs';

// Stable compatibility facade used by the CLI and existing test helpers.
export { parseEnv };

export function createApp(options = {}) {
    return createHttpServer(options);
}

export function loadConfig(options = {}) {
    return loadImmichConfig(options);
}
