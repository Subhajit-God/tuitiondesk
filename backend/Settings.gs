/** TuitionDesk backend — Settings.gs : Teacher-configurable centre settings (no secrets here). */
var SETTING_DEFS = {
  centre_name: { t: 's', def: '', max: 120 },
  centre_phone: { t: 's', def: '', max: 30 },
  centre_email: { t: 's', def: '', max: 120 },
  centre_address: { t: 's', def: '', max: 300 },
  teacher_name: { t: 's', def: '', max: 100 },
  timezone: { t: 's', def: 'Asia/Kolkata', max: 60 },
  default_country_code: { t: 's', def: '91', max: 4 },
  currency_symbol: { t: 's', def: '₹', max: 4 },
  multi_batch_allowed: { t: 'b', def: true },
  session_labels: { t: 's', def: 'Regular', max: 200 },
  // fees
  fee_default_amount: { t: 'n', def: 0, min: 0 },
  fee_due_day: { t: 'n', def: 10, min: 1, max: 28 },
  late_fee_enabled: { t: 'b', def: false },
  late_fee_amount: { t: 'n', def: 0, min: 0 },
  late_fee_grace_days: { t: 'n', def: 7, min: 0, max: 365 },
  // payments
  upi_id: { t: 's', def: '', max: 80 },
  upi_payee_name: { t: 's', def: '', max: 80 },
  payment_instructions: { t: 's', def: '', max: 600 },
  // notifications
  reminders_enabled: { t: 'b', def: false },
  reminder_day: { t: 'n', def: 5, min: 1, max: 28 },
  reminder_hour: { t: 'n', def: 9, min: 0, max: 23 },
  overdue_followup_enabled: { t: 'b', def: false },
  overdue_followup_interval_days: { t: 'n', def: 7, min: 1, max: 60 },
  absence_alert_enabled: { t: 'b', def: false },
  weekly_report_enabled: { t: 'b', def: false },
  weekly_report_hour: { t: 'n', def: 18, min: 0, max: 23 },
  weekly_report_recipients: { t: 's', def: '', max: 200 },
  quiet_hours_enabled: { t: 'b', def: true },
  quiet_start: { t: 's', def: '21:00', max: 5 },
  quiet_end: { t: 's', def: '08:00', max: 5 },
  wa_template_name: { t: 's', def: '', max: 100 },
  wa_template_lang: { t: 's', def: 'en', max: 10 },
  tpl_fee_reminder: { t: 's', def: '', max: 600 },
  tpl_overdue: { t: 's', def: '', max: 600 },
  tpl_absence: { t: 's', def: '', max: 600 },
  tpl_notice: { t: 's', def: '', max: 600 },
  ladder_enabled: { t: 'b', def: false },
  ladder_before_days: { t: 'n', def: 3, min: 1, max: 15 },
  ladder_repeat_days: { t: 'n', def: 7, min: 2, max: 30 },
  ladder_max_firm: { t: 'n', def: 3, min: 1, max: 10 },
  ladder_adapt: { t: 'b', def: true },
  tpl_ladder_friendly: { t: 's', def: '', max: 600 },
  tpl_ladder_due: { t: 's', def: '', max: 600 },
  tpl_ladder_firm: { t: 's', def: '', max: 600 },
  absence_exception_threshold: { t: 'n', def: 3, min: 1, max: 30 },
  // documents
  pdf_page_size: { t: 'e', def: 'A4', list: ['A4', 'A5'] },
  pdf_color_mode: { t: 'e', def: 'colour', list: ['colour', 'bw'] },
  show_teacher_name: { t: 'b', def: true },
  watermark_enabled: { t: 'b', def: true },
  watermark_text: { t: 's', def: '', max: 60 },
  watermark_position: { t: 'e', def: 'center', list: ['center', 'diagonal', 'top', 'bottom'] },
  watermark_size: { t: 'n', def: 48, min: 12, max: 120 },
  watermark_opacity: { t: 'n', def: 0.08, min: 0.02, max: 0.3 },
  verify_show_document_number: { t: 'b', def: false },
  public_base_url: { t: 's', def: '', max: 300 },
  // backups
  backup_frequency_days: { t: 'n', def: 7, min: 1, max: 90 },
  backup_retention_days: { t: 'n', def: 90, min: 7, max: 3650 }
};

var DEFAULT_TEMPLATES = {
  tpl_fee_reminder: 'Dear {{guardian}}, this is a reminder from {{centre}}: fee balance for {{student}} is {{amount}} ({{periods}}). Please pay at your earliest convenience.{{payline}} Thank you.',
  tpl_overdue: 'Dear {{guardian}}, fees for {{student}} are overdue at {{centre}}: {{amount}} pending ({{periods}}). Kindly clear the balance or contact us.{{payline}}',
  tpl_ladder_friendly: 'Hello {{guardian}}, a friendly heads-up from {{centre}}: the fee for {{student}} ({{months}}), {{amount}}, is due on {{due}}.{{payline}} Thank you!',
  tpl_ladder_due: 'Dear {{guardian}}, the fee for {{student}} ({{months}}), {{amount}}, is due today at {{centre}}.{{payline}} If you have already paid, please ignore this message.',
  tpl_ladder_firm: 'Dear {{guardian}}, the fee for {{student}} ({{months}}) at {{centre}} is now {{days}} days past its due date. Amount pending: {{amount}}. Please pay today or call us if there is a problem.{{payline}}',
  tpl_absence: 'Dear {{guardian}}, {{student}} was marked absent on {{date}} ({{batch}}) at {{centre}}.',
  tpl_notice: '{{centre}} notice: {{title}} — {{body}}'
};

var Settings = (function () {
  var cache = null;
  function load() {
    if (cache) return cache;
    var c = {};
    Db.all('TuitionCentreSettings').forEach(function (r) { c[r.setting_key] = r.setting_value; });
    cache = c; return c;
  }
  function parse(def, raw) {
    if (raw === undefined || raw === '') return def.def;
    if (def.t === 'b') return raw === 'TRUE' || raw === 'true';
    if (def.t === 'n') { var n = Number(raw); return isFinite(n) ? n : def.def; }
    return raw;
  }
  return {
    reset: function () { cache = null; },
    get: function (key) {
      var def = SETTING_DEFS[key]; if (!def) return undefined;
      var raw; try { raw = load()[key]; } catch (e) { raw = undefined; }
      var v = parse(def, raw);
      if (v === '' && DEFAULT_TEMPLATES[key]) return DEFAULT_TEMPLATES[key];
      return v;
    },
    all: function () { var o = {}; Object.keys(SETTING_DEFS).forEach(function (k) { o[k] = Settings.get(k); }); return o; },
    /** Settings a Student may see (payment instructions + centre identity). */
    publicInfo: function () {
      var keys = ['centre_name', 'centre_phone', 'centre_address', 'upi_id', 'upi_payee_name', 'payment_instructions', 'currency_symbol'];
      var o = {}; keys.forEach(function (k) { o[k] = Settings.get(k); }); return o;
    },
    update: function (ctx, patch) {
      var before = {}, after = {};
      Object.keys(patch || {}).forEach(function (k) {
        var def = SETTING_DEFS[k];
        if (!def) throw new ApiError('VALIDATION', 'Unknown setting: ' + k, { field: k });
        var v = patch[k], out;
        if (def.t === 'b') out = V.bool(v, k);
        else if (def.t === 'n') out = V.num(v, k, { min: def.min, max: def.max, required: true });
        else if (def.t === 'e') out = V.oneOf(v, k, def.list, { required: true });
        else out = V.str(v, k, { max: def.max });
        if (k === 'timezone' && out && !/^[A-Za-z_]+(\/[A-Za-z_\-+0-9]+)*$/.test(out)) V.fail(k, 'is not a valid timezone');
        if (k === 'quiet_start' || k === 'quiet_end') V.time(out, k, { required: true });
        if (k === 'default_country_code' && !/^\d{1,4}$/.test(out)) V.fail(k, 'must be digits');
        if (k === 'weekly_report_recipients') out = out.split(',').map(function (p) { return p.trim() ? V.phone(p, k) : ''; }).filter(Boolean).join(',');
        if (k === 'public_base_url' && out && !/^https:\/\//.test(out)) V.fail(k, 'must start with https://');
        if (k === 'upi_id' && out && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(out)) V.fail(k, 'must look like name@bank');
        before[k] = Settings.get(k); after[k] = out;
      });
      Object.keys(after).forEach(function (k) {
        var stored = typeof after[k] === 'boolean' ? (after[k] ? 'TRUE' : 'FALSE') : String(after[k]);
        var ex = Db.get('TuitionCentreSettings', k);
        if (ex) Db.update('TuitionCentreSettings', k, { setting_value: stored, updated_at: Util.nowIso(), updated_by: ctx.session.userId });
        else Db.insert('TuitionCentreSettings', { setting_key: k, setting_value: stored, updated_at: Util.nowIso(), updated_by: ctx.session.userId });
      });
      Settings.reset();
      Audit.log(ctx, 'settings.update', 'settings', '', { before: before, after: after });
      return Settings.all();
    },
    templateVersion: function (key) {
      var raw; try { raw = load()[key]; } catch (e) { raw = ''; }
      return raw ? 'custom-' + Util.sha256Hex(raw).slice(0, 8) : 'default-1';
    },
    requireCentreName: function () {
      var n = Settings.get('centre_name');
      if (!n) throw new ApiError('SETUP_REQUIRED', 'Set the tuition-centre name in Settings before generating official documents.');
      return n;
    }
  };
})();
