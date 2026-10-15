# auth-dance

Authentication recovery for Node.js. A TypeScript core, JavaScript API, JSON CLI,
and optional oRPC router share one token manager. No resident service required.
MIT licensed. Distributed through GitHub, not the npm registry.

## Install

Requires Node.js 22.13+ (SQLite uses Node's built-in SQLite API).
Pin a reviewed full commit SHA and retain the consumer's package-lock.json:

```sh
npm install 'git+https://github.com/UnitedSuperintelligence/auth-dance.git#FULL_COMMIT_SHA'
```

Compiled JavaScript and declarations are committed for Git installations, including
installations with lifecycle scripts disabled. Maintainers run `npm ci && npm test`
and regenerate `dist` before committing. `npm pack --dry-run` lists shipped files.

## JavaScript

```js
import { TokenManager, FileTokenStore, createAuthenticatedClient } from 'auth-dance';
const manager = new TokenManager(new FileTokenStore('/private/app-state/account.json'), {
  async login() {
    // Call the platform's official login API with credentials from your secret manager.
    // Use a separate bounded transport; do not call the authenticated client here.
    return { accessToken: 'example-only', expiresAt: Date.now() + 3600000 };
  }
});
export default createAuthenticatedClient(manager, { origin: 'https://api.example.com' });
```

Save application setup as `auth.config.mjs`. Business code calls
`client.request({path:'/items'})` and receives `{status,data}`, never Axios's
credential-bearing request/config objects. Use a separate store per account,
tenant, provider and privilege level. `SqliteTokenStore` implements the same API.
`createOAuthProvider` implements official OAuth refresh-token exchange with rotation;
it falls back to the supplied login only for an explicit `invalid_grant`.
Other official login protocols implement `AuthProvider` directly.

## CLI and oRPC

```sh
printf '%s' '{"operation":"status"}' | auth-dance --config ./auth.config.mjs
printf '%s' '{"operation":"request","input":{"path":"/items"}}' | auth-dance --config ./auth.config.mjs
```

One JSON message per invocation. Output is `{ok:true,result}` or a static error
code with nonzero exit. Config is trusted executable application code; never load
untrusted config. No credential flags or token-printing command are provided.
CLI invokes the same oRPC procedures as the optional server integration:

```js
import { createAuthRouter } from 'auth-dance/orpc';
const router = createAuthRouter(client);
// Mount with your preferred oRPC adapter, behind caller authentication,
// authorization, request size limits and rate limits. No server starts implicitly.
```

## Recovery and storage

Only HTTP 401 triggers recovery by default. A provider-specific exact predicate
may classify a known authentication response; generic 403, permission denial,
transport errors and 5xx must not trigger login. GET/HEAD replay once after recovery.
Writes recover authentication but throw `AUTH_RECOVERED_NOT_REPLAYED`; opt in only
with an audited `replaySafe` predicate for exact read-only POST operations.
A second authentication failure stops with `AUTH_REJECTED`.

File storage uses mode 0600, fsync plus atomic rename, generation/CAS and a
heartbeat lock shared across processes. SQLite combines conditional SQL updates
with the same local lock. Failed acquisition records a shared 10-second cooldown.
A successful refresh replaces the entire session, preserving rotation returned by
the provider. Custom providers must bound network requests and never log secrets.
Events contain only a static name and generation. `TokenManager.execute` is a
privileged infrastructure hook: adapters can access sessions; business code should
use the authenticated client.

Use a dedicated private local directory. State is plaintext at rest; use encrypted
disks or a custom encrypted TokenStore where required. Coordination assumes one
local filesystem, reliable lock heartbeats and all writers respecting the store
contract. It is not a distributed lease for multiple hosts or unreliable network
filesystems. A crash between upstream token rotation and local publication may
require login again. Providers can fail, accounts can be revoked and authorization
can change; continuous access is not guaranteed. SQLite stores can be closed with
`close()` after use. Store CAS must run inside `exclusive()`.

The client enforces an exact HTTPS origin and disables redirects and environment
proxies. HTTP loopback is available only via an explicit test flag. It does not
expose custom Axios adapters, auth headers, base URLs or redirect overrides.
Response bodies are application data and can still contain secrets if an upstream
returns them; authorize routes and handle results accordingly. An oRPC endpoint
must not expose unrestricted upstream access to untrusted callers.

## Deployments

Use in a single Node app, multiple local cron processes sharing a store, or a
server-side oRPC service with its own caller security. Keep upstream credentials
out of browsers. Multiple machines need an independently reviewed distributed
TokenStore implementation; the included SQLite store is local only.

Tests use fictional credentials and loopback fixtures, including concurrent child
processes, refresh rotation, CAS, bounded replay, cooldown and all three entrypoints.

## Existing coordinated stores

`RecoveryCoordinator` is a small integration adapter for an application that already
has a provider-specific, cross-process coordinated credential store. Its acquisition
callback owns credential publication and cooldown; the coordinator owns classification,
one recovery attempt, mutation replay policy and propagation of retry failures.
It does not add distributed locking to an uncoordinated callback. This permits adoption
without migrating existing encrypted credentials, Redis keys or account partitions.
