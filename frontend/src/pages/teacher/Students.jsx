import React, { useEffect, useState } from 'react';
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
        <Select aria-label="Filter by status" value={status} onChange={reset(setStatus)} placeholder="Active & inactive" options={[['active', 'Active'], ['left', 'Left'], ['inactive', 'Inactive'], ['archived', 'Archived']]} />
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
                <td className="num">{s.studentId}</td><td><strong>{s.fullName}</strong><div className="muted small">Admitted {fmtDate(s.admissionDate)}{s.leavingDate && ' · Left ' + fmtDate(s.leavingDate)}</div></td>
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
    if (!f.batchId) er.batchId = 'Select the batch this student is joining. Create batches first on the Today page → Batches tab.';
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
        <Field label="Batch" error={err.batchId}><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Select a batch" required /></Field>
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
          <Tabs value={tab} onChange={setTab} tabs={[['profile', 'Profile'], ['enrolment', 'Admission & leaving'], ['batches', 'Batches'], ['fees', 'Fees'], ['attendance', 'Attendance'], ['account', 'Account']]} />
          {tab === 'profile' && <EditProfile s={s} onSaved={() => { q.reload(); onChanged(); }} />}
          {tab === 'enrolment' && <EnrolmentTab s={s} onChanged={() => { q.reload(); onChanged(); }} />}
          {tab === 'batches' && <BatchesTab s={s} onChanged={() => { q.reload(); onChanged(); }} />}
          {tab === 'fees' && <FeesTab id={id} s={s} />}
          {tab === 'attendance' && <AttTab id={id} />}
          {tab === 'account' && <AccountTab s={s} onChanged={() => { q.reload(); onChanged(); }} onCreds={onCreds} />}
        </>)}</Async>
    </Modal>
  );
}

function EditProfile({ s, onSaved }) {
  const [run, busy] = useAction();
  const [f, set, setF] = useForm({ fullName: s.fullName, guardianName: s.guardianName, guardianWhatsapp: s.guardianWhatsapp ? '+' + s.guardianWhatsapp : '', whatsappConsent: s.whatsappConsent, contactEmail: s.contactEmail, admissionDate: s.admissionDate, monthlyFee: s.monthlyFee || '', username: s.username || '', notes: s.notes, planId: s.planId || '', noSiblingDiscount: !!s.noSiblingDiscount, language: s.language || 'en', reminderMode: s.reminderMode || 'auto', reminderPauseUntil: s.reminderPauseUntil || '' });
  const [err, setErr] = useState(''); const plans = useApi('plans.list', {});
  const submit = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api('students.update', { studentId: s.studentId, ...f }), 'Profile saved.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <form onSubmit={submit} className="formgrid">
      <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} required minLength={2} /></Field>
      <Field label="Admission date"><input type="date" value={f.admissionDate} onChange={set('admissionDate')} /></Field>
      <Field label="Monthly fee (₹)" hint="Used when generating fees. Changing it never alters fees already billed."><input type="number" min="0" step="0.01" value={f.monthlyFee} onChange={set('monthlyFee')} /></Field>
      <Field label="Fee plan" hint="Sets the billing cycle and admission fee. The monthly fee above, if filled, overrides the plan's."><select value={f.planId} onChange={set('planId')}><option value="">No plan (default fee)</option>{(plans.data || []).map((p) => <option key={p.planId} value={p.planId}>{p.name} — {p.cycle}</option>)}</select></Field>
      <Field label="Message language" hint="Used for this family's reminders and monthly report."><select value={f.language} onChange={set('language')}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="bn">বাংলা (Bengali)</option></select></Field>
      <label className="check"><input type="checkbox" checked={f.noSiblingDiscount} onChange={(e) => setF({ ...f, noSiblingDiscount: e.target.checked })} /> Do not give a sibling discount to this student</label>
      {s.username && <Field label="Login name" hint="Changing it signs the student out"><input value={f.username} onChange={set('username')} autoCapitalize="none" pattern="[a-z0-9._\-]+" minLength={3} /></Field>}
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
  const [editLink, setEditLink] = useState(null); const ui = useUi(); const [pick, setPick] = useState(''); const [run, busy] = useAction();
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
          <tr key={b.linkId}><td>{b.name}</td><td>{fmtDate(b.startDate)}</td><td>{fmtDate(b.endDate)}</td><td><Chip s={b.status === 'active' ? 'active' : 'inactive'} label={b.status === 'active' ? 'Current' : 'Ended'} /></td><td><Btn className="small" onClick={() => setEditLink(b)}>Dates…</Btn> {b.status === 'active' && <Btn className="small" onClick={() => remove(b)}>Remove</Btn>}</td></tr>))}</tbody></Table>)}
      {editLink && <LinkDates b={editLink} onClose={() => setEditLink(null)} onDone={() => { setEditLink(null); onChanged(); }} />}
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
function FeesTab({ id, s }) {
  const q = useApi('fees.statement', { studentId: id }); const [gen, setGen] = useState(false);
  return (
    <Async q={q}>{(st) => (
      <>
        {['active', 'left'].includes(s.status) && <div className="row"><Btn onClick={() => setGen(true)}>Generate fees for all enrolled months…</Btn><span className="hint">Fees run from the admission month ({s.enrolment.billableFrom}) to {s.status === 'left' ? 'the leaving month (' + s.enrolment.billableTo + ')' : 'the current month'}.</span></div>}
        {gen && <GenerateFees s={s} onClose={() => setGen(false)} onDone={() => { setGen(false); q.reload(); }} />}
        {st.creditOnAccount > 0 && <p className="banner credit" role="status">Credit on account: <strong><Money v={st.creditOnAccount} /></strong> — it is applied automatically to the next fee that is created.</p>}
        <PayLinkBox id={id} />
        <div className="grid g4"><div className="stat"><div className="l">Net due</div><div className="v"><Money v={st.totals.netDue} /></div></div><div className="stat"><div className="l">Paid (verified)</div><div className="v"><Money v={st.totals.paid} /></div></div><div className="stat"><div className="l">Outstanding</div><div className="v"><Money v={st.totals.balance} /></div></div><div className="stat"><div className="l">Credit on account</div><div className="v"><Money v={st.creditOnAccount} /></div></div></div>
        <h3>Fee obligations</h3>
        {st.fees.length === 0 ? <Empty title="No fees yet" hint="Create fees from Fees & Payments." /> : <Table><thead><tr><th>Period</th><th>Due</th><th className="r">Net due</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th></tr></thead><tbody>{st.fees.map((f) => <tr key={f.feeId}><td>{f.billingPeriod}{f.kind === 'admission' && <div className="small muted">Admission fee</div>}{f.months > 1 && <div className="small muted">{f.months} months</div>}</td><td>{fmtDate(f.dueDate)}{f.overdueDays > 0 && f.balance > 0 && <div className="small muted">{f.overdueDays} days overdue</div>}</td><td className="r"><Money v={f.netDue} /></td><td className="r"><Money v={f.paid} /></td><td className="r"><Money v={f.balance} /></td><td><Chip s={f.status} /></td></tr>)}</tbody></Table>}
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
      {s.status === 'left' ? <p className="banner">This student left on {fmtDate(s.leavingDate)}. To bring them back use <strong>Re-admit</strong> on the “Admission &amp; leaving” tab.</p> : <div className="row">{s.status !== 'active' && <Btn variant="primary" busy={busy} onClick={() => setStatus('active')}>Reactivate</Btn>}{s.status === 'active' && <Btn busy={busy} onClick={() => setStatus('inactive')}>Deactivate</Btn>}{s.status !== 'archived' && <Btn busy={busy} onClick={() => setStatus('archived')}>Archive</Btn>}</div>}
      {s.status !== 'left' && <p className="hint">Deactivating or archiving does <strong>not</strong> stop fees. When a student stops coming, record the leaving on the “Admission &amp; leaving” tab so billing ends in the leaving month.</p>}
      <p className="hint">Students are never deleted, so financial and academic history stays intact.</p>
    </>
  );
}

const REASONS = [['completed', 'Completed the course'], ['relocated', 'Moved away'], ['fees', 'Fees'], ['other_institute', 'Joined another institute'], ['not_satisfied', 'Not satisfied'], ['health', 'Health'], ['other', 'Other']];
const reasonLabel = (k) => (REASONS.find((r) => r[0] === k) || [k, k || '—'])[1];

function EnrolmentTab({ s, onChanged }) {
  const e = s.enrolment; const [modal, setModal] = useState('');
  return (
    <>
      <div className="grid g4"><div className="stat"><div className="l">Billed from</div><div className="v">{e.billableFrom || '—'}</div></div><div className="stat"><div className="l">Billed to</div><div className="v">{e.billableTo || '—'}{s.status !== 'left' && <span className="small muted"> (now)</span>}</div></div><div className="stat"><div className="l">Months</div><div className="v">{e.billableMonths}</div></div><div className="stat"><div className="l">Still owes</div><div className="v">{money(e.outstanding)}</div></div></div>
      <p className="hint">Fees are calculated from the <strong>admission month</strong> to the <strong>leaving month</strong>, both whole months. If the student leaves mid-month, that month is still billed — use a fee discount if you want to charge less.</p>
      {e.derived && <p className="banner warn">This student was added before admission and leaving were tracked, so the stay is worked out from the admission date and stays open until you record a leaving.</p>}
      {e.feesOutside.length > 0 && <p className="banner bad">Fee(s) outside the enrolled months: {e.feesOutside.join(', ')}. Review them in Fees &amp; Payments (cancel them, or correct the admission/leaving dates). Nothing was deleted automatically.</p>}
      <h3>Stays</h3>
      <Table><thead><tr><th>Admitted</th><th>Left</th><th>Reason</th><th /></tr></thead><tbody>{e.stays.map((x, i) => <tr key={i}><td>{fmtDate(x.startDate)}</td><td>{x.endDate ? fmtDate(x.endDate) : <Chip s="active" label="Still enrolled" />}</td><td>{x.endDate ? reasonLabel(x.reason) + (x.note ? ' — ' + x.note : '') : '—'}</td><td>{!x.derived && <Btn className="small" onClick={() => setModal({ stay: x })}>Correct dates…</Btn>}</td></tr>)}</tbody></Table>{e.derived && <p className="hint">To correct this stay's admission date, edit it on the Profile tab.</p>}
      <div className="row mt">{['active', 'inactive'].includes(s.status) && <Btn variant="danger" onClick={() => setModal('leave')}>Record leaving…</Btn>}{s.status === 'left' && <Btn variant="primary" onClick={() => setModal('readmit')}>Re-admit…</Btn>}</div>
      {modal?.stay && <EditStayModal s={s} stay={modal.stay} onClose={() => setModal('')} onDone={() => { setModal(''); onChanged(); }} />}
      {modal === 'leave' && <LeaveModal s={s} onClose={() => setModal('')} onDone={() => { setModal(''); onChanged(); }} />}
      {modal === 'readmit' && <ReadmitModal s={s} onClose={() => setModal('')} onDone={() => { setModal(''); onChanged(); }} />}
    </>
  );
}

function LeaveModal({ s, onClose, onDone }) {
  const [f, set] = useForm({ leavingDate: todayStr(), reason: 'relocated', note: '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const pv = useApi('students.leavePreview', { studentId: s.studentId, leavingDate: f.leavingDate }); const [done, setDone] = useState(null);
  const go = async (ev) => { ev.preventDefault(); setErr(''); try { setDone(await run(() => api('students.leave', { studentId: s.studentId, ...f, confirm: true }), 'Leaving recorded.')); } catch (x) { setErr(x.message); } };
  if (done) return (
    <Modal title="Leaving recorded" onClose={onDone} footer={<Btn variant="primary" onClick={onDone}>Done</Btn>}>
      <p><strong>{s.fullName}</strong> left on {fmtDate(done.leavingDate)}. Login is switched off and batch memberships ended.</p>
      <p>{done.leaveSummary.cancelledFees} later unpaid fee(s) cancelled{done.leaveSummary.cancelledMessages ? '; ' + done.leaveSummary.cancelledMessages + ' waiting reminder(s) removed' : ''}.</p>
      {done.leaveSummary.needsReview.length > 0 && <p className="banner warn">{done.leaveSummary.needsReview.length} fee(s) after the leaving month already have payments ({done.leaveSummary.needsReview.map((x) => x.period).join(', ')}) and were kept. Refund or reallocate them in Fees &amp; Payments.</p>}
      <p>Still owed up to the leaving month: <strong>{money(done.leaveSummary.outstanding)}</strong>. Reminders and the pay link keep working for it.</p>
    </Modal>);
  return (
    <Modal title={'Record leaving — ' + s.fullName} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="danger" busy={busy} type="submit" form="leaveform" disabled={!pv.data}>Confirm leaving</Btn></>}>
      <form id="leaveform" onSubmit={go} className="formgrid">
        <Field label="Leaving date" hint="The day they stopped. Not in the future."><input type="date" value={f.leavingDate} max={todayStr()} min={s.enrolment.stays[s.enrolment.stays.length - 1].startDate} onChange={set('leavingDate')} required /></Field>
        <Field label="Reason"><Select value={f.reason} onChange={set('reason')} options={REASONS} /></Field>
        <Field label="Note (optional)" wide><input value={f.note} onChange={set('note')} maxLength={300} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
      <Async q={pv}>{(p) => (
        <div className="card mt"><p>Billing runs <strong>{p.billedFrom}</strong> to <strong>{p.billedTo}</strong> ({p.months} month{p.months === 1 ? '' : 's'}). Owed up to then: <strong>{money(p.outstanding)}</strong>.</p>
          {p.willCancel.length > 0 && <p>Will be cancelled (unpaid, after the leaving month): {p.willCancel.map((x) => x.period).join(', ')}.</p>}
          {p.needsReview.length > 0 && <p className="banner warn">Kept for your review (already have payments): {p.needsReview.map((x) => x.period + ' (paid ' + money(x.paid) + ')').join(', ')}.</p>}
          <p className="hint">Their login is switched off and batch memberships end. History is never deleted.</p></div>)}</Async>
    </Modal>
  );
}

function ReadmitModal({ s, onClose, onDone }) {
  const [f, set] = useForm({ admissionDate: todayStr(), batchId: '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const go = async (ev) => { ev.preventDefault(); setErr(''); try { await run(() => api('students.readmit', { studentId: s.studentId, admissionDate: f.admissionDate, batchId: f.batchId || undefined }), 'Student re-admitted.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={'Re-admit — ' + s.fullName} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="readmitform">Re-admit</Btn></>}>
      <form id="readmitform" onSubmit={go} className="formgrid">
        <Field label="New admission date" hint="Months between leaving and this date are not billed."><input type="date" value={f.admissionDate} min={s.leavingDate} max={todayStr()} onChange={set('admissionDate')} required /></Field>
        <Field label="Batch (optional)"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Assign later" /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
      <p className="hint">Login is switched back on (the old password still applies; reset it from the Account tab if needed).</p>
    </Modal>
  );
}

function GenerateFees({ s, onClose, onDone }) {
  const [f, set] = useForm({ amountDue: '', dueDay: '10' }); const [run, busy] = useAction(); const [pv, setPv] = useState(null); const [err, setErr] = useState('');
  const amount = Number(f.amountDue);
  useEffect(() => { setPv(null); setErr(''); let off = false; api('fees.generateRange', { studentId: s.studentId, ...(amount > 0 ? { amountDue: amount } : {}), dueDay: Number(f.dueDay), dryRun: true }).then((r) => { if (!off) setPv(r); }).catch((x) => { if (!off) setErr(x.message); }); return () => { off = true; }; }, [f.amountDue, f.dueDay]);
  const go = async () => { try { await run(() => api('fees.generateRange', { studentId: s.studentId, ...(amount > 0 ? { amountDue: amount } : {}), dueDay: Number(f.dueDay) }), (r) => r.created + ' fee(s) created.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={'Generate fees — ' + s.fullName} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!pv || pv.toCreate === 0} onClick={go}>{pv ? 'Create ' + pv.toCreate + ' fee(s)' : 'Create'}</Btn></>}>
      <div className="formgrid"><Field label="Monthly fee (optional)" hint="Leave empty to use the student's own fee, their plan, or the default fee. Plan billing cycle, admission fee and sibling discount apply automatically."><input type="number" min="1" step="0.01" value={f.amountDue} onChange={set('amountDue')} autoFocus /></Field><Field label="Due day of month"><input type="number" min="1" max="28" value={f.dueDay} onChange={set('dueDay')} /></Field></div>
      {err && <p className="ferr" role="alert">{err}</p>}
      {pv && <><p className="hint">Enrolled: {pv.enrolled}. Months already billed are left alone.</p><Table><thead><tr><th>Month</th><th>Due</th><th className="r">Amount</th><th /></tr></thead><tbody>{pv.months.map((m) => <tr key={m.kind + m.period}><td>{m.kind === 'admission' ? 'Admission fee' : (m.label || m.period)}{m.discount > 0 && <div className="small muted">sibling discount −<Money v={m.discount} /></div>}</td><td>{fmtDate(m.dueDate)}</td><td className="r">{m.existing ? '—' : money(m.amount)}</td><td>{m.existing ? <span className="muted small">already billed</span> : <Chip s="pending" label="new" />}</td></tr>)}</tbody></Table><p><strong>Total of new fees: {money(pv.total)}</strong></p></>}
    </Modal>
  );
}

function EditStayModal({ s, stay, onClose, onDone }) {
  const [f, set] = useForm({ startDate: stay.startDate, endDate: stay.endDate || '', reason: stay.reason || 'other', note: stay.note || '', editReason: '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const go = async (ev) => { ev.preventDefault(); setErr(''); const b = { studentId: s.studentId, enrolmentId: stay.enrolmentId, startDate: f.startDate, editReason: f.editReason }; if (stay.endDate) Object.assign(b, { endDate: f.endDate, reason: f.reason, note: f.note }); try { await run(() => api('students.editStay', b), 'Dates corrected.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Correct admission / leaving dates" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="staform">Save</Btn></>}>
      <form id="staform" onSubmit={go} className="formgrid">
        <Field label="Admission date"><input type="date" value={f.startDate} max={todayStr()} onChange={set('startDate')} required /></Field>
        {stay.endDate ? <><Field label="Leaving date"><input type="date" value={f.endDate} max={todayStr()} onChange={set('endDate')} required /></Field><Field label="Reason"><Select value={f.reason} onChange={set('reason')} options={REASONS} /></Field><Field label="Note"><input value={f.note} onChange={set('note')} maxLength={300} /></Field></> : <p className="hint wide">This stay is still open. To end it use “Record leaving”.</p>}
        <Field label="Why are you changing this? (audited)" wide><input value={f.editReason} onChange={set('editReason')} required minLength={3} maxLength={200} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
      <p className="hint">Billing follows these dates. Fees that now fall outside the stay are flagged, not deleted; months now inside it can be generated from the Fees tab.</p>
    </Modal>
  );
}

function LinkDates({ b, onClose, onDone }) {
  const [f, set] = useForm({ startDate: b.startDate, endDate: b.endDate || '' }); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const go = async (ev) => { ev.preventDefault(); setErr(''); const body = { linkId: b.linkId, startDate: f.startDate }; if (b.status !== 'active') body.endDate = f.endDate; try { await run(() => api('students.updateBatchLink', body), 'Dates saved.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={'Batch dates — ' + b.name} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="lnkform">Save</Btn></>}>
      <form id="lnkform" onSubmit={go} className="formgrid"><Field label="Joined the batch"><input type="date" value={f.startDate} max={todayStr()} onChange={set('startDate')} required /></Field>{b.status !== 'active' && <Field label="Left the batch"><input type="date" value={f.endDate} onChange={set('endDate')} required /></Field>}{err && <p className="ferr wide" role="alert">{err}</p>}</form>
    </Modal>
  );
}
