import React, { useEffect, useState } from 'react';
import { publicCall } from '../api.js';
import { ErrorBox, Loading } from '../ui.jsx';

/** Public enquiry form (no login). Off unless the Teacher turns it on in Settings. */
export default function Enquire() {
  const [info, setInfo] = useState(null); const [err, setErr] = useState(null); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', guardianName: '', phone: '', subject: '', message: '', consent: false, website: '' });
  const load = () => { setErr(null); publicCall('enquiry.info', {}).then(setInfo).catch(setErr); };
  useEffect(load, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await publicCall('enquiry.submit', f); setDone(true); } catch (x) { setErr(x); } finally { setBusy(false); } };
  return (
    <main className="vcard"><h1 style={{ textAlign: 'center', color: 'var(--brand)' }}>{info?.centreName || 'Enquiry'}</h1>
      {err && !info ? <ErrorBox error={err} onRetry={load} /> : !info ? <Loading label="Loading…" /> : !info.enabled ? (
        <div className="card"><p><strong>This enquiry form is not open.</strong></p><p className="muted">Please contact the centre directly.</p></div>
      ) : done ? (
        <div className="card"><div className="vstatus valid" role="status">✓ Thank you — we have your details</div><p className="muted mt">We will call you back soon.{info.centrePhone ? ' You can also call us on ' + info.centrePhone + '.' : ''}</p></div>
      ) : (
        <form className="card" onSubmit={submit}>
          <p>{info.intro}</p>
          <label className="field"><span className="lbl">Student’s name</span><input value={f.name} onChange={set('name')} required minLength={2} maxLength={100} /></label>
          <label className="field"><span className="lbl">Parent / guardian name</span><input value={f.guardianName} onChange={set('guardianName')} maxLength={100} /></label>
          <label className="field"><span className="lbl">Phone / WhatsApp number</span><input inputMode="tel" value={f.phone} onChange={set('phone')} required /></label>
          <label className="field"><span className="lbl">Class / subject interested in</span><input list="subjects" value={f.subject} onChange={set('subject')} maxLength={80} /><datalist id="subjects">{info.subjects.map((s) => <option key={s} value={s} />)}</datalist></label>
          <label className="field"><span className="lbl">Anything else? (optional)</span><textarea rows={3} value={f.message} onChange={set('message')} maxLength={500} /></label>
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label>Leave empty<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
          <label className="check"><input type="checkbox" checked={f.consent} onChange={set('consent')} required /> I agree that {info.centreName} may contact me about this enquiry.</label>
          {err && <p className="ferr" role="alert">{err.message}</p>}
          <button className="btn primary mt" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
        </form>)}
    </main>
  );
}
