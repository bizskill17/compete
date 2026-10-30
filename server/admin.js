import { randomUUID } from 'node:crypto';
import { aiProvider } from './judging.js';
import { emailKey, hashPassword } from './auth.js';
const read = async (store, key) => (await store.get(key))?.json();
const save = (store, key, value) => store.put(key, JSON.stringify(value));
async function list(store, prefix) {
  const result = []; let cursor;
  do { const page = await store.list({ prefix, cursor });
    result.push(...await Promise.all(page.objects.map(o => read(store, o.key))));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result.filter(Boolean);
}
const reply = (body, status = 200) => Response.json(body, { status });
const cleanUser = ({ id, name, email, role, disabled, created }) => ({ id, name, email, role, disabled: !!disabled, created });
export async function adminRequest(request, env) {
  if (!env.identity?.admin) return reply({ error: 'Administrator access required.' }, 403);
  const path = new URL(request.url).pathname, store = env.BUCKET;
  if (path === '/api/admin/overview' && request.method === 'GET') {
    const [competitions, categories, accounts, entries, registrations] = await Promise.all(
      ['competition/', 'category/', 'account/', 'entry/', 'registration/'].map(p => list(store, p)));
    const users = new Map(accounts.map(a => [a.id, a]));
    // Older order objects store their ID only in the storage key.
    const keyedPayments = []; let cursor;
    do { const page = await store.list({ prefix: 'order/', cursor });
      for (const object of page.objects) { const o = await read(store, object.key), id = object.key.slice(6);
        const reg = registrations.find(r => r.order === id);
        keyedPayments.push({ id, competition: o.competition, amount: o.amount, email: users.get(o.uid)?.email || '', paid: !!reg?.paid, payment: reg?.payment || '' }); }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return reply({ competitions, categories, participants: accounts.map(cleanUser), entries, payments: keyedPayments,
      ready: { payments: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), ai: !!aiProvider(env), aiProvider: aiProvider(env), webhook: !!env.RAZORPAY_WEBHOOK_SECRET, database: !!env.DB_NAME },
      stats: { participants: accounts.filter(a => a.role !== 'admin').length, active: competitions.filter(c => c.status === 'open').length,
        pending: entries.filter(e => !e.reviewStatus).length, collected: keyedPayments.filter(p => p.paid).reduce((sum, p) => sum + p.amount, 0) } });
  }
  if (request.method !== 'POST') return reply({ error: 'Not found' }, 404);
  const body = await request.json();
  if (path === '/api/admin/delete') {
    const { kind, id } = body;
    if (!['category', 'competition', 'participant', 'entry'].includes(kind) || typeof id !== 'string' || id.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(id)) return reply({ error: 'Invalid delete request.' }, 400);
    if (kind === 'entry') {
      const entry = await read(store, 'entry/' + id);
      if (!entry) return reply({ error: 'Entry not found.' }, 404);
      await store.delete('art/' + entry.id);
      await store.delete('entry/' + entry.id);
      return reply({ ok: true });
    }
    if (kind === 'category') {
      const category = await read(store, 'category/' + id);
      if (!category) return reply({ error: 'Category not found.' }, 404);
      if ((await list(store, 'competition/')).some(c => c.category === category.name)) return reply({ error: 'This category is used by a competition. Deactivate it instead.' }, 409);
      await store.delete('category/' + id); return reply({ ok: true });
    }
    const [entries, orders] = await Promise.all(['entry/', 'order/'].map(prefix => list(store, prefix)));
    if (kind === 'competition') {
      if (!await read(store, 'competition/' + id)) return reply({ error: 'Competition not found.' }, 404);
      if (entries.some(e => e.competition === id) || orders.some(o => o.competition === id)) return reply({ error: 'This competition has entries or payment orders. Close it instead.' }, 409);
      // Registration keys include the competition ID even when records have no orders.
      if ((await store.list({ prefix: 'registration/' + id + '/' })).objects.length) return reply({ error: 'This competition has registrations. Close it instead.' }, 409);
      await store.delete('competition/' + id); return reply({ ok: true });
    }
    const account = (await list(store, 'account/')).find(a => a.id === id);
    if (!account) return reply({ error: 'Participant not found.' }, 404);
    if (account.role === 'admin') return reply({ error: 'Administrator accounts cannot be deleted here.' }, 403);
    if (entries.some(e => e.uid === id) || orders.some(o => o.uid === id)) return reply({ error: 'This participant has entries or payment orders. Suspend the account instead.' }, 409);
    let cursor;
    do {
      const page = await store.list({ prefix: 'registration/', cursor });
      if (page.objects.some(o => o.key.endsWith('/' + id))) return reply({ error: 'This participant has registrations. Suspend the account instead.' }, 409);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const key = emailKey(account.email);
    return store.lock(key, async () => {
      const current = await read(store, key);
      if (!current || current.id !== id || current.role === 'admin') return reply({ error: 'Participant could not be deleted.' }, 409);
      let cursor;
      do {
        const page = await store.list({ prefix: 'session/', cursor });
        for (const object of page.objects) {
          const session = await read(store, object.key);
          if (session?.accountKey === key) await store.delete(object.key);
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      await store.delete(key);
      return reply({ ok: true });
    });
  }
  if (path === '/api/admin/category') {
    const name = String(body.name || '').trim();
    if (!name || name.length > 50 || (body.id && !/^[a-zA-Z0-9-]{1,80}$/.test(body.id))) return reply({ error: 'Enter a category name of 1–50 characters.' }, 400);
    const categories = await list(store, 'category/');
    if (categories.some(c => c.id !== body.id && c.name.toLowerCase() === name.toLowerCase())) return reply({ error: 'This category already exists.' }, 409);
    const old = body.id ? await read(store, 'category/' + body.id) : null;
    if (body.id && !old) return reply({ error: 'Category not found.' }, 404);
    if (old && old.name !== name && (await list(store, 'competition/')).some(c => c.category === old.name)) return reply({ error: 'This category is in use. Deactivate it or create another category instead of renaming it.' }, 409);
    const category = { id: old?.id || randomUUID(), name, active: body.active !== false };
    await save(store, 'category/' + category.id, category); return reply(category);
  }
  if (path === '/api/admin/participant') {
    const email = String(body.email || '').trim().toLowerCase(), name = String(body.name || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100) return reply({ error: 'Enter a name and valid email address.' }, 400);
    const key = emailKey(email);
    return store.lock(key, async () => {
      const old = await read(store, key);
      if (body.id) {
        if (!old || old.id !== body.id || old.role === 'admin') return reply({ error: 'Participant not found or cannot be edited here.' }, 404);
        const changed = !!body.disabled !== !!old.disabled;
        const user = { ...old, name, disabled: !!body.disabled, authVersion: (old.authVersion || 1) + (changed ? 1 : 0) };
        await save(store, key, user); return reply(cleanUser(user));
      }
      if (old || email === String(env.ADMIN_EMAIL || '').trim().toLowerCase()) return reply({ error: 'This email is already used or reserved.' }, 409);
      if (typeof body.password !== 'string' || body.password.length < 4 || body.password.length > 20) return reply({ error: 'Use a password of 4–20 characters.' }, 400);
      const user = { id: randomUUID(), email, name, passwordHash: await hashPassword(body.password), role: 'participant', authVersion: 1, created: new Date().toISOString() };
      await save(store, key, user); return reply(cleanUser(user));
    });
  }
  if (path === '/api/admin/review') {
    const entry = await read(store, 'entry/' + String(body.id));
    if (!entry) return reply({ error: 'Entry not found.' }, 404);
    if (!['accepted', 'rejected'].includes(body.reviewStatus)) return reply({ error: 'Choose accept or reject.' }, 400);
    const reason = String(body.reason || '').trim().slice(0, 1000);
    if (body.reviewStatus === 'rejected' && !reason) return reply({ error: 'Enter a rejection reason.' }, 400);
    const updated = { ...entry, reviewStatus: body.reviewStatus, reviewReason: reason, reviewedAt: new Date().toISOString() };
    await save(store, 'entry/' + entry.id, updated); return reply(updated);
  }
  return reply({ error: 'Not found' }, 404);
}
