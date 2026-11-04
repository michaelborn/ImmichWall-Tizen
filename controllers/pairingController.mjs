import { PairingError } from '../services/pairingService.mjs';

function requireObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PairingError(400, 'Enter valid pairing details.');
    return body;
}

function browserKey(request) {
    return `${request.ip ?? request.socket.remoteAddress ?? 'unknown'}\n${request.get('user-agent') ?? ''}`;
}

export function createPairingController(service) {
    return {
        createSession(request, response) {
            response.status(201).json(service.createSession());
        },

        verify(request, response) {
            const body = requireObject(request.body);
            response.json(service.verifyPin(body, browserKey(request)));
        },

        claim(request, response) {
            const body = requireObject(request.body);
            response.json(service.claim(body, browserKey(request)));
        },

        tvStatus(request, response) {
            response.json(service.getTvSession(request.params.sessionId));
        },

        update(request, response) {
            response.json(service.updateConnection(requireObject(request.body)));
        },

        handoffStatus(request, response) {
            const body = requireObject(request.body);
            response.json(service.getHandoffStatus(body.handoffToken));
        },

        tvError(request, response) {
            response.json(service.reportTvError(requireObject(request.body)));
        },

        acknowledge(request, response) {
            const body = requireObject(request.body);
            response.json(service.acknowledge(body.sessionId, body.revision));
        },
    };
}
