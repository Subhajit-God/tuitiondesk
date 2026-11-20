/** TuitionDesk backend — Today.gs : the Today screen. Reads only; every item says what to do and links to where. */
var Today = (function () {
  function sname(id) { var s = Db.get('Students', id); return s ? s.full_name : ''; }
  return {
    get: function (ctx) {
      var today = Util.today(), sess = Db.filter('AttendanceSessions', function (s) { return s.session_date === today; }), ent = Util.groupBy(Db.all('AttendanceEntries'), 'session_id'), bm = {}; Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b; });
      var classes = Timetable.expandRange(today, today).map(function (c) {
        var ss = sess.filter(function (s) { return s.batch_id === c.batchId; }), taken = ss.length > 0, cn = { P: 0, A: 0, H: 0 }; ss.forEach(function (s) { (ent[s.session_id] || []).forEach(function (e) { cn[e.status]++; }); });
        c.attendanceTaken = taken; c.counts = taken ? cn : null; return c;
      });
      var absentees = [];
      sess.forEach(function (s) { (ent[s.session_id] || []).forEach(function (e) {
        if (e.status !== 'A') return; var st = Db.get('Students', e.student_id), n = Db.find('Notifications', function (x) { return x.idempotency_key === 'absence:' + s.session_id + ':' + e.student_id; });
        absentees.push({ studentId: e.student_id, studentName: st ? st.full_name : '', batchName: bm[s.batch_id] ? bm[s.batch_id].name : '', guardianPhone: st ? st.guardian_whatsapp : '', message: n ? (n.status === 'manually_sent' || n.status === 'sent' ? 'sent' : n.status === 'pending_manual' ? 'waiting' : n.status) : 'none', notificationId: n ? n.notification_id : '' });
      }); });
      var pend = Db.filter('Payments', function (p) { return p.kind === 'payment' && p.verification_status === 'pending'; }).map(function (p) { return { paymentId: p.payment_id, studentId: p.student_id, studentName: sname(p.student_id), amount: p.amount, method: p.method, reference: p.provider_reference, receivedAt: p.received_at }; });
      var reported = Ladder.status().reported.filter(function (r) { return Util.diffDays(today, r.at.slice(0, 10)) < PayLinks.REPORT_HOLD_DAYS + 4; });
      var msgs = Db.filter('Notifications', function (n) { return n.status === 'pending_manual'; });
      var calls = Ladder.status().needsCall, enq = Enquiries.due(), bk = Backup.health();
      return { date: today, centreName: Settings.get('centre_name'), classes: classes, absentees: absentees, pendingVerifications: pend, parentsSaidPaid: reported,
        messagesWaiting: { count: msgs.length, heldCount: msgs.filter(function (n) { return n.not_before && n.not_before > Util.nowIso(); }).length }, needsCall: calls, enquiriesDue: enq, backup: bk,
        counts: { classes: classes.length, classesNotMarked: classes.filter(function (c) { return c.type !== 'cancelled' && c.type !== 'cancellation' && !c.attendanceTaken; }).length, absentees: absentees.length, verifications: pend.length + reported.length, messages: msgs.length, calls: calls.length, enquiries: enq.length } };
    }
  };
})();
