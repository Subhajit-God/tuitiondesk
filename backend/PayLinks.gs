/**
 * TuitionDesk backend — PayLinks.gs : one-tap UPI pay links.
 *
 * Every family gets ONE stable, unguessable link (128-bit random id). Opening it shows the live amount due, the months it covers
 * and a "Pay with UPI" button that opens the parent's UPI app with the payee, exact amount and a note already filled in.
 *
 * What this does NOT do (and the UI says so): it cannot see whether the parent completed the payment in their UPI app.
 * A payment counts only after the Teacher records and verifies it against the bank statement (Fees & Payments). The
 * "I have paid" button only leaves a note for the Teacher and pauses reminders for a few days; it never marks anything paid.
 *
 * Privacy: the public page returns the student's FIRST NAME, the centre name, amounts, months and the Teacher's UPI details.
 * No phone numbers, no full name, no other students, no payment history.
 */
var PayLinks = (function () {
  var REPORT_HOLD_DAYS = 3;
  function windowDays() { return Settings.get('ladder_before_days') + 4; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(period) { var m = parseInt(String(period).slice(5, 7), 10); return (MON[m - 1] || '?') + ' ' + String(period).slice(0, 4); }
  function dateLabel(d) { var m = parseInt(String(d).slice(5, 7), 10); return parseInt(String(d).slice(8, 10), 10) + ' ' + (MON[m - 1] || ''); }
  function firstName(full) { return String(full || '').trim().split(/\s+/)[0] || ''; }
  function validUpi() { var u = Settings.get('upi_id'); return /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(u) ? u : ''; }
  function throttle(prefix) {
    var k = prefix + Math.floor(Util.now().getTime() / 60000), n = 0;
    try {
      n = parseInt(CacheService.getScriptCache().get(k) || '0', 10);
      if (n >= TD.PAY_MAX_PER_MINUTE) throw new ApiError('RATE_LIMITED', 'Too many requests. Please retry shortly.');
      CacheService.getScriptCache().put(k, String(n + 1), 90);
    } catch (e) { if (e instanceof ApiError) throw e; }
  }
  function byStudent(sid) { return Db.find('PayLinks', function (r) { return r.student_id === sid; }); }
  function baseUrl() { var b = Settings.get('public_base_url'); return b ? b.replace(/#.*$/, '') : ''; }
  function urlFor(rec) { var b = baseUrl(); return b && rec ? b + '#/pay/' + rec.link_id : ''; }
  function refOf(rec) { return rec.link_id.slice(0, 6).toUpperCase(); }
  function ensure(ctx, sid) {
    var r = byStudent(sid); if (r) return r;
    r = Db.insert('PayLinks', { link_id: Util.uuid(), student_id: sid, created_at: Util.nowIso(), last_reported_at: '', report_count: 0, last_reported_ref: '', updated_at: Util.nowIso() });
    Audit.log(ctx, 'paylink.create', 'student', sid, {}); return r;
  }

  /** Everything payable now: unpaid active fees due within the window (past-due fees are always included). */
  function dues(sid) {
    var limit = Util.addDays(Util.today(), windowDays()), fees = Ledger.fees(sid).filter(function (v) { return v.recordStatus === 'active' && v.balance > 0 && v.dueDate <= limit; });
    fees.sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0; });
    var total = 0, periods = []; fees.forEach(function (v) { total += Util.paise(v.balance); if (periods.indexOf(v.billingPeriod) < 0) periods.push(v.billingPeriod); });
    return { fees: fees, paise: total, amount: Util.fromPaise(total), periods: periods };
  }
  function upiUri(sid, rec, d, first) {
    var upi = validUpi(); if (!upi || d.paise <= 0) return '';
    var note = ('Fee ' + first + ' ' + d.periods.map(monthLabel).join(',')).slice(0, 34) + ' #' + refOf(rec), payee = Settings.get('upi_payee_name') || Settings.get('centre_name') || 'Tuition';
    return 'upi://pay?pa=' + encodeURIComponent(upi) + '&pn=' + encodeURIComponent(payee) + '&am=' + Util.fromPaise(d.paise).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent(note);
  }

  return {
    dues: dues, monthLabel: monthLabel, dateLabel: dateLabel, windowDays: windowDays, REPORT_HOLD_DAYS: REPORT_HOLD_DAYS, byStudent: byStudent,

    /** Text that goes inside reminder messages. Empty when neither a pay page nor a UPI ID is available. */
    line: function (ctx, sid, opts) {
      opts = opts || {};
      var d = dues(sid); if (d.paise <= 0) return '';
      var rec = opts.preview ? byStudent(sid) : ensure(ctx, sid), b = baseUrl();
      if (b && rec) return ' Pay in one tap: ' + urlFor(rec);
      if (b && opts.preview) return ' Pay in one tap: ' + b + '#/pay/(link created when queued)';
      var upi = validUpi(); return upi ? ' Pay by UPI to ' + upi + ' (amount ' + Settings.get('currency_symbol') + d.amount.toFixed(2) + ').' : '';
    },

    /** Teacher: the link for a family (created on first use). */
    teacherLink: function (ctx, p) {
      var sid = V.id(p.studentId, 'studentId'); Students.need(sid);
      var rec = ensure(ctx, sid), d = dues(sid), url = urlFor(rec);
      return { studentId: sid, url: url, reference: refOf(rec), configured: !!url, upiConfigured: !!validUpi(), amount: d.amount, periods: d.periods, reportedAt: rec.last_reported_at, reportCount: rec.report_count,
        problem: !url ? 'Set “Public app address” (https://…) in Settings so links can open the pay page.' : (!validUpi() ? 'Set your UPI ID in Settings so the pay button can open a UPI app.' : '') };
    },

    /** PUBLIC. Unknown / malformed / inactive all return the same shape so ids cannot be probed. */
    info: function (ctx, p) {
      throttle('pchk_');
      var bad = { status: 'invalid' }, id = p && p.id;
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return bad;
      var rec = Db.get('PayLinks', id); if (!rec) return bad;
      var st = Db.get('Students', rec.student_id); if (!st || st.status !== 'active') return bad;
      var d = dues(st.student_id), first = firstName(st.full_name), uri = upiUri(st.student_id, rec, d, first), reportedRecently = !!rec.last_reported_at && Util.diffDays(Util.today(), rec.last_reported_at.slice(0, 10)) < REPORT_HOLD_DAYS;
      return { status: d.paise > 0 ? 'due' : 'clear', centreName: Settings.get('centre_name'), centrePhone: Settings.get('centre_phone'), studentFirstName: first, currencySymbol: Settings.get('currency_symbol'),
        amount: d.amount, months: d.periods.map(monthLabel), items: d.fees.map(function (v) { return { month: monthLabel(v.billingPeriod), dueDate: v.dueDate, amount: v.balance, overdue: v.overdueDays > 0 }; }),
        upiUri: uri, upiId: validUpi(), payeeName: Settings.get('upi_payee_name') || Settings.get('centre_name'), reference: refOf(rec), instructions: Settings.get('payment_instructions'), reportedRecently: reportedRecently };
    },

    /** PUBLIC. "I have paid" — leaves a note for the Teacher. Never changes the ledger. */
    report: function (ctx, p) {
      throttle('prep_');
      var id = p && p.id; if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return { recorded: false };
      var rec = Db.get('PayLinks', id); if (!rec) return { recorded: false };
      var st = Db.get('Students', rec.student_id); if (!st || st.status !== 'active') return { recorded: false };
      if (dues(st.student_id).paise <= 0) return { recorded: false, reason: 'nothing_due' };
      var ref = V.str(p.reference, 'reference', { max: 40 }).replace(/[^A-Za-z0-9 \-]/g, '');
      Db.update('PayLinks', id, { last_reported_at: Util.nowIso(), report_count: (rec.report_count || 0) + 1, last_reported_ref: ref, updated_at: Util.nowIso() });
      Audit.log({ actor: 'public', actorRole: 'public' }, 'paylink.reported', 'student', st.student_id, { reference: ref });
      return { recorded: true, holdDays: REPORT_HOLD_DAYS };
    }
  };
})();
