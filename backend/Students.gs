/** TuitionDesk backend — Students.gs : students, batches and batch membership history. */
var Batches = (function () {
  function view(b, members) {
    return { batchId: b.batch_id, name: b.name, subject: b.subject, capacity: b.capacity, status: b.status, description: b.description,
      memberCount: members, occupancy: b.capacity > 0 ? Math.round(members / b.capacity * 1000) / 10 : null };
  }
  function activeCounts() {
    var c = {};
    Db.filter('StudentBatchLinks', function (l) { return l.status === 'active'; }).forEach(function (l) { c[l.batch_id] = (c[l.batch_id] || 0) + 1; });
    return c;
  }
  function need(id) { var b = Db.get('Batches', V.id(id, 'batchId')); if (!b) throw new ApiError('NOT_FOUND', 'Batch not found.'); return b; }

  return {
    need: need,
    view: view,
    list: function (ctx, p) {
      var counts = activeCounts(), q = (p.search || '').toLowerCase();
      var rows = Db.all('Batches').filter(function (b) {
        return (!p.status || b.status === p.status) && (!q || (b.name + ' ' + b.subject).toLowerCase().indexOf(q) >= 0);
      }).sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (b) { return view(b, counts[b.batch_id] || 0); });
      return Util.paginate(rows, p);
    },
    get: function (ctx, p) {
      var b = need(p.batchId), counts = activeCounts();
      return { batch: view(b, counts[b.batch_id] || 0), roster: Batches.roster(b.batch_id, Util.today()) };
    },
    create: function (ctx, p) {
      var name = V.str(p.name, 'name', { required: true, max: 80 });
      if (Db.find('Batches', function (b) { return b.status === 'active' && b.name.toLowerCase() === name.toLowerCase(); })) throw new ApiError('CONFLICT', 'An active batch with this name already exists.');
      var b = Db.insert('Batches', { batch_id: Util.newId('bat'), name: name, subject: V.str(p.subject, 'subject', { max: 80 }), capacity: V.num(p.capacity, 'capacity', { min: 0, max: 1000, int: true, def: 0 }), status: 'active', description: V.str(p.description, 'description', { max: 300 }) });
      Audit.log(ctx, 'batch.create', 'batch', b.batch_id, { name: name });
      return view(b, 0);
    },
    update: function (ctx, p) {
      var b = need(p.batchId), patch = {};
      if (p.name !== undefined) patch.name = V.str(p.name, 'name', { required: true, max: 80 });
      if (p.subject !== undefined) patch.subject = V.str(p.subject, 'subject', { max: 80 });
      if (p.capacity !== undefined) patch.capacity = V.num(p.capacity, 'capacity', { min: 0, max: 1000, int: true, def: 0 });
      if (p.description !== undefined) patch.description = V.str(p.description, 'description', { max: 300 });
      var n = Db.update('Batches', b.batch_id, patch);
      Audit.log(ctx, 'batch.update', 'batch', b.batch_id, { before: Util.pick(b, Object.keys(patch)), after: patch });
      return view(n, activeCounts()[b.batch_id] || 0);
    },
    setStatus: function (ctx, p) {
      var b = need(p.batchId), st = V.oneOf(p.status, 'status', ['active', 'inactive'], { required: true });
      var n = Db.update('Batches', b.batch_id, { status: st });
      Audit.log(ctx, 'batch.status', 'batch', b.batch_id, { from: b.status, to: st });
      return view(n, activeCounts()[b.batch_id] || 0);
    },
    /** Active students in a batch on a given date (membership dates + student status). */
    roster: function (batchId, date) {
      var links = Db.filter('StudentBatchLinks', function (l) { return l.batch_id === batchId && l.start_date <= date && (!l.end_date || l.end_date >= date) && l.status !== 'void'; });
      var out = [], seen = {};
      links.forEach(function (l) {
        var s = Db.get('Students', l.student_id);
        if (s && s.status === 'active' && !seen[s.student_id]) { seen[s.student_id] = 1; out.push({ studentId: s.student_id, fullName: s.full_name }); }
      });
      return out.sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    }
  };
})();

var Students = (function () {
  function need(id) { var s = Db.get('Students', V.id(id, 'studentId')); if (!s) throw new ApiError('NOT_FOUND', 'Student not found.'); return s; }
  function batchesOf(studentId, onlyActive) {
    var bm = {}; Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b; });
    return Db.filter('StudentBatchLinks', function (l) { return l.student_id === studentId && (!onlyActive || l.status === 'active'); }).map(function (l) {
      var b = bm[l.batch_id] || {}; return { linkId: l.link_id, batchId: l.batch_id, name: b.name || '(removed)', subject: b.subject || '', startDate: l.start_date, endDate: l.end_date, status: l.status };
    });
  }
  /** Full Teacher-facing view (includes guardian contact + private notes). */
  function teacherView(s) {
    var u = s.user_id ? Db.get('Users', s.user_id) : null;
    return { studentId: s.student_id, fullName: s.full_name, guardianName: s.guardian_name, guardianWhatsapp: s.guardian_whatsapp, whatsappConsent: s.whatsapp_consent,
      contactEmail: s.contact_email, admissionDate: s.admission_date, status: s.status, notes: s.notes, username: u ? u.username : '', accountStatus: u ? u.status : 'none', reminderMode: s.reminder_mode || 'auto', reminderPauseUntil: s.reminder_pause_until || '',
      batches: batchesOf(s.student_id, false) };
  }
  /** Student self view: no guardian contact, no private notes. */
  function selfView(s) {
    return { studentId: s.student_id, fullName: s.full_name, guardianName: s.guardian_name, admissionDate: s.admission_date, status: s.status,
      batches: batchesOf(s.student_id, true).map(function (b) { return Util.pick(b, ['batchId', 'name', 'subject', 'startDate']); }) };
  }
  function assignInternal(ctx, st, batchId, startDate, override) {
    var b = Batches.need(batchId);
    if (b.status !== 'active') throw new ApiError('CONFLICT', 'Batch "' + b.name + '" is inactive.');
    var active = Db.filter('StudentBatchLinks', function (l) { return l.student_id === st.student_id && l.status === 'active'; });
    if (active.some(function (l) { return l.batch_id === batchId; })) return null; // already a member
    if (!Settings.get('multi_batch_allowed') && active.length) throw new ApiError('CONFLICT', 'Centre policy allows only one batch per student.');
    if (b.capacity > 0 && !override) {
      var n = Db.filter('StudentBatchLinks', function (l) { return l.batch_id === batchId && l.status === 'active'; }).length;
      if (n >= b.capacity) throw new ApiError('CAPACITY', 'Batch "' + b.name + '" is full (' + b.capacity + '). Confirm to exceed capacity.', { needsConfirmation: true });
    }
    var l = Db.insert('StudentBatchLinks', { link_id: Util.newId('lnk'), student_id: st.student_id, batch_id: batchId, start_date: startDate || Util.today(), end_date: '', status: 'active' });
    Audit.log(ctx, 'student.batch_assign', 'student', st.student_id, { batchId: batchId });
    return l;
  }

  return {
    need: need, teacherView: teacherView, selfView: selfView, batchesOf: batchesOf,
    assignInternal: assignInternal,

    list: function (ctx, p) {
      var q = (p.search || '').toLowerCase(), links = Util.groupBy(Db.filter('StudentBatchLinks', function (l) { return l.status === 'active'; }), 'student_id');
      var bm = {}; Db.all('Batches').forEach(function (b) { bm[b.batch_id] = b.name; });
      var rows = Db.all('Students').filter(function (s) {
        if (p.status && s.status !== p.status) return false;
        if (!p.status && s.status === 'archived' && !p.includeArchived) return false;
        if (p.batchId && !(links[s.student_id] || []).some(function (l) { return l.batch_id === p.batchId; })) return false;
        return !q || (s.full_name + ' ' + s.student_id + ' ' + s.guardian_name).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }).map(function (s) {
        return { studentId: s.student_id, fullName: s.full_name, guardianName: s.guardian_name, status: s.status, admissionDate: s.admission_date,
          batches: (links[s.student_id] || []).map(function (l) { return { batchId: l.batch_id, name: bm[l.batch_id] || '' }; }) };
      });
      return Util.paginate(rows, p);
    },
    get: function (ctx, p) { return teacherView(need(p.studentId)); },

    create: function (ctx, p, opts) {
      opts = opts || {};
      var name = V.str(p.fullName, 'fullName', { required: true, min: 2, max: 100 });
      var gphone = V.phone(p.guardianWhatsapp, 'guardianWhatsapp');
      var consent = V.oneOf(p.whatsappConsent || 'unknown', 'whatsappConsent', ['yes', 'no', 'unknown']);
      var adm = V.date(p.admissionDate || Util.today(), 'admissionDate');
      var batchIds = Array.isArray(p.batchIds) ? p.batchIds.map(function (b) { return V.id(b, 'batchIds'); }) : [];
      batchIds.forEach(function (b) { Batches.need(b); });
      var sid = Db.nextSeq('Students', 'student_id', 'STU-', 4);
      var tempPw = null, user = null;
      if (p.createAccount !== false) {
        var username = V.str(p.username || sid.toLowerCase().replace('-', ''), 'username', { required: true, min: 3, max: 30, re: /^[a-z0-9._-]+$/, reMsg: 'may only use lowercase letters, digits, . _ -' });
        tempPw = p.password || Auth.generatePassword();
        user = Auth.createStudentUser(username, name, sid, tempPw);
      }
      var s = Db.insert('Students', { student_id: sid, user_id: user ? user.user_id : '', full_name: name, guardian_name: V.str(p.guardianName, 'guardianName', { max: 100 }),
        guardian_whatsapp: gphone, whatsapp_consent: consent, contact_email: V.email(p.contactEmail, 'contactEmail'), admission_date: adm, status: 'active', notes: V.str(p.notes, 'notes', { max: 1000 }) });
      Audit.log(ctx, 'student.create', 'student', sid, { fullName: name, source: opts.source || 'manual' });
      batchIds.forEach(function (b) { assignInternal(ctx, s, b, adm, !!p.overrideCapacity); });
      var out = teacherView(s);
      if (tempPw) out.temporaryPassword = tempPw;
      return out;
    },

    update: function (ctx, p) {
      var s = need(p.studentId), patch = {};
      if (p.fullName !== undefined) patch.full_name = V.str(p.fullName, 'fullName', { required: true, min: 2, max: 100 });
      if (p.guardianName !== undefined) patch.guardian_name = V.str(p.guardianName, 'guardianName', { max: 100 });
      if (p.guardianWhatsapp !== undefined) patch.guardian_whatsapp = V.phone(p.guardianWhatsapp, 'guardianWhatsapp');
      if (p.whatsappConsent !== undefined) patch.whatsapp_consent = V.oneOf(p.whatsappConsent, 'whatsappConsent', ['yes', 'no', 'unknown']);
      if (p.contactEmail !== undefined) patch.contact_email = V.email(p.contactEmail, 'contactEmail');
      if (p.admissionDate !== undefined) patch.admission_date = V.date(p.admissionDate, 'admissionDate', { required: true });
      if (p.notes !== undefined) patch.notes = V.str(p.notes, 'notes', { max: 1000 });
      if (p.reminderMode !== undefined) patch.reminder_mode = V.oneOf(p.reminderMode, 'reminderMode', ['auto', 'gentle', 'off']);
      if (p.reminderPauseUntil !== undefined) patch.reminder_pause_until = p.reminderPauseUntil === '' ? '' : V.date(p.reminderPauseUntil, 'reminderPauseUntil');
      var n = Db.update('Students', s.student_id, patch);
      if (patch.full_name && s.user_id) Db.update('Users', s.user_id, { display_name: patch.full_name });
      var before = {}; Object.keys(patch).forEach(function (k) { before[k] = k === 'notes' ? '(private)' : s[k]; });
      Audit.log(ctx, 'student.update', 'student', s.student_id, { fields: Object.keys(patch), before: before });
      return teacherView(n);
    },

    /** Deactivate/archive instead of deleting: history is preserved. */
    setStatus: function (ctx, p) {
      var s = need(p.studentId), st = V.oneOf(p.status, 'status', ['active', 'inactive', 'archived'], { required: true });
      if (st === s.status) return teacherView(s);
      Db.update('Students', s.student_id, { status: st });
      if (st !== 'active') {
        Db.filter('StudentBatchLinks', function (l) { return l.student_id === s.student_id && l.status === 'active'; })
          .forEach(function (l) { Db.update('StudentBatchLinks', l.link_id, { status: 'ended', end_date: Util.today() }); });
      }
      Auth.setStudentAccountStatus(ctx, s.student_id, st === 'active');
      Audit.log(ctx, 'student.status', 'student', s.student_id, { from: s.status, to: st });
      return teacherView(Db.get('Students', s.student_id));
    },

    assignBatch: function (ctx, p) {
      var s = need(p.studentId);
      if (s.status !== 'active') throw new ApiError('CONFLICT', 'Only active students can be assigned to a batch.');
      assignInternal(ctx, s, V.id(p.batchId, 'batchId'), V.date(p.startDate, 'startDate') || Util.today(), !!p.overrideCapacity);
      return teacherView(s);
    },
    removeBatch: function (ctx, p) {
      var s = need(p.studentId), l = Db.find('StudentBatchLinks', function (x) { return x.student_id === s.student_id && x.batch_id === p.batchId && x.status === 'active'; });
      if (!l) throw new ApiError('NOT_FOUND', 'The student is not an active member of that batch.');
      Db.update('StudentBatchLinks', l.link_id, { status: 'ended', end_date: Util.today() });
      Audit.log(ctx, 'student.batch_remove', 'student', s.student_id, { batchId: p.batchId });
      return teacherView(s);
    },
    resetPassword: function (ctx, p) { return Auth.resetStudentPassword(ctx, p); }
  };
})();
