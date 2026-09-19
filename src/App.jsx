import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CreditCard, Database, Download, IndianRupee, LayoutList, LoaderCircle, MapPin, Menu, Pencil, Phone, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, SquareCheck, Trash2, Tv, Users, X } from 'lucide-react';
import { api, dateLabel, download, initials, labels, money, number, phoneLink, searchParams, singular } from './lib.js';
import Modal from './components/Modal.jsx';
import RecordForm from './components/RecordForm.jsx';
import CustomerDetail from './components/CustomerDetail.jsx';
import WhatsAppLink from './components/WhatsAppLink.jsx';

const navItems = [{ kind: 'customers', Icon: Users, caption: 'People' }, { kind: 'payments', Icon: IndianRupee, caption: 'Payment' }, { kind: 'recharges', Icon: CheckCircle2, caption: 'Recharge' }];
const sidebarItems = [...navItems, { kind: 'ending-soon', Icon: RefreshCw, caption: 'Recharge Ending Soon' }];
const descriptions = { customers: 'Your customers. Every connection, in one place.', payments: 'Keep track of collections and paid recharge periods.', recharges: 'Manage monthly recharges and connection history.' };
const getView = () => ['customers', 'payments', 'recharges', 'ending-soon'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'customers';

function IconButton({ label, children, ...props }) { return <button type="button" className="icon-button" title={label} aria-label={label} {...props}>{children}</button>; }
function RecordWarning({ row, kind }) {
  const reasons = [];
  if (row.duplicateCard || row.customerState === 'duplicate') reasons.push('Duplicate customer card');
  if (row.customerState === 'missing') reasons.push('Customer not found');
  if (row.invalidRange) reasons.push('End date precedes start date');
  if (kind === 'payments' && (row.amount === null || !row.date || !row.fromDate || !row.untilDate || !row.mode)) reasons.push('Incomplete payment');
  if (kind === 'recharges' && (!row.date || !row.fromDate || !row.untilDate)) reasons.push('Incomplete recharge');
  return reasons.length ? <span className="record-warning" title={reasons.join(' · ')} aria-label={reasons.join(' · ')}><AlertTriangle size={15}/></span> : null;
}

export default function App() {
  const [activeView, setView] = useState(getView), [bootstrap, setBootstrap] = useState(null), [data, setData] = useState(null);
  const endingSoon = activeView === 'ending-soon';
  const view = endingSoon ? 'customers' : activeView;
  const pageLabel = endingSoon ? 'Recharge Ending Soon' : labels[view];
  const [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState('');
  const [area, setArea] = useState(''), [status, setStatus] = useState(''), [month, setMonth] = useState(''), [mode, setMode] = useState(''), [sort, setSort] = useState('source');
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [form, setForm] = useState(null), [detailId, setDetailId] = useState(null), [deleteTarget, setDeleteTarget] = useState(null), [reviewOpen, setReviewOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false), [selected, setSelected] = useState(new Set()), [toast, setToast] = useState(''), [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState('');
  const searchRef = useRef(null);
  const closeForm = useCallback(() => setForm(null), []), closeDetail = useCallback(() => setDetailId(null), []), closeReview = useCallback(() => setReviewOpen(false), []);
  const closeDelete = useCallback(() => { setDeleteTarget(null); setDeleteError(''); }, []);

  useEffect(() => { const handler = () => setView(getView()); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  useEffect(() => { setQuery(''); setDebouncedQuery(''); setArea(''); setStatus(''); setMonth(''); setMode(''); setPage(1); setSort(endingSoon ? 'expiry' : view === 'customers' ? 'source' : 'newest'); setSelected(new Set()); setSelectionMode(false); }, [activeView]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 200); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    api('/bootstrap', { signal: controller.signal }).then(setBootstrap).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api(`/${view}?${searchParams({ q: debouncedQuery, area, status, month, mode, sort, page, endingSoon: endingSoon ? '1' : '' })}`, { signal: controller.signal })
      .then(result => { setData({ ...result, kind: activeView }); setPage(result.page); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activeView, debouncedQuery, area, status, month, mode, sort, page, revision]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [debouncedQuery, area, status, month, mode, sort]);

  function navigate(kind) { if (activeView !== kind) { setData(null); location.hash = kind; setView(kind); } }
  function refresh() { setRevision(r => r + 1); setSelected(new Set()); }
  function saved(message) { setForm(null); refresh(); setToast(message); }
  function edit(kind, record) { setDetailId(null); setForm({ kind, record }); }
  function add(kind = view, customer = null) { setDetailId(null); setForm({ kind, customer }); }
  function requestDelete(kind, row) { setDeleteError(''); setDeleteTarget({ kind, row }); }
  async function remove() {
    setDeleting(true); setDeleteError('');
    try { await api(`/${deleteTarget.kind}/${deleteTarget.row.id}`, { method: 'DELETE' }); setDeleteTarget(null); refresh(); setToast('Record deleted.'); }
    catch (e) { setDeleteError(e.message); } finally { setDeleting(false); }
  }
  async function exportCsv() {
    setDownloading(true);
    try { await download(`/api/${view}/export?${searchParams({ q: debouncedQuery, area, status, month, mode, sort, endingSoon: endingSoon ? '1' : '', ids: selected.size ? [...selected].join(',') : '' })}`, `kesari-${activeView}.csv`); setToast(`${selected.size ? 'Selected' : 'Filtered'} records exported.`); }
    catch (e) { setToast(e.message); } finally { setDownloading(false); }
  }
  async function backup() {
    try { await download('/api/backup', `kesari-backup-${bootstrap?.today || 'data'}.json`); setToast('Full data backup downloaded.'); } catch (e) { setToast(e.message); }
  }
  function toggleSelected(id) { setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const rows = data?.kind === activeView ? data.rows : [];
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const stats = bootstrap?.stats;
  const reviewTotal = stats ? Object.values(stats.reviewCounts).reduce((a, b) => a + b, 0) : 0;
  const metricCards = view === 'customers' ? [
    { label: 'Total customers', value: stats?.customers, hint: 'Cable connections', Icon: Users, tone: 'red' },
    { label: 'Active recharges', value: stats?.active, hint: 'As of today', Icon: CheckCircle2, tone: 'green' },
    { label: 'Expiring soon', value: stats?.expiring, hint: 'In the next 7 days', Icon: RefreshCw, tone: 'amber' },
    { label: 'Expired recharges', value: stats?.expired, hint: 'Ready for renewal', Icon: CreditCard, tone: 'slate' },
  ] : view === 'payments' ? [
    { label: 'Total collected', value: stats?.collected, currency: true, hint: 'All recorded payments', Icon: IndianRupee, tone: 'green' },
    { label: 'Payment records', value: stats?.payments, hint: 'All time', Icon: CreditCard, tone: 'red' },
    { label: 'Customer connections', value: stats?.customers, hint: 'In your directory', Icon: Users, tone: 'slate' },
    { label: 'Needs review', value: stats?.reviewCounts.payments, hint: 'Missing or inconsistent details', Icon: AlertCircle, tone: 'amber' },
  ] : [
    { label: 'Total recharges', value: stats?.recharges, hint: 'Complete recharge history', Icon: LayoutList, tone: 'red' },
    { label: 'Active recharges', value: stats?.active, hint: 'Customer connections today', Icon: CheckCircle2, tone: 'green' },
    { label: 'Expiring soon', value: stats?.expiring, hint: 'In the next 7 days', Icon: RefreshCw, tone: 'amber' },
    { label: 'Needs review', value: stats?.reviewCounts.recharges, hint: 'Missing or inconsistent details', Icon: AlertCircle, tone: 'slate' },
  ];
  const filtersActive = Boolean(endingSoon || query || area || status || month || mode);
  function resetFilters() { setQuery(''); setArea(''); setStatus(''); setMonth(''); setMode(''); }
  function openReviewView(kind) { navigate(kind); setReviewOpen(false); setTimeout(() => setStatus('review'), 0); }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content').focus(); }}>Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#customers" aria-label="Kesari Cable Network home"><span className="brand-icon"><Tv size={24}/></span><span>KESARI<small>CABLE NETWORK</small></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{sidebarItems.map(({ kind, Icon, caption }) => <button key={kind} className={`nav-item ${activeView === kind ? 'active' : ''}`} onClick={() => navigate(kind)} aria-current={activeView === kind ? 'page' : undefined}><Icon size={19}/><span>{caption}</span><span className="nav-count">{stats ? number(stats[kind]) : '—'}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className="utility-item" onClick={() => setReviewOpen(true)}><ShieldCheck size={18}/><span>Data review</span>{reviewTotal > 0 && <span className="review-dot"/>}</button><button className="utility-item" onClick={backup} disabled={!bootstrap}><Download size={18}/><span>Download backup</span></button><div className="storage-note"><span className={`connection-dot ${error ? 'offline' : ''}`}/><div>{error ? 'Connection unavailable' : bootstrap?.storage === 'postgres' ? 'Saved in Supabase' : 'Saved on this computer'}<small>Your records, under your control</small></div></div><div className="sidebar-signature"><span className="owner-avatar">KC</span><span>Kesari Cable Network<small>Business workspace</small></span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{pageLabel}</strong></div><div className="topbar-right"><span className="today">{bootstrap?.today && new Date(`${bootstrap.today}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><span className="topbar-divider"/><span className="owner-avatar">KC</span></div><a className="mobile-brand" href="#customers"><span className="brand-icon"><Tv size={20}/></span><span>Kesari <strong>Cable Network</strong></span></a><div className="mobile-tools"><IconButton label="Open data tools" onClick={() => setMobileMenu(!mobileMenu)} aria-expanded={mobileMenu}><Menu size={22}/></IconButton>{mobileMenu && <div className="mobile-tools-menu"><button onClick={() => { setMobileMenu(false); setReviewOpen(true); }}><ShieldCheck size={17}/>Data review</button><button onClick={() => { setMobileMenu(false); backup(); }} disabled={!bootstrap}><Download size={17}/>Download backup</button></div>}</div></header>
      <main id="main-content" tabIndex={-1}>
        <div className="page-heading"><div><div className="eyebrow">CUSTOMER MANAGEMENT</div><h1>{pageLabel}</h1><p>{endingSoon ? 'Latest recharge ends yesterday, today, tomorrow or the day after tomorrow.' : descriptions[view]}</p></div><div className="heading-actions"><button className="button export-button" onClick={exportCsv} disabled={downloading || !data || loading}><ArrowDownToLine size={17}/>{downloading ? 'Exporting…' : selected.size ? `Export ${selected.size}` : 'Export CSV'}</button><button className="button primary desktop-add" onClick={() => add()} disabled={!bootstrap}><Plus size={18}/>Add {singular[view]}</button></div></div>
        {!endingSoon && <section className="stats-grid" aria-label="Account overview">{metricCards.map(({ label, value, currency, hint, Icon, tone }) => <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={18}/></span></div><strong>{value === undefined ? '—' : currency ? money(value) : number(value)}</strong><small>{hint}</small></div>)}</section>}
        <section className="records-panel" aria-label={`${pageLabel} records`}>
          <div className="records-tabs"><div className="tabs-left"><button className={status === '' ? 'active' : ''} onClick={() => setStatus('')}>{endingSoon ? 'Matching customers' : view === 'customers' ? 'All customers' : view === 'payments' ? 'All payments' : 'All recharges'}<span>{stats ? number(stats[activeView]) : '—'}</span></button>{!endingSoon && view === 'customers' && <><button className={status === 'active' ? 'active' : ''} onClick={() => setStatus('active')}>Active</button><button className={status === 'expired' ? 'active' : ''} onClick={() => setStatus('expired')}>Expired</button></>}{!endingSoon && <button className={status === 'review' ? 'active' : ''} onClick={() => setStatus('review')}>Needs review{stats?.reviewCounts[view] > 0 && <span className="review-tab-count">{number(stats.reviewCounts[view])}</span>}</button>}</div><div className="table-tools"><IconButton label={selectionMode ? 'Exit selection' : 'Select records'} onClick={() => { setSelectionMode(!selectionMode); setSelected(new Set()); }}><SquareCheck size={18}/></IconButton><IconButton label="Refresh records" onClick={refresh} disabled={loading}><RefreshCw size={18} className={loading ? 'spin' : ''}/></IconButton></div></div>
          <div className="filter-bar"><div className="search-input"><Search size={18}/><input ref={searchRef} aria-label={`Search ${pageLabel.toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, card number or phone…"/>{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><X size={15}/></button>}</div><div className="filter-controls"><div className="select-wrap"><MapPin size={16}/><select aria-label="Filter by area" value={area} onChange={e => setArea(e.target.value)}><option value="">All areas</option>{bootstrap?.areas.map(a => <option key={a}>{a}</option>)}</select><ChevronDown size={14}/></div>{view === 'customers' ? <div className="select-wrap sort-select"><SlidersHorizontal size={16}/><select aria-label="Sort customers" value={sort} onChange={e => setSort(e.target.value)}><option value="source">Original order</option><option value="name">Name A–Z</option><option value="expiry">Recharge expiry</option><option value="newest">Recently added</option></select><ChevronDown size={14}/></div> : <><input type="month" aria-label="Filter by month" className="month-filter" value={month} onChange={e => setMonth(e.target.value)}/>{view === 'payments' && <div className="select-wrap mode-select"><select aria-label="Filter by payment mode" value={mode} onChange={e => setMode(e.target.value)}><option value="">All modes</option>{bootstrap?.modes.map(m => <option key={m}>{m}</option>)}</select><ChevronDown size={14}/></div>}<div className="select-wrap sort-select"><select aria-label="Sort records" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="source">Original order</option><option value="name">Name A–Z</option></select><ChevronDown size={14}/></div></>}{filtersActive && <button className="text-button reset-filters" onClick={resetFilters}>Reset</button>}</div></div>
          {status === 'review' && <div className="inline-notice"><AlertTriangle size={16}/>{view === 'customers' ? 'These customer rows share a card number. Review the details before removing a duplicate.' : 'These records have missing customer links, incomplete details or inconsistent dates. Original values are preserved.'}</div>}
          {selected.size > 0 && <div className="selection-bar"><Check size={16}/>{selected.size} selected<button className="text-button" onClick={() => setSelected(new Set())}>Clear selection</button></div>}
          {error ? <div className="empty-state error-state"><AlertCircle size={30}/><h3>Couldn’t load your records</h3><p>{error}</p><button className="button" onClick={refresh}>Try again</button></div> : loading && !data ? <div className="empty-state"><LoaderCircle size={28} className="spin"/><p>Loading your records…</p></div> : rows.length === 0 ? <div className="empty-state"><Search size={32}/><h3>{endingSoon && !query && !area ? 'No recharges ending in this window' : filtersActive ? 'No matching records' : `No ${view} yet`}</h3><p>{endingSoon && !query && !area ? 'No customer has a latest recharge ending between yesterday and the day after tomorrow.' : filtersActive ? 'Try a different name, card number or filter.' : `Add your first ${singular[view]} to get started.`}</p><button className="button" onClick={filtersActive ? resetFilters : () => add()}>{filtersActive ? 'Clear filters' : `Add ${singular[view]}`}</button></div> : <>
            <div className={`table-scroll ${view === 'customers' ? 'people-table-wrap' : ''} ${loading ? 'table-loading' : ''}`} aria-busy={loading}>
              <table className={`records-table ${view}`}><thead><tr>{selectionMode && <th className="checkbox-cell"><input type="checkbox" aria-label="Select all records on this page" checked={allSelected} onChange={() => setSelected(prev => { const next = new Set(prev); rows.forEach(r => allSelected ? next.delete(r.id) : next.add(r.id)); return next; })}/></th>}<th>{view === 'customers' ? 'Customer' : 'Name'}</th>{view === 'customers' && <th>Area</th>}<th>Card number</th>{view === 'customers' ? <><th>Recharge until</th><th>Payment until</th></> : view === 'payments' ? <><th className="amount-heading">Amount</th><th>Payment date</th><th>Recharge period</th><th>Mode</th></> : <><th>Date of recharge</th><th>Recharge from</th><th>Recharge until</th></>}<th className="actions-heading">Actions</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                {selectionMode && <td className="checkbox-cell"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={() => toggleSelected(row.id)}/></td>}
                <td className="customer-cell"><div className="customer-name-wrap">{view === 'customers' && <span className={`avatar avatar-${index % 5}`}>{initials(row.name)}</span>}<div><button className="name-link" onClick={() => view === 'customers' ? setDetailId(row.id) : row.customerId ? setDetailId(row.customerId) : edit(view, row)}>{row.name}<RecordWarning row={row} kind={view}/></button>{view === 'customers' ? <span className="customer-subtitle">{row.phone || 'No phone number'}</span> : row.customerState !== 'linked' && <span className="customer-subtitle warning-text">{row.customerState === 'missing' ? 'Customer not found' : 'Duplicate card'}</span>}</div></div></td>
                {view === 'customers' && <td className="area-cell">{row.address || '—'}</td>}<td className="mono card-cell">{row.cardNo}</td>
                {view === 'customers' ? <><td className="recharge-date-cell"><span className={`date-status ${row.status}`}><i/>{dateLabel(row.rechargeUntil)}</span></td><td className="muted payment-date-cell">{dateLabel(row.paymentUntil)}</td></> : view === 'payments' ? <><td className="amount">{money(row.amount)}</td><td className="nowrap">{dateLabel(row.date)}</td><td className={`period-cell ${row.invalidRange ? 'warning-text' : ''}`}>{dateLabel(row.fromDate)}<span>to {dateLabel(row.untilDate)}</span></td><td>{row.mode ? <span className={`mode-badge ${row.mode === 'UPI' ? 'upi' : ''}`}>{row.mode}</span> : <span className="muted">—</span>}</td></> : <><td className="nowrap">{dateLabel(row.date)}</td><td className="nowrap muted">{dateLabel(row.fromDate)}</td><td className={`nowrap ${row.invalidRange ? 'warning-text' : ''}`}>{dateLabel(row.untilDate)}</td></>}
                <td className="actions-cell"><div className="row-actions">{view === 'customers' && row.phone && <a className="icon-button" title={`Call ${row.name}`} aria-label={`Call ${row.name}`} href={`tel:${phoneLink(row.phone)}`}><Phone size={16}/></a>}{view === 'customers' && row.phone && <WhatsAppLink phone={row.phone} label={`WhatsApp ${row.name}`}/>}{view === 'recharges' && row.phone && <><WhatsAppLink phone={row.phone} label={`WhatsApp recharge confirmation for ${row.name}`} message={`Hello ${row.name}, your cable card ${row.cardNo} has been recharged from ${dateLabel(row.fromDate)} until ${dateLabel(row.untilDate)}. Kesari Cable Network`}/><WhatsAppLink phone={row.phone} label={`WhatsApp expiry reminder for ${row.name}`} message={`Hello ${row.name}, your cable recharge for card ${row.cardNo} ends on ${dateLabel(row.untilDate)}. Please contact Kesari Cable Network for renewal.`}/></>}
                  <IconButton label={`Edit ${singular[view]} ${row.name}`} onClick={() => edit(view, row)}><Pencil size={16}/></IconButton><IconButton label={`Delete ${singular[view]} ${row.name}`} onClick={() => requestDelete(view, row)}><Trash2 size={16}/></IconButton></div></td>
              </tr>)}</tbody></table>
            </div>
            <footer className="table-footer"><span>{selected.size ? `${selected.size} selected · ` : ''}Showing <strong>{number((data.page - 1) * data.pageSize + 1)}–{number(Math.min(data.page * data.pageSize, data.total))}</strong> of <strong>{number(data.total)}</strong>{view === 'payments' && <span className="filtered-total"> · {money(data.totalAmount)} total</span>}</span><div className="pagination"><button className="button page-button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}><ArrowLeft size={15}/></button><span>Page <strong>{data.page}</strong> of {data.pages}</span><button className="button page-button" aria-label="Next page" disabled={page >= data.pages || loading} onClick={() => setPage(p => p + 1)}><ArrowRight size={15}/></button></div></footer>
          </>}
        </section>
        <div className="page-footnote"><Database size={13}/><span>Changes are saved automatically after you submit a form.</span><span className="desktop-footnote">Kesari Cable Network</span></div>
      </main>
    </div>
    <button className="mobile-fab" aria-label={`Add ${singular[view]}`} onClick={() => add()} disabled={!bootstrap}><Plus size={29}/></button>
    <nav className="mobile-nav" aria-label="Mobile navigation">{sidebarItems.map(({ kind, Icon, caption }) => <button key={kind} className={activeView === kind ? 'active' : ''} onClick={() => navigate(kind)} aria-current={activeView === kind ? 'page' : undefined}><Icon size={22}/><span>{caption}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
    {form && bootstrap && <RecordForm key={`${form.kind}-${form.record?.id || 'new'}`} {...form} bootstrap={bootstrap} onClose={closeForm} onSaved={saved}/>}
    {detailId && <CustomerDetail id={detailId} onClose={closeDetail} onEdit={row => edit('customers', row)} onAdd={add} onEditLog={edit}/>}
    {deleteTarget && <Modal title={`Delete ${singular[deleteTarget.kind]}?`} onClose={closeDelete}><div className="form-body"><div className="delete-icon"><Trash2 size={24}/></div><p className="delete-description">Delete {deleteTarget.kind === 'customers' ? <strong>{deleteTarget.row.name}</strong> : <>this {singular[deleteTarget.kind]} for <strong>{deleteTarget.row.name}</strong></>}? This cannot be undone.</p>{deleteTarget.kind === 'customers' && <p className="field-note">A customer with linked history can only be deleted if another customer row retains the same card number.</p>}{deleteError && <div className="form-error" role="alert"><AlertCircle size={17}/>{deleteError}</div>}</div><footer className="modal-footer"><button className="button" onClick={closeDelete} disabled={deleting}>Cancel</button><button className="button primary" onClick={remove} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete record'}</button></footer></Modal>}
    {reviewOpen && bootstrap && <Modal title="Data review" subtitle="Your original Google Sheets records are preserved." onClose={closeReview} wide><div className="form-body review-body"><h3>Records to review now</h3><p className="muted">Open a view to correct missing details or resolve customer references.</p><div className="review-links">{navItems.map(({ kind, Icon, caption }) => <button key={kind} onClick={() => openReviewView(kind)}><Icon size={20}/><span>{caption}</span><strong>{number(stats.reviewCounts[kind])}</strong><ArrowRight size={16}/></button>)}</div><h3>Original CSV import</h3><div className="import-table">{Object.entries(bootstrap.report.sources).map(([name, info]) => <div key={name}><span>{name}</span><strong>{number(info.imported)} imported</strong><small>{info.skippedBlank ? `${number(info.skippedBlank)} empty rows skipped` : 'All rows imported'}</small></div>)}</div><div className="review-note"><AlertTriangle size={19}/><span>The original import included {bootstrap.report.issues.filter(i => i.type === 'duplicate_card').length} duplicate card number, {number(bootstrap.report.issues.filter(i => i.type === 'missing_customer').length)} records with no matching customer, and {bootstrap.report.issues.filter(i => i.type === 'date_range').length} reversed date ranges. No historical records were discarded.</span></div><p className="field-note">CSV dates use month/day/year. Dates in the app are displayed as day month year. Blank payment amounts remain blank. Latest recharge and payment dates are the maximum recorded end dates, matching the original app.</p><button className="button" onClick={backup}><Download size={16}/>Download all data</button></div></Modal>}
  </div>;
}
