alter table if exists auth.sessions
  add column if not exists tag text;
