/** Generic bounded recovery for applications with an existing coordinated session store. */
export class RecoveryCoordinator {
    acquire;
    constructor(acquire) {
        this.acquire = acquire;
    }
    async execute(credential, request, isAuthError, replaySafe, notReplayed = () => new Error('AUTH_RECOVERED_NOT_REPLAYED')) {
        try {
            return { value: await request(credential), credential };
        }
        catch (error) {
            if (!isAuthError(error))
                throw error;
            const fresh = await this.acquire(credential);
            if (!replaySafe)
                throw notReplayed();
            return { value: await request(fresh), credential: fresh };
        }
    }
}
