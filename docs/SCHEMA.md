# Database schema (Google Sheet tabs)

Generated from backend/Config.gs. Each tab is one table; the first column is the stable ID. Do not edit tabs by hand: the app validates every write, and hand edits bypass the audit log and ledger rules. setupDatabase() creates all tabs and header rows (and appends new columns on upgrade).

Totals (outstanding, paid, balance, credit) are **never stored**. They are derived from Fees + FeeAdjustments + PaymentAllocations.

Users.totp_secret and totp_pending are sealed (not readable without the Script Property MFA_KEY); recovery_hashes holds only SHA-256 hashes.

## TuitionCentreSettings

| Column | Type |
|---|---|
| setting_key | text |
| setting_value | text |
| updated_at | text |
| updated_by | text |

## Users

| Column | Type |
|---|---|
| user_id | text |
| username | text |
| password_hash | text |
| salt | text |
| iterations | integer |
| role | text |
| student_id | text |
| display_name | text |
| status | text |
| must_change_password | boolean |
| last_login_at | text |
| totp_secret | text |
| totp_pending | text |
| totp_enabled | boolean |
| totp_last_step | integer |
| recovery_hashes | text |
| recovery_email | text |
| created_at | text |
| updated_at | text |

## Sessions

| Column | Type |
|---|---|
| session_hash | text |
| user_id | text |
| role | text |
| student_id | text |
| created_at | text |
| expires_at | text |
| revoked | boolean |

## Students

| Column | Type |
|---|---|
| student_id | text |
| user_id | text |
| full_name | text |
| guardian_name | text |
| guardian_whatsapp | text |
| whatsapp_consent | text |
| contact_email | text |
| admission_date | text |
| status | text |
| notes | text |
| reminder_mode | text |
| reminder_pause_until | text |
| leaving_date | text |
| leaving_reason | text |
| monthly_fee | number |
| plan_id | text |
| no_sibling_discount | boolean |
| language | text |
| created_at | text |
| updated_at | text |

## Batches

| Column | Type |
|---|---|
| batch_id | text |
| name | text |
| subject | text |
| capacity | integer |
| status | text |
| description | text |
| created_at | text |
| updated_at | text |
| class_name | text |

## StudentBatchLinks

| Column | Type |
|---|---|
| link_id | text |
| student_id | text |
| batch_id | text |
| start_date | text |
| end_date | text |
| status | text |
| created_at | text |
| updated_at | text |

## FeePlans

| Column | Type |
|---|---|
| plan_id | text |
| name | text |
| monthly_fee | number |
| cycle | text |
| admission_fee | number |
| status | text |
| note | text |
| created_at | text |
| updated_at | text |

## Fees

| Column | Type |
|---|---|
| fee_id | text |
| student_id | text |
| kind | text |
| months | integer |
| billing_period | text |
| amount_due | number |
| due_date | text |
| status | text |
| note | text |
| created_by | text |
| created_at | text |
| updated_at | text |

## FeeAdjustments

| Column | Type |
|---|---|
| adjustment_id | text |
| fee_id | text |
| student_id | text |
| kind | text |
| amount | number |
| reason | text |
| idempotency_key | text |
| created_by | text |
| created_at | text |

## Payments

| Column | Type |
|---|---|
| payment_id | text |
| student_id | text |
| kind | text |
| parent_payment_id | text |
| amount | number |
| method | text |
| provider_reference | text |
| source | text |
| verification_status | text |
| verification_method | text |
| reconciliation_note | text |
| verified_by | text |
| verified_at | text |
| received_at | text |
| notes | text |
| rejected_reason | text |
| idempotency_key | text |
| created_by | text |
| created_at | text |
| updated_at | text |

## PaymentAllocations

| Column | Type |
|---|---|
| allocation_id | text |
| payment_id | text |
| fee_id | text |
| student_id | text |
| amount | number |
| reason | text |
| created_by | text |
| created_at | text |

## Receipts

| Column | Type |
|---|---|
| receipt_id | text |
| receipt_number | text |
| payment_id | text |
| student_id | text |
| amount | number |
| issued_at | text |
| status | text |
| verification_id | text |
| created_at | text |

## AttendanceSessions

| Column | Type |
|---|---|
| session_id | text |
| batch_id | text |
| session_date | text |
| session_label | text |
| created_by | text |
| saved_at | text |
| idempotency_key | text |

## AttendanceEntries

| Column | Type |
|---|---|
| attendance_id | text |
| session_id | text |
| student_id | text |
| status | text |
| correction_reason | text |
| updated_by | text |
| updated_at | text |

## Tests

| Column | Type |
|---|---|
| test_id | text |
| batch_id | text |
| title | text |
| subject | text |
| test_date | text |
| max_marks | number |
| publication_status | text |
| published_at | text |
| published_by | text |
| created_at | text |
| updated_at | text |

## TestResults

| Column | Type |
|---|---|
| result_id | text |
| test_id | text |
| student_id | text |
| marks | number (nullable) |
| result_status | text |
| teacher_comment | text |
| updated_by | text |
| updated_at | text |

## Homework

| Column | Type |
|---|---|
| homework_id | text |
| audience_type | text |
| batch_id | text |
| student_id | text |
| title | text |
| subject | text |
| instructions | text |
| assigned_date | text |
| due_date | text |
| resource_url | text |
| publication_status | text |
| status | text |
| created_at | text |
| updated_at | text |

## Timetable

| Column | Type |
|---|---|
| schedule_id | text |
| batch_id | text |
| kind | text |
| weekday | integer |
| date | text |
| start_time | text |
| end_time | text |
| subject | text |
| room | text |
| note | text |
| status | text |
| published | boolean |
| created_at | text |
| updated_at | text |

## Enquiries

| Column | Type |
|---|---|
| enquiry_id | text |
| enquiry_date | text |
| name | text |
| guardian_name | text |
| phone | text |
| requested_subject | text |
| requested_batch_id | text |
| source | text |
| notes | text |
| next_action | text |
| next_action_date | text |
| status | text |
| converted_student_id | text |
| created_at | text |
| updated_at | text |

## EnquiryFollowups

| Column | Type |
|---|---|
| followup_id | text |
| enquiry_id | text |
| note | text |
| next_action | text |
| next_action_date | text |
| created_by | text |
| created_at | text |

## Admissions

| Column | Type |
|---|---|
| admission_id | text |
| enquiry_id | text |
| student_id | text |
| batch_id | text |
| admission_date | text |
| source | text |
| status | text |
| created_by | text |
| created_at | text |

## Notices

| Column | Type |
|---|---|
| notice_id | text |
| title | text |
| body | text |
| audience_type | text |
| batch_id | text |
| student_id | text |
| status | text |
| published_at | text |
| created_by | text |
| created_at | text |
| updated_at | text |

## Notifications

| Column | Type |
|---|---|
| notification_id | text |
| idempotency_key | text |
| trigger | text |
| student_id | text |
| recipient | text |
| channel | text |
| template | text |
| template_version | text |
| message | text |
| status | text |
| status_reason | text |
| not_before | text |
| attempts | integer |
| last_attempt_at | text |
| provider_message_id | text |
| provider_response | text |
| next_retry_at | text |
| related_type | text |
| related_id | text |
| created_at | text |
| updated_at | text |

## DocumentVerification

| Column | Type |
|---|---|
| verification_id | text |
| document_number | text |
| doc_type | text |
| version | integer |
| supersedes | text |
| record_ref | text |
| student_id | text |
| issued_at | text |
| issued_by | text |
| status | text |
| revoked_at | text |
| revoked_by | text |
| revoke_reason | text |
| file_id | text |
| file_name | text |
| content_hash | text |
| snapshot_json | text |

## AuditLogs

| Column | Type |
|---|---|
| audit_id | text |
| at | text |
| actor_user_id | text |
| actor_role | text |
| action | text |
| entity_type | text |
| entity_id | text |
| details | JSON text |

## Enrolments

| Column | Type |
|---|---|
| enrolment_id | text |
| student_id | text |
| start_date | text |
| end_date | text |
| leave_reason | text |
| leave_note | text |
| status | text |
| created_by | text |
| created_at | text |
| updated_at | text |

## PayLinks

| Column | Type |
|---|---|
| link_id | text |
| student_id | text |
| created_at | text |
| last_reported_at | text |
| report_count | integer |
| last_reported_ref | text |
| updated_at | text |

## BackupLog

| Column | Type |
|---|---|
| backup_id | text |
| kind | text |
| started_at | text |
| finished_at | text |
| status | text |
| file_id | text |
| file_name | text |
| details | text |
| created_by | text |

## JobRuns

| Column | Type |
|---|---|
| run_id | text |
| job | text |
| started_at | text |
| finished_at | text |
| status | text |
| details | text |

