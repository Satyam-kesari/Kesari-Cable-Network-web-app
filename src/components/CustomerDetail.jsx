import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarDays, CheckCircle2, CreditCard, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import Modal from './Modal.jsx';
import WhatsAppLink from './WhatsAppLink.jsx';
import { api, dateLabel, initials, money, phoneLink } from '../lib.js';

export default function CustomerDetail({ id, onClose, onEdit, onAdd, onEditLog }) {
  const [customer, setCustomer] = useState(null), [error, setError] = useState(''), [tab, setTab] = useState('recharges'), [limit, setLimit] = useState(20);
  useEffect(() => { let active = true; api(`/customers/${id}`).then(c => { if (active) setCustomer(c); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id]);
  return <Modal title="Customer details" onClose={onClose} drawer>
    {!customer ? <div className="empty-state">{error || 'Loading customer history…'}</div> : <div className="detail-body">
      <div className="detail-profile"><span className="avatar avatar-large">{initials(customer.name)}</span><h2>{customer.name}</h2><span className={`badge ${customer.status}`}>{customer.status === 'active' ? 'Active recharge' : customer.status === 'expired' ? 'Recharge expired' : 'No recharge history'}</span></div>
      {customer.duplicateCard && <div className="review-note"><AlertTriangle size={18}/><span>This card is shared by more than one customer row. The history below belongs to the card.</span></div>}
      <div className="detail-info"><div><CreditCard size={17}/><span>Card number</span><strong className="mono">{customer.cardNo}</strong></div><div><MapPin size={17}/><span>Area</span><strong>{customer.address || '—'}</strong></div><div><Phone size={17}/><span>Phone</span><strong>{customer.phone || 'Not provided'}</strong></div></div>
      <div className="detail-actions"><button className="button" onClick={() => onEdit(customer)}><Pencil size={16}/>Edit customer</button>{customer.phone && <><a className="button" href={`tel:${phoneLink(customer.phone)}`}><Phone size={16}/>Call</a><WhatsAppLink phone={customer.phone} label={`WhatsApp ${customer.name}`} showLabel/></>}</div>
      <div className="detail-dates"><div><CheckCircle2 size={18}/><span>Recharge until<strong>{dateLabel(customer.rechargeUntil)}</strong></span></div><div><CalendarDays size={18}/><span>Payment until<strong>{dateLabel(customer.paymentUntil)}</strong></span></div></div>
      <div className="history-heading"><h3>Account history</h3><span>{customer.rechargeCount + customer.paymentCount} records</span></div>
      <div className="history-tabs"><button className={tab === 'recharges' ? 'active' : ''} onClick={() => { setTab('recharges'); setLimit(20); }}>Recharges <span>{customer.rechargeCount}</span></button><button className={tab === 'payments' ? 'active' : ''} onClick={() => { setTab('payments'); setLimit(20); }}>Payments <span>{customer.paymentCount}</span></button></div>
      <button className="button add-history" disabled={customer.duplicateCard} onClick={() => onAdd(tab, customer)}><Plus size={16}/>Add {tab === 'payments' ? 'payment' : 'recharge'}</button>
      <div className="history-list">{customer[tab].length ? customer[tab].slice(0, limit).map(row => <button className="history-item" key={row.id} onClick={() => onEditLog(tab, row)}><span className={`history-icon ${tab}`}><CalendarDays size={17}/></span><span><strong>{tab === 'payments' ? money(row.amount) : 'Cable recharge'}</strong><small>{dateLabel(row.fromDate)} — {dateLabel(row.untilDate)}</small>{row.invalidRange && <small className="warning-text">Check the original date range</small>}{row.comment && <small>{row.comment}</small>}</span><span className="history-meta">{dateLabel(row.date)}<small>{tab === 'payments' ? row.mode || 'No payment mode' : <ArrowUpRight size={15}/>}</small></span></button>) : <div className="empty-state compact">No {tab} recorded for this card.</div>}</div>
      {customer[tab].length > limit && <button className="button load-more" onClick={() => setLimit(n => n + 30)}>Show more history</button>}
    </div>}
  </Modal>;
}
