alter table if exists auth.sessions
  add column if not exists oauth_client_id uuid;

alter table auth.sessions
  add constraint sessions_oauth_client_id_fkey foreign key (oauth_client_id)
  references auth.oauth_clients(id) on delete cascade not valid;

alter table auth.sessions
  validate constraint sessions_oauth_client_id_fkey;

create index if not exists sessions_oauth_client_id_idx on auth.sessions (oauth_client_id);
