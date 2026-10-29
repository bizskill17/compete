import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { FileStore, createStore } from '../server/storage.js';
import { createAdmin, recoverAdmin } from '../server/auth.js';
import { createAppServer } from '../server/http.js';

const realFetch = global.fetch;
test('Hostinger application: accounts, durable data, protected actions, captured payments, submissions and certificates', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compete-'));
  const store = new FileStore(directory); await store.init();
  const config = { ADMIN_EMAIL: 'owner@example.com', RAZORPAY_KEY_ID: 'rzp_test_placeholder', RAZORPAY_KEY_SECRET: 'test-only-secret', RAZORPAY_WEBHOOK_SECRET: 'test-webhook', OPENAI_API_KEY: 'test-only-no-network' };
  await createAdmin(store, config.ADMIN_EMAIL, 'Organizer-password-123');
  const server = await createAppServer(store, config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let orderCount = 0, judgeCount = 0, captured = false;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.startsWith('https://api.razorpay.com/')) {
      if (value.endsWith('/orders')) { orderCount++; const body = JSON.parse(options.body); assert.equal(body.amount, 19900); return Response.json({ id: 'order_test', amount: 19900 }); }
      if (value.endsWith('/orders/order_test/payments')) return Response.json({ items: captured ? [{ id: 'pay_test', status: 'captured', amount: 19900, currency: 'INR' }] : [] });
      if (value.endsWith('/payments/pay_test')) return Response.json({ id: 'pay_test', status: 'captured', amount: 19900, currency: 'INR', order_id: 'order_test' });
      throw Error('Unexpected payment URL: ' + value);
    }
    if (value.startsWith('https://api.openai.com/')) {
      judgeCount++; return Response.json({ choices: [{ message: { content: JSON.stringify({ creativity: 25, composition: 20, craftsmanship: 20, theme: 15, eligible: true, feedback: 'Balanced composition.' }) } }] });
    }
    throw Error('Unexpected external network request');
  };
  t.after(async () => { global.fetch = realFetch; server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(directory, { recursive: true, force: true }); });
  async function request(path, body, cookie, headers = {}) {
    const multipart = body instanceof FormData;
    const r = await realFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { Origin: origin, ...(multipart ? {} : { 'Content-Type': 'application/json' }) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? multipart ? body : JSON.stringify(body) : undefined });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = await request('/api/auth/login', { email: config.ADMIN_EMAIL, password: 'Organizer-password-123' }); assert.equal(admin.status, 200);
  const user = await request('/api/auth/register', { email: 'artist@example.com', password: 'Artist-password-123', name: 'Artist' }); assert.equal(user.status, 200); assert.match(user.cookie, /^compete_session=/);
  assert.equal((await request('/api/auth/register', { email: config.ADMIN_EMAIL, password: 'Fake-password-123', name: 'Fake admin' })).status, 400);
  assert.equal((await request('/api/auth/login', { email: 'artist@example.com', password: 'Wrong-password-123' })).status, 401);
  assert.equal((await request('/api/state', null, user.cookie)).data.admin, false);
  assert.equal((await request('/api/state', null, admin.cookie)).data.admin, true);
  const c = { title: 'Real rangoli', category: 'Rangoli', description: 'Festival art', fee: 199, prizes: [1000, 500, 250], deadline: '2099-11-07', status: 'draft', rules: 'Original artwork only' };
  assert.equal((await request('/api/admin/competition', c, user.cookie, { 'oai-authenticated-user-email': config.ADMIN_EMAIL, 'oai-authenticated-user-id': 'owner' })).status, 403);
  assert.equal((await request('/api/admin/competition', c, admin.cookie, { Origin: 'https://evil.example' })).status, 403);
  const created = await request('/api/admin/competition', c, admin.cookie); assert.equal(created.status, 200); c.id = created.data.id;
  assert.equal((await request('/api/state')).data.competitions.length, 0, 'Drafts are not public');
  c.status = 'open'; assert.equal((await request('/api/admin/competition', c, admin.cookie)).status, 200);
  assert.equal((await request('/api/state')).data.competitions[0].id, c.id);
  assert.equal((await request('/api/order', { competition: c.id })).status, 401);
  assert.equal((await request('/api/order', { competition: c.id, amount: 1 }, user.cookie)).data.amount, 19900);
  assert.equal((await request('/api/order', { competition: c.id }, user.cookie)).data.id, 'order_test'); assert.equal(orderCount, 1, 'Unpaid order reused');
  assert.equal((await request('/api/admin/competition', { ...c, fee: 1 }, admin.cookie)).status, 409, 'Fee locked after orders start');
  assert.equal((await request('/api/verify', { razorpay_order_id: 'order_test', razorpay_payment_id: 'pay_test', razorpay_signature: 'fake' }, user.cookie)).status, 400);
  const other = await request('/api/auth/register', { email: 'other@example.com', password: 'Different-password-123', name: 'Other' });
  const sig = createHmac('sha256', config.RAZORPAY_KEY_SECRET).update('order_test|pay_test').digest('hex');
  assert.equal((await request('/api/verify', { razorpay_order_id: 'order_test', razorpay_payment_id: 'pay_test', razorpay_signature: sig }, other.cookie)).status, 400);
  captured = true; assert.equal((await request('/api/order', { competition: c.id }, user.cookie)).data.paid, true, 'Captured payment recovers without browser callback');
  const form = () => { const f = new FormData(); f.set('competition', c.id); f.set('name', '<script>artist</script>'); f.set('title', 'Floral light'); f.set('original', 'yes'); f.set('image', new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' }), 'art.png'); return f; };
  assert.equal((await request('/api/submit', form(), other.cookie)).status, 403);
  const submissions = await Promise.all([request('/api/submit', form(), user.cookie), request('/api/submit', form(), user.cookie)]);
  assert.deepEqual(submissions.map(s => s.status).sort(), [200, 409], 'Concurrent duplicate prevented');
  const entry = submissions.find(s => s.status === 200).data;
  const certificate = await request('/certificate/' + entry.id, null, user.cookie); assert.equal(certificate.status, 200); assert.match(certificate.data, /&lt;script&gt;artist/); assert.doesNotMatch(certificate.data, /<script>artist/);
  assert.equal((await request('/certificate/' + entry.id, null, other.cookie)).status, 404);
  assert.equal((await request('/api/judge', { id: entry.id }, other.cookie)).status, 404);
  const judged = await request('/api/judge', { id: entry.id }, user.cookie); assert.equal(judged.data.score, 80);
  assert.equal((await request('/api/judge', { id: entry.id }, user.cookie)).data.score, 80); assert.equal(judgeCount, 1);
  const board = await request('/api/leaderboard?id=' + c.id); assert.equal(board.data.length, 1); assert.equal(board.data[0].score, 80); assert.equal(board.data[0].uid, undefined);
  const restored = new FileStore(directory); await restored.init(); assert.equal((await (await restored.get('entry/' + entry.id)).json()).certificate, entry.certificate, 'Persistence survives store recreation');
  assert.equal((await request('/api/payments/webhook', { event: 'payment.captured' }, null, { 'x-razorpay-signature': 'bad' })).status, 400);
  const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test', order_id: 'order_test', amount: 19900, currency: 'INR', status: 'captured' } } } };
  const webhookSig = createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex');
  assert.equal((await request('/api/payments/webhook', event, null, { 'x-razorpay-signature': webhookSig })).status, 200);
  assert.equal((await request('/api/payments/webhook', event, null, { 'x-razorpay-signature': webhookSig })).status, 200, 'Webhook replay is idempotent');
  await recoverAdmin(store, config.ADMIN_EMAIL, 'Changed-password-123'); assert.equal((await request('/api/state', null, admin.cookie)).data.admin, false, 'Admin recovery revokes prior sessions');
  assert.equal((await request('/api/auth/logout', {}, user.cookie)).status, 200);
  assert.equal((await request('/api/mine', null, user.cookie)).status, 401);
});

test('production fails closed without persistent MySQL and HTTPS origin', async () => {
  await assert.rejects(createStore({ NODE_ENV: 'production' }), /Production requires/);
  await assert.rejects(createAppServer({}, { NODE_ENV: 'production' }), /APP_URL/);
});
