import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const object = (body, metadata = {}) => ({
  json: async () => JSON.parse(body.toString()),
  arrayBuffer: async () => Uint8Array.from(body).buffer,
  httpMetadata: metadata,
});
const pack = value => Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value));

// Development only. Production refuses to start without MySQL.
export class FileStore {
  constructor(directory) { this.directory = resolve(directory); this.locks = new Map(); }
  async init() { await mkdir(this.directory, { recursive: true }); }
  path(key) { return join(this.directory, Buffer.from(key).toString('hex') + '.json'); }
  async get(key) { try { const v = JSON.parse(await readFile(this.path(key), 'utf8')); return object(Buffer.from(v.body, 'base64'), v.metadata); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async put(key, value, options = {}) {
    const target = this.path(key), temporary = target + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify({ key, body: pack(value).toString('base64'), metadata: options.httpMetadata || {} }), { mode: 0o600 });
    await rename(temporary, target);
  }
  async delete(key) { await unlink(this.path(key)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  async list({ prefix, cursor }) {
    const keys = (await readdir(this.directory)).filter(f => f.endsWith('.json')).map(f => Buffer.from(f.slice(0, -5), 'hex').toString()).filter(k => k.startsWith(prefix)).sort();
    const remaining = keys.filter(k => !cursor || k > cursor), page = remaining.slice(0, 100);
    return { objects: page.map(key => ({ key })), truncated: remaining.length > page.length, cursor: page.at(-1) };
  }
  async lock(key, fn) {
    const previous = this.locks.get(key) || Promise.resolve(); let release;
    const next = new Promise(r => { release = r; }); this.locks.set(key, next);
    await previous;
    try { return await fn(); } finally { release(); if (this.locks.get(key) === next) this.locks.delete(key); }
  }
  async close() {}
}

export class MySQLStore {
  constructor(pool) { this.pool = pool; this.activeLocks = 0; this.lockWaiters = []; }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS compete_objects (
      object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      metadata TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS compete_object_parts (
      object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      part_number INT NOT NULL, body MEDIUMBLOB NOT NULL,
      PRIMARY KEY(object_key, part_number),
      FOREIGN KEY(object_key) REFERENCES compete_objects(object_key) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async get(key) {
    // One statement gives a consistent view even during transactional replacement.
    const [rows] = await this.pool.execute('SELECT o.metadata,p.body FROM compete_objects o LEFT JOIN compete_object_parts p ON p.object_key=o.object_key WHERE o.object_key=? ORDER BY p.part_number', [key]);
    if (!rows.length) return null;
    return object(Buffer.concat(rows.filter(r => r.body !== null).map(r => r.body)), JSON.parse(rows[0].metadata));
  }
  async put(key, value, options = {}) {
    const body = pack(value), connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('INSERT INTO compete_objects(object_key,metadata) VALUES(?,?) ON DUPLICATE KEY UPDATE metadata=VALUES(metadata)', [key, JSON.stringify(options.httpMetadata || {})]);
      await connection.execute('DELETE FROM compete_object_parts WHERE object_key=?', [key]);
      for (let offset = 0, part = 0; offset < body.length; offset += 262144, part++) {
        await connection.execute('INSERT INTO compete_object_parts(object_key,part_number,body) VALUES(?,?,?)', [key, part, body.subarray(offset, offset + 262144)]);
      }
      await connection.commit();
    } catch (e) { await connection.rollback(); throw e; } finally { connection.release(); }
  }
  async delete(key) { await this.pool.execute('DELETE FROM compete_objects WHERE object_key=?', [key]); }
  async list({ prefix, cursor = '' }) {
    const [rows] = await this.pool.execute('SELECT object_key FROM compete_objects WHERE LEFT(object_key,?)=? AND object_key>? ORDER BY object_key LIMIT 101', [prefix.length, prefix, cursor]);
    const page = rows.slice(0, 100);
    return { objects: page.map(r => ({ key: r.object_key })), truncated: rows.length > 100, cursor: page.at(-1)?.object_key };
  }
  async lock(key, fn) {
    // Dedicated connection holds a cross-process lock. Ordinary data work uses the pool.
    const { createHash } = await import('node:crypto');
    const name = createHash('sha256').update(key).digest('hex').slice(0, 64);
    if (this.activeLocks >= 8) await new Promise(resolve => this.lockWaiters.push(resolve));
    this.activeLocks++;
    let connection;
    try {
      connection = await this.pool.getConnection();
      const [rows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [name]);
      if (Number(rows[0].acquired) !== 1) throw new Error('This action is already processing. Please retry.');
      try { return await fn(); } finally { await connection.execute('SELECT RELEASE_LOCK(?)', [name]); }
    } finally { connection?.release(); this.activeLocks--; this.lockWaiters.shift()?.(); }
  }
  async close() { await this.pool.end(); }
}

export async function createStore(config) {
  if (!config.DB_NAME) {
    if (config.NODE_ENV === 'production') throw new Error('Production requires DB_HOST, DB_USER, DB_PASSWORD and DB_NAME.');
    const store = new FileStore(config.DATA_DIR || './data'); await store.init(); return store;
  }
  const { default: mysql } = await import('mysql2/promise');
  const pool = mysql.createPool({ host: config.DB_HOST || '127.0.0.1', port: Number(config.DB_PORT || 3306), user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME, connectionLimit: 20, waitForConnections: true, queueLimit: 50, connectTimeout: 10000 });
  const store = new MySQLStore(pool); await store.init(); return store;
}
