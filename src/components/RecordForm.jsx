import { useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, CreditCard, LoaderCircle, Search } from 'lucide-react';
import Modal from './Modal.jsx';
import { api, initials, singular } from '../lib.js';

export default function RecordForm({ kind, record, customer, bootstrap, onClose, onSaved }) {
  const editing = Boolean(record?.id);
  const [values, setValues] = useState(() => kind === 'customers'
    ? { name: record?.name || '', phone: record?.phone || '', address: record?.address || '', cardNo: record?.cardNo || '' }
    : { cardNo: record?.cardNo || customer?.cardNo || '', date: record?.date || bootstrap.today, fromDate: record?.fromDate || bootstrap.today, untilDate: record?.untilDate || '', ...(kind === 'payments' ? { amount: record?.amount ?? '', mode: record?.mode || 'UPI', comment: record?.comment || '' } : {}) });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false), [customerQuery, setCustomerQuery] = useState('');
  const options = useMemo(() => bootstrap.customers.filter(c => !c.duplicateCard), [bootstrap.customers]);
  const selected = options.find(c => c.cardNo === values.cardNo);
  const suggestions = options.filter(c => `${c.name} ${c.cardNo} ${c.phone}`.toLowerCase().includes(customerQuery.toLowerCase())).slice(0, 8);
  const update = event => setValues(v => ({ ...v, [event.target.name]: event.target.value }));
  function setMonth() {
    if (!values.fromDate) return;
    const start = new Date(`${values.fromDate}T00:00:00Z`);
    const next = new Date(start); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(start.getUTCDate(), lastDay)); next.setUTCDate(next.getUTCDate() - 1);
    setValues(v => ({ ...v, untilDate: next.toISOString().slice(0, 10) }));
  }
  async function submit(event) {
    event.preventDefault(); setError('');
    if (kind !== 'customers' && !values.cardNo) { setError('Choose a customer to continue.'); return; }
    setSaving(true);
    try {
      await api(`/${kind}${editing ? `/${record.id}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...values, ...(kind === 'payments' ? { amount: Number(values.amount) } : {}) }) });
      onSaved(`${singular[kind][0].toUpperCase() + singular[kind].slice(1)} ${editing ? 'updated' : 'added'} successfully.`);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  return <Modal title={`${editing ? 'Edit' : 'Add'} ${singular[kind]}`} subtitle={kind === 'customers' ? 'Customer and cable connection details' : `Record a ${singular[kind]} for a customer`} onClose={onClose}>
    <form onSubmit={submit}>
      <div className="form-body">
        {error && <div className="form-error" role="alert"><AlertCircle size={18}/>{error}</div>}
        {kind === 'customers' ? <>
          <label>Customer name <span>*</span><input data-autofocus name="name" value={values.name} onChange={update} placeholder="e.g. Anukalp Kumar" required maxLength={250}/></label>
          <label>Card number <span>*</span><input name="cardNo" value={values.cardNo} onChange={update} placeholder="Enter the complete card number" required maxLength={250} autoCapitalize="characters"/><small>Keep all leading zeros and letters.</small></label>
          <label>Phone number<input name="phone" type="tel" value={values.phone} onChange={update} placeholder="Mobile number" maxLength={250}/></label>
          <label>Area / address<input name="address" list="areas" value={values.address} onChange={update} placeholder="Choose an area or enter a new one" maxLength={250}/><datalist id="areas">{bootstrap.areas.map(a => <option key={a} value={a}/>)}</datalist></label>
          {editing && <p className="field-note">Changing a unique card number also updates its linked payments and recharges.</p>}
        </> : <>
          <div className="field-label">Customer <span>*</span></div>
          <div className="customer-picker">
            <button type="button" className="customer-choice" onClick={() => setPickerOpen(!pickerOpen)} aria-expanded={pickerOpen} aria-label="Choose customer">
              <span className="avatar">{selected ? initials(selected.name) : <CreditCard size={18}/>}</span>
              <span>{selected ? selected.name : values.cardNo || 'Choose a customer'}<small>{selected ? selected.cardNo : values.cardNo ? 'Historical card reference' : 'Search by name, card number or phone'}</small></span><ChevronDown size={18}/>
            </button>
            {pickerOpen && <div className="customer-options"><div className="picker-search"><Search size={16}/><input aria-label="Search customers" value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} placeholder="Search customers…" autoFocus/></div>
              <div className="picker-results">{suggestions.length ? suggestions.map(c => <button type="button" key={c.id} onClick={() => { setValues(v => ({ ...v, cardNo: c.cardNo })); setPickerOpen(false); }}><span>{c.name}<small>{c.cardNo} · {c.address}</small></span>{values.cardNo === c.cardNo && <Check size={16}/>}</button>) : <p>No matching customers. Add them in People first.</p>}</div>
            </div>}
          </div>
          {kind === 'payments' && <div className="form-grid"><label>Amount (₹) <span>*</span><input name="amount" type="number" value={values.amount} onChange={update} required min="0" max="10000000" step="0.01" placeholder="0.00"/></label><label>Payment mode <span>*</span><select name="mode" value={values.mode} onChange={update} required>{bootstrap.modes.map(m => <option key={m}>{m}</option>)}</select></label></div>}
          <label>{kind === 'payments' ? 'Payment date' : 'Date of recharge'} <span>*</span><input name="date" type="date" value={values.date} onChange={update} required/></label>
          <div className="period-heading"><h3>Recharge period</h3><button type="button" className="text-button" onClick={setMonth} disabled={!values.fromDate}>Set one month</button></div>
          <div className="form-grid"><label>From <span>*</span><input name="fromDate" type="date" value={values.fromDate} onChange={update} required/></label><label>Until <span>*</span><input name="untilDate" type="date" value={values.untilDate} onChange={update} min={values.fromDate} required/></label></div>
          {kind === 'payments' && <label>Comment<textarea name="comment" value={values.comment} onChange={update} placeholder="Add a note (optional)" rows={3} maxLength={4000}/></label>}
        </>}
      </div>
      <footer className="modal-footer"><button type="button" className="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" disabled={saving}>{saving && <LoaderCircle size={17} className="spin"/>}{saving ? 'Saving…' : `${editing ? 'Save' : 'Add'} ${singular[kind]}`}</button></footer>
    </form>
  </Modal>;
}
