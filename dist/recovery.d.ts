/** Generic bounded recovery for applications with an existing coordinated session store. */
export declare class RecoveryCoordinator<Credential> {
    private acquire;
    constructor(acquire: (rejected: Credential | undefined) => Promise<Credential>);
    execute<T>(credential: Credential | undefined, request: (credential: Credential | undefined) => Promise<T>, isAuthError: (error: unknown) => boolean, replaySafe: boolean, notReplayed?: () => Error): Promise<{
        value: T;
        credential: Credential | undefined;
    }>;
}
