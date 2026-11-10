/** TuitionDesk backend — Auth.gs : password hashing, sessions, login throttling, account recovery. */
var Auth = (function () {
  function iterations() { return parseInt(Props.get('PW_ITERATIONS'), 10) || TD.PW_ITERATIONS_DEFAULT; }

  /** Salted, iterated HMAC-SHA256 (Apps Script has no bcrypt/argon2). Never stores plaintext. */
  function hashPw(pw, salt, iter) {
    var h = Utilities.computeHmacSha256Signature(salt + ':' + pw, salt);
    for (var i = 1; i < iter; i++) h = Utilities.computeHmacSha256Signature(h, salt);
    return Utilities.base64Encode(h);
  }
  function makeCred(pw) {
    var salt = Util.uuid(), it = iterations();
    return { salt: salt, iterations: it, password_hash: hashPw(pw, salt, it) };
  }
  function checkStrength(pw, min) {
    if (typeof pw !== 'string' || pw.length < min) V.fail('password', 'must be at least ' + min + ' characters');
    if (pw.length > 128) V.fail('password', 'is too long');
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) V.fail('password', 'must contain letters and numbers');
  }
  function throttleKey(u) { return 'login_' + Util.sha256Hex(u.toLowerCase()).slice(0, 24); }
  function cacheGet(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
  function cachePut(k, v, s) { try { CacheService.getScriptCache().put(k, v, s); } catch (e) { /* cache optional */ } }
  function cacheDel(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { /* ignore */ } }
  function sessionObj(u, rec) { return { userId: u.user_id, role: u.role, studentId: u.student_id || '', displayName: u.display_name, expiresAt: rec.expires_at }; }
  function publicUser(u) { return { userId: u.user_id, username: u.username, role: u.role, studentId: u.student_id || '', displayName: u.display_name, mustChangePassword: !!u.must_change_password, mfaEnabled: !!u.totp_enabled }; }

  function newSession(u) {
    var token = Util.uuid() + Util.uuid();
    var hash = Util.sha256Hex(token);
    var exp = new Date(Util.now().getTime() + TD.SESSION_TTL_HOURS * 3600 * 1000).toISOString();
    var rec = Db.insert('Sessions', { session_hash: hash, user_id: u.user_id, role: u.role, student_id: u.student_id || '', created_at: Util.nowIso(), expires_at: exp, revoked: false });
    cachePut('sess_' + hash, JSON.stringify(sessionObj(u, rec)), 21000);
    return { token: token, expiresAt: exp };
  }

  return {
    hashPw: hashPw, makeCred: makeCred, checkStrength: checkStrength, publicUser: publicUser,

    teacherExists: function () { return !!Db.find('Users', function (u) { return u.role === ROLES.TEACHER; }); },

    /** One-time creation of the Teacher (Master Admin) account, guarded by a SETUP_KEY script property. */
    bootstrap: function (ctx, p) {
      if (Auth.teacherExists()) throw new ApiError('FORBIDDEN', 'Setup has already been completed.');
      var key = Props.get('SETUP_KEY');
      if (!key) throw new ApiError('SETUP_REQUIRED', 'No setup key exists. Run generateSetupKey() in the Apps Script editor first.');
      var tk = 'boot_fail';
      if (parseInt(cacheGet(tk) || '0', 10) >= 10) throw new ApiError('RATE_LIMITED', 'Too many attempts. Try again later.');
      if (!Util.constEq(String(p.setupKey || ''), key)) { cachePut(tk, String(parseInt(cacheGet(tk) || '0', 10) + 1), 900); throw new ApiError('AUTH_FAILED', 'Invalid setup key.'); }
      var username = V.str(p.username, 'username', { required: true, min: 3, max: 30, re: /^[a-z0-9._-]+$/, reMsg: 'may only use lowercase letters, digits, . _ -' });
      var name = V.str(p.displayName, 'displayName', { required: true, max: 80 });
      checkStrength(p.password, TD.TEACHER_PW_MIN_LENGTH);
      var cred = makeCred(p.password);
      var u = Db.insert('Users', Object.assign({ user_id: Util.newId('usr'), username: username, role: ROLES.TEACHER, student_id: '', display_name: name, status: 'active', must_change_password: false, last_login_at: '' }, cred));
      Props.del('SETUP_KEY');
      Audit.log({ actor: u.user_id, actorRole: ROLES.TEACHER }, 'auth.bootstrap', 'user', u.user_id, { username: username });
      return { created: true };
    },

    login: function (ctx, p) {
      var username = V.str(p.username, 'username', { required: true, max: 60 }).toLowerCase();
      if (typeof p.password !== 'string' || !p.password) V.fail('password', 'is required');
      var tk = throttleKey(username), fails = parseInt(cacheGet(tk) || '0', 10);
      if (fails >= TD.LOGIN_MAX_FAILS) throw new ApiError('RATE_LIMITED', 'Too many failed sign-in attempts. Try again in 15 minutes.');
      var u = Db.find('Users', function (x) { return x.username === username; });
      var ok = false;
      if (u && u.status === 'active') ok = Util.constEq(hashPw(p.password, u.salt, u.iterations), u.password_hash);
      else hashPw(p.password, 'x', iterations()); // equalise timing for unknown users
      if (!ok) {
        cachePut(tk, String(fails + 1), TD.LOGIN_LOCK_SECONDS);
        Audit.log({ actor: u ? u.user_id : 'anonymous', actorRole: u ? u.role : 'none' }, 'auth.login_failed', 'user', u ? u.user_id : '', { username: username });
        throw new ApiError('AUTH_FAILED', 'Incorrect username or password.');
      }
      cacheDel(tk);
      if (u.role === ROLES.TEACHER && u.totp_enabled) return Mfa.challenge(u);   // second step required: no session yet
      return Auth.completeLogin(u);
    },

    /** Issues the session. Called after the password (and, for a Teacher with two-step on, the second factor) succeeded. */
    completeLogin: function (u) {
      Db.update('Users', u.user_id, { last_login_at: Util.nowIso() });
      var s = newSession(u);
      return { token: s.token, expiresAt: s.expiresAt, user: publicUser(Db.get('Users', u.user_id)), environment: Props.get('ENVIRONMENT') || 'production' };
    },

    /** Resolves a bearer token to a session. Role and student scope come ONLY from here. */
    authenticate: function (token) {
      if (typeof token !== 'string' || token.length < 40) throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
      var hash = Util.sha256Hex(token), s = null, c = cacheGet('sess_' + hash);
      if (c) { try { s = JSON.parse(c); } catch (e) { s = null; } }
      if (!s) {
        var rec = Db.get('Sessions', hash);
        if (rec && !rec.revoked) { var u = Db.get('Users', rec.user_id); if (u) s = sessionObj(u, rec); }
      }
      if (!s || new Date(s.expiresAt) < Util.now()) throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
      var user = Db.get('Users', s.userId);
      if (!user || user.status !== 'active') throw new ApiError('UNAUTHENTICATED', 'This account is not active.');
      s.role = user.role; s.studentId = user.student_id || ''; s.mustChangePassword = !!user.must_change_password; s.hash = hash;
      return s;
    },

    logout: function (ctx) {
      Db.update('Sessions', ctx.session.hash, { revoked: true });
      cacheDel('sess_' + ctx.session.hash);
      return { loggedOut: true };
    },

    me: function (ctx) {
      var u = Db.get('Users', ctx.session.userId);
      return { user: publicUser(u), environment: Props.get('ENVIRONMENT') || 'production', serverTime: Util.nowIso(), centreName: Settings.get('centre_name') };
    },

    changePassword: function (ctx, p) {
      var u = Db.get('Users', ctx.session.userId);
      if (!Util.constEq(hashPw(String(p.currentPassword || ''), u.salt, u.iterations), u.password_hash)) throw new ApiError('AUTH_FAILED', 'Current password is incorrect.');
      checkStrength(p.newPassword, u.role === ROLES.TEACHER ? TD.TEACHER_PW_MIN_LENGTH : TD.PW_MIN_LENGTH);
      if (p.newPassword === p.currentPassword) V.fail('newPassword', 'must differ from the current password');
      Db.update('Users', u.user_id, Object.assign(makeCred(p.newPassword), { must_change_password: false }));
      Auth.revokeUserSessions(u.user_id, ctx.session.hash);
      Audit.log(ctx, 'auth.change_password', 'user', u.user_id, {});
      return { changed: true };
    },

    revokeUserSessions: function (userId, exceptHash) {
      Db.filter('Sessions', function (s) { return s.user_id === userId && !s.revoked && s.session_hash !== exceptHash; })
        .forEach(function (s) { Db.update('Sessions', s.session_hash, { revoked: true }); cacheDel('sess_' + s.session_hash); });
    },

    /** Teacher-run account recovery for a Student (no email/SMS dependency). */
    resetStudentPassword: function (ctx, p) {
      var st = Db.get('Students', V.id(p.studentId, 'studentId'));
      if (!st || !st.user_id) throw new ApiError('NOT_FOUND', 'Student account not found.');
      var pw = p.newPassword ? p.newPassword : Auth.generatePassword();
      checkStrength(pw, TD.PW_MIN_LENGTH);
      Db.update('Users', st.user_id, Object.assign(makeCred(pw), { must_change_password: true, status: 'active' }));
      Auth.revokeUserSessions(st.user_id);
      cacheDel(throttleKey(Db.get('Users', st.user_id).username));
      Audit.log(ctx, 'auth.reset_student_password', 'user', st.user_id, { studentId: st.student_id });
      return { temporaryPassword: pw, mustChangePassword: true };
    },

    setStudentAccountStatus: function (ctx, studentId, active) {
      var st = Db.get('Students', studentId);
      if (st && st.user_id) {
        Db.update('Users', st.user_id, { status: active ? 'active' : 'disabled' });
        if (!active) Auth.revokeUserSessions(st.user_id);
      }
    },

    generatePassword: function () {
      var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', hex = Util.uuid();
      for (var i = 0; i < 10; i++) out += chars[parseInt(hex.substr(i * 3, 3), 16) % chars.length];
      return out + '7a';
    },

    createStudentUser: function (username, displayName, studentId, password) {
      var existing = Db.find('Users', function (u) { return u.username === username; });
      if (existing) throw new ApiError('CONFLICT', 'That username is already taken.', { field: 'username' });
      checkStrength(password, TD.PW_MIN_LENGTH);
      return Db.insert('Users', Object.assign({ user_id: Util.newId('usr'), username: username, role: ROLES.STUDENT, student_id: studentId, display_name: displayName, status: 'active', must_change_password: true, last_login_at: '' }, makeCred(password)));
    },

    purgeExpiredSessions: function () {
      var now = Util.now(), n = 0;
      Db.filter('Sessions', function (s) { return new Date(s.expires_at) < now || s.revoked; }).forEach(function () { n++; });
      return n; // rows are retained for audit; counted only (sheet row deletion is avoided to keep ids stable)
    }
  };
})();
