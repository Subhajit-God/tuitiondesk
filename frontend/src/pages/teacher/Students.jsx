import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Modal, Money, Page, Pager, SearchBar, Select, Table, Tabs, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { fmtDate, monthStartStr, phoneDisplay, todayStr, money } from '../../util.js';

export default function Students() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [batchId, setBatchId] = useState(''); const [page, setPage] = useState(1);
  const q = useApi('students.list', { search, status, batchId, page, pageSize: 25 });
  const [adding, setAdding] = useState(false); const [open, setOpen] = useState(null); const [creds, setCreds] = useState(null);
  const reset = (fn) => (e) => { fn(e.target ? e.target.value : e); setPage(1); };
  return (
    <Page title="Students" actions={<Btn variant="primary" onClick={() => setAdding(true)}>+ Add student</Btn>}>
      <div className="row">
        <SearchBar value={search} onChange={reset(setSearch)} placeholder="Search name, ID or guardian" />
        <Select aria-label="Filter by status" value={status} onChange={reset(setStatus)} placeholder="Active & inactive" options={[['active', 'Active'], ['inactive', 'Inactive'], ['archived', 'Archived']]} />
        <BatchSelect aria-label="Filter by batch" value={batchId} onChange={reset(setBatchId)} />
      </div>
      <Async q={q}>{(d) => d.items.length === 0 ? (
        search || status || batchId ? <Empty title="No students match these filters" hint="Clear the search or filters to see everyone." />
          : <Empty title="No students yet" hint="Add your first student. You can assign a batch and create their login at the same time."><Btn variant="primary" onClick={() => setAdding(true)}>Add the first student</Btn></Empty>
      ) : (
        <>
          <Table><thead><tr><th>ID</th><th>Name</th><th>Batches</th><th>Guardian</th><th>Status</th></tr></thead><tbody>
            {d.items.map((s) => (
              <tr key={s.studentId} className="click" tabIndex={0} onClick={() => setOpen(s.studentId)} onKeyDown={(e) => e.key === 'Enter' && setOpen(s.studentId)}>
                <td className="num">{s.studentId}</td><td><strong>{s.fullName}</strong><div className="muted small">Admitted {fmtDate(s.admissionDate)}</div></td>
                <td>{s.batches.length ? s.batches.map((b) => b.name).join(', ') : <span className="muted">None</span>}</td><td>{s.guardianName || '—'}</td><td><Chip s={s.status} /></td>
              </tr>))}
          </tbody></Table>
          <Pager data={d} onPage={setPage} />
        </>)}</Async>
      {adding && <AddStudent onClose={() => setAdding(false)} onCreated={(c) => { setAdding(false); setCreds(c); q.reload(); }} />}
      {creds && <Credentials c={creds} onClose={() => setCreds(null)} />}
      {open && <Profile id={open} onClose={() => setOpen(null)} onChanged={q.reload} onCreds={setCreds} />}
    </Page>
  );
}

export function Credentials({ c, onClose }) {
  const ui = useUi();
  const text = `Username: ${c.username}\nTemporary password: ${c.temporaryPassword}`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); ui.ok('Copied.'); } catch { ui.err('Copy failed — select the text and copy it manually.'); } };
  return (
    <Modal title="Student login created" onClose={onClose} footer={<><Btn onClick={copy}>Copy</Btn><Btn variant="primary" onClick={onClose}>I have noted it</Btn></>}>
      <p className="banner warn" role="alert">Shown <strong>once</strong>. The student must change this temporary password at first sign-in. It cannot be viewed again — you can only reset it.</p>
      <p><strong>{c.name}</strong></p>
      <dl className="kv"><dt>Username</dt><dd><code>{c.username}</code></dd><dt>Temporary password</dt><dd><code>{c.temporaryPassword}</code></dd></dl>
    </Modal>
  );
}

function AddStudent({ onClose, onCreated }) {
  const [run, busy] = useAction(); const ui = useUi();
  const [f, set, setF] = useForm({ fullName: '', guardianName: '', guardianWhatsapp: '', whatsappConsent: 'unknown', admissionDate: todayStr(), batchId: '', notes: '', createAccount: true, username: '', password: '' });
  const [err, setErr] = useState({}); const [msg, setMsg] = useState('');
  const submit = async (e, override) => {
    e?.preventDefault(); setMsg('');
    const er = {};
    if (f.fullName.trim().length < 2) er.fullName = 'Enter the student’s full name (at least 2 letters).';
    if (f.guardianWhatsapp && !/^[\d\s+\-()]{10,16}$/.test(f.guardianWhatsapp)) er.guardianWhatsapp = 'Enter a valid phone number (digits only).';
    if (f.username && !/^[a-z0-9._-]{3,30}$/.test(f.username)) er.username = 'Use 3–30 lowercase letters, digits, . _ -';
    setErr(er); if (Object.keys(er).length) return;
    const body = { fullName: f.fullName.trim(), guardianName: f.guardianName.trim(), guardianWhatsapp: f.guardianWhatsapp.trim(), whatsappConsent: f.whatsappConsent, admissionDate: f.admissionDate, batchIds: f.batchId ? [f.batchId] : [], notes: f.notes, createAccount: f.createAccount, overrideCapacity: !!override };
    if (f.createAccount && f.username) body.username = f.username.trim(); if (f.createAccount && f.password) body.password = f.password;
    try { const r = await run(() => api('students.create', body), 'Student added.'); onCreated(r.temporaryPassword ? { name: r.fullName, username: r.username, temporaryPassword: r.temporaryPassword } : null); if (!r.temporaryPassword) onCreated(null); }
    catch (x) { if (x.code === 'CAPACITY') { if (await ui.confirm({ title: 'Batch is full', message: x.message, confirmLabel: 'Add anyway' })) return submit(null, true); } else setMsg(x.message); }
  };
  return (
    <Modal title="Add student" wide onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="addstu">Add student</Btn></>}>
      <form id="addstu" onSubmit={submit} className="formgrid" noValidate>
        <Field label="Full name" error={err.fullName} wide><input value={f.fullName} onChange={set('fullName')} required autoFocus maxLength={100} /></Field>
        <Field label="Guardian name"><input value={f.guardianName} onChange={set('guardianName')} maxLength={100} /></Field>
        <Field label="Guardian WhatsApp number" error={err.guardianWhatsapp} hint="10-digit number; +91 is added automatically"><input inputMode="tel" value={f.guardianWhatsapp} onChange={set('guardianWhatsapp')} /></Field>
        <Field label="Guardian consent for WhatsApp messages" hint="Messages are prepared for you to send from your own WhatsApp. Record whether the guardian agreed to receive them."><Select value={f.whatsappConsent} onChange={set('whatsappConsent')} options={[['unknown', 'Not confirmed'], ['yes', 'Yes — consented'], ['no', 'No — opted out']]} /></Field>
        <Field label="Admission date"><input type="date" value={f.admissionDate} max={todayStr()} onChange={set('admissionDate')} /></Field>
        <Field label="Batch (optional)"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="No batch yet" /></Field>
        <Field label="Private notes (Teacher only)" wide><input value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        <label className="wide" style={{ marginBottom: '.6rem' }}><input type="checkbox" checked={f.createAccount} onChange={set('createAccount')} /> Create a student login (portal access)</label>
        {f.createAccount && <><Field label="Username (optional)" error={err.username} hint="Leave blank to use the student ID, e.g. stu0001"><input value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>
          <Field label="Temporary password (optional)" hint="Leave blank to generate one. The student must change it."><input value={f.password} onChange={set('password')} autoComplete="off" /></Field></>}
        {msg && <p className="ferr wide" role="alert">{msg}</p>}
      </form>
    </Modal>
  );
}

function Profile({ id, onClose, onChanged, onCreds }) {
  const q = useApi('students.get', { studentId: id }); const [tab, setTab] = useState('profile');
  const title = q.data ? `${q.data.fullName} · ${q.data.studentId}` : 'Student';
  return (
    <Modal title={title} wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Async q={q}>{(s) => (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[['profile', 'Profile'], ['batches', 'Batches'], ['fees', 'Fees'], ['attendance', 'Attendance'], ['account', 'Account']]} />
          {tab === 'profile' && <EditProfile s={s} onSaved={() => { q.reload(); onChanged(); }} />}
          {tab === 'batches' && <BatchesTab s={s} onChanged={() => { q.reload(); onChanged(); }} />}
          {tab === 'fees' && <FeesTab id={id} />}
          {tab === 'attendance' && <AttTab id={id} />}
          {tab === 'account' && <AccountTab s={s} onChanged={() => { q.reload(); onChanged(); }} onCreds={onCreds} />}
        </>)}</Async>
    </Modal>
  );
}

function EditProfile({ s, onSaved }) {
  const [run, busy] = useAction();
  const [f, set] = useForm({ fullName: s.fullName, guardianName: s.guardianName, guardianWhatsapp: s.guardianWhatsapp ? '+' + s.guardianWhatsapp : '', whatsappConsent: s.whatsappConsent, contactEmail: s.contactEmail, admissionDate: s.admissionDate, notes: s.notes, reminderMode: s.reminderMode || 'auto', reminderPauseUntil: s.reminderPauseUntil || '' });
  const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api('students.update', { studentId: s.studentId, ...f }), 'Profile saved.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <form onSubmit={submit} className="formgrid">
      <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} required minLength={2} /></Field>
      <Field label="Admission date"><input type="date" value={f.admissionDate} onChange={set('admissionDate')} /></Field>
      <Field label="Guardian name"><input value={f.guardianName} onChange={set('guardianName')} /></Field>
      <Field label="Guardian WhatsApp"><input inputMode="tel" value={f.guardianWhatsapp} onChange={set('guardianWhatsapp')} /></Field>
      <Field label="Guardian consent for WhatsApp"><Select value={f.whatsappConsent} onChange={set('whatsappConsent')} options={[['unknown', 'Not confirmed'], ['yes', 'Yes — consented'], ['no', 'No — opted out']]} /></Field>
      <Field label="Fee reminders" hint="Gentle = never a firm message; you are asked to call instead."><Select value={f.reminderMode} onChange={set('reminderMode')} options={[['auto', 'Automatic ladder'], ['gentle', 'Gentle — call me instead of firm messages'], ['off', 'Off for this family']]} /></Field>
      <Field label="Pause reminders until" hint="Optional date, e.g. a promised payment date"><input type="date" value={f.reminderPauseUntil} onChange={set('reminderPauseUntil')} /></Field>
      <Field label="Contact email (optional)"><input type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
      <Field label="Private notes (Teacher only)" wide><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
      {err && <p className="ferr wide" role="alert">{err}</p>}
      <div className="wide"><Btn variant="primary" busy={busy} type="submit">Save changes</Btn> <span className="muted small">Status: <Chip s={s.status} /> · Guardian: {phoneDisplay(s.guardianWhatsapp)}</span></div>
    </form>
  );
}

function BatchesTab({ s, onChanged }) {
  const ui = useUi(); const [pick, setPick] = useState(''); const [run, busy] = useAction();
  const active = s.batches.filter((b) => b.status === 'active');
  const add = async (override) => {
    try { await run(() => api('students.assignBatch', { studentId: s.studentId, batchId: pick, overrideCapacity: !!override }), 'Batch assigned.'); setPick(''); onChanged(); }
    catch (x) { if (x.code === 'CAPACITY' && (await ui.confirm({ title: 'Batch is full', message: x.message, confirmLabel: 'Assign anyway' }))) add(true); }
  };
  const remove = async (b) => { if (!(await ui.confirm({ title: 'Remove from batch', message: `Remove ${s.fullName} from "${b.name}"? Past attendance, fees and marks are kept.`, confirmLabel: 'Remove', danger: true }))) return; try { await run(() => api('students.removeBatch', { studentId: s.studentId, batchId: b.batchId }), 'Removed from batch.'); onChanged(); } catch { /* toast shown */ } };
  return (
    <>
      {s.status !== 'active' ? <p className="banner warn">This student is {s.status}. Reactivate them in the Account tab to assign batches.</p> : (
        <div className="row"><Field label="Assign to batch"><BatchSelect value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Choose a batch" /></Field><Btn variant="primary" disabled={!pick} busy={busy} onClick={() => add(false)}>Assign</Btn></div>)}
      {s.batches.length === 0 ? <Empty title="Not in any batch" hint="Choose a batch above to assign this student." /> : (
        <Table><thead><tr><th>Batch</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead><tbody>{s.batches.map((b) => (
          <tr key={b.linkId}><td>{b.name}</td><td>{fmtDate(b.startDate)}</td><td>{fmtDate(b.endDate)}</td><td><Chip s={b.status === 'active' ? 'active' : 'inactive'} label={b.status === 'active' ? 'Current' : 'Ended'} /></td><td>{b.status === 'active' && <Btn className="small" onClick={() => remove(b)}>Remove</Btn>}</td></tr>))}</tbody></Table>)}
      {active.length === 0 && s.batches.length > 0 && <p className="muted small mt">Membership history is kept for records.</p>}
    </>
  );
}

function PayLinkBox({ id }) {
  const [l, setL] = useState(null); const [run, busy] = useAction(); const ui = useUi();
  const get = async () => { try { setL(await run(() => api('pay.link', { studentId: id }))); } catch { /* toast */ } };
  const copy = async () => { try { await navigator.clipboard.writeText(l.url); ui.ok('Pay link copied.'); } catch { ui.err('Could not copy — select the link and copy it.'); } };
  return (<div className="card"><strong>One-tap pay link</strong> <span className="muted small">— the parent sees the exact amount and pays with their UPI app</span>
    <div className="row mt"><Btn busy={busy} onClick={get}>{l ? 'Refresh' : 'Show pay link'}</Btn>{l?.url && <Btn onClick={copy}>Copy link</Btn>}</div>
    {l && <><p className="small" style={{ wordBreak: 'break-all' }}>{l.url || '—'}</p><p className="small">Currently payable: <strong>{l.amount}</strong>{l.periods.length ? ' (' + l.periods.join(', ') + ')' : ''} · note reference <strong>#{l.reference}</strong> appears on the bank statement if the parent uses the link.{l.reportedAt && ' Parent said “I have paid” on ' + l.reportedAt.slice(0, 10) + ' — check your bank, then record and verify the payment.'}</p>{l.problem && <p className="banner warn">{l.problem}</p>}</>}</div>);
}
function FeesTab({ id }) {
  const q = useApi('fees.statement', { studentId: id });
  return (
    <Async q={q}>{(st) => (
      <>
        <PayLinkBox id={id} />
        <div className="grid g4"><div className="stat"><div className="l">Net due</div><div className="v"><Money v={st.totals.netDue} /></div></div><div className="stat"><div className="l">Paid (verified)</div><div className="v"><Money v={st.totals.paid} /></div></div><div className="stat"><div className="l">Outstanding</div><div className="v"><Money v={st.totals.balance} /></div></div><div className="stat"><div className="l">Credit on account</div><div className="v"><Money v={st.creditOnAccount} /></div></div></div>
        <h3>Fee obligations</h3>
        {st.fees.length === 0 ? <Empty title="No fees yet" hint="Create fees from Fees & Payments." /> : <Table><thead><tr><th>Period</th><th>Due</th><th className="r">Net due</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th></tr></thead><tbody>{st.fees.map((f) => <tr key={f.feeId}><td>{f.billingPeriod}</td><td>{fmtDate(f.dueDate)}{f.overdueDays > 0 && f.balance > 0 && <div className="small muted">{f.overdueDays} days overdue</div>}</td><td className="r"><Money v={f.netDue} /></td><td className="r"><Money v={f.paid} /></td><td className="r"><Money v={f.balance} /></td><td><Chip s={f.status} /></td></tr>)}</tbody></Table>}
        <h3>Payments</h3>
        {st.payments.length === 0 ? <p className="muted">No payments recorded.</p> : <Table><thead><tr><th>Date</th><th>Type</th><th className="r">Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>{st.payments.map((p) => <tr key={p.paymentId}><td>{fmtDate(p.receivedAt)}</td><td>{p.kind === 'refund' ? 'Refund' : 'Payment'} · {p.method}</td><td className="r"><Money v={p.amount} /></td><td><Chip s={p.status} label={p.status === 'pending' ? 'pending — unverified' : p.status} /></td><td>{p.receipt?.receiptNumber || '—'}</td></tr>)}</tbody></Table>}
        <p className="mt"><a href="#/fees">Open Fees & Payments</a> to record, verify or adjust.</p>
      </>)}</Async>
  );
}

function AttTab({ id }) {
  const [from, setFrom] = useState(monthStartStr()); const [to, setTo] = useState(todayStr());
  const q = useApi('attendance.studentSummary', { studentId: id, from, to });
  return (
    <>
      <div className="row"><Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <Async q={q}>{(a) => (
        <>
          <div className="grid g4"><div className="stat"><div className="l">Present</div><div className="v">{a.counts.P}</div></div><div className="stat"><div className="l">Absent</div><div className="v">{a.counts.A}</div></div><div className="stat"><div className="l">Holiday</div><div className="v">{a.counts.H}</div></div><div className="stat"><div className="l">Attendance</div><div className="v">{a.percentage === null ? 'n/a' : a.percentage + '%'}</div></div></div>
          <p className="hint">{a.policy}</p>
          {a.records.length === 0 ? <Empty title="No attendance in this period" hint="Record attendance from the Attendance page." /> : <Table><thead><tr><th>Date</th><th>Batch</th><th>Session</th><th>Status</th></tr></thead><tbody>{a.records.slice(0, 60).map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.batchName}</td><td>{r.sessionLabel}</td><td><Chip s={{ P: 'present', A: 'absent', H: 'holiday' }[r.status]} />{r.corrected && <span className="muted small"> corrected</span>}</td></tr>)}</tbody></Table>}
        </>)}</Async>
    </>
  );
}

function AccountTab({ s, onChanged, onCreds }) {
  const ui = useUi(); const [run, busy] = useAction(); const [pw, setPw] = useState('');
  const resetPw = async () => {
    if (!(await ui.confirm({ title: 'Reset password', message: `Generate a new temporary password for ${s.fullName}? They will be signed out and must choose a new password.`, confirmLabel: 'Reset' }))) return;
    try { const r = await run(() => api('students.resetPassword', { studentId: s.studentId, newPassword: pw || undefined })); onCreds({ name: s.fullName, username: s.username, temporaryPassword: r.temporaryPassword }); setPw(''); } catch { /* toast */ }
  };
  const setStatus = async (to) => {
    const msg = { inactive: 'The student is deactivated: login disabled and removed from batches. Fees, attendance and marks are kept.', archived: 'Archive the student (hidden from normal lists). Login disabled; all history kept.', active: 'Reactivate the student and re-enable login? They must be re-assigned to batches.' }[to];
    if (!(await ui.confirm({ title: to === 'active' ? 'Reactivate student' : to === 'archived' ? 'Archive student' : 'Deactivate student', message: msg, confirmLabel: to === 'active' ? 'Reactivate' : 'Confirm', danger: to !== 'active' }))) return;
    try { await run(() => api('students.setStatus', { studentId: s.studentId, status: to }), 'Status updated.'); onChanged(); } catch { /* toast */ }
  };
  return (
    <>
      <dl className="kv"><dt>Status</dt><dd><Chip s={s.status} /></dd><dt>Username</dt><dd>{s.username || 'No login'}</dd><dt>Login</dt><dd>{s.accountStatus}</dd></dl>
      {s.username ? (<><h3>Reset password</h3><div className="row"><Field label="New temporary password (optional)" hint="Leave blank to generate one"><input value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field><Btn busy={busy} onClick={resetPw}>Reset password</Btn></div></>) : <p className="muted">This student has no login account.</p>}
      <h3>Status</h3>
      <div className="row">{s.status !== 'active' && <Btn variant="primary" busy={busy} onClick={() => setStatus('active')}>Reactivate</Btn>}{s.status === 'active' && <Btn busy={busy} onClick={() => setStatus('inactive')}>Deactivate</Btn>}{s.status !== 'archived' && <Btn busy={busy} onClick={() => setStatus('archived')}>Archive</Btn>}</div>
      <p className="hint">Students are never deleted, so financial and academic history stays intact.</p>
    </>
  );
}
