import { type Session } from './store.js';
import type { AuthProvider } from './index.js';
/** Official OAuth refresh-token adapter. Supply an application-owned interactive login callback. */
export declare function createOAuthProvider(options: {
    tokenUrl: string;
    clientId: string;
    clientSecret?: () => Promise<string>;
    login: () => Promise<Session>;
}): AuthProvider;
