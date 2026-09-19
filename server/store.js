import pg from 'pg';
import { readFileSync } from 'node:fs';
import { postgresReads } from './postgres-read.js';

export const TABLES = ['customers', 'payments', 'recharges', 'metadata'];
export const PG_SCHEMA = 'kesari';

export function createPool() {
  const raw = process.env.DATABASE_URL;
  if (!raw || raw.includes('REPLACE_')) throw new Error('Set DATABASE_URL in .env before connecting to Supabase.');
  const url = new URL(raw);
  // Configure TLS explicitly: URL SSL options must not override certificate verification.
  const cert = process.env.PGSSLROOTCERT || url.searchParams.get('sslrootcert');
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  return new pg.Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000, statement_timeout: 30000,
    ssl: { rejectUnauthorized: true, ...(cert ? { ca: readFileSync(cert, 'utf8') } : {}) },
    types: { getTypeParser: (oid, format) => oid === 1082 ? value => value : pg.types.getTypeParser(oid, format) },
  });
}

// The app's SQL uses a small, controlled subset shared by the two databases.
// Table/column identifiers originate in server code; all user values are bound.
export function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\b(customers|payments|recharges|metadata)\b/g, name => `"${PG_SCHEMA}"."${name}"`)
    .replace(/\b(cardNo|amountCents|fromDate|untilDate|sourceRow|createdAt)\b/g, name => `"${name}"`)
    .replace(/\browid\b/g, '"_order"').replace(/\?/g, () => `$${++index}`);
}

function cleanRow(row) {
  if (!row) return undefined;
  const { _order, ...result } = row;
  if (typeof result.count === 'string') result.count = Number(result.count);
  if (typeof result.amountCents === 'string') {
    result.amountCents = Number(result.amountCents);
    if (!Number.isSafeInteger(result.amountCents)) throw new Error('Payment amount exceeds the supported exact integer range.');
  }
  return result;
}

function postgresQueries(connection) {
  return {
    storage: 'postgres',
    async all(sql, ...values) { return (await connection.query(postgresSql(sql), values)).rows.map(cleanRow); },
    async get(sql, ...values) { return cleanRow((await connection.query(postgresSql(sql), values)).rows[0]); },
    async run(sql, ...values) { return connection.query(postgresSql(sql), values); },
  };
}

export function postgresStore(pool) {
  const store = { ...postgresQueries(pool), reads: postgresReads(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize this app's writes, including validation, across backend instances.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('kesari.write'))");
        const result = await fn(postgresQueries(client));
        await client.query('COMMIT'); return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async snapshot() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const tables = {};
        for (const table of TABLES) tables[table] = await postgresQueries(client).all(`SELECT * FROM ${table} ORDER BY ${table === 'metadata' ? 'key' : 'rowid'}`);
        await client.query('COMMIT'); return tables;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
  return store;
}

export function sqliteStore(db) {
  let pending = Promise.resolve();
  const store = {
    storage: 'sqlite',
    all(sql, ...values) { return db.prepare(sql).all(...values); },
    get(sql, ...values) { return db.prepare(sql).get(...values); },
    run(sql, ...values) { return db.prepare(sql).run(...values); },
    async transaction(fn) {
      const previous = pending;
      let release; pending = new Promise(resolve => { release = resolve; });
      await previous;
      db.exec('BEGIN IMMEDIATE');
      try { const result = await fn(store); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      finally { release(); }
    },
    snapshot() { return Object.fromEntries(TABLES.map(table => [table, store.all(`SELECT * FROM ${table} ORDER BY ${table === 'metadata' ? 'key' : 'rowid'}`)])); },
    close() { db.close(); },
  };
  return store;
}
