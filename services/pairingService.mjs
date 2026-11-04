import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { parseConnectionInput } from '../config/immich.js';

const PIN_LIFETIME_MS = 5 * 60 * 1000;
const HANDOFF_LIFETIME_MS = 60 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_PIN_ATTEMPTS = 5;

export class PairingError extends Error {
    constructor(status, message, retryAfterSeconds = undefined) {
        super(message);
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export class PairingService {
    constructor({ now = Date.now, makeSessionId = randomUUID, makeToken = () => randomBytes(32).toString('base64url'), makePin = () => String(randomInt(0, 100000)).padStart(5, '0') } = {}) {
        this.now = now;
        this.makeSessionId = makeSessionId;
        this.makeToken = makeToken;
        this.makePin = makePin;
        this.sessions = new Map();
        this.handoffs = new Map();
        this.failures = new Map();
    }

    prune() {
        const now = this.now();
        for (const [id, session] of this.sessions) {
            const expiry = session.claimedAt === null ? session.expiresAt : session.handoffExpiresAt;
            if (expiry <= now) this.expireSession(id, session);
        }
        for (const [key, failure] of this.failures) {
            if (failure.expiresAt <= now) this.failures.delete(key);
        }
    }

    expireSession(id, session) {
        session.serverUrl = '';
        session.apiKey = '';
        session.pin = '';
        this.sessions.delete(id);
        if (session.handoffHash) this.handoffs.delete(session.handoffHash);
    }

    scheduleExpiry(session) {
        const service = this;
        const sessionId = session.id;
        const expiry = session.claimedAt === null ? session.expiresAt : session.handoffExpiresAt;
        const timer = setTimeout(function expire() {
            const current = service.sessions.get(sessionId);
            if (!current) return;
            const currentExpiry = current.claimedAt === null ? current.expiresAt : current.handoffExpiresAt;
            if (currentExpiry > service.now()) {
                service.scheduleExpiry(current);
                return;
            }
            service.expireSession(sessionId, current);
        }, Math.max(0, expiry - this.now()));
        if (typeof timer.unref === 'function') timer.unref();
    }

    createSession() {
        this.prune();
        let pin;
        do {
            pin = this.makePin();
        } while ([...this.sessions.values()].some((session) => session.pin === pin && session.claimedAt === null));

        const id = this.makeSessionId();
        const expiresAt = this.now() + PIN_LIFETIME_MS;
        this.sessions.set(id, {
            id,
            pin,
            expiresAt,
            claimedAt: null,
            handoffExpiresAt: null,
            serverUrl: '',
            apiKey: '',
            handoffHash: '',
            acknowledged: false,
            revision: 0,
            lastError: null,
        });
        this.scheduleExpiry(this.sessions.get(id));
        return { sessionId: id, pin, expiresAt };
    }

    annotateAttempts(browserKey) {
        const failure = this.failures.get(browserKey);
        if (failure?.blockedUntil > this.now()) {
            throw new PairingError(429, 'Too many incorrect PIN attempts. Try again later.', Math.ceil((failure.blockedUntil - this.now()) / 1000));
        }
    }

    recordFailedAttempt(browserKey) {
        const failure = this.failures.get(browserKey);
        const attempts = (failure?.attempts ?? 0) + 1;
        const blockedUntil = attempts >= MAX_PIN_ATTEMPTS ? this.now() + LOCKOUT_MS : 0;
        this.failures.set(browserKey, { attempts, blockedUntil, expiresAt: blockedUntil || this.now() + LOCKOUT_MS });
        if (blockedUntil) throw new PairingError(429, 'Too many incorrect PIN attempts. Try again later.', Math.ceil(LOCKOUT_MS / 1000));
        throw new PairingError(401, 'That PIN is incorrect or has expired. Check the TV and try again.');
    }

    findClaimableSession(pin) {
        return [...this.sessions.values()].find((candidate) => candidate.claimedAt === null && candidate.pin === pin && candidate.expiresAt > this.now());
    }

    verifyPin({ pin }, browserKey) {
        this.prune();
        this.annotateAttempts(browserKey);
        if (typeof pin !== 'string' || !/^\d{5}$/.test(pin)) throw new PairingError(400, 'Enter the five-digit PIN shown on the TV.');
        const session = this.findClaimableSession(pin);
        if (!session) this.recordFailedAttempt(browserKey);
        return { verified: true };
    }

    claim({ pin, serverUrl, apiKey }, browserKey) {
        this.prune();
        this.annotateAttempts(browserKey);

        if (typeof pin !== 'string' || !/^\d{5}$/.test(pin)) throw new PairingError(400, 'Enter the five-digit PIN shown on the TV.');
        const session = this.findClaimableSession(pin);
        if (!session) this.recordFailedAttempt(browserKey);

        const connection = parseConnectionInput({ serverUrl, apiKey });
        const handoffToken = this.makeToken();
        const handoffHash = createHash('sha256').update(handoffToken).digest('hex');
        session.pin = '';
        session.claimedAt = this.now();
        session.handoffExpiresAt = session.claimedAt + HANDOFF_LIFETIME_MS;
        session.serverUrl = connection.immichBaseUrl;
        session.apiKey = connection.immichApiKey;
        session.revision += 1;
        session.handoffHash = handoffHash;
        this.handoffs.set(handoffHash, session.id);
        this.failures.delete(browserKey);
        return { handoffToken, expiresAt: session.handoffExpiresAt };
    }

    updateConnection({ handoffToken, serverUrl, apiKey }) {
        this.prune();
        const session = this.getHandoff(handoffToken);
        if (session.acknowledged) throw new PairingError(410, 'This TV has already completed pairing.');
        const connection = parseConnectionInput({ serverUrl, apiKey });
        session.serverUrl = connection.immichBaseUrl;
        session.apiKey = connection.immichApiKey;
        session.revision += 1;
        session.lastError = null;
        return { updated: true, expiresAt: session.handoffExpiresAt };
    }

    getHandoffStatus(handoffToken) {
        this.prune();
        const session = this.getHandoff(handoffToken);
        if (session.acknowledged) return { state: 'acknowledged', expiresAt: session.handoffExpiresAt };
        if (session.lastError) return { state: 'error', message: session.lastError.message, expiresAt: session.handoffExpiresAt };
        return { state: 'waiting', expiresAt: session.handoffExpiresAt };
    }

    reportTvError({ sessionId, revision, message }) {
        this.prune();
        const session = this.sessions.get(sessionId);
        if (!session || session.claimedAt === null) throw new PairingError(410, 'The pairing session is missing or has expired.');
        if (session.acknowledged || session.revision !== revision) return { reported: false };
        const text = String(message ?? '').trim().slice(0, 300);
        if (!text) throw new PairingError(400, 'Describe the error the TV reported.');
        session.lastError = { message: text, revision: session.revision };
        return { reported: true };
    }

    getTvSession(sessionId) {
        this.prune();
        const session = this.sessions.get(sessionId);
        if (!session) return { state: 'expired' };
        if (session.acknowledged) return { state: 'acknowledged' };
        if (session.claimedAt === null) return { state: 'waiting', expiresAt: session.expiresAt };
        return {
            state: 'claimed',
            serverUrl: session.serverUrl,
            apiKey: session.apiKey,
            expiresAt: session.handoffExpiresAt,
            revision: session.revision,
        };
    }

    acknowledge(sessionId, revision) {
        this.prune();
        const session = this.sessions.get(sessionId);
        if (!session || session.claimedAt === null) throw new PairingError(410, 'The pairing session is missing or has expired.');
        if (revision !== session.revision) throw new PairingError(409, 'The connection changed. Check it again before completing pairing.');
        session.apiKey = '';
        session.serverUrl = '';
        session.pin = '';
        session.acknowledged = true;
        session.lastError = null;
        return { acknowledged: true };
    }

    getHandoff(token) {
        if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw new PairingError(401, 'Pairing handoff is invalid or expired.');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const sessionId = this.handoffs.get(tokenHash);
        const session = sessionId ? this.sessions.get(sessionId) : null;
        if (!session || session.handoffExpiresAt <= this.now()) throw new PairingError(401, 'Pairing handoff is invalid or expired.');
        return session;
    }
}
