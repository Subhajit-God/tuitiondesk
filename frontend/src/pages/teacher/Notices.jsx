import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, SearchBar, Select, StudentSelect, Table, Tabs, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { asText, fmtDate, fmtDateTime } from '../../util.js';

export default function Notices() {
  const [tab, setTab] = useState('notices');
  return <Page title="Notices & Notifications"><Tabs value={tab} onChange={setTab} tabs={[['notices', 'Notices'], ['queue', 'Messages to send'], ['ladder', 'Fee reminder ladder'], ['jobs', 'Scheduled jobs']]} />{tab === 'notices' ? <NoticeList /> : tab === 'queue' ? <Queue /> : tab === 'ladder' ? <LadderTab goQueue={() => setTab('queue')} /> : <Jobs />}</Page>;
}

function NoticeList() {
  const [page, setPage] = useState(1); const q = useApi('notices.list', { page, pageSize: 20 }); const [edit, setEdit] = useState(null); const ui = useUi();
  const setStatus = async (n, status) => {
    const pub = status === 'published';
    const r = await ui.confirm({ title: pub ? 'Publish notice' : status === 'archived' ? 'Archive notice' : 'Unpublish notice', message: pub ? 'Students in the audience will see this notice. Messages for the guardians are prepared in “Messages to send” — you send them yourself from your WhatsApp.' : 'This hides the notice from students.', confirmLabel: pub ? 'Publish' : 'Confirm' });
    if (!r) return;
    try { const out = await api('notices.setStatus', { noticeId: n.noticeId, status, notifyGuardians: false }); ui.ok('Notice ' + status + '.'); q.reload(); return out; } catch (e) { ui.err(e); }
  };
  return (
    <>
      <div className="row"><Btn variant="primary" onClick={() => setEdit({})}>+ New notice</Btn></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No notices" hint="Notices appear on student screens once published." /> : (
        <><Table><thead><tr><th>Title</th><th>Audience</th><th>Published</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((n) => <tr key={n.noticeId}><td><strong>{n.title}</strong><div className="small muted">{n.body.slice(0, 90)}{n.body.length > 90 ? '…' : ''}</div></td><td>{n.audienceType === 'all' ? 'All students' : n.audienceType === 'batch' ? n.batchName : n.studentName}</td><td>{fmtDate(n.publishedAt)}</td><td><Chip s={n.status} /></td>
            <td style={{ whiteSpace: 'nowrap' }}><Btn className="small" onClick={() => setEdit(n)}>Edit</Btn> {n.status !== 'published' ? <Btn className="small" onClick={() => setStatus(n, 'published')}>Publish</Btn> : <Btn className="small" onClick={() => setStatus(n, 'draft')}>Unpublish</Btn>} {n.status !== 'archived' && <Btn className="small" onClick={() => setStatus(n, 'archived')}>Archive</Btn>}</td></tr>)}
        </tbody></Table><Pager data={d} onPage={setPage} /></>)}</Async>
      {edit && <NoticeForm n={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />}
    </>
  );
}
function NoticeForm({ n, onClose, onSaved }) {
  const isNew = !n.noticeId; const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [f, set] = useForm({ title: n.title || '', body: n.body || '', audienceType: n.audienceType || 'all', batchId: n.batchId || '', studentId: n.studentId || '', status: 'draft' });
  const submit = async (e) => { e.preventDefault(); setErr('');
    if (f.audienceType === 'batch' && !f.batchId) return setErr('Choose a batch.'); if (f.audienceType === 'student' && !f.studentId) return setErr('Choose a student.');
    try { await run(() => api(isNew ? 'notices.create' : 'notices.update', isNew ? f : { noticeId: n.noticeId, title: f.title, body: f.body, audienceType: f.audienceType, batchId: f.batchId, studentId: f.studentId }), 'Notice saved.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={isNew ? 'New notice' : 'Edit notice'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="noticeform">Save</Btn></>}>
      <form id="noticeform" onSubmit={submit} className="formgrid">
        <Field label="Title" wide><input value={f.title} onChange={set('title')} required maxLength={120} /></Field><Field label="Message" wide><textarea rows={5} value={f.body} onChange={set('body')} required maxLength={2000} /></Field>
        <Field label="Audience"><Select value={f.audienceType} onChange={set('audienceType')} options={[['all', 'All students'], ['batch', 'One batch'], ['student', 'One student']]} /></Field>
        {f.audienceType === 'batch' && <Field label="Batch"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Choose" /></Field>}{f.audienceType === 'student' && <Field label="Student"><StudentSelect value={f.studentId} onChange={set('studentId')} /></Field>}
        {isNew && <Field label="Visibility"><Select value={f.status} onChange={set('status')} options={[['draft', 'Save as draft'], ['published', 'Publish now']]} /></Field>}
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}

/* ───────── notification queue ───────── */
const NOTE = { queued: 'Waiting to be sent', sending: 'Being sent', pending_manual: 'Waiting for you to send it', manually_sent: 'You said you sent it (WhatsApp does not confirm delivery to us)', skipped: 'Skipped', cancelled: 'Cancelled' };
function Queue() {
  const [f, setF] = useState({ status: '', search: '', page: 1 }); const q = useApi('notifications.list', { ...f, pageSize: 25 }); const ui = useUi(); const [flow, setFlow] = useState(false);
  const act = async (a, n, extra = {}, msg) => { try { await api(a, { notificationId: n.notificationId, ...extra }); ui.ok(msg); q.reload(); } catch (e) { if (e.code === 'NEEDS_CONFIRMATION' && a === 'notifications.retry') { if (await ui.confirm({ title: 'Possible duplicate', message: e.message, confirmLabel: 'Retry anyway', danger: true })) return act(a, n, { confirmDuplicateRisk: true }, msg); } else ui.err(e); } };
  const wa = (n) => 'https://wa.me/' + String(n.recipient).replace(/\D/g, '') + '?text=' + encodeURIComponent(n.message);
  return (
    <>
      <div className="row"><Field label="Search"><SearchBar value={f.search} onChange={(v) => setF((x) => ({ ...x, search: v, page: 1 }))} placeholder="Student or text" /></Field><Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} placeholder="All" options={Object.keys(NOTE).map((k) => [k, k.replace(/_/g, ' ')])} /></Field></div>
      <Async q={q}>{(d) => (
        <>
          <div className="row"><p className="banner" style={{ flex: 1 }}>Nothing is sent automatically. Each message opens in your own WhatsApp; after sending it, press “I sent it”. “Sent” is your confirmation — WhatsApp does not tell this app whether the message was delivered or read.</p><Btn variant="primary" onClick={() => setFlow(true)}>Send one by one…</Btn></div>
          {d.items.length === 0 ? <Empty title="No notifications" /> : (
            <><Table><thead><tr><th>Created</th><th>Student / recipient</th><th>Message</th><th>Status</th><th /></tr></thead><tbody>
              {d.items.map((n) => <tr key={n.notificationId}><td className="small">{fmtDateTime(n.createdAt)}<div className="muted">{n.trigger.replace(/_/g, ' ')}</div></td><td>{n.studentName || '—'}<div className="small muted">+{n.recipient}</div></td><td style={{ maxWidth: 320 }}><span className="small">{n.message}</span></td>
                <td><Chip s={n.status} />{n.held && <div className="small"><strong>Held for quiet hours</strong> — best after {new Date(n.notBefore).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}<div className="small muted">{NOTE[n.status]}{n.statusReason ? ' — ' + n.statusReason : ''}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>{['pending_manual'].includes(n.status) && <a className="btn small" href={wa(n)} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>} {['pending_manual'].includes(n.status) && <Btn className="small" onClick={() => act('notifications.markSent', n, {}, 'Marked as sent.')}>I sent it</Btn>} {['pending_manual'].includes(n.status) && <Btn className="small" onClick={() => act('notifications.cancel', n, {}, 'Cancelled.')}>Cancel</Btn>}</td></tr>)}
            </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}
        </>)}</Async>
      {flow && <SendFlow onClose={() => { setFlow(false); q.reload(); }} />}
    </>
  );
}

function Jobs() {
  const q = useApi('jobs.status', {}); const [run, busy] = useAction();
  const go = async (job) => { try { const r = await run(() => api('jobs.run', { job }), 'Job finished.'); window.alert(JSON.stringify(r, null, 2)); q.reload(); } catch { /* toast */ } };
  return (
    <Async q={q}>{(d) => (
      <>
        <p className={'banner ' + (d.triggerInstalled ? '' : 'warn')}>{d.triggerInstalled ? 'The hourly scheduled trigger is installed (timezone ' + d.timezone + '). Jobs run only when enabled in Settings.' : 'The hourly trigger is NOT installed, so nothing runs automatically. Run setupTriggers() once in Apps Script (see the deployment guide).'}</p>
        <Card title="Run a job now"><div className="row"><Btn busy={busy} onClick={() => go('ladder')}>Reminder ladder</Btn><Btn busy={busy} onClick={() => go('fee_reminders')}>Fee reminders (older)</Btn><Btn busy={busy} onClick={() => go('overdue')}>Overdue follow-up</Btn><Btn busy={busy} onClick={() => go('weekly_report')}>Weekly report</Btn></div><p className="hint">Running a job only prepares messages for you to send; the same message is never queued twice. When the reminder ladder is on in Settings, the older monthly and overdue jobs stay off.</p></Card>
        <Card title="Recent runs">{d.runs.length === 0 ? <p className="muted">No runs recorded yet.</p> : <Table><thead><tr><th>Started</th><th>Job</th><th>Status</th><th>Details</th></tr></thead><tbody>{d.runs.map((r) => <tr key={r.runId}><td className="small">{fmtDateTime(r.startedAt)}</td><td>{r.job}</td><td><Chip s={r.status === 'ok' ? 'confirmed' : 'failed'} label={r.status} /></td><td className="small" style={{ wordBreak: 'break-all' }}>{asText(r.details)}</td></tr>)}</tbody></Table>}</Card>
      </>)}</Async>
  );
}

/* ───────── send one by one (self-sending from the Teacher's own WhatsApp) ───────── */
function SendFlow({ onClose }) {
  const q = useApi('notifications.list', { status: 'pending_manual', pageSize: 100 }); const ui = useUi(); const [done, setDone] = useState({}); const [opened, setOpened] = useState('');
  const items = (q.data?.items || []).filter((n) => !done[n.notificationId]).sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || (a.createdAt < b.createdAt ? -1 : 1));
  const cur = items[0], total = (q.data?.items || []).length, idx = total - items.length + 1;
  const mark = async (n, a, msg) => { try { await api(a, { notificationId: n.notificationId }); setDone((d) => ({ ...d, [n.notificationId]: 1 })); setOpened(''); ui.ok(msg); } catch (e) { ui.err(e); } };
  const skip = (n) => { setDone((d) => ({ ...d, [n.notificationId]: 1 })); setOpened(''); };
  return (
    <Modal wide title="Send one by one" onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Async q={q}>{() => !cur ? <Empty title="All done" hint="No more messages are waiting. Skipped ones stay in the list." /> : (
        <div className="sendcard">
          <p className="muted small">Message {idx} of {total}</p>
          <p><strong>{cur.studentName || 'Recipient'}</strong> <span className="muted">+{cur.recipient}</span></p>
          {cur.held && <p className="banner warn">Quiet hours: this was held until {new Date(cur.notBefore).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Sending now is your call.</p>}
          <div className="sendmsg">{cur.message}</div>
          <div className="row">
            <a className="btn primary" href={cur.shareLink} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(cur.notificationId)}>{cur.held ? 'Send anyway — open WhatsApp' : 'Open WhatsApp'}</a>
            <Btn disabled={opened !== cur.notificationId} onClick={() => mark(cur, 'notifications.markSent', 'Marked as sent.')}>I sent it</Btn>
            <Btn onClick={() => skip(cur)}>Skip for now</Btn><Btn variant="danger" onClick={() => mark(cur, 'notifications.cancel', 'Cancelled.')}>Cancel message</Btn>
          </div>
          <p className="hint">WhatsApp opens with the text ready — press Send there, come back, then press “I sent it”. If you did not send it, press “Skip for now”.</p>
        </div>)}</Async>
    </Modal>
  );
}

/* ───────── fee reminder ladder ───────── */
const STAGE = { friendly: 'Friendly (before due date)', due: 'Polite (due date)', firm: 'Firm (after grace)' };
const ACT = { send: ['Will queue', 'confirmed'], hold: ['On hold', 'pending'], call: ['Needs a call', 'failed'], wait: ['Waiting', 'pending'], exists: ['Already queued', 'confirmed'], blocked: ['Cannot message', 'failed'], skipped: ['Not needed', 'confirmed'] };
function LadderTab({ goQueue }) {
  const st = useApi('ladder.status', {}); const pv = useApi('ladder.preview', {}); const [run, busy] = useAction(); const ui = useUi(); const [open, setOpen] = useState('');
  const queue = async () => {
    if (!(await ui.confirm({ title: 'Prepare today\'s reminders', message: 'This prepares today\'s messages in “Messages to send”. Nothing is sent — you send each one yourself. Families already messaged for the same fee are not repeated.', confirmLabel: 'Prepare messages' }))) return;
    try { const r = await run(() => api('ladder.run', {}), null); ui.ok(r.created + ' message(s) prepared' + (r.cancelledPaid ? ', ' + r.cancelledPaid + ' cancelled (paid)' : '') + '.'); st.reload(); pv.reload(); } catch { /* toast */ }
  };
  return (
    <Async q={st}>{(s) => (
      <>
        {!s.enabled && <p className="banner warn">The ladder is switched OFF, so nothing is prepared automatically. Turn it on under Settings → Reminder ladder. You can still preview it and prepare messages by hand below.</p>}
        {!s.publicUrlSet && <p className="banner warn">Set “Public web address of this app” in Settings (https://…) — without it messages cannot carry the one-tap pay link, only your UPI ID.</p>}
        {!s.upiSet && <p className="banner warn">Set your UPI ID in Settings — the pay page cannot open a UPI app without it.</p>}
        <Card title="How it works">
          <p className="small">Friendly nudge a few days before the due date → polite message on the due date → firm message after the grace period (repeated, then “needs a call”). Each message carries the exact amount, the months and a pay link. It stops once you have <em>verified</em> the payment, holds while a payment is waiting to be verified, and never messages during quiet hours automatically. You send every message yourself.</p>
          <div className="row"><Btn variant="primary" busy={busy} onClick={queue}>Prepare today’s messages</Btn><Btn onClick={goQueue}>Go to messages to send</Btn></div>
          {s.lastRun && <p className="hint">Last scheduled run: {fmtDateTime(s.lastRun.at)} ({s.lastRun.status}).</p>}
        </Card>
        {s.reported.length > 0 && <Card title="Parents who said “I have paid”"><p className="hint">Check your bank. Only after you record and verify the payment does the balance change.</p><ul>{s.reported.map((r) => <li key={r.studentId}><strong>{r.studentName}</strong> — {fmtDateTime(r.at)}{r.reference && ' — ref ' + r.reference}{r.count > 1 && ' (' + r.count + ' times)'}</li>)}</ul></Card>}
        {s.needsCall.length > 0 && <Card title="Needs a phone call"><ul>{s.needsCall.map((r) => <li key={r.studentId}><strong>{r.studentName}</strong> — {r.amount} pending ({r.months.join(', ')}) <a className="btn small" href={'tel:+' + r.guardianPhone}>Call +{r.guardianPhone}</a><div className="small muted">{r.note}</div></li>)}</ul></Card>}
        <Card title="What the ladder would do today" actions={<Btn className="small" onClick={() => pv.reload()}>Refresh</Btn>}>
          <Async q={pv}>{(p) => p.items.length === 0 ? <Empty title="Nothing to do today" hint="No family has a fee inside the reminder window." /> : (
            <Table><thead><tr><th>Family</th><th>Stage</th><th>Amount</th><th>Decision</th></tr></thead><tbody>
              {p.items.map((i) => <React.Fragment key={i.studentId}><tr><td><strong>{i.studentName}</strong><div className="small muted">{i.months.join(', ')}</div></td><td>{STAGE[i.stage]}</td><td>{i.amount}</td>
                <td><Chip s={ACT[i.action][1]} label={ACT[i.action][0]} /><div className="small muted">{i.note}{i.notes.map((n, k) => <div key={k}>{n}</div>)}</div>{i.message && <button type="button" className="linkbtn" onClick={() => setOpen(open === i.studentId ? '' : i.studentId)}>{open === i.studentId ? 'Hide text' : 'Show text'}</button>}</td></tr>
                {open === i.studentId && <tr><td colSpan={4}><div className="sendmsg">{i.message}</div></td></tr>}</React.Fragment>)}
            </tbody></Table>)}</Async>
        </Card>
      </>)}</Async>
  );
}
