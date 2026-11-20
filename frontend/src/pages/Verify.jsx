import React, { useEffect, useState } from 'react';
import { verifyDocument } from '../api.js';
import { ErrorBox, Loading } from '../ui.jsx';
import { fmtDate } from '../util.js';

/** Public verification page: shows ONLY document type, issuing centre, issue date/version and validity status. */
export default function Verify({ id }) {
  const [r, setR] = useState(null); const [err, setErr] = useState(null);
  const load = () => { setErr(null); setR(null); verifyDocument(id || '').then(setR).catch(setErr); };
  useEffect(load, [id]);
  const label = { valid: '✓ Valid document', revoked: '⊘ Revoked — do not accept', invalid: '? Not recognised' };
  return (
    <main className="vcard"><h1 style={{ textAlign: 'center', color: 'var(--brand)' }}>Document verification</h1>
      {err ? <ErrorBox error={err} onRetry={load} /> : !r ? <Loading label="Checking…" /> : (
        <div className="card">
          <div className={'vstatus ' + r.status} role="status">{label[r.status]}</div>
          {r.status !== 'invalid' ? (
            <dl className="kv mt"><dt>Document</dt><dd>{r.docType}</dd><dt>Issued by</dt><dd>{r.centreName}</dd><dt>Issue date</dt><dd>{fmtDate(r.issueDate)}</dd><dt>Version</dt><dd>{r.version}{r.isLatest === false ? ' (a newer version has been issued)' : ''}</dd>{r.documentNumber && <><dt>Document no.</dt><dd>{r.documentNumber}</dd></>}</dl>
          ) : <p className="muted mt">This code does not match any document issued by this system. The document may be forged or the code damaged.</p>}
          <p className="hint mt">For privacy, no student, fee or marks information is shown here.</p>
        </div>)}
    </main>
  );
}
