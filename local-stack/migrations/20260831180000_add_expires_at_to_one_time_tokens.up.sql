/* auth_migration: 20260831180000 */
alter table auth.one_time_tokens
    add column if not exists expires_at timestamptz;
