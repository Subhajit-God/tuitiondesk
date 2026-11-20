/** In-app, Firebase push and email notifications for authenticated TuitionDesk accounts. */
var NotificationHub = (function () {
  var CATEGORIES = ['announcements','homework','timetable','results','fees','attendance','system'];
  function policy(category, mandatory) {
    if (mandatory) return { push: true, email: true, enabled: true };
    if (!Settings.get('app_notifications_enabled')) return { push: false, email: false, enabled: false };
    return { enabled: !!Settings.get('app_category_' + category), push: !!Settings.get('app_push_enabled'), email: !!Settings.get('app_email_enabled') };
  }
  function b64(v) { return Utilities.base64EncodeWebSafe(v).replace(/=+$/g, ''); }
  function accessToken() {
    var cache = CacheService.getScriptCache(), saved = cache.get('td_fcm_access_token');
    if (saved) return saved;
    var raw = Props.get('FCM_SERVICE_ACCOUNT_JSON');
    if (!raw) return '';
    var sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
    if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error('Firebase service account JSON is missing required fields.');
    var now = Math.floor(Util.now().getTime() / 1000);
    var head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    var claim = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3500 }));
    var unsigned = head + '.' + claim;
    var sig = b64(Utilities.computeRsaSha256Signature(unsigned, sa.private_key));
    var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }, muteHttpExceptions: true });
    var body = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !body.access_token) throw new Error('Firebase OAuth token request failed.');
    cache.put('td_fcm_access_token', body.access_token, Math.max(60, Math.min(3500, Number(body.expires_in || 3600) - 60)));
    return body.access_token;
  }
  function push(user, title, body, link) {
    var devices = Db.filter('PushDevices', function (d) { return d.user_id === user.user_id && d.status === 'active' && d.fcm_token; });
    if (!devices.length) return 'no_device';
    var token = accessToken(); if (!token) return 'not_configured';
    var project = JSON.parse(Props.get('FCM_SERVICE_ACCOUNT_JSON')).project_id, ok = 0;
    devices.forEach(function (d) {
      var res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + project + '/messages:send', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ message: { token: d.fcm_token, notification: { title: title, body: body }, data: { title: title, body: body, link: link || './#/notifications' }, webpush: { notification: { title: title, body: body, icon: '/icon-192.png', badge: '/icon-192.png' } } } }), muteHttpExceptions: true });
      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) ok++;
      else if (/UNREGISTERED|registration-token-not-registered/i.test(res.getContentText() || '')) Db.update('PushDevices', d.device_id, { status: 'inactive', fcm_token: '' });
    });
    return ok ? 'accepted_by_fcm' : 'failed';
  }
  function emailAddress(user) {
    if (user.role === ROLES.STUDENT && user.student_id) { var st = Db.get('Students', user.student_id); return st && st.contact_email || ''; }
    return user.recovery_email || Settings.get('centre_email') || '';
  }
  function deliver(user, n, channels) {
    var p = { push: 'not_requested', email: 'not_requested' };
    if (channels.push) { try { p.push = push(user, n.title, n.body, n.link); } catch (e) { p.push = 'failed'; } }
    if (channels.email) {
      var to = emailAddress(user);
      if (!to) p.email = 'no_email';
      else try { MailApp.sendEmail({ to: to, subject: n.title, body: n.body + (n.link ? '\n\nOpen TuitionDesk: ' + n.link : ''), name: Settings.get('centre_name') || 'TuitionDesk' }); p.email = 'accepted_by_mail_service'; }
      catch (e2) { p.email = 'failed'; }
    }
    return p;
  }
  function notifyUsers(ctx, users, spec) {
    var mandatory = !!spec.mandatory, cat = CATEGORIES.indexOf(spec.category) >= 0 ? spec.category : 'system';
    var pol = policy(cat, mandatory), requested = spec.channels || {};
    var channels = { push: pol.push && (requested.push !== false), email: pol.email && (requested.email !== false) };
    if (!mandatory && !pol.enabled) return { created: 0, skipped: users.length, reason: 'Category disabled by Teacher policy.' };
    var count = 0;
    users.forEach(function (u) {
      if (!u || u.status !== 'active') return;
      var id = Util.newId('appn');
      Db.insert('AppNotifications', { notification_id: id, user_id: u.user_id, role: u.role, title: V.str(spec.title, 'title', { required: true, min: 1, max: 120 }), body: V.str(spec.body, 'body', { required: true, min: 1, max: 2000 }), category: cat, priority: spec.priority === 'high' ? 'high' : 'normal', mandatory: mandatory, related_type: spec.relatedType || '', related_id: spec.relatedId || '', sent_by: ctx && ctx.session ? ctx.session.userId : '', push_requested: channels.push, email_requested: channels.email, read_at: '', push_status: channels.push ? 'queued' : 'not_requested', email_status: channels.email ? 'queued' : 'not_requested', delivery_note: '' });
      if (ctx && ctx.afterCommit) ctx.afterCommit.push(function () { deliverPending(id); });
      count++;
    });
    return { created: count, skipped: users.length - count };
  }
  function deliverPending(id) {
    var snapshot = Runtime.withLock(function () { Db.reset(); var n = Db.get('AppNotifications', id); if (!n || (n.push_status !== 'queued' && n.email_status !== 'queued')) return null; var u = Db.get('Users', n.user_id); if (!u || u.status !== 'active') return null; return { row:n, user:u }; });
    if (!snapshot) return;
    var result = deliver(snapshot.user, snapshot.row, { push: !!snapshot.row.push_requested, email: !!snapshot.row.email_requested });
    Runtime.withLock(function () { Db.reset(); Db.update('AppNotifications', id, { push_status: result.push, email_status: result.email, delivery_note: 'Provider acceptance is not proof of delivery.' }); });
  }
  function notifyStudents(ctx, students, spec) {
    var users = [];
    (students || []).forEach(function (st) { var u = st && st.user_id ? Db.get('Users', st.user_id) : null; if (u && u.status === 'active') users.push(u); });
    return notifyUsers(ctx, users, spec);
  }
  function myUser(ctx) { return Db.get('Users', ctx.session.userId); }
  function list(ctx, p) {
    var rows = Db.filter('AppNotifications', function (n) { return n.user_id === ctx.session.userId || (ctx.session.role === ROLES.TEACHER && n.sent_by === ctx.session.userId); }).sort(function (a,b) { return a.created_at < b.created_at ? 1 : -1; });
    var users = {}; Db.all('Users').forEach(function (u) { users[u.user_id] = u.display_name || u.username; });
    var out = Util.paginate(rows.map(function (n) { return { notificationId:n.notification_id,title:n.title,body:n.body,category:n.category,priority:n.priority,mandatory:n.mandatory,read:!!n.read_at,readAt:n.read_at,createdAt:n.created_at,pushStatus:n.push_status,emailStatus:n.email_status,recipientName:users[n.user_id] || '',sentByMe:n.sent_by === ctx.session.userId && n.user_id !== ctx.session.userId }; }), p || {});
    out.unread = rows.filter(function (n) { return n.user_id === ctx.session.userId && !n.read_at; }).length; return out;
  }
  function markRead(ctx, p) {
    var id = V.id(p.notificationId, 'notificationId'), n = Db.get('AppNotifications', id);
    if (!n || n.user_id !== ctx.session.userId) throw new ApiError('NOT_FOUND', 'Notification not found.');
    if (!n.read_at) Db.update('AppNotifications', id, { read_at: Util.nowIso() });
    return { read: true };
  }
  function send(ctx, p) {
    var type = V.oneOf(p.targetType, 'targetType', ['students','teachers','everyone','student','teacher','batch'], { required:true });
    var category = V.oneOf(p.category || 'announcements', 'category', CATEGORIES, { required:true });
    var users = [];
    if (type === 'teachers' || type === 'everyone' || type === 'teacher') users = users.concat(Db.filter('Users', function (u) { return u.role === ROLES.TEACHER && u.status === 'active' && (type !== 'teacher' || u.user_id === p.targetId); }));
    if (type === 'students' || type === 'everyone' || type === 'student' || type === 'batch') {
      var students = Db.filter('Students', function (s) { return s.status === 'active' && (type !== 'student' || s.student_id === p.targetId); });
      if (type === 'batch') { var linked = {}; Db.filter('StudentBatchLinks', function (l) { return l.batch_id === p.targetId && l.status === 'active'; }).forEach(function (l) { linked[l.student_id] = 1; }); students = students.filter(function (s) { return !!linked[s.student_id]; }); }
      students.forEach(function (s) { var u = Db.get('Users', s.user_id); if (u && u.status === 'active') users.push(u); });
    }
    if (!users.length) throw new ApiError('NOT_FOUND', 'No active accounts match this audience.');
    var result = notifyUsers(ctx, users, { title:p.title, body:p.body, category:category, priority:p.priority, channels:p.channels || {}, relatedType:'teacher_broadcast' });
    Audit.log(ctx, 'notification.broadcast', 'notification', '', { targetType:type, recipientCount:result.created, category:category });
    return result;
  }
  return { notifyUsers:notifyUsers, notifyStudents:notifyStudents, list:list, markRead:markRead, send:send, deliverPending:deliverPending };
})();
