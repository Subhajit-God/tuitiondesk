import React, { useState } from 'react';
import { Async, Btn, Card, Chip, Empty, Field, Money, Page, Table, useApi } from '../../ui.jsx';
import { asText, fmtDate, fmtDateTime, money, monthStartStr, todayStr, WEEKDAYS, payLabel } from '../../util.js';
import { Def } from './bshared.jsx';

function Bars({ data, valueKey, label, fmt }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d[valueKey])));
  const w = 100 / data.length;
  return (
    <svg className="bchart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={label}>
      {data.map((d, i) => { const h = (Math.abs(d[valueKey]) / max) * 40; return <g key={d.month}><rect x={i * w + w * 0.15} y={46 - h} width={w * 0.7} height={h} fill="var(--brand-2)"><title>{d.month}: {fmt(d[valueKey])}</title></rect><text x={i * w + w / 2} y={57} fontSize="5" textAnchor="middle" fill="currentColor">{d.month.slice(5)}</text></g>; })}
    </svg>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState({ from: monthStartStr(), to: todayStr() });
  const [draft, setDraft] = useState(range);
  const q = useApi('dashboard.get', range);
  return (
    <Page title="Dashboard" actions={<Btn onClick={q.reload}>Refresh</Btn>}>
      <Card title="Date range">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (draft.from && draft.to) setRange(draft); }}>
          <Field label="From"><input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field>
          <Btn variant="primary" type="submit">Apply</Btn>
        </form>
        <p className="hint">Collections and enrolment counts use this range; outstanding balances are as of today.</p>
      </Card>
      <Async q={q}>{(d) => <Body d={d} />}</Async>
    </Page>
  );
}

function Body({ d }) {
  const def = d.definitions;
  const fresh = d.students.total === 0 && d.batches.active === 0;
  return (
    <>
      {fresh && (
        <Card title="Getting started">
          <p>Your database is empty. Set things up in this order:</p>
          <ol className="bchecklist">
            <li><a href="#/settings">Set the centre name and details in Settings</a> (needed for official documents).</li>
            <li><a href="#/batches">Add a batch</a> (a class group with its subject and schedule).</li>
            <li><a href="#/students">Add your first student</a> and assign a batch — a login is created automatically.</li>
            <li><a href="#/fees">Create fee entries</a>, then record and verify payments.</li>
            <li><a href="#/attendance">Take attendance</a> and <a href="#/tests">create tests</a> as classes run.</li>
          </ol>
        </Card>
      )}
      <div className="grid g4">
        <div className="stat"><div className="l">Net collected <Def text={def.collections} /></div><div className="v"><Money v={d.collections.net} /></div><div className="d">Gross {money(d.collections.gross)} · refunds {money(d.collections.refunds)}</div><div className="d">{fmtDate(d.range.from)} – {fmtDate(d.range.to)}</div></div>
        <div className="stat"><div className="l">Outstanding <Def text={def.outstanding} /></div><div className="v"><Money v={d.outstanding.total} /></div><div className="d">as of today</div></div>
        <div className="stat"><div className="l">Overdue <Def text={def.overdue} /></div><div className="v"><Money v={d.outstanding.overdue} /></div><div className="d">{d.outstanding.overdueStudents} student(s)</div></div>
        <div className="stat"><div className="l">Awaiting verification <Def text="Payments recorded or reported but not yet verified by you. They are NOT counted as collected." /></div><div className="v">{d.pendingVerification.count}</div><div className="d">{money(d.pendingVerification.amount)} · <a href="#/fees">review in Fees</a></div></div>
        <div className="stat"><div className="l">Active students <Def text="Students with status Active (not inactive or archived)." /></div><div className="v">{d.students.active}</div><div className="d">{d.students.total} on record</div></div>
        <div className="stat"><div className="l">Active batches <Def text="Batches with status Active. Occupancy = active members ÷ configured capacity (shown only when a capacity is set)." /></div><div className="v">{d.batches.active}</div></div>
        <div className="stat"><div className="l">New enquiries <Def text="Enquiries dated within the selected range." /></div><div className="v">{d.enquiries.newInRange}</div><div className="d">{d.enquiries.conversionsInRange} admission(s) in range</div></div>
        <div className="stat"><div className="l">Ledger check <Def text="Automatic reconciliation: every allocation, receipt and balance agrees with the underlying payment and fee records." /></div><div className="v"><Chip s={d.reconciliation.ok ? 'valid' : 'failed'} label={d.reconciliation.ok ? 'Reconciled' : 'Mismatch'} /></div>{!d.reconciliation.ok && <div className="d"><a href="#/audit">See details</a></div>}</div>
      </div>

      <div className="grid g2 mt">
        <Card title="Batch occupancy">
          {d.batches.occupancy.length === 0 ? <Empty title="No active batches" hint="Add a batch to see occupancy."><a className="btn" href="#/batches">Add a batch</a></Empty> :
            d.batches.occupancy.map((b) => (
              <div key={b.batchId} style={{ marginBottom: '.6rem' }}>
                <div className="row" style={{ marginBottom: 0 }}><strong style={{ flex: '1 1 auto' }}>{b.name}</strong><span className="small muted" style={{ flex: '0 0 auto' }}>{b.members}{b.capacity > 0 ? ' / ' + b.capacity : ' students (no capacity set)'}</span></div>
                {b.percent !== null && <div className="bar" role="img" aria-label={b.name + ' ' + b.percent + '% full'}><i style={{ width: Math.min(100, b.percent) + '%' }} /></div>}
              </div>))}
        </Card>
        <Card title="Recent verified payments">
          {d.recentPayments.length === 0 ? <Empty title="No verified payments yet" hint="Payments appear here after you verify them." /> :
            <Table><thead><tr><th>Student</th><th className="r">Amount</th><th>Method</th><th>Verified</th></tr></thead><tbody>{d.recentPayments.map((p) => <tr key={p.paymentId}><td>{p.studentName}</td><td className="r"><Money v={p.amount} /></td><td>{payLabel(p.method)}</td><td>{fmtDateTime(p.verifiedAt)}</td></tr>)}</tbody></Table>}
        </Card>
        <Card title="Upcoming classes (7 days)">
          {d.upcomingClasses.length === 0 ? <Empty title="No classes scheduled" hint="Add schedule entries in Timetable."><a className="btn" href="#/timetable">Open Timetable</a></Empty> :
            <Table><thead><tr><th>Date</th><th>Time</th><th>Batch</th><th>Status</th></tr></thead><tbody>{d.upcomingClasses.map((c, i) => <tr key={i}><td>{fmtDate(c.date)}</td><td>{c.startTime}–{c.endTime}</td><td>{c.batchName}{c.subject ? ' · ' + c.subject : ''}</td><td><Chip s={c.type === 'cancelled' ? 'cancelled' : c.type} label={c.type === 'cancelled' ? 'Cancelled' : c.type === 'extra' ? 'Extra class' : 'Scheduled'} /></td></tr>)}</tbody></Table>}
        </Card>
        <Card title={<>Attendance exceptions <Def text={def.attendanceExceptions} /></>}>
          {d.attendanceExceptions.length === 0 ? <Empty title="No exceptions" hint="No student has reached the absence threshold in the last 14 days." /> :
            <Table><thead><tr><th>Student</th><th className="r">Absences</th></tr></thead><tbody>{d.attendanceExceptions.map((s) => <tr key={s.studentId}><td>{s.fullName} <span className="muted small">{s.studentId}</span></td><td className="r">{s.absences}</td></tr>)}</tbody></Table>}
        </Card>
        <Card title="Recent enquiries" actions={<a className="btn small" href="#/enquiries">All enquiries</a>}>
          {d.enquiries.recent.length === 0 ? <Empty title="No enquiries yet" hint="Record enquiries to track follow-ups and admissions."><a className="btn" href="#/enquiries">Add an enquiry</a></Empty> :
            <Table><thead><tr><th>Name</th><th>Date</th><th>Status</th></tr></thead><tbody>{d.enquiries.recent.map((e) => <tr key={e.enquiryId}><td>{e.name}</td><td>{fmtDate(e.enquiryDate)}</td><td><Chip s={e.status} /></td></tr>)}</tbody></Table>}
        </Card>
        <Card title="Needs attention" actions={<a className="btn small" href="#/notices">Notifications</a>}>
          <dl className="kv"><dt>Failed</dt><dd>{d.notifications.failed}</dd><dt>Outcome unknown</dt><dd>{d.notifications.unknown}</dd><dt>Waiting for manual send</dt><dd>{d.notifications.pendingManual}</dd></dl>
          {d.notifications.jobFailures.length > 0 && <><h3>Recent scheduled-job failures</h3><ul>{d.notifications.jobFailures.map((j, i) => <li key={i}><strong>{j.job}</strong> · {fmtDateTime(j.at)}<div className="small muted">{asText(j.details)}</div></li>)}</ul></>}
          {!d.notifications.failed && !d.notifications.unknown && !d.notifications.pendingManual && !d.notifications.jobFailures.length && <p className="muted small">Nothing needs attention.</p>}
        </Card>
      </div>

      <Card title={<>Trends (last 6 months) <Def text={def.trends} /></>}>
        {d.trends.sufficient ? (
          <div className="grid g2">
            <div><h3>Net collections</h3><Bars data={d.trends.collections} valueKey="net" label="Net collections by month" fmt={(v) => money(v)} /></div>
            <div><h3>New students by admission month</h3><Bars data={d.trends.enrolments} valueKey="count" label="Admissions by month" fmt={(v) => v + ' students'} /></div>
          </div>
        ) : <p className="muted">Trends appear once at least two months have data. Nothing is estimated or invented in the meantime.</p>}
      </Card>
    </>
  );
}
