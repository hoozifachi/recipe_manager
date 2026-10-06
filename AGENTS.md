# Recipe Manager - Agent Instructions

## Stack
- React 19 + TypeScript + Vite + Tailwind CSS
- Supabase: Postgres (pgcrypto, pg_trgm), PostgREST, GoTrue
- RLS is the security boundary (publishable key ships to browser)
- Local stack: Docker-free in `local-stack/` (Postgres 18.6 via mise)

## Essential Commands
- `npm run stack:up` - Start local stack (recreates DB from migrations; clears data each run; writes `.env.local`)
- `npm run dev` - Start dev server at http://localhost:5173
- `npm run lint` - Run oxlint (`.oxlintrc.json`)
- `npm run build` - Typecheck (`tsc -b`) then Vite build
- `npm run preview` - Preview built app
- `npm run smoke` - Run end-to-end queries against target in `.env.local` (destructive; creates/deletes test accounts/recipes)
- `npm run test:ui` - Run Puppeteer UI test (requires `npm run dev` running; uses system Chromium, set `CHROME_PATH` if needed)

## Architecture (Repo-specific)
- **Data layer**: `src/lib/queries.ts` contains all DB operations. Uses Supabase RPCs: `search_recipes(query, tag_ids, ...)` and `get_recipe(recipe_id)`. Search combines generated `search_vector` (weighted title/A, ingredients/B, description/C, notes/D) + 0.5× tag name tsvector, with title/ilike and tag name ilike as prefix fallback. `listRecipes()` calls `search_recipes` with `query=null`.
- **Single-user app**: sign-up exists only as a bootstrap path. `signup_allowed()` (SECURITY DEFINER, granted to `anon` — the one deliberate exception to the anon-gets-nothing rule) tells `LoginPage` whether to render sign-up or sign-in; it is false as soon as one account exists. **Not enforcement**: the API-level signup stays open until `GOTRUE_DISABLE_SIGNUP=true` / hosted email-signup-off is set. Keep local signup ENABLED (`gotrue.env`) because smoke/ui tests need throwaway accounts.
- **Types**: `src/lib/types.ts` exports `Database` (generated from schema) and derived types including `RecipeWithTags` (omits `search_vector`, `user_id`; includes `rank` and `tags: RecipeTag[]`).
- **Client**: `src/lib/supabase.ts` requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at startup (throws if missing). Persists/refreshes session.
- **Validation**: Client-side validation in `queries.ts` (e.g. title non-empty, rating 1-5, servings>=1, prep/cook>=0). Check constraint errors (23514) mapped to user-friendly message.
- **Tags**: Many-to-many via `recipe_tags`. `resolveTagIds()` upserts missing tags by name scoped to user; handles duplicate key race by re-reading.
- **RLS enforcement**: All tables have RLS enabled; policies use `(select auth.uid()) = user_id`. `recipe_tags` checked via existence against owning recipe and (for insert) owning tag. Only `authenticated` role granted table privileges; `anon` has none (bar `signup_allowed`). See migration notes about explicit grants for newer Supabase projects.

## Database (Critical)
- **Migrations**: `supabase/migrations/20261004150000_create_recipe_schema.sql` then `20261005130000_signup_allowed.sql` (the single-user gate). `local-stack/up.sh` applies every `*.sql` in that dir in filename order. Contains extensions (pgcrypto, pg_trgm), `ingredients_to_tsvector()` helper (IMMUTABLE wrapper around STABLE `array_to_string`), tables, indexes (GIN on `search_vector`, GIN trgm on `title`, user indexes), triggers (`set_updated_at()`), RPCs (`search_recipes`, `get_recipe`), RLS policies, and **explicit grants** (required on projects created after 2026-05-30 where default privileges missing). `ingredients_to_tsvector` granted EXECUTE (needed for generated column evaluation on writes).
- **Search behavior**: `search_recipes` accepts `query` (text), `tag_ids` (uuid[]), optional paging. Empty/blank query returns all. Tag filter applied before limit. Returns `tags` as JSONB aggregated from joined `recipe_tags`/`tags`. `get_recipe` delegates to `search_recipes` with null filters and filters by id.
- **Constraints**: `recipes.rating` smallint 1-5; `servings>0`, `prep_time/cook_time>=0` (or null); `tags.name` non-empty trimmed; unique `(user_id,name)`.
- **New RPC needs `notify pgrst, 'reload schema';`**: PostgREST resolves functions from a schema cache built at startup, so a migration adding an RPC is invisible until it is told to re-read. Symptom is PGRST202 / "Could find the function ... in the schema cache". Local `stack:up` starts PostgREST after migrations so it never bites there; a hosted project is already running when `db push` runs, so **any migration adding a function must end with the NOTIFY**.
- **Local stack specifics**: `local-stack/up.sh` pre-applies GoTrue migrations, records versions in `auth.schema_migrations`, drops/adjusts some constraints to make GoTrue re-run safe, sets DB `search_path=auth,public`, grants roles, runs app migration, starts auth/postgrest/gateway, writes `.env.local`. DB recreated each run (data lost). GoTrue auto-confirms emails locally; registration signs in directly. The `auth` and `postgrest` binaries are **gitignored and not committed** — a fresh clone cannot `stack:up` until they are fetched from the supabase/auth and PostgREST GitHub releases into `local-stack/`.

## App Flow
- Routes under `src/routes/` with `RequireAuth` wrapper (`src/auth/`). Auth context in `src/auth/AuthContext.tsx`.
- Supabase project URL same for auth/rest; local uses `gateway.mjs` (strips `/auth/v1`, `/rest/v1`, adds CORS). Hosted uses Kong.

## Testing & Verification
- **smoke**: Bundles `scripts/smoke.ts` (imports real `src/lib/*`) via esbuild, sets VITE_* defines. Tests search (ingredient, title prefix/trigram), tag filtering by RPC, tag creation/upsert, validation, `get_recipe` (direct lookup + not found), RLS isolation across two accounts, cross-account write/read protection, signed-out behavior (0 rows or permission denied - both acceptable). Destructive.
- **UI**: Puppeteer drives full flow (login redirect, invalid creds, signin, create, search/filter, edit, delete, sign out). Uses REST/auth directly for setup cleanup.
- Build/lint must pass before considering task complete (`npm run lint`, `npm run build`).

## Config Notes
- `vite.config.ts`: React + Tailwind via `@tailwindcss/vite`.
- `tsconfig.app.json`: ES2023, strict-ish linting flags (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`), `moduleResolution: bundler`.
- `oxlint`: React + TypeScript + oxc plugins; warns on `only-export-components` with `allowConstantExport`.
- `vercel.json`: SPA rewrite for client routes. `.vercelignore` excludes local-stack (prevents large uploads in CLI deploys).

## Gotchas (Avoid Mistakes)
- Trust executable sources: migration/schema and queries define reality. Docs (README) align but prefer code/migration for details.
- `search_recipes` RPC param is `tag_ids` (array of UUIDs) - not camelCase. Queries do this correctly.
- When writing recipes/tags, respect user scoping (RLS + explicit user_id on inserts). The app passes `userId` to `createRecipe`/`updateRecipe`.
- Duplicate tag insert race handled in `resolveTagIds()` by catching "duplicate key" and re-reading.
- Generated column `search_vector` uses `ingredients_to_tsvector()` (IMMUTABLE) and evaluates with caller privileges; migration grants EXECUTE to authenticated.
- Local stack recreates DB every `stack:up` - accounts/recipes lost. UI/smoke expect clean state.
- Smoke/UI destructive by design - only run against local stack or throwaway targets.
- No Docker required locally; Postgres from mise at `$HOME/.local/share/mise/installs/postgres/18.6/bin/`.
- Prefer editing existing files; follow existing code style (no comments unless asked).
- Check package.json scripts first for verification commands (lint/build/smoke/test:ui).
