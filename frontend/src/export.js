// CSV and Excel (.xlsx) writers. No dependencies: the .xlsx is a small hand-built OOXML package in an uncompressed ZIP.
import { api } from './api.js';
import { downloadBlob, todayStr } from './util.js';

/** Fetch every page of a dataset (the server pages at 1000 rows so nothing is ever silently cut). */
export async function fetchDataset(dataset, { from, to } = {}, onProgress) {
  let page = 1, pages = 1, all = [], first = null;
  do {
    const d = await api('export.get', { dataset, page, from: from || undefined, to: to || undefined });
    first = first || d; pages = d.pages; all = all.concat(d.rows); onProgress?.(all.length, d.total); page++;
  } while (page <= pages);
  if (all.length !== first.total) throw new Error(`Export incomplete: expected ${first.total} rows but received ${all.length}. Nothing was saved; please try again.`);
  return { dataset, label: first.label, columns: first.columns, rows: all, centreName: first.centreName, generatedAt: first.generatedAt };
}

export const slug = (s) => String(s || 'tuitiondesk').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tuitiondesk';
export const fileBase = (ds, centre) => `${slug(centre)}-${ds}-${todayStr()}`;

/* ───────── CSV ───────── */
// Cells that a spreadsheet could execute as a formula get a leading apostrophe (OWASP CSV-injection guidance). Numbers are untouched.
const guard = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = String(guard(v)); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCsv(ds) {
  const lines = [ds.columns.map(csvCell).join(',')].concat(ds.rows.map((r) => r.map(csvCell).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 (names, ₹) correctly
}
export const csvBlob = (ds) => new Blob([toCsv(ds)], { type: 'text/csv;charset=utf-8' });

/* ───────── XLSX ───────── */
const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** ZIP with "stored" (no compression) entries. files: [{name, data(Uint8Array)}] */
export function zipStore(files) {
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    parts.push(local, name, f.data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const sheetName = (s, used) => { let n = String(s).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'; let k = 2, base = n; while (used.has(n.toLowerCase())) n = base.slice(0, 28) + ' ' + k++; used.add(n.toLowerCase()); return n; };

function sheetXml(ds) {
  const widths = ds.columns.map((c, i) => Math.min(60, Math.max(8, String(c).length + 2, ...ds.rows.slice(0, 300).map((r) => String(r[i] ?? '').length + 2))));
  const cell = (v, r, c, header) => {
    const ref = colName(c) + r;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`; // text is always text: IDs and phone numbers keep their zeros, nothing becomes a formula or date
  };
  const head = `<row r="1">${ds.columns.map((c, i) => cell(c, 1, i, true)).join('')}</row>`;
  const body = ds.rows.map((row, ri) => `<row r="${ri + 2}">${row.map((v, ci) => cell(v, ri + 2, ci, false)).join('')}</row>`).join('');
  const last = colName(Math.max(ds.columns.length - 1, 0)) + (ds.rows.length + 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

/** datasets: [{label, columns, rows}] -> one workbook with one sheet each. */
export function xlsxBlob(datasets) {
  const used = new Set(), names = datasets.map((d) => sheetName(d.label, used));
  const f = (name, text) => ({ name, data: enc.encode(text) });
  const files = [
    f('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${datasets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    f('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${datasets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${datasets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    f('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'),
    ...datasets.map((d, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(d))),
  ];
  return zipStore(files).slice(0, undefined, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export const saveCsv = (ds, centre) => downloadBlob(csvBlob(ds), fileBase(ds.dataset, centre) + '.csv');
export const saveXlsx = (datasets, centre, name) => downloadBlob(xlsxBlob(datasets), fileBase(name || (datasets.length === 1 ? datasets[0].dataset : 'all-data'), centre) + '.xlsx');
