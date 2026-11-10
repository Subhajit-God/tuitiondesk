'use strict';
/**
 * Loads the Apps Script (.gs) sources into a Node `vm` context with in-memory mocks of the Google services
 * (SpreadsheetApp, DriveApp, LockService, CacheService, PropertiesService, Utilities, UrlFetchApp, ...).
 * Used by the unit/integration/security tests and by the local dev server. NOT used in production.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILES = ['Config', 'Util', 'Db', 'Settings', 'Auth', 'Mfa', 'Students','Enrolment', 'Finance', 'Academics', 'Comms', 'Notify','PayLinks','Ladder','Plans', 'Documents', 'Export', 'Reports', 'Ops', 'Today', 'Monthly', 'Api', 'Setup'];
const SRC = path.join(__dirname, '..');

const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(Array.from(v).map((b) => b & 255)));
const toSigned = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));

function createBackend(opts = {}) {
  const sheets = new Map(); // spreadsheetId -> {id, sheets: Map(name -> {name, data})}
  const files = new Map();
  const props = new Map();
  const cache = new Map();
  const log = { fetches: [], logs: [], files: [], mails: [] };
  let lockHeld = false;
  let seq = 0;
  const nextId = (p) => `${p}${(++seq).toString().padStart(4, '0')}${crypto.randomBytes(6).toString('hex')}`;

  function makeSS(name) {
    const ss = { id: nextId('ss'), name: name || 'ss', sheets: new Map() };
    sheets.set(ss.id, ss);
    return ss;
  }
  function wrapSS(ss) {
    const wrapSheet = (sh) => ({
      getName: () => sh.name,
      getLastRow() { for (let r = sh.data.length; r > 0; r--) if (sh.data[r - 1].some((c) => c !== '' && c !== null && c !== undefined)) return r; return 0; },
      getLastColumn() { let m = 0; sh.data.forEach((r) => { for (let c = r.length; c > 0; c--) if (r[c - 1] !== '' && r[c - 1] !== undefined) { m = Math.max(m, c); break; } }); return m; },
      getMaxRows: () => Math.max(sh.data.length, 1000),
      setFrozenRows() {},
      clear() { sh.data = []; },
      getRange(r, c, nr = 1, nc = 1) {
        return {
          getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
          setValues: (vals) => { vals.forEach((row, i) => { const rr = r - 1 + i; sh.data[rr] = sh.data[rr] || []; row.forEach((v, j) => { sh.data[rr][c - 1 + j] = v; }); }); },
          setValue: (v) => { sh.data[r - 1] = sh.data[r - 1] || []; sh.data[r - 1][c - 1] = v; },
          setNumberFormat() {}, setFontWeight() {},
        };
      },
    });
    return {
      getId: () => ss.id,
      getSheetByName: (n) => (ss.sheets.has(n) ? wrapSheet(ss.sheets.get(n)) : null),
      insertSheet: (n) => { const sh = { name: n, data: [] }; ss.sheets.set(n, sh); return wrapSheet(sh); },
    };
  }
  function ssById(id) { const ss = sheets.get(id); if (!ss) throw new Error('No spreadsheet ' + id); return wrapSS(ss); }

  const main = makeSS('TuitionDesk DB');
  const folders = new Map();
  const mkFolder = (name) => { const f = { id: nextId('fld'), name, files: [] }; folders.set(f.id, f); return f; };
  const wrapFolder = (f) => ({
    getId: () => f.id,
    createFile: (blob) => { const file = { id: nextId('file'), name: blob.name, bytes: blob.bytes, folder: f.id, trashed: false }; files.set(file.id, file); f.files.push(file.id); log.files.push(file); return wrapFile(file); },
    createFolder: (n) => wrapFolder(mkFolder(n)),
    setSharing() {},
  });
  const wrapFile = (file) => ({
    getId: () => file.id,
    getName: () => file.name,
    setTrashed: (t) => { file.trashed = t; },
    getParents: () => ({ hasNext: () => false, next: () => null }),
    makeCopy(name, folder) {
      const src = sheets.get(file.id);
      const copy = { id: nextId('ss'), name, sheets: new Map() };
      src.sheets.forEach((sh, n) => copy.sheets.set(n, { name: n, data: JSON.parse(JSON.stringify(sh.data)) }));
      sheets.set(copy.id, copy);
      const f = { id: copy.id, name, trashed: false }; files.set(f.id, f);
      return wrapFile(f);
    },
  });
  files.set(main.id, { id: main.id, name: 'db', trashed: false });

  const lockObj = {
    tryLock() { if (lockHeld) throw new Error('NESTED LOCK: lock already held in this execution'); lockHeld = true; return true; },
    releaseLock() { lockHeld = false; },
  };
  const fmt = (date, tz, pattern) => {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    const u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
    return pattern.replace(/yyyy/g, parts.year).replace(/MM/g, parts.month).replace(/dd/g, parts.day).replace(/HH/g, parts.hour).replace(/mm/g, parts.minute).replace(/ss/g, parts.second)
      .replace(/\bH\b/g, String(parseInt(parts.hour, 10))).replace(/\bm\b/g, String(parseInt(parts.minute, 10))).replace(/\bu\b/g, String(u));
  };

  const sandbox = {
    console,
    Logger: { log: (m) => { log.logs.push(String(m)); } },
    MailApp: { sendEmail: (o) => { if (be.mailFail) throw new Error('mail service down'); log.mails.push(o); } },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => lockObj },
    SpreadsheetApp: { getActiveSpreadsheet: () => wrapSS(main), openById: ssById, create: (name) => { const ss = makeSS(name); files.set(ss.id, { id: ss.id, name, trashed: false }); return wrapSS(ss); } },
    DriveApp: { getFileById: (id) => { const f = files.get(id); if (!f) throw new Error('No file'); return wrapFile(f); }, getFolderById: (id) => wrapFolder(folders.get(id)), getRootFolder: () => wrapFolder(mkFolder('root')), Access: { PRIVATE: 'P' }, Permission: { NONE: 'N' } },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create() {} }) }) }), deleteTrigger() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
    UrlFetchApp: { fetch: (url, o) => { log.fetches.push({ url, o }); if (!be.fetchHandler) throw new Error('No fetch handler'); return be.fetchHandler(url, o); } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, v) => toSigned(crypto.createHash('sha256').update(toBuf(v)).digest()),
      MacAlgorithm: { HMAC_SHA_1: 'sha1' },
      computeHmacSignature: (alg, v, k) => toSigned(crypto.createHmac('sha1', toBuf(k)).update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64Encode: (v) => toBuf(v).toString('base64'),
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      formatDate: fmt,
    },
  };
  sandbox.TD_NOW_OVERRIDE = opts.now ? new Date(opts.now).toISOString() : '';
  const ctx = vm.createContext(sandbox);
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f + '.gs'), 'utf8'), ctx, { filename: f + '.gs' }));

  const be = {
    ctx, log, props, cache, sheets, files, mainId: main.id, fetchHandler: null,
    setNow(iso) { ctx.TD_NOW_OVERRIDE = iso ? new Date(iso).toISOString() : ''; },
    run(code) { return vm.runInContext(code, ctx); },
    /** Initialise tabs + folders like setupDatabase() does. */
    setup() {
      props.set('SPREADSHEET_ID', main.id);
      const d = mkFolder('docs'), b = mkFolder('backups');
      props.set('DOCS_FOLDER_ID', d.id); props.set('BACKUP_FOLDER_ID', b.id);
      vm.runInContext('Db.init()', ctx);
      return be;
    },
    /** Invoke the web-app POST handler exactly like Apps Script would; returns the parsed JSON response. */
    call(action, params = {}, token = undefined) {
      const out = vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify({ action, params, token }) }, parameter: {} });
      return JSON.parse(out.getContent());
    },
    rawPost(body, parameter = {}) { return JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: body }, parameter }).getContent()); },
    rawGet(parameter) { const o = vm.runInContext('doGet', ctx)({ parameter }); return o.getContent(); },
    /** Creates the Teacher via the real bootstrap flow and returns a token. */
    bootstrapTeacher(username = 'teacher', password = 'Teacher#12345') {
      vm.runInContext('generateSetupKey()', ctx);
      const key = props.get('SETUP_KEY');
      const r = be.call('auth.bootstrap', { setupKey: key, username, password, displayName: 'Test Teacher' });
      if (!r.ok) throw new Error('bootstrap failed ' + JSON.stringify(r));
      return be.login(username, password);
    },
    login(username, password) { const r = be.call('auth.login', { username, password }); if (!r.ok) throw new Error('login failed ' + JSON.stringify(r)); return r.data.token; },
    snapshot() { const o = {}; sheets.forEach((ss, id) => { o[id] = { name: ss.name, sheets: [...ss.sheets].map(([n, s]) => [n, s.data]) }; }); return { sheets: o, props: [...props] }; },
    restore(s) { Object.keys(s.sheets).forEach((id) => { const ss = sheets.get(id) || { id, name: s.sheets[id].name, sheets: new Map() }; ss.sheets = new Map(s.sheets[id].sheets.map(([n, d]) => [n, { name: n, data: d }])); sheets.set(id, ss); }); s.props.forEach(([k, v]) => props.set(k, v)); },
  };
  return be;
}

module.exports = { createBackend };
