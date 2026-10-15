import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { FileTokenStore, SqliteTokenStore, TokenManager, createAuthenticatedClient } from '../dist/index.js';
import { createAuthRouter } from '../dist/orpc.js';
import { createRouterClient } from '@orpc/server';
const temp = () => mkdtemp(join(tmpdir(),'auth-dance-'));
const child = (args, input='') => new Promise((resolve,reject)=> { const p=spawn(process.execPath,args); let out=''; let err=''; p.stdout.on('data',b=>out+=b); p.stderr.on('data',b=>err+=b); p.on('error',reject); p.on('exit',code=>code?reject(new Error(out+err)):resolve(out)); p.stdin.end(input); });
for (const Store of [FileTokenStore,SqliteTokenStore]) {
 test(Store.name+' single flight, persistence and CAS', async()=> {
  const store=new Store(join(await temp(),'state')); let calls=0;
  const m=new TokenManager(store,{login:async()=>{calls++; await new Promise(r=>setTimeout(r,20)); return {accessToken:'fixture'};}});
  await Promise.all(Array.from({length:20},()=>m.execute(async()=>200,()=>false,true)));
  assert.equal(calls,1); assert.equal((await store.load()).generation,1);
  await store.exclusive(async()=>assert.equal(await store.compareAndSwap(0,{generation:1}),false));
  assert.equal((await stat(store.path)).mode&0o777,0o600); store.close?.();
 });
 test(Store.name+' rotated refresh and late rejection',async()=> {
  const store=new Store(join(await temp(),'state')); await store.exclusive(()=>store.compareAndSwap(0,{generation:1,session:{accessToken:'old',refreshToken:'r1'}})); let refresh=0;
  const m=new TokenManager(store,{login:async()=>{throw Error('unexpected');},refresh:async s=>{assert.equal(s.refreshToken,'r1');refresh++;return {accessToken:'new',refreshToken:'r2'};}});
  const result=await Promise.all(Array.from({length:10},()=>m.execute(async s=>{if(s.accessToken==='old') await new Promise(r=>setTimeout(r,30));return s.accessToken==='old'?401:200;},x=>x===401,true)));
  assert.deepEqual(result,Array(10).fill(200));assert.equal(refresh,1);assert.equal((await store.load()).session.refreshToken,'r2');store.close?.();
 });
 test(Store.name+' cooldown fails closed',async()=> {
  const store=new Store(join(await temp(),'state'));let calls=0;
  const m=new TokenManager(store,{login:async()=>{calls++;throw Error('secret');}});
  await assert.rejects(m.execute(async()=>200,()=>false),/AUTH_FAILED/);
  await assert.rejects(m.execute(async()=>200,()=>false),/AUTH_BACKOFF/);assert.equal(calls,1);store.close?.();
 });
}
test('bounded replay, permission denial, publication failure',async()=> {
 const store=new FileTokenStore(join(await temp(),'state'));let logins=0,requests=0;
 const m=new TokenManager(store,{login:async()=>({accessToken:'fake-'+(++logins)})});
 assert.equal(await m.execute(async()=>403,x=>x===401,true),403);assert.equal(logins,1);
 await assert.rejects(m.execute(async()=>{requests++;return 401;},x=>x===401,false),/NOT_REPLAYED/);assert.equal(requests,1);
 requests=0;await assert.rejects(m.execute(async()=>{requests++;return 401;},x=>x===401,true),/AUTH_REJECTED/);assert.equal(requests,2);
 const broken=new FileTokenStore(join(await temp(),'state'));broken.compareAndSwap=async()=>{throw Error('disk');};
 const b=new TokenManager(broken,{login:async()=>({accessToken:'fake'})});let sent=false;
 await assert.rejects(b.execute(async()=>{sent=true;},()=>false));assert.equal(sent,false);
});
test('cross-process acquisition coalesces',async()=> {
 const dir=await temp();const module=new URL('../dist/index.js',import.meta.url).href;
 const script=`import {FileTokenStore,TokenManager} from ${JSON.stringify(module)};import {appendFile} from 'node:fs/promises'; const m=new TokenManager(new FileTokenStore(${JSON.stringify(join(dir,'state'))}),{login:async()=>{await appendFile(${JSON.stringify(join(dir,'calls'))},'1');await new Promise(r=>setTimeout(r,100));return {accessToken:'fake'};}});await m.execute(async()=>200,()=>false,true);`;
 await Promise.all(Array.from({length:6},()=>child(['--input-type=module','-e',script])));assert.equal(await readFile(join(dir,'calls'),'utf8'),'1');
});
test('JS, oRPC and CLI share secured client; redirects denied',async t=> {
 let calls=0;const server=createServer((req,res)=>{calls++;if(req.url==='/redirect'){res.writeHead(302,{location:'http://localhost:1/steal'});res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const origin=`http://127.0.0.1:${server.address().port}`;
 const dir=await temp();const manager=new TokenManager(new FileTokenStore(join(dir,'state')),{login:async()=>({accessToken:'fixture'})});const client=createAuthenticatedClient(manager,{origin,allowHttpLocalhost:true});
 assert.equal((await client.request({path:'/items'})).status,200);
 assert.equal((await client.request({path:'/redirect'})).status,302);assert.equal(calls,2);
 for(const path of ['https://evil.invalid','//evil.invalid','/\\evil.invalid']) await assert.rejects(client.request({path}),/TARGET_DENIED/);
 assert.equal((await createRouterClient(createAuthRouter(client)).request({path:'/items'})).status,200);
 const config=join(dir,'config.mjs');await writeFile(config,`import {TokenManager,FileTokenStore,createAuthenticatedClient} from ${JSON.stringify(new URL('../dist/index.js',import.meta.url).href)};export default createAuthenticatedClient(new TokenManager(new FileTokenStore(${JSON.stringify(join(dir,'state'))}),{login:async()=>({accessToken:'fixture'})}),{origin:${JSON.stringify(origin)},allowHttpLocalhost:true});`);
 const result=JSON.parse(await child(['dist/cli.js','--config',config],JSON.stringify({operation:'request',input:{path:'/items'}})));assert.equal(result.result.status,200);assert.equal(JSON.stringify(result).includes('fixture'),false);
});
test('existing-store recovery adapter bounds replays and preserves failures',async()=> {
 const {RecoveryCoordinator}=await import('../dist/index.js');let renewals=0,requests=0;
 const r=new RecoveryCoordinator(async()=>{renewals++;return 'fresh';});
 assert.deepEqual(await r.execute('stale',async c=>{requests++;if(c==='stale')throw Error('auth');return 200;},e=>e.message==='auth',true),{value:200,credential:'fresh'});
 assert.equal(renewals,1);assert.equal(requests,2);
 await assert.rejects(r.execute('stale',async()=>{throw Error('permission');},()=>false,true),/permission/);assert.equal(renewals,1);
 await assert.rejects(r.execute('stale',async()=>{throw Error('auth');},()=>true,false),/NOT_REPLAYED/);
 requests=0;await assert.rejects(r.execute('stale',async()=>{requests++;throw Error('auth');},()=>true,true),/auth/);assert.equal(requests,2);
});
