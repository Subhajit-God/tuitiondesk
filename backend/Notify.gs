/**
 * TuitionDesk backend — Notify.gs : traceable, idempotent notifications.
 *
 * Statuses:  queued (auto-send pending) | sending | sent_to_provider (provider ACCEPTED it; NOT delivery)
 *            | delivered | read (both only from provider webhook) | failed | unknown (outcome uncertain)
 *            | pending_manual (Teacher must send via share link) | manually_sent (Teacher says they sent it)
 *            | skipped | cancelled.
 * "delivered" is NEVER set without provider confirmation.
 *
 * Default mode (TD.MESSAGING === 'self'): the Teacher sends every message from their own WhatsApp via a wa.me link and
 * confirms it ("manually_sent" = the Teacher's word, not a delivery receipt). No provider API is called.
 */
var Notifications = (function () {
  var MAX_ATTEMPTS = 3;

  function apiConfigured() { return TD.MESSAGING === 'api' && !!(Props.get('WA_PHONE_NUMBER_ID') && Props.get('WA_ACCESS_TOKEN') && Settings.get('wa_template_name')); }
  function money(n) { return Settings.get('currency_symbol') + Util.round2(n).toFixed(2); }
  function langOf(st) { var l = st && st.language; return LANGS[l] ? l : 'en'; }
  function render(key, vars, lang) {
    var k = lang && lang !== 'en' && SETTING_DEFS[key + '_' + lang] ? key + '_' + lang : key;
    return Settings.get(k).replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : ''; });
  }
  function inQuiet() {
    if (!Settings.get('quiet_hours_enabled')) return false;
    var s = Settings.get('quiet_start').split(':'), e = Settings.get('quiet_end').split(':');
    var a = parseInt(s[0], 10) * 60 + parseInt(s[1], 10), b = parseInt(e[0], 10) * 60 + parseInt(e[1], 10), n = Util.localMinutes();
    return a === b ? false : (a < b ? (n >= a && n < b) : (n >= a || n < b));
  }
  function quietEndIso() {
    // next time the local clock reads quiet_end: step forward minute-by-minute is wasteful; approximate by minutes difference
    var e = Settings.get('quiet_end').split(':'), target = parseInt(e[0], 10) * 60 + parseInt(e[1], 10), n = Util.localMinutes();
    var diff = target - n; if (diff <= 0) diff += 1440;
    return new Date(Util.now().getTime() + diff * 60000).toISOString();
  }
  function shareLink(n) { return n.recipient ? Util.waLink(n.recipient, n.message) : ''; }
  function view(n, names) {
    var held = ['pending_manual', 'queued'].indexOf(n.status) >= 0 && !!n.not_before && n.not_before > Util.nowIso();
    var manual = ['pending_manual', 'failed', 'unknown', 'skipped'].indexOf(n.status) >= 0 && n.recipient;
    return { notificationId: n.notification_id, trigger: n.trigger, studentId: n.student_id, studentName: names ? (names[n.student_id] || '') : '', recipient: n.recipient, channel: n.channel, template: n.template, templateVersion: n.template_version, message: n.message,
      status: n.status, statusReason: n.status_reason, notBefore: n.not_before, attempts: n.attempts, lastAttemptAt: n.last_attempt_at, providerMessageId: n.provider_message_id, nextRetryAt: n.next_retry_at, relatedType: n.related_type, relatedId: n.related_id, createdAt: n.created_at,
      shareLink: manual ? shareLink(n) : '', held: held, canRetry: ['failed', 'unknown'].indexOf(n.status) >= 0, canMarkSent: ['pending_manual', 'failed', 'unknown'].indexOf(n.status) >= 0 };
  }

  /** Create a notification unless one with the same idempotency key already exists. */
  function create(ctx, spec) {
    var ex = Db.find('Notifications', function (n) { return n.idempotency_key === spec.key; });
    if (ex) return { created: false, notification: ex };
    var st = spec.studentId ? Db.get('Students', spec.studentId) : null, phone = spec.recipient || (st ? st.guardian_whatsapp : ''), consent = st ? st.whatsapp_consent : 'yes';
    var status, reason = '', channel = 'whatsapp_share_link', notBefore = '';
    if (!phone) { status = 'skipped'; reason = 'No WhatsApp number on file.'; }
    else if (consent === 'no') { status = 'skipped'; reason = 'Guardian has opted out of messages.'; }
    else if (apiConfigured() && consent === 'yes') { status = 'queued'; channel = 'whatsapp_api'; if (inQuiet()) { notBefore = quietEndIso(); reason = 'Held for quiet hours.'; } }
    else {
      status = 'pending_manual';
      reason = !apiConfigured() ? (consent === 'unknown' ? 'You send this yourself from your WhatsApp. Guardian consent is not recorded — confirm they are happy to receive messages.' : 'You send this yourself from your WhatsApp.') : 'Guardian consent for automatic messages is not confirmed — send manually.';
      if (inQuiet()) { notBefore = quietEndIso(); reason = 'Quiet hours — best sent after ' + Settings.get('quiet_end') + '. ' + reason; }
    }
    var n = Db.insert('Notifications', { notification_id: Util.newId('ntf'), idempotency_key: spec.key, trigger: spec.trigger, student_id: spec.studentId || '', recipient: phone, channel: channel, template: spec.template || '', template_version: spec.templateVersion || '',
      message: spec.message, status: status, status_reason: reason, not_before: notBefore, attempts: 0, last_attempt_at: '', provider_message_id: '', provider_response: '', next_retry_at: '', related_type: spec.relatedType || '', related_id: spec.relatedId || '' });
    return { created: true, notification: n };
  }
  function countCreated(results) { return results.filter(function (r) { return r.created; }).length; }
  function guardian(st) { return st.guardian_name || 'Parent/Guardian'; }
  function payline(ctx, sid, lang) { try { return PayLinks.line(ctx, sid, { lang: lang }); } catch (e) { return ''; } }
  function ver(key) { return Settings.templateVersion(key); }

  function claimDue(limit) {
    var now = Util.nowIso(), claimed = [];
    var due = Db.filter('Notifications', function (n) {
      if (n.channel !== 'whatsapp_api') return false;
      if (n.status === 'queued') return !n.not_before || n.not_before <= now ? !inQuiet() || !!n.not_before : false;
      if (n.status === 'failed') return n.attempts < MAX_ATTEMPTS && n.next_retry_at && n.next_retry_at <= now;
      return false;
    });
    due.slice(0, limit).forEach(function (n) { Db.update('Notifications', n.notification_id, { status: 'sending', attempts: n.attempts + 1, last_attempt_at: now }); claimed.push(n.notification_id); });
    return claimed;
  }
  function attempt(n) {
    var phoneId = Props.get('WA_PHONE_NUMBER_ID'), token = Props.get('WA_ACCESS_TOKEN');
    var payload = { messaging_product: 'whatsapp', to: n.recipient, type: 'template', template: { name: Settings.get('wa_template_name'), language: { code: Settings.get('wa_template_lang') }, components: [{ type: 'body', parameters: [{ type: 'text', text: n.message.slice(0, 1000) }] }] } };
    try {
      var r = UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + phoneId + '/messages', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(payload), muteHttpExceptions: true });
      var code = r.getResponseCode(), body = r.getContentText() || '', id = '';
      try { var j = JSON.parse(body); id = j.messages && j.messages[0] && j.messages[0].id || ''; } catch (e) { /* ignore */ }
      if (code >= 200 && code < 300 && id) return { status: 'sent_to_provider', id: id, response: 'HTTP ' + code };
      return { status: 'failed', reason: 'Provider rejected the request (HTTP ' + code + ').', response: body.replace(/Bearer\s+\S+/g, '').slice(0, 300) };
    } catch (err) { return { status: 'unknown', reason: 'Network error — the provider may or may not have received the message.', response: String(err.message || err).slice(0, 200) }; }
  }

  return {
    create: create, view: view, langOf: langOf, apiConfigured: apiConfigured, render: render, money: money, guardian: guardian, ver: ver, inQuiet: inQuiet,

    queueAbsences: function (ctx, session, batch, absentEntries, force) {
      if (!force && !Settings.get('absence_alert_enabled')) return 0;
      var res = absentEntries.map(function (e) {
        var st = Db.get('Students', e.studentId);
        return create(ctx, { key: 'absence:' + session.session_id + ':' + e.studentId, trigger: 'absence', studentId: e.studentId, template: 'tpl_absence', templateVersion: ver('tpl_absence'), relatedType: 'attendance_session', relatedId: session.session_id,
          message: render('tpl_absence', { guardian: guardian(st), student: st.full_name, date: session.session_date, batch: batch.name, centre: Settings.get('centre_name') }, langOf(st)) });
      });
      return countCreated(res);
    },
    queueResultPublished: function (ctx, test, rows) {
      var res = rows.map(function (r) { var st = Db.get('Students', r.studentId); return create(ctx, { key: 'result:' + test.test_id + ':' + r.studentId, trigger: 'result_published', studentId: r.studentId, template: 'tpl_notice', templateVersion: ver('tpl_notice'), relatedType: 'test', relatedId: test.test_id,
        message: render('tpl_notice', { centre: Settings.get('centre_name'), title: 'Results published', body: 'Results of "' + test.title + '" (' + test.test_date + ') for ' + st.full_name + ' are now available in the student portal.' }) }); });
      return countCreated(res);
    },
    queueHomework: function (ctx, hw) {
      var students = hw.audience_type === 'student' ? [Db.get('Students', hw.student_id)] : Batches.roster(hw.batch_id, Util.today()).map(function (r) { return Db.get('Students', r.studentId); });
      return countCreated(students.map(function (st) { return create(ctx, { key: 'homework:' + hw.homework_id + ':' + st.student_id, trigger: 'homework', studentId: st.student_id, template: 'tpl_notice', templateVersion: ver('tpl_notice'), relatedType: 'homework', relatedId: hw.homework_id,
        message: render('tpl_notice', { centre: Settings.get('centre_name'), title: 'New homework: ' + hw.title, body: 'Due ' + hw.due_date + ' for ' + st.full_name + '.' }) }); }));
    },
    queueScheduleChange: function (ctx, batch, message) {
      var stamp = Util.sha256Hex(message).slice(0, 10);
      var res = Batches.roster(batch.batch_id, Util.today()).map(function (r) { var st = Db.get('Students', r.studentId); return create(ctx, { key: 'schedule:' + batch.batch_id + ':' + stamp + ':' + r.studentId, trigger: 'schedule_change', studentId: r.studentId, template: 'tpl_notice', templateVersion: ver('tpl_notice'), relatedType: 'batch', relatedId: batch.batch_id,
        message: render('tpl_notice', { centre: Settings.get('centre_name'), title: 'Schedule update (' + batch.name + ')', body: message }) }); });
      Audit.log(ctx, 'notification.schedule_change', 'batch', batch.batch_id, { queued: countCreated(res) });
      return countCreated(res);
    },
    queueNotice: function (ctx, notice) {
      var res = Notices.recipients(notice).map(function (st) { return create(ctx, { key: 'notice:' + notice.notice_id + ':' + st.student_id, trigger: 'notice', studentId: st.student_id, template: 'tpl_notice', templateVersion: ver('tpl_notice'), relatedType: 'notice', relatedId: notice.notice_id,
        message: render('tpl_notice', { centre: Settings.get('centre_name'), title: notice.title, body: notice.body }) }); });
      Audit.log(ctx, 'notification.notice', 'notice', notice.notice_id, { queued: countCreated(res) });
      return countCreated(res);
    },

    /** Fee reminders for students with outstanding balances. Scheduled runs use a per-month key; manual runs a per-day key. */
    queueFeeReminders: function (ctx, opts) {
      opts = opts || {}; var today = Util.today(), month = Util.monthOf(today), res = [], ids = opts.studentIds ? {} : null;
      if (ids) opts.studentIds.forEach(function (s) { ids[s] = 1; });
      var by = Util.groupBy(Ledger.fees().filter(function (v) { return v.recordStatus === 'active' && v.balance > 0 && v.billingPeriod <= month; }), 'studentId');
      Object.keys(by).forEach(function (sid) {
        if (ids && !ids[sid]) return;
        var st = Db.get('Students', sid); if (!st || (st.status !== 'active' && st.status !== 'left')) return;
        var total = 0, periods = []; by[sid].forEach(function (v) { total += Util.paise(v.balance); periods.push(v.billingPeriod); });
        var key = opts.scheduled ? 'fee_reminder:' + month + ':' + sid : 'fee_reminder_manual:' + today + ':' + sid;
        res.push(create(ctx, { key: key, trigger: 'fee_reminder', studentId: sid, template: 'tpl_fee_reminder', templateVersion: ver('tpl_fee_reminder'), relatedType: 'student', relatedId: sid,
          message: render('tpl_fee_reminder', { guardian: guardian(st), student: st.full_name, amount: money(Util.fromPaise(total)), periods: periods.sort().join(', '), centre: Settings.get('centre_name'), payline: payline(ctx, sid, langOf(st)) }, langOf(st)) }));
      });
      return { eligible: Object.keys(by).length, created: countCreated(res), existing: res.length - countCreated(res) };
    },
    queueOverdue: function (ctx, opts) {
      opts = opts || {}; var today = Util.today(), interval = Settings.get('overdue_followup_interval_days'), win = Math.floor(Util.diffDays(today, '1970-01-01') / interval), res = [];
      var by = Util.groupBy(Ledger.fees().filter(function (v) { return v.recordStatus === 'active' && v.balance > 0 && v.overdueDays > 0; }), 'studentId');
      Object.keys(by).forEach(function (sid) {
        var st = Db.get('Students', sid); if (!st || (st.status !== 'active' && st.status !== 'left')) return;
        if (Db.find('Notifications', function (n) { return n.student_id === sid && n.trigger === 'fee_reminder' && n.created_at.slice(0, 10) === today; })) return;
        var total = 0, periods = []; by[sid].forEach(function (v) { total += Util.paise(v.balance); periods.push(v.billingPeriod); });
        res.push(create(ctx, { key: 'overdue:' + sid + ':' + win, trigger: 'overdue_followup', studentId: sid, template: 'tpl_overdue', templateVersion: ver('tpl_overdue'), relatedType: 'student', relatedId: sid,
          message: render('tpl_overdue', { guardian: guardian(st), student: st.full_name, amount: money(Util.fromPaise(total)), periods: periods.sort().join(', '), centre: Settings.get('centre_name'), payline: payline(ctx, sid, langOf(st)) }, langOf(st)) }));
      });
      return { eligible: Object.keys(by).length, created: countCreated(res) };
    },
    /** Weekly report for the 7 days ending on `end` (inclusive). Returns null when there is no real data. */
    buildWeekly: function (end) {
      var from = Util.addDays(end, -6), pays = Db.filter('Payments', function (p) { return p.verification_status === 'verified' && p.received_at >= from && p.received_at <= end; });
      var coll = 0; pays.forEach(function (p) { coll += (p.kind === 'refund' ? -1 : 1) * Util.paise(p.amount); });
      var sess = Db.filter('AttendanceSessions', function (s) { return s.session_date >= from && s.session_date <= end; }), sid = {}; sess.forEach(function (s) { sid[s.session_id] = 1; });
      var ent = Db.filter('AttendanceEntries', function (e) { return sid[e.session_id]; }), c = Attendance.counts(ent);
      var tests = Db.filter('Tests', function (t) { return t.test_date >= from && t.test_date <= end; }), enq = Db.filter('Enquiries', function (e) { return e.enquiry_date >= from && e.enquiry_date <= end; });
      var adm = Db.filter('Admissions', function (a) { return a.admission_date >= from && a.admission_date <= end && a.status === 'confirmed'; });
      if (!pays.length && !sess.length && !tests.length && !enq.length && !adm.length) return null;
      var t = Ledger.totals(Ledger.fees());
      var text = Settings.get('centre_name') + ' — weekly summary ' + from + ' to ' + end + '\nVerified collections (net): ' + money(Util.fromPaise(coll)) + '\nOutstanding fees: ' + money(t.balance) + ' (overdue ' + money(t.overdue) + ')\nClasses recorded: ' + sess.length + ' — present ' + c.P + ', absent ' + c.A + ', holiday ' + c.H +
        '\nTests held: ' + tests.length + '\nNew enquiries: ' + enq.length + ', admissions: ' + adm.length;
      return { from: from, to: end, text: text };
    },
    queueWeekly: function (ctx, end) {
      var rep = Notifications.buildWeekly(end); if (!rep) return { skipped: true, reason: 'No recorded activity in the period.' };
      var rec = Settings.get('weekly_report_recipients').split(',').filter(Boolean); if (!rec.length) return { skipped: true, reason: 'No weekly report recipients configured.' };
      var res = rec.map(function (ph) { return create(ctx, { key: 'weekly:' + end + ':' + ph, trigger: 'weekly_report', recipient: ph, template: 'weekly', templateVersion: 'v1', relatedType: 'report', relatedId: end, message: rep.text }); });
      return { skipped: false, created: countCreated(res), from: rep.from, to: rep.to };
    },

    /** Claim → send (outside the lock) → record. Safe for overlapping triggers (claim step is under lock). */
    processQueue: function (limit) {
      if (!apiConfigured()) return { processed: 0 };
      var ids = Runtime.withLock(function () { Db.reset(); Settings.reset(); return claimDue(limit || 15); }), done = 0;
      ids.forEach(function (id) {
        var n = Runtime.withLock(function () { Db.reset(); return Db.get('Notifications', id); });
        var out = attempt(n);
        Runtime.withLock(function () {
          Db.reset();
          var patch = { status: out.status, provider_response: out.response || '', status_reason: out.reason || '', provider_message_id: out.id || '' };
          if (out.status === 'failed') patch.next_retry_at = new Date(Util.now().getTime() + Math.pow(4, n.attempts) * 5 * 60000).toISOString();
          Db.update('Notifications', id, patch);
        });
        done++;
      });
      return { processed: done };
    },
    /** Any notification stuck in "sending" (crashed mid-attempt) becomes "unknown" — never silently re-sent. */
    sweepStale: function () {
      var cutoff = new Date(Util.now().getTime() - 10 * 60000).toISOString(), n = 0;
      Db.filter('Notifications', function (x) { return x.status === 'sending' && x.last_attempt_at < cutoff; }).forEach(function (x) { Db.update('Notifications', x.notification_id, { status: 'unknown', status_reason: 'Send attempt did not finish; outcome unknown.' }); n++; });
      return n;
    },
    list: function (ctx, p) {
      var names = {}; Db.all('Students').forEach(function (s) { names[s.student_id] = s.full_name; });
      var q = (p.search || '').toLowerCase();
      var rows = Db.filter('Notifications', function (n) { return (!p.status || n.status === p.status) && (!p.trigger || n.trigger === p.trigger) && (!p.studentId || n.student_id === p.studentId); }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(function (n) { return view(n, names); });
      if (q) rows = rows.filter(function (r) { return (r.studentName + ' ' + r.message).toLowerCase().indexOf(q) >= 0; });
      var out = Util.paginate(rows, p); out.apiConfigured = apiConfigured(); return out;
    },
    markManuallySent: function (ctx, p) {
      var n = Db.get('Notifications', V.id(p.notificationId, 'notificationId')); if (!n) throw new ApiError('NOT_FOUND', 'Notification not found.');
      if (['pending_manual', 'failed', 'unknown'].indexOf(n.status) < 0) throw new ApiError('CONFLICT', 'This notification cannot be marked as sent manually.');
      var u = Db.update('Notifications', n.notification_id, { status: 'manually_sent', status_reason: 'Teacher confirmed sending manually (delivery not verified).', last_attempt_at: Util.nowIso() });
      Audit.log(ctx, 'notification.manual_sent', 'notification', n.notification_id, {}); return view(u);
    },
    cancel: function (ctx, p) {
      var n = Db.get('Notifications', V.id(p.notificationId, 'notificationId')); if (!n) throw new ApiError('NOT_FOUND', 'Notification not found.');
      if (['queued', 'pending_manual', 'failed', 'unknown'].indexOf(n.status) < 0) throw new ApiError('CONFLICT', 'This notification can no longer be cancelled.');
      var u = Db.update('Notifications', n.notification_id, { status: 'cancelled', status_reason: 'Cancelled by Teacher.' }); Audit.log(ctx, 'notification.cancel', 'notification', n.notification_id, {}); return view(u);
    },
    retry: function (ctx, p) {
      var n = Db.get('Notifications', V.id(p.notificationId, 'notificationId')); if (!n) throw new ApiError('NOT_FOUND', 'Notification not found.');
      if (n.provider_message_id || ['sent_to_provider', 'delivered', 'read', 'manually_sent'].indexOf(n.status) >= 0) throw new ApiError('CONFLICT', 'This message was already accepted by the provider or sent; retrying would duplicate it.');
      if (n.status === 'unknown' && p.confirmDuplicateRisk !== true) throw new ApiError('NEEDS_CONFIRMATION', 'The earlier attempt may have reached the recipient. Retrying could send a duplicate. Confirm to retry.');
      if (['failed', 'unknown'].indexOf(n.status) < 0) throw new ApiError('CONFLICT', 'Only failed or unknown notifications can be retried.');
      if (n.channel !== 'whatsapp_api') throw new ApiError('CONFLICT', 'Use the WhatsApp share link for manual notifications.');
      var u = Db.update('Notifications', n.notification_id, { status: 'queued', attempts: Math.min(n.attempts, MAX_ATTEMPTS - 1), status_reason: 'Retry requested by Teacher.', not_before: '' });
      Audit.log(ctx, 'notification.retry', 'notification', n.notification_id, {});
      ctx.afterCommit.push(function () { Notifications.processQueue(10); });
      return view(u);
    },
    /** Provider status webhook (WhatsApp Cloud API shape). The ONLY path that can set delivered/read. */
    webhookStatus: function (payload) {
      var n = 0, rank = { sent_to_provider: 1, delivered: 2, read: 3 };
      ((payload && payload.entry) || []).forEach(function (en) { (en.changes || []).forEach(function (ch) { ((ch.value && ch.value.statuses) || []).forEach(function (s) {
        var rec = Db.find('Notifications', function (x) { return x.provider_message_id === s.id; }); if (!rec) return;
        var map = { delivered: 'delivered', read: 'read', failed: 'failed' }, to = map[s.status]; if (!to) return;
        if (to !== 'failed' && (rank[to] || 0) <= (rank[rec.status] || 0)) return;
        Db.update('Notifications', rec.notification_id, { status: to, status_reason: to === 'failed' ? String((s.errors && s.errors[0] && s.errors[0].title) || 'Provider reported failure').slice(0, 200) : 'Confirmed by provider.' }); n++;
      }); }); });
      return n;
    },
    counts: function () {
      var c = {}; Db.all('Notifications').forEach(function (n) { c[n.status] = (c[n.status] || 0) + 1; }); return c;
    }
  };
})();
