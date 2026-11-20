/**
 * TuitionDesk backend — Plans.gs : fee plans, billing cycles, admission fee, sibling discount, automatic credit.
 *
 * A plan is a named price list: monthly fee, billing cycle (monthly | quarterly | annual) and an optional one-time admission fee.
 * A student's own "monthly fee" (if set) overrides the plan's. Cycles start at the admission month of each stay, so a student
 * admitted in August on a quarterly plan is billed for Aug–Oct, Nov–Jan, … (billed in advance, due on the due day of the first month).
 * A cycle that runs past a leaving month is shortened to the months actually enrolled.
 *
 * Sibling discount: students who share the same guardian WhatsApp number are siblings. The earliest-admitted active child pays full
 * fees; the others get Settings → "sibling discount %" off tuition (not the admission fee), written as a visible, audited discount
 * line on each fee when it is generated. Fees already billed are never changed retroactively.
 */
var Plans = (function () {
  var CYCLES = { monthly: 1, quarterly: 3, annual: 12 };
  function need(id) { var p = Db.get('FeePlans', V.id(id, 'planId')); if (!p) throw new ApiError('NOT_FOUND', 'Fee plan not found.'); return p; }
  function planOf(s) { return s.plan_id ? Db.get('FeePlans', s.plan_id) : null; }
  function view(p) { return { planId: p.plan_id, name: p.name, monthlyFee: p.monthly_fee, cycle: p.cycle, cycleMonths: CYCLES[p.cycle] || 1, admissionFee: p.admission_fee || 0, status: p.status, note: p.note, students: Db.filter('Students', function (s) { return s.plan_id === p.plan_id && s.status !== 'archived'; }).length }; }
  function effMonthly(s) { if (s.monthly_fee > 0) return s.monthly_fee; var p = planOf(s); return p ? p.monthly_fee : 0; }
  function cycleMonths(s) { var p = planOf(s); return p ? (CYCLES[p.cycle] || 1) : 1; }
  function addMonths(p, k) { for (var i = 0; i < k; i++) p = Enrolments.nextP(p); return p; }
  function monthsBetween(a, b) { var n = 0; while (a < b && n < 600) { a = Enrolments.nextP(a); n++; } return n; }
  function coveredBy(f) { var out = [], n = parseInt(f.months, 10) || 1, p = f.billing_period; for (var i = 0; i < n; i++) { out.push(p); p = Enrolments.nextP(p); } return out; }

  /** Siblings = active students sharing the guardian WhatsApp number. Returns percent off for this student (0 when none). */
  function siblingPct(s) {
    var pct = Settings.get('sibling_discount_percent'); if (!(pct > 0) || s.no_sibling_discount === true || !s.guardian_whatsapp) return 0;
    var fam = Db.filter('Students', function (x) { return x.status === 'active' && x.guardian_whatsapp === s.guardian_whatsapp; }).sort(function (a, b) { return a.admission_date < b.admission_date ? -1 : a.admission_date > b.admission_date ? 1 : a.student_id < b.student_id ? -1 : 1; });
    return fam.length > 1 && fam[0].student_id !== s.student_id ? pct : 0;
  }

  /** What billing the student up to `through` would create. Writes nothing. */
  function schedule(s, through, dueDay) {
    var plan = planOf(s), cyc = cycleMonths(s), monthly = effMonthly(s), rows = [], thisP = Enrolments.thisPeriod(), cap = through && through > thisP ? through : thisP, pct = siblingPct(s);
    var have = {}, haveAdm = false;
    Db.filter('Fees', function (f) { return f.student_id === s.student_id && f.status === 'active'; }).forEach(function (f) { if (f.kind === 'admission') haveAdm = true; else coveredBy(f).forEach(function (m) { have[m] = 1; }); });
    var spells = Enrolments.spells(s), dd = Util.pad(dueDay || Settings.get('fee_due_day'), 2);
    if (plan && plan.admission_fee > 0) rows.push({ kind: 'admission', label: 'Admission fee', period: Enrolments.mo(spells[0].startDate), months: 1, gross: plan.admission_fee, discount: 0, amount: plan.admission_fee, dueDate: spells[0].startDate, existing: haveAdm });
    spells.forEach(function (e) {
      var last = e.endDate ? Enrolments.mo(e.endDate) : cap;
      for (var p = Enrolments.mo(e.startDate), g = 0; p <= last && g < 240; p = addMonths(p, cyc), g++) {
        var n = e.endDate ? Math.min(cyc, monthsBetween(p, last) + 1) : cyc, gross = Util.round2(monthly * n), disc = Util.round2(gross * pct / 100);
        rows.push({ kind: 'tuition', label: n > 1 ? p + ' (' + n + ' months)' : p, period: p, months: n, gross: gross, discount: disc, discountPct: pct, amount: Util.round2(gross - disc), dueDate: p + '-' + dd, existing: !!have[p] });
      }
    });
    return rows;
  }

  function createFee(ctx, s, row) {
    var f = Db.insert('Fees', { fee_id: Util.newId('fee'), student_id: s.student_id, kind: row.kind === 'admission' ? 'admission' : '', months: row.months || 1, billing_period: row.period, amount_due: row.gross, due_date: row.dueDate, status: 'active', note: row.kind === 'admission' ? 'One-time admission fee' : '', created_by: ctx.session ? ctx.session.userId : 'system' });
    Audit.log(ctx, 'fee.create', 'fee', f.fee_id, { studentId: s.student_id, period: row.period, amount: row.gross, dueDate: row.dueDate, kind: row.kind, months: row.months });
    if (row.discount > 0) Fees.adjust(ctx, { feeId: f.fee_id, kind: 'discount', amount: row.discount, reason: 'Sibling discount ' + row.discountPct + '%', idempotencyKey: 'sib:' + f.fee_id }, true);
    return f;
  }

  return {
    need: need, CYCLES: CYCLES, planOf: planOf, effMonthly: effMonthly, schedule: schedule, createFee: createFee, siblingPct: siblingPct, coveredBy: coveredBy,

    list: function (ctx, p) { return Db.filter('FeePlans', function (x) { return p.includeArchived || x.status === 'active'; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).map(view); },
    create: function (ctx, p) {
      var name = V.str(p.name, 'name', { required: true, min: 2, max: 60 });
      if (Db.find('FeePlans', function (x) { return x.status === 'active' && x.name.toLowerCase() === name.toLowerCase(); })) throw new ApiError('CONFLICT', 'A plan with this name already exists.');
      var r = Db.insert('FeePlans', { plan_id: Util.newId('pln'), name: name, monthly_fee: V.num(p.monthlyFee, 'monthlyFee', { required: true, min: 1, max: MAX_MONEY, money: true }), cycle: V.oneOf(p.cycle || 'monthly', 'cycle', Object.keys(CYCLES)),
        admission_fee: V.num(p.admissionFee, 'admissionFee', { min: 0, max: MAX_MONEY, money: true, def: 0 }), status: 'active', note: V.str(p.note, 'note', { max: 200 }) });
      Audit.log(ctx, 'plan.create', 'plan', r.plan_id, { name: name }); return view(r);
    },
    update: function (ctx, p) {
      var r = need(p.planId), patch = {};
      if (p.name !== undefined) patch.name = V.str(p.name, 'name', { required: true, min: 2, max: 60 });
      if (p.monthlyFee !== undefined) patch.monthly_fee = V.num(p.monthlyFee, 'monthlyFee', { required: true, min: 1, max: MAX_MONEY, money: true });
      if (p.cycle !== undefined) patch.cycle = V.oneOf(p.cycle, 'cycle', Object.keys(CYCLES));
      if (p.admissionFee !== undefined) patch.admission_fee = V.num(p.admissionFee, 'admissionFee', { min: 0, max: MAX_MONEY, money: true, def: 0 });
      if (p.note !== undefined) patch.note = V.str(p.note, 'note', { max: 200 });
      if (p.status !== undefined) patch.status = V.oneOf(p.status, 'status', ['active', 'archived']);
      Db.update('FeePlans', r.plan_id, patch); Audit.log(ctx, 'plan.update', 'plan', r.plan_id, { before: Util.pick(r, Object.keys(patch)), after: patch });
      return view(Db.get('FeePlans', r.plan_id));
    },
    /** Family overview for the Teacher: who counts as sibling and who gets the discount. */
    families: function (ctx, p) {
      var by = {}; Db.filter('Students', function (s) { return s.status === 'active' && s.guardian_whatsapp; }).forEach(function (s) { (by[s.guardian_whatsapp] = by[s.guardian_whatsapp] || []).push(s); });
      return Object.keys(by).filter(function (k) { return by[k].length > 1; }).map(function (k) { return { guardianWhatsapp: k, children: by[k].sort(function (a, b) { return a.admission_date < b.admission_date ? -1 : 1; }).map(function (s) { return { studentId: s.student_id, fullName: s.full_name, discountPct: siblingPct(s), exempt: s.no_sibling_discount === true }; }) }; });
    }
  };
})();
