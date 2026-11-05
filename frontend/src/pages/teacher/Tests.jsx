import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, Select, Table, useAction, useApi, useForm, useUi, useUnsavedWarning } from '../../ui.jsx';
import { fmtDate, todayStr } from '../../util.js';

export default function Tests() {
  const [f, setF] = useState({ batchId: '', page: 1 }); const q = useApi('tests.list', { ...f, pageSize: 20 }); const [modal, setModal] = useState(null);
  return (
    <Page title="Tests & Results" actions={<><BatchSelect value={f.batchId} onChange={(e) => setF({ batchId: e.target.value, page: 1 })} /><Btn variant="primary" onClick={() => setModal({ t: 'new' })}>+ New test</Btn></>}>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No tests yet" hint="Create a test for a batch, enter marks, then publish so students can see the results."><Btn variant="primary" onClick={() => setModal({ t: 'new' })}>Create a test</Btn></Empty> : (
        <><Table><thead><tr><th>Test</th><th>Batch</th><th>Date</th><th>Max</th><th>Marks entered</th><th>Average</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((t) => <tr key={t.testId}><td><strong>{t.title}</strong><div className="small muted">{t.subject}</div></td><td>{t.batchName}</td><td>{fmtDate(t.testDate)}</td><td className="num">{t.maxMarks}</td><td className="num">{t.stats.entered}/{t.stats.students}{t.stats.notEntered > 0 && <div className="small muted">{t.stats.notEntered} not entered</div>}</td><td className="num">{t.stats.average ?? '—'}</td><td><Chip s={t.publicationStatus} /></td>
            <td><Btn className="small" onClick={() => setModal({ t: 'marks', id: t.testId })}>Marks</Btn> <Btn className="small" onClick={() => setModal({ t: 'edit', test: t })}>Edit</Btn></td></tr>)}
        </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
      {(modal?.t === 'new' || modal?.t === 'edit') && <TestForm test={modal.test} onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'marks' && <Marks id={modal.id} onClose={() => { setModal(null); q.reload(); }} />}
    </Page>
  );
}
function TestForm({ test, onClose, onSaved }) {
  const isNew = !test; const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [f, set] = useForm({ batchId: test?.batchId || '', title: test?.title || '', subject: test?.subject || '', testDate: test?.testDate || todayStr(), maxMarks: test?.maxMarks || 100, reason: '' });
  const submit = async (e) => { e.preventDefault(); setErr(''); if (isNew && !f.batchId) return setErr('Choose a batch.');
    try { await run(() => api(isNew ? 'tests.create' : 'tests.update', isNew ? { ...f, maxMarks: Number(f.maxMarks) } : { testId: test.testId, title: f.title, subject: f.subject, testDate: f.testDate, maxMarks: Number(f.maxMarks), reason: f.reason }), isNew ? 'Test created.' : 'Test updated.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={isNew ? 'New test' : 'Edit test'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="testform">Save</Btn></>}>
      <form id="testform" onSubmit={submit} className="formgrid">
        {isNew && <Field label="Batch" wide><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Choose batch" /></Field>}
        <Field label="Title" wide><input value={f.title} onChange={set('title')} required maxLength={100} /></Field>
        <Field label="Subject"><input value={f.subject} onChange={set('subject')} maxLength={80} /></Field><Field label="Date"><input type="date" value={f.testDate} onChange={set('testDate')} required /></Field>
        <Field label="Maximum marks"><input type="number" min="1" max="1000" value={f.maxMarks} onChange={set('maxMarks')} required /></Field>
        {!isNew && test.publicationStatus === 'published' && <Field label="Reason for change (published test)" wide><input value={f.reason} onChange={set('reason')} required minLength={5} /></Field>}
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function Marks({ id, onClose }) {
  const q = useApi('tests.get', { testId: id }); const [ed, setEd] = useState({}); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const ui = useUi(); const dirty = Object.keys(ed).length > 0;
  useUnsavedWarning(dirty);
  const set = (sid, patch) => setEd((x) => ({ ...x, [sid]: { ...(x[sid] || {}), ...patch } }));
  const save = async (d) => {
    const entries = Object.entries(ed).map(([studentId, v]) => { const row = d.rows.find((r) => r.studentId === studentId); const st = v.status ?? row.resultStatus; const marks = v.marks !== undefined ? v.marks : row.marks; return { studentId, status: st, marks: st === 'entered' ? marks : undefined, comment: v.comment !== undefined ? v.comment : row.comment }; });
    for (const e of entries) if (e.status === 'entered' && (e.marks === '' || e.marks === null || e.marks === undefined)) return ui.err('Enter marks for every student marked “entered”.');
    try { await run(() => api('tests.saveMarks', { testId: id, entries, reason }), (r) => r.saved + ' result(s) saved.'); setEd({}); setReason(''); q.reload(); } catch { /* toast */ }
  };
  const publish = async (d, pub) => {
    const n = d.stats.notEntered;
    const ok = await ui.confirm({ title: pub ? 'Publish results' : 'Unpublish results', message: pub ? `Students will be able to see these results.${n ? ' ' + n + ' student(s) have no marks entered and will show “Not entered” (not zero).' : ''} Guardian notifications are queued, not sent, unless WhatsApp API is configured.` : 'Hide these results from students again.', confirmLabel: pub ? 'Publish' : 'Unpublish' });
    if (!ok) return;
    try { await run(() => api('tests.publish', { testId: id, publish: pub, confirmNotEntered: true, notifyGuardians: pub }), pub ? 'Results published.' : 'Results unpublished.'); q.reload(); } catch { /* toast */ }
  };
  return (
    <Modal wide title="Enter marks" onClose={() => { if (!dirty || window.confirm('Discard unsaved marks?')) onClose(); }} footer={<Btn onClick={() => { if (!dirty || window.confirm('Discard unsaved marks?')) onClose(); }}>Close</Btn>}>
      <Async q={q}>{(d) => (
        <>
          <p><strong>{d.test.title}</strong> · {d.test.batchName} · {fmtDate(d.test.testDate)} · out of <strong>{d.test.maxMarks}</strong> · <Chip s={d.test.publicationStatus} /></p>
          <p className="muted small">Entered {d.stats.entered}/{d.stats.students} · average {d.stats.average ?? '—'} · highest {d.stats.highest ?? '—'} · lowest {d.stats.lowest ?? '—'}. {d.rankingPolicy}</p>
          <Table><thead><tr><th>Student</th><th>Status</th><th>Marks</th><th>%</th><th>Rank</th><th>Comment</th></tr></thead><tbody>
            {d.rows.map((r) => { const v = ed[r.studentId] || {}; const st = v.status ?? r.resultStatus; const marks = v.marks !== undefined ? v.marks : r.marks;
              return <tr key={r.studentId}><td>{r.fullName}</td>
                <td><Select aria-label={'Status for ' + r.fullName} value={st} onChange={(e) => set(r.studentId, { status: e.target.value })} options={[['not_entered', 'Not entered'], ['entered', 'Marks entered'], ['absent', 'Absent'], ['exempt', 'Exempt']]} /></td>
                <td><input aria-label={'Marks for ' + r.fullName} type="number" min="0" max={d.test.maxMarks} step="0.01" style={{ width: 90 }} disabled={st !== 'entered'} value={st === 'entered' ? (marks ?? '') : ''} onChange={(e) => set(r.studentId, { marks: e.target.value, status: 'entered' })} /></td>
                <td className="num">{r.percentage ?? '—'}</td><td className="num">{r.rank ?? '—'}</td><td><input aria-label={'Comment for ' + r.fullName} maxLength={300} value={v.comment !== undefined ? v.comment : r.comment || ''} onChange={(e) => set(r.studentId, { comment: e.target.value })} /></td></tr>; })}
          </tbody></Table>
          {d.test.publicationStatus === 'published' && dirty && <Field label="Reason for changing published marks (audited)"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} /></Field>}
          <div className="row mt"><Btn variant="primary" busy={busy} disabled={!dirty} onClick={() => save(d)}>Save marks</Btn>
            {d.test.publicationStatus === 'published' ? <Btn onClick={() => publish(d, false)} disabled={dirty}>Unpublish</Btn> : <Btn onClick={() => publish(d, true)} disabled={dirty}>Publish results</Btn>}</div>
          {dirty && <p className="hint">Save your marks before publishing.</p>}
        </>)}</Async>
    </Modal>
  );
}
