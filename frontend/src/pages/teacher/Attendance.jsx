import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Loading, Modal, Page, Pager, Tabs, Table, useAction, useApi, useUi, useUnsavedWarning } from '../../ui.jsx';
import { fmtDate, newKey, todayStr } from '../../util.js';

export default function Attendance() {
  const [tab, setTab] = useState('mark');
  return (
    <Page title="Attendance">
      <Tabs value={tab} onChange={setTab} tabs={[['mark', 'Mark attendance'], ['history', 'Past sessions']]} />
      {tab === 'mark' ? <Mark /> : <History />}
    </Page>
  );
}

function Mark() {
  const [batchId, setBatchId] = useState(''); const [date, setDate] = useState(todayStr()); const [label, setLabel] = useState('');
  const q = useApi('attendance.roster', { batchId, date }, [batchId, date]);
  const [marks, setMarks] = useState({}); const [dirty, setDirty] = useState(false); const [key, setKey] = useState(newKey);
  const [run, busy] = useAction(); const ui = useUi(); const [dup, setDup] = useState(null);
  useUnsavedWarning(dirty);
  useEffect(() => { setMarks({}); setDirty(false); setKey(newKey()); setDup(null); }, [batchId, date]);
  const d = batchId ? q.data : null;
  const roster = d?.roster || [];
  const set = (id, s) => { setMarks((m) => ({ ...m, [id]: s })); setDirty(true); };
  const all = (s) => { const m = {}; roster.forEach((r) => { m[r.studentId] = s; }); setMarks(m); setDirty(true); };
  const missing = roster.filter((r) => !marks[r.studentId]).length;
  const [quick, setQuick] = useState(true); const [absent, setAbsent] = useState({});
  useEffect(() => { setAbsent({}); }, [batchId, date]);
  const tap = (id) => { setAbsent((m) => ({ ...m, [id]: !m[id] })); setDirty(true); };
  const saveQuick = async () => {
    const ids = roster.filter((r) => absent[r.studentId]).map((r) => r.studentId);
    if (!(await ui.confirm({ title: 'Save attendance', message: `${roster.length - ids.length} present, ${ids.length} absent. A message for each absent student's guardian will be prepared for you to send.`, confirmLabel: 'Save' }))) return;
    try {
      const r = await run(() => api('attendance.saveAbsentees', { batchId, date, sessionLabel: label || d.sessionLabels?.[0], idempotencyKey: key, absentIds: ids }), 'Attendance saved.');
      setDirty(false); setAbsent({}); q.reload(); setKey(newKey()); if (r.notifications?.queued) ui.ok(r.notifications.queued + ' message(s) prepared — see Messages to send.');
    } catch (e) { if (e.code === 'DUPLICATE_SESSION') setDup(e.details?.sessionId); }
  };
  const save = async () => {
    if (missing) return ui.err('Mark every student (' + missing + ' not marked yet).');
    const absent = roster.filter((r) => marks[r.studentId] === 'A').length;
    if (!(await ui.confirm({ title: 'Save attendance', message: `${roster.length} students: ${roster.filter((r) => marks[r.studentId] === 'P').length} present, ${absent} absent, ${roster.filter((r) => marks[r.studentId] === 'H').length} holiday. Absence alerts are queued for guardians only if enabled in Settings.`, confirmLabel: 'Save' }))) return;
    try {
      const r = await run(() => api('attendance.save', { batchId, date, sessionLabel: label || d.sessionLabels?.[0], idempotencyKey: key, entries: roster.map((x) => ({ studentId: x.studentId, status: marks[x.studentId] })) }), 'Attendance saved.');
      setDirty(false); setMarks({}); q.reload(); setKey(newKey()); if (r.notifications?.queued) ui.ok(r.notifications.queued + ' absence alert(s) queued.');
    } catch (e) { if (e.code === 'DUPLICATE_SESSION') setDup(e.details?.sessionId); }
  };
  return (
    <>
      <div className="row"><Field label="Batch"><BatchSelect value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="Choose batch" /></Field><Field label="Date"><input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></Field>
        {d?.sessionLabels?.length > 1 && <Field label="Session"><select value={label || d.sessionLabels[0]} onChange={(e) => setLabel(e.target.value)}>{d.sessionLabels.map((l) => <option key={l}>{l}</option>)}</select></Field>}</div>
      {!batchId ? <Empty title="Choose a batch and date" hint="The roster shows students who were enrolled in the batch on that date." /> : q.loading && !q.data ? <Loading /> : q.error ? <Async q={q}>{() => null}</Async> : (
        <>
          {d.existingSessions?.length > 0 && <p className="banner warn">Attendance for this batch and date has already been saved ({d.existingSessions.map((s) => s.sessionLabel).join(', ')}). Open it under “Past sessions” to correct individual entries.</p>}
          {dup && <p className="banner bad" role="alert">This session already exists — use “Past sessions” to correct it.</p>}
          {roster.length === 0 ? <Empty title="No students in this batch on that date" /> : (
            quick ? (
              <Card title={`${roster.length} student${roster.length === 1 ? "" : "s"} — everyone is present; tap the absent ones`} actions={<Btn className="small" onClick={() => setQuick(false)}>Detailed mode (holiday…)</Btn>}>
                <div className="tapgrid">{roster.map((r) => <button key={r.studentId} type="button" className={'tap' + (absent[r.studentId] ? ' absent' : '')} aria-pressed={!!absent[r.studentId]} onClick={() => tap(r.studentId)}><strong>{r.fullName}</strong><span>{absent[r.studentId] ? 'Absent' : 'Present'}</span></button>)}</div>
                <div className="row mt"><span className="muted">{roster.length - Object.values(absent).filter(Boolean).length} present · {Object.values(absent).filter(Boolean).length} absent</span><Btn variant="primary" busy={busy} onClick={saveQuick}>Save attendance</Btn></div>
              </Card>
            ) : (
            <Card title={`${roster.length} students`} actions={<><Btn className="small" onClick={() => setQuick(true)}>Quick mode</Btn><Btn className="small" onClick={() => all('P')}>All present</Btn><Btn className="small" onClick={() => all('A')}>All absent</Btn></>}>
              {roster.map((r) => (
                <div className="att-row" key={r.studentId}><span><strong>{r.fullName}</strong><span className="muted small"> {r.studentId}</span></span>
                  <span className="seg" role="group" aria-label={'Attendance for ' + r.fullName}>{[['P', 'Present'], ['A', 'Absent'], ['H', 'Holiday']].map(([s, l]) => <button key={s} type="button" className={s} aria-pressed={marks[r.studentId] === s} aria-label={l} onClick={() => set(r.studentId, s)}>{s}</button>)}</span></div>))}
              <div className="row mt"><span className="muted">{missing ? missing + ' not marked' : 'All marked'} · P = present, A = absent, H = holiday</span><Btn variant="primary" busy={busy} disabled={!dirty && !missing} onClick={save}>Save attendance</Btn></div>
            </Card>))}
        </>)}
    </>
  );
}

function History() {
  const [f, setF] = useState({ batchId: '', from: '', to: '', page: 1 }); const q = useApi('attendance.sessions', { ...f, pageSize: 20 }); const [open, setOpen] = useState(null);
  return (
    <>
      <div className="row"><Field label="Batch"><BatchSelect value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value, page: 1 })} /></Field><Field label="From"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} /></Field><Field label="To"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} /></Field></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No sessions saved for this filter" /> : (
        <><Table><thead><tr><th>Date</th><th>Batch</th><th>Session</th><th>P</th><th>A</th><th>H</th><th /></tr></thead><tbody>
          {d.items.map((s) => <tr key={s.sessionId}><td>{fmtDate(s.date)}</td><td>{s.batchName}</td><td>{s.sessionLabel}</td><td className="num">{s.counts.P}</td><td className="num">{s.counts.A}</td><td className="num">{s.counts.H}</td><td><Btn className="small" onClick={() => setOpen(s.sessionId)}>Open / correct</Btn></td></tr>)}
        </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
      {open && <Session id={open} onClose={() => { setOpen(null); q.reload(); }} />}
    </>
  );
}
function Session({ id, onClose }) {
  const q = useApi('attendance.session', { sessionId: id }); const [fix, setFix] = useState(null);
  return (
    <Modal wide title="Attendance session" onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Async q={q}>{(s) => (
        <>
          <p><strong>{s.batchName}</strong> · {fmtDate(s.date)} · {s.sessionLabel}</p>
          <Table><thead><tr><th>Student</th><th>Status</th><th /></tr></thead><tbody>{s.entries.map((e) => <tr key={e.attendanceId}><td>{e.fullName}</td><td><Chip s={{ P: 'present', A: 'absent', H: 'holiday' }[e.status]} />{e.correctionReason && <div className="small muted">Corrected: {e.correctionReason}</div>}</td><td><Btn className="small" onClick={() => setFix(e)}>Correct</Btn></td></tr>)}</tbody></Table>
          {fix && <Correct entry={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); q.reload(); }} />}
        </>)}</Async>
    </Modal>
  );
}
function Correct({ entry, onClose, onDone }) {
  const [status, setStatus] = useState(entry.status); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); setErr(''); if (status === entry.status) return setErr('Choose a different status.'); try { await run(() => api('attendance.correct', { attendanceId: entry.attendanceId, status, reason }), 'Correction saved and audited.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <form onSubmit={go} className="card mt"><h3>Correct {entry.fullName}</h3>
      <Field label="New status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="P">Present</option><option value="A">Absent</option><option value="H">Holiday</option></select></Field>
      <Field label="Reason (audited)"><input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={200} /></Field>{err && <p className="ferr" role="alert">{err}</p>}
      <div className="row"><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit">Save correction</Btn></div></form>);
}
