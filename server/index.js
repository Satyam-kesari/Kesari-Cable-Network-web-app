import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, openDatabase } from './db.js';
import { createApp } from './app.js';
import { createPool, postgresStore } from './store.js';

if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const port = Number(process.env.PORT || 5191);
const host = process.env.HOST || '127.0.0.1';
const client = process.env.DB_CLIENT || 'sqlite';
if (!['sqlite', 'postgres'].includes(client)) throw new Error('DB_CLIENT must be sqlite or postgres.');
const db = client === 'postgres' ? postgresStore(createPool()) : openDatabase();
if (client === 'postgres') {
  try {
    if (!(await db.get("SELECT value FROM metadata WHERE key='migration:sqlite'"))) throw new Error('Run the verified SQLite migration before enabling PostgreSQL.');
  } catch (error) { await db.close(); console.error('PostgreSQL startup failed:', error.code || error.message); process.exit(1); }
}
const server = createApp(db).listen(port, host, () => console.log(`Kesari Cable Network API: http://${host}:${port}`));
server.on('error', async error => { console.error(error.message); await db.close(); process.exit(1); });
const stop = () => server.close(async () => { await db.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
