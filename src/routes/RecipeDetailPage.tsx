import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteRecipe, getRecipe } from '../lib/queries'
import { formatMinutes } from '../lib/format'
import type { RecipeWithTags } from '../lib/types'

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<RecipeWithTags | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    let active = true
    getRecipe(id)
      .then((result) => {
        if (!active) return
        setRecipe(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load recipe.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  async function handleDelete() {
    if (!id) return
    if (!confirm('Delete this recipe? This cannot be undone.')) return
    setDeleting(true)
    try {
      await deleteRecipe(id)
      navigate('/')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete recipe.',
      )
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link
            to="/"
            className="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900"
          >
            ← All recipes
          </Link>
          {recipe && (
            <div className="flex gap-3">
              <Link
                to={`/recipes/${recipe.id}/edit`}
                className="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900"
              >
                Edit
              </Link>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="text-sm text-red-600 underline underline-offset-4 hover:text-red-800 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading && <p className="text-sm text-stone-500">Loading…</p>}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {recipe && (
          <article>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
              {recipe.title}
            </h1>

            {recipe.description && (
              <p className="mt-2 text-stone-600">{recipe.description}</p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-500">
              {recipe.rating !== null && (
                <span className="text-amber-600">
                  {'★'.repeat(recipe.rating)}
                  <span className="text-stone-300">
                    {'★'.repeat(5 - recipe.rating)}
                  </span>
                </span>
              )}
              {recipe.prep_time_minutes !== null && (
                <span>Prep {formatMinutes(recipe.prep_time_minutes)}</span>
              )}
              {recipe.cook_time_minutes !== null && (
                <span>Cook {formatMinutes(recipe.cook_time_minutes)}</span>
              )}
              {recipe.servings !== null && (
                <span>Serves {recipe.servings}</span>
              )}
            </div>

            {recipe.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {recipe.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}

            {recipe.ingredients.length > 0 && (
              <Section title="Ingredients">
                <ul className="space-y-1.5">
                  {recipe.ingredients.map((ingredient, i) => (
                    <li key={i} className="text-stone-700">
                      {ingredient}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {recipe.steps.length > 0 && (
              <Section title="Method">
                <ol className="space-y-3">
                  {recipe.steps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="shrink-0 font-medium text-stone-400">
                        {i + 1}.
                      </span>
                      <span className="text-stone-700">{step}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {recipe.notes && (
              <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Notes
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-stone-700">
                  {recipe.notes}
                </p>
              </section>
            )}

            {recipe.source_url && (
              <p className="mt-8 text-sm">
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-stone-600 underline underline-offset-4 hover:text-stone-900"
                >
                  View original source
                </a>
              </p>
            )}
          </article>
        )}
      </main>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}