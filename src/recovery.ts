/** Generic bounded recovery for applications with an existing coordinated session store. */
export class RecoveryCoordinator<Credential> {
  constructor(private acquire: (rejected: Credential | undefined) => Promise<Credential>) {}
  async execute<T>(credential: Credential | undefined, request: (credential: Credential | undefined) => Promise<T>,
    isAuthError: (error: unknown) => boolean, replaySafe: boolean,
    notReplayed: () => Error = () => new Error('AUTH_RECOVERED_NOT_REPLAYED')): Promise<{ value: T; credential: Credential | undefined }> {
    try { return { value: await request(credential), credential }; }
    catch (error) {
      if (!isAuthError(error)) throw error;
      const fresh = await this.acquire(credential);
      if (!replaySafe) throw notReplayed();
      return { value: await request(fresh), credential: fresh };
    }
  }
}
