import express from 'express';

function asyncRoute(handler) {
    return function routeHandler(request, response, next) {
        Promise.resolve(handler(request, response, next)).catch(next);
    };
}

export function createApiRouter(controller) {
    const router = express.Router();
    router.use((request, response, next) => {
        response.set('cache-control', 'no-store');
        response.set('x-content-type-options', 'nosniff');
        next();
    });

    router.get('/config', controller.getConfig);
    router.post('/connect', asyncRoute(controller.connect));
    router.post('/disconnect', controller.disconnect);
    router.get('/status', asyncRoute(controller.status));
    router.get('/albums', asyncRoute(controller.albums));
    router.get('/photos/random', asyncRoute(controller.randomPhoto));
    router.get('/photos/:assetId/thumbnail', asyncRoute(controller.thumbnail));

    return router;
}
