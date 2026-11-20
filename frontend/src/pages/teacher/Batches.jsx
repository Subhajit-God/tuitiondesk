import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, Select, StudentSelect, Table, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { WEEKDAYS } from '../../util.js';

const Frag = ({ children, actions }) => <><div className="row">{actions}</div>{children}</>;
const t12 = (t) => { const [h, m] = String(t).split(':').map(Number); return ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); };
export const slotText = (s) => WEEKDAYS[s.weekday] + ' ' + t12(s.startTime) + '–' + t12(s.endTime);

export default function Batches({ embedded }) {
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const q = useApi('batches.list', { status, page, pageSize: 20 });
  const [edit, setEdit] = useState(null); const [view, setView] = useState(null);
  const ui = useUi(); const Wrap = embedded ? Frag : Page;
  const toggle = async (b) => {
    const to = b.status === 'active' ? 'inactive' : 'active';
    if (!(await ui.confirm({ title: (to === 'inactive' ? 'Deactivate' : 'Activate') + ' batch', message: to === 'inactive' ? `"${b.name}" will be hidden from new attendance, fees and tests. Existing records are kept.` : `Activate "${b.name}" again?`, confirmLabel: to === 'inactive' ? 'Deactivate' : 'Activate', danger: to === 'inactive' }))) return;
    try { await api('batches.setStatus', { batchId: b.batchId, status: to }); ui.ok('Batch ' + to + '.'); q.reload(); } catch (e) { ui.err(e); }
  };
  return (
    <Wrap title="Batches" actions={<><Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={[['active', 'Active'], ['inactive', 'Inactive']]} /><Btn variant="primary" onClick={() => setEdit({})}>+ New batch</Btn></>}>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No batches yet" hint="A batch is a class group (for example “Class 10 Maths”). Create your first batch, then add students to it."><Btn variant="primary" onClick={() => setEdit({})}>Create the first batch</Btn></Empty> : (
        <>
          <Table><thead><tr><th>Batch</th><th>Class</th><th>Timings</th><th>Students</th><th>Capacity</th><th>Status</th><th /></tr></thead><tbody>
            {d.items.map((b) => (
              <tr key={b.batchId}>
                <td><strong>{b.name}</strong>{b.description && <div className="muted small">{b.description}</div>}</td><td>{b.className || '—'}</td><td className="small">{b.slots?.length ? b.slots.map((s) => <div key={s.scheduleId}>{slotText(s)}</div>) : <span className="muted">No timings</span>}</td>
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
    </Wrap>
  );
}

function BatchForm({ batch, onClose, onSaved }) {
  const isNew = !batch.batchId; const [run, busy] = useAction();
  const [f, set] = useForm({ name: batch.name || '', className: batch.className || '', subject: batch.subject || '', capacity: batch.capacity || 0, description: batch.description || '' });
  const [err, setErr] = useState(''); const [slots, setSlots] = useState((batch.slots || []).map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })));
  const setSlot = (i, k, v) => setSlots((a) => a.map((s, j) => (j === i ? { ...s, [k]: k === 'weekday' ? Number(v) : v } : s)));
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.name.trim().length < 1) return setErr('Batch name is required.');
    if (!f.className.trim()) return setErr('Class is required (for example 5, 6, 7 … or “Class 9”).');
    if (slots.some((s) => !s.startTime || !s.endTime || s.endTime <= s.startTime)) return setErr('Every timing needs a start time and a later end time.');
    if (Number(f.capacity) < 0) return setErr('Capacity cannot be negative.');
    try { await run(() => api(isNew ? 'batches.create' : 'batches.update', { ...(isNew ? {} : { batchId: batch.batchId }), name: f.name.trim(), className: f.className.trim(), slots, subject: f.subject.trim(), capacity: Number(f.capacity) || 0, description: f.description.trim() }), isNew ? 'Batch created.' : 'Batch updated.'); onSaved(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={isNew ? 'New batch' : 'Edit batch'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="batchform">Save batch</Btn></>}>
      <form id="batchform" onSubmit={submit} className="formgrid">
        <Field label="Batch name" wide><input value={f.name} onChange={set('name')} required maxLength={80} autoFocus /></Field>
        <Field label="Class" hint="e.g. 5, 6, 7, 8, 9"><input value={f.className} onChange={set('className')} required maxLength={30} /></Field>
        <div className="wide field"><span className="lbl">Timings (add as many days and times as the batch meets)</span>
          {slots.length === 0 && <p className="hint">No timings yet.</p>}
          {slots.map((s, i) => (
            <div className="slotrow" key={i} role="group" aria-label={'Timing ' + (i + 1)}>
              <select aria-label={'Day ' + (i + 1)} value={s.weekday} onChange={(e) => setSlot(i, 'weekday', e.target.value)}>{WEEKDAYS.slice(1).map((d, k) => <option key={d} value={k + 1}>{d}</option>)}</select>
              <input type="time" aria-label={'Start time ' + (i + 1)} value={s.startTime} onChange={(e) => setSlot(i, 'startTime', e.target.value)} required />
              <span className="muted">–</span>
              <input type="time" aria-label={'End time ' + (i + 1)} value={s.endTime} onChange={(e) => setSlot(i, 'endTime', e.target.value)} required />
              <Btn type="button" className="small" onClick={() => setSlots((a) => a.filter((_, j) => j !== i))}>Remove</Btn>
            </div>))}
          <Btn type="button" className="small" onClick={() => setSlots((a) => [...a, { weekday: 7, startTime: '07:00', endTime: '09:30' }])}>+ Add a day and time</Btn>
        </div>
        <Field label="Subject / course (optional)"><input value={f.subject} onChange={set('subject')} maxLength={80} /></Field>
        <Field label="Capacity" hint="0 = no limit"><input type="number" min="0" max="1000" value={f.capacity} onChange={set('capacity')} /></Field>
        <Field label="Description" wide><input value={f.description} onChange={set('description')} maxLength={300} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}

function Roster({ batch, onClose }) {
  const q = useApi('batches.get', { batchId: batch.batchId }); const [pick, setPick] = useState(''); const [run, busy] = useAction(); const ui = useUi();
  const add = async (override) => {
    try { await run(() => api('students.assignBatch', { studentId: pick, batchId: batch.batchId, overrideCapacity: !!override }), 'Student added to the batch.'); setPick(''); q.reload(); }
    catch (e) { if (e.code === 'CAPACITY' && (await ui.confirm({ title: 'Batch is full', message: 'This batch has reached its capacity. Add the student anyway?', confirmLabel: 'Add anyway' }))) add(true); }
  };
  return (
    <Modal title={'Roster — ' + batch.name} onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      {batch.slots?.length > 0 && <p className="small muted">{batch.className ? 'Class ' + batch.className + ' · ' : ''}{batch.slots.map(slotText).join(' · ')}</p>}
      <div className="row"><Field label="Add an existing student to this batch"><StudentSelect value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Choose student" /></Field><Btn variant="primary" busy={busy} disabled={!pick} onClick={() => add(false)}>Add to batch</Btn></div>
      <p className="hint">New student? Add them from <a href="#/students">Students → New student</a> and choose this batch there.</p>
      <Async q={q}>{(d) => d.roster.length === 0 ? <Empty title="No active students" hint="Add students from the Students page and assign them to this batch." /> : (
        <Table><thead><tr><th>ID</th><th>Name</th></tr></thead><tbody>{d.roster.map((s) => <tr key={s.studentId}><td>{s.studentId}</td><td>{s.fullName}</td></tr>)}</tbody></Table>)}</Async>
    </Modal>
  );
}
