/** TuitionDesk backend — Util.gs : errors, helpers, validation, locking, audit. */

function ApiError(code, message, details) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
  this.details = details || null;
}
ApiError.prototype = Object.create(Error.prototype);

var Props = {
  get: function (k) { return PropertiesService.getScriptProperties().getProperty(k); },
  set: function (k, v) { PropertiesService.getScriptProperties().setProperty(k, v); },
  del: function (k) { PropertiesService.getScriptProperties().deleteProperty(k); }
};

var Util = {
  now: function () { return (typeof TD_NOW_OVERRIDE !== 'undefined' && TD_NOW_OVERRIDE) ? new Date(TD_NOW_OVERRIDE) : new Date(); },
  nowIso: function () { return Util.now().toISOString(); },
  tz: function () { return Settings.get('timezone') || 'Asia/Kolkata'; },
  today: function () { return Utilities.formatDate(Util.now(), Util.tz(), 'yyyy-MM-dd'); },
  localHour: function () { return parseInt(Utilities.formatDate(Util.now(), Util.tz(), 'H'), 10); },
  localMinutes: function () { var p = Utilities.formatDate(Util.now(), Util.tz(), 'H:m').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); },
  uuid: function () { return Utilities.getUuid().replace(/-/g, ''); },
  newId: function (prefix) { return prefix + '_' + Util.uuid().slice(0, 20); },
  sha256Hex: function (s) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  },
  constEq: function (a, b) {
    a = String(a); b = String(b);
    var d = a.length ^ b.length;
    for (var i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return d === 0;
  },
  /** Deterministic JSON (sorted keys) for hashing. */
  canon: function (v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(Util.canon).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + Util.canon(v[k]); }).join(',') + '}';
  },
  pad: function (n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; },
  round2: function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; },
  paise: function (n) { return Math.round(Number(n) * 100); },
  fromPaise: function (p) { return p / 100; },
  isDate: function (s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  },
  addDays: function (s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
  diffDays: function (a, b) { return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000); },
  /** ISO weekday: Monday=1 ... Sunday=7 */
  weekday: function (s) { var d = new Date(s + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; },
  monthOf: function (s) { return s.slice(0, 7); },
  monthStart: function (s) { return s.slice(0, 7) + '-01'; },
  paginate: function (arr, p) {
    var size = Math.min(Math.max(parseInt(p.pageSize, 10) || 50, 1), TD.MAX_PAGE_SIZE);
    var page = Math.max(parseInt(p.page, 10) || 1, 1);
    return { items: arr.slice((page - 1) * size, page * size), total: arr.length, page: page, pageSize: size };
  },
  groupBy: function (arr, key) {
    var m = {};
    arr.forEach(function (x) { var k = typeof key === 'function' ? key(x) : x[key]; (m[k] = m[k] || []).push(x); });
    return m;
  },
  pick: function (o, keys) { var r = {}; keys.forEach(function (k) { r[k] = o[k]; }); return r; },
  waLink: function (phone, text) { return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text); }
};

/** Input validation: every function throws ApiError('VALIDATION') with the field name. */
var V = {
  fail: function (name, msg) { throw new ApiError('VALIDATION', name + ': ' + msg, { field: name }); },
  str: function (v, name, o) {
    o = o || {};
    if (v === undefined || v === null || v === '') { if (o.required) V.fail(name, 'is required'); return o.def !== undefined ? o.def : ''; }
    if (typeof v !== 'string' && typeof v !== 'number') V.fail(name, 'must be text');
    var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (o.required && !s) V.fail(name, 'is required');
    if (o.min && s.length < o.min) V.fail(name, 'must be at least ' + o.min + ' characters');
    if (s.length > (o.max || 500)) V.fail(name, 'must be at most ' + (o.max || 500) + ' characters');
    if (o.re && s && !o.re.test(s)) V.fail(name, o.reMsg || 'has an invalid format');
    return s;
  },
  num: function (v, name, o) {
    o = o || {};
    if (v === undefined || v === null || v === '') { if (o.required) V.fail(name, 'is required'); return o.def !== undefined ? o.def : null; }
    var n = Number(v);
    if (!isFinite(n)) V.fail(name, 'must be a number');
    if (o.min !== undefined && n < o.min) V.fail(name, 'must be at least ' + o.min);
    if (o.max !== undefined && n > o.max) V.fail(name, 'must be at most ' + o.max);
    if (o.int && Math.floor(n) !== n) V.fail(name, 'must be a whole number');
    return o.money ? Util.round2(n) : n;
  },
  bool: function (v, name, def) { if (v === undefined || v === null || v === '') return def === undefined ? false : def; return v === true || v === 'true' || v === 'TRUE' || v === 1; },
  oneOf: function (v, name, list, o) {
    o = o || {};
    if (v === undefined || v === null || v === '') { if (o.required) V.fail(name, 'is required'); return o.def !== undefined ? o.def : ''; }
    if (list.indexOf(v) < 0) V.fail(name, 'must be one of: ' + list.join(', '));
    return v;
  },
  date: function (v, name, o) {
    o = o || {};
    if (v === undefined || v === null || v === '') { if (o.required) V.fail(name, 'is required'); return ''; }
    if (!Util.isDate(v)) V.fail(name, 'must be a valid date (YYYY-MM-DD)');
    return v;
  },
  period: function (v, name) {
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) V.fail(name, 'must be a month in YYYY-MM format');
    return v;
  },
  time: function (v, name, o) {
    o = o || {};
    if (!v) { if (o.required) V.fail(name, 'is required'); return ''; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) V.fail(name, 'must be a time in HH:MM format');
    return v;
  },
  /** Normalises to digits with country code (default 91 for 10-digit numbers). Returns '' if blank. */
  phone: function (v, name, o) {
    o = o || {};
    if (v === undefined || v === null || String(v).trim() === '') { if (o.required) V.fail(name, 'is required'); return ''; }
    var d = String(v).replace(/[\s\-().+]/g, '');
    if (!/^\d+$/.test(d)) V.fail(name, 'must contain digits only');
    if (d.length === 10) d = (Settings.get('default_country_code') || '91') + d;
    if (d.length < 11 || d.length > 15) V.fail(name, 'must be a valid phone number');
    return d;
  },
  id: function (v, name) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_\-]{3,64}$/.test(v)) V.fail(name, 'is invalid');
    return v;
  },
  email: function (v, name) {
    if (!v) return '';
    return V.str(v, name, { max: 120, re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, reMsg: 'must be a valid email' });
  }
};

/** Script-wide lock around all mutating work (financial integrity / concurrency). */
var Runtime = {
  withLock: function (fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(TD.LOCK_WAIT_MS)) throw new ApiError('BUSY', 'The system is busy. Please retry in a moment.');
    try { return fn(); } finally { lock.releaseLock(); }
  }
};

var Audit = {
  log: function (ctx, action, entityType, entityId, details) {
    var s = ctx && ctx.session;
    Db.insert('AuditLogs', {
      audit_id: Util.newId('aud'), at: Util.nowIso(),
      actor_user_id: s ? s.userId : (ctx && ctx.actor) || 'system',
      actor_role: s ? s.role : (ctx && ctx.actorRole) || 'system',
      action: action, entity_type: entityType, entity_id: entityId || '',
      details: Audit.clip(details || {})
    });
  },
  clip: function (d) {
    var s = JSON.stringify(d);
    if (s.length > 8000) return { truncated: true, preview: s.slice(0, 7500) };
    return d;
  }
};
