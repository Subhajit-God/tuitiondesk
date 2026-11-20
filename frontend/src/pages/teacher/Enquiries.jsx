import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, SearchBar, Select, Table, Tabs, useAction, useApi, useForm } from '../../ui.jsx';
import { fmtDate, money, todayStr } from '../../util.js';

const STATUSES = [['new', 'New'], ['contacted', 'Contacted'], ['follow_up', 'Follow-up'], ['trial', 'Trial'], ['admitted', 'Admitted'], ['lost', 'Lost']];

export default function Enquiries() {
  const [tab, setTab] = useState('enq');
  return <Page title="Enquiries, Admissions & Leavers"><Tabs value={tab} onChange={setTab} tabs={[['enq', 'Enquiries'], ['adm', 'Admissions'], ['left', 'Leavers']]} />{tab === 'enq' ? <List /> : tab === 'adm' ? <Admissions /> : <Leavers />}</Page>;
}
function Due() {
  const q = useApi('enquiries.due', {});
  return (<Async q={q}>{(d) => d.length === 0 ? null : (
    <div className="card"><h2>Follow-ups due today ({d.length})</h2><ul className="plain">{d.map((e) => (
      <li key={e.enquiryId}><strong>{e.name}</strong> <span className="muted">— {e.reason}{e.overdueDays > 0 ? ', ' + e.overdueDays + ' day(s) ago' : ''}{e.nextAction ? ': ' + e.nextAction : ''}</span> {e.phone && <a className="btn small" href={'tel:+' + e.phone}>Call</a>} {e.waLink && <a className="btn small" href={e.waLink} target="_blank" rel="noreferrer">WhatsApp</a>}</li>))}</ul></div>)}</Async>);
}
function List() {
  const [f, setF] = useState({ status: '', search: '', page: 1 }); const q = useApi('enquiries.list', { ...f, pageSize: 20 }); const [modal, setModal] = useState(null);
  return (
    <>
      <Due />
      <div className="row"><Field label="Search"><SearchBar value={f.search} onChange={(v) => setF((x) => ({ ...x, search: v, page: 1 }))} placeholder="Name or phone" /></Field><Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} placeholder="All" options={STATUSES} /></Field><Btn variant="primary" onClick={() => setModal({ t: 'form', e: {} })}>+ New enquiry</Btn></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No enquiries" hint="Record every enquiry, follow up, then convert it to an admission when the student joins." /> : (
        <><Table><thead><tr><th>Date</th><th>Name</th><th>Interest</th><th>Next action</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((e) => <tr key={e.enquiryId}><td>{fmtDate(e.enquiryDate)}</td><td><strong>{e.name}</strong><div className="small muted">{e.guardianName} {e.phone && '· +' + e.phone}</div></td><td>{e.requestedSubject || '—'}</td><td>{e.nextAction || '—'}{e.nextActionDate && <div className="small muted">{fmtDate(e.nextActionDate)}</div>}</td><td><Chip s={e.status} /></td><td><Btn className="small" onClick={() => setModal({ t: 'open', id: e.enquiryId })}>Open</Btn></td></tr>)}
        </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
      {modal?.t === 'form' && <EnqForm e={modal.e} onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'open' && <Detail id={modal.id} onClose={() => { setModal(null); q.reload(); }} />}
    </>
  );
}
function EnqForm({ e, onClose, onSaved }) {
  const isNew = !e.enquiryId; const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [f, set] = useForm({ name: e.name || '', guardianName: e.guardianName || '', phone: e.phone || '', requestedSubject: e.requestedSubject || '', requestedBatchId: e.requestedBatchId || '', source: e.source || '', notes: e.notes || '', nextAction: e.nextAction || '', nextActionDate: e.nextActionDate || '' });
  const submit = async (ev) => { ev.preventDefault(); setErr(''); try { await run(() => api(isNew ? 'enquiries.create' : 'enquiries.update', isNew ? f : { ...f, enquiryId: e.enquiryId }), 'Enquiry saved.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={isNew ? 'New enquiry' : 'Edit enquiry'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="enqform">Save</Btn></>}>
      <form id="enqform" onSubmit={submit} className="formgrid">
        <Field label="Student name" wide><input value={f.name} onChange={set('name')} required minLength={2} maxLength={100} autoFocus /></Field>
        <Field label="Guardian"><input value={f.guardianName} onChange={set('guardianName')} maxLength={100} /></Field><Field label="Phone / WhatsApp" hint="With or without country code"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Subject wanted"><input value={f.requestedSubject} onChange={set('requestedSubject')} maxLength={80} /></Field><Field label="Preferred batch"><BatchSelect value={f.requestedBatchId} onChange={set('requestedBatchId')} placeholder="None" /></Field>
        <Field label="Source"><input value={f.source} onChange={set('source')} maxLength={80} placeholder="Referral, flyer…" /></Field><Field label="Next action date"><input type="date" value={f.nextActionDate} onChange={set('nextActionDate')} /></Field>
        <Field label="Next action" wide><input value={f.nextAction} onChange={set('nextAction')} maxLength={200} /></Field><Field label="Notes" wide><textarea rows={3} value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function Detail({ id, onClose }) {
  const q = useApi('enquiries.get', { enquiryId: id }); const [run, busy] = useAction(); const [sub, setSub] = useState(null); const [note, setNote] = useState({ note: '', nextAction: '', nextActionDate: '' });
  const setStatus = async (status) => { try { await run(() => api('enquiries.update', { enquiryId: id, status }), 'Status updated.'); q.reload(); } catch { /* toast */ } };
  const follow = async (ev) => { ev.preventDefault(); try { await run(() => api('enquiries.addFollowup', { enquiryId: id, ...note }), 'Follow-up added.'); setNote({ note: '', nextAction: '', nextActionDate: '' }); q.reload(); } catch { /* toast */ } };
  return (
    <Modal wide title="Enquiry" onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Async q={q}>{(d) => { const e = d.enquiry; return (
        <>
          <dl className="kv"><dt>Name</dt><dd>{e.name}</dd><dt>Guardian</dt><dd>{e.guardianName || '—'}</dd><dt>Phone</dt><dd>{e.phone ? '+' + e.phone : '—'}</dd><dt>Interested in</dt><dd>{e.requestedSubject || '—'}</dd><dt>Source</dt><dd>{e.source || '—'}</dd><dt>Status</dt><dd><Chip s={e.status} />{e.convertedStudentId && ' → ' + e.convertedStudentId}</dd>{e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}</dl>
          <div className="row mt"><Select aria-label="Change status" value={e.status} disabled={e.status === 'admitted'} onChange={(ev) => setStatus(ev.target.value)} options={STATUSES.filter((s) => s[0] !== 'admitted' || e.status === 'admitted')} /><Btn onClick={() => setSub('edit')}>Edit</Btn>{e.status !== 'admitted' && <Btn variant="primary" onClick={() => setSub('convert')}>Convert to admission…</Btn>}</div>
          <Card title="Follow-ups"><form onSubmit={follow} className="formgrid"><Field label="Note" wide><input value={note.note} onChange={(x) => setNote({ ...note, note: x.target.value })} required maxLength={500} /></Field><Field label="Next action"><input value={note.nextAction} onChange={(x) => setNote({ ...note, nextAction: x.target.value })} maxLength={200} /></Field><Field label="Next action date"><input type="date" value={note.nextActionDate} onChange={(x) => setNote({ ...note, nextActionDate: x.target.value })} /></Field><div className="wide"><Btn variant="primary" busy={busy} type="submit">Add follow-up</Btn></div></form>
            {d.followups.length === 0 ? <p className="muted">No follow-ups yet.</p> : <ul>{d.followups.map((f) => <li key={f.followupId}><span className="muted small">{fmtDate(f.createdAt)}</span> {f.note}{f.nextAction && <span className="muted"> — next: {f.nextAction} {f.nextActionDate && '(' + fmtDate(f.nextActionDate) + ')'}</span>}</li>)}</ul>}</Card>
          {sub === 'edit' && <EnqForm e={e} onClose={() => setSub(null)} onSaved={() => { setSub(null); q.reload(); }} />}
          {sub === 'convert' && <Convert e={e} onClose={() => setSub(null)} onDone={() => { setSub(null); q.reload(); }} />}
        </>); }}</Async>
    </Modal>
  );
}
function Convert({ e, onClose, onDone }) {
  const [run, busy] = useAction(); const [err, setErr] = useState(''); const [res, setRes] = useState(null);
  const [f, set] = useForm({ fullName: e.name, guardianName: e.guardianName || '', guardianWhatsapp: e.phone || '', whatsappConsent: 'unknown', admissionDate: todayStr(), batchId: e.requestedBatchId || '', createAccount: true, username: '' });
  const go = async (ev) => { ev.preventDefault(); setErr(''); try { setRes(await run(() => api('enquiries.convert', { enquiryId: e.enquiryId, ...f, username: f.username || undefined }), 'Admission confirmed.')); } catch (x) { setErr(x.message); } };
  if (res) return (
    <Modal title="Admission confirmed" onClose={onDone} footer={<Btn variant="primary" onClick={onDone}>Done</Btn>}>
      <p>Student ID <strong>{res.studentId}</strong> created.</p>
      {res.temporaryPassword && <p className="banner warn">Temporary password: <strong style={{ userSelect: 'all', fontFamily: 'monospace' }}>{res.temporaryPassword}</strong><br />Shown only now. Give it to the student; they must change it at first sign-in.</p>}
    </Modal>);
  return (
    <Modal title="Convert to admission" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="convform">Confirm admission</Btn></>}>
      <form id="convform" onSubmit={go} className="formgrid">
        <Field label="Student full name" wide><input value={f.fullName} onChange={set('fullName')} required minLength={2} /></Field>
        <Field label="Guardian"><input value={f.guardianName} onChange={set('guardianName')} /></Field><Field label="Guardian WhatsApp"><input inputMode="tel" value={f.guardianWhatsapp} onChange={set('guardianWhatsapp')} /></Field>
        <label className="field wide"><span className="lbl"><input type="checkbox" checked={f.whatsappConsent === 'yes'} onChange={(ev) => set('whatsappConsent')(ev.target.checked ? 'yes' : 'unknown')} /> Guardian has agreed to receive WhatsApp messages</span></label>
        <Field label="Admission date"><input type="date" value={f.admissionDate} onChange={set('admissionDate')} required /></Field><Field label="Batch"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Assign later" /></Field>
        <label className="field wide"><span className="lbl"><input type="checkbox" checked={f.createAccount} onChange={set('createAccount')} /> Create a student login (temporary password generated)</span></label>
        {f.createAccount && <Field label="Username (optional)" hint="Blank = generated" wide><input value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>}
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function Admissions() {
  const [page, setPage] = useState(1); const q = useApi('admissions.list', { page, pageSize: 25 });
  return <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No admissions yet" hint="Every admission appears here: converted enquiries, direct admissions and re-admissions." /> : <><Table><thead><tr><th>Date</th><th>Student</th><th>Batch</th><th>Source</th><th>Status</th></tr></thead><tbody>{d.items.map((a) => <tr key={a.admissionId}><td>{fmtDate(a.admissionDate)}</td><td>{a.studentName}<div className="small muted">{a.studentId}</div></td><td>{a.batchName || '—'}</td><td>{a.enquiryId ? (a.source || 'Enquiry') : a.source === 'readmission' ? 'Re-admission' : 'Direct admission'}</td><td><Chip s={a.status} /></td></tr>)}</tbody></Table><Pager data={d} onPage={setPage} /></>}</Async>;
}

const REASON = { completed: 'Completed the course', relocated: 'Moved away', fees: 'Fees', other_institute: 'Joined another institute', not_satisfied: 'Not satisfied', health: 'Health', other: 'Other' };
function Leavers() {
  const [f, setF] = useState({ search: '', page: 1 }); const q = useApi('leavers.list', { ...f, pageSize: 25 });
  return (
    <>
      <div className="row"><Field label="Search"><SearchBar value={f.search} onChange={(v) => setF({ search: v, page: 1 })} placeholder="Name or ID" /></Field></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No leavers" hint="Record a leaving from a student's “Admission & leaving” tab. Billing then ends in the leaving month." /> : (
        <><p className="hint">Still owed by students who have left: <strong>{money(d.totalOutstanding)}</strong>. Their reminders and pay links keep working.</p>
          <Table><thead><tr><th>Student</th><th>Admitted</th><th>Left</th><th>Reason</th><th className="r">Months billed</th><th className="r">Still owes</th></tr></thead><tbody>
            {d.items.map((s) => <tr key={s.studentId}><td><strong>{s.fullName}</strong><div className="small muted">{s.studentId}</div></td><td>{fmtDate(s.admissionDate)}</td><td>{fmtDate(s.leavingDate)}</td><td>{REASON[s.reason] || s.reason || '—'}</td><td className="r">{s.billedMonths}</td><td className="r">{s.outstanding > 0 ? <strong>{money(s.outstanding)}</strong> : money(0)}{s.feesOutside.length > 0 && <div className="small muted">review fees: {s.feesOutside.join(', ')}</div>}</td></tr>)}
          </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
    </>
  );
}
