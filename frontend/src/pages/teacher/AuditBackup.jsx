import React, { useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Chip, Empty, Field, Modal, Page, Pager, SearchBar, Table, Tabs, useAction, useApi, useUi } from '../../ui.jsx';
import { asText, fmtDateTime } from '../../util.js';

export default function AuditBackup() {
  const [tab, setTab] = useState('audit');
  return <Page title="Audit Logs & Backups"><Tabs value={tab} onChange={setTab} tabs={[['audit', 'Audit log'], ['backup', 'Backups & restore test']]} />{tab === 'audit' ? <Audit /> : <Backups />}</Page>;
}
function Audit() {
  const [f, setF] = useState({ search: '', action: '', from: '', to: '', page: 1 }); const q = useApi('audit.list', { ...f, pageSize: 30 });
  return (
    <>
      <div className="row"><Field label="Search"><SearchBar value={f.search} onChange={(v) => setF((x) => ({ ...x, search: v, page: 1 }))} /></Field><Field label="Action starts with"><input value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })} placeholder="payment., fee., login…" /></Field><Field label="From"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} /></Field><Field label="To"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} /></Field></div>
      <Async q={q}>{(d) => d.items.length === 0 ? <Empty title="No audit entries match" /> : (
        <><Table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>
          {d.items.map((a) => <tr key={a.auditId}><td className="small">{fmtDateTime(a.at)}</td><td className="small">{a.actorRole}<div className="muted">{a.actorUserId}</div></td><td><strong>{a.action}</strong></td><td className="small">{a.entityType}<div className="muted">{a.entityId}</div></td><td className="small" style={{ wordBreak: 'break-word', maxWidth: 340 }}>{asText(a.details)}</td></tr>)}
        </tbody></Table><Pager data={d} onPage={(p) => setF({ ...f, page: p })} /></>)}</Async>
      <p className="hint">The audit log is append-only. Passwords, tokens and secrets are never written to it.</p>
    </>
  );
}
function Backups() {
  const q = useApi('backup.list', { pageSize: 30 }); const [run, busy] = useAction(); const ui = useUi(); const [restore, setRestore] = useState(null);
  const backup = async () => { try { const r = await run(() => api('backup.run', {}), (r) => r.ok ? 'Backup created and checksums match.' : 'Backup created but verification mismatched.'); q.reload(); return r; } catch { /* toast */ } };
  const verify = async (b) => { try { const r = await run(() => api('backup.verify', { backupId: b.backupId }), null); if (r.ok) ui.ok('Backup verified: row counts and checksums match.'); else ui.err('Backup does NOT match: ' + JSON.stringify(r.mismatched)); q.reload(); } catch { /* toast */ } };
  return (
    <Async q={q}>{(d) => (
      <>
        {!d.configured && <p className="banner bad">No backup folder is configured. Run setupDatabase() in Apps Script or set BACKUP_FOLDER_ID.</p>}
        <Card title="Status" actions={<Btn variant="primary" busy={busy} disabled={!d.configured} onClick={backup}>Back up now</Btn>}>
          <p>Last good backup: <strong>{d.lastBackup ? fmtDateTime(d.lastBackup.finishedAt || d.lastBackup.startedAt) : 'none yet'}</strong></p>
          <p>Last restore test: <strong>{d.lastRestoreTest ? fmtDateTime(d.lastRestoreTest.finishedAt || d.lastRestoreTest.startedAt) + (d.lastRestoreTest.ok ? ' — passed' : ' — FAILED') : 'never run'}</strong></p>
          <p className="hint">A backup you have never restored is only a hope. Run a restore test regularly: it copies a backup into a <em>separate, empty</em> spreadsheet, compares every table and checks that the fee ledger still reconciles. It never touches live data.</p>
        </Card>
        {d.items.length === 0 ? <Empty title="No backups yet" /> : <Table><thead><tr><th>When</th><th>Kind</th><th>Result</th><th>File</th><th /></tr></thead><tbody>
          {d.items.map((b) => <tr key={b.backupId}><td className="small">{fmtDateTime(b.startedAt)}</td><td>{b.kind === 'restore_test' ? 'restore test' : 'backup'}</td><td><Chip s={b.ok ? 'confirmed' : b.status === 'expired' ? 'expired' : 'failed'} label={b.status === 'expired' ? 'expired' : b.ok ? 'ok' : 'failed'} /></td><td className="small">{b.fileName}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{b.kind === 'backup' && b.status === 'ok' && <><Btn className="small" onClick={() => verify(b)}>Verify</Btn> <Btn className="small" onClick={() => setRestore(b)}>Restore test…</Btn></>}</td></tr>)}
        </tbody></Table>}
        {restore && <RestoreTest b={restore} onClose={() => { setRestore(null); q.reload(); }} />}
      </>)}</Async>
  );
}
function RestoreTest({ b, onClose }) {
  const [id, setId] = useState(''); const [run, busy] = useAction(); const [res, setRes] = useState(null); const [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); setErr(''); try { setRes(await run(() => api('backup.restoreTest', { backupId: b.backupId, targetSpreadsheetId: id.trim() }))); } catch (x) { setErr(x.message); } };
  return (
    <Modal title="Restore test" onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <p>Backup: <strong>{b.fileName}</strong></p>
      <form onSubmit={go}><Field label="ID of an EMPTY spreadsheet to restore into" hint="Create a blank Google Sheet, copy its ID from the address bar (the long text between /d/ and /edit). It must not be your live database."><input value={id} onChange={(e) => setId(e.target.value)} required /></Field>
        {err && <p className="ferr" role="alert">{err}</p>}<Btn variant="primary" busy={busy} type="submit">Run restore test</Btn></form>
      {res && <p className={'banner ' + (res.ok ? '' : 'bad')} role="status">{res.ok ? '✓ Restore test passed' : '✕ Restore test FAILED'} — {res.tables} tables compared; ledger {res.ledgerReconciles ? 'reconciles' : 'does NOT reconcile'}.{res.mismatched?.length > 0 && ' Mismatches: ' + JSON.stringify(res.mismatched)}</p>}
    </Modal>
  );
}
