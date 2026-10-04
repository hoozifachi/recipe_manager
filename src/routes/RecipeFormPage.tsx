import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import {
  createRecipe,
  getRecipe,
  listTags,
  toDraft,
  updateRecipe,
} from '../lib/queries'
import type { RecipeDraft, TagRow } from '../lib/types'

const EMPTY_DRAFT: RecipeDraft = {
  title: '',
  description: '',
  ingredients: '',
  steps: '',
  notes: '',
  prep_time_minutes: '',
  cook_time_minutes: '',
  servings: '',
  rating: '',
  source_url: '',
  tagNames: [],
}

export function RecipeFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [draft, setDraft] = useState<RecipeDraft>(EMPTY_DRAFT)
  // The tag input holds raw text. Deriving its value from tagNames would strip
  // the comma on every keystroke, so "one, two" could never be typed out.
  const [tagText, setTagText] = useState('')
  const [allTags, setAllTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(mode === 'edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listTags()
      .then((tags) => {
        if (active) setAllTags(tags)
      })
      .catch(() => {
        // A tag-list failure is not worth blocking the form; the text field
        // still accepts free-form tags.
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (mode !== 'edit' || !id) return
    let active = true
getRecipe(id)
        .then((recipe) => {
          if (!active) return
          setDraft(toDraft(recipe))
          setTagText(recipe.tags.map((t) => t.name).join(', '))
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
  }, [mode, id])

  function update<K extends keyof RecipeDraft>(
    key: K,
    value: RecipeDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function toggleTag(name: string) {
    const next = draft.tagNames.includes(name)
      ? draft.tagNames.filter((n) => n !== name)
      : [...draft.tagNames, name]
    update('tagNames', next)
    setTagText(next.join(', '))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!userId) {
      setError('Not signed in.')
      return
    }
    setSaving(true)
    setError(null)
    const toSave = { ...draft, tagNames: parseTagInput(tagText) }
    try {
      if (mode === 'create') {
        const newId = await createRecipe(toSave, userId)
        navigate(`/recipes/${newId}`)
      } else if (id) {
        await updateRecipe(id, toSave, userId)
        navigate(`/recipes/${id}`)
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save recipe.',
      )
      setSaving(false)
    }
  }

  const heading = mode === 'create' ? 'New recipe' : 'Edit recipe'

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-stone-900">
            {heading}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <TextField
              label="Title"
              required
              value={draft.title}
              onChange={(v) => update('title', v)}
            />

            <TextField
              label="Description"
              value={draft.description}
              onChange={(v) => update('description', v)}
            />

            <TextAreaField
              label="Ingredients"
              hint="One ingredient per line."
              rows={6}
              value={draft.ingredients}
              onChange={(v) => update('ingredients', v)}
            />

            <TextAreaField
              label="Steps"
              hint="One step per line."
              rows={8}
              value={draft.steps}
              onChange={(v) => update('steps', v)}
            />

            <TextAreaField
              label="Notes"
              hint="Substitutions, tips, anything else."
              rows={4}
              value={draft.notes}
              onChange={(v) => update('notes', v)}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="Prep time"
                type="number"
                min="0"
                value={draft.prep_time_minutes}
                onChange={(v) => update('prep_time_minutes', v)}
              />
              <TextField
                label="Cook time"
                type="number"
                min="0"
                value={draft.cook_time_minutes}
                onChange={(v) => update('cook_time_minutes', v)}
              />
              <TextField
                label="Servings"
                type="number"
                min="1"
                value={draft.servings}
                onChange={(v) => update('servings', v)}
              />
            </div>

            <TextField
              label="Rating"
              type="number"
              min="1"
              max="5"
              value={draft.rating}
              onChange={(v) => update('rating', v)}
            />

            <TextField
              label="Source URL"
              type="url"
              value={draft.source_url}
              onChange={(v) => update('source_url', v)}
            />

            <TextField
              label="Tags"
              hint="Comma separated."
              value={tagText}
              onChange={setTagText}
            />

            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {allTags.map((tag) => {
                  const selected = draft.tagNames.includes(tag.name)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(tag.name)}
                      className={
                        selected
                          ? 'rounded-full bg-stone-900 px-2.5 py-1 text-xs font-medium text-white'
                          : 'rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-700 transition hover:border-stone-500'
                      }
                    >
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save recipe'}
              </button>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 transition hover:border-stone-500"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}

function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const inputClass =
  'mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-900'

function TextField({
  label,
  value,
  onChange,
  hint,
  required,
  type = 'text',
  min,
  max,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  required?: boolean
  type?: string
  min?: string
  max?: string
}) {
  return (
    <div>
      <label
        htmlFor={`field-${label}`}
        className="block text-sm font-medium text-stone-700"
      >
        {label}
      </label>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      <input
        id={`field-${label}`}
        type={type}
        required={required}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
  hint,
  rows,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  rows: number
}) {
  return (
    <div>
      <label
        htmlFor={`field-${label}`}
        className="block text-sm font-medium text-stone-700"
      >
        {label}
      </label>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      <textarea
        id={`field-${label}`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  )
}