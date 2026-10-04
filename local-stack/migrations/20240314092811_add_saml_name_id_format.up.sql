do $$ begin
alter table auth.saml_providers add column if not exists name_id_format text null;
end $$
