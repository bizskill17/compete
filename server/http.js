import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import app from './app.js';
import { adminRequest } from './admin.js';
import { identity, authenticate } from './auth.js';
const read = async (store, key) => (await store.get(key))?.json();
const save = (store, key, data) => store.put(key, JSON.stringify(data));
const webhookPath = '/api/payments/webhook';

export async function createAppServer(store, config = {}) {
  const production = config.NODE_ENV === 'production';
  if (production && (!config.APP_URL || !config.APP_URL.startsWith('https://'))) throw new Error('Set APP_URL to the final HTTPS origin in production.');
  const origin = config.APP_URL ? new URL(config.APP_URL).origin : null;
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const adminPage = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const rate = new Map(); let inflight = 0;
  const server = createServer(async (incoming, outgoing) => {
    const send = (body, status = 200, headers = {}) => {
      outgoing.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}), ...headers });
      outgoing.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (inflight >= 30) { send({ error: 'The service is busy. Please retry shortly.' }, 503); return; }
    inflight++;
    try {
      // Configured origin is authoritative; Host and forwarding headers never grant identity.
      const requestOrigin = origin || 'http://127.0.0.1:' + server.address().port;
      const url = new URL(incoming.url, requestOrigin), method = incoming.method;
      if (['/admin', '/admin/'].includes(url.pathname) && method === 'GET') { send(adminPage, 200, { 'Content-Type': 'text/html; charset=utf-8' }); return; }
      if (url.pathname === '/health' && method === 'GET') { send({ ok: true }); return; }
      if (!['GET', 'HEAD', 'POST'].includes(method)) { send({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD, POST' }); return; }
      if (method === 'POST' && url.pathname !== webhookPath && incoming.headers.origin !== requestOrigin) { send({ error: 'Request origin does not match this website.' }, 403); return; }
      if (url.pathname.startsWith('/api/auth/') && method === 'POST') {
        const address = incoming.socket.remoteAddress, now = Date.now();
        if (rate.size > 10000) for (const [k, v] of rate) if (v.until < now) rate.delete(k);
        let bucket = rate.get(address);
        if (!bucket || bucket.until < now) bucket = { count: 0, until: now + 60000 };
        bucket.count++; rate.set(address, bucket);
        if (bucket.count > 60) { send({ error: 'Too many requests. Please retry later.' }, 429); return; }
      }
      const maximum = url.pathname === '/api/submit' ? 6 * 1024 * 1024 : 128 * 1024;
      if (Number(incoming.headers['content-length']) > maximum) { send({ error: 'Request is too large.' }, 413); incoming.resume(); return; }
      const chunks = []; let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > maximum) { send({ error: 'Request is too large.' }, 413); return; }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), cookie = incoming.headers.cookie || '';
      if (url.pathname.startsWith('/api/auth/')) {
        if (method !== 'POST' || !['/api/auth/register', '/api/auth/login', '/api/auth/logout'].includes(url.pathname)) { send({ error: 'Not found' }, 404); return; }
        let body; try { body = JSON.parse(bytes.toString() || '{}'); } catch { send({ error: 'Invalid JSON.' }, 400); return; }
        if (!body || typeof body !== 'object') { send({ error: 'Invalid request.' }, 400); return; }
        let result;
        try { result = await authenticate(store, config, url.pathname, body, cookie); } catch (e) { if (/Enter a valid|Use a password/.test(e.message)) { send({ error: e.message }, 400); return; } throw e; }
        send(result.body, result.status || 200, result.cookie ? { 'Set-Cookie': result.cookie } : {}); return;
      }
      if (url.pathname === webhookPath && method === 'POST') {
        if (!config.RAZORPAY_WEBHOOK_SECRET) { send({ error: 'Webhook not configured' }, 503); return; }
        const signature = String(incoming.headers['x-razorpay-signature'] || '');
        const expected = createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET).update(bytes).digest('hex');
        if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) { send({ error: 'Invalid signature' }, 400); return; }
        let event; try { event = JSON.parse(bytes); } catch { send({ error: 'Invalid JSON' }, 400); return; }
        await store.lock('competition-write', async () => {
          if (!['payment.captured', 'order.paid'].includes(event.event)) return;
          const payment = event.payload?.payment?.entity, order = payment?.order_id ? await read(store, 'order/' + payment.order_id) : null;
          if (!order) return;
          if (payment.status !== 'captured' || payment.amount !== order.amount || payment.currency !== 'INR') throw new Error('Payment webhook amount/status mismatch');
          await save(store, 'registration/' + order.competition + '/' + order.uid, { paid: true, order: payment.order_id, payment: payment.id });
        });
        send({ ok: true }); return;
      }
      const user = await identity(store, cookie);
      const headers = new Headers();
      if (incoming.headers['content-type']) headers.set('Content-Type', incoming.headers['content-type']);
      headers.set('Content-Length', String(bytes.length));
      // No oai-authenticated-* or X-User-* headers from the internet are forwarded.
      const request = new Request(url, { method, headers, body: method === 'POST' ? bytes : undefined });
      const environment = { ...config, BUCKET: store, PAGE: page, identity: user };
      if (url.pathname.startsWith('/api/admin/art/')) {
        if (!user?.admin) { send({ error: 'Administrator access required.' }, 403); return; }
        const entry = await read(store, 'entry/' + decodeURIComponent(url.pathname.slice('/api/admin/art/'.length)));
        const art = entry && await store.get('art/' + entry.id);
        if (!art) { send({ error: 'Image not found.' }, 404); return; }
        send(Buffer.from(await art.arrayBuffer()), 200, { 'Content-Type': art.httpMetadata.contentType, 'Content-Disposition': 'inline' }); return;
      }
      const run = () => url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin/competition' ? adminRequest(request, environment) : app.fetch(request, environment);
      let response;
      if (method === 'POST') {
        let key = 'competition-write';
        if (url.pathname === '/api/judge' || url.pathname === '/api/admin/review') {
          const body = JSON.parse(bytes); key = 'judge/' + String(body.id).slice(0, 150);
        }
        response = await store.lock(key, run);
      } else response = await run();
      send(Buffer.from(await response.arrayBuffer()), response.status, Object.fromEntries(response.headers));
    } catch (e) {
      console.error('HTTP request failed:', e.name);
      if (!outgoing.headersSent) send({ error: 'Unable to complete this action. Please retry.' }, 500);
      else outgoing.end();
    } finally { inflight--; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

