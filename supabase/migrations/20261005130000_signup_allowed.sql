-- Reports whether the sign-up form should be offered, which is only while no
-- account exists. Deliberately answers "may I sign up" rather than "how many
-- users exist": the answer stops being actionable once a single account
-- exists, so a later visitor learns nothing they could not already infer.
--
-- SECURITY DEFINER is required because auth.users grants nothing to anon or
-- authenticated, so an invoker call would simply fail with permission denied.
-- search_path is pinned empty and the table reference is fully qualified, so
-- the definer's elevated rights cannot be borrowed to read anything else.
--
-- This is the one deliberate exception to the rule that anon holds no
-- privileges in this schema. It has to be readable by a signed-out visitor,
-- because deciding whether to render sign-up happens before sign-in.
create or replace function public.signup_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from auth.users);
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default, so revoke
-- first: otherwise the grants below are decorative and the function stays
-- reachable by every role in the cluster.
revoke execute on function public.signup_allowed() from public;

grant execute on function public.signup_allowed() to anon, authenticated;

-- PostgREST resolves RPCs from a schema cache it builds at startup, so a new
-- function is invisible until something tells it to look again: without this
-- every call fails with PGRST202, "Could not find the function
-- public.signup_allowed without parameters in the schema cache". Local
-- stack:up happens to start PostgREST after this migration so it never shows
-- up there, but a hosted project's PostgREST is already running when db push
-- applies this, and it does not watch for DDL on its own.
notify pgrst, 'reload schema';