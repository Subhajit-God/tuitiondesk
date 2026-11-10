# Backup and recovery

## What is backed up
Backup = a full copy of the database spreadsheet, stored in the private "TuitionDesk Backups" Drive folder, with a row count and checksum per tab. Generated PDFs are already stored in the private documents folder. Backups run automatically every *N* days (Settings) when the hourly trigger is installed, or on demand: **Audit Logs & Backups → Back up now**. Old backups are trashed after the retention period.

## Check backups regularly
1. **Verify**: re-reads the backup file and compares it to the checksums recorded when it was made.
2. **Restore test** (do this monthly and after any big change): create a *blank* Google Sheet, copy its ID, press Restore test. The app copies every tab into the blank sheet, compares counts and checksums, and re-runs the ledger reconciliation on the restored data. It refuses to target the live database. The result is logged.

## If the live data is damaged or lost
1. Stop using the app (tell students it is under maintenance).
2. Open the latest good backup in Drive (use the restore-test result and `backup.verify` to pick one). Make a copy.
3. Either (a) rename the damaged sheet, and make the backup copy the database: open its Apps Script (copy the `.gs` files in, or "Make a copy" of the original script-bound sheet) and run `setupDatabase` after setting Script property `SPREADSHEET_ID` to the new sheet's ID, then redeploy a new version; or (b) copy rows from the backup tabs back into the live tabs (keep the header row).
4. Open **Fees & Payments → Ledger check**. It must show all checks passed.
5. Anything recorded after the backup time must be re-entered; payments received in that gap are in your bank/UPI records.

**This production restore procedure is manual and has not been rehearsed on real Google services from the build environment.** Rehearse it once with test data before you need it. Only the restore *test* (into a blank sheet) is automated.

## Teacher locked out
**With two-step sign-in on (recommended)** you rarely need this: use a printed recovery code or the emailed code to sign in, or "Teacher: forgot your password?" (two different proofs) to reset the password. See the Teacher guide.

**Last resort, only if you have lost the password AND every second factor.** You, as owner of the Google Sheet, can recover: in the `Users` tab delete the row whose `role` is `teacher`, run `generateSetupKey` in Apps Script, then create the Teacher account again on the first-run screen (two-step sign-in must be set up again). Student records, fees and history are untouched. Old audit entries keep the previous Teacher user ID. Anyone with edit access to the Sheet or script can do this, so keep that access to yourself.

**After restoring onto a new script project:** authenticator secrets are sealed with the Script Property `MFA_KEY`, which a sheet backup does not contain. The authenticator code will then fail; sign in with a printed recovery code (those do not depend on it), turn two-step off and on again to enrol a fresh secret.
