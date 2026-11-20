import React, { useState } from 'react';
import { api } from '../api.js';
import { Btn, Field, useUi } from '../ui.jsx';

/** Used for the forced temporary-password change and from Profile/Settings. */
export default function ChangePassword({ forced, onDone, onLogout }) {
  const ui = useUi(); const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' }); const [busy, setBusy] = useState(false); const [e, setE] = useState('');
  const set = (k) => (x) => setF({ ...f, [k]: x.target.value });
  const submit = async (ev) => {
    ev.preventDefault(); setE('');
    if (f.newPassword !== f.confirm) return setE('New passwords do not match.');
    setBusy(true);
    try { await api('auth.changePassword', { currentPassword: f.currentPassword, newPassword: f.newPassword }); ui.ok('Password changed.'); setF({ currentPassword: '', newPassword: '', confirm: '' }); onDone?.(); }
    catch (x) { setE(x.message); } finally { setBusy(false); }
  };
  const form = (
    <form className="card" onSubmit={submit} style={{ maxWidth: 440 }}>
      {forced && <p className="banner warn">You are using a temporary password. Choose a new one to continue.</p>}
      <Field label="Current password"><input type="password" autoComplete="current-password" value={f.currentPassword} onChange={set('currentPassword')} required /></Field>
      <Field label="New password" hint="At least 8 characters (Teacher: 10) with letters and numbers."><input type="password" autoComplete="new-password" value={f.newPassword} onChange={set('newPassword')} required /></Field>
      <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></Field>
      {e && <p className="ferr" role="alert">{e}</p>}
      <div className="row"><Btn variant="primary" busy={busy} type="submit">Change password</Btn>{forced && <Btn type="button" onClick={onLogout}>Sign out</Btn>}</div>
    </form>
  );
  return forced ? <main className="login"><h1>Change password</h1>{form}</main> : form;
}
