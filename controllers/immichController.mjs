import { parseConnectionInput } from '../config/immich.js';
import { ImmichHttpError } from '../services/immichService.mjs';

export function createImmichController(service, { pairingBaseUrl = '', defaultImmichServerUrl = '' } = {}) {
    return {
        getConfig(request, response) {
            const connection = service.getConnection();
            response.json({
                configured: service.isConfigured(),
                serverUrl: connection.immichBaseUrl || defaultImmichServerUrl,
                pairingBaseUrl,
            });
        },

        async connect(request, response) {
            const nextConnection = parseConnectionInput(request.body);
            const previousConnection = service.getConnection();
            service.setConnection(nextConnection);
            try {
                await service.checkPhotoAccess();
                response.json({ configured: true, serverUrl: nextConnection.immichBaseUrl });
            } catch (error) {
                service.setConnection(previousConnection);
                throw error;
            }
        },

        disconnect(request, response) {
            service.disconnect();
            response.json({ configured: false, serverUrl: '' });
        },

        async status(request, response) {
            response.json(await service.getStatus());
        },

        async albums(request, response) {
            response.json(await service.listAlbums());
        },

        async randomPhoto(request, response) {
            response.json(await service.getRandomPhoto({
                source: request.query.source ?? 'all',
                albumId: request.query.albumId ?? '',
                excludeId: request.query.exclude ?? '',
            }));
        },

        async thumbnail(request, response) {
            if (!/^[\da-f-]{36}$/i.test(request.params.assetId)) {
                throw new ImmichHttpError(404, 'Photo not found.');
            }
            const thumbnail = await service.getThumbnail(request.params.assetId);
            response
                .status(200)
                .set('content-type', thumbnail.contentType)
                .set('content-length', String(thumbnail.bytes.length))
                .set('cache-control', 'private, max-age=3600')
                .send(thumbnail.bytes);
        },
    };
}
