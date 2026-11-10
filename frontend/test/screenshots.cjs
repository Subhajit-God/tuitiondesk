// Captures TuitionDesk's own screens (demo data, in-memory backend) for docs/HOSTING_GUIDE.md. Run via test/run-shots.sh
const { chromium } = require('playwright');
const API = 'http://localhost:8787', WEB = 'http://localhost:5173', OUT = process.argv[2];
const call = async (action, params = {}, token) => { const r = await (await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, params, token }) })).json(); if (!r.ok) throw new Error(action + ': ' + JSON.stringify(r.error)); return r.data; };
(async () => {
  const key = await (await fetch(API + '/__setup_key')).text();
  const boot = await call('auth.bootstrap', { setupKey: key, username: 'teacher', password: 'Teacher#12345x', displayName: 'Demo Teacher' });
  const login = await call('auth.login', { username: 'teacher', password: 'Teacher#12345x' }); const tok = login.token;
  await call('settings.update', { patch: { centre_name: 'Demo Tuition Centre', centre_phone: '+91 98765 43210', public_base_url: 'https://example.invalid/app/', upi_id: 'demo@upi', fee_default_amount: 1500, public_enquiry_enabled: true } }, tok);
  const b = await call('batches.create', { name: 'Class 7 Evening', className: '7', slots: [{ weekday: 7, startTime: '07:00', endTime: '09:30' }, { weekday: 3, startTime: '17:00', endTime: '18:30' }] }, tok);
  const b2 = await call('batches.create', { name: 'Class 9 Maths', className: '9', slots: [{ weekday: 1, startTime: '16:00', endTime: '17:30' }] }, tok);
  const s = await call('students.create', { fullName: 'Asha Verma', guardianName: 'R Verma', guardianWhatsapp: '9876543210', whatsappConsent: 'yes', batchIds: [b.batchId], createAccount: false, admissionDate: '2026-09-01' }, tok);
  await call('students.create', { fullName: 'Ravi Kumar', guardianName: 'S Kumar', guardianWhatsapp: '9876500011', whatsappConsent: 'yes', batchIds: [b2.batchId], createAccount: false, admissionDate: '2026-09-01' }, tok);
  await call('plans.create', { name: 'Quarterly 600', monthlyFee: 600, cycle: 'quarterly', admissionFee: 500 }, tok);
  await call('fees.generateRange', { studentId: s.studentId, amountDue: 1500 }, tok);
  await call('enquiries.create', { name: 'Meera', phone: '9876511111', nextActionDate: '2026-11-01', enquiryDate: '2026-10-20', requestedSubject: 'Maths' }, tok);
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); await page.goto(WEB + '/#/'); const keyName = await page.evaluate(() => null);
  await page.evaluate((l) => { for (const k of ['td_session_v1']) localStorage.setItem(k, JSON.stringify(l)); }, login);
  const shot = async (name, hash, ready) => { await page.goto(WEB + '/#/' + hash); await page.reload(); if (ready) await ready(); await page.waitForTimeout(500); await page.screenshot({ path: OUT + '/' + name + '.png' }); };
  await shot('01-today', 'today', () => page.getByRole('heading', { name: /Who to call/ }).waitFor());
  await shot('02-settings', 'settings', () => page.getByRole('heading', { name: /Settings/ }).first().waitFor());
  await shot('03-backups', 'audit', async () => { await page.getByRole('tab', { name: /Backups/ }).click(); });
  await shot('04-plans', 'plans', () => page.getByRole('row', { name: /Quarterly/ }).waitFor());
  const pay = await call('pay.link', { studentId: s.studentId }, tok); const id = pay.url.split('#/pay/')[1];
  await page.setViewportSize({ width: 420, height: 800 }); await shot('05-parent-pay-page', 'pay/' + id, () => page.getByText(/Fee for/).waitFor());
  await shot('06-public-enquiry-form', 'enquire', () => page.getByText(/Send enquiry/).waitFor());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
