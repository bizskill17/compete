import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
for (const path of ['server/admin.js', 'server.js', 'server/app.js', 'server/storage.js', 'server/auth.js', 'server/http.js', 'scripts/admin.mjs']) {
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  assert.equal(result.status, 0, path + ' syntax check failed');
}
const html = await readFile('public/index.html', 'utf8');
const adminHtml = await readFile('public/admin.html', 'utf8');
for (const match of adminHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
assert(!html.includes('signin-with-chatgpt'));
assert(!html.includes('signout-with-chatgpt'));
assert(!html.includes('oai-authenticated-user'));
console.log('Node server and browser scripts validated. No compilation required.');

