import { os } from '@orpc/server';
import { z } from 'zod';
import type { AuthenticatedClient } from './index.js';
export const requestSchema = z.object({ path: z.string().max(8192), method: z.enum(['GET','HEAD','POST','PUT','PATCH','DELETE']).optional(), data: z.unknown().optional() }).strict();
/** Mount behind your own caller authentication and authorization. No listener is started. */
export function createAuthRouter(client: AuthenticatedClient) {
  return {
    status: os.handler(() => client.status()),
    request: os.input(requestSchema).handler(({ input }) => client.request(input))
  };
}
