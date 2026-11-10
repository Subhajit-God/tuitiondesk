/**
 * TuitionDesk backend — Finance.gs : fee ledger, payments, allocations, receipts.
 *
 * Ledger rules (no stored totals — everything is derived from immutable source rows):
 *   netDue   = Fees.amount_due + SUM(FeeAdjustments.amount)          (discounts are negative)
 *   paid     = SUM(PaymentAllocations.amount)                        (rows are created ONLY on verification;
 *                                                                     refunds/reversals add negative rows)
 *   balance  = netDue - paid
 *   credit   = SUM(verified payments) - SUM(verified refunds) - SUM(all allocations)   (money on account)
 * Status: cancelled | paid (balance<=0) | late (past due, within grace) | overdue (past grace)
 *         | partial (some paid, not yet due) | pending.
 */
var PAY_METHODS = ['upi', 'cash', 'bank_transfer', 'cheque', 'card', 'other'];
var MAX_MONEY = 10000000;

var Ledger = (function () {
  function sumBy(rows, key, val) { var m = {}; rows.forEach(function (r) { m[r[key]] = (m[r[key]] || 0) + Util.paise(r[val]); }); return m; }

  function feeView(f, adjP, paidP, today, grace) {
    var netP = Util.paise(f.amount_due) + (adjP || 0), paid = paidP || 0, balP = netP - paid;
    var overdueDays = 0, status;
    if (f.status === 'cancelled') { status = 'cancelled'; balP = 0; }
    else if (balP <= 0) status = 'paid';
    else {
      overdueDays = today > f.due_date ? Util.diffDays(today, f.due_date) : 0;
      status = overdueDays > 0 ? (overdueDays > grace ? 'overdue' : 'late') : (paid > 0 ? 'partial' : 'pending');
    }
    return { feeId: f.fee_id, studentId: f.student_id, billingPeriod: f.billing_period, amountDue: Util.round2(f.amount_due), adjustments: Util.fromPaise(adjP || 0),
      netDue: Util.fromPaise(netP), paid: Util.fromPaise(paid), balance: Util.fromPaise(balP), dueDate: f.due_date, status: status, overdueDays: overdueDays,
      partiallyPaid: paid > 0 && balP > 0, note: f.note, recordStatus: f.status, kind: f.kind === 'admission' ? 'admission' : 'tuition', months: parseInt(f.months, 10) || 1 };
  }

  return {
    feeView: feeView,
    /** Build fee views (optionally for one student). */
    fees: function (studentId) {
      var today = Util.today(), grace = Settings.get('late_fee_grace_days');
      var fees = Db.filter('Fees', function (f) { return !studentId || f.student_id === studentId; });
      var adj = sumBy(Db.filter('FeeAdjustments', function (a) { return !studentId || a.student_id === studentId; }), 'fee_id', 'amount');
      var al = sumBy(Db.filter('PaymentAllocations', function (a) { return !studentId || a.student_id === studentId; }), 'fee_id', 'amount');
      return fees.map(function (f) { return feeView(f, adj[f.fee_id], al[f.fee_id], today, grace); });
    },
    feeById: function (feeId) { var f = Db.get('Fees', feeId); if (!f) return null; var v = Ledger.fees(f.student_id).filter(function (x) { return x.feeId === feeId; })[0]; return v; },
    /** Money on account (unallocated verified receipts net of refunds). */
    credit: function (studentId) {
      var p = Db.filter('Payments', function (x) { return x.student_id === studentId && x.verification_status === 'verified'; });
      var inP = 0, outP = 0;
      p.forEach(function (x) { if (x.kind === 'refund') outP += Util.paise(x.amount); else inP += Util.paise(x.amount); });
      var al = 0; Db.filter('PaymentAllocations', function (a) { return a.student_id === studentId; }).forEach(function (a) { al += Util.paise(a.amount); });
      return Util.fromPaise(inP - outP - al);
    },
    totals: function (views) {
      var t = { netDue: 0, paid: 0, balance: 0, overdue: 0 };
      views.forEach(function (v) { if (v.recordStatus === 'cancelled') return; t.netDue += Util.paise(v.netDue); t.paid += Util.paise(v.paid); t.balance += Util.paise(v.balance); if (v.overdueDays > 0 && v.balance > 0) t.overdue += Util.paise(v.balance); });
      return { netDue: Util.fromPaise(t.netDue), paid: Util.fromPaise(t.paid), balance: Util.fromPaise(t.balance), overdue: Util.fromPaise(t.overdue) };
    },
    reconcile: function () {
      var checks = [], fees = Db.all('Fees'), feeIds = {}; fees.forEach(function (f) { feeIds[f.fee_id] = 1; });
      var allocs = Db.all('PaymentAllocations'), pays = Db.all('Payments'), byPay = {};
      allocs.forEach(function (a) { byPay[a.payment_id] = (byPay[a.payment_id] || 0) + Util.paise(a.amount); });
      function chk(name, bad) { checks.push({ name: name, ok: bad.length === 0, detail: bad.slice(0, 5) }); }
      chk('Every allocation points to an existing fee', allocs.filter(function (a) { return !feeIds[a.fee_id]; }).map(function (a) { return a.allocation_id; }));
      chk('Verified payments are not over-allocated', pays.filter(function (p) { return p.kind === 'payment' && p.verification_status === 'verified' && (byPay[p.payment_id] || 0) > Util.paise(p.amount); }).map(function (p) { return p.payment_id; }));
      chk('Reversed payments net to zero allocation', pays.filter(function (p) { return p.verification_status === 'reversed' && (byPay[p.payment_id] || 0) !== 0; }).map(function (p) { return p.payment_id; }));
      chk('Pending/rejected payments carry no allocations', pays.filter(function (p) { return (p.verification_status === 'pending' || p.verification_status === 'rejected') && byPay[p.payment_id]; }).map(function (p) { return p.payment_id; }));
      chk('Refund allocations never exceed the refund', pays.filter(function (p) { return p.kind === 'refund' && (byPay[p.payment_id] || 0) < -Util.paise(p.amount); }).map(function (p) { return p.payment_id; }));
      chk('No active fee has a negative balance', Ledger.fees().filter(function (v) { return v.recordStatus === 'active' && v.balance < 0; }).map(function (v) { return v.feeId; }));
      var rc = Db.all('Receipts'), recByPay = {}; rc.forEach(function (r) { (recByPay[r.payment_id] = recByPay[r.payment_id] || []).push(r); });
      chk('Each verified payment has exactly one valid receipt', pays.filter(function (p) { return p.kind === 'payment' && p.verification_status === 'verified' && (recByPay[p.payment_id] || []).filter(function (r) { return r.status === 'valid'; }).length !== 1; }).map(function (p) { return p.payment_id; }));
      chk('Reversed payments have no valid receipt', pays.filter(function (p) { return p.verification_status === 'reversed' && (recByPay[p.payment_id] || []).some(function (r) { return r.status === 'valid'; }); }).map(function (p) { return p.payment_id; }));
      var sids = {}; Db.all('Students').forEach(function (s) { sids[s.student_id] = 1; });
      chk('No student has negative credit on account', Object.keys(sids).filter(function (s) { return Ledger.credit(s) < 0; }));
      return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
    }
  };
})();

var Fees = (function () {
  function needFee(id) { var f = Db.get('Fees', V.id(id, 'feeId')); if (!f) throw new ApiError('NOT_FOUND', 'Fee not found.'); return f; }
  function activeStudent(id) { var s = Students.need(id); if (s.status !== 'active' && s.status !== 'left') throw new ApiError('CONFLICT', 'Student is not active.'); return s; }
  function needEnrolled(s, period) { if (!Enrolments.covers(s, period)) throw new ApiError('CONFLICT', s.full_name + ' is not enrolled in ' + period + ' (enrolled ' + Enrolments.ranges(s) + '). Fees run from the admission month to the leaving month.'); }
  function names() { var m = {}; Db.all('Students').forEach(function (s) { m[s.student_id] = s.full_name; }); return m; }
  function defaultDue(period) { return period + '-' + Util.pad(Settings.get('fee_due_day'), 2); }
  function checkNotBelowPaid(feeId, newNetP) {
    var v = Ledger.feeById(feeId);
    if (newNetP < Util.paise(v.paid)) throw new ApiError('CONFLICT', 'This change would make the amount due lower than the ' + v.paid + ' already paid. Refund the payment first.');
  }

  return {
    list: function (ctx, p) {
      var nm = names(), memberIds = null;
      if (p.batchId) { memberIds = {}; Db.filter('StudentBatchLinks', function (l) { return l.batch_id === p.batchId && l.status === 'active'; }).forEach(function (l) { memberIds[l.student_id] = 1; }); }
      var views = Ledger.fees(p.studentId ? V.id(p.studentId, 'studentId') : null).filter(function (v) {
        if (memberIds && !memberIds[v.studentId]) return false;
        if (p.period && v.billingPeriod !== p.period) return false;
        if (p.status && v.status !== p.status) return false;
        if (!p.status && v.recordStatus === 'cancelled' && !p.includeCancelled) return false;
        return true;
      }).map(function (v) { v.studentName = nm[v.studentId] || ''; return v; });
      var q = (p.search || '').toLowerCase();
      if (q) views = views.filter(function (v) { return (v.studentName + ' ' + v.studentId).toLowerCase().indexOf(q) >= 0; });
      views.sort(function (a, b) { return a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : a.studentName.localeCompare(b.studentName); });
      var out = Util.paginate(views, p); out.totals = Ledger.totals(views); return out;
    },
    create: function (ctx, p) {
      var s = activeStudent(p.studentId), period = V.period(p.billingPeriod, 'billingPeriod');
      needEnrolled(s, period);
      var amt = V.num(p.amountDue, 'amountDue', { required: true, min: 1, max: MAX_MONEY, money: true });
      var due = V.date(p.dueDate || defaultDue(period), 'dueDate', { required: true });
      var kind = p.kind === 'admission' ? 'admission' : '', months = kind ? 1 : (p.months === undefined ? 1 : V.num(p.months, 'months', { min: 1, max: 12, int: true, required: true }));
      if (Db.find('Fees', function (f) { return f.student_id === s.student_id && f.status === 'active' && (kind ? f.kind === 'admission' : f.kind !== 'admission' && Plans.coveredBy(f).indexOf(period) >= 0); })) throw new ApiError('CONFLICT', kind ? 'This student already has an admission fee.' : 'A fee covering ' + period + ' already exists for this student.');
      var f = Db.insert('Fees', { fee_id: Util.newId('fee'), student_id: s.student_id, kind: kind, months: months, billing_period: period, amount_due: amt, due_date: due, status: 'active', note: V.str(p.note, 'note', { max: 200 }), created_by: ctx.session.userId });
      Audit.log(ctx, 'fee.create', 'fee', f.fee_id, { studentId: s.student_id, period: period, amount: amt, dueDate: due, kind: kind || 'tuition', months: months });
      Payments.autoApplyCredit(ctx, s.student_id);
      return Ledger.feeById(f.fee_id);
    },
    createBulk: function (ctx, p) {
      var b = Batches.need(p.batchId), period = V.period(p.billingPeriod, 'billingPeriod'), perStudent = p.useStudentFees === true;
      var amt = perStudent ? 0 : V.num(p.amountDue, 'amountDue', { required: true, min: 1, max: MAX_MONEY, money: true });
      var due = V.date(p.dueDate || defaultDue(period), 'dueDate', { required: true });
      var created = [], skipped = [], notEnrolled = [], noFee = [];
      Batches.roster(b.batch_id, Util.today()).forEach(function (r) {
        var stu = Students.need(r.studentId); if (!Enrolments.covers(stu, period)) { notEnrolled.push(r.studentId); return; }
        var amtS = perStudent ? Plans.effMonthly(stu) : amt; if (!(amtS > 0)) { noFee.push(r.studentId); return; }
        if (Db.find('Fees', function (f) { return f.student_id === r.studentId && f.status === 'active' && f.kind !== 'admission' && Plans.coveredBy(f).indexOf(period) >= 0; })) { skipped.push(r.studentId); return; }
        var pct = Plans.siblingPct(stu), disc = Util.round2(amtS * pct / 100);
        var f = Plans.createFee(ctx, stu, { kind: 'tuition', period: period, months: 1, gross: amtS, discount: disc, discountPct: pct, dueDate: due });
        Payments.autoApplyCredit(ctx, r.studentId);
        created.push(f.fee_id);
      });
      Audit.log(ctx, 'fee.create_bulk', 'batch', b.batch_id, { period: period, amount: amt, created: created.length, skipped: skipped.length, notEnrolled: notEnrolled.length, noFee: noFee.length, perStudent: perStudent });
      return { created: created.length, skipped: skipped.length, notEnrolled: notEnrolled.length, noFee: noFee.length };
    },
    /** Bill every enrolled cycle (admission month → leaving month, or → current month while enrolled) that has no fee yet, plus the one-time admission fee of the plan.
     *  Uses the student's plan (monthly / quarterly / annual), sibling discount and monthly fee; `amountDue` overrides the monthly fee for this run. dryRun lists without writing. */
    generateRange: function (ctx, p) {
      var s = activeStudent(p.studentId);
      if (p.amountDue !== undefined && p.amountDue !== '') { var ov = V.num(p.amountDue, 'amountDue', { required: true, min: 1, max: MAX_MONEY, money: true }); s = Util.pick(s, Object.keys(s)); s.monthly_fee = ov; }
      if (!(Plans.effMonthly(s) > 0)) throw new ApiError('VALIDATION', 'Enter the monthly fee, or give the student a fee plan or monthly fee first.', { field: 'amountDue' });
      var through = p.throughPeriod ? V.period(p.throughPeriod, 'throughPeriod') : Enrolments.thisPeriod();
      var lim = Enrolments.thisPeriod(); for (var k = 0; k < 2; k++) lim = Enrolments.nextP(lim);
      if (through > lim) V.fail('throughPeriod', 'can be at most two months ahead');
      var day = p.dueDay !== undefined ? V.num(p.dueDay, 'dueDay', { min: 1, max: 28, int: true, required: true }) : Settings.get('fee_due_day');
      var rows = Plans.schedule(s, through, day), todo = rows.filter(function (r) { return !r.existing; });
      if (!p.dryRun) todo.forEach(function (r) { var f = Plans.createFee(ctx, Students.need(p.studentId), r); r.feeId = f.fee_id; });
      if (!p.dryRun && todo.length) { Payments.autoApplyCredit(ctx, s.student_id); Audit.log(ctx, 'fee.generate_range', 'student', s.student_id, { from: rows[0] && rows[0].period, to: rows.length ? rows[rows.length - 1].period : '', created: todo.length }); }
      var tot = 0, dis = 0; todo.forEach(function (r) { tot += Util.paise(r.amount); dis += Util.paise(r.discount); });
      return { dryRun: !!p.dryRun, months: rows, created: p.dryRun ? 0 : todo.length, toCreate: todo.length, existing: rows.length - todo.length, total: Util.fromPaise(tot), discountTotal: Util.fromPaise(dis), enrolled: Enrolments.ranges(s), credit: Ledger.credit(s.student_id) };
    },
    update: function (ctx, p) {
      var f = needFee(p.feeId); if (f.status === 'cancelled') throw new ApiError('CONFLICT', 'Fee is cancelled.');
      var patch = {};
      if (p.amountDue !== undefined) { patch.amount_due = V.num(p.amountDue, 'amountDue', { required: true, min: 1, max: MAX_MONEY, money: true }); var v = Ledger.feeById(f.fee_id); checkNotBelowPaid(f.fee_id, Util.paise(patch.amount_due) + Util.paise(v.adjustments)); }
      if (p.billingPeriod !== undefined && p.billingPeriod !== f.billing_period) {
        var np = V.period(p.billingPeriod, 'billingPeriod'), ow = Students.need(f.student_id); needEnrolled(ow, np);
        if (f.kind !== 'admission' && Db.find('Fees', function (x) { return x.student_id === f.student_id && x.status === 'active' && x.fee_id !== f.fee_id && x.kind !== 'admission' && Plans.coveredBy(x).indexOf(np) >= 0; })) throw new ApiError('CONFLICT', 'A fee for ' + np + ' already exists for this student.');
        patch.billing_period = np; if (p.dueDate === undefined) patch.due_date = defaultDue(np);
      }
      if (p.dueDate !== undefined) patch.due_date = V.date(p.dueDate, 'dueDate', { required: true });
      if (p.note !== undefined) patch.note = V.str(p.note, 'note', { max: 200 });
      var reason = V.str(p.reason, 'reason', { required: true, min: 3, max: 200 });
      Db.update('Fees', f.fee_id, patch);
      Audit.log(ctx, 'fee.update', 'fee', f.fee_id, { before: Util.pick(f, Object.keys(patch)), after: patch, reason: reason });
      return Ledger.feeById(f.fee_id);
    },
    cancel: function (ctx, p) {
      var f = needFee(p.feeId), reason = V.str(p.reason, 'reason', { required: true, min: 3, max: 200 }), v = Ledger.feeById(f.fee_id);
      if (Util.paise(v.paid) !== 0) throw new ApiError('CONFLICT', 'Payments are allocated to this fee. Reverse or refund them before cancelling.');
      Db.update('Fees', f.fee_id, { status: 'cancelled' });
      Audit.log(ctx, 'fee.cancel', 'fee', f.fee_id, { reason: reason });
      return Ledger.feeById(f.fee_id);
    },
    adjust: function (ctx, p, auto) {
      var f = needFee(p.feeId); if (f.status === 'cancelled') throw new ApiError('CONFLICT', 'Fee is cancelled.');
      var kind = V.oneOf(p.kind, 'kind', ['discount', 'adjustment', 'late_fee'], { required: true });
      var amt = V.num(p.amount, 'amount', { required: true, min: -MAX_MONEY, max: MAX_MONEY, money: true });
      if (amt === 0) V.fail('amount', 'must not be zero');
      if (kind === 'discount') { if (amt < 0) V.fail('amount', 'enter the discount as a positive amount'); amt = -amt; }
      if (kind === 'late_fee' && amt < 0) V.fail('amount', 'late fee must be positive');
      var reason = V.str(p.reason, 'reason', { required: true, min: 3, max: 200 });
      var key = p.idempotencyKey ? V.str(p.idempotencyKey, 'idempotencyKey', { max: 80 }) : '';
      if (key) { var ex = Db.find('FeeAdjustments', function (a) { return a.idempotency_key === key; }); if (ex) return Ledger.feeById(f.fee_id); }
      var v = Ledger.feeById(f.fee_id);
      checkNotBelowPaid(f.fee_id, Util.paise(v.netDue) + Util.paise(amt));
      var a = Db.insert('FeeAdjustments', { adjustment_id: Util.newId('adj'), fee_id: f.fee_id, student_id: f.student_id, kind: kind, amount: amt, reason: reason, idempotency_key: key, created_by: auto ? 'system' : ctx.session.userId });
      Audit.log(ctx, 'fee.adjust', 'fee', f.fee_id, { kind: kind, amount: amt, reason: reason, adjustmentId: a.adjustment_id });
      return Ledger.feeById(f.fee_id);
    },
    /** Late-fee policy (Settings): flat amount or % of the fee, once or repeated every N days after the grace period, optionally capped per fee.
     *  Runs automatically every day when enabled; each charge is a visible, audited line on the fee and never repeats (idempotent keys).
     *  A fee carrying a "waived" line is left alone. */
    applyLateFees: function (ctx, p, auto) {
      if (!Settings.get('late_fee_enabled') || !(Settings.get('late_fee_amount') > 0)) throw new ApiError('CONFLICT', 'Late fees are not enabled in Settings.');
      var mode = Settings.get('late_fee_mode'), amt = Settings.get('late_fee_amount'), rep = Settings.get('late_fee_repeat_days'), cap = Settings.get('late_fee_max'), grace = Settings.get('late_fee_grace_days'), applied = 0, total = 0;
      Ledger.fees().filter(function (v) { return v.status === 'overdue' && v.recordStatus === 'active'; }).forEach(function (v) {
        var adjs = Db.filter('FeeAdjustments', function (a) { return a.fee_id === v.feeId; });
        if (adjs.some(function (a) { return a.reason.indexOf('Late fee waived') === 0; })) return;
        var K = rep > 0 ? Math.floor((v.overdueDays - grace - 1) / rep) : 0, paidLate = 0;
        adjs.forEach(function (a) { if (a.kind === 'late_fee') paidLate += Util.paise(a.amount); });
        for (var k = 0; k <= K; k++) {
          var key = k === 0 ? 'late:' + v.feeId : 'late:' + v.feeId + ':' + k;
          if (adjs.some(function (a) { return a.idempotency_key === key; })) continue;
          var a1 = mode === 'percent' ? Util.round2(v.amountDue * amt / 100) : amt;
          if (cap > 0) { a1 = Math.min(a1, Util.fromPaise(Util.paise(cap) - paidLate)); if (!(a1 > 0)) break; }
          if (!(a1 > 0)) continue;
          Fees.adjust(ctx, { feeId: v.feeId, kind: 'late_fee', amount: a1, reason: 'Late fee (policy) — ' + v.overdueDays + ' days overdue', idempotencyKey: key }, !!auto); paidLate += Util.paise(a1); applied++; total += Util.paise(a1);
        }
      });
      return { applied: applied, total: Util.fromPaise(total) };
    },
    /** Remove the late fees charged on one fee and stop further ones. The original charges stay visible in the fee's history. */
    waiveLateFees: function (ctx, p) {
      var f = needFee(p.feeId), reason = V.str(p.reason, 'reason', { required: true, min: 3, max: 200 }), t = 0;
      Db.filter('FeeAdjustments', function (a) { return a.fee_id === f.fee_id; }).forEach(function (a) { if (a.kind === 'late_fee') t += Util.paise(a.amount); });
      if (Db.find('FeeAdjustments', function (a) { return a.fee_id === f.fee_id && a.reason.indexOf('Late fee waived') === 0; })) throw new ApiError('CONFLICT', 'Late fees on this fee were already waived.');
      if (t > 0) Fees.adjust(ctx, { feeId: f.fee_id, kind: 'discount', amount: Util.fromPaise(t), reason: 'Late fee waived — ' + reason, idempotencyKey: 'waive:' + f.fee_id });
      else Db.insert('FeeAdjustments', { adjustment_id: Util.newId('adj'), fee_id: f.fee_id, student_id: f.student_id, kind: 'adjustment', amount: 0.00, reason: 'Late fee waived — ' + reason, idempotency_key: 'waive:' + f.fee_id, created_by: ctx.session.userId });
      Audit.log(ctx, 'fee.waive_late', 'fee', f.fee_id, { waived: Util.fromPaise(t), reason: reason }); return Ledger.feeById(f.fee_id);
    },
    /** Statement for a student. `forStudent` hides Teacher-only payment details. */
    statement: function (studentId, forStudent) {
      var s = Students.need(studentId), views = Ledger.fees(studentId).filter(function (v) { return v.recordStatus !== 'cancelled'; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
      var adj = Db.filter('FeeAdjustments', function (a) { return a.student_id === studentId; }).map(function (a) { return { adjustmentId: a.adjustment_id, feeId: a.fee_id, kind: a.kind, amount: a.amount, reason: a.reason, at: a.created_at }; });
      var pays = Payments.listFor(studentId, forStudent);
      return { student: { studentId: s.student_id, fullName: s.full_name }, fees: views, adjustments: adj, payments: pays, totals: Ledger.totals(views), creditOnAccount: Ledger.credit(studentId), asOf: Util.today() };
    }
  };
})();

var Payments = (function () {
  function need(id) { var p = Db.get('Payments', V.id(id, 'paymentId')); if (!p) throw new ApiError('NOT_FOUND', 'Payment not found.'); return p; }
  function alloc(paymentId) { var t = 0; Db.filter('PaymentAllocations', function (a) { return a.payment_id === paymentId; }).forEach(function (a) { t += Util.paise(a.amount); }); return t; }
  function view(p, forStudent) {
    var r = Db.find('Receipts', function (x) { return x.payment_id === p.payment_id && x.status === 'valid'; });
    var allocated = Util.fromPaise(alloc(p.payment_id));
    var o = { paymentId: p.payment_id, studentId: p.student_id, kind: p.kind, parentPaymentId: p.parent_payment_id, amount: p.amount, method: p.method, reference: p.provider_reference, source: p.source,
      status: p.verification_status, receivedAt: p.received_at, verifiedAt: p.verified_at, createdAt: p.created_at,
      allocated: p.kind === 'payment' ? allocated : null, unallocated: p.kind === 'payment' && p.verification_status === 'verified' ? Util.round2(p.amount - allocated) : 0,
      receipt: r ? { receiptId: r.receipt_id, receiptNumber: r.receipt_number, verificationId: r.verification_id } : null,
      verificationMethod: p.verification_method, rejectedReason: p.rejected_reason };
    if (!forStudent) { o.notes = p.notes; o.reconciliationNote = p.reconciliation_note; o.verifiedBy = p.verified_by; var s = Db.get('Students', p.student_id); o.studentName = s ? s.full_name : ''; }
    else o.statusLabel = p.verification_status === 'pending' ? 'Awaiting Teacher verification (not yet counted)' : p.verification_status;
    return o;
  }
  function outstandingFees(studentId) {
    return Ledger.fees(studentId).filter(function (v) { return v.recordStatus === 'active' && Util.paise(v.balance) > 0; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.billingPeriod < b.billingPeriod ? -1 : 1; });
  }
  /** Validate requested allocations or compute oldest-due-first. Returns [{feeId, amountP}]. */
  function planAllocations(studentId, amountP, requested) {
    var fees = outstandingFees(studentId), out = [];
    if (requested && requested.length) {
      var used = 0, seen = {};
      requested.forEach(function (r) {
        var fid = V.id(r.feeId, 'allocations.feeId'), a = Util.paise(V.num(r.amount, 'allocations.amount', { required: true, min: 0.01, money: true }));
        if (seen[fid]) V.fail('allocations', 'lists the same fee twice'); seen[fid] = 1;
        var f = fees.filter(function (x) { return x.feeId === fid; })[0];
        if (!f) throw new ApiError('VALIDATION', 'Fee ' + fid + ' is not an outstanding fee of this student.');
        if (a > Util.paise(f.balance)) throw new ApiError('VALIDATION', 'Allocation exceeds the outstanding balance of ' + f.billingPeriod + '.');
        used += a; out.push({ feeId: fid, amountP: a });
      });
      if (used > amountP) throw new ApiError('VALIDATION', 'Allocations exceed the payment amount.');
      return out;
    }
    var left = amountP;
    fees.forEach(function (f) { if (left <= 0) return; var a = Math.min(left, Util.paise(f.balance)); out.push({ feeId: f.feeId, amountP: a }); left -= a; });
    return out;
  }
  function writeAllocs(ctx, paymentId, studentId, plan, reason) {
    plan.forEach(function (a) { Db.insert('PaymentAllocations', { allocation_id: Util.newId('alc'), payment_id: paymentId, fee_id: a.feeId, student_id: studentId, amount: Util.fromPaise(a.amountP), reason: reason, created_by: ctx.session ? ctx.session.userId : 'provider' }); });
  }
  function dupRef(method, ref, exceptId) {
    if (!ref) return null;
    return Db.find('Payments', function (x) { return x.payment_id !== exceptId && x.method === method && x.provider_reference.toLowerCase() === ref.toLowerCase() && x.verification_status !== 'rejected' && x.kind === 'payment'; });
  }

  function createRecord(ctx, p, source, studentId) {
    var amt = V.num(p.amount, 'amount', { required: true, min: 1, max: MAX_MONEY, money: true });
    var method = V.oneOf(p.method, 'method', PAY_METHODS, { required: true });
    var ref = V.str(p.providerReference, 'providerReference', { max: 60, re: /^[A-Za-z0-9\-_\/ .]*$/, reMsg: 'may contain letters, digits and - _ / . only' });
    if ((method === 'upi' || method === 'bank_transfer') && !ref) V.fail('providerReference', 'is required for UPI / bank transfers (UTR / transaction id)');
    var recv = V.date(p.receivedAt || Util.today(), 'receivedAt');
    if (recv > Util.today()) V.fail('receivedAt', 'cannot be in the future');
    var key = p.idempotencyKey ? V.str(p.idempotencyKey, 'idempotencyKey', { max: 80 }) : '';
    if (key) { var ex = Db.find('Payments', function (x) { return x.idempotency_key === key && x.student_id === studentId; }); if (ex) return { payment: view(ex, source === 'student'), duplicate: true }; }
    var d = dupRef(method, ref); if (d) throw new ApiError('DUPLICATE_REFERENCE', 'A payment with this ' + method + ' reference already exists.');
    var rec = Db.insert('Payments', { payment_id: Util.newId('pay'), student_id: studentId, kind: 'payment', parent_payment_id: '', amount: amt, method: method, provider_reference: ref, source: source,
      verification_status: 'pending', verification_method: '', reconciliation_note: '', verified_by: '', verified_at: '', received_at: recv, notes: V.str(p.notes, 'notes', { max: 300 }), rejected_reason: '', idempotency_key: key, created_by: ctx.session ? ctx.session.userId : 'provider' });
    Audit.log(ctx, 'payment.record', 'payment', rec.payment_id, { studentId: studentId, amount: amt, method: method, source: source });
    return { payment: view(rec, source === 'student'), duplicate: false };
  }

  function verifyInternal(ctx, pay, how, note, requested) {
    if (pay.verification_status === 'verified') return { payment: view(pay), alreadyVerified: true, receipt: view(pay).receipt };
    if (pay.verification_status !== 'pending') throw new ApiError('CONFLICT', 'Only pending payments can be verified (this one is ' + pay.verification_status + ').');
    var st = Db.get('Students', pay.student_id);
    var plan = planAllocations(pay.student_id, Util.paise(pay.amount), requested);
    writeAllocs(ctx, pay.payment_id, pay.student_id, plan, 'allocation');
    var updated = Db.update('Payments', pay.payment_id, { verification_status: 'verified', verification_method: how, reconciliation_note: note, verified_by: ctx.session ? ctx.session.userId : 'provider', verified_at: Util.nowIso() });
    var receipt = Receipts.issue(ctx, updated, st);
    Audit.log(ctx, 'payment.verify', 'payment', pay.payment_id, { amount: pay.amount, method: how, allocations: plan.map(function (a) { return { feeId: a.feeId, amount: Util.fromPaise(a.amountP) }; }), receipt: receipt.receiptNumber, note: note });
    return { payment: view(updated), alreadyVerified: false, receipt: receipt };
  }

  return {
    view: view,
    listFor: function (studentId, forStudent) {
      return Db.filter('Payments', function (p) { return p.student_id === studentId; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(function (p) { return view(p, forStudent); });
    },
    list: function (ctx, p) {
      var q = (p.search || '').toLowerCase();
      var rows = Db.filter('Payments', function (x) {
        return (!p.status || x.verification_status === p.status) && (!p.studentId || x.student_id === p.studentId) && (!p.method || x.method === p.method) && (!p.from || x.received_at >= p.from) && (!p.to || x.received_at <= p.to);
      }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(function (x) { return view(x); });
      if (q) rows = rows.filter(function (r) { return (r.studentName + ' ' + r.studentId + ' ' + r.reference).toLowerCase().indexOf(q) >= 0; });
      return Util.paginate(rows, p);
    },
    get: function (ctx, p) {
      var pay = need(p.paymentId), v = view(pay);
      v.allocations = Db.filter('PaymentAllocations', function (a) { return a.payment_id === pay.payment_id; }).map(function (a) { return { feeId: a.fee_id, amount: a.amount, reason: a.reason, at: a.created_at }; });
      v.outstandingFees = pay.verification_status === 'pending' || (pay.verification_status === 'verified' && v.unallocated > 0) ? outstandingFees(pay.student_id) : [];
      return v;
    },
    record: function (ctx, p) { var s = Students.need(p.studentId); return createRecord(ctx, p, 'teacher', s.student_id); },
    /** Student-reported payment: stored as PENDING only; never counted until the Teacher verifies it. */
    reportByStudent: function (ctx, p) {
      var sid = ctx.session.studentId;
      var pending = Db.filter('Payments', function (x) { return x.student_id === sid && x.verification_status === 'pending' && x.source === 'student'; }).length;
      if (pending >= 5) throw new ApiError('LIMIT', 'You already have 5 payments awaiting verification.');
      return createRecord(ctx, p, 'student', sid);
    },
    /** Fix a typo in a payment. Pending payments: amount, method, reference, date, note. Verified payments are part of the ledger and receipt: only the note. */
    update: function (ctx, p) {
      var pay = need(p.paymentId), reason = V.str(p.reason, 'reason', { required: true, min: 3, max: 200 }), patch = {};
      if (pay.kind !== 'payment') throw new ApiError('CONFLICT', 'Refunds and reversals cannot be edited.');
      if (pay.verification_status === 'rejected') throw new ApiError('CONFLICT', 'A rejected payment cannot be edited.');
      if (p.notes !== undefined) patch.notes = V.str(p.notes, 'notes', { max: 300 });
      var money = ['amount', 'method', 'providerReference', 'receivedAt'].filter(function (k) { return p[k] !== undefined; });
      if (money.length) {
        if (pay.verification_status !== 'pending') throw new ApiError('CONFLICT', 'This payment is verified and has a receipt, so its amount, method, reference and date are locked. Reverse it and record the correct payment instead. You can still edit the note.');
        var method = p.method !== undefined ? V.oneOf(p.method, 'method', PAY_METHODS, { required: true }) : pay.method;
        var ref = p.providerReference !== undefined ? V.str(p.providerReference, 'providerReference', { max: 60, re: /^[A-Za-z0-9\-_\/ .]*$/, reMsg: 'may contain letters, digits and - _ / . only' }) : pay.provider_reference;
        if ((method === 'upi' || method === 'bank_transfer') && !ref) V.fail('providerReference', 'is required for UPI / bank transfers (UTR / transaction id)');
        if (dupRef(method, ref, pay.payment_id)) throw new ApiError('DUPLICATE_REFERENCE', 'A payment with this ' + method + ' reference already exists.');
        patch.method = method; patch.provider_reference = ref;
        if (p.amount !== undefined) patch.amount = V.num(p.amount, 'amount', { required: true, min: 1, max: MAX_MONEY, money: true });
        if (p.receivedAt !== undefined) { patch.received_at = V.date(p.receivedAt, 'receivedAt', { required: true }); if (patch.received_at > Util.today()) V.fail('receivedAt', 'cannot be in the future'); }
      }
      if (!Object.keys(patch).length) return view(pay);
      Db.update('Payments', pay.payment_id, patch);
      Audit.log(ctx, 'payment.update', 'payment', pay.payment_id, { before: Util.pick(pay, Object.keys(patch)), after: patch, reason: reason });
      return view(Db.get('Payments', pay.payment_id));
    },
    verify: function (ctx, p) {
      var pay = need(p.paymentId);
      if (pay.verification_status === 'verified') return verifyInternal(ctx, pay, '', '', null);
      var note = V.str(p.reconciliationNote, 'reconciliationNote', { required: true, min: 5, max: 300 });
      if (p.confirm !== true) throw new ApiError('NEEDS_CONFIRMATION', 'Confirm that you have checked this payment against bank/UPI/cash records.');
      return verifyInternal(ctx, pay, 'teacher_reconciliation', note, p.allocations);
    },
    reject: function (ctx, p) {
      var pay = need(p.paymentId), reason = V.str(p.reason, 'reason', { required: true, min: 3, max: 200 });
      if (pay.verification_status !== 'pending') throw new ApiError('CONFLICT', 'Only pending payments can be rejected.');
      Db.update('Payments', pay.payment_id, { verification_status: 'rejected', rejected_reason: reason });
      Audit.log(ctx, 'payment.reject', 'payment', pay.payment_id, { reason: reason });
      return view(Db.get('Payments', pay.payment_id));
    },
    /** Apply remaining credit of a verified payment to (new) fees. */
    /** Money on account is put against the student's open fees, oldest first, as soon as a fee exists. Only VERIFIED payments ever count. */
    autoApplyCredit: function (ctx, studentId) {
      if (!Settings.get('auto_apply_credit') || !(Ledger.credit(studentId) > 0)) return 0;
      var applied = 0, pays = Db.filter('Payments', function (x) { return x.student_id === studentId && x.kind === 'payment' && x.verification_status === 'verified'; }).sort(function (a, b) { return a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.created_at < b.created_at ? -1 : 1; });
      pays.forEach(function (pay) {
        var refunded = 0; Db.filter('Payments', function (x) { return x.parent_payment_id === pay.payment_id && x.kind === 'refund' && x.verification_status === 'verified'; }).forEach(function (x) { refunded += Util.paise(x.amount); });
        var left = Util.paise(pay.amount) - refunded - alloc(pay.payment_id); if (left <= 0) return;
        var plan = planAllocations(studentId, left); if (!plan.length) return;
        writeAllocs(ctx, pay.payment_id, studentId, plan, 'credit_applied');
        var sum = 0; plan.forEach(function (a) { sum += a.amountP; }); applied += sum;
        Audit.log(ctx, 'payment.credit_applied', 'payment', pay.payment_id, { allocations: plan.map(function (a) { return { feeId: a.feeId, amount: Util.fromPaise(a.amountP) }; }), auto: true });
      });
      return Util.fromPaise(applied);
    },
    allocateCredit: function (ctx, p) {
      var pay = need(p.paymentId);
      if (pay.verification_status !== 'verified' || pay.kind !== 'payment') throw new ApiError('CONFLICT', 'Only verified payments can be allocated.');
      var left = Util.paise(pay.amount) - alloc(pay.payment_id);
      if (left <= 0) throw new ApiError('CONFLICT', 'This payment is fully allocated.');
      var plan = planAllocations(pay.student_id, left, p.allocations);
      if (!plan.length) throw new ApiError('CONFLICT', 'There are no outstanding fees to allocate to.');
      writeAllocs(ctx, pay.payment_id, pay.student_id, plan, 'allocation');
      Audit.log(ctx, 'payment.allocate', 'payment', pay.payment_id, { allocations: plan.map(function (a) { return { feeId: a.feeId, amount: Util.fromPaise(a.amountP) }; }) });
      return view(pay);
    },
    reverse: function (ctx, p) {
      var pay = need(p.paymentId), reason = V.str(p.reason, 'reason', { required: true, min: 5, max: 200 });
      if (pay.kind !== 'payment' || pay.verification_status !== 'verified') throw new ApiError('CONFLICT', 'Only verified payments can be reversed.');
      if (Db.find('Payments', function (x) { return x.parent_payment_id === pay.payment_id && x.kind === 'refund' && x.verification_status === 'verified'; })) throw new ApiError('CONFLICT', 'This payment has refunds. Refunded payments cannot be reversed.');
      if (p.confirm !== true) throw new ApiError('NEEDS_CONFIRMATION', 'Confirm the reversal.');
      var byFee = {};
      Db.filter('PaymentAllocations', function (a) { return a.payment_id === pay.payment_id; }).forEach(function (a) { byFee[a.fee_id] = (byFee[a.fee_id] || 0) + Util.paise(a.amount); });
      var plan = Object.keys(byFee).filter(function (f) { return byFee[f] !== 0; }).map(function (f) { return { feeId: f, amountP: -byFee[f] }; });
      writeAllocs(ctx, pay.payment_id, pay.student_id, plan, 'reversal');
      Db.update('Payments', pay.payment_id, { verification_status: 'reversed', rejected_reason: reason });
      var r = Db.find('Receipts', function (x) { return x.payment_id === pay.payment_id && x.status === 'valid'; });
      if (r) { Db.update('Receipts', r.receipt_id, { status: 'void' }); Documents.revokeInternal(ctx, r.verification_id, 'Payment reversed: ' + reason); }
      Audit.log(ctx, 'payment.reverse', 'payment', pay.payment_id, { reason: reason, amount: pay.amount });
      return view(Db.get('Payments', pay.payment_id));
    },
    refund: function (ctx, p) {
      var pay = need(p.paymentId), amt = V.num(p.amount, 'amount', { required: true, min: 0.01, max: MAX_MONEY, money: true }), reason = V.str(p.reason, 'reason', { required: true, min: 5, max: 200 });
      if (pay.kind !== 'payment' || pay.verification_status !== 'verified') throw new ApiError('CONFLICT', 'Only verified payments can be refunded.');
      if (p.confirm !== true) throw new ApiError('NEEDS_CONFIRMATION', 'Confirm the refund.');
      var refunded = 0; Db.filter('Payments', function (x) { return x.parent_payment_id === pay.payment_id && x.kind === 'refund' && x.verification_status === 'verified'; }).forEach(function (x) { refunded += Util.paise(x.amount); });
      if (Util.paise(amt) > Util.paise(pay.amount) - refunded) throw new ApiError('VALIDATION', 'Refund exceeds the refundable amount of this payment.');
      var plan = [], sum = 0, views = Ledger.fees(pay.student_id);
      (p.fromFees || []).forEach(function (r) {
        var f = views.filter(function (v) { return v.feeId === r.feeId; })[0]; if (!f) throw new ApiError('VALIDATION', 'Unknown fee in fromFees.');
        var a = Util.paise(V.num(r.amount, 'fromFees.amount', { required: true, min: 0.01, money: true }));
        if (a > Util.paise(f.paid)) throw new ApiError('VALIDATION', 'Cannot take back more than was paid on ' + f.billingPeriod + '.');
        sum += a; plan.push({ feeId: r.feeId, amountP: -a });
      });
      if (sum > Util.paise(amt)) throw new ApiError('VALIDATION', 'fromFees exceeds the refund amount.');
      if (Util.paise(amt) - sum > Util.paise(Ledger.credit(pay.student_id))) throw new ApiError('VALIDATION', 'The remainder of the refund exceeds the credit on account. Specify which fees it is taken from.');
      var rec = Db.insert('Payments', { payment_id: Util.newId('pay'), student_id: pay.student_id, kind: 'refund', parent_payment_id: pay.payment_id, amount: amt, method: pay.method, provider_reference: '', source: 'teacher', verification_status: 'verified', verification_method: 'teacher_reconciliation', reconciliation_note: reason, verified_by: ctx.session.userId, verified_at: Util.nowIso(), received_at: Util.today(), notes: reason, rejected_reason: '', idempotency_key: '', created_by: ctx.session.userId });
      writeAllocs(ctx, rec.payment_id, pay.student_id, plan, 'refund');
      Audit.log(ctx, 'payment.refund', 'payment', rec.payment_id, { parent: pay.payment_id, amount: amt, reason: reason, fromFees: plan });
      return view(rec);
    },
    /**
     * Provider callback boundary. Verified by HMAC signature (PAYMENT_WEBHOOK_SECRET script property).
     * Idempotent on the provider event id / reference: repeats never double-credit.
     */
    providerCallback: function (ctx, p) {
      var secret = Props.get('PAYMENT_WEBHOOK_SECRET');
      if (!secret) throw new ApiError('NOT_CONFIGURED', 'Payment provider callbacks are not configured.');
      var ev = p.event || {}, canon = [ev.id, ev.reference, ev.amount, ev.status].join('|');
      var sig = Utilities.computeHmacSha256Signature(canon, secret).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
      if (!Util.constEq(sig, String(p.signature || ''))) throw new ApiError('AUTH_FAILED', 'Invalid signature.');
      var eventId = V.str(ev.id, 'event.id', { required: true, max: 80 }), ref = V.str(ev.reference, 'event.reference', { required: true, max: 60 });
      var done = Db.find('Payments', function (x) { return x.idempotency_key === 'cb:' + eventId; });
      if (done) return { payment: view(done), duplicate: true };
      var pay = Db.find('Payments', function (x) { return x.kind === 'payment' && x.provider_reference.toLowerCase() === ref.toLowerCase() && x.verification_status === 'pending'; });
      if (!pay) { var any = Db.find('Payments', function (x) { return x.kind === 'payment' && x.provider_reference.toLowerCase() === ref.toLowerCase(); }); return { matched: false, duplicate: !!any, note: any ? 'Already processed' : 'No pending payment matches; Teacher reconciliation required.' }; }
      if (ev.status !== 'captured') return { matched: true, verified: false, note: 'Event status is ' + ev.status };
      if (Util.paise(ev.amount) !== Util.paise(pay.amount)) { Audit.log({ actor: 'provider', actorRole: 'system' }, 'payment.callback_mismatch', 'payment', pay.payment_id, { expected: pay.amount, got: ev.amount }); return { matched: true, verified: false, note: 'Amount mismatch; Teacher reconciliation required.' }; }
      Db.update('Payments', pay.payment_id, { idempotency_key: 'cb:' + eventId });
      var r = verifyInternal({ actor: 'provider', actorRole: 'system' }, Db.get('Payments', pay.payment_id), 'provider_callback', 'Provider event ' + eventId, null);
      return { matched: true, verified: true, payment: r.payment };
    }
  };
})();

var Receipts = (function () {
  return {
    issue: function (ctx, pay, student) {
      var year = Util.today().slice(0, 4), num = Db.nextSeq('Receipts', 'receipt_number', 'RCP-' + year + '-', 5);
      var rid = Util.newId('rcp');
      var doc = Documents.createReceiptRecord(ctx, pay, student, num);
      Db.insert('Receipts', { receipt_id: rid, receipt_number: num, payment_id: pay.payment_id, student_id: pay.student_id, amount: pay.amount, issued_at: Util.nowIso(), status: 'valid', verification_id: doc.verification_id });
      return { receiptId: rid, receiptNumber: num, verificationId: doc.verification_id };
    },
    list: function (ctx, p) {
      var rows = Db.filter('Receipts', function (r) { return !p.studentId || r.student_id === p.studentId; }).sort(function (a, b) { return a.issued_at < b.issued_at ? 1 : -1; }).map(function (r) { return Receipts.view(r); });
      return Util.paginate(rows, p);
    },
    view: function (r) { var s = Db.get('Students', r.student_id), pay = Db.get('Payments', r.payment_id); return { receiptId: r.receipt_id, receiptNumber: r.receipt_number, paymentId: r.payment_id, studentId: r.student_id, studentName: s ? s.full_name : '', amount: r.amount, method: pay ? pay.method : '', issuedAt: r.issued_at, status: r.status, verificationId: r.verification_id }; }
  };
})();
