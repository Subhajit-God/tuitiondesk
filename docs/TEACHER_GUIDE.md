# Teacher handover guide

## First day
1. Sign in. Open **Settings** and fill in the centre name, your name, phone, address, UPI ID and instructions. Documents cannot be issued until the centre name is set.
2. **Batches** → create your class groups. **Students** → add students (tick "create login" to get a temporary password; it is shown once. Give it to the student; they must change it on first sign-in). Forgot password? Open the student and press Reset password.
3. **Fees & Payments** → "Fees for a whole batch" to bill a month. Safe to repeat: students already billed are skipped.

## Daily
- **Attendance**: pick batch and date, mark P / A / H for every student, Save. A saved session cannot be duplicated; use "Past sessions → Correct" (reason required, audited).
- **Payments**: when money arrives, either a student reports it or you record it. It stays **pending** and does not change any balance. Check your bank/UPI app or cash book, open the payment, tick the confirmation, write how you checked it, press Verify. The receipt is issued automatically.
- Wrong payment? Open it → Reverse (undoes allocations and cancels the receipt). Money returned? → Refund.

## Weekly / monthly
- **Tests**: create, enter marks (status Entered / Absent / Exempt / Not entered; "not entered" is not zero), Save, then Publish. Published marks can still be corrected with a reason.
- **Homework / Notices / Timetable**: drafts are invisible to students until published.
- **Notices & Notifications → Messages to send**: press "Send one by one…", press "Open WhatsApp" (your own WhatsApp opens with the text ready), press Send there, come back and press "I sent it". That is your word; the app labels it "manually sent", never "delivered" — WhatsApp does not tell us.
- **Fee reminder ladder** (same page, and Settings → Reminder ladder): friendly nudge N days before the due date, polite on the due date, firm after the grace period (repeated every N days, then the family appears under "Needs a phone call"). Each message has the exact amount, months and a pay link. Reminders stop when you have *verified* the payment (a recorded-but-unverified payment holds them). Per family (Students → Profile): *Automatic*, *Gentle* (calls instead of firm messages) or *Off*, plus "pause until". "What the ladder would do today" shows every decision and why before anything is queued.
- **Pay link** (Students → Fees → Show pay link): the parent opens it, sees the exact amount and taps to pay in their UPI app. If they press "I have paid" you see a note and reminders pause for 3 days — **check your bank, then record and verify the payment**; the balance never changes by itself. The bank note carries `#REF` to help you match it.
- **Official Documents**: generate, then Preview / Download / Save to Drive. Choose A4 or A5 and colour or B&W per print. Changed records produce a new version; unchanged ones reprint the same document. Revoke a document you withdrew: its QR code will then show REVOKED.
- **Audit Logs & Backups**: back up, verify, and run a restore test monthly.

## Checking a document
Scan the QR code with any phone, or open the web address and `#/verify/<ID>`. The page shows only: valid or revoked or unrecognised, document type, centre name, issue date, version. Never student names, marks, or amounts.
The PDF417 barcode under the QR carries the same 32-character ID for barcode scanners. Neither code contains personal data.

## Rules the app enforces (so you can trust the numbers)
- Balance = net due − verified allocations. Nothing else changes it.
- Receipts cannot be edited. Corrections are made by reversing the payment.
- Attendance % = Present / (Present + Absent); holidays excluded.
- Ranks use competition ranking (1,2,2,4) on entered marks only.

## Two-step sign-in (do this on day one)
1. **Password & security → Turn on two-step sign-in.** Scan the QR code with an authenticator app (Google/Microsoft Authenticator, Authy…). If you cannot scan, type the key shown. Enter the 6-digit code to finish. It only turns on after a correct code.
2. You are shown **10 recovery codes once**. Print them or download the file and keep them away from your phone. Each works once.
3. Optional but recommended: **Add recovery email**. A code is emailed to confirm the address. Use a mailbox that has its own two-step login: anyone controlling that mailbox *and* knowing your password could sign in.

Signing in: password, then a 6-digit authenticator code. Lost your phone? Use a printed recovery code, or on the code screen press "Email me a code".
**Forgot your password?** On the sign-in screen choose "Teacher: forgot your password?". You must give **two different kinds** of proof (authenticator code, printed recovery code, emailed code) and choose a new password. Two printed codes do not count as different. Resetting the password never skips two-step sign-in.
Make new recovery codes when you have 3 or fewer left. Students are not affected by any of this.
If you have lost the phone, all printed codes and the email, the owner of the Google Sheet can still use the manual procedure in BACKUP_RECOVERY.md.

## Exporting your data
**Data Export** → download everything as one Excel workbook (a sheet each for students, fees, payments, attendance) or any single table as Excel or CSV. Fees, payments and attendance can be limited to a date range. The files contain personal data: keep them safe. It is a copy for your own use or to move to another system; for disaster recovery use Backups.

## Admission, leaving and the fee window

- **Admission** is recorded whenever you add a student (the admission date), convert an enquiry, or re-admit a leaver. Enquiries, Admissions & Leavers → *Admissions* lists them all.
- **Fees are calculated from the admission month to the leaving month**, both whole months. A student still enrolled is billed through the current month. Fees outside those months are refused. A mid-month leaving still bills that month — use a fee discount to charge less.
- **Generate fees for all enrolled months** (student → Fees): enter the monthly fee and due day, see every month it will create (months already billed are skipped), then confirm. Safe to repeat.
- **Record leaving** (student → Admission & leaving): choose the date and reason. You see first what will happen: later unpaid fees are cancelled; later fees that already have payments are kept and listed for you to refund or reallocate; login is switched off; batch memberships end. What the student still owes up to the leaving month stays owed — reminders and the pay link keep working, and *Leavers* shows the balance.
- **Re-admit** starts a new stay from a new date. Months between leaving and re-admission are not billed.
- *Deactivate* and *Archive* do **not** stop billing; only a recorded leaving does. Students added before this feature are treated as still enrolled from their admission date until you record a leaving.

## What you can correct (and what you cannot, on purpose)

- **Student**: name, guardian, WhatsApp number and consent, email, admission date, **monthly fee**, login name, reminder mode, notes. **Stays**: admission and leaving dates and reason. **Batch memberships**: join/leave dates.
- **Fees**: amount, due date, billing month, note (reason required, audited); add discounts/adjustments; cancel an unpaid fee. Changing a student's monthly fee never rewrites fees already billed; edit those individually.
- **Payments**: before verification, edit amount, method, reference, date and note. After verification only the note — the amount, method, reference and date are locked because a receipt and the ledger depend on them. To fix a verified payment: Reverse, then record the correct one.
- **Locked by design**: receipts, issued documents (issue an updated version or revoke instead), the audit log, and refunds/reversals.
- Batches, tests and marks, attendance (corrections), homework, timetable, notices, enquiries and settings keep their edit screens.

## Today screen and Batches
Open **Today** every morning. Each box says what to do and links to where. The **Batches** tab beside it lists your batches: press **+ New batch**, give a name and class, and add as many “day + start–end time” rows as the batch meets (Sunday 7:00–9:30, Wednesday 17:00–18:30 …). Those timings also appear in the Timetable. Open a batch's **Roster** to add students. When you add a new student you must pick their batch.

## Attendance by tap
Choose the batch and date. Everyone is already Present; tap the students who are absent and press **Save attendance**. A message for each absent student's guardian is prepared in **Messages to send** — you send it yourself. Use *Detailed mode* for holidays.

## Fee plans, discounts, late fees, credit
- **Fee plans** (left menu): a plan has a monthly fee, a cycle (monthly / quarterly / annual — quarterly and annual are billed in advance, counted from the admission month) and a one-time admission fee. Give a plan to a student on their Profile; a fee typed on the profile overrides the plan.
- **Siblings** = same guardian WhatsApp number. The eldest pays full, the others get the percentage in Settings (a visible “Sibling discount” line on each fee). Tick “no sibling discount” on a profile to opt out. Existing fees are not changed.
- **Late fees**: switch on in Settings; set flat or percent, grace days, repeat and a maximum. Use **Waive late fee…** on a fee to remove them (with a reason).
- **Credit on account** (overpayment) shows in a green box on the student's page and is applied automatically to the next fee created (oldest first). Turn that off in Settings if you prefer to allocate by hand.

## Certificates
**Official Documents → No-Dues Certificate** works only when the student's balance is zero and no payment is waiting for verification; otherwise it tells you what is outstanding. **Leaving Certificate** works after you have recorded the student as left.

## Messages in Hindi / Bengali, monthly report
Set a student's **Message language** on their Profile. Edit the wording in Settings → Message languages. **Notices → Monthly parent report**: pick the month, check the preview, press **Prepare messages** (one per family).

## Enquiries
Enquiries with a follow-up date that has arrived (or new ones nobody called for 2 days) show on **Today** and at the top of **Enquiries**. The optional public form is at `your-address/#/enquire` (turn on in Settings).

## Backups
They run by themselves. If a red banner appears at the top of the screen, open **Audit Logs & Backups** and press **Back up now**, then **Test restore now**.
