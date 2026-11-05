# Deployment and configuration guide

You need: a Google account for the Teacher, and a place to host static files (GitHub Pages, Netlify, Cloudflare Pages or any web server with HTTPS).

## 1. Backend (Google Apps Script)
1. Create a new Google Sheet named "TuitionDesk Database". Open **Extensions → Apps Script**.
2. Create one script file per file in `backend/` (including `Mfa.gs` and `Export.gs`) (same names, `.gs`). Replace the manifest: Project Settings → "Show appsscript.json" → paste `backend/appsscript.json`. Set the time zone there if you are not in India.
3. In the editor choose `setupDatabase` and **Run**. Approve the permissions (Sheets, Drive, external requests, triggers, and **sending email**, used only for recovery codes). This creates all tabs and two private Drive folders (documents, backups) and sets `ENVIRONMENT=production`.
4. Run `generateSetupKey`. Open **Execution log** and copy the one-time key.
5. Run `setupTriggers` to install the hourly scheduled-jobs trigger. Jobs still do nothing until enabled in Settings.
6. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the web app URL (ends in `/exec`).
   "Anyone" only means anyone can reach the login/verification endpoints. Every other action needs a session token and is role-checked on the server.
7. Run `showConfigStatus` any time to see what is configured (it never prints secrets).

After editing any `.gs` file you must create a **new deployment version** (Deploy → Manage deployments → Edit → New version), otherwise the live URL keeps the old code.

## 2. Frontend
1. `cd frontend && npm install && node build.mjs` (output in `frontend/dist`).
2. Edit `dist/config.json`: `{"apiUrl": "<web app URL>", "publicUrl": ""}`.
3. Upload the contents of `dist/` to your host. It must be HTTPS (needed for installing the PWA).
4. Open the site. On first run you see "Welcome to TuitionDesk": enter the setup key and create the Teacher account (10+ characters, letters and numbers). The key is then deleted.
5. In **Settings** set: centre name (required before any official document), Teacher name, phone, address, UPI details, and **Public web address** = the final URL of the site (HTTPS, with trailing slash). The QR code on every PDF links to that address + `#/verify/<id>`. Changing the site address later does not break old printed documents only if the old address still serves the app, so choose a stable one.

## 3. Script Properties (secrets) — Project Settings → Script properties
| Property | Needed for | Set by |
|---|---|---|
| `SPREADSHEET_ID`, `DOCS_FOLDER_ID`, `BACKUP_FOLDER_ID`, `ENVIRONMENT` | core | `setupDatabase()` |
| `SETUP_KEY` | first Teacher account | `generateSetupKey()` (deleted after use) |
| `MFA_KEY` | seals authenticator secrets in the sheet | created automatically on first 2FA setup |
| `PW_ITERATIONS` | optional: password-hash cost (default is a safe value) | you |
| `PAYMENT_WEBHOOK_SECRET` | automatic payment verification by a provider callback | you |

Secrets are never entered in the app and never shown in it.

### External credentials you must obtain yourself
- **WhatsApp**: no WhatsApp API or account is needed. The app prepares messages and you send each one from your own WhatsApp (Notices & Notifications → Messages to send). Nothing is sent automatically.
- **One-tap pay link** needs two Settings: *Public web address of this app* (`https://…`, the address where the frontend is hosted) and your *UPI ID*. Without the address, messages carry your UPI ID instead of a link.
- **Reminder ladder**: switch it on in Settings → Reminder ladder, then run `setupTriggers()` once so the hourly job prepares each day's messages after the reminder hour (never in quiet hours).
- **Payment provider callbacks** (optional): your provider must send a signed event to the web app URL (`action=payments.callback`). The signature is HMAC-SHA256 with `PAYMENT_WEBHOOK_SECRET` over `id|reference|amount|status`. A callback verifies a payment only if a pending payment with the same reference **and the exact amount** exists and the event status is `captured`; anything else is left for you to reconcile. If you have no provider, leave it unset: everything works through Teacher reconciliation.

## 4. Configuration reference
All Settings are under the Settings screen: centre details, fees (default amount, due day, late fee, grace days), payment info, notification schedule and quiet hours, message templates, PDF defaults (A4/A5, colour/B&W, Teacher name, watermark text/position/size/opacity), verification page options, backup frequency and retention. Every change is audited.

## 5. Going live checklist
- [ ] `ENVIRONMENT` is `production` (a coloured banner shows on any non-production environment).
- [ ] Centre name and public web address set; print a test receipt and scan both codes with a phone and a barcode reader.
- [ ] Run **Back up now**, then **Restore test** into a blank sheet (docs/BACKUP_RECOVERY.md).
- [ ] Triggers installed (`showConfigStatus` lists `runScheduledJobs`).
- [ ] Teacher password stored safely; recovery plan noted (see BACKUP_RECOVERY.md).

## 6. Upgrading an existing deployment to two-step sign-in and export
Paste the new/changed files (`Mfa.gs`, `Export.gs`, `Config.gs`, `Auth.gs`, `Api.gs`, `appsscript.json`), run `setupDatabase` once (it appends the new `Users` columns; nothing is deleted), re-authorise when asked (new email permission), create a **new deployment version**, then upload the new frontend build.
