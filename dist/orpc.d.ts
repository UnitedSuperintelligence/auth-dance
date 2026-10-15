import { z } from 'zod';
import type { AuthenticatedClient } from './index.js';
export declare const requestSchema: z.ZodObject<{
    path: z.ZodString;
    method: z.ZodOptional<z.ZodEnum<{
        GET: "GET";
        HEAD: "HEAD";
        POST: "POST";
        PUT: "PUT";
        PATCH: "PATCH";
        DELETE: "DELETE";
    }>>;
    data: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
/** Mount behind your own caller authentication and authorization. No listener is started. */
export declare function createAuthRouter(client: AuthenticatedClient): {
    status: import("@orpc/server").DecoratedProcedure<Record<never, never>, Record<never, never>, import("@orpc/server").Schema<unknown, unknown>, import("@orpc/server").Schema<{
        generation: number;
        authenticated: boolean;
        retryAt: number | null;
    }, {
        generation: number;
        authenticated: boolean;
        retryAt: number | null;
    }>, Record<never, never>, Record<never, never>>;
    request: import("@orpc/server").DecoratedProcedure<Record<never, never>, Record<never, never>, z.ZodObject<{
        path: z.ZodString;
        method: z.ZodOptional<z.ZodEnum<{
            GET: "GET";
            HEAD: "HEAD";
            POST: "POST";
            PUT: "PUT";
            PATCH: "PATCH";
            DELETE: "DELETE";
        }>>;
        data: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strict>, import("@orpc/server").Schema<{
        status: number;
        data: unknown;
    }, {
        status: number;
        data: unknown;
    }>, Record<never, never>, Record<never, never>>;
};
