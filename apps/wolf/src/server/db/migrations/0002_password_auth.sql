-- Forward-only migration from email OTP to Wolf passwords.
-- schema.sql remains the historical migration. This file is safe to run again.
-- Existing users, memberships, grants, sessions, and audit rows are kept.
-- password_hash stays null until an administrator sets a Wolf password.
-- Null means the account cannot sign in. It is not a blank password.

alter table users add column if not exists password_hash text;
alter table users add column if not exists must_change_password boolean not null default false;

alter table users drop constraint if exists users_password_hash_check;
alter table users add constraint users_password_hash_check check (
  password_hash is null
  or (
    password_hash like '$argon2id$%'
    and length(password_hash) between 50 and 512
  )
);

alter table auth_attempts drop constraint if exists auth_attempts_kind_check;
alter table auth_attempts add constraint auth_attempts_kind_check check (
  kind in ('send', 'verify', 'login')
);

alter table audit_events drop constraint if exists audit_events_type_check;
alter table audit_events add constraint audit_events_type_check check (
  event_type in (
    'sign_in_code_issued',
    'sign_in_suppressed',
    'sign_in_rate_limited',
    'verify_rate_limited',
    'email_failed',
    'otp_rejected_mismatch',
    'otp_rejected_expired',
    'otp_rejected_attempts',
    'otp_rejected_used',
    'otp_verified',
    'session_created',
    'session_revoked',
    'authorization_allowed',
    'authorization_denied',
    'login_succeeded',
    'login_rejected',
    'login_rate_limited',
    'password_changed',
    'password_reset_by_admin',
    'account_provisioned'
  )
);

drop table if exists otp_challenges;
