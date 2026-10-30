// Hostinger's LiteSpeed launcher loads this entry with require().
// Keep the entry synchronous; load the ESM application asynchronously.
async function start() {
  const [{ createStore }, { createAppServer }] = await Promise.all([
    import('./server/storage.js'),
    import('./server/http.js'),
  ]);
  const config = process.env;
  const store = await createStore(config);
  const server = await createAppServer(store, config);
  const port = Number(config.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Compete is listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(async () => { await store.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}

start().catch(error => {
  console.error('Compete startup failed:', error);
  process.exit(1);
});
