/** TuitionDesk backend — Ops.gs : backups/restore tests, scheduled jobs, job monitoring. */
var Backup = (function () {
  function allChecks(ss) { var o = {}; Object.keys(SCHEMA).forEach(function (t) { o[t] = Db.checksum(t, ss); }); return o; }
  function sameChecks(a, b) { var bad = []; Object.keys(a).forEach(function (t) { if (!b[t] || a[t].rows !== b[t].rows || a[t].hash !== b[t].hash) bad.push(t); }); return bad; }
  function log(ctx, kind, started, status, fileId, fileName, details) {
    return Db.insert('BackupLog', { backup_id: Util.newId('bkp'), kind: kind, started_at: started, finished_at: Util.nowIso(), status: status, file_id: fileId || '', file_name: fileName || '', details: JSON.stringify(details).slice(0, TD.MAX_CELL_CHARS - 100), created_by: ctx.session ? ctx.session.userId : 'system' });
  }
  return {
    /** Full spreadsheet copy into the restricted backups folder + checksum verification against the live data. */
    run: function (ctx) {
      var started = Util.nowIso(), folderId = Props.get('BACKUP_FOLDER_ID');
      if (!folderId) throw new ApiError('NOT_CONFIGURED', 'Backup folder is not configured (run setupDatabase()).');
      var ss = Db.getSpreadsheet(), name = 'TuitionDesk-backup-' + started.replace(/[:.]/g, '-');
      var copy = DriveApp.getFileById(ss.getId()).makeCopy(name, DriveApp.getFolderById(folderId));
      var src = allChecks(ss), dst = allChecks(SpreadsheetApp.openById(copy.getId())), bad = sameChecks(src, dst), ok = bad.length === 0;
      var rec = log(ctx, 'backup', started, ok ? 'ok' : 'checksum_mismatch', copy.getId(), name, { tables: dst, mismatched: bad, reconcile: Ledger.reconcile().ok });
      Audit.log(ctx, 'backup.run', 'backup', rec.backup_id, { ok: ok, file: name });
      var trashed = Backup.applyRetention(ctx);
      return { backupId: rec.backup_id, fileName: name, ok: ok, mismatched: bad, trashed: trashed };
    },
    applyRetention: function (ctx) {
      var days = Settings.get('backup_retention_days'), cutoff = new Date(Util.now().getTime() - days * 86400000).toISOString(), n = 0;
      Db.filter('BackupLog', function (b) { return b.kind === 'backup' && b.status === 'ok' && b.finished_at < cutoff && b.file_id; }).forEach(function (b) {
        try { DriveApp.getFileById(b.file_id).setTrashed(true); Db.update('BackupLog', b.backup_id, { status: 'expired' }); n++; } catch (e) { /* already gone */ }
      });
      return n;
    },
    list: function (ctx, p) {
      var rows = Db.all('BackupLog').sort(function (a, b) { return a.started_at < b.started_at ? 1 : -1; }).map(function (b) { var d = {}; try { d = JSON.parse(b.details); } catch (e) { /* ignore */ } return { backupId: b.backup_id, kind: b.kind, startedAt: b.started_at, finishedAt: b.finished_at, status: b.status, fileName: b.file_name, ok: d.ok !== undefined ? d.ok : (b.status === 'ok'), summary: d.mismatched || d.reconcile !== undefined ? { mismatched: d.mismatched || [], reconcile: d.reconcile } : null }; });
      return { items: Util.paginate(rows, p).items, lastBackup: (rows.filter(function (r) { return r.kind === 'backup' && r.status === 'ok'; })[0] || null), lastRestoreTest: (rows.filter(function (r) { return r.kind === 'restore_test'; })[0] || null), configured: !!Props.get('BACKUP_FOLDER_ID') };
    },
    /** Re-open a backup and confirm its contents still match the checksums recorded when it was made. */
    verify: function (ctx, p) {
      var b = Db.get('BackupLog', V.id(p.backupId, 'backupId')); if (!b || b.kind !== 'backup') throw new ApiError('NOT_FOUND', 'Backup not found.');
      var started = Util.nowIso(), recorded = JSON.parse(b.details).tables, now = allChecks(SpreadsheetApp.openById(b.file_id)), bad = sameChecks(recorded, now);
      log(ctx, 'verify', started, bad.length ? 'mismatch' : 'ok', b.file_id, b.file_name, { ok: !bad.length, mismatched: bad });
      return { ok: !bad.length, mismatched: bad };
    },
    /**
     * Restore a backup into a SEPARATE test spreadsheet (never the live one) and prove integrity:
     * per-tab checksums must match the backup, and the ledger must reconcile on the restored data.
     */
    restoreTest: function (ctx, p) {
      var b = Db.get('BackupLog', V.id(p.backupId, 'backupId')); if (!b || b.kind !== 'backup') throw new ApiError('NOT_FOUND', 'Backup not found.');
      var targetId = V.str(p.targetSpreadsheetId, 'targetSpreadsheetId', { required: true, max: 100 }), live = Db.getSpreadsheet();
      if (targetId === live.getId()) throw new ApiError('FORBIDDEN', 'Restore tests can only target a different spreadsheet than the live database.');
      var started = Util.nowIso(), src = SpreadsheetApp.openById(b.file_id), tgt = SpreadsheetApp.openById(targetId), details = { tables: {} };
      Object.keys(SCHEMA).forEach(function (t) {
        var s = src.getSheetByName(t), d = tgt.getSheetByName(t) || tgt.insertSheet(t), vals = s.getLastRow() ? s.getRange(1, 1, s.getLastRow(), SCHEMA[t].length).getValues() : [];
        d.clear(); d.getRange(1, 1, SCHEMA[t].length ? 1 : 1, SCHEMA[t].length).setNumberFormat('@'); if (d.getMaxRows() > 1) d.getRange(1, 1, d.getMaxRows(), SCHEMA[t].length).setNumberFormat('@');
        if (vals.length) d.getRange(1, 1, vals.length, SCHEMA[t].length).setValues(vals);
      });
      var a = allChecks(src), c = allChecks(tgt), bad = sameChecks(a, c), rec = null;
      Db.reset(); Db.setSpreadsheet(tgt);
      try { rec = Ledger.reconcile(); } finally { Db.setSpreadsheet(live); }
      details.ok = !bad.length && rec.ok; details.mismatched = bad; details.reconcile = rec.ok; details.reconcileChecks = rec.checks.map(function (x) { return { name: x.name, ok: x.ok }; }); details.tables = c;
      var row = log(ctx, 'restore_test', started, details.ok ? 'ok' : 'failed', targetId, 'restore-test', details);
      Audit.log(ctx, 'backup.restore_test', 'backup', row.backup_id, { ok: details.ok, mismatched: bad });
      return { ok: details.ok, mismatched: bad, ledgerReconciles: rec.ok, tables: Object.keys(c).length };
    }
  };
})();

var Jobs = (function () {
  function ranFor(job, key) { return !!Db.find('JobRuns', function (j) { return j.job === job && j.status === 'ok' && JSON.parse(j.details || '{}').key === key; }); }
  function record(job, started, status, details) { Db.insert('JobRuns', { run_id: Util.newId('job'), job: job, started_at: started, finished_at: Util.nowIso(), status: status, details: JSON.stringify(details).slice(0, 4000) }); }
  function exec(job, key, fn, force) {
    var started = Util.nowIso();
    if (!force && ranFor(job, key)) return { job: job, skipped: 'already ran for ' + key };
    try { var out = fn() || {}; out.key = key; record(job, started, 'ok', out); return { job: job, ok: true, result: out }; }
    catch (e) { record(job, started, 'error', { key: key, error: String(e.message || e).slice(0, 300) }); return { job: job, ok: false, error: String(e.message || e) }; }
  }
  var SYS = { actor: 'system', actorRole: 'system', afterCommit: [] };
  var JOBS = {
    fee_reminders: function (force) { return exec('fee_reminders', Util.monthOf(Util.today()), function () { return Notifications.queueFeeReminders(SYS, { scheduled: true }); }, force); },
    overdue: function (force) { return exec('overdue', Util.today(), function () { return Notifications.queueOverdue(SYS, {}); }, force); },
    ladder: function (force) { return exec('ladder', Util.today(), function () { return Ladder.run(SYS); }, force); },
    weekly_report: function (force) { var end = Util.today(); return exec('weekly_report', end, function () { return Notifications.queueWeekly(SYS, end); }, force); }
  };
  return {
    /** Hourly time-driven trigger entry point. Safe to re-run: every step is keyed and idempotent. */
    runScheduled: function () {
      var results = [];
      Runtime.withLock(function () {
        Db.reset(); Settings.reset();
        var h = Util.localHour(), today = Util.today(), dom = parseInt(today.slice(8, 10), 10);
        var ladderOn = Settings.get('ladder_enabled');
        if (ladderOn && h >= Settings.get('reminder_hour') && !Notifications.inQuiet()) results.push(JOBS.ladder(false));
        if (!ladderOn && Settings.get('reminders_enabled') && dom === Settings.get('reminder_day') && h >= Settings.get('reminder_hour')) results.push(JOBS.fee_reminders(false));
        if (!ladderOn && Settings.get('overdue_followup_enabled') && h >= Settings.get('reminder_hour')) results.push(JOBS.overdue(false));
        if (Settings.get('weekly_report_enabled') && Util.weekday(today) === 7 && h >= Settings.get('weekly_report_hour')) results.push(JOBS.weekly_report(false));
        var paidCancelled = Ladder.sweepPaid(SYS); if (paidCancelled) results.push({ job: 'ladder_sweep', cancelled: paidCancelled });
        var swept = Notifications.sweepStale(); if (swept) results.push({ job: 'sweep', swept: swept });
        var last = Db.filter('BackupLog', function (b) { return b.kind === 'backup' && b.status === 'ok'; }).sort(function (a, b) { return a.started_at < b.started_at ? 1 : -1; })[0];
        if (Props.get('BACKUP_FOLDER_ID') && (!last || (Util.now() - new Date(last.started_at)) / 86400000 >= Settings.get('backup_frequency_days'))) {
          var started = Util.nowIso();
          try { var b = Backup.run(SYS); results.push({ job: 'backup', ok: b.ok }); } catch (e) { record('backup', started, 'error', { error: String(e.message || e).slice(0, 300) }); results.push({ job: 'backup', ok: false }); }
        }
      });
      try { Notifications.processQueue(20); } catch (e) { Runtime.withLock(function () { Db.reset(); record('notification_queue', Util.nowIso(), 'error', { error: String(e.message || e).slice(0, 300) }); }); }
      return results;
    },
    /** Teacher-initiated run (ignores the schedule gate but keeps idempotency keys, so no duplicates). */
    runNow: function (ctx, p) {
      var job = V.oneOf(p.job, 'job', ['fee_reminders', 'overdue', 'weekly_report', 'ladder'], { required: true });
      SYS.afterCommit = [];
      var r = JOBS[job](true); ctx.afterCommit.push(function () { Notifications.processQueue(20); }); return r;
    },
    status: function (ctx, p) {
      var rows = Db.all('JobRuns').sort(function (a, b) { return a.started_at < b.started_at ? 1 : -1; }).slice(0, 30).map(function (j) { return { runId: j.run_id, job: j.job, startedAt: j.started_at, finishedAt: j.finished_at, status: j.status, details: j.details }; });
      var triggers = []; try { triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) { /* not available */ }
      return { runs: rows, triggerInstalled: triggers.indexOf('runScheduledJobs') >= 0, timezone: Util.tz(), messaging: 'self' };
    }
  };
})();
