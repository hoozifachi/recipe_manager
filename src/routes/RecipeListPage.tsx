import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { listTags, searchRecipes } from '../lib/queries'
import { formatTotalTime } from '../lib/format'
import type { RecipeWithTags, TagRow } from '../lib/types'

export function RecipeListPage() {
  const { session, signOut } = useAuth()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [recipes, setRecipes] = useState<RecipeWithTags[]>([])
  const [tags, setTags] = useState<TagRow[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Debouncing keeps a fast typist from firing a query per keystroke; the
  // server does the ranking, so there is no useful work to do in between.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let active = true
    listTags()
      .then((result) => {
        if (active) setTags(result)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load tags.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  // Derived rather than assigned in the effect: the fetch is in flight until
  // the key it was issued for matches the current one, which avoids a second
  // render pass just to flip a loading flag.
  const requestKey = `${debounced}|${selectedTags.slice().sort().join(',')}`
  const loading = loadedKey !== requestKey

  useEffect(() => {
    if (loadedKey === requestKey) return
    let active = true
    searchRecipes(debounced, selectedTags)
      .then((result) => {
        if (!active) return
        setRecipes(result)
        setError(null)
        setLoadedKey(requestKey)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load recipes.',
        )
        setLoadedKey(requestKey)
      })
    return () => {
      active = false
    }
  }, [debounced, selectedTags, requestKey, loadedKey])

  const hasFilters = debounced.trim() !== '' || selectedTags.length > 0

  const toggleTag = (id: string) => {
    setSelectedTags((current) =>
      current.includes(id)
        ? current.filter((tagId) => tagId !== id)
        : [...current, id],
    )
  }

  const email = session?.user.email ?? ''

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-stone-900">
            Recipes
          </h1>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-stone-500 sm:inline">
              {email}
            </span>
            <button
              onClick={() => void signOut()}
              className="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-6 sm:flex-row">
          <aside className="sm:w-48 sm:shrink-0">
            <Link
              to="/recipes/new"
              className="block rounded-md bg-stone-900 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-stone-700"
            >
              New recipe
            </Link>

            {tags.length > 0 && (
              <div className="mt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Tags
                </h2>
                <ul className="mt-2 flex flex-wrap gap-1.5 sm:flex-col">
                  {tags.map((tag) => {
                    const active = selectedTags.includes(tag.id)
                    return (
                      <li key={tag.id}>
                        <button
                          onClick={() => toggleTag(tag.id)}
                          aria-pressed={active}
                          className={
                            active
                              ? 'rounded-full bg-stone-900 px-2.5 py-1 text-xs font-medium text-white'
                              : 'rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-700 transition hover:border-stone-500'
                          }
                        >
                          {tag.name}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </aside>

          <section className="min-w-0 flex-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search recipes, ingredients, notes…"
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-900"
            />

            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-stone-500">
                {loading
                  ? 'Searching…'
                  : `${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}`}
              </p>
              {hasFilters && (
                <button
                  onClick={() => {
                    setQuery('')
                    setSelectedTags([])
                  }}
                  className="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900"
                >
                  Clear filters
                </button>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-4 text-sm text-red-600">
                {error}
              </p>
            )}

            {!loading && !error && recipes.length === 0 && (
              <p className="mt-8 text-sm text-stone-500">
                {hasFilters
                  ? 'No recipes match those filters.'
                  : 'No recipes yet. Add your first one.'}
              </p>
            )}

            <ul className="mt-4 space-y-3">
              {recipes.map((recipe) => (
                <li key={recipe.id}>
                  <RecipeCard recipe={recipe} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}

function RecipeCard({ recipe }: { recipe: RecipeWithTags }) {
  const totalTime = useMemo(
    () => formatTotalTime(recipe.prep_time_minutes, recipe.cook_time_minutes),
    [recipe.prep_time_minutes, recipe.cook_time_minutes],
  )

  return (
    <Link
      to={`/recipes/${recipe.id}`}
      className="block rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-400"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-stone-900">{recipe.title}</h3>
          {recipe.description && (
            <p className="mt-1 line-clamp-2 text-sm text-stone-500">
              {recipe.description}
            </p>
          )}
        </div>
        {recipe.rating !== null && (
          <span className="shrink-0 text-sm text-amber-600">
            {'★'.repeat(recipe.rating)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
        {totalTime && <span>{totalTime}</span>}
        {recipe.servings !== null && <span>Serves {recipe.servings}</span>}
        {recipe.tags.map((tag) => (
          <span
            key={tag.id}
            className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600"
          >
            {tag.name}
          </span>
        ))}
      </div>
    </Link>
  )
}