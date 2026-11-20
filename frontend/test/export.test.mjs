// Export file writers: CSV and XLSX are validated with independent tools (python csv, unzip -t, openpyxl, LibreOffice).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.env.EXP_OUT || '/tmp/td-e2e/export'; fs.mkdirSync(out, { recursive: true });
await esbuild.build({ entryPoints: [path.join(root, 'src/export.js')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(out, 'exp.mjs'), logLevel: 'error' });
const X = await import(pathToFileURL(path.join(out, 'exp.mjs')).href);
let pass = 0, fail = 0; const t = (n, ok, i) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !i ? '' : ' :: ' + i)); };

const ds = { dataset: 'students', label: 'Students', columns: ['Student ID', 'Name', 'Phone', 'Amount', 'Notes'], rows: [
  ['stu_0001', 'Asha, "Ace" Verma', '09876543210', 1500.5, '=HYPERLINK("http://evil","x")'],
  ['stu_0002', 'Ravi Ñandi — ₹ ünïcode', '919800000000', -20, '+91 call me\nsecond line'],
  ['stu_0003', 'Tab\there', '', 0, '@SUM(A1)'],
  ['stu_0004', 'Ctl\u0001char', null, 7, "-cmd|' /C calc'!A0"],
] };
// ---- CSV
fs.writeFileSync(path.join(out, 'a.csv'), X.toCsv(ds));
let r = spawnSync('python3', ['-c', `
import csv,sys,json
raw=open('${out}/a.csv','rb').read(); assert raw.startswith(b'\\xef\\xbb\\xbf'), 'BOM'
rows=list(csv.reader(open('${out}/a.csv',encoding='utf-8-sig',newline='')))
print(json.dumps(rows, ensure_ascii=False))`], { encoding: 'utf8' });
const rows = JSON.parse(r.stdout || '[]');
t('CSV parses back to 5 rows x 5 columns (quotes, commas, newlines survive)', rows.length === 5 && rows.every((x) => x.length === 5), r.stderr);
t('CSV keeps text exactly (unicode, quotes, leading zeros, embedded newline)', rows[1][1] === 'Asha, "Ace" Verma' && rows[1][2] === '09876543210' && rows[2][1].includes('₹ ünïcode') && rows[2][4].includes('\nsecond line'));
t('CSV neutralises formula starters in text cells but not real numbers', rows[1][4].startsWith("'=") && rows[2][4].startsWith("'+91") && rows[3][4].startsWith("'@") && rows[4][4].startsWith("'-") && rows[2][3] === '-20' && rows[1][3] === '1500.5');
// ---- XLSX
const blob = X.xlsxBlob([ds, { ...ds, label: 'Fees/2026: [x]', rows: ds.rows.slice(0, 1) }]); fs.writeFileSync(path.join(out, 'a.xlsx'), Buffer.from(await blob.arrayBuffer()));
r = spawnSync('unzip', ['-t', path.join(out, 'a.xlsx')], { encoding: 'utf8' }); t('xlsx is a valid zip (CRCs checked by unzip -t)', r.status === 0 && /No errors/.test(r.stdout), r.stdout + r.stderr);
r = spawnSync('python3', ['-c', `
import openpyxl,json
wb=openpyxl.load_workbook('${out}/a.xlsx')
print(json.dumps({'names':wb.sheetnames,'rows':[[c.value for c in r] for r in wb.worksheets[0].iter_rows()],'types':[type(c.value).__name__ for c in wb.worksheets[0][2]],'freeze':wb.worksheets[0].freeze_panes,'filter':wb.worksheets[0].auto_filter.ref,'bold':wb.worksheets[0]['A1'].font.b}, ensure_ascii=False))`], { encoding: 'utf8' });
const j = JSON.parse(r.stdout || '{}');
t('openpyxl opens the workbook with 2 safely-named sheets', j.names && j.names.length === 2 && j.names[0] === 'Students' && !/[\[\]:*?\/\\]/.test(j.names[1]), r.stderr + JSON.stringify(j.names));
t('xlsx text stays text (IDs/phones keep zeros, formulas are NOT formulas), numbers stay numbers', j.rows && j.rows[1][2] === '09876543210' && j.rows[1][4] === '=HYPERLINK("http://evil","x")' && j.types[3] === 'float' || j.types?.[3] === 'int', JSON.stringify(j.rows?.[1]) + JSON.stringify(j.types));
t('xlsx unicode, tabs/newlines preserved; control chars stripped; negatives numeric', j.rows && j.rows[2][1].includes('₹ ünïcode') && j.rows[2][4].includes('\nsecond line') && j.rows[2][3] === -20 && j.rows[4][1] === 'Ctlchar', JSON.stringify(j.rows?.slice(2)));
t('xlsx header is bold, frozen and filterable', j.bold === true && j.freeze === 'A2' && j.filter === 'A1:E5', JSON.stringify([j.bold, j.freeze, j.filter]));
r = spawnSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', out + '/lo', path.join(out, 'a.xlsx')], { encoding: 'utf8', timeout: 120000 });
const lo = fs.existsSync(path.join(out, 'lo/a.csv')) ? fs.readFileSync(path.join(out, 'lo/a.csv'), 'utf8') : '';
t('LibreOffice opens the xlsx and exports it (a second, independent reader)', /Asha, ""Ace"" Verma/.test(lo) && /09876543210/.test(lo), r.stderr.slice(0, 200));
// big
const big = { dataset: 'attendance', label: 'Attendance', columns: ['a', 'b'], rows: Array.from({ length: 30000 }, (_, i) => ['stu_' + i, i]) };
const bb = X.xlsxBlob([big]); fs.writeFileSync(path.join(out, 'big.xlsx'), Buffer.from(await bb.arrayBuffer()));
r = spawnSync('python3', ['-c', `import openpyxl;ws=openpyxl.load_workbook('${out}/big.xlsx',read_only=True).worksheets[0];print(ws.max_row)`], { encoding: 'utf8' }); t('30,000-row workbook opens and has every row', r.stdout.trim() === '30001', r.stdout + r.stderr);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
