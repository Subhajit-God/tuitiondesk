/**
 * TuitionDesk backend — Academics.gs : attendance, tests/results, homework, timetable.
 *
 * Attendance policy: statuses P (present), A (absent), H (holiday). Percentage = P / (P + A) x 100.
 * Holidays (H) are EXCLUDED from the denominator; there is no separate "excused" status — mark an excused
 * session as H only if the centre treats it as a non-counting day. Percentage is null when P + A = 0.
 *
 * Ranking policy: standard competition ranking ("1,2,2,4") on ENTERED marks only; absent / exempt /
 * not-entered students are unranked. Missing marks are never treated as zero.
 */
var Attendance = (function () {
  function names() { var m = {}; Db.all('Students').forEach(function (s) { m[s.student_id] = s.full_name; }); return m; }
  function labels() { return Settings.get('session_labels').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function counts(entries) { var c = { P: 0, A: 0, H: 0 }; entries.forEach(function (e) { c[e.status]++; }); return c; }
  function pct(c) { return c.P + c.A === 0 ? null : Math.round(c.P / (c.P + c.A) * 1000) / 10; }

  return {
    pct: pct, counts: counts,
    roster: function (ctx, p) {
      var b = Batches.need(p.batchId), date = V.date(p.date, 'date', { required: true });
      var sessions = Db.filter('AttendanceSessions', function (s) { return s.batch_id === b.batch_id && s.session_date === date; }).map(function (s) { return { sessionId: s.session_id, sessionLabel: s.session_label }; });
      return { batch: { batchId: b.batch_id, name: b.name, status: b.status }, date: date, roster: Batches.roster(b.batch_id, date), existingSessions: sessions, sessionLabels: labels() };
    },
    save: function (ctx, p) {
      var b = Batches.need(p.batchId), date = V.date(p.date, 'date', { required: true });
      if (date > Util.today()) V.fail('date', 'cannot be in the future');
      if (b.status !== 'active') throw new ApiError('CONFLICT', 'Batch is inactive.');
      var label = V.str(p.sessionLabel || labels()[0] || 'Regular', 'sessionLabel', { required: true, max: 30 });
      var key = V.str(p.idempotencyKey, 'idempotencyKey', { required: true, max: 80 });
      var dup = Db.find('AttendanceSessions', function (s) { return s.batch_id === b.batch_id && s.session_date === date && s.session_label.toLowerCase() === label.toLowerCase(); });
      if (dup) {
        if (dup.idempotency_key === key) return { sessionId: dup.session_id, duplicateRequest: true, counts: counts(Db.filter('AttendanceEntries', function (e) { return e.session_id === dup.session_id; })) };
        throw new ApiError('DUPLICATE_SESSION', 'Attendance for this batch, date and session was already saved. Open it and use a correction instead.', { sessionId: dup.session_id });
      }
      var roster = Batches.roster(b.batch_id, date), want = {}; roster.forEach(function (r) { want[r.studentId] = 1; });
      if (!Array.isArray(p.entries) || !p.entries.length) V.fail('entries', 'are required');
      var seen = {}, entries = p.entries.map(function (e) {
        var sid = V.id(e.studentId, 'entries.studentId'); if (!want[sid]) throw new ApiError('VALIDATION', 'Student ' + sid + ' is not on this batch roster.');
        if (seen[sid]) V.fail('entries', 'contains a student twice'); seen[sid] = 1;
        return { studentId: sid, status: V.oneOf(e.status, 'entries.status', ['P', 'A', 'H'], { required: true }) };
      });
      if (entries.length !== roster.length) throw new ApiError('VALIDATION', 'Every student on the roster must be marked (' + entries.length + ' of ' + roster.length + ' marked).');
      var s = Db.insert('AttendanceSessions', { session_id: Util.newId('ses'), batch_id: b.batch_id, session_date: date, session_label: label, created_by: ctx.session.userId, saved_at: Util.nowIso(), idempotency_key: key });
      entries.forEach(function (e) { Db.insert('AttendanceEntries', { attendance_id: Util.newId('att'), session_id: s.session_id, student_id: e.studentId, status: e.status, correction_reason: '', updated_by: ctx.session.userId, updated_at: Util.nowIso() }); });
      Audit.log(ctx, 'attendance.save', 'attendance_session', s.session_id, { batchId: b.batch_id, date: date, label: label, counts: counts(entries.map(function (e) { return { status: e.status }; })) });
      // Absence alerts are created ONLY after the attendance rows above were written successfully.
      var notif = { queued: 0, error: null };
      try { notif.queued = Notifications.queueAbsences(ctx, s, b, entries.filter(function (e) { return e.status === 'A'; }), !!p._forceAlerts); }
      catch (err) { notif.error = 'Attendance saved, but absence alerts could not be queued: ' + (err.message || 'error'); }
      return { sessionId: s.session_id, savedAt: s.saved_at, counts: counts(entries.map(function (e) { return { status: e.status }; })), notifications: notif };
    },
    /** Tap-to-mark: everyone is Present except the ids in absentIds. Absent guardians get a prepared message (queue only; the Teacher sends it). */
    saveAbsentees: function (ctx, p) {
      var b = Batches.need(p.batchId), date = V.date(p.date, 'date', { required: true }), ab = Array.isArray(p.absentIds) ? p.absentIds : [], hol = Array.isArray(p.holidayIds) ? p.holidayIds : [];
      var entries = Batches.roster(b.batch_id, date).map(function (r) { return { studentId: r.studentId, status: ab.indexOf(r.studentId) >= 0 ? 'A' : hol.indexOf(r.studentId) >= 0 ? 'H' : 'P' }; });
      if (!entries.length) throw new ApiError('CONFLICT', 'This batch has no students on that date.');
      var known = {}; entries.forEach(function (e) { known[e.studentId] = 1; }); ab.concat(hol).forEach(function (id) { if (!known[id]) throw new ApiError('VALIDATION', 'Student ' + id + ' is not on this batch roster.'); });
      var r = Attendance.save(ctx, { batchId: b.batch_id, date: date, sessionLabel: p.sessionLabel, idempotencyKey: p.idempotencyKey, entries: entries, _forceAlerts: true });
      r.absent = ab.length; return r;
    },
    sessions: function (ctx, p) {
      var bm = {}; Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b.name; });
      var ent = Util.groupBy(Db.all('AttendanceEntries'), 'session_id');
      var rows = Db.filter('AttendanceSessions', function (s) { return (!p.batchId || s.batch_id === p.batchId) && (!p.from || s.session_date >= p.from) && (!p.to || s.session_date <= p.to); })
        .sort(function (a, b) { return a.session_date < b.session_date ? 1 : a.session_date > b.session_date ? -1 : 0; })
        .map(function (s) { return { sessionId: s.session_id, batchId: s.batch_id, batchName: bm[s.batch_id] || '', date: s.session_date, sessionLabel: s.session_label, savedAt: s.saved_at, counts: counts(ent[s.session_id] || []) }; });
      return Util.paginate(rows, p);
    },
    session: function (ctx, p) {
      var s = Db.get('AttendanceSessions', V.id(p.sessionId, 'sessionId')); if (!s) throw new ApiError('NOT_FOUND', 'Session not found.');
      var nm = names(), b = Db.get('Batches', s.batch_id);
      var entries = Db.filter('AttendanceEntries', function (e) { return e.session_id === s.session_id; }).map(function (e) { return { attendanceId: e.attendance_id, studentId: e.student_id, fullName: nm[e.student_id] || '', status: e.status, correctionReason: e.correction_reason }; }).sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
      return { sessionId: s.session_id, batchId: s.batch_id, batchName: b ? b.name : '', date: s.session_date, sessionLabel: s.session_label, entries: entries, counts: counts(entries) };
    },
    correct: function (ctx, p) {
      var e = Db.get('AttendanceEntries', V.id(p.attendanceId, 'attendanceId')); if (!e) throw new ApiError('NOT_FOUND', 'Attendance entry not found.');
      var st = V.oneOf(p.status, 'status', ['P', 'A', 'H'], { required: true }), reason = V.str(p.reason, 'reason', { required: true, min: 5, max: 200 });
      if (st === e.status) throw new ApiError('CONFLICT', 'The entry already has that status.');
      Db.update('AttendanceEntries', e.attendance_id, { status: st, correction_reason: reason, updated_by: ctx.session.userId, updated_at: Util.nowIso() });
      Audit.log(ctx, 'attendance.correct', 'attendance_entry', e.attendance_id, { sessionId: e.session_id, studentId: e.student_id, from: e.status, to: st, reason: reason });
      return { attendanceId: e.attendance_id, status: st };
    },
    /** Attendance for ONE student (caller supplies the id: Teacher param, or the Student's own session id). */
    summaryFor: function (studentId, from, to) {
      var sessions = {}; Db.all('AttendanceSessions').forEach(function (s) { sessions[s.session_id] = s; });
      var bm = {}; Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b.name; });
      var recs = Db.filter('AttendanceEntries', function (e) { var s = sessions[e.session_id]; return e.student_id === studentId && s && (!from || s.session_date >= from) && (!to || s.session_date <= to); })
        .map(function (e) { var s = sessions[e.session_id]; return { date: s.session_date, batchName: bm[s.batch_id] || '', sessionLabel: s.session_label, status: e.status, corrected: !!e.correction_reason }; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var c = counts(recs);
      return { from: from || '', to: to || '', counts: c, percentage: pct(c), policy: 'Percentage = Present / (Present + Absent). Holidays are excluded.', records: recs };
    },
    studentSummary: function (ctx, p) { return Attendance.summaryFor(Students.need(p.studentId).student_id, V.date(p.from, 'from'), V.date(p.to, 'to')); }
  };
})();

var Tests = (function () {
  function need(id) { var t = Db.get('Tests', V.id(id, 'testId')); if (!t) throw new ApiError('NOT_FOUND', 'Test not found.'); return t; }
  function pctOf(marks, max) { return Math.round(marks / max * 1000) / 10; }
  function rosterIds(t) {
    var ids = {}; Batches.roster(t.batch_id, t.test_date).concat(Batches.roster(t.batch_id, Util.today())).forEach(function (r) { ids[r.studentId] = 1; });
    Db.filter('TestResults', function (r) { return r.test_id === t.test_id; }).forEach(function (r) { ids[r.student_id] = 1; });
    return Object.keys(ids);
  }
  /** Rows for every student on the test with computed percent and competition rank. */
  function rows(t) {
    var res = {}; Db.filter('TestResults', function (r) { return r.test_id === t.test_id; }).forEach(function (r) { res[r.student_id] = r; });
    var nm = {}; Db.all('Students').forEach(function (s) { nm[s.student_id] = s.full_name; });
    var out = rosterIds(t).map(function (sid) {
      var r = res[sid];
      return { resultId: r ? r.result_id : null, studentId: sid, fullName: nm[sid] || '', resultStatus: r ? r.result_status : 'not_entered', marks: r && r.result_status === 'entered' ? r.marks : null,
        percentage: r && r.result_status === 'entered' ? pctOf(r.marks, t.max_marks) : null, comment: r ? r.teacher_comment : '', rank: null };
    });
    var ranked = out.filter(function (x) { return x.resultStatus === 'entered'; }).sort(function (a, b) { return b.marks - a.marks; });
    ranked.forEach(function (x, i) { x.rank = i > 0 && x.marks === ranked[i - 1].marks ? ranked[i - 1].rank : i + 1; });
    return out.sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
  }
  function stats(t, rs) {
    var entered = rs.filter(function (r) { return r.resultStatus === 'entered'; }), tot = 0; entered.forEach(function (r) { tot += r.marks; });
    return { students: rs.length, entered: entered.length, absent: rs.filter(function (r) { return r.resultStatus === 'absent'; }).length, exempt: rs.filter(function (r) { return r.resultStatus === 'exempt'; }).length,
      notEntered: rs.filter(function (r) { return r.resultStatus === 'not_entered'; }).length, average: entered.length ? Math.round(tot / entered.length * 100) / 100 : null,
      highest: entered.length ? Math.max.apply(null, entered.map(function (r) { return r.marks; })) : null, lowest: entered.length ? Math.min.apply(null, entered.map(function (r) { return r.marks; })) : null };
  }
  function view(t) { var b = Db.get('Batches', t.batch_id); return { testId: t.test_id, batchId: t.batch_id, batchName: b ? b.name : '', title: t.title, subject: t.subject, testDate: t.test_date, maxMarks: t.max_marks, publicationStatus: t.publication_status, publishedAt: t.published_at }; }

  return {
    need: need, rows: rows, stats: stats, view: view, rosterIds: rosterIds,
    list: function (ctx, p) {
      var list = Db.filter('Tests', function (t) { return (!p.batchId || t.batch_id === p.batchId) && (!p.publicationStatus || t.publication_status === p.publicationStatus); })
        .sort(function (a, b) { return a.test_date < b.test_date ? 1 : -1; }).map(function (t) { var v = view(t); v.stats = stats(t, rows(t)); return v; });
      return Util.paginate(list, p);
    },
    create: function (ctx, p) {
      var b = Batches.need(p.batchId);
      var t = Db.insert('Tests', { test_id: Util.newId('tst'), batch_id: b.batch_id, title: V.str(p.title, 'title', { required: true, max: 100 }), subject: V.str(p.subject || b.subject, 'subject', { max: 80 }), test_date: V.date(p.testDate || Util.today(), 'testDate', { required: true }),
        max_marks: V.num(p.maxMarks, 'maxMarks', { required: true, min: 1, max: 1000 }), publication_status: 'draft', published_at: '', published_by: '' });
      Audit.log(ctx, 'test.create', 'test', t.test_id, { title: t.title, batchId: b.batch_id, maxMarks: t.max_marks });
      return view(t);
    },
    update: function (ctx, p) {
      var t = need(p.testId), patch = {};
      if (p.title !== undefined) patch.title = V.str(p.title, 'title', { required: true, max: 100 });
      if (p.subject !== undefined) patch.subject = V.str(p.subject, 'subject', { max: 80 });
      if (p.testDate !== undefined) patch.test_date = V.date(p.testDate, 'testDate', { required: true });
      if (p.maxMarks !== undefined) {
        patch.max_marks = V.num(p.maxMarks, 'maxMarks', { required: true, min: 1, max: 1000 });
        if (Db.find('TestResults', function (r) { return r.test_id === t.test_id && r.result_status === 'entered' && r.marks > patch.max_marks; })) throw new ApiError('CONFLICT', 'Some entered marks exceed the new maximum.');
      }
      if (t.publication_status === 'published') V.str(p.reason, 'reason', { required: true, min: 5, max: 200 });
      Db.update('Tests', t.test_id, patch);
      Audit.log(ctx, 'test.update', 'test', t.test_id, { before: Util.pick(t, Object.keys(patch)), after: patch, reason: p.reason || '' });
      return view(Db.get('Tests', t.test_id));
    },
    get: function (ctx, p) { var t = need(p.testId), rs = rows(t); return { test: view(t), rows: rs, stats: stats(t, rs), rankingPolicy: 'Competition ranking (1,2,2,4) on entered marks only. Absent, exempt and not-entered students are unranked.' }; },
    saveMarks: function (ctx, p) {
      var t = need(p.testId), allowed = {}; rosterIds(t).forEach(function (s) { allowed[s] = 1; });
      if (!Array.isArray(p.entries) || !p.entries.length) V.fail('entries', 'are required');
      var published = t.publication_status === 'published', reason = published ? V.str(p.reason, 'reason', { required: true, min: 5, max: 200 }) : '';
      var changes = [], existing = {}; Db.filter('TestResults', function (r) { return r.test_id === t.test_id; }).forEach(function (r) { existing[r.student_id] = r; });
      var checked = p.entries.map(function (e) {
        var sid = V.id(e.studentId, 'entries.studentId'); if (!allowed[sid]) throw new ApiError('VALIDATION', 'Student ' + sid + ' is not on this test.');
        var st = V.oneOf(e.status, 'entries.status', RESULT_STATUS, { required: true }), marks = null;
        if (st === 'entered') {
          if (e.marks === undefined || e.marks === null || e.marks === '') throw new ApiError('VALIDATION', 'Marks are required when status is "entered" (use "not_entered" for missing marks).');
          marks = V.num(e.marks, 'marks', { required: true, min: 0, max: t.max_marks });
          if (Math.round(marks * 100) / 100 !== marks) V.fail('marks', 'allows at most 2 decimals');
        } else if (e.marks !== undefined && e.marks !== null && e.marks !== '') throw new ApiError('VALIDATION', 'Marks must be blank unless status is "entered".');
        return { sid: sid, st: st, marks: marks, comment: V.str(e.comment, 'comment', { max: 300 }) };
      });
      checked.forEach(function (c) {
        var ex = existing[c.sid];
        if (ex && ex.result_status === c.st && ex.marks === c.marks && ex.teacher_comment === c.comment) return;
        if (ex) Db.update('TestResults', ex.result_id, { marks: c.marks, result_status: c.st, teacher_comment: c.comment, updated_by: ctx.session.userId, updated_at: Util.nowIso() });
        else Db.insert('TestResults', { result_id: Util.newId('res'), test_id: t.test_id, student_id: c.sid, marks: c.marks, result_status: c.st, teacher_comment: c.comment, updated_by: ctx.session.userId, updated_at: Util.nowIso() });
        changes.push({ studentId: c.sid, from: ex ? { status: ex.result_status, marks: ex.marks } : null, to: { status: c.st, marks: c.marks } });
      });
      if (changes.length) Audit.log(ctx, 'test.marks', 'test', t.test_id, { changed: changes.length, changes: changes.slice(0, 40), reason: reason, afterPublication: published });
      return { saved: changes.length, unchanged: checked.length - changes.length };
    },
    publish: function (ctx, p) {
      var t = need(p.testId), pub = V.bool(p.publish, 'publish', true), rs = rows(t), st = stats(t, rs);
      if (pub) {
        if (t.publication_status === 'published') return view(t);
        if (!st.entered) throw new ApiError('CONFLICT', 'Enter marks for at least one student before publishing.');
        if (st.notEntered > 0 && p.confirmNotEntered !== true) throw new ApiError('NEEDS_CONFIRMATION', st.notEntered + ' student(s) still have no marks entered. Those will show as "Not entered". Confirm to publish.', { notEntered: st.notEntered });
        Db.update('Tests', t.test_id, { publication_status: 'published', published_at: Util.nowIso(), published_by: ctx.session.userId });
        Audit.log(ctx, 'test.publish', 'test', t.test_id, { notEntered: st.notEntered });
        var n = 0; if (p.notifyGuardians) { try { n = Notifications.queueResultPublished(ctx, Db.get('Tests', t.test_id), rs); } catch (e) { /* publication stands */ } }
        var out = view(Db.get('Tests', t.test_id)); out.notificationsQueued = n; return out;
      }
      if (t.publication_status !== 'published') return view(t);
      Db.update('Tests', t.test_id, { publication_status: 'draft', published_at: '', published_by: '' });
      Audit.log(ctx, 'test.unpublish', 'test', t.test_id, {});
      return view(Db.get('Tests', t.test_id));
    },
    /** A student's own results; published tests only (never unpublished). */
    resultsFor: function (studentId) {
      var out = [];
      Db.filter('Tests', function (t) { return t.publication_status === 'published'; }).forEach(function (t) {
        var r = Db.find('TestResults', function (x) { return x.test_id === t.test_id && x.student_id === studentId; });
        var inRoster = r || Batches.roster(t.batch_id, t.test_date).some(function (s) { return s.studentId === studentId; });
        if (!inRoster) return;
        var ent = r && r.result_status === 'entered';
        out.push({ testId: t.test_id, title: t.title, subject: t.subject, testDate: t.test_date, maxMarks: t.max_marks, resultStatus: r ? r.result_status : 'not_entered', marks: ent ? r.marks : null, percentage: ent ? pctOf(r.marks, t.max_marks) : null, comment: r ? r.teacher_comment : '' });
      });
      return out.sort(function (a, b) { return a.testDate < b.testDate ? 1 : -1; });
    }
  };
})();

var Homework = (function () {
  function need(id) { var h = Db.get('Homework', V.id(id, 'homeworkId')); if (!h) throw new ApiError('NOT_FOUND', 'Homework not found.'); return h; }
  function view(h) { var b = h.batch_id ? Db.get('Batches', h.batch_id) : null, s = h.student_id ? Db.get('Students', h.student_id) : null;
    return { homeworkId: h.homework_id, audienceType: h.audience_type, batchId: h.batch_id, batchName: b ? b.name : '', studentId: h.student_id, studentName: s ? s.full_name : '', title: h.title, subject: h.subject, instructions: h.instructions, assignedDate: h.assigned_date, dueDate: h.due_date, resourceUrl: h.resource_url, publicationStatus: h.publication_status, status: h.status }; }
  function fields(p, partial) {
    var o = {};
    if (!partial || p.title !== undefined) o.title = V.str(p.title, 'title', { required: true, max: 120 });
    if (!partial || p.subject !== undefined) o.subject = V.str(p.subject, 'subject', { max: 80 });
    if (!partial || p.instructions !== undefined) o.instructions = V.str(p.instructions, 'instructions', { max: 2000 });
    if (!partial || p.assignedDate !== undefined) o.assigned_date = V.date(p.assignedDate || Util.today(), 'assignedDate', { required: true });
    if (!partial || p.dueDate !== undefined) o.due_date = V.date(p.dueDate, 'dueDate', { required: true });
    if (p.resourceUrl !== undefined) o.resource_url = V.str(p.resourceUrl, 'resourceUrl', { max: 300, re: /^$|^https:\/\/\S+$/, reMsg: 'must be an https:// link' });
    return o;
  }
  return {
    list: function (ctx, p) {
      var rows = Db.filter('Homework', function (h) { return (p.includeArchived || h.status === 'active') && (!p.batchId || h.batch_id === p.batchId) && (!p.publicationStatus || h.publication_status === p.publicationStatus); })
        .sort(function (a, b) { return a.due_date < b.due_date ? 1 : -1; }).map(view);
      return Util.paginate(rows, p);
    },
    create: function (ctx, p) {
      var at = V.oneOf(p.audienceType, 'audienceType', ['batch', 'student'], { required: true }), f = fields(p, false);
      if (f.due_date < f.assigned_date) V.fail('dueDate', 'cannot be before the assigned date');
      var batchId = '', studentId = '';
      if (at === 'batch') batchId = Batches.need(p.batchId).batch_id; else studentId = Students.need(p.studentId).student_id;
      var h = Db.insert('Homework', Object.assign({ homework_id: Util.newId('hw'), audience_type: at, batch_id: batchId, student_id: studentId, resource_url: '', publication_status: V.oneOf(p.publicationStatus || 'draft', 'publicationStatus', ['draft', 'published']), status: 'active' }, f));
      Audit.log(ctx, 'homework.create', 'homework', h.homework_id, { title: h.title, audience: at });
      return view(h);
    },
    update: function (ctx, p) {
      var h = need(p.homeworkId), f = fields(p, true);
      if ((f.due_date || h.due_date) < (f.assigned_date || h.assigned_date)) V.fail('dueDate', 'cannot be before the assigned date');
      var n = Db.update('Homework', h.homework_id, f); Audit.log(ctx, 'homework.update', 'homework', h.homework_id, { fields: Object.keys(f) }); return view(n);
    },
    setPublication: function (ctx, p) {
      var h = need(p.homeworkId), st = V.oneOf(p.publicationStatus, 'publicationStatus', ['draft', 'published'], { required: true });
      var n = Db.update('Homework', h.homework_id, { publication_status: st }); Audit.log(ctx, 'homework.publication', 'homework', h.homework_id, { to: st });
      var queued = 0; if (st === 'published' && p.notifyGuardians) { try { queued = Notifications.queueHomework(ctx, n); } catch (e) { /* ignore */ } }
      var o = view(n); o.notificationsQueued = queued; return o;
    },
    archive: function (ctx, p) { var h = need(p.homeworkId); Db.update('Homework', h.homework_id, { status: 'archived' }); Audit.log(ctx, 'homework.archive', 'homework', h.homework_id, {}); return { archived: true }; },
    /** Published homework addressed to the given student (their batches or directly to them). */
    forStudent: function (studentId) {
      var bids = {}; Db.filter('StudentBatchLinks', function (l) { return l.student_id === studentId && l.status === 'active'; }).forEach(function (l) { bids[l.batch_id] = 1; });
      return Db.filter('Homework', function (h) { return h.status === 'active' && h.publication_status === 'published' && (h.audience_type === 'student' ? h.student_id === studentId : bids[h.batch_id]); })
        .sort(function (a, b) { return a.due_date < b.due_date ? 1 : -1; })
        .map(function (h) { var v = view(h); return { homeworkId: v.homeworkId, title: v.title, subject: v.subject, instructions: v.instructions, assignedDate: v.assignedDate, dueDate: v.dueDate, resourceUrl: v.resourceUrl, batchName: v.batchName, audience: v.audienceType === 'student' ? 'You' : v.batchName }; });
    },
    view: view
  };
})();

var Timetable = (function () {
  function need(id) { var t = Db.get('Timetable', V.id(id, 'scheduleId')); if (!t) throw new ApiError('NOT_FOUND', 'Schedule entry not found.'); return t; }
  function view(t) { var b = Db.get('Batches', t.batch_id); return { scheduleId: t.schedule_id, batchId: t.batch_id, batchName: b ? b.name : '', kind: t.kind, weekday: t.weekday, date: t.date, startTime: t.start_time, endTime: t.end_time, subject: t.subject, room: t.room, note: t.note, status: t.status, published: t.published }; }
  function fields(p, kindHint) {
    var kind = V.oneOf(p.kind || kindHint, 'kind', ['regular', 'one_off', 'cancellation'], { required: true }), o = { kind: kind, weekday: 0, date: '' };
    if (kind === 'regular') o.weekday = V.num(p.weekday, 'weekday', { required: true, min: 1, max: 7, int: true }); else o.date = V.date(p.date, 'date', { required: true });
    o.start_time = V.time(p.startTime, 'startTime', { required: kind !== 'cancellation' }); o.end_time = V.time(p.endTime, 'endTime', { required: kind !== 'cancellation' });
    if (o.start_time && o.end_time && o.end_time <= o.start_time) V.fail('endTime', 'must be after the start time');
    o.subject = V.str(p.subject, 'subject', { max: 80 }); o.room = V.str(p.room, 'room', { max: 40 }); o.note = V.str(p.note, 'note', { max: 200 });
    return o;
  }
  /** Expand schedule into dated classes between from..to for given batches. */
  function expand(entries, from, to) {
    var out = [], cancels = entries.filter(function (e) { return e.kind === 'cancellation'; });
    for (var d = from; d <= to; d = Util.addDays(d, 1)) {
      entries.forEach(function (e) {
        if (e.kind === 'cancellation') { if (e.date === d) out.push({ date: d, scheduleId: e.schedule_id, batchId: e.batch_id, startTime: e.start_time, endTime: e.end_time, subject: e.subject, room: '', note: e.note, type: 'cancellation' }); return; }
        var on = e.kind === 'regular' ? Util.weekday(d) === e.weekday : e.date === d; if (!on) return;
        var cancelled = cancels.some(function (c) { return c.batch_id === e.batch_id && c.date === d && (!c.start_time || c.start_time === e.start_time); });
        out.push({ date: d, scheduleId: e.schedule_id, batchId: e.batch_id, startTime: e.start_time, endTime: e.end_time, subject: e.subject, room: e.room, note: e.note, type: cancelled ? 'cancelled' : (e.kind === 'one_off' ? 'extra' : 'regular') });
      });
    }
    var bm = {}; Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b.name; });
    return out.map(function (x) { x.batchName = bm[x.batchId] || ''; return x; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startTime || '') < (b.startTime || '') ? -1 : 1; });
  }
  return {
    view: view,
    expandRange: function (from, to) { return expand(Db.filter('Timetable', function (t) { return t.status === 'active'; }), from, to); },
    list: function (ctx, p) {
      var rows = Db.filter('Timetable', function (t) { return t.status === 'active' && (!p.batchId || t.batch_id === p.batchId); }).sort(function (a, b) { return (a.weekday - b.weekday) || (a.start_time < b.start_time ? -1 : 1); }).map(view);
      return { items: rows, upcoming: expand(Db.filter('Timetable', function (t) { return t.status === 'active' && (!p.batchId || t.batch_id === p.batchId); }), Util.today(), Util.addDays(Util.today(), 13)) };
    },
    create: function (ctx, p) {
      var b = Batches.need(p.batchId), f = fields(p);
      var t = Db.insert('Timetable', Object.assign({ schedule_id: Util.newId('sch'), batch_id: b.batch_id, status: 'active', published: V.bool(p.published, 'published', true) }, f));
      Audit.log(ctx, 'timetable.create', 'timetable', t.schedule_id, { batchId: b.batch_id, kind: f.kind }); return view(t);
    },
    update: function (ctx, p) {
      var t = need(p.scheduleId), f = fields(Object.assign({}, view(t), { startTime: t.start_time, endTime: t.end_time }, p), t.kind);
      if (p.published !== undefined) f.published = V.bool(p.published, 'published');
      var n = Db.update('Timetable', t.schedule_id, f); Audit.log(ctx, 'timetable.update', 'timetable', t.schedule_id, { before: Util.pick(t, ['weekday', 'date', 'start_time', 'end_time', 'subject', 'room']), after: f }); return view(n);
    },
    remove: function (ctx, p) { var t = need(p.scheduleId); Db.update('Timetable', t.schedule_id, { status: 'removed' }); Audit.log(ctx, 'timetable.remove', 'timetable', t.schedule_id, {}); return { removed: true }; },
    /** Notify guardians of a batch about a published schedule change (manual review unless API configured). */
    notifyChange: function (ctx, p) {
      var b = Batches.need(p.batchId), msg = V.str(p.message, 'message', { required: true, min: 5, max: 400 });
      return { queued: Notifications.queueScheduleChange(ctx, b, msg) };
    },
    forStudent: function (studentId) {
      var bids = Db.filter('StudentBatchLinks', function (l) { return l.student_id === studentId && l.status === 'active'; }).map(function (l) { return l.batch_id; });
      var entries = Db.filter('Timetable', function (t) { return t.status === 'active' && t.published && bids.indexOf(t.batch_id) >= 0; });
      return { weekly: entries.filter(function (e) { return e.kind === 'regular'; }).sort(function (a, b) { return (a.weekday - b.weekday) || (a.start_time < b.start_time ? -1 : 1); }).map(view), upcoming: expand(entries, Util.today(), Util.addDays(Util.today(), 13)) };
    },
    upcoming: function (days) { return expand(Db.filter('Timetable', function (t) { return t.status === 'active'; }), Util.today(), Util.addDays(Util.today(), days - 1)); },
    expand: expand
  };
})();
