import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Chip, Empty, Field, Money, Page, Select, Table, useAction, useApi, useUi } from '../../ui.jsx';
import { PAY_METHODS, WEEKDAYS, fmtDate, fmtDateTime, newKey, payLabel, todayStr } from '../../util.js';
import { PdfActions } from '../teacher/pdfactions.jsx';
import ChangePassword from '../ChangePassword.jsx';

const NAV = [['home', 'Home', '⌂'], ['timetable', 'Timetable', '◷'], ['attendance', 'Attendance', '✔'], ['homework', 'Homework', '✐'], ['results', 'Results', '✎'], ['fees', 'Fees', '₹'], ['documents', 'Receipts & documents', '▤'], ['notices', 'Notices', '✉'], ['profile', 'My profile', '☺']];

export default function StudentApp({ user, environment, centreName, logout, route }) {
  const [open, setOpen] = useState(false); const key = route[0] || 'home';
  useEffect(() => setOpen(false), [key]);
  useEffect(() => { document.title = (NAV.find((n) => n[0] === key)?.[1] || 'Portal') + ' · ' + (centreName || 'TuitionDesk'); }, [key, centreName]);
  const Screen = { home: Home, timetable: Timetable, attendance: Attendance, homework: Homework, results: Results, fees: Fees, documents: Documents, notices: Notices, profile: Profile }[key];
  return (
    <div className="shell">
      {environment !== 'production' && <div className="envbar" role="note">TEST ENVIRONMENT ({environment}) — not live data</div>}
      <header className="topbar"><button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button><span className="title">{centreName || 'TuitionDesk'}</span><span className="who">{user.displayName}</span><button className="btn small" onClick={logout}>Sign out</button></header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={'nav' + (open ? ' open' : '')} aria-label="Main"><div className="brand">{centreName || 'TuitionDesk'}</div>
        {NAV.map(([k, l, ic]) => <a key={k} href={'#/' + k} className={key === k ? 'on' : ''} aria-current={key === k ? 'page' : undefined}><span aria-hidden="true">{ic}</span>{l}</a>)}</nav>
      <main className="main">{Screen ? <Screen user={user} /> : <Page title="Not found"><p><a href="#/home">Go home</a></p></Page>}</main>
    </div>
  );
}

function Home() {
  const q = useApi('my.home', {});
  return (
    <Page title="Home">
      <Async q={q}>{(d) => (
        <>
          <h2 style={{ marginTop: 0 }}>Hello, {d.profile.fullName}</h2>
          <div className="grid g3">
            <div className="stat"><div className="l">Attendance (last 30 days)</div><div className="v">{d.attendance.percentage === null ? '—' : d.attendance.percentage + '%'}</div><div className="l">{d.attendance.counts.P} present · {d.attendance.counts.A} absent</div></div>
            <div className="stat"><div className="l">Fee balance</div><div className="v"><Money v={d.fees.balance} /></div><div className="l">{d.fees.overdue > 0 ? <Chip s="overdue" label={'overdue ' + d.fees.overdue} /> : 'Nothing overdue'}{d.fees.credit > 0 && ' · credit ₹' + d.fees.credit}</div></div>
            <div className="stat"><div className="l">Homework due</div><div className="v">{d.homeworkDue.length}</div><a href="#/homework">View</a></div>
          </div>
          <Card title="Upcoming classes">{d.upcomingClasses.length === 0 ? <p className="muted">No classes scheduled.</p> : <ul>{d.upcomingClasses.map((c, i) => <li key={i}>{fmtDate(c.date)} {c.startTime}–{c.endTime} · {c.subject || c.batchName} {c.type === 'cancelled' && <Chip s="cancelled" label="cancelled" />}{c.type === 'extra' && <Chip s="extra" label="extra class" />}</li>)}</ul>}</Card>
          <Card title="Latest notices">{d.notices.length === 0 ? <p className="muted">No notices.</p> : d.notices.map((n) => <div key={n.noticeId}><strong>{n.title}</strong><p className="small">{n.body}</p></div>)}</Card>
          <Card title="Latest results">{d.results.length === 0 ? <p className="muted">No published results yet.</p> : <ul>{d.results.map((r) => <li key={r.testId}>{r.title}: {r.resultStatus === 'entered' ? r.marks + ' / ' + r.maxMarks : r.resultStatus.replace(/_/g, ' ')}</li>)}</ul>}</Card>
        </>)}</Async>
    </Page>
  );
}
function Timetable() {
  const q = useApi('my.timetable', {});
  return (
    <Page title="Timetable"><Async q={q}>{(d) => (
      <>
        <Card title="Next 14 days">{d.upcoming.length === 0 ? <Empty title="No classes in the next two weeks" /> : <Table><thead><tr><th>Date</th><th>Time</th><th>Class</th></tr></thead><tbody>{d.upcoming.map((c, i) => <tr key={i}><td>{fmtDate(c.date)}</td><td>{c.startTime ? c.startTime + '–' + c.endTime : 'All day'}</td><td>{c.subject || c.batchName}{c.room ? ' · ' + c.room : ''} {c.type === 'cancelled' || c.type === 'cancellation' ? <Chip s="cancelled" label="cancelled" /> : c.type === 'extra' ? <Chip s="extra" label="extra class" /> : null}{c.note && <div className="small muted">{c.note}</div>}</td></tr>)}</tbody></Table>}</Card>
        <Card title="Weekly schedule">{d.weekly.length === 0 ? <p className="muted">No weekly schedule.</p> : <Table><thead><tr><th>Day</th><th>Time</th><th>Class</th></tr></thead><tbody>{d.weekly.map((c) => <tr key={c.scheduleId}><td>{WEEKDAYS[c.weekday]}</td><td>{c.startTime}–{c.endTime}</td><td>{c.subject || c.batchName}{c.room ? ' · ' + c.room : ''}</td></tr>)}</tbody></Table>}</Card>
      </>)}</Async></Page>
  );
}
function Attendance() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const q = useApi('my.attendance', { from, to });
  return (
    <Page title="Attendance">
      <div className="row"><Field label="From"><input type="date" value={from} max={todayStr()} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} max={todayStr()} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <Async q={q}>{(d) => (
        <>
          <div className="grid g3"><div className="stat"><div className="l">Attendance</div><div className="v">{d.percentage === null ? '—' : d.percentage + '%'}</div></div><div className="stat"><div className="l">Present / Absent / Holiday</div><div className="v">{d.counts.P} / {d.counts.A} / {d.counts.H}</div></div></div>
          <p className="hint">{d.policy}</p>
          {d.records.length === 0 ? <Empty title="No attendance recorded for this period" /> : <Table><thead><tr><th>Date</th><th>Batch</th><th>Status</th></tr></thead><tbody>{d.records.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.batchName} <span className="muted small">{r.sessionLabel}</span></td><td><Chip s={{ P: 'present', A: 'absent', H: 'holiday' }[r.status]} />{r.corrected && <span className="small muted"> corrected</span>}</td></tr>)}</tbody></Table>}
        </>)}</Async>
    </Page>
  );
}
function Homework() {
  const q = useApi('my.homework', {}); const today = todayStr();
  return <Page title="Homework"><Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No homework" hint="Nothing has been assigned to you." /> : d.items.map((h) => (
    <Card key={h.homeworkId} title={h.title} actions={<Chip s={h.dueDate < today ? 'overdue' : 'pending'} label={(h.dueDate < today ? 'was due ' : 'due ') + fmtDate(h.dueDate)} />}>
      <p className="small muted">{h.subject} · {h.audience} · assigned {fmtDate(h.assignedDate)}</p>{h.instructions && <p style={{ whiteSpace: 'pre-wrap' }}>{h.instructions}</p>}{h.resourceUrl && <a href={h.resourceUrl} target="_blank" rel="noopener noreferrer">Open resource ↗</a>}</Card>))}</Async></Page>;
}
function Results() {
  const q = useApi('my.results', {});
  return <Page title="Results"><Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No published results yet" /> : <Table><thead><tr><th>Test</th><th>Date</th><th className="right">Marks</th><th className="right">%</th><th>Remarks</th></tr></thead><tbody>{d.items.map((r) => <tr key={r.testId}><td><strong>{r.title}</strong><div className="small muted">{r.subject}</div></td><td>{fmtDate(r.testDate)}</td><td className="right">{r.resultStatus === 'entered' ? r.marks + ' / ' + r.maxMarks : <Chip s={r.resultStatus === 'absent' ? 'absent' : r.resultStatus === 'exempt' ? 'exempt' : 'not_entered'} label={r.resultStatus.replace(/_/g, ' ')} />}</td><td className="right">{r.percentage ?? '—'}</td><td>{r.comment}</td></tr>)}</tbody></Table>}</Async></Page>;
}
function Fees() {
  const q = useApi('my.fees', {}); const [report, setReport] = useState(false);
  return (
    <Page title="Fees" actions={<Btn variant="primary" onClick={() => setReport(true)}>I have paid — tell my teacher</Btn>}>
      <Async q={q}>{(d) => (
        <>
          <div className="grid g3"><div className="stat"><div className="l">Balance</div><div className="v"><Money v={d.totals.balance} /></div></div><div className="stat"><div className="l">Overdue</div><div className="v"><Money v={d.totals.overdue} /></div></div><div className="stat"><div className="l">Credit on account</div><div className="v"><Money v={d.creditOnAccount} /></div></div></div>
          {(d.paymentInfo.upi_id || d.paymentInfo.payment_instructions) && <Card title="How to pay">{d.paymentInfo.upi_id && <p>UPI: <strong style={{ userSelect: 'all' }}>{d.paymentInfo.upi_id}</strong>{d.paymentInfo.upi_payee_name && ' (' + d.paymentInfo.upi_payee_name + ')'}</p>}{d.paymentInfo.payment_instructions && <p>{d.paymentInfo.payment_instructions}</p>}<p className="hint">A payment counts only after your teacher has verified it.</p></Card>}
          <Card title="Fee obligations">{d.fees.length === 0 ? <p className="muted">No fees yet.</p> : <Table><thead><tr><th>Period</th><th>Due</th><th className="right">Amount</th><th className="right">Paid</th><th className="right">Balance</th><th>Status</th></tr></thead><tbody>{d.fees.map((f) => <tr key={f.feeId}><td>{f.billingPeriod}</td><td>{fmtDate(f.dueDate)}</td><td className="right"><Money v={f.netDue} /></td><td className="right"><Money v={f.paid} /></td><td className="right"><Money v={f.balance} /></td><td><Chip s={f.status} /></td></tr>)}</tbody></Table>}</Card>
          <Card title="Payments">{d.payments.length === 0 ? <p className="muted">No payments.</p> : <Table><thead><tr><th>Date</th><th>Method</th><th className="right">Amount</th><th>Status</th></tr></thead><tbody>{d.payments.map((p) => <tr key={p.paymentId}><td>{fmtDate(p.receivedAt)}</td><td>{payLabel(p.method)}{p.kind === 'refund' && ' (refund)'}</td><td className="right"><Money v={p.amount} /></td><td><Chip s={p.status} /><div className="small muted">{p.statusLabel}</div></td></tr>)}</tbody></Table>}</Card>
          {report && <Report onClose={() => setReport(false)} onDone={() => { setReport(false); q.reload(); }} />}
        </>)}</Async>
    </Page>
  );
}
function Report({ onClose, onDone }) {
  const [run, busy] = useAction(); const [key] = useState(newKey); const [f, setF] = useState({ amount: '', method: 'upi', providerReference: '', receivedAt: todayStr(), notes: '' }); const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api('my.reportPayment', { ...f, amount: Number(f.amount), idempotencyKey: key }), 'Sent to your teacher. It will count once they verify it.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <div className="overlay"><div className="modal" role="dialog" aria-modal="true" aria-label="Report a payment"><header><h2>Report a payment</h2><button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button></header>
      <form className="modal-body formgrid" onSubmit={go}><p className="banner wide">This does <strong>not</strong> reduce your balance. Your teacher checks it against their records and then verifies it; you will get a receipt.</p>
        <Field label="Amount paid (₹)"><input type="number" step="0.01" min="1" value={f.amount} onChange={set('amount')} required /></Field><Field label="Method"><Select value={f.method} onChange={set('method')} options={PAY_METHODS} /></Field>
        <Field label="UPI / transaction reference" hint="Helps your teacher find it"><input value={f.providerReference} onChange={set('providerReference')} maxLength={60} /></Field><Field label="Date paid"><input type="date" max={todayStr()} value={f.receivedAt} onChange={set('receivedAt')} /></Field>
        <Field label="Note" wide><input value={f.notes} onChange={set('notes')} maxLength={300} /></Field>{err && <p className="ferr wide" role="alert">{err}</p>}
        <div className="row wide"><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit">Send to teacher</Btn></div></form></div></div>
  );
}
function Documents() {
  const r = useApi('my.receipts', {}); const d = useApi('my.documents', {});
  return (
    <Page title="Receipts & documents">
      <Card title="Receipts"><Async q={r}>{(x) => x.items.length === 0 ? <p className="muted">No receipts yet. A receipt is issued when your teacher verifies a payment.</p> : <Table><thead><tr><th>Receipt</th><th>Date</th><th className="right">Amount</th><th /></tr></thead><tbody>{x.items.map((i) => <tr key={i.verificationId}><td>{i.receiptNumber}</td><td>{fmtDateTime(i.issuedAt)}</td><td className="right"><Money v={i.amount} /></td><td><PdfActions verificationId={i.verificationId} fetchAction="my.document" teacher={false} label="receipt" /></td></tr>)}</tbody></Table>}</Async></Card>
      <Card title="Other documents"><Async q={d}>{(x) => x.items.length === 0 ? <p className="muted">No documents have been issued to you.</p> : <Table><thead><tr><th>Document</th><th>Issued</th><th /></tr></thead><tbody>{x.items.map((i) => <tr key={i.verificationId}><td>{i.docTypeLabel}<div className="small muted">{i.documentNumber}</div></td><td>{fmtDateTime(i.issuedAt)}</td><td><PdfActions verificationId={i.verificationId} fetchAction="my.document" teacher={false} label="PDF" /></td></tr>)}</tbody></Table>}</Async></Card>
    </Page>
  );
}
function Notices() {
  const q = useApi('my.notices', {});
  return <Page title="Notices"><Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No notices" /> : d.items.map((n) => <Card key={n.noticeId} title={n.title}><p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p><p className="small muted">{fmtDate(n.publishedAt)}</p></Card>)}</Async></Page>;
}
function Profile() {
  const q = useApi('my.profile', {});
  return (
    <Page title="My profile"><Async q={q}>{(p) => (
      <><Card title={p.fullName}><dl className="kv"><dt>Student ID</dt><dd>{p.studentId}</dd><dt>Guardian</dt><dd>{p.guardianName || '—'}</dd><dt>Admission date</dt><dd>{fmtDate(p.admissionDate)}</dd><dt>Batches</dt><dd>{p.batches.map((b) => b.name).join(', ') || '—'}</dd></dl><p className="hint">To change these details, please ask your teacher.</p></Card>
        <Card title="Change password"><ChangePassword /></Card></>)}</Async></Page>
  );
}
