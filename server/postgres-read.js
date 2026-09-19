import { todayInIndia } from './db.js';

const kinds = new Set(['customers', 'payments', 'recharges']);
const customerSql = `
 SELECT c.*, r.until AS "rechargeUntil", p.until AS "paymentUntil",
 COALESCE(r.count,0)::int AS "rechargeCount", COALESCE(p.count,0)::int AS "paymentCount",
 count(*) OVER (PARTITION BY c."cardNo") > 1 AS "duplicateCard",
 CASE WHEN r.until IS NULL THEN 'no-history' WHEN r.until < $1::date THEN 'expired' ELSE 'active' END AS status
 FROM kesari.customers c
 LEFT JOIN (SELECT "cardNo",max("untilDate") AS until,count(*) AS count FROM kesari.recharges GROUP BY "cardNo") r ON r."cardNo"=c."cardNo"
 LEFT JOIN (SELECT "cardNo",max("untilDate") AS until,count(*) AS count FROM kesari.payments GROUP BY "cardNo") p ON p."cardNo"=c."cardNo"`;

function baseSql(kind) {
  if (!kinds.has(kind)) throw new Error('Unknown table');
  if (kind === 'customers') return customerSql;
  return `SELECT t.*,
    CASE WHEN c.count=1 THEN c.name ELSE t."cardNo" END AS name,
    CASE WHEN c.count=1 THEN c.id ELSE NULL END AS "customerId",
    CASE WHEN c.count=1 THEN c.address ELSE '' END AS address,
    CASE WHEN c.count=1 THEN c.phone ELSE '' END AS phone,
    CASE WHEN c.count IS NULL THEN 'missing' WHEN c.count>1 THEN 'duplicate' ELSE 'linked' END AS "customerState",
    (t."fromDate" IS NOT NULL AND t."untilDate" IS NOT NULL AND t."untilDate"<t."fromDate") AS "invalidRange"
    ${kind === 'payments' ? ', t."amountCents"::numeric / 100 AS amount' : ''}
    FROM kesari.${kind} t
    LEFT JOIN (SELECT "cardNo",count(*) AS count,min(name) AS name,min(id) AS id,min(address) AS address,min(phone) AS phone FROM kesari.customers GROUP BY "cardNo") c ON c."cardNo"=t."cardNo"
    WHERE $1::date IS NOT NULL`;
}

function conditions(kind, query, values) {
  const clauses = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  if (query.q) clauses.push(`position(lower(${bind(String(query.q).trim())}) in lower(concat_ws(' ',name,"cardNo",phone,address,id${kind === 'payments' ? ',comment' : ''})))>0`);
  if (query.area) clauses.push(`address=${bind(query.area)}`);
  if (kind === 'customers' && query.endingSoon === '1') clauses.push('"rechargeUntil" BETWEEN $1::date - 1 AND $1::date + 2');
  if (query.status === 'review') clauses.push(kind === 'customers' ? '"duplicateCard"' : `("customerState"<>'linked' OR "invalidRange" OR date IS NULL OR "fromDate" IS NULL OR "untilDate" IS NULL ${kind === 'payments' ? 'OR "amountCents" IS NULL OR mode=\'\'' : ''})`);
  else if (query.status) clauses.push(kind === 'customers' ? `status=${bind(query.status)}` : 'FALSE');
  if (query.month) clauses.push(kind === 'customers' ? 'FALSE' : `substring(date::text,1,7)=${bind(query.month)}`);
  if (query.mode) clauses.push(kind === 'payments' ? `mode=${bind(query.mode)}` : 'FALSE');
  if (query.ids) clauses.push(`id=ANY(${bind(String(query.ids).split(','))}::text[])`);
  if (query.cardNo !== undefined) clauses.push(`"cardNo"=${bind(query.cardNo)}`);
  if (query.id) clauses.push(`id=${bind(query.id)}`);
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

const normalize = row => {
  const { _order, ...record } = row;
  for (const key of ['amount', 'amountCents']) if (record[key] !== undefined && record[key] !== null) record[key] = Number(record[key]);
  return record;
};

export function postgresReads(pool) {
  async function list(kind, query = {}, all = false) {
    const values = [todayInIndia()];
    const sql = `WITH records AS (${baseSql(kind)}) SELECT * FROM records${conditions(kind, query, values)}`;
    const sort = query.sort || (kind === 'customers' ? 'source' : 'newest');
    const date = kind === 'customers' ? '"createdAt"' : 'date';
    const order = { source: '"_order"', name: 'lower(name),"_order"', newest: `${date} DESC NULLS LAST,"_order"`, oldest: `${date} ASC NULLS LAST,"_order"`, expiry: kind === 'customers' ? '"rechargeUntil" ASC NULLS LAST,"_order"' : '"_order"' }[sort] || '"_order"';
    if (all) return (await pool.query(`${sql} ORDER BY ${order}`, values)).rows.map(normalize);
    const countSql = `SELECT count(*)::int AS total${kind === 'payments' ? ',COALESCE(sum("amountCents"),0)::numeric/100 AS "totalAmount"' : ''} FROM (${sql}) filtered`;
    const counts = (await pool.query(countSql, values)).rows[0];
    const pageSize = Math.max(1, Math.min(100, Number.parseInt(query.pageSize, 10) || 25));
    const pages = Math.max(1, Math.ceil(counts.total / pageSize));
    const page = Math.max(1, Math.min(pages, Number.parseInt(query.page, 10) || 1));
    const rows = (await pool.query(`${sql} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize])).rows.map(normalize);
    return { rows, total: counts.total, page, pageSize, pages, ...(kind === 'payments' ? { totalAmount: Number(counts.totalAmount) } : {}) };
  }
  return { list,
    async detail(kind, id) {
      const record = (await list(kind, { id }, true))[0];
      if (!record || kind !== 'customers') return record;
      const [payments, recharges] = await Promise.all(['payments', 'recharges'].map(table => list(table, { cardNo: record.cardNo, sort: 'newest' }, true)));
      return { ...record, payments, recharges };
    },
    async overview() {
      const customers = await list('customers', {}, true);
      const aggregates = (await pool.query(`SELECT
        (SELECT count(*)::int FROM kesari.payments) payments,
        (SELECT count(*)::int FROM kesari.recharges) recharges,
        (SELECT COALESCE(sum("amountCents"),0)::numeric/100 FROM kesari.payments) collected,
        (SELECT array_agg(DISTINCT mode) FROM kesari.payments WHERE mode<>'') modes`)).rows[0];
      const review = await Promise.all(['payments', 'recharges'].map(async kind => {
        const values = [todayInIndia()];
        const sql = `WITH records AS (${baseSql(kind)}) SELECT count(*)::int AS count FROM records${conditions(kind, {status:'review'}, values)}`;
        return (await pool.query(sql, values)).rows[0].count;
      }));
      return { customers, ...aggregates, collected: Number(aggregates.collected), reviewCounts: { customers: customers.filter(c => c.duplicateCard).length, payments: review[0], recharges: review[1] } };
    },
  };
}
