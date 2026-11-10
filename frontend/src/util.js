export const todayStr = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const monthStr = (d = todayStr()) => d.slice(0, 7);
export const monthStartStr = () => monthStr() + '-01';
export const money = (n, sym = '₹') => (n === null || n === undefined || n === '' ? '—' : sym + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s.length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };
export const fmtDateTime = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
export const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
export const PAY_METHODS = [['upi', 'UPI'], ['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['card', 'Card'], ['other', 'Other']];
export const payLabel = (m) => (PAY_METHODS.find((x) => x[0] === m) || [m, m])[1];
export const phoneDisplay = (p) => (p ? '+' + p : '—');
export function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
export const asText = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
