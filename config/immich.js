import dotenv from 'dotenv';

export class ImmichConfigError extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
    }
}

export function parseEnv(contents) {
    return dotenv.parse(contents);
}

export async function loadImmichConfig({ envFilePath, environment = process.env } = {}) {
    let fileValues = {};
    if (envFilePath) {
        const fileEnvironment = {};
        const result = dotenv.config({
            path: envFilePath,
            processEnv: fileEnvironment,
            override: true,
            quiet: true,
        });
        if (result.error && result.error.code !== 'ENOENT') throw result.error;
        fileValues = result.parsed ?? fileEnvironment;
    }

    return {
        immichBaseUrl: normalizeImmichBaseUrl(environment.IMMICH_SERVER_URL ?? fileValues.IMMICH_SERVER_URL ?? ''),
        immichApiKey: environment.IMMICH_API_KEY ?? fileValues.IMMICH_API_KEY ?? '',
    };
}

export async function loadPublicImmichConfig({ envFilePath, environment = process.env } = {}) {
    let fileValues = {};
    if (envFilePath) {
        const fileEnvironment = {};
        const result = dotenv.config({
            path: envFilePath,
            processEnv: fileEnvironment,
            override: true,
            quiet: true,
        });
        if (result.error && result.error.code !== 'ENOENT') throw result.error;
        fileValues = result.parsed ?? fileEnvironment;
    }

    return {
        defaultImmichServerUrl: normalizeImmichBaseUrl(environment.IMMICH_SERVER_URL ?? fileValues.IMMICH_SERVER_URL ?? ''),
        pairingBaseUrl: normalizeImmichBaseUrl(environment.PAIRING_BASE_URL ?? fileValues.PAIRING_BASE_URL ?? ''),
    };
}

export function normalizeImmichBaseUrl(value) {
    return String(value ?? '').replace(/\/+$/, '');
}

export function parseConnectionInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ImmichConfigError('Enter a valid server URL and API key.');
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(body.serverUrl);
    } catch {
        throw new ImmichConfigError('Enter a valid Immich server URL.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
        throw new ImmichConfigError('Use an http(s) URL without embedded credentials, query, or fragment.');
    }
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 4096 || /[\r\n]/.test(body.apiKey)) {
        throw new ImmichConfigError('Enter a valid Immich API key.');
    }

    return {
        immichBaseUrl: normalizeImmichBaseUrl(parsedUrl.href),
        immichApiKey: body.apiKey.trim(),
    };
}
