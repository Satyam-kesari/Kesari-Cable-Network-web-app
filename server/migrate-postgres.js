import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './db.js';
import { createPool, TABLES } from './store.js';

if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const normalize = rows => rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key,
  key === 'amountCents' && row[key] !== null ? Number(row[key]) : row[key],
])));
const fingerprint = rows => createHash('sha256').update(JSON.stringify(normalize(rows))).digest('hex');

async function migrate() {
  const sourceDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
  const sourceFile = resolve(sourceDir, 'kesari.sqlite');
  if (!existsSync(sourceFile)) throw new Error('Existing SQLite database not found. No migration performed.');
  if (process.env.DB_CLIENT === 'postgres') throw new Error('App already uses PostgreSQL. Refusing to import an older SQLite snapshot.');
  const pool = createPool();
  let client, source, snapshot, ownsLock = false, committed = false;
  const lock = resolve(sourceDir, 'migration.lock');
  try {
    client = await pool.connect();
    const existing = await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name='kesari'");
    if (existing.rowCount) throw new Error('Target schema kesari already exists. Refusing to overwrite it. Inspect the previous migration before retrying.');
    writeFileSync(lock, JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }), { flag: 'wx', mode: 0o600 });
    ownsLock = true;
    source = new DatabaseSync(sourceFile, { readOnly: true });
    mkdirSync(resolve(root, 'backups'), { recursive: true });
    const backupFile = resolve(root, 'backups', `before-supabase-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
    await backup(source, backupFile);
    source.close(); source = null;
    snapshot = new DatabaseSync(backupFile, { readOnly: true });
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite backup integrity check failed.');
    const tables = Object.fromEntries(TABLES.map(table => [table, snapshot.prepare(`SELECT ${table === 'metadata' ? '*' : 'rowid AS _order, *'} FROM ${table} ORDER BY ${table === 'metadata' ? 'key' : 'rowid'}`).all()]));
    const counts = Object.fromEntries(TABLES.map(table => [table, tables[table].length]));
    console.log('SQLite backup created. Source counts:', JSON.stringify(counts));
    await client.query('BEGIN');
    await client.query(readFileSync(resolve(root, 'server/postgres-schema.sql'), 'utf8'));
    for (const table of TABLES) {
      const rows = tables[table];
      if (rows.length) {
        const columns = Object.keys(rows[0]);
        for (let offset = 0; offset < rows.length; offset += 200) {
          const batch = rows.slice(offset, offset + 200);
          const params = batch.flatMap(row => columns.map(column => row[column]));
          const groups = batch.map((_, i) => `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(',')})`);
          await client.query(`INSERT INTO kesari."${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES ${groups.join(',')}`, params);
        }
      }
      if (table !== 'metadata') await client.query(`SELECT setval(pg_get_serial_sequence('kesari.${table}', '_order'), COALESCE(MAX("_order"),1), MAX("_order") IS NOT NULL) FROM kesari."${table}"`);
      const target = (await client.query(`SELECT * FROM kesari."${table}" ORDER BY ${table === 'metadata' ? 'key' : '"_order"'}`)).rows;
      if (fingerprint(rows) !== fingerprint(target)) throw new Error(`Exact record verification failed for ${table}. Migration will be rolled back.`);
      console.log(`Verified ${table}: ${rows.length} records, all field values and ordering match.`);
    }
    const receipt = { completedAt: new Date().toISOString(), sourceCounts: counts,
      fingerprints: Object.fromEntries(TABLES.map(table => [table, fingerprint(tables[table])])),
      paymentTotalPaise: tables.payments.reduce((sum, row) => sum + (row.amountCents || 0), 0) };
    await client.query('INSERT INTO kesari.metadata(key,value) VALUES ($1,$2)', ['migration:sqlite', JSON.stringify(receipt)]);
    await client.query('COMMIT'); committed = true;
    writeFileSync(resolve(root, 'backups', 'supabase-migration-receipt.json'), JSON.stringify({ ...receipt, backupFile }, null, 2), { mode: 0o600 });
    console.log('Migration committed. SQLite writes remain paused until DB_CLIENT=postgres is enabled and verified.');
    console.log('Backup:', backupFile);
  } catch (error) {
    if (client && !committed) await client.query('ROLLBACK').catch(() => {});
    if (ownsLock && !committed) unlinkSync(lock);
    throw error;
  } finally {
    source?.close(); snapshot?.close(); client?.release(); await pool.end();
  }
}
try { await migrate(); }
catch (error) { console.error('Migration not completed:', error.code || error.message); process.exitCode = 1; }
