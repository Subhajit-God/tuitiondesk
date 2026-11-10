/**
 * TuitionDesk backend — Export.gs : read-only data export so the Teacher is never locked in.
 * export.get returns one page of a dataset as plain rows; the browser assembles CSV / Excel files.
 * Pages (not truncation) are used so a large centre is never silently cut short. Every export is audited (dataset and row count only).
 */
var Exporter = (function () {
  var PAGE = 1000;
  function nameMap() { var m = {}; Db.all('Students').forEach(function (s) { m[s.student_id] = s.full_name; }); return m; }
  function batchMap() { var m = {}; Db.all('Batches').forEach(function (b) { m[b.batch_id] = b.name; }); return m; }

  var DATASETS = {
    students: {
      label: 'Students',
      columns: ['Student ID', 'Full name', 'Status', 'Admission date', 'Guardian name', 'Guardian WhatsApp', 'WhatsApp consent', 'Email', 'Current batches', 'Username', 'Login status', 'Notes'],
      build: function () {
        return Db.all('Students').sort(function (a, b) { return a.student_id < b.student_id ? -1 : 1; }).map(function (s) {
          var v = Students.teacherView(s);
          return [s.student_id, s.full_name, s.status, s.admission_date, s.guardian_name, s.guardian_whatsapp, s.whatsapp_consent, s.contact_email, v.batches.map(function (b) { return b.name; }).join('; '), v.username, v.accountStatus, s.notes];
        });
      }
    },
    fees: {
      label: 'Fees',
      columns: ['Fee ID', 'Student ID', 'Student', 'Billing period', 'Due date', 'Amount due', 'Adjustments', 'Net due', 'Paid (verified)', 'Balance', 'Status', 'Days overdue', 'Record status', 'Note'],
      build: function (p) {
        var nm = nameMap();
        return Ledger.fees(null).filter(function (f) { return (!p.from || f.dueDate >= p.from) && (!p.to || f.dueDate <= p.to); })
          .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.studentId < b.studentId ? -1 : 1; })
          .map(function (f) { return [f.feeId, f.studentId, nm[f.studentId] || '', f.billingPeriod, f.dueDate, f.amountDue, f.adjustments, f.netDue, f.paid, f.balance, f.status, f.overdueDays, f.recordStatus, f.note]; });
      }
    },
    payments: {
      label: 'Payments',
      columns: ['Payment ID', 'Student ID', 'Student', 'Type', 'Amount', 'Method', 'Reference', 'Received on', 'Status', 'Verified at', 'Verified by', 'Verification method', 'Receipt no.', 'Source', 'Notes'],
      build: function (p) {
        var nm = nameMap(), rc = {}; Db.all('Receipts').forEach(function (r) { if (r.status === 'valid') rc[r.payment_id] = r.receipt_number; });
        return Db.all('Payments').filter(function (x) { return (!p.from || x.received_at >= p.from) && (!p.to || x.received_at <= p.to); })
          .sort(function (a, b) { return a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.payment_id < b.payment_id ? -1 : 1; })
          .map(function (x) { return [x.payment_id, x.student_id, nm[x.student_id] || '', x.kind, x.amount, x.method, x.provider_reference, x.received_at, x.verification_status, x.verified_at, x.verified_by, x.verification_method, rc[x.payment_id] || '', x.source, x.notes]; });
      }
    },
    attendance: {
      label: 'Attendance',
      columns: ['Date', 'Batch', 'Session', 'Student ID', 'Student', 'Status (P/A/H)', 'Correction reason', 'Saved at', 'Session ID'],
      build: function (p) {
        var nm = nameMap(), bm = batchMap(), sessions = {};
        Db.all('AttendanceSessions').forEach(function (s) { if ((!p.from || s.session_date >= p.from) && (!p.to || s.session_date <= p.to)) sessions[s.session_id] = s; });
        return Db.all('AttendanceEntries').filter(function (e) { return sessions[e.session_id]; }).map(function (e) { var s = sessions[e.session_id]; return { s: s, e: e }; })
          .sort(function (a, b) { return a.s.session_date < b.s.session_date ? -1 : a.s.session_date > b.s.session_date ? 1 : (a.s.session_id + a.e.student_id) < (b.s.session_id + b.e.student_id) ? -1 : 1; })
          .map(function (r) { return [r.s.session_date, bm[r.s.batch_id] || '', r.s.session_label, r.e.student_id, nm[r.e.student_id] || '', r.e.status, r.e.correction_reason, r.s.saved_at, r.s.session_id]; });
      }
    }
  };

  return {
    get: function (ctx, p) {
      var key = V.oneOf(p.dataset, 'dataset', Object.keys(DATASETS), { required: true }), d = DATASETS[key];
      var from = p.from ? V.date(p.from, 'from') : '', to = p.to ? V.date(p.to, 'to') : '';
      if (from && to && to < from) V.fail('to', 'must not be before from');
      var rows = d.build({ from: from, to: to }), page = Math.max(parseInt(p.page, 10) || 1, 1), pages = Math.max(Math.ceil(rows.length / PAGE), 1);
      if (page === 1) Audit.log(ctx, 'export.run', 'export', key, { dataset: key, rows: rows.length, from: from, to: to });
      return { dataset: key, label: d.label, columns: d.columns, rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length, page: page, pages: pages, generatedAt: Util.nowIso(), centreName: Settings.get('centre_name') };
    }
  };
})();
