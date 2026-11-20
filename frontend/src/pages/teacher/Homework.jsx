import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Chip, Empty, Field, Modal, Page, Pager, Select, StudentSelect, Table, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { fmtDate, todayStr } from '../../util.js';

export default function Homework() {
  const [f, setF] = useState({ batchId: '', publicationStatus: '', page: 1 }); const q = useApi('homework.list', { ...f, pageSize: 20 }); const [edit, setEdit] = useState(null); const ui = useUi();
  const toggle = async (h) => {
    const to = h.publicationStatus === 'published' ? 'draft' : 'published';
    const ok = await ui.confirm({ title: to === 'published' ? 'Publish homework' : 'Unpublish homework', message: to === 'published' ? 'Students in the audience will see this homework. Guardian notifications are queued only if you choose so below.' : 'Hide this homework from students.', confirmLabel: to === 'published' ? 'Publish' : 'Unpublish' });
    if (!ok) return;
    try { await api('homework.setPublication', { homeworkId: h.homeworkId, publicationStatus: to, notifyGuardians: false }); ui.ok('Homework ' + to + '.'); q.reload(); } catch (e) { ui.err(e); }
  };
  const archive = async (h) => { if (!(await ui.confirm({ title: 'Archive homework', message: `Archive “${h.title}”? It is hidden from lists but kept in records.`, confirmLabel: 'Archive', danger: true }))) return; try { await api('homework.archive', { homeworkId: h.homeworkId }); ui.ok('Archived.'); q.reload(); } catch (e) { ui.err(e); } };
  return (
    <Page title="Homework" actions={<><BatchSelect value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value, page: 1 })} /><Select aria-label="Status" value={f.publicationStatus} onChange={(e) => setF({ ...f, publicationStatus: e.target.value, page: 1 })} placeholder="All" options={[['draft', 'Draft'], ['published', 'Published']]} /><Btn variant="primary" onClick={() => setEdit({})}>+ New homework</Btn></>}>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No homework" hint="Assign homework to a batch or to one student. Drafts are invisible to students until published." /> : (
        <><Table><thead><tr><th>Title</th><th>For</th><th>Assigned</th><th>Due</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((h) => <tr key={h.homeworkId}><td><strong>{h.title}</strong><div className="small muted">{h.subject}</div></td><td>{h.audienceType === 'batch' ? h.batchName : h.studentName}</td><td>{fmtDate(h.assignedDate)}</td><td>{fmtDate(h.dueDate)}</td><td><Chip s={h.publicationStatus} /></td>
            <td style={{ whiteSpace: 'nowrap' }}><Btn className="small" onClick={() => setEdit(h)}>Edit</Btn> <Btn className="small" onClick={() => toggle(h)}>{h.publicationStatus === 'published' ? 'Unpublish' : 'Publish'}</Btn> <Btn className="small" onClick={() => archive(h)}>Archive</Btn></td></tr>)}
        </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
      {edit && <Form hw={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />}
    </Page>
  );
}
function Form({ hw, onClose, onSaved }) {
  const isNew = !hw.homeworkId; const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [f, set] = useForm({ audienceType: hw.audienceType || 'batch', batchId: hw.batchId || '', studentId: hw.studentId || '', title: hw.title || '', subject: hw.subject || '', instructions: hw.instructions || '', assignedDate: hw.assignedDate || todayStr(), dueDate: hw.dueDate || '', resourceUrl: hw.resourceUrl || '', publicationStatus: hw.publicationStatus || 'draft' });
  const submit = async (e) => { e.preventDefault(); setErr('');
    if (f.dueDate < f.assignedDate) return setErr('Due date cannot be before the assigned date.');
    if (isNew && f.audienceType === 'batch' && !f.batchId) return setErr('Choose a batch.'); if (isNew && f.audienceType === 'student' && !f.studentId) return setErr('Choose a student.');
    const body = { title: f.title, subject: f.subject, instructions: f.instructions, assignedDate: f.assignedDate, dueDate: f.dueDate, resourceUrl: f.resourceUrl };
    try { await run(() => api(isNew ? 'homework.create' : 'homework.update', isNew ? { ...body, audienceType: f.audienceType, batchId: f.batchId, studentId: f.studentId, publicationStatus: f.publicationStatus } : { ...body, homeworkId: hw.homeworkId }), 'Homework saved.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={isNew ? 'New homework' : 'Edit homework'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="hwform">Save</Btn></>}>
      <form id="hwform" onSubmit={submit} className="formgrid">
        {isNew && <><Field label="Assign to"><Select value={f.audienceType} onChange={set('audienceType')} options={[['batch', 'A whole batch'], ['student', 'One student']]} /></Field>
          {f.audienceType === 'batch' ? <Field label="Batch"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Choose batch" /></Field> : <Field label="Student"><StudentSelect value={f.studentId} onChange={set('studentId')} /></Field>}</>}
        <Field label="Title" wide><input value={f.title} onChange={set('title')} required maxLength={120} /></Field><Field label="Subject"><input value={f.subject} onChange={set('subject')} maxLength={80} /></Field>
        <Field label="Assigned"><input type="date" value={f.assignedDate} onChange={set('assignedDate')} required /></Field><Field label="Due"><input type="date" value={f.dueDate} onChange={set('dueDate')} required /></Field>
        <Field label="Instructions" wide><textarea rows={4} value={f.instructions} onChange={set('instructions')} maxLength={2000} /></Field>
        <Field label="Resource link (https://…)" wide hint="Optional. Only https links are accepted."><input value={f.resourceUrl} onChange={set('resourceUrl')} placeholder="https://" /></Field>
        {isNew && <Field label="Visibility"><Select value={f.publicationStatus} onChange={set('publicationStatus')} options={[['draft', 'Draft (hidden)'], ['published', 'Publish now']]} /></Field>}
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
