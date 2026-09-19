import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import request from 'supertest';
import { openDatabase, root, sourceDate, todayInIndia, isRechargeEndingSoon } from '../server/db.js';
import { createApp } from '../server/app.js';

let db, app, folder;
before(() => {
  folder = mkdtempSync(resolve(tmpdir(), 'kesari-test-'));
  db = openDatabase(resolve(folder, 'test.sqlite'));
  app = createApp(db);
});
after(() => { db.close(); rmSync(folder, { recursive: true, force: true }); });
const newCustomer = { name: 'Test customer', phone: '9876543210', address: 'Test area', cardNo: '000012340001' };
const newRecharge = { cardNo: newCustomer.cardNo, date: '2026-09-19', fromDate: '2026-09-19', untilDate: '2026-10-18' };

test('ending-soon formula includes exactly yesterday through two days ahead across calendar boundaries', () => {
  for (const today of ['2026-01-01', '2024-03-01', '2026-03-01', '2026-09-19']) {
    for (const offset of [-2, -1, 0, 1, 2, 3, 7]) {
      const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + offset);
      assert.equal(isRechargeEndingSoon(end.toISOString().slice(0, 10), today), [-1, 0, 1, 2].includes(offset));
    }
    assert.equal(isRechargeEndingSoon(null, today), false);
  }
});

test('ending-soon list, count and export use latest recharge dates and retain the window with search', async () => {
  const today = todayInIndia();
  const shifted = offset => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  db.exec('BEGIN');
  try {
    for (const offset of [-2, -1, 0, 1, 2, 3, 10]) {
      const card = `ending-test-${offset}`;
      db.prepare('INSERT INTO customers(id,name,phone,address,cardNo) VALUES (?,?,?,?,?)').run(card, `Ending boundary ${offset}`, '', 'Boundary area', card);
      db.prepare('INSERT INTO recharges(id,cardNo,date,fromDate,untilDate) VALUES (?,?,?,?,?)').run(card, card, today, today, shifted(offset));
    }
    db.prepare('INSERT INTO recharges(id,cardNo,date,fromDate,untilDate) VALUES (?,?,?,?,?)').run('ending-test-old', 'ending-test-10', today, today, today);
    db.prepare('INSERT INTO customers(id,name,phone,address,cardNo) VALUES (?,?,?,?,?)').run('ending-blank', 'Ending boundary blank', '', 'Boundary area', 'ending-blank');
    const list = await request(app).get('/api/customers?endingSoon=1&q=Ending%20boundary&sort=expiry').expect(200);
    assert.deepEqual(list.body.rows.map(r => r.cardNo), [-1, 0, 1, 2].map(n => `ending-test-${n}`));
    const csv = await request(app).get('/api/customers/export?endingSoon=1&area=Boundary%20area').expect(200);
    assert.equal(parse(csv.text, { columns: true, bom: true }).length, 4);
    const all = await request(app).get('/api/customers?endingSoon=1&pageSize=100').expect(200);
    const bootstrap = await request(app).get('/api/bootstrap').expect(200);
    assert.equal(all.body.total, bootstrap.body.stats['ending-soon']);
    assert.ok(all.body.rows.every(r => isRechargeEndingSoon(r.rechargeUntil, today)));
  } finally { db.exec('ROLLBACK'); }
});

test('imports every nonempty source row without losing keys, leading zeros, blanks, or dates', () => {
  for (const [file, table] of [['Summary.csv', 'customers'], ['Payment.csv', 'payments'], ['Recharge.csv', 'recharges']]) {
    const source = parse(readFileSync(resolve(root, file), 'utf8'), { columns: true, bom: true, skip_empty_lines: true }).filter(r => Object.values(r).some(v => v.trim()));
    const records = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    assert.equal(records.length, source.length);
    source.forEach((r, i) => {
      const actual = records[i];
      assert.equal(actual.cardNo, r['Card No.'].trim());
      if (table === 'customers') {
        assert.equal(actual.name, r.Name); assert.equal(actual.phone, r['Ph no.']); assert.equal(actual.address, r.Address);
      } else {
        const payment = table === 'payments';
        assert.equal(actual.id, r[payment ? 'Payment ID' : 'Recharge ID']);
        assert.equal(actual.date, sourceDate(r[payment ? 'Payment Date' : 'Date of recharge']));
        assert.equal(actual.fromDate, sourceDate(r[payment ? 'Payment of recharge from' : 'Recharge from date']));
        assert.equal(actual.untilDate, sourceDate(r[payment ? 'Payment of recharge untill' : 'Recharge uptill Date']));
        if (payment) {
          assert.equal(actual.amountCents, r['Payment Amt.'] ? Math.round(Number(r['Payment Amt.']) * 100) : null);
          assert.equal(actual.comment, r.Comment); assert.equal(actual.mode, r['Payment mode']);
        }
      }
    });
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

test('keeps import idempotent when the database is reopened', () => {
  db.close(); db = openDatabase(resolve(folder, 'test.sqlite')); app = createApp(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, 380);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recharges').get().n, 6628);
});

test('returns original import issues and current review filters without inventing customer links', async () => {
  const { body } = await request(app).get('/api/bootstrap').expect(200);
  assert.equal(body.report.issues.filter(i => i.type === 'missing_customer').length, 692);
  assert.equal(body.report.issues.filter(i => i.type === 'date_range').length, 20);
  assert.equal(body.report.issues.filter(i => i.type === 'duplicate_card').length, 1);
  const missing = await request(app).get('/api/payments?q=000028374973').expect(200);
  assert.equal(missing.body.rows[0].customerState, 'missing');
  assert.equal(missing.body.rows[0].customerId, null);
  const duplicates = await request(app).get('/api/customers?status=review').expect(200);
  assert.equal(duplicates.body.total, 2);
});

test('supports search, area, month, sorting, pagination and CSV exports', async () => {
  const people = await request(app).get('/api/customers?q=N70158509128').expect(200);
  assert.equal(people.body.total, 1); assert.equal(people.body.rows[0].name, 'Anukalp kumar');
  const area = await request(app).get('/api/customers?area=Ramnagar&pageSize=2&page=2').expect(200);
  assert.equal(area.body.total, 3); assert.equal(area.body.rows.length, 1);
  const logs = await request(app).get('/api/recharges?month=2026-08&sort=newest&pageSize=10&page=2').expect(200);
  assert.equal(logs.body.page, 2); assert.equal(logs.body.rows.length, 10);
  assert.ok(logs.body.rows.every(r => r.date.startsWith('2026-08')));
  for (const sort of ['newest', 'oldest']) {
    const payments = await request(app).get(`/api/payments?sort=${sort}&pageSize=100`).expect(200);
    assert.ok(payments.body.rows[0].date);
    assert.equal(payments.body.rows.at(-1).date, null);
  }
  const csv = await request(app).get('/api/customers/export?q=000080241656').expect(200);
  const rows = parse(csv.text, { columns: true, bom: true });
  assert.equal(rows.length, 1); assert.equal(rows[0]['Card No.'], '000080241656');
  const selected = await request(app).get(`/api/customers/export?ids=${people.body.rows[0].id}`).expect(200);
  assert.equal(parse(selected.text, { columns: true, bom: true }).length, 1);
});

test('customer, payment and recharge CRUD recalculates latest dates and protects history', async () => {
  const customer = await request(app).post('/api/customers').send(newCustomer).expect(201);
  const id = customer.body.id;
  await request(app).post('/api/customers').send(newCustomer).expect(409);
  const r1 = await request(app).post('/api/recharges').send(newRecharge).expect(201);
  const r2 = await request(app).post('/api/recharges').send({ ...newRecharge, untilDate: '2026-12-31' }).expect(201);
  const p = await request(app).post('/api/payments').send({ ...newRecharge, amount: 330.25, mode: 'UPI', comment: 'Paid' }).expect(201);
  let detail = await request(app).get(`/api/customers/${id}`).expect(200);
  assert.equal(detail.body.rechargeUntil, '2026-12-31'); assert.equal(detail.body.paymentUntil, '2026-10-18');
  assert.equal(detail.body.payments[0].amount, 330.25); assert.equal(detail.body.rechargeCount, 2);
  await request(app).delete(`/api/customers/${id}`).expect(409);
  await request(app).delete(`/api/recharges/${r2.body.id}`).expect(204);
  detail = await request(app).get(`/api/customers/${id}`).expect(200);
  assert.equal(detail.body.rechargeUntil, '2026-10-18');
  await request(app).put(`/api/recharges/${r1.body.id}`).send({ ...newRecharge, untilDate: '2026-11-18' }).expect(200);
  await request(app).put(`/api/payments/${p.body.id}`).send({ ...newRecharge, amount: 440, mode: 'Cash in Shop', comment: 'Updated' }).expect(200);
  await request(app).put(`/api/customers/${id}`).send({ ...newCustomer, name: 'Updated customer', cardNo: '000012340002' }).expect(200);
  detail = await request(app).get(`/api/customers/${id}`).expect(200);
  assert.equal(detail.body.name, 'Updated customer'); assert.equal(detail.body.recharges[0].cardNo, '000012340002');
  assert.equal(detail.body.payments[0].amount, 440); assert.equal(detail.body.rechargeUntil, '2026-11-18');
  await request(app).delete(`/api/recharges/${r1.body.id}`).expect(204);
  await request(app).delete(`/api/payments/${p.body.id}`).expect(204);
  await request(app).delete(`/api/customers/${id}`).expect(204);
});

test('validates real dates, chronological periods, required fields, money and customer references', async () => {
  await request(app).post('/api/customers').send({ ...newCustomer, name: '' }).expect(400);
  for (const patch of [{ date: '2026-02-30' }, { date: 'not-a-date' }, { untilDate: '2025-01-01' }, { cardNo: 'missing-card' }, { cardNo: 'N70175283178' }]) {
    await request(app).post('/api/recharges').send({ ...newRecharge, cardNo: 'N70158509128', ...patch }).expect(400);
  }
  for (const amount of [-1, 1.001, null, '330']) await request(app).post('/api/payments').send({ ...newRecharge, cardNo: 'N70158509128', amount, mode: 'UPI', comment: '' }).expect(400);
  await request(app).post('/api/payments').send({ ...newRecharge, cardNo: 'N70158509128', amount: 0, mode: '', comment: '' }).expect(400);
});

test('preserves unresolved historical references while allowing their dates to be corrected', async () => {
  const old = db.prepare("SELECT * FROM payments WHERE id='16602658'").get();
  await request(app).put('/api/payments/16602658').send({ cardNo: old.cardNo, date: old.date, fromDate: old.fromDate, untilDate: old.untilDate, amount: old.amountCents / 100, mode: old.mode, comment: old.comment }).expect(200);
  const result = await request(app).get('/api/payments/16602658').expect(200);
  assert.equal(result.body.customerState, 'missing'); assert.equal(result.body.cardNo, '000028374973');
});

test('removing a redundant customer row retains its card history and resolves ambiguity', async () => {
  const duplicateRows = db.prepare("SELECT * FROM customers WHERE cardNo='N70175283178'").all();
  const beforeCount = db.prepare("SELECT COUNT(*) n FROM recharges WHERE cardNo='N70175283178'").get().n;
  await request(app).put(`/api/customers/${duplicateRows[1].id}`).send({ name: 'New', phone: '', address: '', cardNo: 'CHANGED-CARD' }).expect(409);
  await request(app).delete(`/api/customers/${duplicateRows[1].id}`).expect(204);
  const remaining = await request(app).get(`/api/customers/${duplicateRows[0].id}`).expect(200);
  assert.equal(remaining.body.duplicateCard, false); assert.equal(remaining.body.rechargeCount, beforeCount);
  // Restore the original duplicate in this isolated test database.
  const r = duplicateRows[1]; db.prepare('INSERT INTO customers(id,name,phone,address,cardNo,sourceRow) VALUES(?,?,?,?,?,?)').run(r.id, r.name, r.phone, r.address, r.cardNo, r.sourceRow);
});

test('rejects foreign-origin writes, handles missing records, and produces a complete backup', async () => {
  await request(app).post('/api/customers').set('Origin', 'https://unrelated.example').send(newCustomer).expect(403);
  await request(app).get('/api/customers/does-not-exist').expect(404);
  await request(app).get('/api/unknown').expect(404);
  await request(app).delete('/api/customers/does-not-exist').expect(404);
  const { body } = await request(app).get('/api/backup').expect(200);
  assert.equal(body.version, 1); assert.equal(body.customers.length, 380); assert.equal(body.payments.length, 56); assert.equal(body.recharges.length, 6628);
});

test('escapes formula-like text in CSV exports without changing stored text', async () => {
  const { body } = await request(app).post('/api/customers').send({ ...newCustomer, name: '=1+1', cardNo: '000099900099' }).expect(201);
  const csv = await request(app).get(`/api/customers/export?ids=${body.id}`).expect(200);
  assert.equal(parse(csv.text, { columns: true, bom: true })[0].Name, "'=1+1");
  assert.equal(db.prepare('SELECT name FROM customers WHERE id=?').get(body.id).name, '=1+1');
  await request(app).delete(`/api/customers/${body.id}`).expect(204);
});
