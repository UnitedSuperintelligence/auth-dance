import axios from 'axios';
import { DanceError, type Session } from './store.js';
import type { AuthProvider } from './index.js';
/** Official OAuth refresh-token adapter. Supply an application-owned interactive login callback. */
export function createOAuthProvider(options: { tokenUrl: string; clientId: string; clientSecret?: () => Promise<string>; login: () => Promise<Session> }): AuthProvider {
  const url = new URL(options.tokenUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new DanceError('INVALID_TOKEN_ENDPOINT');
  const transport = axios.create({ timeout: 20000, maxRedirects: 0, proxy: false, validateStatus: () => true });
  return {
    login: options.login,
    async refresh(session) {
      const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken!, client_id: options.clientId });
      if (options.clientSecret) form.set('client_secret', await options.clientSecret());
      let response;
      try { response = await transport.post(url.href, form); } catch { throw new DanceError('OAUTH_UNAVAILABLE'); }
      if (response.status === 400 && response.data?.error === 'invalid_grant') throw new DanceError('REFRESH_REJECTED');
      if (response.status !== 200 || typeof response.data?.access_token !== 'string') throw new DanceError('OAUTH_FAILED');
      const data = response.data;
      return { accessToken: data.access_token, refreshToken: data.refresh_token ?? session.refreshToken,
        expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined };
    },
    isRefreshRejected: e => e instanceof DanceError && e.code === 'REFRESH_REJECTED'
  };
}
