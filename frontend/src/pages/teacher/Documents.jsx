import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, BatchSelect, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, SearchBar, Select, StudentSelect, Table, Tabs, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { fmtDate, fmtDateTime } from '../../util.js';
import { PdfActions } from './pdfactions.jsx';

// which parameters each document type needs
const NEEDS = {
  admission_form: ['student'], admission_confirmation: ['student'], id_card: ['studentOrBatch'], fee_statement: ['student'], fee_reminder: ['student'], attendance_summary: ['student', 'range'], report_card: ['student'],
  test_report: ['test'], homework_summary: ['studentOrBatchOnly', 'range'], notice: ['notice'], enquiry_record: ['enquiry'], batch_report: ['batch', 'range'], financial_summary: ['rangeRequired'], verification_certificate: ['target'], no_dues_certificate: ['student'], leaving_certificate: ['student'],
};

export default function Documents() {
  const [tab, setTab] = useState('make');
  return <Page title="Official Documents"><Tabs value={tab} onChange={setTab} tabs={[['make', 'Generate'], ['issued', 'Issued documents']]} />{tab === 'make' ? <Make /> : <Issued />}</Page>;
}

function Make() {
  const types = useApi('documents.types', {}); const [f, set] = useForm({ type: '', studentId: '', batchId: '', testId: '', noticeId: '', enquiryId: '', from: '', to: '', targetVerificationId: '', studentIds: '' });
  const [run, busy] = useAction(); const [res, setRes] = useState(null); const ui = useUi();
  const tests = useApi('tests.list', { publicationStatus: 'published', pageSize: 100 }); const notices = useApi('notices.list', { status: 'published', pageSize: 100 }); const enq = useApi('enquiries.list', { pageSize: 100 });
  const needs = NEEDS[f.type] || [];
  const go = async (e) => {
    e.preventDefault(); setRes(null);
    const p = { type: f.type };
    if (needs.includes('student') && !f.studentId) return ui.err('Choose a student.');
    if (needs.includes('studentOrBatch') && !f.studentId && !f.batchId) return ui.err('Choose a student or a batch.');
    if (needs.includes('studentOrBatchOnly') && !f.studentId && !f.batchId) return ui.err('Choose a student or a batch.');
    if (needs.includes('batch') && !f.batchId) return ui.err('Choose a batch.');
    if (needs.includes('rangeRequired') && (!f.from || !f.to)) return ui.err('Choose a from and to date.');
    ['studentId', 'batchId', 'testId', 'noticeId', 'enquiryId', 'from', 'to', 'targetVerificationId'].forEach((k) => { if (f[k]) p[k] = f[k]; });
    if (f.type === 'id_card' && f.studentId) { p.studentIds = [f.studentId]; delete p.batchId; }
    if (f.type === 'homework_summary' && p.studentId) delete p.batchId;
    try { const r = await run(() => api('documents.issue', p), (r) => r.isReprint ? 'Same content as before — reprinting the existing document (no new version).' : 'Document issued: ' + r.meta.documentNumber); setRes(r); } catch { /* toast */ }
  };
  return (
    <Card title="Generate an official document">
      <form onSubmit={go} className="formgrid">
        <Field label="Document type" wide><Async q={types}>{(t) => <Select value={f.type} onChange={set('type')} placeholder="Choose…" options={t.filter((x) => x.issuable).map((x) => [x.type, x.label])} />}</Async></Field>
        {(needs.includes('student') || needs.includes('studentOrBatch') || needs.includes('studentOrBatchOnly')) && <Field label="Student"><StudentSelect value={f.studentId} onChange={set('studentId')} status="" placeholder={needs.includes('student') ? 'Select student' : 'Any / none'} /></Field>}
        {(needs.includes('batch') || needs.includes('studentOrBatch') || needs.includes('studentOrBatchOnly')) && <Field label="Batch"><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Select batch" includeInactive /></Field>}
        {needs.includes('test') && <Field label="Published test" wide><Async q={tests}>{(d) => <Select value={f.testId} onChange={set('testId')} placeholder="Select test" options={d.items.map((t) => [t.testId, t.title + ' — ' + t.batchName + ' (' + fmtDate(t.testDate) + ')'])} />}</Async></Field>}
        {needs.includes('notice') && <Field label="Published notice" wide><Async q={notices}>{(d) => <Select value={f.noticeId} onChange={set('noticeId')} placeholder="Select notice" options={d.items.map((t) => [t.noticeId, t.title])} />}</Async></Field>}
        {needs.includes('enquiry') && <Field label="Enquiry" wide><Async q={enq}>{(d) => <Select value={f.enquiryId} onChange={set('enquiryId')} placeholder="Select enquiry" options={d.items.map((t) => [t.enquiryId, t.name + ' (' + fmtDate(t.enquiryDate) + ')'])} />}</Async></Field>}
        {needs.includes('target') && <Field label="Verification ID of the document to certify" wide hint="From the Issued documents list"><input value={f.targetVerificationId} onChange={set('targetVerificationId')} pattern="[a-f0-9]{32}" /></Field>}
        {(needs.includes('range') || needs.includes('rangeRequired')) && <><Field label="From"><input type="date" value={f.from} onChange={set('from')} required={needs.includes('rangeRequired')} /></Field><Field label="To"><input type="date" value={f.to} onChange={set('to')} required={needs.includes('rangeRequired')} /></Field></>}
        <div className="wide"><Btn variant="primary" busy={busy} disabled={!f.type} type="submit">Generate</Btn></div>
      </form>
      {res && <div className="card mt"><p><strong>{res.meta.docTypeLabel}</strong> · {res.meta.documentNumber} · version {res.meta.version} {res.isReprint && <Chip s="active" label="reprint, unchanged" />}</p>
        <p className="hint">Print settings default to Settings → Documents (A4/A5, colour/B&amp;W, watermark, Teacher name). You can override size and colour here for this print only.</p>
        <PdfActions doc={res} label="PDF" defaults={{}} /></div>}
    </Card>
  );
}

function Issued() {
  const [f, setF] = useState({ docType: '', status: '', search: '', page: 1 }); const q = useApi('documents.list', { ...f, pageSize: 20 }); const types = useApi('documents.types', {}); const [modal, setModal] = useState(null);
  return (
    <>
      <div className="row"><Field label="Search"><SearchBar value={f.search} onChange={(v) => setF((x) => ({ ...x, search: v, page: 1 }))} placeholder="Number or student" /></Field>
        <Field label="Type"><Async q={types}>{(t) => <Select value={f.docType} onChange={(e) => setF({ ...f, docType: e.target.value, page: 1 })} placeholder="All" options={t.map((x) => [x.type, x.label])} />}</Async></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} placeholder="All" options={[['valid', 'Valid'], ['revoked', 'Revoked']]} /></Field></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No documents issued yet" /> : (
        <><Table><thead><tr><th>Number</th><th>Type</th><th>Student</th><th>Issued</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((m) => <tr key={m.verificationId}><td><strong>{m.documentNumber}</strong><div className="small muted">v{m.version}{m.isLatest ? '' : ' (superseded)'}</div></td><td>{m.docTypeLabel}</td><td>{m.studentName || '—'}</td><td>{fmtDateTime(m.issuedAt)}</td><td><Chip s={m.status} /></td><td><Btn className="small" onClick={() => setModal(m)}>Open</Btn></td></tr>)}
        </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
      {modal && <Detail m={modal} onClose={() => { setModal(null); q.reload(); }} />}
    </>
  );
}
function Detail({ m, onClose }) {
  const hist = useApi('documents.history', { verificationId: m.verificationId }); const [act, setAct] = useState(null); const [reason, setReason] = useState(''); const [run, busy] = useAction(); const [err, setErr] = useState(''); const [again, setAgain] = useState(null);
  const submit = async (e) => { e.preventDefault(); setErr('');
    try {
      if (act === 'revoke') { await run(() => api('documents.revoke', { verificationId: m.verificationId, reason, confirm: true }), 'Document revoked. It will verify as revoked.'); onClose(); }
      else { const r = await run(() => api('documents.reissue', { verificationId: m.verificationId, reason }), 'New version issued.'); setAgain(r); setAct(null); hist.reload(); }
    } catch (x) { setErr(x.message); } };
  return (
    <Modal wide title={m.docTypeLabel + ' · ' + m.documentNumber} onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <dl className="kv"><dt>Verification ID</dt><dd className="small" style={{ wordBreak: 'break-all' }}>{m.verificationId}</dd><dt>Version</dt><dd>{m.version} {m.isLatest ? '(latest)' : '(superseded)'}</dd><dt>Status</dt><dd><Chip s={m.status} />{m.revokeReason && ' — ' + m.revokeReason}</dd></dl>
      {m.status === 'valid' && <div className="row mt"><PdfActions verificationId={m.verificationId} label="PDF" />{m.docType !== 'receipt' && <Btn onClick={() => setAct('reissue')}>Issue updated version…</Btn>}{m.docType !== 'receipt' && <Btn variant="danger" onClick={() => setAct('revoke')}>Revoke…</Btn>}</div>}
      {m.docType === 'receipt' && <p className="hint">Receipts cannot be edited or revoked directly. To correct one, reverse the payment under Fees &amp; Payments.</p>}
      {act && <form onSubmit={submit} className="card mt"><h3>{act === 'revoke' ? 'Revoke document' : 'Issue an updated version'}</h3><p className="hint">{act === 'revoke' ? 'A revoked document stays in the registry and shows as REVOKED when its QR code is scanned.' : 'Rebuilds the document from current records. If nothing has changed, no new version is created.'}</p><Field label="Reason (audited)"><input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={200} /></Field>{err && <p className="ferr" role="alert">{err}</p>}<div className="row"><Btn type="button" onClick={() => setAct(null)}>Cancel</Btn><Btn variant={act === 'revoke' ? 'danger' : 'primary'} busy={busy} type="submit">{act === 'revoke' ? 'Revoke' : 'Issue new version'}</Btn></div></form>}
      {again && <div className="card mt"><p>New version <strong>{again.meta.documentNumber}</strong> issued.</p><PdfActions doc={again} label="new version" /></div>}
      <Card title="Version history & audit"><Async q={hist}>{(h) => <><ul>{h.versions.map((v) => <li key={v.verificationId}>v{v.version} · {v.documentNumber} · {fmtDateTime(v.issuedAt)} · <Chip s={v.status} /></li>)}</ul>{h.audit.length > 0 && <ul className="small muted">{h.audit.map((a, i) => <li key={i}>{fmtDateTime(a.at)} — {a.action}</li>)}</ul>}</>}</Async></Card>
    </Modal>
  );
}
