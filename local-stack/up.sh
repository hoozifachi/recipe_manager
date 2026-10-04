#!/usr/bin/env bash
# Brings up a Docker-free local Supabase: Postgres (mise), GoTrue (auth), and
# PostgREST (postgrest) as three standalone processes.
#
# The auth migrations are pre-applied and recorded in auth.schema_migrations,
# which keeps GoTrue's runner from re-executing them. That runner is not
# idempotent outside Supabase's container image, where migrations are applied
# exactly once and the constraint/column adds never see a pre-existing object.
set -euo pipefail

PGBIN="$HOME/.local/share/mise/installs/postgres/18.6/bin"
STACK=$(cd "$(dirname "$0")" && pwd)
PROJECT=$(dirname "$STACK")
PGROOT=$STACK/.data
PGDATA=$PGROOT/pgdata
PGPORT=54329
DB=fullstack
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"

export PGHOST=$PGROOT PGPORT=$PGPORT PGUSER=postgres

pkill -x postgrest 2>/dev/null || true
pkill -x auth 2>/dev/null || true
# Scoped to this script's gateway: a bare `pkill -x node` would take the Vite dev
# server down with it. up.sh's own command line never contains "gateway.mjs".
pkill -f 'gateway.mjs' 2>/dev/null || true
sleep 1

mkdir -p "$PGROOT"

if [ ! -d "$PGDATA" ]; then
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGROOT/pg.log" \
    -o "-p $PGPORT -k $PGROOT" start >/dev/null
  sleep 2
fi

"$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 || \
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGROOT/pg.log" -o "-p $PGPORT -k $PGROOT" start >/dev/null
sleep 2

"$PGBIN/dropdb" --if-exists "$DB" >/dev/null
"$PGBIN/createdb" "$DB"

# GoTrue owns the auth schema and runs these itself.
"$PGBIN/psql" -q -d "$DB" -c "create schema auth;" >/dev/null
for f in "$STACK"/migrations/*.up.sql; do
  "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
done
# GoTrue records bare timestamps (e.g. 20210710035447), not the filename stem.
ls "$STACK"/migrations/*.up.sql | sed 's|.*/||; s/_.*//' | paste -sd, - > "$PGROOT/versions.txt"
# GoTrue's runner tracks applied versions in auth.schema_migrations. Recording
# the pre-applied versions there stops it from re-executing migrations that add
# columns and constraints without an existence check.
"$PGBIN/psql" -q -d "$DB" <<SQL
insert into auth.schema_migrations (version)
select unnest(string_to_array('$(cat "$PGROOT/versions.txt")', ','))
on conflict do nothing;
SQL

# A migration that adds an FK constraint is not idempotent, and the constraint
# already exists from the pre-applied pass, so drop it before GoTrue gets there.
"$PGBIN/psql" -q -d "$DB" \
  -c "alter table auth.sessions drop constraint if exists sessions_oauth_client_id_fkey;" >/dev/null

# Roles are cluster-wide, but the application's RLS policies name them, so they
# have to exist before the migration runs.
"$PGBIN/psql" -q -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
end $$;
SQL

# The application schema.
"$PGBIN/psql" -q -v ON_ERROR_STOP=1 -d "$DB" \
  -f "$PROJECT/supabase/migrations/20261004150000_create_recipe_schema.sql" >/dev/null

# PostgREST connects as postgres and switches role per request, so it needs
# privileges on everything in public.
"$PGBIN/psql" -q -d "$DB" <<'SQL'
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;
SQL

# GoTrue's migrations are not idempotent against a pre-applied schema: several
# add a constraint without checking first. Drop the ones it trips on so its
# runner can proceed, and let it record the remaining versions itself.
"$PGBIN/psql" -q -d "$DB" <<'SQL'
alter table auth.sessions drop constraint if exists sessions_oauth_client_id_fkey;
alter table auth.oauth_authorizations drop constraint if exists oauth_authorizations_nonce_length;
SQL

cd "$STACK"
# GoTrue's queries are written unqualified ("from identities"), so auth has to
# be on the database search_path the way Supabase configures it for the auth
# service. This has to happen after the application migration, which creates
# unqualified tables that would otherwise land in auth.
"$PGBIN/psql" -q -d "$DB" -c "alter database $DB set search_path = auth, public;" >/dev/null
(set -a; . ./gotrue.env; set +a
 export DATABASE_URL="postgresql://postgres@localhost:$PGPORT/$DB?host=$PGROOT&port=$PGPORT"
 setsid --fork ./auth > "$PGROOT/gotrue.log" 2>&1 < /dev/null)
cat > "$STACK/postgrest.conf" <<EOF
db-uri = "postgresql://postgres@localhost:$PGPORT/$DB?host=$PGROOT&port=$PGPORT"
db-schemas = "public"
db-anon-role = "anon"
db-authenticated-role = "authenticated"
server-port = 30000
server-host = "127.0.0.1"
jwt-secret = "$JWT_SECRET"
log-level = "error"
EOF
setsid --fork ./postgrest "$STACK/postgrest.conf" > "$PGROOT/pgrst.log" 2>&1 < /dev/null

# supabase-js is configured with one project URL, so /auth/v1 and /rest/v1 must
# arrive on the same port the way Kong fans them out in hosted Supabase.
setsid --fork node gateway.mjs > "$PGROOT/gateway.log" 2>&1 < /dev/null

sleep 6
node mkjwt.mjs "$JWT_SECRET" anon anon > "$STACK/anon.key"

# Point the app at the gateway so `npm run dev` works straight after this.
cat > "$PROJECT/.env.local" <<EOF
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=$(cat "$STACK/anon.key")
EOF

printf 'gateway:   %s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/auth/v1/health)"
printf 'rest:      %s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/rest/v1/)"
printf 'anon key:  %s\n' "$(cat "$STACK/anon.key")"
printf '\nwrote %s\n' "$PROJECT/.env.local"