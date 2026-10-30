import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../server/storage.js';
import { createAdmin } from '../server/auth.js';
import { createAppServer } from '../server/http.js';
import { JSDOM, VirtualConsole } from 'jsdom';

test('admin area authorizes every operation, manages categories and participants, revokes suspended sessions, reviews entries and hides secrets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compete-admin-'));
  const store = new FileStore(directory); await store.init();
  const config = { ADMIN_EMAIL: 'owner@example.com', DB_PASSWORD: 'never-return-this-secret', RAZORPAY_KEY_SECRET: 'another-hidden-secret' };
  await createAdmin(store, config.ADMIN_EMAIL, 'Admin-password-123');
  const server = await createAppServer(store, config); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  async function request(path, body, cookie, overrideOrigin) {
    const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { Origin: overrideOrigin || origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.match((await request('/admin')).text, /Sign in to dashboard/);
  const owner = await request('/api/auth/login', { email: config.ADMIN_EMAIL, password: 'Admin-password-123' });
  const participant = await request('/api/auth/register', { email: 'artist@example.com', name: 'Artist', password: 'Artist-password-123' });
  for (const cookie of [undefined, participant.cookie]) {
    assert.equal((await request('/api/admin/overview', null, cookie)).status, 403);
    for (const path of ['category', 'participant', 'review', 'delete']) assert.equal((await request('/api/admin/' + path, {}, cookie)).status, 403);
    assert.equal((await request('/api/admin/art/missing', null, cookie)).status, 403);
  }
  assert.equal((await request('/api/admin/category', { name: 'Art' }, owner.cookie, 'https://evil.example')).status, 403);
  const category = await request('/api/admin/category', { name: 'Drawing', active: true }, owner.cookie);
  assert.equal(category.status, 200);
  assert.equal((await request('/api/admin/category', { name: 'drawing' }, owner.cookie)).status, 409);
  assert.equal((await request('/api/admin/category', { ...category.data, active: false }, owner.cookie)).data.active, false);
  assert.equal((await request('/api/admin/participant', { name: 'Short', email: 'short@example.com', password: '123' }, owner.cookie)).status, 400);
  assert.equal((await request('/api/admin/participant', { name: 'Long', email: 'long@example.com', password: 'x'.repeat(21) }, owner.cookie)).status, 400);
  const newUser = await request('/api/admin/participant', { name: 'New artist', email: 'new@example.com', password: 'Artist-password-123', role: 'admin' }, owner.cookie);
  assert.equal(newUser.status, 200); assert.equal(newUser.data.role, 'participant'); assert.equal(newUser.data.passwordHash, undefined);
  assert.equal((await request('/api/admin/participant', { name: 'Copy', email: 'new@example.com', password: 'Artist-password-123' }, owner.cookie)).status, 409);
  const login = await request('/api/auth/login', { email: 'new@example.com', password: 'Artist-password-123' });
  assert.equal((await request('/api/admin/participant', { ...newUser.data, disabled: true }, owner.cookie)).status, 200);
  assert.equal((await request('/api/state', null, login.cookie)).data.user, null);
  assert.equal((await request('/api/auth/login', { email: 'new@example.com', password: 'Artist-password-123' })).status, 401);
  const put = (key, value) => store.put(key, JSON.stringify(value));
  await put('competition/c1', { id: 'c1', title: 'Drawing contest', category: 'Drawing', status: 'open' });
  assert.equal((await request('/api/admin/category', { ...category.data, name: 'Changed' }, owner.cookie)).status, 409);
  await put('entry/e1', { id: 'e1', competition: 'c1', name: 'Artist', status: 'judged', score: 90, created: '2026-10-30T00:00:00Z' });
  await store.put('art/e1', Buffer.from([1, 2, 3]), { httpMetadata: { contentType: 'image/png' } });
  assert.equal((await request('/api/admin/art/e1', null, owner.cookie)).status, 200);
  assert.equal((await request('/api/admin/review', { id: 'e1', reviewStatus: 'rejected' }, owner.cookie)).status, 400);
  assert.equal((await request('/api/admin/review', { id: 'e1', reviewStatus: 'rejected', reason: 'Outside theme' }, owner.cookie)).status, 200);
  assert.equal((await request('/api/leaderboard?id=c1')).data.length, 0);
  await put('order/o1', { uid: newUser.data.id, competition: 'c1', amount: 19900 });
  await put('registration/c1/u1', { order: 'o1', paid: true, payment: 'pay1' });
  const overview = await request('/api/admin/overview', null, owner.cookie);
  assert.equal(overview.data.stats.collected, 19900); assert.equal(overview.data.stats.pending, 0);
  assert.equal(overview.data.payments[0].id, 'o1'); assert.equal(overview.data.payments[0].email, 'new@example.com');
  assert(!overview.text.includes('passwordHash')); assert(!overview.text.includes(config.DB_PASSWORD)); assert(!overview.text.includes(config.RAZORPAY_KEY_SECRET));
});

test('admin browser handles login, navigation, category save, errors and logout', async t => {
  const html = await readFile('public/admin.html', 'utf8');
  let loggedIn = false, data = { competitions: [], participants: [], entries: [], payments: [], categories: [], ready: {}, stats: { participants: 0, active: 0, pending: 0, collected: 0 } };
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => { if (e.type !== 'css-parsing' && !/navigation/.test(e.message)) errors.push(e.message); });
  const window = new JSDOM(html, { url: 'http://127.0.0.1/admin', runScripts: 'dangerously', virtualConsole: vc, beforeParse(w) {
    w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    w.HTMLDialogElement.prototype.close = function() { this.open = false; };
    w.fetch = async (url, options) => {
      let body;
      if (url === '/api/state') body = { admin: loggedIn, user: loggedIn ? { email: 'owner@example.com' } : null };
      else if (url === '/api/auth/login') { loggedIn = true; body = { ok: true }; }
      else if (url === '/api/admin/overview') body = data;
      else if (url === '/api/admin/category') { const c = JSON.parse(options.body); data.categories.push({ ...c, id: 'cat1' }); body = c; }
      else if (url === '/api/admin/delete') { const b = JSON.parse(options.body); data.categories = data.categories.filter(c => c.id !== b.id); body = { ok: true }; }
      else if (url === '/api/auth/logout') { loggedIn = false; body = { ok: true }; }
      else throw new Error('Unexpected URL ' + url);
      return { ok: true, json: async () => body };
    };
  } }).window;
  t.after(() => window.close()); const doc = window.document;
  await new Promise(r => setImmediate(r)); assert(!doc.querySelector('#login').classList.contains('hide'));
  const passwordInput = doc.querySelector('#password'), toggle = doc.querySelector('#loginForm .password-toggle');
  assert.equal(passwordInput.minLength, 4); assert.equal(passwordInput.maxLength, 20);
  toggle.click(); assert.equal(passwordInput.type, 'text'); assert.equal(toggle.getAttribute('aria-label'), 'Hide password');
  toggle.click(); assert.equal(passwordInput.type, 'password');
  const loginForm = doc.querySelector('#loginForm'); loginForm.elements.email.value = 'owner@example.com'; loginForm.elements.password.value = 'Admin-password-123';
  await loginForm.onsubmit({ preventDefault() {}, target: loginForm });
  assert(!doc.querySelector('#app').classList.contains('hide')); assert.match(doc.querySelector('#content').textContent, /No records yet/);
  doc.querySelector('[data-section="categories"]').click(); doc.querySelector('[data-new="category"]').click();
  const form = doc.querySelector('#editorForm'); form.elements.name.value = '<Art>'; await form.onsubmit({ preventDefault() {}, target: form });
  assert.equal(doc.querySelector('#editor').open, false); assert.match(doc.querySelector('#records').textContent, /<Art>/); assert.equal(doc.querySelector('#records art'), null);
  doc.querySelector('[data-section="participants"]').click(); doc.querySelector('[data-new="participant"]').click();
  await new Promise(r => setImmediate(r));
  const dynamicPassword = doc.querySelector('#editorForm input[name=password]');
  assert.equal(dynamicPassword.minLength, 4); assert.equal(dynamicPassword.maxLength, 20);
  doc.querySelector('#editorForm .password-toggle').click(); assert.equal(dynamicPassword.type, 'text');
  doc.querySelector('#editor .close').click();
  doc.querySelector('[data-section="competitions"]').click(); doc.querySelector('[data-new="competition"]').click();
  assert.equal(doc.querySelector('#editorForm').elements.category.options[1].textContent, '<Art>');
  doc.querySelector('#editor .close').click();
  for (const section of ['participants', 'entries', 'payments', 'settings', 'dashboard']) doc.querySelector('[data-section="'+section+'"]').click();
  doc.querySelector('[data-section="categories"]').click();
  const deleteButton = doc.querySelector('[data-delete-kind="category"]');
  assert(deleteButton.querySelector('svg')); assert.equal(deleteButton.getAttribute('aria-label'), 'Delete category');
  assert(doc.querySelector('[data-edit-category] svg'));
  window.confirm = () => false; await deleteButton.onclick(); assert.equal(data.categories.length, 1);
  window.confirm = () => true; await deleteButton.onclick(); assert.equal(data.categories.length, 0);
  await doc.querySelector('#logout').onclick(); assert.equal(loggedIn, false); assert.deepEqual(errors, []);
});
