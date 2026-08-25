import { createApp } from './assemble.js';

/** example · 启动入口：组装（内核 + 中间件 + 连接器）后监听。 */
const port = Number(process.env.PORT ?? 3001);
createApp()
  .then((app) => app.listen({ port, host: '0.0.0.0' }))
  .then(() => {
    const ingest = process.env.KAOGONGSI_INGEST;
    const db = process.env.DATABASE_URL ? ' db:postgres' : '';
    const cache = process.env.REDIS_URL ? ' cache:redis' : '';
    console.log(`example-app listening on :${port}${ingest ? ` (ingest: ${ingest})` : ''}${db}${cache}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
