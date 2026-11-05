/**
 * TuitionDesk backend — Mfa.gs : optional two-step sign-in for the Teacher account.
 *
 *  Factors (any ONE is accepted as the second step of sign-in, after the password):
 *   1. Authenticator app code: RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s, +-1 step). A code is accepted once only.
 *   2. Printed recovery code: 10 single-use codes (XXXX-XXXX-XXXX, 60 bits) shown once; only SHA-256 hashes are stored.
 *   3. Emailed code: 8 digits, valid 10 minutes, only to a recovery address the Teacher has confirmed. Max 3 sends per hour.
 *  Forgotten password: needs TWO different factors from the list above (so a lost printed sheet alone cannot take over the account).
 *  All second-step attempts share one throttle (5 failures -> 15 minute lock). Secrets are never written to the audit log.
 *  Email goes through Google MailApp; "sent" means handed to Google's mail service, not delivered.
 */
var Mfa = (function () {
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', ISSUER = 'TuitionDesk', RC_COUNT = 10;

  function cacheGet(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
  function cachePut(k, v, s) { try { CacheService.getScriptCache().put(k, v, s); } catch (e) { /* optional */ } }
  function cacheDel(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { /* ignore */ } }
  function b32enc(bytes) {
    var bits = '', out = '', i;
    for (i = 0; i < bytes.length; i++) bits += ('0000000' + bytes[i].toString(2)).slice(-8);
    for (i = 0; i + 5 <= bits.length; i += 5) out += B32.charAt(parseInt(bits.substr(i, 5), 2));
    return out;
  }
  function b32dec(s) {
    var bits = '', out = [], i; s = String(s).toUpperCase().replace(/=+$/, '');
    for (i = 0; i < s.length; i++) { var v = B32.indexOf(s.charAt(i)); if (v < 0) return null; bits += ('00000' + v.toString(2)).slice(-5); }
    for (i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.substr(i, 8), 2));
    return out;
  }
  function signed(arr) { return arr.map(function (b) { return b > 127 ? b - 256 : b; }); }
  function randomBytes(n, salt) {
    var hex = Util.sha256Hex(Util.uuid() + Util.uuid() + Util.uuid() + ':' + salt + ':' + Util.now().getTime()), out = [];
    for (var i = 0; i < n; i++) out.push(parseInt(hex.substr(i * 2, 2), 16));
    return out;
  }
  function hotp(secretB32, counter) {
    var key = b32dec(secretB32); if (!key) return '';
    var hi = Math.floor(counter / 4294967296), lo = counter % 4294967296, msg = [];
    [hi, lo].forEach(function (w) { msg.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255); });
    var h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, signed(msg), signed(key)).map(function (b) { return b & 255; });
    var o = h[h.length - 1] & 15, bin = ((h[o] & 127) * 16777216) + (h[o + 1] << 16) + (h[o + 2] << 8) + h[o + 3];
    return Util.pad(bin % 1000000, 6);
  }
  /** TOTP secrets are stored sealed (XOR with an HMAC keystream keyed by Script Property MFA_KEY), so a copy of the sheet or a backup alone cannot generate codes. */
  function sealKey() { var k = Props.get('MFA_KEY'); if (!k) { k = Util.uuid() + Util.uuid(); Props.set('MFA_KEY', k); } return k; }
  function keystream(uid, n) { var h = Utilities.computeHmacSha256Signature('totp:' + uid, sealKey()).map(function (b) { return b & 255; }); return h.slice(0, n); }
  function seal(uid, secret) { var ks = keystream(uid, secret.length), out = []; for (var i = 0; i < secret.length; i++) out.push((secret.charCodeAt(i) ^ ks[i]) & 255); return Utilities.base64Encode(signed(out)); }
  function unseal(uid, sealed) {
    if (!sealed) return ''; var raw = Utilities.base64Decode(sealed).map(function (b) { return b & 255; }), ks = keystream(uid, raw.length), out = '';
    for (var i = 0; i < raw.length; i++) out += String.fromCharCode(raw[i] ^ ks[i]); return out;
  }
  function stepNow() { return Math.floor(Util.now().getTime() / 30000); }
  /** Returns the matching time step (> minStep) or -1. Always checks all three windows. */
  function matchTotp(secret, code, minStep) {
    var hit = -1, now = stepNow();
    for (var d = -1; d <= 1; d++) { var s = now + d; if (Util.constEq(hotp(secret, s), code) && s > minStep && hit < 0) hit = s; }
    return hit;
  }
  function rcHash(uid, code) { return Util.sha256Hex('rc:' + uid + ':' + code); }
  function ecHash(uid, code) { return Util.sha256Hex('ec:' + uid + ':' + code); }
  function newRecoveryCodes(uid) {
    var codes = [], rec = [];
    for (var i = 0; i < RC_COUNT; i++) {
      var raw = b32enc(randomBytes(8, 'rc' + i)).slice(0, 12), code = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
      codes.push(code); rec.push({ h: rcHash(uid, raw), used: '' });
    }
    return { codes: codes, stored: JSON.stringify(rec) };
  }
  function recList(u) { try { return JSON.parse(u.recovery_hashes || '[]'); } catch (e) { return []; } }
  function remaining(u) { return recList(u).filter(function (r) { return !r.used; }).length; }
  function normalise(code) { return String(code || '').toUpperCase().replace(/[\s\-]/g, ''); }
  function mask(email) { var p = String(email || '').split('@'); return p.length === 2 ? p[0].charAt(0) + '***@' + p[1] : ''; }
  function failKey(uid) { return 'mfaf_' + uid; }
  function checkLock(uid) { if (parseInt(cacheGet(failKey(uid)) || '0', 10) >= TD.LOGIN_MAX_FAILS) throw new ApiError('RATE_LIMITED', 'Too many incorrect codes. Try again in 15 minutes.'); }
  function noteFail(uid, ctxName) {
    cachePut(failKey(uid), String(parseInt(cacheGet(failKey(uid)) || '0', 10) + 1), TD.LOGIN_LOCK_SECONDS);
    Audit.log({ actor: uid, actorRole: ROLES.TEACHER }, 'mfa.failed', 'user', uid, { where: ctxName || '' });
  }
  function teacherByUsername(name) { return Db.find('Users', function (x) { return x.username === String(name || '').toLowerCase() && x.role === ROLES.TEACHER && x.status === 'active'; }); }
  function pwOk(u, pw) { return Util.constEq(Auth.hashPw(String(pw || ''), u.salt, u.iterations), u.password_hash); }
  function needPassword(ctx, p) {
    var u = Db.get('Users', ctx.session.userId);
    if (!pwOk(u, p.password)) throw new ApiError('AUTH_FAILED', 'Password is incorrect.');
    return u;
  }
  function validEmail(e) { return typeof e === 'string' && e.length <= 120 && /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[A-Za-z]{2,}$/.test(e); }

  /** Check one code against every factor the user has. Returns {kind, commit()} or null. Never consumes anything itself. */
  function identify(u, raw) {
    var code = normalise(raw), step;
    if (/^\d{6}$/.test(code) && u.totp_enabled) {
      step = matchTotp(unseal(u.user_id, u.totp_secret), code, u.totp_last_step || 0);
      return step >= 0 ? { kind: 'totp', commit: function () { Db.update('Users', u.user_id, { totp_last_step: step }); } } : null;
    }
    if (/^\d{8}$/.test(code)) {
      var stored = cacheGet('mfae_' + u.user_id);
      return stored && Util.constEq(stored, ecHash(u.user_id, code)) ? { kind: 'email', commit: function () { cacheDel('mfae_' + u.user_id); } } : null;
    }
    if (/^[A-Z2-7]{12}$/.test(code)) {
      var list = recList(u), h = rcHash(u.user_id, code), idx = -1;
      list.forEach(function (r, i) { if (Util.constEq(r.h, h) && !r.used && idx < 0) idx = i; });
      return idx >= 0 ? { kind: 'recovery', commit: function () { list[idx].used = Util.nowIso(); Db.update('Users', u.user_id, { recovery_hashes: JSON.stringify(list) }); } } : null;
    }
    return null;
  }
  function sendMail(to, subject, body) {
    try { MailApp.sendEmail({ to: to, subject: subject, body: body, name: Settings.get('centre_name') || 'TuitionDesk' }); }
    catch (e) { throw new ApiError('EMAIL_FAILED', 'The email could not be handed to Google\'s mail service (' + String(e.message || e).slice(0, 100) + '). Use an authenticator or recovery code instead.'); }
  }
  function emailRate(uid) {
    var k = 'mfaes_' + uid, n = parseInt(cacheGet(k) || '0', 10);
    if (n >= 3) throw new ApiError('RATE_LIMITED', 'Too many emails requested. Try again in an hour.');
    cachePut(k, String(n + 1), 3600);
  }
  function makeEmailCode(uid) {
    var hex = Util.sha256Hex(Util.uuid() + Util.uuid() + ':ec:' + Util.now().getTime()), n = 0;
    for (var i = 0; i < 7; i++) n = n * 256 + parseInt(hex.substr(i * 2, 2), 16);
    var code = Util.pad(n % 100000000, 8); cachePut('mfae_' + uid, ecHash(uid, code), 600); return code;
  }
  function login(u) { return Auth.completeLogin(u); }

  return {
    status: function (ctx) {
      var u = Db.get('Users', ctx.session.userId);
      return { enabled: !!u.totp_enabled, recoveryCodesRemaining: u.totp_enabled ? remaining(u) : 0, recoveryEmail: mask(u.recovery_email), pendingSetup: !!u.totp_pending };
    },

    /** Step 1 of enrolment: needs the current password. Returns the secret ONCE for the QR code / manual entry. */
    begin: function (ctx, p) {
      var u = needPassword(ctx, p);
      if (u.totp_enabled) throw new ApiError('CONFLICT', 'Two-step sign-in is already on. Turn it off first to enrol a new device.');
      var secret = b32enc(randomBytes(20, 'totp'));
      Db.update('Users', u.user_id, { totp_pending: seal(u.user_id, secret) });
      var account = u.username + '@' + (Settings.get('centre_name') || ISSUER);
      return { secret: secret, otpauthUri: 'otpauth://totp/' + encodeURIComponent(ISSUER + ':' + account) + '?secret=' + secret + '&issuer=' + encodeURIComponent(ISSUER) + '&algorithm=SHA1&digits=6&period=30', account: account };
    },
    /** Step 2: prove the app works by entering a current code. Only then is it switched on. */
    enable: function (ctx, p) {
      var u = Db.get('Users', ctx.session.userId);
      if (u.totp_enabled) throw new ApiError('CONFLICT', 'Already enabled.');
      if (!u.totp_pending) throw new ApiError('CONFLICT', 'Start setup first.');
      checkLock(u.user_id);
      var step = matchTotp(unseal(u.user_id, u.totp_pending), normalise(p.code), 0);
      if (step < 0) { noteFail(u.user_id, 'enable'); throw new ApiError('AUTH_FAILED', 'That code is not correct. Check the time on your phone and try again.'); }
      var rc = newRecoveryCodes(u.user_id);
      Db.update('Users', u.user_id, { totp_secret: u.totp_pending, totp_pending: '', totp_enabled: true, totp_last_step: step, recovery_hashes: rc.stored });
      Auth.revokeUserSessions(u.user_id, ctx.session.hash);
      Audit.log(ctx, 'mfa.enabled', 'user', u.user_id, {});
      return { enabled: true, recoveryCodes: rc.codes };
    },
    disable: function (ctx, p) {
      var u = needPassword(ctx, p); if (!u.totp_enabled) throw new ApiError('CONFLICT', 'Two-step sign-in is not on.');
      checkLock(u.user_id);
      var f = identify(u, p.code); if (!f) { noteFail(u.user_id, 'disable'); throw new ApiError('AUTH_FAILED', 'That code is not correct.'); }
      f.commit();
      Db.update('Users', u.user_id, { totp_secret: '', totp_pending: '', totp_enabled: false, totp_last_step: 0, recovery_hashes: '' });
      Auth.revokeUserSessions(u.user_id, ctx.session.hash);
      Audit.log(ctx, 'mfa.disabled', 'user', u.user_id, { via: f.kind });
      return { enabled: false };
    },
    regenerateRecovery: function (ctx, p) {
      var u = needPassword(ctx, p); if (!u.totp_enabled) throw new ApiError('CONFLICT', 'Two-step sign-in is not on.');
      checkLock(u.user_id);
      var f = identify(u, p.code); if (!f || f.kind !== 'totp') { noteFail(u.user_id, 'regen'); throw new ApiError('AUTH_FAILED', 'Enter a current authenticator code.'); }
      f.commit(); var rc = newRecoveryCodes(u.user_id);
      Db.update('Users', u.user_id, { recovery_hashes: rc.stored });
      Audit.log(ctx, 'mfa.recovery_regenerated', 'user', u.user_id, {});
      return { recoveryCodes: rc.codes };
    },

    /** Recovery email must be CONFIRMED by a code sent to it, so a typo can never hand a stranger a login factor. */
    emailStart: function (ctx, p) {
      var u = needPassword(ctx, p); if (!u.totp_enabled) throw new ApiError('CONFLICT', 'Turn on two-step sign-in first.');
      var email = String(p.email || '').trim().toLowerCase(); if (!validEmail(email)) V.fail('email', 'is not a valid email address');
      emailRate(u.user_id);
      var code = makeEmailCode(u.user_id); cachePut('mfaev_' + u.user_id, email, 600);
      sendMail(email, 'Confirm your recovery email', 'Your confirmation code is ' + code + '. It expires in 10 minutes. If you did not ask for this, ignore this message.');
      Audit.log(ctx, 'mfa.recovery_email_code_sent', 'user', u.user_id, {});
      return { sentTo: mask(email) };
    },
    emailConfirm: function (ctx, p) {
      var u = Db.get('Users', ctx.session.userId), email = cacheGet('mfaev_' + u.user_id); checkLock(u.user_id);
      var f = email ? identify(u, p.code) : null;
      if (!f || f.kind !== 'email') { noteFail(u.user_id, 'email_confirm'); throw new ApiError('AUTH_FAILED', 'That code is not correct or has expired.'); }
      f.commit(); cacheDel('mfaev_' + u.user_id); Db.update('Users', u.user_id, { recovery_email: email });
      Audit.log(ctx, 'mfa.recovery_email_set', 'user', u.user_id, { email: mask(email) });
      return { recoveryEmail: mask(email) };
    },
    emailRemove: function (ctx, p) {
      var u = needPassword(ctx, p); Db.update('Users', u.user_id, { recovery_email: '' }); cacheDel('mfae_' + u.user_id);
      Audit.log(ctx, 'mfa.recovery_email_removed', 'user', u.user_id, {}); return { recoveryEmail: '' };
    },

    /** Called by Auth.login after a correct password for an account with two-step on. No session is issued yet. */
    challenge: function (u) {
      var token = Util.uuid() + Util.uuid();
      cachePut('mfa_' + Util.sha256Hex(token), u.user_id, 300);
      return { mfaRequired: true, mfaToken: token, methods: { authenticator: true, recoveryCode: remaining(u) > 0, email: !!u.recovery_email } };
    },
    verifyLogin: function (ctx, p) {
      var tok = String(p.mfaToken || ''), uid = tok.length >= 40 ? cacheGet('mfa_' + Util.sha256Hex(tok)) : null;
      if (!uid) throw new ApiError('UNAUTHENTICATED', 'That sign-in step expired. Please enter your password again.');
      var u = Db.get('Users', uid); if (!u || u.status !== 'active' || !u.totp_enabled) throw new ApiError('UNAUTHENTICATED', 'Please sign in again.');
      checkLock(uid);
      var f = identify(u, p.code);
      if (!f) { noteFail(uid, 'login'); throw new ApiError('AUTH_FAILED', 'That code is not correct.'); }
      f.commit(); cacheDel('mfa_' + Util.sha256Hex(tok)); cacheDel(failKey(uid));
      Audit.log({ actor: uid, actorRole: ROLES.TEACHER }, 'mfa.login', 'user', uid, { via: f.kind });
      var out = login(u); out.secondFactor = f.kind; if (f.kind === 'recovery') out.recoveryCodesRemaining = remaining(Db.get('Users', uid));
      return out;
    },
    /** Sign-in screen: "Email me a code". Needs the mfaToken (so the password was already correct). */
    emailCodeForLogin: function (ctx, p) {
      var tok = String(p.mfaToken || ''), uid = tok.length >= 40 ? cacheGet('mfa_' + Util.sha256Hex(tok)) : null;
      if (!uid) throw new ApiError('UNAUTHENTICATED', 'That sign-in step expired. Please enter your password again.');
      var u = Db.get('Users', uid); if (!u.recovery_email) throw new ApiError('NOT_CONFIGURED', 'No recovery email is set up.');
      emailRate(uid); var code = makeEmailCode(uid);
      sendMail(u.recovery_email, 'Your sign-in code', 'Your sign-in code is ' + code + '. It expires in 10 minutes. If you did not just try to sign in, someone has your password: change it now.');
      Audit.log({ actor: uid, actorRole: ROLES.TEACHER }, 'mfa.email_code_sent', 'user', uid, {});
      return { sentTo: mask(u.recovery_email) };
    },

    /** Forgotten password, step A (public): email a code if (and only if) a confirmed recovery email exists. Same answer either way. */
    emailCodeForReset: function (ctx, p) {
      var u = teacherByUsername(p.username);
      if (u && u.totp_enabled && u.recovery_email) { emailRate(u.user_id); sendMail(u.recovery_email, 'Password reset code', 'Your password reset code is ' + makeEmailCode(u.user_id) + '. It expires in 10 minutes. If you did not ask for this, ignore it; your password has not changed.'); Audit.log({ actor: u.user_id, actorRole: ROLES.TEACHER }, 'mfa.reset_code_sent', 'user', u.user_id, {}); }
      return { requested: true, note: 'If a recovery email is set up for this account, a code has been sent to it.' };
    },
    /** Forgotten password, step B (public): two codes of two DIFFERENT kinds + a new password. */
    recoverPassword: function (ctx, p) {
      var u = teacherByUsername(p.username), generic = new ApiError('AUTH_FAILED', 'The codes are not correct, or recovery is not set up for this account.');
      if (!u || !u.totp_enabled) { Auth.hashPw('x', 'x', 50); throw generic; }
      checkLock(u.user_id);
      var a = identify(u, p.code1), b = identify(u, p.code2);
      if (!a || !b || a.kind === b.kind) { noteFail(u.user_id, 'reset'); throw generic; }
      Auth.checkStrength(p.newPassword, TD.TEACHER_PW_MIN_LENGTH);
      a.commit(); b.commit();
      Db.update('Users', u.user_id, Object.assign(Auth.makeCred(p.newPassword), { must_change_password: false }));
      Auth.revokeUserSessions(u.user_id); cacheDel('login_' + Util.sha256Hex(u.username.toLowerCase()).slice(0, 24)); cacheDel(failKey(u.user_id));
      Audit.log({ actor: u.user_id, actorRole: ROLES.TEACHER }, 'mfa.password_recovered', 'user', u.user_id, { factors: [a.kind, b.kind] });
      return { changed: true };
    },
    _hotp: hotp, _b32enc: b32enc
  };
})();
