export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not connect to the server.');
  return result;
}
export const money = value => value == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
export const number = value => new Intl.NumberFormat('en-IN').format(value || 0);
export const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const initials = name => name?.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
export const phoneLink = phone => phone.replace(/[^+\d]/g, '');
export function whatsappLink(phone, message = '') {
  const original = phone.trim();
  let digits = original.replace(/\D/g, '');
  if (original.startsWith('00')) digits = digits.slice(2);
  else if (!original.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;
  }
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}
export const labels = { customers: 'People', payments: 'Payment', recharges: 'Recharge' };
export const singular = { customers: 'customer', payments: 'payment', recharges: 'recharge' };
export const searchParams = values => new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value != null))).toString();
export async function download(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Download failed. Please try again.');
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = href; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
