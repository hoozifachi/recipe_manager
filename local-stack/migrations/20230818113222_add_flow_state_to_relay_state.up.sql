alter table auth.saml_relay_states add column if not exists flow_state_id uuid references auth.flow_state(id) on delete cascade default null;
