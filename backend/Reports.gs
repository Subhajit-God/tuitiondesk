/** TuitionDesk backend — Reports.gs : Teacher dashboard and the Student portal (strictly self-scoped). */
var Dashboard = (function () {
  function collections(from, to) {
    var g = 0, r = 0, by = {};
    Db.filter('Payments', function (p) { return p.verification_status === 'verified' && p.received_at >= from && p.received_at <= to; }).forEach(function (p) {
      var a = Util.paise(p.amount); if (p.kind === 'refund') { r += a; by[p.method] = (by[p.method] || 0) - a; } else { g += a; by[p.method] = (by[p.method] || 0) + a; }
    });
    Object.keys(by).forEach(function (k) { by[k] = Util.fromPaise(by[k]); });
    return { gross: Util.fromPaise(g), refunds: Util.fromPaise(r), net: Util.fromPaise(g - r), byMethod: by };
  }
  function monthsBack(today, n) { var out = [], y = parseInt(today.slice(0, 4), 10), m = parseInt(today.slice(5, 7), 10); for (var i = n - 1; i >= 0; i--) { var mm = m - i, yy = y; while (mm < 1) { mm += 12; yy--; } out.push(yy + '-' + Util.pad(mm, 2)); } return out; }

  return {
    collections: collections,
    get: function (ctx, p) {
      var today = Util.today(), from = V.date(p.from || Util.monthStart(today), 'from'), to = V.date(p.to || today, 'to');
      if (to < from) V.fail('to', 'must not be before from');
      var views = Ledger.fees().filter(function (v) { return v.recordStatus === 'active'; }), tot = Ledger.totals(views);
      var overdueStudents = {}; views.forEach(function (v) { if (v.overdueDays > 0 && v.balance > 0) overdueStudents[v.studentId] = 1; });
      var pend = Db.filter('Payments', function (x) { return x.verification_status === 'pending'; }), pendAmt = 0; pend.forEach(function (x) { pendAmt += Util.paise(x.amount); });
      var students = Db.all('Students'), counts = {}; Db.filter('StudentBatchLinks', function (l) { return l.status === 'active'; }).forEach(function (l) { counts[l.batch_id] = (counts[l.batch_id] || 0) + 1; });
      var batches = Db.filter('Batches', function (b) { return b.status === 'active'; });
      var sm = {}; students.forEach(function (s) { sm[s.student_id] = s.full_name; });
      var recent = Db.filter('Payments', function (x) { return x.verification_status === 'verified' && x.kind === 'payment'; }).sort(function (a, b) { return a.verified_at < b.verified_at ? 1 : -1; }).slice(0, 5).map(function (x) { return { paymentId: x.payment_id, studentName: sm[x.student_id] || '', amount: x.amount, method: x.method, verifiedAt: x.verified_at }; });
      var upcoming = Timetable.upcoming(7).filter(function (c) { return c.type !== 'cancellation'; }).slice(0, 10);
      // attendance exceptions: students with >= threshold absences in the last 14 days
      var since = Util.addDays(today, -13), thr = Settings.get('absence_exception_threshold'), sess = {}; Db.filter('AttendanceSessions', function (s) { return s.session_date >= since && s.session_date <= today; }).forEach(function (s) { sess[s.session_id] = 1; });
      var abs = {}; Db.filter('AttendanceEntries', function (e) { return sess[e.session_id] && e.status === 'A'; }).forEach(function (e) { abs[e.student_id] = (abs[e.student_id] || 0) + 1; });
      var exceptions = Object.keys(abs).filter(function (k) { return abs[k] >= thr; }).map(function (k) { return { studentId: k, fullName: sm[k] || '', absences: abs[k] }; }).sort(function (a, b) { return b.absences - a.absences; });
      var enqs = Db.all('Enquiries'), admsInRange = Db.filter('Admissions', function (a) { return a.status === 'confirmed' && a.admission_date >= from && a.admission_date <= to; });
      var nc = Notifications.counts(), jobFails = Db.filter('JobRuns', function (j) { return j.status === 'error'; }).sort(function (a, b) { return a.started_at < b.started_at ? 1 : -1; }).slice(0, 3).map(function (j) { return { job: j.job, at: j.started_at, details: j.details }; });
      var months = monthsBack(today, 6), trendC = months.map(function (m) { var c = collections(m + '-01', m + '-31'); return { month: m, net: c.net }; });
      var trendE = months.map(function (m) { return { month: m, count: students.filter(function (s) { return s.admission_date.slice(0, 7) === m; }).length }; });
      return {
        range: { from: from, to: to },
        definitions: {
          collections: 'Verified payments received in the date range, minus verified refunds. Pending and rejected payments are never counted.',
          outstanding: 'Sum of fee balances (net due after adjustments minus allocated verified payments) for active fee obligations, as of today.',
          overdue: 'Outstanding balance on fees whose due date has passed.',
          attendanceExceptions: 'Students with ' + thr + ' or more absences in the last 14 days (' + since + ' to ' + today + ').',
          trends: 'Calculated from actual records for the last 6 calendar months; shown only when at least 2 months contain data.'
        },
        collections: collections(from, to), outstanding: { total: tot.balance, overdue: tot.overdue, overdueStudents: Object.keys(overdueStudents).length },
        pendingVerification: { count: pend.length, amount: Util.fromPaise(pendAmt) },
        students: { active: students.filter(function (s) { return s.status === 'active'; }).length, total: students.length },
        batches: { active: batches.length, occupancy: batches.map(function (b) { return { batchId: b.batch_id, name: b.name, members: counts[b.batch_id] || 0, capacity: b.capacity, percent: b.capacity > 0 ? Math.round((counts[b.batch_id] || 0) / b.capacity * 1000) / 10 : null }; }) },
        recentPayments: recent, upcomingClasses: upcoming, attendanceExceptions: exceptions,
        enquiries: { recent: enqs.sort(function (a, b) { return a.enquiry_date < b.enquiry_date ? 1 : -1; }).slice(0, 5).map(function (e) { return { enquiryId: e.enquiry_id, name: e.name, status: e.status, enquiryDate: e.enquiry_date }; }), newInRange: enqs.filter(function (e) { return e.enquiry_date >= from && e.enquiry_date <= to; }).length, conversionsInRange: admsInRange.length },
        notifications: { failed: nc.failed || 0, unknown: nc.unknown || 0, pendingManual: nc.pending_manual || 0, jobFailures: jobFails },
        trends: { collections: trendC, enrolments: trendE, sufficient: trendC.filter(function (t) { return t.net !== 0; }).length >= 2 || trendE.filter(function (t) { return t.count > 0; }).length >= 2 },
        reconciliation: { ok: Ledger.reconcile().ok }
      };
    }
  };
})();

/** Student portal. EVERY function derives the student from the authenticated session — never from request params. */
var Portal = (function () {
  function sid(ctx) { if (!ctx.session.studentId) throw new ApiError('FORBIDDEN', 'No student profile is linked to this account.'); return ctx.session.studentId; }
  return {
    home: function (ctx) {
      var id = sid(ctx), today = Util.today(), att = Attendance.summaryFor(id, Util.addDays(today, -29), today), fees = Fees.statement(id, true);
      return { profile: Students.selfView(Students.need(id)), upcomingClasses: Timetable.forStudent(id).upcoming.filter(function (c) { return c.type !== 'cancellation'; }).slice(0, 5),
        attendance: { counts: att.counts, percentage: att.percentage, from: att.from, to: att.to }, fees: { balance: fees.totals.balance, overdue: fees.totals.overdue, credit: fees.creditOnAccount },
        homeworkDue: Homework.forStudent(id).filter(function (h) { return h.dueDate >= today; }).slice(0, 5), notices: Notices.forStudent(id).slice(0, 3), results: Tests.resultsFor(id).slice(0, 3), centre: Settings.publicInfo() };
    },
    profile: function (ctx) { return Students.selfView(Students.need(sid(ctx))); },
    timetable: function (ctx) { return Timetable.forStudent(sid(ctx)); },
    attendance: function (ctx, p) { return Attendance.summaryFor(sid(ctx), V.date(p.from, 'from'), V.date(p.to, 'to')); },
    homework: function (ctx) { return { items: Homework.forStudent(sid(ctx)) }; },
    results: function (ctx) { return { items: Tests.resultsFor(sid(ctx)) }; },
    fees: function (ctx) { var s = Fees.statement(sid(ctx), true); s.paymentInfo = Settings.publicInfo(); return s; },
    reportPayment: function (ctx, p) { return Payments.reportByStudent(ctx, p); },
    receipts: function (ctx) {
      var id = sid(ctx); return { items: Db.filter('Receipts', function (r) { return r.student_id === id && r.status === 'valid'; }).sort(function (a, b) { return a.issued_at < b.issued_at ? 1 : -1; }).map(function (r) { var v = Receipts.view(r); return { receiptNumber: v.receiptNumber, amount: v.amount, method: v.method, issuedAt: v.issuedAt, verificationId: v.verificationId }; }) };
    },
    documents: function (ctx) { return { items: Documents.listForStudent(sid(ctx)) }; },
    document: function (ctx, p) { return Documents.getForStudent(sid(ctx), p.verificationId); },
    notices: function (ctx) { return { items: Notices.forStudent(sid(ctx)) }; }
  };
})();

var AuditApi = {
  list: function (ctx, p) {
    var q = (p.search || '').toLowerCase();
    var rows = Db.filter('AuditLogs', function (a) { return (!p.entityType || a.entity_type === p.entityType) && (!p.action || a.action.indexOf(p.action) === 0) && (!p.actor || a.actor_user_id === p.actor) && (!p.from || a.at.slice(0, 10) >= p.from) && (!p.to || a.at.slice(0, 10) <= p.to) && (!q || (a.action + ' ' + a.entity_id).toLowerCase().indexOf(q) >= 0); })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; }).map(function (a) { return { auditId: a.audit_id, at: a.at, actorUserId: a.actor_user_id, actorRole: a.actor_role, action: a.action, entityType: a.entity_type, entityId: a.entity_id, details: a.details }; });
    return Util.paginate(rows, p);
  }
};
