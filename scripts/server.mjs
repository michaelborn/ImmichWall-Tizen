import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

export function parseEnv(contents) {
    const values = {};
    for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match) continue;
        values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
}

export async function loadConfig({ envFilePath, environment = process.env } = {}) {
    let fileValues = {};
    if (envFilePath) {
        try {
            fileValues = parseEnv(await readFile(envFilePath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    return {
        immichBaseUrl: (environment.IMMICH_SERVER_URL ?? fileValues.IMMICH_SERVER_URL ?? '').replace(/\/+$/, ''),
        immichApiKey: environment.IMMICH_API_KEY ?? fileValues.IMMICH_API_KEY ?? '',
    };
}

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
};
const PAGE_SIZE = 100;

export function createApp({
    immichBaseUrl = '',
    immichApiKey = '',
    webRoot = resolve('desktop'),
    fetchImpl = fetch,
    random = Math.random,
    immichTimeoutMs = 25000,
} = {}) {
    const resolvedWebRoot = resolve(webRoot);

    function requireCredentials() {
        if (!immichBaseUrl || !immichApiKey) {
            throw new HttpError(503, 'Set IMMICH_SERVER_URL and IMMICH_API_KEY in the root .env file, then restart this app.');
        }
    }

    async function fetchImmich(path, options = {}) {
        requireCredentials();
        const response = await fetchImpl(`${immichBaseUrl}${path}`, {
            ...options,
            headers: {
                'x-api-key': immichApiKey,
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                ...options.headers,
            },
            signal: AbortSignal.timeout(immichTimeoutMs),
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new HttpError(response.status, 'Immich rejected the API key. Check the key in .env.');
            }
            if (response.status === 404) {
                throw new HttpError(404, 'The requested Immich resource was not found. It may have been removed.');
            }
            throw new HttpError(response.status, `Immich returned HTTP ${response.status}.`);
        }
        return response;
    }

    function sendJson(response, status, data) {
        response.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
        });
        response.end(JSON.stringify(data));
    }

    async function handleApi(request, response, url) {
        if (url.pathname === '/api/config' && request.method === 'GET') {
            return sendJson(response, 200, {
                configured: Boolean(immichBaseUrl && immichApiKey),
                serverUrl: immichBaseUrl,
            });
        }

        if (url.pathname === '/api/status' && request.method === 'GET') {
            const [pingResponse, aboutResponse] = await Promise.all([
                fetchImmich('/api/server/ping'),
                fetchImmich('/api/server/about'),
            ]);
            const [ping, about] = await Promise.all([pingResponse.json(), aboutResponse.json()]);
            return sendJson(response, 200, {
                connected: ping.res === 'pong',
                version: about.version ?? 'unknown',
            });
        }

        if (url.pathname === '/api/albums' && request.method === 'GET') {
            const upstream = await fetchImmich('/api/albums');
            const albums = await upstream.json();
            return sendJson(response, 200, albums
                .filter((album) => Number(album.assetCount ?? 0) > 0)
                .map((album) => ({
                    id: album.id,
                    name: album.albumName ?? 'Untitled album',
                    assetCount: Number(album.assetCount ?? 0),
                    thumbnailAssetId: album.albumThumbnailAssetId ?? null,
                })));
        }

        if (url.pathname === '/api/photos/random' && request.method === 'GET') {
            const source = url.searchParams.get('source') ?? 'all';
            const albumId = url.searchParams.get('albumId') ?? '';
            const excludeId = url.searchParams.get('exclude') ?? '';
            if (!['all', 'favorites', 'album'].includes(source)) {
                throw new HttpError(400, 'Unknown photo source.');
            }
            if (source === 'album' && !/^[\da-f-]{36}$/i.test(albumId)) {
                throw new HttpError(400, 'Choose a valid album before starting the slideshow.');
            }

            const search = async (page) => {
                const body = { type: 'IMAGE', page, size: PAGE_SIZE };
                if (source === 'favorites') body.isFavorite = true;
                if (source === 'album') body.albumIds = [albumId];
                const upstream = await fetchImmich('/api/search/metadata', {
                    method: 'POST',
                    body: JSON.stringify(body),
                });
                return upstream.json();
            };

            const firstPage = await search(1);
            const total = Number(firstPage.assets?.total ?? firstPage.assets?.items?.length ?? 0);
            const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
            const randomPage = Math.floor(random() * pageCount) + 1;
            const result = randomPage === 1 ? firstPage : await search(randomPage);
            const assets = result.assets?.items ?? [];
            if (!assets.length) throw new HttpError(404, 'No photos found for this source.');

            let candidates = assets;
            if (excludeId && assets.length > 1) {
                const withoutPrevious = assets.filter((asset) => asset.id !== excludeId);
                if (withoutPrevious.length) candidates = withoutPrevious;
            }
            const asset = candidates[Math.floor(random() * candidates.length)];
            return sendJson(response, 200, {
                id: asset.id,
                fileName: asset.originalFileName ?? 'Immich photo',
                width: asset.width ?? null,
                height: asset.height ?? null,
                date: asset.fileCreatedAt ?? asset.createdAt ?? null,
                favorite: Boolean(asset.isFavorite),
            });
        }

        const thumbnailMatch = url.pathname.match(/^\/api\/photos\/([\da-f-]{36})\/thumbnail$/i);
        if (thumbnailMatch && request.method === 'GET') {
            const upstream = await fetchImmich(
                `/api/assets/${thumbnailMatch[1]}/thumbnail?size=preview&format=jpg`,
            );
            const bytes = Buffer.from(await upstream.arrayBuffer());
            response.writeHead(200, {
                'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
                'content-length': bytes.length,
                'cache-control': 'private, max-age=3600',
                'x-content-type-options': 'nosniff',
            });
            return response.end(bytes);
        }

        throw new HttpError(404, 'API route not found.');
    }

    async function serveFile(request, response, pathname) {
        let relativePath;
        try {
            relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
        } catch {
            throw new HttpError(400, 'Malformed path.');
        }
        const filePath = resolve(resolvedWebRoot, relativePath);
        if (!filePath.startsWith(resolvedWebRoot + sep)) throw new HttpError(403, 'Forbidden.');

        let details;
        try {
            details = await stat(filePath);
        } catch {
            throw new HttpError(404, 'Not found.');
        }
        if (!details.isFile()) throw new HttpError(404, 'Not found.');

        response.writeHead(200, {
            'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
            'content-length': details.size,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
        });
        if (request.method === 'HEAD') return response.end();
        createReadStream(filePath).pipe(response);
    }

    return createServer(async (request, response) => {
        try {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                throw new HttpError(405, 'Method not allowed.');
            }
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname.startsWith('/api/')) {
                await handleApi(request, response, url);
            } else {
                await serveFile(request, response, url.pathname);
            }
        } catch (error) {
            if (response.headersSent) {
                response.destroy();
                return;
            }
            const status = error instanceof HttpError ? error.status : 502;
            const message = error instanceof HttpError
                ? error.message
                : (error.name === 'TimeoutError' || error.name === 'AbortError'
                    ? 'The request to Immich timed out.'
                    : (error instanceof SyntaxError
                        ? 'Immich returned an unreadable response.'
                        : 'Could not connect to Immich. Check the server URL and network.'));
            sendJson(response, status, { error: message });
        }
    });
}
