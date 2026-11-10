/**
 * TuitionDesk backend — Documents.gs : official document snapshots, issuance/versioning/revocation, public verification.
 *
 * The backend builds an authoritative, render-agnostic SNAPSHOT of each document and stores it with a SHA-256 hash.
 * The browser renders the snapshot to an A4/A5 PDF (colour or B/W) and uploads the file for Drive storage.
 *
 * Policy:
 *  - Reprint of unchanged content  -> same verification id and version (documents.issue returns isReprint=true).
 *  - Changed content               -> NEW version (v+1), previous version stays valid but is flagged "not latest".
 *  - Receipts are immutable; correct them by reversing the payment (which revokes the receipt).
 *  - Revoked documents stay in the registry and verify as "revoked".
 * QR / PDF417 carry ONLY the random verification id (128-bit) or a URL containing it — never personal data.
 */
var Documents = (function () {
  var PREFIX = { admission_form: 'ADM', admission_confirmation: 'ACF', id_card: 'IDC', fee_statement: 'FST', fee_reminder: 'FRM', receipt: 'RCP', attendance_summary: 'ATS', report_card: 'RPC', test_report: 'TRP', homework_summary: 'HWS', notice: 'NTC', enquiry_record: 'ENQ', batch_report: 'BTR', financial_summary: 'FIN', no_dues_certificate: 'NDC', leaving_certificate: 'LVC', verification_certificate: 'VCT' };
  var STUDENT_VISIBLE = ['receipt', 'fee_statement', 'fee_reminder', 'attendance_summary', 'report_card', 'admission_confirmation', 'id_card', 'no_dues_certificate', 'leaving_certificate'];

  function kv(title, rows) { return { type: 'kv', title: title || '', rows: rows }; }
  function table(title, columns, rows, foot) { return { type: 'table', title: title || '', columns: columns, rows: rows, footnote: foot || '' }; }
  function text(t, title) { return { type: 'text', title: title || '', text: t }; }
  function base(title, subtitle, blocks) { return { title: title, subtitle: subtitle || '', currency: 'Rs.', blocks: blocks }; }
  function batchNames(sid) { return Students.batchesOf(sid, true).map(function (b) { return b.name; }).join(', ') || '—'; }
  function dateRange(from, to) { return (from || to) ? (from || 'start') + ' to ' + (to || 'today') : 'All records'; }
  function payLabel(m) { return { upi: 'UPI', cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', other: 'Other' }[m] || m; }
  function need(id) { var r = Db.get('DocumentVerification', id); if (!r) throw new ApiError('NOT_FOUND', 'Document not found.'); return r; }
  function stu(id) { return Students.need(id); }

  var BUILD = {
    admission_form: function (p) { var s = stu(p.studentId);
      return { studentId: s.student_id, snap: base('Admission Form', 'Student admission record', [
        kv('Student', [['Student ID', s.student_id], ['Full name', s.full_name], ['Admission date', s.admission_date], ['Batches', batchNames(s.student_id)], ['Status', s.status]]),
        kv('Guardian', [['Name', s.guardian_name || '—'], ['WhatsApp', s.guardian_whatsapp || '—'], ['Email', s.contact_email || '—']]),
        text('I confirm that the details above are correct and I agree to abide by the rules of the tuition centre.', 'Declaration'), { type: 'signatures', labels: ['Guardian signature', 'Teacher signature'] }]) }; },
    admission_confirmation: function (p) { var s = stu(p.studentId);
      return { studentId: s.student_id, snap: base('Admission Confirmation', '', [text('This is to confirm that ' + s.full_name + ' (' + s.student_id + ') has been admitted on ' + s.admission_date + '.'),
        kv('', [['Student ID', s.student_id], ['Name', s.full_name], ['Admission date', s.admission_date], ['Batches', batchNames(s.student_id)]]), { type: 'signatures', labels: ['Teacher signature'] }]) }; },
    id_card: function (p) {
      var ids = p.studentIds && p.studentIds.length ? p.studentIds : (p.batchId ? Batches.roster(Batches.need(p.batchId).batch_id, Util.today()).map(function (r) { return r.studentId; }) : (p.studentId ? [p.studentId] : []));
      if (!ids.length) throw new ApiError('VALIDATION', 'Select at least one student or a batch with students.');
      if (ids.length > 40) throw new ApiError('VALIDATION', 'At most 40 ID cards per sheet.');
      ids = ids.map(function (i) { return V.id(i, 'studentIds'); }).sort();
      var cards = ids.map(function (i) { var s = stu(i); return { studentId: s.student_id, name: s.full_name, batches: batchNames(s.student_id), admissionDate: s.admission_date }; });
      return { studentId: ids.length === 1 ? ids[0] : '', refs: { studentIds: ids }, snap: base('Student ID Cards', '', [{ type: 'cards', cards: cards }]) }; },
    fee_statement: function (p) { var s = stu(p.studentId), st = Fees.statement(s.student_id, false);
      var paid = st.payments.filter(function (x) { return x.status === 'verified'; });
      return { studentId: s.student_id, snap: base('Fee Statement', s.full_name + ' (' + s.student_id + ')', [
        table('Fee obligations', [{ key: 'p', label: 'Period' }, { key: 'd', label: 'Due date' }, { key: 'n', label: 'Net due', f: 'money', a: 'r' }, { key: 'pd', label: 'Paid', f: 'money', a: 'r' }, { key: 'b', label: 'Balance', f: 'money', a: 'r' }, { key: 's', label: 'Status' }],
          st.fees.map(function (f) { return [f.billingPeriod, f.dueDate, f.netDue, f.paid, f.balance, f.status]; })),
        table('Verified payments', [{ key: 'd', label: 'Received' }, { key: 'r', label: 'Receipt' }, { key: 'm', label: 'Method' }, { key: 'a', label: 'Amount', f: 'money', a: 'r' }, { key: 'k', label: 'Type' }],
          paid.map(function (x) { return [x.receivedAt, x.receipt ? x.receipt.receiptNumber : '—', payLabel(x.method), x.amount, x.kind === 'refund' ? 'Refund' : 'Payment']; })),
        kv('Summary', [['Total net due', { m: st.totals.netDue }], ['Total paid', { m: st.totals.paid }], ['Outstanding balance', { m: st.totals.balance }], ['Credit on account', { m: st.creditOnAccount }]]),
        text('Only verified payments reduce the balance. Payments awaiting verification are not included.')]) }; },
    fee_reminder: function (p) { var s = stu(p.studentId), st = Fees.statement(s.student_id, false), out = st.fees.filter(function (f) { return f.balance > 0; });
      if (!out.length) throw new ApiError('CONFLICT', 'This student has no outstanding fees.');
      var pi = Settings.get('upi_id');
      return { studentId: s.student_id, snap: base('Fee Reminder', s.full_name + ' (' + s.student_id + ')', [text('Dear ' + (s.guardian_name || 'Parent/Guardian') + ', the following fees are outstanding. Please arrange payment at the earliest.'),
        table('Outstanding fees', [{ key: 'p', label: 'Period' }, { key: 'd', label: 'Due date' }, { key: 'b', label: 'Balance', f: 'money', a: 'r' }, { key: 's', label: 'Status' }], out.map(function (f) { return [f.billingPeriod, f.dueDate, f.balance, f.status]; })),
        kv('', [['Total outstanding', { m: st.totals.balance }]].concat(pi ? [['Pay via UPI', pi + (Settings.get('upi_payee_name') ? ' (' + Settings.get('upi_payee_name') + ')' : '')]] : [])),
        text(Settings.get('payment_instructions') || 'Payments are recorded only after the Teacher verifies them.')]) }; },
    attendance_summary: function (p) { var s = stu(p.studentId), a = Attendance.summaryFor(s.student_id, p.from || '', p.to || '');
      return { studentId: s.student_id, refs: { studentId: s.student_id, from: p.from || '', to: p.to || '' }, snap: base('Attendance Summary', s.full_name + ' (' + s.student_id + ') — ' + dateRange(p.from, p.to), [
        kv('Totals', [['Present', a.counts.P], ['Absent', a.counts.A], ['Holiday', a.counts.H], ['Attendance', a.percentage === null ? 'n/a' : a.percentage + '%']]), text(a.policy),
        table('Sessions', [{ key: 'd', label: 'Date' }, { key: 'b', label: 'Batch' }, { key: 'l', label: 'Session' }, { key: 's', label: 'Status' }], a.records.slice(0, 250).map(function (r) { return [r.date, r.batchName, r.sessionLabel, { P: 'Present', A: 'Absent', H: 'Holiday' }[r.status]]; }), a.records.length > 250 ? 'Showing latest 250 of ' + a.records.length + ' sessions.' : '')]) }; },
    report_card: function (p) { var s = stu(p.studentId), r = Tests.resultsFor(s.student_id);
      if (!r.length) throw new ApiError('CONFLICT', 'There are no published results for this student.');
      return { studentId: s.student_id, snap: base('Report Card', s.full_name + ' (' + s.student_id + ')', [table('Published results', [{ key: 't', label: 'Test' }, { key: 'd', label: 'Date' }, { key: 'm', label: 'Marks', a: 'r' }, { key: 'p', label: '%', a: 'r' }, { key: 'c', label: 'Remarks' }],
        r.map(function (x) { return [x.title + (x.subject ? ' (' + x.subject + ')' : ''), x.testDate, x.resultStatus === 'entered' ? x.marks + ' / ' + x.maxMarks : { absent: 'Absent', exempt: 'Exempt', not_entered: 'Not entered' }[x.resultStatus], x.percentage === null ? '—' : x.percentage + '%', x.comment || '']; })),
        text('Only results published by the Teacher are included. "Not entered" means marks were not recorded; it is not a zero.')]) }; },
    test_report: function (p) { var t = Tests.need(p.testId); if (t.publication_status !== 'published') throw new ApiError('CONFLICT', 'Publish the test before issuing an official report.');
      var rs = Tests.rows(t), st = Tests.stats(t, rs), b = Db.get('Batches', t.batch_id);
      return { studentId: '', snap: base('Test Report', t.title + ' — ' + (b ? b.name : '') + ' — ' + t.test_date, [
        kv('Summary', [['Maximum marks', t.max_marks], ['Students', st.students], ['Marks entered', st.entered], ['Absent / exempt / not entered', st.absent + ' / ' + st.exempt + ' / ' + st.notEntered], ['Average', st.average === null ? 'n/a' : st.average], ['Highest', st.highest === null ? 'n/a' : st.highest], ['Lowest', st.lowest === null ? 'n/a' : st.lowest]]),
        table('Results', [{ key: 'r', label: 'Rank', a: 'r' }, { key: 'n', label: 'Student' }, { key: 'm', label: 'Marks', a: 'r' }, { key: 'p', label: '%', a: 'r' }, { key: 's', label: 'Status' }],
          rs.slice().sort(function (a, b2) { return (a.rank || 9999) - (b2.rank || 9999) || a.fullName.localeCompare(b2.fullName); }).map(function (r) { return [r.rank === null ? '—' : r.rank, r.fullName, r.marks === null ? '—' : r.marks, r.percentage === null ? '—' : r.percentage + '%', { entered: 'Entered', absent: 'Absent', exempt: 'Exempt', not_entered: 'Not entered' }[r.resultStatus]]; })),
        text('Ranking: competition ranking (ties share a rank, next rank is skipped). Only entered marks are ranked.')]) }; },
    homework_summary: function (p) {
      var refs = p.studentId ? { studentId: Students.need(p.studentId).student_id } : { batchId: Batches.need(p.batchId).batch_id }, from = p.from || '', to = p.to || '';
      var rows = Db.filter('Homework', function (h) { return h.status === 'active' && h.publication_status === 'published' && (refs.studentId ? (h.student_id === refs.studentId || Students.batchesOf(refs.studentId, false).some(function (b) { return b.batchId === h.batch_id; })) : h.batch_id === refs.batchId) && (!from || h.assigned_date >= from) && (!to || h.assigned_date <= to); }).sort(function (a, b) { return a.assigned_date < b.assigned_date ? -1 : 1; });
      return { studentId: refs.studentId || '', refs: Object.assign(refs, { from: from, to: to }), snap: base('Homework Summary', dateRange(from, to), [table('Homework', [{ key: 'a', label: 'Assigned' }, { key: 'd', label: 'Due' }, { key: 't', label: 'Title' }, { key: 's', label: 'Subject' }], rows.map(function (h) { return [h.assigned_date, h.due_date, h.title, h.subject]; }))]) }; },
    notice: function (p) { var n = Notices.need(p.noticeId); if (n.status !== 'published') throw new ApiError('CONFLICT', 'Publish the notice first.'); var v = Notices.view(n);
      return { studentId: n.audience_type === 'student' ? n.student_id : '', snap: base(n.title, 'Notice / Circular — ' + (n.audience_type === 'all' ? 'All students' : n.audience_type === 'batch' ? v.batchName : v.studentName), [text(n.body)]) }; },
    enquiry_record: function (p) { var e = Db.get('Enquiries', V.id(p.enquiryId, 'enquiryId')); if (!e) throw new ApiError('NOT_FOUND', 'Enquiry not found.');
      var f = Db.filter('EnquiryFollowups', function (x) { return x.enquiry_id === e.enquiry_id; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }), adm = Db.find('Admissions', function (a) { return a.enquiry_id === e.enquiry_id; });
      return { studentId: '', snap: base('Enquiry / Admission Record', e.name, [kv('Enquiry', [['Date', e.enquiry_date], ['Name', e.name], ['Guardian', e.guardian_name || '—'], ['Phone', e.phone || '—'], ['Requested subject', e.requested_subject || '—'], ['Source', e.source || '—'], ['Status', e.status]]),
        table('Follow-ups', [{ key: 'd', label: 'Date' }, { key: 'n', label: 'Note' }, { key: 'a', label: 'Next action' }], f.map(function (x) { return [x.created_at.slice(0, 10), x.note, x.next_action || '']; })),
        kv('Admission', adm ? [['Student ID', adm.student_id], ['Admission date', adm.admission_date], ['Status', adm.status]] : [['Admission', 'Not admitted']])]) }; },
    batch_report: function (p) { var b = Batches.need(p.batchId), from = p.from || '', to = p.to || '', ro = Batches.roster(b.batch_id, Util.today());
      var rows = ro.map(function (r) { var a = Attendance.summaryFor(r.studentId, from, to), bal = Ledger.totals(Ledger.fees(r.studentId)).balance; return [r.studentId, r.fullName, a.percentage === null ? 'n/a' : a.percentage + '%', bal]; });
      return { studentId: '', refs: { batchId: b.batch_id, from: from, to: to }, snap: base('Batch Report', b.name + ' — ' + dateRange(from, to), [kv('Batch', [['Subject', b.subject || '—'], ['Capacity', b.capacity || 'not set'], ['Active students', ro.length]]),
        table('Students', [{ key: 'i', label: 'ID' }, { key: 'n', label: 'Name' }, { key: 'a', label: 'Attendance', a: 'r' }, { key: 'o', label: 'Outstanding', f: 'money', a: 'r' }], rows), text('Attendance % = Present / (Present + Absent); holidays excluded.')]) }; },
    financial_summary: function (p) { var from = V.date(p.from, 'from', { required: true }), to = V.date(p.to, 'to', { required: true }); if (to < from) V.fail('to', 'must not be before from');
      var m = Dashboard.collections(from, to), t = Ledger.totals(Ledger.fees());
      return { studentId: '', refs: { from: from, to: to }, snap: base('Financial Summary', from + ' to ' + to, [kv('Verified collections', [['Gross payments', { m: m.gross }], ['Refunds', { m: m.refunds }], ['Net collections', { m: m.net }]]),
        table('By method', [{ key: 'm', label: 'Method' }, { key: 'a', label: 'Net amount', f: 'money', a: 'r' }], Object.keys(m.byMethod).sort().map(function (k) { return [payLabel(k), m.byMethod[k]]; })),
        kv('Outstanding (all periods, as of issue)', [['Total outstanding', { m: t.balance }], ['Overdue', { m: t.overdue }]]), text('Only verified payments are counted as collected.')]) }; },
    no_dues_certificate: function (p) { var s = stu(p.studentId), fees = Ledger.fees(s.student_id).filter(function (v) { return v.recordStatus === 'active'; }), owing = fees.filter(function (v) { return v.balance > 0; });
      var pend = Db.filter('Payments', function (x) { return x.student_id === s.student_id && x.kind === 'payment' && x.verification_status === 'pending'; });
      if (owing.length) throw new ApiError('CONFLICT', 'A No-Dues Certificate can only be issued when the balance is zero. Outstanding: ' + owing.map(function (v) { return v.billingPeriod + ' (' + v.balance.toFixed(2) + ')'; }).join(', ') + '.', { outstanding: owing.map(function (v) { return { period: v.billingPeriod, balance: v.balance }; }) });
      if (pend.length) throw new ApiError('CONFLICT', 'A payment for this student is recorded but not verified yet. Verify it first, then issue the certificate.');
      var t = Ledger.totals(fees);
      return { studentId: s.student_id, refs: { studentId: s.student_id }, snap: base('No-Dues Certificate', s.full_name + ' (' + s.student_id + ')', [
        text('This is to certify that ' + s.full_name + ' (' + s.student_id + '), admitted on ' + (s.admission_date || '—') + ', has no outstanding fees with this centre as on ' + Util.today() + '.'),
        kv('Fee position as on ' + Util.today(), [['Total fees charged', { m: t.netDue }], ['Total paid (verified)', { m: t.paid }], ['Outstanding', { m: 0 }]]),
        text('Only payments verified by the Teacher are counted. This certificate reflects records on the date of issue.'), { type: 'signatures', labels: ['Teacher signature'] }]) }; },
    leaving_certificate: function (p) { var s = stu(p.studentId);
      if (s.status !== 'left') throw new ApiError('CONFLICT', 'A Leaving Certificate can only be issued after the student has been marked as left.');
      var t = Ledger.totals(Ledger.fees(s.student_id).filter(function (v) { return v.recordStatus === 'active'; })), clear = t.balance <= 0;
      return { studentId: s.student_id, refs: { studentId: s.student_id }, snap: base('Leaving Certificate', s.full_name + ' (' + s.student_id + ')', [
        text('This is to certify that ' + s.full_name + ' (' + s.student_id + ') was a student of this centre from ' + (s.admission_date || '—') + ' to ' + (s.leaving_date || '—') + '.'),
        kv('Details', [['Student ID', s.student_id], ['Name', s.full_name], ['Guardian', s.guardian_name || '—'], ['Admission date', s.admission_date || '—'], ['Leaving date', s.leaving_date || '—'], ['Reason', s.leaving_reason || '—'], ['Batches', batchNames(s.student_id)], ['Fee dues at leaving', clear ? 'Cleared' : 'Outstanding']]),
        { type: 'signatures', labels: ['Teacher signature'] }]) }; },
    verification_certificate: function (p) { var r = need(V.id(p.targetVerificationId, 'targetVerificationId'));
      return { studentId: '', refs: { targetVerificationId: r.verification_id }, snap: base('Verification Certificate', '', [text('This certifies that the document below was issued by ' + Settings.get('centre_name') + ' and was ' + (r.status === 'valid' ? 'valid' : 'revoked') + ' at the time this certificate was issued.'),
        kv('', [['Document type', DOC_TYPES[r.doc_type] || r.doc_type], ['Document number', r.document_number], ['Version', r.version], ['Issued on', r.issued_at.slice(0, 10)], ['Status', r.status]])]) }; }
  };

  function refKey(refs) { return Util.canon(refs); }
  function latestOf(type, rk) {
    var rows = Db.filter('DocumentVerification', function (r) { return r.doc_type === type && r.record_ref === rk; }); rows.sort(function (a, b) { return b.version - a.version; }); return rows[0] || null;
  }
  function meta(r) {
    var latest = latestOf(r.doc_type, r.record_ref);
    return { verificationId: r.verification_id, documentNumber: r.document_number, docType: r.doc_type, docTypeLabel: DOC_TYPES[r.doc_type] || r.doc_type, version: r.version, isLatest: !!latest && latest.verification_id === r.verification_id, studentId: r.student_id, issuedAt: r.issued_at, issuedBy: r.issued_by, status: r.status, revokedAt: r.revoked_at, revokeReason: r.revoke_reason, fileId: r.file_id, fileName: r.file_name, hasFile: !!r.file_id };
  }
  function create(ctx, type, refs, studentId, snap, fixedNumber) {
    var rk = refKey(refs), hash = Util.sha256Hex(Util.canon(snap)), latest = latestOf(type, rk);
    if (latest && latest.status === 'valid' && latest.content_hash === hash) return { record: latest, isReprint: true };
    var version = latest ? latest.version + 1 : 1, base = fixedNumber || (latest ? latest.document_number.replace(/-v\d+$/, '') : Db.nextSeq('DocumentVerification', 'document_number', PREFIX[type] + '-' + Util.today().slice(0, 4) + '-', 5));
    var number = version > 1 ? base + '-v' + version : base;
    var rec = Db.insert('DocumentVerification', { verification_id: Util.uuid(), document_number: number, doc_type: type, version: version, supersedes: latest ? latest.verification_id : '', record_ref: rk, student_id: studentId || '', issued_at: Util.nowIso(), issued_by: ctx.session ? ctx.session.userId : 'system',
      status: 'valid', revoked_at: '', revoked_by: '', revoke_reason: '', file_id: '', file_name: '', content_hash: hash, snapshot_json: JSON.stringify(snap) });
    Audit.log(ctx, version > 1 ? 'document.reissue' : 'document.issue', 'document', rec.verification_id, { type: type, number: number, version: version, supersedes: rec.supersedes });
    return { record: rec, isReprint: false };
  }

  return {
    types: function () { return Object.keys(DOC_TYPES).map(function (k) { return { type: k, label: DOC_TYPES[k], issuable: k !== 'receipt' }; }); },
    renderConfig: function () {
      return { centreName: Settings.requireCentreName(), teacherName: Settings.get('show_teacher_name') ? Settings.get('teacher_name') : '', centrePhone: Settings.get('centre_phone'), centreAddress: Settings.get('centre_address'), watermark: { enabled: Settings.get('watermark_enabled'), text: Settings.get('watermark_text') || Settings.get('centre_name'), position: Settings.get('watermark_position'), size: Settings.get('watermark_size'), opacity: Settings.get('watermark_opacity') },
        pageSize: Settings.get('pdf_page_size'), colorMode: Settings.get('pdf_color_mode'), publicBaseUrl: Settings.get('public_base_url') };
    },
    createReceiptRecord: function (ctx, pay, student, receiptNumber) {
      var allocs = Db.filter('PaymentAllocations', function (a) { return a.payment_id === pay.payment_id; }), feeMap = {}; Db.all('Fees').forEach(function (f) { feeMap[f.fee_id] = f; });
      var bal = Ledger.totals(Ledger.fees(pay.student_id)).balance, ref = pay.provider_reference ? '••••' + pay.provider_reference.slice(-4) : '—';
      var snap = base('Payment Receipt', 'Receipt ' + receiptNumber, [kv('', [['Receipt number', receiptNumber], ['Student', student.full_name + ' (' + student.student_id + ')'], ['Amount received', { m: pay.amount }], ['Method', payLabel(pay.method)], ['Reference', ref], ['Received on', pay.received_at], ['Verified', 'Yes — ' + (pay.verification_method === 'provider_callback' ? 'payment provider confirmation' : 'Teacher reconciliation')]]),
        table('Applied to', [{ key: 'p', label: 'Fee period' }, { key: 'a', label: 'Amount', f: 'money', a: 'r' }], allocs.map(function (a) { return [feeMap[a.fee_id] ? feeMap[a.fee_id].billing_period : '', a.amount]; })),
        kv('', [['Balance remaining after this payment', { m: bal }]])]);
      return create(ctx, 'receipt', { paymentId: pay.payment_id }, pay.student_id, snap, receiptNumber).record;
    },
    /** Latest valid receipt record for a payment (or null). */
    receiptFor: function (paymentId) { var r = latestOf('receipt', refKey({ paymentId: paymentId })); return r && r.status === 'valid' ? r : null; },
    issue: function (ctx, p) {
      var type = V.oneOf(p.type, 'type', Object.keys(DOC_TYPES), { required: true }); if (type === 'receipt') throw new ApiError('VALIDATION', 'Receipts are issued automatically when a payment is verified. Use reprint.');
      Settings.requireCentreName();
      var b = BUILD[type](p), refs = b.refs || (function () { var r = {}; ['studentId', 'testId', 'noticeId', 'enquiryId', 'batchId'].forEach(function (k) { if (p[k]) r[k] = p[k]; }); return r; })();
      var res = create(ctx, type, refs, b.studentId, b.snap);
      return { meta: meta(res.record), snapshot: b.snap, isReprint: res.isReprint, render: Documents.renderConfig() };
    },
    reissue: function (ctx, p) {
      var r = need(V.id(p.verificationId, 'verificationId')), reason = V.str(p.reason, 'reason', { required: true, min: 5, max: 200 });
      if (r.doc_type === 'receipt') throw new ApiError('CONFLICT', 'Receipts cannot be reissued. Reverse the payment and record it again if a correction is needed.');
      if (r.status === 'revoked') throw new ApiError('CONFLICT', 'This document is revoked.');
      var refs = JSON.parse(r.record_ref), b = BUILD[r.doc_type](Object.assign({}, refs, { type: r.doc_type })), res = create(ctx, r.doc_type, JSON.parse(r.record_ref), b.studentId, b.snap);
      if (res.isReprint) throw new ApiError('CONFLICT', 'Nothing has changed since this version was issued.');
      Audit.log(ctx, 'document.reissue_reason', 'document', res.record.verification_id, { reason: reason });
      return { meta: meta(res.record), snapshot: b.snap, isReprint: false, render: Documents.renderConfig() };
    },
    /** Reprint exactly what was issued (original snapshot, same id/version). */
    get: function (ctx, p) {
      var r = need(V.id(p.verificationId, 'verificationId'));
      return { meta: meta(r), snapshot: JSON.parse(r.snapshot_json), render: Documents.renderConfig() };
    },
    getForStudent: function (studentId, id) {
      var r = Db.get('DocumentVerification', V.id(id, 'verificationId'));
      if (!r || r.student_id !== studentId || STUDENT_VISIBLE.indexOf(r.doc_type) < 0) throw new ApiError('NOT_FOUND', 'Document not found.'); // same error for "not yours" and "missing"
      if (r.status === 'revoked') throw new ApiError('CONFLICT', 'This document has been revoked.');
      return { meta: meta(r), snapshot: JSON.parse(r.snapshot_json), render: Documents.renderConfig() };
    },
    listForStudent: function (studentId) {
      return Db.filter('DocumentVerification', function (r) { return r.student_id === studentId && STUDENT_VISIBLE.indexOf(r.doc_type) >= 0 && r.status === 'valid'; }).sort(function (a, b) { return a.issued_at < b.issued_at ? 1 : -1; }).map(function (r) { var m = meta(r); return { verificationId: m.verificationId, docTypeLabel: m.docTypeLabel, documentNumber: m.documentNumber, version: m.version, issuedAt: m.issuedAt }; });
    },
    list: function (ctx, p) {
      var sn = {}; Db.all('Students').forEach(function (s) { sn[s.student_id] = s.full_name; });
      var rows = Db.filter('DocumentVerification', function (r) { return (!p.docType || r.doc_type === p.docType) && (!p.studentId || r.student_id === p.studentId) && (!p.status || r.status === p.status); })
        .sort(function (a, b) { return a.issued_at < b.issued_at ? 1 : -1; }).map(function (r) { var m = meta(r); m.studentName = sn[r.student_id] || ''; return m; });
      var q = (p.search || '').toLowerCase(); if (q) rows = rows.filter(function (m) { return (m.documentNumber + ' ' + m.studentName + ' ' + m.docTypeLabel).toLowerCase().indexOf(q) >= 0; });
      return Util.paginate(rows, p);
    },
    history: function (ctx, p) {
      var r = need(V.id(p.verificationId, 'verificationId')), chain = []; var cur = r;
      Db.filter('DocumentVerification', function (x) { return x.doc_type === r.doc_type && x.record_ref === r.record_ref; }).sort(function (a, b) { return a.version - b.version; }).forEach(function (x) { chain.push(meta(x)); });
      var ids = {}; chain.forEach(function (c) { ids[c.verificationId] = 1; });
      return { versions: chain, audit: Db.filter('AuditLogs', function (a) { return a.entity_type === 'document' && ids[a.entity_id]; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; }).map(function (a) { return { at: a.at, action: a.action, actor: a.actor_user_id, details: a.details }; }) };
    },
    revokeInternal: function (ctx, id, reason) {
      var r = need(id); if (r.status === 'revoked') return r;
      var u = Db.update('DocumentVerification', id, { status: 'revoked', revoked_at: Util.nowIso(), revoked_by: ctx.session ? ctx.session.userId : 'system', revoke_reason: reason });
      Audit.log(ctx, 'document.revoke', 'document', id, { reason: reason, number: r.document_number }); return u;
    },
    revoke: function (ctx, p) {
      var r = need(V.id(p.verificationId, 'verificationId')), reason = V.str(p.reason, 'reason', { required: true, min: 5, max: 200 });
      if (p.confirm !== true) throw new ApiError('NEEDS_CONFIRMATION', 'Confirm that you want to revoke this document.');
      if (r.status === 'revoked') throw new ApiError('CONFLICT', 'Already revoked.');
      if (r.doc_type === 'receipt') throw new ApiError('CONFLICT', 'Receipts are revoked by reversing the payment.');
      return meta(Documents.revokeInternal(ctx, r.verification_id, reason));
    },
    attachFile: function (ctx, p) {
      var r = need(V.id(p.verificationId, 'verificationId')), b64 = V.str(p.base64, 'base64', { required: true, max: 3500000 });
      var bytes = Utilities.base64Decode(b64); if (!bytes || bytes.length < 100 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') throw new ApiError('VALIDATION', 'File must be a PDF.');
      var folderId = Props.get('DOCS_FOLDER_ID'); if (!folderId) throw new ApiError('NOT_CONFIGURED', 'Documents folder is not configured (run setupDatabase()).');
      var name = r.document_number.replace(/[^A-Za-z0-9\-_]/g, '_') + '_v' + r.version + '.pdf';
      var f = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes, 'application/pdf', name));
      Db.update('DocumentVerification', r.verification_id, { file_id: f.getId(), file_name: name });
      Audit.log(ctx, 'document.file_stored', 'document', r.verification_id, { name: name }); return { stored: true, fileName: name };
    },
    /** PUBLIC verification: minimal metadata only. Unknown, malformed and missing ids all return the same shape. */
    check: function (id) {
      var k = 'vchk_' + Math.floor(Util.now().getTime() / 60000), n = 0;
      try { n = parseInt(CacheService.getScriptCache().get(k) || '0', 10); if (n >= TD.VERIFY_MAX_PER_MINUTE) throw new ApiError('RATE_LIMITED', 'Too many verification requests. Please retry shortly.'); CacheService.getScriptCache().put(k, String(n + 1), 90); } catch (e) { if (e instanceof ApiError) throw e; }
      var out = { status: 'invalid', centreName: '', docType: '', issueDate: '', version: null, isLatest: null };
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) return out;
      var r = Db.get('DocumentVerification', id); if (!r) return out;
      var m = meta(r);
      out = { status: r.status === 'revoked' ? 'revoked' : 'valid', centreName: Settings.get('centre_name'), docType: m.docTypeLabel, issueDate: Utilities.formatDate(new Date(r.issued_at), Util.tz(), 'yyyy-MM-dd'), version: r.version, isLatest: m.isLatest };
      if (Settings.get('verify_show_document_number')) out.documentNumber = r.document_number;
      return out;
    }
  };
})();
