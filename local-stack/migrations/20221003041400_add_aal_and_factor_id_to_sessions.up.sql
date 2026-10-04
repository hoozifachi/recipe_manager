-- add factor_id to sessions
 alter table auth.sessions add column if not exists factor_id uuid null;
 alter table auth.sessions add column if not exists aal auth.aal_level null;
