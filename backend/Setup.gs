/**
 * TuitionDesk backend — Setup.gs : run these functions manually from the Apps Script editor.
 *  1. setupDatabase()      creates tabs, restricted Drive folders, ENVIRONMENT property
 *  2. generateSetupKey()   prints a one-time key (Execution log) used to create the Teacher account in the app
 *  3. setupTriggers()      installs the hourly scheduled-jobs trigger
 *  4. showConfigStatus()   prints what is / isn't configured (never prints secrets)
 */
function setupDatabase() {
  var made = Db.init();
  if (!Props.get('ENVIRONMENT')) Props.set('ENVIRONMENT', 'production');
  var ss = Db.getSpreadsheet();
  if (!Props.get('SPREADSHEET_ID')) Props.set('SPREADSHEET_ID', ss.getId());
  var parent = DriveApp.getFileById(ss.getId()).getParents(), root = parent.hasNext() ? parent.next() : DriveApp.getRootFolder();
  if (!Props.get('DOCS_FOLDER_ID')) { var d = root.createFolder('TuitionDesk Documents (private)'); d.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); Props.set('DOCS_FOLDER_ID', d.getId()); }
  if (!Props.get('BACKUP_FOLDER_ID')) { var b = root.createFolder('TuitionDesk Backups (private)'); b.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); Props.set('BACKUP_FOLDER_ID', b.getId()); }
  Logger.log('Tabs created: ' + (made.join(', ') || '(none — already existed)'));
  Logger.log('Next: run generateSetupKey(), deploy as a web app, then create the Teacher account in the app.');
}
function generateSetupKey() {
  if (Auth.teacherExists()) { Logger.log('A Teacher account already exists. No setup key needed.'); return; }
  var key = Util.uuid().slice(0, 16); Props.set('SETUP_KEY', key);
  Logger.log('One-time setup key (enter it on the first-run screen; it is deleted after use): ' + key);
}
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runScheduledJobs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runScheduledJobs').timeBased().everyHours(1).create();
  Logger.log('Hourly trigger installed. Script time zone: ' + Session.getScriptTimeZone() + ' (centre time zone setting is used for schedules).');
}
function showConfigStatus() {
  Db.reset(); Settings.reset();
  Logger.log(JSON.stringify({ environment: Props.get('ENVIRONMENT'), spreadsheet: !!Props.get('SPREADSHEET_ID'), docsFolder: !!Props.get('DOCS_FOLDER_ID'), backupFolder: !!Props.get('BACKUP_FOLDER_ID'),
    teacherAccount: Auth.teacherExists(), whatsappApi: Notifications.apiConfigured(), paymentCallbacks: !!Props.get('PAYMENT_WEBHOOK_SECRET'), waWebhookSecret: !!Props.get('WA_WEBHOOK_SECRET'), centreName: !!Settings.get('centre_name'),
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) }, null, 2));
}
