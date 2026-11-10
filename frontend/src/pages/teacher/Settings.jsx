import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Async, Btn, Card, Page, useAction, useApi, useUi } from '../../ui.jsx';
import { Check, Section, useLeaveGuard } from './bshared.jsx';

// [key, label, type, hint, options]
const GROUPS = [
  ['Centre', [['centre_name', 'Centre name (printed on every document)', 's'], ['teacher_name', 'Teacher name', 's'], ['centre_phone', 'Phone', 's'], ['centre_email', 'Email', 's'], ['centre_address', 'Address', 's'], ['timezone', 'Timezone', 's', 'e.g. Asia/Kolkata'], ['default_country_code', 'Default country code for phone numbers', 's', 'Digits only, e.g. 91'], ['session_labels', 'Attendance session labels', 's', 'Comma separated, e.g. Regular, Extra'], ['multi_batch_allowed', 'Allow a student to be in several batches', 'b']]],
  ['Fees', [['fee_default_amount', 'Default monthly fee (₹)', 'n'], ['fee_due_day', 'Default due day of month (1–28)', 'n'], ['late_fee_enabled', 'Offer a late fee', 'b', 'Applied only when you press “Apply late fees”.'], ['late_fee_amount', 'Late fee (₹, flat)', 'n'], ['late_fee_grace_days', 'Grace days before a fee is “overdue”', 'n']]],
  ['Payment details shown to students', [['upi_id', 'UPI ID', 's'], ['upi_payee_name', 'UPI payee name', 's'], ['payment_instructions', 'Payment instructions', 't', 'Shown to students on the Fees screen. Payments only count after you verify them.']]],
  ['Notifications', [['reminders_enabled', 'Scheduled fee reminders', 'b'], ['reminder_day', 'Reminder day of month', 'n'], ['reminder_hour', 'Reminder hour (0–23)', 'n'], ['overdue_followup_enabled', 'Scheduled overdue follow-ups', 'b'], ['overdue_followup_interval_days', 'Overdue follow-up every N days', 'n'], ['absence_alert_enabled', 'Queue absence alerts when attendance is saved', 'b'], ['absence_exception_threshold', 'Flag students with at least N absences (dashboard)', 'n'],
    ['weekly_report_enabled', 'Weekly summary', 'b'], ['weekly_report_hour', 'Weekly summary hour', 'n'], ['weekly_report_recipients', 'Weekly summary recipients (phone numbers)', 's', 'Comma separated'], ['quiet_hours_enabled', 'Respect quiet hours', 'b'], ['quiet_start', 'Quiet hours start (HH:MM)', 's'], ['quiet_end', 'Quiet hours end (HH:MM)', 's'],
    ['tpl_fee_reminder', 'Fee reminder text', 't', 'Placeholders: {{guardian}} {{student}} {{amount}} {{periods}} {{centre}} {{payline}}'], ['tpl_overdue', 'Overdue text', 't'], ['tpl_absence', 'Absence text', 't', '{{guardian}} {{student}} {{date}} {{batch}} {{centre}}'], ['tpl_notice', 'Notice text', 't', '{{centre}} {{title}} {{body}}']]],
  ['Documents (PDF)', [['pdf_page_size', 'Default paper size', 'e', '', [['A4', 'A4'], ['A5', 'A5']]], ['pdf_color_mode', 'Default colour mode', 'e', '', [['colour', 'Colour'], ['bw', 'Black & white']]], ['show_teacher_name', 'Print Teacher name in the header', 'b'], ['watermark_enabled', 'Watermark', 'b'], ['watermark_text', 'Watermark text (blank = centre name)', 's'], ['watermark_position', 'Watermark position', 'e', '', [['center', 'Centre'], ['diagonal', 'Diagonal'], ['top', 'Top'], ['bottom', 'Bottom']]], ['watermark_size', 'Watermark size (12–120)', 'n'], ['watermark_opacity', 'Watermark opacity (0.02–0.3)', 'n'],
    ['verify_show_document_number', 'Show document number on the public verification page', 'b', 'Off by default for privacy.'], ['public_base_url', 'Public web address of this app', 's', 'Document QR codes and parent pay links open this address (#/verify/… and #/pay/…). Must be the final hosted URL, e.g. https://yourname.github.io/tuitiondesk/']]],
  ['Reminder ladder (friendly → polite → firm)', [['ladder_enabled', 'Use the reminder ladder', 'b', 'Replaces the older monthly / overdue reminders. It only prepares messages for you to send.'], ['ladder_before_days', 'Friendly nudge N days before the due date', 'n'], ['ladder_repeat_days', 'Repeat a firm reminder every N days', 'n'], ['ladder_max_firm', 'Stop after N firm reminders (then “needs a call”)', 'n'], ['ladder_adapt', 'Adapt to each family’s payment history', 'b', 'Families who pay on time skip the nudge; habitual late payers get it 4 days earlier.'],
    ['tpl_ladder_friendly', 'Friendly text', 't', 'Placeholders: {{guardian}} {{student}} {{months}} {{amount}} {{due}} {{payline}} {{centre}}'], ['tpl_ladder_due', 'Due-date text', 't', 'Same placeholders'], ['tpl_ladder_firm', 'Firm text', 't', 'Same placeholders plus {{days}} (days overdue). “Firm” starts after the grace days set under Fees.']]],
  ['Fee plans, late fees & credit', [['sibling_discount_percent', 'Sibling discount (%)', 'n', 'Same guardian WhatsApp number = siblings. The eldest pays in full. Not applied retroactively.'], ['auto_apply_credit', 'Use credit on account for the next fee automatically', 'b'],
    ['late_fee_enabled', 'Charge late fees automatically (daily)', 'b', 'Needs the hourly trigger. You can waive a late fee on any fee.'], ['late_fee_mode', 'Late fee type', 'e', '', [['flat', 'Flat amount (₹)'], ['percent', 'Percent of the fee (%)']]], ['late_fee_amount', 'Late fee amount (₹ or %)', 'n'],
    ['late_fee_grace_days', 'Grace days after the due date', 'n'], ['late_fee_repeat_days', 'Repeat every N days (0 = charge once)', 'n'], ['late_fee_max', 'Maximum total late fee per fee (0 = no limit)', 'n']]],
  ['Message languages (Hindi / Bengali)', [['tpl_fee_reminder_hi', 'Fee reminder — Hindi', 't', 'Leave as is or edit. The Hindi and Bengali texts were written by the developer, not a professional translator: please have a native speaker read them.'], ['tpl_fee_reminder_bn', 'Fee reminder — Bengali', 't'],
    ['tpl_overdue_hi', 'Overdue — Hindi', 't'], ['tpl_overdue_bn', 'Overdue — Bengali', 't'], ['tpl_ladder_friendly_hi', 'Friendly nudge — Hindi', 't'], ['tpl_ladder_friendly_bn', 'Friendly nudge — Bengali', 't'], ['tpl_ladder_due_hi', 'Due today — Hindi', 't'], ['tpl_ladder_due_bn', 'Due today — Bengali', 't'],
    ['tpl_ladder_firm_hi', 'Firm — Hindi', 't'], ['tpl_ladder_firm_bn', 'Firm — Bengali', 't'], ['tpl_absence_hi', 'Absence — Hindi', 't'], ['tpl_absence_bn', 'Absence — Bengali', 't']]],
  ['Monthly report to parents', [['monthly_report_enabled', 'Prepare the monthly report automatically', 'b', 'One message per family, put in “Messages to send”. You send it yourself.'], ['monthly_report_day', 'Prepare on day of month (1–28)', 'n']]],
  ['Public enquiry form', [['public_enquiry_enabled', 'Accept enquiries from the public form', 'b', 'Link: your public app address followed by #/enquire. Anyone with the link can submit, so expect some spam; it is rate limited.'], ['public_enquiry_intro', 'Intro text on the form', 't'], ['public_enquiry_hourly_cap', 'Maximum enquiries per hour', 'n']]],
  ['Backups', [['backup_frequency_days', 'Backup every N days (1 = daily)', 'n'], ['backup_retention_days', 'Keep backups for N days', 'n'], ['backup_stale_hours', 'Warn if the last backup is older than N hours', 'n'], ['restore_test_days', 'Warn if no restore test for N days', 'n']]],
];

export default function Settings() {
  const q = useApi('settings.get', {}); const [vals, setVals] = useState(null); const [orig, setOrig] = useState(null); const [run, busy] = useAction(); const ui = useUi();
  useEffect(() => { if (q.data) { setVals({ ...q.data.settings }); setOrig({ ...q.data.settings }); } }, [q.data]);
  const dirty = vals && orig && JSON.stringify(vals) !== JSON.stringify(orig); useLeaveGuard(dirty);
  const save = async (e) => {
    e.preventDefault(); const patch = {}; Object.keys(vals).forEach((k) => { if (vals[k] !== orig[k]) patch[k] = vals[k]; });
    GROUPS.forEach(([, fs]) => fs.forEach(([k, , t]) => { if (k in patch && t === 'n') patch[k] = Number(patch[k]); }));
    if (!Object.keys(patch).length) return ui.ok('Nothing to save.');
    try { await run(() => api('settings.update', { patch }), 'Settings saved.'); q.reload(); } catch { /* toast */ }
  };
  return (
    <Page title="Settings">
      <Async q={q}>{(d) => !vals ? null : (
        <form onSubmit={save}>
          {!vals.centre_name && <p className="banner warn">Set the centre name first — official documents cannot be issued without it.</p>}
          <Card title="Integration status"><ul className="small">
            <li>WhatsApp: you send every message yourself from your own WhatsApp (nothing is sent automatically, no WhatsApp API is used)</li>
            <li>Payment provider callbacks: {d.integrations.paymentCallbacks ? 'secret configured' : 'not configured — all payments need your manual verification'}</li>
            <li>Google Drive documents folder: {d.integrations.documentsFolder ? 'configured' : 'NOT configured'}</li><li>Backup folder: {d.integrations.backupFolder ? 'configured' : 'NOT configured'}</li>
            <li>Environment: {d.environment} · backend version {d.version}</li></ul><p className="hint">API keys and secrets are never entered here. They live in Apps Script “Script Properties” (see the configuration guide).</p></Card>
          {GROUPS.map(([title, fields]) => (
            <Section key={title} title={title}>
              <div className="formgrid">{fields.map(([k, label, t, hint, opts]) => t === 'b' ? <Check key={k} label={label} hint={hint} checked={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.checked })} /> : (
                <label key={k} className={'field' + (t === 't' ? ' wide' : '')}><span className="lbl">{label}</span>
                  {t === 't' ? <textarea rows={3} value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /> : t === 'e' ? <select value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : <input type={t === 'n' ? 'number' : 'text'} step={t === 'n' ? 'any' : undefined} value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />}
                  {hint && <span className="hint">{hint}</span>}</label>))}</div>
            </Section>))}
          <div className="stickybar"><Btn variant="primary" type="submit" busy={busy} disabled={!dirty}>Save settings</Btn>{dirty && <span className="muted"> You have unsaved changes.</span>}</div>
        </form>)}</Async>
    </Page>
  );
}
