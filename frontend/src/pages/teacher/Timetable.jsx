import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Modal, Page, Select, Table, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { WEEKDAYS, fmtDate, todayStr } from '../../util.js';

export default function Timetable() {
  const [batchId, setBatchId] = useState(''); const q = useApi('timetable.list', { batchId }); const [edit, setEdit] = useState(null); const [notify, setNotify] = useState(false); const ui = useUi();
  const remove = async (t) => { if (!(await ui.confirm({ title: 'Remove entry', message: 'Remove this timetable entry?', confirmLabel: 'Remove', danger: true }))) return; try { await api('timetable.remove', { scheduleId: t.scheduleId }); ui.ok('Removed.'); q.reload(); } catch (e) { ui.err(e); } };
  return (
    <Page title="Timetable" actions={<><BatchSelect value={batchId} onChange={(e) => setBatchId(e.target.value)} /><Btn variant="primary" onClick={() => setEdit({ kind: 'regular' })}>+ Weekly class</Btn><Btn onClick={() => setEdit({ kind: 'one_off' })}>+ Extra class</Btn><Btn onClick={() => setEdit({ kind: 'cancellation' })}>Cancel a class</Btn><Btn onClick={() => setNotify(true)}>Notify guardians</Btn></>}>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No timetable entries" hint="Add the weekly schedule for each batch. Extra classes and cancellations are one-off entries for a single date." /> : (
        <>
          <Card title="Entries"><Table><thead><tr><th>When</th><th>Batch</th><th>Subject / room</th><th>Type</th><th>Visible</th><th /></tr></thead><tbody>
            {d.items.map((t) => <tr key={t.scheduleId}><td>{t.kind === 'regular' ? WEEKDAYS[t.weekday] : fmtDate(t.date)}{t.startTime && <div className="small muted">{t.startTime}–{t.endTime}</div>}</td><td>{t.batchName}</td><td>{t.subject || '—'}<div className="small muted">{t.room}{t.note ? ' · ' + t.note : ''}</div></td><td><Chip s={t.kind === 'regular' ? 'regular' : t.kind === 'one_off' ? 'extra' : 'cancelled'} label={t.kind === 'regular' ? 'weekly' : t.kind === 'one_off' ? 'extra class' : 'cancellation'} /></td><td>{t.published ? 'Yes' : 'Hidden'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><Btn className="small" onClick={() => setEdit(t)}>Edit</Btn> <Btn className="small" onClick={() => remove(t)}>Remove</Btn></td></tr>)}
          </tbody></Table></Card>
          <Card title="Next 14 days (as students will see it)"><Table><thead><tr><th>Date</th><th>Time</th><th>Batch</th><th>Class</th></tr></thead><tbody>
            {d.upcoming.map((u, i) => <tr key={i}><td>{fmtDate(u.date)}</td><td>{u.startTime ? u.startTime + '–' + u.endTime : 'All day'}</td><td>{u.batchName}</td><td>{u.subject}{u.room ? ' · ' + u.room : ''} {u.type !== 'regular' && <Chip s={u.type === 'cancelled' || u.type === 'cancellation' ? 'cancelled' : 'extra'} label={u.type === 'extra' ? 'extra class' : 'cancelled'} />}</td></tr>)}
          </tbody></Table></Card>
        </>)}</Async>
      {edit && <Form t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />}
      {notify && <Notify onClose={() => setNotify(false)} />}
    </Page>
  );
}
function Form({ t, onClose, onSaved }) {
  const isNew = !t.scheduleId; const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [f, set] = useForm({ batchId: t.batchId || '', kind: t.kind || 'regular', weekday: t.weekday || 1, date: t.date || todayStr(), startTime: t.startTime || '', endTime: t.endTime || '', subject: t.subject || '', room: t.room || '', note: t.note || '', published: t.published !== false });
  const submit = async (e) => { e.preventDefault(); setErr(''); if (isNew && !f.batchId) return setErr('Choose a batch.'); if (f.endTime && f.startTime && f.endTime <= f.startTime) return setErr('End time must be after start time.');
    const body = { kind: f.kind, weekday: Number(f.weekday), date: f.date, startTime: f.startTime, endTime: f.endTime, subject: f.subject, room: f.room, note: f.note, published: f.published };
    try { await run(() => api(isNew ? 'timetable.create' : 'timetable.update', isNew ? { ...body, batchId: f.batchId } : { ...body, scheduleId: t.scheduleId }), 'Saved.'); onSaved(); } catch (x) { setErr(x.message); } };
  const cancel = f.kind === 'cancellation';
  return (
    <Modal title={(isNew ? 'New ' : 'Edit ') + (f.kind === 'regular' ? 'weekly class' : f.kind === 'one_off' ? 'extra class' : 'cancellation')} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="ttform">Save</Btn></>}>
      <form id="ttform" onSubmit={submit} className="formgrid">
        {isNew && <Field label="Batch" wide><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Choose batch" /></Field>}
        {f.kind === 'regular' ? <Field label="Weekday"><Select value={f.weekday} onChange={set('weekday')} options={WEEKDAYS.slice(1).map((w, i) => [i + 1, w])} /></Field> : <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>}
        <Field label={cancel ? 'Start time (blank = whole day)' : 'Start time'}><input type="time" value={f.startTime} onChange={set('startTime')} required={!cancel} /></Field>
        <Field label="End time"><input type="time" value={f.endTime} onChange={set('endTime')} required={!cancel} /></Field>
        <Field label="Subject"><input value={f.subject} onChange={set('subject')} maxLength={80} /></Field>{!cancel && <Field label="Room"><input value={f.room} onChange={set('room')} maxLength={40} /></Field>}
        <Field label="Note" wide><input value={f.note} onChange={set('note')} maxLength={200} /></Field>
        <label className="field wide"><span className="lbl"><input type="checkbox" checked={f.published} onChange={set('published')} /> Visible to students</span></label>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function Notify({ onClose }) {
  const [run, busy] = useAction(); const [f, set] = useForm({ batchId: '', message: '' }); const [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); setErr(''); if (!f.batchId) return setErr('Choose a batch.'); try { await run(() => api('timetable.notifyChange', f), (r) => r.queued + ' notification(s) queued (not yet sent — see Notices & Notifications).'); onClose(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Notify guardians of a schedule change" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="nform">Queue messages</Btn></>}>
      <form id="nform" onSubmit={go}><Field label="Batch"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Choose batch" /></Field><Field label="Message"><textarea rows={3} value={f.message} onChange={set('message')} required minLength={5} maxLength={400} /></Field>{err && <p className="ferr" role="alert">{err}</p>}</form>
    </Modal>);
}
