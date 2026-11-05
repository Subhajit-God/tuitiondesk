import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Chip, Empty, Field, Modal, Money, Page, Pager, SearchBar, Select, StudentSelect, BatchSelect, Table, Tabs, useAction, useApi, useForm, useUi } from '../../ui.jsx';
import { PAY_METHODS, fmtDate, fmtDateTime, monthStr, newKey, payLabel, todayStr } from '../../util.js';
import { PdfActions } from './pdfactions.jsx';

export default function Fees() {
  const [tab, setTab] = useState('fees');
  return (
    <Page title="Fees & Payments">
      <Tabs value={tab} onChange={setTab} tabs={[['fees', 'Fee obligations'], ['payments', 'Payments'], ['receipts', 'Receipts'], ['check', 'Ledger check']]} />
      {tab === 'fees' && <FeeList />}
      {tab === 'payments' && <PaymentList />}
      {tab === 'receipts' && <ReceiptList />}
      {tab === 'check' && <LedgerCheck />}
    </Page>
  );
}

/* ───────────── obligations ───────────── */
function FeeList() {
  const [f, setF] = useState({ status: '', period: '', batchId: '', search: '', page: 1 });
  const q = useApi('fees.list', { ...f, pageSize: 25 });
  const [modal, setModal] = useState(null); const ui = useUi();
  const upd = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e, page: 1 });
  const lateFees = async () => {
    const ok = await ui.confirm({ title: 'Apply late fees', message: 'Adds the configured flat late fee once to every fee that is overdue beyond the grace period (Settings). Already-applied fees are skipped.', confirmLabel: 'Apply late fees' });
    if (!ok) return;
    try { const r = await api('fees.applyLateFees', {}); ui.ok(r.applied + ' late fee(s) applied.'); q.reload(); } catch (e) { ui.err(e); }
  };
  return (
    <>
      <div className="row">
        <Field label="Search"><SearchBar value={f.search} onChange={(v) => setF((x) => ({ ...x, search: v, page: 1 }))} placeholder="Student name or ID" /></Field>
        <Field label="Status"><Select value={f.status} onChange={upd('status')} placeholder="All" options={[['pending', 'Pending'], ['partial', 'Partly paid'], ['late', 'Late'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']]} /></Field>
        <Field label="Billing month"><input type="month" value={f.period} onChange={upd('period')} /></Field>
        <Field label="Batch"><BatchSelect value={f.batchId} onChange={upd('batchId')} /></Field>
      </div>
      <div className="row"><Btn variant="primary" onClick={() => setModal({ t: 'create' })}>+ Fee for a student</Btn><Btn onClick={() => setModal({ t: 'bulk' })}>+ Fees for a whole batch</Btn><Btn onClick={() => setModal({ t: 'payment' })}>Record a payment</Btn><Btn onClick={() => setModal({ t: 'remind' })}>Queue fee reminders</Btn><Btn onClick={lateFees}>Apply late fees</Btn></div>
      <Async q={q}>{(d) => (
        <>
          <div className="grid g3 mt"><div className="stat"><div className="l">Net due (filtered)</div><div className="v"><Money v={d.totals?.netDue} /></div></div><div className="stat"><div className="l">Verified paid</div><div className="v"><Money v={d.totals?.paid} /></div></div><div className="stat"><div className="l">Balance / overdue</div><div className="v"><Money v={d.totals?.balance} /> <span className="small muted">/ <Money v={d.totals?.overdue} /></span></div></div></div>
          {d.items.length === 0 ? <Empty title="No fee obligations match" hint="Create a fee for one student, or for every student in a batch." /> : (
            <Table><thead><tr><th>Student</th><th>Period</th><th>Due</th><th className="right">Net due</th><th className="right">Paid</th><th className="right">Balance</th><th>Status</th><th /></tr></thead><tbody>
              {d.items.map((x) => (
                <tr key={x.feeId}><td><strong>{x.studentName}</strong><div className="muted small">{x.studentId}</div></td><td>{x.billingPeriod}</td><td>{fmtDate(x.dueDate)}{x.overdueDays > 0 && <div className="small muted">{x.overdueDays} day(s) past</div>}</td>
                  <td className="right"><Money v={x.netDue} />{x.adjustments !== 0 && <div className="small muted">adj. <Money v={x.adjustments} /></div>}</td><td className="right"><Money v={x.paid} /></td><td className="right"><Money v={x.balance} /></td><td><Chip s={x.status} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.status !== 'cancelled' && <><Btn className="small" onClick={() => setModal({ t: 'adjust', fee: x })}>Adjust</Btn> <Btn className="small" onClick={() => setModal({ t: 'edit', fee: x })}>Edit</Btn> <Btn className="small" onClick={() => setModal({ t: 'cancel', fee: x })}>Cancel</Btn></>}</td></tr>))}
            </tbody></Table>)}
          <Pager data={d} onPage={(p) => setF({ ...f, page: p })} />
        </>)}</Async>
      {modal?.t === 'create' && <FeeForm onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'bulk' && <BulkForm onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'edit' && <EditFee fee={modal.fee} onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'adjust' && <AdjustFee fee={modal.fee} onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'cancel' && <CancelFee fee={modal.fee} onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'payment' && <RecordPayment onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'remind' && <Remind onClose={() => setModal(null)} />}
    </>
  );
}
function FeeForm({ onClose, onSaved }) {
  const [run, busy] = useAction(); const [f, set] = useForm({ studentId: '', billingPeriod: monthStr(), amountDue: '', dueDate: '', note: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); if (!f.studentId) return setErr('Choose a student.'); if (!(Number(f.amountDue) > 0)) return setErr('Enter an amount greater than zero.');
    try { await run(() => api('fees.create', { ...f, amountDue: Number(f.amountDue), dueDate: f.dueDate || undefined }), 'Fee created.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="New fee obligation" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="feeform">Create fee</Btn></>}>
      <form id="feeform" onSubmit={submit} className="formgrid">
        <Field label="Student" wide><StudentSelect value={f.studentId} onChange={set('studentId')} /></Field>
        <Field label="Billing month"><input type="month" value={f.billingPeriod} onChange={set('billingPeriod')} required /></Field>
        <Field label="Amount (₹)"><input type="number" step="0.01" min="1" value={f.amountDue} onChange={set('amountDue')} required /></Field>
        <Field label="Due date" hint="Blank = default due day from Settings"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        <Field label="Note"><input value={f.note} onChange={set('note')} maxLength={200} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function BulkForm({ onClose, onSaved }) {
  const [run, busy] = useAction(); const [f, set] = useForm({ batchId: '', billingPeriod: monthStr(), amountDue: '', dueDate: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); if (!f.batchId) return setErr('Choose a batch.'); if (!(Number(f.amountDue) > 0)) return setErr('Enter an amount greater than zero.');
    try { const r = await run(() => api('fees.createBulk', { ...f, amountDue: Number(f.amountDue), dueDate: f.dueDate || undefined }), (r) => r.created + ' fee(s) created, ' + r.skipped + ' skipped (already billed for that month).'); onSaved(r); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Create fees for a batch" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="bulkform">Create fees</Btn></>}>
      <form id="bulkform" onSubmit={submit} className="formgrid">
        <p className="hint wide">One fee per active student in the batch. Students who already have a fee for the month are skipped, so running this twice is safe.</p>
        <Field label="Batch" wide><BatchSelect value={f.batchId} onChange={set('batchId')} placeholder="Choose batch" /></Field>
        <Field label="Billing month"><input type="month" value={f.billingPeriod} onChange={set('billingPeriod')} required /></Field>
        <Field label="Amount per student (₹)"><input type="number" step="0.01" min="1" value={f.amountDue} onChange={set('amountDue')} required /></Field>
        <Field label="Due date"><input type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function EditFee({ fee, onClose, onSaved }) {
  const [run, busy] = useAction(); const [f, set] = useForm({ amountDue: fee.amountDue, dueDate: fee.dueDate, note: fee.note || '', reason: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api('fees.update', { feeId: fee.feeId, amountDue: Number(f.amountDue), dueDate: f.dueDate, note: f.note, reason: f.reason }), 'Fee updated.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={'Edit fee — ' + fee.studentName + ' ' + fee.billingPeriod} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="editfee">Save</Btn></>}>
      <form id="editfee" onSubmit={submit} className="formgrid">
        <Field label="Amount (₹)" hint="Cannot go below what has already been paid"><input type="number" step="0.01" min="1" value={f.amountDue} onChange={set('amountDue')} required /></Field>
        <Field label="Due date"><input type="date" value={f.dueDate} onChange={set('dueDate')} required /></Field>
        <Field label="Note" wide><input value={f.note} onChange={set('note')} maxLength={200} /></Field>
        <Field label="Reason for change (audited)" wide><input value={f.reason} onChange={set('reason')} required minLength={3} maxLength={200} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function AdjustFee({ fee, onClose, onSaved }) {
  const [run, busy] = useAction(); const [f, set] = useForm({ kind: 'discount', amount: '', reason: '' }); const [err, setErr] = useState(''); const [key] = useState(newKey);
  const submit = async (e) => { e.preventDefault(); setErr(''); let amt = Number(f.amount); if (!(amt > 0)) return setErr('Enter a positive amount.'); if (f.kind === 'discount') amt = -amt;
    try { await run(() => api('fees.adjust', { feeId: fee.feeId, kind: f.kind, amount: amt, reason: f.reason, idempotencyKey: key }), 'Adjustment recorded.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title={'Adjust fee — ' + fee.studentName + ' ' + fee.billingPeriod} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="adjfee">Record adjustment</Btn></>}>
      <form id="adjfee" onSubmit={submit} className="formgrid">
        <p className="hint wide">Current balance <Money v={fee.balance} />. Adjustments are kept as separate audited entries; the original fee amount is never overwritten.</p>
        <Field label="Type"><Select value={f.kind} onChange={set('kind')} options={[['discount', 'Discount (reduces fee)'], ['adjustment', 'Extra charge (increases fee)'], ['late_fee', 'Late fee']]} /></Field>
        <Field label="Amount (₹)"><input type="number" step="0.01" min="0.01" value={f.amount} onChange={set('amount')} required /></Field>
        <Field label="Reason" wide><input value={f.reason} onChange={set('reason')} required minLength={3} maxLength={200} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function CancelFee({ fee, onClose, onSaved }) {
  const [run, busy] = useAction(); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api('fees.cancel', { feeId: fee.feeId, reason }), 'Fee cancelled.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Cancel this fee?" onClose={onClose} footer={<><Btn onClick={onClose}>Keep fee</Btn><Btn variant="danger" busy={busy} type="submit" form="cancelfee">Cancel fee</Btn></>}>
      <form id="cancelfee" onSubmit={submit}>
        <p>{fee.studentName} · {fee.billingPeriod} · net due <Money v={fee.netDue} />. A fee that has verified payments cannot be cancelled until those payments are reversed or refunded.</p>
        <Field label="Reason (audited)"><input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} /></Field>
        {err && <p className="ferr" role="alert">{err}</p>}
      </form>
    </Modal>);
}
function Remind({ onClose }) {
  const [run, busy] = useAction(); const [res, setRes] = useState(null);
  const go = async (a) => { try { setRes(await run(() => api(a, {}))); } catch { /* toast shown */ } };
  return (
    <Modal title="Fee reminders" onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <p>Reminders are <strong>queued</strong>, not sent. If WhatsApp API credentials are not configured they wait in <em>Notices &amp; Notifications</em> as “pending manual send” so you can send them yourself and mark them done. Duplicates for the same fee and day are never created.</p>
      <div className="row"><Btn variant="primary" busy={busy} onClick={() => go('notifications.queueFeeReminders')}>Queue reminders for upcoming dues</Btn><Btn busy={busy} onClick={() => go('notifications.queueOverdue')}>Queue overdue notices</Btn></div>
      {res && <p className="banner">Result: {JSON.stringify(res)}</p>}
    </Modal>);
}
export function RecordPayment({ onClose, onSaved, studentId }) {
  const [run, busy] = useAction(); const [key] = useState(newKey); const [err, setErr] = useState('');
  const [f, set] = useForm({ studentId: studentId || '', amount: '', method: 'upi', providerReference: '', receivedAt: todayStr(), notes: '' });
  const submit = async (e) => { e.preventDefault(); setErr(''); if (!f.studentId) return setErr('Choose a student.'); if (!(Number(f.amount) > 0)) return setErr('Enter an amount greater than zero.');
    try { await run(() => api('payments.record', { ...f, amount: Number(f.amount), idempotencyKey: key }), 'Payment recorded as PENDING — verify it to count it.'); onSaved(); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Record a payment" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="payform">Record payment</Btn></>}>
      <form id="payform" onSubmit={submit} className="formgrid">
        <p className="banner wide">A recorded payment stays <strong>pending</strong> and does not reduce any balance until you verify it against your bank/UPI/cash records.</p>
        {!studentId && <Field label="Student" wide><StudentSelect value={f.studentId} onChange={set('studentId')} /></Field>}
        <Field label="Amount (₹)"><input type="number" step="0.01" min="1" value={f.amount} onChange={set('amount')} required /></Field>
        <Field label="Method"><Select value={f.method} onChange={set('method')} options={PAY_METHODS} /></Field>
        <Field label="Reference / UTR / cheque no." hint="Letters, digits and - _ / . only"><input value={f.providerReference} onChange={set('providerReference')} maxLength={60} /></Field>
        <Field label="Date received"><input type="date" value={f.receivedAt} max={todayStr()} onChange={set('receivedAt')} /></Field>
        <Field label="Notes" wide><input value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>);
}

/* ───────────── payments ───────────── */
function PaymentList() {
  const [f, setF] = useState({ status: 'pending', search: '', page: 1 });
  const q = useApi('payments.list', { ...f, pageSize: 25 }); const [modal, setModal] = useState(null);
  return (
    <>
      <div className="row"><Field label="Search"><SearchBar value={f.search} onChange={(v) => setF((x) => ({ ...x, search: v, page: 1 }))} placeholder="Student or reference" /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} placeholder="All" options={[['pending', 'Awaiting verification'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['reversed', 'Reversed']]} /></Field>
        <Btn variant="primary" onClick={() => setModal({ t: 'new' })}>Record a payment</Btn></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No payments in this view" hint={f.status === 'pending' ? 'Nothing is waiting for verification.' : undefined} /> : (
        <>
          <Table><thead><tr><th>Received</th><th>Student</th><th>Type</th><th>Method / ref</th><th className="right">Amount</th><th>Status</th><th /></tr></thead><tbody>
            {d.items.map((p) => (
              <tr key={p.paymentId}><td>{fmtDate(p.receivedAt)}<div className="small muted">{p.source === 'student' ? 'reported by student' : p.source === 'provider' ? 'provider' : 'recorded by you'}</div></td><td><strong>{p.studentName}</strong><div className="muted small">{p.studentId}</div></td>
                <td>{p.kind}</td><td>{payLabel(p.method)}<div className="small muted">{p.reference || '—'}</div></td><td className="right"><Money v={p.amount} /></td><td><Chip s={p.status} />{p.status === 'pending' && <div className="small muted">not counted yet</div>}</td>
                <td><Btn className="small" onClick={() => setModal({ t: 'open', id: p.paymentId })}>Open</Btn></td></tr>))}
          </tbody></Table>
          <Pager data={d} onPage={(p) => setF({ ...f, page: p })} />
        </>)}</Async>
      {modal?.t === 'new' && <RecordPayment onClose={() => setModal(null)} onSaved={() => { setModal(null); q.reload(); }} />}
      {modal?.t === 'open' && <PaymentDetail id={modal.id} onClose={() => setModal(null)} onChanged={q.reload} />}
    </>
  );
}
function PaymentDetail({ id, onClose, onChanged }) {
  const q = useApi('payments.get', { paymentId: id }); const [act, setAct] = useState(null);
  const done = () => { setAct(null); q.reload(); onChanged(); };
  return (
    <Modal wide title="Payment" onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Async q={q}>{(p) => (
        <>
          <dl className="kv"><dt>Student</dt><dd>{p.studentName} ({p.studentId})</dd><dt>Amount</dt><dd><Money v={p.amount} /> · {payLabel(p.method)}</dd><dt>Reference</dt><dd>{p.reference || '—'}</dd><dt>Received</dt><dd>{fmtDate(p.receivedAt)}</dd><dt>Status</dt><dd><Chip s={p.status} /></dd>
            {p.notes && <><dt>Notes</dt><dd>{p.notes}</dd></>}{p.verifiedAt && <><dt>Verified</dt><dd>{fmtDateTime(p.verifiedAt)} · {p.verificationMethod === 'provider_callback' ? 'provider callback' : 'Teacher reconciliation'}</dd></>}
            {p.reconciliationNote && <><dt>Reconciliation note</dt><dd>{p.reconciliationNote}</dd></>}{p.rejectedReason && <><dt>Rejected because</dt><dd>{p.rejectedReason}</dd></>}
            {p.status === 'verified' && p.kind === 'payment' && <><dt>Allocated / on account</dt><dd><Money v={p.allocated} /> / <Money v={p.unallocated} /></dd></>}</dl>
          {p.allocations?.length > 0 && <Table><thead><tr><th>Fee</th><th className="right">Amount</th><th>Reason</th></tr></thead><tbody>{p.allocations.map((a, i) => <tr key={i}><td className="small">{a.feeId}</td><td className="right"><Money v={a.amount} /></td><td>{a.reason}</td></tr>)}</tbody></Table>}
          <div className="row mt">
            {p.status === 'pending' && p.kind === 'payment' && <><Btn variant="primary" onClick={() => setAct('verify')}>Verify…</Btn><Btn onClick={() => setAct('reject')}>Reject…</Btn></>}
            {p.status === 'verified' && p.kind === 'payment' && <><Btn onClick={() => setAct('reverse')}>Reverse…</Btn><Btn onClick={() => setAct('refund')}>Refund…</Btn>{p.unallocated > 0 && <Btn onClick={() => setAct('credit')}>Allocate credit…</Btn>}</>}
          </div>
          {act === 'verify' && <VerifyForm p={p} onClose={() => setAct(null)} onDone={done} />}
          {act === 'reject' && <ReasonForm title="Reject payment" action="payments.reject" p={p} label="Why is this being rejected?" okMsg="Payment rejected." danger onClose={() => setAct(null)} onDone={done} />}
          {act === 'reverse' && <ReasonForm title="Reverse payment" action="payments.reverse" p={p} confirm label="Reason for reversal" okMsg="Payment reversed; its receipt is revoked." danger onClose={() => setAct(null)} onDone={done} extra="This undoes all allocations and revokes the receipt. Use it for payments recorded in error." />}
          {act === 'refund' && <RefundForm p={p} onClose={() => setAct(null)} onDone={done} />}
          {act === 'credit' && <CreditForm p={p} onClose={() => setAct(null)} onDone={done} />}
        </>)}</Async>
    </Modal>
  );
}
function VerifyForm({ p, onClose, onDone }) {
  const [run, busy] = useAction(); const [note, setNote] = useState(''); const [ok, setOk] = useState(false); const [err, setErr] = useState('');
  const fees = useApi('fees.list', { studentId: p.studentId, pageSize: 100 });
  const open = (fees.data?.items || []).filter((x) => x.balance > 0 && x.status !== 'cancelled').sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const [manual, setManual] = useState(false); const [alloc, setAlloc] = useState({});
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    const allocations = manual ? Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([feeId, v]) => ({ feeId, amount: Number(v) })) : undefined;
    if (manual) { const t = allocations.reduce((s, a) => s + a.amount, 0); if (t > p.amount + 0.001) return setErr('Allocated amount exceeds the payment.'); }
    try { await run(() => api('payments.verify', { paymentId: p.paymentId, reconciliationNote: note, confirm: true, allocations }), (r) => 'Verified. Receipt ' + (r.receipt?.receiptNumber || '') + ' issued.'); onDone(); } catch (x) { setErr(x.message); }
  };
  return (
    <form onSubmit={submit} className="card mt"><h3>Verify this payment</h3>
      <p className="hint">Only verify after you have matched <strong><Money v={p.amount} /></strong> against your bank statement, UPI app or cash book. Verification applies the money to the oldest unpaid fees first (or as you choose), issues the receipt and cannot be silently undone.</p>
      <Field label="How did you check it? (required)"><input value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} maxLength={300} placeholder="e.g. Seen in HDFC statement 12 Oct, UTR matches" /></Field>
      <label className="field"><span className="lbl"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Choose which fees this pays (default: oldest first)</span></label>
      {manual && <Async q={fees}>{() => open.length === 0 ? <p className="muted">No unpaid fees — the full amount will be held as credit on account.</p> : open.map((x) => <Field key={x.feeId} label={x.billingPeriod + ' · balance ' + x.balance}><input type="number" min="0" step="0.01" max={x.balance} value={alloc[x.feeId] || ''} onChange={(e) => setAlloc({ ...alloc, [x.feeId]: e.target.value })} /></Field>)}</Async>}
      <label className="field"><span className="lbl"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I have checked this payment against bank / UPI / cash records.</span></label>
      {err && <p className="ferr" role="alert">{err}</p>}
      <div className="row"><Btn onClick={onClose} type="button">Cancel</Btn><Btn variant="primary" busy={busy} disabled={!ok} type="submit">Verify and issue receipt</Btn></div>
    </form>);
}
function ReasonForm({ title, action, p, label, okMsg, confirm, danger, onClose, onDone, extra }) {
  const [run, busy] = useAction(); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); try { await run(() => api(action, { paymentId: p.paymentId, reason, ...(confirm ? { confirm: true } : {}) }), okMsg); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <form onSubmit={submit} className="card mt"><h3>{title}</h3>{extra && <p className="hint">{extra}</p>}<Field label={label}><input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={200} /></Field>
      {err && <p className="ferr" role="alert">{err}</p>}<div className="row"><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant={danger ? 'danger' : 'primary'} busy={busy} type="submit">{title}</Btn></div></form>);
}
function RefundForm({ p, onClose, onDone }) {
  const [run, busy] = useAction(); const [f, set] = useForm({ amount: '', reason: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr(''); if (!(Number(f.amount) > 0)) return setErr('Enter the refund amount.');
    try { await run(() => api('payments.refund', { paymentId: p.paymentId, amount: Number(f.amount), reason: f.reason, confirm: true }), 'Refund recorded.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <form onSubmit={submit} className="card mt"><h3>Refund</h3><p className="hint">Records money you have given back. Unallocated credit is used first; any remainder is taken from the most recently allocated fees. The ledger records the refund — you still return the money yourself.</p>
      <Field label="Refund amount (₹)"><input type="number" step="0.01" min="0.01" max={p.amount} value={f.amount} onChange={set('amount')} required /></Field><Field label="Reason"><input value={f.reason} onChange={set('reason')} required minLength={5} maxLength={200} /></Field>
      {err && <p className="ferr" role="alert">{err}</p>}<div className="row"><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="danger" busy={busy} type="submit">Record refund</Btn></div></form>);
}
function CreditForm({ p, onClose, onDone }) {
  const [run, busy] = useAction(); const [err, setErr] = useState('');
  const fees = useApi('fees.list', { studentId: p.studentId, pageSize: 100 }); const [alloc, setAlloc] = useState({});
  const open = (fees.data?.items || []).filter((x) => x.balance > 0);
  const submit = async (e) => { e.preventDefault(); setErr(''); const allocations = Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([feeId, v]) => ({ feeId, amount: Number(v) })); if (!allocations.length) return setErr('Enter an amount for at least one fee.');
    try { await run(() => api('payments.allocateCredit', { paymentId: p.paymentId, allocations }), 'Credit allocated.'); onDone(); } catch (x) { setErr(x.message); } };
  return (
    <form onSubmit={submit} className="card mt"><h3>Allocate credit on account (<Money v={p.unallocated} /> available)</h3>
      <Async q={fees}>{() => open.length === 0 ? <p className="muted">No unpaid fees to allocate to.</p> : open.map((x) => <Field key={x.feeId} label={x.billingPeriod + ' · balance ' + x.balance}><input type="number" min="0" step="0.01" max={x.balance} value={alloc[x.feeId] || ''} onChange={(e) => setAlloc({ ...alloc, [x.feeId]: e.target.value })} /></Field>)}</Async>
      {err && <p className="ferr" role="alert">{err}</p>}<div className="row"><Btn type="button" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit">Allocate</Btn></div></form>);
}

/* ───────────── receipts ───────────── */
function ReceiptList() {
  const [page, setPage] = useState(1); const q = useApi('receipts.list', { page, pageSize: 25 });
  return (
    <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No receipts yet" hint="A receipt is issued automatically when you verify a payment." /> : (
      <>
        <Table><thead><tr><th>Receipt no.</th><th>Issued</th><th>Student</th><th className="right">Amount</th><th>Status</th><th /></tr></thead><tbody>
          {d.items.map((r) => (<tr key={r.receiptId}><td><strong>{r.receiptNumber}</strong></td><td>{fmtDateTime(r.issuedAt)}</td><td>{r.studentName}<div className="small muted">{r.studentId}</div></td><td className="right"><Money v={r.amount} /></td><td><Chip s={r.status === 'valid' ? 'valid' : r.status} /></td>
            <td>{r.status === 'valid' && <PdfActions kind="receipt" verificationId={r.verificationId} label="Receipt" />}</td></tr>))}
        </tbody></Table>
        <Pager data={d} onPage={setPage} />
      </>)}</Async>
  );
}

/* ───────────── ledger check ───────────── */
function LedgerCheck() {
  const q = useApi('ledger.reconcile', {});
  return (
    <Card title="Ledger consistency check" actions={<Btn onClick={q.reload}>Run again</Btn>}>
      <p className="hint">Checks that no payment is over-allocated, reversed payments net to zero, pending/rejected payments carry no allocations and every verified payment has exactly one valid receipt.</p>
      <Async q={q}>{(d) => (
        <>
          <p className={'banner ' + (d.ok ? '' : 'bad')} role="status">{d.ok ? '✓ All checks passed.' : '✕ Problems found — see below.'}</p>
          <ul>{d.checks.map((c, i) => <li key={i}>{c.ok ? '✓' : '✕'} {c.name}{!c.ok && <span className="muted small"> — e.g. {(c.detail || []).join(', ')}</span>}</li>)}</ul>
        </>)}</Async>
    </Card>
  );
}
