/**
 * TuitionDesk backend — Config.gs
 * Constants, enumerations and the complete Google Sheets schema.
 *
 * Column type codes (suffix after ":"):  (none)=string  n=number  i=integer
 *   nn=nullable number  b=boolean  j=JSON text
 * The FIRST column of every table is its permanent unique ID (never a row number).
 */
var TD = {
  VERSION: '1.0.0',
  SESSION_TTL_HOURS: 12,
  PW_MIN_LENGTH: 8,
  TEACHER_PW_MIN_LENGTH: 10,
  PW_ITERATIONS_DEFAULT: 1500,
  MAX_CELL_CHARS: 45000,
  MAX_BODY_BYTES: 3 * 1024 * 1024,
  MAX_PAGE_SIZE: 100,
  LOGIN_MAX_FAILS: 5,
  LOGIN_LOCK_SECONDS: 900,
  VERIFY_MAX_PER_MINUTE: 120,
  PAY_MAX_PER_MINUTE: 120,
  /** 'self' = the Teacher sends every message from their own WhatsApp (default; no provider API is ever called). 'api' is a legacy opt-in kept only for tests and is not documented as a feature. */
  MESSAGING: 'self',
  LOCK_WAIT_MS: 25000
};

var ROLES = { TEACHER: 'teacher', STUDENT: 'student' };
var ATT = { P: 'P', A: 'A', H: 'H' };
var RESULT_STATUS = ['entered', 'absent', 'exempt', 'not_entered'];

function cols_(spec) {
  return spec.trim().split(/\s+/).map(function (s) {
    var p = s.split(':');
    return { name: p[0], type: p[1] || 's' };
  });
}

var SCHEMA = {
  TuitionCentreSettings: cols_('setting_key setting_value updated_at updated_by'),
  Users: cols_('user_id username password_hash salt iterations:i role student_id display_name status must_change_password:b last_login_at totp_secret totp_pending totp_enabled:b totp_last_step:i recovery_hashes recovery_email created_at updated_at'),
  Sessions: cols_('session_hash user_id role student_id created_at expires_at revoked:b'),
  Students: cols_('student_id user_id full_name guardian_name guardian_whatsapp whatsapp_consent contact_email admission_date status notes reminder_mode reminder_pause_until leaving_date leaving_reason monthly_fee:n plan_id no_sibling_discount:b language created_at updated_at'),
  Batches: cols_('batch_id name subject capacity:i status description created_at updated_at class_name'),
  StudentBatchLinks: cols_('link_id student_id batch_id start_date end_date status created_at updated_at'),
  FeePlans: cols_('plan_id name monthly_fee:n cycle admission_fee:n status note created_at updated_at'),
  Fees: cols_('fee_id student_id kind months:i billing_period amount_due:n due_date status note created_by created_at updated_at'),
  FeeAdjustments: cols_('adjustment_id fee_id student_id kind amount:n reason idempotency_key created_by created_at'),
  Payments: cols_('payment_id student_id kind parent_payment_id amount:n method provider_reference source verification_status verification_method reconciliation_note verified_by verified_at received_at notes rejected_reason idempotency_key created_by created_at updated_at'),
  PaymentAllocations: cols_('allocation_id payment_id fee_id student_id amount:n reason created_by created_at'),
  Receipts: cols_('receipt_id receipt_number payment_id student_id amount:n issued_at status verification_id created_at'),
  AttendanceSessions: cols_('session_id batch_id session_date session_label created_by saved_at idempotency_key'),
  AttendanceEntries: cols_('attendance_id session_id student_id status correction_reason updated_by updated_at'),
  Tests: cols_('test_id batch_id title subject test_date max_marks:n publication_status published_at published_by created_at updated_at'),
  TestResults: cols_('result_id test_id student_id marks:nn result_status teacher_comment updated_by updated_at'),
  Homework: cols_('homework_id audience_type batch_id student_id title subject instructions assigned_date due_date resource_url publication_status status created_at updated_at'),
  Timetable: cols_('schedule_id batch_id kind weekday:i date start_time end_time subject room note status published:b created_at updated_at'),
  Enquiries: cols_('enquiry_id enquiry_date name guardian_name phone requested_subject requested_batch_id source notes next_action next_action_date status converted_student_id created_at updated_at'),
  EnquiryFollowups: cols_('followup_id enquiry_id note next_action next_action_date created_by created_at'),
  Admissions: cols_('admission_id enquiry_id student_id batch_id admission_date source status created_by created_at'),
  Notices: cols_('notice_id title body audience_type batch_id student_id status published_at created_by created_at updated_at'),
  Notifications: cols_('notification_id idempotency_key trigger student_id recipient channel template template_version message status status_reason not_before attempts:i last_attempt_at provider_message_id provider_response next_retry_at related_type related_id created_at updated_at'),
  DocumentVerification: cols_('verification_id document_number doc_type version:i supersedes record_ref student_id issued_at issued_by status revoked_at revoked_by revoke_reason file_id file_name content_hash snapshot_json'),
  AuditLogs: cols_('audit_id at actor_user_id actor_role action entity_type entity_id details:j'),
  Enrolments: cols_('enrolment_id student_id start_date end_date leave_reason leave_note status created_by created_at updated_at'),
  PayLinks: cols_('link_id student_id created_at last_reported_at report_count:i last_reported_ref updated_at'),
  BackupLog: cols_('backup_id kind started_at finished_at status file_id file_name details created_by'),
  JobRuns: cols_('run_id job started_at finished_at status details')
};

/** Display labels for document types (also used by the public verifier). */
var DOC_TYPES = {
  admission_form: 'Admission Form',
  admission_confirmation: 'Admission Confirmation',
  id_card: 'Student ID Card',
  fee_statement: 'Fee Statement',
  fee_reminder: 'Fee Reminder',
  receipt: 'Payment Receipt',
  attendance_summary: 'Attendance Summary',
  report_card: 'Report Card',
  test_report: 'Test Report',
  homework_summary: 'Homework Summary',
  notice: 'Notice / Circular',
  enquiry_record: 'Enquiry / Admission Record',
  batch_report: 'Batch Report',
  financial_summary: 'Financial Summary',
  no_dues_certificate: 'No-Dues Certificate',
  leaving_certificate: 'Leaving Certificate',
  verification_certificate: 'Verification Certificate'
};
