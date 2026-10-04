alter table if exists auth.sessions
  add column if not exists refreshed_at timestamp without time zone,
  add column if not exists user_agent text,
  add column if not exists ip inet;
