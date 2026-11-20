/**
 * TuitionDesk backend — Ladder.gs : the smart fee-reminder ladder.
 *
 * Stages (one message per family per run, never more):
 *   friendly — a few days BEFORE the due date
 *   due      — ON the due date (or the first run after it, inside the grace period)
 *   firm     — AFTER the grace period; repeated every `ladder_repeat_days`, at most `ladder_max_firm` times, then "needs a call"
 *
 * Rules, all visible in the preview ("why"):
 *   - It stops the moment the fee is paid: a payment counts only after the Teacher verifies it, then waiting reminders are cancelled.
 *   - It holds while a payment is recorded but unverified, or the parent said "I have paid" in the last few days.
 *   - Per family: mode auto | gentle (no firm messages, goes to "needs a call") | off, and an optional pause-until date.
 *   - Adapts to history (needs >= 3 fully paid fees): families who usually pay on/before the due date skip the friendly nudge;
 *     families who usually pay 5+ days late get the friendly nudge 4 days earlier.
 *   - Quiet hours: scheduled runs never queue inside quiet hours; messages queued by hand during quiet hours are marked "held".
 *   - Nothing is sent by this software. Messages wait in the queue; the Teacher sends each one from their own WhatsApp.
 */
var Ladder = (function () {
  var FIRM_STATES = ['cancelled', 'skipped'];
  function stageTrigger(stage) { return 'ladder_' + stage; }

  function history(sid, maps) {
    var paid = Ledger.fees(sid).filter(function (v) { return v.recordStatus === 'active' && v.netDue > 0 && v.balance <= 0; }).sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : -1; }).slice(0, 6), lates = [];
    paid.forEach(function (v) {
      var last = '';
      (maps.alloc[v.feeId] || []).forEach(function (a) { var p = maps.pay[a.payment_id]; if (p && p.verification_status === 'verified' && p.verified_at && p.verified_at > last) last = p.verified_at; });
      if (last) lates.push(Util.diffDays(last.slice(0, 10), v.dueDate));
    });
    if (lates.length < 3) return null;
    lates.sort(function (a, b) { return a - b; });
    var med = lates[Math.floor(lates.length / 2)];
    return { n: lates.length, median: med, pattern: med <= 0 ? 'prompt' : (med >= 5 ? 'late' : 'typical') };
  }
  function maps_() {
    var alloc = {}, pay = {};
    Db.all('PaymentAllocations').forEach(function (a) { if (a.amount > 0) (alloc[a.fee_id] = alloc[a.fee_id] || []).push(a); });
    Db.all('Payments').forEach(function (p) { pay[p.payment_id] = p; });
    return { alloc: alloc, pay: pay };
  }
  function keyExists(key) { return !!Db.find('Notifications', function (n) { return n.idempotency_key === key; }); }

  /** Work out what the ladder would do today for every family with something owing. Writes nothing. */
  function plan(opts) {
    opts = opts || {};
    var today = Util.today(), before = Settings.get('ladder_before_days'), grace = Settings.get('late_fee_grace_days'), repeat = Settings.get('ladder_repeat_days'), maxFirm = Settings.get('ladder_max_firm'), adapt = Settings.get('ladder_adapt');
    var maps = adapt ? maps_() : null, out = [];
    var by = Util.groupBy(Ledger.fees().filter(function (v) { return v.recordStatus === 'active' && v.balance > 0; }), 'studentId');
    var pendingPay = {}; Db.all('Payments').forEach(function (p) { if (p.kind === 'payment' && p.verification_status === 'pending' && p.student_id) pendingPay[p.student_id] = p; });
    Object.keys(by).forEach(function (sid) {
      var st = Db.get('Students', sid); if (!st || (st.status !== 'active' && st.status !== 'left')) return;
      var unpaid = by[sid], notes = [], hist = adapt ? history(sid, maps) : null;
      var lead = before; if (hist && hist.pattern === 'late') { lead += 4; notes.push('Usually pays ' + hist.median + ' days after the due date — friendly nudge sent 4 days earlier.'); }
      // which stage applies today?
      var firmFees = unpaid.filter(function (v) { return v.overdueDays > grace; });
      var dueFees = unpaid.filter(function (v) { return v.overdueDays > 0 ? v.overdueDays <= grace : v.dueDate === today; });
      var soonFees = unpaid.filter(function (v) { return v.dueDate > today && v.dueDate <= Util.addDays(today, lead); });
      var stage = firmFees.length ? 'firm' : dueFees.length ? 'due' : soonFees.length ? 'friendly' : '';
      if (!stage) return;
      var d = PayLinks.dues(sid); if (d.paise <= 0) return;
      var trig = (stage === 'firm' ? firmFees : stage === 'due' ? dueFees : soonFees).slice().sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; })[0];
      var item = { studentId: sid, studentName: st.full_name, guardianPhone: st.guardian_whatsapp, stage: stage, action: 'send', note: '', amount: d.amount, months: d.periods.map(PayLinks.monthLabel), notes: notes, key: '', message: '', maxOverdueDays: Math.max.apply(null, unpaid.map(function (v) { return v.overdueDays; })) };
      function stop(action, note) { item.action = action; item.note = note; out.push(item); }
      var mode = st.reminder_mode || 'auto';
      if (mode === 'off') return stop('hold', 'Reminders are switched off for this family.');
      if (st.reminder_pause_until && st.reminder_pause_until >= today) return stop('hold', 'Paused until ' + st.reminder_pause_until + '.');
      if (!st.guardian_whatsapp) return stop('blocked', 'No WhatsApp number on file.');
      if (st.whatsapp_consent === 'no') return stop('blocked', 'Guardian has opted out of messages.');
      if (pendingPay[sid]) return stop('hold', 'A payment is recorded but not verified yet — verify it in Fees & Payments first.');
      var link = PayLinks.byStudent(sid);
      if (link && link.last_reported_at && Util.diffDays(today, link.last_reported_at.slice(0, 10)) < PayLinks.REPORT_HOLD_DAYS) return stop('hold', 'Parent said they paid on ' + link.last_reported_at.slice(0, 10) + ' — check your bank and verify the payment.');
      if (stage === 'friendly' && hist && hist.pattern === 'prompt') return stop('skipped', 'Pays on time (median ' + (hist.median < 0 ? Math.abs(hist.median) + ' days early' : 'on the due date') + ' over ' + hist.n + ' fees) — friendly nudge not needed.');
      if (stage === 'firm') {
        var firm = Db.filter('Notifications', function (n) { return n.student_id === sid && n.trigger === stageTrigger('firm'); }), counted = firm.filter(function (n) { return FIRM_STATES.indexOf(n.status) < 0; });
        item.firmSent = counted.length;
        if (mode === 'gentle') return stop('call', 'Gentle family — no firm message. Please call them.');
        if (counted.length >= maxFirm) return stop('call', 'Already sent ' + counted.length + ' firm reminders — please call the family.');
        var last = firm.reduce(function (m, n) { return n.created_at > m ? n.created_at : m; }, '');
        if (last && Util.diffDays(today, last.slice(0, 10)) < repeat) return stop('wait', 'Next firm reminder on ' + Util.addDays(last.slice(0, 10), repeat) + '.');
        item.key = 'ladder:firm:' + sid + ':' + (firm.length + 1);
      } else item.key = 'ladder:' + stage + ':' + trig.feeId;
      if (keyExists(item.key)) return stop('exists', 'Already queued earlier.');
      var days = item.maxOverdueDays;
      item.message = Notifications.render('tpl_ladder_' + stage, { guardian: Notifications.guardian(st), student: st.full_name, centre: Settings.get('centre_name'), amount: Notifications.money(d.amount), months: item.months.join(', '), periods: d.periods.join(', '),
        due: PayLinks.dateLabel(trig.dueDate), days: days, payline: PayLinks.line(opts.ctx, sid, { preview: !!opts.preview, lang: Notifications.langOf(st) }) }, Notifications.langOf(st));
      item.template = 'tpl_ladder_' + stage; item.trigger = trig; out.push(item);
    });
    return out;
  }

  function strip(i) { return { studentId: i.studentId, studentName: i.studentName, stage: i.stage, action: i.action, note: i.note, amount: i.amount, months: i.months, notes: i.notes, message: i.message, guardianPhone: i.guardianPhone, firmSent: i.firmSent || 0 }; }

  return {
    preview: function () { return { today: Util.today(), quietNow: Notifications.inQuiet(), items: plan({ preview: true }).map(strip) }; },

    /** Queue today's messages (idempotent) and cancel waiting ones whose fees are now paid. */
    run: function (ctx) {
      var items = plan({ ctx: ctx }), created = 0, held = 0, call = 0;
      items.forEach(function (i) {
        if (i.action === 'send') {
          var r = Notifications.create(ctx, { key: i.key, trigger: stageTrigger(i.stage), studentId: i.studentId, template: i.template, templateVersion: Notifications.ver(i.template), relatedType: 'fee', relatedId: i.trigger.feeId, message: i.message });
          if (r.created) created++;
        } else if (i.action === 'hold') held++; else if (i.action === 'call') call++;
      });
      var cancelled = Ladder.sweepPaid(ctx);
      Audit.log(ctx, 'ladder.run', 'ladder', '', { created: created, held: held, needsCall: call, cancelledPaid: cancelled });
      return { created: created, held: held, needsCall: call, cancelledPaid: cancelled };
    },

    /** Stops once paid: waiting reminders for families with nothing payable any more are cancelled. */
    sweepPaid: function (ctx) {
      var n = 0, cache = {};
      Db.filter('Notifications', function (x) { return ['pending_manual', 'queued'].indexOf(x.status) >= 0 && /^(ladder_|fee_reminder$|overdue_followup$)/.test(x.trigger) && x.student_id; }).forEach(function (x) {
        var owing = cache[x.student_id]; if (owing === undefined) owing = cache[x.student_id] = Ledger.fees(x.student_id).some(function (v) { return v.recordStatus === 'active' && v.balance > 0; });
        if (!owing) { Db.update('Notifications', x.notification_id, { status: 'cancelled', status_reason: 'Paid — reminder no longer needed.' }); n++; }
      });
      return n;
    },

    status: function () {
      var items = plan({ preview: true }), pend = Db.filter('Notifications', function (n) { return /^ladder_/.test(n.trigger); }), counts = {};
      pend.forEach(function (n) { var k = n.trigger.slice(7) + ':' + n.status; counts[k] = (counts[k] || 0) + 1; });
      var reported = Db.filter('PayLinks', function (r) { return r.last_reported_at && Util.diffDays(Util.today(), r.last_reported_at.slice(0, 10)) < 14; }).map(function (r) { var s = Db.get('Students', r.student_id); return { studentId: r.student_id, studentName: s ? s.full_name : '', at: r.last_reported_at, reference: r.last_reported_ref, count: r.report_count }; });
      var lastRun = Db.filter('JobRuns', function (j) { return j.job === 'ladder'; }).sort(function (a, b) { return a.started_at < b.started_at ? 1 : -1; })[0];
      return { enabled: Settings.get('ladder_enabled'), needsCall: items.filter(function (i) { return i.action === 'call'; }).map(strip), reported: reported, counts: counts, lastRun: lastRun ? { at: lastRun.started_at, status: lastRun.status } : null,
        publicUrlSet: !!Settings.get('public_base_url'), upiSet: /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(Settings.get('upi_id')), messaging: 'self' };
    }
  };
})();
