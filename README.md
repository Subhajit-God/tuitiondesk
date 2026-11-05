# TuitionDesk

Mobile-first tuition-centre manager for one Teacher (Master Admin) and their Students.
React frontend (installable PWA) + Google Apps Script backend, Google Sheets as the database, Google Drive for stored PDFs.

| Folder | What it is |
|---|---|
| `backend/` | Apps Script source (`*.gs`, `appsscript.json`), test harness `test/`, local dev server `dev-server.js` |
| `frontend/` | React 19 app, PDF engine (`src/pdf`), build (`build.mjs`), tests (`test/`) |
| `docs/` | Deployment, configuration, schema, backup/recovery, Teacher guide, verification, tests, limitations |

Start with **docs/DEPLOYMENT.md**. Read **docs/LIMITATIONS.md** before relying on it for real money: several things could not be tested against real Google, WhatsApp, or payment services from the build environment.

## What it does
- Two roles only. Teacher sees and changes everything. Student sees only their own data (enforced on the server, not only in the UI).
- Students, batches, enrolment history, enquiries and admissions.
- Fee ledger: obligations, discounts/adjustments, late fees, payments, credit on account, refunds, reversals. A payment counts only after Teacher reconciliation or a signed provider callback. Receipts are issued only on verification.
- Attendance (Present / Absent / Holiday) with audited corrections. Tests, marks and publish/unpublish. Homework, timetable (with extra classes and cancellations), notices.
- **One-tap UPI pay link**: every reminder carries a link to a public pay page showing the exact amount, the months and the student's first name; its button opens the parent's UPI app with payee, amount and note filled in.
- **Fee reminder ladder**: friendly nudge before the due date, polite on the due date, firm after the grace period; adapts per family, stops once the payment is verified, respects quiet hours.
- **Self-sending**: the app never calls any WhatsApp API. Messages wait in a queue and the Teacher sends each one from their own WhatsApp ("Send one by one"); "sent" is the Teacher's confirmation, not a delivery receipt.
- Official PDFs, A4 or A5, colour or black-and-white, centre name on every page, optional Teacher name, watermark controls, QR + PDF417 carrying only a random verification ID. Versioning, reprint, revocation, public verification page.
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
node backend/test/run.js          # 73 backend tests
node frontend/test/pdf.test.mjs   # 32 PDF / QR / PDF417 tests (needs python3, pdfplumber, opencv, pikepdf, pdftoppm)
node frontend/test/export.test.mjs # 10 CSV/Excel checks (python3 + openpyxl, unzip, LibreOffice)
sh frontend/test/run-e2e.sh       # 109 browser checks (needs Playwright + Chromium)
```
Results and what they do and do not prove: docs/TEST_REPORT.md.
