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
  sibling_discount_percent: { t: 'n', def: 0, min: 0, max: 100 },
  auto_apply_credit: { t: 'b', def: true },
  late_fee_mode: { t: 'e', def: 'flat', list: ['flat', 'percent'] },
  late_fee_repeat_days: { t: 'n', def: 0, min: 0, max: 90 },
  late_fee_max: { t: 'n', def: 0, min: 0 },
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
  public_enquiry_enabled: { t: 'b', def: false },
  public_enquiry_intro: { t: 's', def: 'Interested in joining? Leave your details and we will call you back.', max: 300 },
  public_enquiry_hourly_cap: { t: 'n', def: 20, min: 1, max: 200 },
  public_base_url: { t: 's', def: '', max: 300 },
  // backups
  backup_frequency_days: { t: 'n', def: 1, min: 1, max: 90 },
  backup_stale_hours: { t: 'n', def: 48, min: 6, max: 720 },
  restore_test_days: { t: 'n', def: 30, min: 7, max: 120 },
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

/**
 * Message languages. English is the default; Hindi (hi) and Bengali (bn) are provided per family (Students.language).
 * Every template can be overridden per language in Settings as tpl_<name>_<lang>. The Hindi/Bengali defaults were written
 * by the developer, not a native-speaker translator — read them, and edit them in Settings, before relying on them.
 */
var LANGS = { en: 'English', hi: 'हिन्दी (Hindi)', bn: 'বাংলা (Bengali)' };
var LANG_TEXT = {
  hi: {
    tpl_fee_reminder: 'प्रिय {{guardian}}, {{centre}} की ओर से याद दिलाना: {{student}} की फ़ीस बकाया है {{amount}} ({{periods}}). कृपया जल्द भुगतान करें।{{payline}} धन्यवाद।',
    tpl_overdue: 'प्रिय {{guardian}}, {{centre}} में {{student}} की फ़ीस की देय तिथि निकल चुकी है: {{amount}} बकाया ({{periods}}). कृपया भुगतान करें या हमसे संपर्क करें।{{payline}}',
    tpl_ladder_friendly: 'नमस्ते {{guardian}}, {{centre}} की ओर से एक छोटी सूचना: {{student}} की फ़ीस ({{months}}), {{amount}}, {{due}} को देय है।{{payline}} धन्यवाद!',
    tpl_ladder_due: 'प्रिय {{guardian}}, {{centre}} में {{student}} की फ़ीस ({{months}}), {{amount}}, आज देय है।{{payline}} यदि आप भुगतान कर चुके हैं तो कृपया इस संदेश को अनदेखा करें।',
    tpl_ladder_firm: 'प्रिय {{guardian}}, {{centre}} में {{student}} की फ़ीस ({{months}}) की देय तिथि को {{days}} दिन बीत चुके हैं। बकाया राशि: {{amount}}. कृपया आज ही भुगतान करें, या कोई समस्या हो तो हमें फ़ोन करें।{{payline}}',
    tpl_absence: 'प्रिय {{guardian}}, {{student}} {{date}} को {{centre}} ({{batch}}) में अनुपस्थित था/थी।',
    pay: ' एक टैप में भुगतान करें: ', upi: ' UPI से भुगतान करें: ',
    m_head: '{{centre}} — {{month}} की मासिक रिपोर्ट, {{guardian}} के लिए:', m_att: 'उपस्थिति', m_att_na: 'उपस्थिति: इस माह कोई कक्षा दर्ज नहीं', m_tests: 'परीक्षाएँ', m_fee_clear: 'फ़ीस: कोई बकाया नहीं', m_fee_due: 'फ़ीस बकाया', m_credit: 'अग्रिम जमा', m_foot: 'किसी भी प्रश्न के लिए हमसे संपर्क करें।', m_days: 'दिन', m_of: 'में से'
  },
  bn: {
    tpl_fee_reminder: 'প্রিয় {{guardian}}, {{centre}} থেকে মনে করিয়ে দিচ্ছি: {{student}}-এর ফি বাকি {{amount}} ({{periods}})। অনুগ্রহ করে দ্রুত পরিশোধ করুন।{{payline}} ধন্যবাদ।',
    tpl_overdue: 'প্রিয় {{guardian}}, {{centre}}-এ {{student}}-এর ফি-এর নির্ধারিত তারিখ পেরিয়ে গেছে: {{amount}} বাকি ({{periods}})। অনুগ্রহ করে পরিশোধ করুন বা আমাদের সঙ্গে যোগাযোগ করুন।{{payline}}',
    tpl_ladder_friendly: 'নমস্কার {{guardian}}, {{centre}} থেকে একটি ছোট মনে করিয়ে দেওয়া: {{student}}-এর ফি ({{months}}), {{amount}}, {{due}} তারিখে দেয়।{{payline}} ধন্যবাদ!',
    tpl_ladder_due: 'প্রিয় {{guardian}}, {{centre}}-এ {{student}}-এর ফি ({{months}}), {{amount}}, আজ দেয়।{{payline}} আপনি যদি ইতিমধ্যে পরিশোধ করে থাকেন, এই বার্তাটি উপেক্ষা করুন।',
    tpl_ladder_firm: 'প্রিয় {{guardian}}, {{centre}}-এ {{student}}-এর ফি ({{months}}) নির্ধারিত তারিখের {{days}} দিন পেরিয়ে গেছে। বাকি: {{amount}}। অনুগ্রহ করে আজই পরিশোধ করুন, কোনো সমস্যা থাকলে আমাদের ফোন করুন।{{payline}}',
    tpl_absence: 'প্রিয় {{guardian}}, {{student}} {{date}} তারিখে {{centre}} ({{batch}})-এ অনুপস্থিত ছিল।',
    pay: ' এক ট্যাপে পরিশোধ করুন: ', upi: ' UPI-তে পরিশোধ করুন: ',
    m_head: '{{centre}} — {{month}} মাসের রিপোর্ট, {{guardian}}-এর জন্য:', m_att: 'উপস্থিতি', m_att_na: 'উপস্থিতি: এই মাসে কোনো ক্লাস নথিভুক্ত নেই', m_tests: 'পরীক্ষা', m_fee_clear: 'ফি: কোনো বাকি নেই', m_fee_due: 'ফি বাকি', m_credit: 'অগ্রিম জমা', m_foot: 'কোনো প্রশ্ন থাকলে আমাদের জানান।', m_days: 'দিন', m_of: 'এর মধ্যে'
  },
  en: { pay: ' Pay in one tap: ', upi: ' Pay by UPI to ', m_head: '{{centre}} — monthly update for {{guardian}} ({{month}}):', m_att: 'Attendance', m_att_na: 'Attendance: no classes recorded this month', m_tests: 'Tests', m_fee_clear: 'Fees: nothing due', m_fee_due: 'Fees due', m_credit: 'Advance credit', m_foot: 'Please contact us for any question.', m_days: 'days', m_of: 'of' }
};
(function () {
  ['fee_reminder', 'overdue', 'ladder_friendly', 'ladder_due', 'ladder_firm', 'absence'].forEach(function (k) {
    ['hi', 'bn'].forEach(function (l) { SETTING_DEFS['tpl_' + k + '_' + l] = { t: 's', def: '', max: 600 }; DEFAULT_TEMPLATES['tpl_' + k + '_' + l] = LANG_TEXT[l]['tpl_' + k]; });
  });
  ['hi', 'bn', 'en'].forEach(function (l) { SETTING_DEFS['tpl_monthly_head_' + l] = { t: 's', def: '', max: 300 }; DEFAULT_TEMPLATES['tpl_monthly_head_' + l] = LANG_TEXT[l].m_head; });
  SETTING_DEFS.monthly_report_enabled = { t: 'b', def: false }; SETTING_DEFS.monthly_report_day = { t: 'n', def: 1, min: 1, max: 28 };
})();

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
