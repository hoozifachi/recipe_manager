# Recipe Manager

A single-user recipe manager: search across recipes, organise them with
free-form tags, and keep the whole thing private behind Supabase auth.

- React 19 + TypeScript + Vite + Tailwind CSS
- Postgres full-text search (weighted) with row level security
- Supabase auth (email + password)

## Running it

The usual way to run Supabase locally is `supabase start`, which needs Docker.
This machine has no Docker access, so the project ships a Docker-free stack in
`local-stack/` that runs the same three services as plain processes:

| Service     | Port    | What it does                        |
| ----------- | ------- | ----------------------------------- |
| Postgres    | `54329` | the database (socket in `.data/`)   |
| GoTrue      | `9999`  | auth (`local-stack/auth`)           |
| PostgREST   | `30000` | the REST API (`local-stack/postgrest`) |
| gateway     | `54321` | serves both under one Supabase-style URL |

```bash
npm run stack:up   # start the database, auth, REST API, and gateway
npm run dev        # http://localhost:5173
```

`stack:up` recreates the database from `supabase/migrations/` on every run, so
local data does not survive it. It writes `.env.local` with the generated anon
key, so there is nothing else to configure.

The first launch initialises a Postgres cluster under `local-stack/.data/`
(using the Postgres 18.6 build installed via `mise`). That takes a few seconds;
later runs reuse it.

### Creating an account

The login page has a **Create one** toggle for registering the account. GoTrue
on the local stack auto-confirms email, so registering signs you straight in.

For a real deployment, create the account first and then turn registration off
by setting `GOTRUE_DISABLE_SIGNUP=true` in `local-stack/gotrue.env` (or the
equivalent setting in your Supabase project), so nobody else can register.

Note that `stack:up` recreates the database every run, which deletes accounts
along with everything else. You will need to register again after each run
unless you change that.

## Verifying it

```bash
npm run smoke      # exercises src/lib/queries.ts against the local stack
npm run test:ui    # drives the real UI in Chromium (needs `npm run dev` running)
npm run lint
npm run build
```

`smoke` covers search, tag filtering, validation, and confirms a second account
cannot read or write the first account's rows. `test:ui` walks the whole flow in
a browser: register, sign in, create, search, filter by tag, edit, delete,
sign out. It uses the system Chromium; set `CHROME_PATH` if yours is somewhere
unusual.

## Notes

- `local-stack/gateway.mjs` exists because `supabase-js` is configured with a
  single project URL, while GoTrue and PostgREST listen on separate ports. The
  gateway strips the `/auth/v1` and `/rest/v1` prefixes and answers CORS, which
  hosted Supabase normally handles in Kong.
- `.env.local` is generated and gitignored. `.env.example` is the template for
  pointing at a hosted Supabase project instead.
- RLS is the real security boundary, not the anon key: the key ships inside the
  browser bundle, and the policies in the migration are what keep rows private.