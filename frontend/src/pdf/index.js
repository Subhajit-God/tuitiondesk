// Official-document PDF renderer. A4 / A5 only. Colour or black-and-white. Vector QR + PDF417 verification codes.
// The "magnetic-ink-inspired" look is a purely visual motif (monospace document line + fine guilloche rule); it is NOT MICR.
import { PDFDocument, StandardFonts, rgb, grayscale, degrees } from 'pdf-lib';
import { encodeQR } from './qr.js';
import { encodePDF417 } from './pdf417.js';
import { getConfig } from '../api.js';

const MM = 72 / 25.4;
export const PAGE = { A4: [595.28, 841.89], A5: [419.53, 595.28] };

export function verifyUrl(id, base) {
  const b = (base || getConfig().publicUrl || (typeof location !== 'undefined' ? location.origin + location.pathname : '')).replace(/#.*$/, '');
  return `${b}${b.endsWith('/') || b === '' ? '' : ''}#/verify/${id}`;
}
const fmtMoney = (n) => 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };

export async function buildPdf(doc, opts = {}) {
  const { meta, snapshot: snap, render: rc } = doc;
  const pageSize = opts.pageSize || rc.pageSize || 'A4';
  if (!PAGE[pageSize]) throw new Error('Only A4 and A5 are supported');
  const mode = opts.colorMode || rc.colorMode || 'colour', bw = mode === 'bw';
  const [PW, PH] = PAGE[pageSize], small = pageSize === 'A5';
  const M = (small ? 12 : 15) * MM, contentW = PW - 2 * M;
  const pdf = await PDFDocument.create();
  const F = await pdf.embedFont(StandardFonts.Helvetica), FB = await pdf.embedFont(StandardFonts.HelveticaBold), FM = await pdf.embedFont(StandardFonts.Courier);
  const chars = new Set(F.getCharacterSet());
  const clean = (t) => String(t === null || t === undefined ? '' : t).replace(/₹/g, 'Rs.').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[→➔]/g, '->').replace(/\r?\n/g, ' ')
    .split('').map((ch) => (ch === ' ' || chars.has(ch.codePointAt(0)) ? ch : '?')).join('');
  const COL = { ink: bw ? grayscale(0) : rgb(0.11, 0.14, 0.19), brand: bw ? grayscale(0) : rgb(0.12, 0.23, 0.37), muted: bw ? grayscale(0.35) : rgb(0.36, 0.4, 0.47), rule: bw ? grayscale(0.55) : rgb(0.62, 0.68, 0.78), head: bw ? grayscale(0.88) : rgb(0.91, 0.94, 0.98), zebra: bw ? grayscale(0.96) : rgb(0.97, 0.98, 1), white: bw ? grayscale(1) : rgb(1, 1, 1), wm: bw ? grayscale(0.5) : rgb(0.12, 0.23, 0.37) };
  const centre = clean(rc.centreName);
  const url = verifyUrl(meta.verificationId, opts.publicBaseUrl || rc.publicBaseUrl);
  const topY = PH - M, headerH = (small ? 17 : 20) * MM, footerH = 9 * MM, bottomLimit = M + footerH;
  const wm = rc.watermark || {};
  const pages = [];
  let page, y;

  const widthOf = (t, f, s) => f.widthOfTextAtSize(t, s);
  function wrap(text, f, s, maxW) {
    const out = []; const words = clean(text).split(' ');
    let line = '';
    for (let w of words) {
      while (widthOf(w, f, s) > maxW) { let cut = w.length; while (cut > 1 && widthOf(w.slice(0, cut), f, s) > maxW) cut--; if (line) { out.push(line); line = ''; } out.push(w.slice(0, cut)); w = w.slice(cut); }
      const t = line ? line + ' ' + w : w;
      if (widthOf(t, f, s) <= maxW) line = t; else { out.push(line); line = w; }
    }
    if (line || !out.length) out.push(line);
    return out;
  }
  function drawWatermark(p) {
    if (!wm.enabled || !wm.text) return;
    const text = clean(wm.text), size = wm.size || 48, op = wm.opacity || 0.08, tw = widthOf(text, FB, size);
    const common = { font: FB, size, color: COL.wm, opacity: op };
    const reserveBottom = bottomLimit + 38 * MM; // never overlaps the code block / footer
    if (wm.position === 'diagonal') { const a = 35 * Math.PI / 180; p.drawText(text, { ...common, x: PW / 2 - (tw / 2) * Math.cos(a) + (size / 3) * Math.sin(a), y: PH / 2 - (tw / 2) * Math.sin(a) - (size / 3) * Math.cos(a), rotate: degrees(35) }); }
    else if (wm.position === 'top') p.drawText(text, { ...common, x: (PW - tw) / 2, y: topY - headerH - 30 * MM });
    else if (wm.position === 'bottom') p.drawText(text, { ...common, x: (PW - tw) / 2, y: reserveBottom + size * 0.3 });
    else p.drawText(text, { ...common, x: (PW - tw) / 2, y: PH / 2 });
  }
  function newPage() {
    page = pdf.addPage([PW, PH]); pages.push(page); drawWatermark(page);
    // header: centre name (+ teacher name if enabled), guilloche rule
    page.drawText(centre, { x: M, y: topY - 14, size: small ? 13 : 16, font: FB, color: COL.brand, maxWidth: contentW });
    const sub = [rc.centreAddress, rc.centrePhone].filter(Boolean).map(clean).join('  |  ');
    if (sub) page.drawText(sub.length > 90 ? sub.slice(0, 90) : sub, { x: M, y: topY - 14 - (small ? 11 : 13), size: 7.5, font: F, color: COL.muted });
    if (rc.teacherName) { const t = 'Teacher: ' + clean(rc.teacherName); page.drawText(t, { x: PW - M - widthOf(t, F, 9), y: topY - 12, size: 9, font: F, color: COL.ink }); }
    const gy = topY - headerH + 4;
    for (let x = 0; x < contentW; x += 2) { const a = Math.sin(x / 9) * 1.6, b = Math.sin(x / 9 + 1.7) * 1.6; page.drawLine({ start: { x: M + x, y: gy + a }, end: { x: M + x + 2, y: gy + Math.sin((x + 2) / 9) * 1.6 }, thickness: 0.3, color: COL.rule }); page.drawLine({ start: { x: M + x, y: gy + b }, end: { x: M + x + 2, y: gy + Math.sin((x + 2) / 9 + 1.7) * 1.6 }, thickness: 0.3, color: COL.rule }); }
    y = topY - headerH - 4;
  }
  const ensure = (h) => { if (y - h < bottomLimit) newPage(); };

  newPage();
  // title block
  const tSize = small ? 15 : 18;
  page.drawText(clean(snap.title), { x: M, y: y - tSize, size: tSize, font: FB, color: COL.ink, maxWidth: contentW }); y -= tSize + 5;
  if (snap.subtitle) for (const l of wrap(snap.subtitle, F, 10, contentW)) { page.drawText(l, { x: M, y: y - 10, size: 10, font: F, color: COL.muted }); y -= 13; }
  const metaLine = clean(`${meta.documentNumber}  |  v${meta.version}  |  issued ${fmtDate(meta.issuedAt)}`);
  page.drawText(metaLine, { x: M, y: y - 9, size: 8.5, font: FM, color: COL.ink }); y -= 16;

  const fontSize = small ? 8.5 : 9.5;
  const cellText = (v) => (v && typeof v === 'object' && 'm' in v ? fmtMoney(v.m) : clean(v));

  function drawKV(b) {
    if (b.title) { ensure(24); page.drawText(clean(b.title), { x: M, y: y - 11, size: 11, font: FB, color: COL.brand }); y -= 18; }
    const lw = contentW * 0.36;
    for (const [k, v] of b.rows) {
      const lines = wrap(cellText(v), F, fontSize, contentW - lw - 6), h = Math.max(lines.length, 1) * (fontSize + 3) + 2;
      ensure(h); page.drawText(clean(k), { x: M, y: y - fontSize, size: fontSize - 0.5, font: F, color: COL.muted, maxWidth: lw - 4 });
      lines.forEach((l, i) => page.drawText(l, { x: M + lw, y: y - fontSize - i * (fontSize + 3), size: fontSize, font: FB, color: COL.ink }));
      y -= h;
    }
    y -= 6;
  }
  function drawTable(b) {
    if (b.title) { ensure(40); page.drawText(clean(b.title), { x: M, y: y - 11, size: 11, font: FB, color: COL.brand }); y -= 18; }
    const cols = b.columns, ts = fontSize - 0.5, pad = 3;
    if (!b.rows.length) { ensure(16); page.drawText('No records.', { x: M, y: y - 10, size: ts, font: F, color: COL.muted }); y -= 18; return; }
    const lens = cols.map((c, i) => Math.min(34, Math.max(clean(c.label).length, ...b.rows.slice(0, 80).map((r) => cellText(r[i]).length), 4)));
    const tot = lens.reduce((a, c) => a + c, 0), widths = lens.map((l) => (l / tot) * contentW);
    const header = () => { ensure(22); page.drawRectangle({ x: M, y: y - 14, width: contentW, height: 14, color: COL.head }); let x = M; cols.forEach((c, i) => { const t = clean(c.label); const w = widthOf(t, FB, ts - 0.5); page.drawText(t, { x: c.a === 'r' ? x + widths[i] - pad - w : x + pad, y: y - 10.5, size: ts - 0.5, font: FB, color: COL.ink }); x += widths[i]; }); y -= 14; };
    header();
    b.rows.forEach((row, ri) => {
      const cells = row.map((v, i) => wrap(cellText(cols[i].f === 'money' && typeof v === 'number' ? { m: v } : v), F, ts, widths[i] - 2 * pad).slice(0, 3));
      const h = Math.max(...cells.map((c) => c.length)) * (ts + 2.5) + 5;
      if (y - h < bottomLimit) { newPage(); header(); }
      if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: COL.zebra });
      let x = M;
      cells.forEach((lines, i) => { lines.forEach((l, li) => { const w = widthOf(l, F, ts); page.drawText(l, { x: cols[i].a === 'r' ? x + widths[i] - pad - w : x + pad, y: y - ts - 1.5 - li * (ts + 2.5), size: ts, font: F, color: COL.ink }); }); x += widths[i]; });
      page.drawLine({ start: { x: M, y: y - h }, end: { x: M + contentW, y: y - h }, thickness: 0.4, color: COL.rule });
      y -= h;
    });
    if (b.footnote) { ensure(14); page.drawText(clean(b.footnote), { x: M, y: y - 9, size: 7.5, font: F, color: COL.muted }); y -= 14; }
    y -= 8;
  }
  function drawText(b) {
    if (b.title) { ensure(24); page.drawText(clean(b.title), { x: M, y: y - 11, size: 11, font: FB, color: COL.brand }); y -= 18; }
    for (const l of wrap(b.text, F, fontSize + 0.5, contentW)) { ensure(14); page.drawText(l, { x: M, y: y - fontSize, size: fontSize + 0.5, font: F, color: COL.ink }); y -= fontSize + 5; }
    y -= 6;
  }
  function drawSignatures(b) {
    ensure(40); y -= 22; const w = Math.min(60 * MM, (contentW - 10 * MM) / Math.max(b.labels.length, 1));
    b.labels.forEach((l, i) => { const x = M + i * (w + 10 * MM); page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: COL.ink }); page.drawText(clean(l), { x, y: y - 10, size: 8, font: F, color: COL.muted }); });
    y -= 22;
  }
  function drawCards(b) {
    const cw = 85.6 * MM, ch = 54 * MM, gap = 5 * MM, perRow = Math.max(1, Math.floor((contentW + gap) / (cw + gap)));
    for (let i = 0; i < b.cards.length; i += perRow) {
      ensure(ch + gap);
      b.cards.slice(i, i + perRow).forEach((c, j) => {
        const x = M + j * (cw + gap), top = y;
        page.drawRectangle({ x, y: top - ch, width: cw, height: ch, borderColor: COL.ink, borderWidth: 0.8, color: COL.white });
        page.drawRectangle({ x, y: top - 13 * MM, width: cw, height: 13 * MM, color: COL.brand });
        page.drawText(centre, { x: x + 3 * MM, y: top - 8 * MM, size: 10, font: FB, color: COL.white, maxWidth: cw - 6 * MM });
        page.drawText(clean(c.name), { x: x + 4 * MM, y: top - 21 * MM, size: 12.5, font: FB, color: COL.ink, maxWidth: cw - 8 * MM });
        page.drawText('ID: ' + clean(c.studentId), { x: x + 4 * MM, y: top - 28 * MM, size: 10, font: FM, color: COL.ink });
        wrap('Batch: ' + c.batches, F, 8.5, cw - 8 * MM).slice(0, 2).forEach((l, k) => page.drawText(l, { x: x + 4 * MM, y: top - 34 * MM - k * 11, size: 8.5, font: F, color: COL.ink }));
        page.drawText('Admitted: ' + fmtDate(c.admissionDate), { x: x + 4 * MM, y: top - ch + 4 * MM, size: 7.5, font: F, color: COL.muted });
        page.drawText('Teacher sign.', { x: x + cw - 24 * MM, y: top - ch + 4 * MM, size: 7, font: F, color: COL.muted });
      });
      y -= ch + gap;
    }
  }
  for (const b of snap.blocks) ({ kv: drawKV, table: drawTable, text: drawText, signatures: drawSignatures, cards: drawCards }[b.type] || (() => {}))(b);

  // verification code block (last page): white backing so the watermark can never sit on the codes
  const qrM = qrModules(url), qrSize = (small ? 24 : 27) * MM, qrCell = qrSize / qrM.length;
  const p417 = encodePDF417(meta.verificationId), modW = (small ? 0.42 : 0.5) * MM, rowH = modW * 3.2;
  const p417W = p417.matrix[0].length * modW, p417H = p417.rows * rowH, quiet = 3 * MM;
  const blockH = Math.max(qrSize, p417H) + 2 * quiet + 24;
  ensure(blockH + 6);
  const by = Math.max(y - blockH, bottomLimit);
  page.drawRectangle({ x: M, y: by, width: contentW, height: blockH, color: COL.white, borderColor: COL.rule, borderWidth: 0.5 });
  page.drawText('Scan to verify this document', { x: M + quiet, y: by + blockH - 11, size: 8.5, font: FB, color: COL.ink });
  const qx = M + quiet, qy = by + quiet + 10;
  qrM.forEach((row, r) => row.forEach((d, c) => { if (d) page.drawRectangle({ x: qx + c * qrCell, y: qy + (qrM.length - 1 - r) * qrCell, width: qrCell, height: qrCell, color: grayscale(0) }); }));
  const px = Math.min(qx + qrSize + 7 * MM, M + contentW - p417W - quiet), py = by + quiet + 10;
  p417.matrix.forEach((row, r) => { let c = 0; while (c < row.length) { if (!row[c]) { c++; continue; } let e = c; while (e < row.length && row[e]) e++; page.drawRectangle({ x: px + c * modW, y: py + (p417.rows - 1 - r) * rowH, width: (e - c) * modW, height: rowH, color: grayscale(0) }); c = e; } });
  page.drawText('Verification ID: ' + meta.verificationId, { x: M + quiet, y: by + 5, size: 6.5, font: FM, color: COL.ink });
  page.drawText('QR / PDF417 contain only this random ID — no personal data.', { x: M + quiet, y: by + blockH - 20, size: 6.5, font: F, color: COL.muted, maxWidth: contentW - 2 * quiet });
  y = by - 4;

  // footers
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + footerH - 3 }, end: { x: PW - M, y: M + footerH - 3 }, thickness: 0.4, color: COL.rule });
    p.drawText(centre, { x: M, y: M + 6, size: 7.5, font: FB, color: COL.muted, maxWidth: contentW * 0.6 });
    const t = `${meta.documentNumber}  |  Page ${i + 1} of ${pages.length}`; p.drawText(clean(t), { x: PW - M - widthOf(clean(t), FM, 7), y: M + 6, size: 7, font: FM, color: COL.muted });
  });
  pdf.setTitle(clean(snap.title) + ' - ' + meta.documentNumber); pdf.setAuthor(centre); pdf.setCreator('TuitionDesk'); pdf.setProducer('TuitionDesk'); pdf.setSubject('Verification ID ' + meta.verificationId);
  const bytes = await pdf.save();
  return { bytes, blob: new Blob([bytes], { type: 'application/pdf' }), fileName: `${meta.documentNumber}_v${meta.version}.pdf`.replace(/[^A-Za-z0-9_.\-]/g, '_'), pages: pages.length, verifyUrl: url, pageSize, colorMode: mode };
}

function qrModules(text) { return encodeQR(text); }

export function downloadPdf(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
export function previewPdf(blob) { const u = URL.createObjectURL(blob); const w = window.open(u, '_blank'); if (!w) downloadPdf(blob, 'document.pdf'); setTimeout(() => URL.revokeObjectURL(u), 60000); }
export async function blobToBase64(blob) { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }
