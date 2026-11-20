/** TuitionDesk backend — Db.gs : Google Sheets persistence with stable IDs and typed columns. */
var Db = (function () {
  var _ss = null, _cache = {};

  function spreadsheet() {
    if (_ss) return _ss;
    var id = Props.get('SPREADSHEET_ID');
    _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!_ss) throw new ApiError('NOT_CONFIGURED', 'Database spreadsheet is not configured. Run setupDatabase().');
    return _ss;
  }
  function sheet(table) {
    var sh = spreadsheet().getSheetByName(table);
    if (!sh) throw new ApiError('NOT_CONFIGURED', 'Database is not initialised (missing tab ' + table + '). Run setupDatabase().');
    return sh;
  }
  function fromCell(v, type) {
    switch (type) {
      case 'n': return v === '' || v === null ? 0 : Number(v);
      case 'i': return v === '' || v === null ? 0 : parseInt(v, 10);
      case 'nn': return v === '' || v === null || v === undefined ? null : Number(v);
      case 'b': return v === true || v === 'TRUE' || v === 'true' || v === 1;
      case 'j': try { return v === '' ? null : JSON.parse(v); } catch (e) { return null; }
      default:
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString();
        return String(v);
    }
  }
  function toCell(v, type, table, name) {
    switch (type) {
      case 'n': case 'i': return v === undefined || v === null || v === '' ? 0 : Number(v);
      case 'nn': return v === undefined || v === null || v === '' ? '' : Number(v);
      case 'b': return v ? 'TRUE' : 'FALSE';
      case 'j': { var s = v === undefined || v === null ? '' : JSON.stringify(v); if (s.length > TD.MAX_CELL_CHARS) throw new ApiError('TOO_LARGE', 'Data too large to store (' + table + '.' + name + ').'); return s; }
      default: { var t = v === undefined || v === null ? '' : String(v); if (t.length > TD.MAX_CELL_CHARS) throw new ApiError('TOO_LARGE', 'Text too large to store (' + table + '.' + name + ').'); return t; }
    }
  }
  function rowToObj(cols, row) {
    var o = {};
    for (var i = 0; i < cols.length; i++) o[cols[i].name] = fromCell(row[i], cols[i].type);
    return o;
  }
  function objToRow(table, o) {
    return SCHEMA[table].map(function (c) { return toCell(o[c.name], c.type, table, c.name); });
  }
  function load(table) {
    if (_cache[table]) return _cache[table];
    var cols = SCHEMA[table], sh = sheet(table), last = sh.getLastRow();
    var t = { rows: [], byId: {}, nextRow: Math.max(last + 1, 2) };
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
      for (var r = 0; r < vals.length; r++) {
        if (vals[r][0] === '' || vals[r][0] === null) continue;
        var e = { row: r + 2, obj: rowToObj(cols, vals[r]) };
        t.rows.push(e); t.byId[e.obj[cols[0].name]] = e;
      }
    }
    _cache[table] = t;
    return t;
  }
  function clone(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }

  return {
    setSpreadsheet: function (ss) { _ss = ss; _cache = {}; },
    getSpreadsheet: function () { return spreadsheet(); },
    reset: function () { _cache = {}; },
    idCol: function (table) { return SCHEMA[table][0].name; },

    /** Create missing tabs / append missing header columns. Idempotent. */
    init: function () {
      var ss = spreadsheet(), made = [];
      Object.keys(SCHEMA).forEach(function (table) {
        var cols = SCHEMA[table], sh = ss.getSheetByName(table);
        if (!sh) { sh = ss.insertSheet(table); made.push(table); }
        var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
        for (var i = 0; i < cols.length; i++) {
          if (have[i] === undefined || have[i] === '') sh.getRange(1, i + 1).setValue(cols[i].name);
          else if (have[i] !== cols[i].name) throw new ApiError('SCHEMA_MISMATCH', 'Tab ' + table + ' column ' + (i + 1) + ' is "' + have[i] + '", expected "' + cols[i].name + '".');
        }
        sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
        sh.setFrozenRows(1);
        sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // plain text: no formula/date coercion
      });
      _cache = {};
      return made;
    },
    all: function (table) { return load(table).rows.map(function (e) { return clone(e.obj); }); },
    get: function (table, id) { var e = load(table).byId[id]; return e ? clone(e.obj) : null; },
    find: function (table, pred) { var rows = load(table).rows; for (var i = 0; i < rows.length; i++) if (pred(rows[i].obj)) return clone(rows[i].obj); return null; },
    filter: function (table, pred) { return load(table).rows.filter(function (e) { return pred(e.obj); }).map(function (e) { return clone(e.obj); }); },
    count: function (table) { return load(table).rows.length; },

    insert: function (table, obj) {
      var cols = SCHEMA[table], idc = cols[0].name, t = load(table), now = Util.nowIso();
      var o = clone(obj);
      if (!o[idc]) throw new ApiError('INTERNAL', 'Missing id for ' + table);
      if (t.byId[o[idc]]) throw new ApiError('CONFLICT', 'Duplicate id in ' + table);
      cols.forEach(function (c) {
        if (c.name === 'created_at' && !o.created_at) o.created_at = now;
        if (c.name === 'updated_at' && !o.updated_at) o.updated_at = now;
        if (o[c.name] === undefined) o[c.name] = c.type === 'n' || c.type === 'i' ? 0 : c.type === 'b' ? false : c.type === 'nn' ? null : c.type === 'j' ? null : '';
      });
      var row = objToRow(table, o);
      sheet(table).getRange(t.nextRow, 1, 1, cols.length).setValues([row]);
      var e = { row: t.nextRow, obj: rowToObj(cols, row) };
      t.nextRow++; t.rows.push(e); t.byId[o[idc]] = e;
      return clone(e.obj);
    },
    update: function (table, id, patch) {
      var cols = SCHEMA[table], idc = cols[0].name, t = load(table), e = t.byId[id];
      if (!e) throw new ApiError('NOT_FOUND', 'Record not found.');
      var o = clone(e.obj);
      for (var k in patch) { if (k !== idc) o[k] = patch[k]; }
      if (cols.some(function (c) { return c.name === 'updated_at'; })) o.updated_at = Util.nowIso();
      var row = objToRow(table, o);
      sheet(table).getRange(e.row, 1, 1, cols.length).setValues([row]);
      e.obj = rowToObj(cols, row);
      return clone(e.obj);
    },
    /** Next human-friendly sequential id such as STU-0007, derived from existing data (survives restores). */
    nextSeq: function (table, col, prefix, width) {
      var max = 0, re = new RegExp('^' + prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '(\\d+)$');
      load(table).rows.forEach(function (e) { var m = re.exec(e.obj[col] || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); });
      return prefix + Util.pad(max + 1, width || 4);
    },
    /** Checksum of a tab's raw values, used by backup verification. */
    checksum: function (table, ss) {
      var sh = (ss || spreadsheet()).getSheetByName(table);
      if (!sh || sh.getLastRow() < 1) return { rows: 0, hash: Util.sha256Hex('') };
      var vals = sh.getRange(1, 1, sh.getLastRow(), SCHEMA[table].length).getValues();
      return { rows: vals.length - 1, hash: Util.sha256Hex(JSON.stringify(vals)) };
    }
  };
})();
