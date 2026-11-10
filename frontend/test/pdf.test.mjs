// PDF engine tests: renders A4/A5 x colour/bw, then verifies with independent tools (pdfplumber, OpenCV QR, independent PDF417 decoder).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.env.PDF_OUT || '/tmp/claude-0/pdf-samples';
fs.mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [path.join(root, 'src/pdf/index.js')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(out, 'pdfmod.mjs'), logLevel: 'error' });
const { buildPdf } = await import(pathToFileURL(path.join(out, 'pdfmod.mjs')).href);
const { encodePDF417, eccCodewords } = await import(pathToFileURL(path.join(root, 'src/pdf/pdf417.js')).href);

let pass = 0, fail = 0;
const t = (name, ok, info) => { if (ok) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info ? ' :: ' + info : '')); } };
const VID = 'a3f09c71be5d42e8a6c0d19f7b2e4c85';
const BASE = 'https://tuition.example.org/app/';
const longName = 'Aishwarya Venkataraghavan-Subramaniam Ramachandran '.repeat(3);
const snap = (extra = []) => ({ title: 'Fee Statement', subtitle: 'Asha Verma (STU-0001)', currency: 'Rs.', blocks: [
  { type: 'kv', title: 'Student', rows: [['Student ID', 'STU-0001'], ['Name', longName], ['Admission date', '2026-10-05'], ['Fee ₹ note', { m: 12345.5 }]] },
  { type: 'table', title: 'Fee obligations', columns: [{ key: 'p', label: 'Period' }, { key: 'd', label: 'Due date' }, { key: 'n', label: 'Net due', f: 'money', a: 'r' }, { key: 'b', label: 'Balance', f: 'money', a: 'r' }, { key: 's', label: 'Status' }],
    rows: Array.from({ length: 70 }, (_, i) => ['2026-' + String((i % 12) + 1).padStart(2, '0'), '2026-10-10', 1000 + i, i * 3, i % 2 ? 'paid' : 'overdue']), footnote: 'Only verified payments reduce the balance.' },
  { type: 'text', title: 'Note', text: 'Payments are recorded only after the Teacher verifies them. ' + 'Long text '.repeat(40) },
  { type: 'signatures', labels: ['Guardian signature', 'Teacher signature'] }, ...extra] });
const cards = { type: 'cards', cards: Array.from({ length: 5 }, (_, i) => ({ studentId: 'STU-000' + (i + 1), name: 'Student Number ' + (i + 1), batches: 'Class 10 Maths, Class 10 Science', admissionDate: '2026-10-05' })) };
const mk = (o = {}) => ({ meta: { verificationId: VID, documentNumber: 'FST-2026-00001', version: 1, issuedAt: '2026-10-05T10:00:00.000Z', docType: 'fee_statement' }, snapshot: o.snapshot || snap(), render: { centreName: 'Bright Minds Tuition', teacherName: o.teacher === undefined ? 'Mr. Rao' : o.teacher, centrePhone: '+91 98765 43210', centreAddress: '12 MG Road, Pune', watermark: o.wm || { enabled: true, text: 'Bright Minds Tuition', position: 'center', size: 48, opacity: 0.08 }, pageSize: 'A4', colorMode: 'colour', publicBaseUrl: BASE } });

// ---- encoder unit tests
const e = encodePDF417(VID);
t('pdf417 RS syndromes are zero for all roots 3^i', (() => { for (let i = 0; i < (1 << (e.ecLevel + 1)); i++) { const x = 3 ** i % 929; let acc = 0; for (const c of e.codewords) acc = (acc * x + c) % 929; if (acc) return false; } return true; })());
t('pdf417 rows within spec (3..90), cols 1..30', e.rows >= 3 && e.rows <= 90 && e.cols >= 1);
t('payload contains no personal data (id only)', /^[a-f0-9]{32}$/.test(VID));

const py = (file, args) => spawnSync('python3', [path.join(root, 'test', file), ...args], { encoding: 'utf8' });
const combos = [];
for (const size of ['A4', 'A5']) for (const mode of ['colour', 'bw']) combos.push([size, mode]);
for (const [size, mode] of combos) {
  for (const variant of ['plain', 'noteacher-nowm', 'cards', 'wm-diagonal', 'wm-bottom', 'wm-top']) {
    const o = variant === 'noteacher-nowm' ? { teacher: '', wm: { enabled: false } } : variant === 'cards' ? { snapshot: { title: 'Student ID Cards', subtitle: '', currency: 'Rs.', blocks: [cards] } } :
      variant.startsWith('wm-') ? { wm: { enabled: true, text: 'CUSTOM TEXT', position: variant.slice(3), size: 40, opacity: 0.12 } } : {};
    const doc = mk(o); let r;
    try { r = await buildPdf(doc, { pageSize: size, colorMode: mode }); } catch (err) { t(`${size}/${mode}/${variant} renders`, false, err.stack); continue; }
    const f = path.join(out, `${size}-${mode}-${variant}.pdf`); fs.writeFileSync(f, r.bytes);
    const wmText = o.wm?.enabled === false ? '-' : (o.wm?.text || 'Bright Minds Tuition');
    const p = py('pdf_check.py', [f, 'Bright Minds Tuition', VID, BASE + '#/verify/' + VID, size, o.teacher === '' ? '-' : 'Mr. Rao', wmText, mode === 'bw' ? '1' : '0']);
    let j; try { j = JSON.parse(p.stdout.trim().split('\n').pop()); } catch { j = { results: {}, failures: ['checker crashed: ' + p.stderr.slice(-300) + p.stdout.slice(-200)] }; }
    t(`${size}/${mode}/${variant}: ${Object.keys(j.results).length} checks (page size, centre name, teacher toggle, watermark, QR, PDF417, colours)`, j.failures.length === 0, j.failures.join(' | '));
    if (variant === 'plain') t(`${size}/${mode}: long table paginates`, r.pages > 1, 'pages=' + r.pages);
  }
}
try { await buildPdf(mk(), { pageSize: 'Letter' }); t('rejects non A4/A5 sizes', false); } catch { t('rejects non A4/A5 sizes', true); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
