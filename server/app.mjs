import express from 'express';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImmichConfigError } from '../config/immich.js';
import { createImmichController } from '../controllers/immichController.mjs';
import { createPairingController } from '../controllers/pairingController.mjs';
import { createApiRouter } from '../routes/api.mjs';
import { createPairingRouter } from '../routes/pairing.mjs';
import { ImmichHttpError, ImmichService } from '../services/immichService.mjs';
import { PairingError, PairingService } from '../services/pairingService.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function errorStatus(error) {
    return error.status ?? (error.type === 'entity.too.large' ? 413 : (error.type === 'entity.parse.failed' ? 400 : 502));
}

function errorMessage(error) {
    if (error instanceof ImmichHttpError || error instanceof ImmichConfigError || error instanceof PairingError) return error.message;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'The request to Immich timed out.';
    if (error.type === 'entity.parse.failed') return 'Enter a valid JSON request body.';
    if (error.type === 'entity.too.large') return 'Request body is too large.';
    if (error instanceof SyntaxError) return 'Immich returned an unreadable response.';
    return 'Could not connect to Immich. Check the server URL and network.';
}

export function createExpressApp({
    immichBaseUrl = '',
    immichApiKey = '',
    pairingBaseUrl = process.env.PAIRING_BASE_URL ?? '',
    defaultImmichServerUrl = '',
    webRoot = resolve(PROJECT_ROOT, 'frontend'),
    pairRoot = resolve(PROJECT_ROOT, 'pair'),
    fetchImpl = fetch,
    random = Math.random,
    immichTimeoutMs = 25000,
    pairingService = new PairingService(),
} = {}) {
    const resolvedWebRoot = resolve(webRoot);
    const resolvedPairRoot = resolve(pairRoot);
    const service = new ImmichService({ immichBaseUrl, immichApiKey, fetchImpl, random, timeoutMs: immichTimeoutMs });
    const controller = createImmichController(service, { pairingBaseUrl, defaultImmichServerUrl });
    const pairingController = createPairingController(pairingService);
    const app = express();

    app.disable('x-powered-by');
    app.use((request, response, next) => {
        response.set('x-content-type-options', 'nosniff');
        next();
    });

    app.use((request, response, next) => {
        const allowed = request.method === 'GET'
            || request.method === 'HEAD'
            || (request.method === 'POST' && ['/api/connect', '/api/disconnect', '/api/pairing/sessions', '/api/pairing/verify-pin', '/api/pairing/claim', '/api/pairing/update', '/api/pairing/handoff-status', '/api/pairing/session-error', '/api/pairing/acknowledge'].includes(request.path));
        if (allowed) return next();
        return next(new ImmichHttpError(405, 'Method not allowed.'));
    });

    app.use(express.json({ limit: '8kb', strict: true }));
    app.use('/api', createApiRouter(controller));
    app.use('/api/pairing', createPairingRouter(pairingController));
    app.use('/api', (request, response, next) => next(new ImmichHttpError(404, 'API route not found.')));

    app.use('/pair', express.static(resolvedPairRoot, {
        dotfiles: 'deny',
        etag: false,
        fallthrough: true,
        index: 'index.html',
        setHeaders(response) {
            response.setHeader('cache-control', 'no-store');
            response.setHeader('x-content-type-options', 'nosniff');
            response.setHeader('referrer-policy', 'no-referrer');
            response.setHeader('content-security-policy', "default-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        },
    }));

    app.use((request, response, next) => {
        let decodedPath;
        try {
            decodedPath = decodeURIComponent(request.originalUrl.split('?')[0]);
        } catch {
            return next(new ImmichHttpError(400, 'Malformed path.'));
        }
        const candidate = resolve(resolvedWebRoot, decodedPath === '/' ? 'index.html' : decodedPath.slice(1));
        if (!candidate.startsWith(resolvedWebRoot + sep)) return next(new ImmichHttpError(403, 'Forbidden.'));
        next();
    });

    app.use(express.static(resolvedWebRoot, {
        dotfiles: 'deny',
        etag: false,
        fallthrough: true,
        index: 'index.html',
        setHeaders(response) {
            response.setHeader('cache-control', 'no-store');
            response.setHeader('x-content-type-options', 'nosniff');
        },
    }));
    app.use((request, response, next) => next(new ImmichHttpError(404, 'Not found.')));
    app.use((error, request, response, next) => {
        if (response.headersSent) return next(error);
        if (error.retryAfterSeconds) response.set('retry-after', String(error.retryAfterSeconds));
        response.status(errorStatus(error)).json({ error: errorMessage(error) });
    });

    app.immichService = service;
    app.pairingService = pairingService;
    return app;
}

export function createHttpServer(options = {}) {
    return createServer(createExpressApp(options));
}
