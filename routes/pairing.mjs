import express from 'express';

export function createPairingRouter(controller) {
    const router = express.Router();
    router.use((request, response, next) => {
        response.set('cache-control', 'no-store');
        response.set('x-content-type-options', 'nosniff');
        next();
    });
    router.post('/sessions', controller.createSession);
    router.post('/verify-pin', controller.verify);
    router.post('/claim', controller.claim);
    router.get('/sessions/:sessionId', controller.tvStatus);
    router.post('/update', controller.update);
    router.post('/handoff-status', controller.handoffStatus);
    router.post('/session-error', controller.tvError);
    router.post('/acknowledge', controller.acknowledge);
    return router;
}
