create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- array_to_string is only STABLE, so it cannot be called directly from a
-- generated column, which requires IMMUTABLE. Re-declaring it as immutable is
-- safe here: text[] has no element output function whose behaviour could vary
-- between calls.
create or replace function ingredients_to_tsvector(input text[])
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_tsvector('english', coalesce(array_to_string(input, ' '), ''));
$$;

-- recipes -------------------------------------------------------------------
-- ingredients and steps are text arrays: one array element per line, which is
-- what the editor textarea produces and what a future scraper can fill in
-- directly. search_vector is generated so the weights live with the data and
-- the GIN index can serve queries against it.
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  ingredients text[] not null default '{}',
  steps text[] not null default '{}',
  notes text,
  prep_time_minutes integer check (prep_time_minutes is null or prep_time_minutes >= 0),
  cook_time_minutes integer check (cook_time_minutes is null or cook_time_minutes >= 0),
  servings integer check (servings is null or servings > 0),
  rating smallint check (rating between 1 and 5),
  source_url text,
  search_vector tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(ingredients_to_tsvector(ingredients), 'B') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(notes, '')), 'D')
    ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_search_idx on recipes using gin (search_vector);
create index recipes_user_idx on recipes (user_id);
-- trigram index backs the prefix-match fallback in search_recipes, so typing
-- a partial word like "choc" still returns "chocolate".
create index recipes_title_trgm_idx on recipes using gin (title gin_trgm_ops);

-- tags ----------------------------------------------------------------------
-- Free-form and many-to-many. The unique constraint per user lets the editor
-- treat tag names as a stable vocabulary while still allowing any new label.
create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index tags_user_idx on tags (user_id);

create table recipe_tags (
  recipe_id uuid not null references recipes (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  primary key (recipe_id, tag_id)
);

create index recipe_tags_tag_idx on recipe_tags (tag_id);

-- updated_at ----------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger recipes_set_updated_at
  before update on recipes
  for each row execute function set_updated_at();

-- search --------------------------------------------------------------------
-- Returns recipes ranked by relevance to `query`, optionally narrowed to the
-- supplied tag ids. security invoker so the caller's RLS policies apply, and
-- stable so PostgREST can order by the rank column without re-evaluating.
create or replace function search_recipes(
  query text,
  tag_ids uuid[] default null,
  result_limit integer default null,
  result_offset integer default null
)
returns table (
  id uuid,
  title text,
  description text,
  ingredients text[],
  steps text[],
  notes text,
  prep_time_minutes integer,
  cook_time_minutes integer,
  servings integer,
  rating smallint,
  source_url text,
  created_at timestamptz,
  updated_at timestamptz,
  rank real,
  tags jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Resolved once so the parser sees a blank query as null rather than an empty
  -- tsquery, which would raise a notice and rank everything at zero.
  with q as (
    select case
      when query is null or btrim(query) = '' then null
      else websearch_to_tsquery('english', query)
    end as tsq
  ),
  -- Tag names are not in the generated search_vector, so they are gathered here
  -- and matched (and ranked, at half weight) alongside the recipe's own fields.
  tag_text as (
    select
      rt.recipe_id,
      string_agg(t.name, ' ' order by t.name) as names,
      to_tsvector('english', string_agg(t.name, ' ' order by t.name)) as vector
    from public.recipe_tags rt
    join public.tags t on t.id = rt.tag_id
    group by rt.recipe_id
  ),
  scored as (
    select
      r.*,
      case
        when q.tsq is null then 0::real
        else ts_rank(r.search_vector, q.tsq)
             + ts_rank(coalesce(tt.vector, ''::tsvector), q.tsq) * 0.5
      end as rank
    from public.recipes r
    left join tag_text tt on tt.recipe_id = r.id
    cross join q
    where q.tsq is null
       or r.search_vector @@ q.tsq
       -- prefix fallback: full-text alone will not match "choc" for
       -- "chocolate", which feels broken in a search-as-you-type box.
       or r.title ilike '%' || query || '%'
       or tt.names ilike '%' || query || '%'
  )
  select
    s.id,
    s.title,
    s.description,
    s.ingredients,
    s.steps,
    s.notes,
    s.prep_time_minutes,
    s.cook_time_minutes,
    s.servings,
    s.rating,
    s.source_url,
    s.created_at,
    s.updated_at,
    s.rank,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', t.id, 'name', t.name)
          order by t.name
        )
        from public.recipe_tags rt
        join public.tags t on t.id = rt.tag_id
        where rt.recipe_id = s.id
      ),
      '[]'::jsonb
    ) as tags
  from scored s
  -- The tag filter runs before the limit so narrowing by a tag cannot hide
  -- older recipes that were cut off by the page size.
  where tag_ids is null
     or cardinality(tag_ids) = 0
     or exists (
       select 1
       from public.recipe_tags rt
       where rt.recipe_id = s.id and rt.tag_id = any (tag_ids)
     )
  order by s.rank desc, s.created_at desc
  limit coalesce(result_limit, 200) offset coalesce(result_offset, 0);
$$;

-- Detail lookup by id. Searching the list to find one row would cap out at the
-- search page size, so opening a recipe has to address it directly.
create or replace function get_recipe(recipe_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  ingredients text[],
  steps text[],
  notes text,
  prep_time_minutes integer,
  cook_time_minutes integer,
  servings integer,
  rating smallint,
  source_url text,
  created_at timestamptz,
  updated_at timestamptz,
  rank real,
  tags jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.search_recipes(
    null::text, null::uuid[], null::integer, null::integer
  )
  where id = recipe_id;
$$;

-- Row level security --------------------------------------------------------
-- RLS is the actual security boundary here. The anon key ships inside the
-- browser bundle, so anyone can read it; these policies are what stop a leaked
-- key from exposing any rows.
alter table recipes enable row level security;
alter table tags enable row level security;
alter table recipe_tags enable row level security;

create policy "recipes are visible to their owner"
  on recipes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "recipes are insertable by their owner"
  on recipes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "recipes are updatable by their owner"
  on recipes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "recipes are deletable by their owner"
  on recipes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "tags are visible to their owner"
  on tags for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "tags are insertable by their owner"
  on tags for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "tags are updatable by their owner"
  on tags for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "tags are deletable by their owner"
  on tags for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- recipe_tags has no user_id of its own, so membership is decided by joining
-- to the owning recipe. The join alone would be enough, but adding the tag
-- check keeps a user from attaching somebody else's tag to their recipe.
create policy "recipe_tags are visible to their owner"
  on recipe_tags for select
  to authenticated
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  );

create policy "recipe_tags are insertable by their owner"
  on recipe_tags for insert
  to authenticated
  with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
    and exists (
      select 1 from tags t
      where t.id = tag_id and t.user_id = (select auth.uid())
    )
  );

create policy "recipe_tags are deletable by their owner"
  on recipe_tags for delete
  to authenticated
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_id and r.user_id = (select auth.uid())
    )
  );