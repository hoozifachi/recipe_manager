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

This is a single-user app, so there is no general registration page. The login
page shows a **Create your account** form only while no account exists; once one
does, it is sign-in only, with no way to reach registration.

On a fresh stack that means registering through the UI, which signs you straight
in because GoTrue auto-confirms email locally:

1. `npm run stack:up`, then `npm run dev`
2. Open http://localhost:5173 and register

For a real deployment, register the same way before turning registration off,
by setting `GOTRUE_DISABLE_SIGNUP=true` in `local-stack/gotrue.env` (or the
equivalent **Enable email signup** setting in your Supabase project). The
`signup_allowed` function in the migration hides the form, but that is a UI
convenience, not enforcement: signup stays open at the API level until the
server-side setting is off. Set it.

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
cannot read or write the first account's rows. It also asserts `signup_allowed`
has gone false once an account exists. `test:ui` walks the whole flow in a
browser: sign in, create, search, filter by tag, edit, delete, sign out, then
checks the login page offers no sign-up controls and that a throwaway account
created straight through the auth API can sign in. It uses the system Chromium;
set `CHROME_PATH` if yours is somewhere unusual.

Both create throwaway accounts, which is why `local-stack/gotrue.env` keeps
`GOTRUE_DISABLE_SIGNUP=false`. Turning it off locally breaks them; the tests are
meant for the local stack or a throwaway project.

`smoke` targets whatever `.env.local` points at. Export the two variables to run
it against a hosted project instead:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... npm run smoke
```

It is destructive against whatever it is given, since it signs up throwaway
accounts and clears their recipes and tags.

## Deploying

### 1. Supabase

Create a project, then apply the schema. `db push` connects to the remote
database directly and needs no Docker:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push --dry-run
supabase db push
```

Then in the dashboard:

- **Auth → Email**: turn **Confirm email** off. The account is created through the
  login page, and with confirmation on `signUp` returns no session, so you would
  need SMTP configured just to finish registering.
- **Auth → URL Configuration → Site URL**: set it to the production Vercel URL
  once that exists. Any confirmation email GoTrue sends links back to this, so
  leaving it at the local default puts a `localhost` link in the mail.
- **Settings → API Keys**: create the `default` publishable key
  (`sb_publishable_...`). Legacy `anon`/`service_role` JWTs are deprecated at the
  end of 2026; `service_role` also has no use here because it bypasses RLS.

The migration grants privileges explicitly. This is required, not defensive:
Supabase projects created after 2026-05-30 no longer apply default privileges
for `postgres` in `public`, and a RLS policy is only consulted once the calling
role already holds table privileges. Without those grants `db push` succeeds and
then every query fails with `permission denied for table recipes`.

The `signup_allowed` migration ends with `notify pgrst, 'reload schema'`.
PostgREST resolves RPCs from a schema cache it builds at startup and does not
watch for DDL, so a newly added function is otherwise invisible and every call
fails with `PGRST202`, "Could not find the function ... in the schema cache".
The local stack starts PostgREST after the migrations so it never shows the
problem there, but `db push` applies them to an already-running PostgREST.

Once you have registered in the browser, turn **email signup off** in the Auth
settings so nobody else can.

### 2. Vercel

Import the GitHub repo. `vercel.json` sets the framework, build command, output
directory, and Node version. The rewrite is the part that matters: without it,
refreshing `/recipes/:id` 404s, because Vite builds a single-page app and Vercel
has no fallback for client-side routes.

Set two environment variables, both safe to expose since RLS is what protects
the data:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`.vercelignore` keeps the local stack out of uploads. It matters for
`vercel deploy` from the CLI: Vercel does not apply `.gitignore`, so without it
a deploy would send the 66MB Postgres data directory and the stack's JWT signing
key. A GitHub import only uploads tracked files, which are already clean.

## Notes

- `local-stack/gateway.mjs` exists because `supabase-js` is configured with a
  single project URL, while GoTrue and PostgREST listen on separate ports. The
  gateway strips the `/auth/v1` and `/rest/v1` prefixes and answers CORS, which
  hosted Supabase normally handles in Kong.
- `.env.local` is generated and gitignored. `.env.example` is the template for
  pointing at a hosted Supabase project instead.
- RLS is the real security boundary, not the publishable key: the key ships
  inside the browser bundle, and the policies in the migration are what keep
  rows private.