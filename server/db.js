import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// AppSheet rule: latest recharge end date equals TODAY() - 1, TODAY(), +1 or +2.
export function isRechargeEndingSoon(untilDate, today = todayInIndia()) {
  if (!untilDate) return false;
  const days = (Date.parse(`${untilDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  return [-1, 0, 1, 2].includes(days);
}

export function sourceDate(value) {
  if (!value?.trim()) return null;
  const [month, day, year] = value.trim().split('/').map(Number);
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error(`Invalid source date: ${value}`);
  return iso;
}

export function openDatabase(filename = resolve(process.env.DATA_DIR || resolve(root, 'data'), 'kesari.sqlite'), sourceDir = root) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '', cardNo TEXT NOT NULL, sourceRow INTEGER,
      createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, cardNo TEXT NOT NULL, amountCents INTEGER,
      date TEXT, fromDate TEXT, untilDate TEXT, mode TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '', sourceRow INTEGER,
      createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS recharges (
      id TEXT PRIMARY KEY, cardNo TEXT NOT NULL, date TEXT, fromDate TEXT, untilDate TEXT,
      sourceRow INTEGER, createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS customers_card ON customers(cardNo);
    CREATE INDEX IF NOT EXISTS payments_card ON payments(cardNo);
    CREATE INDEX IF NOT EXISTS recharges_card ON recharges(cardNo);
    CREATE INDEX IF NOT EXISTS payments_date ON payments(date);
    CREATE INDEX IF NOT EXISTS recharges_date ON recharges(date);
  `);
  if (!db.prepare("SELECT value FROM metadata WHERE key = 'import'").get()) importSources(db, sourceDir);
  return db;
}

function importSources(db, sourceDir) {
  const report = { importedAt: new Date().toISOString(), sources: {}, issues: [] };
  const read = (filename) => {
    const rows = parse(readFileSync(resolve(sourceDir, filename), 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
    const populated = rows.map((row, index) => ({ row, sourceRow: index + 2 })).filter(({ row }) => Object.values(row).some(v => v.trim()));
    report.sources[filename] = { imported: populated.length, skippedBlank: rows.length - populated.length };
    return populated;
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    const insertCustomer = db.prepare('INSERT INTO customers(id,name,phone,address,cardNo,sourceRow) VALUES (?,?,?,?,?,?)');
    for (const { row: r, sourceRow } of read('Summary.csv')) {
      insertCustomer.run(randomUUID(), r.Name, r['Ph no.'], r.Address, r['Card No.'].trim(), sourceRow);
    }
    const cards = new Map(db.prepare('SELECT cardNo, COUNT(*) count FROM customers GROUP BY cardNo').all().map(r => [r.cardNo, r.count]));
    for (const [cardNo, count] of cards) if (count > 1) report.issues.push({ type: 'duplicate_card', table: 'customers', cardNo, message: `${count} customer rows share this card number.` });
    for (const kind of ['payments', 'recharges']) {
      const isPayment = kind === 'payments';
      const file = isPayment ? 'Payment.csv' : 'Recharge.csv';
      const stmt = db.prepare(isPayment
        ? 'INSERT INTO payments(id,cardNo,amountCents,date,fromDate,untilDate,mode,comment,sourceRow) VALUES (?,?,?,?,?,?,?,?,?)'
        : 'INSERT INTO recharges(id,cardNo,date,fromDate,untilDate,sourceRow) VALUES (?,?,?,?,?,?)');
      for (const { row: r, sourceRow } of read(file)) {
        const id = r[isPayment ? 'Payment ID' : 'Recharge ID'];
        const cardNo = r['Card No.'].trim();
        const date = sourceDate(r[isPayment ? 'Payment Date' : 'Date of recharge']);
        const from = sourceDate(r[isPayment ? 'Payment of recharge from' : 'Recharge from date']);
        const until = sourceDate(r[isPayment ? 'Payment of recharge untill' : 'Recharge uptill Date']);
        if (!cards.has(cardNo)) report.issues.push({ type: 'missing_customer', table: kind, id, cardNo, sourceRow, message: 'Card number has no matching customer.' });
        if (from && until && until < from) report.issues.push({ type: 'date_range', table: kind, id, cardNo, sourceRow, message: 'End date is earlier than start date. Original dates preserved.' });
        if (isPayment) {
          const rawAmount = r['Payment Amt.'].trim();
          if (rawAmount && !/^\d+(\.\d{1,2})?$/.test(rawAmount)) throw new Error(`Invalid amount in ${file}, row ${sourceRow}`);
          stmt.run(id, cardNo, rawAmount ? Math.round(Number(rawAmount) * 100) : null, date, from, until, r['Payment mode'], r.Comment, sourceRow);
        } else stmt.run(id, cardNo, date, from, until, sourceRow);
      }
    }
    db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)').run('import', JSON.stringify(report));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}

export async function getData(db, today = todayInIndia()) {
  const snapshot = await db.snapshot();
  return deriveData(snapshot, today);
}

export function deriveData(snapshot, today = todayInIndia()) {
  const customers = snapshot.customers;
  const cards = new Map();
  for (const c of customers) cards.set(c.cardNo, [...(cards.get(c.cardNo) || []), c]);
  const paymentsByCard = new Map(), rechargesByCard = new Map();
  const enrich = (kind, byCard) => snapshot[kind].map(row => {
    const matches = cards.get(row.cardNo) || [];
    const record = {
      ...row,
      name: matches.length === 1 ? matches[0].name : row.cardNo,
      customerId: matches.length === 1 ? matches[0].id : null,
      address: matches.length === 1 ? matches[0].address : '',
      phone: matches.length === 1 ? matches[0].phone : '',
      customerState: matches.length === 0 ? 'missing' : matches.length > 1 ? 'duplicate' : 'linked',
      invalidRange: Boolean(row.fromDate && row.untilDate && row.untilDate < row.fromDate),
      ...(kind === 'payments' ? { amount: row.amountCents === null ? null : row.amountCents / 100 } : {}),
    };
    byCard.set(row.cardNo, [...(byCard.get(row.cardNo) || []), record]);
    return record;
  });
  const payments = enrich('payments', paymentsByCard);
  const recharges = enrich('recharges', rechargesByCard);
  const maxDate = (rows) => rows.reduce((max, r) => r.untilDate && (!max || r.untilDate > max) ? r.untilDate : max, null);
  const people = customers.map(c => {
    const ps = paymentsByCard.get(c.cardNo) || [], rs = rechargesByCard.get(c.cardNo) || [];
    const rechargeUntil = maxDate(rs), paymentUntil = maxDate(ps);
    return { ...c, rechargeUntil, paymentUntil, paymentCount: ps.length, rechargeCount: rs.length,
      duplicateCard: cards.get(c.cardNo).length > 1,
      status: !rechargeUntil ? 'no-history' : rechargeUntil < today ? 'expired' : 'active' };
  });
  return { customers: people, payments, recharges };
}
