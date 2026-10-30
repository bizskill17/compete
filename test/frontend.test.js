import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const settle = () => new Promise(resolve => setImmediate(resolve));
test('account dialogs and organizer form remain usable after asynchronous actions', async t => {
  const html = (await readFile('public/index.html', 'utf8')).replace(/<script src=[^>]+><\/script>/g, '');
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => { if (e.type !== 'css-parsing') errors.push(e); });
  let loggedIn = false;
  const competition = { id: 'test', title: 'Rangoli test', category: 'Rangoli', description: 'Art', rules: 'Original', fee: 199, prizes: [1000, 500, 250], deadline: '2099-11-07', status: 'open' };
  const window = new JSDOM(html, { url: 'http://127.0.0.1:3000', runScripts: 'dangerously', virtualConsole, beforeParse(w) {
    w.scrollTo = () => {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    w.fetch = async (url, options) => {
      if (url === '/api/state') return { ok: true, json: async () => ({ competitions: [competition], demo: false, admin: loggedIn, user: loggedIn ? { email: 'owner@example.com' } : null, ready: { payments: false, ai: false, admin: true } }) };
      if (url === '/api/auth/login') { loggedIn = true; return { ok: true, json: async () => ({ ok: true }) }; }
      if (url === '/api/auth/logout') { loggedIn = false; return { ok: true, json: async () => ({ ok: true }) }; }
      if (url === '/api/admin/competition') return { ok: true, json: async () => competition };
      throw Error('Unexpected request: ' + url);
    };
  } }).window;
  t.after(() => window.close());
  await settle(); await settle();
  const document = window.document;
  assert(document.querySelector('[data-view=admin]').classList.contains('hide'));
  document.querySelector('#account').click();
  assert.equal(document.querySelector('#authDialog').open, true);
  const toggle = document.querySelector('#authForm .password-toggle');
  assert.equal(document.querySelector('#authPassword').minLength, 4); assert.equal(document.querySelector('#authPassword').maxLength, 20);
  toggle.click(); assert.equal(document.querySelector('#authPassword').type, 'text');
  toggle.click(); assert.equal(document.querySelector('#authPassword').type, 'password');
  document.querySelector('#registerTab').click(); assert.equal(document.querySelector('#authName').required, true);
  document.querySelector('#loginTab').click(); assert.equal(document.querySelector('#authName').required, false);
  document.querySelector('#authEmail').value = 'owner@example.com'; document.querySelector('#authPassword').value = 'Owner-password-123';
  await document.querySelector('#authForm').onsubmit({ preventDefault() {}, target: document.querySelector('#authForm') });
  assert.equal(document.querySelector('#authDialog').open, false);
  assert.equal(document.querySelector('[data-view=admin]').classList.contains('hide'), false);
  document.querySelector('#newComp').click(); assert.equal(document.querySelector('#compDialog').open, true);
  const form = document.querySelector('#compForm');
  form.elements.title.value = 'New competition'; form.elements.description.value = 'Creative work'; form.elements.rules.value = 'Original'; form.elements.deadline.value = '2099-11-07';
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.equal(form.querySelector('button:not(.password-toggle)').disabled, false, 'Save button restored after successful save');
  assert.equal(document.querySelector('#compDialog').open, false);
  document.querySelector('#account').click(); await document.querySelector('#signOut').onclick();
  assert.match(document.querySelector('#account').textContent, /Sign in/);
  assert.equal(errors.length, 0, errors.map(e => e.message).join('\n'));
});

