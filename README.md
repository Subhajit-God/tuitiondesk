# TuitionDesk

Mobile-first tuition-centre manager for one Teacher (Master Admin) and their Students.
React frontend (installable PWA) + Google Apps Script backend, Google Sheets as the database, Google Drive for stored PDFs.

| Folder | What it is |
|---|---|
| `backend/` | Apps Script source (`*.gs`, `appsscript.json`), test harness `test/`, local dev server `dev-server.js` |
| `frontend/` | React 19 app, PDF engine (`src/pdf`), build (`build.mjs`), tests (`test/`) |
| `docs/` | Deployment, configuration, schema, backup/recovery, Teacher guide, verification, tests, limitations |

Start with **docs/HOSTING_GUIDE.md** (step-by-step, with screenshots of the app's own screens) and **docs/DEPLOYMENT.md**. Read **docs/LIMITATIONS.md** before relying on it for real money: several things could not be tested against real Google, WhatsApp, or payment services from the build environment.

## What it does
- Two roles only. Teacher sees and changes everything. Student sees only their own data (enforced on the server, not only in the UI).
- Students, batches, enrolment history, enquiries and admissions.
- Fee ledger: obligations, discounts/adjustments, late fees, payments, credit on account, refunds, reversals. A payment counts only after Teacher reconciliation or a signed provider callback. Receipts are issued only on verification.
- Attendance (Present / Absent / Holiday) with audited corrections. Tests, marks and publish/unpublish. Homework, timetable (with extra classes and cancellations), notices.
- **Admission & leaving**: every admission (direct, from an enquiry, or a re-admission) is recorded; recording a leaving ends billing in the leaving month, switches off login, ends batch memberships and cancels later unpaid fees. Fees are calculated from the admission month to the leaving month.
- **One-tap UPI pay link**: every reminder carries a link to a public pay page showing the exact amount, the months and the student's first name; its button opens the parent's UPI app with payee, amount and note filled in.
- **Fee reminder ladder**: friendly nudge before the due date, polite on the due date, firm after the grace period; adapts per family, stops once the payment is verified, respects quiet hours.
- **Self-sending**: the app never calls any WhatsApp API. Messages wait in a queue and the Teacher sends each one from their own WhatsApp ("Send one by one"); "sent" is the Teacher's confirmation, not a delivery receipt.
- Official PDFs, A4 or A5, colour or black-and-white, centre name on every page, optional Teacher name, watermark controls, QR + PDF417 carrying only a random verification ID. Versioning, reprint, revocation, public verification page.
- **Today screen**: classes today and whether attendance is marked, absentees and whether their guardian was told, payments to verify, messages to send, who to call, enquiry follow-ups due, backup warnings.
- **Batches tab**: create a batch with name, class (5, 6, 7 …) and several weekly timings (e.g. Sunday 7:00–9:30am + Wednesday 5:00–6:30pm); add students from its roster. A new student must choose a batch.
- **Tap attendance**: everyone starts Present, tap the absentees, save; each absent guardian gets a prepared message (queued, you send it).
- **Fee plans**: monthly / quarterly / annual billing, one-time admission fee, sibling discount (same guardian number), automatic late fees (flat or percent, repeat, cap, waivable), credit on account shown clearly and applied automatically to the next fee.
- **No-Dues and Leaving certificates** (official PDFs; no-dues only at zero balance with nothing awaiting verification).
- **Languages**: reminders, absence messages and the monthly report in English, Hindi or Bengali per family (Hindi/Bengali defaults are unreviewed machine-style translations — have a native speaker check them).
- **Monthly parent report**: one message per family (attendance, tests, fee status), same send queue.
- **Parent pay page** also lists past payments with receipts; **public enquiry form** (off by default) lands in Enquiries; daily enquiry follow-up list.
- **Backups**: daily automatic backup, monthly automatic restore test, visible stale-backup warning.
- Dashboard from real records, audit log, backups with a restore test.
- Optional two-step sign-in for the Teacher (authenticator app + printed recovery codes + optional confirmed recovery email), with self-service recovery of a forgotten password.
- Data export of students, fees, payments and attendance as Excel or CSV.

## Run it locally (no Google account needed)
```
cd frontend && npm install
OUT=/tmp/td-dist node build.mjs
printf '{"apiUrl":"http://localhost:8787","publicUrl":""}' > /tmp/td-dist/config.json
node ../backend/dev-server.js 8787        # prints the one-time setup key
OUT=/tmp/td-dist node serve.mjs 5173      # open http://localhost:5173
```
The dev server runs the real backend source against in-memory fakes of Google services. It is for development and tests only.

## Tests
```
node backend/test/run.js          # 98 backend tests
node frontend/test/pdf.test.mjs   # 32 PDF / QR / PDF417 tests (needs python3, pdfplumber, opencv, pikepdf, pdftoppm)
node frontend/test/export.test.mjs # 10 CSV/Excel checks (python3 + openpyxl, unzip, LibreOffice)
sh frontend/test/run-e2e.sh       # 133 browser checks (needs Playwright + Chromium)
```
Results and what they do and do not prove: docs/TEST_REPORT.md.

## Error codes and what they mean

Every failed request returns `{ "ok": false, "error": { "code", "message", "details" } }`. The screen shows the plain-language `message`; the `code` is the stable part (use it when asking for help or reading the audit log and Apps Script executions). Errors never contain passwords, tokens, secrets or other people's data. Unexpected faults only show a reference number (`requestId`) that matches a line in the Apps Script execution log.

| Code | Meaning | What to do |
|---|---|---|
| `VALIDATION` | A field is missing, the wrong type, out of range, or not allowed (e.g. a date in the future, a fee below what is already paid, a leaving date before admission). `details.field` names the field. | Fix the named field and save again. |
| `CONFLICT` | The request is valid but clashes with the current records: a fee already exists for that month, the student is not enrolled in that month, a verified payment is locked, the student has already left, an overlapping stay, a username already taken. | Read the message; it says what to change (often: use Re-admit, Reverse, or pick another month). |
| `NOT_FOUND` | The record (student, fee, payment, batch…) does not exist, or the id was mistyped or removed. | Refresh the list and pick it again. |
| `NEEDS_CONFIRMATION` | A consequential action (verify a payment, reverse, revoke a document, record a leaving, publish marks with gaps) was sent without the explicit confirmation flag. The screen asks you to confirm; nothing was changed. | Confirm in the dialog. |
| `CAPACITY` | The batch is full. `details.needsConfirmation` is true. | Confirm “Assign anyway” or choose another batch. |
| `DUPLICATE_REFERENCE` | A payment with the same method and UTR / reference already exists (not rejected). Protects against recording one payment twice. | Check the existing payment; use a different reference only if it really is a different payment. |
| `DUPLICATE_SESSION` | Attendance for that batch, date and session was already saved. `details.sessionId` points to it. | Open it and use a correction instead of saving again. |
| `LIMIT` | A per-user safety limit was reached (a student can have at most 5 payment reports awaiting verification). | Wait for the Teacher to verify or reject the earlier ones. |
| `AUTH_FAILED` | Wrong username or password, wrong current password, wrong setup key, or a bad payment-provider signature. Deliberately does not say which part was wrong. | Re-enter carefully. Repeated failures trigger `RATE_LIMITED`. |
| `UNAUTHENTICATED` | You are not signed in, the session expired (sessions last a limited time), the account was disabled (for example after leaving) or a two-step sign-in step timed out. | Sign in again. |
| `PASSWORD_CHANGE_REQUIRED` | The account still has a temporary password; nothing else works until it is changed. | Choose a new password when prompted. |
| `FORBIDDEN` | Your role may not do this (a student calling a Teacher action), setup was already completed, a restore test targeted the live database, or no student profile is linked to this login. | Sign in with the right account; restore tests need a separate empty sheet. |
| `RATE_LIMITED` | Too many attempts: failed sign-ins or wrong two-step codes (locked for 15 minutes), or too many requests to the public verify / pay pages in a minute. | Wait and retry. |
| `BUSY` | Another change was being written at the same moment and the lock wait timed out. The change was **not** saved. | Retry in a moment. |
| `SETUP_REQUIRED` | A first-time step is missing: no setup key was generated, or the centre name is not set before issuing official documents. | Run `generateSetupKey()` / fill Settings, as the message says. |
| `NOT_CONFIGURED` | The database spreadsheet, documents folder, backup folder or payment callback secret is not set up (or, in the browser, `apiUrl` is missing in `config.json`). | Run `setupDatabase()` (see docs/DEPLOYMENT.md) or set the missing value. |
| `SCHEMA_MISMATCH` | A sheet tab's columns do not match what the code expects (someone moved, renamed or deleted a header). Nothing is written until fixed. | Restore the header row from docs/SCHEMA.md, or restore a backup. |
| `EMAIL_FAILED` | Google's mail service refused to send the emailed code. | Use an authenticator or recovery code instead; check the mail quota and the recovery email address. |
| `TOO_LARGE` | A request or one cell would exceed the size limit. | Shorten the text or split the request. |
| `BAD_REQUEST` | The request body was not valid JSON (usually a broken client or a hand-made request). | Reload the app; if it persists, report it. |
| `UNKNOWN_ACTION` | The app asked for an action the server does not know (frontend and backend versions are out of step). | Redeploy the backend as a **new version** and reload the app. |
| `INTERNAL_ERROR` / `INTERNAL` | An unexpected fault. The message carries a reference number; the full detail is only in the Apps Script execution log. Nothing sensitive is shown. | Retry once; if it repeats, send the reference number. |

Codes raised in the browser itself (never sent by the server):

| Code | Meaning | What to do |
|---|---|---|
| `NETWORK` | The server could not be reached (offline, blocked, or the web-app URL is wrong). | Check the internet connection and `apiUrl`, then retry. |
| `BAD_RESPONSE` | The server answered with something that is not the expected JSON (often a Google sign-in or error page: the web app is not deployed for “Anyone”, or the deployment is stale). | Re-deploy the web app with access “Anyone” and a new version. |
| `ERROR` | The server returned a failure without a code. | Retry; report it if it persists. |

Not errors, but often confused with them: notification statuses `pending_manual` (waiting for you to send it from your own WhatsApp), `manually_sent` (you said you sent it; WhatsApp does not confirm delivery to the app), `skipped` (no number or the guardian opted out) and `cancelled`; payment statuses `pending` (recorded, not yet verified by you), `verified`, `rejected`.
