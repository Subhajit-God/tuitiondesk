import React, { useEffect, useState } from 'react';
import { ApiErr, publicCall } from '../api.js';
import { Btn, Field, Loading, ErrorBox } from '../ui.jsx';

export default function Login({ onLoggedIn }) {
  const [status, setStatus] = useState(null); const [err, setErr] = useState(null);
  const load = () => { setErr(null); publicCall('auth.status').then(setStatus).catch(setErr); };
  useEffect(load, []);
  if (err) return <div className="login"><ErrorBox error={err} onRetry={load} /></div>;
  if (!status) return <Loading />;
  return status.setupComplete ? <SignIn status={status} onLoggedIn={onLoggedIn} /> : <FirstRun status={status} onLoggedIn={onLoggedIn} />;
}

function Env({ status }) { return status.environment !== 'production' ? <div className="banner warn" role="note">Test environment ({status.environment}) — not the live centre data.</div> : null; }

function SignIn({ status, onLoggedIn }) {
  const [mfa, setMfa] = useState(null); const [recover, setRecover] = useState(false);
  if (recover) return <Recover status={status} onBack={() => setRecover(false)} />;
  if (mfa) return <SecondStep status={status} mfa={mfa} onLoggedIn={onLoggedIn} onBack={() => setMfa(null)} />;
  return <Password status={status} onLoggedIn={onLoggedIn} onMfa={setMfa} onForgot={() => setRecover(true)} />;
}

function Password({ status, onLoggedIn, onMfa, onForgot }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [busy, setBusy] = useState(false); const [e, setE] = useState('');
  const submit = async (ev) => {
    ev.preventDefault(); setBusy(true); setE('');
    try { const r = await publicCall('auth.login', { username: u.trim(), password: p }); if (r.mfaRequired) onMfa(r); else onLoggedIn({ token: r.token, expiresAt: r.expiresAt, user: r.user }); }
    catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  return (
    <main className="login"><h1>TuitionDesk</h1><p className="muted" style={{ textAlign: 'center' }}>{status.centreName || 'Sign in to continue'}</p><Env status={status} />
      <form className="card" onSubmit={submit}>
        <Field label="Username"><input autoComplete="username" autoCapitalize="none" value={u} onChange={(x) => setU(x.target.value)} required /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={p} onChange={(x) => setP(x.target.value)} required /></Field>
        {e && <p className="ferr" role="alert">{e}</p>}
        <Btn variant="primary" busy={busy} type="submit" style={{ width: '100%' }}>Sign in</Btn>
        <p className="hint mt">Student? Forgot your password? Ask your Teacher to reset it for you.</p>
        <p className="hint"><button type="button" className="linkbtn" onClick={onForgot}>Teacher: forgot your password?</button></p>
      </form>
    </main>
  );
}

function FirstRun({ status, onLoggedIn }) {
  const [f, setF] = useState({ setupKey: '', displayName: '', username: '', password: '', confirm: '' }); const [busy, setBusy] = useState(false); const [e, setE] = useState('');
  const set = (k) => (x) => setF({ ...f, [k]: x.target.value });
  const submit = async (ev) => {
    ev.preventDefault(); setE('');
    if (f.password !== f.confirm) return setE('Passwords do not match.');
    setBusy(true);
    try {
      await publicCall('auth.bootstrap', { setupKey: f.setupKey.trim(), username: f.username.trim().toLowerCase(), password: f.password, displayName: f.displayName.trim() });
      const r = await publicCall('auth.login', { username: f.username.trim().toLowerCase(), password: f.password });
      onLoggedIn({ token: r.token, expiresAt: r.expiresAt, user: r.user });
    } catch (x) { setE(x instanceof ApiErr ? x.message : 'Setup failed.'); } finally { setBusy(false); }
  };
  return (
    <main className="login"><h1>Welcome to TuitionDesk</h1><p className="muted" style={{ textAlign: 'center' }}>Create the Teacher (Master Admin) account.</p><Env status={status} />
      <form className="card" onSubmit={submit}>
        <Field label="Setup key" hint="Run generateSetupKey() in the Apps Script editor and copy the key from the log. It works once."><input value={f.setupKey} onChange={set('setupKey')} required autoComplete="off" /></Field>
        <Field label="Your name"><input value={f.displayName} onChange={set('displayName')} required /></Field>
        <Field label="Username" hint="Lowercase letters, digits, . _ -"><input value={f.username} onChange={set('username')} required autoCapitalize="none" autoComplete="username" /></Field>
        <Field label="Password" hint="At least 10 characters with letters and numbers."><input type="password" value={f.password} onChange={set('password')} required autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
        {e && <p className="ferr" role="alert">{e}</p>}
        <Btn variant="primary" busy={busy} type="submit" style={{ width: '100%' }}>Create Teacher account</Btn>
      </form>
    </main>
  );
}

/** Second step for a Teacher with two-step sign-in on. */
function SecondStep({ status, mfa, onLoggedIn, onBack }) {
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [e, setE] = useState(''); const [note, setNote] = useState('');
  const submit = async (ev) => {
    ev.preventDefault(); setBusy(true); setE('');
    try { const r = await publicCall('auth.mfaVerify', { mfaToken: mfa.mfaToken, code }); onLoggedIn({ token: r.token, expiresAt: r.expiresAt, user: r.user }); if (r.secondFactor === 'recovery') setTimeout(() => window.alert('You signed in with a recovery code. ' + r.recoveryCodesRemaining + ' left. Open “Password & security” to make new codes.'), 300); }
    catch (x) { setE(x.message); if (x.code === 'UNAUTHENTICATED') setTimeout(onBack, 1500); } finally { setBusy(false); }
  };
  const email = async () => { setE(''); setNote(''); try { const r = await publicCall('auth.mfaEmailCode', { mfaToken: mfa.mfaToken }); setNote('A code was handed to the mail service for ' + r.sentTo + '. It may take a minute and can land in spam. Enter the 8-digit code.'); } catch (x) { setE(x.message); } };
  return (
    <main className="login"><h1>Two-step sign-in</h1><p className="muted" style={{ textAlign: 'center' }}>{status.centreName}</p><Env status={status} />
      <form className="card" onSubmit={submit}>
        <Field label="Code" hint="The 6-digit code from your authenticator app, or a recovery code (XXXX-XXXX-XXXX), or the 8-digit code from your email."><input inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" value={code} onChange={(x) => setCode(x.target.value)} required autoFocus /></Field>
        {e && <p className="ferr" role="alert">{e}</p>}{note && <p className="banner" role="status">{note}</p>}
        <Btn variant="primary" busy={busy} type="submit" style={{ width: '100%' }}>Sign in</Btn>
        <p className="hint mt">Lost your phone? {mfa.methods?.recoveryCode && 'Use one of your printed recovery codes. '}{mfa.methods?.email ? <button type="button" className="linkbtn" onClick={email}>Email me a code</button> : 'No recovery email is set up.'}</p>
        <p className="hint"><button type="button" className="linkbtn" onClick={onBack}>← Back</button></p>
      </form>
    </main>
  );
}

/** Forgotten Teacher password: two DIFFERENT proofs (authenticator code, recovery code, emailed code) + a new password. */
function Recover({ status, onBack }) {
  const [f, setF] = useState({ username: '', code1: '', code2: '', newPassword: '', confirm: '' }); const [busy, setBusy] = useState(false); const [e, setE] = useState(''); const [note, setNote] = useState(''); const [done, setDone] = useState(false);
  const set = (k) => (x) => setF({ ...f, [k]: x.target.value });
  const email = async () => { setE(''); setNote(''); if (!f.username.trim()) return setE('Enter your username first.'); try { const r = await publicCall('auth.recoveryEmailCode', { username: f.username.trim().toLowerCase() }); setNote(r.note + ' (Mail can take a minute and may land in spam.)'); } catch (x) { setE(x.message); } };
  const submit = async (ev) => {
    ev.preventDefault(); setE(''); if (f.newPassword !== f.confirm) return setE('Passwords do not match.'); setBusy(true);
    try { await publicCall('auth.recoverPassword', { username: f.username.trim().toLowerCase(), code1: f.code1, code2: f.code2, newPassword: f.newPassword }); setDone(true); } catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  if (done) return <main className="login"><h1>Password changed</h1><div className="card"><p>Your password was changed and all other sessions were signed out. Two-step sign-in is still required.</p><Btn variant="primary" onClick={onBack}>Go to sign in</Btn></div></main>;
  return (
    <main className="login"><h1>Reset Teacher password</h1><Env status={status} />
      <form className="card" onSubmit={submit}>
        <p className="small">This works only if two-step sign-in is on. You need <strong>two different</strong> proofs: any two of an authenticator code, a printed recovery code, or an emailed code. (Two recovery codes do not count as different.)</p>
        <Field label="Username"><input value={f.username} onChange={set('username')} autoCapitalize="none" required /></Field>
        <Field label="First code"><input value={f.code1} onChange={set('code1')} autoComplete="off" required /></Field><Field label="Second code (a different kind)"><input value={f.code2} onChange={set('code2')} autoComplete="off" required /></Field>
        <p className="hint"><button type="button" className="linkbtn" onClick={email}>Email me a code</button> (only if you added a recovery email)</p>
        <Field label="New password" hint="At least 10 characters with letters and numbers."><input type="password" autoComplete="new-password" value={f.newPassword} onChange={set('newPassword')} required /></Field>
        <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></Field>
        {e && <p className="ferr" role="alert">{e}</p>}{note && <p className="banner" role="status">{note}</p>}
        <Btn variant="primary" busy={busy} type="submit" style={{ width: '100%' }}>Change password</Btn>
        <p className="hint mt"><button type="button" className="linkbtn" onClick={onBack}>← Back to sign in</button></p>
      </form>
    </main>
  );
}
