import { backup } from 'node:sqlite';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase, root } from './db.js';
import { createPool, postgresStore } from './store.js';

if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
mkdirSync(resolve(root, 'backups'), { recursive: true });
const stamp = new Date().toISOString().replaceAll(':', '-');
if (process.env.DB_CLIENT === 'postgres') {
  const store = postgresStore(createPool());
  try {
    const filename = resolve(root, 'backups', `kesari-postgres-${stamp}.json`);
    writeFileSync(filename, JSON.stringify({ version: 1, storage: 'postgres', exportedAt: new Date().toISOString(), ...await store.snapshot() }, null, 2), { mode: 0o600 });
    console.log(`PostgreSQL data export saved: ${filename}`);
  } finally { await store.close(); }
} else {
  const db = openDatabase();
  try {
    const filename = resolve(root, 'backups', `kesari-${stamp}.sqlite`);
    await backup(db, filename);
    console.log(`SQLite backup saved: ${filename}`);
  } finally { db.close(); }
}
