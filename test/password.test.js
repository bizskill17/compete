import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../server/storage.js';
import { createAdmin, recoverAdmin, authenticate } from '../server/auth.js';

test('password policy accepts 4 and 20 characters and rejects values outside the range', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'compete-password-'));
  const store = new FileStore(dir); await store.init();
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const password of ['123', 'x'.repeat(21)]) {
    await assert.rejects(createAdmin(store, 'invalid@example.com', password), /4–20/);
    await assert.rejects(authenticate(store, {}, '/api/auth/register', { email: 'invalid@example.com', name: 'Invalid', password }, ''), /4–20|Invalid credentials/);
  }
  await createAdmin(store, 'admin@example.com', '1234');
  assert.equal((await authenticate(store, {}, '/api/auth/login', { email: 'admin@example.com', password: '1234' }, '')).body.ok, true);
  await recoverAdmin(store, 'admin@example.com', 'x'.repeat(20));
  assert.equal((await authenticate(store, {}, '/api/auth/login', { email: 'admin@example.com', password: 'x'.repeat(20) }, '')).body.ok, true);
  for (const [email, password] of [['four@example.com', '1234'], ['twenty@example.com', 'y'.repeat(20)]]) {
    assert.equal((await authenticate(store, {}, '/api/auth/register', { email, name: 'Artist', password }, '')).body.ok, true);
    assert.equal((await authenticate(store, {}, '/api/auth/login', { email, password }, '')).body.ok, true);
  }
});
