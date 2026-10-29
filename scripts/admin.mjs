import { createStore } from '../server/storage.js';
import { createAdmin, recoverAdmin } from '../server/auth.js';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_SETUP_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_SETUP_PASSWORD in the command environment. Never pass a password as an argument.');
const store = await createStore(process.env);
try {
  const action = process.argv[2] === 'recover' ? recoverAdmin : createAdmin;
  await action(store, process.env.ADMIN_EMAIL, process.env.ADMIN_SETUP_PASSWORD);
  console.log('Organizer account updated. Remove ADMIN_SETUP_PASSWORD after setup.');
} finally { await store.close(); }
