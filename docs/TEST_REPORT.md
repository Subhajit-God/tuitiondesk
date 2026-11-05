# Test checklist and results

Last run: 2026-10-25. All automated suites passed.

| Suite | Command | Result |
|---|---|---|
| Backend (real `.gs` source on in-memory Google fakes) | `node backend/test/run.js` | 73 / 73 |
| PDF engine, A4/A5 × colour/B&W × 6 layouts, QR, PDF417 | `node frontend/test/pdf.test.mjs` | 32 / 32 |
| CSV / Excel writers (python csv, unzip, openpyxl, LibreOffice) | `node frontend/test/export.test.mjs` | 10 / 10 |
| Browser E2E (Chromium, 390 px wide, real build + real backend source) | `sh frontend/test/run-e2e.sh` | 109 / 109 |

## What is covered
**Backend**: role permission table; Student can reach only own data (other students' records, teacher actions all denied); login throttling, forced password change, session expiry; ledger arithmetic, partial payments, credit, refunds, reversals, idempotent recording, over-allocation refusal, `ledger.reconcile`; payments never count before verification; provider callback signature/amount rules; attendance duplicates and corrections; test marks, ranking, publish gating; notification idempotency and honest statuses; document issue/reprint/new-version/revoke; public verification leaks nothing; backup, verify, restore test; dashboard from real records.

**PDF** (checked with independent tools, not the generator's own code): MediaBox is exactly A4 or A5; centre name on every page; Teacher name shown only when enabled; watermark present/absent and backed by a white box so it cannot touch the codes; black-and-white files contain no colour operators; long tables paginate; QR decodes (OpenCV) to the verification URL and carries no personal data; PDF417 decodes (independent decoder) to the bare ID, from both the vector geometry and a 220-dpi raster; other paper sizes are rejected. The E2E also re-checked a receipt downloaded through the UI.

**E2E**: first-run Teacher creation; every Teacher and Student screen renders (heading present, no error state), no horizontal scroll at 390 px, zero console errors; payment verify flow (button locked until the confirmation box is ticked, balance goes to zero, one receipt); receipt PDF download; public verify page (valid / not recognised, no student or amount shown); temporary password forced change; Student sees published marks, reprints own receipt; the backend rejects a Student calling a Teacher action.

**Two-step sign-in** (backend + browser): TOTP matches the RFC 6238 vector and an independent implementation; setup needs the password and a valid code; a password alone yields no session; codes cannot be replayed; wrong-code throttling; recovery codes single-use and stored only as hashes; TOTP secret sealed in the sheet; recovery email must be confirmed, is masked, rate-limited and expires after 10 minutes; honest error when mail fails; password recovery needs two different factors and revokes sessions yet keeps 2FA; students cannot reach any of it; audit never contains codes or secrets. Browser: scan-less setup, wrong code refused, recovery codes shown once, sign-in with recovery code, replay-safe TOTP, email recovery, reset flow.
**Export**: rows match the records, Teacher only, audited without data, paged at 1000 rows with no loss across pages (1,207-row test), no password hashes; files parse in other programs, text stays text, CSV formula-injection guarded, 30,000-row workbook opens.

## Manual checklist for your first real deployment (not automatable here)
- [ ] Deploy backend, create Teacher account, set Settings.
- [ ] Add a test student + batch; bill, record, verify a payment; download the receipt.
- [ ] Scan the printed receipt: QR with a phone (opens verify page, shows valid); PDF417 with your barcode reader.
- [ ] Revoke a test document and scan again (shows revoked).
- [ ] Mark attendance from a phone; publish a test result; log in as the student on a phone and check.
- [ ] Turn on two-step sign-in with your own phone; print the recovery codes; sign out and in; try "Email me a code" with a real mailbox (check spam).
- [ ] Download the Excel export and open it in Excel / Google Sheets.
- [ ] Install the PWA to the home screen (HTTPS).
- [ ] Back up, verify, restore-test into a blank sheet.
- [ ] Open a real pay link on a phone with GPay/PhonePe/Paytm and confirm the app opens with the right payee, amount and note (UPI apps differ; see LIMITATIONS).
- [ ] Send one real reminder from the queue to your own number and confirm the WhatsApp text and link look right.
- [ ] If using payment callbacks: send one real callback and confirm statuses match reality.
- [ ] Print in A4 and A5, colour and B&W; check the watermark does not hurt legibility.

## Not covered by any test
Real Google services, real WhatsApp/payment providers, hardware PDF417 scanners, printers, iOS Safari/Android Chrome devices (only Chromium emulation), accessibility audit with a screen reader (semantic labels, status text + icons, focus-visible and 44 px tap targets were built in but not audited).
