import React, { useEffect, useMemo, useState } from 'react';
import { publicCall } from '../api.js';
import { ErrorBox, Loading } from '../ui.jsx';
import { fmtDate } from '../util.js';
import { encodeQR } from '../pdf/qr.js';

function Qr({ text }) {
  const m = useMemo(() => { try { return encodeQR(text); } catch { return null; } }, [text]);
  if (!m) return null;
  const n = m.length, q = 4;
  return (
    <svg viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} width="180" height="180" role="img" aria-label="QR code for the UPI payment" shapeRendering="crispEdges" style={{ background: '#fff' }}>
      <rect width="100%" height="100%" fill="#fff" />
      {m.map((row, y) => row.map((b, x) => (b ? <rect key={x + '-' + y} x={x + q} y={y + q} width="1" height="1" fill="#000" /> : null)))}
    </svg>
  );
}

/** Public one-tap pay page. Shows first name, months and the exact amount; the button opens the parent's UPI app. */
export default function Pay({ id }) {
  const [r, setR] = useState(null); const [err, setErr] = useState(null); const [paid, setPaid] = useState(null); const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState('');
  const load = () => { setErr(null); setR(null); publicCall('pay.info', { id: id || '' }).then(setR).catch(setErr); };
  useEffect(load, [id]);
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000); } catch { setCopied('Copy failed — please select the text yourself.'); } };
  const report = async (e) => { e.preventDefault(); setBusy(true); try { setPaid(await publicCall('pay.report', { id, reference: ref })); } catch (x) { setErr(x); } finally { setBusy(false); } };
  const money = (n) => (r.currencySymbol || '₹') + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <main className="vcard"><h1 style={{ textAlign: 'center', color: 'var(--brand)' }}>{r?.centreName || 'Fee payment'}</h1>
      {err ? <ErrorBox error={err} onRetry={load} /> : !r ? <Loading label="Loading…" /> : r.status === 'invalid' ? (
        <div className="card"><p><strong>This payment link is not valid.</strong></p><p className="muted">It may be old or incomplete. Please ask the tuition centre for a fresh link.</p></div>
      ) : r.status === 'clear' ? (
        <div className="card"><div className="vstatus valid" role="status">✓ Nothing is due right now</div><p className="muted mt">No fee is pending for {r.studentFirstName}. Thank you!</p></div>
      ) : (
        <div className="card">
          <p className="muted" style={{ marginBottom: 4 }}>Fee for <strong>{r.studentFirstName}</strong> — {r.months.join(', ')}</p>
          <div className="payamt" aria-label="Amount to pay">{money(r.amount)}</div>
          <ul className="small paylist">{r.items.map((i, k) => <li key={k}><span>{i.month} <span className="muted">(due {fmtDate(i.dueDate)}{i.overdue ? ', overdue' : ''})</span></span><strong>{money(i.amount)}</strong></li>)}</ul>
          {r.upiUri ? (
            <>
              {mobile && <a className="btn primary paybtn" href={r.upiUri}>Pay {money(r.amount)} with UPI</a>}
              {!mobile && <><p className="hint">Open this page on your phone to pay in one tap, or scan this code with any UPI app:</p><div style={{ textAlign: 'center' }}><Qr text={r.upiUri} /></div></>}
              <p className="hint mt">The button opens your UPI app (GPay, PhonePe, Paytm, BHIM…) with the amount and note filled in. If nothing opens, pay manually:</p>
              <dl className="kv"><dt>UPI ID</dt><dd><strong style={{ userSelect: 'all' }}>{r.upiId}</strong> <button type="button" className="linkbtn" onClick={() => copy('upi', r.upiId)}>copy</button></dd><dt>Amount</dt><dd><strong>{money(r.amount)}</strong> <button type="button" className="linkbtn" onClick={() => copy('amt', r.amount.toFixed(2))}>copy</button></dd><dt>Note</dt><dd>Fee {r.studentFirstName} #{r.reference}</dd></dl>
              {copied && <p className="small" role="status">{copied === 'upi' ? 'UPI ID copied.' : copied === 'amt' ? 'Amount copied.' : copied}</p>}
            </>
          ) : <p className="banner warn">Online payment details are not set up yet. {r.instructions || 'Please contact the centre' + (r.centrePhone ? ' on ' + r.centrePhone : '') + ' to pay.'}</p>}
          {r.instructions && r.upiUri && <p className="small muted">{r.instructions}</p>}
          <hr />
          {paid?.recorded ? <p className="banner" role="status">Thank you — we have noted it. The centre will confirm your payment once it shows in their bank account, and the reminders will stop then.</p>
            : r.reportedRecently ? <p className="muted small">You told us you have paid. The centre will confirm it once it reaches their bank account.</p> : (
              <form onSubmit={report}><p className="small"><strong>Already paid?</strong> Let the centre know (optional: your UPI reference / UTR number).</p>
                <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} placeholder="UTR / reference (optional)" aria-label="UTR or reference (optional)" style={{ width: '100%' }} />
                <button className="btn mt" type="submit" disabled={busy}>I have paid</button>
                <p className="hint">This only sends a note to the centre. Your payment is confirmed by the centre after checking its bank account — this page cannot see whether the payment went through.</p></form>)}
        </div>)}
    </main>
  );
}
