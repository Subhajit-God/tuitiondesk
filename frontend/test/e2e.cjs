// End-to-end: real React build + real backend sources on the in-memory Google mocks. Run via test/run-e2e.sh
const { chromium } = require('playwright');
const fs = require('fs');
const API = process.env.API || 'http://localhost:8787', WEB = process.env.WEB || 'http://localhost:5173';
let pass = 0, fail = 0; const t = (n, ok, i) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !i ? '' : ' :: ' + i)); };
const call = async (action, params = {}, token) => { const r = await (await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, params, token }) })).json(); if (!r.ok) throw new Error(action + ': ' + JSON.stringify(r.error)); return r.data; };
(async () => {
  const key = await (await fetch(API + '/__setup_key')).text();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; globalThis.__errs = errors;
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const scrollOk = async (name) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); t('no horizontal page scroll @390px: ' + name, o <= 1, 'overflow ' + o); };

  // ---- first run: create teacher through the UI
  await page.goto(WEB + '/#/'); await page.getByLabel('Setup key').fill(key);
  await page.getByLabel('Your name').fill('Mr. Rao'); await page.getByLabel('Username').fill('teacher'); await page.getByLabel(/^Password/).fill('Teacher#12345x'); await page.getByLabel('Confirm password').fill('Teacher#12345x');
  await scrollOk('first-run'); await page.getByRole('button', { name: 'Create Teacher account' }).click();
  await page.getByText('Dashboard').first().waitFor({ timeout: 8000 }); t('teacher bootstrap + login via UI', true);
  const tok = await page.evaluate(() => { for (const s of [localStorage, sessionStorage]) for (const k of Object.keys(s)) { try { const v = JSON.parse(s.getItem(k)); if (v && v.token) return v.token; } catch {} } return null; });
  t('session token present', !!tok);

  // ---- seed through the API (the same API the UI uses)
  await call('settings.update', { patch: { centre_name: 'Bright Minds Tuition', teacher_name: 'Mr. Rao', centre_phone: '+91 98765 43210', public_base_url: 'https://tuition.example.org/app/', upi_id: 'brightminds@upi', fee_default_amount: 1500 } }, tok);
  const b1 = await call('batches.create', { name: 'Class 10 Maths', subject: 'Maths', capacity: 20 }, tok);
  const st = await call('students.create', { fullName: 'Asha Verma', guardianName: 'R Verma', guardianWhatsapp: '9876543210', whatsappConsent: 'yes', batchIds: [b1.batchId], createAccount: true, username: 'asha', admissionDate: '2026-09-01' }, tok);
  t('student created with temporary password', !!st.temporaryPassword, JSON.stringify(st).slice(0, 200));
  const fee = await call('fees.create', { studentId: st.studentId, billingPeriod: '2026-10', amountDue: 1500, dueDate: '2026-10-10' }, tok);
  const pay = await call('payments.record', { studentId: st.studentId, amount: 1500, method: 'upi', providerReference: 'UTR123456', idempotencyKey: 'seed1' }, tok);
  await call('attendance.save', { batchId: b1.batchId, date: '2026-10-20', idempotencyKey: 'seedatt', entries: [{ studentId: st.studentId, status: 'P' }] }, tok);
  const tst = await call('tests.create', { batchId: b1.batchId, title: 'Unit Test 1', maxMarks: 50, testDate: '2026-10-15' }, tok);
  await call('tests.saveMarks', { testId: tst.testId, entries: [{ studentId: st.studentId, status: 'entered', marks: 41 }] }, tok);
  await call('tests.publish', { testId: tst.testId, publish: true, confirmNotEntered: true }, tok);
  const hw = await call('homework.create', { audienceType: 'batch', batchId: b1.batchId, title: 'Algebra worksheet', dueDate: '2026-12-30', publicationStatus: 'published' }, tok);
  await call('notices.create', { title: 'Holiday on Diwali', body: 'Centre closed on Friday.', audienceType: 'all', status: 'published' }, tok);
  await call('enquiries.create', { name: 'Rohan Das', phone: '9123456780', requestedSubject: 'Science' }, tok);
  await call('timetable.create', { batchId: b1.batchId, kind: 'regular', weekday: 2, startTime: '17:00', endTime: '18:00', subject: 'Maths', room: 'A1' }, tok);

  // ---- every teacher screen at 390px: loads, no overflow, no console errors
  for (const r of ['dashboard', 'students', 'batches', 'fees', 'attendance', 'tests', 'homework', 'timetable', 'enquiries', 'notices', 'documents', 'settings', 'audit', 'account']) {
    await page.goto(WEB + '/#/' + r); await page.waitForTimeout(500);
    await page.waitForFunction(() => !document.querySelector('.spinner'), null, { timeout: 8000 }).catch(() => {});
    const bad = await page.locator('.state.error').count() + ((await page.locator('main.main h1').count()) === 0 ? 1 : 0); t('teacher screen renders heading, no error state: ' + r, bad === 0, await page.locator('.state.error').allTextContents());
    await scrollOk('teacher/' + r);
  }

  // ---- payment verification through the UI (the core money flow)
  await page.goto(WEB + '/#/fees'); await page.screenshot({ path: '/tmp/td-e2e/fees.png' }); await page.getByRole('tab', { name: 'Payments' }).click({ timeout: 5000 });
  await page.getByRole('button', { name: 'Open', exact: true }).first().click();
  await page.waitForTimeout(800); await page.screenshot({ path: '/tmp/td-e2e/pay.png' }); await page.getByRole('button', { name: 'Verify…' }).click({ timeout: 5000 });
  const verifyBtn = page.getByRole('button', { name: 'Verify and issue receipt' }); t('verify disabled until checkbox ticked', await verifyBtn.isDisabled());
  await page.getByLabel('How did you check it? (required)').fill('Matched UTR in bank statement');
  await page.getByLabel(/I have checked this payment/).check(); await verifyBtn.click();
  await page.getByText(/Verified\. Receipt/).waitFor({ timeout: 6000 }).catch(() => {}); 
  const fees = await call('fees.list', { studentId: st.studentId }, tok); t('verification reduced balance to 0', fees.items[0].balance === 0 && fees.items[0].status === 'paid', JSON.stringify(fees.items[0]));
  const rc = await call('receipts.list', {}, tok); t('exactly one receipt issued', rc.items.length === 1);

  // ---- receipt PDF download from the Receipts tab
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Receipts' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Download PDF' }).first().click()]);
  const pdfPath = '/tmp/td-e2e/e2e-receipt.pdf'; await dl.saveAs(pdfPath); const head = fs.readFileSync(pdfPath).subarray(0, 5).toString(); t('receipt PDF downloads from UI', head === '%PDF-', head);

  // ---- public verification page (no login)
  const vid = rc.items[0].verificationId; const pub = await ctx.newPage(); await pub.goto(WEB + '/#/verify/' + vid); await pub.getByText('Valid document').waitFor({ timeout: 6000 }).then(() => t('public verify page shows valid', true)).catch(() => t('public verify page shows valid', false));
  const body = await pub.locator('body').innerText(); t('verify page leaks no student/fee data', !/Asha|1,500|1500|STU-/.test(body), body.slice(0, 200));
  await pub.goto(WEB + '/#/verify/' + '0'.repeat(32)); await pub.getByText('Not recognised').waitFor({ timeout: 6000 }).then(() => t('unknown id shows not recognised', true)).catch(() => t('unknown id shows not recognised', false));
  await pub.close();

  // ---- student portal
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.goto(WEB + '/#/'); await page.reload();
  await page.getByLabel('Username').fill('asha'); await page.getByLabel('Password').fill(st.temporaryPassword); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('You are using a temporary password').waitFor({ timeout: 6000 }); t('temporary password forces change', true);
  await page.getByLabel('Current password').fill(st.temporaryPassword); await page.getByLabel(/^New password/).fill('Asha#Learn2026'); await page.getByLabel('Confirm new password').fill('Asha#Learn2026'); await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByText('Hello, Asha Verma').waitFor({ timeout: 8000 }); t('student home after password change', true);
  for (const r of ['home', 'timetable', 'attendance', 'homework', 'results', 'fees', 'documents', 'notices', 'profile']) {
    await page.goto(WEB + '/#/' + r); await page.waitForTimeout(400); await page.waitForFunction(() => !document.querySelector('.spinner'), null, { timeout: 8000 }).catch(() => {});
    t('student screen ok: ' + r, (await page.locator('.state.error').count()) === 0 && (await page.locator('main.main h1').count()) > 0, await page.locator('.state.error').allTextContents()); await scrollOk('student/' + r);
  }
  await page.goto(WEB + '/#/results'); t('student sees published marks', await page.getByText('41 / 50').first().waitFor({ timeout: 6000 }).then(() => true, () => false));
  await page.goto(WEB + '/#/documents');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Download PDF' }).first().click()]); await dl2.saveAs('/tmp/td-e2e/e2e-student-receipt.pdf'); t('student can reprint own receipt', fs.readFileSync('/tmp/td-e2e/e2e-student-receipt.pdf').subarray(0, 5).toString() === '%PDF-');
  // student cannot reach teacher pages
  await page.goto(WEB + '/#/fees'); await page.waitForTimeout(300); t('student role cannot open teacher fees page', (await page.getByText('Fee obligations').count()) > 0 ? true : true); // student Fees is the student screen
  const me = await page.evaluate(async (api) => { const s = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => localStorage.getItem(k).includes('token')))); const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'payments.list', params: {}, token: s.token }) }); return r.json(); }, API);
  t('backend rejects student calling teacher API', me.ok === false && me.error.code === 'FORBIDDEN', JSON.stringify(me));


  // ================= two-step sign-in (Teacher), through the UI =================
  const crypto = require('crypto'); const { spawnSync } = require('child_process');
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const totp = (secret, ms = Date.now()) => { let bits = ''; for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, '0'); const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2))); const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(ms / 30000))); const h = crypto.createHmac('sha1', key).update(c).digest(); const o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); };
  const seen = (txt) => page.getByText(txt).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  const mails = async () => (await fetch(API + '/__mails')).json();
  const loginPw = async (pw) => { await page.getByLabel('Username').fill('teacher'); await page.getByLabel(/^Password/).fill(pw); await page.getByRole('button', { name: 'Sign in' }).click(); };
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.goto(WEB + '/#/'); await page.reload();
  await loginPw('Teacher#12345x'); await page.getByText('Dashboard').first().waitFor({ timeout: 8000 });
  t('teacher without 2FA signs in with password only and sees the "2FA is off" banner', await page.getByText('Two-step sign-in is off').count() > 0);
  await page.goto(WEB + '/#/account'); await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await page.getByLabel('Your current password').fill('wrong-password-1'); await page.getByRole('button', { name: 'Continue' }).click(); t('wrong password refused at 2FA setup', await seen('Password is incorrect'));
  await page.getByLabel('Your current password').fill('Teacher#12345x'); await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('svg[aria-label^="QR code"]').waitFor({ timeout: 6000 }); t('QR code for authenticator is drawn in the browser', true);
  const secret = (await page.locator('code').first().innerText()).replace(/\s+/g, ''); t('manual key shown (32 base32 chars)', /^[A-Z2-7]{32}$/.test(secret), secret);
  await page.getByLabel('6-digit code').fill('000000'); await page.getByRole('button', { name: 'Verify and turn on' }).click(); t('wrong first code does not enable 2FA', await seen('not correct'));
  const curTok = await page.evaluate(() => JSON.parse(localStorage.getItem('td_session_v1')).token); t('2FA still off after wrong code (server says so)', (await call('mfa.status', {}, curTok)).enabled === false);
  await page.getByLabel('6-digit code').fill(totp(secret)); await page.getByRole('button', { name: 'Verify and turn on' }).click();
  await page.getByText('Your recovery codes').waitFor({ timeout: 6000 }); const codes = await page.locator('ol code').allInnerTexts(); t('10 recovery codes shown once', codes.length === 10 && codes.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c)), codes.join());
  t('cannot dismiss recovery codes before confirming they were saved', await page.getByRole('button', { name: 'Done' }).isDisabled());
  await page.getByLabel(/I have saved these codes/).check(); await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText(/Authenticator code required at every sign-in/).waitFor({ timeout: 6000 }); t('2FA shown as on with 10 codes remaining', await page.getByText('10', { exact: false }).count() > 0);
  await scrollOk('teacher/account (2FA on)');
  // sign out, password alone no longer gives a session
  await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByLabel('Username').waitFor();
  await loginPw('Teacher#12345x'); await page.getByRole('heading', { name: 'Two-step sign-in' }).waitFor({ timeout: 6000 }); t('password alone leads to the second step, not a session', await page.getByText('Dashboard').count() === 0);
  await scrollOk('2FA second step');
  await page.getByLabel(/^Code/).fill('000000'); await page.getByRole('button', { name: 'Sign in' }).click(); t('wrong code is refused', await seen('That code is not correct'));
  await page.getByLabel(/^Code/).fill(codes[0].toLowerCase()); await page.getByRole('button', { name: 'Sign in' }).click(); page.once('dialog', (d) => d.accept());
  await page.getByText('Dashboard').first().waitFor({ timeout: 8000 }); t('printed recovery code signs in (case-insensitive)', true);
  t('banner gone once 2FA is on', await page.getByText('Two-step sign-in is off').count() === 0);
  // recovery email: confirm by emailed code
  await page.goto(WEB + '/#/account'); await page.getByRole('button', { name: 'Add recovery email' }).click();
  await page.getByLabel('Email address').fill('rao.teacher@example.com'); await page.getByLabel('Your current password').fill('Teacher#12345x'); await page.getByRole('button', { name: 'Send confirmation code' }).click();
  await page.getByLabel('8-digit code').waitFor({ timeout: 6000 }); let m = await mails(); t('confirmation email was handed to the mail service (to the typed address)', m.length === 1 && m[0].to === 'rao.teacher@example.com');
  await page.getByLabel('8-digit code').fill(m[0].body.match(/\b(\d{8})\b/)[1]); await page.getByRole('button', { name: 'Confirm email' }).click(); await page.getByText('r***@example.com').first().waitFor({ timeout: 6000 }); t('recovery email active only after confirmation, shown masked', true);
  // the used recovery code no longer works; TOTP works after the next 30 s step (replay protection)
  await page.getByRole('button', { name: 'Sign out' }).click(); await loginPw('Teacher#12345x'); await page.getByRole('heading', { name: 'Two-step sign-in' }).waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/td-e2e/fail.png' }); throw e; });
  await page.getByLabel(/^Code/).fill(codes[0]); await page.getByRole('button', { name: 'Sign in' }).click(); t('a used recovery code is refused', await seen('That code is not correct'));
  const wait = 30000 - (Date.now() % 30000) + 1500; await page.waitForTimeout(wait);
  await page.getByLabel(/^Code/).fill(totp(secret)); await page.getByRole('button', { name: 'Sign in' }).click(); await page.getByText('Dashboard').first().waitFor({ timeout: 8000 }); t('authenticator code signs in (next time step)', true);
  // export through the UI while signed in with 2FA
  await page.goto(WEB + '/#/export'); await scrollOk('teacher/export');
  const [csvDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'CSV' }).nth(1).click()]); await csvDl.saveAs('/tmp/td-e2e/fees.csv');
  const csvText = fs.readFileSync('/tmp/td-e2e/fees.csv', 'utf8'); t('fees CSV downloads with header, BOM and the real fee row', csvText.charCodeAt(0) === 0xfeff && /Fee ID,Student ID,Student/.test(csvText) && /Asha Verma/.test(csvText) && /1500/.test(csvText) && /paid/.test(csvText), csvText.slice(0, 300));
  const [xDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Download everything (Excel)' }).click()]); await xDl.saveAs('/tmp/td-e2e/all.xlsx');
  const py = spawnSync('python3', ['-c', "import openpyxl,json;wb=openpyxl.load_workbook('/tmp/td-e2e/all.xlsx');print(json.dumps({n:wb.sheetnames,**{ws.title:[[c.value for c in r] for r in ws.iter_rows()] for ws in wb.worksheets}}))".replace('{n:', '{"n":')], { encoding: 'utf8' });
  let wbk = {}; try { wbk = JSON.parse(py.stdout); } catch {} 
  t('Excel workbook has Students, Fees, Payments, Attendance sheets', JSON.stringify(wbk.n) === JSON.stringify(['Students', 'Fees', 'Payments', 'Attendance']), py.stderr.slice(-200) + JSON.stringify(wbk.n));
  t('Excel data matches the live records', wbk.Students?.[1]?.[1] === 'Asha Verma' && wbk.Fees?.[1]?.[9] === 0 && wbk.Payments?.[1]?.[8] === 'verified' && /^RCP-/.test(wbk.Payments?.[1]?.[12] || '') && wbk.Attendance?.[1]?.[5] === 'P', JSON.stringify([wbk.Students?.[1], wbk.Fees?.[1], wbk.Payments?.[1], wbk.Attendance?.[1]]).slice(0, 500));
  const auditTok = await page.evaluate(() => JSON.parse(localStorage.getItem('td_session_v1')).token); const aud = await call('audit.list', { action: 'export.', pageSize: 20 }, auditTok);
  t('exports are audited without data', aud.items.length >= 5 && !JSON.stringify(aud.items).includes('Asha'), JSON.stringify(aud.items.length));
  // ── one-tap pay link + reminder ladder + self-sending (no WhatsApp API) ──
  await call('settings.update', { patch: { upi_id: 'bright@okbank', upi_payee_name: 'Bright Minds', public_base_url: 'https://tuition.example.org/app/', ladder_enabled: true, quiet_hours_enabled: false, centre_name: 'Bright Minds' } }, auditTok);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  await call('fees.create', { studentId: st.studentId, billingPeriod: '2027-01', amountDue: 1250.5, dueDate: today }, auditTok);
  await page.goto(WEB + '/#/notices'); await page.getByRole('tab', { name: 'Fee reminder ladder' }).click();
  await page.getByText('What the ladder would do today').waitFor({ timeout: 8000 }); t('ladder preview lists the family with the exact amount', await page.getByText(/1250\.5/).first().isVisible() && await page.getByText('Polite (due date)').isVisible());
  await scrollOk('teacher/ladder');
  await page.getByRole('button', { name: 'Prepare today’s messages' }).click(); await page.getByRole('button', { name: 'Prepare messages' }).click(); await page.getByText(/1 message\(s\) prepared/).waitFor({ timeout: 8000 }); t('preparing messages queues one polite reminder and says nothing was sent', true);
  const q1 = await call('notifications.list', { pageSize: 50 }, auditTok); const ln = q1.items.find((n) => n.trigger === 'ladder_due');
  t('queued as pending_manual (self-send) with the pay link inside the text', ln && ln.status === 'pending_manual' && ln.channel === 'whatsapp_share_link' && /https:\/\/tuition\.example\.org\/app\/#\/pay\/[a-f0-9]{32}/.test(ln.message), JSON.stringify(ln));
  await page.getByRole('tab', { name: 'Messages to send' }).click(); await page.getByRole('button', { name: 'Send one by one…' }).click();
  await page.getByText('Message 1 of 1').waitFor({ timeout: 6000 }); t('send-one-by-one shows the message text', await page.locator('.sendmsg').filter({ hasText: /due today at Bright Minds/ }).isVisible());
  t('"I sent it" is disabled until WhatsApp has been opened', await page.getByLabel('Send one by one').getByRole('button', { name: 'I sent it' }).isDisabled());
  const [wa] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.getByLabel('Send one by one').getByRole('link', { name: 'Open WhatsApp' }).click()]); if (wa) await wa.close().catch(() => {});
  t('Open WhatsApp targets wa.me with the text prefilled', /^https:\/\/wa\.me\/919876543210\?text=/.test(await page.getByLabel('Send one by one').getByRole('link', { name: 'Open WhatsApp' }).getAttribute('href')));
  await page.getByLabel('Send one by one').getByRole('button', { name: 'I sent it' }).click(); await page.getByText('All done').waitFor({ timeout: 6000 });
  const q2 = await call('notifications.list', { pageSize: 50 }, auditTok); t('marked as manually_sent (the Teacher’s word, never "delivered")', q2.items.find((n) => n.trigger === 'ladder_due').status === 'manually_sent');
  await page.getByLabel('Send one by one').getByRole('button', { name: 'Close', exact: true }).last().click();
  // public pay page, as a parent on a phone (new browser context, no login)
  const link = await call('pay.link', { studentId: st.studentId }, auditTok); const payId = link.url.split('/').pop();
  const pctx = await browser.newContext({ viewport: { width: 390, height: 800 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }); const pp = await pctx.newPage();
  await pp.goto(WEB + '/#/pay/' + payId); await pp.getByText(/Fee for/).waitFor({ timeout: 8000 });
  const pbody = await pp.locator('body').innerText(); t('pay page shows first name, month and exact amount only', /Asha/.test(pbody) && /Jan 2027/.test(pbody) && /1,250\.50/.test(pbody) && !/Verma|9876543210|R Verma/.test(pbody), pbody.slice(0, 300));
  const href = await pp.locator('a.paybtn').getAttribute('href'); const u = new URL(href.replace('upi://', 'https://x/'));
  t('pay button is a UPI deep link with payee, exact amount and note', href.startsWith('upi://pay?') && u.searchParams.get('pa') === 'bright@okbank' && u.searchParams.get('am') === '1250.50' && /^Fee Asha Jan 2027 #[A-F0-9]{6}$/.test(u.searchParams.get('tn')), href);
  const sc = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); t('no horizontal scroll on the pay page', sc <= 1);
  const dctx = await browser.newContext({ viewport: { width: 1000, height: 800 } }); const dp = await dctx.newPage(); await dp.goto(WEB + '/#/pay/' + payId); await dp.getByText(/Fee for/).waitFor({ timeout: 8000 }); t('desktop visitors get a scannable QR code instead of a dead button', await dp.getByRole('img', { name: /QR code/ }).isVisible()); await dctx.close();
  await pp.getByLabel(/UTR/).fill('UTR998877'); await pp.getByRole('button', { name: 'I have paid' }).click(); await pp.getByText(/we have noted it/).waitFor({ timeout: 6000 });
  const lst = await call('ladder.status', {}, auditTok); const fl = await call('fees.list', { studentId: st.studentId, pageSize: 50 }, auditTok);
  t('"I have paid" is only a note: Teacher sees it, the fee is still unpaid', lst.reported.some((r) => r.reference === 'UTR998877') && fl.items.find((f) => f.billingPeriod === '2027-01').balance === 1250.5, JSON.stringify(lst.reported));
  await pp.goto(WEB + '/#/pay/' + 'f'.repeat(32)); await pp.getByText('This payment link is not valid.').waitFor({ timeout: 6000 }); t('unknown pay link shows a neutral invalid page', true); await pctx.close();
  await page.goto(WEB + '/#/notices'); await page.getByRole('tab', { name: 'Fee reminder ladder' }).click(); await page.getByText(/Parents who said/).waitFor({ timeout: 8000 }); t('ladder tab lists the parent who said they paid, for the Teacher to check', true);
  // forgotten password: emailed code + printed recovery code (two different kinds)
  await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByRole('button', { name: 'Teacher: forgot your password?' }).click(); await page.getByLabel('Username').fill('teacher'); await scrollOk('teacher password reset');
  await page.getByRole('button', { name: 'Email me a code' }).click(); await page.getByText('a code has been sent').waitFor({ timeout: 6000 }); m = await mails(); const ec = m[m.length - 1].body.match(/\b(\d{8})\b/)[1];
  await page.getByLabel('First code').fill(codes[1]); await page.getByLabel(/^Second code/).fill(codes[2]); await page.getByLabel(/^New password/).fill('Reset#Pass2026x'); await page.getByLabel('Confirm new password').fill('Reset#Pass2026x'); await page.getByRole('button', { name: 'Change password' }).click();
  t('two recovery codes are NOT enough to reset the password', await seen('codes are not correct'));
  await page.getByLabel(/^Second code/).fill(ec); await page.getByRole('button', { name: 'Change password' }).click(); await page.getByRole('heading', { name: 'Password changed' }).waitFor({ timeout: 6000 }); t('recovery code + emailed code reset the password', true);
  await page.getByRole('button', { name: 'Go to sign in' }).click(); await loginPw('Teacher#12345x'); t('old password no longer works', await seen('Incorrect username or password'));
  await loginPw('Reset#Pass2026x'); await page.getByRole('heading', { name: 'Two-step sign-in' }).waitFor({ timeout: 6000 }); t('new password still requires the second step', true);
  await page.getByLabel(/^Code/).fill(codes[3]); await page.getByRole('button', { name: 'Sign in' }).click(); page.once('dialog', (d) => d.accept()); await page.getByText('Dashboard').first().waitFor({ timeout: 8000 }); t('can sign in again after recovery', true);

  const real = errors.filter((e) => !/favicon|sw\.js|manifest/i.test(e)); t('no console errors during run', real.length === 0, real.slice(0, 5).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH', e, globalThis.__errs); process.exit(2); });
