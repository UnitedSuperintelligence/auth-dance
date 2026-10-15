import { type Session, type TokenStore } from './store.js';
export * from './store.js';
export interface AuthProvider {
    login(): Promise<Session>;
    refresh?(session: Session): Promise<Session>;
    /** Only an explicit invalid refresh credential permits fallback to login. */
    isRefreshRejected?(error: unknown): boolean;
}
export declare class TokenManager {
    private store;
    private provider;
    private options;
    private pending?;
    constructor(store: TokenStore, provider: AuthProvider, options?: {
        skewMs?: number;
        cooldownMs?: number;
        log?: (event: {
            event: string;
            generation?: number;
        }) => void;
    });
    private valid;
    private log;
    private acquire;
    status(): Promise<{
        generation: number;
        authenticated: boolean;
        retryAt: number | null;
    }>;
    /** Infrastructure hook: callbacks must not log or return the session. */
    execute<T>(request: (session: Session) => Promise<T>, isAuthFailure: (result: T) => boolean, replaySafe?: boolean): Promise<T>;
}
export interface RequestInput {
    path: string;
    method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    data?: unknown;
}
export interface ClientOptions {
    origin: string;
    allowHttpLocalhost?: boolean;
    isAuthFailure?: (response: {
        status: number;
        data: unknown;
    }) => boolean;
    /** Exact, audited read-POST routes only. */
    replaySafe?: (request: RequestInput) => boolean;
}
export declare function createAuthenticatedClient(manager: TokenManager, options: ClientOptions): {
    request(input: RequestInput): Promise<{
        status: number;
        data: unknown;
    }>;
    status: () => Promise<{
        generation: number;
        authenticated: boolean;
        retryAt: number | null;
    }>;
};
export type AuthenticatedClient = ReturnType<typeof createAuthenticatedClient>;
export { createOAuthProvider } from "./provider.js";
export { RecoveryCoordinator } from "./recovery.js";
