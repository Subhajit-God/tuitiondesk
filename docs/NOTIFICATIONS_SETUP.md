# TuitionDesk notification system

## What is included

- A private in-app notification inbox for each signed-in student and teacher.
- Teacher broadcast from **Notices & Notifications → App notifications** to all students, all teachers, or both.
- Teacher policy controls in **Settings → Notifications** for the overall feature, push, email, and each supported category.
- Firebase Cloud Messaging (FCM) delivery to registered Android/browser devices. A registered device is not proof that a notification reached the device; the UI records provider acceptance separately.
- Email delivery through Apps Script `MailApp` when the account has an email address. A successful `MailApp.sendEmail` call means Google accepted the message, not that the recipient's mailbox delivered it.
- Automatic app alerts for published notices, homework, results, timetable changes, verified student payments, student-reported payments, new public enquiries, and password changes.
- Password-change, password-reset, and account-recovery security alerts are mandatory and bypass the Teacher's optional notification switches.
- Recipient inbox records are private to the signed-in account. A teacher can view broadcast records they sent, but cannot mark another account's notification as read.

## Notification categories

| Category | Examples / trigger | Recipient |
|---|---|---|
| Announcements | Notice published | Students in that notice's audience |
| Homework | Homework first published | The assigned student or active batch roster |
| Timetable | Teacher sends a batch timetable-change message | Students in that batch |
| Results | Test results first published | Students included in the result rows |
| Fees | Payment verified; student reports a payment | Student or active teachers, respectively |
| System | New public enquiry; password changed | Active teachers or the affected account |
| Attendance | Policy switch is present; additional automatic event wiring can be added | Not currently wired to this app inbox |

The existing WhatsApp guardian queue is separate and unchanged. It continues to use its existing manual-send / WhatsApp Cloud API policy.

## First-time setup

1. Deploy the updated Apps Script project.
2. Run `setupDatabase()` (or the project's database initialisation function) once so the new `AppNotifications` tab is created. Existing data is preserved; the new table is additive.
3. In Firebase Console, confirm **Firebase Cloud Messaging API (HTTP v1)** is enabled for the same Firebase project used by `frontend/public/config.json`.
4. Create a Firebase service-account key with permission to send FCM messages. Keep the downloaded JSON private.
5. In Apps Script → **Project Settings → Script Properties**, add:
   - Property: `FCM_SERVICE_ACCOUNT_JSON`
   - Value: the complete service-account JSON content
6. Never paste the private key into chat, source code, GitHub, Google Sheets, or `frontend/public/config.json`. The JSON belongs only in Apps Script Script Properties.
7. Re-authorize the Apps Script project when prompted so it can call Google's OAuth/FCM endpoints and use `MailApp`.
8. Deploy the frontend with its existing Firebase public config and VAPID public key. Each student/teacher must sign in and enable notifications on each device they want to register.
9. Add student email addresses in the student's contact-email field. Teacher email delivery uses the teacher account's verified recovery email, if present.

## Delivery states

- `accepted_by_fcm`: FCM accepted the send request; this does not prove the device displayed it.
- `accepted_by_mail_service`: Apps Script MailApp accepted the email request; this does not prove mailbox delivery.
- `no_device` / `no_email`: no eligible endpoint is registered for that channel.
- `not_configured`: FCM service-account credentials are not configured.
- `failed`: the provider request failed.
- `not_requested`: that channel was not selected or is disabled by Teacher policy.

The send API writes the in-app record first and performs provider calls after the Apps Script write lock is released. The in-app inbox remains available even if a provider is unavailable.

## Current scope limitations

- Teacher broadcasts currently support immediate sends to all students, all teachers, or everyone. Batch and individual targeting are supported by the backend API but are not exposed in the current composer.
- Scheduled / recurring app broadcasts, per-user optional preferences, delivery webhooks/receipts, and a detailed per-recipient broadcast report are not included yet.
- Attendance and several other existing business events still use the legacy WhatsApp workflow or have no app-inbox event wired yet.
- The Apps Script `MailApp` daily recipient quota applies. Check the quota for the Google account deploying the script before sending large broadcasts.
