export interface Session {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    metadata?: Record<string, unknown>;
}
export interface State {
    generation: number;
    session?: Session;
    retryAt?: number;
}
export interface TokenStore {
    load(): Promise<State>;
    compareAndSwap(generation: number, next: State): Promise<boolean>;
    exclusive<T>(work: () => Promise<T>): Promise<T>;
}
export declare class DanceError extends Error {
    code: string;
    constructor(code: string);
}
export declare class FileTokenStore implements TokenStore {
    readonly path: string;
    constructor(path: string);
    prepare(): Promise<void>;
    exclusive<T>(work: () => Promise<T>): Promise<T>;
    protected assertLease: () => void;
    load(): Promise<State>;
    compareAndSwap(generation: number, next: State): Promise<boolean>;
}
/** SQLite persistence with local cross-process coordination. Not a distributed lock. */
export declare class SqliteTokenStore extends FileTokenStore {
    private db?;
    private connection;
    load(): Promise<State>;
    compareAndSwap(generation: number, next: State): Promise<boolean>;
    close(): void;
}
