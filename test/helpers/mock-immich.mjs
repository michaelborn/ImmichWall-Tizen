import { createServer } from 'node:http';

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function uuid(value) {
    return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function makeAsset(index) {
    return {
        id: uuid(index + 1),
        originalFileName: `test-photo-${String(index + 1).padStart(4, '0')}.jpg`,
        originalMimeType: 'image/jpeg',
        width: 1920,
        height: 1080,
        fileCreatedAt: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
        createdAt: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
        isFavorite: index % 4 === 0,
        resized: true,
    };
}

function sendJson(response, status, data) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
}

async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMockImmich({ apiKey = 'test-api-key', version = 'v-test.0' } = {}) {
    const assets = Array.from({ length: 225 }, (_, index) => makeAsset(index));
    const albumIds = {
        regular: uuid(9001),
        empty: uuid(9002),
        large: uuid(9003),
    };
    const state = {
        searchMode: 'ok',
        thumbnailMode: 'ok',
        pingMode: 'ok',
        searchDelayMs: 0,
        thumbnailDelayMs: 0,
        requestLog: [],
        searchBodies: [],
    };

    const albums = [
        {
            id: albumIds.regular,
            albumName: 'Weekend at the Lake',
            assetCount: 8,
            albumThumbnailAssetId: assets[0].id,
        },
        {
            id: albumIds.empty,
            albumName: 'Empty album',
            assetCount: 0,
            albumThumbnailAssetId: null,
        },
        {
            id: albumIds.large,
            albumName: 'Entire library album',
            assetCount: assets.length,
            albumThumbnailAssetId: assets[0].id,
        },
    ];

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://mock-immich.local');

        if (url.pathname === '/__control' && request.method === 'POST') {
            try {
                const changes = await readJson(request);
                for (const key of ['searchMode', 'thumbnailMode', 'pingMode', 'searchDelayMs', 'thumbnailDelayMs']) {
                    if (Object.hasOwn(changes, key)) state[key] = changes[key];
                }
                if (changes.resetRequests) {
                    state.requestLog = [];
                    state.searchBodies = [];
                }
                return sendJson(response, 200, state);
            } catch {
                return sendJson(response, 400, { error: 'Invalid mock control payload.' });
            }
        }

        if (url.pathname === '/__state' && request.method === 'GET') {
            return sendJson(response, 200, state);
        }

        state.requestLog.push({
            method: request.method,
            path: url.pathname,
            hasApiKey: request.headers['x-api-key'] === apiKey,
        });
        if (request.headers['x-api-key'] !== apiKey) {
            return sendJson(response, 401, { message: 'Unauthorized' });
        }

        if (url.pathname === '/api/server/ping' && request.method === 'GET') {
            if (state.pingMode === 'reset') return request.socket.destroy();
            if (state.pingMode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1000));
            if (state.pingMode === 'auth') return sendJson(response, 401, { message: 'Unauthorized' });
            return sendJson(response, 200, { res: 'pong' });
        }

        if (url.pathname === '/api/server/about' && request.method === 'GET') {
            return sendJson(response, 200, { version });
        }

        if (url.pathname === '/api/albums' && request.method === 'GET') {
            return sendJson(response, 200, albums);
        }

        if (url.pathname === '/api/search/metadata' && request.method === 'POST') {
            if (state.searchDelayMs) await new Promise((resolve) => setTimeout(resolve, state.searchDelayMs));
            if (state.searchMode === 'reset') return request.socket.destroy();
            if (state.searchMode === 'auth') return sendJson(response, 401, { message: 'Unauthorized' });
            if (state.searchMode === 'error') return sendJson(response, 500, { message: 'Mock Immich failure' });
            if (state.searchMode === 'invalid-json') {
                response.writeHead(200, { 'content-type': 'application/json' });
                return response.end('{invalid-json');
            }

            let body;
            try {
                body = await readJson(request);
            } catch {
                return sendJson(response, 400, { message: 'Invalid search body' });
            }
            state.searchBodies.push(body);
            if (body.type !== 'IMAGE') return sendJson(response, 400, { message: 'Expected image search' });

            let candidates = assets;
            if (body.isFavorite === true) candidates = candidates.filter((asset) => asset.isFavorite);
            if (Array.isArray(body.albumIds)) {
                if (body.albumIds.includes(albumIds.regular)) candidates = assets.slice(0, 8);
                else if (body.albumIds.includes(albumIds.large)) candidates = assets;
                else candidates = [];
            }
            if (state.searchMode === 'empty') candidates = [];
            if (state.searchMode === 'single') candidates = candidates.slice(0, 1);

            const pageSize = Math.max(1, Math.min(Number(body.size) || 100, 500));
            const page = Math.max(1, Number(body.page) || 1);
            const start = (page - 1) * pageSize;
            const items = candidates.slice(start, start + pageSize);
            return sendJson(response, 200, {
                albums: { total: 0, count: 0, items: [], facets: [] },
                assets: {
                    total: candidates.length,
                    count: items.length,
                    items,
                    facets: [],
                    nextPage: start + pageSize < candidates.length ? page + 1 : null,
                },
            });
        }

        const thumbnailMatch = url.pathname.match(/^\/api\/assets\/([\da-f-]{36})\/thumbnail$/i);
        if (thumbnailMatch && request.method === 'GET') {
            if (state.thumbnailDelayMs) await new Promise((resolve) => setTimeout(resolve, state.thumbnailDelayMs));
            if (state.thumbnailMode === 'reset') return request.socket.destroy();
            if (state.thumbnailMode === 'auth') return sendJson(response, 401, { message: 'Unauthorized' });
            if (state.thumbnailMode === 'error') return sendJson(response, 500, { message: 'Mock thumbnail failure' });
            if (state.thumbnailMode === 'missing' || !assets.some((asset) => asset.id === thumbnailMatch[1])) {
                return sendJson(response, 404, { message: 'Asset missing' });
            }
            response.writeHead(200, {
                'content-type': 'image/png',
                'cache-control': 'private, max-age=60',
            });
            return response.end(state.thumbnailMode === 'corrupt' ? Buffer.from('not an image') : PNG);
        }

        return sendJson(response, 404, { message: 'Not found' });
    });

    server.mockState = state;
    server.albumIds = albumIds;
    server.assets = assets;
    return server;
}
