/** TuitionDesk backend — Push.gs : secure FCM device registration. */
var Push = (function () {

  function getSession(ctx) {
    if (!ctx || !ctx.session || !ctx.session.userId) {
      throw new ApiError('UNAUTHENTICATED', 'Please sign in.');
    }
    return ctx.session;
  }

  function validateToken(value) {
    if (typeof value !== 'string') {
      throw new ApiError('VALIDATION', 'A valid FCM token is required.');
    }

    var token = value.trim();

    if (token.length < 20 || token.length > 4096) {
      throw new ApiError('VALIDATION', 'Invalid FCM token length.');
    }

    return token;
  }

  function register(ctx, p) {
    var session = getSession(ctx);
    var token = validateToken(p.token);

    // Never trust account identity or role supplied by the browser.
    var deviceId = Util.sha256Hex(token);
    var platform = String(p.platform || 'web').slice(0, 30);
    var userAgent = String(p.userAgent || '').slice(0, 300);
    var existing = Db.get('PushDevices', deviceId);

    var record = {
      device_id: deviceId,
      user_id: session.userId,
      role: session.role,
      student_id: session.studentId || '',
      fcm_token: token,
      platform: platform,
      user_agent: userAgent,
      status: 'active',
      last_seen_at: Util.nowIso()
    };

    if (existing) {
      Db.update('PushDevices', deviceId, record);
    } else {
      record.created_at = Util.nowIso();
      Db.insert('PushDevices', record);
    }

    Audit.log(ctx, 'push.device_registered', 'push_device', deviceId, {
      platform: platform
    });

    return { registered: true };
  }

  function unregister(ctx, p) {
    var session = getSession(ctx);
    var token = validateToken(p.token);
    var deviceId = Util.sha256Hex(token);
    var existing = Db.get('PushDevices', deviceId);

    // A user can only deactivate their own device.
    if (!existing || existing.user_id !== session.userId) {
      return { removed: false };
    }

    Db.update('PushDevices', deviceId, {
      status: 'inactive',
      fcm_token: ''
    });

    Audit.log(ctx, 'push.device_unregistered', 'push_device', deviceId, {});

    return { removed: true };
  }

  function status(ctx) {
    var session = getSession(ctx);

    var devices = Db.filter('PushDevices', function (d) {
      return d.user_id === session.userId && d.status === 'active';
    });

    // Never return FCM tokens to the frontend.
    return {
      enabled: devices.length > 0,
      deviceCount: devices.length
    };
  }

  return {
    register: register,
    unregister: unregister,
    status: status
  };

})();