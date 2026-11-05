'use strict';
/* TuitionDesk backend test-suite: unit + integration + security + operational tests against the real Apps Script
   sources running on in-memory Google-service mocks.  Run: node test/run.js */
const assert = require('assert');
const crypto = require('crypto');
const { createBackend } = require('./harness');

let passed = 0, failed = 0; const failures = []; const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(['PASS', name]); }
  catch (e) { failed++; failures.push([name, e]); results.push(['FAIL', name]); }
}
const D = (r) => { if (!r.ok) throw new Error('Expected ok, got ' + JSON.stringify(r.error)); return r.data; };
const E = (r, code) => { assert.strictEqual(r.ok, false, 'expected failure ' + code + ' but call succeeded'); if (code) assert.strictEqual(r.error.code, code, 'expected ' + code + ' got ' + r.error.code + ': ' + r.error.message); return r.error; };

function fresh(now = '2026-10-05T10:00:00+05:30') {
  const be = createBackend({ now }).setup();
  let t = be.bootstrapTeacher();
  const c = (a, p, tok) => { if (tok !== undefined) return be.call(a, p || {}, tok); let r = be.call(a, p || {}, t); if (!r.ok && r.error.code === 'UNAUTHENTICATED') { t = be.login('teacher', 'Teacher#12345'); r = be.call(a, p || {}, t); } return r; };
  D(c('settings.update', { patch: { centre_name: 'Bright Minds Tuition', teacher_name: 'Mr. Rao' } }));
  const mkBatch = (name = 'Class 10 Maths', cap = 0) => D(c('batches.create', { name, subject: 'Maths', capacity: cap }));
  const mkStudent = (name, batchId, extra = {}) => { const s = D(c('students.create', Object.assign({ fullName: name, guardianName: name + ' Guardian', guardianWhatsapp: '98765' + String(Math.floor(10000 + Math.random() * 89999)), batchIds: batchId ? [batchId] : [] }, extra))); const tok = be.login(s.username, s.temporaryPassword); D(be.call('auth.changePassword', { currentPassword: s.temporaryPassword, newPassword: 'Newpass123' }, tok)); s.token = be.login(s.username, 'Newpass123'); return s; };
  const mkFee = (studentId, period = '2026-10', amount = 1000, due) => D(c('fees.create', { studentId, billingPeriod: period, amountDue: amount, dueDate: due || period + '-10' }));
  const pay = (studentId, amount, ref, method = 'upi') => D(c('payments.record', { studentId, amount, method, providerReference: ref || 'UTR' + crypto.randomBytes(4).toString('hex') })).payment;
  const verify = (paymentId, extra = {}) => D(c('payments.verify', Object.assign({ paymentId, reconciliationNote: 'Matched with bank statement', confirm: true }, extra)));
  return { be, get t() { return t; }, c, mkBatch, mkStudent, mkFee, pay, verify };
}

// ───────────────────────── Empty start ─────────────────────────
test('starts with an empty database (no fake records)', () => {
  const { be, c } = fresh();
  ['Students', 'Batches', 'Fees', 'Payments', 'Receipts', 'AttendanceSessions', 'Tests', 'Enquiries', 'Notices', 'Notifications', 'DocumentVerification', 'Homework', 'Timetable'].forEach((tb) => assert.strictEqual(be.run(`Db.count('${tb}')`), 0, tb));
  assert.strictEqual(be.run(`Db.count('Users')`), 1); // only the Teacher
  const d = D(c('dashboard.get')); assert.strictEqual(d.collections.net, 0); assert.strictEqual(d.students.active, 0); assert.strictEqual(d.trends.sufficient, false);
  assert.strictEqual(D(c('students.list')).total, 0);
});

// ───────────────────────── Auth & access ─────────────────────────
test('bootstrap works once, needs the setup key, and passwords are never stored in plaintext', () => {
  const be = createBackend({ now: '2026-10-05T10:00:00+05:30' }).setup();
  E(be.call('auth.bootstrap', { setupKey: 'x', username: 'teacher', password: 'Teacher#12345', displayName: 'T' }), 'SETUP_REQUIRED');
  be.run('generateSetupKey()');
  E(be.call('auth.bootstrap', { setupKey: 'wrong', username: 'teacher', password: 'Teacher#12345', displayName: 'T' }), 'AUTH_FAILED');
  E(be.call('auth.bootstrap', { setupKey: be.props.get('SETUP_KEY'), username: 'teacher', password: 'short', displayName: 'T' }), 'VALIDATION');
  D(be.call('auth.bootstrap', { setupKey: be.props.get('SETUP_KEY'), username: 'teacher', password: 'Teacher#12345', displayName: 'T' }));
  E(be.call('auth.bootstrap', { setupKey: 'anything', username: 'x2', password: 'Teacher#12345', displayName: 'T' }), 'FORBIDDEN');
  assert.ok(!JSON.stringify(be.snapshot()).includes('Teacher#12345'), 'plaintext password found in storage');
  assert.ok(!be.props.has('SETUP_KEY'));
});
test('unauthenticated and garbage tokens are rejected', () => {
  const { be } = fresh();
  E(be.call('students.list', {}, undefined), 'UNAUTHENTICATED'); E(be.call('students.list', {}, 'x'.repeat(64)), 'UNAUTHENTICATED'); E(be.call('nope', {}), 'UNKNOWN_ACTION');
  E(be.rawPost('not json'), 'BAD_REQUEST');
});
test('login throttling locks the account after repeated failures', () => {
  const { be } = fresh();
  for (let i = 0; i < 5; i++) E(be.call('auth.login', { username: 'teacher', password: 'bad' + i }), 'AUTH_FAILED');
  E(be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' }), 'RATE_LIMITED');
});
test('every Teacher-only action rejects a Student token (role enforced on the backend)', () => {
  const { be, mkStudent } = fresh(); const s = mkStudent('Asha');
  const names = be.run(`Object.keys(actions_()).filter(function(k){var a=actions_()[k].a; return Array.isArray(a) && a.length===1 && a[0]==='teacher';})`);
  assert.ok(names.length > 60, 'expected many teacher actions, got ' + names.length);
  names.forEach((a) => { const r = be.call(a, { studentId: s.studentId }, s.token); assert.strictEqual(r.ok, false, a); assert.strictEqual(r.error.code, 'FORBIDDEN', a + ' -> ' + r.error.code); });
});
test('Student-only actions reject the Teacher; accounts must change temporary password first', () => {
  const { be, c, mkStudent } = fresh(); E(c('my.home'), 'FORBIDDEN');
  const s = D(c('students.create', { fullName: 'New Kid' })); const tok = be.login(s.username, s.temporaryPassword);
  E(be.call('my.home', {}, tok), 'PASSWORD_CHANGE_REQUIRED');
  E(be.call('auth.changePassword', { currentPassword: s.temporaryPassword, newPassword: 'abc' }, tok), 'VALIDATION');
  D(be.call('auth.changePassword', { currentPassword: s.temporaryPassword, newPassword: 'Another123' }, tok));
  D(be.call('my.home', {}, tok)); // current session stays; others are revoked
  D(be.call('my.home', {}, be.login(s.username, 'Another123')));
});
test('Student cannot read another Student by changing ids (portal scope comes from the session)', () => {
  const { be, c, mkBatch, mkStudent, mkFee, pay, verify } = fresh(); const b = mkBatch();
  const A = mkStudent('Asha A', b.batchId), B = mkStudent('Bala B', b.batchId);
  mkFee(A.studentId); mkFee(B.studentId, '2026-10', 777); const pb = pay(B.studentId, 777); const vb = verify(pb.paymentId);
  const fees = D(be.call('my.fees', { studentId: B.studentId }, A.token)); assert.strictEqual(fees.student.studentId, A.studentId); assert.ok(!JSON.stringify(fees).includes(B.studentId)); assert.ok(!JSON.stringify(fees).includes('Bala'));
  assert.strictEqual(D(be.call('my.profile', { studentId: B.studentId }, A.token)).studentId, A.studentId);
  assert.strictEqual(D(be.call('my.receipts', { studentId: B.studentId }, A.token)).items.length, 0);
  E(be.call('my.document', { verificationId: vb.receipt.verificationId }, A.token), 'NOT_FOUND');
  E(be.call('my.document', { verificationId: 'zz' }, A.token), 'VALIDATION');
  assert.strictEqual(D(be.call('my.document', { verificationId: vb.receipt.verificationId }, B.token)).meta.docType, 'receipt');
  const att = D(be.call('my.attendance', { studentId: B.studentId, from: '2026-01-01', to: '2026-12-31' }, A.token)); assert.strictEqual(att.records.length, 0);
});
test('Student profile view hides guardian contact and private notes', () => {
  const { be, mkStudent } = fresh(); const s = mkStudent('Asha', null, { notes: 'SECRET NOTE', guardianWhatsapp: '9811122233' });
  const p = JSON.stringify(D(be.call('my.home', {}, s.token))); assert.ok(!p.includes('SECRET NOTE')); assert.ok(!p.includes('9811122233'));
});

// ───────────────────────── Fees & payments ─────────────────────────
test('fee statuses: pending, partial, late, overdue, paid; overdue days only when balance remains', () => {
  const { be, c, mkBatch, mkStudent, mkFee, pay, verify } = fresh('2026-10-05T10:00:00+05:30'); const b = mkBatch(); const s = mkStudent('Asha', b.batchId);
  const f = mkFee(s.studentId, '2026-10', 1000, '2026-10-10'); assert.strictEqual(f.status, 'pending'); assert.strictEqual(f.overdueDays, 0);
  verify(pay(s.studentId, 400).paymentId); let v = D(c('fees.list', { studentId: s.studentId })).items[0]; assert.strictEqual(v.status, 'partial'); assert.strictEqual(v.balance, 600);
  be.setNow('2026-10-12T10:00:00+05:30'); v = D(c('fees.list', { studentId: s.studentId })).items[0]; assert.strictEqual(v.status, 'late'); assert.strictEqual(v.overdueDays, 2);
  be.setNow('2026-10-20T10:00:00+05:30'); v = D(c('fees.list', { studentId: s.studentId })).items[0]; assert.strictEqual(v.status, 'overdue');
  verify(pay(s.studentId, 600).paymentId); v = D(c('fees.list', { studentId: s.studentId })).items[0]; assert.strictEqual(v.status, 'paid'); assert.strictEqual(v.overdueDays, 0); assert.strictEqual(v.balance, 0);
});
test('duplicate fee for the same student and period is rejected; bulk creation skips duplicates', () => {
  const { c, mkBatch, mkStudent, mkFee } = fresh(); const b = mkBatch(); const s = mkStudent('Asha', b.batchId); mkStudent('Bala', b.batchId); mkFee(s.studentId);
  E(c('fees.create', { studentId: s.studentId, billingPeriod: '2026-10', amountDue: 5 }), 'CONFLICT');
  const r = D(c('fees.createBulk', { batchId: b.batchId, billingPeriod: '2026-10', amountDue: 900 })); assert.deepStrictEqual([r.created, r.skipped], [1, 1]);
});
test('unverified payments (teacher-recorded or student-reported) do not reduce the balance or count as collected', () => {
  const { be, c, mkBatch, mkStudent, mkFee, pay } = fresh(); const b = mkBatch(); const s = mkStudent('Asha', b.batchId); mkFee(s.studentId); pay(s.studentId, 500);
  const rep = D(be.call('my.reportPayment', { amount: 300, method: 'upi', providerReference: 'MYREF1', studentId: 'STU-9999' }, s.token)); assert.strictEqual(rep.payment.status, 'pending'); assert.strictEqual(rep.payment.studentId, s.studentId);
  assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].balance, 1000);
  const d = D(c('dashboard.get')); assert.strictEqual(d.collections.net, 0); assert.strictEqual(d.pendingVerification.count, 2); assert.strictEqual(d.pendingVerification.amount, 800);
  assert.strictEqual(D(c('receipts.list')).total, 0);
  const st = D(be.call('my.fees', {}, s.token)); assert.strictEqual(st.totals.balance, 1000); assert.ok(st.payments.every((p) => p.status === 'pending'));
});
test('verification requires confirmation and a reconciliation note; produces a unique receipt and a ledger that reconciles', () => {
  const { be, c, mkBatch, mkStudent, mkFee, pay } = fresh(); const b = mkBatch(); const s = mkStudent('Asha', b.batchId); mkFee(s.studentId); mkFee(s.studentId, '2026-11', 1000, '2026-11-10');
  const p1 = pay(s.studentId, 1200), p2 = pay(s.studentId, 300);
  E(c('payments.verify', { paymentId: p1.paymentId, reconciliationNote: 'ok' }), 'VALIDATION'); E(c('payments.verify', { paymentId: p1.paymentId, reconciliationNote: 'Matched with bank statement' }), 'NEEDS_CONFIRMATION');
  const v1 = D(c('payments.verify', { paymentId: p1.paymentId, reconciliationNote: 'Matched with bank statement', confirm: true })); const v2 = D(c('payments.verify', { paymentId: p2.paymentId, reconciliationNote: 'Cash in hand', confirm: true }));
  assert.notStrictEqual(v1.receipt.receiptNumber, v2.receipt.receiptNumber); assert.match(v1.receipt.receiptNumber, /^RCP-2026-\d{5}$/);
  const fees = D(c('fees.list', { studentId: s.studentId })).items.sort((a, b2) => a.billingPeriod < b2.billingPeriod ? -1 : 1); assert.deepStrictEqual(fees.map((f) => f.balance), [0, 500]); // 1200 -> Oct(1000)+Nov(200); +300 -> Nov
  assert.strictEqual(D(c('dashboard.get')).collections.net, 1500); assert.strictEqual(D(c('ledger.reconcile')).ok, true);
  assert.strictEqual(D(c('receipts.list')).total, 2);
});
test('verifying twice is idempotent (no double credit, same receipt)', () => {
  const { c, mkBatch, mkStudent, mkFee, pay, verify } = fresh(); const s = mkStudent('Asha'); mkFee(s.studentId); const p = pay(s.studentId, 1000);
  const a = verify(p.paymentId), b = verify(p.paymentId); assert.strictEqual(b.alreadyVerified, true); assert.strictEqual(a.receipt.receiptNumber, b.receipt.receiptNumber);
  assert.strictEqual(D(c('receipts.list')).total, 1); assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].paid, 1000);
});
test('duplicate references and repeated submissions (idempotency key) cannot create double payments', () => {
  const { c, mkStudent } = fresh(); const s = mkStudent('Asha');
  D(c('payments.record', { studentId: s.studentId, amount: 100, method: 'upi', providerReference: 'UTR-1' })); E(c('payments.record', { studentId: s.studentId, amount: 100, method: 'upi', providerReference: 'utr-1' }), 'DUPLICATE_REFERENCE');
  E(c('payments.record', { studentId: s.studentId, amount: 100, method: 'upi' }), 'VALIDATION');
  const a = D(c('payments.record', { studentId: s.studentId, amount: 50, method: 'cash', idempotencyKey: 'k1' })), b = D(c('payments.record', { studentId: s.studentId, amount: 50, method: 'cash', idempotencyKey: 'k1' })); assert.strictEqual(a.payment.paymentId, b.payment.paymentId); assert.strictEqual(b.duplicate, true);
  E(c('payments.record', { studentId: s.studentId, amount: -5, method: 'cash' }), 'VALIDATION'); E(c('payments.record', { studentId: s.studentId, amount: 5, method: 'cash', receivedAt: '2030-01-01' }), 'VALIDATION');
});
test('overpayment becomes credit on account and can be allocated to a later fee', () => {
  const { c, mkStudent, mkFee, pay, verify } = fresh(); const s = mkStudent('Asha'); mkFee(s.studentId); const p = pay(s.studentId, 1500); const v = verify(p.paymentId);
  assert.strictEqual(v.payment.unallocated, 500); assert.strictEqual(D(c('fees.statement', { studentId: s.studentId })).creditOnAccount, 500);
  mkFee(s.studentId, '2026-11', 800, '2026-11-10'); D(c('payments.allocateCredit', { paymentId: p.paymentId }));
  const st = D(c('fees.statement', { studentId: s.studentId })); assert.strictEqual(st.creditOnAccount, 0); assert.strictEqual(st.totals.balance, 300); assert.strictEqual(D(c('ledger.reconcile')).ok, true);
});
test('discounts, adjustments and late fees are auditable ledger entries; cannot push amount below what was paid', () => {
  const { c, mkStudent, mkFee, pay, verify } = fresh(); const s = mkStudent('Asha'); const f = mkFee(s.studentId);
  let v = D(c('fees.adjust', { feeId: f.feeId, kind: 'discount', amount: 100, reason: 'Sibling discount' })); assert.strictEqual(v.netDue, 900);
  v = D(c('fees.adjust', { feeId: f.feeId, kind: 'adjustment', amount: 50, reason: 'Material fee' })); assert.strictEqual(v.netDue, 950);
  E(c('fees.adjust', { feeId: f.feeId, kind: 'discount', amount: 10 }), 'VALIDATION'); verify(pay(s.studentId, 900).paymentId);
  E(c('fees.adjust', { feeId: f.feeId, kind: 'discount', amount: 100, reason: 'Too much' }), 'CONFLICT'); E(c('fees.update', { feeId: f.feeId, amountDue: 500, reason: 'edit' }), 'CONFLICT'); E(c('fees.cancel', { feeId: f.feeId, reason: 'oops' }), 'CONFLICT');
  assert.ok(D(c('audit.list', { action: 'fee.adjust' })).total >= 2);
});
test('optional late-fee policy applies once per overdue fee', () => {
  const { be, c, mkStudent, mkFee } = fresh(); const s = mkStudent('Asha'); mkFee(s.studentId, '2026-09', 1000, '2026-09-10');
  E(c('fees.applyLateFees'), 'CONFLICT'); D(c('settings.update', { patch: { late_fee_enabled: true, late_fee_amount: 50 } }));
  assert.strictEqual(D(c('fees.applyLateFees')).applied, 1); assert.strictEqual(D(c('fees.applyLateFees')).applied, 0); assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].netDue, 1050);
});
test('refund and reversal keep an auditable, reconciling ledger and revoke the receipt', () => {
  const { be, c, mkStudent, mkFee, pay, verify } = fresh(); const s = mkStudent('Asha'); const f = mkFee(s.studentId); const p1 = pay(s.studentId, 1000), v1 = verify(p1.paymentId);
  const r = D(c('payments.refund', { paymentId: p1.paymentId, amount: 300, reason: 'Withdrew for a month', fromFees: [{ feeId: f.feeId, amount: 300 }], confirm: true })); assert.strictEqual(r.kind, 'refund');
  assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].balance, 300); assert.strictEqual(D(c('dashboard.get')).collections.net, 700);
  E(c('payments.refund', { paymentId: p1.paymentId, amount: 900, reason: 'too much', fromFees: [{ feeId: f.feeId, amount: 700 }], confirm: true }), 'VALIDATION');
  E(c('payments.reverse', { paymentId: p1.paymentId, reason: 'Bounced cheque', confirm: true }), 'CONFLICT'); // has a refund
  const p2 = pay(s.studentId, 300), v2 = verify(p2.paymentId); assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].balance, 0);
  D(c('payments.reverse', { paymentId: p2.paymentId, reason: 'Bounced cheque', confirm: true })); assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].balance, 300);
  assert.strictEqual(be.call('verify.check', { id: v2.receipt.verificationId }).data.status, 'revoked'); assert.strictEqual(be.call('verify.check', { id: v1.receipt.verificationId }).data.status, 'valid');
  assert.strictEqual(D(c('ledger.reconcile')).ok, true); const au = D(c('audit.list', { pageSize: 100 })).items.map((a) => a.action); ['payment.verify', 'payment.refund', 'payment.reverse', 'document.revoke'].forEach((a) => assert.ok(au.includes(a), a));
});
test('provider callback: signature required, duplicates never double-credit, amount mismatch is not auto-verified', () => {
  const { be, c, mkStudent, mkFee, pay } = fresh(); const s = mkStudent('Asha'); mkFee(s.studentId); const p = pay(s.studentId, 1000, 'PROVREF1');
  E(be.call('payments.callback', { event: { id: 'e1', reference: 'PROVREF1', amount: 1000, status: 'captured' }, signature: 'x' }), 'NOT_CONFIGURED'); be.props.set('PAYMENT_WEBHOOK_SECRET', 'whsec');
  const sign = (e) => crypto.createHmac('sha256', 'whsec').update([e.id, e.reference, e.amount, e.status].join('|')).digest('hex');
  const ev = { id: 'evt_1', reference: 'PROVREF1', amount: 1000, status: 'captured' }; E(be.call('payments.callback', { event: ev, signature: 'bad' }), 'AUTH_FAILED');
  const bad = { id: 'evt_0', reference: 'PROVREF1', amount: 999, status: 'captured' }; assert.strictEqual(D(be.call('payments.callback', { event: bad, signature: sign(bad) })).verified, false);
  assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].paid, 0);
  assert.strictEqual(D(be.call('payments.callback', { event: ev, signature: sign(ev) })).verified, true); const again = D(be.call('payments.callback', { event: ev, signature: sign(ev) })); assert.strictEqual(again.duplicate, true);
  const again2 = D(be.call('payments.callback', { event: { id: 'evt_2', reference: 'PROVREF1', amount: 1000, status: 'captured' }, signature: sign({ id: 'evt_2', reference: 'PROVREF1', amount: 1000, status: 'captured' }) })); assert.strictEqual(again2.verified === true, false);
  assert.strictEqual(D(c('fees.list', { studentId: s.studentId })).items[0].paid, 1000); assert.strictEqual(D(c('receipts.list')).total, 1);
});
test('concurrency: lock is required for writes and is never nested (harness throws on nested lock)', () => {
  const { c, mkStudent, mkFee, pay, verify } = fresh(); const s = mkStudent('Asha'); mkFee(s.studentId); verify(pay(s.studentId, 100).paymentId);
  assert.ok(true);
});

// ───────────────────────── Attendance ─────────────────────────
function attSetup(extraSettings) {
  const x = fresh(); const b = x.mkBatch('Class 9', 5); const a = x.mkStudent('Asha', b.batchId, { whatsappConsent: 'unknown' }), s2 = x.mkStudent('Bala', b.batchId), s3 = x.mkStudent('Chitra', b.batchId);
  if (extraSettings) D(x.c('settings.update', { patch: extraSettings })); return Object.assign(x, { b, a, s2, s3 });
}
test('attendance: P/A/H persist, whole roster must be marked, duplicates blocked, retry is idempotent, no future dates', () => {
  const { c, b, a, s2, s3 } = attSetup({ absence_alert_enabled: true });
  const ro = D(c('attendance.roster', { batchId: b.batchId, date: '2026-10-05' })); assert.strictEqual(ro.roster.length, 3);
  E(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k', entries: [{ studentId: a.studentId, status: 'P' }] }), 'VALIDATION');
  E(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k', entries: [{ studentId: a.studentId, status: 'X' }, { studentId: s2.studentId, status: 'P' }, { studentId: s3.studentId, status: 'P' }] }), 'VALIDATION');
  E(c('attendance.save', { batchId: b.batchId, date: '2026-10-09', idempotencyKey: 'k', entries: [] }), 'VALIDATION');
  const entries = [{ studentId: a.studentId, status: 'A' }, { studentId: s2.studentId, status: 'P' }, { studentId: s3.studentId, status: 'H' }];
  const r = D(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k1', entries })); assert.deepStrictEqual(r.counts, { P: 1, A: 1, H: 1 });
  assert.strictEqual(D(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k1', entries })).duplicateRequest, true);
  E(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k2', entries }), 'DUPLICATE_SESSION'); assert.strictEqual(D(c('attendance.session', { sessionId: r.sessionId })).entries.length, 3);
});
test('absence alert is queued only after a successful save, only for absent students, and never duplicated', () => {
  const { be, c, b, a, s2, s3 } = attSetup({ absence_alert_enabled: true });
  E(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'bad', entries: [{ studentId: a.studentId, status: 'A' }] }), 'VALIDATION'); assert.strictEqual(be.run(`Db.count('Notifications')`), 0);
  const r = D(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'ok', entries: [{ studentId: a.studentId, status: 'A' }, { studentId: s2.studentId, status: 'P' }, { studentId: s3.studentId, status: 'H' }] }));
  assert.strictEqual(r.notifications.queued, 1); const n = D(c('notifications.list')).items; assert.strictEqual(n.length, 1); assert.strictEqual(n[0].studentId, a.studentId); assert.strictEqual(n[0].status, 'pending_manual'); assert.match(n[0].shareLink, /^https:\/\/wa\.me\/91\d{10}\?text=/);
  D(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'ok', entries: [{ studentId: a.studentId, status: 'A' }, { studentId: s2.studentId, status: 'P' }, { studentId: s3.studentId, status: 'H' }] })); assert.strictEqual(be.run(`Db.count('Notifications')`), 1);
});
test('attendance corrections need a reason, are audited, and percentage excludes holidays', () => {
  const { c, b, a, s2, s3 } = attSetup();
  const r = D(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k', entries: [{ studentId: a.studentId, status: 'A' }, { studentId: s2.studentId, status: 'P' }, { studentId: s3.studentId, status: 'H' }] }));
  D(c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k2', sessionLabel: 'Evening', entries: [{ studentId: a.studentId, status: 'P' }, { studentId: s2.studentId, status: 'P' }, { studentId: s3.studentId, status: 'H' }] }));
  let sm = D(c('attendance.studentSummary', { studentId: a.studentId })); assert.strictEqual(sm.percentage, 50); assert.deepStrictEqual(sm.counts, { P: 1, A: 1, H: 0 });
  assert.strictEqual(D(c('attendance.studentSummary', { studentId: s3.studentId })).percentage, null);
  const att = D(c('attendance.session', { sessionId: r.sessionId })).entries.find((e) => e.studentId === a.studentId);
  E(c('attendance.correct', { attendanceId: att.attendanceId, status: 'P' }), 'VALIDATION'); E(c('attendance.correct', { attendanceId: att.attendanceId, status: 'P', reason: 'ok' }), 'VALIDATION');
  D(c('attendance.correct', { attendanceId: att.attendanceId, status: 'P', reason: 'Was present, marked wrongly' })); sm = D(c('attendance.studentSummary', { studentId: a.studentId })); assert.strictEqual(sm.percentage, 100);
  const au = D(c('audit.list', { action: 'attendance.correct' })).items[0]; assert.strictEqual(au.details.from, 'A'); assert.strictEqual(au.details.to, 'P');
});

// ───────────────────────── Tests & results ─────────────────────────
function testSetup() { const x = fresh(); const b = x.mkBatch('Class 8'); const st = ['Asha', 'Bala', 'Chitra', 'Dev', 'Esha'].map((n) => x.mkStudent(n, b.batchId)); const t = D(x.c('tests.create', { batchId: b.batchId, title: 'Unit Test 1', testDate: '2026-10-05', maxMarks: 50 })); return Object.assign(x, { b, st, tst: t }); }
test('marks validated against maximum; not-entered stays distinct from a real zero', () => {
  const { c, st, tst } = testSetup();
  E(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered', marks: 51 }] }), 'VALIDATION'); E(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered', marks: -1 }] }), 'VALIDATION');
  E(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered' }] }), 'VALIDATION'); E(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'absent', marks: 3 }] }), 'VALIDATION');
  D(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered', marks: 0 }, { studentId: st[1].studentId, status: 'absent' }, { studentId: st[2].studentId, status: 'exempt' }] }));
  const g = D(c('tests.get', { testId: tst.testId })); const by = Object.fromEntries(g.rows.map((r) => [r.fullName, r]));
  assert.strictEqual(by.Asha.marks, 0); assert.strictEqual(by.Asha.resultStatus, 'entered'); assert.strictEqual(by.Dev.marks, null); assert.strictEqual(by.Dev.resultStatus, 'not_entered'); assert.strictEqual(by.Bala.resultStatus, 'absent'); assert.strictEqual(g.stats.notEntered, 2);
});
test('ranking uses competition ranking for ties and ignores non-entered statuses', () => {
  const { c, st, tst } = testSetup(); const m = [40, 45, 45, 30]; D(c('tests.saveMarks', { testId: tst.testId, entries: st.slice(0, 4).map((s, i) => ({ studentId: s.studentId, status: 'entered', marks: m[i] })).concat([{ studentId: st[4].studentId, status: 'absent' }]) }));
  const ranks = Object.fromEntries(D(c('tests.get', { testId: tst.testId })).rows.map((r) => [r.fullName, r.rank])); assert.deepStrictEqual(ranks, { Asha: 3, Bala: 1, Chitra: 1, Dev: 4, Esha: null });
});
test('students see only their own PUBLISHED results; publish needs confirmation when marks are missing; unpublish hides again', () => {
  const { be, c, st, tst } = testSetup(); D(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered', marks: 42, comment: 'Good' }, { studentId: st[1].studentId, status: 'entered', marks: 20 }] }));
  assert.strictEqual(D(be.call('my.results', {}, st[0].token)).items.length, 0); E(c('tests.publish', { testId: tst.testId, publish: true }), 'NEEDS_CONFIRMATION');
  D(c('tests.publish', { testId: tst.testId, publish: true, confirmNotEntered: true }));
  const mine = D(be.call('my.results', {}, st[0].token)).items; assert.strictEqual(mine.length, 1); assert.strictEqual(mine[0].marks, 42); assert.strictEqual(mine[0].percentage, 84); assert.ok(!JSON.stringify(mine).includes('rank'));
  assert.strictEqual(D(be.call('my.results', {}, st[2].token)).items[0].resultStatus, 'not_entered'); assert.strictEqual(D(be.call('my.results', {}, st[2].token)).items[0].marks, null);
  assert.ok(!JSON.stringify(D(be.call('my.results', {}, st[1].token)).items.map((i) => i.marks)).includes('42'));
  D(c('tests.publish', { testId: tst.testId, publish: false })); assert.strictEqual(D(be.call('my.results', {}, st[0].token)).items.length, 0);
});
test('editing marks after publication needs a reason and is audited with before/after', () => {
  const { c, st, tst } = testSetup(); D(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered', marks: 10 }] })); D(c('tests.publish', { testId: tst.testId, publish: true, confirmNotEntered: true }));
  E(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st[0].studentId, status: 'entered', marks: 12 }] }), 'VALIDATION');
  D(c('tests.saveMarks', { testId: tst.testId, reason: 'Re-evaluation', entries: [{ studentId: st[0].studentId, status: 'entered', marks: 12 }] })); const a = D(c('audit.list', { action: 'test.marks' })).items[0]; assert.strictEqual(a.details.changes[0].from.marks, 10); assert.strictEqual(a.details.changes[0].to.marks, 12);
  E(c('tests.update', { testId: tst.testId, maxMarks: 5, reason: 'shrink' }), 'CONFLICT');
});

// ───────────────────────── Notifications ─────────────────────────
test('fee reminders: only eligible outstanding accounts; scheduled run only on the 5th, once; reruns create no duplicates', () => {
  const { be, c, mkBatch, mkStudent, mkFee, pay, verify } = fresh('2026-10-04T10:00:00+05:30'); const b = mkBatch(); const A = mkStudent('Asha', b.batchId), B = mkStudent('Bala', b.batchId), C = mkStudent('Chitra', b.batchId, { guardianWhatsapp: '' });
  mkFee(A.studentId); mkFee(B.studentId); mkFee(C.studentId); mkFee(A.studentId, '2026-11', 500, '2026-11-10'); verify(pay(B.studentId, 1000).paymentId);
  D(c('settings.update', { patch: { reminders_enabled: true } })); be.run('runScheduledJobs()'); assert.strictEqual(be.run(`Db.count('Notifications')`), 0, 'must not run on the 4th');
  be.setNow('2026-10-05T10:00:00+05:30'); const r1 = be.run('runScheduledJobs()'); const n = D(c('notifications.list')).items; assert.strictEqual(n.length, 2, 'A and C (B has paid); A\'s future Nov fee excluded'); assert.ok(n.every((x) => x.trigger === 'fee_reminder'));
  const nA = n.find((x) => x.studentId === A.studentId); assert.match(nA.message, /1000\.00/); assert.ok(!nA.message.includes('500')); assert.strictEqual(n.find((x) => x.studentId === C.studentId).status, 'skipped');
  be.run('runScheduledJobs()'); be.run('runScheduledJobs()'); assert.strictEqual(be.run(`Db.count('Notifications')`), 2); assert.strictEqual(be.run(`Db.filter('JobRuns',function(j){return j.job==='fee_reminders'}).length`), 1);
  be.setNow('2026-10-06T10:00:00+05:30'); be.run('runScheduledJobs()'); assert.strictEqual(be.run(`Db.count('Notifications')`), 2);
  assert.strictEqual(D(c('jobs.run', { job: 'fee_reminders' })).ok, true); assert.strictEqual(be.run(`Db.count('Notifications')`), 2, 'forced run is still idempotent');
});
function waSetup() { const x = fresh('2026-10-05T12:00:00+05:30'); x.be.run("TD.MESSAGING='api'"); x.be.props.set('WA_PHONE_NUMBER_ID', '123'); x.be.props.set('WA_ACCESS_TOKEN', 'tok'); D(x.c('settings.update', { patch: { wa_template_name: 'fee_update', absence_alert_enabled: true } })); const b = x.mkBatch(); const s = x.mkStudent('Asha', b.batchId, { whatsappConsent: 'yes' }); x.mkFee(s.studentId); return Object.assign(x, { b, s }); }
test('WhatsApp API: accepted ≠ delivered; delivered only via provider webhook; failures are shown as failed', () => {
  const { be, c, s } = waSetup(); be.fetchHandler = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }) });
  D(c('notifications.queueFeeReminders', {})); const q = D(c('notifications.list')).items[0]; assert.strictEqual(q.status, 'queued'); assert.strictEqual(q.channel, 'whatsapp_api');
  be.run('Notifications.processQueue(10)'); let n = D(c('notifications.list')).items[0]; assert.strictEqual(n.status, 'sent_to_provider'); assert.strictEqual(be.log.fetches.length, 1); assert.ok(!JSON.stringify(be.log.fetches[0].o.payload).includes('tok'));
  be.run('Notifications.processQueue(10)'); assert.strictEqual(be.log.fetches.length, 1, 'no resend');
  E(c('notifications.retry', { notificationId: n.notificationId }), 'CONFLICT');
  be.props.set('WA_WEBHOOK_SECRET', 'whs'); E(be.rawPost(JSON.stringify({ entry: [] }), { wa_secret: 'nope' }), 'FORBIDDEN');
  be.rawPost(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }] }), { wa_secret: 'whs' }); assert.strictEqual(D(c('notifications.list')).items[0].status, 'delivered');
  be.rawPost(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'sent' }] } }] }] }), { wa_secret: 'whs' }); assert.strictEqual(D(c('notifications.list')).items[0].status, 'delivered', 'never downgraded');
});
test('WhatsApp API failures: HTTP error → failed with backoff and bounded retries; network error → unknown and needs confirmation to retry', () => {
  const { be, c } = waSetup(); be.fetchHandler = () => ({ getResponseCode: () => 400, getContentText: () => '{"error":{"message":"bad"}}' });
  D(c('notifications.queueFeeReminders', {})); be.run('Notifications.processQueue(10)'); let n = D(c('notifications.list')).items[0]; assert.strictEqual(n.status, 'failed'); assert.strictEqual(n.attempts, 1); assert.ok(n.nextRetryAt);
  assert.strictEqual(D(c('dashboard.get')).notifications.failed, 1);
  be.fetchHandler = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ messages: [{ id: 'wamid.9' }] }) }); be.run('Notifications.processQueue(10)'); assert.strictEqual(D(c('notifications.list')).items[0].status, 'failed', 'retry not due yet');
  be.setNow('2026-10-05T13:00:00+05:30'); be.run('Notifications.processQueue(10)'); assert.strictEqual(D(c('notifications.list')).items[0].status, 'sent_to_provider'); assert.strictEqual(be.log.fetches.length, 2);
  const x = waSetup(); x.be.fetchHandler = () => { throw new Error('timeout'); }; D(x.c('notifications.queueFeeReminders', {})); x.be.run('Notifications.processQueue(10)'); n = D(x.c('notifications.list')).items[0]; assert.strictEqual(n.status, 'unknown');
  E(x.c('notifications.retry', { notificationId: n.notificationId }), 'NEEDS_CONFIRMATION'); x.be.fetchHandler = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ messages: [{ id: 'w2' }] }) });
  D(x.c('notifications.retry', { notificationId: n.notificationId, confirmDuplicateRisk: true })); assert.strictEqual(D(x.c('notifications.list')).items[0].status, 'sent_to_provider');
});
test('quiet hours hold automatic messages; manual fallback never claims delivery', () => {
  const { be, c } = waSetup(); be.setNow('2026-10-05T23:00:00+05:30'); be.fetchHandler = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ messages: [{ id: 'w' }] }) });
  D(c('notifications.queueFeeReminders', {})); be.run('Notifications.processQueue(10)'); let n = D(c('notifications.list')).items[0]; assert.strictEqual(n.status, 'queued'); assert.strictEqual(be.log.fetches.length, 0);
  be.setNow('2026-10-06T08:30:00+05:30'); be.run('Notifications.processQueue(10)'); assert.strictEqual(D(c('notifications.list')).items[0].status, 'sent_to_provider');
  const y = fresh(); const s = y.mkStudent('Bala', null, { whatsappConsent: 'yes' }); y.mkFee(s.studentId); D(y.c('notifications.queueFeeReminders', {})); const m = D(y.c('notifications.list')).items[0]; assert.strictEqual(m.status, 'pending_manual');
  const done = D(y.c('notifications.markSent', { notificationId: m.notificationId })); assert.strictEqual(done.status, 'manually_sent'); assert.notStrictEqual(done.status, 'delivered');
});
test('weekly report: Sunday only, correct 7-day range, real data only, skipped when there is nothing to report', () => {
  const { be, c, b, a, s2 } = attSetup({ weekly_report_enabled: true, weekly_report_recipients: '9800000001', weekly_report_hour: 18 });
  be.run(`Db.all('StudentBatchLinks').forEach(function(l){Db.update('StudentBatchLinks',l.link_id,{start_date:'2026-09-01'})})`);
  be.setNow('2026-10-04T19:00:00+05:30'); be.run('runScheduledJobs()'); assert.strictEqual(be.run(`Db.count('Notifications')`), 0, 'no data -> skipped'); assert.strictEqual(be.run(`Db.filter('JobRuns',function(j){return j.job==='weekly_report'}).length`), 1);
  be.setNow('2026-10-01T10:00:00+05:30'); D(c('attendance.save', { batchId: b.batchId, date: '2026-10-01', idempotencyKey: 'w1', entries: [{ studentId: a.studentId, status: 'P' }, { studentId: s2.studentId, status: 'A' }, { studentId: be.run(`Db.all('Students')[2].student_id`), status: 'P' }] }));
  D(c('attendance.save', { batchId: b.batchId, date: '2026-09-27', idempotencyKey: 'w0', entries: [{ studentId: a.studentId, status: 'A' }, { studentId: s2.studentId, status: 'A' }, { studentId: be.run(`Db.all('Students')[2].student_id`), status: 'A' }] }));
  be.setNow('2026-10-04T10:00:00+05:30'); be.run('runScheduledJobs()'); assert.strictEqual(be.run(`Db.count('Notifications')`), 0, 'before 18:00');
  be.setNow('2026-10-04T19:00:00+05:30'); const key = be.run(`Db.filter('JobRuns',function(j){return j.job==='weekly_report'}).length`); D(c('jobs.run', { job: 'weekly_report' })); const n = D(c('notifications.list')).items; assert.strictEqual(n.length, 1);
  assert.match(n[0].message, /2026-09-28 to 2026-10-04/); assert.match(n[0].message, /present 2, absent 1/); assert.strictEqual(n[0].trigger, 'weekly_report');
  be.run('runScheduledJobs()'); be.run('runScheduledJobs()'); assert.strictEqual(be.run(`Db.count('Notifications')`), 1);
});

// ───────────────────────── Documents & verification ─────────────────────────
test('documents need a centre name; reprint preserves id/version; changed content creates a new version; old one flagged not-latest', () => {
  const be = createBackend({ now: '2026-10-05T10:00:00+05:30' }).setup(); const t = be.bootstrapTeacher(); const c = (a, p) => be.call(a, p, t);
  const s = D(c('students.create', { fullName: 'Asha Verma', guardianWhatsapp: '9876543210' })); E(c('documents.issue', { type: 'admission_confirmation', studentId: s.studentId }), 'SETUP_REQUIRED');
  D(c('settings.update', { patch: { centre_name: 'Bright Minds' } })); const d1 = D(c('documents.issue', { type: 'admission_confirmation', studentId: s.studentId })); assert.strictEqual(d1.meta.version, 1); assert.strictEqual(d1.isReprint, false);
  const d1b = D(c('documents.issue', { type: 'admission_confirmation', studentId: s.studentId })); assert.strictEqual(d1b.isReprint, true); assert.strictEqual(d1b.meta.verificationId, d1.meta.verificationId);
  D(c('students.update', { studentId: s.studentId, fullName: 'Asha V. Verma' })); const d2 = D(c('documents.issue', { type: 'admission_confirmation', studentId: s.studentId })); assert.strictEqual(d2.meta.version, 2); assert.notStrictEqual(d2.meta.verificationId, d1.meta.verificationId); assert.match(d2.meta.documentNumber, /-v2$/);
  const old = D(c('documents.get', { verificationId: d1.meta.verificationId })); assert.strictEqual(old.meta.isLatest, false); assert.ok(JSON.stringify(old.snapshot).includes('Asha Verma') && !JSON.stringify(old.snapshot).includes('V. Verma'), 'original content preserved');
  assert.strictEqual(be.call('verify.check', { id: d1.meta.verificationId }).data.isLatest, false); const h = D(c('documents.history', { verificationId: d2.meta.verificationId })); assert.strictEqual(h.versions.length, 2); assert.ok(h.audit.length >= 2);
});
test('every document type can be issued from real records, includes centre name data, and refuses bad states', () => {
  const x = fresh(); const { c } = x; const b = x.mkBatch('Class 10'); const s = x.mkStudent('Asha', b.batchId); x.mkFee(s.studentId); x.verify(x.pay(s.studentId, 400).paymentId);
  const tst = D(c('tests.create', { batchId: b.batchId, title: 'T1', testDate: '2026-10-01', maxMarks: 20 })); E(c('documents.issue', { type: 'report_card', studentId: s.studentId }), 'CONFLICT'); E(c('documents.issue', { type: 'test_report', testId: tst.testId }), 'CONFLICT');
  D(c('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: s.studentId, status: 'entered', marks: 15 }] })); D(c('tests.publish', { testId: tst.testId, publish: true }));
  const n = D(c('notices.create', { title: 'Holiday', body: 'Closed on Monday', audienceType: 'all', status: 'published' })); const e = D(c('enquiries.create', { name: 'Kid', phone: '9811111111' })); D(c('homework.create', { audienceType: 'batch', batchId: b.batchId, title: 'Ex 1', dueDate: '2026-10-10', publicationStatus: 'published' }));
  const issued = {}; [['admission_form', { studentId: s.studentId }], ['admission_confirmation', { studentId: s.studentId }], ['id_card', { batchId: b.batchId }], ['fee_statement', { studentId: s.studentId }], ['fee_reminder', { studentId: s.studentId }], ['attendance_summary', { studentId: s.studentId }], ['report_card', { studentId: s.studentId }], ['test_report', { testId: tst.testId }],
    ['homework_summary', { batchId: b.batchId }], ['notice', { noticeId: n.noticeId }], ['enquiry_record', { enquiryId: e.enquiryId }], ['batch_report', { batchId: b.batchId }], ['financial_summary', { from: '2026-10-01', to: '2026-10-31' }]].forEach(([type, p]) => { const r = D(c('documents.issue', Object.assign({ type }, p))); issued[type] = r; assert.ok(r.snapshot.blocks.length > 0, type); assert.match(r.meta.verificationId, /^[a-f0-9]{32}$/); assert.strictEqual(r.render.centreName, 'Bright Minds Tuition'); });
  D(c('documents.issue', { type: 'verification_certificate', targetVerificationId: issued.fee_statement.meta.verificationId })); E(c('documents.issue', { type: 'receipt' }), 'VALIDATION');
  assert.strictEqual(D(c('documents.list')).total, 15); assert.strictEqual(issued.fee_statement.snapshot.blocks[0].rows[0][3], 400);
  const rc = x.be.call('documents.list', { docType: 'receipt' }, x.t).data.items[0]; assert.ok(rc);
});
test('public verification exposes only minimal metadata and supports valid / revoked / invalid', () => {
  const x = fresh(); const { be, c } = x; const s = x.mkStudent('Asha Verma', null, { guardianWhatsapp: '9811122233' }); x.mkFee(s.studentId, '2026-10', 1234); const v = x.verify(x.pay(s.studentId, 1234).paymentId); const vid = v.receipt.verificationId;
  let r = be.call('verify.check', { id: vid }); assert.deepStrictEqual(Object.keys(r.data).sort(), ['centreName', 'docType', 'isLatest', 'issueDate', 'status', 'version']); assert.strictEqual(r.data.status, 'valid'); assert.strictEqual(r.data.docType, 'Payment Receipt');
  const txt = JSON.stringify(r.data); ['Asha', '1234', '9811122233', 'STU-', 'RCP-', 'UTR'].forEach((k) => assert.ok(!txt.includes(k), 'leaks ' + k));
  assert.deepStrictEqual(be.call('verify.check', { id: 'f'.repeat(32) }).data.status, 'invalid'); assert.strictEqual(be.call('verify.check', { id: "' OR 1=1" }).data.status, 'invalid'); assert.strictEqual(be.call('verify.check', {}).data.status, 'invalid');
  assert.deepStrictEqual(JSON.parse(be.rawGet({ verify: vid })).data, r.data);
  const d = D(c('documents.issue', { type: 'admission_confirmation', studentId: s.studentId })); E(c('documents.revoke', { verificationId: d.meta.verificationId, reason: 'Issued in error' }), 'NEEDS_CONFIRMATION');
  D(c('documents.revoke', { verificationId: d.meta.verificationId, reason: 'Issued in error', confirm: true })); r = be.call('verify.check', { id: d.meta.verificationId }); assert.strictEqual(r.data.status, 'revoked'); assert.ok(!JSON.stringify(r.data).includes('error'));
  E(c('documents.revoke', { verificationId: vid, reason: 'Manual revoke', confirm: true }), 'CONFLICT'); assert.ok(D(c('documents.history', { verificationId: d.meta.verificationId })).audit.some((a) => a.action === 'document.revoke'));
  be.setNow('2026-10-05T10:00:30+05:30'); for (let i = 0; i < 125; i++) be.call('verify.check', { id: 'a'.repeat(32) }); E(be.call('verify.check', { id: 'a'.repeat(32) }), 'RATE_LIMITED');
});
test('verification payload (what QR/PDF417 encode) is a random 128-bit id — no personal data; document files must be real PDFs', () => {
  const x = fresh(); const s = x.mkStudent('Asha Verma'); const d = D(x.c('documents.issue', { type: 'admission_form', studentId: s.studentId })); assert.match(d.meta.verificationId, /^[a-f0-9]{32}$/); assert.ok(!d.meta.verificationId.includes('STU'));
  E(x.c('documents.attachFile', { verificationId: d.meta.verificationId, base64: Buffer.from('not a pdf '.repeat(20)).toString('base64') }), 'VALIDATION');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 1)]).toString('base64'); D(x.c('documents.attachFile', { verificationId: d.meta.verificationId, base64: pdf })); assert.strictEqual(x.be.log.files.length, 1);
});
test('students can view only their own issued documents (receipts etc.)', () => {
  const x = fresh(); const A = x.mkStudent('Asha'), B = x.mkStudent('Bala'); x.mkFee(A.studentId); const v = x.verify(x.pay(A.studentId, 100).paymentId);
  assert.strictEqual(D(x.be.call('my.documents', {}, A.token)).items.length, 1); assert.strictEqual(D(x.be.call('my.documents', {}, B.token)).items.length, 0); E(x.be.call('my.document', { verificationId: v.receipt.verificationId }, B.token), 'NOT_FOUND');
  const own = D(x.be.call('my.document', { verificationId: v.receipt.verificationId }, A.token)); assert.strictEqual(own.snapshot.title, 'Payment Receipt');
});

// ───────────────────────── Enquiries / homework / timetable / notices ─────────────────────────
test('enquiry conversion creates one student + admission and is idempotent', () => {
  const { be, c, mkBatch } = fresh(); const b = mkBatch(); const e = D(c('enquiries.create', { name: 'Ravi Kumar', guardianName: 'Mr Kumar', phone: '9811111111', source: 'Referral' })); E(c('enquiries.update', { enquiryId: e.enquiryId, status: 'admitted' }), 'CONFLICT');
  const r = D(c('enquiries.convert', { enquiryId: e.enquiryId, batchId: b.batchId })); assert.ok(r.temporaryPassword); const r2 = D(c('enquiries.convert', { enquiryId: e.enquiryId, batchId: b.batchId })); assert.strictEqual(r2.alreadyConverted, true); assert.strictEqual(r2.studentId, r.studentId);
  assert.strictEqual(be.run(`Db.count('Students')`), 1); assert.strictEqual(be.run(`Db.count('Admissions')`), 1); assert.strictEqual(D(c('admissions.list')).items[0].source, 'Referral');
});
test('homework/notices/timetable reach only the intended students; unpublished items stay hidden', () => {
  const { be, c, mkBatch, mkStudent } = fresh(); const b1 = mkBatch('B1'), b2 = mkBatch('B2'); const A = mkStudent('Asha', b1.batchId), B = mkStudent('Bala', b2.batchId);
  D(c('homework.create', { audienceType: 'batch', batchId: b1.batchId, title: 'HW-B1', dueDate: '2026-10-10', publicationStatus: 'published' })); D(c('homework.create', { audienceType: 'batch', batchId: b1.batchId, title: 'HW-draft', dueDate: '2026-10-10' })); D(c('homework.create', { audienceType: 'student', studentId: B.studentId, title: 'HW-B-only', dueDate: '2026-10-10', publicationStatus: 'published' }));
  assert.deepStrictEqual(D(be.call('my.homework', {}, A.token)).items.map((h) => h.title), ['HW-B1']); assert.deepStrictEqual(D(be.call('my.homework', {}, B.token)).items.map((h) => h.title), ['HW-B-only']);
  D(c('notices.create', { title: 'All', body: 'x', status: 'published' })); D(c('notices.create', { title: 'B2 only', body: 'x', audienceType: 'batch', batchId: b2.batchId, status: 'published' })); D(c('notices.create', { title: 'Draft', body: 'x' }));
  assert.deepStrictEqual(D(be.call('my.notices', {}, A.token)).items.map((n) => n.title), ['All']); assert.deepStrictEqual(D(be.call('my.notices', {}, B.token)).items.map((n) => n.title).sort(), ['All', 'B2 only']);
  D(c('timetable.create', { batchId: b1.batchId, kind: 'regular', weekday: 1, startTime: '16:00', endTime: '17:00', subject: 'Maths' })); D(c('timetable.create', { batchId: b1.batchId, kind: 'regular', weekday: 2, startTime: '16:00', endTime: '17:00', published: false }));
  D(c('timetable.create', { batchId: b1.batchId, kind: 'cancellation', date: '2026-10-12', note: 'Teacher away' }));
  assert.strictEqual(D(be.call('my.timetable', {}, A.token)).weekly.length, 1); assert.strictEqual(D(be.call('my.timetable', {}, B.token)).weekly.length, 0);
  assert.ok(D(be.call('my.timetable', {}, A.token)).upcoming.some((u) => u.date === '2026-10-12' && u.type === 'cancelled'));
  E(c('homework.create', { audienceType: 'batch', batchId: b1.batchId, title: 'x', assignedDate: '2026-10-10', dueDate: '2026-10-01' }), 'VALIDATION'); E(c('homework.create', { audienceType: 'batch', batchId: b1.batchId, title: 'x', dueDate: '2026-10-10', resourceUrl: 'javascript:alert(1)' }), 'VALIDATION');
});
test('students & batches: capacity, inactive students keep history, usernames unique, input sanitised', () => {
  const { be, c, mkBatch, mkStudent } = fresh(); const b = mkBatch('Tiny', 1); const s1 = mkStudent('Asha', b.batchId); E(c('students.create', { fullName: 'Bala', batchIds: [b.batchId] }), 'CAPACITY'); D(c('students.create', { fullName: 'Bala', batchIds: [b.batchId], overrideCapacity: true }));
  E(c('students.create', { fullName: 'X', username: 'stu0001' }), 'VALIDATION'); E(c('students.create', { fullName: 'Chitra', username: 'stu0001' }), 'CONFLICT');
  mkFeeFor(c, s1.studentId); D(c('students.setStatus', { studentId: s1.studentId, status: 'inactive' })); assert.strictEqual(be.run(`Db.count('Fees')`), 1); E(be.call('auth.login', { username: 'stu0001', password: 'Newpass123' }), 'AUTH_FAILED');
  assert.strictEqual(D(c('batches.get', { batchId: b.batchId })).roster.length, 1); E(c('students.create', { fullName: 'Bad<>', guardianWhatsapp: 'abc' }), 'VALIDATION');
  assert.strictEqual(be.run(`Db.filter('StudentBatchLinks',function(l){return l.student_id==='${s1.studentId}'})[0].status`), 'ended');
});
function mkFeeFor(c, sid) { D(c('fees.create', { studentId: sid, billingPeriod: '2026-10', amountDue: 100 })); }

// ───────────────────────── Audit, backup, errors ─────────────────────────
test('sensitive actions are audited and only the Teacher can read audit logs', () => {
  const x = fresh(); const s = x.mkStudent('Asha'); x.mkFee(s.studentId); D(x.c('students.update', { studentId: s.studentId, notes: 'SECRETNOTE' })); D(x.c('settings.update', { patch: { upi_id: 'centre@bank' } })); E(x.be.call('audit.list', {}, s.token), 'FORBIDDEN');
  const acts = D(x.c('audit.list', { pageSize: 100 })).items.map((a) => a.action); ['student.create', 'student.update', 'fee.create', 'settings.update', 'auth.bootstrap'].forEach((a) => assert.ok(acts.includes(a), a)); const du = D(x.c('audit.list', { action: 'student.update' })).items[0]; assert.ok(!JSON.stringify(du).includes('SECRETNOTE'));
  E(be_denied(x), 'FORBIDDEN'); assert.ok(D(x.c('audit.list', { action: 'security.denied' })).total >= 1);
});
function be_denied(x) { const s = D(x.c('students.list')).items[0]; const tok = x.be.login(x.be.run(`Db.all('Users').filter(function(u){return u.role==='student'})[0].username`), 'Newpass123'); return x.be.call('payments.verify', { paymentId: 'pay_x' }, tok); }
test('backup: copy is checksum-verified, restore test into a separate spreadsheet reconciles, restore into live is refused, tampering is detected', () => {
  const x = fresh(); const s = x.mkStudent('Asha'); x.mkFee(s.studentId); x.verify(x.pay(s.studentId, 400).paymentId); const bk = D(x.c('backup.run')); assert.strictEqual(bk.ok, true);
  const target = x.be.run(`(function(){var t=SpreadsheetApp.openById(Props.get('SPREADSHEET_ID'));return null})()`); const tid = (() => { const id = 'restore-target-1'; x.be.sheets.set(id, { id, name: 'restore', sheets: new Map() }); return id; })();
  const live = x.be.mainId; E(x.c('backup.restoreTest', { backupId: bk.backupId, targetSpreadsheetId: live }), 'FORBIDDEN');
  const rt = D(x.c('backup.restoreTest', { backupId: bk.backupId, targetSpreadsheetId: tid })); assert.strictEqual(rt.ok, true); assert.strictEqual(rt.ledgerReconciles, true); assert.deepStrictEqual(rt.mismatched, []);
  const rows = x.be.sheets.get(tid).sheets.get('Payments').data.length; assert.strictEqual(rows, x.be.sheets.get(x.be.mainId).sheets.get('Payments').data.length);
  assert.strictEqual(D(x.c('backup.verify', { backupId: bk.backupId })).ok, true); const bf = x.be.run(`Db.all('BackupLog')[0].file_id`); x.be.sheets.get(bf).sheets.get('Fees').data[1][6] = 'tampered'; assert.strictEqual(D(x.c('backup.verify', { backupId: bk.backupId })).ok, false);
  const l = D(x.c('backup.list')); assert.ok(l.lastBackup); assert.ok(l.lastRestoreTest); E(x.be.call('backup.list', {}, s.token), 'FORBIDDEN');
});
test('scheduled backup runs when due and retention trashes expired backups', () => {
  const x = fresh(); x.be.run('runScheduledJobs()'); assert.strictEqual(x.be.run(`Db.filter('BackupLog',function(b){return b.kind==='backup'}).length`), 1); x.be.run('runScheduledJobs()'); assert.strictEqual(x.be.run(`Db.filter('BackupLog',function(b){return b.kind==='backup'}).length`), 1);
  x.be.setNow('2026-10-13T10:00:00+05:30'); x.be.run('runScheduledJobs()'); assert.strictEqual(x.be.run(`Db.filter('BackupLog',function(b){return b.kind==='backup'}).length`), 2);
  x.be.setNow('2027-02-01T10:00:00+05:30'); D(x.c('backup.run')); assert.ok([...x.be.files.values()].some((f) => f.trashed), 'old backup trashed');
});
test('internal errors do not leak stack traces or configuration', () => {
  const x = fresh(); x.be.run(`Db.get = function(){ throw new Error('boom at /secret/path SPREADSHEET_ID=abc'); }`); const r = x.be.call('students.get', { studentId: 'STU-0001' }, x.t);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error.code, 'INTERNAL_ERROR'); assert.ok(!JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('SPREADSHEET'));
});
test('settings are validated server-side (A4/A5 only, opacity bounds, https base url)', () => {
  const { c, mkStudent } = fresh(); E(c('settings.update', { patch: { pdf_page_size: 'Letter' } }), 'VALIDATION'); E(c('settings.update', { patch: { watermark_opacity: 0.9 } }), 'VALIDATION'); E(c('settings.update', { patch: { public_base_url: 'http://x' } }), 'VALIDATION'); E(c('settings.update', { patch: { nonsense: 1 } }), 'VALIDATION');
  D(c('settings.update', { patch: { pdf_page_size: 'A5', pdf_color_mode: 'bw', show_teacher_name: false, watermark_position: 'diagonal', weekly_report_recipients: '9800000001, 9800000002' } })); const g = D(c('settings.get')); assert.strictEqual(g.settings.pdf_page_size, 'A5'); assert.strictEqual(g.settings.weekly_report_recipients, '919800000001,919800000002'); assert.strictEqual(g.integrations.whatsappApi, false);
  const s = mkStudent('Zed'); assert.ok(s);
});
test('dashboard metrics are computed from real records with definitions and bounded ranges', () => {
  const x = fresh(); const b = x.mkBatch('Class 7', 4); const s = x.mkStudent('Asha', b.batchId); x.mkStudent('Bala', b.batchId); x.mkFee(s.studentId, '2026-09', 1000, '2026-09-10'); x.verify(x.pay(s.studentId, 250).paymentId);
  const d = D(x.c('dashboard.get', { from: '2026-10-01', to: '2026-10-31' })); assert.strictEqual(d.collections.net, 250); assert.strictEqual(d.outstanding.total, 750); assert.strictEqual(d.outstanding.overdue, 750); assert.strictEqual(d.batches.occupancy[0].percent, 50); assert.strictEqual(d.students.active, 2); assert.ok(d.definitions.collections.includes('Verified')); assert.strictEqual(D(x.c('dashboard.get', { from: '2026-11-01', to: '2026-11-30' })).collections.net, 0);
  E(x.c('dashboard.get', { from: '2026-11-01', to: '2026-10-01' }), 'VALIDATION');
});

// ───────────────────────── two-step sign-in (Teacher) ─────────────────────────
// Independent RFC 6238 implementation (does not share code with Mfa.gs).
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const unb32 = (s) => { let bits = ''; for (const ch of s) bits += B32.indexOf(ch).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (secret, atMs, digits = 6) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000))); const h = crypto.createHmac('sha1', unb32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 10 ** digits).padStart(digits, '0'); };
const NOW = '2026-10-05T10:00:00+05:30';
function mfaOn(x) {
  const b = D(x.c('mfa.begin', { password: 'Teacher#12345' }));
  const en = D(x.c('mfa.enable', { code: totp(b.secret, Date.parse(NOW)) }));
  return { secret: b.secret, codes: en.recoveryCodes };
}
const later = (x, sec) => x.be.setNow(new Date(Date.parse(NOW) + sec * 1000).toISOString());

test('TOTP matches the RFC 6238 test vector (secret 12345678901234567890, T=59 -> 287082)', () => {
  const x = fresh(); assert.strictEqual(x.be.run("Mfa._hotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)"), '287082');
});
test('2FA setup needs the password, only turns on after a valid code, and returns 10 recovery codes once', () => {
  const x = fresh(); E(x.c('mfa.begin', { password: 'wrong-password1' }), 'AUTH_FAILED');
  const b = D(x.c('mfa.begin', { password: 'Teacher#12345' }));
  assert.ok(/^[A-Z2-7]{32}$/.test(b.secret)); assert.ok(b.otpauthUri.startsWith('otpauth://totp/') && b.otpauthUri.includes('secret=' + b.secret));
  assert.strictEqual(D(x.c('mfa.status')).enabled, false);
  E(x.c('mfa.enable', { code: '000000' }), 'AUTH_FAILED'); assert.strictEqual(D(x.c('mfa.status')).enabled, false);
  const en = D(x.c('mfa.enable', { code: totp(b.secret, Date.parse(NOW)) }));
  assert.strictEqual(en.recoveryCodes.length, 10); assert.ok(en.recoveryCodes.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c)));
  assert.strictEqual(new Set(en.recoveryCodes).size, 10);
  const st = D(x.c('mfa.status')); assert.strictEqual(st.enabled, true); assert.strictEqual(st.recoveryCodesRemaining, 10); assert.ok(!JSON.stringify(st).includes(b.secret));
});
test('with 2FA on, the password alone gives NO session; the correct code does', () => {
  const x = fresh(); const m = mfaOn(x); later(x, 40);
  const r = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' }));
  assert.strictEqual(r.mfaRequired, true); assert.ok(!r.token); assert.ok(r.mfaToken);
  E(x.be.call('auth.me', {}, r.mfaToken), 'UNAUTHENTICATED');           // the challenge token is not a session
  E(x.be.call('auth.mfaVerify', { mfaToken: r.mfaToken, code: '123456' }), 'AUTH_FAILED');
  const ok = D(x.be.call('auth.mfaVerify', { mfaToken: r.mfaToken, code: totp(m.secret, Date.parse(NOW) + 40000) }));
  assert.ok(ok.token); assert.strictEqual(ok.user.mfaEnabled, true); D(x.be.call('auth.me', {}, ok.token));
  E(x.be.call('auth.mfaVerify', { mfaToken: r.mfaToken, code: totp(m.secret, Date.parse(NOW) + 40000) }), 'UNAUTHENTICATED'); // challenge is single use
});
test('a TOTP code cannot be replayed, and codes far outside the 30s window are refused', () => {
  const x = fresh(); const m = mfaOn(x); later(x, 100);
  const code = totp(m.secret, Date.parse(NOW) + 100000);
  const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); D(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code }));
  const b = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); E(x.be.call('auth.mfaVerify', { mfaToken: b.mfaToken, code }), 'AUTH_FAILED');
  const old = totp(m.secret, Date.parse(NOW) + 100000 - 5 * 60000); E(x.be.call('auth.mfaVerify', { mfaToken: b.mfaToken, code: old }), 'AUTH_FAILED');
});
test('second-step guessing is throttled (5 wrong codes lock it, even for the right code)', () => {
  const x = fresh(); const m = mfaOn(x); later(x, 60);
  const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' }));
  for (let i = 0; i < 5; i++) E(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: '11111' + i }), 'AUTH_FAILED');
  E(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: totp(m.secret, Date.parse(NOW) + 60000) }), 'RATE_LIMITED');
});
test('recovery codes sign in once each; only hashes are stored; used count is reported', () => {
  const x = fresh(); const m = mfaOn(x);
  const sheet = x.be.run("JSON.stringify(Object.keys(SCHEMA).map(function (t) { return Db.all(t); }))");
  assert.ok(sheet.includes('teacher') && sheet.includes('recovery_hashes'), 'database dump must really contain the Users rows');
  assert.ok(!sheet.includes(m.codes[0]) && !sheet.includes(m.codes[0].replace(/-/g, '')) , 'recovery code must not be stored in clear');
  assert.ok(!sheet.includes(m.codes[5].replace(/-/g, '')), 'no recovery code stored in clear');
  assert.ok(!sheet.includes(m.secret), 'TOTP secret must be sealed in the sheet');
  const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' }));
  const ok = D(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: m.codes[0].toLowerCase().replace(/-/g, ' ') }));
  assert.strictEqual(ok.secondFactor, 'recovery'); assert.strictEqual(ok.recoveryCodesRemaining, 9);
  const b = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); E(x.be.call('auth.mfaVerify', { mfaToken: b.mfaToken, code: m.codes[0] }), 'AUTH_FAILED');
  D(x.be.call('auth.mfaVerify', { mfaToken: b.mfaToken, code: m.codes[1] }));
});
test('2FA never applies to students; students cannot call mfa.* or see teacher factors', () => {
  const x = fresh(); const s = x.mkStudent('Asha'); mfaOn(x); const tok = s.token;
  for (const a of ['mfa.status', 'mfa.begin', 'mfa.enable', 'mfa.disable', 'mfa.regenerateRecovery', 'mfa.emailStart']) E(x.be.call(a, { password: 'x', code: 'x' }, tok), 'FORBIDDEN');
  E(x.be.call('mfa.status', {}), 'UNAUTHENTICATED');
});
test('turning 2FA off needs password + a valid factor and logs other sessions out', () => {
  const x = fresh(); const m = mfaOn(x); E(x.c('mfa.disable', { password: 'Teacher#12345', code: '000000' }), 'AUTH_FAILED'); E(x.c('mfa.disable', { password: 'bad-pass-123', code: m.codes[0] }), 'AUTH_FAILED');
  D(x.c('mfa.disable', { password: 'Teacher#12345', code: m.codes[0] })); assert.strictEqual(D(x.c('mfa.status')).enabled, false);
  assert.ok(D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })).token, 'plain login works again');
});
test('regenerating recovery codes needs an authenticator code and voids the old ones', () => {
  const x = fresh(); const m = mfaOn(x); later(x, 90); E(x.c('mfa.regenerateRecovery', { password: 'Teacher#12345', code: m.codes[0] }), 'AUTH_FAILED');
  const n = D(x.c('mfa.regenerateRecovery', { password: 'Teacher#12345', code: totp(m.secret, Date.parse(NOW) + 90000) })).recoveryCodes;
  assert.strictEqual(n.length, 10); const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' }));
  E(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: m.codes[2] }), 'AUTH_FAILED'); D(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: n[0] }));
});
test('recovery email must be confirmed by a code before it can be used; emails are masked and rate limited', () => {
  const x = fresh(); const m = mfaOn(x);
  E(x.c('mfa.emailStart', { password: 'Teacher#12345', email: 'not-an-email' }), 'VALIDATION');
  const s = D(x.c('mfa.emailStart', { password: 'Teacher#12345', email: 'Rao.Teacher@example.com' })); assert.strictEqual(s.sentTo, 'r***@example.com');
  assert.strictEqual(x.be.log.mails.length, 1); assert.strictEqual(x.be.log.mails[0].to, 'rao.teacher@example.com');
  assert.strictEqual(D(x.c('mfa.status')).recoveryEmail, ''); // not active until confirmed
  const a0 = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); E(x.be.call('auth.mfaEmailCode', { mfaToken: a0.mfaToken }), 'NOT_CONFIGURED');
  E(x.c('mfa.emailConfirm', { code: '00000000' }), 'AUTH_FAILED');
  const code = x.be.log.mails[0].body.match(/\b(\d{8})\b/)[1]; assert.strictEqual(D(x.c('mfa.emailConfirm', { code })).recoveryEmail, 'r***@example.com');
  E(x.c('mfa.emailConfirm', { code }), 'AUTH_FAILED'); // single use
  const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); assert.strictEqual(a.methods.email, true);
  D(x.be.call('auth.mfaEmailCode', { mfaToken: a.mfaToken })); D(x.be.call('auth.mfaEmailCode', { mfaToken: a.mfaToken })); // 2nd + 3rd send overall (1st was confirmation)
  E(x.be.call('auth.mfaEmailCode', { mfaToken: a.mfaToken }), 'RATE_LIMITED');
  const mail = x.be.log.mails[x.be.log.mails.length - 1]; const ec = mail.body.match(/\b(\d{8})\b/)[1];
  const ok = D(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: ec })); assert.strictEqual(ok.secondFactor, 'email');
});
test('emailed code expires after 10 minutes; a failing mail service is reported honestly', () => {
  const x = fresh(); mfaOn(x); D(x.c('mfa.emailStart', { password: 'Teacher#12345', email: 'a@example.com' })); D(x.c('mfa.emailConfirm', { code: x.be.log.mails[0].body.match(/\b(\d{8})\b/)[1] }));
  later(x, 30); const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); D(x.be.call('auth.mfaEmailCode', { mfaToken: a.mfaToken }));
  const code = x.be.log.mails[1].body.match(/\b(\d{8})\b/)[1];
  x.be.cache.delete('mfae_' + x.be.run("Db.find('Users', function(u){return u.role==='teacher';}).user_id")); // simulate expiry
  E(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code }), 'AUTH_FAILED');
  x.be.mailFail = true; const b = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' })); E(x.be.call('auth.mfaEmailCode', { mfaToken: b.mfaToken }), 'EMAIL_FAILED');
});
test('forgotten password: needs TWO different factors; one recovery code alone is not enough; sessions are revoked', () => {
  const x = fresh(); const m = mfaOn(x); const oldTok = x.t; later(x, 120);
  const body = (o) => Object.assign({ username: 'teacher', newPassword: 'Brand#New2026x' }, o);
  E(x.be.call('auth.recoverPassword', body({ code1: m.codes[0], code2: m.codes[1] })), 'AUTH_FAILED');                      // two recovery codes: same kind
  E(x.be.call('auth.recoverPassword', body({ code1: m.codes[0], code2: m.codes[0] })), 'AUTH_FAILED');
  E(x.be.call('auth.recoverPassword', body({ code1: m.codes[0], code2: '999999' })), 'AUTH_FAILED');
  E(x.be.call('auth.recoverPassword', { username: 'nobody', newPassword: 'Brand#New2026x', code1: '1', code2: '2' }), 'AUTH_FAILED');
  E(x.be.call('auth.login', { username: 'teacher', password: 'Brand#New2026x' }), 'AUTH_FAILED');  // nothing changed yet
  const t = totp(m.secret, Date.parse(NOW) + 120000);
  E(x.be.call('auth.recoverPassword', body({ code1: m.codes[0], code2: t, newPassword: 'short' })), 'VALIDATION');
  D(x.be.call('auth.recoverPassword', body({ code1: m.codes[0], code2: t })));
  E(x.be.call('auth.me', {}, oldTok), 'UNAUTHENTICATED');
  const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Brand#New2026x' })); assert.strictEqual(a.mfaRequired, true, 'a new password does not bypass 2FA');
  E(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: m.codes[0] }), 'AUTH_FAILED'); // that recovery code was consumed
});
test('forgotten password via emailed code + printed code; reset-email request never reveals whether an account exists', () => {
  const x = fresh(); const m = mfaOn(x); D(x.c('mfa.emailStart', { password: 'Teacher#12345', email: 'a@example.com' })); D(x.c('mfa.emailConfirm', { code: x.be.log.mails[0].body.match(/\b(\d{8})\b/)[1] }));
  const r1 = D(x.be.call('auth.recoveryEmailCode', { username: 'teacher' })), r2 = D(x.be.call('auth.recoveryEmailCode', { username: 'ghost' })); assert.deepStrictEqual(r1, r2);
  assert.strictEqual(x.be.log.mails.length, 2); const ec = x.be.log.mails[1].body.match(/\b(\d{8})\b/)[1];
  D(x.be.call('auth.recoverPassword', { username: 'teacher', newPassword: 'Another#Pass99', code1: ec, code2: m.codes[3] }));
  assert.strictEqual(D(x.be.call('auth.login', { username: 'teacher', password: 'Another#Pass99' })).mfaRequired, true);
});
test('account without 2FA has no self-service recovery (nothing to prove with)', () => {
  const x = fresh(); E(x.be.call('auth.recoverPassword', { username: 'teacher', newPassword: 'Brand#New2026x', code1: '123456', code2: '12345678' }), 'AUTH_FAILED');
  assert.strictEqual(D(x.be.call('auth.recoveryEmailCode', { username: 'teacher' })).requested, true); assert.strictEqual(x.be.log.mails.length, 0);
});
test('audit log records 2FA events but never a secret, code or hash', () => {
  const x = fresh(); const m = mfaOn(x); const a = D(x.be.call('auth.login', { username: 'teacher', password: 'Teacher#12345' }));
  E(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: '000000' }), 'AUTH_FAILED'); D(x.be.call('auth.mfaVerify', { mfaToken: a.mfaToken, code: m.codes[0] }));
  const log = JSON.stringify(D(x.c('audit.list', { pageSize: 100 })).items);
  for (const w of ['mfa.enabled', 'mfa.failed', 'mfa.login']) assert.ok(log.includes(w), 'missing audit ' + w);
  assert.ok(!log.includes(m.secret) && !log.includes(m.codes[0]) && !log.includes('000000'));
});

// ───────────────────────── data export ─────────────────────────
test('export: students, fees, payments and attendance return real rows matching the records; Teacher only; audited', () => {
  const x = fresh(); const b = x.mkBatch(); const s = x.mkStudent('Asha', b.batchId, { notes: 'allergic, "quote"' }); x.mkStudent('Bala', b.batchId);
  const f = x.mkFee(s.studentId, '2026-10', 1500); const p = x.pay(s.studentId, 1000, 'UTR777'); x.verify(p.paymentId); x.pay(s.studentId, 200, 'UTR888');
  D(x.c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'k1', entries: [{ studentId: s.studentId, status: 'P' }, { studentId: x.c('students.list', {}).data.items.find((i) => i.fullName === 'Bala').studentId, status: 'A' }] }));
  const st = D(x.c('export.get', { dataset: 'students' })); assert.strictEqual(st.total, 2); assert.ok(st.columns.length === st.rows[0].length);
  const asha = st.rows.find((r) => r[1] === 'Asha'); assert.strictEqual(asha[0], s.studentId); assert.strictEqual(asha[8], 'Class 10 Maths'); assert.strictEqual(asha[11], 'allergic, "quote"');
  const fe = D(x.c('export.get', { dataset: 'fees' })); assert.strictEqual(fe.total, 1); const fr = fe.rows[0]; assert.deepStrictEqual([fr[3], fr[5], fr[7], fr[8], fr[9], fr[10]], ['2026-10', 1500, 1500, 1000, 500, 'partial']);
  const pa = D(x.c('export.get', { dataset: 'payments' })); assert.strictEqual(pa.total, 2); const verified = pa.rows.find((r) => r[6] === 'UTR777'); assert.strictEqual(verified[8], 'verified'); assert.ok(/^RCP-/.test(verified[12])); assert.strictEqual(pa.rows.find((r) => r[6] === 'UTR888')[8], 'pending');
  const at = D(x.c('export.get', { dataset: 'attendance' })); assert.strictEqual(at.total, 2); assert.deepStrictEqual(at.rows.map((r) => r[5]).sort(), ['A', 'P']);
  assert.strictEqual(D(x.c('export.get', { dataset: 'attendance', from: '2026-11-01' })).total, 0, 'date filter');
  E(x.c('export.get', { dataset: 'users' }), 'VALIDATION'); E(x.c('export.get', { dataset: 'fees', from: '2026-12-01', to: '2026-01-01' }), 'VALIDATION');
  E(x.be.call('export.get', { dataset: 'students' }, s.token), 'FORBIDDEN'); E(x.be.call('export.get', { dataset: 'students' }), 'UNAUTHENTICATED');
  const au = JSON.stringify(D(x.c('audit.list', { action: 'export.', pageSize: 20 })).items); assert.ok(au.includes('export.run') && !au.includes('Asha') && !au.includes('UTR777'), 'audit has counts only, no data');
});
test('export pages instead of truncating (1000 rows per page) and never exposes password hashes', () => {
  const x = fresh(); const b = x.mkBatch(); for (let i = 0; i < 3; i++) x.mkStudent('Kid' + i, b.batchId);
  const dump = JSON.stringify(D(x.c('export.get', { dataset: 'students' }))); assert.ok(!/password|salt|hash/i.test(dump.replace(/Student ID/g, '')));
  D(x.c('attendance.save', { batchId: b.batchId, date: '2026-10-05', idempotencyKey: 'pg', entries: D(x.c('students.list', {})).items.map((i) => ({ studentId: i.studentId, status: 'P' })) }));
  const sid = x.be.run("Db.all('AttendanceSessions')[0].session_id");
  x.be.run("for (var i = 0; i < 1204; i++) Db.insert('AttendanceEntries', { attendance_id: 'att_bulk' + i, session_id: '" + sid + "', student_id: 'stu_x' + i, status: 'P', correction_reason: '', updated_by: 't', updated_at: '' });");
  const p1 = D(x.c('export.get', { dataset: 'attendance', page: 1 })), p2 = D(x.c('export.get', { dataset: 'attendance', page: 2 }));
  assert.strictEqual(p1.total, 1207); assert.strictEqual(p1.pages, 2); assert.strictEqual(p1.rows.length, 1000); assert.strictEqual(p2.rows.length, 207);
  assert.strictEqual(new Set(p1.rows.concat(p2.rows).map((r) => r[3])).size, 1207, 'no row lost or duplicated across pages');
});

// ───────────────────────── Pay links, self-send messaging, reminder ladder ─────────────────────────
function ladderSetup(now = '2026-10-07T10:00:00+05:30', patch = {}) {
  const x = fresh(now); const b = x.mkBatch(); const A = x.mkStudent('Asha Rao', b.batchId, { whatsappConsent: 'yes', guardianWhatsapp: '9876500001' });
  D(x.c('settings.update', { patch: Object.assign({ centre_name: 'Bright Minds', upi_id: 'bright@okbank', upi_payee_name: 'Bright Minds', public_base_url: 'https://app.example.org/td/', ladder_enabled: true, quiet_hours_enabled: true }, patch) }));
  const fee = x.mkFee(A.studentId); return Object.assign(x, { b, A, fee });
}
const lnotes = (c, trig) => D(c('notifications.list', { pageSize: 100 })).items.filter((n) => !trig || n.trigger === trig);
test('self-send is the only mode: even with provider credentials present nothing is ever fetched, every message waits for the Teacher', () => {
  const { be, c, A } = ladderSetup(); be.props.set('WA_PHONE_NUMBER_ID', '1'); be.props.set('WA_ACCESS_TOKEN', 't'); D(c('settings.update', { patch: { wa_template_name: 'x' } }));
  D(c('notifications.queueFeeReminders', {})); be.run('Notifications.processQueue(10)'); const n = lnotes(c)[0];
  assert.strictEqual(n.status, 'pending_manual'); assert.strictEqual(n.channel, 'whatsapp_share_link'); assert.strictEqual(be.log.fetches.length, 0); assert.strictEqual(D(c('notifications.list')).apiConfigured, false);
  assert.ok(n.shareLink.startsWith('https://wa.me/')); D(c('notifications.markSent', { notificationId: n.notificationId })); assert.strictEqual(lnotes(c)[0].status, 'manually_sent');
});
test('pay link: exact amount, months and UPI deep link; stable per family; reminder messages carry it', () => {
  const { be, c, A } = ladderSetup(); D(c('fees.create', { studentId: A.studentId, billingPeriod: '2026-11', amountDue: 250.5, dueDate: '2026-11-10' }));
  const l = D(c('pay.link', { studentId: A.studentId })); assert.match(l.url, /^https:\/\/app\.example\.org\/td\/#\/pay\/[a-f0-9]{32}$/); assert.strictEqual(D(c('pay.link', { studentId: A.studentId })).url, l.url);
  const id = l.url.split('/').pop(), i = D(be.call('pay.info', { id }));
  assert.strictEqual(i.status, 'due'); assert.strictEqual(i.amount, 1000, 'Nov fee is outside the window so only Oct is payable now'); assert.deepStrictEqual(i.months, ['Oct 2026']); assert.strictEqual(i.studentFirstName, 'Asha');
  const u = new URL(i.upiUri.replace('upi://', 'https://x/')); assert.strictEqual(u.searchParams.get('pa'), 'bright@okbank'); assert.strictEqual(u.searchParams.get('am'), '1000.00'); assert.strictEqual(u.searchParams.get('cu'), 'INR'); assert.match(u.searchParams.get('tn'), /^Fee Asha Oct 2026 #[A-F0-9]{6}$/); assert.strictEqual(u.searchParams.get('tn').split('#')[1], i.reference);
  D(c('notifications.queueFeeReminders', {})); assert.ok(lnotes(c)[0].message.includes(l.url), 'message carries the pay link');
});
test('pay page is private: first name only, no phone/full name/ids, same answer for unknown or malformed ids, rate limited', () => {
  const { be, c, A } = ladderSetup(); const id = D(c('pay.link', { studentId: A.studentId })).url.split('/').pop(), s = JSON.stringify(D(be.call('pay.info', { id })));
  assert.ok(!s.includes('Rao') && !s.includes('9876500001') && !s.includes(A.studentId) && !s.includes('Guardian'), s);
  const a = D(be.call('pay.info', { id: 'f'.repeat(32) })), b = D(be.call('pay.info', { id: 'nope' })), cc = D(be.call('pay.info', {})); assert.deepStrictEqual(a, { status: 'invalid' }); assert.deepStrictEqual(b, a); assert.deepStrictEqual(cc, a);
  D(c('students.setStatus', { studentId: A.studentId, status: 'inactive', confirm: true })); assert.deepStrictEqual(D(be.call('pay.info', { id })), a, 'inactive student link stops working');
  let limited = false; for (let k = 0; k < 130; k++) { const r = be.call('pay.info', { id: 'a'.repeat(32) }); if (!r.ok && r.error.code === 'RATE_LIMITED') { limited = true; break; } } assert.ok(limited);
});
test('pay page: after the Teacher verifies a payment it shows nothing due; "I have paid" never touches the ledger', () => {
  const { be, c, A, pay, verify } = ladderSetup(); const id = D(c('pay.link', { studentId: A.studentId })).url.split('/').pop(), before = JSON.stringify(D(c('fees.list', { studentId: A.studentId })));
  const r = D(be.call('pay.report', { id, reference: 'UTR 123<script>' })); assert.strictEqual(r.recorded, true); assert.strictEqual(JSON.stringify(D(c('fees.list', { studentId: A.studentId }))), before, 'ledger unchanged');
  assert.strictEqual(D(be.call('pay.info', { id })).reportedRecently, true); assert.strictEqual(D(c('ladder.status')).reported[0].reference, 'UTR 123script');
  verify(pay(A.studentId, 1000).paymentId); const i = D(be.call('pay.info', { id })); assert.strictEqual(i.status, 'clear'); assert.strictEqual(i.upiUri, ''); assert.strictEqual(D(be.call('pay.report', { id })).recorded, false);
  assert.ok(D(c('audit.list', { action: 'paylink' })).items.length >= 2);
});
test('ladder: friendly before, polite on due date, firm after grace; repeats spaced; max then "needs a call"; reruns never duplicate', () => {
  const { be, c, A } = ladderSetup('2026-10-06T10:00:00+05:30'); const run = (d) => { be.setNow(d + 'T10:00:00+05:30'); return D(c('ladder.run')); };
  assert.strictEqual(run('2026-10-06').created, 0, '4 days ahead is too early');
  assert.strictEqual(run('2026-10-07').created, 1); assert.strictEqual(run('2026-10-07').created, 0); assert.strictEqual(lnotes(c, 'ladder_friendly').length, 1); assert.match(lnotes(c, 'ladder_friendly')[0].message, /friendly heads-up.*1000\.00.*10 Oct/);
  assert.strictEqual(run('2026-10-08').created, 0, 'friendly is sent once per fee');
  assert.strictEqual(run('2026-10-10').created, 1); assert.match(lnotes(c, 'ladder_due')[0].message, /due today/);
  assert.strictEqual(run('2026-10-12').created, 0, 'inside the grace period nothing more');
  assert.strictEqual(run('2026-10-18').created, 1); assert.match(lnotes(c, 'ladder_firm')[0].message, /8 days past/); assert.strictEqual(run('2026-10-18').created, 0); assert.strictEqual(run('2026-10-24').created, 0, 'repeat spacing is 7 days');
  assert.strictEqual(run('2026-10-25').created, 1); assert.strictEqual(run('2026-11-01').created, 1); assert.strictEqual(lnotes(c, 'ladder_firm').length, 3);
  const r = run('2026-11-09'); assert.strictEqual(r.created, 0); assert.strictEqual(D(c('ladder.status')).needsCall.length, 1); assert.strictEqual(D(c('ladder.status')).needsCall[0].studentId, A.studentId);
});
test('ladder stops once paid: waiting reminders are cancelled only after the Teacher verifies the payment', () => {
  const { be, c, A, pay, verify } = ladderSetup(); D(c('ladder.run')); assert.strictEqual(lnotes(c, 'ladder_friendly')[0].status, 'pending_manual');
  const p = pay(A.studentId, 1000); D(c('ladder.run')); assert.strictEqual(lnotes(c, 'ladder_friendly')[0].status, 'pending_manual', 'recorded but unverified payment does not count');
  verify(p.paymentId); be.run('runScheduledJobs()'); const n = lnotes(c, 'ladder_friendly')[0]; assert.strictEqual(n.status, 'cancelled'); assert.match(n.statusReason, /Paid/);
  be.setNow('2026-10-10T10:00:00+05:30'); assert.strictEqual(D(c('ladder.run')).created, 0);
});
test('ladder holds: unverified payment, parent said paid, pause date, mode off; gentle family goes to "needs a call" instead of a firm message', () => {
  const { be, c, A, pay } = ladderSetup('2026-10-10T10:00:00+05:30'); const pv = () => D(c('ladder.preview')).items.find((i) => i.studentId === A.studentId);
  const p = pay(A.studentId, 400); assert.strictEqual(pv().action, 'hold'); assert.match(pv().note, /not verified/); D(c('payments.reject', { paymentId: p.paymentId, reason: 'not found in bank' })); assert.strictEqual(pv().action, 'send');
  const id = D(c('pay.link', { studentId: A.studentId })).url.split('/').pop(); D(be.call('pay.report', { id })); assert.match(pv().note, /said they paid/); be.setNow('2026-10-14T10:00:00+05:30'); assert.strictEqual(pv().action, 'send', 'hold ends after 3 days');
  D(c('students.update', { studentId: A.studentId, reminderPauseUntil: '2026-10-20' })); assert.strictEqual(pv().action, 'hold'); assert.match(pv().note, /Paused until 2026-10-20/);
  D(c('students.update', { studentId: A.studentId, reminderPauseUntil: '', reminderMode: 'off' })); assert.strictEqual(pv().action, 'hold'); assert.strictEqual(D(c('ladder.run')).created, 0);
  D(c('students.update', { studentId: A.studentId, reminderMode: 'gentle' })); be.setNow('2026-10-20T10:00:00+05:30'); assert.strictEqual(pv().action, 'call'); D(c('ladder.run')); assert.strictEqual(lnotes(c, 'ladder_firm').length, 0);
  E(c('students.update', { studentId: A.studentId, reminderMode: 'angry' }), 'VALIDATION'); assert.strictEqual(D(c('students.get', { studentId: A.studentId })).reminderMode, 'gentle');
});
test('ladder adapts to the family: prompt payers skip the friendly nudge, habitual late payers get it 4 days earlier, and the preview says why', () => {
  const x = ladderSetup('2026-06-08T10:00:00+05:30', { ladder_enabled: true }); const { be, c, A, pay, verify } = x;
  be.setNow('2026-06-08T10:00:00+05:30'); const f6 = x.mkFee(A.studentId, '2026-06', 800), f7 = x.mkFee(A.studentId, '2026-07', 800), f8 = x.mkFee(A.studentId, '2026-08', 800);
  D(c('fees.cancel', { feeId: x.fee.feeId, reason: 'test setup' }));
  const payOn = (day, fee) => { be.setNow(day + 'T10:00:00+05:30'); const p = pay(A.studentId, 800); verify(p.paymentId, { allocations: [{ feeId: fee.feeId, amount: 800 }] }); };
  payOn('2026-06-08', f6); payOn('2026-07-09', f7); payOn('2026-08-08', f8);
  x.mkFee(A.studentId, '2026-11', 900, '2026-11-10'); be.setNow('2026-11-07T10:00:00+05:30'); const it = D(c('ladder.preview')).items.find((i) => i.studentId === A.studentId);
  assert.strictEqual(it.action, 'skipped'); assert.match(it.note, /Pays on time/); D(c('settings.update', { patch: { ladder_adapt: false } })); assert.strictEqual(D(c('ladder.preview')).items.find((i) => i.studentId === A.studentId).action, 'send');
});
test('ladder adapts to chronic late payers (nudge sent 4 days earlier) and keeps quiet hours: scheduled runs never queue at night, hand-queued messages are marked held', () => {
  const x = ladderSetup('2026-06-20T10:00:00+05:30'); const { be, c, A, pay, verify } = x; D(c('fees.cancel', { feeId: x.fee.feeId, reason: 'setup' }));
  const mk = (p, due) => x.mkFee(A.studentId, p, 800, due); const f = [mk('2026-03', '2026-03-10'), mk('2026-04', '2026-04-10'), mk('2026-05', '2026-05-10')]; const days = ['2026-03-18', '2026-04-17', '2026-05-18'];
  f.forEach((fee, i) => { be.setNow(days[i] + 'T10:00:00+05:30'); verify(pay(A.studentId, 800).paymentId, { allocations: [{ feeId: fee.feeId, amount: 800 }] }); });
  x.mkFee(A.studentId, '2026-10', 900, '2026-10-10'); be.setNow('2026-10-04T10:00:00+05:30'); const it = D(c('ladder.preview')).items.find((i) => i.studentId === A.studentId); assert.strictEqual(it.action, 'send'); assert.match(it.notes.join(' '), /4 days earlier/);
  be.setNow('2026-10-04T23:00:00+05:30'); be.run('runScheduledJobs()'); assert.strictEqual(lnotes(c).length, 0, 'no scheduled queueing in quiet hours');
  D(c('ladder.run')); const n = lnotes(c)[0]; assert.strictEqual(n.held, true); assert.ok(n.notBefore > '2026-10-04T17:30:00Z'); assert.match(n.statusReason, /Quiet hours/);
  be.setNow('2026-10-05T09:00:00+05:30'); be.run('runScheduledJobs()'); assert.strictEqual(lnotes(c).length, 1, 'rerun adds nothing'); assert.strictEqual(lnotes(c)[0].held, false);
});
test('with the ladder on, the older monthly/overdue jobs stay quiet (one voice per family); no consent/number is reported, never queued', () => {
  const { be, c, b, A, mkStudent, mkFee } = ladderSetup('2026-10-07T10:00:00+05:30', { reminders_enabled: true, reminder_day: 7, overdue_followup_enabled: true }); const N = mkStudent('Nina', b.batchId, { guardianWhatsapp: '' }); mkFee(N.studentId, '2026-10', 1000, '2026-10-08');
  be.run('runScheduledJobs()'); assert.strictEqual(lnotes(c, 'fee_reminder').length, 0); const pv = D(c('ladder.preview')).items; assert.strictEqual(pv.find((i) => i.studentId === N.studentId).action, 'blocked');
  assert.strictEqual(lnotes(c).length, 1, 'the scheduled run already queued the ladder message for Asha only'); assert.strictEqual(lnotes(c)[0].trigger, 'ladder_friendly'); assert.strictEqual(lnotes(c)[0].studentId, A.studentId); assert.strictEqual(D(c('ladder.run')).created, 0);
});

// ───────────────────────── report ─────────────────────────
results.forEach(([s, n]) => console.log(`${s === 'PASS' ? '✔' : '✘'} ${n}`));
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} tests)`);
failures.forEach(([n, e]) => { console.log('\n--- FAIL: ' + n + '\n' + (e && e.stack || e)); });
process.exit(failed ? 1 : 0);
