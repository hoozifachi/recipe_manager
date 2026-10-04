do $$
begin
   if exists (select from information_schema.columns where table_schema = 'auth' and table_name = 'saml_relay_states' and column_name = 'from_ip_address') then
      alter table auth.saml_relay_states drop column from_ip_address;
   end if;
end
$$;
