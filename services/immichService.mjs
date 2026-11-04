export class ImmichHttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export class ImmichService {
    constructor({
        immichBaseUrl = '',
        immichApiKey = '',
        fetchImpl = fetch,
        timeoutMs = 25000,
        random = Math.random,
        pageSize = 100,
    } = {}) {
        this.baseUrl = immichBaseUrl;
        this.apiKey = immichApiKey;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.random = random;
        this.pageSize = pageSize;
    }

    isConfigured() {
        return Boolean(this.baseUrl && this.apiKey);
    }

    getConnection() {
        return { immichBaseUrl: this.baseUrl, immichApiKey: this.apiKey };
    }

    setConnection({ immichBaseUrl, immichApiKey }) {
        this.baseUrl = immichBaseUrl;
        this.apiKey = immichApiKey;
    }

    disconnect() {
        this.baseUrl = '';
        this.apiKey = '';
    }

    async request(path, options = {}) {
        if (!this.isConfigured()) {
            throw new ImmichHttpError(503, 'Connect to your Immich server using the setup screen first.');
        }
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                'x-api-key': this.apiKey,
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                ...options.headers,
            },
            signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new ImmichHttpError(response.status, 'Immich rejected the API key or it lacks permission to search photos.');
            }
            if (response.status === 404) {
                throw new ImmichHttpError(404, 'The requested Immich resource was not found. It may have been removed.');
            }
            throw new ImmichHttpError(response.status, `Immich returned HTTP ${response.status}.`);
        }
        return response;
    }

    async searchMetadata(body) {
        const response = await this.request('/api/search/metadata', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        return response.json();
    }

    async checkPhotoAccess() {
        const result = await this.searchMetadata({ type: 'IMAGE', page: 1, size: 1 });
        if (!result.assets || !Array.isArray(result.assets.items)) {
            throw new ImmichHttpError(502, 'Immich returned an unexpected photo-search response.');
        }
        return result;
    }

    async getStatus() {
        await this.checkPhotoAccess();
        return { connected: true };
    }

    async listAlbums() {
        const response = await this.request('/api/albums');
        const albums = await response.json();
        return albums
            .filter((album) => Number(album.assetCount ?? 0) > 0)
            .map((album) => ({
                id: album.id,
                name: album.albumName ?? 'Untitled album',
                assetCount: Number(album.assetCount ?? 0),
                thumbnailAssetId: album.albumThumbnailAssetId ?? null,
            }));
    }

    async getRandomPhoto({ source = 'all', albumId = '', excludeId = '' } = {}) {
        if (!['all', 'favorites', 'album'].includes(source)) {
            throw new ImmichHttpError(400, 'Unknown photo source.');
        }
        if (source === 'album' && !/^[\da-f-]{36}$/i.test(albumId)) {
            throw new ImmichHttpError(400, 'Choose a valid album before starting the slideshow.');
        }

        const search = (page) => {
            const body = { type: 'IMAGE', page, size: this.pageSize };
            if (source === 'favorites') body.isFavorite = true;
            if (source === 'album') body.albumIds = [albumId];
            return this.searchMetadata(body);
        };

        const firstPage = await search(1);
        const total = Number(firstPage.assets?.total ?? firstPage.assets?.items?.length ?? 0);
        const pageCount = Math.max(1, Math.ceil(total / this.pageSize));
        const randomPage = Math.floor(this.random() * pageCount) + 1;
        const result = randomPage === 1 ? firstPage : await search(randomPage);
        const assets = result.assets?.items ?? [];
        if (!assets.length) throw new ImmichHttpError(404, 'No photos found for this source.');

        let candidates = assets;
        if (excludeId && assets.length > 1) {
            const withoutPrevious = assets.filter((asset) => asset.id !== excludeId);
            if (withoutPrevious.length) candidates = withoutPrevious;
        }
        const asset = candidates[Math.floor(this.random() * candidates.length)];
        return {
            id: asset.id,
            fileName: asset.originalFileName ?? 'Immich photo',
            width: asset.width ?? null,
            height: asset.height ?? null,
            date: asset.fileCreatedAt ?? asset.createdAt ?? null,
            favorite: Boolean(asset.isFavorite),
        };
    }

    async getThumbnail(assetId) {
        const response = await this.request(`/api/assets/${assetId}/thumbnail?size=preview&format=jpg`);
        return {
            bytes: Buffer.from(await response.arrayBuffer()),
            contentType: response.headers.get('content-type') ?? 'image/jpeg',
        };
    }
}
