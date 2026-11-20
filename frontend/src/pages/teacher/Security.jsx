import React, { useState } from 'react';
import { api } from '../../api.js';
import { encodeQR } from '../../pdf/qr.js';
import { Async, Btn, Card, Field, Modal, Page, useAction, useApi, useUi } from '../../ui.jsx';
import ChangePassword from '../ChangePassword.jsx';

export const refreshUser = () => window.dispatchEvent(new Event('td-user-changed'));

/** Inline SVG QR drawn in the browser: the secret never leaves the device. */
export function QrSvg({ text, size = 200 }) {
  let m; try { m = encodeQR(text); } catch { return <p className="small muted">QR is too large for this name; use the manual key below.</p>; }
  const n = m.length, q = 4, dim = n + q * 2; const rects = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) rects.push(<rect key={x + ',' + y} x={x + q} y={y + q} width="1" height="1" />);
  return <svg role="img" aria-label="QR code for your authenticator app" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" style={{ background: '#fff' }}><rect width={dim} height={dim} fill="#fff" /><g fill="#000">{rects}</g></svg>;
}

export function printCodes(codes, centre) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f);
  const d = f.contentDocument; d.open();
  d.write(`<html><head><title>Recovery codes</title><style>body{font:16px/1.6 sans-serif;margin:24mm}h1{font-size:20px}code{font:20px monospace;letter-spacing:2px}li{margin:6px 0}</style></head><body><h1>${centre || 'TuitionDesk'} — recovery codes</h1><p>Each code works once. Keep this sheet somewhere safe and private (not with your phone). Printed ${new Date().toLocaleDateString()}.</p><ol>${codes.map((c) => `<li><code>${c}</code></li>`).join('')}</ol></body></html>`);
  d.close(); setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 300);
}
const downloadCodes = (codes) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['TuitionDesk recovery codes (each works once)\r\n\r\n' + codes.join('\r\n') + '\r\n'], { type: 'text/plain' })); a.download = 'tuitiondesk-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500); };

export default function Security() {
  return <Page title="My password & security"><Card title="Change password"><ChangePassword /></Card><TwoStep /></Page>;
}

function TwoStep() {
  const q = useApi('mfa.status', {}); const [modal, setModal] = useState(null); const [codes, setCodes] = useState(null);
  const done = (c) => { setModal(null); if (c) setCodes(c); q.reload(); refreshUser(); };
  return (
    <Card title="Two-step sign-in">
      <Async q={q}>{(s) => (
        <>
          {!s.enabled ? (
            <>
              <p className="banner warn">Off. Anyone who learns your password can open every student record and verify payments. Turn this on: after your password, sign-in also needs a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</p>
              <Btn variant="primary" onClick={() => setModal('setup')}>Turn on two-step sign-in</Btn>
            </>
          ) : (
            <>
              <p className="banner">On. Authenticator code required at every sign-in. You have <strong>{s.recoveryCodesRemaining}</strong> unused recovery code(s).{s.recoveryCodesRemaining <= 3 && ' Make new ones soon.'}</p>
              <div className="row"><Btn onClick={() => setModal('regen')}>New recovery codes</Btn><Btn variant="danger" onClick={() => setModal('disable')}>Turn off…</Btn></div>
              <h3>Recovery email {s.recoveryEmail ? <span className="muted">· {s.recoveryEmail}</span> : null}</h3>
              <p className="small muted">Optional. If you lose your phone, a code emailed to this address can stand in for the authenticator code at sign-in, and can help you reset a forgotten password. Anyone who controls this mailbox <em>and</em> knows your password can sign in, so use a mailbox protected by its own two-step login.</p>
              <div className="row"><Btn onClick={() => setModal('email')}>{s.recoveryEmail ? 'Change recovery email' : 'Add recovery email'}</Btn>{s.recoveryEmail && <Btn onClick={() => setModal('emailoff')}>Remove</Btn>}</div>
            </>)}
        </>)}</Async>
      {modal === 'setup' && <Setup onClose={() => setModal(null)} onDone={done} />}
      {modal === 'regen' && <Confirm title="New recovery codes" action="mfa.regenerateRecovery" extra="Your current 10 codes stop working. Enter a current authenticator code." codeLabel="Authenticator code" onClose={() => setModal(null)} onDone={(r) => done(r.recoveryCodes)} />}
      {modal === 'disable' && <Confirm title="Turn off two-step sign-in" action="mfa.disable" danger extra="Your account will be protected by the password only. All other sessions are signed out." codeLabel="Authenticator or recovery code" onClose={() => setModal(null)} onDone={() => done()} />}
      {modal === 'email' && <EmailSetup onClose={() => setModal(null)} onDone={() => done()} />}
      {modal === 'emailoff' && <Confirm title="Remove recovery email" action="mfa.emailRemove" noCode onClose={() => setModal(null)} onDone={() => done()} />}
      {codes && <CodesModal codes={codes} onClose={() => setCodes(null)} />}
    </Card>
  );
}

function Setup({ onClose, onDone }) {
  const [run, busy] = useAction(); const [pw, setPw] = useState(''); const [info, setInfo] = useState(null); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const begin = async (e) => { e.preventDefault(); setErr(''); try { setInfo(await run(() => api('mfa.begin', { password: pw }))); } catch (x) { setErr(x.message); } };
  const enable = async (e) => { e.preventDefault(); setErr(''); try { const r = await run(() => api('mfa.enable', { code }), 'Two-step sign-in is on.'); onDone(r.recoveryCodes); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Turn on two-step sign-in" onClose={onClose} footer={<Btn onClick={onClose}>Cancel</Btn>}>
      {!info ? (
        <form onSubmit={begin}><p>Confirm it is you.</p><Field label="Your current password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>{err && <p className="ferr" role="alert">{err}</p>}<Btn variant="primary" busy={busy} type="submit">Continue</Btn></form>
      ) : (
        <form onSubmit={enable}>
          <ol><li>Open your authenticator app and add an account by scanning this code.</li></ol>
          <div style={{ textAlign: 'center' }}><QrSvg text={info.otpauthUri} /></div>
          <p className="small">Can’t scan? Enter this key manually (time-based, 6 digits):<br /><code style={{ userSelect: 'all', wordBreak: 'break-all', fontSize: '1.05rem' }}>{info.secret.match(/.{1,4}/g).join(' ')}</code></p>
          <ol start={2}><li>Type the 6-digit code the app shows now.</li></ol>
          <Field label="6-digit code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
          {err && <p className="ferr" role="alert">{err}</p>}<Btn variant="primary" busy={busy} type="submit">Verify and turn on</Btn>
          <p className="hint">Two-step turns on only after a correct code, so you cannot lock yourself out with a wrong scan. You will then get 10 recovery codes.</p>
        </form>)}
    </Modal>);
}
function CodesModal({ codes, onClose }) {
  const [saved, setSaved] = useState(false);
  return (
    <Modal title="Your recovery codes" onClose={() => saved && onClose()} footer={<Btn variant="primary" disabled={!saved} onClick={onClose}>Done</Btn>}>
      <p className="banner warn">Shown only once. Each code works one time and replaces your authenticator if your phone is lost. Print them or download them now, and keep them away from your phone.</p>
      <ol style={{ columns: 2 }}>{codes.map((c) => <li key={c}><code style={{ fontSize: '1.1rem' }}>{c}</code></li>)}</ol>
      <div className="row"><Btn onClick={() => printCodes(codes, document.title.split('·').pop().trim())}>Print</Btn><Btn onClick={() => downloadCodes(codes)}>Download .txt</Btn><Btn onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</Btn></div>
      <label className="field"><span className="lbl"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes somewhere safe.</span></label>
    </Modal>);
}
function Confirm({ title, action, extra, codeLabel, danger, noCode, onClose, onDone }) {
  const [run, busy] = useAction(); const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); setErr(''); try { onDone(await run(() => api(action, { password: pw, code }), 'Done.')); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant={danger ? 'danger' : 'primary'} busy={busy} type="submit" form="mfaconfirm">{title}</Btn></>}>
      <form id="mfaconfirm" onSubmit={go}>{extra && <p>{extra}</p>}<Field label="Your current password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
        {!noCode && <Field label={codeLabel}><input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></Field>}{err && <p className="ferr" role="alert">{err}</p>}</form>
    </Modal>);
}
function EmailSetup({ onClose, onDone }) {
  const [run, busy] = useAction(); const [pw, setPw] = useState(''); const [email, setEmail] = useState(''); const [sent, setSent] = useState(null); const [code, setCode] = useState(''); const [err, setErr] = useState('');
  const start = async (e) => { e.preventDefault(); setErr(''); try { setSent(await run(() => api('mfa.emailStart', { password: pw, email }))); } catch (x) { setErr(x.message); } };
  const confirm = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api('mfa.emailConfirm', { code }), 'Recovery email saved.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Recovery email" onClose={onClose} footer={<Btn onClick={onClose}>Cancel</Btn>}>
      {!sent ? <form onSubmit={start}><Field label="Email address"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field><Field label="Your current password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>{err && <p className="ferr" role="alert">{err}</p>}<Btn variant="primary" busy={busy} type="submit">Send confirmation code</Btn></form>
        : <form onSubmit={confirm}><p>A code was handed to Google’s mail service for <strong>{sent.sentTo}</strong>. Mail can be delayed or land in spam; this app cannot see whether it arrived. Enter the 8-digit code.</p><Field label="8-digit code"><input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>{err && <p className="ferr" role="alert">{err}</p>}<Btn variant="primary" busy={busy} type="submit">Confirm email</Btn></form>}
    </Modal>);
}
