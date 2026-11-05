/** TuitionDesk backend — Comms.gs : enquiries, admissions and notices. */
var Enquiries = (function () {
  var STATUSES = ['new', 'contacted', 'follow_up', 'trial', 'admitted', 'lost'];
  function need(id) { var e = Db.get('Enquiries', V.id(id, 'enquiryId')); if (!e) throw new ApiError('NOT_FOUND', 'Enquiry not found.'); return e; }
  function view(e) {
    var b = e.requested_batch_id ? Db.get('Batches', e.requested_batch_id) : null;
    return { enquiryId: e.enquiry_id, enquiryDate: e.enquiry_date, name: e.name, guardianName: e.guardian_name, phone: e.phone, requestedSubject: e.requested_subject, requestedBatchId: e.requested_batch_id, requestedBatchName: b ? b.name : '',
      source: e.source, notes: e.notes, nextAction: e.next_action, nextActionDate: e.next_action_date, status: e.status, convertedStudentId: e.converted_student_id };
  }
  function fields(p, partial) {
    var o = {};
    if (!partial || p.name !== undefined) o.name = V.str(p.name, 'name', { required: true, min: 2, max: 100 });
    if (p.guardianName !== undefined) o.guardian_name = V.str(p.guardianName, 'guardianName', { max: 100 });
    if (p.phone !== undefined) o.phone = V.phone(p.phone, 'phone');
    if (p.requestedSubject !== undefined) o.requested_subject = V.str(p.requestedSubject, 'requestedSubject', { max: 80 });
    if (p.requestedBatchId) o.requested_batch_id = Batches.need(p.requestedBatchId).batch_id; else if (p.requestedBatchId === '') o.requested_batch_id = '';
    if (p.source !== undefined) o.source = V.str(p.source, 'source', { max: 80 });
    if (p.notes !== undefined) o.notes = V.str(p.notes, 'notes', { max: 1000 });
    if (p.nextAction !== undefined) o.next_action = V.str(p.nextAction, 'nextAction', { max: 200 });
    if (p.nextActionDate !== undefined) o.next_action_date = V.date(p.nextActionDate, 'nextActionDate');
    return o;
  }
  return {
    list: function (ctx, p) {
      var q = (p.search || '').toLowerCase();
      var rows = Db.filter('Enquiries', function (e) { return (!p.status || e.status === p.status) && (!q || (e.name + ' ' + e.guardian_name + ' ' + e.phone).toLowerCase().indexOf(q) >= 0); })
        .sort(function (a, b) { return a.enquiry_date < b.enquiry_date ? 1 : a.enquiry_date > b.enquiry_date ? -1 : 0; }).map(view);
      return Util.paginate(rows, p);
    },
    get: function (ctx, p) {
      var e = need(p.enquiryId);
      return { enquiry: view(e), followups: Db.filter('EnquiryFollowups', function (f) { return f.enquiry_id === e.enquiry_id; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(function (f) { return { followupId: f.followup_id, note: f.note, nextAction: f.next_action, nextActionDate: f.next_action_date, createdAt: f.created_at }; }) };
    },
    create: function (ctx, p) {
      var f = fields(p, false);
      var e = Db.insert('Enquiries', Object.assign({ enquiry_id: Util.newId('enq'), enquiry_date: V.date(p.enquiryDate || Util.today(), 'enquiryDate'), guardian_name: '', phone: '', requested_subject: '', requested_batch_id: '', source: '', notes: '', next_action: '', next_action_date: '', status: 'new', converted_student_id: '' }, f));
      Audit.log(ctx, 'enquiry.create', 'enquiry', e.enquiry_id, { name: e.name }); return view(e);
    },
    update: function (ctx, p) {
      var e = need(p.enquiryId), f = fields(p, true);
      if (p.status !== undefined) {
        f.status = V.oneOf(p.status, 'status', STATUSES, { required: true });
        if (f.status === 'admitted' && !e.converted_student_id) throw new ApiError('CONFLICT', 'Use "Convert to admission" to mark an enquiry as admitted.');
      }
      var n = Db.update('Enquiries', e.enquiry_id, f); Audit.log(ctx, 'enquiry.update', 'enquiry', e.enquiry_id, { fields: Object.keys(f) }); return view(n);
    },
    addFollowup: function (ctx, p) {
      var e = need(p.enquiryId), note = V.str(p.note, 'note', { required: true, max: 500 });
      var f = Db.insert('EnquiryFollowups', { followup_id: Util.newId('fup'), enquiry_id: e.enquiry_id, note: note, next_action: V.str(p.nextAction, 'nextAction', { max: 200 }), next_action_date: V.date(p.nextActionDate, 'nextActionDate'), created_by: ctx.session.userId });
      Db.update('Enquiries', e.enquiry_id, { next_action: f.next_action, next_action_date: f.next_action_date, status: e.status === 'new' ? 'contacted' : e.status });
      return { followupId: f.followup_id };
    },
    /** Idempotent: converting twice returns the existing admission and never duplicates the student. */
    convert: function (ctx, p) {
      var e = need(p.enquiryId);
      var existing = Db.find('Admissions', function (a) { return a.enquiry_id === e.enquiry_id && a.status === 'confirmed'; });
      if (existing) return { admissionId: existing.admission_id, studentId: existing.student_id, alreadyConverted: true };
      var student, temp;
      if (p.existingStudentId) student = Students.need(p.existingStudentId);
      else {
        var out = Students.create(ctx, { fullName: p.fullName || e.name, guardianName: p.guardianName !== undefined ? p.guardianName : e.guardian_name, guardianWhatsapp: p.guardianWhatsapp !== undefined ? p.guardianWhatsapp : e.phone,
          whatsappConsent: p.whatsappConsent, admissionDate: p.admissionDate, batchIds: p.batchId ? [p.batchId] : [], username: p.username, password: p.password, createAccount: p.createAccount, notes: p.notes, overrideCapacity: p.overrideCapacity }, { source: 'enquiry' });
        student = Db.get('Students', out.studentId); temp = out.temporaryPassword;
      }
      if (p.existingStudentId && p.batchId) Students.assignInternal(ctx, student, V.id(p.batchId, 'batchId'), Util.today(), !!p.overrideCapacity);
      var a = Db.insert('Admissions', { admission_id: Util.newId('adm'), enquiry_id: e.enquiry_id, student_id: student.student_id, batch_id: p.batchId || '', admission_date: student.admission_date, source: e.source, status: 'confirmed', created_by: ctx.session.userId });
      Db.update('Enquiries', e.enquiry_id, { status: 'admitted', converted_student_id: student.student_id });
      Audit.log(ctx, 'enquiry.convert', 'enquiry', e.enquiry_id, { studentId: student.student_id, admissionId: a.admission_id });
      return { admissionId: a.admission_id, studentId: student.student_id, temporaryPassword: temp || null, alreadyConverted: false };
    }
  };
})();

var Admissions = {
  list: function (ctx, p) {
    var sm = {}, bm = {}; Db.all('Students').forEach(function (s) { sm[s.student_id] = s.full_name; }); Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b.name; });
    var rows = Db.filter('Admissions', function (a) { return !p.from || a.admission_date >= p.from; }).sort(function (a, b) { return a.admission_date < b.admission_date ? 1 : -1; })
      .map(function (a) { return { admissionId: a.admission_id, enquiryId: a.enquiry_id, studentId: a.student_id, studentName: sm[a.student_id] || '', batchName: bm[a.batch_id] || '', admissionDate: a.admission_date, source: a.source, status: a.status }; });
    return Util.paginate(rows, p);
  }
};

var Notices = (function () {
  function need(id) { var n = Db.get('Notices', V.id(id, 'noticeId')); if (!n) throw new ApiError('NOT_FOUND', 'Notice not found.'); return n; }
  function view(n) { var b = n.batch_id ? Db.get('Batches', n.batch_id) : null, s = n.student_id ? Db.get('Students', n.student_id) : null; return { noticeId: n.notice_id, title: n.title, body: n.body, audienceType: n.audience_type, batchId: n.batch_id, batchName: b ? b.name : '', studentId: n.student_id, studentName: s ? s.full_name : '', status: n.status, publishedAt: n.published_at, createdAt: n.created_at }; }
  function audience(p) {
    var at = V.oneOf(p.audienceType || 'all', 'audienceType', ['all', 'batch', 'student']), o = { audience_type: at, batch_id: '', student_id: '' };
    if (at === 'batch') o.batch_id = Batches.need(p.batchId).batch_id; if (at === 'student') o.student_id = Students.need(p.studentId).student_id; return o;
  }
  return {
    view: view, need: need,
    /** Active students a notice is addressed to. */
    recipients: function (n) {
      var act = Db.filter('Students', function (s) { return s.status === 'active'; });
      if (n.audience_type === 'student') return act.filter(function (s) { return s.student_id === n.student_id; });
      if (n.audience_type === 'batch') { var ids = {}; Batches.roster(n.batch_id, Util.today()).forEach(function (r) { ids[r.studentId] = 1; }); return act.filter(function (s) { return ids[s.student_id]; }); }
      return act;
    },
    list: function (ctx, p) { return Util.paginate(Db.filter('Notices', function (n) { return (!p.status || n.status === p.status) && n.status !== 'deleted'; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).map(view), p); },
    create: function (ctx, p) {
      var st = V.oneOf(p.status || 'draft', 'status', ['draft', 'published']);
      var n = Db.insert('Notices', Object.assign({ notice_id: Util.newId('not'), title: V.str(p.title, 'title', { required: true, max: 120 }), body: V.str(p.body, 'body', { required: true, max: 2000 }), status: st, published_at: st === 'published' ? Util.nowIso() : '', created_by: ctx.session.userId }, audience(p)));
      Audit.log(ctx, 'notice.create', 'notice', n.notice_id, { title: n.title, audience: n.audience_type, status: st }); return view(n);
    },
    update: function (ctx, p) {
      var n = need(p.noticeId), patch = {};
      if (p.title !== undefined) patch.title = V.str(p.title, 'title', { required: true, max: 120 });
      if (p.body !== undefined) patch.body = V.str(p.body, 'body', { required: true, max: 2000 });
      if (p.audienceType !== undefined) Object.assign(patch, audience(p));
      var u = Db.update('Notices', n.notice_id, patch); Audit.log(ctx, 'notice.update', 'notice', n.notice_id, { fields: Object.keys(patch) }); return view(u);
    },
    setStatus: function (ctx, p) {
      var n = need(p.noticeId), st = V.oneOf(p.status, 'status', ['draft', 'published', 'archived'], { required: true });
      var u = Db.update('Notices', n.notice_id, { status: st, published_at: st === 'published' ? (n.published_at || Util.nowIso()) : n.published_at });
      Audit.log(ctx, 'notice.status', 'notice', n.notice_id, { from: n.status, to: st });
      var out = view(u); out.notificationsQueued = 0;
      if (st === 'published' && p.notifyGuardians) out.notificationsQueued = Notifications.queueNotice(ctx, u);
      return out;
    },
    forStudent: function (studentId) {
      var bids = {}; Db.filter('StudentBatchLinks', function (l) { return l.student_id === studentId && l.status === 'active'; }).forEach(function (l) { bids[l.batch_id] = 1; });
      return Db.filter('Notices', function (n) { return n.status === 'published' && (n.audience_type === 'all' || (n.audience_type === 'batch' && bids[n.batch_id]) || (n.audience_type === 'student' && n.student_id === studentId)); })
        .sort(function (a, b) { return a.published_at < b.published_at ? 1 : -1; }).map(function (n) { return { noticeId: n.notice_id, title: n.title, body: n.body, publishedAt: n.published_at }; });
    }
  };
})();
