/**
 * TuitionDesk backend — Api.gs : web-app entry points, router and the role/permission table.
 *
 * Request  (POST, Content-Type text/plain to avoid CORS pre-flight): {"action":"students.list","token":"...","params":{...}}
 * Response: {"ok":true,"data":...}  |  {"ok":false,"error":{"code":"VALIDATION","message":"...","details":{...}}}
 *
 * Authorization is enforced HERE for every action: the role comes from the server-side session, and Student
 * actions ("my.*") take the student id from the session — any studentId sent by the browser is ignored.
 */
var T = [ROLES.TEACHER], S = [ROLES.STUDENT], TS = [ROLES.TEACHER, ROLES.STUDENT];
var PW_EXEMPT = { 'auth.me': 1, 'auth.logout': 1, 'auth.changePassword': 1 };

function actions_() {
  // a = allowed roles ('public' = no token), w = mutating (runs under the script lock), f = handler
  return {
    'auth.status': { a: 'public', f: function () { return { setupComplete: Auth.teacherExists(), environment: Props.get('ENVIRONMENT') || 'production', centreName: Settings.get('centre_name') }; } },
    'auth.bootstrap': { a: 'public', w: 1, f: Auth.bootstrap },
    'auth.login': { a: 'public', w: 1, f: Auth.login },
    'auth.mfaVerify': { a: 'public', w: 1, f: Mfa.verifyLogin }, 'auth.mfaEmailCode': { a: 'public', w: 1, f: Mfa.emailCodeForLogin },
    'auth.recoveryEmailCode': { a: 'public', w: 1, f: Mfa.emailCodeForReset }, 'auth.recoverPassword': { a: 'public', w: 1, f: Mfa.recoverPassword },
    'verify.check': { a: 'public', f: function (c, p) { return Documents.check(p.id); } },
    'pay.info': { a: 'public', f: PayLinks.info }, 'pay.report': { a: 'public', w: 1, f: PayLinks.report },
    'payments.callback': { a: 'public', w: 1, f: Payments.providerCallback },

    'auth.me': { a: TS, f: Auth.me }, 'auth.logout': { a: TS, w: 1, f: Auth.logout }, 'auth.changePassword': { a: TS, w: 1, f: Auth.changePassword },

    'mfa.status': { a: T, f: Mfa.status }, 'mfa.begin': { a: T, w: 1, f: Mfa.begin }, 'mfa.enable': { a: T, w: 1, f: Mfa.enable }, 'mfa.disable': { a: T, w: 1, f: Mfa.disable },
    'mfa.regenerateRecovery': { a: T, w: 1, f: Mfa.regenerateRecovery }, 'mfa.emailStart': { a: T, w: 1, f: Mfa.emailStart }, 'mfa.emailConfirm': { a: T, w: 1, f: Mfa.emailConfirm }, 'mfa.emailRemove': { a: T, w: 1, f: Mfa.emailRemove },
    'settings.get': { a: T, f: function () { return { settings: Settings.all(), integrations: { messaging: 'self', whatsappApi: false, paymentCallbacks: !!Props.get('PAYMENT_WEBHOOK_SECRET'), backupFolder: !!Props.get('BACKUP_FOLDER_ID'), documentsFolder: !!Props.get('DOCS_FOLDER_ID') }, environment: Props.get('ENVIRONMENT') || 'production', version: TD.VERSION }; } },
    'settings.update': { a: T, w: 1, f: function (c, p) { return Settings.update(c, p.patch || {}); } },

    'students.list': { a: T, f: Students.list }, 'students.get': { a: T, f: Students.get }, 'students.create': { a: T, w: 1, f: Students.create }, 'students.update': { a: T, w: 1, f: Students.update },
    'students.setStatus': { a: T, w: 1, f: Students.setStatus }, 'students.assignBatch': { a: T, w: 1, f: Students.assignBatch }, 'students.removeBatch': { a: T, w: 1, f: Students.removeBatch }, 'students.resetPassword': { a: T, w: 1, f: Students.resetPassword },
    'batches.list': { a: T, f: Batches.list }, 'batches.get': { a: T, f: Batches.get }, 'batches.create': { a: T, w: 1, f: Batches.create }, 'batches.update': { a: T, w: 1, f: Batches.update }, 'batches.setStatus': { a: T, w: 1, f: Batches.setStatus },

    'fees.list': { a: T, f: Fees.list }, 'fees.create': { a: T, w: 1, f: Fees.create }, 'fees.createBulk': { a: T, w: 1, f: Fees.createBulk }, 'fees.update': { a: T, w: 1, f: Fees.update }, 'fees.cancel': { a: T, w: 1, f: Fees.cancel },
    'fees.adjust': { a: T, w: 1, f: Fees.adjust }, 'fees.applyLateFees': { a: T, w: 1, f: Fees.applyLateFees }, 'fees.statement': { a: T, f: function (c, p) { return Fees.statement(V.id(p.studentId, 'studentId'), false); } },
    'payments.list': { a: T, f: Payments.list }, 'payments.get': { a: T, f: Payments.get }, 'payments.record': { a: T, w: 1, f: Payments.record }, 'payments.verify': { a: T, w: 1, f: Payments.verify }, 'payments.reject': { a: T, w: 1, f: Payments.reject },
    'payments.allocateCredit': { a: T, w: 1, f: Payments.allocateCredit }, 'payments.reverse': { a: T, w: 1, f: Payments.reverse }, 'payments.refund': { a: T, w: 1, f: Payments.refund },
    'receipts.list': { a: T, f: Receipts.list }, 'ledger.reconcile': { a: T, f: function () { return Ledger.reconcile(); } },

    'attendance.roster': { a: T, f: Attendance.roster }, 'attendance.save': { a: T, w: 1, f: Attendance.save, post: 1 }, 'attendance.sessions': { a: T, f: Attendance.sessions }, 'attendance.session': { a: T, f: Attendance.session },
    'attendance.correct': { a: T, w: 1, f: Attendance.correct }, 'attendance.studentSummary': { a: T, f: Attendance.studentSummary },
    'tests.list': { a: T, f: Tests.list }, 'tests.create': { a: T, w: 1, f: Tests.create }, 'tests.update': { a: T, w: 1, f: Tests.update }, 'tests.get': { a: T, f: Tests.get }, 'tests.saveMarks': { a: T, w: 1, f: Tests.saveMarks }, 'tests.publish': { a: T, w: 1, f: Tests.publish },
    'homework.list': { a: T, f: Homework.list }, 'homework.create': { a: T, w: 1, f: Homework.create }, 'homework.update': { a: T, w: 1, f: Homework.update }, 'homework.setPublication': { a: T, w: 1, f: Homework.setPublication }, 'homework.archive': { a: T, w: 1, f: Homework.archive },
    'timetable.list': { a: T, f: Timetable.list }, 'timetable.create': { a: T, w: 1, f: Timetable.create }, 'timetable.update': { a: T, w: 1, f: Timetable.update }, 'timetable.remove': { a: T, w: 1, f: Timetable.remove }, 'timetable.notifyChange': { a: T, w: 1, f: Timetable.notifyChange },
    'enquiries.list': { a: T, f: Enquiries.list }, 'enquiries.get': { a: T, f: Enquiries.get }, 'enquiries.create': { a: T, w: 1, f: Enquiries.create }, 'enquiries.update': { a: T, w: 1, f: Enquiries.update }, 'enquiries.addFollowup': { a: T, w: 1, f: Enquiries.addFollowup }, 'enquiries.convert': { a: T, w: 1, f: Enquiries.convert }, 'admissions.list': { a: T, f: Admissions.list },
    'notices.list': { a: T, f: Notices.list }, 'notices.create': { a: T, w: 1, f: Notices.create }, 'notices.update': { a: T, w: 1, f: Notices.update }, 'notices.setStatus': { a: T, w: 1, f: Notices.setStatus },
    'notifications.list': { a: T, f: Notifications.list }, 'notifications.markSent': { a: T, w: 1, f: Notifications.markManuallySent }, 'notifications.cancel': { a: T, w: 1, f: Notifications.cancel }, 'notifications.retry': { a: T, w: 1, f: Notifications.retry },
    'notifications.queueFeeReminders': { a: T, w: 1, f: function (c, p) { return Notifications.queueFeeReminders(c, { studentIds: Array.isArray(p.studentIds) ? p.studentIds : null }); } },
    'notifications.queueOverdue': { a: T, w: 1, f: function (c) { return Notifications.queueOverdue(c, {}); } },
    'pay.link': { a: T, w: 1, f: PayLinks.teacherLink }, 'ladder.preview': { a: T, f: Ladder.preview }, 'ladder.run': { a: T, w: 1, f: Ladder.run }, 'ladder.status': { a: T, f: Ladder.status },
    'jobs.run': { a: T, w: 1, f: Jobs.runNow }, 'jobs.status': { a: T, f: Jobs.status },

    'documents.types': { a: T, f: Documents.types }, 'documents.issue': { a: T, w: 1, f: Documents.issue }, 'documents.reissue': { a: T, w: 1, f: Documents.reissue }, 'documents.get': { a: T, f: Documents.get },
    'documents.list': { a: T, f: Documents.list }, 'documents.history': { a: T, f: Documents.history }, 'documents.revoke': { a: T, w: 1, f: Documents.revoke }, 'documents.attachFile': { a: T, w: 1, f: Documents.attachFile },
    'export.get': { a: T, w: 1, f: Exporter.get },
    'dashboard.get': { a: T, f: Dashboard.get }, 'audit.list': { a: T, f: AuditApi.list },
    'backup.run': { a: T, w: 1, f: Backup.run }, 'backup.list': { a: T, f: Backup.list }, 'backup.verify': { a: T, w: 1, f: Backup.verify }, 'backup.restoreTest': { a: T, w: 1, f: Backup.restoreTest },

    'my.home': { a: S, f: Portal.home }, 'my.profile': { a: S, f: Portal.profile }, 'my.timetable': { a: S, f: Portal.timetable }, 'my.attendance': { a: S, f: Portal.attendance }, 'my.homework': { a: S, f: Portal.homework },
    'my.results': { a: S, f: Portal.results }, 'my.fees': { a: S, f: Portal.fees }, 'my.reportPayment': { a: S, w: 1, f: Portal.reportPayment }, 'my.receipts': { a: S, f: Portal.receipts }, 'my.documents': { a: S, f: Portal.documents },
    'my.document': { a: S, f: Portal.document }, 'my.notices': { a: S, f: Portal.notices }, 'settings.paymentInfo': { a: TS, f: function () { return Settings.publicInfo(); } }
  };
}

function handle_(req) {
  var requestId = Util.uuid().slice(0, 12), ctx = { requestId: requestId, afterCommit: [], session: null };
  try {
    Db.reset(); Settings.reset();
    if (!req || typeof req !== 'object' || typeof req.action !== 'string') throw new ApiError('BAD_REQUEST', 'Invalid request.');
    var def = actions_()[req.action];
    if (!def) throw new ApiError('UNKNOWN_ACTION', 'Unknown action.');
    var params = req.params && typeof req.params === 'object' && !Array.isArray(req.params) ? req.params : {};
    if (def.a !== 'public') {
      ctx.session = Auth.authenticate(req.token);
      if (def.a.indexOf(ctx.session.role) < 0) {
        try { Runtime.withLock(function () { Db.reset(); Audit.log(ctx, 'security.denied', 'action', req.action, { role: ctx.session.role }); }); } catch (e) { /* best effort */ }
        throw new ApiError('FORBIDDEN', 'You do not have permission to do that.');
      }
      if (ctx.session.mustChangePassword && !PW_EXEMPT[req.action]) throw new ApiError('PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password to continue.');
    }
    var data = def.w ? Runtime.withLock(function () { Db.reset(); Settings.reset(); return def.f(ctx, params); }) : def.f(ctx, params);
    var res = { ok: true, data: data === undefined ? null : data, requestId: requestId };
    ctx.afterCommit.forEach(function (fn) { try { fn(); } catch (e) { Logger.log('afterCommit error ' + requestId + ': ' + (e && e.message)); } });
    return res;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: { code: e.code, message: e.message, details: e.details }, requestId: requestId };
    Logger.log('INTERNAL ' + requestId + ' ' + (e && e.stack || e));
    try { Runtime.withLock(function () { Db.reset(); Audit.log(ctx, 'system.error', 'request', requestId, { action: req && req.action, error: String(e && e.message || e).slice(0, 200) }); }); } catch (e2) { /* ignore */ }
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Reference: ' + requestId }, requestId: requestId };
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  var body = e && e.postData && e.postData.contents || '';
  if (body.length > TD.MAX_BODY_BYTES) return json_({ ok: false, error: { code: 'TOO_LARGE', message: 'Request too large.' } });
  var req; try { req = JSON.parse(body); } catch (err) { return json_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }); }
  if (req && req.entry && e.parameter && e.parameter.wa_secret) {            // WhatsApp status webhook
    var secret = Props.get('WA_WEBHOOK_SECRET');
    if (!secret || !Util.constEq(e.parameter.wa_secret, secret)) return json_({ ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden.' } });
    return json_({ ok: true, updated: Runtime.withLock(function () { Db.reset(); return Notifications.webhookStatus(req); }) });
  }
  return json_(handle_(req));
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p['hub.mode'] === 'subscribe') {                                        // WhatsApp webhook verification handshake
    var tok = Props.get('WA_VERIFY_TOKEN');
    if (tok && Util.constEq(p['hub.verify_token'] || '', tok)) return ContentService.createTextOutput(String(p['hub.challenge'] || ''));
    return ContentService.createTextOutput('forbidden');
  }
  if (p.verify !== undefined) return json_(handle_({ action: 'verify.check', params: { id: p.verify } }));
  return json_({ ok: true, service: 'TuitionDesk', version: TD.VERSION });
}

/** Time-driven trigger target (see setupTriggers). */
function runScheduledJobs() { return Jobs.runScheduled(); }
