alter table auth.mfa_factors add column if not exists web_authn_credential jsonb null;
alter table auth.mfa_factors add column if not exists web_authn_aaguid uuid null;
alter table auth.mfa_challenges add column if not exists web_authn_session_data jsonb null;
