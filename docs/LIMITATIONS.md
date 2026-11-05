# Known limitations and what was NOT verified

Read this before going live.

## Not tested against the real services
- **Google Apps Script / Sheets / Drive**: the backend was run against in-memory fakes of those services (strict about locking and cache). They approximate, but are not, Google. Expect to meet a Google-specific surprise (quota, permission prompt, date-format quirk, slow sheet at large scale) on first real deployment. Do the going-live checklist with test data first.
- **Payment provider callbacks**: implemented to the documented request shape but never called for real. No success is simulated anywhere; unconfigured means "manual".
- **Messages are self-sent.** The app never calls WhatsApp. "Manually sent" is the Teacher's confirmation; the app cannot know whether a message was delivered or read, and a Teacher can press "I sent it" without sending. wa.me links open WhatsApp with the text prefilled but the Teacher still presses Send.
- **UPI pay link**: the `upi://pay` deep link is a widely supported standard but was not tested on real GPay/PhonePe/Paytm/BHIM apps; some apps ignore the note or cap its length, and some refuse a link opened from a browser for a personal (non-merchant) UPI ID. The page offers the UPI ID, amount and a QR as manual fallbacks. The app cannot see whether the parent completed the payment: only the Teacher's verification against the bank statement changes the ledger.
- **Pay link is a capability link**: anyone who has it sees the first name, months and amount due and can press "I have paid" (which only leaves a note and pauses reminders for 3 days; the Teacher sees it and its count). It stops working if the student is made inactive. The page is rate-limited (120 requests per minute for the whole system).
- **Ladder adaptation is simple rules, not prediction**: with at least 3 fully paid fees, median lateness <= 0 days skips the friendly nudge, >= 5 days sends it 4 days earlier. The pay-page amount covers fees due within (before-days + 4) days and past-due fees, and the messages use the same figure.
- **Quiet hours**: scheduled runs never prepare messages during quiet hours; messages the Teacher prepares by hand then are flagged "held" with a Send-anyway choice, since the Teacher decides when to message.
- **Scheduled jobs**: logic is tested with a fake clock; the real hourly trigger has not been observed.
- **Production restore** is manual (docs/BACKUP_RECOVERY.md). Only restore *testing* into a blank sheet is automated.

## Codes
- QR codes decode with OpenCV in tests. The PDF417 encoder is original code, validated by an independent decoder written for the tests (Reed-Solomon check, row indicators, byte-compaction decode), and the symbol table comes from the ISO 15438 data. **It has not been scanned with a real hardware/phone PDF417 reader.** Scan a printed sample with the reader you will use. If it fails, the QR code alone still verifies.
- Print-quality factors (printer resolution, toner) are outside what could be tested.

## Two-step sign-in and export
- Emails go through Google MailApp. "Sent" means handed to Google's mail service; delivery was never tested against a real mailbox and the app cannot see bounces. Consumer Gmail has a daily send quota (about 100 recipients).
- The emailed code is a full second step: someone who controls the recovery mailbox and knows the password can sign in. This is a deliberate convenience; skip the recovery email if that trade-off is not acceptable.
- Authenticator secrets are sealed with a Script Property key, which protects a leaked sheet or backup but not someone who can edit the Apps Script project (they can do anything anyway).
- Throttling and email-code expiry use Apps Script's cache, which Google may evict early; the worst case is asking for a new code.
- Excel export is a plain data dump (no formulas, one style). CSV cells starting with = + - @ get a leading apostrophe. Export is not a restorable backup.

## Product scope
- No logo upload; centre name is text. Fonts are the PDF standard set; the rupee sign prints as "Rs." (WinAnsi limitation).
- Students cannot submit homework; homework is view-only. No online payment collection inside the app (students are shown your UPI details and report payments).
- No multi-teacher, parent or staff roles by design. One Teacher account.
- No email sending. Guardian messages are WhatsApp only (API or manual).
- Apps Script web apps give ~6 min per request and daily quotas; one tuition centre fits comfortably, thousands of students would not. Sheets reads are cached per request.
- Offline: the app shell is cached, but data screens need the network. Nothing financial is ever cached.
- Password reset is Teacher-run only (no email/SMS reset).
- The `ANYONE_ANONYMOUS` web app exposes the login endpoint publicly; login throttling (5 failures → 15-minute lock) mitigates guessing but a long Teacher password is essential.

## Build-environment deviations
- Vite/jsPDF/bwip-js could not be installed (registry blocked). The frontend uses esbuild, React 19, pdf-lib, and in-repo QR and PDF417 encoders instead.
