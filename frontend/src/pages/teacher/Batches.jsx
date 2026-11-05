import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, Select, Table, useAction, useApi, useForm, useUi } from '../../ui.jsx';

export default function Batches() {
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const q = useApi('batches.list', { status, page, pageSize: 20 });
  const [edit, setEdit] = useState(null); const [view, setView] = useState(null);
  const ui = useUi();
  const toggle = async (b) => {
    const to = b.status === 'active' ? 'inactive' : 'active';
    if (!(await ui.confirm({ title: (to === 'inactive' ? 'Deactivate' : 'Activate') + ' batch', message: to === 'inactive' ? `"${b.name}" will be hidden from new attendance, fees and tests. Existing records are kept.` : `Activate "${b.name}" again?`, confirmLabel: to === 'inactive' ? 'Deactivate' : 'Activate', danger: to === 'inactive' }))) return;
    try { await api('batches.setStatus', { batchId: b.batchId, status: to }); ui.ok('Batch ' + to + '.'); q.reload(); } catch (e) { ui.err(e); }
  };
  return (
    <Page title="Batches" actions={<><Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={[['active', 'Active'], ['inactive', 'Inactive']]} /><Btn variant="primary" onClick={() => setEdit({})}>+ New batch</Btn></>}>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No batches yet" hint="A batch is a class group (for example “Class 10 Maths”). Create your first batch, then add students to it."><Btn variant="primary" onClick={() => setEdit({})}>Create the first batch</Btn></Empty> : (
        <>
          <Table><thead><tr><th>Batch</th><th>Subject</th><th>Students</th><th>Capacity</th><th>Status</th><th /></tr></thead><tbody>
            {d.items.map((b) => (
              <tr key={b.batchId}>
                <td><strong>{b.name}</strong>{b.description && <div className="muted small">{b.description}</div>}</td><td>{b.subject || '—'}</td>
                <td className="num">{b.memberCount}</td>
                <td>{b.capacity > 0 ? <div style={{ minWidth: 110 }}><span className="num">{b.memberCount} / {b.capacity}</span> <span className="muted small">({b.occupancy}%)</span><div className="bar" aria-hidden="true"><i style={{ width: Math.min(100, b.occupancy) + '%' }} /></div></div> : <span className="muted">Not set</span>}</td>
                <td><Chip s={b.status} /></td>
                <td style={{ whiteSpace: 'nowrap' }}><Btn className="small" onClick={() => setView(b)}>Roster</Btn> <Btn className="small" onClick={() => setEdit(b)}>Edit</Btn> <Btn className="small" onClick={() => toggle(b)}>{b.status === 'active' ? 'Deactivate' : 'Activate'}</Btn></td>
              </tr>))}
          </tbody></Table>
          <Pager data={d} onPage={setPage} />
        </>)}</Async>
      {edit && <BatchForm batch={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />}
      {view && <Roster batch={view} onClose={() => setView(null)} />}
    </Page>
  );
}

function BatchForm({ batch, onClose, onSaved }) {
  const isNew = !batch.batchId; const [run, busy] = useAction();
  const [f, set] = useForm({ name: batch.name || '', subject: batch.subject || '', capacity: batch.capacity || 0, description: batch.description || '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.name.trim().length < 1) return setErr('Batch name is required.');
    if (Number(f.capacity) < 0) return setErr('Capacity cannot be negative.');
    try { await run(() => api(isNew ? 'batches.create' : 'batches.update', { ...(isNew ? {} : { batchId: batch.batchId }), name: f.name.trim(), subject: f.subject.trim(), capacity: Number(f.capacity) || 0, description: f.description.trim() }), isNew ? 'Batch created.' : 'Batch updated.'); onSaved(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={isNew ? 'New batch' : 'Edit batch'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="batchform">Save batch</Btn></>}>
      <form id="batchform" onSubmit={submit} className="formgrid">
        <Field label="Batch name" wide><input value={f.name} onChange={set('name')} required maxLength={80} autoFocus /></Field>
        <Field label="Subject / course"><input value={f.subject} onChange={set('subject')} maxLength={80} /></Field>
        <Field label="Capacity" hint="0 = no limit"><input type="number" min="0" max="1000" value={f.capacity} onChange={set('capacity')} /></Field>
        <Field label="Description" wide><input value={f.description} onChange={set('description')} maxLength={300} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}

function Roster({ batch, onClose }) {
  const q = useApi('batches.get', { batchId: batch.batchId });
  return (
    <Modal title={'Roster — ' + batch.name} onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Async q={q}>{(d) => d.roster.length === 0 ? <Empty title="No active students" hint="Add students from the Students page and assign them to this batch." /> : (
        <Table><thead><tr><th>ID</th><th>Name</th></tr></thead><tbody>{d.roster.map((s) => <tr key={s.studentId}><td>{s.studentId}</td><td>{s.fullName}</td></tr>)}</tbody></Table>)}</Async>
    </Modal>
  );
}
