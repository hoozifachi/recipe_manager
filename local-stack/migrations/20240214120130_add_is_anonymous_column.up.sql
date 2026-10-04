do $$
begin
   alter table auth.users 
   add column if not exists is_anonymous boolean not null default false;

   create index if not exists users_is_anonymous_idx  on auth.users using btree (is_anonymous);
end
$$;
