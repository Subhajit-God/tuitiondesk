import React, { useState } from 'react';
import { api } from '../../api.js';
import { Btn, Select, useUi } from '../../ui.jsx';
import { blobToBase64, buildPdf, downloadPdf, previewPdf } from '../../pdf/index.js';

/** Render an already-issued (or just-issued) document snapshot to PDF. Used by Teacher and Student screens.
 *  `doc` may be passed directly ({meta,snapshot,render}); otherwise it is fetched with `fetchAction`. */
export async function renderDoc(doc, opts) { return buildPdf(doc, opts); }

export function PdfActions({ verificationId, doc, fetchAction = 'documents.get', fetchParams, label = 'Document', teacher = true, defaults }) {
  const ui = useUi(); const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(defaults?.pageSize || ''); const [mode, setMode] = useState(defaults?.colorMode || '');
  const go = async (how) => {
    setBusy(how);
    try {
      const d = doc || await api(fetchAction, fetchParams || { verificationId });
      const r = await buildPdf(d, { pageSize: size || undefined, colorMode: mode || undefined });
      if (how === 'download') downloadPdf(r.blob, r.fileName); else if (how === 'view') previewPdf(r.blob);
      else if (how === 'store') { await api('documents.attachFile', { verificationId: d.meta.verificationId, base64: await blobToBase64(r.blob) }); ui.ok('Saved to the documents folder in Google Drive.'); }
    } catch (e) { ui.err(e); } finally { setBusy(false); }
  };
  return (
    <span className="pdfact">
      <Select aria-label="Paper size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size: default" options={[['A4', 'A4'], ['A5', 'A5']]} style={{ width: 'auto', minHeight: 36 }} />
      <Select aria-label="Colour mode" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="Colour: default" options={[['colour', 'Colour'], ['bw', 'Black & white']]} style={{ width: 'auto', minHeight: 36 }} />
      <Btn className="small" busy={busy === 'view'} disabled={!!busy} onClick={() => go('view')}>Preview {label}</Btn>
      <Btn className="small" busy={busy === 'download'} disabled={!!busy} onClick={() => go('download')}>Download PDF</Btn>
      {teacher && <Btn className="small" busy={busy === 'store'} disabled={!!busy} onClick={() => go('store')}>Save to Drive</Btn>}
    </span>
  );
}
