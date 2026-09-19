import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { sqliteStore } from './store.js';
import { getData, root, todayInIndia, isRechargeEndingSoon } from './db.js';

const text = z.string().trim().max(250);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Use a valid calendar date.');
const customerSchema = z.object({ name: text.min(1, 'Customer name is required.'), phone: text, address: text, cardNo: text.min(1, 'Card number is required.') });
const baseLog = { cardNo: text.min(1, 'Choose a customer.'), date, fromDate: date, untilDate: date };
const schemas = {
  customers: customerSchema,
  payments: z.object({ ...baseLog, amount: z.number().finite().nonnegative().max(10000000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, 'Use up to two decimal places.'), mode: text.min(1, 'Payment mode is required.'), comment: z.string().trim().max(4000) }),
  recharges: z.object(baseLog),
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const kinds = new Set(Object.keys(schemas));
const csvCell = v => {
  let s = String(v ?? '');
  // Prevent spreadsheet formula execution when user-entered text is exported.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};
const csvDate = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(0, 4)}` : '';

export function filtered(rows, query, kind) {
  let result = rows;
  if (kind === 'customers' && query.endingSoon === '1') result = result.filter(r => isRechargeEndingSoon(r.rechargeUntil));
  const q = String(query.q || '').toLocaleLowerCase().trim();
  if (q) result = result.filter(r => [r.name, r.cardNo, r.phone, r.address, r.id, r.comment].some(v => v?.toLocaleLowerCase().includes(q)));
  if (query.area) result = result.filter(r => r.address === query.area);
  if (query.status === 'review') result = result.filter(r => r.duplicateCard || r.customerState === 'missing' || r.customerState === 'duplicate' || r.invalidRange || (kind === 'payments' && (r.amount === null || !r.date || !r.fromDate || !r.untilDate || !r.mode)) || (kind === 'recharges' && (!r.date || !r.fromDate || !r.untilDate)));
  else if (query.status) result = result.filter(r => r.status === query.status);
  if (query.month) result = result.filter(r => r.date?.startsWith(String(query.month)));
  if (query.mode) result = result.filter(r => r.mode === query.mode);
  if (query.ids) { const ids = new Set(String(query.ids).split(',')); result = result.filter(r => ids.has(r.id)); }
  const sort = query.sort || (kind === 'customers' ? 'source' : 'newest');
  if (sort === 'name') result = [...result].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'newest' || sort === 'oldest') result = [...result].sort((a, b) => {
    const aDate = kind === 'customers' ? a.createdAt : a.date;
    const bDate = kind === 'customers' ? b.createdAt : b.date;
    if (!aDate || !bDate) return aDate ? -1 : bDate ? 1 : 0;
    return aDate.localeCompare(bDate) * (sort === 'newest' ? -1 : 1);
  });
  if (sort === 'expiry') result = [...result].sort((a, b) => (a.rechargeUntil || '9999').localeCompare(b.rechargeUntil || '9999'));
  return result;
}

export function createApp(database) {
  const db = database.storage ? database : sqliteStore(database);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (db.storage === 'sqlite' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && existsSync(resolve(process.env.DATA_DIR || resolve(root, 'data'), 'migration.lock'))) return res.status(503).json({ error: 'Database migration in progress. Please wait before saving changes.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      const allowed = new Set([`http://127.0.0.1:${process.env.VITE_PORT || 5190}`, `http://localhost:${process.env.VITE_PORT || 5190}`, `http://127.0.0.1:${process.env.PORT || 5191}`, `http://localhost:${process.env.PORT || 5191}`]);
      if (!allowed.has(req.headers.origin)) return next(fail(403, 'Requests from this origin are not allowed.'));
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', async (req, res) => { await db.get('SELECT 1 AS ok'); res.json({ ok: true, storage: db.storage }); });
  app.get('/api/bootstrap', async (req, res) => {
    const today = todayInIndia();
    const overview = db.reads ? await db.reads.overview() : null;
    const data = overview ? { customers: overview.customers, payments: [], recharges: [] } : await getData(db, today);
    const nextWeek = new Date(`${today}T00:00:00Z`); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const report = JSON.parse((await db.get("SELECT value FROM metadata WHERE key='import'")).value);
    const reviewCounts = overview?.reviewCounts || Object.fromEntries([...kinds].map(kind => [kind, filtered(data[kind], { status: 'review' }, kind).length]));
    res.json({ today, storage: db.storage, customers: data.customers, areas: [...new Set(data.customers.map(c => c.address).filter(Boolean))].sort(),
      modes: [...new Set(['UPI', 'Cash in Shop', 'Cash on Collection', 'Bank Transfer', ...(overview?.modes || data.payments.map(p => p.mode).filter(Boolean))])],
      stats: { customers: data.customers.length, payments: overview?.payments ?? data.payments.length, recharges: overview?.recharges ?? data.recharges.length,
        'ending-soon': data.customers.filter(c => isRechargeEndingSoon(c.rechargeUntil, today)).length,
        active: data.customers.filter(c => c.status === 'active').length,
        expired: data.customers.filter(c => c.status === 'expired').length,
        expiring: data.customers.filter(c => c.status === 'active' && c.rechargeUntil <= nextWeek.toISOString().slice(0, 10)).length,
        collected: overview?.collected ?? data.payments.reduce((sum, p) => sum + (p.amountCents || 0), 0) / 100,
        reviewCounts }, report });
  });
  app.get('/api/backup', async (req, res) => {
    const tables = await db.snapshot();
    res.attachment(`kesari-backup-${todayInIndia()}.json`).json({ version: 1, exportedAt: new Date().toISOString(), storage: db.storage, ...tables });
  });
  app.param('kind', (req, res, next, kind) => kinds.has(kind) ? next() : next(fail(404, 'Unknown record type.')));
  app.get('/api/:kind/export', async (req, res) => {
    const kind = req.params.kind;
    const rows = db.reads ? await db.reads.list(kind, req.query, true) : filtered((await getData(db))[kind], req.query, kind);
    const headers = kind === 'customers' ? ['Name', 'Ph no.', 'Address', 'Card No.'] : kind === 'payments'
      ? ['Payment ID', 'Card No.', 'Payment Amt.', 'Payment Date', 'Payment of recharge from', 'Payment of recharge untill', 'Payment mode', 'Comment']
      : ['Recharge ID', 'Card No.', 'Date of recharge', 'Recharge from date', 'Recharge uptill Date'];
    const values = rows.map(r => kind === 'customers' ? [r.name, r.phone, r.address, r.cardNo] : kind === 'payments'
      ? [r.id, r.cardNo, r.amount, csvDate(r.date), csvDate(r.fromDate), csvDate(r.untilDate), r.mode, r.comment]
      : [r.id, r.cardNo, csvDate(r.date), csvDate(r.fromDate), csvDate(r.untilDate)]);
    res.attachment(`${kind}-${todayInIndia()}.csv`).type('text/csv').send('\uFEFF' + [headers, ...values].map(row => row.map(csvCell).join(',')).join('\r\n'));
  });
  app.get('/api/:kind', async (req, res) => {
    const kind = req.params.kind;
    if (db.reads) return res.json(await db.reads.list(kind, req.query));
    const rows = filtered((await getData(db))[kind], req.query, kind);
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(req.query.pageSize, 10) || 25));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.max(1, Math.min(pages, Number.parseInt(req.query.page, 10) || 1));
    res.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pages,
      totalAmount: kind === 'payments' ? rows.reduce((s, r) => s + (r.amountCents || 0), 0) / 100 : undefined });
  });
  app.get('/api/:kind/:id', async (req, res) => {
    if (db.reads) {
      const record = await db.reads.detail(req.params.kind, req.params.id);
      if (!record) throw fail(404, 'Record not found.');
      return res.json(record);
    }
    const data = await getData(db);
    const record = data[req.params.kind].find(r => r.id === req.params.id);
    if (!record) throw fail(404, 'Record not found.');
    res.json(req.params.kind === 'customers' ? { ...record,
      payments: data.payments.filter(p => p.cardNo === record.cardNo).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      recharges: data.recharges.filter(r => r.cardNo === record.cardNo).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    } : record);
  });

  async function save(req, res) {
    const result = await db.transaction(async db => {
    const { kind, id } = req.params;
    const previous = id ? await db.get(`SELECT * FROM ${kind} WHERE id = ?`, id) : null;
    if (id && !previous) throw fail(404, 'Record not found.');
    const parsed = schemas[kind].safeParse(req.body);
    if (!parsed.success) throw fail(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' '));
    const values = parsed.data;
    if (kind !== 'customers') {
      if (values.untilDate < values.fromDate) throw fail(400, 'End date must be on or after start date.');
      const matches = (await db.get('SELECT COUNT(*) count FROM customers WHERE cardNo=?', values.cardNo)).count;
      // A historical unresolved card may be retained during correction; new references must resolve uniquely.
      if (matches !== 1 && (!previous || previous.cardNo !== values.cardNo)) throw fail(400, matches ? 'This card belongs to multiple customer rows. Resolve the duplicate first.' : 'Choose an existing customer, or add the customer first.');
    } else {
      const count = (await db.get('SELECT COUNT(*) count FROM customers WHERE cardNo=? AND id != ?', values.cardNo, id || '')).count;
      if (count && (!previous || previous.cardNo !== values.cardNo)) throw fail(409, 'This card number already belongs to another customer.');
      if (previous && previous.cardNo !== values.cardNo) {
        const oldMatches = (await db.get('SELECT COUNT(*) count FROM customers WHERE cardNo=?', previous.cardNo)).count;
        if (oldMatches > 1) throw fail(409, 'This card is shared by duplicate customer rows. Remove the redundant customer row before changing its card number.');
      }
    }
    const recordId = id || randomUUID();
    if (kind === 'payments') { values.amountCents = Math.round(values.amount * 100); delete values.amount; }

      if (previous && kind === 'customers' && previous.cardNo !== values.cardNo) {
        for (const table of ['payments', 'recharges']) await db.run(`UPDATE ${table} SET cardNo=? WHERE cardNo=?`, values.cardNo, previous.cardNo);
      }
      const entries = Object.entries(values);
      if (previous) await db.run(`UPDATE ${kind} SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`, ...entries.map(([, value]) => value), recordId);
      else await db.run(`INSERT INTO ${kind}(id,${entries.map(([key]) => key).join(',')}) VALUES (${['?', ...entries.map(() => '?')].join(',')})`, recordId, ...entries.map(([, value]) => value));
      return { status: previous ? 200 : 201, id: recordId };
    });
    res.status(result.status).json({ id: result.id });
  }
  app.post('/api/:kind', save);
  app.put('/api/:kind/:id', save);
  app.delete('/api/:kind/:id', async (req, res) => {
    await db.transaction(async db => {
    const { kind, id } = req.params;
    const row = await db.get(`SELECT * FROM ${kind} WHERE id=?`, id);
    if (!row) throw fail(404, 'Record not found.');
    if (kind === 'customers') {
      const matches = (await db.get('SELECT COUNT(*) count FROM customers WHERE cardNo=?', row.cardNo)).count;
      const counts = await Promise.all(['payments', 'recharges'].map(table => db.get(`SELECT COUNT(*) count FROM ${table} WHERE cardNo=?`, row.cardNo)));
      const related = counts.reduce((sum, row) => sum + row.count, 0);
      if (matches === 1 && related) throw fail(409, 'This customer has payment or recharge history. Keep the customer to preserve those records.');
    }
    await db.run(`DELETE FROM ${kind} WHERE id=?`, id);
    });
    res.status(204).end();
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  const dist = resolve(root, 'dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('Database request failed:', error.code || error.name);
    res.status(status).json({ error: status >= 500 ? 'The record could not be saved. Please try again.' : error.message });
  });
  return app;
}
