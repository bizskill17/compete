import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const digest = text => createHash('sha256').update(text).digest('hex');
const normalize = email => String(email || '').trim().toLowerCase();
const read = async (store, key) => (await store.get(key))?.json();
const save = (store, key, data) => store.put(key, JSON.stringify(data));
export const emailKey = email => 'account/' + digest(normalize(email));
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return salt + ':' + hash.toString('hex');
}
async function matches(password, stored) {
  const [salt, encoded] = stored.split(':');
  const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(encoded, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function validate(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password of 12–128 characters.');
}
export async function createAdmin(store, email, password) {
  email = normalize(email); validate(email, password);
  await store.lock(emailKey(email), async () => {
    const old = await read(store, emailKey(email));
    if (old) throw new Error('An account already uses this email. Use the explicit admin recovery command.');
    await save(store, emailKey(email), { id: randomUUID(), email, name: 'Organizer', passwordHash: await hashPassword(password), role: 'admin', authVersion: 1 });
  });
}
export async function recoverAdmin(store, email, password) {
  email = normalize(email); validate(email, password);
  await store.lock(emailKey(email), async () => {
    const old = await read(store, emailKey(email));
    if (!old) throw new Error('Account not found. Use create-admin.');
    await save(store, emailKey(email), { ...old, passwordHash: await hashPassword(password), role: 'admin', authVersion: (old.authVersion || 1) + 1 });
  });
}
export async function identity(store, cookie = '') {
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('compete_session='))?.slice(16);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const key = 'session/' + digest(token), session = await read(store, key);
  if (!session) return null;
  if (session.expires < Date.now()) { await store.delete(key); return null; }
  const user = await read(store, session.accountKey);
  if (!user || user.disabled || (user.authVersion || 1) !== session.version) return null;
  return { id: user.id, email: user.email, name: user.name, admin: user.role === 'admin', sessionKey: key };
}
export async function authenticate(store, config, path, body, cookie) {
  const current = await identity(store, cookie), secure = config.NODE_ENV === 'production' ? '; Secure' : '';
  const sessionCookie = token => 'compete_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800' + secure;
  if (path === '/api/auth/logout') {
    if (current) await store.delete(current.sessionKey);
    return { body: { ok: true }, cookie: 'compete_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secure };
  }
  const email = normalize(body.email), password = body.password;
  if (typeof password !== 'string' || password.length > 128) return { status: 400, body: { error: 'Invalid credentials.' } };
  validate(email, password);
  // Persistent per-account attempt budget; lock also prevents duplicate signups.
  return store.lock(emailKey(email), async () => {
    const rateKey = 'auth-rate/' + digest(email), now = Date.now();
    let rate = await read(store, rateKey);
    if (!rate || rate.until < now) rate = { count: 0, until: now + 15 * 60 * 1000 };
    if (rate.count >= 10) return { status: 429, body: { error: 'Too many attempts. Please retry in 15 minutes.' } };
    rate.count++; await save(store, rateKey, rate);
    let user = await read(store, emailKey(email));
    if (path === '/api/auth/register') {
      const name = String(body.name || '').trim().slice(0, 100);
      if (!name || user || (config.ADMIN_EMAIL && email === normalize(config.ADMIN_EMAIL))) return { status: 400, body: { error: 'Unable to register this account. Try signing in or contact the organizer.' } };
      user = { id: randomUUID(), email, name, passwordHash: await hashPassword(password), role: 'participant', authVersion: 1 };
      await save(store, emailKey(email), user);
    } else {
      // Dummy derivation keeps unknown-account timing close to incorrect-password timing.
      const valid = await matches(password, user?.passwordHash || '00000000000000000000000000000000:' + '00'.repeat(64));
      if (!user || user.disabled || !valid) return { status: 401, body: { error: 'Email or password is incorrect.' } };
    }
    await store.delete(rateKey);
    const token = randomBytes(32).toString('hex');
    await save(store, 'session/' + digest(token), { accountKey: emailKey(email), version: user.authVersion || 1, expires: now + 7 * 86400000 });
    return { body: { ok: true }, cookie: sessionCookie(token) };
  });
}

