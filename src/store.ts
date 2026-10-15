import { mkdir, open, readFile, rename, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { DatabaseSync } from 'node:sqlite';
export interface Session { accessToken: string; refreshToken?: string; expiresAt?: number; metadata?: Record<string, unknown> }
export interface State { generation: number; session?: Session; retryAt?: number }
export interface TokenStore {
  load(): Promise<State>;
  compareAndSwap(generation: number, next: State): Promise<boolean>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}
export class DanceError extends Error { constructor(public code: string) { super(code); this.name = 'DanceError'; } }
// Locks have a heartbeat. A lost lease fails closed before publication.
export class FileTokenStore implements TokenStore {
  readonly path: string;
  constructor(path: string) { this.path = resolve(path); }
  async prepare() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const f = await open(this.path + '.coord', 'a', 0o600); await f.close();
  }
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    await this.prepare();
    let lost = false;
    const release = await lockfile.lock(this.path + '.coord', { realpath: false, stale: 30000, update: 5000,
      retries: { retries: 100, minTimeout: 100, maxTimeout: 500 }, onCompromised: () => { lost = true; } });
    this.assertLease = () => { if (lost) throw new DanceError('LOCK_LOST'); };
    try { const result = await work(); this.assertLease(); return result; }
    finally { this.assertLease = () => { throw new DanceError('LOCK_REQUIRED'); }; await release(); }
  }
  protected assertLease: () => void = () => { throw new DanceError('LOCK_REQUIRED'); };
  async load(): Promise<State> {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { generation: 0 }; throw new DanceError('STORE_READ_FAILED'); }
  }
  async compareAndSwap(generation: number, next: State) {
    this.assertLease();
    if ((await this.load()).generation !== generation || next.generation !== generation + 1) return false;
    const tmp = this.path + '.' + randomUUID();
    const f = await open(tmp, 'wx', 0o600);
    try { await f.writeFile(JSON.stringify(next)); await f.sync(); } finally { await f.close(); }
    this.assertLease(); await rename(tmp, this.path); return true;
  }
}
/** SQLite persistence with local cross-process coordination. Not a distributed lock. */
export class SqliteTokenStore extends FileTokenStore {
  private db?: DatabaseSync;
  private async connection() {
    if (!this.db) {
      await this.prepare();
      const f = await open(this.path, 'a', 0o600); await f.close(); await chmod(this.path, 0o600);
      this.db = new DatabaseSync(this.path);
      this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS auth_state (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, body TEXT NOT NULL)');
    }
    return this.db;
  }
  override async load(): Promise<State> {
    const row = (await this.connection()).prepare('SELECT body FROM auth_state WHERE id=1').get();
    return row ? JSON.parse(row.body as string) : { generation: 0 };
  }
  override async compareAndSwap(generation: number, next: State) {
    this.assertLease(); if (next.generation !== generation + 1) return false;
    const db = await this.connection();
    if (generation === 0) return db.prepare('INSERT OR IGNORE INTO auth_state VALUES (1, ?, ?)').run(next.generation, JSON.stringify(next)).changes === 1;
    return db.prepare('UPDATE auth_state SET generation=?, body=? WHERE id=1 AND generation=?').run(next.generation, JSON.stringify(next), generation).changes === 1;
  }
  close() { this.db?.close(); this.db = undefined; }
}
