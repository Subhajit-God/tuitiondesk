import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Chip, Empty, Field, Modal, Money, Page, Table, useAction, useApi, useForm } from '../../ui.jsx';

const CYCLES = [['monthly', 'Monthly (every month)'], ['quarterly', 'Quarterly (every 3 months, billed in advance)'], ['annual', 'Annual (every 12 months, billed in advance)']];

export default function Plans() {
  const q = useApi('plans.list', { includeArchived: true }); const fam = useApi('plans.families', {}); const [edit, setEdit] = useState(null); const [run] = useAction();
  const archive = async (p) => { try { await run(() => api('plans.update', { planId: p.planId, status: p.status === 'active' ? 'archived' : 'active' }), 'Plan updated.'); q.reload(); } catch { /* toast */ } };
  return (
    <Page title="Fee plans" actions={<Btn variant="primary" onClick={() => setEdit({})}>+ New plan</Btn>}>
      <p className="hint">A plan is a price list: monthly fee, how often you bill (monthly, quarterly, annual) and a one-time admission fee. Give a plan to a student on their profile. A student’s own “monthly fee” overrides the plan. Fees are generated from the admission month to the leaving month.</p>
      <Async q={q}>{(d) => d.length === 0 ? <Empty title="No plans yet" hint="Without a plan, the default monthly fee in Settings is used."><Btn variant="primary" onClick={() => setEdit({})}>Create a plan</Btn></Empty> : (
        <Table><thead><tr><th>Plan</th><th>Monthly fee</th><th>Billing</th><th>Admission fee</th><th>Students</th><th>Status</th><th /></tr></thead><tbody>
          {d.map((p) => <tr key={p.planId}><td><strong>{p.name}</strong>{p.note && <div className="small muted">{p.note}</div>}</td><td><Money v={p.monthlyFee} /></td><td>{p.cycle}</td><td>{p.admissionFee ? <Money v={p.admissionFee} /> : '—'}</td><td className="num">{p.students}</td><td><Chip s={p.status === 'active' ? 'active' : 'inactive'} label={p.status} /></td>
            <td style={{ whiteSpace: 'nowrap' }}><Btn className="small" onClick={() => setEdit(p)}>Edit</Btn> <Btn className="small" onClick={() => archive(p)}>{p.status === 'active' ? 'Archive' : 'Restore'}</Btn></td></tr>)}
        </tbody></Table>)}</Async>
      <Card title="Sibling discounts">
        <p className="hint">Children with the same guardian WhatsApp number are siblings. The eldest (by admission date) pays in full; the others get the percentage set in Settings → Fee plans, late fees &amp; credit, shown as a visible discount line on each fee. Discounts are not applied retroactively.</p>
        <Async q={fam}>{(d) => d.length === 0 ? <p className="muted">No families with more than one active child.</p> : d.map((f) => (
          <p key={f.guardianWhatsapp}>+{f.guardianWhatsapp}: {f.children.map((c) => c.fullName + (c.exempt ? ' (opted out)' : c.discountPct ? ' (' + c.discountPct + '% off)' : ' (full fee)')).join(', ')}</p>))}</Async>
      </Card>
      {edit && <PlanForm plan={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); fam.reload(); }} />}
    </Page>
  );
}

function PlanForm({ plan, onClose, onSaved }) {
  const isNew = !plan.planId; const [run, busy] = useAction(); const [err, setErr] = useState('');
  const [f, set] = useForm({ name: plan.name || '', monthlyFee: plan.monthlyFee || '', cycle: plan.cycle || 'monthly', admissionFee: plan.admissionFee || 0, note: plan.note || '' });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!(Number(f.monthlyFee) > 0)) return setErr('Enter the monthly fee.');
    try { await run(() => api(isNew ? 'plans.create' : 'plans.update', { ...(isNew ? {} : { planId: plan.planId }), name: f.name.trim(), monthlyFee: Number(f.monthlyFee), cycle: f.cycle, admissionFee: Number(f.admissionFee) || 0, note: f.note }), isNew ? 'Plan created.' : 'Plan updated.'); onSaved(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={isNew ? 'New fee plan' : 'Edit fee plan'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} type="submit" form="planform">Save plan</Btn></>}>
      <form id="planform" onSubmit={submit} className="formgrid">
        <Field label="Plan name" wide><input value={f.name} onChange={set('name')} required minLength={2} maxLength={60} autoFocus /></Field>
        <Field label="Monthly fee (₹)"><input type="number" min="1" step="0.01" value={f.monthlyFee} onChange={set('monthlyFee')} required /></Field>
        <Field label="Billing cycle"><select value={f.cycle} onChange={set('cycle')}>{CYCLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="One-time admission fee (₹)" hint="Charged once, in the admission month. 0 = none."><input type="number" min="0" step="0.01" value={f.admissionFee} onChange={set('admissionFee')} /></Field>
        <Field label="Note" wide><input value={f.note} onChange={set('note')} maxLength={200} /></Field>
        {err && <p className="ferr wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}
