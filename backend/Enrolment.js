/**
 * TuitionDesk backend — Enrolment.gs : admission, leaving, re-admission, and the billing window.
 *
 * Rule (the Teacher's rule): a student is billed for every month from the ADMISSION MONTH through the LEAVING MONTH, inclusive.
 * A student still enrolled is billed through the current month. The whole of the admission month and the whole of the leaving month
 * are billable (no automatic proration — use a fee discount/adjustment if the Teacher wants to charge less for a part month).
 * A student can leave and later return: each stay is its own "enrolment" and only the months inside a stay are billable.
 *
 * Students created before this feature have no Enrolments rows; their stay is derived from admission_date and is open (billing
 * continues) until the Teacher records a leaving. "Inactive"/"archived" alone never stops billing.
 */
var Enrolments = (function () {
  var REASONS = ['completed', 'relocated', 'fees', 'other_institute', 'not_satisfied', 'health', 'other'];
  function mo(d) { return d ? String(d).slice(0, 7) : ''; }
  function nextP(p) { var y = parseInt(p.slice(0, 4), 10), m = parseInt(p.slice(5, 7), 10) + 1; if (m > 12) { m = 1; y++; } return y + '-' + Util.pad(m, 2); }
  function thisPeriod() { return Util.today().slice(0, 7); }

  /** The student's stays, oldest first. Synthesised for pre-existing students. */
  function spells(s) {
    var rows = Db.filter('Enrolments', function (e) { return e.student_id === s.student_id && e.status !== 'void'; }).sort(function (a, b) { return a.start_date < b.start_date ? -1 : 1; });
    if (rows.length) return rows.map(function (e) { return { enrolmentId: e.enrolment_id, startDate: e.start_date, endDate: e.end_date, reason: e.leave_reason, note: e.leave_note, derived: false }; });
    var end = s.status === 'left' ? (s.leaving_date || s.admission_date) : '';   // inactive/archived are NOT a leaving: billing continues until the Teacher records one
    if (end && end < s.admission_date) end = s.admission_date;
    return [{ enrolmentId: '', startDate: s.admission_date, endDate: end, reason: s.leaving_reason || '', note: '', derived: true }];
  }
  function covers(s, period) { return spells(s).some(function (e) { return period >= mo(e.startDate) && (!e.endDate || period <= mo(e.endDate)); }); }
  /** Every billable period (ascending) from each admission month to its leaving month (current month while still enrolled, or `through` if later). */
  function months(s, through) {
    var out = [], cap = through && through > thisPeriod() ? through : thisPeriod();
    spells(s).forEach(function (e) {
      var last = e.endDate ? mo(e.endDate) : cap;
      for (var p = mo(e.startDate), n = 0; p <= last && n < 240; p = nextP(p), n++) if (out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }
  function ranges(s) { return spells(s).map(function (e) { return mo(e.startDate) + ' → ' + (e.endDate ? mo(e.endDate) : 'now'); }).join(', '); }
  function open_(s) { return Db.find('Enrolments', function (e) { return e.student_id === s.student_id && e.status !== 'void' && !e.end_date; }); }

  function start(ctx, s, date, source) {
    var e = Db.insert('Enrolments', { enrolment_id: Util.newId('enr'), student_id: s.student_id, start_date: date, end_date: '', leave_reason: '', leave_note: '', status: 'active', created_by: ctx.session ? ctx.session.userId : 'system' });
    return e;
  }
  /** Make sure a pre-existing student has a real row before we change their history. */
  function materialise(ctx, s) {
    if (Db.find('Enrolments', function (e) { return e.student_id === s.student_id && e.status !== 'void'; })) return;
    var sp = spells(s)[0]; Db.insert('Enrolments', { enrolment_id: Util.newId('enr'), student_id: s.student_id, start_date: sp.startDate, end_date: sp.endDate, leave_reason: sp.reason, leave_note: '', status: 'active', created_by: 'system' });
  }

  /** Fees that sit outside every stay (e.g. a fee for a month before admission). Shown as a warning, never deleted automatically. */
  function outside(s) {
    return Db.filter('Fees', function (f) { return f.student_id === s.student_id && f.status === 'active' && !covers(s, f.billing_period); }).map(function (f) { return f.billing_period; }).sort();
  }
  function view(s) {
    var sp = spells(s), m = months(s), fees = Ledger.fees(s.student_id).filter(function (v) { return v.recordStatus === 'active'; }), billed = 0, bal = 0;
    fees.forEach(function (v) { billed += Util.paise(v.netDue); bal += Util.paise(Math.max(v.balance, 0)); });
    return { stays: sp, derived: sp[0].derived, billableFrom: m[0] || '', billableTo: m.length ? m[m.length - 1] : '', billableMonths: m.length, billedMonths: fees.length, billed: Util.fromPaise(billed), outstanding: Util.fromPaise(bal), feesOutside: outside(s), leavingDate: s.leaving_date || '', leavingReason: s.leaving_reason || '' };
  }

  /** What leaving on `date` would do. Writes nothing. */
  function impact(s, date) {
    var lim = mo(date), fees = Ledger.fees(s.student_id).filter(function (v) { return v.recordStatus === 'active'; }), cancel = [], review = [], owed = 0;
    fees.forEach(function (v) {
      var endP = v.billingPeriod; for (var m = 1; m < (v.months || 1); m++) endP = nextP(endP);
      if (v.billingPeriod > lim) { (Util.paise(v.paid) === 0 ? cancel : review).push(v); } else { if (endP > lim && v.kind !== 'admission') review.push(v); if (v.balance > 0) owed += Util.paise(v.balance); }
    });
    return { lastBilledMonth: lim, cancel: cancel, review: review, owed: owed };
  }
  function brief(v) { return { feeId: v.feeId, period: v.billingPeriod, amount: v.netDue, paid: v.paid }; }

  return {
    REASONS: REASONS, spells: spells, covers: covers, months: months, ranges: ranges, view: view, start: start, materialise: materialise, outside: outside, mo: mo, nextP: nextP, thisPeriod: thisPeriod,

    leavePreview: function (ctx, p) {
      var s = Students.need(p.studentId); if (['active', 'inactive'].indexOf(s.status) < 0) throw new ApiError('CONFLICT', 'Only a current student can be recorded as leaving.');
      var d = V.date(p.leavingDate, 'leavingDate', { required: true }), sp = spells(s), cur = sp[sp.length - 1];
      if (d < cur.startDate) V.fail('leavingDate', 'cannot be before the admission date (' + cur.startDate + ')');
      if (d > Util.today()) V.fail('leavingDate', 'cannot be in the future — record the leaving on the day it happens');
      var i = impact(s, d);
      return { studentId: s.student_id, studentName: s.full_name, admissionDate: cur.startDate, leavingDate: d, billedFrom: mo(cur.startDate), billedTo: i.lastBilledMonth, months: (function () { var n = 0; for (var q = mo(cur.startDate); q <= i.lastBilledMonth && n < 240; q = nextP(q)) n++; return n; })(),
        willCancel: i.cancel.map(brief), needsReview: i.review.map(brief), outstanding: Util.fromPaise(i.owed) };
    },

    leave: function (ctx, p) {
      var pv = Enrolments.leavePreview(ctx, p), s = Students.need(p.studentId);
      var reason = V.oneOf(p.reason, 'reason', REASONS, { required: true }), note = V.str(p.note, 'note', { max: 300 });
      if (p.confirm !== true) throw new ApiError('NEEDS_CONFIRMATION', 'Confirm that ' + s.full_name + ' left on ' + pv.leavingDate + '. Fees after ' + pv.billedTo + ' will be cancelled' + (pv.needsReview.length ? ' (' + pv.needsReview.length + ' with payments are kept for your review)' : '') + '.');
      materialise(ctx, s);
      var o = open_(s); if (o) Db.update('Enrolments', o.enrolment_id, { end_date: pv.leavingDate, leave_reason: reason, leave_note: note });
      Db.update('Students', s.student_id, { status: 'left', leaving_date: pv.leavingDate, leaving_reason: reason });
      Db.filter('StudentBatchLinks', function (l) { return l.student_id === s.student_id && l.status === 'active'; }).forEach(function (l) { Db.update('StudentBatchLinks', l.link_id, { status: 'ended', end_date: pv.leavingDate }); });
      Auth.setStudentAccountStatus(ctx, s.student_id, false);
      var ids = {}; pv.willCancel.forEach(function (f) { ids[f.feeId] = 1; Db.update('Fees', f.feeId, { status: 'cancelled' }); Audit.log(ctx, 'fee.cancel', 'fee', f.feeId, { reason: 'Student left on ' + pv.leavingDate + ' (billing ends in ' + pv.billedTo + ')', auto: true }); });
      var dropped = 0; Db.filter('Notifications', function (n) { return n.related_type === 'fee' && ids[n.related_id] && ['pending_manual', 'queued'].indexOf(n.status) >= 0; }).forEach(function (n) { Db.update('Notifications', n.notification_id, { status: 'cancelled', status_reason: 'Fee cancelled — student left.' }); dropped++; });
      Audit.log(ctx, 'student.leave', 'student', s.student_id, { date: pv.leavingDate, reason: reason, cancelledFees: pv.willCancel.length, keptForReview: pv.needsReview.length, outstanding: pv.outstanding });
      var out = Students.teacherView(Db.get('Students', s.student_id)); out.leaveSummary = { cancelledFees: pv.willCancel.length, needsReview: pv.needsReview, outstanding: pv.outstanding, cancelledMessages: dropped }; return out;
    },

    readmit: function (ctx, p) {
      var s = Students.need(p.studentId); if (s.status !== 'left') throw new ApiError('CONFLICT', 'Only a student who has left can be re-admitted.');
      var d = V.date(p.admissionDate || Util.today(), 'admissionDate', { required: true }); if (d > Util.today()) V.fail('admissionDate', 'cannot be in the future');
      var last = spells(s).slice(-1)[0]; if (last.endDate && d < last.endDate) V.fail('admissionDate', 'cannot be before the previous leaving date (' + last.endDate + ')');
      if (p.batchId) Batches.need(p.batchId);
      materialise(ctx, s); start(ctx, s, d, 'readmission');
      Db.update('Students', s.student_id, { status: 'active', leaving_date: '', leaving_reason: '' });
      Auth.setStudentAccountStatus(ctx, s.student_id, true);
      Db.insert('Admissions', { admission_id: Util.newId('adm'), enquiry_id: '', student_id: s.student_id, batch_id: p.batchId || '', admission_date: d, source: 'readmission', status: 'confirmed', created_by: ctx.session.userId });
      if (p.batchId) Students.assignInternal(ctx, Db.get('Students', s.student_id), p.batchId, d, !!p.overrideCapacity);
      Audit.log(ctx, 'student.readmit', 'student', s.student_id, { date: d });
      return Students.teacherView(Db.get('Students', s.student_id));
    },

    /** Correct a stay's admission/leaving dates or leaving reason. Opening or closing a stay still goes through Leave / Re-admit. */
    editStay: function (ctx, p) {
      var s = Students.need(p.studentId); materialise(ctx, s);
      var rows = Db.filter('Enrolments', function (e) { return e.student_id === s.student_id && e.status !== 'void'; }).sort(function (a, b) { return a.start_date < b.start_date ? -1 : 1; });
      var i = -1; rows.forEach(function (e, k) { if (e.enrolment_id === p.enrolmentId) i = k; }); if (i < 0) throw new ApiError('NOT_FOUND', 'Stay not found.');
      var row = rows[i], last = i === rows.length - 1;
      var start = p.startDate !== undefined ? V.date(p.startDate, 'startDate', { required: true }) : row.start_date;
      var end = p.endDate !== undefined ? (p.endDate === '' ? '' : V.date(p.endDate, 'endDate')) : row.end_date;
      if (!!end !== !!row.end_date) throw new ApiError('CONFLICT', row.end_date ? 'To bring the student back use Re-admit.' : 'To end this stay use Record leaving.');
      if (start > Util.today()) V.fail('startDate', 'cannot be in the future'); if (end && end > Util.today()) V.fail('endDate', 'cannot be in the future');
      if (end && end < start) V.fail('endDate', 'cannot be before the admission date');
      if (i > 0 && rows[i - 1].end_date && start < rows[i - 1].end_date) V.fail('startDate', 'overlaps the previous stay, which ended on ' + rows[i - 1].end_date);
      if (!last && end && rows[i + 1].start_date < end) V.fail('endDate', 'overlaps the next stay, which started on ' + rows[i + 1].start_date);
      var reason = end ? (p.reason !== undefined ? V.oneOf(p.reason, 'reason', REASONS, { required: true }) : row.leave_reason) : '', note = p.note !== undefined ? V.str(p.note, 'note', { max: 300 }) : row.leave_note;
      var why = V.str(p.editReason, 'editReason', { required: true, min: 3, max: 200 });
      Db.update('Enrolments', row.enrolment_id, { start_date: start, end_date: end, leave_reason: reason, leave_note: note });
      var sp = {}; if (i === 0) sp.admission_date = start; if (last && end) { sp.leaving_date = end; sp.leaving_reason = reason; } if (Object.keys(sp).length) Db.update('Students', s.student_id, sp);
      var adm = Db.find('Admissions', function (a) { return a.student_id === s.student_id && a.admission_date === row.start_date; }); if (adm && start !== row.start_date) Db.update('Admissions', adm.admission_id, { admission_date: start });
      Audit.log(ctx, 'student.stay_edit', 'student', s.student_id, { enrolmentId: row.enrolment_id, before: { start: row.start_date, end: row.end_date, reason: row.leave_reason }, after: { start: start, end: end, reason: reason }, reason: why });
      return Students.teacherView(Db.get('Students', s.student_id));
    },

    /** Everyone who has left, with what they still owe. */
    leavers: function (ctx, p) {
      var q = (p.search || '').toLowerCase();
      var rows = Db.filter('Students', function (s) { return s.status === 'left' && (!q || (s.full_name + ' ' + s.student_id).toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) { return a.leaving_date < b.leaving_date ? 1 : -1; }).map(function (s) {
        var v = view(s); return { studentId: s.student_id, fullName: s.full_name, admissionDate: spells(s)[0].startDate, leavingDate: s.leaving_date, reason: s.leaving_reason, billedMonths: v.billableMonths, billed: v.billed, outstanding: v.outstanding, feesOutside: v.feesOutside };
      });
      var out = Util.paginate(rows, p); out.totalOutstanding = Util.fromPaise(rows.reduce(function (t, r) { return t + Util.paise(r.outstanding); }, 0)); return out;
    }
  };
})();
