import axios from 'axios';
import { DanceError } from './store.js';
export * from './store.js';
export class TokenManager {
    store;
    provider;
    options;
    pending;
    constructor(store, provider, options = {}) {
        this.store = store;
        this.provider = provider;
        this.options = options;
    }
    valid(s) { return s.retryAt === undefined && !!s.session && (s.session.expiresAt === undefined || s.session.expiresAt > Date.now() + (this.options.skewMs ?? 30000)); }
    log(event, generation) { try {
        this.options.log?.({ event, generation });
    }
    catch { } }
    async acquire(rejected) {
        if (this.pending) {
            await this.pending;
            return this.acquire(rejected);
        }
        const work = this.store.exclusive(async () => {
            const current = await this.store.load();
            if (this.valid(current) && current.generation !== rejected)
                return current;
            if ((current.retryAt ?? 0) > Date.now())
                throw new DanceError('AUTH_BACKOFF');
            try {
                let session;
                if (current.session?.refreshToken && this.provider.refresh) {
                    try {
                        session = await this.provider.refresh(current.session);
                    }
                    catch (e) {
                        if (!this.provider.isRefreshRejected?.(e))
                            throw e;
                        session = await this.provider.login();
                    }
                }
                else
                    session = await this.provider.login();
                if (!session.accessToken || /[\r\n]/.test(session.accessToken) || (session.expiresAt !== undefined && (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now())))
                    throw new DanceError('INVALID_SESSION');
                const next = { generation: current.generation + 1, session };
                if (!await this.store.compareAndSwap(current.generation, next))
                    throw new DanceError('CAS_CONFLICT');
                this.log('auth_published', next.generation);
                return next;
            }
            catch {
                await this.store.compareAndSwap(current.generation, { ...current, generation: current.generation + 1, retryAt: Date.now() + (this.options.cooldownMs ?? 10000) });
                this.log('auth_failed');
                throw new DanceError('AUTH_FAILED');
            }
        });
        this.pending = work;
        try {
            return await work;
        }
        finally {
            if (this.pending === work)
                this.pending = undefined;
        }
    }
    async status() { const s = await this.store.load(); return { generation: s.generation, authenticated: this.valid(s), retryAt: s.retryAt ?? null }; }
    /** Infrastructure hook: callbacks must not log or return the session. */
    async execute(request, isAuthFailure, replaySafe = false) {
        let state = await this.store.load();
        if (!this.valid(state))
            state = await this.acquire();
        const result = await request(state.session);
        if (!isAuthFailure(result))
            return result;
        state = await this.acquire(state.generation);
        if (!replaySafe)
            throw new DanceError('AUTH_RECOVERED_NOT_REPLAYED');
        const retried = await request(state.session);
        if (isAuthFailure(retried))
            throw new DanceError('AUTH_REJECTED');
        return retried;
    }
}
export function createAuthenticatedClient(manager, options) {
    const origin = new URL(options.origin);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        (origin.protocol !== 'https:' && !(options.allowHttpLocalhost && origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))))
        throw new DanceError('INVALID_ORIGIN');
    const transport = axios.create({ timeout: 30000, maxRedirects: 0, proxy: false, validateStatus: () => true, maxContentLength: 10 * 1024 * 1024 });
    // Dedicated instance: callers cannot override transport, URL, auth or redirects.
    transport.interceptors.response.use(r => r, () => Promise.reject(new DanceError('TRANSPORT_FAILED')));
    return {
        async request(input) {
            const url = new URL(input.path, origin);
            if (url.origin !== origin.origin || url.username || url.password || !input.path.startsWith('/') || input.path.startsWith('//'))
                throw new DanceError('TARGET_DENIED');
            const method = input.method ?? 'GET';
            const safe = ['GET', 'HEAD'].includes(method) || options.replaySafe?.(input) === true;
            const result = await manager.execute(async (session) => {
                const r = await transport.request({ url: url.href, method, data: input.data, headers: { Authorization: `Bearer ${session.accessToken}` } });
                // Never expose Axios config/request (contains Authorization) to the business layer.
                return { status: r.status, data: r.data };
            }, options.isAuthFailure ?? (r => r.status === 401), safe);
            return result;
        },
        status: () => manager.status()
    };
}
export { createOAuthProvider } from "./provider.js";
export { RecoveryCoordinator } from "./recovery.js";
