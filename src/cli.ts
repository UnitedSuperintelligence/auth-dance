#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRouterClient } from '@orpc/server';
import { createAuthRouter } from './orpc.js';
import { DanceError } from './index.js';
if (process.argv.includes('--help')) {
  console.log('auth-dance --config ./auth.config.mjs < request.json\nConfig exports default authenticated client. Input: {"operation":"status"} or {"operation":"request","input":{"path":"/items"}}');
} else {
  try {
    const i = process.argv.indexOf('--config');
    if (i < 0 || !process.argv[i + 1]) throw new DanceError('CONFIG_REQUIRED');
    let raw = ''; for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) throw new DanceError('INPUT_TOO_LARGE'); }
    const message = JSON.parse(raw);
    const client = (await import(pathToFileURL(resolve(process.argv[i + 1])).href)).default;
    const rpc = createRouterClient(createAuthRouter(client));
    let result;
    if (message.operation === 'status') result = await rpc.status();
    else if (message.operation === 'request') result = await rpc.request(message.input);
    else throw new DanceError('UNKNOWN_OPERATION');
    console.log(JSON.stringify({ ok: true, result }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e instanceof DanceError ? e.code : 'REQUEST_FAILED' })); process.exitCode = 1;
  }
}
