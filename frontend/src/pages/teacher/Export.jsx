import React, { useState } from 'react';
import { Btn, Card, Field, Page, useUi } from '../../ui.jsx';
import { fetchDataset, saveCsv, saveXlsx } from '../../export.js';
import { api } from '../../api.js';

const SETS = [
  ['students', 'Students', 'Every student with guardian contact, batches, login status and notes.', false],
  ['fees', 'Fees', 'Every fee obligation with adjustments, verified payments, balance and status. The range filters on due date.', true],
  ['payments', 'Payments', 'Every payment, refund and reversal with its verification status and receipt number. The range filters on date received.', true],
  ['attendance', 'Attendance', 'One row per student per session (P / A / H) with corrections. The range filters on session date.', true],
];

export default function Export() {
  const ui = useUi(); const [range, setRange] = useState({ from: '', to: '' }); const [busy, setBusy] = useState(''); const [progress, setProgress] = useState('');
  const centre = React.useRef('');
  const load = async (key) => { const ds = await fetchDataset(key, SETS.find((s) => s[0] === key)[3] ? range : {}, (n, t) => setProgress(`${key}: ${n} of ${t} rows`)); centre.current = ds.centreName; return ds; };
  const run = async (id, fn) => { setBusy(id); setProgress(''); try { await fn(); ui.ok('Download started.'); } catch (e) { ui.err(e); } finally { setBusy(''); setProgress(''); } };
  const csv = (k) => run(k + 'csv', async () => { const ds = await load(k); saveCsv(ds, centre.current); });
  const xlsx = (k) => run(k + 'xlsx', async () => { const ds = await load(k); saveXlsx([ds], centre.current); });
  const all = () => run('all', async () => { const out = []; for (const [k] of SETS) out.push(await load(k)); saveXlsx(out, centre.current, 'all-data'); });
  return (
    <Page title="Data Export">
      <p className="banner">Your data is yours. Download it any time as Excel (<strong>.xlsx</strong>) or <strong>CSV</strong>. Files contain personal information (names, guardian phone numbers, fees): store them safely and delete copies you no longer need. Each export is recorded in the audit log (what and how many rows, never the data).</p>
      <Card title="Date range (optional)"><div className="row"><Field label="From"><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field><Field label="To"><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field><Btn onClick={() => setRange({ from: '', to: '' })}>All dates</Btn></div><p className="hint">Leave empty to export everything. Does not apply to Students.</p></Card>
      <Card title="Everything in one workbook"><p>One Excel file with a sheet each for students, fees, payments and attendance. This is the most complete backup of your records in a format any spreadsheet program can open.</p><Btn variant="primary" busy={busy === 'all'} disabled={!!busy} onClick={all}>Download everything (Excel)</Btn></Card>
      {SETS.map(([k, label, desc]) => (
        <Card key={k} title={label}><p className="small muted">{desc}</p><div className="row"><Btn busy={busy === k + 'xlsx'} disabled={!!busy} onClick={() => xlsx(k)}>Excel</Btn><Btn busy={busy === k + 'csv'} disabled={!!busy} onClick={() => csv(k)}>CSV</Btn></div></Card>))}
      {progress && <p className="muted" role="status">Fetching {progress}…</p>}
      <p className="hint">CSV files open correctly in Excel and Google Sheets (UTF-8). Text that begins with = + - or @ gets a leading apostrophe so a spreadsheet can never run it as a formula; the Excel files store such text unchanged. This is a data export, not a restorable backup: use Backups for that.</p>
    </Page>
  );
}
