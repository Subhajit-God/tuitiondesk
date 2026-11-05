import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { money as fmtMoney } from './util.js';

/* ───────── data hook: loading / error / empty are always handled by <Async> ───────── */
export function useApi(action, params, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current; set((s) => ({ ...s, loading: true, error: null }));
    api(action, params || {}).then((data) => { if (n === seq.current) set({ data, loading: false, error: null }); })
      .catch((error) => { if (n === seq.current) set({ data: null, loading: false, error }); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, JSON.stringify(params || {}), ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Renders loading, error (with retry / permission-denied) or children(data). */
export function Async({ q, children, empty }) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  return <>{typeof children === 'function' ? children(q.data) : children}{empty}</>;
}
export const Loading = ({ label = 'Loading…' }) => <div className="state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /> {label}</div>;
export function ErrorBox({ error, onRetry }) {
  const denied = error?.code === 'FORBIDDEN';
  return (
    <div className="state error" role="alert">
      <strong>{denied ? 'Not allowed' : error?.code === 'NETWORK' ? 'Connection problem' : 'Something went wrong'}</strong>
      <p>{error?.message || 'Unknown error'}</p>
      {onRetry && !denied && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}
export const Empty = ({ title, hint, children }) => <div className="state empty"><strong>{title}</strong>{hint && <p>{hint}</p>}{children}</div>;

/* ───────── basic components ───────── */
export const Page = ({ title, actions, children }) => (
  <section className="page"><header className="page-head"><h1>{title}</h1><div className="head-actions">{actions}</div></header>{children}</section>
);
export const Card = ({ title, actions, children, className = '' }) => (
  <div className={'card ' + className}>{(title || actions) && <div className="card-head"><h2>{title}</h2><div className="head-actions">{actions}</div></div>}{children}</div>
);
export function Btn({ variant = '', busy, children, ...p }) {
  return <button {...p} disabled={p.disabled || busy} className={('btn ' + variant + ' ' + (p.className || '')).trim()}>{busy ? 'Please wait…' : children}</button>;
}
export function Field({ label, hint, error, children, wide }) {
  return <label className={'field' + (wide ? ' wide' : '')}><span className="lbl">{label}</span>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="ferr" role="alert">{error}</span>}</label>;
}
export const Input = React.forwardRef(function Input(p, ref) { return <input ref={ref} {...p} />; });
export const Select = ({ options, placeholder, ...p }) => (
  <select {...p}>{placeholder !== undefined && <option value="">{placeholder}</option>}{options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}</select>
);
export const Money = ({ v, sym }) => <span className="num">{fmtMoney(v, sym)}</span>;

const STATUS = {
  paid: ['✓', 'good'], verified: ['✓', 'good'], valid: ['✓', 'good'], active: ['●', 'good'], published: ['✓', 'good'], present: ['P', 'good'], delivered: ['✓✓', 'good'], read: ['✓✓', 'good'], confirmed: ['✓', 'good'], admitted: ['✓', 'good'], entered: ['●', 'good'],
  pending: ['…', 'warn'], partial: ['◐', 'warn'], late: ['!', 'warn'], draft: ['✎', 'muted'], queued: ['…', 'warn'], pending_manual: ['✋', 'warn'], sent_to_provider: ['➤', 'info'], manually_sent: ['✋✓', 'info'], new: ['★', 'info'], contacted: ['☎', 'info'], follow_up: ['↻', 'warn'], trial: ['◔', 'info'], sending: ['…', 'warn'],
  overdue: ['!!', 'bad'], failed: ['✕', 'bad'], rejected: ['✕', 'bad'], revoked: ['⊘', 'bad'], reversed: ['↺', 'bad'], unknown: ['?', 'bad'], absent: ['A', 'bad'], inactive: ['○', 'muted'], archived: ['▭', 'muted'], cancelled: ['—', 'muted'], skipped: ['—', 'muted'], lost: ['—', 'muted'], void: ['—', 'muted'], expired: ['—', 'muted'],
  holiday: ['H', 'info'], exempt: ['E', 'info'], not_entered: ['∅', 'warn'], regular: ['', 'muted'], extra: ['+', 'info'], invalid: ['?', 'bad'],
};
/** Status chip: colour AND text/icon, never colour alone. */
export const Chip = ({ s, label }) => { const [ic, tone] = STATUS[s] || ['', 'muted']; return <span className={'chip ' + tone}><span aria-hidden="true">{ic}</span> {label || String(s || '').replace(/_/g, ' ')}</span>; };

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export function Pager({ data, onPage }) {
  if (!data || data.total <= data.pageSize) return null;
  const pages = Math.ceil(data.total / data.pageSize);
  return <div className="pager"><Btn disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>‹ Prev</Btn><span>Page {data.page} of {pages} · {data.total} records</span><Btn disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>Next ›</Btn></div>;
}
/** Responsive table: scrolls inside its own container (page itself never scrolls sideways). */
export const Table = ({ children, className = '' }) => <div className={'table-wrap ' + className}><table>{children}</table></div>;

/* ───────── toast + confirm ───────── */
const Ctx = createContext(null);
export const useUi = () => useContext(Ctx);
export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dlg, setDlg] = useState(null);
  const push = useCallback((kind, text) => { const id = Math.random(); setToasts((t) => [...t, { id, kind, text }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000); }, []);
  const ui = {
    ok: (t) => push('ok', t), err: (e) => push('error', typeof e === 'string' ? e : e?.message || 'Something went wrong'),
    confirm: (opts) => new Promise((resolve) => setDlg({ ...(typeof opts === 'string' ? { message: opts } : opts), resolve })),
  };
  return (
    <Ctx.Provider value={ui}>
      {children}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>{t.kind === 'ok' ? '✓ ' : '⚠ '}{t.text}</div>)}</div>
      {dlg && <ConfirmDialog dlg={dlg} close={(v) => { dlg.resolve(v); setDlg(null); }} />}
    </Ctx.Provider>
  );
}
function ConfirmDialog({ dlg, close }) {
  const [text, setText] = useState('');
  const need = dlg.reason;
  return (
    <Modal title={dlg.title || 'Please confirm'} onClose={() => close(null)} footer={<><Btn onClick={() => close(null)}>Cancel</Btn><Btn variant={dlg.danger ? 'danger' : 'primary'} disabled={need && text.trim().length < (dlg.minReason || 5)} onClick={() => close(need ? { reason: text.trim() } : true)}>{dlg.confirmLabel || 'Confirm'}</Btn></>}>
      <p>{dlg.message}</p>
      {need && <Field label={dlg.reasonLabel || 'Reason (required)'}><textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
    </Modal>
  );
}

/** Run an async action with busy state + toast feedback. */
export function useAction() {
  const ui = useUi(); const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) ui.ok(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
    catch (e) { ui.err(e); throw e; } finally { setBusy(false); }
  }, [ui]);
  return [run, busy];
}
export function useForm(initial) {
  const [v, setV] = useState(initial);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  return [v, set, setV];
}
/** Warn before the page is closed while there are unsaved edits. */
export function useUnsavedWarning(dirty) {
  useEffect(() => { if (!dirty) return; const h = (e) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
}
export function SearchBar({ value, onChange, placeholder = 'Search…' }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { const t = setTimeout(() => onChange(v), 300); return () => clearTimeout(t); // eslint-disable-next-line
  }, [v]);
  return <input type="search" className="search" aria-label={placeholder} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />;
}
/** Batch picker loaded from the API. */
export function BatchSelect({ value, onChange, includeInactive, placeholder = 'All batches', ...p }) {
  const q = useApi('batches.list', { pageSize: 100 });
  const items = (q.data?.items || []).filter((b) => includeInactive || b.status === 'active');
  return <Select value={value} onChange={onChange} placeholder={placeholder} options={items.map((b) => [b.batchId, b.name])} {...p} />;
}
export function StudentSelect({ value, onChange, placeholder = 'Select student', status = 'active', ...p }) {
  const q = useApi('students.list', { pageSize: 100, status });
  return <Select value={value} onChange={onChange} placeholder={placeholder} options={(q.data?.items || []).map((s) => [s.studentId, s.fullName + ' (' + s.studentId + ')'])} {...p} />;
}
