import { createStore } from './server/storage.js';
import { createAppServer } from './server/http.js';
const config = process.env;
const store = await createStore(config);
const server = await createAppServer(store, config);
const port = Number(config.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Compete is listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(async () => { await store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
