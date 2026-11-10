import React, { useState } from 'react';
import Batches from './Batches.jsx';
import { Async, Btn, Card, Chip, Empty, Money, Page, Tabs, useApi } from '../../ui.jsx';
import { fmtDate, payLabel } from '../../util.js';

const Link = ({ to, children }) => <a className="btn small" href={'#/' + to}>{children}</a>;
const wa = (p) => (p ? 'https://wa.me/' + p : '');

/** The Teacher's morning screen: what needs doing today, in one place. Read-only; every row links to where it is done. */
export default function Today() {
  const [tab, setTab] = useState('today');
  return (
    <Page title="Today">
      <Tabs value={tab} onChange={setTab} tabs={[['today', 'Today'], ['batches', 'Batches']]} />
      {tab === 'today' ? <TodayTab /> : <Batches embedded />}
    </Page>
  );
}

function TodayTab() {
  const q = useApi('today.get', {});
  return (
    <>
      <div className="row"><Btn onClick={q.reload}>Refresh</Btn></div>
      <Async q={q}>{(d) => {
        const c = d.counts, nothing = !c.classesNotMarked && !c.absentees && !c.verifications && !c.messages && !c.calls && !c.enquiries;
        return (
          <>
            <p className="muted">{fmtDate(d.date)} · {d.centreName}</p>
            {nothing && <p className="banner" role="status">✓ Nothing needs your attention right now.</p>}
            <div className="grid2">
              <Card title={`Today’s classes (${c.classes})`} actions={<Link to="attendance">Mark attendance</Link>}>
                {d.classes.length === 0 ? <p className="muted">No classes scheduled today.</p> : (
                  <ul className="plain">{d.classes.map((k, i) => (
                    <li key={i}><strong>{k.startTime}–{k.endTime}</strong> {k.batchName}{k.subject ? ' · ' + k.subject : ''}{k.room ? ' · ' + k.room : ''}{' '}
                      {k.type === 'cancelled' || k.type === 'cancellation' ? <Chip s="cancelled" label="Cancelled" /> : k.attendanceTaken ? <Chip s="confirmed" label={`Marked · ${k.counts.P} present, ${k.counts.A} absent`} /> : <Chip s="pending" label="Attendance not marked" />}</li>))}</ul>)}
              </Card>
              <Card title={`Absent today (${c.absentees})`}>
                {d.absentees.length === 0 ? <p className="muted">No absentees recorded yet today.</p> : (
                  <ul className="plain">{d.absentees.map((a) => (
                    <li key={a.studentId + a.batchName}><strong>{a.studentName}</strong> <span className="muted">{a.batchName}</span>{' '}
                      {a.message === 'sent' ? <Chip s="confirmed" label="Guardian told" /> : a.message === 'waiting' ? <a href="#/notices" className="chip pending">Message ready to send →</a> : <Chip s="muted" label="No message" />}</li>))}</ul>)}
              </Card>
              <Card title={`To verify (${c.verifications})`} actions={<Link to="fees">Fees & Payments</Link>}>
                {c.verifications === 0 ? <p className="muted">Nothing waiting for verification.</p> : <ul className="plain">
                  {d.pendingVerifications.map((p) => <li key={p.paymentId}><strong>{p.studentName}</strong> · <Money v={p.amount} /> · {payLabel(p.method)}{p.reference ? ' · ' + p.reference : ''} <Chip s="pending" label="Check your bank, then verify" /></li>)}
                  {d.parentsSaidPaid.map((r) => <li key={r.studentId}><strong>{r.studentName}</strong> said “I have paid”{r.reference ? ' (ref ' + r.reference + ')' : ''} <span className="muted">— check your bank, then record the payment</span></li>)}</ul>}
              </Card>
              <Card title={`Messages to send (${c.messages})`} actions={<Link to="notices">Open queue</Link>}>
                <p>{c.messages === 0 ? 'No messages are waiting.' : `${c.messages} message(s) are ready for you to send from your WhatsApp.`}{d.messagesWaiting.heldCount ? ` ${d.messagesWaiting.heldCount} held for quiet hours.` : ''}</p>
              </Card>
              <Card title={`Who to call (${c.calls})`}>
                {d.needsCall.length === 0 ? <p className="muted">No family needs a phone call today.</p> : <ul className="plain">{d.needsCall.map((n) => (
                  <li key={n.studentId}><strong>{n.studentName}</strong> · <Money v={n.amount} /> pending<div className="small muted">{n.note}</div>{n.guardianPhone && <a className="btn small" href={'tel:+' + n.guardianPhone}>Call +{n.guardianPhone}</a>}</li>))}</ul>}
              </Card>
              <Card title={`Enquiries to follow up (${c.enquiries})`} actions={<Link to="enquiries">Enquiries</Link>}>
                {d.enquiriesDue.length === 0 ? <p className="muted">No enquiry follow-ups due.</p> : <ul className="plain">{d.enquiriesDue.map((e) => (
                  <li key={e.enquiryId}><strong>{e.name}</strong>{e.requestedSubject ? ' · ' + e.requestedSubject : ''} <span className="muted">— {e.reason}{e.overdueDays > 0 ? `, ${e.overdueDays} day(s) ago` : ''}{e.nextAction ? ': ' + e.nextAction : ''}</span>{' '}
                    {e.phone && <a className="btn small" href={'tel:+' + e.phone}>Call</a>} {e.waLink && <a className="btn small" href={e.waLink} target="_blank" rel="noreferrer">WhatsApp</a>}</li>))}</ul>}
              </Card>
            </div>
            {d.backup.warnings.length > 0 && <Card title="Backups">{d.backup.warnings.map((w) => <p key={w.code} className={'banner ' + (w.level === 'error' ? 'bad' : 'warn')}>{w.message} <a href="#/audit">Open backups</a></p>)}</Card>}
          </>);
      }}</Async>
    </>
  );
}
