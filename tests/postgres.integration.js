// Explicit opt-in: exercises the configured Supabase DB using disposable records.
// Run with npm run test:postgres, never as part of the default SQLite test suite.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { parse } from 'csv-parse/sync';
import { createApp } from '../server/app.js';
import { createPool, postgresStore } from '../server/store.js';
import { todayInIndia } from '../server/db.js';

process.loadEnvFile('.env');
const pool = createPool();
const store = postgresStore(pool);
const app = createApp(store);
const marker = `migration-check-${randomUUID()}`;
const cardNo = `0000-${marker}`, changedCard = `${cardNo}-updated`;
const customer = { name: marker, phone: '9876543210', address: 'Migration verification', cardNo };
const today = todayInIndia();
const period = { cardNo, date: today, fromDate: today, untilDate: today };
const before = await store.snapshot();
try {
  assert.equal((await request(app).get('/api/health').expect(200)).body.storage, 'postgres');
  const bootstrap = (await request(app).get('/api/bootstrap').expect(200)).body;
  assert.equal(bootstrap.storage, 'postgres');
  for (const kind of ['customers', 'payments', 'recharges']) {
    const list = (await request(app).get(`/api/${kind}`).expect(200)).body;
    assert.equal(list.total, before[kind].length);
    const csv = await request(app).get(`/api/${kind}/export`).expect(200);
    assert.equal(parse(csv.text, { columns: true, bom: true }).length, before[kind].length);
  }
  console.log('PASS PostgreSQL reads, counts and exports for all three views.');
  const created = (await request(app).post('/api/customers').send(customer).expect(201)).body;
  await request(app).post('/api/customers').send(customer).expect(409);
  const recharge = (await request(app).post('/api/recharges').send(period).expect(201)).body;
  const payment = (await request(app).post('/api/payments').send({ ...period, amount: 330.25, mode: 'UPI', comment: 'Temporary migration verification' }).expect(201)).body;
  let detail = (await request(app).get(`/api/customers/${created.id}`).expect(200)).body;
  assert.equal(detail.cardNo, cardNo); assert.equal(detail.rechargeUntil, today);
  assert.equal(detail.paymentUntil, today); assert.equal(detail.payments[0].amount, 330.25);
  assert.equal(typeof detail.payments[0].amountCents, 'number');
  const due = (await request(app).get(`/api/customers?endingSoon=1&q=${marker}`).expect(200)).body;
  assert.equal(due.total, 1);
  await request(app).delete(`/api/customers/${created.id}`).expect(409);
  await request(app).put(`/api/payments/${payment.id}`).send({ ...period, amount: 440, mode: 'Cash in Shop', comment: '' }).expect(200);
  await request(app).put(`/api/recharges/${recharge.id}`).send(period).expect(200);
  await request(app).put(`/api/customers/${created.id}`).send({ ...customer, cardNo: changedCard }).expect(200);
  detail = (await request(app).get(`/api/customers/${created.id}`).expect(200)).body;
  assert.equal(detail.payments[0].amount, 440);
  assert.equal(detail.recharges[0].cardNo, changedCard);
  assert.equal(detail.payments[0].cardNo, changedCard);
  await request(app).post('/api/recharges').send({ ...period, cardNo: changedCard, untilDate: '2000-01-01' }).expect(400);
  console.log('PASS PostgreSQL creation, updates, exact amounts, date summaries, ending-soon filter and history protection.');
  await request(app).delete(`/api/payments/${payment.id}`).expect(204);
  await request(app).delete(`/api/recharges/${recharge.id}`).expect(204);
  await request(app).delete(`/api/customers/${created.id}`).expect(204);
  // Concurrent attempts for a new card must not produce duplicates.
  const results = await Promise.all([1, 2].map(() => request(app).post('/api/customers').send(customer)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  await request(app).delete(`/api/customers/${results.find(r => r.status === 201).body.id}`).expect(204);
  await assert.rejects(store.transaction(async tx => {
    await tx.run('INSERT INTO customers(id,name,phone,address,cardNo) VALUES (?,?,?,?,?)', marker, marker, '', '', cardNo);
    throw new Error('Intentional rollback test');
  }), /Intentional rollback test/);
  assert.equal(await store.get('SELECT id FROM customers WHERE id=?', marker), undefined);
  console.log('PASS concurrent duplicate protection, transaction rollback and deletes.');
  const exported = (await request(app).get('/api/backup').expect(200)).body;
  for (const table of ['customers', 'payments', 'recharges', 'metadata']) assert.deepEqual(exported[table], before[table]);
  console.log('PASS complete backup; all original records remain unchanged.');
} finally {
  try {
    await store.transaction(async tx => {
      for (const card of [cardNo, changedCard]) {
        for (const table of ['payments', 'recharges', 'customers']) await tx.run(`DELETE FROM ${table} WHERE cardNo=?`, card);
      }
    });
  } finally { await store.close(); }
}
